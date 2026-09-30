import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/reconciliation/[id]/details?status=&po=&factoryPo=&size=&model=&dateFrom=&dateTo=&page=1&pageSize=50
// Returns paginated comparison results with optional filters (spec §25).
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status") || "";
    const po = searchParams.get("po") || "";
    const factoryPo = searchParams.get("factoryPo") || "";
    const size = searchParams.get("size") || "";
    const model = searchParams.get("model") || "";
    const page = Math.max(1, Number(searchParams.get("page") || "1"));
    const pageSize = Math.min(500, Number(searchParams.get("pageSize") || "50"));

    const run = await db.reconciliationRun.findUnique({ where: { id } });
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

    const where: any = { runId: id };
    if (status) where.status = status;
    if (po) where.poNo = { contains: po };
    if (factoryPo) where.factoryPO = { contains: factoryPo };
    if (size) where.size = { contains: size };
    if (model) where.model = { contains: model };

    const [rows, total] = await Promise.all([
      db.reconciliationResult.findMany({
        where,
        orderBy: [{ status: "asc" }, { poNo: "asc" }, { factoryPO: "asc" }, { size: "asc" }],
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
