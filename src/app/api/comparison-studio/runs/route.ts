import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/comparison-studio/runs?limit=20 — list past comparison runs.
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.min(Number(searchParams.get("limit") || "20"), 100);
    const profileId = searchParams.get("profileId") || undefined;

    const runs = await db.comparisonRun.findMany({
      where: profileId ? { profileId } : undefined,
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return NextResponse.json({ ok: true, runs, total: runs.length });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message }, { status: 500 });
  }
}
