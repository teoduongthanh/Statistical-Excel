import { NextRequest, NextResponse } from "next/server";
import { previewEntry } from "@/lib/entry-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/entries/preview
// Validates input, looks up Master Data, computes Qty1/Qty2, prepares paired Pending
// for Output — but does NOT write to the database. Returns a preview for user CONFIRM.
export async function POST(req: NextRequest) {
  const body = await req.json();
  if (!body.productType) {
    return NextResponse.json(
      { ok: false, errors: ["productType is required"] },
      { status: 400 }
    );
  }
  const preview = await previewEntry({
    productType: body.productType,
    shippingStatus: body.shippingStatus || "",
    poNo: body.poNo || "",
    factoryPO: body.factoryPO || "",
    size: body.size || "",
    qty: body.qty ?? body.qty1 ?? "",
  });
  return NextResponse.json(preview);
}
