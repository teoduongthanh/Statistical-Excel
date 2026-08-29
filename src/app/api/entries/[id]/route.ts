import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { deleteEntryWithGroup, deleteEntryGroup } from "@/lib/entry-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface UpdateBody {
  factoryPO?: string;
  size?: string;
  qty1?: string;
  shippingStatus?: string;
  autoCalcQty2?: boolean;
  note?: string;
  model?: string;
  sku?: string;
  poNo?: string;
  season?: string;
  colorCode?: string;
  colorCode2?: string;
  painting?: string;
  printingColor?: string;
  deadline?: string;
}

// PUT /api/entries/[id] — update an entry.
// If shippingStatus changes, qty2 is recomputed via the same status rules.
// Editing entries NEVER mutates Master Data (spec §41).
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json()) as UpdateBody;
  const existing = await db.entryData.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const updateData: any = {};
  if (body.factoryPO !== undefined) updateData.factoryPO = body.factoryPO.trim();
  if (body.size !== undefined) updateData.size = body.size.trim();
  if (body.note !== undefined) updateData.note = body.note;

  // If qty1 or shippingStatus changed, recompute qty2 using the same status rules.
  // qty1/qty2 are stored as Int — convert string input to number.
  const newStatus = body.shippingStatus ?? existing.shippingStatus ?? "";
  const rawQty1 = body.qty1 ?? existing.qty1 ?? 0;
  const newQty1 = typeof rawQty1 === "number" ? rawQty1 : parseInt(String(rawQty1), 10) || 0;
  if (body.qty1 !== undefined || body.shippingStatus !== undefined) {
    // Import computeQty2 inline to avoid circular import.
    const { computeQty2 } = await import("@/lib/entry-service");
    updateData.qty1 = newQty1;
    updateData.shippingStatus = newStatus;
    updateData.qty2 = computeQty2(newStatus, newQty1);
  }

  // Apply direct field overrides (manual edits, never touch Master Data).
  for (const f of ["model", "sku", "poNo", "season", "colorCode", "colorCode2", "painting", "printingColor", "deadline"] as const) {
    if (body[f] !== undefined) updateData[f] = body[f];
  }

  const updated = await db.entryData.update({ where: { id }, data: updateData });
  return NextResponse.json({ ok: true, entry: updated });
}

// DELETE /api/entries/[id]
// If the entry is part of an Output+Pending transaction group, returns needsConfirm
// so the UI can prompt "Delete both?". Pass ?forceGroup=true to delete both atomically.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const forceGroup = searchParams.get("forceGroup") === "true";

  if (forceGroup) {
    const result = await deleteEntryGroup(id);
    return NextResponse.json({ ok: result.ok, deleted: result.deleted });
  }

  const result = await deleteEntryWithGroup(id);
  if (result.needsConfirm) {
    return NextResponse.json({
      ok: false,
      needsConfirm: result.needsConfirm,
    }, { status: 409 });
  }
  return NextResponse.json({ ok: result.ok });
}
