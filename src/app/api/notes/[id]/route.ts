import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkPerm } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PUT /api/notes/[id] — update note content / date.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const perm = await checkPerm("notes:write");
  if (!perm.ok) return NextResponse.json({ error: perm.error }, { status: perm.status });
  const body = (await req.json()) as { content?: string; noteDate?: string };
  const data: any = {};
  if (body.content !== undefined) data.content = body.content.trim();
  if (body.noteDate) data.noteDate = new Date(body.noteDate);
  const updated = await db.orderNote.update({ where: { id }, data });
  return NextResponse.json({
    ...updated,
    noteDate: updated.noteDate.toISOString(),
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
  });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const perm = await checkPerm("notes:write");
  if (!perm.ok) return NextResponse.json({ error: perm.error }, { status: perm.status });
  await db.orderNote.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
