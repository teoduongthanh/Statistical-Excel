import { NextResponse } from "next/server";
import { recomputeQuantityCheck } from "@/lib/master-service";
import { checkPerm } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/quantity-check/recompute — recompute the Order=Input=Output invariant.
export async function POST() {
  const perm = await checkPerm("settings:write");
  if (!perm.ok) return NextResponse.json({ error: perm.error }, { status: perm.status });
  const count = await recomputeQuantityCheck();
  return NextResponse.json({ ok: true, computed: count });
}
