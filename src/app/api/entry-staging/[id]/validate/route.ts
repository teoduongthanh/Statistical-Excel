import { NextRequest, NextResponse } from "next/server";
import { validateBatch } from "@/lib/staging-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/entry-staging/[id]/validate
// Auto-fills each staging row from the Order map, then runs full validation
// (structure / order-reference / quantity / duplication / consistency).
// Persists results to EntryStagingRow.validationStatus + validationErrors,
// upserts an EntryValidationRun, and updates EntryBatch summary counts.
// Returns: { ok, runNumber, totalRows, validRows, warningRows, errorRows, reviewedRows }
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json(
        { ok: false, error: "Batch id is required" },
        { status: 400 }
      );
    }

    const result = await validateBatch(id);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Validation failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
