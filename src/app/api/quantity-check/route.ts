import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/quantity-check?page=&pageSize=&company=&poNo=&factoryPO=&onlyErrors=&onlyShortage=
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get("page") || "1"));
  const pageSize = Math.min(200, Math.max(1, Number(searchParams.get("pageSize") || "20")));
  const company = searchParams.get("company") || "all";
  const poNo = searchParams.get("poNo") || "";
  const factoryPO = searchParams.get("factoryPO") || "";
  const onlyErrors = searchParams.get("onlyErrors") === "true";
  const onlyShortage = searchParams.get("onlyShortage") === "true";

  const where: any = { AND: [] };
  if (company && company !== "all") where.AND.push({ company });
  if (poNo) where.AND.push({ poNo: { contains: poNo } });
  if (factoryPO) where.AND.push({ factoryPO: { contains: factoryPO } });
  if (onlyErrors) where.AND.push({ match: false });
  if (onlyShortage) where.AND.push({ shortage: { gt: 0 } });
  if (where.AND.length === 0) delete where.AND;

  const [total, rows, stats] = await Promise.all([
    db.quantityCheck.count({ where }),
    db.quantityCheck.findMany({
      where,
      orderBy: { shortage: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    // Aggregates
    db.quantityCheck.aggregate({
      _sum: { orderQty: true, outputQty: true, inputQty: true, shortage: true },
      where,
    }),
  ]);
  const errorCount = await db.quantityCheck.count({ where: { ...where, match: false } });
  const shortageCount = await db.quantityCheck.count({ where: { ...where, shortage: { gt: 0 } } });

  return NextResponse.json({
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
    rows: rows.map((r) => ({
      ...r,
      statusFlags: JSON.parse(r.statusFlags || "[]"),
      computedAt: r.computedAt.toISOString(),
    })),
    stats: {
      totalOrder: stats._sum.orderQty ?? 0,
      totalOutput: stats._sum.outputQty ?? 0,
      totalInput: stats._sum.inputQty ?? 0,
      totalShortage: stats._sum.shortage ?? 0,
      errorCount,
      shortageCount,
    },
  });
}
