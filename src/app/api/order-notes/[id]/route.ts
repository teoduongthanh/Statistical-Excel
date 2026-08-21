import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PUT /api/order-notes/[id] — update a note
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const existing = await db.orderNote.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const updated = await db.orderNote.update({
    where: { id },
    data: {
      content: body.content ?? existing.content,
      noteDate: body.noteDate ?? existing.noteDate,
      poNo: body.poNo ?? existing.poNo,
    },
  });
  return NextResponse.json(updated);
}

// DELETE /api/order-notes/[id]
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await db.orderNote.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
