import { NextRequest, NextResponse } from "next/server";
import { getPendingSyncSummary } from "@/lib/sync-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/sync/pending?productType=MAFATE
// Returns the pending sync summary for the UI banner.
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const productType = searchParams.get("productType") || undefined;
    const summary = await getPendingSyncSummary(productType || undefined);
    return NextResponse.json({ ok: true, ...summary });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
