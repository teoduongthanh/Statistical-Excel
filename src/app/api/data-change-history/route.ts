import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/data-change-history?productType=MAFATE&dateFrom=&dateTo=&limit=100
// Returns AuditLog entries filtered by productType + optional date range.
// Each entry includes: timestamp, user, action, entityType, entityId,
// oldValue (parsed JSON if possible), newValue (parsed JSON if possible), detail.
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const productType = searchParams.get("productType") || "";
    if (!productType) {
      return NextResponse.json({ ok: false, error: "productType is required" }, { status: 400 });
    }
    const dateFrom = searchParams.get("dateFrom") || undefined;
    const dateTo = searchParams.get("dateTo") || undefined;
    const limit = Math.min(500, Math.max(1, Number(searchParams.get("limit") || "100")));

    // Build where clause
    const where: any = { productType };
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(dateFrom + "T00:00:00Z");
      if (dateTo) where.createdAt.lte = new Date(dateTo + "T23:59:59Z");
    }

    const logs = await db.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    // Parse oldValue/newValue JSON for display
    const parsed = logs.map((log) => {
      let oldValueParsed: any = null;
      let newValueParsed: any = null;
      try { if (log.oldValue) oldValueParsed = JSON.parse(log.oldValue); } catch { /* keep raw */ }
      try { if (log.newValue) newValueParsed = JSON.parse(log.newValue); } catch { /* keep raw */ }
      return {
        id: log.id,
        timestamp: log.createdAt,
        user: log.user || "system",
        action: log.action,
        entityType: log.entityType,
        entityId: log.entityId,
        oldValue: oldValueParsed || log.oldValue,
        newValue: newValueParsed || log.newValue,
        detail: log.detail,
        productType: log.productType,
      };
    });

    // Summary by action
    const byAction: Record<string, number> = {};
    for (const l of parsed) {
      byAction[l.action] = (byAction[l.action] || 0) + 1;
    }

    return NextResponse.json({
      ok: true,
      history: parsed,
      summary: {
        total: parsed.length,
        byAction,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to fetch history";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
