import { NextRequest, NextResponse } from "next/server";
import { getFactoryPOGroupsByPoNo } from "@/lib/output-slip-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/output-slips/factory-pos?productType=MAFATE&poNo=H411351971
// Returns all Factory PO groups for a given PO NO# with per-size Remaining Output.
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const productType = searchParams.get("productType") || "";
    const poNo = searchParams.get("poNo") || "";
    if (!productType || !poNo) {
      return NextResponse.json(
        { ok: false, error: "productType and poNo are required" },
        { status: 400 }
      );
    }
    const groups = await getFactoryPOGroupsByPoNo(productType, poNo);
    return NextResponse.json({ ok: true, groups });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to fetch Factory PO groups";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
