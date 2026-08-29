import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { masterRowToObj } from "@/lib/master-service";
import type { CanonicalField } from "@/lib/fields";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/master-data?productType=MAFATE&page=&pageSize=&search=&factoryPO=&...
// Product isolation: productType is MANDATORY (spec §51).
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const productType = searchParams.get("productType") || "";
  const page = Math.max(1, Number(searchParams.get("page") || "1"));
  const pageSize = Math.min(200, Math.max(1, Number(searchParams.get("pageSize") || "20")));
  const search = searchParams.get("search") || "";
  const sort = (searchParams.get("sort") || "factoryPO") as CanonicalField;
  const order = searchParams.get("order") === "desc" ? "desc" : "asc";

  const where: any = { AND: [] };
  // productType filter — always applied when provided.
  if (productType) where.AND.push({ productType });
  if (search) {
    where.AND.push({
      OR: [
        { factoryPO: { contains: search } },
        { sku: { contains: search } },
        { poNo: { contains: search } },
        { model: { contains: search } },
        { season: { contains: search } },
        { colorCode: { contains: search } },
        { size: { contains: search } },
      ],
    });
  }
  for (const [k, v] of [
    ["factoryPO", searchParams.get("factoryPO")],
    ["model", searchParams.get("model")],
    ["sku", searchParams.get("sku")],
    ["poNo", searchParams.get("poNo")],
    ["season", searchParams.get("season")],
    ["colorCode", searchParams.get("colorCode")],
    ["size", searchParams.get("size")],
    ["shippingStatus", searchParams.get("shippingStatus")],
  ] as [string, string | null][]) {
    if (v) where.AND.push({ [k]: { contains: v } });
  }
  if (where.AND.length === 0) delete where.AND;

  const [total, rows] = await Promise.all([
    db.masterData.count({ where }),
    db.masterData.findMany({
      where,
      orderBy: { [sort as string]: order },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return NextResponse.json({
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
    rows: rows.map(masterRowToObj),
  });
}

// POST /api/master-data — add a single row to MasterData from the Data Entry form.
// This allows users to create Master Data when a Factory PO doesn't exist yet.
// After inserting, rebuilds the MasterGroup index so lookups work immediately.
interface CreateMasterBody {
  productType: string;
  date?: string;
  shippingStatus?: string;
  model?: string;
  sku?: string;
  poNo?: string;
  factoryPO: string;
  item?: string;
  season?: string;
  colorCode?: string;
  colorCode2?: string;
  painting?: string;
  printingColor?: string;
  size: string;
  qty1?: string | number;
  qty2?: string | number;
  deadline?: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as CreateMasterBody;
    if (!body.productType) {
      return NextResponse.json({ error: "productType is required" }, { status: 400 });
    }
    if (!body.factoryPO) {
      return NextResponse.json({ error: "factoryPO is required" }, { status: 400 });
    }
    if (!body.size) {
      return NextResponse.json({ error: "size is required" }, { status: 400 });
    }

    // NO duplicate check: multiple rows with the same PO NO# + Factory PO + Size
    // are legitimate. A single Order of 100 units may be fulfilled by several
    // Output shipments (e.g. 20 + 30 + 50) and several Input receipts, each
    // row recording one shipment/receipt event. Blocking duplicates here would
    // prevent users from recording split shipments correctly.

    const created = await db.masterData.create({
      data: {
        productType: body.productType,
        date: body.date || null,
        shippingStatus: body.shippingStatus || null,
        model: body.model || null,
        sku: body.sku || null,
        poNo: body.poNo || null,
        factoryPO: body.factoryPO,
        item: body.item || null,
        season: body.season || null,
        colorCode: body.colorCode || null,
        colorCode2: body.colorCode2 || null,
        painting: body.painting || null,
        printingColor: body.printingColor || null,
        size: body.size,
        qty1: body.qty1 !== undefined && body.qty1 !== "" ? parseInt(String(body.qty1), 10) || 0 : null,
        qty2: body.qty2 !== undefined && body.qty2 !== "" ? parseInt(String(body.qty2), 10) || 0 : null,
        deadline: body.deadline || null,
        sourceFile: "manual-entry",
      },
    });

    // Rebuild MasterGroup index so the new Factory PO is immediately searchable
    // and all downstream dashboards/aggregations reflect the new data.
    // IMPORTANT: await completion so callers can refresh the UI knowing the
    // index is up-to-date (prevents stale autocomplete / dashboard data).
    try {
      const { rebuildMasterGroups } = await import("@/lib/master-service");
      await rebuildMasterGroups(body.productType);
    } catch (rebuildErr) {
      // Log but don't fail the request — the row was created successfully.
      console.error("rebuildMasterGroups failed:", rebuildErr);
    }

    return NextResponse.json({ ok: true, row: created });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to add master data";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
