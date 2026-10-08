// Reconciliation Tool Service — spec F1–F9.
//
// A standalone reconciliation engine that compares two datasets (MasterData
// filtered by productType) with:
//   F1  Column scanning (profiles per dataset)
//   F2  Column mapping (source A ↔ source B) with roles
//   F3  Rule engine (normalize → cast → regex → lookup → conditional → formula)
//       Critical sub-feature (F3.5): conditional size transformation.
//       ART prefix "3MH" → Men, "3WH" → Women, then use the matching size
//       conversion table (Men table or Women table).
//   F4  Comparison config (match keys, tolerance, mode, pre-filter)
//   F5  Status engine (9 canonical statuses)
//   F6  Dashboard data (KPIs + chart datasets)
//   F7  (interactive review — not implemented here, server-only)
//   F8  Multi-sheet Excel export
//   F9  Profile persistence
//
// READ-ONLY: never modifies source data.

import { db } from "./db";
import { classifyShippingStatus } from "./quantity-service";
import {
  detectGender,
  stechSizeToCanonical,
  fvoSizeToCanonical,
  type Gender,
} from "./fvo-stech-tracking-service";

// ── Types ────────────────────────────────────────────────────────────────────

// F2: column mapping roles.
export type FieldRole =
  | "PRIMARY_KEY"
  | "SECONDARY_KEY"
  | "ATTRIBUTE"
  | "QUANTITY"
  | "DATE"
  | "FILTER";

export interface FieldMapping {
  sourceField: string; // canonical field name in source dataset
  targetField: string; // canonical field name in target dataset
  role: FieldRole;
  // Optional transformation rule (F3) — applied to BOTH sides so the values
  // are normalized into a common form before comparison.
  transformRule?: string;
}

// F3.4: editable size conversion lookup tables.
// Each table maps raw size tokens to canonical US sizes for one gender.
export interface SizeConversionTable {
  gender: "M" | "W";
  // entries: { "M07": "7", "M07T": "7.5", "W08": "8", ... }
  entries: Record<string, string>;
}

// F3.5: conditional size transformation rule.
// condition: e.g. "gender==M" → apply table `tableId` (menTableId).
// If no rule matches, fall back to the built-in stechSizeToCanonical /
// fvoSizeToCanonical helpers.
export interface SizeTransformRule {
  id: string;
  name: string;
  // "if_then" | "regex_extract" | "lookup" | "formula"
  type: "if_then" | "regex_extract" | "lookup" | "formula";
  // For if_then: condition field ("gender==M" | "gender==W" | "dataset==ONYX")
  condition?: string;
  // The table to apply (gender-specific size conversion table).
  tableId?: "men" | "women";
  // For regex_extract: the regex (defaults to /[MW]\d{1,2}T?/).
  regex?: string;
  // For formula: simple expression (limited eval — see applyFormula).
  formula?: string;
  // Whether this rule is enabled.
  enabled: boolean;
}

// F3.1: normalize flags.
export interface NormalizeConfig {
  trim?: boolean;
  upper?: boolean;
  removeWhitespace?: boolean;
  commaToDot?: boolean;
}

// F4: comparison config.
export interface ToleranceConfig {
  type: "absolute" | "percentage";
  value: number; // ±n pairs or ±%
}

export interface PreFilter {
  shippingStatus?: string; // e.g. "1.Order" → only compare order rows
  dateFrom?: string;
  dateTo?: string;
}

export interface ReconciliationConfig {
  sourceDataset: string; // "ONYX_FVO"
  targetDataset: string; // "ONYX"
  fieldMappings: FieldMapping[];
  matchKeys: string[]; // subset of sourceField values
  statusMapping: Record<string, string>; // source status → target status
  tolerance: ToleranceConfig;
  mode: "row_to_row" | "aggregate";
  preFilter: PreFilter;
  sizeTransformRules: SizeTransformRule[];
  normalizeConfig?: NormalizeConfig;
  // Optional lookup tables for size conversion (F3.4).
  sizeConversionTables?: SizeConversionTable[];
}

// F1: column profile for a dataset.
export interface ColumnProfile {
  field: string;
  type: "string" | "number" | "date" | "boolean" | "mixed" | "empty";
  emptyPct: number; // 0-100
  uniqueCount: number;
  samples: string[]; // up to 5 sample values
  totalCount: number;
}

// F5: status engine — 9 canonical statuses.
export type ReconStatus =
  | "MATCHED_OK"
  | "PARTIAL"
  | "OVER"
  | "MISSING_OUT"
  | "ORPHAN"
  | "DUP"
  | "ATTR_MISMATCH"
  | "FMT_FIXED"
  | "SUSPECT_PO";

export const RECON_STATUSES: ReconStatus[] = [
  "MATCHED_OK",
  "PARTIAL",
  "OVER",
  "MISSING_OUT",
  "ORPHAN",
  "DUP",
  "ATTR_MISMATCH",
  "FMT_FIXED",
  "SUSPECT_PO",
];

// F6: KPI summary + chart data.
export interface ReconciliationSummary {
  runId: string;
  profileId: string;
  profileName: string;
  sourceDataset: string;
  targetDataset: string;
  totalLines: number;
  // Status tallies (F5).
  statusCounts: Record<ReconStatus, number>;
  sourceTotalQty: number;
  targetTotalQty: number;
  totalDifference: number;
  matchPercentage: number;
  durationMs: number;
  mode: string;
}

export interface DashboardChartData {
  // Stacked bar: per-status distribution split by gender.
  stackedBar: Array<{ label: string; M: number; W: number; unknown: number }>;
  // Donut: per-status percentage.
  donut: Array<{ label: string; value: number; color: string }>;
  // Top shortage: largest absolute shortages (source − target).
  topShortage: Array<{ key: string; missing: number }>;
  // Heatmap: status × gender counts.
  heatmap: Array<{ status: string; gender: string; value: number }>;
  // Timeline: rows by status × date bucket (yyyy-mm).
  timeline: Array<{ bucket: string; status: string; value: number }>;
}

// Result row (one per matched/unmatched key).
export interface ReconResultRow {
  id: string;
  runId: string;
  key: string;
  sourceData: {
    poNo: string;
    factoryPO: string;
    size: string;
    rawSize: string;
    model: string | null;
    colorCode: string | null;
    deadline: string | null;
    gender: Gender;
    rowCount: number;
  };
  targetData: {
    poNo: string;
    factoryPO: string;
    size: string;
    rawSize: string;
    model: string | null;
    colorCode: string | null;
    deadline: string | null;
    gender: Gender;
    rowCount: number;
  };
  sourceQty: number;
  targetQty: number;
  difference: number;
  percentage: number;
  status: ReconStatus;
  issues: string[];
  matchType: string | null;
  createdAt: Date;
}

// ── Default profile (spec §5 default profile) ────────────────────────────────

// F3.4: default Men and Women size conversion tables.
// These are seeded from the same rules used in fvo-stech-tracking-service.ts:
//   M07 → 7, M07T → 7.5, ..., M14 → 14
//   W05 → 5, W05T → 5.5, ..., W10T → 10.5
function buildDefaultMenTable(): SizeConversionTable {
  const entries: Record<string, string> = {};
  for (let n = 7; n <= 14; n++) {
    entries[`M${String(n).padStart(2, "0")}`] = String(n);
    if (n < 14) entries[`M${String(n).padStart(2, "0")}T`] = String(n + 0.5);
  }
  return { gender: "M", entries };
}

function buildDefaultWomenTable(): SizeConversionTable {
  const entries: Record<string, string> = {};
  for (let n = 5; n <= 10; n++) {
    entries[`W${String(n).padStart(2, "0")}`] = String(n);
    if (n < 10 || n === 10) {
      // T suffix = +0.5 (W10T → 10.5)
      entries[`W${String(n).padStart(2, "0")}T`] = String(n + 0.5);
    }
  }
  return { gender: "W", entries };
}

export const DEFAULT_MEN_TABLE = buildDefaultMenTable();
export const DEFAULT_WOMEN_TABLE = buildDefaultWomenTable();

export const DEFAULT_RECON_PROFILE: ReconciliationConfig = {
  sourceDataset: "ONYX_FVO",
  targetDataset: "ONYX",
  fieldMappings: [
    // FVO's poNo (OCF...) ↔ Stech's factoryPO
    { sourceField: "poNo", targetField: "factoryPO", role: "PRIMARY_KEY" },
    // FVO's factoryPO (ART e.g. 3MH...) ↔ Stech's poNo
    { sourceField: "factoryPO", targetField: "poNo", role: "PRIMARY_KEY" },
    // Size — transformed (F3.5 conditional mapping)
    { sourceField: "size", targetField: "size", role: "PRIMARY_KEY", transformRule: "size_normalize" },
    // Attribute consistency check (Model + Color)
    { sourceField: "model", targetField: "model", role: "ATTRIBUTE" },
    { sourceField: "colorCode", targetField: "colorCode", role: "ATTRIBUTE" },
    // Quantity compare
    { sourceField: "qty1", targetField: "qty1", role: "QUANTITY" },
    // Date
    { sourceField: "deadline", targetField: "deadline", role: "DATE" },
    // Filter
    { sourceField: "shippingStatus", targetField: "shippingStatus", role: "FILTER" },
  ],
  matchKeys: ["poNo", "factoryPO", "size"],
  statusMapping: { "1.Order": "1.Order" },
  tolerance: { type: "absolute", value: 0 },
  mode: "aggregate",
  preFilter: { shippingStatus: "1.Order" },
  sizeTransformRules: [
    {
      id: "men-rule",
      name: "Men size (3MH prefix)",
      type: "if_then",
      condition: "gender==M",
      tableId: "men",
      enabled: true,
    },
    {
      id: "women-rule",
      name: "Women size (3WH prefix)",
      type: "if_then",
      condition: "gender==W",
      tableId: "women",
      enabled: true,
    },
    {
      id: "regex-rule",
      name: "Extract M/W token (default)",
      type: "regex_extract",
      regex: "[MW]\\d{1,2}T?",
      enabled: true,
    },
  ],
  normalizeConfig: { trim: true, upper: true, removeWhitespace: true, commaToDot: true },
  sizeConversionTables: [DEFAULT_MEN_TABLE, DEFAULT_WOMEN_TABLE],
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function safeParse<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

// F3.1: normalize a raw value per the config flags.
export function normalizeValue(
  value: unknown,
  cfg: NormalizeConfig | undefined
): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (cfg?.removeWhitespace) s = s.replace(/\s+/g, "");
  if (cfg?.commaToDot) s = s.replace(/,/g, ".");
  if (cfg?.trim) s = s.trim();
  if (cfg?.upper) s = s.toUpperCase();
  return s;
}

// F3.3: extract gender hint from an ART (poNo) value.
//   "3MH10325626" → "M"
//   "3WH10325626" → "W"
//   Anything else → ""
export function extractGenderFromArt(art: string): Gender {
  const s = String(art || "").trim().toUpperCase();
  const m = s.match(/^(3M|3W)H/);
  if (!m) return "";
  return m[1] === "3M" ? "M" : "W";
}

// F3.4 + F3.5: apply conditional size transformation.
// Falls back to detectGender (model-based) + stechSizeToCanonical /
// fvoSizeToCanonical when no rule matches or lookup misses.
export function applySizeTransform(
  rawSize: string,
  model: string | null,
  artHint: string | null,
  rules: SizeTransformRule[],
  tables: SizeConversionTable[]
): { canonical: string; original: string; fixed: boolean } {
  const original = String(rawSize || "").trim();
  if (!original) return { canonical: "", original: "", fixed: false };

  // Combine gender hints: model-based first, ART-prefix second.
  const genderFromModel = detectGender(model);
  const genderFromArt = artHint ? extractGenderFromArt(artHint) : "";
  const gender: Gender = genderFromModel || genderFromArt || "";

  // F3.5 conditional rules (if_then) — first matching enabled rule wins.
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (rule.type === "if_then" && rule.tableId) {
      const cond = rule.condition || "";
      // Supported condition forms: "gender==M" | "gender==W" | "dataset==ONYX"
      const m = cond.match(/^(\w+)==(\w+)$/);
      if (m) {
        const field = m[1];
        const target = m[2];
        if (field === "gender") {
          if (gender === target) {
            const table = tables.find((t) => t.gender === (target as "M" | "W"));
            if (table) {
              // Try the raw original key (e.g. "M07T")
              const lookupKey = original.toUpperCase();
              if (table.entries[lookupKey] !== undefined) {
                return { canonical: table.entries[lookupKey], original, fixed: false };
              }
              // Try regex extraction first then lookup
              const mMatch = lookupKey.match(/M(\d{1,2})(T)?/);
              if (mMatch && target === "M") {
                const key = `M${mMatch[1].padStart(2, "0")}${mMatch[2] ?? ""}`;
                if (table.entries[key]) return { canonical: table.entries[key], original, fixed: false };
              }
              const wMatch = lookupKey.match(/W(\d{1,2})(T)?/);
              if (wMatch && target === "W") {
                const key = `W${wMatch[1].padStart(2, "0")}${wMatch[2] ?? ""}`;
                if (table.entries[key]) return { canonical: table.entries[key], original, fixed: false };
              }
            }
          }
        }
        // Other condition fields unsupported — skip.
      }
    }
  }

  // F3.3 regex extract: apply the first enabled regex rule.
  const regexRule = rules.find((r) => r.enabled && r.type === "regex_extract");
  const regexPattern = regexRule?.regex || "[MW]\\d{1,2}T?";
  try {
    const re = new RegExp(regexPattern);
    const match = original.toUpperCase().match(re);
    if (match) {
      // Pass the extracted token through the gender-aware canonical helper.
      const token = match[0];
      const fallback = stechSizeToCanonical(token, gender);
      if (fallback) {
        // Detect if we changed anything (e.g. stripped trailing chars).
        const fixed = token.toUpperCase() !== original.toUpperCase();
        return { canonical: fallback, original, fixed };
      }
    }
  } catch {
    /* invalid regex — ignore */
  }

  // No rule matched — use the built-in gender-aware normalizers.
  if (/[MW]\d{1,2}T?/.test(original.toUpperCase())) {
    return { canonical: stechSizeToCanonical(original, gender), original, fixed: false };
  }
  const c = fvoSizeToCanonical(original, gender);
  // If the value contained commas or extra whitespace that we cleaned, mark fixed.
  const fixed = c !== original && c !== "" && Number(c) === Number(original.replace(",", "."));
  return { canonical: c, original, fixed };
}

// ── F1: Column scanning ──────────────────────────────────────────────────────

// Canonical fields exposed on MasterData rows.
const SCAN_FIELDS = [
  "date",
  "shippingStatus",
  "model",
  "sku",
  "poNo",
  "factoryPO",
  "item",
  "season",
  "colorCode",
  "colorCode2",
  "painting",
  "printingColor",
  "size",
  "qty1",
  "qty2",
  "deadline",
  "sourceFile",
  "sheetName",
];

export async function scanColumns(dataset: string): Promise<ColumnProfile[]> {
  const rows = await db.masterData.findMany({
    where: { productType: dataset },
    select: {
      date: true,
      shippingStatus: true,
      model: true,
      sku: true,
      poNo: true,
      factoryPO: true,
      item: true,
      season: true,
      colorCode: true,
      colorCode2: true,
      painting: true,
      printingColor: true,
      size: true,
      qty1: true,
      qty2: true,
      deadline: true,
      sourceFile: true,
      sheetName: true,
    },
    take: 5000, // cap scan for performance
  });

  const total = rows.length;
  if (total === 0) return [];

  const profiles: ColumnProfile[] = [];
  for (const field of SCAN_FIELDS) {
    let empty = 0;
    const uniq = new Set<string>();
    const samples: string[] = [];
    let isNumber = true;
    let isBoolean = true;
    let isDate = true;
    let hasValue = false;
    for (const r of rows) {
      const v = (r as any)[field];
      if (v === null || v === undefined || v === "") {
        empty++;
        continue;
      }
      hasValue = true;
      const sv = String(v);
      uniq.add(sv);
      if (samples.length < 5) samples.push(sv);
      // Type heuristics
      if (isNumber && isNaN(Number(sv))) isNumber = false;
      if (isBoolean && !/^(true|false|yes|no|0|1)$/i.test(sv)) isBoolean = false;
      if (isDate && !/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(sv) && !/^\d{1,2}[-/]\d{1,2}[-/]\d{4}/.test(sv)) {
        isDate = false;
      }
    }
    let type: ColumnProfile["type"] = "string";
    if (!hasValue) type = "empty";
    else if (isNumber) type = "number";
    else if (isBoolean) type = "boolean";
    else if (isDate) type = "date";
    else if (uniq.size > 1) type = "mixed";
    profiles.push({
      field,
      type,
      emptyPct: Math.round((empty / total) * 1000) / 10,
      uniqueCount: uniq.size,
      samples,
      totalCount: total,
    });
  }
  return profiles;
}

// ── F2 + F3: Build composite key ──────────────────────────────────────────────

interface NormalizedRow {
  raw: Record<string, unknown>;
  poNo: string;
  factoryPO: string;
  size: string;
  rawSize: string;
  model: string | null;
  colorCode: string | null;
  deadline: string | null;
  gender: Gender;
  qty: number;
  date: string | null;
  shippingStatus: string | null;
  sizeFixed: boolean;
}

// Normalize a single raw row from a dataset into the canonical form, applying
// all F3 transformations: normalize → cast → size transform (conditional).
function normalizeRow(
  raw: Record<string, unknown>,
  config: ReconciliationConfig,
  side: "source" | "target"
): NormalizedRow | null {
  const norm = config.normalizeConfig ?? { trim: true, upper: true };

  // Read raw fields using side-aware mapping.
  // matchKeyFields are interpreted as the SOURCE's canonical field names.
  // For each canonical name, look up the field mapping whose sourceField
  // equals the canonical name. The source side reads row[sourceField], the
  // target side reads row[targetField]. This way a "swap" mapping
  //   { sourceField: "poNo", targetField: "factoryPO" }
  // correctly matches source.poNo against target.factoryPO.
  function readField(canonical: string): string {
    const m = config.fieldMappings.find((fm) => fm.sourceField === canonical);
    const field = m ? (side === "source" ? m.sourceField : m.targetField) : canonical;
    return normalizeValue(raw[field], norm);
  }

  const poNo = readField("poNo");
  const factoryPO = readField("factoryPO");
  const rawSize = readField("size");
  const modelStr = readField("model");
  const colorCode = readField("colorCode");
  const deadline = readField("deadline");
  const qtyRaw = readField("qty1");
  const dateRaw = readField("date");
  const shipRaw = readField("shippingStatus");

  // Pre-filter (F4): skip rows that don't match the shipping status filter.
  if (config.preFilter.shippingStatus) {
    const bucket = classifyShippingStatus(shipRaw);
    const wantBucket = classifyShippingStatus(config.preFilter.shippingStatus);
    if (bucket !== wantBucket) return null;
  }
  // Pre-filter (F4): date range
  if (config.preFilter.dateFrom || config.preFilter.dateTo) {
    const d = dateRaw || deadline || "";
    if (d) {
      if (config.preFilter.dateFrom && d < config.preFilter.dateFrom) return null;
      if (config.preFilter.dateTo && d > config.preFilter.dateTo) return null;
    }
  }

  // F3.5: conditional size transformation.
  // The ART (e.g. "3MH10325626" or "3WH10246271") lives in different raw fields
  // depending on the dataset: in ONYX_FVO it's `factoryPO`, in ONYX it's `poNo`.
  // After the swap mapping, the CANONICAL `factoryPO` resolves to the ART on
  // both sides — so use that as the gender hint.
  const artHint = factoryPO;

  const { canonical, original, fixed } = applySizeTransform(
    rawSize,
    modelStr || null,
    artHint || null,
    config.sizeTransformRules,
    config.sizeConversionTables ?? [DEFAULT_MEN_TABLE, DEFAULT_WOMEN_TABLE]
  );

  const qty = Number(qtyRaw);
  return {
    raw,
    poNo,
    factoryPO,
    size: canonical,
    rawSize: original,
    model: modelStr || null,
    colorCode: colorCode || null,
    deadline: deadline || null,
    gender: detectGender(modelStr) || extractGenderFromArt(artHint),
    qty: isNaN(qty) ? 0 : qty,
    date: dateRaw || null,
    shippingStatus: shipRaw || null,
    sizeFixed: fixed,
  };
}

// F2/F4: build the composite match key from a normalized row.
// matchKeys are interpreted as canonical field names. Source side reads the
// sourceField from the mapping; target side reads the targetField. Because
// FVO.poNo ↔ Stech.factoryPO is a "swap" mapping, the same canonical key
// position matches across sides correctly.
function buildKey(row: NormalizedRow, matchKeys: string[]): string {
  const parts: string[] = [];
  for (const k of matchKeys) {
    if (k === "poNo") parts.push(row.poNo);
    else if (k === "factoryPO") parts.push(row.factoryPO);
    else if (k === "size") parts.push(row.size);
    else if (k === "model") parts.push(row.model || "");
    else if (k === "colorCode") parts.push(row.colorCode || "");
    else parts.push("");
  }
  return parts.join("|");
}

// ── F4 + F5: Aggregate, match, classify ──────────────────────────────────────

interface AggBucket {
  key: string;
  rows: NormalizedRow[];
  totalQty: number;
  poNo: string;
  factoryPO: string;
  size: string;
  rawSizes: string[];
  model: string | null;
  colorCode: string | null;
  deadline: string | null;
  gender: Gender;
  date: string | null;
  anySizeFixed: boolean;
}

function aggregateRows(
  rows: NormalizedRow[],
  matchKeys: string[]
): Map<string, AggBucket> {
  const map = new Map<string, AggBucket>();
  for (const r of rows) {
    const key = buildKey(r, matchKeys);
    if (!key || key.replace(/\|/g, "").length === 0) continue;
    let entry = map.get(key);
    if (!entry) {
      entry = {
        key,
        rows: [],
        totalQty: 0,
        poNo: r.poNo,
        factoryPO: r.factoryPO,
        size: r.size,
        rawSizes: [],
        model: r.model,
        colorCode: r.colorCode,
        deadline: r.deadline,
        gender: r.gender,
        date: r.date,
        anySizeFixed: false,
      };
      map.set(key, entry);
    }
    entry.rows.push(r);
    entry.totalQty += r.qty;
    if (r.rawSize && !entry.rawSizes.includes(r.rawSize)) entry.rawSizes.push(r.rawSize);
    if (r.sizeFixed) entry.anySizeFixed = true;
  }
  return map;
}

// F4: tolerance check.
function withinTolerance(diff: number, sourceQty: number, targetQty: number, tol: ToleranceConfig): boolean {
  if (tol.type === "absolute") return Math.abs(diff) <= tol.value;
  // percentage relative to max(source, target) — never divide by zero.
  const denom = Math.max(sourceQty, targetQty, 1);
  return (Math.abs(diff) / denom) * 100 <= tol.value;
}

// F5: status engine — classify a single matched/unmatched key.
function classifyStatus(
  src: AggBucket | undefined,
  tgt: AggBucket | undefined,
  tol: ToleranceConfig
): { status: ReconStatus; issues: string[]; matchType: string } {
  const issues: string[] = [];
  if (!src && tgt) {
    return {
      status: "ORPHAN",
      issues: ["ORPHAN: target exists but no source order"],
      matchType: "MISSING_SOURCE",
    };
  }
  if (src && !tgt) {
    return {
      status: "MISSING_OUT",
      issues: ["MISSING_OUT: source order exists but no target output"],
      matchType: "MISSING_TARGET",
    };
  }
  if (!src && !tgt) {
    // Shouldn't happen — return ORPHAN as fallback.
    return { status: "ORPHAN", issues: [], matchType: "NONE" };
  }

  // Both exist.
  const sourceQty = src!.totalQty;
  const targetQty = tgt!.totalQty;
  const diff = sourceQty - targetQty; // positive = source > target
  const matchType = src!.anySizeFixed || tgt!.anySizeFixed ? "TRANSFORMED" : "EXACT";

  // DUP: more than 1 source row collapsing into the same key (only flagged in
  // row_to_row mode; in aggregate mode duplicates are normal).
  // We still flag extreme duplication (>5) as DUP for visibility.
  if (src!.rows.length > 5 || tgt!.rows.length > 5) {
    issues.push(
      `DUP: source has ${src!.rows.length} rows, target has ${tgt!.rows.length} rows collapsed into one key`
    );
    return { status: "DUP", issues, matchType };
  }

  // F3.6 / F5: FMT_FIXED — auto-fixed size format.
  if (src!.anySizeFixed || tgt!.anySizeFixed) {
    issues.push("FMT_FIXED: size format was auto-normalized");
    // Still classify the underlying quantity mismatch below — FMT_FIXED is a
    // secondary tag. We return FMT_FIXED only when the qty matches so it
    // doesn't shadow real mismatches.
    if (withinTolerance(diff, sourceQty, targetQty, tol)) {
      return { status: "FMT_FIXED", issues, matchType };
    }
  }

  // ATTR_MISMATCH: same key (poNo+factoryPO+size) but model or color differ.
  if (
    src!.model && tgt!.model &&
    src!.model.toUpperCase() !== tgt!.model.toUpperCase()
  ) {
    issues.push(
      `ATTR_MISMATCH: source model "${src!.model}" vs target model "${tgt!.model}"`
    );
    return { status: "ATTR_MISMATCH", issues, matchType };
  }
  if (
    src!.colorCode && tgt!.colorCode &&
    src!.colorCode.toUpperCase() !== tgt!.colorCode.toUpperCase()
  ) {
    issues.push(
      `ATTR_MISMATCH: source color "${src!.colorCode}" vs target color "${tgt!.colorCode}"`
    );
    return { status: "ATTR_MISMATCH", issues, matchType };
  }

  // Quantity classification.
  if (withinTolerance(diff, sourceQty, targetQty, tol)) {
    return { status: "MATCHED_OK", issues, matchType };
  }
  if (targetQty < sourceQty) {
    issues.push(`PARTIAL: source=${sourceQty}, target=${targetQty}, missing=${diff}`);
    return { status: "PARTIAL", issues, matchType };
  }
  // targetQty > sourceQty
  issues.push(`OVER: source=${sourceQty}, target=${targetQty}, surplus=${-diff}`);
  return { status: "OVER", issues, matchType };
}

// SUSPECT_PO: helper that flags PO strings differing by exactly 1 char.
// Stricter than a naive all-keys scan: only flags a row as SUSPECT_PO if there
// is an EXISTING OPPOSITE-SIDE row with the same factoryPO + size + gender and
// a poNo that differs from this row's poNo by exactly 1 char.
//
// This avoids false positives where thousands of unrelated POs happen to share
// 1-char near-misses.
function findSuspectPo(
  probeRows: Array<{
    key: string;
    status: ReconStatus;
    sourcePoNo: string;
    targetPoNo: string;
    sourceFactoryPO: string;
    targetFactoryPO: string;
    sourceSize: string;
    targetSize: string;
    sourceGender: Gender;
    targetGender: Gender;
    isMissingSource: boolean;
    isMissingTarget: boolean;
  }>,
  sourceMap: Map<string, AggBucket>,
  targetMap: Map<string, AggBucket>
): Map<string, "SUSPECT_PO"> {
  const flagged = new Map<string, "SUSPECT_PO">();

  // Helper: 1-char Levenshtein distance for equal-length strings.
  function oneCharDiff(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    if (a.length < 4) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) {
        diff++;
        if (diff > 1) return false;
      }
    }
    return diff === 1;
  }

  for (const r of probeRows) {
    if (r.status !== "MISSING_OUT" && r.status !== "ORPHAN") continue;

    if (r.status === "MISSING_OUT") {
      // MISSING_OUT = source has order, target has none.
      // Look for a TARGET row with same factoryPO + size + gender but poNo
      // differing by 1 char.
      const srcPo = r.sourcePoNo.toUpperCase();
      const fpo = r.sourceFactoryPO.toUpperCase();
      const sz = r.sourceSize.toUpperCase();
      const gender = r.sourceGender;
      if (!srcPo || !fpo || !sz) continue;
      for (const tgt of targetMap.values()) {
        if (tgt.factoryPO.toUpperCase() !== fpo) continue;
        if (tgt.size.toUpperCase() !== sz) continue;
        if (tgt.gender !== gender) continue;
        // The target's poNo (after swap mapping) is stored as `poNo` here —
        // but in this canonical view, `poNo` represents the FVO poNo. Compare.
        if (oneCharDiff(srcPo, tgt.poNo.toUpperCase())) {
          flagged.set(r.key, "SUSPECT_PO");
          break;
        }
      }
    } else {
      // ORPHAN = target has output, source has none.
      // Look for a SOURCE row with same factoryPO + size + gender but poNo
      // differing by 1 char.
      const tgtPo = r.targetPoNo.toUpperCase();
      const fpo = r.targetFactoryPO.toUpperCase();
      const sz = r.targetSize.toUpperCase();
      const gender = r.targetGender;
      if (!tgtPo || !fpo || !sz) continue;
      for (const src of sourceMap.values()) {
        if (src.factoryPO.toUpperCase() !== fpo) continue;
        if (src.size.toUpperCase() !== sz) continue;
        if (src.gender !== gender) continue;
        if (oneCharDiff(tgtPo, src.poNo.toUpperCase())) {
          flagged.set(r.key, "SUSPECT_PO");
          break;
        }
      }
    }
  }
  return flagged;
}

// ── Run pipeline ─────────────────────────────────────────────────────────────

export async function runReconciliation(
  config: ReconciliationConfig,
  profile?: { id: string; name: string } | null
): Promise<{ runId: string; summary: ReconciliationSummary }> {
  const startedAt = Date.now();
  const runId = await generateRunId();

  // Create the run record (status=running).
  const run = await db.reconToolRun.create({
    data: {
      runId,
      profileId: profile?.id ?? "adhoc",
      profileName: profile?.name ?? "Ad-hoc",
      sourceDataset: config.sourceDataset,
      targetDataset: config.targetDataset,
      configSnapshot: JSON.stringify(config),
      status: "running",
      startedAt: new Date(),
    },
  });

  try {
    // F1: bulk-load both datasets in parallel.
    const [sourceRowsRaw, targetRowsRaw] = await Promise.all([
      db.masterData.findMany({
        where: { productType: config.sourceDataset },
        select: {
          id: true, date: true, shippingStatus: true, model: true, sku: true,
          poNo: true, factoryPO: true, item: true, season: true,
          colorCode: true, colorCode2: true, painting: true, printingColor: true,
          size: true, qty1: true, qty2: true, deadline: true, sourceFile: true,
          sheetName: true,
        },
      }),
      db.masterData.findMany({
        where: { productType: config.targetDataset },
        select: {
          id: true, date: true, shippingStatus: true, model: true, sku: true,
          poNo: true, factoryPO: true, item: true, season: true,
          colorCode: true, colorCode2: true, painting: true, printingColor: true,
          size: true, qty1: true, qty2: true, deadline: true, sourceFile: true,
          sheetName: true,
        },
      }),
    ]);

    // F3: normalize each row.
    const sourceRows: NormalizedRow[] = [];
    for (const r of sourceRowsRaw) {
      const nr = normalizeRow(r as unknown as Record<string, unknown>, config, "source");
      if (nr) sourceRows.push(nr);
    }
    const targetRows: NormalizedRow[] = [];
    for (const r of targetRowsRaw) {
      const nr = normalizeRow(r as unknown as Record<string, unknown>, config, "target");
      if (nr) targetRows.push(nr);
    }

    // F4: aggregate (aggregate mode is default; row_to_row mode skips aggregation
    // and matches row-by-row on the first row per key — kept simple here).
    const matchKeys = config.matchKeys.length > 0 ? config.matchKeys : ["poNo", "factoryPO", "size"];
    const sourceMap = aggregateRows(sourceRows, matchKeys);
    const targetMap = aggregateRows(targetRows, matchKeys);

    // F5: classify each key.
    const allKeys = new Set<string>([...sourceMap.keys(), ...targetMap.keys()]);
    const results: Array<{
      runId: string;
      key: string;
      sourceData: string;
      targetData: string;
      sourceQty: number;
      targetQty: number;
      difference: number;
      percentage: number;
      status: string;
      issues: string;
      matchType: string | null;
    }> = [];

    const statusCounts: Record<ReconStatus, number> = {
      MATCHED_OK: 0,
      PARTIAL: 0,
      OVER: 0,
      MISSING_OUT: 0,
      ORPHAN: 0,
      DUP: 0,
      ATTR_MISMATCH: 0,
      FMT_FIXED: 0,
      SUSPECT_PO: 0,
    };
    let sourceTotalQty = 0;
    let targetTotalQty = 0;
    let totalDifference = 0;

    // Track for SUSPECT_PO pass.
    const suspectProbe: Array<{
      key: string;
      status: ReconStatus;
      sourcePoNo: string;
      targetPoNo: string;
      sourceFactoryPO: string;
      targetFactoryPO: string;
      sourceSize: string;
      targetSize: string;
      sourceGender: Gender;
      targetGender: Gender;
      isMissingSource: boolean;
      isMissingTarget: boolean;
    }> = [];

    for (const key of allKeys) {
      const src = sourceMap.get(key);
      const tgt = targetMap.get(key);
      const { status, issues, matchType } = classifyStatus(src, tgt, config.tolerance);
      const sourceQty = src?.totalQty ?? 0;
      const targetQty = tgt?.totalQty ?? 0;
      sourceTotalQty += sourceQty;
      targetTotalQty += targetQty;
      totalDifference += sourceQty - targetQty;
      statusCounts[status]++;

      suspectProbe.push({
        key,
        status,
        sourcePoNo: src?.poNo ?? "",
        targetPoNo: tgt?.poNo ?? "",
        sourceFactoryPO: src?.factoryPO ?? "",
        targetFactoryPO: tgt?.factoryPO ?? "",
        sourceSize: src?.size ?? "",
        targetSize: tgt?.size ?? "",
        sourceGender: src?.gender ?? "",
        targetGender: tgt?.gender ?? "",
        isMissingSource: !src,
        isMissingTarget: !tgt,
      });

      const percentage =
        sourceQty > 0
          ? ((sourceQty - targetQty) / sourceQty) * 100
          : targetQty > 0
          ? ((sourceQty - targetQty) / targetQty) * 100
          : 0;

      results.push({
        runId,
        key,
        sourceData: JSON.stringify(src ? {
          poNo: src.poNo,
          factoryPO: src.factoryPO,
          size: src.size,
          rawSize: src.rawSizes[0] ?? "",
          model: src.model,
          colorCode: src.colorCode,
          deadline: src.deadline,
          gender: src.gender,
          rowCount: src.rows.length,
          date: src.date,
        } : {}),
        targetData: JSON.stringify(tgt ? {
          poNo: tgt.poNo,
          factoryPO: tgt.factoryPO,
          size: tgt.size,
          rawSize: tgt.rawSizes[0] ?? "",
          model: tgt.model,
          colorCode: tgt.colorCode,
          deadline: tgt.deadline,
          gender: tgt.gender,
          rowCount: tgt.rows.length,
          date: tgt.date,
        } : {}),
        sourceQty,
        targetQty,
        difference: sourceQty - targetQty,
        percentage: Math.round(percentage * 100) / 100,
        status,
        issues: JSON.stringify(issues),
        matchType,
      });
    }

    // F5 SUSPECT_PO second pass — flag near-miss POs (stricter heuristic).
    const suspectMap = findSuspectPo(suspectProbe, sourceMap, targetMap);
    if (suspectMap.size > 0) {
      for (const r of results) {
        if (suspectMap.has(r.key)) {
          // Downgrade the existing status to SUSPECT_PO (priority over
          // MISSING_OUT / ORPHAN, since this is more actionable).
          if (r.status === "MISSING_OUT" || r.status === "ORPHAN") {
            statusCounts[r.status as ReconStatus]--;
            r.status = "SUSPECT_PO";
            statusCounts.SUSPECT_PO++;
            const issues = safeParse(r.issues, [] as string[]);
            issues.push("SUSPECT_PO: poNo differs from an existing key by 1 char");
            r.issues = JSON.stringify(issues);
          }
        }
      }
    }

    // F6: build chart data + dashboard.
    const chartData = buildDashboardData(results);

    // Persist results (chunked — MongoDB limit safety).
    const CHUNK_SIZE = 500;
    for (let i = 0; i < results.length; i += CHUNK_SIZE) {
      const chunk = results.slice(i, i + CHUNK_SIZE);
      await db.reconToolResult.createMany({ data: chunk as any });
    }

    const totalLines = results.length;
    const matched = statusCounts.MATCHED_OK + statusCounts.FMT_FIXED;
    const matchPercentage = totalLines > 0 ? (matched / totalLines) * 100 : 0;
    const duration = Date.now() - startedAt;

    await db.reconToolRun.update({
      where: { id: run.id },
      data: {
        totalLines,
        matchedOk: statusCounts.MATCHED_OK,
        partial: statusCounts.PARTIAL,
        over: statusCounts.OVER,
        missingOut: statusCounts.MISSING_OUT,
        orphan: statusCounts.ORPHAN,
        dup: statusCounts.DUP,
        attrMismatch: statusCounts.ATTR_MISMATCH,
        fmtFixed: statusCounts.FMT_FIXED,
        suspectPo: statusCounts.SUSPECT_PO,
        sourceTotalQty,
        targetTotalQty,
        totalDifference,
        matchPercentage: Math.round(matchPercentage * 100) / 100,
        chartData: JSON.stringify(chartData),
        status: "completed",
        duration,
        completedAt: new Date(),
      },
    });

    const summary: ReconciliationSummary = {
      runId,
      profileId: profile?.id ?? "adhoc",
      profileName: profile?.name ?? "Ad-hoc",
      sourceDataset: config.sourceDataset,
      targetDataset: config.targetDataset,
      totalLines,
      statusCounts,
      sourceTotalQty,
      targetTotalQty,
      totalDifference,
      matchPercentage: Math.round(matchPercentage * 100) / 100,
      durationMs: duration,
      mode: config.mode,
    };

    return { runId, summary };
  } catch (e: any) {
    await db.reconToolRun.update({
      where: { id: run.id },
      data: { status: "failed", error: e?.message ?? String(e), completedAt: new Date() },
    });
    throw e;
  }
}

// ── F6: Dashboard data ───────────────────────────────────────────────────────

const STATUS_COLORS: Record<ReconStatus, string> = {
  MATCHED_OK: "#10b981", // emerald
  PARTIAL: "#f59e0b",    // amber
  OVER: "#ef4444",       // red
  MISSING_OUT: "#8b5cf6",// violet
  ORPHAN: "#ec4899",     // pink
  DUP: "#eab308",        // yellow
  ATTR_MISMATCH: "#06b6d4", // cyan
  FMT_FIXED: "#3b82f6",  // blue
  SUSPECT_PO: "#f97316", // orange
};

function buildDashboardData(results: Array<{
  status: string;
  sourceData: string;
  targetData: string;
  sourceQty: number;
  targetQty: number;
  difference: number;
  key: string;
}>): DashboardChartData {
  // Donut: status totals.
  const statusTotals: Record<string, number> = {};
  for (const r of results) {
    statusTotals[r.status] = (statusTotals[r.status] || 0) + 1;
  }
  const donut = Object.entries(statusTotals).map(([label, value]) => ({
    label,
    value,
    color: (STATUS_COLORS as Record<string, string>)[label] ?? "#94a3b8",
  }));

  // Stacked bar + heatmap: status × gender.
  const stackedMap = new Map<string, { M: number; W: number; unknown: number }>();
  const heatmapMap = new Map<string, number>();
  for (const r of results) {
    const src = safeParse(r.sourceData, {} as any);
    const tgt = safeParse(r.targetData, {} as any);
    const gender: string = src.gender || tgt.gender || "";
    const bucket = stackedMap.get(r.status) ?? { M: 0, W: 0, unknown: 0 };
    if (gender === "M") bucket.M++;
    else if (gender === "W") bucket.W++;
    else bucket.unknown++;
    stackedMap.set(r.status, bucket);
    const hmKey = `${r.status}|${gender || "unknown"}`;
    heatmapMap.set(hmKey, (heatmapMap.get(hmKey) ?? 0) + 1);
  }
  const stackedBar = Array.from(stackedMap.entries()).map(([label, v]) => ({ label, ...v }));
  const heatmap = Array.from(heatmapMap.entries()).map(([k, value]) => {
    const [status, gender] = k.split("|");
    return { status, gender, value };
  });

  // Top shortage: rows where difference > 0 (source > target) sorted desc.
  const topShortage = results
    .filter((r) => r.difference > 0)
    .sort((a, b) => b.difference - a.difference)
    .slice(0, 10)
    .map((r) => ({ key: r.key, missing: r.difference }));

  // Timeline: bucket by yyyy-mm extracted from source/target date.
  const timelineMap = new Map<string, Map<string, number>>();
  for (const r of results) {
    const src = safeParse(r.sourceData, {} as any);
    const tgt = safeParse(r.targetData, {} as any);
    const dateStr = (src.date || tgt.date || "").toString();
    const m = dateStr.match(/^(\d{4})[-/](\d{1,2})/);
    const bucket = m ? `${m[1]}-${m[2].padStart(2, "0")}` : "unknown";
    if (!timelineMap.has(bucket)) timelineMap.set(bucket, new Map());
    const inner = timelineMap.get(bucket)!;
    inner.set(r.status, (inner.get(r.status) ?? 0) + 1);
  }
  const timeline: Array<{ bucket: string; status: string; value: number }> = [];
  for (const [bucket, inner] of timelineMap) {
    for (const [status, value] of inner) {
      timeline.push({ bucket, status, value });
    }
  }

  return { stackedBar, donut, topShortage, heatmap, timeline };
}

// ── Read results (paginated) ──────────────────────────────────────────────────

export interface ResultFilters {
  status?: string;
  poNo?: string;
  factoryPO?: string;
  size?: string;
  page?: number;
  pageSize?: number;
}

export async function getReconciliationResults(
  runId: string,
  filters?: ResultFilters
): Promise<{ rows: ReconResultRow[]; total: number; summary: ReconciliationSummary | null }> {
  const run = await db.reconToolRun.findUnique({ where: { runId } });
  if (!run) return { rows: [], total: 0, summary: null };

  const where: Record<string, unknown> = { runId };
  if (filters?.status) where.status = filters.status;
  const total = await db.reconToolResult.count({ where: where as any });

  const page = Math.max(1, filters?.page ?? 1);
  const pageSize = Math.min(500, filters?.pageSize ?? 50);
  const skip = (page - 1) * pageSize;

  const dbRows = await db.reconToolResult.findMany({
    where: where as any,
    orderBy: [{ status: "asc" }, { key: "asc" }],
    skip,
    take: pageSize,
  });

  let rows: ReconResultRow[] = dbRows.map(materializeResult);
  if (filters?.poNo) {
    const q = filters.poNo.toUpperCase();
    rows = rows.filter((r) => (r.sourceData.poNo || r.targetData.poNo || "").toUpperCase().includes(q));
  }
  if (filters?.factoryPO) {
    const q = filters.factoryPO.toUpperCase();
    rows = rows.filter((r) => (r.sourceData.factoryPO || r.targetData.factoryPO || "").toUpperCase().includes(q));
  }
  if (filters?.size) {
    const q = filters.size.toUpperCase();
    rows = rows.filter((r) => (r.sourceData.size || r.targetData.size || "").toUpperCase().includes(q));
  }

  const summary: ReconciliationSummary = {
    runId: run.runId,
    profileId: run.profileId,
    profileName: run.profileName,
    sourceDataset: run.sourceDataset,
    targetDataset: run.targetDataset,
    totalLines: run.totalLines,
    statusCounts: {
      MATCHED_OK: run.matchedOk,
      PARTIAL: run.partial,
      OVER: run.over,
      MISSING_OUT: run.missingOut,
      ORPHAN: run.orphan,
      DUP: run.dup,
      ATTR_MISMATCH: run.attrMismatch,
      FMT_FIXED: run.fmtFixed,
      SUSPECT_PO: run.suspectPo,
    },
    sourceTotalQty: run.sourceTotalQty,
    targetTotalQty: run.targetTotalQty,
    totalDifference: run.totalDifference,
    matchPercentage: run.matchPercentage,
    durationMs: run.duration ?? 0,
    mode: "aggregate",
  };

  return { rows, total, summary };
}

function materializeResult(r: any): ReconResultRow {
  return {
    id: r.id,
    runId: r.runId,
    key: r.key,
    sourceData: safeParse(r.sourceData, {
      poNo: "", factoryPO: "", size: "", rawSize: "",
      model: null, colorCode: null, deadline: null,
      gender: "" as Gender, rowCount: 0, date: null,
    }),
    targetData: safeParse(r.targetData, {
      poNo: "", factoryPO: "", size: "", rawSize: "",
      model: null, colorCode: null, deadline: null,
      gender: "" as Gender, rowCount: 0, date: null,
    }),
    sourceQty: r.sourceQty ?? 0,
    targetQty: r.targetQty ?? 0,
    difference: r.difference ?? 0,
    percentage: r.percentage ?? 0,
    status: r.status as ReconStatus,
    issues: safeParse(r.issues, [] as string[]),
    matchType: r.matchType ?? null,
    createdAt: r.createdAt,
  };
}

// ── Profile CRUD helpers ──────────────────────────────────────────────────────

export function serializeConfig(config: ReconciliationConfig) {
  return {
    fieldMappings: JSON.stringify(config.fieldMappings),
    matchKeys: JSON.stringify(config.matchKeys),
    statusMapping: JSON.stringify(config.statusMapping),
    tolerance: JSON.stringify(config.tolerance),
    mode: config.mode,
    preFilter: JSON.stringify(config.preFilter),
    sizeTransformRules: JSON.stringify(config.sizeTransformRules),
    normalizeConfig: JSON.stringify(config.normalizeConfig ?? {}),
  };
}

export function parseProfileConfig(profile: any): ReconciliationConfig {
  return {
    sourceDataset: profile.sourceDataset,
    targetDataset: profile.targetDataset,
    fieldMappings: safeParse(profile.fieldMappings, []),
    matchKeys: safeParse(profile.matchKeys, []),
    statusMapping: safeParse(profile.statusMapping, {}),
    tolerance: safeParse(profile.tolerance, { type: "absolute", value: 0 }),
    mode: (profile.mode as "row_to_row" | "aggregate") ?? "aggregate",
    preFilter: safeParse(profile.preFilter, {}),
    sizeTransformRules: safeParse(profile.sizeTransformRules, []),
    normalizeConfig: safeParse(profile.normalizeConfig, {}),
    sizeConversionTables: [DEFAULT_MEN_TABLE, DEFAULT_WOMEN_TABLE],
  };
}

// ── Run ID generator ─────────────────────────────────────────────────────────

async function generateRunId(): Promise<string> {
  const today = new Date();
  const ymd =
    today.getFullYear().toString() +
    String(today.getMonth() + 1).padStart(2, "0") +
    String(today.getDate()).padStart(2, "0");
  const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const count = await db.reconToolRun.count({
    where: { createdAt: { gte: startOfDay, lt: endOfDay } },
  });
  const seq = String(count + 1).padStart(3, "0");
  return `RT-${ymd}-${seq}`;
}

// ── Seed default profile ──────────────────────────────────────────────────────

export async function ensureDefaultProfileSeeded(): Promise<void> {
  const existing = await db.reconToolProfile.findUnique({
    where: { name: DEFAULT_PROFILE_NAME },
  });
  if (existing) return;
  const s = serializeConfig(DEFAULT_RECON_PROFILE);
  await db.reconToolProfile.create({
    data: {
      name: DEFAULT_PROFILE_NAME,
      description: "Default: ONYX_FVO vs ONYX reconciliation (spec F1–F9)",
      sourceDataset: DEFAULT_RECON_PROFILE.sourceDataset,
      targetDataset: DEFAULT_RECON_PROFILE.targetDataset,
      fieldMappings: s.fieldMappings,
      matchKeys: s.matchKeys,
      statusMapping: s.statusMapping,
      tolerance: s.tolerance,
      mode: s.mode,
      preFilter: s.preFilter,
      sizeTransformRules: s.sizeTransformRules,
      normalizeConfig: s.normalizeConfig,
      active: true,
    },
  });
}

export const DEFAULT_PROFILE_NAME = "ONYX_FVO_VS_ONYX_DEFAULT";
