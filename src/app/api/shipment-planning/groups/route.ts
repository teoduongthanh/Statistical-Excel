import { NextRequest, NextResponse } from "next/server";
import {
  getShipmentGroups,
  getShipmentSummary,
  type ShipmentFilters,
} from "@/lib/shipment-planning-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/shipment-planning/groups?productType=MAFATE&date=&colorCode=&poNo=&factoryPO=&model=&sku=&size=&deadline=
// Returns the grouped shipment rows + summary KPIs for the daily planning view.
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
    model: searchParams.get("model") || undefined,
    sku: searchParams.get("sku") || undefined,
    size: searchParams.get("size") || undefined,
    deadline: searchParams.get("deadline") || undefined,
  };

  // getShipmentSummary internally calls getShipmentGroups, so we re-use its
  // embedded `groups` to avoid a double SQL round-trip.
  const summary = await getShipmentSummary(filters);

  return NextResponse.json({
    groups: summary.groups,
    summary: {
      totalGroups: summary.totalGroups,
      totalOrder: summary.totalOrder,
      totalOutput: summary.totalOutput,
      totalInput: summary.totalInput,
      totalPending: summary.totalPending,
      totalRemainingOutput: summary.totalRemainingOutput,
      totalRemainingInput: summary.totalRemainingInput,
      totalSurplus: summary.totalSurplus,
      shortOutputCount: summary.shortOutputCount,
      surplusCount: summary.surplusCount,
      balancedCount: summary.balancedCount,
    },
  });
}
