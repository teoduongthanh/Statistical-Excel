import { NextRequest, NextResponse } from "next/server";
import {
  getShipmentGroups,
  type ShipmentFilters,
} from "@/lib/shipment-planning-service";
import {
  detectSurplusTransfers,
  getSurplusSources,
} from "@/lib/surplus-transfer-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/shipment-planning/surplus?productType=MAFATE&date=&colorCode=&poNo=&factoryPO=
// Returns surplus sources + transfer proposals for the active filter scope.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const productType = searchParams.get("productType") || "";
  if (!productType) {
    return NextResponse.json(
      { error: "productType is required" },
      { status: 400 }
    );
  }

  const filters: ShipmentFilters = {
    productType,
    date: searchParams.get("date") || undefined,
    colorCode: searchParams.get("colorCode") || undefined,
    poNo: searchParams.get("poNo") || undefined,
    factoryPO: searchParams.get("factoryPO") || undefined,
  };

  const groups = await getShipmentGroups(filters);
  const proposals = detectSurplusTransfers(groups);
  const surplusSources = getSurplusSources(groups);

  return NextResponse.json({
    proposals,
    surplusSources,
  });
}
