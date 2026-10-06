import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/comparison-studio/[runId]/summary — return the run's summary stats.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const { runId } = await params;
    const run = await db.comparisonRun.findUnique({ where: { runId } });
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

    const summary = {
      runId: run.runId,
      profileId: run.profileId,
      profileName: run.profileName,
      profileVersion: run.profileVersion,
      sourceDataset: run.sourceDataset,
      targetDataset: run.targetDataset,
      filters: JSON.parse(run.filters || "{}"),
      totalCompared: run.totalCompared,
      matchedCount: run.matchedCount,
      mismatchCount: run.mismatchCount,
      missingSource: run.missingSource,
      missingTarget: run.missingTarget,
      ambiguousCount: run.ambiguousCount,
      shortageCount: run.shortageCount,
      overageCount: run.overageCount,
      sourceTotalQty: run.sourceTotalQty,
      targetTotalQty: run.targetTotalQty,
      totalDifference: run.totalDifference,
      matchPercentage: run.matchPercentage,
      status: run.status,
      error: run.error,
      duration: run.duration,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      createdAt: run.createdAt,
    };
    return NextResponse.json({ ok: true, summary, run });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message }, { status: 500 });
  }
}
