import { NextRequest, NextResponse } from "next/server";
import { runSync } from "@/lib/sync-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/sync/run
// Runs synchronization for all pending change events (optionally scoped to a product).
// Body: { productType?: string, triggeredBy?: string }
// Returns the SyncRun result with validation errors.
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { productType?: string; triggeredBy?: string };
    const result = await runSync(body.productType, body.triggeredBy);
    if (!result.ok) {
      return NextResponse.json({ ok: false, errors: result.errors }, { status: 500 });
    }
    // Strip the `ok` field from result to avoid duplicate keys when spreading.
    const { ok, ...rest } = result;
    return NextResponse.json({ ok: true, ...rest });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Sync run failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
