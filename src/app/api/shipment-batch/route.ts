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

// GET /api/shipment-batch?productType=MAFATE
// List ShipmentBatch rows for a product (most recent first).
// Implemented via raw SQL so the route works even when the dev server is
// holding a stale Prisma Client singleton (without the shipmentBatch accessor).
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const productType = searchParams.get("productType") || "";
  if (!productType) {
    return NextResponse.json(
      { error: "productType is required" },
      { status: 400 }
    );
  }

  const status = searchParams.get("status") || "";
  const date = searchParams.get("date") || "";

  const conditions = ["productType = ?"];
  const params: any[] = [productType];
  if (status) {
    conditions.push("status = ?");
    params.push(status);
  }
  if (date) {
    conditions.push("date = ?");
    params.push(date);
  }
  const whereClause = conditions.join(" AND ");

  const rows = await db.$queryRawUnsafe<ShipmentBatchRow[]>(
    `SELECT id, productType, batchNumber, date, colorCode, poNo, factoryPO,
            model, sku, season, size,
            orderQty, previousOutput, plannedQty, remainingQty,
            deadline, status, note, createdAt, updatedAt
       FROM ShipmentBatch
       WHERE ${whereClause}
       ORDER BY date DESC, createdAt DESC
       LIMIT 500`,
    ...params
  );

  return NextResponse.json({ batches: rows });
}

// POST /api/shipment-batch — create a new planned shipment batch.
// Body: { productType, date, colorCode, poNo, factoryPO, model, sku, season,
//         size, orderQty, previousOutput, plannedQty, remainingQty, deadline, note? }
// Generates batchNumber like SHIP-YYYYMMDD-NNN (NNN is per-day sequence).
// Validates: plannedQty <= remainingQty (remainingOutput).
export async function POST(req: NextRequest) {
  const body = await req.json();

  const required = [
    "productType",
    "date",
    "colorCode",
    "poNo",
    "factoryPO",
    "size",
  ];
  for (const k of required) {
    if (!body[k] || String(body[k]).trim() === "") {
      return NextResponse.json(
        { error: `Missing required field: ${k}` },
        { status: 400 }
      );
    }
  }

  const productType = String(body.productType).trim();
  const date = String(body.date).trim();
  const colorCode = String(body.colorCode).trim();
  const poNo = String(body.poNo).trim();
  const factoryPO = String(body.factoryPO).trim();
  const size = String(body.size).trim();

  const orderQty = Number(body.orderQty) || 0;
  const previousOutput = Number(body.previousOutput) || 0;
  const plannedQty = Number(body.plannedQty) || 0;
  const remainingQty = Number(body.remainingQty) || 0;

  // Validation: plannedQty cannot exceed remainingQty (remaining output).
  if (plannedQty > remainingQty) {
    return NextResponse.json(
      {
        error: `Planned qty (${plannedQty}) exceeds remaining output (${remainingQty})`,
      },
      { status: 400 }
    );
  }
  if (plannedQty <= 0) {
    return NextResponse.json(
      { error: "plannedQty must be greater than 0" },
      { status: 400 }
    );
  }

  // Generate batchNumber: SHIP-YYYYMMDD-NNN where NNN is the day's sequence.
  const yyyymmdd = date.replace(/-/g, "");
  const prefix = `SHIP-${yyyymmdd}-`;
  const existing = await db.$queryRawUnsafe<{ batchNumber: string }[]>(
    `SELECT batchNumber FROM ShipmentBatch WHERE batchNumber LIKE ?`,
    `${prefix}%`
  );
  let maxSeq = 0;
  for (const b of existing) {
    const m = b.batchNumber.match(/SHIP-\d{8}-(\d+)$/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > maxSeq) maxSeq = n;
    }
  }
  const nextSeq = maxSeq + 1;
  const batchNumber = `${prefix}${String(nextSeq).padStart(3, "0")}`;

  // Generate a cuid-like id (we let SQLite handle it with a random ID).
  const id =
    "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

  await db.$executeRawUnsafe(
    `INSERT INTO ShipmentBatch
       (id, productType, batchNumber, date, colorCode, poNo, factoryPO,
        model, sku, season, size, orderQty, previousOutput, plannedQty,
        remainingQty, deadline, status, note, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    id,
    productType,
    batchNumber,
    date,
    colorCode,
    poNo,
    factoryPO,
    body.model ?? null,
    body.sku ?? null,
    body.season ?? null,
    size,
    orderQty,
    previousOutput,
    plannedQty,
    remainingQty,
    body.deadline ?? null,
    body.note ?? null
  );

  const created = await db.$queryRawUnsafe<ShipmentBatchRow[]>(
    `SELECT id, productType, batchNumber, date, colorCode, poNo, factoryPO,
            model, sku, season, size, orderQty, previousOutput, plannedQty,
            remainingQty, deadline, status, note, createdAt, updatedAt
       FROM ShipmentBatch WHERE id = ?`,
    id
  );

  return NextResponse.json({ ok: true, batch: created[0] ?? null });
}
