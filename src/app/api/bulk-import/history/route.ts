import { NextRequest, NextResponse } from "next/server";
import { getBulkImportHistory } from "@/lib/bulk-import-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/bulk-import/history
// Returns the history of bulk imports (from AuditLog where action=ENTRY_CREATE
// and entityId starts with "BULK-").
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit") || "50")));
    const history = await getBulkImportHistory(limit);
    return NextResponse.json({ ok: true, history });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to fetch history";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
