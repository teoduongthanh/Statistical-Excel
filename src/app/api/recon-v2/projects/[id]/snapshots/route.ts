import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getProject, ensureProjectSources } from "@/lib/project-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/recon-v2/projects/[id]/snapshots — list snapshots for a project.
// Optional query: ?sourceId=xxx to filter by source.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const project = await getProject(id);
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
    await ensureProjectSources(id, project);

    const { searchParams } = new URL(req.url);
    const sourceId = searchParams.get("sourceId");
    const sources = await db.reconDataSource.findMany({ where: { projectId: id } });
    const targetSourceIds = sourceId ? [sourceId] : sources.map((s) => s.id);

    const snapshots = await db.reconSnapshot.findMany({
      where: { dataSourceId: { in: targetSourceIds } },
      orderBy: { fetchedAt: "desc" },
      take: 100,
    });
    // Attach dataSource name for UI.
    const sourceMap = new Map(sources.map((s) => [s.id, s.name]));
    const enriched = snapshots.map((s) => ({
      ...s,
      dataSourceName: sourceMap.get(s.dataSourceId) ?? "—",
    }));
    return NextResponse.json({ ok: true, snapshots: enriched, sources });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}
