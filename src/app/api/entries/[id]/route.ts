import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface UpdateBody {
  factoryPO?: string;
  size?: string;
  qty1?: string;
  autoCalcQty2?: boolean;
  note?: string;
  // Allow direct field edits for manual override
  model?: string;
  sku?: string;
  poNo?: string;
  season?: string;
  colorCode?: string;
  colorCode2?: string;
  painting?: string;
  printingColor?: string;
  shippingStatus?: string;
  deadline?: string;
}

// PUT /api/entries/[id] — update an entry.
// If factoryPO changes, re-lookup shared data from MasterGroup.
// If only qty1/size/note change, keep existing shared data.
// Direct field overrides (model, sku, etc.) take priority.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json()) as UpdateBody;
  const existing = await db.entryData.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const factoryPO = (body.factoryPO ?? existing.factoryPO).trim();
  const size = (body.size ?? existing.size).trim();
  const qty1 = (body.qty1 ?? existing.qty1).toString().trim();
  const autoCalcQty2 = body.autoCalcQty2 ?? true;

  let updateData: any = { factoryPO, size, qty1 };

  // Re-lookup shared data if factoryPO changed.
  if (factoryPO !== existing.factoryPO) {
    const group = await db.masterGroup.findUnique({ where: { factoryPO } });
    if (!group) {
      return NextResponse.json(
        { ok: false, errors: ["Factory PO not found in Master Data"] },
        { status: 400 }
      );
    }
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
      productType: group.productType,
    };
  }

  // Auto-calc Qty2.
  if (autoCalcQty2) {
    const n = Number(qty1);
    updateData.qty2 = isNaN(n) ? existing.qty2 : String(-Math.abs(n));
  } else if (body.qty1 !== undefined) {
    updateData.qty2 = existing.qty2;
  }

  // Apply direct field overrides (manual edits take priority).
  const overrideFields: (keyof UpdateBody)[] = [
    "model", "sku", "poNo", "season", "colorCode", "colorCode2",
    "painting", "printingColor", "shippingStatus", "deadline",
  ];
  for (const f of overrideFields) {
    if (body[f] !== undefined) {
      updateData[f] = body[f];
    }
  }

  // Note update.
  if (body.note !== undefined) {
    updateData.note = body.note;
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
