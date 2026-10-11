import { NextRequest, NextResponse } from "next/server";
import { getProjectNotifications } from "@/lib/project-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/recon-v2/projects/[id]/notifications — list project notifications.
// Query: ?limit=50
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const limit = Math.min(200, Number(searchParams.get("limit") || "50"));
    const notifications = await getProjectNotifications(id, limit);
    return NextResponse.json({ ok: true, notifications });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}
