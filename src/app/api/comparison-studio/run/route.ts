import { NextRequest, NextResponse } from "next/server";
import { runComparison, type RunFilters } from "@/lib/comparison-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/comparison-studio/run — execute a comparison.
// Body: { profileId: string, filters?: { dateFrom?, dateTo?, poNo?, factoryPO? } }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const profileId = body?.profileId;
    if (!profileId) {
      return NextResponse.json({ error: "profileId is required" }, { status: 400 });
    }
    const filters: RunFilters = {
      dateFrom: body?.filters?.dateFrom,
      dateTo: body?.filters?.dateTo,
      poNo: body?.filters?.poNo,
      factoryPO: body?.filters?.factoryPO,
    };
    const result = await runComparison(profileId, filters);
    return NextResponse.json({
      ok: true,
      runId: result.runId,
      summary: result.summary,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Comparison failed", detail: e?.message },
      { status: 500 }
    );
  }
}
