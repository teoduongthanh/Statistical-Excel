import { NextRequest, NextResponse } from "next/server";
import { getShipmentGroups, type ShipmentFilters } from "@/lib/shipment-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/shipment/groups?productType=MAFATE&colorCode=NMNN&poNo=...&factoryPO=...&...
// Returns groups of (PO NO# + Factory PO + Size) with Order/Output/Input/Remaining/Surplus.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const productType = searchParams.get("productType") || "";
  if (!productType) {
    return NextResponse.json({ error: "productType is required" }, { status: 400 });
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
  const groups = await getShipmentGroups(filters);
  return NextResponse.json({
    total: groups.length,
    shortOutput: groups.filter((g) => g.status === "SHORT_OUTPUT").length,
    surplus: groups.filter((g) => g.status === "SURPLUS").length,
    complete: groups.filter((g) => g.status === "COMPLETE").length,
    groups,
  });
}
