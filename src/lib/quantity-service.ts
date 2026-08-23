// QuantityCalculationService
// Business logic for production quantity calculations.
//
// Shipping status meanings (per spec):
//   1.Order   → quantity ordered for outsource processing (per quarter)
//   2.Output  → quantity actually sent out for processing
//   3.Pending → copy of Output as NEGATIVE (offset, not a real order)
//   4.Input   → quantity received back after processing
//
// Key formulas:
//   Output Remaining = Order - Output
//   Processing       = Output - Input
//   Input Remaining  = Order - Input
//   Completion %     = Input / Order × 100
//   Output %         = Output / Order × 100
//   Processing %     = (Output - Input) / Order × 100
//   Missing          = Order - Input (same as Input Remaining; flagged when > 0)

export type ShippingStatus = "order" | "output" | "pending" | "input" | "other";

// Classify a raw shipping status string into the canonical bucket.
// Handles "1.Order", "1. Order", "Order", "2.Output", "2. Output", etc.
export function classifyShippingStatus(raw: string | null | undefined): ShippingStatus {
  if (!raw) return "other";
  const s = String(raw).trim().toLowerCase();
  if (s.startsWith("1") || s === "order") return "order";
  if (s.startsWith("2") || s === "output") return "output";
  if (s.startsWith("3") || s === "pending" || s.includes("spend")) return "pending";
  if (s.startsWith("4") || s === "input") return "input";
  return "other";
}

export interface RawQtyRow {
  shippingStatus: string | null;
  qty1: string | null;
  qty2?: string | null;
  date?: string | null;
  deadline?: string | null;
}

export interface AggregatedQty {
  orderQty: number;
  outputQty: number;
  pendingQty: number; // kept as raw sum (usually negative)
  inputQty: number;
}

// Aggregate raw rows into Order/Output/Pending/Input sums.
// Each row contributes its qty1 to exactly one bucket based on shipping status.
export function aggregateQuantities(rows: RawQtyRow[]): AggregatedQty {
  let orderQty = 0, outputQty = 0, pendingQty = 0, inputQty = 0;
  for (const r of rows) {
    const qty = Number(r.qty1);
    const q = isNaN(qty) ? 0 : qty;
    const bucket = classifyShippingStatus(r.shippingStatus);
    switch (bucket) {
      case "order": orderQty += q; break;
      case "output": outputQty += q; break;
      case "pending": pendingQty += q; break;
      case "input": inputQty += q; break;
      // "other" rows are ignored in calculations
    }
  }
  return { orderQty, outputQty, pendingQty, inputQty };
}

export interface ProductionSummary extends AggregatedQty {
  outputRemaining: number;   // Order - Output
  processing: number;        // Output - Input
  inputRemaining: number;     // Order - Input
  outputRate: number;        // Output / Order × 100
  completionRate: number;    // Input / Order × 100
  processingRate: number;    // (Output - Input) / Order × 100
  missing: number;           // max(0, Order - Input)
  quantityStatus: QuantityStatus;
}

export type QuantityStatus =
  | "COMPLETED"
  | "PROCESSING"
  | "WARNING"
  | "NOT_STARTED";

// Compute the full production summary from aggregated quantities.
export function computeProductionSummary(q: AggregatedQty): ProductionSummary {
  const order = q.orderQty;
  const output = q.outputQty;
  const input = q.inputQty;
  const outputRemaining = order - output;
  const processing = output - input;
  const inputRemaining = order - input;
  const missing = Math.max(0, inputRemaining);
  const outputRate = order > 0 ? (output / order) * 100 : 0;
  const completionRate = order > 0 ? (input / order) * 100 : 0;
  const processingRate = order > 0 ? (processing / order) * 100 : 0;

  let quantityStatus: QuantityStatus;
  if (order === 0) quantityStatus = "NOT_STARTED";
  else if (input >= order && output >= order) quantityStatus = "COMPLETED";
  else if (input > 0 || output > 0) quantityStatus = "PROCESSING";
  else quantityStatus = "WARNING";

  return {
    ...q,
    outputRemaining,
    processing,
    inputRemaining,
    outputRate,
    completionRate,
    processingRate,
    missing,
    quantityStatus,
  };
}

// ===== Deadline engine =====
export type DeadlineStatus =
  | "OVERDUE"
  | "DUE_TODAY"
  | "DUE_TOMORROW"
  | "DUE_THIS_WEEK"
  | "UPCOMING"
  | "COMPLETED"
  | "NO_DEADLINE";

// Parse a deadline string. Handles yyyy-MM-dd, dd/MM/yyyy, and Excel serials.
export function parseDeadline(dateStr: string | null | undefined): Date | null {
  if (!dateStr) return null;
  const s = String(dateStr).trim();
  if (!s) return null;
  // dd/MM/yyyy
  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) {
    const d = new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
    if (!isNaN(d.getTime())) return d;
  }
  // yyyy-MM-dd or ISO
  const iso = new Date(s);
  if (!isNaN(iso.getTime())) return iso;
  // Excel serial
  const n = Number(s);
  if (!isNaN(n) && n > 1000) {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    epoch.setDate(epoch.getDate() + n);
    return epoch;
  }
  return null;
}

// Compute deadline status relative to "now".
export function computeDeadlineStatus(
  deadline: string | null | undefined,
  completed: boolean,
  now: Date = new Date()
): DeadlineStatus {
  if (completed) return "COMPLETED";
  const d = parseDeadline(deadline);
  if (!d) return "NO_DEADLINE";
  const startToday = new Date(now);
  startToday.setHours(0, 0, 0, 0);
  const dNorm = new Date(d);
  dNorm.setHours(0, 0, 0, 0);
  const dayMs = 86400000;
  const diff = dNorm.getTime() - startToday.getTime();
  if (diff < 0) return "OVERDUE";
  if (diff < dayMs) return "DUE_TODAY";
  if (diff < 2 * dayMs) return "DUE_TOMORROW";
  if (diff < 7 * dayMs) return "DUE_THIS_WEEK";
  return "UPCOMING";
}

// Combined alert priority for sorting the alert table.
export type AlertPriority = "HIGH" | "MEDIUM" | "LOW" | "INFO";

export interface AlertInfo {
  priority: AlertPriority;
  deadlineStatus: DeadlineStatus;
  quantityStatus: QuantityStatus;
  outputRemaining: number;
  missing: number;
  messages: string[];
}

// Combine deadline + quantity into a single alert assessment.
export function assessAlert(summary: ProductionSummary, deadline: string | null): AlertInfo {
  const deadlineStatus = computeDeadlineStatus(deadline, summary.quantityStatus === "COMPLETED");
  const messages: string[] = [];
  let priority: AlertPriority = "INFO";

  if (deadlineStatus === "OVERDUE" && summary.missing > 0) {
    priority = "HIGH";
    messages.push(`🔴 OVERDUE: ${summary.missing} units not yet received (deadline ${deadline})`);
  } else if (deadlineStatus === "DUE_TODAY" && summary.outputRemaining > 0) {
    priority = "HIGH";
    messages.push(`🔴 DUE TODAY: ${summary.outputRemaining} units have not been output`);
  } else if (deadlineStatus === "DUE_TOMORROW" && summary.outputRemaining > 0) {
    priority = "MEDIUM";
    messages.push(`🟠 Due tomorrow: ${summary.outputRemaining} units not yet output`);
  } else if (summary.outputRemaining > 0) {
    priority = "MEDIUM";
    messages.push(`⚠ Output shortage: ${summary.outputRemaining} units remaining to output`);
  }
  if (summary.missing > 0 && priority !== "HIGH") {
    priority = priority === "INFO" ? "MEDIUM" : priority;
    messages.push(`⚠ ${summary.missing} units missing (ordered ${summary.orderQty}, received ${summary.inputQty})`);
  }
  if (summary.quantityStatus === "COMPLETED") {
    if (priority === "INFO") {
      priority = "LOW";
      messages.push("🟢 Completed");
    }
  }

  return {
    priority,
    deadlineStatus,
    quantityStatus: summary.quantityStatus,
    outputRemaining: summary.outputRemaining,
    missing: summary.missing,
    messages,
  };
}
