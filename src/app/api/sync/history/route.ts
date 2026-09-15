import { NextRequest, NextResponse } from "next/server";
import { getSyncHistory } from "@/lib/sync-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/sync/history?limit=20
// Returns recent SyncRun records (completed sync batches).
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit") || "20")));
    const history = await getSyncHistory(limit);
    return NextResponse.json({ ok: true, history });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
