import { NextRequest, NextResponse } from "next/server";
import { getReportGroups, buildReportExcel, type ReportFilters } from "@/lib/report-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.productType) return NextResponse.json({ error: "productType is required" }, { status: 400 });
    const filters: ReportFilters = {
      productType: body.productType,
      poNo: body.poNo, factoryPO: body.factoryPO,
      colorCode: body.colorCode, size: body.size,
    };
    const result = await getReportGroups(filters);
    const buffer = buildReportExcel(result.groups, result.errors);
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="Production_Report_${new Date().toISOString().slice(0,10)}.xlsx"`,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Export failed" }, { status: 500 });
  }
}
