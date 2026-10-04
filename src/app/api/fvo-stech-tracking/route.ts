import { NextRequest, NextResponse } from "next/server";
import { buildTracking } from "@/lib/fvo-stech-tracking-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/fvo-stech-tracking?poNo=&art=&size=&model=&colorCode=&status=&gender=&page=1&pageSize=50
// Returns paginated tracking rows + summary KPIs (spec §10, §14).
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const filters = {
      poNo: searchParams.get("poNo") || undefined,
      art: searchParams.get("art") || undefined,
      size: searchParams.get("size") || undefined,
      model: searchParams.get("model") || undefined,
      colorCode: searchParams.get("colorCode") || undefined,
      status: searchParams.get("status") || undefined,
      gender: searchParams.get("gender") || undefined, // "M" | "W" | ""
      page: Math.max(1, Number(searchParams.get("page") || "1")),
      pageSize: Math.min(500, Number(searchParams.get("pageSize") || "50")),
    };

    const result = await buildTracking(filters);

    return NextResponse.json({
      ok: true,
      page: filters.page,
      pageSize: filters.pageSize,
      total: result.total,
      totalPages: Math.ceil(result.total / filters.pageSize),
      rows: result.rows,
      summary: result.summary,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message }, { status: 500 });
  }
}
