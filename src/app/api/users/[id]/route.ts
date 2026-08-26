import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getServerSession } from "next-auth";
import { authOptions, can } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PUT /api/users/[id] — update role/name (admin only).
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  if (!session || !can((session.user as any)?.role, "users:write")) {
    return NextResponse.json({ error: "Forbidden — admin access required" }, { status: 403 });
  }
  const body = await req.json();
  const data: any = {};
  if (body.role && ["admin", "operator", "viewer"].includes(body.role)) data.role = body.role;
  if (body.name !== undefined) data.name = body.name || null;
  const updated = await db.user.update({ where: { id }, data, select: { id: true, email: true, name: true, role: true } });
  return NextResponse.json({ ok: true, user: updated });
}

// DELETE /api/users/[id] — delete user (admin only, can't delete self).
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  if (!session || !can((session.user as any)?.role, "users:write")) {
    return NextResponse.json({ error: "Forbidden — admin access required" }, { status: 403 });
  }
  if ((session.user as any).id === id) {
    return NextResponse.json({ error: "Cannot delete your own account" }, { status: 400 });
  }
  await db.user.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
