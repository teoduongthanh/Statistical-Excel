import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/statistics/production?from=&to=&company=
// Aggregates Order/Output/Input quantities from MasterData by date and company.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const company = searchParams.get("company") || "all";
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 30);
  const fromDate = searchParams.get("from");
  const toDate = searchParams.get("to");
  if (fromDate) from.setTime(new Date(fromDate).getTime());
  if (toDate) to.setTime(new Date(toDate).getTime());

  // We aggregate from MasterData (which holds the source-of-truth qty per status).
  // Each row's qty1 contributes to order/output/input based on shippingStatus prefix.
  const where: any = { AND: [] };
  if (company && company !== "all") where.AND.push({ company });
  if (where.AND.length === 0) delete where.AND;

  const rows = await db.masterData.findMany({
    where,
    select: { company: true, date: true, shippingStatus: true, qty1: true, factoryPO: true, poNo: true },
  });

  let totalOrder = 0, totalOutput = 0, totalInput = 0;
  const byDateMap = new Map<string, { order: number; output: number; input: number }>();
  const byCompanyMap = new Map<string, { order: number; output: number; input: number }>();
  // For topIncomplete: group by (factoryPO, poNo) → order vs input.
  const orderMap = new Map<string, { factoryPO: string; poNo: string; order: number; input: number }>();

  for (const r of rows) {
    const status = (r.shippingStatus || "").trim();
    const qty = Math.abs(Number(r.qty1) || 0);
    if (qty === 0) continue;
    const bucket = status.startsWith("1") ? "order" :
                   status.startsWith("2") ? "output" :
                   status.startsWith("3") ? "spending" :
                   status.startsWith("4") ? "input" : null;
    if (!bucket || bucket === "spending") continue;
    if (bucket === "order") totalOrder += qty;
    if (bucket === "output") totalOutput += qty;
    if (bucket === "input") totalInput += qty;

    // byDate
    const d = (r.date || "").toString().trim();
    let dateKey = "";
    if (d) {
      // normalize to yyyy-mm-dd if it's an excel serial or dd/mm/yyyy
      if (/^\d+$/.test(d)) {
        const n = Number(d);
        const ms = Math.round((n - 25569) * 86400 * 1000);
        dateKey = new Date(ms).toISOString().slice(0, 10);
      } else {
        dateKey = d.slice(0, 10);
      }
    }
    if (dateKey) {
      if (!byDateMap.has(dateKey)) byDateMap.set(dateKey, { order: 0, output: 0, input: 0 });
      byDateMap.get(dateKey)![bucket] += qty;
    }
    // byCompany
    if (!byCompanyMap.has(r.company)) byCompanyMap.set(r.company, { order: 0, output: 0, input: 0 });
    byCompanyMap.get(r.company)![bucket] += qty;
    // topIncomplete
    const ok = (r.factoryPO || "").trim();
    const op = (r.poNo || "").trim();
    if (ok && op) {
      const k = `${ok}|${op}`;
      if (!orderMap.has(k)) orderMap.set(k, { factoryPO: ok, poNo: op, order: 0, input: 0 });
      if (bucket === "order") orderMap.get(k)!.order += qty;
      if (bucket === "input") orderMap.get(k)!.input += qty;
    }
  }

  const topIncomplete = [...orderMap.values()]
    .map((v) => ({
      factoryPO: v.factoryPO,
      poNo: v.poNo,
      shortage: v.order - v.input,
      completionRate: v.order > 0 ? Math.round((v.input / v.order) * 100) : 0,
    }))
    .filter((v) => v.shortage > 0)
    .sort((a, b) => b.shortage - a.shortage)
    .slice(0, 10);

  const completionRate = totalOrder > 0 ? Math.round((totalInput / totalOrder) * 100) : 0;

  return NextResponse.json({
    range: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) },
    totalOrder,
    totalOutput,
    totalInput,
    completionRate,
    byDate: [...byDateMap.entries()].sort().map(([date, v]) => ({ date, ...v })),
    byCompany: [...byCompanyMap.entries()].map(([company, v]) => ({ company, ...v })),
    topIncomplete,
  });
}
