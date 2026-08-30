import { NextRequest, NextResponse } from "next/server";
import { bulkImportEntries, type BulkImportInput } from "@/lib/bulk-import-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/bulk-import
// Performs the actual database INSERT for validated bulk rows.
// Uses a database transaction so the import is atomic.
// Only call this AFTER the user has reviewed validation results and confirmed.
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as BulkImportInput;

    if (!body.productType) {
      return NextResponse.json(
        { ok: false, error: "productType is required" },
        { status: 400 }
      );
    }

    if (!Array.isArray(body.rows) || body.rows.length === 0) {
      return NextResponse.json(
        { ok: false, error: "rows must be a non-empty array" },
        { status: 400 }
      );
    }

    if (body.rows.length > 1000) {
      return NextResponse.json(
        { ok: false, error: "Maximum 1000 rows per import. Please split your data." },
        { status: 400 }
      );
    }

    const result = await bulkImportEntries(body);

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.errors.join("; ") }, { status: 400 });
    }

    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Bulk import failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
