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
import {
  classifyShippingStatus,
  parseDeadline,
} from "./quantity-service";

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
  // Build Prisma where object. Always product-scoped.
  const where: Record<string, unknown> = {
    productType: filters.productType,
    poNo: { not: null, not: "" },
    factoryPO: { not: null, not: "" },
    size: { not: null, not: "" },
  };
  if (filters.poNo) where.poNo = filters.poNo;
  if (filters.factoryPO) where.factoryPO = { contains: filters.factoryPO };
  if (filters.model) where.model = { contains: filters.model };
  if (filters.sku) where.sku = { contains: filters.sku };
  if (filters.size) where.size = { contains: filters.size };
  if (filters.date) where.date = filters.date;
  if (filters.deadline) where.deadline = filters.deadline;
  if (filters.colorCode) {
    // Match colorCode contains "(COLOR)" OR contains the bare code text.
    where.OR = [
      { colorCode: { contains: `(${filters.colorCode})` } },
      { colorCode: { contains: filters.colorCode } },
    ];
  }

  const rows = await db.masterData.findMany({
    where,
    select: {
      poNo: true, factoryPO: true, size: true,
      colorCode: true, colorCode2: true,
      model: true, sku: true, season: true,
      deadline: true, shippingStatus: true, qty1: true,
    },
  });

  // Group by (poNo + factoryPO + size + colorCode + colorCode2) in JS.
  type Acc = {
    poNo: string; factoryPO: string; size: string;
    colorCode: string; colorCode2: string;
    model: string; sku: string; season: string;
    nearestDeadline: Date | null;
    orderQty: number; outputQty: number; inputQty: number; pendingQty: number;
  };
  const groupsMap = new Map<string, Acc>();

  for (const r of rows) {
    const poNo = r.poNo ?? "";
    const fpo = r.factoryPO ?? "";
    const sz = r.size ?? "";
    const cc = r.colorCode ?? "";
    const cc2 = r.colorCode2 ?? "";
    const key = `${poNo}|${fpo}|${normalizeSize(sz)}|${cc}`;
    if (!groupsMap.has(key)) {
      groupsMap.set(key, {
        poNo, factoryPO: fpo, size: sz,
        colorCode: cc, colorCode2: cc2,
        model: r.model ?? "", sku: r.sku ?? "", season: r.season ?? "",
        nearestDeadline: null,
        orderQty: 0, outputQty: 0, inputQty: 0, pendingQty: 0,
      });
    }
    const g = groupsMap.get(key)!;
    if (r.model) g.model = r.model;
    if (r.sku) g.sku = r.sku;
    if (r.season) g.season = r.season;
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

  const out: ShipmentGroup[] = [];
  for (const r of groupsMap.values()) {
    const orderQty = r.orderQty;
    const outputQty = r.outputQty;
    const inputQty = r.inputQty;
    const pendingQty = r.pendingQty;
    const remainingOutput = orderQty - outputQty;
    const remainingInput = outputQty - inputQty;
    const surplus = Math.max(0, outputQty - orderQty);

    let status: ShipmentGroup["status"];
    if (orderQty === 0) status = "NO_ORDER";
    else if (surplus > 0) status = "SURPLUS";
    else if (remainingOutput > 0) status = "SHORT_OUTPUT";
    else status = "BALANCED";

    const model = r.model;
    const mw = model; // M/W column = model

    out.push({
      key: `${r.poNo}|${r.factoryPO}|${normalizeSize(r.size)}|${r.colorCode}`,
      productType: filters.productType,
      poNo: r.poNo,
      factoryPO: r.factoryPO,
      size: r.size,
      colorCode: r.colorCode,
      colorCode2: r.colorCode2,
      model,
      sku: r.sku,
      season: r.season,
      mw,
      deadline: r.nearestDeadline ? r.nearestDeadline.toISOString().slice(0, 10) : null,
      orderQty,
      outputQty,
      inputQty,
      pendingQty,
      remainingOutput,
      remainingInput,
      surplus,
      status,
    });
  }

  // Sort by colorCode, poNo, factoryPO, size to match the original SQL ORDER BY.
  out.sort((a, b) => {
    if (a.colorCode !== b.colorCode) return a.colorCode.localeCompare(b.colorCode);
    if (a.poNo !== b.poNo) return a.poNo.localeCompare(b.poNo);
    if (a.factoryPO !== b.factoryPO) return a.factoryPO.localeCompare(b.factoryPO);
    return a.size.localeCompare(b.size);
  });

  // LIMIT 2000.
  return out.slice(0, 2000);
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
  const rows = await db.masterData.findMany({
    where: {
      productType,
      colorCode: { not: null, not: "" },
    },
    distinct: ["colorCode"],
    select: { colorCode: true },
  });
  const result: { code: string; label: string }[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const label = r.colorCode ?? "";
    if (!label) continue;
    const code = extractColorCode(label);
    if (code && !seen.has(code)) {
      seen.add(code);
      result.push({ code, label });
    }
  }
  return result;
}

// Get unique Factory POs for a specific color code.
export async function getFactoryPOsByColor(
  productType: string,
  colorCode: string
): Promise<string[]> {
  const rows = await db.masterData.findMany({
    where: {
      productType,
      factoryPO: { not: null, not: "" },
      OR: [
        { colorCode: { contains: `(${colorCode})` } },
        { colorCode: { contains: colorCode } },
      ],
    },
    distinct: ["factoryPO"],
    select: { factoryPO: true },
  });
  return rows
    .map((r) => r.factoryPO)
    .filter((v): v is string => Boolean(v))
    .sort((a, b) => a.localeCompare(b));
}

// Get unique PO NO#s for a specific color code + factory PO.
export async function getPoNosByColorAndFactory(
  productType: string,
  colorCode: string,
  factoryPO: string
): Promise<string[]> {
  const where: Record<string, unknown> = {
    productType,
    factoryPO,
    poNo: { not: null, not: "" },
  };
  if (colorCode) {
    where.OR = [
      { colorCode: { contains: `(${colorCode})` } },
      { colorCode: { contains: colorCode } },
    ];
  }
  const rows = await db.masterData.findMany({
    where,
    distinct: ["poNo"],
    select: { poNo: true },
  });
  return rows
    .map((r) => r.poNo)
    .filter((v): v is string => Boolean(v))
    .sort((a, b) => a.localeCompare(b));
}

// Get unique sizes for a specific color code + factory PO + poNo.
export async function getSizesByColorFactoryPo(
  productType: string,
  colorCode: string,
  factoryPO: string,
  poNo?: string
): Promise<string[]> {
  const where: Record<string, unknown> = {
    productType,
    factoryPO,
    size: { not: null, not: "" },
  };
  if (colorCode) {
    where.OR = [
      { colorCode: { contains: `(${colorCode})` } },
      { colorCode: { contains: colorCode } },
    ];
  }
  if (poNo) where.poNo = poNo;
  const rows = await db.masterData.findMany({
    where,
    distinct: ["size"],
    select: { size: true },
  });
  return rows
    .map((r) => r.size)
    .filter((v): v is string => Boolean(v))
    .sort((a, b) => a.localeCompare(b));
}
