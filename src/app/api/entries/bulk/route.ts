import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createEntry } from "@/lib/master-service";
import { deleteEntryGroup } from "@/lib/entry-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface BulkItem {
  factoryPO: string;
  size: string;
  qty1: string;
  productType?: string;
}
interface BulkBody {
  items: BulkItem[];
  autoCalcQty2?: boolean;
  productType?: string;
}

// POST /api/entries/bulk — create many entries, returning per-item results + error report.
export async function POST(req: NextRequest) {
  const body = (await req.json()) as BulkBody;
  const autoCalcQty2 = body.autoCalcQty2 ?? true;
  const globalProductType = body.productType;
  const results: { index: number; ok: boolean; entry?: any; errors?: string[]; input: BulkItem }[] = [];

  for (let i = 0; i < body.items.length; i++) {
    const it = body.items[i];
    const productType = it.productType || globalProductType;
    const r = await createEntry(
      { factoryPO: it.factoryPO, size: it.size, qty1: it.qty1 },
      { autoCalcQty2, productType }
    );
    if (r.ok) {
      results.push({ index: i, ok: true, entry: r.entry, input: it });
    } else {
      results.push({ index: i, ok: false, errors: r.errors, input: it });
    }
  }

  return NextResponse.json({
    ok: true,
    total: body.items.length,
    success: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  });
}

// DELETE /api/entries/bulk — delete many entries by IDs (atomic transaction).
// If an entry belongs to an Output+Pending transaction group, both records are deleted.
// Body: { ids: string[] }
export async function DELETE(req: NextRequest) {
  try {
    const body = (await req.json()) as { ids: string[] };
    if (!body.ids || !Array.isArray(body.ids) || body.ids.length === 0) {
      return NextResponse.json(
        { ok: false, error: "ids array is required and must not be empty" },
        { status: 400 }
      );
    }
    if (body.ids.length > 500) {
      return NextResponse.json(
        { ok: false, error: "Cannot delete more than 500 entries at once" },
        { status: 400 }
      );
    }

    const deleted: string[] = [];
    const skipped: { id: string; reason: string }[] = [];

    await db.$transaction(async (tx) => {
      // Find selected entries + their transaction group IDs.
      const selected = await tx.entryData.findMany({
        where: { id: { in: body.ids } },
        select: { id: true, transactionGroupId: true },
      });
      const foundIds = new Set(selected.map((e) => e.id));
      const txGroupIds = selected
        .map((e) => e.transactionGroupId)
        .filter((g): g is string => !!g);

      // Collect all IDs to delete: found selected ones + siblings sharing a tx group.
      const allIds = new Set<string>(foundIds);
      if (txGroupIds.length > 0) {
        const siblings = await tx.entryData.findMany({
          where: { transactionGroupId: { in: txGroupIds } },
          select: { id: true },
        });
        siblings.forEach((s) => allIds.add(s.id));
      }

      // Delete all collected IDs in one query.
      if (allIds.size > 0) {
        await tx.entryData.deleteMany({
          where: { id: { in: [...allIds] } },
        });
      }
      // Track which requested IDs were actually deleted vs not found.
      for (const id of body.ids) {
        if (foundIds.has(id)) {
          deleted.push(id);
        } else {
          skipped.push({ id, reason: "not found" });
        }
      }
    });

    return NextResponse.json({
      ok: true,
      requested: body.ids.length,
      deleted: deleted.length,
      skipped: skipped.length,
      deletedIds: deleted,
      skippedIds: skipped,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Bulk delete failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
