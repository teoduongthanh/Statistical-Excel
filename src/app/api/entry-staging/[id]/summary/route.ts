import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/entry-staging/[id]/summary
// Returns the batch record + per-status row counts.
// Returns: { ok, batch, counts: { total, valid, warning, error, reviewed, pending } }
export async function GET(
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

    const batch = await db.entryBatch.findUnique({ where: { id } });
    if (!batch) {
      return NextResponse.json(
        { ok: false, error: "Batch not found" },
        { status: 404 }
      );
    }

    // Group-count rows by validationStatus (only non-imported rows).
    const grouped = await db.entryStagingRow.groupBy({
      by: ["validationStatus"],
      where: { batchId: id, imported: false },
      _count: { _all: true },
    });

    const counts: Record<string, number> = {
      total: 0,
      valid: 0,
      warning: 0,
      error: 0,
      reviewed: 0,
      pending: 0,
    };
    for (const g of grouped) {
      const key = (g.validationStatus || "PENDING").toLowerCase();
      const n = g._count?._all ?? 0;
      counts[key] = (counts[key] ?? 0) + n;
      counts.total += n;
    }

    // Also include imported count for completeness.
    const importedCount = await db.entryStagingRow.count({
      where: { batchId: id, imported: true },
    });

    return NextResponse.json({
      ok: true,
      batch: {
        id: batch.id,
        batchId: batch.batchId,
        productType: batch.productType,
        status: batch.status,
        totalRows: batch.totalRows,
        validRows: batch.validRows,
        warningRows: batch.warningRows,
        errorRows: batch.errorRows,
        reviewedRows: batch.reviewedRows,
        importedRows: batch.importedRows,
        createdBy: batch.createdBy,
        createdAt: batch.createdAt.toISOString(),
        importedAt: batch.importedAt?.toISOString() ?? null,
      },
      counts: {
        ...counts,
        imported: importedCount,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load summary";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
