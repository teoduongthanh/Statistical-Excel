import { NextRequest, NextResponse } from "next/server";
import { aggregateProduction, type AggregationFilters } from "@/lib/aggregation-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/production/groups?productType=MAFATE&...
// Returns production groups (Order/Output/Input/Processing/Missing per composite key).
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const productType = searchParams.get("productType") || "";
  if (!productType) {
    return NextResponse.json({ error: "productType is required" }, { status: 400 });
  }
  const filters: AggregationFilters = {
    productType,
    factoryPO: searchParams.get("factoryPO") || undefined,
    poNo: searchParams.get("poNo") || undefined,
    model: searchParams.get("model") || undefined,
    sku: searchParams.get("sku") || undefined,
    season: searchParams.get("season") || undefined,
    colorCode: searchParams.get("colorCode") || undefined,
    size: searchParams.get("size") || undefined,
    shippingStatus: searchParams.get("shippingStatus") || undefined,
    dateFrom: searchParams.get("dateFrom") || undefined,
    dateTo: searchParams.get("dateTo") || undefined,
  };
  const groups = await aggregateProduction(filters, ["poNo", "factoryPO", "size"]);
  return NextResponse.json({
    total: groups.length,
    groups,
  });
}
