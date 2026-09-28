import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/dashboard — aggregate stats for the dashboard.
export async function GET() {
  const [totalMaster, totalEntries, totalFactoryPO] = await Promise.all([
    db.masterData.count(),
    db.entryData.count(),
    db.masterGroup.count(),
  ]);
  // Distinct counts via findMany({ distinct }) — works for MongoDB.
  const skuRows = await db.masterData.findMany({
    where: { sku: { not: null, not: "" } },
    distinct: ["sku"],
    select: { sku: true },
  });
  const modelRows = await db.masterData.findMany({
    where: { model: { not: null, not: "" } },
    distinct: ["model"],
    select: { model: true },
  });
  const totalSKU = skuRows.length;
  const totalModels = modelRows.length;

  // Today's entries (UTC date).
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const todayEntries = await db.entryData.count({ where: { createdAt: { gte: startOfDay } } });

  // Entries by date (last 14 days).
  const since = new Date();
  since.setDate(since.getDate() - 14);
  const recent = await db.entryData.findMany({
    where: { createdAt: { gte: since } },
    select: { createdAt: true, factoryPO: true, model: true, season: true },
  });
  const byDate = new Map<string, number>();
  const byFPO = new Map<string, number>();
  const byModel = new Map<string, number>();
  const bySeason = new Map<string, number>();
  for (const r of recent) {
    const d = r.createdAt.toISOString().slice(0, 10);
    byDate.set(d, (byDate.get(d) ?? 0) + 1);
    if (r.factoryPO) byFPO.set(r.factoryPO, (byFPO.get(r.factoryPO) ?? 0) + 1);
    if (r.model) byModel.set(r.model, (byModel.get(r.model) ?? 0) + 1);
    if (r.season) bySeason.set(r.season, (bySeason.get(r.season) ?? 0) + 1);
  }
  const top = (m: Map<string, number>, n: number) =>
    [...m.entries()].map(([k, v]) => ({ [typeof k === "string" ? "key" : "key"]: k, count: v })).slice(0, n);

  return NextResponse.json({
    totalMaster,
    totalEntries,
    totalFactoryPO,
    totalSKU,
    totalModels,
    todayEntries,
    entriesByDate: [...byDate.entries()].sort().map(([date, count]) => ({ date, count })),
    entriesByFactoryPO: [...byFPO.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([factoryPO, count]) => ({ factoryPO, count })),
    entriesByModel: [...byModel.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([model, count]) => ({ model, count })),
    entriesBySeason: [...bySeason.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([season, count]) => ({ season, count })),
  });
}
