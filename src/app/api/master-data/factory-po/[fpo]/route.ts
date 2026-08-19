import { NextRequest, NextResponse } from "next/server";
import { lookupFactoryPO } from "@/lib/master-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/master-data/factory-po/[fpo] → shared attributes + sizes list
export async function GET(_req: NextRequest, { params }: { params: Promise<{ fpo: string }> }) {
  const { fpo } = await params;
  const decoded = decodeURIComponent(fpo);
  const group = await lookupFactoryPO(decoded);
  if (!group) {
    return NextResponse.json({ error: "Factory PO not found" }, { status: 404 });
  }
  return NextResponse.json(group);
}
