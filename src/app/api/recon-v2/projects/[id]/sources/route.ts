import { NextRequest, NextResponse } from "next/server";
import { getProjectSources, ensureProjectSources, getProject } from "@/lib/project-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/recon-v2/projects/[id]/sources — list data sources for a project.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const project = await getProject(id);
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
    await ensureProjectSources(id, project);
    const sources = await getProjectSources(id);
    return NextResponse.json({ ok: true, sources });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}
