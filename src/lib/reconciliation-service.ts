// ReconciliationService
// Compares imported Excel data with Website (MasterData) data within a selected
// date range. Only 4 fields are compared: PO NO#, Factory PO, Size, Qty.
//
// Flow (spec §27):
//   Excel Data → Filter By Date → Normalize → Group By (PO+FactoryPO+Size) → SUM Qty
//   Website Data → Filter Same Date Range → Normalize → Group → SUM Qty
//   FULL OUTER COMPARISON → MATCH / MISMATCH / MISSING / DUPLICATE
//
// Key rules:
//   - Date is only a FILTER — not part of the comparison key.
//   - Size normalization: trim, collapse spaces, remove line breaks. M(10) ≠ M(10T).
//   - Qty is summed per group before comparison (so 10+16=26 matches a single 26).
//   - READ-ONLY: this service never writes data. Only detects + reports.
//   - EXACT DUPLICATE detection: same (date + poNo + factoryPO + size + qty) appears >1 time.

import { db } from "./db";

// ===== Types =====

export interface ReconciliationInput {
  productType: string;
  dateFrom: string; // yyyy-MM-dd
  dateTo: string;   // yyyy-MM-dd
  excelRows: Array<{
    date?: string;
    poNo?: string;
    factoryPO?: string;
    size?: string;
    qty?: string | number;
  }>;
}

export type ComparisonStatus =
  | "MATCHED"
  | "QTY_MISMATCH"
  | "MISSING_ON_WEBSITE"
  | "MISSING_IN_EXCEL"
  | "POSSIBLE_WRONG_FACTORY_PO"
  | "POSSIBLE_WRONG_SIZE"
  | "POSSIBLE_DUPLICATE"
  | "EXACT_DUPLICATE"
  | "INVALID_DATA";

export interface ComparisonResult {
  status: ComparisonStatus;
  poNo: string;
  factoryPO: string;
  size: string;
  excelQty: number;
  websiteQty: number;
  difference: number; // excelQty - websiteQty
  suggestedFactoryPO?: string;
  suggestedSize?: string;
  excelRowCount: number;
  websiteRowCount: number;
  // For exact duplicate: count of duplicate occurrences.
  duplicateCount?: number;
}

export interface ReconciliationSummary {
  dateRange: { from: string; to: string };
  excelTotalRecords: number;
  excelRecordsInDateRange: number;
  excelExcluded: number;
  websiteTotalRecords: number;
  websiteRecordsInDateRange: number;
  websiteExcluded: number;
  matched: number;
  qtyMismatch: number;
  missingOnWebsite: number;
  missingInExcel: number;
  possibleWrongFactoryPO: number;
  possibleWrongSize: number;
  possibleDuplicate: number;
  exactDuplicate: number;
  invalidData: number;
  totalIssues: number;
  totalGroups: number;
}

export interface ReconciliationOutput {
  ok: boolean;
  summary: ReconciliationSummary;
  results: ComparisonResult[];
}

// ===== Normalization =====

// Parse a date string to yyyy-MM-dd. Handles Excel serials, dd/MM/yyyy, ISO.
function parseDate(raw: string | number | null | undefined): string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const s = String(raw).trim();
  if (!s) return null;
  // Excel serial (number of days since 1900-01-01)
  const n = Number(s);
  if (!isNaN(n) && n > 1000 && n < 100000) {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    epoch.setDate(epoch.getDate() + n);
    return epoch.toISOString().slice(0, 10);
  }
  // dd/MM/yyyy
  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) {
    const d = new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  // yyyy-MM-dd or ISO
  const iso = new Date(s);
  if (!isNaN(iso.getTime())) return iso.toISOString().slice(0, 10);
  return null;
}

// Normalize a string field: trim, collapse spaces, remove line breaks, uppercase.
function normalizeStr(s: string | null | undefined): string {
  if (!s) return "";
  return String(s)
    .replace(/\r\n|\n|\r/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

// Normalize Size: M(07) /W(08) → M(07)/W(08). Preserves T suffix.
function normalizeSize(s: string | null | undefined): string {
  if (!s) return "";
  return String(s)
    .replace(/\r\n|\n|\r/g, "")
    .replace(/\s+/g, "")
    .trim()
    .toUpperCase();
}

// Normalize Qty: "10" → 10, 10.0 → 10, "10.5" → 10.5, "" → 0.
function normalizeQty(q: string | number | null | undefined): number {
  if (q === null || q === undefined || q === "") return 0;
  const n = Number(String(q).trim());
  return isNaN(n) ? 0 : n;
}

// ===== Group + Sum =====

interface GroupedRow {
  poNo: string;
  factoryPO: string;
  size: string;
  qty: number;
  rowCount: number;
}

function groupAndSum(rows: Array<{ poNo: string; factoryPO: string; size: string; qty: number }>): Map<string, GroupedRow> {
  const map = new Map<string, GroupedRow>();
  for (const r of rows) {
    const key = `${r.poNo}|${r.factoryPO}|${r.size}`;
    if (!map.has(key)) {
      map.set(key, { poNo: r.poNo, factoryPO: r.factoryPO, size: r.size, qty: 0, rowCount: 0 });
    }
    const g = map.get(key)!;
    g.qty += r.qty;
    g.rowCount++;
  }
  return map;
}

// ===== Exact duplicate detection (spec §17) =====
// Checks if the same (date + poNo + factoryPO + size + qty) appears more than once
// within the same source (Excel or Website).
interface ExactDuplicate {
  poNo: string;
  factoryPO: string;
  size: string;
  qty: number;
  count: number;
  source: "excel" | "website";
}

function findExactDuplicates(rows: Array<{ date: string; poNo: string; factoryPO: string; size: string; qty: number }>, source: "excel" | "website"): ExactDuplicate[] {
  const seen = new Map<string, { count: number; sample: { date: string; poNo: string; factoryPO: string; size: string; qty: number } }>();
  for (const r of rows) {
    const key = `${r.date}|${r.poNo}|${r.factoryPO}|${r.size}|${r.qty}`;
    if (!seen.has(key)) {
      seen.set(key, { count: 0, sample: r });
    }
    seen.get(key)!.count++;
  }
  const duplicates: ExactDuplicate[] = [];
  for (const [, v] of seen) {
    if (v.count > 1) {
      duplicates.push({
        poNo: v.sample.poNo,
        factoryPO: v.sample.factoryPO,
        size: v.sample.size,
        qty: v.sample.qty,
        count: v.count,
        source,
      });
    }
  }
  return duplicates;
}

// ===== Main reconciliation function =====

export async function reconcileData(input: ReconciliationInput): Promise<ReconciliationOutput> {
  const { productType, dateFrom, dateTo, excelRows } = input;

  // Step 1: Parse + filter Excel rows by date range.
  const excelTotalRecords = excelRows.length;
  let excelRecordsInDateRange = 0;
  const excelNormalized: Array<{ date: string; poNo: string; factoryPO: string; size: string; qty: number }> = [];
  let excelInvalidCount = 0;

  for (const row of excelRows) {
    const dateStr = parseDate(row.date);
    if (dateStr) {
      if (dateStr < dateFrom || dateStr > dateTo) continue; // outside range → excluded
    } else {
      continue; // no date → excluded (spec §4)
    }
    excelRecordsInDateRange++;
    const poNo = normalizeStr(row.poNo);
    const factoryPO = normalizeStr(row.factoryPO);
    const size = normalizeSize(row.size);
    const qty = normalizeQty(row.qty);
    if (!poNo || !factoryPO || !size) {
      excelInvalidCount++;
      continue; // invalid data
    }
    excelNormalized.push({ date: dateStr, poNo, factoryPO, size, qty });
  }

  // Step 2: Fetch Website (MasterData) rows in the date range.
  const websiteRows = await db.masterData.findMany({
    where: { productType },
    select: { date: true, poNo: true, factoryPO: true, size: true, qty1: true, shippingStatus: true },
  });
  const websiteTotalRecords = websiteRows.length;
  let websiteRecordsInDateRange = 0;
  const websiteNormalized: Array<{ date: string; poNo: string; factoryPO: string; size: string; qty: number }> = [];

  for (const row of websiteRows) {
    const dateStr = parseDate(row.date);
    if (dateStr) {
      if (dateStr < dateFrom || dateStr > dateTo) continue;
    } else {
      continue;
    }
    websiteRecordsInDateRange++;
    const poNo = normalizeStr(row.poNo);
    const factoryPO = normalizeStr(row.factoryPO);
    const size = normalizeSize(row.size);
    const qty = normalizeQty(row.qty1);
    if (!poNo || !factoryPO || !size) continue;
    websiteNormalized.push({ date: dateStr, poNo, factoryPO, size, qty });
  }

  // Step 3: Detect exact duplicates (spec §17) — same (date+poNo+factoryPO+size+qty) appears >1 time.
  const excelDuplicates = findExactDuplicates(excelNormalized, "excel");
  const websiteDuplicates = findExactDuplicates(websiteNormalized, "website");

  // Step 4: Group + sum both datasets.
  const excelGroups = groupAndSum(excelNormalized);
  const websiteGroups = groupAndSum(websiteNormalized);

  // Step 5: Full outer comparison.
  const allKeys = new Set<string>([...excelGroups.keys(), ...websiteGroups.keys()]);
  const results: ComparisonResult[] = [];

  // Build lookup indexes for "possible wrong" detection.
  const websiteByPoSize = new Map<string, string[]>();
  const websiteByPoFpo = new Map<string, string[]>();
  for (const [, g] of websiteGroups) {
    const ks = `${g.poNo}|${g.size}`;
    if (!websiteByPoSize.has(ks)) websiteByPoSize.set(ks, []);
    websiteByPoSize.get(ks)!.push(g.factoryPO);
    const kf = `${g.poNo}|${g.factoryPO}`;
    if (!websiteByPoFpo.has(kf)) websiteByPoFpo.set(kf, []);
    websiteByPoFpo.get(kf)!.push(g.size);
  }

  for (const key of allKeys) {
    const excel = excelGroups.get(key);
    const website = websiteGroups.get(key);

    if (excel && website) {
      const diff = excel.qty - website.qty;
      if (excel.qty === website.qty) {
        if (excel.rowCount > 1 || website.rowCount > 1) {
          results.push({
            status: "POSSIBLE_DUPLICATE",
            poNo: excel.poNo, factoryPO: excel.factoryPO, size: excel.size,
            excelQty: excel.qty, websiteQty: website.qty, difference: 0,
            excelRowCount: excel.rowCount, websiteRowCount: website.rowCount,
          });
        } else {
          results.push({
            status: "MATCHED",
            poNo: excel.poNo, factoryPO: excel.factoryPO, size: excel.size,
            excelQty: excel.qty, websiteQty: website.qty, difference: 0,
            excelRowCount: excel.rowCount, websiteRowCount: website.rowCount,
          });
        }
      } else {
        results.push({
          status: "QTY_MISMATCH",
          poNo: excel.poNo, factoryPO: excel.factoryPO, size: excel.size,
          excelQty: excel.qty, websiteQty: website.qty, difference: diff,
          excelRowCount: excel.rowCount, websiteRowCount: website.rowCount,
        });
      }
    } else if (excel && !website) {
      const poSizeKey = `${excel.poNo}|${excel.size}`;
      const possibleFpos = websiteByPoSize.get(poSizeKey) || [];
      const poFpoKey = `${excel.poNo}|${excel.factoryPO}`;
      const possibleSizes = websiteByPoFpo.get(poFpoKey) || [];

      if (possibleFpos.length > 0) {
        results.push({
          status: "POSSIBLE_WRONG_FACTORY_PO",
          poNo: excel.poNo, factoryPO: excel.factoryPO, size: excel.size,
          excelQty: excel.qty, websiteQty: 0, difference: excel.qty,
          suggestedFactoryPO: possibleFpos[0],
          excelRowCount: excel.rowCount, websiteRowCount: 0,
        });
      } else if (possibleSizes.length > 0) {
        results.push({
          status: "POSSIBLE_WRONG_SIZE",
          poNo: excel.poNo, factoryPO: excel.factoryPO, size: excel.size,
          excelQty: excel.qty, websiteQty: 0, difference: excel.qty,
          suggestedSize: possibleSizes[0],
          excelRowCount: excel.rowCount, websiteRowCount: 0,
        });
      } else {
        results.push({
          status: "MISSING_ON_WEBSITE",
          poNo: excel.poNo, factoryPO: excel.factoryPO, size: excel.size,
          excelQty: excel.qty, websiteQty: 0, difference: excel.qty,
          excelRowCount: excel.rowCount, websiteRowCount: 0,
        });
      }
    } else if (!excel && website) {
      results.push({
        status: "MISSING_IN_EXCEL",
        poNo: website.poNo, factoryPO: website.factoryPO, size: website.size,
        excelQty: 0, websiteQty: website.qty, difference: -website.qty,
        excelRowCount: 0, websiteRowCount: website.rowCount,
      });
    }
  }

  // Add exact duplicate results (spec §17).
  for (const dup of [...excelDuplicates, ...websiteDuplicates]) {
    results.push({
      status: "EXACT_DUPLICATE",
      poNo: dup.poNo, factoryPO: dup.factoryPO, size: dup.size,
      excelQty: dup.qty, websiteQty: dup.qty, difference: 0,
      excelRowCount: dup.source === "excel" ? dup.count : 0,
      websiteRowCount: dup.source === "website" ? dup.count : 0,
      duplicateCount: dup.count,
    });
  }

  // Step 6: Build summary.
  const summary: ReconciliationSummary = {
    dateRange: { from: dateFrom, to: dateTo },
    excelTotalRecords,
    excelRecordsInDateRange,
    excelExcluded: excelTotalRecords - excelRecordsInDateRange,
    websiteTotalRecords,
    websiteRecordsInDateRange,
    websiteExcluded: websiteTotalRecords - websiteRecordsInDateRange,
    matched: results.filter((r) => r.status === "MATCHED").length,
    qtyMismatch: results.filter((r) => r.status === "QTY_MISMATCH").length,
    missingOnWebsite: results.filter((r) => r.status === "MISSING_ON_WEBSITE").length,
    missingInExcel: results.filter((r) => r.status === "MISSING_IN_EXCEL").length,
    possibleWrongFactoryPO: results.filter((r) => r.status === "POSSIBLE_WRONG_FACTORY_PO").length,
    possibleWrongSize: results.filter((r) => r.status === "POSSIBLE_WRONG_SIZE").length,
    possibleDuplicate: results.filter((r) => r.status === "POSSIBLE_DUPLICATE").length,
    exactDuplicate: results.filter((r) => r.status === "EXACT_DUPLICATE").length,
    invalidData: results.filter((r) => r.status === "INVALID_DATA").length + excelInvalidCount,
    totalIssues: results.filter((r) => r.status !== "MATCHED").length,
    totalGroups: results.length,
  };

  return { ok: true, summary, results };
}
