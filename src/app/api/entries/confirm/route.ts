import { NextRequest, NextResponse } from "next/server";
import { confirmEntry, previewEntry } from "@/lib/entry-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/entries/confirm
// Atomic database transaction. For Output, creates BOTH Output + Pending records
// sharing a transactionGroupId. Applies merge logic if an identical entry exists.
export async function POST(req: NextRequest) {
  const body = await req.json();
  if (!body.productType) {
    return NextResponse.json(
      { ok: false, errors: ["productType is required"] },
      { status: 400 }
    );
  }

  const input = {
    productType: body.productType,
    shippingStatus: body.shippingStatus || "",
    poNo: body.poNo || "",
    factoryPO: body.factoryPO || "",
    size: body.size || "",
    qty: body.qty ?? body.qty1 ?? "",
    date: body.date || undefined,
  };

  // Re-preview to get fresh data (spec §39: validate + lookup again).
  const preview = await previewEntry(input);
  if (!preview.ok) {
    return NextResponse.json({ ok: false, errors: preview.errors }, { status: 400 });
  }

  // Atomic confirm.
  const result = await confirmEntry(input, preview);
  if (!result.ok) {
    return NextResponse.json({ ok: false, errors: result.errors }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    created: result.created,
    merged: result.merged,
    preview,
  });
}
