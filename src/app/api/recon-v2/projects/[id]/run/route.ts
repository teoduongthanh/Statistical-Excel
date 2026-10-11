import { NextRequest, NextResponse } from "next/server";
import { runProjectReconciliation } from "@/lib/project-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/recon-v2/projects/[id]/run — run reconciliation (reuses engine F1–F9).
// Body: { trigger?: "manual" | "auto" | "scheduled", user?: string }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    let body: any = {};
    try { body = await req.json(); } catch { /* allow empty body */ }
    const trigger = body?.trigger === "auto" || body?.trigger === "scheduled" ? body.trigger : "manual";
    const user = body?.user ?? null;
    const result = await runProjectReconciliation(id, trigger, user);
    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}
