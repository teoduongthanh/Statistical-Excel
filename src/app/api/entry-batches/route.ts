import { NextRequest, NextResponse } from "next/server";
import {
  createBatch,
  listBatches,
} from "@/lib/entry-batch-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/entry-batches?productType=&entryDateFrom=&entryDateTo=&shippingStatus=&entrySequence=&batchCode=&page=&pageSize=&includeDeleted=
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const filters = {
    productType: searchParams.get("productType") || undefined,
    entryDateFrom: searchParams.get("entryDateFrom") || undefined,
    entryDateTo: searchParams.get("entryDateTo") || undefined,
    shippingStatus: searchParams.get("shippingStatus") || undefined,
    entrySequence: searchParams.get("entrySequence")
      ? Number(searchParams.get("entrySequence"))
      : undefined,
    batchCode: searchParams.get("batchCode") || undefined,
    includeDeleted: searchParams.get("includeDeleted") === "true",
    page: searchParams.get("page") ? Number(searchParams.get("page")) : 1,
    pageSize: searchParams.get("pageSize") ? Number(searchParams.get("pageSize")) : 20,
  };
  const result = await listBatches(filters);
  return NextResponse.json(result);
}

// POST /api/entry-batches — create a new batch
// Body: { productType, shippingStatus, entryDate?, entryTime?, note?, createdBy? }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.productType) return NextResponse.json({ error: "productType is required" }, { status: 400 });
    if (!body.shippingStatus) return NextResponse.json({ error: "shippingStatus is required" }, { status: 400 });
    const batch = await createBatch({
      productType: body.productType,
      shippingStatus: body.shippingStatus,
      entryDate: body.entryDate,
      entryTime: body.entryTime,
      note: body.note,
      createdBy: body.createdBy,
    });
    return NextResponse.json({ ok: true, batch });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Failed to create batch" }, { status: 500 });
  }
}
