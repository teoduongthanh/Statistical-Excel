// Timeline Validator — Chronology & Causality Validation Engine (spec VAL1-VAL7)
//
// This is a PURE MODULE (no DB calls) — takes events as input, returns violations.
// Used by: Report & Validation, Data Entry realtime (VAL6), auto re-run (VAL7).
//
// Spec:
//   VAL1: sequence check (dates must be ordered S1→S2→S3→S4)
//   VAL2: causality check (running balance: received ≤ sent, shipped ≤ received)
//   VAL3: conflict detection (same key, different qty/date)
//   VAL4: status codes + severity + policy
//   VAL5: diagnostic drill-down (timeline + Vietnamese explanation)

import { classifyShippingStatus } from "./quantity-service";

// ── Types ───────────────────────────────────────────────────────────────────

export type Stage = "S1_ORDER" | "S2_SENT_OUT" | "S3_RECEIVED_IN" | "S4_SHIPPED_CUST";

export interface TimelineEvent {
  key: string;           // composite key: poNo|factoryPO|size
  stage: Stage;
  date: string;          // normalized yyyy-MM-dd
  qty: number;
  rowId?: string;        // ref to original MasterData/EntryData row
  sourceData?: Record<string, any>; // full row data for drill-down
}

export type ViolationCode =
  | "INPUT_BEFORE_SEND"      // S3 before S2
  | "OUTPUT_BEFORE_INPUT"     // S4 before S3
  | "BEFORE_ORDER"            // any stage before S1
  | "SAME_DAY_MULTI"          // multiple stages same day
  | "RECEIVED_OVER_SENT"      // cumulative S3 > cumulative S2
  | "SHIPPED_OVER_RECEIVED"   // cumulative S4 > cumulative S3
  | "SENT_OVER_ORDERED"       // cumulative S2 > cumulative S1
  | "IMPOSSIBLE_RECEIPT"      // S3 exists but no S2
  | "CONFLICT_VERSION";       // same key+stage, different qty/date

export type Severity = "ERROR" | "WARNING" | "INFO";

export interface Violation {
  ruleCode: ViolationCode;
  severity: Severity;
  key: string;
  evidence: TimelineEvent[];
  diagnostic: {
    timeline: TimelineEvent[];
    explanation: string[];      // Vietnamese step-by-step
    causeSuggestions: Array<{ cause: string; confidence: number; evidence: string }>;
    similarCases?: Array<{ key: string; ruleCode: string }>;
  };
  expected?: string;
  actual?: string;
  diff?: number;
}

export interface ValidationConfig {
  toleranceDays: number;         // default: 0
  stageOrder: Stage[];          // default: [S1, S2, S3, S4]
  policy: "flag" | "exclude" | "warn_only"; // default: flag
}

export const DEFAULT_CONFIG: ValidationConfig = {
  toleranceDays: 0,
  stageOrder: ["S1_ORDER", "S2_SENT_OUT", "S3_RECEIVED_IN", "S4_SHIPPED_CUST"],
  policy: "flag",
};

// ── Stage detection (spec §2: identify stage from shipping status) ──────────

export function detectStage(shippingStatus: string): Stage | null {
  const bucket = classifyShippingStatus(shippingStatus);
  switch (bucket) {
    case "order": return "S1_ORDER";
    case "output": return "S2_SENT_OUT"; // Output = sent to processing
    case "input": return "S3_RECEIVED_IN"; // Input = received from processing
    // S4_SHIPPED_CUST is typically a separate status or derived from Output to customer
    // For now, we map Output to S2 (sent to processing) and Input to S3 (received)
    // S4 can be configured separately if the business has a distinct "shipped to customer" status
    default: return null;
  }
}

// ── Main validation function ────────────────────────────────────────────────

export function validateTimeline(
  events: TimelineEvent[],
  config: ValidationConfig = DEFAULT_CONFIG
): Violation[] {
  const violations: Violation[] = [];

  // Group events by key
  const byKey = new Map<string, TimelineEvent[]>();
  for (const e of events) {
    let arr = byKey.get(e.key);
    if (!arr) {
      arr = [];
      byKey.set(e.key, arr);
    }
    arr.push(e);
  }

  // Validate each key
  for (const [key, keyEvents] of byKey) {
    violations.push(...validateKey(key, keyEvents, config));
  }

  // Find similar cases (same ruleCode across different keys)
  const ruleCounts = new Map<string, number>();
  for (const v of violations) {
    ruleCounts.set(v.ruleCode, (ruleCounts.get(v.ruleCode) || 0) + 1);
  }

  // Add similar cases to each violation
  for (const v of violations) {
    const similar: Array<{ key: string; ruleCode: string }> = [];
    for (const other of violations) {
      if (other.key !== v.key && other.ruleCode === v.ruleCode && similar.length < 5) {
        similar.push({ key: other.key, ruleCode: other.ruleCode });
      }
    }
    v.diagnostic.similarCases = similar;
  }

  return violations;
}

// ── Validate a single key ───────────────────────────────────────────────────

function validateKey(
  key: string,
  events: TimelineEvent[],
  config: ValidationConfig
): Violation[] {
  const violations: Violation[] = [];

  // Sort events by date
  const sorted = [...events].sort((a, b) => a.date.localeCompare(b.date));

  // Group by stage
  const byStage = new Map<Stage, TimelineEvent[]>();
  for (const e of sorted) {
    let arr = byStage.get(e.stage);
    if (!arr) {
      arr = [];
      byStage.set(e.stage, arr);
    }
    arr.push(e);
  }

  // ── VAL1: Sequence check (dates must be ordered) ──────────────────────
  const orderEvents = config.stageOrder
    .map(stage => ({ stage, events: byStage.get(stage) || [] }))
    .filter(s => s.events.length > 0);

  for (let i = 1; i < orderEvents.length; i++) {
    const prev = orderEvents[i - 1];
    const curr = orderEvents[i];

    // Check if any event in curr stage is before any event in prev stage
    for (const currEvent of curr.events) {
      for (const prevEvent of prev.events) {
        const diff = daysBetween(prevEvent.date, currEvent.date);
        if (diff < -config.toleranceDays) {
          // curr is BEFORE prev → violation
          let code: ViolationCode;
          let severity: Severity = "ERROR";

          if (curr.stage === "S3_RECEIVED_IN" && prev.stage === "S2_SENT_OUT") {
            code = "INPUT_BEFORE_SEND";
          } else if (curr.stage === "S4_SHIPPED_CUST" && prev.stage === "S3_RECEIVED_IN") {
            code = "OUTPUT_BEFORE_INPUT";
          } else if (prev.stage === "S1_ORDER") {
            code = "BEFORE_ORDER";
          } else {
            code = "INPUT_BEFORE_SEND"; // generic
          }

          violations.push({
            ruleCode: code,
            severity,
            key,
            evidence: [prevEvent, currEvent],
            diagnostic: {
              timeline: sorted,
              explanation: [
                `Bước 1: Lấy mọi dòng của khóa ${key} → ${events.length} bản ghi.`,
                `Bước 2: Sắp xếp theo ngày → ${curr.stage} (${currEvent.date}, SL ${currEvent.qty}) xảy ra TRƯỚC ${prev.stage} (${prevEvent.date}, SL ${prevEvent.qty}).`,
                `Bước 3: Kết luận ${code}: lệch ${Math.abs(diff)} ngày — dữ liệu ${stageLabel(curr.stage)} không thể tồn tại trước ${stageLabel(prev.stage)}.`,
              ],
              causeSuggestions: [
                {
                  cause: "Nhầm ngày do 2 định dạng lẫn lộn (VD: '11-Jul' vs '30-09-2026')",
                  confidence: 70,
                  evidence: `Ngày ${currEvent.date} vs ${prevEvent.date}`,
                },
                {
                  cause: "Nhập sai ngày khi nhập liệu thủ công",
                  confidence: 50,
                  evidence: `Business date có thể bị sai`,
                },
              ],
            },
            expected: `${prevEvent.date} (sau ${stageLabel(prev.stage)})`,
            actual: `${currEvent.date} (trước ${stageLabel(prev.stage)})`,
            diff,
          });
        }
      }
    }
  }

  // ── VAL2: Causality check (running balance) ────────────────────────────
  // Cumulative sums by stage
  const sums: Record<Stage, number> = {
    S1_ORDER: 0, S2_SENT_OUT: 0, S3_RECEIVED_IN: 0, S4_SHIPPED_CUST: 0,
  };
  for (const e of sorted) {
    sums[e.stage] += e.qty;
  }

  // S3 (received) > S2 (sent) → RECEIVED_OVER_SENT
  if (sums.S3_RECEIVED_IN > sums.S2_SENT_OUT && sums.S2_SENT_OUT > 0) {
    const excess = sums.S3_RECEIVED_IN - sums.S2_SENT_OUT;
    violations.push({
      ruleCode: "RECEIVED_OVER_SENT",
      severity: "ERROR",
      key,
      evidence: sorted.filter(e => e.stage === "S2_SENT_OUT" || e.stage === "S3_RECEIVED_IN"),
      diagnostic: {
        timeline: sorted,
        explanation: [
          `Bước 1: Tính lũy kế theo timeline cho khóa ${key}.`,
          `Bước 2: Tổng đã nhận về (S3) = ${sums.S3_RECEIVED_IN}, tổng đã giao đi (S2) = ${sums.S2_SENT_OUT}.`,
          `Bước 3: Nhận về (${sums.S3_RECEIVED_IN}) > Giao đi (${sums.S2_SENT_OUT}) → vượt ${excess}.`,
          `Bước 4: Kết luận RECEIVED_OVER_SENT: hàng chưa được giao đi ${sums.S2_SENT_OUT} nhưng đã nhận về ${sums.S3_RECEIVED_IN} → ${excess} đôi không thể tồn tại.`,
        ],
        causeSuggestions: [
          {
            cause: "Dữ liệu nhận về ghi trước khi dữ liệu giao đi được nhập vào hệ thống",
            confidence: 80,
            evidence: `S3 = ${sums.S3_RECEIVED_IN} > S2 = ${sums.S2_SENT_OUT}`,
          },
          {
            cause: "Nhập trùng lặp dòng Input",
            confidence: 60,
            evidence: "Kiểm tra xem có dòng S3 bị trùng không",
          },
        ],
      },
      expected: `≤ ${sums.S2_SENT_OUT}`,
      actual: `${sums.S3_RECEIVED_IN}`,
      diff: excess,
    });
  }

  // S3 exists but no S2 → IMPOSSIBLE_RECEIPT
  if (sums.S3_RECEIVED_IN > 0 && sums.S2_SENT_OUT === 0) {
    violations.push({
      ruleCode: "IMPOSSIBLE_RECEIPT",
      severity: "ERROR",
      key,
      evidence: sorted.filter(e => e.stage === "S3_RECEIVED_IN"),
      diagnostic: {
        timeline: sorted,
        explanation: [
          `Bước 1: Khóa ${key} có bản ghi nhận về (Input) nhưng KHÔNG có bản ghi giao đi (Output).`,
          `Bước 2: Hàng chưa được giao đi gia công → không thể có dữ liệu nhận về.`,
          `Bước 3: Kết luận IMPOSSIBLE_RECEIPT: ${sums.S3_RECEIVED_IN} đôi hàng nhận về không có nguồn gốc.`,
        ],
        causeSuggestions: [
          {
            cause: "Thiếu dữ liệu Output — chưa nhập hoặc chưa import",
            confidence: 85,
            evidence: "S2 = 0 nhưng S3 > 0",
          },
          {
            cause: "Nhầm PO — dữ liệu nhận về có thể thuộc PO khác",
            confidence: 60,
            evidence: "Kiểm tra PO tương tự (Levenshtein ≤ 2)",
          },
        ],
      },
      expected: "Có S2 (giao đi) trước khi có S3 (nhận về)",
      actual: `S2 = 0, S3 = ${sums.S3_RECEIVED_IN}`,
      diff: sums.S3_RECEIVED_IN,
    });
  }

  // S4 (shipped to customer) > S3 (received) → SHIPPED_OVER_RECEIVED
  if (sums.S4_SHIPPED_CUST > sums.S3_RECEIVED_IN && sums.S3_RECEIVED_IN > 0) {
    const excess = sums.S4_SHIPPED_CUST - sums.S3_RECEIVED_IN;
    violations.push({
      ruleCode: "SHIPPED_OVER_RECEIVED",
      severity: "ERROR",
      key,
      evidence: sorted.filter(e => e.stage === "S3_RECEIVED_IN" || e.stage === "S4_SHIPPED_CUST"),
      diagnostic: {
        timeline: sorted,
        explanation: [
          `Bước 1: Tính lũy kế cho khóa ${key}.`,
          `Bước 2: Tổng đã xuất khách (S4) = ${sums.S4_SHIPPED_CUST}, tổng đã nhận về (S3) = ${sums.S3_RECEIVED_IN}.`,
          `Bước 3: Xuất khách > Nhận về → vượt ${excess} đôi.`,
          `Bước 4: Kết luận SHIPPED_OVER_RECEIVED: không thể xuất nhiều hơn đã nhận.`,
        ],
        causeSuggestions: [
          {
            cause: "Nhập trùng lặp dòng Output",
            confidence: 70,
            evidence: "Kiểm tra dòng S4 trùng lặp",
          },
        ],
      },
      expected: `≤ ${sums.S3_RECEIVED_IN}`,
      actual: `${sums.S4_SHIPPED_CUST}`,
      diff: excess,
    });
  }

  // S2 (sent) > S1 (ordered) → SENT_OVER_ORDERED
  if (sums.S2_SENT_OUT > sums.S1_ORDER && sums.S1_ORDER > 0) {
    const excess = sums.S2_SENT_OUT - sums.S1_ORDER;
    violations.push({
      ruleCode: "SENT_OVER_ORDERED",
      severity: "WARNING",
      key,
      evidence: sorted.filter(e => e.stage === "S1_ORDER" || e.stage === "S2_SENT_OUT"),
      diagnostic: {
        timeline: sorted,
        explanation: [
          `Bước 1: Tính lũy kế cho khóa ${key}.`,
          `Bước 2: Tổng đã giao đi (S2) = ${sums.S2_SENT_OUT}, đơn đặt (S1) = ${sums.S1_ORDER}.`,
          `Bước 3: Giao đi > Đơn đặt → vượt ${excess} đôi.`,
          `Bước 4: Kết luận SENT_OVER_ORDERED: có thể do đơn hàng bổ sung chưa được nhập.`,
        ],
        causeSuggestions: [
          {
            cause: "Đơn hàng bổ sung chưa được nhập vào hệ thống",
            confidence: 75,
            evidence: "Kiểm tra xem có Order mới không",
          },
        ],
      },
      expected: `≤ ${sums.S1_ORDER}`,
      actual: `${sums.S2_SENT_OUT}`,
      diff: excess,
    });
  }

  // ── VAL1b: Same day multiple stages → WARNING ──────────────────────────
  const byDate = new Map<string, Stage[]>();
  for (const e of sorted) {
    let stages = byDate.get(e.date);
    if (!stages) {
      stages = [];
      byDate.set(e.date, stages);
    }
    if (!stages.includes(e.stage)) stages.push(e.stage);
  }
  for (const [date, stages] of byDate) {
    if (stages.length > 1) {
      violations.push({
        ruleCode: "SAME_DAY_MULTI",
        severity: "WARNING",
        key,
        evidence: sorted.filter(e => e.date === date),
        diagnostic: {
          timeline: sorted,
          explanation: [
            `Ngày ${date}: có ${stages.length} stage cùng ngày: ${stages.join(", ")}.`,
            `Có thể hợp lệ (giao + nhận cùng ngày) hoặc cần xác nhận.`,
          ],
          causeSuggestions: [
            {
              cause: "Giao hàng và nhận hàng cùng ngày (có thể hợp lệ)",
              confidence: 80,
              evidence: `Stages: ${stages.join(", ")}`,
            },
          ],
        },
      });
    }
  }

  // ── VAL3: Conflict detection (same stage, different qty/date) ─────────
  for (const [stage, stageEvents] of byStage) {
    if (stageEvents.length < 2) continue;
    // Check if any pair has different qty for same stage
    const qtys = new Set(stageEvents.map(e => e.qty));
    const dates = new Set(stageEvents.map(e => e.date));
    if (qtys.size > 1 || dates.size > 1) {
      violations.push({
        ruleCode: "CONFLICT_VERSION",
        severity: "WARNING",
        key,
        evidence: stageEvents,
        diagnostic: {
          timeline: sorted,
          explanation: [
            `Stage ${stageLabel(stage)} có ${stageEvents.length} bản ghi với số lượng/ngày khác nhau.`,
            `Số lượng: ${stageEvents.map(e => e.qty).join(", ")}`,
            `Ngày: ${stageEvents.map(e => e.date).join(", ")}`,
            `Cần xác nhận bản nào là đúng.`,
          ],
          causeSuggestions: [
            {
              cause: "Nguồn dữ liệu cập nhật phiên bản mới (F12 sync)",
              confidence: 70,
              evidence: "Kiểm tra changelog snapshot",
            },
            {
              cause: "Nhập trùng lặp với số lượng khác",
              confidence: 50,
              evidence: "Kiểm tra dòng trùng",
            },
          ],
        },
      });
    }
  }

  return violations;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function daysBetween(date1: string, date2: string): number {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  return Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
}

function stageLabel(stage: Stage): string {
  switch (stage) {
    case "S1_ORDER": return "Đơn hàng (Order)";
    case "S2_SENT_OUT": return "Giao đi gia công (Output)";
    case "S3_RECEIVED_IN": return "Nhận về (Input)";
    case "S4_SHIPPED_CUST": return "Xuất khách (Shipped)";
  }
}

// ── Build events from MasterData rows ───────────────────────────────────────

export function buildEventsFromMasterData(
  rows: Array<{
    poNo: string | null;
    factoryPO: string | null;
    size: string | null;
    shippingStatus: string | null;
    date: string | null;
    qty1: number | null;
    id: string;
  }>,
  productType: string
): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  for (const r of rows) {
    const poNo = String(r.poNo || "").trim();
    const factoryPO = String(r.factoryPO || "").trim();
    const size = String(r.size || "").trim();
    if (!poNo || !factoryPO || !size) continue;

    const stage = detectStage(r.shippingStatus || "");
    if (!stage) continue;

    // Normalize date (handle Excel serials and mixed formats)
    const date = normalizeDate(r.date);
    if (!date) continue;

    const key = `${poNo}|${factoryPO}|${size}`;
    events.push({
      key,
      stage,
      date,
      qty: r.qty1 ?? 0,
      rowId: r.id,
      sourceData: r as any,
    });
  }
  return events;
}

function normalizeDate(raw: string | null | undefined): string {
  if (!raw) return "";
  const v = String(raw).trim();
  if (!v) return "";
  // Excel serial
  const n = Number(v);
  if (!isNaN(n) && n > 30000 && n < 80000) {
    const ms = Math.round((n - 25569) * 86400 * 1000);
    const d = new Date(ms);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  const d = new Date(v);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return v;
}

// ── Run validation for a product (loads from DB) ─────────────────────────────

import { db } from "./db";

export async function runValidation(
  productType: string,
  config: ValidationConfig = DEFAULT_CONFIG
): Promise<{ runId: string; summary: any; violations: Violation[] }> {
  // Load all MasterData for this productType
  const rows = await db.masterData.findMany({
    where: { productType },
    select: {
      id: true,
      poNo: true,
      factoryPO: true,
      size: true,
      shippingStatus: true,
      date: true,
      qty1: true,
    },
  });

  // Build events
  const events = buildEventsFromMasterData(rows, productType);

  // Run validation
  const violations = validateTimeline(events, config);

  // Generate run ID
  const runCount = await db.validationRun.count({
    where: { productType },
  });
  const runId = `VAL-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${String(runCount + 1).padStart(3, "0")}`;

  // Summary
  const errorCount = violations.filter(v => v.severity === "ERROR").length;
  const warningCount = violations.filter(v => v.severity === "WARNING").length;
  const infoCount = violations.filter(v => v.severity === "INFO").length;

  const ruleBreakdown: Record<string, number> = {};
  for (const v of violations) {
    ruleBreakdown[v.ruleCode] = (ruleBreakdown[v.ruleCode] || 0) + 1;
  }

  // Save run
  const run = await db.validationRun.create({
    data: {
      runId,
      productType,
      trigger: "manual",
      totalKeys: new Set(events.map(e => e.key)).size,
      totalViolations: violations.length,
      errorCount,
      warningCount,
      infoCount,
      ruleBreakdown: JSON.stringify(ruleBreakdown),
      status: "completed",
      completedAt: new Date(),
    },
  });

  // Save violations in batches
  const BATCH = 100;
  for (let i = 0; i < violations.length; i += BATCH) {
    const batch = violations.slice(i, i + BATCH);
    await db.violation.createMany({
      data: batch.map(v => ({
        runId: run.id,
        productType,
        ruleCode: v.ruleCode,
        severity: v.severity,
        key: v.key,
        evidence: JSON.stringify(v.evidence),
        diagnostic: JSON.stringify(v.diagnostic),
      })),
    });
  }

  return {
    runId: run.runId,
    summary: {
      totalKeys: new Set(events.map(e => e.key)).size,
      totalViolations: violations.length,
      errorCount,
      warningCount,
      infoCount,
      ruleBreakdown,
    },
    violations,
  };
}

// ── Realtime validation for Data Entry (spec VAL6) ──────────────────────────

export function validateEntryRealtime(
  newEntry: { poNo: string; factoryPO: string; size: string; shippingStatus: string; date: string; qty: number },
  existingEvents: TimelineEvent[]
): Violation[] {
  const key = `${newEntry.poNo}|${newEntry.factoryPO}|${newEntry.size}`;
  const stage = detectStage(newEntry.shippingStatus);
  if (!stage) return [];

  // Create event for the new entry
  const newEvent: TimelineEvent = {
    key,
    stage,
    date: newEntry.date,
    qty: newEntry.qty,
  };

  // Merge with existing events for this key
  const keyEvents = existingEvents.filter(e => e.key === key);
  keyEvents.push(newEvent);

  // Run validation on just this key
  return validateKey(key, keyEvents, DEFAULT_CONFIG);
}
