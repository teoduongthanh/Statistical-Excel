import { NextRequest, NextResponse } from "next/server";
import { getDiagnostic } from "@/lib/project-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// GET /api/recon-v2/projects/[id]/results/[resultId]/diagnostic?runId=PR-...
// Returns the F11 drill-down: side-by-side, match trace, causes, similar cases, actions.
export async function GET(
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
    const diagnostic = await getDiagnostic(runId, resultId);
    return NextResponse.json({ ok: true, diagnostic, runId, resultId });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}
