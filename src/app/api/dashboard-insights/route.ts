import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  parseDeadline,
  classifyShippingStatus,
} from "@/lib/quantity-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/dashboard-insights?productType=MAFATE
// Returns 4 insight modules for the enhanced dashboard:
//   1. Production Health Score (0-100) — based on completion rate, overdue alerts, data errors
//   2. Deadline Alert Center — overdue / due today / due this week / upcoming
//   3. Data Quality Summary — missing deadlines, qty mismatches, duplicate detection
//   4. Quick Stats — entry count today, active factory POs, pending output qty
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const productType = searchParams.get("productType") || "";
    if (!productType) {
      return NextResponse.json({ ok: false, error: "productType is required" }, { status: 400 });
    }

    // ── 1. Production Health Score ──────────────────────────────────────────
    // Fetch all rows for this product and compute KPIs in JS (MongoDB-compatible).
    const allRows = await db.masterData.findMany({
      where: { productType },
      select: {
        shippingStatus: true, qty1: true,
        factoryPO: true, poNo: true,
        deadline: true, size: true,
      },
    });

    let orderQty = 0, outputQty = 0, inputQty = 0;
    const factoryPOSet = new Set<string>();
    const poNoSet = new Set<string>();
    for (const r of allRows) {
      const bucket = classifyShippingStatus(r.shippingStatus);
      const q = r.qty1 ?? 0;
      if (bucket === "order") orderQty += q;
      else if (bucket === "output") outputQty += q;
      else if (bucket === "input") inputQty += q;
      if (r.factoryPO) factoryPOSet.add(r.factoryPO);
      if (r.poNo) poNoSet.add(r.poNo);
    }
    const factoryPOCount = factoryPOSet.size;
    const poNoCount = poNoSet.size;
    const completionRate = orderQty > 0 ? (inputQty / orderQty) * 100 : 0;
    const outputRate = orderQty > 0 ? (outputQty / orderQty) * 100 : 0;

    // Count overdue items (deadline < today, missing > 0).
    // Group by (poNo + factoryPO + size + deadline) and compute orderQty/inputQty.
    const now = new Date();
    const dayMs = 86400000;
    const deadlineAlerts: any[] = [];

    const groupsMap = new Map<string, {
      poNo: string; factoryPO: string; size: string; deadline: string;
      orderQty: number; inputQty: number;
    }>();

    for (const r of allRows) {
      if (!r.deadline) continue;
      const poNo = r.poNo ?? "";
      const fpo = r.factoryPO ?? "";
      const sz = r.size ?? "";
      const key = `${poNo}|${fpo}|${sz}|${r.deadline}`;
      if (!groupsMap.has(key)) {
        groupsMap.set(key, {
          poNo, factoryPO: fpo, size: sz, deadline: r.deadline,
          orderQty: 0, inputQty: 0,
        });
      }
      const g = groupsMap.get(key)!;
      const q = r.qty1 ?? 0;
      const bucket = classifyShippingStatus(r.shippingStatus);
      if (bucket === "order") g.orderQty += q;
      else if (bucket === "input") g.inputQty += q;
    }

    let overdueCount = 0;
    let dueTodayCount = 0;
    let dueThisWeekCount = 0;
    let upcomingCount = 0;

    // Apply HAVING inputQty < orderQty and LIMIT 500 — sort by deadline asc to keep stable.
    const overdueRows = [...groupsMap.values()]
      .filter((r) => r.inputQty < r.orderQty)
      .sort((a, b) => a.deadline.localeCompare(b.deadline))
      .slice(0, 500);

    for (const r of overdueRows) {
      const d = parseDeadline(r.deadline);
      if (!d) continue;
      const dNorm = new Date(d);
      dNorm.setHours(0, 0, 0, 0);
      const startToday = new Date(now);
      startToday.setHours(0, 0, 0, 0);
      const diff = dNorm.getTime() - startToday.getTime();
      const missing = r.orderQty - r.inputQty;
      if (missing <= 0) continue;

      let status: "OVERDUE" | "DUE_TODAY" | "DUE_THIS_WEEK" | "UPCOMING" = "UPCOMING";
      if (diff < 0) { status = "OVERDUE"; overdueCount++; }
      else if (diff < dayMs) { status = "DUE_TODAY"; dueTodayCount++; }
      else if (diff < 7 * dayMs) { status = "DUE_THIS_WEEK"; dueThisWeekCount++; }
      else { upcomingCount++; }

      if (status !== "UPCOMING") {
        deadlineAlerts.push({
          poNo: r.poNo || "",
          factoryPO: r.factoryPO || "",
          size: r.size || "",
          deadline: r.deadline,
          deadlineStatus: status,
          missing,
          orderQty: r.orderQty,
          inputQty: r.inputQty,
          daysUntilDeadline: Math.floor(diff / dayMs),
          priority: status === "OVERDUE" ? "HIGH" : status === "DUE_TODAY" ? "HIGH" : "MEDIUM",
        });
      }
    }
    deadlineAlerts.sort((a, b) => a.daysUntilDeadline - b.daysUntilDeadline);

    // Health Score formula:
    //   40% completion rate (input/order)
    //   30% output rate (output/order)
    //   20% deadline health (no overdue = full; each overdue -2, capped at -20)
    //   10% data quality (no missing deadlines = full; each -1, capped at -10)
    const deadlinePenalty = Math.min(20, overdueCount * 2);

    // Check data quality
    const missingDeadlineCount = await db.masterData.count({
      where: { productType, deadline: null },
    });
    const totalRows = await db.masterData.count({ where: { productType } });
    const dataQualityPenalty = Math.min(10, Math.ceil((missingDeadlineCount / Math.max(1, totalRows)) * 10));

    const healthScore = Math.max(0, Math.min(100,
      Math.round(completionRate * 0.4 + outputRate * 0.3 + (100 - deadlinePenalty) * 0.2 + (100 - dataQualityPenalty) * 0.1)
    ));

    let healthStatus: "EXCELLENT" | "GOOD" | "WARNING" | "CRITICAL";
    if (healthScore >= 85) healthStatus = "EXCELLENT";
    else if (healthScore >= 65) healthStatus = "GOOD";
    else if (healthScore >= 40) healthStatus = "WARNING";
    else healthStatus = "CRITICAL";

    // ── 2. Deadline Alert Center ────────────────────────────────────────────
    const deadlineCenter = {
      overdue: overdueCount,
      dueToday: dueTodayCount,
      dueThisWeek: dueThisWeekCount,
      upcoming: upcomingCount,
      alerts: deadlineAlerts.slice(0, 15), // top 15 most urgent
    };

    // ── 3. Data Quality Summary ────────────────────────────────────────────
    // Count groups with qty mismatch (output > order or input > output).
    // Reuse rows already fetched (filtered by productType). Group by (poNo + factoryPO + size).
    const qtyGroups = new Map<string, {
      orderQty: number; outputQty: number; inputQty: number;
    }>();
    for (const r of allRows) {
      const poNo = r.poNo ?? "";
      const fpo = r.factoryPO ?? "";
      const sz = r.size ?? "";
      if (!poNo || !fpo || !sz) continue;
      const key = `${poNo}|${fpo}|${sz}`;
      if (!qtyGroups.has(key)) {
        qtyGroups.set(key, { orderQty: 0, outputQty: 0, inputQty: 0 });
      }
      const g = qtyGroups.get(key)!;
      const q = r.qty1 ?? 0;
      const bucket = classifyShippingStatus(r.shippingStatus);
      if (bucket === "order") g.orderQty += q;
      else if (bucket === "output") g.outputQty += q;
      else if (bucket === "input") g.inputQty += q;
    }

    // HAVING: (outputQty > orderQty AND orderQty > 0) OR (inputQty > outputQty AND outputQty > 0)
    // LIMIT 100.
    const qtyMismatchRows = [...qtyGroups.values()]
      .filter((g) => (g.outputQty > g.orderQty && g.orderQty > 0) || (g.inputQty > g.outputQty && g.outputQty > 0))
      .slice(0, 100);

    const inputExceedsOutput = qtyMismatchRows.filter((r) => r.inputQty > r.outputQty && r.outputQty > 0).length;
    const outputExceedsOrder = qtyMismatchRows.filter((r) => r.outputQty > r.orderQty && r.orderQty > 0).length;

    const dataQuality = {
      totalRows,
      missingDeadline: missingDeadlineCount,
      missingDeadlinePercent: totalRows > 0 ? Math.round((missingDeadlineCount / totalRows) * 100) : 0,
      outputExceedsOrder,
      inputExceedsOutput,
      totalIssues: missingDeadlineCount > 0 ? missingDeadlineCount : 0 + outputExceedsOrder + inputExceedsOutput,
      qualityScore: Math.max(0, 100 - dataQualityPenalty * 5),
    };

    // ── 4. Quick Stats ─────────────────────────────────────────────────────
    const todayStr = new Date().toISOString().slice(0, 10);
    const entryCountToday = await db.entryData.count({
      where: { productType, date: todayStr },
    });
    const activeFactoryPOs = await db.masterGroup.count({
      where: { productType },
    });
    const remainingOutput = orderQty - outputQty;

    const quickStats = {
      entryCountToday,
      activeFactoryPOs,
      remainingOutput: Math.max(0, remainingOutput),
      remainingInput: Math.max(0, outputQty - inputQty),
      processing: outputQty - inputQty,
    };

    return NextResponse.json({
      ok: true,
      healthScore: {
        score: healthScore,
        status: healthStatus,
        completionRate: Math.round(completionRate * 10) / 10,
        outputRate: Math.round(outputRate * 10) / 10,
        deadlinePenalty,
        dataQualityPenalty,
        components: {
          completion: Math.round(completionRate * 0.4),
          output: Math.round(outputRate * 0.3),
          deadline: 100 - deadlinePenalty,
          dataQuality: 100 - dataQualityPenalty,
        },
      },
      deadlineCenter,
      dataQuality,
      quickStats,
      kpis: {
        orderQty,
        outputQty,
        inputQty,
        factoryPOCount,
        poNoCount,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to fetch dashboard insights";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
