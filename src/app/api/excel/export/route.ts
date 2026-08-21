import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { buildExcelBuffer } from "@/lib/excel";
import type { CanonicalField } from "@/lib/fields";
import { ALL_FIELDS } from "@/lib/fields";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ExportBody {
  source: "entries" | "master";
  columns?: CanonicalField[];
  mode?: "all" | "filtered" | "selected";
  ids?: string[];
  filters?: Record<string, string>;
  sortOrder?: "asc" | "desc"; // default: asc (chronological)
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ExportBody;
    const columns = body.columns?.length ? body.columns : ALL_FIELDS;
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
      // Sort by createdAt ascending (chronological: Data1, Data2, Data3)
      rows = await db.entryData.findMany({
        where,
        take: 50000,
        orderBy: { createdAt: sortOrder },
      });
    }

    const buffer = buildExcelBuffer(rows, columns);
    return new NextResponse(buffer, {
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
