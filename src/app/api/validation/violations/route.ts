import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/validation/violations?productType=&ruleCode=&severity=&resolved=&page=1&pageSize=50
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const productType = searchParams.get("productType") || "";
    const ruleCode = searchParams.get("ruleCode") || "";
    const severity = searchParams.get("severity") || "";
    const resolved = searchParams.get("resolved");
    const page = Math.max(1, Number(searchParams.get("page") || "1"));
    const pageSize = Math.min(200, Number(searchParams.get("pageSize") || "50"));

    const where: any = {};
    if (productType) where.productType = productType;
    if (ruleCode) where.ruleCode = ruleCode;
    if (severity) where.severity = severity;
    if (resolved === "true") where.resolved = true;
    if (resolved === "false") where.resolved = false;

    const [rows, total] = await Promise.all([
      db.violation.findMany({
        where,
        orderBy: [{ severity: "asc" }, { createdAt: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.violation.count({ where }),
    ]);

    return NextResponse.json({
      ok: true,
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      rows,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message }, { status: 500 });
  }
}
