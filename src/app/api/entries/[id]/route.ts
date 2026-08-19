import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PUT /api/entries/[id] — update an entry (re-lookup shared data if factoryPO/size changed).
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const existing = await db.entryData.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const factoryPO = (body.factoryPO ?? existing.factoryPO).trim();
  const size = (body.size ?? existing.size).trim();
  const qty1 = (body.qty1 ?? existing.qty1).toString().trim();
  const autoCalcQty2 = body.autoCalcQty2 ?? true;

  // Re-lookup shared data if factoryPO changed.
  let updateData: any = { factoryPO, size, qty1 };
  if (factoryPO !== existing.factoryPO) {
    const group = await db.masterGroup.findUnique({ where: { factoryPO } });
    if (!group) return NextResponse.json({ ok: false, errors: ["Factory PO not found in Master Data"] }, { status: 400 });
    updateData = {
      ...updateData,
      date: group.date,
      shippingStatus: group.shippingStatus,
      model: group.model,
      sku: group.sku,
      poNo: group.poNo,
      item: group.item,
      season: group.season,
      colorCode: group.colorCode,
      colorCode2: group.colorCode2,
      painting: group.painting,
      printingColor: group.printingColor,
      deadline: group.deadline,
    };
  }
  if (autoCalcQty2) {
    const n = Number(qty1);
    updateData.qty2 = isNaN(n) ? existing.qty2 : String(-Math.abs(n));
  }

  const updated = await db.entryData.update({ where: { id }, data: updateData });
  return NextResponse.json({ ok: true, entry: updated });
}

// DELETE /api/entries/[id]
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await db.entryData.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
