import { NextRequest, NextResponse } from "next/server";
import {
  createProject,
  listProjects,
  ensureDefaultProjectSeeded,
  type CreateProjectInput,
} from "@/lib/project-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/recon-v2/projects — list projects (auto-seeds default on first call).
// Query: ?status=active|archived|template
export async function GET(req: NextRequest) {
  try {
    await ensureDefaultProjectSeeded();
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status") || undefined;
    const projects = await listProjects(status);
    return NextResponse.json({ ok: true, projects });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}

// POST /api/recon-v2/projects — create a new project.
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as CreateProjectInput;
    if (!body.name) return NextResponse.json({ error: "name is required" }, { status: 400 });
    const project = await createProject(body);
    return NextResponse.json({ ok: true, project });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}
