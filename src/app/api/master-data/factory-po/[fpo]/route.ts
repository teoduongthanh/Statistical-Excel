import { NextRequest, NextResponse } from "next/server";
import { lookupFactoryPO } from "@/lib/master-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/master-data/factory-po/[fpo]?productType=MAFATE
// Product isolation: productType ensures the lookup doesn't cross products.
export async function GET(req: NextRequest, { params }: { params: Promise<{ fpo: string }> }) {
  const { fpo } = await params;
  const decoded = decodeURIComponent(fpo);
  const { searchParams } = new URL(req.url);
  const productType = searchParams.get("productType") || undefined;
  const group = await lookupFactoryPO(decoded, productType);
  if (!group) {
    return NextResponse.json({ error: "Factory PO not found" }, { status: 404 });
  }
  return NextResponse.json(group);
}
