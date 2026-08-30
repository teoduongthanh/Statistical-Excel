import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/output-slips/[id] — fetch a single slip (with parsed items).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const slip = await db.outputSlip.findUnique({ where: { id } });
    if (!slip) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    return NextResponse.json({
      ok: true,
      slip: { ...slip, itemsParsed: JSON.parse(slip.items || "[]") },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

// DELETE /api/output-slips/[id] — cancel a slip (set status to "cancelled").
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const slip = await db.outputSlip.findUnique({ where: { id } });
    if (!slip) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    if (slip.status === "confirmed_output") {
      return NextResponse.json(
        { ok: false, error: "Cannot cancel a confirmed slip (Output entries already created)" },
        { status: 400 }
      );
    }
    const updated = await db.outputSlip.update({
      where: { id },
      data: { status: "cancelled" },
    });
    return NextResponse.json({ ok: true, slip: updated });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Cancel failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
