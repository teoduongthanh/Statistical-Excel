import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/reconciliation/[id]/issues?status=&page=1&pageSize=50
// Returns ONLY mismatched/error rows (status != MATCHED). Useful for issue review.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const statusFilter = searchParams.get("status") || "";
    const page = Math.max(1, Number(searchParams.get("page") || "1"));
    const pageSize = Math.min(500, Number(searchParams.get("pageSize") || "50"));

    const run = await db.reconciliationRun.findUnique({ where: { id } });
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

    const where: any = { runId: id, status: { not: "MATCHED" } };
    if (statusFilter) where.status = statusFilter;

    const [rows, total] = await Promise.all([
      db.reconciliationResult.findMany({
        where,
        orderBy: [{ status: "asc" }, { poNo: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.reconciliationResult.count({ where }),
    ]);

    return NextResponse.json({
      ok: true,
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      rows,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
