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
import { classifyShippingStatus } from "./quantity-service";
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
  const conditions: string[] = [];
  const params: any[] = [];

  // productType is MANDATORY.
  conditions.push("productType = ?");
  params.push(filters.productType);

  if (filters.poNo) { conditions.push("poNo = ?"); params.push(filters.poNo); }
  if (filters.factoryPO) { conditions.push("factoryPO = ?"); params.push(filters.factoryPO); }
  if (filters.model) { conditions.push("model = ?"); params.push(filters.model); }
  if (filters.sku) { conditions.push("sku = ?"); params.push(filters.sku); }
  if (filters.season) { conditions.push("season = ?"); params.push(filters.season); }
  if (filters.colorCode) { conditions.push("colorCode = ?"); params.push(filters.colorCode); }
  if (filters.size) { conditions.push("size = ?"); params.push(filters.size); }
  if (filters.date) { conditions.push("date = ?"); params.push(filters.date); }
  if (filters.deadline) { conditions.push("deadline = ?"); params.push(filters.deadline); }

  const whereClause = conditions.join(" AND ");

  // Aggregate by poNo + factoryPO + size, computing Order/Output/Input sums.
  const sql = `
    SELECT
      poNo, factoryPO, size,
      MAX(model) AS model,
      MAX(sku) AS sku,
      MAX(season) AS season,
      MAX(colorCode) AS colorCode,
      MAX(colorCode2) AS colorCode2,
      MAX(painting) AS painting,
      MAX(printingColor) AS printingColor,
      MIN(deadline) AS deadline,
      SUM(CASE WHEN LOWER(shippingStatus) LIKE '1%' OR LOWER(shippingStatus) = 'order' THEN COALESCE(qty1, 0) ELSE 0 END) AS orderQty,
      SUM(CASE WHEN LOWER(shippingStatus) LIKE '2%' OR LOWER(shippingStatus) = 'output' THEN COALESCE(qty1, 0) ELSE 0 END) AS outputQty,
      SUM(CASE WHEN LOWER(shippingStatus) LIKE '4%' OR LOWER(shippingStatus) = 'input' THEN COALESCE(qty1, 0) ELSE 0 END) AS inputQty
    FROM MasterData
    WHERE ${whereClause}
      AND poNo IS NOT NULL AND poNo != ''
      AND factoryPO IS NOT NULL AND factoryPO != ''
      AND size IS NOT NULL AND size != ''
    GROUP BY poNo, factoryPO, size
    ORDER BY colorCode, poNo, factoryPO, size
    LIMIT 2000
  `;
  const rows = await db.$queryRawUnsafe<any[]>(sql, ...params);

  return rows.map((r) => {
    const orderQty = Number(r.orderQty) || 0;
    const outputQty = Number(r.outputQty) || 0;
    const inputQty = Number(r.inputQty) || 0;
    const remainingOutput = orderQty - outputQty;
    const remainingInput = outputQty - inputQty;
    const surplus = Math.max(0, outputQty - orderQty);

    let status: ShipmentGroup["status"];
    if (surplus > 0) status = "SURPLUS";
    else if (remainingOutput > 0) status = "SHORT_OUTPUT";
    else if (orderQty > 0 && outputQty >= orderQty && inputQty >= orderQty) status = "COMPLETE";
    else status = "NO_OUTPUT";

    return {
      key: `${r.poNo}|${r.factoryPO}|${r.size}`,
      productType: filters.productType,
      poNo: r.poNo || "",
      factoryPO: r.factoryPO || "",
      model: r.model || "",
      sku: r.sku || "",
      season: r.season || "",
      colorCode: r.colorCode || "",
      colorCode2: r.colorCode2 || "",
      painting: r.painting || "",
      printingColor: r.printingColor || "",
      size: r.size || "",
      deadline: r.deadline || null,
      orderQty,
      outputQty,
      inputQty,
      remainingOutput,
      remainingInput,
      surplus,
      status,
    };
  });
}

// ===== Get distinct color codes for a product =====
export async function getColorCodes(productType: string): Promise<string[]> {
  const rows = await db.$queryRaw<{ v: string }[]>`
    SELECT DISTINCT colorCode AS v FROM MasterData
    WHERE productType = ${productType} AND colorCode IS NOT NULL AND colorCode != ''
    ORDER BY colorCode
  `;
  return rows.map((r) => r.v);
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
      const db = b.deadline || "9999";
      return da.localeCompare(db);
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
// Supports multiple Factory POs: each unique (model + poNo + factoryPO) becomes
// its own row in the per-color sheets. The summary sheet is enriched with
// Order / Previous Output / Total Output / Remaining from the shipmentGroups
// lookup (if provided).
export async function generateShipmentExcel(
  productType: string,
  selectedColors: string[],
  plannedOutputs: { poNo: string; factoryPO: string; model: string; colorCode: string; size: string; plannedQty: number; deadline: string | null }[],
  templatePath?: string,
  shipmentGroups?: ShipmentGroup[]
): Promise<Buffer> {
  const wb = XLSX.utils.book_new();

  // Try to read template headers for each color. If template read fails,
  // fall back to default size columns (graceful degradation).
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

  for (const color of selectedColors) {
    const tmpl = templates.get(color);
    const sizeColumns = tmpl?.sizeColumns || defaultSizes.map((s) => ({ header: s, normalized: normalizeSize(s) }));

    // Filter planned outputs for this color.
    const colorData = plannedOutputs.filter((p) => p.colorCode === color);

    // Group by (model + poNo + factoryPO) → rows.
    const rowMap = new Map<string, { model: string; colorCode: string; mw: string; poNo: string; factoryPO: string; sizes: Map<string, number>; grandTotal: number }>();
    for (const p of colorData) {
      const rowKey = `${p.model}|${p.poNo}|${p.factoryPO}`;
      if (!rowMap.has(rowKey)) {
        rowMap.set(rowKey, {
          model: p.model || "",
          colorCode: color,
          mw: "", // M/W column (model variant)
          poNo: p.poNo,
          factoryPO: p.factoryPO,
          sizes: new Map<string, number>(),
          grandTotal: 0,
        });
      }
      const row = rowMap.get(rowKey)!;
      const normSize = normalizeSize(p.size);
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

    // Add a header row separator and the data.
    const ws = XLSX.utils.json_to_sheet(rows, { header: headers });
    // Excel sheet names can't contain : \ / ? * [ ] and max 31 chars.
    // Extract the short color code from parentheses if present (e.g. "NEON FLAME /NEON TANGERINE (NMNN)" → "NMNN").
    const colorShort = color.match(/\(([A-Z0-9]+)\)/)?.[1] || color.replace(/[^A-Za-z0-9]/g, "");
    const sheetName = `IN PO ${colorShort}`.slice(0, 31);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }

  // Add DAILY SHIPMENT SUMMARY sheet.
  // Enrich with Order / Previous Output / Remaining from shipmentGroups.
  const groupMap = new Map<string, ShipmentGroup>();
  if (shipmentGroups) {
    const norm = (s: string) => s.replace(/\s+/g, " ").trim();
    for (const g of shipmentGroups) {
      groupMap.set(`${g.poNo}|${g.factoryPO}|${norm(g.size)}`, g);
    }
  }
  const summaryHeaders = ["Date", "Color", "PO NO#", "Factory PO", "Size", "Order", "Previous Output", "Today's Planned Output", "Total Output", "Remaining", "Deadline"];
  const summaryRows: Record<string, string | number>[] = [];
  for (const p of plannedOutputs) {
    const norm = (s: string) => s.replace(/\s+/g, " ").trim();
    const g = groupMap.get(`${p.poNo}|${p.factoryPO}|${norm(p.size)}`);
    const orderQty = g?.orderQty ?? 0;
    const previousOutput = g?.outputQty ?? 0;
    const totalOutput = previousOutput + p.plannedQty;
    const remaining = orderQty - totalOutput;
    summaryRows.push({
      Date: new Date().toISOString().slice(0, 10),
      Color: p.colorCode,
      "PO NO#": p.poNo,
      "Factory PO": p.factoryPO,
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
