import { NextRequest, NextResponse } from "next/server";
import { resolveResultRow } from "@/lib/project-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/recon-v2/projects/[id]/results/[resultId]/resolve?runId=PR-...
// Body: { resolved?: boolean, note?: string, assignedTo?: string, user?: string }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; resultId: string }> }
) {
  try {
    const { id, resultId } = await params;
    const { searchParams } = new URL(req.url);
    let runId = searchParams.get("runId");
    if (!runId) {
      const { db } = await import("@/lib/db");
      const project = await db.reconProject.findUnique({ where: { id } });
      runId = project?.lastRunId ?? undefined;
    }
    if (!runId) {
      return NextResponse.json({ error: "runId is required (or project has no lastRunId)" }, { status: 400 });
    }
    const body = await req.json().catch(() => ({}));
    const updated = await resolveResultRow(runId, resultId, {
      resolved: body.resolved,
      note: body.note,
      assignedTo: body.assignedTo,
    }, body.user);
    return NextResponse.json({ ok: true, row: updated });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}
