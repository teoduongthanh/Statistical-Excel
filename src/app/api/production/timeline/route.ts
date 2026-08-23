import { NextRequest, NextResponse } from "next/server";
import { productionByDate, type AggregationFilters } from "@/lib/aggregation-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/production/timeline?productType=MAFATE&statusBucket=output
// Returns production-by-date series for charts.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const productType = searchParams.get("productType") || "";
  const statusBucket = (searchParams.get("statusBucket") || "output") as "order" | "output" | "input";
  if (!productType) {
    return NextResponse.json({ error: "productType is required" }, { status: 400 });
  }
  const filters: AggregationFilters = {
    productType,
    factoryPO: searchParams.get("factoryPO") || undefined,
    poNo: searchParams.get("poNo") || undefined,
  };
  const series = await productionByDate(filters, statusBucket);
  return NextResponse.json({ statusBucket, series });
}
