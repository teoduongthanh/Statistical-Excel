import { NextRequest, NextResponse } from "next/server";
import { getFactoryPOsByColor } from "@/lib/shipment-planning-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/shipment-planning/factory-pos?productType=MAFATE&colorCode=NMNN
// Returns the unique Factory POs that have rows for a given color code.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const productType = searchParams.get("productType") || "";
  const colorCode = searchParams.get("colorCode") || "";
  if (!productType) {
    return NextResponse.json(
      { error: "productType is required" },
      { status: 400 }
    );
  }
  if (!colorCode) {
    return NextResponse.json(
      { error: "colorCode is required" },
      { status: 400 }
    );
  }
  const factoryPOs = await getFactoryPOsByColor(productType, colorCode);
  return NextResponse.json(factoryPOs);
}
