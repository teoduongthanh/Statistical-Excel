import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/recon-v2/projects/[id]/runs — list run history for a project.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const runs = await db.projectRun.findMany({
      where: { projectId: id },
      orderBy: { startedAt: "desc" },
      take: 50,
    });
    return NextResponse.json({ ok: true, runs });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}
