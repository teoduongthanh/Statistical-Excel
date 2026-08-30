import { NextRequest, NextResponse } from "next/server";
import { validateBulkData, type BulkValidationInput } from "@/lib/bulk-validation-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/entries/bulk-validate
// Validates a batch of entry rows (Shipping Status + PO NO# + Factory PO + Size + Qty)
// WITHOUT writing to the database. Runs the full sequential simulation engine:
// required fields, master data lookup, quantity limits (Output vs Order,
// Input vs Output), duplicate detection, deadline checks — all grouped by
// (poNo + factoryPO + size) and simulated in row order so row N's result
// depends on rows 1..N-1.
//
// This endpoint is READ-ONLY. Use POST /api/bulk-import to actually save data.
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as BulkValidationInput;

    if (!body.productType) {
      return NextResponse.json(
        { ok: false, error: "productType is required" },
        { status: 400 }
      );
    }
    if (!Array.isArray(body.rows)) {
      return NextResponse.json(
        { ok: false, error: "rows must be an array" },
        { status: 400 }
      );
    }
    // Cap at 1000 rows for performance.
    if (body.rows.length > 1000) {
      return NextResponse.json(
        { ok: false, error: "Maximum 1000 rows per validation. Please split your data." },
        { status: 400 }
      );
    }

    const result = await validateBulkData(body);
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Bulk validation failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
