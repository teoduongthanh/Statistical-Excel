import { NextRequest, NextResponse } from "next/server";
import { syncDataSource } from "@/lib/project-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

// POST /api/recon-v2/projects/[id]/sources/[sourceId]/sync — trigger a sync (F12).
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; sourceId: string }> }
) {
  try {
    const { id, sourceId } = await params;
    const snapshot = await syncDataSource(sourceId);
    return NextResponse.json({ ok: true, projectId: id, sourceId, snapshot });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}
