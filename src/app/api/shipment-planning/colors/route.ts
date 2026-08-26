import { NextRequest, NextResponse } from "next/server";
import { getColorCodes } from "@/lib/shipment-planning-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/shipment-planning/colors?productType=MAFATE
// Returns the unique color codes extracted from the "Color Code" field.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const productType = searchParams.get("productType") || "";
  if (!productType) {
    return NextResponse.json(
      { error: "productType is required" },
      { status: 400 }
    );
  }
  const colors = await getColorCodes(productType);
  return NextResponse.json(colors);
}
