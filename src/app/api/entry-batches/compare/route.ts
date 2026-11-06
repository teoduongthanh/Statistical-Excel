import { NextRequest, NextResponse } from "next/server";
import { compareBatches, getTimePeriodStats } from "@/lib/entry-batch-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/entry-batches/compare?batchId1=&batchId2=&dimension=poNo|factoryPO|colorCode|size
// OR /api/entry-batches/compare?productType=&dateFrom=&dateTo=  (time-period stats)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const batchId1 = searchParams.get("batchId1");
  const batchId2 = searchParams.get("batchId2");
  const dimension = (searchParams.get("dimension") || "size") as "poNo" | "factoryPO" | "colorCode" | "size";

  // Comparison mode
  if (batchId1 && batchId2) {
    const result = await compareBatches(batchId1, batchId2, dimension);
    if (!result) return NextResponse.json({ error: "Batch(es) not found" }, { status: 404 });
    return NextResponse.json(result);
  }

  // Time-period stats mode
  const productType = searchParams.get("productType");
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");
  if (productType && dateFrom && dateTo) {
    const result = await getTimePeriodStats(productType, dateFrom, dateTo);
    return NextResponse.json(result);
  }

  return NextResponse.json(
    { error: "Provide either (batchId1 + batchId2 + dimension) or (productType + dateFrom + dateTo)" },
    { status: 400 }
  );
}
