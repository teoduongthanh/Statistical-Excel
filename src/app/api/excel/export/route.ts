import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { buildExcelBuffer } from "@/lib/excel";
import type { CanonicalField } from "@/lib/fields";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Fixed export column order per spec §24, §27. NEVER change this order.
// Date, Shipping status, MODEL, SKU, PO NO#, Factory PO, ITEM, Season,
// Color Code, COLOR CODE, PAINTING, PRINTING COLOR, Size, Q'ty 1, Q'ty 2, Dead Line
const EXPORT_COLUMNS: CanonicalField[] = [
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
];

interface ExportBody {
  source: "entries" | "master";
  columns?: CanonicalField[]; // optional override; defaults to fixed EXPORT_COLUMNS
  mode?: "all" | "filtered" | "selected";
  ids?: string[];
  filters?: Record<string, string>;
  sortOrder?: "asc" | "desc"; // default: asc (insertion/chronological order, spec §25)
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ExportBody;
    // Per spec §24: if no columns specified, use the fixed 16-column order.
    // User can still override with a custom column list if they explicitly pass it.
    const columns = body.columns?.length ? body.columns : EXPORT_COLUMNS;
    // Default sort: createdAt ASC (preserve insertion order, spec §25).
    const sortOrder = body.sortOrder === "desc" ? "desc" : "asc";

    let rows: any[] = [];
    if (body.source === "master") {
      const where = buildWhere(body.filters);
      rows = await db.masterData.findMany({
        where,
        orderBy: [{ factoryPO: "asc" }, { size: "asc" }],
        take: 50000,
      });
    } else {
      const where =
        body.mode === "selected" && body.ids?.length
          ? { id: { in: body.ids } }
          : buildEntryWhere(body.filters);
      // Preserve insertion order by createdAt (spec §25: don't re-sort unless user asks).
      rows = await db.entryData.findMany({
        where,
        take: 50000,
        orderBy: { createdAt: sortOrder },
      });
    }

    const buffer = buildExcelBuffer(rows, columns);
    return new NextResponse(buffer as any, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="export_${new Date().toISOString().slice(0, 10)}.xlsx"`,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Export failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

function buildWhere(filters?: Record<string, string>) {
  if (!filters) return {};
  const where: any = {};
  for (const [k, v] of Object.entries(filters)) {
    if (v && k !== "mode" && k !== "sortOrder") {
      if (typeof where.AND === "undefined") where.AND = [];
      where.AND.push({ [k]: { contains: v } });
    }
  }
  return where;
}

function buildEntryWhere(filters?: Record<string, string>) {
  if (!filters) return {};
  const where: any = {};
  for (const [k, v] of Object.entries(filters)) {
    if (v && k !== "mode" && k !== "sortOrder") {
      if (typeof where.AND === "undefined") where.AND = [];
      where.AND.push({ [k]: { contains: v } });
    }
  }
  return where;
}
