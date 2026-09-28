import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import * as XLSX from "xlsx";
import { normalizeSize, extractColorCode } from "@/lib/shipment-planning-service";
import {
  classifyShippingStatus,
  parseDeadline,
} from "@/lib/quantity-service";
import { formatDeadline } from "@/lib/excel";

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

    // Build Prisma where. Always product-scoped.
    const where: Record<string, unknown> = {
      productType: body.productType,
      poNo: { not: null, not: "" },
      factoryPO: { not: null, not: "" },
      size: { not: null, not: "" },
    };
    if (body.date) where.date = body.date;

    const rows = await db.masterData.findMany({
      where,
      select: {
        poNo: true, factoryPO: true, size: true,
        colorCode: true, colorCode2: true,
        model: true, sku: true, season: true,
        deadline: true, shippingStatus: true, qty1: true,
      },
    });

    // Group by (poNo + factoryPO + normalizeSize + colorCode + colorCode2) — same as shipment groups.
    type GroupAgg = {
      poNo: string; factoryPO: string; size: string;
      colorCode: string; colorCode2: string;
      model: string; sku: string; season: string;
      nearestDeadline: Date | null;
      orderQty: number; outputQty: number;
      pendingQty: number; inputQty: number;
    };
    const groupsMap = new Map<string, GroupAgg>();

    for (const r of rows) {
      const poNo = r.poNo ?? "";
      const fpo = r.factoryPO ?? "";
      const sz = r.size ?? "";
      const cc = r.colorCode ?? "";
      const cc2 = r.colorCode2 ?? "";
      const normSize = normalizeSize(sz);
      const key = `${poNo}|${fpo}|${normSize}|${cc}|${cc2}`;
      if (!groupsMap.has(key)) {
        groupsMap.set(key, {
          poNo, factoryPO: fpo, size: sz,
          colorCode: cc, colorCode2: cc2,
          model: r.model ?? "", sku: r.sku ?? "", season: r.season ?? "",
          nearestDeadline: null,
          orderQty: 0, outputQty: 0,
          pendingQty: 0, inputQty: 0,
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
      else if (bucket === "pending") g.pendingQty += q;
      else if (bucket === "input") g.inputQty += q;
    }

    // Convert to array (LIMIT 10000) — sorted by colorCode for stable order.
    const aggRows = [...groupsMap.values()]
      .sort((a, b) => a.colorCode.localeCompare(b.colorCode))
      .slice(0, 10000)
      .map((g) => ({
        ...g,
        nearestDeadlineStr: g.nearestDeadline ? g.nearestDeadline.toISOString().slice(0, 10) : null,
      }));

    // Determine which color codes to export.
    const selectedColors = body.colorCodes && body.colorCodes.length > 0
      ? body.colorCodes
      : [...new Set(aggRows.map((r) => extractColorCode(r.colorCode)).filter(Boolean))];

    // Build the workbook.
    const wb = XLSX.utils.book_new();

    // ===== IN PO [Color] sheets =====
    for (const colorCode of selectedColors) {
      // Filter rows for this color code.
      const colorRows = aggRows.filter((r) => extractColorCode(r.colorCode) === colorCode);
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
        const orderQty = r.orderQty;
        const outputQty = r.outputQty;
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
        s.deadline = r.nearestDeadlineStr || s.deadline;
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

    for (const r of aggRows) {
      const orderQty = r.orderQty;
      const outputQty = r.outputQty;
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
        formatDeadline(r.nearestDeadlineStr),
      ]);
    }
    const summaryWs = XLSX.utils.aoa_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(wb, summaryWs, "DAILY SHIPMENT SUMMARY");

    // Generate the buffer.
    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const fileName = `Daily_Shipment_${today}.xlsx`;
    return new NextResponse(buffer as any, {
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
