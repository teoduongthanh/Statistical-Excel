import { NextRequest, NextResponse } from "next/server";
import { aggregateByDimension, type AggregationFilters } from "@/lib/aggregation-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/production/by-dimension?productType=MAFATE&dimension=size
// Returns Order/Output/Input aggregations grouped by a single dimension.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const productType = searchParams.get("productType") || "";
  const dimension = (searchParams.get("dimension") || "size") as
    | "size" | "colorCode" | "model" | "poNo" | "factoryPO" | "season" | "shippingStatus";
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
    dateFrom: searchParams.get("dateFrom") || undefined,
    dateTo: searchParams.get("dateTo") || undefined,
  };
  const rows = await aggregateByDimension(filters, dimension);
  return NextResponse.json({ dimension, rows });
}
