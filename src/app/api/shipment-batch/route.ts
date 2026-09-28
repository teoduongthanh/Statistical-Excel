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

// GET /api/shipment-batch?productType=MAFATE
// List ShipmentBatch rows for a product (most recent first).
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

  const where: Record<string, unknown> = { productType };
  if (status) where.status = status;
  if (date) where.date = date;

  const batches = await db.shipmentBatch.findMany({
    where,
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: 500,
  });

  return NextResponse.json({ batches: batches.map(toRow) });
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
  const existing = await db.shipmentBatch.findMany({
    where: { batchNumber: { startsWith: prefix } },
    select: { batchNumber: true },
  });
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

  const created = await db.shipmentBatch.create({
    data: {
      batchNumber,
      productType,
      date,
      colorCode,
      poNo,
      factoryPO,
      model: body.model ?? null,
      sku: body.sku ?? null,
      season: body.season ?? null,
      size,
      orderQty,
      previousOutput,
      plannedQty,
      remainingQty,
      deadline: body.deadline ?? null,
      status: "DRAFT",
      note: body.note ?? null,
    },
  });

  return NextResponse.json({ ok: true, batch: toRow(created) });
}
