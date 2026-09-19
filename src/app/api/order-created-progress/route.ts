import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/order-created-progress?productType=MAFATE&createdDate=45840&mode=batch|transactions
//
// mode=batch (default):
//   Returns all Order groups created on the specified date (or all dates if not specified).
//   Each group = (poNo + factoryPO + size) with:
//   - orderQty (from 1.Order rows on that date)
//   - outputQty, inputQty (cumulative from ALL dates for this group)
//   - pending, remaining, outputProgress, inputProgress, inputVsOutput
//   - deadline, model, sku, colorCode, season
//   - daily timeline: [{ date, dailyOutput, dailyInput, cumOutput, cumInput, ... }]
//   - status[], anomalies[]
//
// mode=transactions:
//   Returns full transaction history for a specific (poNo + factoryPO + size)
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const productType = searchParams.get("productType") || "";
    if (!productType) {
      return NextResponse.json({ ok: false, error: "productType is required" }, { status: 400 });
    }
    const createdDate = searchParams.get("createdDate") || undefined;
    const mode = (searchParams.get("mode") || "batch") as "batch" | "transactions";

    // Parse date helper
    function parseDate(raw: string | null): string | null {
      if (!raw) return null;
      const s = String(raw).trim();
      if (!s) return null;
      if (/^\d+(\.\d+)?$/.test(s)) {
        const n = Number(s);
        if (n > 1000 && n < 100000) {
          const epoch = new Date(Date.UTC(1899, 11, 30));
          epoch.setDate(epoch.getDate() + Math.floor(n));
          return epoch.toISOString().slice(0, 10);
        }
        return null;
      }
      const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (dmy) {
        const d = new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
        if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
      }
      const iso = new Date(s);
      if (!isNaN(iso.getTime())) return iso.toISOString().slice(0, 10);
      return null;
    }

    function classifyStatus(s: string): "order" | "output" | "input" | "other" {
      const l = (s || "").trim().toLowerCase();
      if (l.startsWith("1") || l === "order") return "order";
      if (l.startsWith("2") || l === "output") return "output";
      if (l.startsWith("4") || l === "input") return "input";
      return "other";
    }

    if (mode === "transactions") {
      const poNo = searchParams.get("poNo") || "";
      const factoryPO = searchParams.get("factoryPO") || "";
      const size = searchParams.get("size") || "";
      if (!poNo || !factoryPO || !size) {
        return NextResponse.json({ ok: false, error: "poNo, factoryPO, size required for transactions mode" }, { status: 400 });
      }
      const rows = await db.masterData.findMany({
        where: { productType, poNo, factoryPO, size },
        select: { date: true, shippingStatus: true, qty1: true, deadline: true },
        orderBy: { date: "asc" },
      });
      let cumOrder = 0, cumOutput = 0, cumInput = 0;
      const transactions = rows.map((r) => {
        const dateStr = parseDate(r.date) || r.date || "";
        const bucket = classifyStatus(r.shippingStatus || "");
        const qty = Number(r.qty1) || 0;
        if (bucket === "order") cumOrder += qty;
        else if (bucket === "output") cumOutput += qty;
        else if (bucket === "input") cumInput += qty;
        return {
          date: dateStr,
          shippingStatus: r.shippingStatus || "",
          bucket,
          qty,
          cumulativeOrder: cumOrder,
          cumulativeOutput: cumOutput,
          cumulativeInput: cumInput,
          pending: Math.max(0, cumOutput - cumInput),
          remaining: Math.max(0, cumOrder - cumOutput),
          outputProgress: cumOrder > 0 ? Math.round((cumOutput / cumOrder) * 1000) / 10 : 0,
          inputProgress: cumOrder > 0 ? Math.round((cumInput / cumOrder) * 1000) / 10 : 0,
          inputVsOutput: cumOutput > 0 ? Math.round((cumInput / cumOutput) * 1000) / 10 : 0,
        };
      }).sort((a, b) => (a.date || "").localeCompare(b.date || ""));
      return NextResponse.json({ ok: true, transactions, deadline: rows[0]?.deadline || null });
    }

    // ── mode = batch ──
    // Step 1: Find all Order rows (shippingStatus starts with "1") for this product.
    // If createdDate is specified, filter to only orders created on that date.
    const orderRows = await db.masterData.findMany({
      where: {
        productType,
        shippingStatus: { startsWith: "1" },
        ...(createdDate ? { date: createdDate } : {}),
      },
      select: {
        date: true, poNo: true, factoryPO: true, size: true,
        qty1: true, deadline: true, model: true, sku: true,
        colorCode: true, colorCode2: true, season: true, painting: true, printingColor: true, item: true,
      },
    });

    // Group orders by (poNo + factoryPO + size) — these are the "order groups"
    interface OrderGroup {
      createdDate: string;
      poNo: string;
      factoryPO: string;
      size: string;
      orderQty: number;
      deadline: string | null;
      model: string; sku: string; colorCode: string; season: string;
      outputQty: number; inputQty: number;
      pending: number; remaining: number;
      outputProgress: number; inputProgress: number; inputVsOutput: number;
      status: string[];
      anomalies: string[];
      timeline: any[];
    }

    const orderGroups = new Map<string, OrderGroup>();
    for (const r of orderRows) {
      const key = `${r.poNo}|${r.factoryPO}|${r.size}`;
      const dateStr = parseDate(r.date) || r.date || "";
      if (!orderGroups.has(key)) {
        orderGroups.set(key, {
          createdDate: dateStr,
          poNo: r.poNo || "", factoryPO: r.factoryPO || "", size: r.size || "",
          orderQty: 0, deadline: r.deadline || null,
          model: r.model || "", sku: r.sku || "", colorCode: r.colorCode || "", season: r.season || "",
          outputQty: 0, inputQty: 0, pending: 0, remaining: 0,
          outputProgress: 0, inputProgress: 0, inputVsOutput: 0,
          status: [], anomalies: [], timeline: [],
        });
      }
      const g = orderGroups.get(key)!;
      g.orderQty += Number(r.qty1) || 0;
    }

    // Step 2: For each order group, fetch ALL transactions (all dates) to compute cumulative progress.
    const groupKeys = [...orderGroups.keys()];
    if (groupKeys.length === 0) {
      // Return available created dates for the date picker
      const allDates = await db.masterData.findMany({
        where: { productType, shippingStatus: { startsWith: "1" } },
        select: { date: true },
        distinct: ["date"],
      });
      const dateOptions = allDates
        .map((r) => ({ raw: r.date, iso: parseDate(r.date) }))
        .filter((d) => d.iso)
        .sort((a, b) => (a.iso || "").localeCompare(b.iso || ""));
      return NextResponse.json({ ok: true, groups: [], summary: { totalOrders: 0, dateOptions } });
    }

    // Batch fetch all transactions for these groups
    const poNos = [...new Set(groupKeys.map((k) => k.split("|")[0]))];
    const factoryPOs = [...new Set(groupKeys.map((k) => k.split("|")[1]))];
    const allTxRows = await db.masterData.findMany({
      where: { productType, poNo: { in: poNos }, factoryPO: { in: factoryPOs } },
      select: { date: true, shippingStatus: true, qty1: true, poNo: true, factoryPO: true, size: true },
      orderBy: { date: "asc" },
    });

    // Build timeline per group
    const txByGroup = new Map<string, any[]>();
    for (const r of allTxRows) {
      const key = `${r.poNo}|${r.factoryPO}|${r.size}`;
      if (!orderGroups.has(key)) continue;
      if (!txByGroup.has(key)) txByGroup.set(key, []);
      txByGroup.get(key)!.push(r);
    }

    // Compute cumulative progress + timeline for each group
    for (const [key, g] of orderGroups) {
      const txs = txByGroup.get(key) || [];
      let cumOutput = 0, cumInput = 0;
      const dailyMap = new Map<string, { date: string; dailyOutput: number; dailyInput: number }>();

      for (const tx of txs) {
        const dateStr = parseDate(tx.date) || tx.date || "";
        const bucket = classifyStatus(tx.shippingStatus || "");
        const qty = Number(tx.qty1) || 0;

        if (bucket === "output") {
          g.outputQty += qty;
          cumOutput += qty;
        } else if (bucket === "input") {
          g.inputQty += qty;
          cumInput += qty;
        }

        // Build daily timeline
        if (bucket === "output" || bucket === "input") {
          if (!dailyMap.has(dateStr)) {
            dailyMap.set(dateStr, { date: dateStr, dailyOutput: 0, dailyInput: 0 });
          }
          const d = dailyMap.get(dateStr)!;
          if (bucket === "output") d.dailyOutput += qty;
          else d.dailyInput += qty;
        }
      }

      // Compute final progress
      g.pending = Math.max(0, g.outputQty - g.inputQty);
      g.remaining = Math.max(0, g.orderQty - g.outputQty);
      g.outputProgress = g.orderQty > 0 ? Math.round((g.outputQty / g.orderQty) * 1000) / 10 : 0;
      g.inputProgress = g.orderQty > 0 ? Math.round((g.inputQty / g.orderQty) * 1000) / 10 : 0;
      g.inputVsOutput = g.outputQty > 0 ? Math.round((g.inputQty / g.outputQty) * 1000) / 10 : 0;

      // Status
      const statuses: string[] = [];
      if (g.outputQty === 0 && g.orderQty > 0) statuses.push("NOT_STARTED");
      else if (g.outputQty > 0 && g.outputQty < g.orderQty) statuses.push("IN_PROGRESS");
      if (g.outputQty >= g.orderQty && g.orderQty > 0) statuses.push("OUTPUT_COMPLETED");
      if (g.inputQty < g.outputQty) statuses.push("INPUT_IN_PROGRESS");
      if (g.inputQty >= g.outputQty && g.outputQty > 0) statuses.push("INPUT_COMPLETED");
      if (g.outputQty > g.orderQty && g.orderQty > 0) statuses.push("OVER_OUTPUT");
      if (g.inputQty > g.orderQty && g.orderQty > 0) statuses.push("OVER_INPUT");
      g.status = statuses;

      // Anomalies
      const anomalies: string[] = [];
      if (g.outputQty > g.orderQty && g.orderQty > 0) anomalies.push(`OVER_OUTPUT: +${g.outputQty - g.orderQty}`);
      if (g.inputQty > g.outputQty && g.outputQty > 0) anomalies.push(`INPUT_EXCEEDS_OUTPUT: +${g.inputQty - g.outputQty}`);
      g.anomalies = anomalies;

      // Build cumulative timeline
      let tlCumOutput = 0, tlCumInput = 0;
      g.timeline = [...dailyMap.values()]
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((d) => {
          tlCumOutput += d.dailyOutput;
          tlCumInput += d.dailyInput;
          return {
            ...d,
            cumOutput: tlCumOutput,
            cumInput: tlCumInput,
            pending: Math.max(0, tlCumOutput - tlCumInput),
            remaining: Math.max(0, g.orderQty - tlCumOutput),
            outputProgress: g.orderQty > 0 ? Math.round((tlCumOutput / g.orderQty) * 1000) / 10 : 0,
            inputProgress: g.orderQty > 0 ? Math.round((tlCumInput / g.orderQty) * 1000) / 10 : 0,
            inputVsOutput: tlCumOutput > 0 ? Math.round((tlCumInput / tlCumOutput) * 1000) / 10 : 0,
          };
        });
    }

    // Build summary
    const groups = [...orderGroups.values()].sort((a, b) => b.orderQty - a.orderQty);
    const summary = {
      totalOrders: groups.length,
      totalOrderQty: groups.reduce((s, g) => s + g.orderQty, 0),
      totalOutputQty: groups.reduce((s, g) => s + g.outputQty, 0),
      totalInputQty: groups.reduce((s, g) => s + g.inputQty, 0),
      totalPending: groups.reduce((s, g) => s + g.pending, 0),
      totalRemaining: groups.reduce((s, g) => s + g.remaining, 0),
      avgOutputProgress: groups.length > 0 ? Math.round(groups.reduce((s, g) => s + g.outputProgress, 0) / groups.length * 10) / 10 : 0,
      avgInputProgress: groups.length > 0 ? Math.round(groups.reduce((s, g) => s + g.inputProgress, 0) / groups.length * 10) / 10 : 0,
      notStarted: groups.filter((g) => g.status.includes("NOT_STARTED")).length,
      inProgress: groups.filter((g) => g.status.includes("IN_PROGRESS")).length,
      outputCompleted: groups.filter((g) => g.status.includes("OUTPUT_COMPLETED")).length,
      inputCompleted: groups.filter((g) => g.status.includes("INPUT_COMPLETED")).length,
      overOutput: groups.filter((g) => g.status.includes("OVER_OUTPUT")).length,
      overInput: groups.filter((g) => g.status.includes("OVER_INPUT")).length,
      anomalyCount: groups.filter((g) => g.anomalies.length > 0).length,
    };

    // If no createdDate specified, also return available dates
    if (!createdDate) {
      const allDates = await db.masterData.findMany({
        where: { productType, shippingStatus: { startsWith: "1" } },
        select: { date: true },
        distinct: ["date"],
      });
      const dateOptions = allDates
        .map((r) => ({ raw: r.date, iso: parseDate(r.date) }))
        .filter((d) => d.iso)
        .sort((a, b) => (a.iso || "").localeCompare(b.iso || ""));
      return NextResponse.json({ ok: true, groups, summary, dateOptions });
    }

    return NextResponse.json({ ok: true, groups, summary });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
