import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getServerSession } from "next-auth";
import { authOptions, can } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/users — list all users (admin only).
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || !can((session.user as any)?.role, "users:read")) {
    return NextResponse.json({ error: "Forbidden — admin access required" }, { status: 403 });
  }
  const users = await db.user.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true, name: true, role: true, createdAt: true },
  });
  return NextResponse.json({ users });
}

// POST /api/users — create user (admin only).
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !can((session.user as any)?.role, "users:write")) {
    return NextResponse.json({ error: "Forbidden — admin access required" }, { status: 403 });
  }
  const bcrypt = await import("bcryptjs");
  const body = await req.json();
  const { email, password, name, role } = body;
  if (!email || !password) {
    return NextResponse.json({ error: "Email and password required" }, { status: 400 });
  }
  const existing = await db.user.findUnique({ where: { email: email.toLowerCase().trim() } });
  if (existing) {
    return NextResponse.json({ error: "Email already registered" }, { status: 409 });
  }
  const passwordHash = await bcrypt.default.hash(password, 10);
  const assignedRole = ["admin", "operator", "viewer"].includes(role) ? role : "viewer";
  const user = await db.user.create({
    data: {
      email: email.toLowerCase().trim(),
      name: name || null,
      passwordHash,
      role: assignedRole,
    },
    select: { id: true, email: true, name: true, role: true, createdAt: true },
  });
  return NextResponse.json({ ok: true, user });
}
