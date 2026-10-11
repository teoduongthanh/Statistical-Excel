import { NextRequest, NextResponse } from "next/server";
import { getProjectResults, type ResultFilters } from "@/lib/project-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/recon-v2/projects/[id]/results?runId=&status=&page=&pageSize=
// Note: runId is required — this is the V2 project runId (PR-YYYYMMDD-NNN).
// If no runId is provided we fall back to the project's lastRunId.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const filters: ResultFilters = {
      status: searchParams.get("status") || undefined,
      page: Math.max(1, Number(searchParams.get("page") || "1")),
      pageSize: Math.min(500, Number(searchParams.get("pageSize") || "50")),
    };
    let runId = searchParams.get("runId") ?? undefined;
    if (!runId) {
      // Resolve from project's lastRunId.
      const { db } = await import("@/lib/db");
      const project = await db.reconProject.findUnique({ where: { id } });
      if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
      runId = project.lastRunId ?? undefined;
    }
    if (!runId) {
      return NextResponse.json({
        ok: true,
        runId: null,
        rows: [],
        total: 0,
        summary: null,
        page: filters.page,
        pageSize: filters.pageSize,
        totalPages: 0,
      });
    }
    const result = await getProjectResults(runId, filters);
    const totalPages = Math.max(1, Math.ceil(result.total / filters.pageSize!));
    return NextResponse.json({
      ok: true,
      runId,
      rows: result.rows,
      total: result.total,
      summary: result.summary,
      page: filters.page,
      pageSize: filters.pageSize,
      totalPages,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}
