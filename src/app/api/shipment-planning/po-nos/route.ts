import { NextRequest, NextResponse } from "next/server";
import { getPoNosByColorAndFactory } from "@/lib/shipment-planning-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/shipment-planning/po-nos?productType=MAFATE&colorCode=NMNN&factoryPO=MH26110228
// Returns the unique PO NO#s for a specific color + factory PO.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const productType = searchParams.get("productType") || "";
  const colorCode = searchParams.get("colorCode") || "";
  const factoryPO = searchParams.get("factoryPO") || "";
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
  const poNos = await getPoNosByColorAndFactory(productType, colorCode, factoryPO);
  return NextResponse.json(poNos);
}
