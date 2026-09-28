// ProductionAggregationService
// Groups MasterData rows by composite keys (Product + PO + Factory PO + Size, etc.)
// and runs Order/Output/Pending/Input aggregation.
//
// All queries are product-scoped: the productType parameter is MANDATORY and applied
// as a Prisma `where` filter to guarantee product isolation (spec §51).
//
// MongoDB-compatible: uses Prisma's standard query API (findMany / groupBy / count)
// instead of raw SQL. Filtering on shipping-status buckets is performed in JS via
// `classifyShippingStatus()`.

import { db } from "./db";
import {
  classifyShippingStatus,
  computeProductionSummary,
  computeDeadlineStatus,
  assessAlert,
  parseDeadline,
  type ProductionSummary,
  type AlertInfo,
  type DeadlineStatus,
} from "./quantity-service";

export interface AggregationFilters {
  productType: string; // MANDATORY
  factoryPO?: string;
  poNo?: string;
  model?: string;
  sku?: string;
  season?: string;
  colorCode?: string;
  size?: string;
  shippingStatus?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface ProductionGroup extends ProductionSummary {
  key: string;
  productType: string;
  poNo: string;
  factoryPO: string;
  model: string;
  sku: string;
  season: string;
  colorCode: string;
  colorCode2: string;
  size: string;
  deadline: string | null;
  deadlineStatus: DeadlineStatus;
  alert: AlertInfo;
  rowCount: number;
}

// Build a Prisma where object from filters. Uses `contains` for LIKE-style matching.
function buildWhere(filters: AggregationFilters): Record<string, unknown> {
  const where: Record<string, unknown> = { productType: filters.productType };
  if (filters.factoryPO) where.factoryPO = { contains: filters.factoryPO };
  if (filters.poNo) where.poNo = { contains: filters.poNo };
  if (filters.model) where.model = { contains: filters.model };
  if (filters.sku) where.sku = { contains: filters.sku };
  if (filters.season) where.season = { contains: filters.season };
  if (filters.colorCode) where.colorCode = { contains: filters.colorCode };
  if (filters.size) where.size = { contains: filters.size };
  if (filters.shippingStatus) where.shippingStatus = { contains: filters.shippingStatus };
  if (filters.dateFrom || filters.dateTo) {
    const dateRange: Record<string, unknown> = {};
    if (filters.dateFrom) dateRange.gte = filters.dateFrom;
    if (filters.dateTo) dateRange.lte = filters.dateTo;
    where.date = dateRange;
  }
  return where;
}

// Core aggregation: groups rows by composite key and sums Order/Output/Pending/Input.
export async function aggregateProduction(
  filters: AggregationFilters,
  groupBy: ("poNo" | "factoryPO" | "model" | "sku" | "season" | "colorCode" | "colorCode2" | "size")[] = ["poNo", "factoryPO", "size"]
): Promise<ProductionGroup[]> {
  const where = buildWhere(filters);

  // Fetch only the columns we need. We materialize everything in memory and group
  // in JS because MongoDB Prisma's groupBy can't easily compute per-bucket sums
  // that depend on a classification function (1.Order / 2.Output / 4.Input).
  const rows = await db.masterData.findMany({
    where,
    select: {
      poNo: true, factoryPO: true, model: true, sku: true,
      season: true, colorCode: true, colorCode2: true, size: true,
      deadline: true, shippingStatus: true, qty1: true,
    },
    // 5000 group cap (LIMIT) is enforced after JS grouping below.
  });

  // Group rows by composite key.
  type Acc = {
    key: string;
    parts: Record<string, string>;
    model: string; sku: string; season: string;
    colorCode: string; colorCode2: string;
    poNo: string; factoryPO: string; size: string;
    nearestDeadline: Date | null;
    rowCount: number;
    orderQty: number; outputQty: number; inputQty: number; pendingQty: number;
  };

  const groups = new Map<string, Acc>();
  for (const r of rows) {
    const partVals = groupBy.map((c) => String((r as any)[c] ?? ""));
    const key = partVals.join("|");
    // Skip rows whose group key is empty (avoids bogus "empty" groups).
    if (!key || partVals.every((v) => !v)) continue;

    if (!groups.has(key)) {
      groups.set(key, {
        key,
        parts: Object.fromEntries(groupBy.map((c, i) => [c, partVals[i]])),
        model: r.model ?? "",
        sku: r.sku ?? "",
        season: r.season ?? "",
        colorCode: r.colorCode ?? "",
        colorCode2: r.colorCode2 ?? "",
        poNo: r.poNo ?? "",
        factoryPO: r.factoryPO ?? "",
        size: r.size ?? "",
        nearestDeadline: null,
        rowCount: 0,
        orderQty: 0, outputQty: 0, inputQty: 0, pendingQty: 0,
      });
    }

    const g = groups.get(key)!;
    g.rowCount++;
    // MAX(model)/MAX(sku)/... — keep the latest non-empty value encountered.
    if (r.model) g.model = r.model;
    if (r.sku) g.sku = r.sku;
    if (r.season) g.season = r.season;
    if (r.colorCode) g.colorCode = r.colorCode;
    if (r.colorCode2) g.colorCode2 = r.colorCode2;
    if (r.poNo) g.poNo = r.poNo;
    if (r.factoryPO) g.factoryPO = r.factoryPO;
    if (r.size) g.size = r.size;

    // MIN(deadline) — keep earliest deadline parsed as Date.
    if (r.deadline) {
      const d = parseDeadline(r.deadline);
      if (d) {
        if (!g.nearestDeadline || d.getTime() < g.nearestDeadline.getTime()) {
          g.nearestDeadline = d;
        }
      }
    }

    const q = r.qty1 ?? 0;
    const bucket = classifyShippingStatus(r.shippingStatus);
    if (bucket === "order") g.orderQty += q;
    else if (bucket === "output") g.outputQty += q;
    else if (bucket === "input") g.inputQty += q;
    else if (bucket === "pending") g.pendingQty += q;
  }

  const groupsArr = [...groups.values()];
  // Sort by nearestDeadline ASC (nulls last).
  groupsArr.sort((a, b) => {
    const ta = a.nearestDeadline ? a.nearestDeadline.getTime() : Number.MAX_SAFE_INTEGER;
    const tb = b.nearestDeadline ? b.nearestDeadline.getTime() : Number.MAX_SAFE_INTEGER;
    return ta - tb;
  });

  return groupsArr.slice(0, 5000).map((g) => {
    const outputQty = g.outputQty;
    const summary = computeProductionSummary({
      orderQty: g.orderQty,
      outputQty,
      pendingQty: g.pendingQty || -outputQty, // Pending = -Output (dynamic, not stored)
      inputQty: g.inputQty,
    });
    const deadline = g.nearestDeadline ? g.nearestDeadline.toISOString().slice(0, 10) : null;
    const deadlineStatus = computeDeadlineStatus(deadline, summary.quantityStatus === "COMPLETED");
    const alert = assessAlert(summary, deadline);
    return {
      key: g.key,
      productType: filters.productType,
      poNo: g.poNo,
      factoryPO: g.factoryPO,
      model: g.model,
      sku: g.sku,
      season: g.season,
      colorCode: g.colorCode,
      colorCode2: g.colorCode2,
      size: g.size,
      deadline,
      deadlineStatus,
      alert,
      rowCount: g.rowCount,
      ...summary,
    } as ProductionGroup;
  });
}

// Total KPIs for a product (no grouping).
export async function getProductKPIs(filters: AggregationFilters) {
  const where = buildWhere(filters);
  const rows = await db.masterData.findMany({
    where,
    select: {
      poNo: true, factoryPO: true, model: true, sku: true,
      shippingStatus: true, qty1: true,
    },
  });

  let orderQty = 0, outputQty = 0, inputQty = 0;
  const poSet = new Set<string>();
  const fpoSet = new Set<string>();
  const modelSet = new Set<string>();
  const skuSet = new Set<string>();
  for (const r of rows) {
    const q = r.qty1 ?? 0;
    const bucket = classifyShippingStatus(r.shippingStatus);
    if (bucket === "order") orderQty += q;
    else if (bucket === "output") outputQty += q;
    else if (bucket === "input") inputQty += q;
    if (r.poNo) poSet.add(r.poNo);
    if (r.factoryPO) fpoSet.add(r.factoryPO);
    if (r.model) modelSet.add(r.model);
    if (r.sku) skuSet.add(r.sku);
  }

  const summary = computeProductionSummary({
    orderQty,
    outputQty,
    pendingQty: -outputQty, // Pending = -Output (dynamic)
    inputQty,
  });
  return {
    ...summary,
    totalPOs: poSet.size,
    totalFactoryPOs: fpoSet.size,
    totalModels: modelSet.size,
    totalSKUs: skuSet.size,
    totalRows: rows.length,
  };
}

// Aggregation by a single dimension (e.g. "size", "colorCode", "model", "poNo", "factoryPO").
export async function aggregateByDimension(
  filters: AggregationFilters,
  dimension: "size" | "colorCode" | "model" | "poNo" | "factoryPO" | "season" | "shippingStatus"
) {
  const where = buildWhere(filters);
  // Exclude null/empty values for the dimension being aggregated.
  const dimWhere = { ...where, [dimension]: { not: null, not: "" } };

  const rows = await db.masterData.findMany({
    where: dimWhere as any,
    select: {
      shippingStatus: true, qty1: true, [dimension]: true,
    } as any,
  });

  // Group by dimension value in JS.
  const groups = new Map<string, { orderQty: number; outputQty: number; inputQty: number; rowCount: number }>();
  for (const r of rows) {
    const dim = String((r as any)[dimension] ?? "");
    if (!dim) continue;
    if (!groups.has(dim)) {
      groups.set(dim, { orderQty: 0, outputQty: 0, inputQty: 0, rowCount: 0 });
    }
    const g = groups.get(dim)!;
    g.rowCount++;
    const q = r.qty1 ?? 0;
    const bucket = classifyShippingStatus(r.shippingStatus);
    if (bucket === "order") g.orderQty += q;
    else if (bucket === "output") g.outputQty += q;
    else if (bucket === "input") g.inputQty += q;
  }

  const out = [...groups.entries()].map(([dim, g]) => {
    const summary = computeProductionSummary({
      orderQty: g.orderQty,
      outputQty: g.outputQty,
      pendingQty: -g.outputQty, // Pending = -Output (dynamic)
      inputQty: g.inputQty,
    });
    return {
      dim,
      rowCount: g.rowCount,
      ...summary,
    };
  });

  // Sort by orderQty DESC, take top 50.
  out.sort((a, b) => b.orderQty - a.orderQty);
  return out.slice(0, 50);
}

// Production timeline by date for a specific shipping status bucket.
export async function productionByDate(
  filters: AggregationFilters,
  statusBucket: "order" | "output" | "input" = "output"
) {
  const where = buildWhere(filters);
  const dateWhere = { ...where, date: { not: null, not: "" } };

  const rows = await db.masterData.findMany({
    where: dateWhere,
    select: { date: true, shippingStatus: true, qty1: true },
  });

  const groups = new Map<string, number>();
  for (const r of rows) {
    if (!r.date) continue;
    const bucket = classifyShippingStatus(r.shippingStatus);
    if (bucket !== statusBucket) continue;
    const q = r.qty1 ?? 0;
    groups.set(r.date, (groups.get(r.date) ?? 0) + q);
  }

  const out = [...groups.entries()]
    .map(([date, qty]) => ({ date, qty }))
    .sort((a, b) => a.date.localeCompare(b.date));
  return out.slice(0, 100);
}

// Top priority alerts for the alert table (sorted by priority then deadline).
export async function getTopAlerts(filters: AggregationFilters, limit = 20): Promise<ProductionGroup[]> {
  const groups = await aggregateProduction(filters, ["poNo", "factoryPO", "size"]);
  const priorityOrder: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2, INFO: 3 };
  return groups
    .filter((g) => g.alert.priority !== "INFO" || g.quantityStatus !== "COMPLETED")
    .sort((a, b) => {
      const p = priorityOrder[a.alert.priority] - priorityOrder[b.alert.priority];
      if (p !== 0) return p;
      return (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999");
    })
    .slice(0, limit);
}
