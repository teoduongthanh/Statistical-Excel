import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { listSlips } from "@/lib/output-slip-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/output-slips?productType=&poNo=&status=&limit=
// List output slips (filtered).
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const productType = searchParams.get("productType") || undefined;
    const poNo = searchParams.get("poNo") || undefined;
    const status = searchParams.get("status") || undefined;
    const limit = Number(searchParams.get("limit") || "50");
    const slips = await listSlips({ productType, poNo, status: status as any, limit });
    return NextResponse.json({ ok: true, slips });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "List failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

// POST /api/output-slips — alias for create (calls the generate logic inline).
// Kept for simple direct creation without going through /generate.
export async function POST(req: NextRequest) {
  return NextResponse.json(
    { ok: false, error: "Use POST /api/output-slips/generate to create a slip" },
    { status: 400 }
  );
}
