import { NextRequest, NextResponse } from "next/server";
import { reconcileData, type ReconciliationInput } from "@/lib/reconciliation-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/reconcile
// Compares imported Excel data with Website MasterData within a date range.
// READ-ONLY — never writes data. Returns comparison results + summary.
//
// Body: { productType, dateFrom, dateTo, excelRows: [...] }
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ReconciliationInput;

    if (!body.productType) {
      return NextResponse.json({ ok: false, error: "productType is required" }, { status: 400 });
    }
    if (!body.dateFrom || !body.dateTo) {
      return NextResponse.json({ ok: false, error: "dateFrom and dateTo are required" }, { status: 400 });
    }
    if (!Array.isArray(body.excelRows)) {
      return NextResponse.json({ ok: false, error: "excelRows must be an array" }, { status: 400 });
    }
    if (body.excelRows.length > 10000) {
      return NextResponse.json({ ok: false, error: "Maximum 10,000 Excel rows per reconciliation" }, { status: 400 });
    }

    const result = await reconcileData(body);
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Reconciliation failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
