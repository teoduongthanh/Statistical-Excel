import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/order-monitor?productType=MAFATE&mode=creation|deadline|matrix|daily|detail&...
//
// Unified Order Monitoring API — 5 modes:
// 1. creation: Group by Order Created Date → Model → PO → Factory PO → Size (with progress)
// 2. deadline: Group by Deadline Date → Model → PO → Factory PO → Size
// 3. matrix: Created Date × Deadline matrix
// 4. daily: Daily progress timeline for all orders (or filtered)
// 5. detail: Flat detail table with all columns (Created Date, Model, PO, Factory PO, Color, Size, Order, Output, Input, Pending, Remaining, Output%, Input%, Deadline, Days Remaining, Status)

interface OrderGroup {
  date: string; // createdDate or deadline
  model: string; poNo: string; factoryPO: string; colorCode: string; size: string;
  orderQty: number; outputQty: number; inputQty: number;
  pending: number; remaining: number;
  outputProgress: number; inputProgress: number; inputVsOutput: number;
  deadline: string | null;
  status: string[];
}

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
  if (dmy) { const d = new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1])); if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10); }
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

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const productType = searchParams.get("productType") || "";
    if (!productType) return NextResponse.json({ ok: false, error: "productType is required" }, { status: 400 });

    const mode = (searchParams.get("mode") || "creation") as "creation" | "deadline" | "matrix" | "daily" | "detail";
    const createdFrom = searchParams.get("createdFrom") || undefined;
    const createdTo = searchParams.get("createdTo") || undefined;
    const deadlineFrom = searchParams.get("deadlineFrom") || undefined;
    const deadlineTo = searchParams.get("deadlineTo") || undefined;
    const asOfDate = searchParams.get("asOfDate") || undefined;
    const modelFilter = searchParams.get("model") || undefined;
    const poNoFilter = searchParams.get("poNo") || undefined;
    const factoryPOFilter = searchParams.get("factoryPO") || undefined;
    const sizeFilter = searchParams.get("size") || undefined;

    // Fetch all MasterData for this product
    const where: any = { productType };
    if (modelFilter) where.model = modelFilter;
    if (poNoFilter) where.poNo = poNoFilter;
    if (factoryPOFilter) where.factoryPO = factoryPOFilter;
    if (sizeFilter) where.size = sizeFilter;

    const rows = await db.masterData.findMany({
      where,
      select: { date: true, shippingStatus: true, qty1: true, poNo: true, factoryPO: true, size: true, deadline: true, model: true, sku: true, colorCode: true, colorCode2: true, season: true, item: true },
    });

    // Parse dates + classify
    const parsed = rows.map((r) => {
      const createdDate = parseDate(r.date) || "";
      const deadlineDate = parseDate(r.deadline);
      const bucket = classifyStatus(r.shippingStatus || "");
      const qty = Number(r.qty1) || 0;
      return { ...r, createdDate, deadlineDate, bucket, qty };
    });

    // Apply as-of-date filter: only include transactions with createdDate <= asOfDate
    // (for output/input, we filter by the transaction's own date)
    const filtered = parsed.filter((r) => {
      // Created date range filter
      if (createdFrom && r.createdDate && r.createdDate < createdFrom) return false;
      if (createdTo && r.createdDate && r.createdDate > createdTo) return false;
      // Deadline range filter (only applies to order rows that have deadline)
      if (deadlineFrom || deadlineTo) {
        if (r.bucket === "order") {
          if (deadlineFrom && r.deadlineDate && r.deadlineDate < deadlineFrom) return false;
          if (deadlineTo && r.deadlineDate && r.deadlineDate > deadlineTo) return false;
        }
      }
      // As-of-date: exclude output/input transactions after that date
      if (asOfDate && (r.bucket === "output" || r.bucket === "input")) {
        if (r.createdDate && r.createdDate > asOfDate) return false;
      }
      return true;
    });

    // Group by (poNo + factoryPO + size) to compute progress per order group
    const groupMap = new Map<string, {
      createdDate: string; model: string; poNo: string; factoryPO: string; size: string;
      colorCode: string; colorCode2: string; season: string; sku: string; item: string;
      orderQty: number; outputQty: number; inputQty: number;
      deadlineDate: string | null;
      transactions: Array<{ date: string; bucket: string; qty: number; }>;
    }>();

    for (const r of filtered) {
      const key = `${r.poNo}|${r.factoryPO}|${r.size}`;
      if (!groupMap.has(key)) {
        groupMap.set(key, {
          createdDate: r.createdDate, model: r.model || "", poNo: r.poNo || "", factoryPO: r.factoryPO || "", size: r.size || "",
          colorCode: r.colorCode || "", colorCode2: r.colorCode2 || "", season: r.season || "", sku: r.sku || "", item: r.item || "",
          orderQty: 0, outputQty: 0, inputQty: 0, deadlineDate: null,
          transactions: [],
        });
      }
      const g = groupMap.get(key)!;
      // Use the earliest order date as createdDate
      if (r.bucket === "order") {
        g.orderQty += r.qty;
        if (!g.createdDate || (r.createdDate && r.createdDate < g.createdDate)) g.createdDate = r.createdDate;
        if (!g.deadlineDate && r.deadlineDate) g.deadlineDate = r.deadlineDate;
      } else if (r.bucket === "output") {
        g.outputQty += r.qty;
        g.transactions.push({ date: r.createdDate, bucket: "output", qty: r.qty });
      } else if (r.bucket === "input") {
        g.inputQty += r.qty;
        g.transactions.push({ date: r.createdDate, bucket: "input", qty: r.qty });
      }
    }

    // Compute progress for each group
    const allGroups: OrderGroup[] = [];
    for (const [, g] of groupMap) {
      const pending = Math.max(0, g.outputQty - g.inputQty);
      const remaining = Math.max(0, g.orderQty - g.outputQty);
      const outputProgress = g.orderQty > 0 ? Math.round((g.outputQty / g.orderQty) * 1000) / 10 : 0;
      const inputProgress = g.orderQty > 0 ? Math.round((g.inputQty / g.orderQty) * 1000) / 10 : 0;
      const inputVsOutput = g.outputQty > 0 ? Math.round((g.inputQty / g.outputQty) * 1000) / 10 : 0;
      const statuses: string[] = [];
      if (g.outputQty === 0 && g.orderQty > 0) statuses.push("NOT_STARTED");
      else if (g.outputQty > 0 && g.outputQty < g.orderQty) statuses.push("IN_PROGRESS");
      if (g.outputQty >= g.orderQty && g.orderQty > 0) statuses.push("OUTPUT_COMPLETED");
      if (g.inputQty < g.outputQty) statuses.push("INPUT_IN_PROGRESS");
      if (g.inputQty >= g.outputQty && g.outputQty > 0) statuses.push("INPUT_COMPLETED");
      if (g.outputQty > g.orderQty && g.orderQty > 0) statuses.push("OVER_OUTPUT");
      if (g.inputQty > g.orderQty && g.orderQty > 0) statuses.push("OVER_INPUT");

      // For deadline grouping, use the group's date field appropriately
      allGroups.push({
        date: "", // filled per mode
        model: g.model, poNo: g.poNo, factoryPO: g.factoryPO, colorCode: g.colorCode, size: g.size,
        orderQty: g.orderQty, outputQty: g.outputQty, inputQty: g.inputQty,
        pending, remaining, outputProgress, inputProgress, inputVsOutput,
        deadline: g.deadlineDate,
        status: statuses,
      });
      // Store the group's createdDate and deadlineDate for later use
      (allGroups[allGroups.length - 1] as any)._createdDate = g.createdDate;
      (allGroups[allGroups.length - 1] as any)._deadlineDate = g.deadlineDate;
      (allGroups[allGroups.length - 1] as any)._transactions = g.transactions;
      (allGroups[allGroups.length - 1] as any)._colorCode2 = g.colorCode2;
      (allGroups[allGroups.length - 1] as any)._season = g.season;
      (allGroups[allGroups.length - 1] as any)._sku = g.sku;
    }

    // ── Mode: detail ── flat table with all columns
    if (mode === "detail") {
      const now = new Date();
      const dayMs = 86400000;
      const detail = allGroups.map((g: any) => {
        const dl = g._deadlineDate;
        let daysRemaining: number | null = null;
        if (dl) {
          const dNorm = new Date(dl);
          dNorm.setHours(0, 0, 0, 0);
          const startToday = new Date(now);
          startToday.setHours(0, 0, 0, 0);
          daysRemaining = Math.floor((dNorm.getTime() - startToday.getTime()) / dayMs);
        }
        return {
          createdDate: g._createdDate || "",
          model: g.model, poNo: g.poNo, factoryPO: g.factoryPO,
          colorCode: g.colorCode, colorCode2: g._colorCode2 || "", size: g.size,
          orderQty: g.orderQty, outputQty: g.outputQty, inputQty: g.inputQty,
          pending: g.pending, remaining: g.remaining,
          outputProgress: g.outputProgress, inputProgress: g.inputProgress, inputVsOutput: g.inputVsOutput,
          deadline: g._deadlineDate || null, daysRemaining,
          status: g.status.join(", "),
          season: g._season || "", sku: g._sku || "",
        };
      }).sort((a, b) => (b.orderQty - a.orderQty));

      const summary = {
        totalLines: detail.length,
        totalOrderQty: detail.reduce((s, g) => s + g.orderQty, 0),
        totalOutputQty: detail.reduce((s, g) => s + g.outputQty, 0),
        totalInputQty: detail.reduce((s, g) => s + g.inputQty, 0),
        totalPending: detail.reduce((s, g) => s + g.pending, 0),
        totalRemaining: detail.reduce((s, g) => s + g.remaining, 0),
        outputProgress: 0, inputProgress: 0,
        overdue: detail.filter((g) => g.daysRemaining !== null && g.daysRemaining < 0 && g.remaining > 0).length,
        dueToday: detail.filter((g) => g.daysRemaining === 0).length,
        upcoming: detail.filter((g) => g.daysRemaining !== null && g.daysRemaining > 0 && g.daysRemaining <= 7).length,
      };
      summary.outputProgress = summary.totalOrderQty > 0 ? Math.round((summary.totalOutputQty / summary.totalOrderQty) * 1000) / 10 : 0;
      summary.inputProgress = summary.totalOrderQty > 0 ? Math.round((summary.totalInputQty / summary.totalOrderQty) * 1000) / 10 : 0;
      return NextResponse.json({ ok: true, detail, summary });
    }

    // ── Mode: creation (group by Created Date → Model → PO → Factory PO → Size) ──
    if (mode === "creation") {
      const byDate = new Map<string, Map<string, Map<string, Map<string, Map<string, OrderGroup[]>>>>>();
      for (const g of allGroups) {
        const cd = (g as any)._createdDate || "";
        const model = g.model || "";
        const poNo = g.poNo || "";
        const fpo = g.factoryPO || "";
        const color = g.colorCode || "";
        const size = g.size || "";
        if (!byDate.has(cd)) byDate.set(cd, new Map());
        if (!byDate.get(cd)!.has(model)) byDate.get(cd)!.set(model, new Map());
        if (!byDate.get(cd)!.get(model)!.has(poNo)) byDate.get(cd)!.get(model)!.set(poNo, new Map());
        if (!byDate.get(cd)!.get(model)!.get(poNo)!.has(fpo)) byDate.get(cd)!.get(model)!.get(poNo)!.set(fpo, new Map());
        if (!byDate.get(cd)!.get(model)!.get(poNo)!.get(fpo)!.has(color)) byDate.get(cd)!.get(model)!.get(poNo)!.get(fpo)!.set(color, []);
        byDate.get(cd)!.get(model)!.get(poNo)!.get(fpo)!.get(color)!.push(g);
      }
      // Build hierarchy with aggregation
      const hierarchy = [...byDate.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([date, models]) => {
        let orderQty = 0, outputQty = 0, inputQty = 0;
        const modelList = [...models.entries()].map(([model, pos]) => {
          let mOrder = 0, mOutput = 0, mInput = 0;
          const poList = [...pos.entries()].map(([poNo, fpos]) => {
            let pOrder = 0, pOutput = 0, pInput = 0;
            const fpoList = [...fpos.entries()].map(([fpo, colors]) => {
              let fOrder = 0, fOutput = 0, fInput = 0;
              const colorList = [...colors.entries()].map(([color, sizes]) => {
                let cOrder = 0, cOutput = 0, cInput = 0;
                sizes.forEach((s) => { cOrder += s.orderQty; cOutput += s.outputQty; cInput += s.inputQty; });
                fOrder += cOrder; fOutput += cOutput; fInput += cInput;
                pOrder += cOrder; pOutput += cOutput; pInput += cInput;
                mOrder += cOrder; mOutput += cOutput; mInput += cInput;
                orderQty += cOrder; outputQty += cOutput; inputQty += cInput;
                return {
                  colorCode: color,
                  orderQty: cOrder, outputQty: cOutput, inputQty: cInput,
                  pending: Math.max(0, cOutput - cInput), remaining: Math.max(0, cOrder - cOutput),
                  outputProgress: cOrder > 0 ? Math.round(cOutput / cOrder * 1000) / 10 : 0,
                  inputProgress: cOrder > 0 ? Math.round(cInput / cOrder * 1000) / 10 : 0,
                  sizes: sizes.map((s) => ({
                    size: s.size, orderQty: s.orderQty, outputQty: s.outputQty, inputQty: s.inputQty,
                    pending: s.pending, remaining: s.remaining, outputProgress: s.outputProgress, inputProgress: s.inputProgress,
                    inputVsOutput: s.inputVsOutput, deadline: s.deadline, status: s.status,
                  })),
                };
              });
              return {
                factoryPO: fpo, orderQty: fOrder, outputQty: fOutput, inputQty: fInput,
                pending: Math.max(0, fOutput - fInput), remaining: Math.max(0, fOrder - fOutput),
                outputProgress: fOrder > 0 ? Math.round(fOutput / fOrder * 1000) / 10 : 0,
                inputProgress: fOrder > 0 ? Math.round(fInput / fOrder * 1000) / 10 : 0,
                colors: colorList,
              };
            });
            return { poNo, orderQty: pOrder, outputQty: pOutput, inputQty: pInput, factoryPOs: fpoList };
          });
          return { model, orderQty: mOrder, outputQty: mOutput, inputQty: mInput, poNOs: poList };
        });
        return {
          createdDate: date, orderQty, outputQty, inputQty,
          pending: Math.max(0, outputQty - inputQty), remaining: Math.max(0, orderQty - outputQty),
          outputProgress: orderQty > 0 ? Math.round(outputQty / orderQty * 1000) / 10 : 0,
          inputProgress: orderQty > 0 ? Math.round(inputQty / orderQty * 1000) / 10 : 0,
          models: modelList,
        };
      });
      return NextResponse.json({ ok: true, hierarchy, summary: { totalDates: hierarchy.length, totalOrderQty: hierarchy.reduce((s, h) => s + h.orderQty, 0) } });
    }

    // ── Mode: deadline (group by Deadline Date → Model → PO → Factory PO → Size) ──
    if (mode === "deadline") {
      const byDeadline = new Map<string, OrderGroup[]>();
      for (const g of allGroups) {
        const dl = (g as any)._deadlineDate || "no-deadline";
        if (!byDeadline.has(dl)) byDeadline.set(dl, []);
        byDeadline.get(dl)!.push(g);
      }
      const deadlineList = [...byDeadline.entries()]
        .filter(([dl]) => dl !== "no-deadline")
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([deadline, groups]) => {
          const orderQty = groups.reduce((s, g) => s + g.orderQty, 0);
          const outputQty = groups.reduce((s, g) => s + g.outputQty, 0);
          const inputQty = groups.reduce((s, g) => s + g.inputQty, 0);
          return {
            deadline, orderQty, outputQty, inputQty,
            pending: Math.max(0, outputQty - inputQty), remaining: Math.max(0, orderQty - outputQty),
            outputProgress: orderQty > 0 ? Math.round(outputQty / orderQty * 1000) / 10 : 0,
            inputProgress: orderQty > 0 ? Math.round(inputQty / orderQty * 1000) / 10 : 0,
            orderCount: groups.length,
            groups: groups.map((g) => ({
              model: g.model, poNo: g.poNo, factoryPO: g.factoryPO, colorCode: g.colorCode, size: g.size,
              orderQty: g.orderQty, outputQty: g.outputQty, inputQty: g.inputQty,
              pending: g.pending, remaining: g.remaining,
              outputProgress: g.outputProgress, inputProgress: g.inputProgress, inputVsOutput: g.inputVsOutput,
              createdDate: (g as any)._createdDate || "", status: g.status,
            })),
          };
        });
      return NextResponse.json({ ok: true, deadlines: deadlineList, noDeadlineCount: byDeadline.get("no-deadline")?.length || 0 });
    }

    // ── Mode: matrix (Created Date × Deadline) ──
    if (mode === "matrix") {
      const matrixMap = new Map<string, { createdDate: string; deadline: string; orderQty: number; outputQty: number; inputQty: number; pending: number; remaining: number; inputProgress: number; }>();
      for (const g of allGroups) {
        const cd = (g as any)._createdDate || "";
        const dl = (g as any)._deadlineDate || "";
        if (!cd || !dl) continue;
        const key = `${cd}|${dl}`;
        if (!matrixMap.has(key)) {
          matrixMap.set(key, { createdDate: cd, deadline: dl, orderQty: 0, outputQty: 0, inputQty: 0, pending: 0, remaining: 0, inputProgress: 0 });
        }
        const m = matrixMap.get(key)!;
        m.orderQty += g.orderQty; m.outputQty += g.outputQty; m.inputQty += g.inputQty;
        m.pending += g.pending; m.remaining += g.remaining;
      }
      const matrix = [...matrixMap.values()].map((m) => {
        m.inputProgress = m.orderQty > 0 ? Math.round(m.inputQty / m.orderQty * 1000) / 10 : 0;
        return m;
      }).sort((a, b) => a.createdDate.localeCompare(b.createdDate) || a.deadline.localeCompare(b.deadline));
      return NextResponse.json({ ok: true, matrix });
    }

    // ── Mode: daily (daily progress timeline) ──
    if (mode === "daily") {
      const dailyMap = new Map<string, { date: string; dailyOutput: number; dailyInput: number }>();
      let totalOrder = 0;
      for (const g of allGroups) {
        totalOrder += g.orderQty;
        const txs = (g as any)._transactions || [];
        for (const tx of txs) {
          if (tx.bucket !== "output" && tx.bucket !== "input") continue;
          const d = tx.date || "";
          if (!d) continue;
          if (!dailyMap.has(d)) dailyMap.set(d, { date: d, dailyOutput: 0, dailyInput: 0 });
          const dm = dailyMap.get(d)!;
          if (tx.bucket === "output") dm.dailyOutput += tx.qty;
          else dm.dailyInput += tx.qty;
        }
      }
      let cumOutput = 0, cumInput = 0;
      const daily = [...dailyMap.values()].sort((a, b) => a.date.localeCompare(b.date)).map((d) => {
        cumOutput += d.dailyOutput;
        cumInput += d.dailyInput;
        return {
          ...d,
          cumOutput, cumInput,
          pending: Math.max(0, cumOutput - cumInput),
          remaining: Math.max(0, totalOrder - cumOutput),
          outputProgress: totalOrder > 0 ? Math.round(cumOutput / totalOrder * 1000) / 10 : 0,
          inputProgress: totalOrder > 0 ? Math.round(cumInput / totalOrder * 1000) / 10 : 0,
          inputVsOutput: cumOutput > 0 ? Math.round(cumInput / cumOutput * 1000) / 10 : 0,
        };
      });
      return NextResponse.json({ ok: true, daily, summary: { totalOrder, totalOutput: cumOutput, totalInput: cumInput } });
    }

    return NextResponse.json({ ok: false, error: "Unknown mode" }, { status: 400 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
