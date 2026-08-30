// BulkValidationService
// Validates a batch of pasted Excel rows BEFORE any database write.
//
// Pipeline:
//   PASTE → PARSE → MAP COLUMNS → VALIDATE EACH ROW → VALIDATE COMBINED →
//   SIMULATE FINAL QUANTITY → SHOW ERRORS → USER REVIEW → CONFIRM SAVE
//
// Key design principles (spec §39):
//   1. Rows are NOT validated independently. We GROUP by (poNo + factoryPO + size)
//      and run a SEQUENTIAL SIMULATION so row N's result depends on rows 1..N-1.
//   2. Pending is NOT stored — it's calculated as -Output. We never expect to
//      find Pending rows in the DB; if a user pastes 3.Pending, it's a warning.
//   3. The validation API NEVER writes to the DB. A separate /bulk-import API
//      does the actual insert inside a transaction.
//   4. Batch lookups: all MasterData + EntryData lookups are batched (single
//      query per batch) for performance with 100-1000 rows.
//
// Error types (spec §17): 22 distinct error/warning codes.

import { db } from "./db";
import { classifyShippingStatus, parseDeadline, computeDeadlineStatus } from "./quantity-service";
import type { MasterGroup, SharedFlags } from "@/types";
import type { CanonicalField } from "./fields";

// ===== Types =====

export type BulkSeverity = "CRITICAL" | "ERROR" | "WARNING" | "INFO";

export type BulkErrorCode =
  // Field-level errors
  | "MISSING_REQUIRED_FIELD"
  | "INVALID_SHIPPING_STATUS"
  | "INVALID_QTY"
  | "INVALID_PO_NO"
  | "INVALID_FACTORY_PO"
  | "INVALID_SIZE"
  | "INVALID_PO_FACTORY_COMBINATION"
  // Master data errors
  | "MISSING_MASTER_DATA"
  | "INVALID_COLOR_CODE"
  // Quantity errors (require sequential simulation)
  | "OUTPUT_EXCEEDS_ORDER"
  | "INPUT_EXCEEDS_OUTPUT"
  | "INPUT_EXCEEDS_ORDER"
  | "INPUT_WITHOUT_OUTPUT"
  | "OUTPUT_WITHOUT_ORDER"
  | "PENDING_WITHOUT_OUTPUT"
  | "PENDING_QTY_INVALID"
  // State warnings
  | "PRODUCT_ALREADY_COMPLETED"
  // Duplicate detection
  | "POSSIBLE_DUPLICATE_BULK"
  | "POSSIBLE_DUPLICATE_EXISTING"
  // Deadline
  | "DEADLINE_PASSED"
  // Format / mapping
  | "DATA_FORMAT_ERROR"
  | "UNEXPECTED_COLUMN_MAPPING";

export interface BulkValidationError {
  code: BulkErrorCode;
  severity: BulkSeverity;
  title: string;
  description: string;
  excess?: number; // for quantity overflows
  duplicateRowNumbers?: number[]; // for duplicate detection
}

export interface BulkRowResult {
  rowNumber: number; // Excel row number (1-based + header = data starts at row 2)
  shippingStatus: string;
  poNo: string;
  factoryPO: string;
  size: string;
  qty1: string;
  qty2?: string;
  // Parsed/normalized
  qty1Num: number;
  statusBucket: "order" | "output" | "pending" | "input" | "other";
  // Master data lookup
  masterDataFound: boolean;
  masterGroup?: MasterGroup | null;
  model?: string;
  sku?: string;
  colorCode?: string;
  deadline?: string;
  // Current DB state (per product key)
  current: {
    order: number;
    output: number;
    input: number;
    pending: number; // = -output
  };
  // Simulated state AFTER this row is added (sequential)
  afterSave: {
    order: number;
    output: number;
    input: number;
    pending: number;
  };
  // Validation
  severity: BulkSeverity; // worst severity among errors (INFO = no issues)
  errors: BulkValidationError[];
  // Status for UI filtering
  status: "valid" | "warning" | "error";
  // Group key for combined display
  groupKey: string;
  // Confirmation info (for warning-confirmed imports)
  needsConfirm: boolean;
  confirmReason?: string;
  note?: string;
}

export interface BulkGroupedError {
  groupKey: string;
  poNo: string;
  factoryPO: string;
  size: string;
  model?: string;
  colorCode?: string;
  rowNumbers: number[];
  current: { order: number; output: number; input: number };
  newTotal: { order: number; output: number; input: number };
  expected: { order: number; output: number; input: number };
  excess: number;
  code: BulkErrorCode;
  severity: BulkSeverity;
  title: string;
  description: string;
}

export interface BulkSummary {
  totalRows: number;
  validRows: number;
  warningRows: number;
  errorRows: number;
  productGroupsAffected: number;
  duplicatePossible: number;
  quantityErrors: number;
  masterDataErrors: number;
  deadlineErrors: number;
}

export interface BulkValidationResult {
  ok: boolean;
  summary: BulkSummary;
  rows: BulkRowResult[];
  groupedErrors: BulkGroupedError[];
  warnings: BulkValidationError[];
  // Current DB totals per group key (for combined view)
  currentGroups: Record<string, { order: number; output: number; input: number; pending: number }>;
  // Final simulated totals after ALL rows applied (only valid+warning rows counted)
  finalGroups: Record<string, { order: number; output: number; input: number; pending: number }>;
}

export interface BulkValidationInput {
  productType: string;
  rows: Partial<Record<CanonicalField, string>>[];
}

// ===== Validation Engine =====

// Required canonical fields for bulk validation.
const REQUIRED_FIELDS: CanonicalField[] = ["shippingStatus", "poNo", "factoryPO", "size", "qty1"];

// Check required fields per row. Returns array of errors.
function checkRequiredFields(
  row: Partial<Record<CanonicalField, string>>,
  rowNumber: number
): BulkValidationError[] {
  const errs: BulkValidationError[] = [];
  for (const field of REQUIRED_FIELDS) {
    const v = row[field];
    if (v === undefined || v === null || String(v).trim() === "") {
      errs.push({
        code: "MISSING_REQUIRED_FIELD",
        severity: "ERROR",
        title: `Missing ${field}`,
        description: `Row ${rowNumber}: field "${field}" is required but was not provided.`,
      });
    }
  }
  return errs;
}

// Normalize shipping status. Accepts "1.Order", "2.Output", "4.Input", "order", etc.
// Returns the canonical "N.Name" format, or null if invalid.
function normalizeShippingStatus(raw: string): string | null {
  const s = raw.trim();
  const bucket = classifyShippingStatus(s);
  switch (bucket) {
    case "order": return "1.Order";
    case "output": return "2.Output";
    case "pending": return "3.Pending";
    case "input": return "4.Input";
    default: return null;
  }
}

// Batch lookup: fetch all MasterGroup rows matching the (productType + factoryPO) pairs
// present in the bulk rows. Returns a Map keyed by "factoryPO|poNo|size" → MasterGroup.
// Also returns a Map keyed by "factoryPO" → MasterGroup[] (for size validation).
async function batchLookupMasterData(
  productType: string,
  rows: { factoryPO: string; poNo: string; size: string }[]
): Promise<{
  byFpo: Map<string, MasterGroup[]>;
  byFpoPoSize: Map<string, MasterGroup>;
}> {
  const factoryPOs = [...new Set(rows.map((r) => r.factoryPO).filter(Boolean))];
  if (factoryPOs.length === 0) {
    return { byFpo: new Map(), byFpoPoSize: new Map() };
  }

  // Fetch MasterGroup rows for these factory POs (product-scoped).
  const dbGroups = await db.masterGroup.findMany({
    where: { productType, factoryPO: { in: factoryPOs } },
  });

  // Convert DB rows (with sizes/sharedFlags as JSON strings) to MasterGroup
  // interface (with sizes: string[], sharedFlags: SharedFlags).
  const groups: MasterGroup[] = dbGroups.map((g) => ({
    id: g.id,
    factoryPO: g.factoryPO,
    date: g.date,
    shippingStatus: g.shippingStatus,
    model: g.model,
    sku: g.sku,
    poNo: g.poNo,
    item: g.item,
    season: g.season,
    colorCode: g.colorCode,
    colorCode2: g.colorCode2,
    painting: g.painting,
    printingColor: g.printingColor,
    deadline: g.deadline,
    nearestDeadline: g.nearestDeadline,
    productType: g.productType,
    sizes: JSON.parse(g.sizes || "[]") as string[],
    sharedFlags: JSON.parse(g.sharedFlags || "{}") as SharedFlags,
    rowCount: g.rowCount,
    sourceFile: g.sourceFile,
  }));

  const byFpo = new Map<string, MasterGroup[]>();
  for (const g of groups) {
    const fpo = g.factoryPO;
    if (!byFpo.has(fpo)) byFpo.set(fpo, []);
    byFpo.get(fpo)!.push(g);
  }

  // Build a finer-grained index: MasterGroup is per-factoryPO, but MasterData
  // rows have per-row poNo + size. We fetch MasterData rows for these FPOs to
  // get per-(FPO, poNo, size) lookup.
  const masterRows = await db.masterData.findMany({
    where: { productType, factoryPO: { in: factoryPOs } },
    select: {
      factoryPO: true,
      poNo: true,
      size: true,
      model: true,
      sku: true,
      colorCode: true,
      colorCode2: true,
      painting: true,
      printingColor: true,
      season: true,
      item: true,
      deadline: true,
      shippingStatus: true,
      date: true,
    },
  });

  // Map: "factoryPO|poNo|size" → representative MasterData row (first match).
  // Use whitespace-normalized size for matching.
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  const byFpoPoSize = new Map<string, MasterGroup>();
  // Use the converted MasterGroup[] (with sizes: string[]).
  const masterGroupByFpo = new Map<string, MasterGroup>();
  for (const g of groups) {
    masterGroupByFpo.set(g.factoryPO, g);
  }

  for (const r of masterRows) {
    const fpo = (r.factoryPO || "").trim();
    const po = (r.poNo || "").trim();
    const sz = norm(r.size || "");
    if (!fpo || !sz) continue;
    const key = `${fpo}|${po}|${sz}`;
    if (!byFpoPoSize.has(key)) {
      const mg = masterGroupByFpo.get(fpo);
      byFpoPoSize.set(key, {
        id: r.factoryPO || "", // not a real MasterGroup id, but sufficient for UI display
        factoryPO: fpo,
        date: r.date,
        shippingStatus: r.shippingStatus,
        model: r.model,
        sku: r.sku,
        poNo: r.poNo,
        item: r.item,
        season: r.season,
        colorCode: r.colorCode,
        colorCode2: r.colorCode2,
        painting: r.painting,
        printingColor: r.printingColor,
        deadline: r.deadline,
        nearestDeadline: mg?.nearestDeadline ?? r.deadline,
        productType,
        sizes: mg ? mg.sizes : [r.size || ""],
        sharedFlags: mg ? mg.sharedFlags : {},
        rowCount: mg?.rowCount ?? 1,
        sourceFile: mg?.sourceFile ?? null,
      });
    }
  }

  return { byFpo, byFpoPoSize };
}

// Batch lookup: fetch aggregated Order/Output/Input for all (poNo + factoryPO + size)
// groups that appear in the bulk rows. Returns a Map keyed by groupKey.
async function batchLookupCurrentQuantities(
  productType: string,
  groupKeys: { poNo: string; factoryPO: string; size: string }[]
): Promise<Map<string, { order: number; output: number; input: number; pending: number }>> {
  if (groupKeys.length === 0) return new Map();

  // Build OR conditions for each unique (poNo, factoryPO, size) tuple.
  const seen = new Set<string>();
  const conditions: string[] = [];
  const params: any[] = [productType];
  let paramIdx = 2; // $1 is productType

  const norm = (s: string) => s.replace(/\s+/g, " ").trim();

  for (const g of groupKeys) {
    const po = g.poNo.trim();
    const fpo = g.factoryPO.trim();
    const sz = norm(g.size);
    const key = `${po}|${fpo}|${sz}`;
    if (seen.has(key)) continue;
    seen.add(key);
    conditions.push(`(poNo = ? AND factoryPO = ? AND size = ?)`);
    params.push(po, fpo, sz);
    paramIdx += 3;
  }

  if (conditions.length === 0) return new Map();

  const sql = `
    SELECT
      poNo, factoryPO, size,
      SUM(CASE WHEN LOWER(shippingStatus) LIKE '1%' OR LOWER(shippingStatus) = 'order'
               THEN COALESCE(qty1, 0) ELSE 0 END) AS orderQty,
      SUM(CASE WHEN LOWER(shippingStatus) LIKE '2%' OR LOWER(shippingStatus) = 'output'
               THEN COALESCE(qty1, 0) ELSE 0 END) AS outputQty,
      SUM(CASE WHEN LOWER(shippingStatus) LIKE '4%' OR LOWER(shippingStatus) = 'input'
               THEN COALESCE(qty1, 0) ELSE 0 END) AS inputQty
    FROM MasterData
    WHERE productType = ? AND (${conditions.join(" OR ")})
    GROUP BY poNo, factoryPO, size
  `;

  const rows = await db.$queryRawUnsafe<{ poNo: string; factoryPO: string; size: string; orderQty: number; outputQty: number; inputQty: number }[]>(
    sql,
    ...params
  );

  const result = new Map<string, { order: number; output: number; input: number; pending: number }>();
  for (const r of rows) {
    const key = `${r.poNo}|${r.factoryPO}|${norm(r.size)}`;
    const output = Number(r.outputQty) || 0;
    result.set(key, {
      order: Number(r.orderQty) || 0,
      output,
      input: Number(r.inputQty) || 0,
      pending: -output, // Pending = -Output (dynamic, not stored)
    });
  }
  return result;
}

// Batch lookup: fetch existing EntryData rows matching the bulk (poNo + factoryPO + size)
// groups. Returns a Map keyed by groupKey → array of entries (for duplicate detection).
async function batchLookupExistingEntries(
  productType: string,
  groupKeys: { poNo: string; factoryPO: string; size: string }[]
): Promise<Map<string, Array<{ id: string; date: string | null; shippingStatus: string | null; qty1: number; createdAt: Date }>>> {
  if (groupKeys.length === 0) return new Map();

  const factoryPOs = [...new Set(groupKeys.map((g) => g.factoryPO.trim()).filter(Boolean))];
  if (factoryPOs.length === 0) return new Map();

  const entries = await db.entryData.findMany({
    where: { productType, factoryPO: { in: factoryPOs } },
    select: { id: true, date: true, shippingStatus: true, qty1: true, poNo: true, factoryPO: true, size: true, createdAt: true },
  });

  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  const result = new Map<string, Array<{ id: string; date: string | null; shippingStatus: string | null; qty1: number; createdAt: Date }>>();
  for (const e of entries) {
    const po = (e.poNo || "").trim();
    const fpo = (e.factoryPO || "").trim();
    const sz = norm(e.size || "");
    const key = `${po}|${fpo}|${sz}`;
    if (!result.has(key)) result.set(key, []);
    result.get(key)!.push({
      id: e.id,
      date: e.date,
      shippingStatus: e.shippingStatus,
      qty1: Number(e.qty1) || 0,
      createdAt: e.createdAt,
    });
  }
  return result;
}

// ===== Main validation function =====

export async function validateBulkData(
  input: BulkValidationInput
): Promise<BulkValidationResult> {
  const { productType, rows } = input;

  if (!productType) {
    return {
      ok: false,
      summary: {
        totalRows: 0, validRows: 0, warningRows: 0, errorRows: 0,
        productGroupsAffected: 0, duplicatePossible: 0, quantityErrors: 0,
        masterDataErrors: 0, deadlineErrors: 0,
      },
      rows: [],
      groupedErrors: [],
      warnings: [{
        code: "DATA_FORMAT_ERROR",
        severity: "ERROR",
        title: "Product type is required",
        description: "Please select a product (MAFATE, ONYX, or MIZUNO) before validating.",
      }],
      currentGroups: {},
      finalGroups: {},
    };
  }

  // Step 1: Parse + extract key fields from each row.
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  const parsed = rows.map((row, idx) => {
    const rowNumber = idx + 2; // Excel row (1-based + header)
    const rawStatus = String(row.shippingStatus || "").trim();
    const poNo = String(row.poNo || "").trim();
    const factoryPO = String(row.factoryPO || "").trim();
    const size = norm(String(row.size || ""));
    const rawQty = String(row.qty1 ?? row.qty2 ?? "").trim();
    const qty1Num = parseInt(rawQty, 10);
    const qty2 = row.qty2 ? String(row.qty2).trim() : undefined;
    return {
      rowNumber,
      rawStatus,
      normalizedStatus: normalizeShippingStatus(rawStatus),
      statusBucket: classifyShippingStatus(rawStatus),
      poNo,
      factoryPO,
      size,
      rawQty,
      qty1Num: isNaN(qty1Num) ? 0 : qty1Num,
      qty2,
      groupKey: `${poNo}|${factoryPO}|${size}`,
    };
  });

  // Step 2: Batch lookup MasterData + existing quantities.
  const lookupKeys = parsed
    .filter((p) => p.factoryPO && p.size)
    .map((p) => ({ poNo: p.poNo, factoryPO: p.factoryPO, size: p.size }));

  const [masterLookup, currentQtyMap, existingEntriesMap] = await Promise.all([
    batchLookupMasterData(productType, lookupKeys),
    batchLookupCurrentQuantities(productType, lookupKeys),
    batchLookupExistingEntries(productType, lookupKeys),
  ]);

  // Step 3: Sequential simulation.
  // For each group key, maintain a running total that starts from the DB state
  // and accumulates as we process rows in order.
  const runningTotals = new Map<string, { order: number; output: number; input: number; pending: number }>();
  for (const [key, val] of currentQtyMap.entries()) {
    runningTotals.set(key, { ...val });
  }

  // Also track per-group rows for duplicate detection inside the bulk.
  const bulkRowsByGroup = new Map<string, number[]>();

  const results: BulkRowResult[] = [];

  for (const p of parsed) {
    const errors: BulkValidationError[] = [];
    const warnings: BulkValidationError[] = [];

    // Step 3a: Required field checks.
    errors.push(...checkRequiredFields(
      {
        shippingStatus: p.rawStatus,
        poNo: p.poNo,
        factoryPO: p.factoryPO,
        size: p.size,
        qty1: p.rawQty,
      },
      p.rowNumber
    ));

    // Step 3b: Shipping status validation.
    if (p.rawStatus && !p.normalizedStatus) {
      errors.push({
        code: "INVALID_SHIPPING_STATUS",
        severity: "ERROR",
        title: "Invalid shipping status",
        description: `Row ${p.rowNumber}: "${p.rawStatus}" is not a valid status. Must be one of: 1.Order, 2.Output, 3.Pending, 4.Input.`,
      });
    }

    // Step 3c: Qty validation.
    if (p.rawQty && (isNaN(parseInt(p.rawQty, 10)))) {
      errors.push({
        code: "INVALID_QTY",
        severity: "ERROR",
        title: "Invalid quantity",
        description: `Row ${p.rowNumber}: Qty "${p.rawQty}" is not a number.`,
      });
    }
    if (!isNaN(p.qty1Num) && p.qty1Num === 0 && p.rawQty) {
      errors.push({
        code: "INVALID_QTY",
        severity: "ERROR",
        title: "Quantity must be greater than 0",
        description: `Row ${p.rowNumber}: Qty = 0 is not allowed.`,
      });
    }
    if (!isNaN(p.qty1Num) && p.qty1Num < 0 && p.rawQty) {
      errors.push({
        code: "INVALID_QTY",
        severity: "ERROR",
        title: "Quantity cannot be negative",
        description: `Row ${p.rowNumber}: Qty = ${p.qty1Num} is negative.`,
      });
    }

    // Step 3d: Master data lookup.
    let masterFound = false;
    let masterGroup: MasterGroup | null = null;
    let model = "";
    let sku = "";
    let colorCode = "";
    let deadline = "";

    if (p.factoryPO && p.poNo && p.size) {
      const key = `${p.factoryPO}|${p.poNo}|${p.size}`;
      masterGroup = masterLookup.byFpoPoSize.get(key) || null;
      if (masterGroup) {
        masterFound = true;
        model = masterGroup.model || "";
        sku = masterGroup.sku || "";
        colorCode = masterGroup.colorCode || "";
        deadline = masterGroup.nearestDeadline || masterGroup.deadline || "";
      } else {
        // Check if factory PO exists at all (maybe size mismatch).
        const fpoGroups = masterLookup.byFpo.get(p.factoryPO);
        if (!fpoGroups || fpoGroups.length === 0) {
          errors.push({
            code: "MISSING_MASTER_DATA",
            severity: "ERROR",
            title: "Factory PO not in Master Data",
            description: `Row ${p.rowNumber}: Factory PO "${p.factoryPO}" does not exist in ${productType} Master Data.`,
          });
        } else {
          // Factory PO exists but size doesn't match.
          const allSizes = new Set<string>();
          for (const g of fpoGroups) {
            for (const s of g.sizes) allSizes.add(norm(s));
          }
          if (!allSizes.has(p.size)) {
            errors.push({
              code: "INVALID_SIZE",
              severity: "ERROR",
              title: "Size not valid for this Factory PO",
              description: `Row ${p.rowNumber}: Size "${p.size}" is not in the size list for Factory PO ${p.factoryPO}. Valid sizes: ${[...allSizes].slice(0, 5).join(", ")}${allSizes.size > 5 ? "..." : ""}.`,
            });
          }
        }
      }
    }

    // Step 3e: Sequential quantity simulation.
    // Get the current running total for this group (starts from DB state).
    const current = runningTotals.get(p.groupKey) || { order: 0, output: 0, input: 0, pending: 0 };

    // Calculate the after-save total if this row is applied.
    const afterSave = { ...current };
    if (p.normalizedStatus) {
      switch (p.statusBucket) {
        case "order":
          afterSave.order += p.qty1Num;
          break;
        case "output":
          afterSave.output += p.qty1Num;
          afterSave.pending = -afterSave.output; // Pending = -Output
          break;
        case "input":
          afterSave.input += p.qty1Num;
          break;
        case "pending":
          // Manual pending entry — warn (usually auto-created).
          warnings.push({
            code: "PENDING_WITHOUT_OUTPUT",
            severity: "WARNING",
            title: "Manual Pending entry",
            description: `Row ${p.rowNumber}: Pending is normally auto-calculated as -Output. Manually entering it is unusual.`,
          });
          break;
      }
    }

    // Step 3f: Quantity limit checks (sequential — uses afterSave which includes all prior rows).
    if (p.statusBucket === "output") {
      // Output must not exceed Order.
      if (afterSave.order > 0 && afterSave.output > afterSave.order) {
        const excess = afterSave.output - afterSave.order;
        errors.push({
          code: "OUTPUT_EXCEEDS_ORDER",
          severity: "ERROR",
          title: "Output exceeds Order",
          description: `Row ${p.rowNumber}: After this row, Output (${afterSave.output}) will exceed Order (${afterSave.order}) by ${excess}.`,
          excess,
        });
      }
      // Warn if no order yet.
      if (current.order === 0 && afterSave.order === 0) {
        warnings.push({
          code: "OUTPUT_WITHOUT_ORDER",
          severity: "WARNING",
          title: "Output without Order",
          description: `Row ${p.rowNumber}: Adding Output but no Order exists for this product key.`,
        });
      }
    }

    if (p.statusBucket === "input") {
      // Input must not exceed Output.
      if (afterSave.output > 0 && afterSave.input > afterSave.output) {
        const excess = afterSave.input - afterSave.output;
        errors.push({
          code: "INPUT_EXCEEDS_OUTPUT",
          severity: "ERROR",
          title: "Input exceeds Output",
          description: `Row ${p.rowNumber}: After this row, Input (${afterSave.input}) will exceed Output (${afterSave.output}) by ${excess}.`,
          excess,
        });
      }
      // Input must not exceed Order.
      if (afterSave.order > 0 && afterSave.input > afterSave.order) {
        const excess = afterSave.input - afterSave.order;
        errors.push({
          code: "INPUT_EXCEEDS_ORDER",
          severity: "ERROR",
          title: "Input exceeds Order",
          description: `Row ${p.rowNumber}: After this row, Input (${afterSave.input}) will exceed Order (${afterSave.order}) by ${excess}.`,
          excess,
        });
      }
      // Warn if no output yet.
      if (current.output === 0 && afterSave.output === 0) {
        warnings.push({
          code: "INPUT_WITHOUT_OUTPUT",
          severity: "WARNING",
          title: "Input without Output",
          description: `Row ${p.rowNumber}: Adding Input but no Output exists for this product key.`,
        });
      }
      // Warn if already completed.
      if (current.order > 0 && current.input >= current.order && current.output >= current.order) {
        warnings.push({
          code: "PRODUCT_ALREADY_COMPLETED",
          severity: "WARNING",
          title: "Product already completed",
          description: `Row ${p.rowNumber}: Order=${current.order}, Output=${current.output}, Input=${current.input}. This product key is already completed.`,
        });
      }
    }

    // Step 3g: Deadline check.
    if (deadline && p.statusBucket !== "order") {
      const dStatus = computeDeadlineStatus(deadline, false);
      if (dStatus === "OVERDUE") {
        warnings.push({
          code: "DEADLINE_PASSED",
          severity: "WARNING",
          title: "Deadline has passed",
          description: `Row ${p.rowNumber}: Deadline ${deadline} has already passed.`,
        });
      }
    }

    // Step 3h: Duplicate detection inside bulk (same date + status + qty for same group).
    const groupRows = bulkRowsByGroup.get(p.groupKey) || [];
    bulkRowsByGroup.set(p.groupKey, [...groupRows, p.rowNumber]);

    // Check against other rows in this bulk with same (date + status + qty).
    // We use today's date for pasted rows (no date column in bulk).
    const today = new Date().toISOString().slice(0, 10);
    for (const prevRowNum of groupRows) {
      const prevRow = results[prevRowNum - 2]; // rowNumber = idx+2 → idx = rowNumber-2
      if (!prevRow) continue;
      if (prevRow.shippingStatus === p.normalizedStatus &&
          prevRow.qty1Num === p.qty1Num) {
        warnings.push({
          code: "POSSIBLE_DUPLICATE_BULK",
          severity: "WARNING",
          title: "Possible duplicate inside bulk data",
          description: `Row ${p.rowNumber} may duplicate Row ${prevRowNum} (same status "${p.normalizedStatus}" and qty ${p.qty1Num}).`,
          duplicateRowNumbers: [prevRowNum, p.rowNumber],
        });
        break;
      }
    }

    // Step 3i: Duplicate detection against existing EntryData.
    if (p.factoryPO && p.size) {
      const existingEntries = existingEntriesMap.get(p.groupKey) || [];
      for (const ex of existingEntries) {
        if (ex.shippingStatus === p.normalizedStatus && ex.qty1 === p.qty1Num) {
          warnings.push({
            code: "POSSIBLE_DUPLICATE_EXISTING",
            severity: "WARNING",
            title: "Possible duplicate transaction",
            description: `Row ${p.rowNumber} may duplicate existing entry ${ex.id} (date ${ex.date || "?"}, status "${ex.shippingStatus}", qty ${ex.qty1}).`,
          });
          break;
        }
      }
    }

    // Step 3j: Commit this row's qty to the running total (so next row sees it).
    if (p.normalizedStatus && errors.filter((e) => e.severity === "ERROR").length === 0) {
      runningTotals.set(p.groupKey, afterSave);
    }

    // Step 3k: Determine overall severity for this row.
    const allIssues = [...errors, ...warnings];
    let severity: BulkSeverity = "INFO";
    if (errors.some((e) => e.severity === "CRITICAL")) severity = "CRITICAL";
    else if (errors.some((e) => e.severity === "ERROR")) severity = "ERROR";
    else if (warnings.some((w) => w.severity === "WARNING")) severity = "WARNING";

    const status: "valid" | "warning" | "error" =
      severity === "ERROR" || severity === "CRITICAL" ? "error" :
      severity === "WARNING" ? "warning" : "valid";

    const needsConfirm = warnings.length > 0 && errors.length === 0;

    results.push({
      rowNumber: p.rowNumber,
      shippingStatus: p.normalizedStatus || p.rawStatus,
      poNo: p.poNo,
      factoryPO: p.factoryPO,
      size: p.size,
      qty1: p.rawQty,
      qty2: p.qty2,
      qty1Num: p.qty1Num,
      statusBucket: p.statusBucket,
      masterDataFound: masterFound,
      masterGroup,
      model,
      sku,
      colorCode,
      deadline,
      current,
      afterSave,
      severity,
      errors: allIssues,
      status,
      groupKey: p.groupKey,
      needsConfirm,
    });
  }

  // Step 4: Build grouped errors (for the "GROUP ERROR SUMMARY" view).
  const groupedMap = new Map<string, BulkGroupedError>();
  for (const r of results) {
    if (r.status !== "error") continue;
    for (const err of r.errors) {
      if (err.severity !== "ERROR" && err.severity !== "CRITICAL") continue;
      // Group by (groupKey + error code) so same-type errors aggregate.
      const gKey = `${r.groupKey}|${err.code}`;
      if (!groupedMap.has(gKey)) {
        const finalGroup = runningTotals.get(r.groupKey) || { order: 0, output: 0, input: 0, pending: 0 };
        groupedMap.set(gKey, {
          groupKey: r.groupKey,
          poNo: r.poNo,
          factoryPO: r.factoryPO,
          size: r.size,
          model: r.model,
          colorCode: r.colorCode,
          rowNumbers: [r.rowNumber],
          current: { ...r.current },
          newTotal: { ...r.afterSave },
          expected: {
            order: finalGroup.order,
            output: finalGroup.output,
            input: finalGroup.input,
          },
          excess: err.excess || 0,
          code: err.code,
          severity: err.severity,
          title: err.title,
          description: err.description,
        });
      } else {
        const g = groupedMap.get(gKey)!;
        if (!g.rowNumbers.includes(r.rowNumber)) {
          g.rowNumbers.push(r.rowNumber);
        }
      }
    }
  }
  const groupedErrors = [...groupedMap.values()];

  // Step 5: Build summary.
  const validRows = results.filter((r) => r.status === "valid").length;
  const warningRows = results.filter((r) => r.status === "warning").length;
  const errorRows = results.filter((r) => r.status === "error").length;
  const productGroupsAffected = new Set(results.map((r) => r.groupKey)).size;
  const duplicatePossible = results.filter((r) =>
    r.errors.some((e) => e.code === "POSSIBLE_DUPLICATE_BULK" || e.code === "POSSIBLE_DUPLICATE_EXISTING")
  ).length;
  const quantityErrors = results.filter((r) =>
    r.errors.some((e) =>
      e.code === "OUTPUT_EXCEEDS_ORDER" || e.code === "INPUT_EXCEEDS_OUTPUT" ||
      e.code === "INPUT_EXCEEDS_ORDER" || e.code === "INPUT_WITHOUT_OUTPUT" ||
      e.code === "OUTPUT_WITHOUT_ORDER"
    )
  ).length;
  const masterDataErrors = results.filter((r) =>
    r.errors.some((e) => e.code === "MISSING_MASTER_DATA" || e.code === "INVALID_SIZE")
  ).length;
  const deadlineErrors = results.filter((r) =>
    r.errors.some((e) => e.code === "DEADLINE_PASSED")
  ).length;

  // Step 6: Build currentGroups + finalGroups (for the combined simulation view).
  const currentGroups: Record<string, { order: number; output: number; input: number; pending: number }> = {};
  const finalGroups: Record<string, { order: number; output: number; input: number; pending: number }> = {};
  for (const [key, val] of currentQtyMap.entries()) {
    currentGroups[key] = { ...val };
  }
  for (const [key, val] of runningTotals.entries()) {
    finalGroups[key] = { ...val };
  }

  return {
    ok: true,
    summary: {
      totalRows: results.length,
      validRows,
      warningRows,
      errorRows,
      productGroupsAffected,
      duplicatePossible,
      quantityErrors,
      masterDataErrors,
      deadlineErrors,
    },
    rows: results,
    groupedErrors,
    warnings: [],
    currentGroups,
    finalGroups,
  };
}
