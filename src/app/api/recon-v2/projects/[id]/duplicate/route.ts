import { NextRequest, NextResponse } from "next/server";
import { duplicateProject } from "@/lib/project-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/recon-v2/projects/[id]/duplicate — duplicate a project.
// Body: { name: string }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const newName = body?.name;
    if (!newName) return NextResponse.json({ error: "name is required" }, { status: 400 });
    const project = await duplicateProject(id, String(newName));
    return NextResponse.json({ ok: true, project });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}
