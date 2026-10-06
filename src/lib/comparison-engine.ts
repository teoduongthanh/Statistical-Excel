// Comparison Engine — Dynamic data relationship & comparison studio (spec 85 sections)
//
// Compares two datasets (MasterData filtered by productType) by:
//   1. Loading all rows for source + target datasets (no per-row queries — spec §50).
//   2. Normalizing fields (trim, uppercase, remove line breaks — spec §10).
//   3. Applying transformations (size normalization — spec §11, §12).
//   4. Building a composite key from matchKeyFields config (spec §13).
//   5. Aggregating by composite key (SUM qty — spec §20).
//   6. Matching source ↔ target by composite key.
//   7. Computing comparison metrics (Difference, Percentage — spec §21-24).
//   8. Applying rules to determine status (spec §26-28):
//        MATCHED | QTY_MISMATCH | MISSING_SOURCE | MISSING_TARGET | AMBIGUOUS | OVERAGE | SHORTAGE
//   9. Persisting ComparisonRun + ComparisonResult rows.
//
// READ-ONLY (spec §62): never modifies source data.
// Dynamic: no hard-coded dataset pairs — any productType can be source or target.
//
// Size normalization reuses the existing helpers from fvo-stech-tracking-service.ts
// (detectGender + stechSizeToCanonical + fvoSizeToCanonical — T suffix = +0.5).

import { db } from "./db";
import { classifyShippingStatus } from "./quantity-service";
import {
  detectGender,
  stechSizeToCanonical,
  fvoSizeToCanonical,
  type Gender,
} from "./fvo-stech-tracking-service";

// ── Types (mirror Prisma JSON columns) ──────────────────────────────────────

export type FieldMappingType = "EXACT" | "NORMALIZED" | "TRANSFORMED" | "COMPARE";

export interface FieldMapping {
  sourceField: string;
  targetField: string;
  type: FieldMappingType;
  transformRule?: string;
}

export interface AggregationConfig {
  qtyField?: string; // default "qty1"
  method?: "SUM" | "MAX" | "MIN" | "AVG"; // default "SUM"
  statusFilter?: string; // optional: only aggregate rows whose shippingStatus maps to this bucket ("order" | "output" | "input" | "pending")
}

export interface MetricConfig {
  type: "DIFFERENCE" | "PERCENTAGE" | "RATIO";
  direction?: "SOURCE_MINUS_TARGET" | "TARGET_MINUS_SOURCE" | "ABSOLUTE";
}

export interface RuleConfig {
  condition: string; // e.g. "difference === 0", "missingSource", "difference < 0"
  status: string;
  priority: number;
}

export type ComparisonMode = "STRICT" | "BALANCED" | "SMART";

export interface ComparisonProfileConfig {
  name: string;
  description?: string;
  sourceDataset: string;
  targetDataset: string;
  statusMapping?: Record<string, string>;
  matchKeyFields?: string[];
  fieldMappings?: FieldMapping[];
  aggregationConfig?: AggregationConfig;
  metrics?: MetricConfig[];
  rules?: RuleConfig[];
  mode?: ComparisonMode;
  version?: number;
}

export interface RunFilters {
  dateFrom?: string; // yyyy-MM-dd
  dateTo?: string;
  poNo?: string;
  factoryPO?: string;
}

export interface ResultFilters {
  status?: string;
  poNo?: string;
  factoryPO?: string;
  size?: string;
  page?: number;
  pageSize?: number;
}

// ── Default profile (spec §66 / task description) ────────────────────────────

export const DEFAULT_PROFILE: ComparisonProfileConfig = {
  name: "ONYX_STECH_VS_FVO",
  description: "Default: ONYX STECH vs ONYX FVO comparison",
  sourceDataset: "ONYX",
  targetDataset: "ONYX_FVO",
  statusMapping: { "2.Output": "4.Input" },
  matchKeyFields: ["poNo", "factoryPO", "size"],
  fieldMappings: [
    { sourceField: "poNo", targetField: "poNo", type: "EXACT" },
    { sourceField: "factoryPO", targetField: "factoryPO", type: "EXACT" },
    { sourceField: "size", targetField: "size", type: "NORMALIZED" },
    { sourceField: "qty1", targetField: "qty1", type: "COMPARE" },
  ],
  aggregationConfig: { qtyField: "qty1", method: "SUM" },
  metrics: [
    { type: "DIFFERENCE", direction: "SOURCE_MINUS_TARGET" },
    { type: "PERCENTAGE" },
  ],
  rules: [
    { condition: "difference === 0", status: "MATCHED", priority: 1 },
    { condition: "missingTarget", status: "MISSING_TARGET", priority: 2 },
    { condition: "missingSource", status: "MISSING_SOURCE", priority: 3 },
    { condition: "difference < 0", status: "SHORTAGE", priority: 4 },
    { condition: "difference > 0", status: "OVERAGE", priority: 5 },
  ],
  mode: "SMART",
  version: 1,
};

// ── Helpers ─────────────────────────────────────────────────────────────────

// Spec §10: normalize a field value — trim, uppercase, remove line breaks.
export function normalizeField(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/[\r\n]+/g, " ")
    .trim()
    .toUpperCase();
}

// Spec §11/§12: apply transformations per field mapping type.
// - EXACT: identity (after normalize).
// - NORMALIZED: for size fields — use gender-aware canonical normalization.
// - TRANSFORMED: reserved for future rules — apply transformRule if present.
// - COMPARE: same as EXACT for key purposes; flagged for comparison metric use.
export function applyTransform(
  field: string,
  rawValue: unknown,
  mappingType: FieldMappingType,
  transformRule: string | undefined,
  gender: Gender
): string {
  const norm = normalizeField(rawValue);
  if (field === "size" || mappingType === "NORMALIZED") {
    if (!norm) return "";
    // Heuristic: ONYX (STECH) sizes look like "M07/W08T"; ONYX_FVO sizes are plain numbers.
    if (/[MW]\d{1,2}T?/.test(norm)) {
      return stechSizeToCanonical(norm, gender);
    }
    return fvoSizeToCanonical(norm, gender);
  }
  if (mappingType === "TRANSFORMED" && transformRule) {
    // Reserved for future transforms (e.g. substring, regex). Best-effort:
    try {
      if (transformRule.startsWith("prefix:")) return transformRule.slice(7) + norm;
      if (transformRule.startsWith("suffix:")) return norm + transformRule.slice(7);
    } catch {
      /* ignore */
    }
  }
  return norm;
}

// Build the composite key from a row using matchKeyFields + fieldMappings.
// `side` indicates which side of the mapping to read from:
//   - "source": reads row[mapping.sourceField] (or row[canonicalName] if no mapping)
//   - "target": reads row[mapping.targetField]   (or row[canonicalName] if no mapping)
//
// matchKeyFields are interpreted as SOURCE field names (canonical names). For
// each canonical name (e.g. "poNo"), the engine looks up the field mapping whose
// sourceField equals the canonical name. The source side reads row[sourceField],
// the target side reads row[targetField]. This way a single mapping
//   { sourceField: "poNo", targetField: "factoryPO", type: "EXACT" }
// causes source.poNo and target.factoryPO to share the same canonical key
// position — i.e. a "swap" mapping is supported cleanly.
export function buildCompositeKey(
  row: Record<string, unknown>,
  matchKeyFields: string[],
  fieldMappings: FieldMapping[],
  gender: Gender,
  side: "source" | "target" = "source"
): string {
  const parts: string[] = [];
  for (const f of matchKeyFields) {
    // Find the mapping whose sourceField is the canonical name.
    const mapping = fieldMappings.find((m) => m.sourceField === f);
    const fieldName = mapping
      ? (side === "source" ? mapping.sourceField : mapping.targetField)
      : f;
    const mappingType = mapping?.type ?? "EXACT";
    const transformRule = mapping?.transformRule;
    const v = applyTransform(fieldName, row[fieldName], mappingType, transformRule, gender);
    parts.push(v);
  }
  return parts.join("|");
}

// Aggregate rows by composite key. Spec §20: SUM qty (or MAX/MIN/AVG).
interface AggBucket {
  key: string;
  rows: Record<string, unknown>[];
  totalQty: number;
  model: string | null;
  colorCode: string | null;
  deadline: string | null;
  gender: Gender;
  size: string; // canonical size if size is part of the key
  poNo: string;
  factoryPO: string;
  rawSizes: string[];
}

function aggregateRows(
  rows: Record<string, unknown>[],
  matchKeyFields: string[],
  fieldMappings: FieldMapping[],
  aggConfig: AggregationConfig,
  side: "source" | "target"
): Map<string, AggBucket> {
  const qtyField = aggConfig.qtyField || "qty1";
  const method = aggConfig.method || "SUM";
  const statusFilter = aggConfig.statusFilter;
  const map = new Map<string, AggBucket>();

  for (const r of rows) {
    // Optional status filter
    if (statusFilter) {
      const bucket = classifyShippingStatus(String(r.shippingStatus ?? ""));
      if (bucket !== statusFilter) continue;
    }

    const gender = detectGender(String(r.model ?? ""));
    const key = buildCompositeKey(r, matchKeyFields, fieldMappings, gender, side);
    if (!key || key.replace(/\|/g, "").length === 0) continue;

    let entry = map.get(key);
    if (!entry) {
      entry = {
        key,
        rows: [],
        totalQty: 0,
        model: (r.model as string) ?? null,
        colorCode: (r.colorCode as string) ?? null,
        deadline: (r.deadline as string) ?? null,
        gender,
        size: String(r.size ?? ""),
        poNo: String(r.poNo ?? ""),
        factoryPO: String(r.factoryPO ?? ""),
        rawSizes: [],
      };
      map.set(key, entry);
    }

    entry.rows.push(r);
    const rawQty = Number(r[qtyField]);
    const qty = isNaN(rawQty) ? 0 : rawQty;

    if (method === "SUM") entry.totalQty += qty;
    else if (method === "MAX") entry.totalQty = Math.max(entry.totalQty, qty);
    else if (method === "MIN") entry.totalQty = entry.totalQty === 0 ? qty : Math.min(entry.totalQty, qty);
    else if (method === "AVG") entry.totalQty += qty; // average computed below

    const rawSize = String(r.size ?? "");
    if (rawSize && !entry.rawSizes.includes(rawSize)) entry.rawSizes.push(rawSize);
  }

  if (method === "AVG") {
    for (const entry of map.values()) {
      const n = entry.rows.length || 1;
      entry.totalQty = Math.round(entry.totalQty / n);
    }
  }

  return map;
}

// Load rows for a dataset (productType filter) with optional date range filter.
async function loadDatasetRows(
  productType: string,
  filters?: RunFilters
): Promise<Record<string, unknown>[]> {
  const where: Record<string, unknown> = { productType };
  if (filters?.dateFrom || filters?.dateTo) {
    const dateFilter: Record<string, string> = {};
    if (filters.dateFrom) dateFilter.gte = filters.dateFrom;
    if (filters.dateTo) dateFilter.lte = filters.dateTo;
    where.date = dateFilter;
  }
  if (filters?.poNo) where.poNo = { contains: filters.poNo };
  if (filters?.factoryPO) where.factoryPO = { contains: filters.factoryPO };

  const rows = await db.masterData.findMany({
    where: where as any,
    select: {
      id: true,
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
      productType: true,
      sourceFile: true,
      sheetName: true,
      rowIndex: true,
    },
  });
  // Prisma returns objects with possibly null fields — keep as-is.
  return rows as unknown as Record<string, unknown>[];
}

// ── Rule evaluation (spec §26-28) ───────────────────────────────────────────

// Evaluates a single rule condition against a result row.
// Supported conditions:
//   - "difference === 0"
//   - "difference !== 0"
//   - "difference < 0"
//   - "difference > 0"
//   - "missingSource"  (no source rows for this key)
//   - "missingTarget"  (no target rows for this key)
//   - "ambiguous"      (multiple source OR multiple target rows)
//   - "percentage > N" / "percentage < N"
//   - "always"         (catch-all)
function evalCondition(condition: string, ctx: {
  difference: number;
  percentage: number;
  missingSource: boolean;
  missingTarget: boolean;
  ambiguous: boolean;
}): boolean {
  const c = condition.trim();
  if (c === "always") return true;
  if (c === "missingSource") return ctx.missingSource;
  if (c === "missingTarget") return ctx.missingTarget;
  if (c === "ambiguous") return ctx.ambiguous;
  // Numeric comparisons
  const m = c.match(/^(difference|percentage)\s*(===|!==|>=|<=|>|<)\s*(-?\d+(?:\.\d+)?)$/);
  if (m) {
    const field = m[1] as "difference" | "percentage";
    const op = m[2];
    const threshold = Number(m[3]);
    const v = ctx[field];
    switch (op) {
      case "===": return v === threshold;
      case "!==": return v !== threshold;
      case ">=": return v >= threshold;
      case "<=": return v <= threshold;
      case ">": return v > threshold;
      case "<": return v < threshold;
    }
  }
  return false;
}

// Apply rules in priority order; first match wins.
function applyRules(rules: RuleConfig[], ctx: {
  difference: number;
  percentage: number;
  missingSource: boolean;
  missingTarget: boolean;
  ambiguous: boolean;
}): { status: string; matchedRule: RuleConfig | null } {
  const sorted = [...rules].sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
  for (const rule of sorted) {
    if (evalCondition(rule.condition, ctx)) {
      return { status: rule.status, matchedRule: rule };
    }
  }
  return { status: "QTY_MISMATCH", matchedRule: null };
}

// ── Main: run a comparison ──────────────────────────────────────────────────

export async function runComparison(
  profileId: string,
  filters?: RunFilters
): Promise<{ runId: string; summary: ComparisonRunSummary }> {
  const profile = await db.comparisonProfile.findUnique({ where: { id: profileId } });
  if (!profile) throw new Error(`Comparison profile not found: ${profileId}`);

  const config = parseProfileConfig(profile);
  const startedAt = Date.now();

  // Create run record (runId auto-generated after we know the next number)
  const runId = await generateRunId();
  const run = await db.comparisonRun.create({
    data: {
      runId,
      profileId: profile.id,
      profileName: profile.name,
      profileVersion: profile.version,
      sourceDataset: profile.sourceDataset,
      targetDataset: profile.targetDataset,
      filters: JSON.stringify(filters ?? {}),
      status: "running",
      startedAt: new Date(),
    },
  });

  try {
    // 1. Load source + target rows in parallel (spec §50: bulk load).
    const [sourceRows, targetRows] = await Promise.all([
      loadDatasetRows(profile.sourceDataset, filters),
      loadDatasetRows(profile.targetDataset, filters),
    ]);

    // 2. Aggregate by composite key
    const matchKeyFields = config.matchKeyFields ?? ["poNo", "factoryPO", "size"];
    const fieldMappings = config.fieldMappings ?? [];
    const aggConfig = config.aggregationConfig ?? { qtyField: "qty1", method: "SUM" };

    const sourceMap = aggregateRows(sourceRows, matchKeyFields, fieldMappings, aggConfig, "source");
    const targetMap = aggregateRows(targetRows, matchKeyFields, fieldMappings, aggConfig, "target");

    // 3. Merge all keys
    const allKeys = new Set<string>([...sourceMap.keys(), ...targetMap.keys()]);

    // 4. Build comparison result rows
    const metrics = config.metrics ?? [
      { type: "DIFFERENCE", direction: "SOURCE_MINUS_TARGET" },
      { type: "PERCENTAGE" },
    ];
    const rules = config.rules ?? [];
    const mode = config.mode ?? "SMART";

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
      matchType: string;
      sourceRowRefs: string;
      targetRowRefs: string;
    }> = [];

    let matchedCount = 0;
    let mismatchCount = 0;
    let missingSourceCount = 0;
    let missingTargetCount = 0;
    let ambiguousCount = 0;
    let shortageCount = 0;
    let overageCount = 0;
    let sourceTotalQty = 0;
    let targetTotalQty = 0;
    let totalDifference = 0;

    for (const key of allKeys) {
      const src = sourceMap.get(key);
      const tgt = targetMap.get(key);
      const sourceQty = src?.totalQty ?? 0;
      const targetQty = tgt?.totalQty ?? 0;
      sourceTotalQty += sourceQty;
      targetTotalQty += targetQty;

      // Compute metrics
      const diffMetric = metrics.find((m) => m.type === "DIFFERENCE");
      const direction = diffMetric?.direction ?? "SOURCE_MINUS_TARGET";
      const difference =
        direction === "TARGET_MINUS_SOURCE"
          ? targetQty - sourceQty
          : direction === "ABSOLUTE"
          ? Math.abs(sourceQty - targetQty)
          : sourceQty - targetQty; // SOURCE_MINUS_TARGET
      totalDifference += difference;

      const pctMetric = metrics.find((m) => m.type === "PERCENTAGE");
      const percentage =
        pctMetric && sourceQty > 0
          ? (difference / sourceQty) * 100
          : pctMetric && targetQty > 0
          ? (difference / targetQty) * 100
          : 0;

      const isMissingSource = !src;
      const isMissingTarget = !tgt;
      // Ambiguous: more than 5 source or target rows collapse into one key (rough heuristic)
      const isAmbiguous =
        (src ? src.rows.length : 0) > 5 || (tgt ? tgt.rows.length : 0) > 5;

      // Issues array
      const issues: string[] = [];
      if (isMissingSource) issues.push("MISSING_SOURCE");
      if (isMissingTarget) issues.push("MISSING_TARGET");
      if (isAmbiguous) issues.push("AMBIGUOUS_MATCH");
      if (!isMissingSource && !isMissingTarget && difference !== 0) {
        issues.push(
          `QTY_MISMATCH (src=${sourceQty}, tgt=${targetQty}, diff=${difference})`
        );
      }

      // Apply rules to determine status
      const { status } = applyRules(rules, {
        difference,
        percentage,
        missingSource: isMissingSource,
        missingTarget: isMissingTarget,
        ambiguous: isAmbiguous,
      });

      // Tally
      if (status === "MATCHED") matchedCount++;
      else if (status === "MISSING_SOURCE") missingSourceCount++;
      else if (status === "MISSING_TARGET") missingTargetCount++;
      else if (status === "AMBIGUOUS") ambiguousCount++;
      else if (status === "SHORTAGE") shortageCount++;
      else if (status === "OVERAGE") overageCount++;
      else mismatchCount++; // unknown status falls back to mismatch

      // Match type (best-effort)
      const matchType = isMissingSource
        ? "MISSING_SOURCE"
        : isMissingTarget
        ? "MISSING_TARGET"
        : (() => {
            const sizeMapping = fieldMappings.find((m) => m.sourceField === "size");
            if (sizeMapping?.type === "NORMALIZED") return "NORMALIZED";
            if (sizeMapping?.type === "TRANSFORMED") return "TRANSFORMED";
            return "EXACT";
          })();

      results.push({
        runId,
        key,
        sourceData: JSON.stringify(src ? {
          poNo: src.poNo,
          factoryPO: src.factoryPO,
          size: src.size,
          model: src.model,
          colorCode: src.colorCode,
          deadline: src.deadline,
          gender: src.gender,
          rowCount: src.rows.length,
          rawSizes: src.rawSizes,
        } : {}),
        targetData: JSON.stringify(tgt ? {
          poNo: tgt.poNo,
          factoryPO: tgt.factoryPO,
          size: tgt.size,
          model: tgt.model,
          colorCode: tgt.colorCode,
          deadline: tgt.deadline,
          gender: tgt.gender,
          rowCount: tgt.rows.length,
          rawSizes: tgt.rawSizes,
        } : {}),
        sourceQty,
        targetQty,
        difference,
        percentage: Math.round(percentage * 100) / 100,
        status,
        issues: JSON.stringify(issues),
        matchType,
        sourceRowRefs: JSON.stringify((src?.rows ?? []).map((r) => String(r.id ?? ""))),
        targetRowRefs: JSON.stringify((tgt?.rows ?? []).map((r) => String(r.id ?? ""))),
      });
    }

    // 5. Bulk-write results (chunk to avoid MongoDB limits)
    const CHUNK_SIZE = 500;
    for (let i = 0; i < results.length; i += CHUNK_SIZE) {
      const chunk = results.slice(i, i + CHUNK_SIZE);
      await db.comparisonResult.createMany({ data: chunk });
    }

    // 6. Update run with summary
    const totalCompared = results.length;
    const matchPercentage = totalCompared > 0 ? (matchedCount / totalCompared) * 100 : 0;
    const duration = Date.now() - startedAt;

    await db.comparisonRun.update({
      where: { id: run.id },
      data: {
        totalCompared,
        matchedCount,
        mismatchCount,
        missingSource: missingSourceCount,
        missingTarget: missingTargetCount,
        ambiguousCount,
        shortageCount,
        overageCount,
        sourceTotalQty,
        targetTotalQty,
        totalDifference,
        matchPercentage: Math.round(matchPercentage * 100) / 100,
        status: "completed",
        duration,
        completedAt: new Date(),
      },
    });

    const summary: ComparisonRunSummary = {
      runId,
      profileId: profile.id,
      profileName: profile.name,
      sourceDataset: profile.sourceDataset,
      targetDataset: profile.targetDataset,
      totalCompared,
      matchedCount,
      mismatchCount,
      missingSource: missingSourceCount,
      missingTarget: missingTargetCount,
      ambiguousCount,
      shortageCount,
      overageCount,
      sourceTotalQty,
      targetTotalQty,
      totalDifference,
      matchPercentage: Math.round(matchPercentage * 100) / 100,
      duration,
      mode,
    };

    return { runId, summary };
  } catch (e: any) {
    // Mark run as failed
    await db.comparisonRun.update({
      where: { id: run.id },
      data: { status: "failed", error: e?.message ?? String(e), completedAt: new Date() },
    });
    throw e;
  }
}

export interface ComparisonRunSummary {
  runId: string;
  profileId: string;
  profileName: string;
  sourceDataset: string;
  targetDataset: string;
  totalCompared: number;
  matchedCount: number;
  mismatchCount: number;
  missingSource: number;
  missingTarget: number;
  ambiguousCount: number;
  shortageCount: number;
  overageCount: number;
  sourceTotalQty: number;
  targetTotalQty: number;
  totalDifference: number;
  matchPercentage: number;
  duration: number;
  mode: string;
}

// ── Get results (paginated) ────────────────────────────────────────────────

export async function getComparisonResults(
  runId: string,
  filters?: ResultFilters
): Promise<{
  rows: Array<ComparisonResultRow>;
  total: number;
  summary: ComparisonRunSummary | null;
}> {
  const run = await db.comparisonRun.findUnique({ where: { runId } });
  if (!run) {
    return { rows: [], total: 0, summary: null };
  }

  // Build where clause
  const where: Record<string, unknown> = { runId };
  if (filters?.status) where.status = filters.status;

  // Get total
  const total = await db.comparisonResult.count({ where: where as any });

  // Fetch page
  const page = Math.max(1, filters?.page ?? 1);
  const pageSize = Math.min(500, filters?.pageSize ?? 50);
  const skip = (page - 1) * pageSize;

  const dbRows = await db.comparisonResult.findMany({
    where: where as any,
    orderBy: [{ status: "asc" }, { key: "asc" }],
    skip,
    take: pageSize,
  });

  // Materialize + apply client-side filters (poNo / factoryPO / size)
  let rows: ComparisonResultRow[] = dbRows.map((r) => materializeResult(r));
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

  const summary: ComparisonRunSummary = {
    runId: run.runId,
    profileId: run.profileId,
    profileName: run.profileName,
    sourceDataset: run.sourceDataset,
    targetDataset: run.targetDataset,
    totalCompared: run.totalCompared,
    matchedCount: run.matchedCount,
    mismatchCount: run.mismatchCount,
    missingSource: run.missingSource,
    missingTarget: run.missingTarget,
    ambiguousCount: run.ambiguousCount,
    shortageCount: run.shortageCount,
    overageCount: run.overageCount,
    sourceTotalQty: run.sourceTotalQty,
    targetTotalQty: run.targetTotalQty,
    totalDifference: run.totalDifference,
    matchPercentage: run.matchPercentage,
    duration: run.duration ?? 0,
    mode: "SMART",
  };

  return { rows, total, summary };
}

export interface ComparisonResultRow {
  id: string;
  runId: string;
  key: string;
  sourceData: {
    poNo: string;
    factoryPO: string;
    size: string;
    model: string | null;
    colorCode: string | null;
    deadline: string | null;
    gender: Gender;
    rowCount: number;
    rawSizes: string[];
  };
  targetData: {
    poNo: string;
    factoryPO: string;
    size: string;
    model: string | null;
    colorCode: string | null;
    deadline: string | null;
    gender: Gender;
    rowCount: number;
    rawSizes: string[];
  };
  sourceQty: number;
  targetQty: number;
  difference: number;
  percentage: number;
  status: string;
  issues: string[];
  matchType: string | null;
  sourceRowRefs: string[];
  targetRowRefs: string[];
  createdAt: Date;
}

function materializeResult(r: any): ComparisonResultRow {
  return {
    id: r.id,
    runId: r.runId,
    key: r.key,
    sourceData: safeParse(r.sourceData, {}),
    targetData: safeParse(r.targetData, {}),
    sourceQty: r.sourceQty ?? 0,
    targetQty: r.targetQty ?? 0,
    difference: r.difference ?? 0,
    percentage: r.percentage ?? 0,
    status: r.status,
    issues: safeParse(r.issues, []),
    matchType: r.matchType ?? null,
    sourceRowRefs: safeParse(r.sourceRowRefs, []),
    targetRowRefs: safeParse(r.targetRowRefs, []),
    createdAt: r.createdAt,
  };
}

function safeParse<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

// ── Parse stored profile JSON into config ──────────────────────────────────

export function parseProfileConfig(profile: any): ComparisonProfileConfig {
  return {
    name: profile.name,
    description: profile.description ?? undefined,
    sourceDataset: profile.sourceDataset,
    targetDataset: profile.targetDataset,
    statusMapping: safeParse(profile.statusMapping, {}),
    matchKeyFields: safeParse(profile.matchKeyFields, []),
    fieldMappings: safeParse(profile.fieldMappings, []),
    aggregationConfig: safeParse(profile.aggregationConfig, {}),
    metrics: safeParse(profile.metrics, []),
    rules: safeParse(profile.rules, []),
    mode: profile.mode ?? "SMART",
    version: profile.version ?? 1,
  };
}

// ── Run ID generator ───────────────────────────────────────────────────────

async function generateRunId(): Promise<string> {
  // Format: CMP-YYYYMMDD-NNN
  const today = new Date();
  const ymd =
    today.getFullYear().toString() +
    String(today.getMonth() + 1).padStart(2, "0") +
    String(today.getDate()).padStart(2, "0");
  // Count today's runs
  const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const count = await db.comparisonRun.count({
    where: { createdAt: { gte: startOfDay, lt: endOfDay } },
  });
  const seq = String(count + 1).padStart(3, "0");
  return `CMP-${ymd}-${seq}`;
}

// ── Seed default profile if none exists ─────────────────────────────────────

export async function ensureDefaultProfileSeeded(): Promise<void> {
  const existing = await db.comparisonProfile.findUnique({
    where: { name: DEFAULT_PROFILE.name },
  });
  if (!existing) {
    await db.comparisonProfile.create({
      data: {
        name: DEFAULT_PROFILE.name,
        description: DEFAULT_PROFILE.description ?? null,
        sourceDataset: DEFAULT_PROFILE.sourceDataset,
        targetDataset: DEFAULT_PROFILE.targetDataset,
        statusMapping: JSON.stringify(DEFAULT_PROFILE.statusMapping ?? {}),
        matchKeyFields: JSON.stringify(DEFAULT_PROFILE.matchKeyFields ?? []),
        fieldMappings: JSON.stringify(DEFAULT_PROFILE.fieldMappings ?? []),
        aggregationConfig: JSON.stringify(DEFAULT_PROFILE.aggregationConfig ?? {}),
        metrics: JSON.stringify(DEFAULT_PROFILE.metrics ?? []),
        rules: JSON.stringify(DEFAULT_PROFILE.rules ?? []),
        mode: DEFAULT_PROFILE.mode ?? "SMART",
        version: DEFAULT_PROFILE.version ?? 1,
        active: true,
      },
    });
  }
}
