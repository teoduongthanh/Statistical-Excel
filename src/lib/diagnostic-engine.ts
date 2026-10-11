// Diagnostic Engine — spec F11.
//
// For each error result row, generates a Vietnamese diagnostic drill-down:
//   1. Side-by-side comparison (source vs target with key fields highlighted)
//   2. Match trace — step-by-step explanation of how the match was attempted
//   3. Cause suggestions with confidence %
//   4. Similar cases (other rows with same error pattern)
//   5. Resolution actions
//
// All explanations are in Vietnamese per the spec.

import { db } from "./db";
import {
  DEFAULT_MEN_TABLE,
  DEFAULT_WOMEN_TABLE,
  type ReconciliationConfig,
} from "./reconciliation-tool-service";
import type { HydratedProject } from "./project-service";

export interface DiagnosticDetail {
  sideBySide: {
    source: Record<string, any>;
    target: Record<string, any>;
    keyMatches: Record<string, boolean>;
  };
  matchTrace: string[]; // Vietnamese step-by-step
  causeSuggestions: Array<{ cause: string; confidence: number; evidence: string }>;
  similarCases: Array<{ resultId: string; key: string; statusCode: string }>;
  resolutionActions: string[];
}

interface ResultRowInput {
  id: string;
  runId: string;
  projectId: string;
  key: string;
  sourceData: Record<string, any>;
  targetData: Record<string, any>;
  sourceQty: number;
  targetQty: number;
  difference: number;
  statusCode: string;
  note: string | null;
  resolved: boolean;
  assignedTo: string | null;
}

interface ProjectContext {
  project: HydratedProject;
  run: any;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// 1-char Levenshtein distance — fast path for equal-length strings.
function levenshteinLeq2(a: string, b: string): number {
  if (a === b) return 0;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 2) return 99;
  // Use a bounded DP matrix.
  const dp: number[][] = Array.from({ length: la + 1 }, () => new Array(lb + 1).fill(0));
  for (let i = 0; i <= la; i++) dp[i][0] = i;
  for (let j = 0; j <= lb; j++) dp[0][j] = j;
  for (let i = 1; i <= la; i++) {
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[la][lb];
}

function str(v: any): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function up(s: string): string {
  return s.toUpperCase();
}

function fmtNum(n: number): string {
  return n.toLocaleString("vi-VN");
}

// ── Side-by-side comparison ─────────────────────────────────────────────────

function buildSideBySide(row: ResultRowInput): DiagnosticDetail["sideBySide"] {
  const src = row.sourceData || {};
  const tgt = row.targetData || {};
  const fields = [
    "poNo", "factoryPO", "size", "rawSize", "model", "colorCode",
    "colorName", "colorCode2", "deadline", "date", "shippingStatus",
    "gender", "qty1", "rowCount",
  ];
  const source: Record<string, any> = {};
  const target: Record<string, any> = {};
  const keyMatches: Record<string, boolean> = {};
  for (const f of fields) {
    source[f] = src[f] ?? "";
    target[f] = tgt[f] ?? "";
    if (f === "qty1" || f === "rowCount") {
      keyMatches[f] = Number(source[f]) === Number(target[f]);
    } else {
      keyMatches[f] = up(str(source[f])) === up(str(target[f])) && str(source[f]) !== "";
    }
  }
  // Add a synthetic qtyCompare flag.
  keyMatches.__qtyEqual = row.sourceQty === row.targetQty;
  source.qty = row.sourceQty;
  target.qty = row.targetQty;
  return { source, target, keyMatches };
}

// ── Match trace (Vietnamese) ────────────────────────────────────────────────

function buildMatchTrace(row: ResultRowInput, ctx: ProjectContext): string[] {
  const src = row.sourceData || {};
  const tgt = row.targetData || {};
  const project = ctx.project;
  const matchKeys = project.matchKeyFields.length > 0
    ? project.matchKeyFields
    : ["poNo", "factoryPO", "size"];
  const trace: string[] = [];
  trace.push(`Bước 1 — Khởi tạo key đối soát dựa trên các trường: ${matchKeys.join(", ")}.`);
  trace.push(`Bước 2 — Áp dụng mapping: FVO.poNo ↔ Stech.factoryPO; FVO.factoryPO ↔ Stech.poNo; FVO.size ↔ Stech.size (TRANSFORMED).`);
  trace.push(`Bước 3 — Áp dụng preFilter: shippingStatus="${project.comparisonConfig?.preFilter?.shippingStatus ?? "1.Order"}".`);

  if (row.statusCode === "ORPHAN") {
    trace.push(`Bước 4 — Source KHÔNG có dòng nào khớp key "${row.key}".`);
    trace.push(`Bước 5 — Tồn tại target nhưng thiếu source → kết luận ORPHAN (output không có đơn hàng tương ứng).`);
  } else if (row.statusCode === "MISSING_OUT") {
    trace.push(`Bước 4 — Target KHÔNG có dòng nào khớp key "${row.key}".`);
    trace.push(`Bước 5 — Source có đơn nhưng chưa có output → kết luận MISSING_OUT.`);
  } else if (row.statusCode === "MATCHED_OK") {
    trace.push(`Bước 4 — Tìm thấy cặp source ↔ target cho key "${row.key}".`);
    trace.push(`Bước 5 — So sánh số lượng: source=${fmtNum(row.sourceQty)}, target=${fmtNum(row.targetQty)}, diff=${fmtNum(row.difference)}.`);
    trace.push(`Bước 6 — Chênh lệch nằm trong dung sai → MATCHED_OK.`);
  } else if (row.statusCode === "PARTIAL") {
    trace.push(`Bước 4 — Tìm thấy cặp source ↔ target cho key "${row.key}".`);
    trace.push(`Bước 5 — So sánh số lượng: source=${fmtNum(row.sourceQty)}, target=${fmtNum(row.targetQty)}, diff=${fmtNum(row.difference)}.`);
    trace.push(`Bước 6 — Target < Source (thiếu output) vượt dung sai → PARTIAL.`);
  } else if (row.statusCode === "OVER") {
    trace.push(`Bước 4 — Tìm thấy cặp source ↔ target cho key "${row.key}".`);
    trace.push(`Bước 5 — So sánh số lượng: source=${fmtNum(row.sourceQty)}, target=${fmtNum(row.targetQty)}, diff=${fmtNum(row.difference)}.`);
    trace.push(`Bước 6 — Target > Source (dư output) vượt dung sai → OVER.`);
  } else if (row.statusCode === "ATTR_MISMATCH") {
    trace.push(`Bước 4 — Tìm thấy cặp source ↔ target cho key "${row.key}".`);
    trace.push(`Bước 5 — Khớp số lượng nhưng thuộc tính model/color khác nhau → ATTR_MISMATCH.`);
    if (str(src.model) && str(tgt.model) && up(str(src.model)) !== up(str(tgt.model))) {
      trace.push(`Bước 6 — Model khác: source="${src.model}" vs target="${tgt.model}".`);
    }
    if (str(src.colorCode) && str(tgt.colorCode) && up(str(src.colorCode)) !== up(str(tgt.colorCode))) {
      trace.push(`Bước 7 — Color khác: source="${src.colorCode}" vs target="${tgt.colorCode}".`);
    }
  } else if (row.statusCode === "FMT_FIXED") {
    trace.push(`Bước 4 — Khớp được cặp source ↔ target sau khi normalize size.`);
    trace.push(`Bước 5 — Phát hiện rawSize khác chuẩn đã được auto-sửa về canonical (vd: "M07T" → "7.5").`);
    trace.push(`Bước 6 — Số lượng khớp → FMT_FIXED.`);
  } else if (row.statusCode === "DUP") {
    trace.push(`Bước 4 — Phát hiện nhiều dòng (>5) cùng collapse về key "${row.key}".`);
    trace.push(`Bước 5 — Có thể là trùng lặp dữ liệu đầu vào → DUP.`);
  } else if (row.statusCode === "SUSPECT_PO") {
    trace.push(`Bước 4 — Key "${row.key}" ban đầu classified là MISSING_OUT/ORPHAN.`);
    trace.push(`Bước 5 — Quét tìm PO đối phía có factoryPO + size + gender trùng và poNo lệch đúng 1 ký tự.`);
    trace.push(`Bước 6 — Phát hiện poNo "gần giống" → SUSPECT_PO (nhập liệu sai 1 chữ số?).`);
  }
  trace.push(`Bước cuối — Lưu kết quả vào ProjectResultRow + sinh diagnostic này (F11).`);
  return trace;
}

// ── Cause suggestions ────────────────────────────────────────────────────────

async function buildCauseSuggestions(
  row: ResultRowInput,
  ctx: ProjectContext
): Promise<Array<{ cause: string; confidence: number; evidence: string }>> {
  const out: Array<{ cause: string; confidence: number; evidence: string }> = [];
  const src = row.sourceData || {};
  const tgt = row.targetData || {};
  const project = ctx.project;

  if (row.statusCode === "ORPHAN") {
    // Look for source rows where PO is within Levenshtein distance 2 of the target poNo,
    // size within ±0.5, and same ART (factoryPO).
    const tgtPo = up(str(tgt.poNo));
    const tgtFpo = up(str(tgt.factoryPO));
    const tgtSize = str(tgt.size);
    const candidates = await db.masterData.findMany({
      where: { productType: project.sourceConfig.dataset, factoryPO: tgt.factoryPO || undefined },
      select: { poNo: true, factoryPO: true, size: true, model: true, shippingStatus: true },
      take: 5000,
    });
    let nearPo = 0;
    let sameArtDiffPo = 0;
    let nearSize = 0;
    for (const c of candidates) {
      const cPo = up(str(c.poNo));
      if (cPo && tgtPo && cPo !== tgtPo && levenshteinLeq2(cPo, tgtPo) <= 2) nearPo++;
      if (up(str(c.factoryPO)) === tgtFpo && cPo !== tgtPo) sameArtDiffPo++;
      const cs = Number(c.size);
      const ts = Number(tgtSize);
      if (!isNaN(cs) && !isNaN(ts) && Math.abs(cs - ts) <= 0.5) nearSize++;
    }
    if (nearPo > 0) {
      out.push({
        cause: "PO nhập sai 1-2 ký tự (sai sót nhập liệu)",
        confidence: Math.min(95, 60 + nearPo * 5),
        evidence: `Tìm thấy ${nearPo} dòng source có poNo gần đúng (Levenshtein ≤ 2) với "${tgtPo}".`,
      });
    }
    if (sameArtDiffPo > 0) {
      out.push({
        cause: "Cùng ART (factoryPO) nhưng khác PO — có thể PO đã bị đổi / tách đơn",
        confidence: 70,
        evidence: `Có ${sameArtDiffPo} dòng source dùng chung ART "${tgtFpo}" nhưng poNo khác "${tgtPo}".`,
      });
    }
    out.push({
      cause: "Output được tạo khi chưa có đơn FVO (đơn nhập sau)",
      confidence: 40,
      evidence: `Không tìm thấy source nào khớp key "${row.key}" trong dataset ${project.sourceConfig.dataset}.`,
    });
  } else if (row.statusCode === "MISSING_OUT") {
    // Check sibling sizes in same PO + ETD/Deadline + shippingStatus filter.
    const srcPo = up(str(src.poNo));
    const srcFpo = up(str(src.factoryPO));
    const siblings = await db.masterData.findMany({
      where: {
        productType: project.targetConfig.dataset,
        factoryPO: src.factoryPO || undefined,
      },
      select: { poNo: true, factoryPO: true, size: true, shippingStatus: true, deadline: true },
      take: 5000,
    });
    const siblingsSamePo = siblings.filter((s) => up(str(s.poNo)) === srcPo).length;
    const siblingsSameArt = siblings.filter((s) => up(str(s.factoryPO)) === srcFpo).length;
    const nonOrderStatuses = new Set(
      siblings
        .map((s) => str(s.shippingStatus))
        .filter((s) => s && !/1\.?\s*order/i.test(s))
    );
    if (siblingsSamePo > 0) {
      out.push({
        cause: "Size chưa được output (chỉ một số size của PO đã giao)",
        confidence: 80,
        evidence: `PO "${srcPo}" có ${siblingsSamePo} dòng target ở size khác — có thể size này chưa đến lượt giao.`,
      });
    }
    if (siblingsSameArt > 0 && siblingsSamePo === 0) {
      out.push({
        cause: "PO của đơn khác với PO ở đầu ra — kiểm tra lại mapping",
        confidence: 60,
        evidence: `ART "${srcFpo}" có ${siblingsSameArt} dòng target nhưng không có dòng nào cùng poNo "${srcPo}".`,
      });
    }
    if (nonOrderStatuses.size > 0) {
      out.push({
        cause: `Dòng bị loại do preFilter shippingStatus="${project.comparisonConfig?.preFilter?.shippingStatus ?? "1.Order"}"`,
        confidence: 50,
        evidence: `Target có trạng thái khác "1.Order": ${Array.from(nonOrderStatuses).slice(0, 5).join(", ")}.`,
      });
    }
    if (src.deadline) {
      out.push({
        cause: "Đơn chưa tới hạn giao (deadline chưa tới)",
        confidence: 40,
        evidence: `Deadline của đơn là "${src.deadline}" — kiểm tra xem STECH đã sản xuất chưa.`,
      });
    }
    if (out.length === 0) {
      out.push({
        cause: "STECH chưa sản xuất / chưa nhập output cho size này",
        confidence: 65,
        evidence: `Không tìm thấy dòng target nào cho key "${row.key}".`,
      });
    }
  } else if (row.statusCode === "PARTIAL") {
    // List delivery batches — group by shippingStatus / date in target.
    const siblings = await db.masterData.findMany({
      where: {
        productType: project.targetConfig.dataset,
        poNo: src.poNo || undefined,
        factoryPO: src.factoryPO || undefined,
      },
      select: { size: true, qty1: true, shippingStatus: true, date: true },
      take: 1000,
    });
    const batches = new Map<string, number>();
    for (const s of siblings) {
      const key = `${str(s.shippingStatus) || "unknown"}|${str(s.date) || "?"}`;
      batches.set(key, (batches.get(key) ?? 0) + (s.qty1 ?? 0));
    }
    const batchList = Array.from(batches.entries())
      .map(([k, v]) => `${k.split("|")[0]} (${k.split("|")[1]}): ${v}`)
      .slice(0, 5);
    out.push({
      cause: "Giao theo nhiều đợt — target đã giao 1 phần",
      confidence: 85,
      evidence: `Tổng target đã giao: ${fmtNum(row.targetQty)}/${fmtNum(row.sourceQty)}. Các đợt: ${batchList.join("; ") || "không rõ"}.`,
    });
  } else if (row.statusCode === "OVER") {
    out.push({
      cause: "STECH giao dư so với đơn (sản xuất thừa / sai số lô)",
      confidence: 80,
      evidence: `Target=${fmtNum(row.targetQty)} > Source=${fmtNum(row.sourceQty)}, dư ${fmtNum(-row.difference)} đôi.`,
    });
    out.push({
      cause: "Có thể đơn bị nhập trùng ở STECH (xem lại DUP)",
      confidence: 45,
      evidence: `Kiểm tra số dòng target collapse về key "${row.key}" — nếu >1 có thể trùng.`,
    });
  } else if (row.statusCode === "ATTR_MISMATCH") {
    if (str(src.model) && str(tgt.model) && up(str(src.model)) !== up(str(tgt.model))) {
      out.push({
        cause: "Model không khớp giữa FVO và STECH (sai master data)",
        confidence: 90,
        evidence: `source.model="${src.model}" vs target.model="${tgt.model}".`,
      });
    }
    if (str(src.colorCode) && str(tgt.colorCode) && up(str(src.colorCode)) !== up(str(tgt.colorCode))) {
      out.push({
        cause: "Color code không khớp (sai color master / nhập nhầm màu)",
        confidence: 85,
        evidence: `source.colorCode="${src.colorCode}" vs target.colorCode="${tgt.colorCode}".`,
      });
    }
  } else if (row.statusCode === "FMT_FIXED") {
    // Show raw → each rule → normalized chain.
    const rawSize = str(src.rawSize) || str(tgt.rawSize) || str(src.size);
    const canonical = str(src.size) || str(tgt.size);
    const chain: string[] = [`raw="${rawSize}"`];
    const rules = project.rules ?? [];
    for (const r of rules) {
      if (!r.enabled) continue;
      chain.push(`rule[${r.id}] ${r.type}${r.condition ? `(${r.condition})` : ""} → ${r.tableId ? `table:${r.tableId}` : (r.regex || r.formula || "")}`);
    }
    chain.push(`canonical="${canonical}"`);
    out.push({
      cause: "Size raw không theo chuẩn → engine đã tự chuẩn hóa (FMT_FIXED)",
      confidence: 95,
      evidence: `Chuỗi: ${chain.join(" → ")}.`,
    });
  } else if (row.statusCode === "DUP") {
    out.push({
      cause: "Nhiều dòng trùng lặp trong source và/hoặc target collapse về cùng 1 key",
      confidence: 75,
      evidence: `Source rows: ${src.rowCount ?? "?"}, Target rows: ${tgt.rowCount ?? "?"}. Kiểm tra dữ liệu đầu vào có nhập trùng không.`,
    });
  } else if (row.statusCode === "SUSPECT_PO") {
    out.push({
      cause: "poNo khác đúng 1 ký tự so với PO đã tồn tại ở phía đối diện — khả năng cao nhập sai 1 số",
      confidence: 88,
      evidence: `Key "${row.key}" — quét SUSPECT_PO second-pass đã flag poNo 1-char diff.`,
    });
  } else if (row.statusCode === "MATCHED_OK") {
    out.push({
      cause: "Khớp hoàn toàn (số lượng + thuộc tính) — không cần hành động",
      confidence: 100,
      evidence: `Source=${fmtNum(row.sourceQty)}, Target=${fmtNum(row.targetQty)}, diff=0.`,
    });
  }

  // Always include a generic suggestion if nothing else.
  if (out.length === 0) {
    out.push({
      cause: "Nguyên nhân chưa xác định — cần review thủ công",
      confidence: 30,
      evidence: `Status="${row.statusCode}", key="${row.key}".`,
    });
  }
  // Normalize confidence to [0, 100].
  return out.map((s) => ({ ...s, confidence: Math.max(0, Math.min(100, Math.round(s.confidence))) }));
}

// ── Similar cases ───────────────────────────────────────────────────────────

async function findSimilarCases(row: ResultRowInput, ctx: ProjectContext): Promise<DiagnosticDetail["similarCases"]> {
  // Find rows in the same run with same status AND (same ART or same poNo or same size).
  const candidates = await db.projectResultRow.findMany({
    where: { runId: row.runId, statusCode: row.statusCode },
    take: 1000,
  });
  const src = row.sourceData || {};
  const tgt = row.targetData || {};
  const srcPo = up(str(src.poNo));
  const srcFpo = up(str(src.factoryPO));
  const tgtPo = up(str(tgt.poNo));
  const tgtFpo = up(str(tgt.factoryPO));
  const sz = str(src.size) || str(tgt.size);
  const out: Array<{ resultId: string; key: string; statusCode: string }> = [];
  for (const c of candidates) {
    if (c.id === row.id) continue;
    const cSrc = safeParse(c.sourceData, {});
    const cTgt = safeParse(c.targetData, {});
    const matches =
      up(str(cSrc.poNo)) === srcPo ||
      up(str(cSrc.factoryPO)) === srcFpo ||
      up(str(cTgt.poNo)) === tgtPo ||
      up(str(cTgt.factoryPO)) === tgtFpo ||
      str(cSrc.size) === sz ||
      str(cTgt.size) === sz;
    if (matches) {
      out.push({ resultId: c.id, key: c.key, statusCode: c.statusCode });
    }
    if (out.length >= 10) break;
  }
  return out;
}

function safeParse<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

// ── Resolution actions ──────────────────────────────────────────────────────

function buildResolutionActions(row: ResultRowInput): string[] {
  const actions: string[] = [];
  switch (row.statusCode) {
    case "ORPHAN":
      actions.push("Kiểm tra poNo có bị nhập sai không (so sánh với source cùng ART).");
      actions.push("Xác nhận output có thực sự thiếu đơn FVO → yêu cầu tạo đơn bổ sung.");
      actions.push("Đánh dấu đã xử lý nếu output là hợp lệ (đơn mẫu / đơn nội bộ).");
      break;
    case "MISSING_OUT":
      actions.push("Kiểm tra với STECH xem size này đã sản xuất chưa.");
      actions.push("Kiểm tra shippingStatus của target — có thể bị preFilter loại.");
      actions.push("Theo dõi deadline; nếu quá hạn → báo cảnh báo.");
      actions.push("Gán cho planner phụ trách theo dõi.");
      break;
    case "PARTIAL":
      actions.push("Liên hệ STECH xác nhận đợt giao tiếp theo + số lượng.");
      actions.push("Cập nhật lại deadline nếu trễ.");
      break;
    case "OVER":
      actions.push("Xác nhận dư thừa là sai số lô hay nhập trùng.");
      actions.push("Nếu nhập trùng → yêu cầu STECH xóa dòng thừa.");
      break;
    case "ATTR_MISMATCH":
      actions.push("Sync master data (model/color) giữa FVO và STECH.");
      actions.push("Cập nhật đúng model ở phía sai (kiểm tra ART gốc).");
      break;
    case "FMT_FIXED":
      actions.push("Chuẩn hóa dữ liệu đầu vào (training / SOP cho người nhập).");
      actions.push("Thêm rule normalize cho token size đặc thù nếu cần.");
      break;
    case "DUP":
      actions.push("Loại bỏ dòng trùng trong dữ liệu nguồn.");
      actions.push("Kiểm tra pipeline import có dedup chưa.");
      break;
    case "SUSPECT_PO":
      actions.push("So sánh poNo với PO gốc → sửa 1 ký tự sai.");
      actions.push("Báo admin kiểm tra quy trình nhập PO.");
      break;
    default:
      actions.push("Review thủ công + ghi note nếu cần.");
  }
  if (row.resolved) {
    actions.push("Đã được đánh dấu đã xử lý.");
  } else {
    actions.push("Đánh dấu đã xử lý sau khi xác minh.");
  }
  return actions;
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function generateDiagnostic(
  row: ResultRowInput,
  ctx: ProjectContext
): Promise<DiagnosticDetail> {
  const sideBySide = buildSideBySide(row);
  const matchTrace = buildMatchTrace(row, ctx);
  const causeSuggestions = await buildCauseSuggestions(row, ctx);
  const similarCases = await findSimilarCases(row, ctx);
  const resolutionActions = buildResolutionActions(row);
  return {
    sideBySide,
    matchTrace,
    causeSuggestions,
    similarCases,
    resolutionActions,
  };
}

// Export helpers for unit testing / API surface.
export const __test = { levenshteinLeq2, buildSideBySide, buildMatchTrace, buildResolutionActions };
