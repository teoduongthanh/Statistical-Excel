import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, getRoleOrDemo } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/auth/me — current session info (includes demo mode flag).
export async function GET() {
  const session = await getServerSession(authOptions);
  if (session?.user) {
    return NextResponse.json({
      user: {
        id: (session.user as any).id,
        email: session.user.email,
        name: session.user.name,
        role: (session.user as any).role,
      },
      demo: false,
    });
  }
  // Demo mode: no session, but if no users exist the server treats as admin.
  const { role, demo } = await getRoleOrDemo();
  return NextResponse.json({
    user: null,
    demo,
    role: demo ? role : null,
  });
}
