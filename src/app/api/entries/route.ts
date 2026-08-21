import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createEntry, validateEntry } from "@/lib/master-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CreateBody {
  factoryPO: string;
  size: string;
  qty1: string;
  autoCalcQty2?: boolean;
  note?: string;
}

// GET /api/entries?page=&pageSize=&search=&factoryPO=&...&sort=&order=
// Default sort: createdAt ASC (chronological: Data1, Data2, Data3)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get("page") || "1"));
  const pageSize = Math.min(200, Math.max(1, Number(searchParams.get("pageSize") || "20")));
  const search = searchParams.get("search") || "";
  const sort = searchParams.get("sort") || "createdAt";
  const order = searchParams.get("order") === "desc" ? "desc" : "asc";
  const productType = searchParams.get("productType") || "";

  const where: any = { AND: [] };
  if (search) {
    where.AND.push({
      OR: [
        { factoryPO: { contains: search } },
        { sku: { contains: search } },
        { model: { contains: search } },
        { poNo: { contains: search } },
        { season: { contains: search } },
        { size: { contains: search } },
      ],
    });
  }
  for (const f of ["factoryPO", "model", "sku", "poNo", "season", "colorCode", "size", "shippingStatus"]) {
    const v = searchParams.get(f);
    if (v) where.AND.push({ [f]: { contains: v } });
  }
  if (productType) where.AND.push({ productType: { contains: productType } });
  if (where.AND.length === 0) delete where.AND;

  const [total, rows] = await Promise.all([
    db.entryData.count({ where }),
    db.entryData.findMany({ where, orderBy: { [sort]: order }, skip: (page - 1) * pageSize, take: pageSize }),
  ]);

  return NextResponse.json({
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
    rows,
  });
}

// POST /api/entries — create a single entry with auto-fill lookup.
export async function POST(req: NextRequest) {
  const body = (await req.json()) as CreateBody;
  const autoCalcQty2 = body.autoCalcQty2 ?? true;

  const vr = await validateEntry({
    factoryPO: body.factoryPO,
    size: body.size,
    qty1: body.qty1,
  });
  if (!vr.ok) {
    return NextResponse.json({ ok: false, errors: vr.errors }, { status: 400 });
  }

  const created = await createEntry(
    { factoryPO: body.factoryPO, size: body.size, qty1: body.qty1 },
    { autoCalcQty2 }
  );
  if (!created.ok) {
    return NextResponse.json({ ok: false, errors: created.errors }, { status: 400 });
  }

  // If a note was provided, attach it to the created entry.
  if (body.note && created.entry) {
    await db.entryData.update({
      where: { id: created.entry.id },
      data: { note: body.note },
    });
    created.entry.note = body.note;
  }

  return NextResponse.json({ ok: true, entry: created.entry });
}
