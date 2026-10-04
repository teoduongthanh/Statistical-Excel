import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createBatch } from "@/lib/staging-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/entry-staging/create-from-entries
// Body: {
//   productType: string,
//   createdBy?: string,
//   filters?: {
//     dateFrom?: string,
//     dateTo?: string,
//     shippingStatus?: string, // "1.Order" | "2.Output" | "3.Pending" | "4.Input"
//     poNo?: string,
//     factoryPO?: string,
//     size?: string,
//     limit?: number, // default 500, max 5000
//   }
// }
//
// Creates a staging batch from EXISTING EntryData rows (no copy-paste needed).
// Useful for re-validating already-entered data against current MasterData.
//
// The EntryData rows are converted to TSV format and fed to createBatch(),
// so the same normalization + auto-fill + validation pipeline runs.
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      productType?: string;
      createdBy?: string;
      filters?: {
        dateFrom?: string;
        dateTo?: string;
        shippingStatus?: string;
        poNo?: string;
        factoryPO?: string;
        size?: string;
        limit?: number;
      };
    };

    if (!body.productType) {
      return NextResponse.json(
        { ok: false, error: "productType is required" },
        { status: 400 }
      );
    }

    const filters = body.filters ?? {};
    const limit = Math.min(Math.max(filters.limit ?? 500, 1), 5000);

    // Build where clause from filters
    const where: any = { productType: body.productType };
    if (filters.shippingStatus) {
      where.shippingStatus = filters.shippingStatus;
    }
    if (filters.poNo) {
      where.poNo = { contains: filters.poNo };
    }
    if (filters.factoryPO) {
      where.factoryPO = { contains: filters.factoryPO };
    }
    if (filters.size) {
      where.size = { contains: filters.size };
    }
    // Date filter on EntryData.date (yyyy-MM-dd string)
    if (filters.dateFrom || filters.dateTo) {
      where.date = {};
      if (filters.dateFrom) where.date.gte = filters.dateFrom;
      if (filters.dateTo) where.date.lte = filters.dateTo;
    }

    // Fetch EntryData rows
    const entries = await db.entryData.findMany({
      where,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: limit,
      select: {
        shippingStatus: true,
        date: true,
        poNo: true,
        factoryPO: true,
        size: true,
        qty1: true,
        deadline: true,
      },
    });

    if (entries.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "No EntryData rows found matching the filters.",
          matchedCount: 0,
        },
        { status: 404 }
      );
    }

    // Convert to TSV text (same format as parseBulkText expects):
    //   status \t po \t factoryPO \t size \t qty \t date \t deadline
    const lines: string[] = [];
    for (const e of entries) {
      const status = e.shippingStatus ?? "";
      const po = e.poNo ?? "";
      const fpo = e.factoryPO ?? "";
      const size = e.size ?? "";
      const qty = String(e.qty1 ?? 0);
      const date = e.date ?? "";
      const deadline = e.deadline ?? "";
      lines.push([status, po, fpo, size, qty, date, deadline].join("\t"));
    }
    const text = lines.join("\n");

    // Create staging batch via the same pipeline as paste-based creation
    const result = await createBatch(
      body.productType,
      text,
      body.createdBy ?? "ui-from-entries"
    );

    return NextResponse.json({
      ok: true,
      ...result,
      sourceCount: entries.length,
      filters,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to create batch from entries";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
