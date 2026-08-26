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
    colorCode: searchParams.get("colorCode") || undefined,
    size: searchParams.get("size") || undefined,
  };
  const result = await getReportGroups(filters);
  return NextResponse.json({ errors: result.errors, total: result.errors.length });
}
