import { NextRequest, NextResponse } from "next/server";
import {
  getProject,
  updateProject,
  deleteProject,
  archiveProject,
  restoreProject,
  ensureProjectSources,
  type CreateProjectInput,
} from "@/lib/project-service";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/recon-v2/projects/[id] — fetch a single project (includes sources).
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const project = await getProject(id);
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
    await ensureProjectSources(id, project);
    const sources = await db.reconDataSource.findMany({
      where: { projectId: id },
      orderBy: { createdAt: "asc" },
    });
    return NextResponse.json({ ok: true, project, sources });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}

// PATCH /api/recon-v2/projects/[id] — update project (auto-saved, audit-logged).
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = (await req.json()) as Partial<CreateProjectInput> & { status?: string };
    const project = await updateProject(id, body);
    return NextResponse.json({ ok: true, project });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}

// DELETE /api/recon-v2/projects/[id] — soft delete (archive) by default.
// Query: ?hard=true to hard-delete (only if already archived).
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const hard = searchParams.get("hard") === "true";
    if (hard) {
      const project = await getProject(id);
      if (project && project.status !== "archived") {
        await archiveProject(id);
      }
    }
    await deleteProject(id);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}

// PUT /api/recon-v2/projects/[id]?action=archive|restore — archive/restore.
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const action = searchParams.get("action");
    if (action === "archive") {
      const project = await archiveProject(id);
      return NextResponse.json({ ok: true, project });
    }
    if (action === "restore") {
      const project = await restoreProject(id);
      return NextResponse.json({ ok: true, project });
    }
    return NextResponse.json({ error: "Unknown action; use ?action=archive|restore" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}
