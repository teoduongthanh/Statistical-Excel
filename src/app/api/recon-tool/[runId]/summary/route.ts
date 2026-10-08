import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/recon-tool/[runId]/summary — KPIs + chart data (F6).
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const { runId } = await params;
    const run = await db.reconToolRun.findUnique({ where: { runId } });
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

    const summary = {
      runId: run.runId,
      profileId: run.profileId,
      profileName: run.profileName,
      sourceDataset: run.sourceDataset,
      targetDataset: run.targetDataset,
      totalLines: run.totalLines,
      statusCounts: {
        MATCHED_OK: run.matchedOk,
        PARTIAL: run.partial,
        OVER: run.over,
        MISSING_OUT: run.missingOut,
        ORPHAN: run.orphan,
        DUP: run.dup,
        ATTR_MISMATCH: run.attrMismatch,
        FMT_FIXED: run.fmtFixed,
        SUSPECT_PO: run.suspectPo,
      },
      sourceTotalQty: run.sourceTotalQty,
      targetTotalQty: run.targetTotalQty,
      totalDifference: run.totalDifference,
      matchPercentage: run.matchPercentage,
      duration: run.duration,
      mode: "aggregate",
      status: run.status,
      error: run.error,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      createdAt: run.createdAt,
    };
    let chartData: any = {};
    try {
      chartData = JSON.parse(run.chartData || "{}");
    } catch { /* ignore */ }
    return NextResponse.json({ ok: true, summary, run, chartData });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message }, { status: 500 });
  }
}
