import { NextRequest, NextResponse } from "next/server";
import { getProductionStats } from "@/lib/master-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/production-stats?productType=&factoryPO=
// Returns production statistics: total ordered, sent (output), received (input),
// completion rate, and breakdowns by product type and Factory PO.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const filters = {
    productType: searchParams.get("productType") || undefined,
    factoryPO: searchParams.get("factoryPO") || undefined,
  };
  const stats = await getProductionStats(filters);
  return NextResponse.json(stats);
}
