import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { masterRowToObj } from "@/lib/master-service";
import type { CanonicalField } from "@/lib/fields";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/master-data?page=1&pageSize=20&search=&factoryPO=&model=&season=&sort=factoryPO&order=asc
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get("page") || "1"));
  const pageSize = Math.min(200, Math.max(1, Number(searchParams.get("pageSize") || "20")));
  const search = searchParams.get("search") || "";
  const factoryPO = searchParams.get("factoryPO") || "";
  const model = searchParams.get("model") || "";
  const sku = searchParams.get("sku") || "";
  const poNo = searchParams.get("poNo") || "";
  const season = searchParams.get("season") || "";
  const colorCode = searchParams.get("colorCode") || "";
  const size = searchParams.get("size") || "";
  const shippingStatus = searchParams.get("shippingStatus") || "";
  const sort = (searchParams.get("sort") || "factoryPO") as CanonicalField;
  const order = searchParams.get("order") === "desc" ? "desc" : "asc";

  const where: any = { AND: [] };
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
    ["factoryPO", factoryPO],
    ["model", model],
    ["sku", sku],
    ["poNo", poNo],
    ["season", season],
    ["colorCode", colorCode],
    ["size", size],
    ["shippingStatus", shippingStatus],
  ] as [string, string][]) {
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
