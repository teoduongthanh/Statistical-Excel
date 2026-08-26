// ShipmentPlanningService
// Core calculation engine for Daily Shipment Planning.
//
// Groups MasterData by (productType + poNo + factoryPO + size + colorCode) and
// computes Order/Output/Input/Pending/Remaining/Surplus quantities.
//
// Key rules (per spec):
//   - Remaining Output = Order - Output (NOT Order - Output - Pending)
//   - Pending is just the negative offset of Output, NOT a real order line
//   - Surplus = Output - Order (when > 0, this Factory PO has excess stock)
//   - Remaining Input = Output - Input (items sent but not yet received back)
//   - Surplus transfer only within same PO NO# + Color Code + Size

import { db } from "./db";
import { classifyShippingStatus } from "./quantity-service";

export interface ShipmentGroup {
  key: string;
  productType: string;
  poNo: string;
  factoryPO: string;
  size: string;
  colorCode: string;
  colorCode2: string;
  model: string;
  sku: string;
  season: string;
  mw: string; // M/W column (e.g. "MAFATE5 MS" or "MAFATE5 WS")
  deadline: string | null;
  orderQty: number;
  outputQty: number;
  inputQty: number;
  pendingQty: number;
  remainingOutput: number; // Order - Output
  remainingInput: number;  // Output - Input
  surplus: number;         // max(0, Output - Order)
  status: "SHORT_OUTPUT" | "BALANCED" | "SURPLUS" | "NO_ORDER";
}

export interface ShipmentFilters {
  productType: string; // MANDATORY
  date?: string;       // filter by date (for daily planning)
  colorCode?: string;   // filter by color code
  poNo?: string;
  factoryPO?: string;
  model?: string;
  sku?: string;
  size?: string;
  deadline?: string;
}

// Normalize size string for matching (handle newlines, spaces, etc.)
export function normalizeSize(s: string): string {
  return String(s ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Extract color code from "Color Code" field.
// e.g. "NEON FLAME / NEON TANGERINE (NMNN)" → "NMNN"
// e.g. "AMBIENT BLUE /ROSEMARY (ABNT)" → "ABNT"
export function extractColorCode(colorCode: string | null | undefined): string {
  if (!colorCode) return "";
  const s = String(colorCode).trim();
  const match = s.match(/\(([A-Z]+(?:\(W\))?)\)/);
  if (match) return match[1];
  // Fallback: if no parentheses, use the whole string (trimmed, uppercased)
  return s.toUpperCase().slice(0, 10);
}

// Core aggregation: groups by (poNo + factoryPO + size + colorCode) and sums
// Order/Output/Input/Pending quantities from MasterData.
export async function getShipmentGroups(
  filters: ShipmentFilters
): Promise<ShipmentGroup[]> {
  const conditions: string[] = [];
  const params: any[] = [];

  // productType is mandatory.
  conditions.push("productType = ?");
  params.push(filters.productType);

  if (filters.poNo) {
    conditions.push("poNo = ?");
    params.push(filters.poNo);
  }
  if (filters.factoryPO) {
    conditions.push("factoryPO LIKE ?");
    params.push(`%${filters.factoryPO}%`);
  }
  if (filters.model) {
    conditions.push("model LIKE ?");
    params.push(`%${filters.model}%`);
  }
  if (filters.sku) {
    conditions.push("sku LIKE ?");
    params.push(`%${filters.sku}%`);
  }
  if (filters.size) {
    conditions.push("size LIKE ?");
    params.push(`%${filters.size}%`);
  }
  if (filters.date) {
    conditions.push("date = ?");
    params.push(filters.date);
  }
  if (filters.deadline) {
    conditions.push("deadline = ?");
    params.push(filters.deadline);
  }

  // Color filter: match on the extracted color code from Color Code field.
  // We use a LIKE filter on colorCode that contains the code in parentheses.
  if (filters.colorCode) {
    conditions.push("(colorCode LIKE ? OR colorCode = ?)");
    params.push(`%(${filters.colorCode})%`);
    params.push(`%${filters.colorCode}%`);
  }

  const whereClause = conditions.join(" AND ");

  const sql = `
    SELECT
      poNo, factoryPO, size, colorCode, colorCode2,
      MAX(model) AS model, MAX(sku) AS sku, MAX(season) AS season,
      MIN(deadline) AS nearestDeadline,
      SUM(CASE WHEN LOWER(shippingStatus) LIKE '1%' OR LOWER(shippingStatus) = 'order' THEN COALESCE(qty1,0) ELSE 0 END) AS orderQty,
      SUM(CASE WHEN LOWER(shippingStatus) LIKE '2%' OR LOWER(shippingStatus) = 'output' THEN COALESCE(qty1,0) ELSE 0 END) AS outputQty,
      SUM(CASE WHEN LOWER(shippingStatus) LIKE '3%' OR LOWER(shippingStatus) = 'pending' THEN COALESCE(qty1,0) ELSE 0 END) AS pendingQty,
      SUM(CASE WHEN LOWER(shippingStatus) LIKE '4%' OR LOWER(shippingStatus) = 'input' THEN COALESCE(qty1,0) ELSE 0 END) AS inputQty
    FROM MasterData
    WHERE ${whereClause}
      AND poNo IS NOT NULL AND poNo != ''
      AND factoryPO IS NOT NULL AND factoryPO != ''
      AND size IS NOT NULL AND size != ''
    GROUP BY poNo, factoryPO, size, colorCode, colorCode2
    ORDER BY colorCode, poNo, factoryPO, size
    LIMIT 2000
  `;

  const rows = await db.$queryRawUnsafe<any[]>(sql, ...params);

  return rows.map((r) => {
    const orderQty = Number(r.orderQty) || 0;
    const outputQty = Number(r.outputQty) || 0;
    const inputQty = Number(r.inputQty) || 0;
    const pendingQty = Number(r.pendingQty) || 0;
    const remainingOutput = orderQty - outputQty;
    const remainingInput = outputQty - inputQty;
    const surplus = Math.max(0, outputQty - orderQty);

    let status: ShipmentGroup["status"];
    if (orderQty === 0) status = "NO_ORDER";
    else if (surplus > 0) status = "SURPLUS";
    else if (remainingOutput > 0) status = "SHORT_OUTPUT";
    else status = "BALANCED";

    // Determine M/W from model (MAFATE5 MS → "MAFATE5 MS", MAFATE5 WS → "MAFATE5 WS")
    const model = r.model || "";
    const mw = model;

    return {
      key: `${r.poNo}|${r.factoryPO}|${normalizeSize(r.size)}|${r.colorCode || ""}`,
      productType: filters.productType,
      poNo: r.poNo || "",
      factoryPO: r.factoryPO || "",
      size: r.size || "",
      colorCode: r.colorCode || "",
      colorCode2: r.colorCode2 || "",
      model,
      sku: r.sku || "",
      season: r.season || "",
      mw,
      deadline: r.nearestDeadline || null,
      orderQty,
      outputQty,
      inputQty,
      pendingQty,
      remainingOutput,
      remainingInput,
      surplus,
      status,
    };
  });
}

// Get summary KPIs for the shipment dashboard.
export async function getShipmentSummary(filters: ShipmentFilters) {
  const groups = await getShipmentGroups(filters);
  const totalOrder = groups.reduce((s, g) => s + g.orderQty, 0);
  const totalOutput = groups.reduce((s, g) => s + g.outputQty, 0);
  const totalInput = groups.reduce((s, g) => s + g.inputQty, 0);
  const totalPending = groups.reduce((s, g) => s + g.pendingQty, 0);
  const totalRemainingOutput = groups.reduce((s, g) => s + Math.max(0, g.remainingOutput), 0);
  const totalRemainingInput = groups.reduce((s, g) => s + Math.max(0, g.remainingInput), 0);
  const totalSurplus = groups.reduce((s, g) => s + g.surplus, 0);
  const shortOutputCount = groups.filter((g) => g.status === "SHORT_OUTPUT").length;
  const surplusCount = groups.filter((g) => g.status === "SURPLUS").length;
  const balancedCount = groups.filter((g) => g.status === "BALANCED").length;

  return {
    totalGroups: groups.length,
    totalOrder,
    totalOutput,
    totalInput,
    totalPending,
    totalRemainingOutput,
    totalRemainingInput,
    totalSurplus,
    shortOutputCount,
    surplusCount,
    balancedCount,
    groups,
  };
}

// Get unique color codes for a product (extracted from Color Code field).
export async function getColorCodes(productType: string): Promise<{ code: string; label: string }[]> {
  const rows = await db.$queryRawUnsafe<{ colorCode: string }[]>(
    `SELECT DISTINCT colorCode FROM MasterData
     WHERE productType = ? AND colorCode IS NOT NULL AND colorCode != ''
     ORDER BY colorCode`,
    productType
  );
  const result: { code: string; label: string }[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const code = extractColorCode(r.colorCode);
    if (code && !seen.has(code)) {
      seen.add(code);
      result.push({ code, label: r.colorCode });
    }
  }
  return result;
}

// Get unique Factory POs for a specific color code.
export async function getFactoryPOsByColor(
  productType: string,
  colorCode: string
): Promise<string[]> {
  const rows = await db.$queryRawUnsafe<{ factoryPO: string }[]>(
    `SELECT DISTINCT factoryPO FROM MasterData
     WHERE productType = ? AND factoryPO IS NOT NULL AND factoryPO != ''
       AND (colorCode LIKE ? OR colorCode LIKE ?)
     ORDER BY factoryPO`,
    productType,
    `%(${colorCode})%`,
    `%${colorCode}%`
  );
  return rows.map((r) => r.factoryPO).filter((v): v is string => Boolean(v));
}

// Get unique PO NO#s for a specific color code + factory PO.
export async function getPoNosByColorAndFactory(
  productType: string,
  colorCode: string,
  factoryPO: string
): Promise<string[]> {
  const conditions = [
    "productType = ?",
    "factoryPO = ?",
    "poNo IS NOT NULL AND poNo != ''",
  ];
  const params: any[] = [productType, factoryPO];
  if (colorCode) {
    conditions.push("(colorCode LIKE ? OR colorCode LIKE ?)");
    params.push(`%(${colorCode})%`, `%${colorCode}%`);
  }
  const sql = `SELECT DISTINCT poNo FROM MasterData WHERE ${conditions.join(" AND ")} ORDER BY poNo`;
  const rows = await db.$queryRawUnsafe<{ poNo: string }[]>(sql, ...params);
  return rows.map((r) => r.poNo).filter((v): v is string => Boolean(v));
}

// Get unique sizes for a specific color code + factory PO + poNo.
export async function getSizesByColorFactoryPo(
  productType: string,
  colorCode: string,
  factoryPO: string,
  poNo?: string
): Promise<string[]> {
  const conditions = [
    "productType = ?",
    "factoryPO = ?",
    "size IS NOT NULL AND size != ''",
  ];
  const params: any[] = [productType, factoryPO];
  if (colorCode) {
    conditions.push("(colorCode LIKE ? OR colorCode LIKE ?)");
    params.push(`%(${colorCode})%`, `%${colorCode}%`);
  }
  if (poNo) {
    conditions.push("poNo = ?");
    params.push(poNo);
  }
  const sql = `SELECT DISTINCT size FROM MasterData WHERE ${conditions.join(" AND ")} ORDER BY size`;
  const rows = await db.$queryRawUnsafe<{ size: string }[]>(sql, ...params);
  return rows.map((r) => r.size).filter((v): v is string => Boolean(v));
}
