// Staging Service — Data Entry Staging → Auto-Fill → Validation → Review → Save
//
// Workflow (spec §1):
//   1. User pastes many rows → create Staging Batch (NOT saved to DB yet)
//   2. Parse + normalize each row (trim, status casing, date, qty)
//   3. Auto-match with 1.Order in MasterData → auto-fill MODEL/SKU/Season/etc
//      - Show source of auto-fill (spec §34)
//      - Don't auto-fill on ambiguous match (spec §35)
//   4. Validate entire batch:
//      - Structure (required fields, valid date/qty/status)
//      - Order reference (find matching Order, ambiguous matches)
//      - Quantity (Output exceeds Order, Input exceeds Output, batch totals)
//      - Duplication (in batch, with existing DB)
//      - Master data (unknown Factory PO, Size)
//      - Consistency (PO-FPO mismatch, size mismatch)
//   5. Generate Validation Report per row (multiple issues per row — spec §22)
//   6. User reviews: edit row, accept warning, add master data, revalidate
//   7. Confirm Import → only confirmed rows go to EntryData (DB)
//
// CRITICAL (spec §2): Shipping Status (1.Order/2.Output/3.Pending/4.Input) is
// business status. Validation Status (VALID/WARNING/ERROR/REVIEWED) is separate.
// NEVER use Shipping Status to indicate validation errors.

import { db } from "./db";
import { classifyShippingStatus } from "./quantity-service";

// ── Types ───────────────────────────────────────────────────────────────────

export interface ParsedRow {
  shippingStatus: string;
  date: string;
  poNo: string;
  factoryPO: string;
  size: string;
  qty: string;
  deadline: string;
  [key: string]: string; // keep extra columns
}

export interface StagingRow extends ParsedRow {
  rowNumber: number;
  // Auto-filled
  model?: string;
  sku?: string;
  item?: string;
  season?: string;
  colorCode?: string;
  colorCode2?: string;
  painting?: string;
  printingColor?: string;
  autoFillSource?: string;
  matchedOrderKey?: string;
  // Validation
  validationStatus: "PENDING" | "VALID" | "WARNING" | "ERROR" | "REVIEWED";
  issues: ValidationIssue[];
  warningAccepted?: boolean;
}

export interface ValidationIssue {
  severity: "ERROR" | "WARNING" | "INFO";
  category: string; // STRUCTURE | ORDER_REFERENCE | QUANTITY | DUPLICATION | MASTER_DATA | CONSISTENCY
  code: string; // e.g. OUTPUT_EXCEEDS_ORDER, ORDER_NOT_FOUND, UNKNOWN_FACTORY_PO
  message: string;
  detail?: string;
  recommendedAction?: string;
}

// ── Normalize (spec §3, §49) ───────────────────────────────────────────────

export function normalizeShippingStatus(s: string): string {
  const t = (s || "").trim();
  if (!t) return "";
  if (/^1\./i.test(t)) return "1.Order";
  if (/^2\./i.test(t)) return "2.Output";
  if (/^3\./i.test(t)) return "3.Pending";
  if (/^4\./i.test(t)) return "4.Input";
  return t;
}

export function normalizeSize(s: string): string {
  // Spec §49: trim, remove line breaks, collapse spaces. PRESERVE T suffix.
  return String(s || "")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizePO(s: string): string {
  return String(s || "")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeQty(s: string): number {
  if (!s) return 0;
  const n = Number(String(s).replace(/[^0-9.\-]/g, ""));
  return isNaN(n) ? 0 : Math.trunc(n);
}

export function normalizeDate(s: string): string {
  if (!s) return "";
  const v = String(s).trim();
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
  if (m) {
    return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  const d = new Date(v);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return v;
}

// ── Parse pasted text (spec §1: user pastes many rows) ──────────────────────

export function parseBulkText(text: string): ParsedRow[] {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return [];

  // Detect TSV or CSV
  const firstLine = lines[0];
  const isTSV = firstLine.includes("\t");
  const delim = isTSV ? "\t" : ",";

  // Check if first line is header
  const lower = firstLine.toLowerCase();
  const hasHeader = /status|shipping|po|factory|size|qty|date|deadline|etd/.test(lower);

  let headers: string[];
  let dataLines: string[];

  if (hasHeader) {
    headers = firstLine.split(delim).map((h) => h.trim().toLowerCase());
    dataLines = lines.slice(1);
  } else {
    // Default column order (spec §59): status, po, factoryPO, size, qty [, date, deadline]
    headers = ["shippingstatus", "po", "factorypo", "size", "qty"];
    dataLines = lines;
  }

  const rows: ParsedRow[] = [];
  for (const line of dataLines) {
    const cells = line.split(delim).map((c) => c.trim());
    const row: ParsedRow = {
      shippingStatus: "",
      date: "",
      poNo: "",
      factoryPO: "",
      size: "",
      qty: "",
      deadline: "",
    };
    headers.forEach((h, i) => {
      const v = cells[i] ?? "";
      if (h === "shippingstatus" || h === "status" || h === "shipping status") row.shippingStatus = v;
      else if (h === "po" || h === "po no#" || h === "po no" || h === "pono") row.poNo = v;
      else if (h === "factorypo" || h === "factory po" || h === "factory_po" || h === "fpo") row.factoryPO = v;
      else if (h === "size") row.size = v;
      else if (h === "qty" || h === "qty1" || h === "quantity") row.qty = v;
      else if (h === "date") row.date = v;
      else if (h === "deadline" || h === "etd" || h === "dead line") row.deadline = v;
      else row[h] = v;
    });
    rows.push(row);
  }
  return rows;
}

// ── Auto-fill from Order (spec §34, §35) ─────────────────────────────────────

interface OrderMatch {
  model: string;
  sku: string;
  item: string;
  season: string;
  colorCode: string;
  colorCode2: string;
  painting: string;
  printingColor: string;
  orderQty: number;
  deadline: string | null;
  orderKey: string; // poNo|factoryPO|size
  source: string;
}

// Load all 1.Order rows for a productType, build lookup by (poNo|factoryPO|size).
// Spec §50: load all once, use HashMap (no per-row queries).
export async function loadOrderMap(productType: string): Promise<{
  byExact: Map<string, OrderMatch[]>;
  byPoFpo: Map<string, OrderMatch[]>;
}> {
  const rows = await db.masterData.findMany({
    where: {
      productType,
      shippingStatus: { startsWith: "1" },
    },
    select: {
      poNo: true, factoryPO: true, size: true, model: true, sku: true,
      item: true, season: true, colorCode: true, colorCode2: true,
      painting: true, printingColor: true, qty1: true, deadline: true,
    },
  });

  const byExact = new Map<string, OrderMatch[]>();
  const byPoFpo = new Map<string, OrderMatch[]>();

  for (const r of rows) {
    const poNo = normalizePO(r.poNo);
    const factoryPO = normalizePO(r.factoryPO);
    const size = normalizeSize(r.size);
    if (!poNo || !factoryPO || !size) continue;

    const match: OrderMatch = {
      model: r.model || "",
      sku: r.sku || "",
      item: r.item || "",
      season: r.season || "",
      colorCode: r.colorCode || "",
      colorCode2: r.colorCode2 || "",
      painting: r.painting || "",
      printingColor: r.printingColor || "",
      orderQty: r.qty1 ?? 0,
      deadline: r.deadline,
      orderKey: `${poNo}|${factoryPO}|${size}`,
      source: `ORDER:${factoryPO}`,
    };

    const exactKey = `${poNo}|${factoryPO}|${size}`;
    if (!byExact.has(exactKey)) byExact.set(exactKey, []);
    byExact.get(exactKey)!.push(match);

    const fpoKey = `${poNo}|${factoryPO}`;
    if (!byPoFpo.has(fpoKey)) byPoFpo.set(fpoKey, []);
    byPoFpo.get(fpoKey)!.push(match);
  }

  return { byExact, byPoFpo };
}

// Auto-fill a row from matching Order. Returns the filled row + match info.
// Spec §35: if multiple matches → don't auto-fill, return ambiguous flag.
export function autoFillRow(
  row: ParsedRow,
  orderMap: { byExact: Map<string, OrderMatch[]>; byPoFpo: Map<string, OrderMatch[]> }
): { row: ParsedRow; match: OrderMatch | null; ambiguous: boolean; possibleMatches?: OrderMatch[] } {
  const poNo = normalizePO(row.poNo);
  const factoryPO = normalizePO(row.factoryPO);
  const size = normalizeSize(row.size);

  if (!poNo || !factoryPO || !size) {
    return { row, match: null, ambiguous: false };
  }

  const exactKey = `${poNo}|${factoryPO}|${size}`;
  const exactMatches = orderMap.byExact.get(exactKey) || [];

  if (exactMatches.length === 0) {
    return { row, match: null, ambiguous: false };
  }
  if (exactMatches.length === 1) {
    const m = exactMatches[0];
    return {
      row: {
        ...row,
        model: m.model,
        sku: m.sku,
        item: m.item,
        season: m.season,
        colorCode: m.colorCode,
        colorCode2: m.colorCode2,
        painting: m.painting,
        printingColor: m.printingColor,
      },
      match: m,
      ambiguous: false,
    };
  }
  // Multiple matches — ambiguous (spec §35)
  return { row, match: null, ambiguous: true, possibleMatches: exactMatches };
}

// ── Load existing DB quantities (for cumulative validation — spec §53) ───────

export async function loadExistingQtys(
  productType: string
): Promise<Map<string, { orderQty: number; outputQty: number; inputQty: number }>> {
  const rows = await db.masterData.findMany({
    where: { productType },
    select: {
      poNo: true, factoryPO: true, size: true,
      shippingStatus: true, qty1: true,
    },
  });

  const map = new Map<string, { orderQty: number; outputQty: number; inputQty: number }>();
  for (const r of rows) {
    const poNo = normalizePO(r.poNo);
    const factoryPO = normalizePO(r.factoryPO);
    const size = normalizeSize(r.size);
    if (!poNo || !factoryPO || !size) continue;
    const key = `${poNo}|${factoryPO}|${size}`;
    let entry = map.get(key);
    if (!entry) {
      entry = { orderQty: 0, outputQty: 0, inputQty: 0 };
      map.set(key, entry);
    }
    const qty = r.qty1 ?? 0;
    const bucket = classifyShippingStatus(r.shippingStatus);
    if (bucket === "order") entry.orderQty += qty;
    else if (bucket === "output") entry.outputQty += qty;
    else if (bucket === "input") entry.inputQty += qty;
  }
  return map;
}

// ── Validate (spec §11-18, §23, §50-54) ─────────────────────────────────────

export function validateRow(
  row: ParsedRow,
  match: OrderMatch | null,
  ambiguous: boolean,
  possibleMatches: OrderMatch[] | undefined,
  existing: { orderQty: number; outputQty: number; inputQty: number } | undefined,
  batchSums: Map<string, { outputQty: number; inputQty: number }>,
  seenInBatch: Set<string>,
  rowKey: string
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const bucket = classifyShippingStatus(row.shippingStatus);

  // ── Structure validation (spec §23 STRUCTURE) ───────────────────────────
  if (!row.shippingStatus) {
    issues.push({
      severity: "ERROR", category: "STRUCTURE", code: "MISSING_REQUIRED_FIELD",
      message: "Shipping Status is required.",
      recommendedAction: "Enter 1.Order, 2.Output, 3.Pending, or 4.Input.",
    });
  }
  if (!row.poNo) {
    issues.push({
      severity: "ERROR", category: "STRUCTURE", code: "MISSING_REQUIRED_FIELD",
      message: "PO NO# is required.",
    });
  }
  if (!row.factoryPO) {
    issues.push({
      severity: "ERROR", category: "STRUCTURE", code: "MISSING_REQUIRED_FIELD",
      message: "Factory PO is required.",
    });
  }
  if (!row.size) {
    issues.push({
      severity: "ERROR", category: "STRUCTURE", code: "MISSING_REQUIRED_FIELD",
      message: "Size is required.",
    });
  }
  const qty = normalizeQty(row.qty);
  if (!row.qty) {
    issues.push({
      severity: "ERROR", category: "STRUCTURE", code: "MISSING_REQUIRED_FIELD",
      message: "Qty is required.",
    });
  } else if (isNaN(Number(row.qty))) {
    issues.push({
      severity: "ERROR", category: "STRUCTURE", code: "INVALID_QTY",
      message: `Qty "${row.qty}" is not a valid number.`,
    });
  } else if (qty <= 0) {
    issues.push({
      severity: "ERROR", category: "STRUCTURE", code: "ZERO_QTY",
      message: `Qty must be greater than 0 (got ${qty}).`,
    });
  }

  // If structure errors, skip further validation
  if (issues.some((i) => i.severity === "ERROR")) return issues;

  // ── Order reference (spec §11, §35, §60, §61) ───────────────────────────
  if (bucket === "output" || bucket === "input" || bucket === "pending") {
    if (ambiguous) {
      issues.push({
        severity: "WARNING", category: "ORDER_REFERENCE", code: "MULTIPLE_ORDER_MATCHES",
        message: `Multiple Order matches found for PO=${row.poNo} / FactoryPO=${row.factoryPO} / Size=${row.size}.`,
        detail: `${possibleMatches?.length ?? 0} matching orders. Please select the correct one.`,
        recommendedAction: "Select the correct Order reference manually.",
      });
    } else if (!match) {
      issues.push({
        severity: "WARNING", category: "ORDER_REFERENCE", code: "ORDER_NOT_FOUND",
        message: `No matching Order found for PO=${row.poNo} / FactoryPO=${row.factoryPO} / Size=${row.size}.`,
        recommendedAction: "Check PO / Factory PO / Size / or add Master Data.",
      });
    }
  }

  // ── Quantity validation (spec §12, §13, §17, §18, §53, §54) ─────────────
  const key = `${normalizePO(row.poNo)}|${normalizePO(row.factoryPO)}|${normalizeSize(row.size)}`;
  const existingQty = existing ?? { orderQty: 0, outputQty: 0, inputQty: 0 };
  const batchSum = batchSums.get(key) ?? { outputQty: 0, inputQty: 0 };

  if (bucket === "output" && match) {
    // Spec §12, §53: Output + existing Output + batch Output vs Order Qty
    const totalOutput = existingQty.outputQty + batchSum.outputQty;
    if (totalOutput > existingQty.orderQty && existingQty.orderQty > 0) {
      const excess = totalOutput - existingQty.orderQty;
      issues.push({
        severity: "WARNING", category: "QUANTITY", code: "OUTPUT_EXCEEDS_ORDER",
        message: `Output quantity exceeds Order.`,
        detail: `Order Qty: ${existingQty.orderQty}\nPrevious Output: ${existingQty.outputQty}\nBatch Output: ${batchSum.outputQty}\nTotal Output: ${totalOutput}\nExcess: ${excess}`,
        recommendedAction: "Check Qty or check Order Qty in Master Data.",
      });
    }
  }

  if (bucket === "input" && match) {
    // Spec §15, §16, §17: Input must have Output, Input ≤ Output
    const totalInput = existingQty.inputQty + batchSum.inputQty;
    const totalOutput = existingQty.outputQty + batchSum.outputQty;
    if (totalOutput === 0) {
      issues.push({
        severity: "WARNING", category: "ORDER_REFERENCE", code: "INPUT_HAS_NO_OUTPUT",
        message: `Input has no matching Output.`,
        detail: `PO=${row.poNo} / FactoryPO=${row.factoryPO} / Size=${row.size} has Input but no Output.`,
        recommendedAction: "Check if Output was recorded.",
      });
    } else if (totalInput > totalOutput) {
      const excess = totalInput - totalOutput;
      issues.push({
        severity: "WARNING", category: "QUANTITY", code: "INPUT_EXCEEDS_OUTPUT",
        message: `Input quantity exceeds Output.`,
        detail: `Order Qty: ${existingQty.orderQty}\nOutput Qty: ${totalOutput}\nInput Qty: ${totalInput}\nExcess Input: ${excess}`,
        recommendedAction: "Check Input Qty or check Output before this entry.",
      });
    }
  }

  // ── Duplication (spec §37) ─────────────────────────────────────────────
  if (seenInBatch.has(rowKey)) {
    issues.push({
      severity: "WARNING", category: "DUPLICATION", code: "DUPLICATE_IN_BATCH",
      message: `Possible duplicate in batch.`,
      detail: `Same PO+FactoryPO+Size+Date+Status+Qty appears multiple times in this batch.`,
      recommendedAction: "Check if this is a duplicate transaction or merge if intentional.",
    });
  }

  return issues;
}

// Compute batch-level sums (spec §13: group by business key, sum qty).
export function computeBatchSums(rows: ParsedRow[]): Map<string, { outputQty: number; inputQty: number }> {
  const sums = new Map<string, { outputQty: number; inputQty: number }>();
  for (const r of rows) {
    const key = `${normalizePO(r.poNo)}|${normalizePO(r.factoryPO)}|${normalizeSize(r.size)}`;
    const bucket = classifyShippingStatus(r.shippingStatus);
    const qty = normalizeQty(r.qty);
    if (bucket !== "output" && bucket !== "input") continue;
    let entry = sums.get(key);
    if (!entry) {
      entry = { outputQty: 0, inputQty: 0 };
      sums.set(key, entry);
    }
    if (bucket === "output") entry.outputQty += qty;
    else if (bucket === "input") entry.inputQty += qty;
  }
  return sums;
}

// ── Create Batch (spec §4) ──────────────────────────────────────────────────

export async function createBatch(
  productType: string,
  rawText: string,
  createdBy?: string
): Promise<{ batchId: string; batchDbId: string; totalRows: number }> {
  const parsed = parseBulkText(rawText);
  if (parsed.length === 0) {
    throw new Error("No rows found in pasted text.");
  }

  // Generate batch ID: ENTRY-YYYYMMDD-NNNN
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const countToday = await db.entryBatch.count({
    where: { batchId: { startsWith: `ENTRY-${today}-` } },
  });
  const batchId = `ENTRY-${today}-${String(countToday + 1).padStart(4, "0")}`;

  const batch = await db.entryBatch.create({
    data: {
      batchId,
      productType,
      createdBy: createdBy ?? "system",
      status: "staging",
      totalRows: parsed.length,
      rawText,
    },
  });

  // Create staging rows (normalized + raw preserved — spec §48)
  const BATCH = 200;
  for (let i = 0; i < parsed.length; i += BATCH) {
    const slice = parsed.slice(i, i + BATCH);
    await db.entryStagingRow.createMany({
      data: slice.map((r, idx) => ({
        batchId: batch.id,
        rowNumber: i + idx + 1,
        shippingStatus: normalizeShippingStatus(r.shippingStatus) || null,
        date: r.date || null,
        poNo: normalizePO(r.poNo) || null,
        factoryPO: normalizePO(r.factoryPO) || null,
        size: normalizeSize(r.size) || null,
        qty: normalizeQty(r.qty),
        deadline: r.deadline || null,
        rawData: JSON.stringify(r),
        validationStatus: "PENDING",
        validationErrors: "[]",
      })),
    });
  }

  // Audit log
  await db.entryAuditLog.create({
    data: {
      batchId: batch.id,
      action: "CREATE",
      user: createdBy ?? "system",
      detail: `Created batch with ${parsed.length} rows`,
    },
  });

  return { batchId, batchDbId: batch.id, totalRows: parsed.length };
}

// ── Validate Batch (spec §50: validate AFTER auto-fill) ─────────────────────

export async function validateBatch(
  batchDbId: string
): Promise<{
  runNumber: number;
  totalRows: number;
  validRows: number;
  warningRows: number;
  errorRows: number;
  reviewedRows: number;
}> {
  const batch = await db.entryBatch.findUnique({ where: { id: batchDbId } });
  if (!batch) throw new Error("Batch not found");

  // Load all staging rows
  const stagingRows = await db.entryStagingRow.findMany({
    where: { batchId: batchDbId, imported: false },
    orderBy: { rowNumber: "asc" },
  });

  if (stagingRows.length === 0) {
    return { runNumber: 0, totalRows: 0, validRows: 0, warningRows: 0, errorRows: 0, reviewedRows: 0 };
  }

  // Build ParsedRow list (normalized)
  const parsedRows: ParsedRow[] = stagingRows.map((r) => ({
    shippingStatus: r.shippingStatus || "",
    date: r.date || "",
    poNo: r.poNo || "",
    factoryPO: r.factoryPO || "",
    size: r.size || "",
    qty: String(r.qty),
    deadline: r.deadline || "",
  }));

  // Load Order map + existing quantities (spec §50: load once)
  const [orderMap, existingQtys] = await Promise.all([
    loadOrderMap(batch.productType),
    loadExistingQtys(batch.productType),
  ]);

  // Compute batch sums (spec §13: group by key, sum)
  const batchSums = computeBatchSums(parsedRows);

  // Track seen-in-batch for duplicate detection (spec §37)
  const seenInBatch = new Set<string>();

  let valid = 0, warning = 0, error = 0, reviewed = 0;
  const results: any[] = [];

  for (let i = 0; i < stagingRows.length; i++) {
    const sr = stagingRows[i];
    const pr = parsedRows[i];

    // Auto-fill (spec §34, §35)
    const { row: filledRow, match, ambiguous, possibleMatches } = autoFillRow(pr, orderMap);

    // Row key for duplicate detection
    const rowKey = `${normalizePO(pr.poNo)}|${normalizePO(pr.factoryPO)}|${normalizeSize(pr.size)}|${pr.date}|${pr.shippingStatus}|${pr.qty}`;

    // Validate
    const existing = existingQtys.get(`${normalizePO(pr.poNo)}|${normalizePO(pr.factoryPO)}|${normalizeSize(pr.size)}`);
    const issues = validateRow(pr, match, ambiguous, possibleMatches, existing, batchSums, seenInBatch, rowKey);

    // Mark as seen
    seenInBatch.add(rowKey);

    // Determine status (spec §2: VALID/WARNING/ERROR/REVIEWED)
    let status: "VALID" | "WARNING" | "ERROR" = "VALID";
    if (issues.some((iss) => iss.severity === "ERROR")) status = "ERROR";
    else if (issues.some((iss) => iss.severity === "WARNING")) status = "WARNING";

    // Preserve REVIEWED status if warning was previously accepted (spec §31, §32)
    const wasAccepted = sr.warningAccepted;
    if (wasAccepted && status === "WARNING") status = "REVIEWED";

    // Update counts
    if (status === "VALID") valid++;
    else if (status === "WARNING") warning++;
    else if (status === "ERROR") error++;
    else if (status === "REVIEWED") reviewed++;

    results.push({ rowId: sr.id, rowNumber: sr.rowNumber, status, issues });

    // Update staging row with auto-fill + validation
    await db.entryStagingRow.update({
      where: { id: sr.id },
      data: {
        model: filledRow.model || null,
        sku: filledRow.sku || null,
        item: filledRow.item || null,
        season: filledRow.season || null,
        colorCode: filledRow.colorCode || null,
        colorCode2: filledRow.colorCode2 || null,
        painting: filledRow.painting || null,
        printingColor: filledRow.printingColor || null,
        autoFillSource: match?.source ?? null,
        matchedOrderKey: match?.orderKey ?? null,
        validationStatus: status,
        validationErrors: JSON.stringify(issues),
      },
    });
  }

  // Update batch summary
  await db.entryBatch.update({
    where: { id: batchDbId },
    data: {
      status: "validated",
      totalRows: stagingRows.length,
      validRows: valid,
      warningRows: warning,
      errorRows: error,
      reviewedRows: reviewed,
      lastValidation: JSON.stringify({ valid, warning, error, reviewed, total: stagingRows.length }),
    },
  });

  // Save validation run (spec §67: keep history)
  const runCount = await db.entryValidationRun.count({ where: { batchId: batchDbId } });
  const runNumber = runCount + 1;
  await db.entryValidationRun.create({
    data: {
      batchId: batchDbId,
      runNumber,
      totalRows: stagingRows.length,
      validRows: valid,
      warningRows: warning,
      errorRows: error,
      reviewedRows: reviewed,
      results: JSON.stringify(results),
    },
  });

  // Audit log
  await db.entryAuditLog.create({
    data: {
      batchId: batchDbId,
      action: "REVALIDATE",
      user: "system",
      detail: `Validation run #${runNumber}: ${valid} valid, ${warning} warning, ${error} error`,
    },
  });

  return { runNumber, totalRows: stagingRows.length, validRows: valid, warningRows: warning, errorRows: error, reviewedRows: reviewed };
}

// ── Confirm Import (spec §43, §44, §45) ─────────────────────────────────────

export async function confirmImport(
  batchDbId: string,
  options: { mode: "valid_only" | "valid_and_accepted"; user?: string }
): Promise<{ imported: number; remaining: number }> {
  const batch = await db.entryBatch.findUnique({ where: { id: batchDbId } });
  if (!batch) throw new Error("Batch not found");

  const rows = await db.entryStagingRow.findMany({
    where: { batchId: batchDbId, imported: false },
  });

  let imported = 0;
  for (const r of rows) {
    const canImport =
      r.validationStatus === "VALID" ||
      (options.mode === "valid_and_accepted" && r.validationStatus === "REVIEWED");

    if (!canImport) continue;

    // Create EntryData record
    const entry = await db.entryData.create({
      data: {
        productType: batch.productType,
        date: r.date || new Date().toISOString().slice(0, 10),
        shippingStatus: r.shippingStatus || "",
        model: r.model || "",
        sku: r.sku || "",
        poNo: r.poNo || "",
        factoryPO: r.factoryPO || "",
        item: r.item || "",
        season: r.season || "",
        colorCode: r.colorCode || "",
        colorCode2: r.colorCode2 || "",
        painting: r.painting || "",
        printingColor: r.printingColor || "",
        size: r.size || "",
        qty1: r.qty,
        qty2: r.qty, // simple mirror; entry-service would compute sign
        deadline: r.deadline || null,
        note: `Imported from batch ${batch.batchId} row ${r.rowNumber}`,
      },
    });

    await db.entryStagingRow.update({
      where: { id: r.id },
      data: { imported: true, importedEntryId: entry.id },
    });

    await db.entryAuditLog.create({
      data: {
        batchId: batchDbId,
        rowId: r.id,
        action: "IMPORT",
        user: options.user ?? "system",
        detail: `Row ${r.rowNumber} imported as entry ${entry.id}`,
      },
    });
    imported++;
  }

  const remaining = rows.length - imported;
  await db.entryBatch.update({
    where: { id: batchDbId },
    data: {
      status: remaining === 0 ? "imported" : "importing",
      importedRows: imported,
      importedAt: remaining === 0 ? new Date() : null,
    },
  });

  return { imported, remaining };
}
