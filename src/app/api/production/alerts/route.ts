import { NextRequest, NextResponse } from "next/server";
import { getTopAlerts, type AggregationFilters } from "@/lib/aggregation-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/production/alerts?productType=MAFATE&limit=20
// Returns top-priority alerts (overdue, deadline today, output shortage, quantity mismatch).
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
  };
  const limit = Math.min(50, Math.max(1, Number(searchParams.get("limit") || "20")));
  const alerts = await getTopAlerts(filters, limit);
  return NextResponse.json({
    total: alerts.length,
    high: alerts.filter((a) => a.alert.priority === "HIGH").length,
    medium: alerts.filter((a) => a.alert.priority === "MEDIUM").length,
    low: alerts.filter((a) => a.alert.priority === "LOW").length,
    alerts,
  });
}
