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
