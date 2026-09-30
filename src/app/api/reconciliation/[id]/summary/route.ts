import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/reconciliation/[id]/summary — return the run's summary stats.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const run = await db.reconciliationRun.findUnique({ where: { id } });
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
    const summary = {
      runId: run.id,
      runNumber: run.runNumber,
      fileName: run.fileName,
      uploadedAt: run.uploadedAt,
      dateFrom: run.dateFrom,
      dateTo: run.dateTo,
      asOfDate: run.asOfDate,
      productType: run.productType,
      status: run.status,
      totalLines: run.totalLines,
      matchedLines: run.matchedLines,
      mismatchLines: run.mismatchLines,
      missingOnWebsite: run.missingOnWebsite,
      missingOnPartner: run.missingOnPartner,
      duplicateLines: run.duplicateLines,
      overOutputLines: run.overOutputLines,
      overInputLines: run.overInputLines,
      dateDiffLines: run.dateDiffLines,
      invalidLines: run.invalidLines,
      totalOrderQty: run.totalOrderQty,
      totalPartnerOut: run.totalPartnerOut,
      totalWebsiteOutput: run.totalWebsiteOutput,
      totalPartnerIn: run.totalPartnerIn,
      totalWebsiteInput: run.totalWebsiteInput,
      previewOrdersCount: run.previewOrdersCount,
      previewSummaryCount: run.previewSummaryCount,
      previewTxCount: run.previewTxCount,
      completedAt: run.completedAt,
    };
    return NextResponse.json({ ok: true, summary });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
