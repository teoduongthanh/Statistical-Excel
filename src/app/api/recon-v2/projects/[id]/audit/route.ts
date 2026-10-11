import { NextRequest, NextResponse } from "next/server";
import { getProjectAudit } from "@/lib/project-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/recon-v2/projects/[id]/audit — audit log for a project.
// Query: ?limit=100
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const limit = Math.min(500, Number(searchParams.get("limit") || "100"));
    const audit = await getProjectAudit(id, limit);
    return NextResponse.json({ ok: true, audit });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}
