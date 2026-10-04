import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/entry-staging/list
// Query: productType?, limit (default 20)
// Returns the most recent EntryBatch records (any status).
// Returns: { ok, batches }
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const productType = searchParams.get("productType") || undefined;
    let limit = parseInt(searchParams.get("limit") || "20", 10);
    if (!Number.isFinite(limit) || limit < 1) limit = 20;
    if (limit > 200) limit = 200;

    const where: { productType?: string } = {};
    if (productType) where.productType = productType;

    const batches = await db.entryBatch.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return NextResponse.json({
      ok: true,
      batches: batches.map((b) => ({
        id: b.id,
        batchId: b.batchId,
        productType: b.productType,
        createdBy: b.createdBy ?? "",
        status: b.status,
        totalRows: b.totalRows,
        validRows: b.validRows,
        warningRows: b.warningRows,
        errorRows: b.errorRows,
        reviewedRows: b.reviewedRows,
        importedRows: b.importedRows,
        createdAt: b.createdAt.toISOString(),
        importedAt: b.importedAt?.toISOString() ?? null,
      })),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to list batches";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
