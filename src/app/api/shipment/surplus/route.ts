import { NextRequest, NextResponse } from "next/server";
import { getSurplusTransfers } from "@/lib/shipment-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/shipment/surplus?productType=MAFATE
// Detects Factory POs with surplus (Output > Order) and suggests transfers
// to Factory POs with remaining capacity (same PO NO# + Color + Size).
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const productType = searchParams.get("productType") || "";
  if (!productType) {
    return NextResponse.json({ error: "productType is required" }, { status: 400 });
  }
  const proposals = await getSurplusTransfers(productType);
  return NextResponse.json({
    total: proposals.length,
    totalTransferable: proposals.reduce((sum, p) => sum + p.totalTransferable, 0),
    proposals,
  });
}
