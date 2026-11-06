import { NextRequest, NextResponse } from "next/server";
import { getBatch, updateBatch, deleteBatch, recomputeBatchTotals } from "@/lib/entry-batch-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/entry-batches/[id]?includeRows=true
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const includeRows = searchParams.get("includeRows") === "true";
  const batch = await getBatch(id, includeRows);
  if (!batch) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(batch);
}

// PUT /api/entry-batches/[id] — update note / isClosed / recompute totals
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  // If requested, recompute denormalized totals from linked entries.
  if (body.recompute) {
    await recomputeBatchTotals(id);
  }
  const batch = await updateBatch(id, {
    note: body.note,
    isClosed: body.isClosed,
  });
  if (!batch) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true, batch });
}

// DELETE /api/entry-batches/[id] — soft-delete
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await deleteBatch(id);
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
