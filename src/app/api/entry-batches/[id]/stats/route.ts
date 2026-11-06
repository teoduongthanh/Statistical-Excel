import { NextRequest, NextResponse } from "next/server";
import { getBatchStats } from "@/lib/entry-batch-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/entry-batches/[id]/stats — breakdown by model/PO/factoryPO/color/size
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const stats = await getBatchStats(id);
  if (!stats) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(stats);
}
