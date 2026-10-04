import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/entry-staging/[id]/rows
// Query params: status (filter by validationStatus), page (1-based), pageSize (default 50, max 200)
// Returns paginated staging rows: { ok, page, pageSize, total, totalPages, rows }
export async function GET(
  req: NextRequest,
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

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status") || undefined;
    let page = parseInt(searchParams.get("page") || "1", 10);
    let pageSize = parseInt(searchParams.get("pageSize") || "50", 10);
    if (!Number.isFinite(page) || page < 1) page = 1;
    if (!Number.isFinite(pageSize) || pageSize < 1) pageSize = 50;
    if (pageSize > 200) pageSize = 200;

    // Validate the status filter value against known enum values.
    const allowedStatuses = new Set([
      "PENDING",
      "VALID",
      "WARNING",
      "ERROR",
      "REVIEWED",
    ]);
    const where: { batchId: string; imported: boolean; validationStatus?: string } = {
      batchId: id,
      imported: false,
    };
    if (status && allowedStatuses.has(status.toUpperCase())) {
      where.validationStatus = status.toUpperCase();
    }

    const [total, rows] = await Promise.all([
      db.entryStagingRow.count({ where }),
      db.entryStagingRow.findMany({
        where,
        orderBy: { rowNumber: "asc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    return NextResponse.json({
      ok: true,
      page,
      pageSize,
      total,
      totalPages,
      rows: rows.map((r) => ({
        id: r.id,
        rowNumber: r.rowNumber,
        shippingStatus: r.shippingStatus ?? "",
        date: r.date ?? "",
        poNo: r.poNo ?? "",
        factoryPO: r.factoryPO ?? "",
        size: r.size ?? "",
        qty: r.qty,
        deadline: r.deadline ?? "",
        model: r.model ?? "",
        sku: r.sku ?? "",
        item: r.item ?? "",
        season: r.season ?? "",
        colorCode: r.colorCode ?? "",
        colorCode2: r.colorCode2 ?? "",
        painting: r.painting ?? "",
        printingColor: r.printingColor ?? "",
        autoFillSource: r.autoFillSource ?? "",
        matchedOrderKey: r.matchedOrderKey ?? "",
        validationStatus: r.validationStatus,
        validationErrors: r.validationErrors ? JSON.parse(r.validationErrors) : [],
        warningAccepted: r.warningAccepted,
        warningAcceptedBy: r.warningAcceptedBy ?? "",
        warningAcceptedReason: r.warningAcceptReason ?? "",
        warningAcceptedAt:
          r.warningAcceptedAt instanceof Date
            ? r.warningAcceptedAt.toISOString()
            : r.warningAcceptedAt ?? null,
        rawData: r.rawData ?? "{}",
        imported: r.imported,
        importedEntryId: r.importedEntryId ?? null,
      })),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load rows";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
