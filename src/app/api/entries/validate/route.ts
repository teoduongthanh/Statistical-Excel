import { NextRequest, NextResponse } from "next/server";
import { validateEntryBeforeSave } from "@/lib/entry-validation-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/entries/validate
// Real-time pre-save validation. Checks existing Order/Output/Input for the
// given product group, simulates new totals, and returns warnings/errors.
// Does NOT save anything — purely read-only validation.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.productType) {
      return NextResponse.json({ error: "productType is required" }, { status: 400 });
    }
    const result = await validateEntryBeforeSave({
      productType: body.productType,
      shippingStatus: body.shippingStatus || "",
      poNo: body.poNo || "",
      factoryPO: body.factoryPO || "",
      size: body.size || "",
      qty: Number(body.qty) || 0,
    });
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Validation failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
