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

// PUT /api/shipment-batch/[id] — update a planned shipment batch.
// Body: partial of { plannedQty, status, note, deadline, remainingQty, ... }
// If plannedQty is being changed, re-validate against remainingQty (remainingOutput).
// Implemented via raw SQL so the route works even when the dev server is
// holding a stale Prisma Client singleton.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();

  const rows = await db.$queryRawUnsafe<ShipmentBatchRow[]>(
    `SELECT id, productType, batchNumber, date, colorCode, poNo, factoryPO,
            model, sku, season, size, orderQty, previousOutput, plannedQty,
            remainingQty, deadline, status, note, createdAt, updatedAt
       FROM ShipmentBatch WHERE id = ?`,
    id
  );
  if (rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const existing = rows[0];

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

  await db.$executeRawUnsafe(
    `UPDATE ShipmentBatch
        SET plannedQty = ?, remainingQty = ?, status = ?, note = ?, deadline = ?,
            updatedAt = CURRENT_TIMESTAMP
      WHERE id = ?`,
    plannedQty,
    remainingQty,
    status,
    note,
    deadline,
    id
  );

  const updatedRows = await db.$queryRawUnsafe<ShipmentBatchRow[]>(
    `SELECT id, productType, batchNumber, date, colorCode, poNo, factoryPO,
            model, sku, season, size, orderQty, previousOutput, plannedQty,
            remainingQty, deadline, status, note, createdAt, updatedAt
       FROM ShipmentBatch WHERE id = ?`,
    id
  );

  return NextResponse.json({ ok: true, batch: updatedRows[0] ?? null });
}

// DELETE /api/shipment-batch/[id] — delete a planned shipment batch.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rows = await db.$queryRawUnsafe<{ id: string }[]>(
    `SELECT id FROM ShipmentBatch WHERE id = ?`,
    id
  );
  if (rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  await db.$executeRawUnsafe(`DELETE FROM ShipmentBatch WHERE id = ?`, id);
  return NextResponse.json({ ok: true });
}
