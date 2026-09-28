import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ShipmentBatchRow {
  id: string;
  productType: string;
  batchNumber: string;
  date: string;
  colorCode: string;
  poNo: string;
  factoryPO: string;
  model: string | null;
  sku: string | null;
  season: string | null;
  size: string;
  orderQty: number;
  previousOutput: number;
  plannedQty: number;
  remainingQty: number;
  deadline: string | null;
  status: string;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

function toRow(b: {
  id: string;
  productType: string;
  batchNumber: string;
  date: string;
  colorCode: string;
  poNo: string;
  factoryPO: string;
  model: string | null;
  sku: string | null;
  season: string | null;
  size: string;
  orderQty: number;
  previousOutput: number;
  plannedQty: number;
  remainingQty: number;
  deadline: string | null;
  status: string;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
}): ShipmentBatchRow {
  return {
    id: b.id,
    productType: b.productType,
    batchNumber: b.batchNumber,
    date: b.date,
    colorCode: b.colorCode,
    poNo: b.poNo,
    factoryPO: b.factoryPO,
    model: b.model,
    sku: b.sku,
    season: b.season,
    size: b.size,
    orderQty: b.orderQty,
    previousOutput: b.previousOutput,
    plannedQty: b.plannedQty,
    remainingQty: b.remainingQty,
    deadline: b.deadline,
    status: b.status,
    note: b.note,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  };
}

// PUT /api/shipment-batch/[id] — update a planned shipment batch.
// Body: partial of { plannedQty, status, note, deadline, remainingQty, ... }
// If plannedQty is being changed, re-validate against remainingQty (remainingOutput).
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();

  const existing = await db.shipmentBatch.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const plannedQty =
    body.plannedQty !== undefined ? Number(body.plannedQty) : existing.plannedQty;
  const remainingQty =
    body.remainingQty !== undefined
      ? Number(body.remainingQty)
      : existing.remainingQty;

  if (Number.isNaN(plannedQty) || Number.isNaN(remainingQty)) {
    return NextResponse.json(
      { error: "plannedQty and remainingQty must be numbers" },
      { status: 400 }
    );
  }
  if (plannedQty > remainingQty) {
    return NextResponse.json(
      {
        error: `Planned qty (${plannedQty}) exceeds remaining output (${remainingQty})`,
      },
      { status: 400 }
    );
  }
  if (plannedQty < 0) {
    return NextResponse.json(
      { error: "plannedQty cannot be negative" },
      { status: 400 }
    );
  }

  const allowedStatus = ["DRAFT", "CONFIRMED", "EXPORTED"];
  const status =
    body.status !== undefined ? String(body.status) : existing.status;
  if (!allowedStatus.includes(status)) {
    return NextResponse.json(
      { error: `Invalid status: ${status}` },
      { status: 400 }
    );
  }

  const note = body.note !== undefined ? body.note ?? null : existing.note;
  const deadline =
    body.deadline !== undefined ? body.deadline ?? null : existing.deadline;

  const updated = await db.shipmentBatch.update({
    where: { id },
    data: { plannedQty, remainingQty, status, note, deadline },
  });

  return NextResponse.json({ ok: true, batch: toRow(updated) });
}

// DELETE /api/shipment-batch/[id] — delete a planned shipment batch.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const existing = await db.shipmentBatch.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  await db.shipmentBatch.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
