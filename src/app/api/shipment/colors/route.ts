import { NextRequest, NextResponse } from "next/server";
import { getColorCodes } from "@/lib/shipment-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/shipment/colors?productType=MAFATE
// Returns distinct color codes for the product, used in the Color dropdown.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const productType = searchParams.get("productType") || "";
  if (!productType) {
    return NextResponse.json({ error: "productType is required" }, { status: 400 });
  }
  const colors = await getColorCodes(productType);
  return NextResponse.json({ colors });
}
