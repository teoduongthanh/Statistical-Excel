import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import * as XLSX from "xlsx";
import { normalizeSize, extractColorCode } from "@/lib/shipment-planning-service";
import { formatDeadline } from "@/lib/quantity-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/shipment-planning/export
// Generates a Daily Shipment Excel file with:
//   - One sheet per selected color code: "IN PO [Color]"
//   - A "DAILY SHIPMENT SUMMARY" sheet
//
// Sheet format (IN PO [Color]):
//   Header: MODEL, COLOR, M/W, PO, FAC PO, [Size columns...], Grand Total
//   Data:   one row per (model + color + poNo + factoryPO), planned qty in matching size col
//
// Dynamic headers: size columns are collected from the actual data — not hard-coded.
interface ExportBody {
  productType: string;
  date?: string;
  colorCodes?: string[]; // selected color codes to export
  plannedOutputs?: Record<string, number>; // key = "poNo|factoryPO|size|colorCode" → planned qty
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ExportBody;
    if (!body.productType) {
      return NextResponse.json({ error: "productType is required" }, { status: 400 });
    }

    // Fetch all MasterData rows for the selected product, grouped by the shipment key.
    const conditions: string[] = ["productType = ?"];
    const params: any[] = [body.productType];
    if (body.date) {
      conditions.push("date = ?");
      params.push(body.date);
    }

    // Aggregate by (poNo + factoryPO + size + colorCode) — same as shipment groups.
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
      WHERE ${conditions.join(" AND ")}
        AND poNo IS NOT NULL AND poNo != ''
        AND factoryPO IS NOT NULL AND factoryPO != ''
        AND size IS NOT NULL AND size != ''
      GROUP BY poNo, factoryPO, size, colorCode, colorCode2
      LIMIT 10000
    `;
    const rows = await db.$queryRawUnsafe<any[]>(sql, ...params);

    // Determine which color codes to export.
    const selectedColors = body.colorCodes && body.colorCodes.length > 0
      ? body.colorCodes
      : [...new Set(rows.map((r) => extractColorCode(r.colorCode)).filter(Boolean))];

    // Build the workbook.
    const wb = XLSX.utils.book_new();

    // ===== IN PO [Color] sheets =====
    for (const colorCode of selectedColors) {
      // Filter rows for this color code.
      const colorRows = rows.filter((r) => extractColorCode(r.colorCode) === colorCode);
      if (colorRows.length === 0) continue;

      // Collect all unique sizes for this color (dynamic — not hard-coded).
      const sizeSet = new Map<string, string>(); // normalizedSize → originalSize
      for (const r of colorRows) {
        const norm = normalizeSize(r.size);
        if (!sizeSet.has(norm)) sizeSet.set(norm, r.size);
      }
      const sizeColumns = [...sizeSet.keys()];

      // Group by (model + color + poNo + factoryPO) → one row per group.
      const rowGroups = new Map<string, {
        model: string;
        color: string;
        mw: string;
        poNo: string;
        factoryPO: string;
        sizes: Map<string, { orderQty: number; outputQty: number; remainingOutput: number; plannedQty: number; deadline: string | null }>;
      }>();

      for (const r of colorRows) {
        const model = r.model || "";
        const color = r.colorCode || "";
        const mw = model; // M/W column = model
        const poNo = r.poNo;
        const factoryPO = r.factoryPO;
        const key = `${model}|${color}|${poNo}|${factoryPO}`;
        const normSize = normalizeSize(r.size);

        if (!rowGroups.has(key)) {
          rowGroups.set(key, {
            model, color, mw, poNo, factoryPO,
            sizes: new Map(),
          });
        }
        const g = rowGroups.get(key)!;
        const orderQty = Number(r.orderQty) || 0;
        const outputQty = Number(r.outputQty) || 0;
        const remainingOutput = orderQty - outputQty;

        // Get planned qty from the request body.
        const planKey = `${poNo}|${factoryPO}|${normSize}|${color}`;
        const plannedQty = body.plannedOutputs?.[planKey] ?? 0;

        if (!g.sizes.has(normSize)) {
          g.sizes.set(normSize, {
            orderQty: 0,
            outputQty: 0,
            remainingOutput: 0,
            plannedQty: 0,
            deadline: null,
          });
        }
        const s = g.sizes.get(normSize)!;
        s.orderQty += orderQty;
        s.outputQty += outputQty;
        s.remainingOutput += remainingOutput;
        s.plannedQty += plannedQty;
        s.deadline = r.nearestDeadline || s.deadline;
      }

      // Build sheet data.
      const header = ["MODEL", "COLOR", "M/W", "PO", "FAC PO", ...sizeColumns, "Grand Total"];
      const data: (string | number)[][] = [header];

      for (const g of rowGroups.values()) {
        const row: (string | number)[] = [
          g.model,
          extractColorCode(g.color),
          g.mw,
          g.poNo,
          g.factoryPO,
        ];
        let grandTotal = 0;
        for (const sizeCol of sizeColumns) {
          const s = g.sizes.get(sizeCol);
          const planned = s?.plannedQty ?? 0;
          row.push(planned);
          grandTotal += planned;
        }
        row.push(grandTotal);
        data.push(row);
      }

      const ws = XLSX.utils.aoa_to_sheet(data);
      const sheetName = `IN PO ${colorCode}`.slice(0, 31); // Excel sheet name max 31 chars
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    }

    // ===== DAILY SHIPMENT SUMMARY sheet =====
    const summaryHeader = [
      "Date", "Color", "PO NO#", "Factory PO", "Size",
      "Order", "Previous Output", "Today's Planned Output",
      "Total Output", "Remaining", "Deadline",
    ];
    const summaryData: (string | number)[][] = [summaryHeader];
    const today = body.date || new Date().toISOString().slice(0, 10);

    for (const r of rows) {
      const orderQty = Number(r.orderQty) || 0;
      const outputQty = Number(r.outputQty) || 0;
      const remainingOutput = orderQty - outputQty;
      const normSize = normalizeSize(r.size);
      const planKey = `${r.poNo}|${r.factoryPO}|${normSize}|${r.colorCode}`;
      const plannedQty = body.plannedOutputs?.[planKey] ?? 0;
      if (plannedQty === 0 && remainingOutput <= 0) continue;

      summaryData.push([
        today,
        extractColorCode(r.colorCode),
        r.poNo,
        r.factoryPO,
        r.size,
        orderQty,
        outputQty, // previous output
        plannedQty, // today's planned
        outputQty + plannedQty, // total output
        Math.max(0, remainingOutput - plannedQty), // remaining after plan
        formatDeadline(r.nearestDeadline),
      ]);
    }
    const summaryWs = XLSX.utils.aoa_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(wb, summaryWs, "DAILY SHIPMENT SUMMARY");

    // Generate the buffer.
    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const fileName = `Daily_Shipment_${today}.xlsx`;
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Shipment export failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
