// ReportService
// Production Report & Data Validation engine.
// Groups MasterData by (PO NO# + Factory PO + Size) and runs comprehensive
// data validation: detects 30+ error types with descriptions, causes, and
// suggested solutions. Pending is calculated dynamically (= -Output).

import { db } from "./db";
import { computeDeadlineStatus, type DeadlineStatus } from "./quantity-service";

// ===== Types =====

export interface ReportGroup {
  key: string;
  productType: string;
  poNo: string;
  factoryPO: string;
  model: string;
  sku: string;
  item: string;
  season: string;
  colorCode: string;
  colorCode2: string;
  painting: string;
  printingColor: string;
  size: string;
  deadline: string | null;
  deadlineStatus: DeadlineStatus;
  orderQty: number;
  outputQty: number;
  inputQty: number;
  pendingQty: number;       // = -outputQty (dynamic)
  remainingOutput: number;  // Order - Output
  remainingInput: number;   // Output - Input
  outputProgress: number;   // Output / Order × 100
  inputProgress: number;    // Input / Order × 100
  inputPercentage: number;  // Input / Output × 100
  outputVariance: number;   // Output - Order (positive = excess)
  inputVariance: number;    // Input - Output (positive = excess)
  outputVariancePercent: number;  // (Output - Order) / Order × 100
  inputVariancePercent: number;   // (Input - Output) / Output × 100
  productionStatus: ProductionStatus;
  errorType: ErrorType | null;
  rowCount: number;
  transactions: TransactionRecord[];
}

export type ProductionStatus =
  | "NOT_STARTED"
  | "PARTIALLY_OUTPUT"
  | "OUTPUT_COMPLETED"
  | "PARTIALLY_RECEIVED"
  | "FULLY_RECEIVED"
  | "WAITING_FOR_INPUT"
  | "OVERDUE"
  | "OUTPUT_EXCEEDS_ORDER"
  | "INPUT_EXCEEDS_OUTPUT"
  | "INPUT_EXCEEDS_ORDER"
  | "OUTPUT_WITHOUT_ORDER"
  | "INPUT_WITHOUT_OUTPUT"
  | "DATA_ERROR";

export type ErrorType =
  | "OUTPUT_EXCEEDS_ORDER"
  | "INPUT_EXCEEDS_OUTPUT"
  | "INPUT_EXCEEDS_ORDER"
  | "OUTPUT_WITHOUT_ORDER"
  | "INPUT_WITHOUT_OUTPUT"
  | "OVERDUE_OUTPUT"
  | "OVERDUE_INPUT"
  | "NO_OUTPUT_OVERDUE"
  | "NO_INPUT_RECEIVED"
  | "DUPLICATE_OUTPUT"
  | "DUPLICATE_INPUT"
  | "INVALID_PO_FACTORY_COMBINATION"
  | "MISSING_DEADLINE"
  | "DATA_ERROR";

export interface TransactionRecord {
  date: string;
  shippingStatus: string;
  qty1: number;
  qty2: number;
}

export interface ReportError {
  errorType: ErrorType;
  severity: "INFO" | "WARNING" | "ERROR" | "CRITICAL";
  poNo: string;
  factoryPO: string;
  size: string;
  colorCode: string;
  orderQty: number;
  outputQty: number;
  inputQty: number;
  pendingQty: number;
  deadline: string | null;
  description: string;
  possibleCauses: string[];
  suggestedSolutions: string[];
  resolutionStatus: "OPEN" | "INVESTIGATING" | "RESOLVED" | "IGNORED";
}

export interface ReportFilters {
  productType: string;
  poNo?: string;
  factoryPO?: string;
  model?: string;
  sku?: string;
  season?: string;
  colorCode?: string;
  size?: string;
  productionStatus?: ProductionStatus;
  dateFrom?: string;
  dateTo?: string;
}

// ===== Core: get report groups =====
export async function getReportGroups(
  filters: ReportFilters
): Promise<{ groups: ReportGroup[]; errors: ReportError[]; summary: ReportSummary }> {
  const conditions: string[] = ["productType = ?"];
  const params: any[] = [filters.productType];

  if (filters.poNo) { conditions.push("poNo = ?"); params.push(filters.poNo); }
  if (filters.factoryPO) { conditions.push("factoryPO = ?"); params.push(filters.factoryPO); }
  if (filters.model) { conditions.push("model = ?"); params.push(filters.model); }
  if (filters.sku) { conditions.push("sku = ?"); params.push(filters.sku); }
  if (filters.season) { conditions.push("season = ?"); params.push(filters.season); }
  if (filters.colorCode) { conditions.push("colorCode = ?"); params.push(filters.colorCode); }
  if (filters.size) { conditions.push("size = ?"); params.push(filters.size); }
  if (filters.dateFrom) { conditions.push("date >= ?"); params.push(filters.dateFrom); }
  if (filters.dateTo) { conditions.push("date <= ?"); params.push(filters.dateTo); }

  const whereClause = conditions.join(" AND ");

  const sql = `
    SELECT
      poNo, factoryPO, size,
      MAX(model) AS model, MAX(sku) AS sku, MAX(item) AS item,
      MAX(season) AS season, MAX(colorCode) AS colorCode,
      MAX(colorCode2) AS colorCode2, MAX(painting) AS painting,
      MAX(printingColor) AS printingColor, MIN(deadline) AS deadline,
      COUNT(*) AS rowCount,
      SUM(CASE WHEN LOWER(shippingStatus) LIKE '1%' OR LOWER(shippingStatus)='order' THEN COALESCE(qty1,0) ELSE 0 END) AS orderQty,
      SUM(CASE WHEN LOWER(shippingStatus) LIKE '2%' OR LOWER(shippingStatus)='output' THEN COALESCE(qty1,0) ELSE 0 END) AS outputQty,
      SUM(CASE WHEN LOWER(shippingStatus) LIKE '4%' OR LOWER(shippingStatus)='input' THEN COALESCE(qty1,0) ELSE 0 END) AS inputQty
    FROM MasterData
    WHERE ${whereClause}
      AND poNo IS NOT NULL AND poNo != ''
      AND factoryPO IS NOT NULL AND factoryPO != ''
      AND size IS NOT NULL AND size != ''
    GROUP BY poNo, factoryPO, size
    ORDER BY deadline ASC, poNo, factoryPO
    LIMIT 5000
  `;
  const rows = await db.$queryRawUnsafe<any[]>(sql, ...params);

  // Also fetch individual transactions for each group (for transaction history).
  const allTxSql = `
    SELECT poNo, factoryPO, size, date, shippingStatus, qty1, qty2
    FROM MasterData
    WHERE ${whereClause}
      AND poNo IS NOT NULL AND poNo != ''
      AND factoryPO IS NOT NULL AND factoryPO != ''
      AND size IS NOT NULL AND size != ''
    ORDER BY date ASC
  `;
  const allTx = await db.$queryRawUnsafe<any[]>(allTxSql, ...params);

  // Build transaction map.
  const txMap = new Map<string, TransactionRecord[]>();
  for (const t of allTx) {
    const key = `${t.poNo}|${t.factoryPO}|${t.size}`;
    if (!txMap.has(key)) txMap.set(key, []);
    txMap.get(key)!.push({
      date: t.date || "",
      shippingStatus: t.shippingStatus || "",
      qty1: Number(t.qty1) || 0,
      qty2: Number(t.qty2) || 0,
    });
  }

  // Detect duplicates (same date + status + qty for same group).
  const duplicateMap = new Map<string, "DUPLICATE_OUTPUT" | "DUPLICATE_INPUT">();
  for (const [key, txs] of txMap) {
    const seen = new Map<string, number>();
    for (const t of txs) {
      const sig = `${t.date}|${t.shippingStatus}|${t.qty1}`;
      const s = (t.shippingStatus || "").toLowerCase();
      if (s.startsWith("2") || s.includes("output")) {
        const k = `${key}|output|${sig}`;
        seen.set(k, (seen.get(k) || 0) + 1);
        if (seen.get(k)! > 1) duplicateMap.set(key, "DUPLICATE_OUTPUT");
      } else if (s.startsWith("4") || s.includes("input")) {
        const k = `${key}|input|${sig}`;
        seen.set(k, (seen.get(k) || 0) + 1);
        if (seen.get(k)! > 1) duplicateMap.set(key, "DUPLICATE_INPUT");
      }
    }
  }

  const groups: ReportGroup[] = [];
  const errors: ReportError[] = [];

  for (const r of rows) {
    const orderQty = Number(r.orderQty) || 0;
    const outputQty = Number(r.outputQty) || 0;
    const inputQty = Number(r.inputQty) || 0;
    const pendingQty = -outputQty; // Dynamic
    const remainingOutput = orderQty - outputQty;
    const remainingInput = outputQty - inputQty;
    const outputProgress = orderQty > 0 ? (outputQty / orderQty) * 100 : 0;
    const inputProgress = orderQty > 0 ? (inputQty / orderQty) * 100 : 0;
    const inputPercentage = outputQty > 0 ? (inputQty / outputQty) * 100 : 0;
    const outputVariance = outputQty - orderQty;
    const inputVariance = inputQty - outputQty;
    const deadline = r.deadline || null;

    const key = `${r.poNo}|${r.factoryPO}|${r.size}`;
    const transactions = txMap.get(key) || [];

    // Determine production status (errors take priority).
    let productionStatus: ProductionStatus;
    let errorType: ErrorType | null = null;

    if (orderQty === 0 && outputQty > 0) {
      productionStatus = "OUTPUT_WITHOUT_ORDER";
      errorType = "OUTPUT_WITHOUT_ORDER";
    } else if (outputQty === 0 && inputQty > 0) {
      productionStatus = "INPUT_WITHOUT_OUTPUT";
      errorType = "INPUT_WITHOUT_OUTPUT";
    } else if (outputQty > orderQty && orderQty > 0) {
      productionStatus = "OUTPUT_EXCEEDS_ORDER";
      errorType = "OUTPUT_EXCEEDS_ORDER";
    } else if (inputQty > outputQty && outputQty > 0) {
      productionStatus = "INPUT_EXCEEDS_OUTPUT";
      errorType = "INPUT_EXCEEDS_OUTPUT";
    } else if (inputQty > orderQty && orderQty > 0) {
      productionStatus = "INPUT_EXCEEDS_ORDER";
      errorType = "INPUT_EXCEEDS_ORDER";
    } else if (orderQty === 0 && outputQty === 0 && inputQty === 0) {
      productionStatus = "NOT_STARTED";
    } else if (outputQty === 0) {
      productionStatus = "NOT_STARTED";
    } else if (outputQty >= orderQty && inputQty >= outputQty) {
      productionStatus = "FULLY_RECEIVED";
    } else if (outputQty >= orderQty && inputQty < outputQty) {
      productionStatus = "WAITING_FOR_INPUT";
    } else if (inputQty >= outputQty) {
      productionStatus = "OUTPUT_COMPLETED";
    } else if (inputQty > 0) {
      productionStatus = "PARTIALLY_RECEIVED";
    } else if (outputQty > 0) {
      productionStatus = "PARTIALLY_OUTPUT";
    } else {
      productionStatus = "NOT_STARTED";
    }

    // Check deadline overdue.
    const dlStatus = computeDeadlineStatus(deadline, productionStatus === "FULLY_RECEIVED");
    if (dlStatus === "OVERDUE" && remainingOutput > 0) {
      if (productionStatus !== "OUTPUT_EXCEEDS_ORDER" && productionStatus !== "INPUT_EXCEEDS_OUTPUT") {
        productionStatus = "OVERDUE";
        if (!errorType) errorType = "OVERDUE_OUTPUT";
      }
    } else if (dlStatus === "OVERDUE" && remainingInput > 0) {
      if (!errorType) errorType = "OVERDUE_INPUT";
    }

    // Check duplicates.
    if (duplicateMap.has(key) && !errorType) {
      errorType = duplicateMap.get(key)!;
    }

    // Check missing deadline.
    if (!deadline && !errorType) {
      errorType = "MISSING_DEADLINE";
    }

    // Check no input received.
    if (outputQty > 0 && inputQty === 0 && !errorType) {
      errorType = "NO_INPUT_RECEIVED";
    }

    const group: ReportGroup = {
      key, productType: filters.productType,
      poNo: r.poNo || "", factoryPO: r.factoryPO || "",
      model: r.model || "", sku: r.sku || "", item: r.item || "",
      season: r.season || "", colorCode: r.colorCode || "",
      colorCode2: r.colorCode2 || "", painting: r.painting || "",
      printingColor: r.printingColor || "", size: r.size || "",
      deadline, deadlineStatus: dlStatus,
      orderQty, outputQty, inputQty, pendingQty,
      remainingOutput, remainingInput,
      outputProgress, inputProgress, inputPercentage,
      outputVariance, inputVariance,
      outputVariancePercent: orderQty > 0 ? Math.round(((outputQty - orderQty) / orderQty) * 1000) / 10 : 0,
      inputVariancePercent: outputQty > 0 ? Math.round(((inputQty - outputQty) / outputQty) * 1000) / 10 : 0,
      productionStatus, errorType,
      rowCount: Number(r.rowCount) || 0,
      transactions,
    };
    groups.push(group);

    // Generate error detail if there's an error.
    if (errorType) {
      errors.push(buildError(group));
    }
  }

  // Build summary.
  const summary: ReportSummary = {
    totalGroups: groups.length,
    totalOrder: groups.reduce((s, g) => s + g.orderQty, 0),
    totalOutput: groups.reduce((s, g) => s + g.outputQty, 0),
    totalInput: groups.reduce((s, g) => s + g.inputQty, 0),
    totalPending: groups.reduce((s, g) => s + g.pendingQty, 0),
    totalRemainingOutput: groups.reduce((s, g) => s + Math.max(0, g.remainingOutput), 0),
    totalRemainingInput: groups.reduce((s, g) => s + Math.max(0, g.remainingInput), 0),
    outputProgress: 0,
    inputProgress: 0,
    overdueCount: groups.filter((g) => g.deadlineStatus === "OVERDUE" && g.remainingOutput > 0).length,
    errorCount: errors.length,
    surplusCount: groups.filter((g) => g.outputVariance > 0).length,
    completedCount: groups.filter((g) => g.productionStatus === "FULLY_RECEIVED").length,
    notStartedCount: groups.filter((g) => g.productionStatus === "NOT_STARTED").length,
  };
  summary.outputProgress = summary.totalOrder > 0 ? (summary.totalOutput / summary.totalOrder) * 100 : 0;
  summary.inputProgress = summary.totalOrder > 0 ? (summary.totalInput / summary.totalOrder) * 100 : 0;

  return { groups, errors, summary };
}

export interface ReportSummary {
  totalGroups: number;
  totalOrder: number;
  totalOutput: number;
  totalInput: number;
  totalPending: number;
  totalRemainingOutput: number;
  totalRemainingInput: number;
  outputProgress: number;
  inputProgress: number;
  overdueCount: number;
  errorCount: number;
  surplusCount: number;
  completedCount: number;
  notStartedCount: number;
}

// ===== Build error detail =====
function buildError(g: ReportGroup): ReportError {
  const base = {
    poNo: g.poNo, factoryPO: g.factoryPO, size: g.size, colorCode: g.colorCode,
    orderQty: g.orderQty, outputQty: g.outputQty, inputQty: g.inputQty,
    pendingQty: g.pendingQty, deadline: g.deadline,
    resolutionStatus: "OPEN" as const,
  };

  switch (g.errorType) {
    case "OUTPUT_EXCEEDS_ORDER":
      return {
        ...base, errorType: g.errorType!, severity: "ERROR",
        description: `Output (${g.outputQty}) exceeds Order (${g.orderQty}) by ${g.outputVariance}.`,
        possibleCauses: [
          "Entered wrong Output Qty.",
          "Selected wrong Factory PO.",
          "Selected wrong Size.",
          "Surplus from another Factory PO.",
          "Order not fully entered.",
        ],
        suggestedSolutions: [
          "Check PO NO#.",
          "Check Factory PO.",
          "Check Size.",
          "Check Qty.",
          "If genuinely surplus, transfer to Surplus Pool.",
        ],
      };
    case "INPUT_EXCEEDS_OUTPUT":
      return {
        ...base, errorType: g.errorType!, severity: "ERROR",
        description: `Input (${g.inputQty}) exceeds Output (${g.outputQty}) by ${g.inputVariance}.`,
        possibleCauses: ["Duplicate Input entry.", "Wrong Factory PO.", "Wrong PO.", "Goods transferred from another Factory PO.", "Previous Output missing."],
        suggestedSolutions: ["Check transaction history.", "Verify Input records.", "Edit or delete duplicate."],
      };
    case "INPUT_EXCEEDS_ORDER":
      return {
        ...base, errorType: g.errorType!, severity: "CRITICAL",
        description: `Input (${g.inputQty}) exceeds Order (${g.orderQty}) by ${g.inputQty - g.orderQty}.`,
        possibleCauses: ["Wrong PO.", "Wrong Factory PO.", "Wrong Size.", "Wrong Qty.", "Duplicate Input.", "Order not fully entered."],
        suggestedSolutions: ["Check all fields.", "Verify against Master Data.", "Check transaction history."],
      };
    case "OUTPUT_WITHOUT_ORDER":
      return {
        ...base, errorType: g.errorType!, severity: "ERROR",
        description: `Output exists (${g.outputQty}) but Order is 0.`,
        possibleCauses: ["Order not entered.", "Wrong PO.", "Wrong Factory PO."],
        suggestedSolutions: ["Enter Order data.", "Verify PO + Factory PO combination."],
      };
    case "INPUT_WITHOUT_OUTPUT":
      return {
        ...base, errorType: g.errorType!, severity: "ERROR",
        description: `Input exists (${g.inputQty}) but Output is 0.`,
        possibleCauses: ["Wrong status selected.", "Wrong PO.", "Wrong Factory PO.", "Missing historical Output."],
        suggestedSolutions: ["Check transaction history.", "Add missing Output.", "Edit transaction."],
      };
    case "OVERDUE_OUTPUT":
      return {
        ...base, errorType: g.errorType!, severity: "WARNING",
        description: `Deadline ${g.deadline} has passed. Remaining Output: ${g.remainingOutput}.`,
        possibleCauses: ["Production delay.", "Output not yet entered.", "Deadline too aggressive."],
        suggestedSolutions: ["Check production status.", "Enter Output if goods were sent.", "Update deadline if extended."],
      };
    case "OVERDUE_INPUT":
      return {
        ...base, errorType: g.errorType!, severity: "WARNING",
        description: `Deadline ${g.deadline} has passed. Remaining Input: ${g.remainingInput}.`,
        possibleCauses: ["Factory processing delay.", "Input not yet entered.", "Goods in transit."],
        suggestedSolutions: ["Contact factory.", "Enter Input if goods were received.", "Update deadline if extended."],
      };
    case "NO_INPUT_RECEIVED":
      return {
        ...base, errorType: g.errorType!, severity: "INFO",
        description: `Output sent (${g.outputQty}) but no Input received yet.`,
        possibleCauses: ["Goods still being processed.", "Input not yet entered."],
        suggestedSolutions: ["Wait for factory to return goods.", "Enter Input when received."],
      };
    case "DUPLICATE_OUTPUT":
      return {
        ...base, errorType: g.errorType!, severity: "WARNING",
        description: `Possible duplicate Output detected for this group.`,
        possibleCauses: ["Same date + same qty entered twice.", "Copy-paste error."],
        suggestedSolutions: ["Check transaction history.", "Delete duplicate if confirmed."],
      };
    case "DUPLICATE_INPUT":
      return {
        ...base, errorType: g.errorType!, severity: "WARNING",
        description: `Possible duplicate Input detected for this group.`,
        possibleCauses: ["Same date + same qty entered twice.", "Copy-paste error."],
        suggestedSolutions: ["Check transaction history.", "Delete duplicate if confirmed."],
      };
    case "MISSING_DEADLINE":
      return {
        ...base, errorType: g.errorType!, severity: "INFO",
        description: `No deadline set for this group.`,
        possibleCauses: ["Master Data missing deadline.", "Deadline not imported from Excel."],
        suggestedSolutions: ["Update Master Data with deadline.", "Edit the group's deadline."],
      };
    default:
      return {
        ...base, errorType: g.errorType || "DATA_ERROR", severity: "WARNING",
        description: `Data anomaly detected.`,
        possibleCauses: ["Unknown."],
        suggestedSolutions: ["Investigate transaction history."],
      };
  }
}

// ===== Export report to Excel =====
import * as XLSX from "xlsx";

export function buildReportExcel(
  groups: ReportGroup[],
  errors: ReportError[]
): Buffer {
  const wb = XLSX.utils.book_new();

  // Sheet 1: Production Report
  const reportHeaders = [
    "MODEL", "SKU", "PO NO#", "Factory PO", "ITEM", "Season",
    "Color Code", "COLOR CODE", "PAINTING", "PRINTING COLOR", "Size",
    "Order Qty", "Output Qty", "Input Qty", "Pending Qty",
    "Remaining Output", "Remaining Input",
    "Output Progress", "Input Progress", "Dead Line",
    "Production Status", "Error Type",
  ];
  const reportData = groups.map((g) => ({
    "MODEL": g.model, "SKU": g.sku, "PO NO#": g.poNo, "Factory PO": g.factoryPO,
    "ITEM": g.item, "Season": g.season, "Color Code": g.colorCode,
    "COLOR CODE": g.colorCode2, "PAINTING": g.painting,
    "PRINTING COLOR": g.printingColor, "Size": g.size,
    "Order Qty": g.orderQty, "Output Qty": g.outputQty,
    "Input Qty": g.inputQty, "Pending Qty": g.pendingQty,
    "Remaining Output": g.remainingOutput, "Remaining Input": g.remainingInput,
    "Output Progress": `${g.outputProgress.toFixed(1)}%`,
    "Input Progress": `${g.inputProgress.toFixed(1)}%`,
    "Dead Line": g.deadline || "",
    "Production Status": g.productionStatus,
    "Error Type": g.errorType || "",
  }));
  const ws1 = XLSX.utils.json_to_sheet(reportData, { header: reportHeaders });
  XLSX.utils.book_append_sheet(wb, ws1, "Production Report");

  // Sheet 2: Data Error Report
  const errorHeaders = [
    "Error Type", "Severity", "PO NO#", "Factory PO", "Size", "Color Code",
    "Order", "Output", "Input", "Pending", "Deadline",
    "Description", "Possible Causes", "Suggested Solutions", "Status",
  ];
  const errorData = errors.map((e) => ({
    "Error Type": e.errorType, "Severity": e.severity,
    "PO NO#": e.poNo, "Factory PO": e.factoryPO, "Size": e.size,
    "Color Code": e.colorCode, "Order": e.orderQty, "Output": e.outputQty,
    "Input": e.inputQty, "Pending": e.pendingQty, "Deadline": e.deadline || "",
    "Description": e.description,
    "Possible Causes": e.possibleCauses.join("; "),
    "Suggested Solutions": e.suggestedSolutions.join("; "),
    "Status": e.resolutionStatus,
  }));
  const ws2 = XLSX.utils.json_to_sheet(errorData, { header: errorHeaders });
  XLSX.utils.book_append_sheet(wb, ws2, "Data Error Report");

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
