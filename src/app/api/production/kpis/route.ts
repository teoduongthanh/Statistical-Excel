import { NextRequest, NextResponse } from "next/server";
import { getProductKPIs, type AggregationFilters } from "@/lib/aggregation-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/production/kpis?productType=MAFATE&factoryPO=&poNo=&dateFrom=&dateTo=
// Returns top-level KPIs for the product dashboard.
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
  const kpis = await getProductKPIs(filters);
  return NextResponse.json(kpis);
}
