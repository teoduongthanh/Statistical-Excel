import { NextRequest, NextResponse } from "next/server";
import { getSizesByColorFactoryPo } from "@/lib/shipment-planning-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/shipment-planning/sizes?productType=MAFATE&colorCode=NMNN&factoryPO=MH26110228&poNo=H411351070
// Returns the unique Sizes for a specific color + factory PO (+ optional PO NO#).
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const productType = searchParams.get("productType") || "";
  const colorCode = searchParams.get("colorCode") || "";
  const factoryPO = searchParams.get("factoryPO") || "";
  const poNo = searchParams.get("poNo") || undefined;
  if (!productType) {
    return NextResponse.json(
      { error: "productType is required" },
      { status: 400 }
    );
  }
  if (!factoryPO) {
    return NextResponse.json(
      { error: "factoryPO is required" },
      { status: 400 }
    );
  }
  const sizes = await getSizesByColorFactoryPo(productType, colorCode, factoryPO, poNo);
  return NextResponse.json(sizes);
}
