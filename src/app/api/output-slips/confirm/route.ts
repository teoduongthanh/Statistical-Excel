import { NextRequest, NextResponse } from "next/server";
import { confirmOutputSlip } from "@/lib/output-slip-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/output-slips/confirm
// Confirms an Output Slip: re-validates Remaining Output (conflict check),
// then creates the real 2.Output entries in EntryData (atomic transaction).
// Pending is NOT stored (calculated dynamically as -Output).
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { slipId: string; confirmedBy?: string };
    if (!body.slipId) {
      return NextResponse.json({ ok: false, error: "slipId is required" }, { status: 400 });
    }
    const result = await confirmOutputSlip(body.slipId, body.confirmedBy);
    if (!result.ok) {
      return NextResponse.json({ ok: false, errors: result.errors }, { status: 400 });
    }
    return NextResponse.json({ ok: true, slip: result.slip, createdCount: result.createdCount });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Confirm failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
