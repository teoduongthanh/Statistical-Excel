import { NextRequest, NextResponse } from "next/server";
import { validateBulkData, type BulkValidationInput } from "@/lib/bulk-validation-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/bulk-validation
// Validates a batch of pasted Excel rows WITHOUT writing to the database.
// Returns the full validation result: summary, per-row results, grouped errors,
// current DB totals, and final simulated totals after all rows are applied.
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

    // Cap at 1000 rows for performance (spec §37).
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
