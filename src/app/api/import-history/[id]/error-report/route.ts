import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { buildExcelBuffer } from "@/lib/excel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/import-history/[id]/error-report — download an Excel with the invalid rows.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const h = await db.importHistory.findUnique({ where: { id } });
  if (!h) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const errors = JSON.parse(h.errors || "[]") as Array<{
    row: number;
    message: string;
    data?: Record<string, string>;
  }>;
  if (errors.length === 0) {
    return NextResponse.json({ error: "No errors to export" }, { status: 400 });
  }
  // Build an Excel sheet listing row, message, and the row's data columns.
  const rows = errors.map((e) => {
    const flat: Record<string, string | number> = { Row: e.row, Error: e.message };
    if (e.data) {
      for (const [k, v] of Object.entries(e.data)) {
        flat[k] = v;
      }
    }
    return flat;
  });
  // Use a generic column set since the row data keys vary.
  const columns = Array.from(
    new Set(rows.flatMap((r) => Object.keys(r)))
  ) as unknown as import("@/lib/fields").CanonicalField[];
  // buildExcelBuffer expects CanonicalField-typed columns; build manually for flexibility.
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "Errors");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const safeName = h.fileName.replace(/[^\w.-]/g, "_").slice(0, 40);
  return new NextResponse(buf as any, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="errors_${safeName}.xlsx"`,
    },
  });
}
