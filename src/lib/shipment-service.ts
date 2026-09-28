// ShipmentService
// Daily Shipment Planning logic: calculate Remaining Output, detect Surplus,
// suggest transfers between Factory POs, and generate Excel in IN PO format.
//
// Key formulas (per PO NO# + Factory PO + Size group):
//   ORDER_QTY   = SUM(qty1) WHERE status = "1.Order"
//   OUTPUT_QTY  = SUM(qty1) WHERE status = "2.Output"
//   INPUT_QTY   = SUM(qty1) WHERE status = "4.Input"
//   REMAINING_OUTPUT = ORDER_QTY - OUTPUT_QTY  (positive = need to ship, negative = surplus)
//   REMAINING_INPUT  = OUTPUT_QTY - INPUT_QTY
//   SURPLUS = MAX(0, OUTPUT_QTY - ORDER_QTY)
//
// Pending (3.Pending) is NOT used in calculations — it's just an offset of Output.

import { db } from "./db";
import {
  classifyShippingStatus,
  parseDeadline as parseDeadlineQty,
} from "./quantity-service";
import * as XLSX from "xlsx";
import * as fs from "fs";
import { FIELD_LABELS, type CanonicalField } from "./fields";

// ===== Types =====

export interface ShipmentGroup {
  key: string;
  productType: string;
  poNo: string;
  factoryPO: string;
  model: string;
  sku: string;
  season: string;
  colorCode: string;
  colorCode2: string;
  painting: string;
  printingColor: string;
  size: string;
  deadline: string | null;
  orderQty: number;
  outputQty: number;
  inputQty: number;
  remainingOutput: number;  // ORDER - OUTPUT (negative = surplus)
  remainingInput: number;   // OUTPUT - INPUT
  surplus: number;           // MAX(0, OUTPUT - ORDER)
  status: "SHORT_OUTPUT" | "COMPLETE" | "SURPLUS" | "NO_OUTPUT";
}

export interface ShipmentFilters {
  productType: string;
  date?: string;
  colorCode?: string;
  poNo?: string;
  factoryPO?: string;
  model?: string;
  sku?: string;
  season?: string;
  size?: string;
  deadline?: string;
}

// ===== Core: get shipment groups =====
// Groups MasterData by (PO NO# + Factory PO + Size) and calculates quantities.
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
  if (filters.factoryPO) where.factoryPO = filters.factoryPO;
  if (filters.model) where.model = filters.model;
  if (filters.sku) where.sku = filters.sku;
  if (filters.season) where.season = filters.season;
  if (filters.colorCode) where.colorCode = filters.colorCode;
  if (filters.size) where.size = filters.size;
  if (filters.date) where.date = filters.date;
  if (filters.deadline) where.deadline = filters.deadline;

  const rows = await db.masterData.findMany({
    where,
    select: {
      poNo: true, factoryPO: true, size: true,
      model: true, sku: true, season: true,
      colorCode: true, colorCode2: true,
      painting: true, printingColor: true,
      deadline: true, shippingStatus: true, qty1: true,
    },
  });

  // Group by (poNo + factoryPO + size) in JS.
  type Acc = {
    poNo: string; factoryPO: string; size: string;
    model: string; sku: string; season: string;
    colorCode: string; colorCode2: string;
    painting: string; printingColor: string;
    nearestDeadline: Date | null;
    orderQty: number; outputQty: number; inputQty: number;
  };
  const groupsMap = new Map<string, Acc>();

  for (const r of rows) {
    const poNo = (r.poNo ?? "").trim();
    const fpo = (r.factoryPO ?? "").trim();
    const sz = (r.size ?? "").trim();
    const key = `${poNo}|${fpo}|${sz}`;
    if (!groupsMap.has(key)) {
      groupsMap.set(key, {
        poNo, factoryPO: fpo, size: sz,
        model: r.model ?? "", sku: r.sku ?? "", season: r.season ?? "",
        colorCode: r.colorCode ?? "", colorCode2: r.colorCode2 ?? "",
        painting: r.painting ?? "", printingColor: r.printingColor ?? "",
        nearestDeadline: null,
        orderQty: 0, outputQty: 0, inputQty: 0,
      });
    }
    const g = groupsMap.get(key)!;
    if (r.model) g.model = r.model;
    if (r.sku) g.sku = r.sku;
    if (r.season) g.season = r.season;
    if (r.colorCode) g.colorCode = r.colorCode;
    if (r.colorCode2) g.colorCode2 = r.colorCode2;
    if (r.painting) g.painting = r.painting;
    if (r.printingColor) g.printingColor = r.printingColor;
    if (r.deadline) {
      const d = parseDeadlineQty(r.deadline);
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
  }

  const out: ShipmentGroup[] = [];
  for (const r of groupsMap.values()) {
    const orderQty = r.orderQty;
    const outputQty = r.outputQty;
    const inputQty = r.inputQty;
    const remainingOutput = orderQty - outputQty;
    const remainingInput = outputQty - inputQty;
    const surplus = Math.max(0, outputQty - orderQty);

    let status: ShipmentGroup["status"];
    if (surplus > 0) status = "SURPLUS";
    else if (remainingOutput > 0) status = "SHORT_OUTPUT";
    else if (orderQty > 0 && outputQty >= orderQty && inputQty >= orderQty) status = "COMPLETE";
    else status = "NO_OUTPUT";

    out.push({
      key: `${r.poNo}|${r.factoryPO}|${r.size}`,
      productType: filters.productType,
      poNo: r.poNo,
      factoryPO: r.factoryPO,
      model: r.model,
      sku: r.sku,
      season: r.season,
      colorCode: r.colorCode,
      colorCode2: r.colorCode2,
      painting: r.painting,
      printingColor: r.printingColor,
      size: r.size,
      deadline: r.nearestDeadline ? r.nearestDeadline.toISOString().slice(0, 10) : null,
      orderQty,
      outputQty,
      inputQty,
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

// ===== Get distinct color codes for a product =====
export async function getColorCodes(productType: string): Promise<string[]> {
  const rows = await db.masterData.findMany({
    where: {
      productType,
      colorCode: { not: null, not: "" },
    },
    distinct: ["colorCode"],
    select: { colorCode: true },
  });
  return rows
    .map((r) => r.colorCode)
    .filter((v): v is string => Boolean(v))
    .sort((a, b) => a.localeCompare(b));
}

// ===== Surplus detection + transfer suggestions =====

export interface SurplusSource {
  key: string;
  poNo: string;
  factoryPO: string;
  model: string;
  colorCode: string;
  size: string;
  deadline: string | null;
  orderQty: number;
  outputQty: number;
  surplus: number;
}

export interface TransferDestination {
  key: string;
  poNo: string;
  factoryPO: string;
  model: string;
  colorCode: string;
  size: string;
  deadline: string | null;
  orderQty: number;
  outputQty: number;
  remainingCapacity: number; // ORDER - OUTPUT (positive = can receive)
}

export interface TransferProposal {
  source: SurplusSource;
  destinations: { dest: TransferDestination; transferQty: number }[];
  totalTransferable: number;
}

export async function getSurplusTransfers(
  productType: string
): Promise<TransferProposal[]> {
  const groups = await getShipmentGroups({ productType });
  const surplusSources = groups.filter((g) => g.surplus > 0);
  const shortGroups = groups.filter((g) => g.remainingOutput > 0);

  const proposals: TransferProposal[] = [];

  for (const src of surplusSources) {
    // Find destinations: same PO NO# + same Color Code + same Size + different Factory PO.
    const candidates = shortGroups.filter(
      (g) =>
        g.poNo === src.poNo &&
        g.colorCode === src.colorCode &&
        g.size === src.size &&
        g.factoryPO !== src.factoryPO
    );

    // Sort by priority: deadline nearest first.
    candidates.sort((a, b) => {
      const da = a.deadline || "9999";
      const db2 = b.deadline || "9999";
      return da.localeCompare(db2);
    });

    let remainingSurplus = src.surplus;
    const transfers: { dest: TransferDestination; transferQty: number }[] = [];

    for (const c of candidates) {
      if (remainingSurplus <= 0) break;
      const transferQty = Math.min(remainingSurplus, c.remainingOutput);
      if (transferQty > 0) {
        transfers.push({
          dest: {
            key: c.key,
            poNo: c.poNo,
            factoryPO: c.factoryPO,
            model: c.model,
            colorCode: c.colorCode,
            size: c.size,
            deadline: c.deadline,
            orderQty: c.orderQty,
            outputQty: c.outputQty,
            remainingCapacity: c.remainingOutput,
          },
          transferQty,
        });
        remainingSurplus -= transferQty;
      }
    }

    proposals.push({
      source: {
        key: src.key,
        poNo: src.poNo,
        factoryPO: src.factoryPO,
        model: src.model,
        colorCode: src.colorCode,
        size: src.size,
        deadline: src.deadline,
        orderQty: src.orderQty,
        outputQty: src.outputQty,
        surplus: src.surplus,
      },
      destinations: transfers,
      totalTransferable: src.surplus - remainingSurplus,
    });
  }

  return proposals;
}

// ===== Excel generation: IN PO [Color] format =====
//
// Reads the template Excel file to get the actual header structure of each
// IN PO sheet, then generates a new Excel file with the planned output
// quantities mapped to the correct size columns.

// Normalize a size string: remove extra whitespace, newlines, etc.
function normalizeSize(s: string): string {
  return String(s || "")
    .replace(/\r\n/g, " ")
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Read the IN PO sheet headers from the template file.
// Returns a map: colorCode → { sheetName, headers: string[], headerRowIdx: number }
// If the template can't be read, returns an empty map (caller falls back to default sizes).
export function readINPoSheetTemplates(templatePath: string): Map<string, {
  sheetName: string;
  headers: string[];
  sizeColumns: { header: string; normalized: string }[];
}> {
  try {
    if (!fs.existsSync(templatePath)) return new Map();
    const wb = XLSX.readFile(templatePath, { sheetStubs: false });
    const result = new Map<string, { sheetName: string; headers: string[]; sizeColumns: { header: string; normalized: string }[] }>();

  for (const sheetName of wb.SheetNames) {
    // Match sheets like "IN PO NMNN", "IN PO ABNT.", etc.
    const match = sheetName.match(/^IN PO\s+(.+)$/i);
    if (!match) continue;
    const colorRaw = match[1].replace(/[.\s]+$/, "").trim();
    const ws = wb.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" }) as unknown[][];
    if (data.length === 0) continue;

    // Find the header row (first row containing "MODEL" or "FAC PO").
    let headerRowIdx = -1;
    let headers: string[] = [];
    for (let i = 0; i < Math.min(20, data.length); i++) {
      const row = (data[i] as unknown[]) || [];
      const rowStr = row.map((c) => String(c ?? "")).join("|").toUpperCase();
      if (rowStr.includes("FAC PO") || rowStr.includes("MODEL")) {
        headerRowIdx = i;
        headers = row.map((c) => String(c ?? "").replace(/\r\n/g, " ").replace(/\n/g, " ").replace(/\s+/g, " ").trim());
        break;
      }
    }
    if (headerRowIdx < 0) continue;

    // Identify size columns: columns between "FAC PO" and "Grand Total"
    const facPoIdx = headers.findIndex((h) => h.toUpperCase().includes("FAC PO"));
    const grandTotalIdx = headers.findIndex((h) => h.toUpperCase().includes("GRAND TOTAL"));
    const sizeColumns: { header: string; normalized: string }[] = [];
    if (facPoIdx >= 0) {
      const endIdx = grandTotalIdx > facPoIdx ? grandTotalIdx : headers.length;
      for (let i = facPoIdx + 1; i < endIdx; i++) {
        const h = headers[i];
        if (h && h.trim()) {
          sizeColumns.push({ header: h, normalized: normalizeSize(h) });
        }
      }
    }

    result.set(colorRaw, { sheetName, headers, sizeColumns });
  }

  return result;
  } catch {
    // If the template can't be read for any reason, return empty map.
    // The caller will fall back to default size columns.
    return new Map();
  }
}

// Generate the Daily Shipment Excel file in IN PO format.
// Each PO NO# becomes its own sheet containing all its Factory POs as rows.
// A PO NO# can have multiple Factory POs — they all appear together in the
// same sheet so the user can export multiple Factory POs at once.
// The summary sheet is enriched with Order / Previous Output / Total Output /
// Remaining from the shipmentGroups lookup (if provided).
export async function generateShipmentExcel(
  productType: string,
  selectedPoNos: string[],
  plannedOutputs: { poNo: string; factoryPO: string; model: string; colorCode: string; size: string; plannedQty: number; deadline: string | null }[],
  templatePath?: string,
  shipmentGroups?: ShipmentGroup[]
): Promise<Buffer> {
  const wb = XLSX.utils.book_new();

  // Try to read template headers (by color → size columns). If template read
  // fails, fall back to default size columns (graceful degradation).
  let templates: Map<string, { sheetName: string; headers: string[]; sizeColumns: { header: string; normalized: string }[] }> = new Map();
  if (templatePath) {
    templates = readINPoSheetTemplates(templatePath);
  }

  // Default size columns if no template found (common Mafate sizes).
  const defaultSizes = [
    "M(04) /W(05)", "M(04T) /W(05T)", "M(05) /W(06)", "M(05T) /W(06T)",
    "M(06) /W(07)", "M(06T) /W(07T)", "M(07) /W(08)", "M(07T) /W(08T)",
    "M(08) /W(09)", "M(08T) /W(09T)", "M(09) /W(10)", "M(09T) /W(10T)",
    "M(10) /W(11)", "M(10T)", "M(11)", "M(11T)", "M(12)", "M(12T)", "M(13)", "M(14)",
  ];

  // Collect all sizes present in the planned outputs so the sheet has a column
  // for every size (union across all colors/Factory POs for this PO NO#).
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  const allSizes = new Map<string, string>(); // normalized → original header
  for (const p of plannedOutputs) {
    const ns = norm(p.size);
    if (!allSizes.has(ns)) allSizes.set(ns, p.size);
  }
  // Merge with default sizes (preserves known sizes even if not in this batch).
  for (const ds of defaultSizes) {
    const ns = norm(ds);
    if (!allSizes.has(ns)) allSizes.set(ns, ds);
  }
  const sizeColumns = Array.from(allSizes.entries()).map(([normalized, header]) => ({ header, normalized }));

  // Build one sheet PER PO NO# (not per color). Each sheet contains all the
  // Factory POs for that PO NO# as separate rows.
  for (const poNo of selectedPoNos) {
    // Filter planned outputs for this PO NO#.
    const poData = plannedOutputs.filter((p) => p.poNo === poNo);
    if (poData.length === 0) continue;

    // Group by (model + colorCode + factoryPO) → rows. All Factory POs for
    // this PO NO# appear in the same sheet so the user sees them together.
    const rowMap = new Map<string, { model: string; colorCode: string; mw: string; poNo: string; factoryPO: string; sizes: Map<string, number>; grandTotal: number }>();
    for (const p of poData) {
      const rowKey = `${p.model}|${p.colorCode}|${p.factoryPO}`;
      if (!rowMap.has(rowKey)) {
        rowMap.set(rowKey, {
          model: p.model || "",
          colorCode: p.colorCode || "",
          mw: "", // M/W column (model variant)
          poNo: p.poNo,
          factoryPO: p.factoryPO,
          sizes: new Map<string, number>(),
          grandTotal: 0,
        });
      }
      const row = rowMap.get(rowKey)!;
      const normSize = norm(p.size);
      row.sizes.set(normSize, (row.sizes.get(normSize) || 0) + p.plannedQty);
      row.grandTotal += p.plannedQty;
    }

    // Build sheet data.
    const headers = ["MODEL", "COLOR", "M/W", "PO", "FAC PO", ...sizeColumns.map((s) => s.header), "Grand Total"];
    const rows: Record<string, string | number>[] = [];

    for (const [, row] of rowMap) {
      const o: Record<string, string | number> = {};
      o["MODEL"] = row.model;
      o["COLOR"] = row.colorCode;
      o["M/W"] = row.mw;
      o["PO"] = row.poNo;
      o["FAC PO"] = row.factoryPO;
      for (const sc of sizeColumns) {
        o[sc.header] = row.sizes.get(sc.normalized) || 0;
      }
      o["Grand Total"] = row.grandTotal;
      rows.push(o);
    }

    // Sort rows by Factory PO for readability.
    rows.sort((a, b) => String(a["FAC PO"]).localeCompare(String(b["FAC PO"])));

    const ws = XLSX.utils.json_to_sheet(rows, { header: headers });
    // Excel sheet names: max 31 chars, no special chars. Use PO NO# as sheet name.
    const sheetName = `IN PO ${poNo}`.replace(/[\\/:?*\[\]]/g, "").slice(0, 31);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }

  // Add DAILY SHIPMENT SUMMARY sheet.
  // Enrich with Order / Previous Output / Remaining from shipmentGroups.
  const groupMap = new Map<string, ShipmentGroup>();
  if (shipmentGroups) {
    for (const g of shipmentGroups) {
      groupMap.set(`${g.poNo}|${g.factoryPO}|${norm(g.size)}`, g);
    }
  }
  const summaryHeaders = ["Date", "PO NO#", "Factory PO", "Color", "Size", "Order", "Previous Output", "Today's Planned Output", "Total Output", "Remaining", "Deadline"];
  const summaryRows: Record<string, string | number>[] = [];
  for (const p of plannedOutputs) {
    const g = groupMap.get(`${p.poNo}|${p.factoryPO}|${norm(p.size)}`);
    const orderQty = g?.orderQty ?? 0;
    const previousOutput = g?.outputQty ?? 0;
    const totalOutput = previousOutput + p.plannedQty;
    const remaining = orderQty - totalOutput;
    summaryRows.push({
      Date: new Date().toISOString().slice(0, 10),
      "PO NO#": p.poNo,
      "Factory PO": p.factoryPO,
      Color: p.colorCode,
      Size: p.size,
      Order: orderQty,
      "Previous Output": previousOutput,
      "Today's Planned Output": p.plannedQty,
      "Total Output": totalOutput,
      Remaining: remaining,
      Deadline: p.deadline || "",
    });
  }
  const summaryWs = XLSX.utils.json_to_sheet(summaryRows, { header: summaryHeaders });
  XLSX.utils.book_append_sheet(wb, summaryWs, "DAILY SHIPMENT SUMMARY");


  const out = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return out;
}
