import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { getServerSession } from "next-auth";
import { authOptions, can } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/auth/register — create a new user (admin only, or bootstrap if no users exist).
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { email, password, name, role } = body as {
    email: string; password: string; name?: string; role?: string;
  };
  if (!email || !password) {
    return NextResponse.json({ error: "Email and password required" }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
  }
  // Bootstrap: allow creating first admin if no users exist.
  const userCount = await db.user.count();
  const session = await getServerSession(authOptions);
  if (userCount > 0) {
    if (!session || !can((session.user as any)?.role, "users:write")) {
      return NextResponse.json({ error: "Forbidden — admin access required" }, { status: 403 });
    }
  }
  const existing = await db.user.findUnique({ where: { email: email.toLowerCase().trim() } });
  if (existing) {
    return NextResponse.json({ error: "Email already registered" }, { status: 409 });
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const assignedRole = userCount === 0 ? "admin" : (role || "viewer");
  if (!["admin", "operator", "viewer"].includes(assignedRole)) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }
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
