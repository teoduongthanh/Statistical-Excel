import { NextRequest, NextResponse } from "next/server";
import { getComparisonResults, type ResultFilters } from "@/lib/comparison-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/comparison-studio/[runId]/results?status=&poNo=&factoryPO=&size=&page=1&pageSize=50
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const { runId } = await params;
    const { searchParams } = new URL(req.url);
    const filters: ResultFilters = {
      status: searchParams.get("status") || undefined,
      poNo: searchParams.get("poNo") || undefined,
      factoryPO: searchParams.get("factoryPO") || undefined,
      size: searchParams.get("size") || undefined,
      page: Math.max(1, Number(searchParams.get("page") || "1")),
      pageSize: Math.min(500, Number(searchParams.get("pageSize") || "50")),
    };

    const result = await getComparisonResults(runId, filters);
    const totalPages = Math.max(1, Math.ceil(result.total / filters.pageSize!));
    return NextResponse.json({
      ok: true,
      rows: result.rows,
      total: result.total,
      page: filters.page,
      pageSize: filters.pageSize,
      totalPages,
      summary: result.summary,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message }, { status: 500 });
  }
}
