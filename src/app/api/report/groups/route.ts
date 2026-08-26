import { NextRequest, NextResponse } from "next/server";
import { getReportGroups, type ReportFilters } from "@/lib/report-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const productType = searchParams.get("productType") || "";
  if (!productType) return NextResponse.json({ error: "productType is required" }, { status: 400 });
  const filters: ReportFilters = {
    productType,
    poNo: searchParams.get("poNo") || undefined,
    factoryPO: searchParams.get("factoryPO") || undefined,
    model: searchParams.get("model") || undefined,
    sku: searchParams.get("sku") || undefined,
    season: searchParams.get("season") || undefined,
    colorCode: searchParams.get("colorCode") || undefined,
    size: searchParams.get("size") || undefined,
    dateFrom: searchParams.get("dateFrom") || undefined,
    dateTo: searchParams.get("dateTo") || undefined,
  };
  const result = await getReportGroups(filters);
  return NextResponse.json(result);
}
