// ProductionAggregationService
// Groups MasterData rows by composite keys (Product + PO + Factory PO + Size, etc.)
// and runs Order/Output/Pending/Input aggregation via SQL.
//
// All queries are product-scoped: the productType parameter is MANDATORY and applied
// as a WHERE filter to guarantee product isolation (spec §51).

import { db } from "./db";
import {
  classifyShippingStatus,
  computeProductionSummary,
  computeDeadlineStatus,
  assessAlert,
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

function buildWhere(filters: AggregationFilters): { where: string; params: any[] } {
  const conditions: string[] = [];
  const params: any[] = [];
  // productType is always applied.
  conditions.push("productType = ?");
  params.push(filters.productType);
  if (filters.factoryPO) { conditions.push("factoryPO LIKE ?"); params.push(`%${filters.factoryPO}%`); }
  if (filters.poNo) { conditions.push("poNo LIKE ?"); params.push(`%${filters.poNo}%`); }
  if (filters.model) { conditions.push("model LIKE ?"); params.push(`%${filters.model}%`); }
  if (filters.sku) { conditions.push("sku LIKE ?"); params.push(`%${filters.sku}%`); }
  if (filters.season) { conditions.push("season LIKE ?"); params.push(`%${filters.season}%`); }
  if (filters.colorCode) { conditions.push("colorCode LIKE ?"); params.push(`%${filters.colorCode}%`); }
  if (filters.size) { conditions.push("size LIKE ?"); params.push(`%${filters.size}%`); }
  if (filters.shippingStatus) { conditions.push("shippingStatus LIKE ?"); params.push(`%${filters.shippingStatus}%`); }
  if (filters.dateFrom) { conditions.push("date >= ?"); params.push(filters.dateFrom); }
  if (filters.dateTo) { conditions.push("date <= ?"); params.push(filters.dateTo); }
  return { where: conditions.join(" AND "), params };
}

// Core aggregation: groups rows by composite key and sums Order/Output/Pending/Input.
export async function aggregateProduction(
  filters: AggregationFilters,
  groupBy: ("poNo" | "factoryPO" | "model" | "sku" | "season" | "colorCode" | "colorCode2" | "size")[] = ["poNo", "factoryPO", "size"]
): Promise<ProductionGroup[]> {
  const { where, params } = buildWhere(filters);
  const groupCols = groupBy.join(", ");
  // Raw SQL aggregation — fast even on 100k+ rows because of composite indexes.
  // We pull all 4 status sums + shared attributes + nearest deadline in one pass.
  const sql = `
    SELECT
      ${groupBy.map((c) => `"${c}"`).join(", ")},
      MAX(model) AS model,
      MAX(sku) AS sku,
      MAX(season) AS season,
      MAX(colorCode) AS colorCode,
      MAX(colorCode2) AS colorCode2,
      MAX(poNo) AS poNo,
      MAX(factoryPO) AS factoryPO,
      MAX(size) AS size,
      MIN(deadline) AS nearestDeadline,
      COUNT(*) AS rowCount,
      SUM(CASE WHEN LOWER(shippingStatus) LIKE '1%' OR LOWER(shippingStatus) = 'order' THEN CAST(qty1 AS REAL) ELSE 0 END) AS orderQty,
      SUM(CASE WHEN LOWER(shippingStatus) LIKE '2%' OR LOWER(shippingStatus) = 'output' THEN CAST(qty1 AS REAL) ELSE 0 END) AS outputQty,
      SUM(CASE WHEN LOWER(shippingStatus) LIKE '3%' OR LOWER(shippingStatus) = 'pending' THEN CAST(qty1 AS REAL) ELSE 0 END) AS pendingQty,
      SUM(CASE WHEN LOWER(shippingStatus) LIKE '4%' OR LOWER(shippingStatus) = 'input' THEN CAST(qty1 AS REAL) ELSE 0 END) AS inputQty
    FROM MasterData
    WHERE ${where}
    GROUP BY ${groupCols}
    ORDER BY nearestDeadline ASC
    LIMIT 5000
  `;
  const rows = await db.$queryRawUnsafe<any[]>(sql, ...params);

  return rows.map((r) => {
    const summary = computeProductionSummary({
      orderQty: Number(r.orderQty) || 0,
      outputQty: Number(r.outputQty) || 0,
      pendingQty: Number(r.pendingQty) || 0,
      inputQty: Number(r.inputQty) || 0,
    });
    const deadline = r.nearestDeadline || null;
    const deadlineStatus = computeDeadlineStatus(deadline, summary.quantityStatus === "COMPLETED");
    const alert = assessAlert(summary, deadline);
    const key = groupBy.map((c) => String(r[c] ?? "")).join("|");
    return {
      key,
      productType: filters.productType,
      poNo: r.poNo || "",
      factoryPO: r.factoryPO || "",
      model: r.model || "",
      sku: r.sku || "",
      season: r.season || "",
      colorCode: r.colorCode || "",
      colorCode2: r.colorCode2 || "",
      size: r.size || "",
      deadline,
      deadlineStatus,
      alert,
      rowCount: Number(r.rowCount) || 0,
      ...summary,
    } as ProductionGroup;
  });
}

// Total KPIs for a product (no grouping).
export async function getProductKPIs(filters: AggregationFilters) {
  const { where, params } = buildWhere(filters);
  const sql = `
    SELECT
      COUNT(DISTINCT poNo) AS totalPOs,
      COUNT(DISTINCT factoryPO) AS totalFactoryPOs,
      COUNT(DISTINCT model) AS totalModels,
      COUNT(DISTINCT sku) AS totalSKUs,
      COUNT(*) AS totalRows,
      SUM(CASE WHEN LOWER(shippingStatus) LIKE '1%' OR LOWER(shippingStatus) = 'order' THEN CAST(qty1 AS REAL) ELSE 0 END) AS orderQty,
      SUM(CASE WHEN LOWER(shippingStatus) LIKE '2%' OR LOWER(shippingStatus) = 'output' THEN CAST(qty1 AS REAL) ELSE 0 END) AS outputQty,
      SUM(CASE WHEN LOWER(shippingStatus) LIKE '3%' OR LOWER(shippingStatus) = 'pending' THEN CAST(qty1 AS REAL) ELSE 0 END) AS pendingQty,
      SUM(CASE WHEN LOWER(shippingStatus) LIKE '4%' OR LOWER(shippingStatus) = 'input' THEN CAST(qty1 AS REAL) ELSE 0 END) AS inputQty
    FROM MasterData
    WHERE ${where}
  `;
  const rows = await db.$queryRawUnsafe<any[]>(sql, ...params);
  const r = rows[0] || {};
  const summary = computeProductionSummary({
    orderQty: Number(r.orderQty) || 0,
    outputQty: Number(r.outputQty) || 0,
    pendingQty: Number(r.pendingQty) || 0,
    inputQty: Number(r.inputQty) || 0,
  });
  return {
    ...summary,
    totalPOs: Number(r.totalPOs) || 0,
    totalFactoryPOs: Number(r.totalFactoryPOs) || 0,
    totalModels: Number(r.totalModels) || 0,
    totalSKUs: Number(r.totalSKUs) || 0,
    totalRows: Number(r.totalRows) || 0,
  };
}

// Aggregation by a single dimension (e.g. "size", "colorCode", "model", "poNo", "factoryPO").
export async function aggregateByDimension(
  filters: AggregationFilters,
  dimension: "size" | "colorCode" | "model" | "poNo" | "factoryPO" | "season" | "shippingStatus"
) {
  const { where, params } = buildWhere(filters);
  const sql = `
    SELECT
      "${dimension}" AS dim,
      SUM(CASE WHEN LOWER(shippingStatus) LIKE '1%' OR LOWER(shippingStatus) = 'order' THEN CAST(qty1 AS REAL) ELSE 0 END) AS orderQty,
      SUM(CASE WHEN LOWER(shippingStatus) LIKE '2%' OR LOWER(shippingStatus) = 'output' THEN CAST(qty1 AS REAL) ELSE 0 END) AS outputQty,
      SUM(CASE WHEN LOWER(shippingStatus) LIKE '3%' OR LOWER(shippingStatus) = 'pending' THEN CAST(qty1 AS REAL) ELSE 0 END) AS pendingQty,
      SUM(CASE WHEN LOWER(shippingStatus) LIKE '4%' OR LOWER(shippingStatus) = 'input' THEN CAST(qty1 AS REAL) ELSE 0 END) AS inputQty,
      COUNT(*) AS rowCount
    FROM MasterData
    WHERE ${where} AND "${dimension}" IS NOT NULL AND "${dimension}" != ''
    GROUP BY "${dimension}"
    ORDER BY orderQty DESC
    LIMIT 50
  `;
  const rows = await db.$queryRawUnsafe<any[]>(sql, ...params);
  return rows.map((r) => {
    const summary = computeProductionSummary({
      orderQty: Number(r.orderQty) || 0,
      outputQty: Number(r.outputQty) || 0,
      pendingQty: Number(r.pendingQty) || 0,
      inputQty: Number(r.inputQty) || 0,
    });
    return {
      dim: r.dim,
      rowCount: Number(r.rowCount) || 0,
      ...summary,
    };
  });
}

// Production timeline by date for a specific shipping status bucket.
export async function productionByDate(
  filters: AggregationFilters,
  statusBucket: "order" | "output" | "input" = "output"
) {
  const { where, params } = buildWhere(filters);
  const statusClause =
    statusBucket === "order" ? "(LOWER(shippingStatus) LIKE '1%' OR LOWER(shippingStatus) = 'order')" :
    statusBucket === "output" ? "(LOWER(shippingStatus) LIKE '2%' OR LOWER(shippingStatus) = 'output')" :
    "(LOWER(shippingStatus) LIKE '4%' OR LOWER(shippingStatus) = 'input')";
  const sql = `
    SELECT date, SUM(CAST(qty1 AS REAL)) AS qty
    FROM MasterData
    WHERE ${where} AND ${statusClause} AND date IS NOT NULL AND date != ''
    GROUP BY date
    ORDER BY date ASC
    LIMIT 100
  `;
  const rows = await db.$queryRawUnsafe<any[]>(sql, ...params);
  return rows.map((r) => ({ date: r.date, qty: Number(r.qty) || 0 }));
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
