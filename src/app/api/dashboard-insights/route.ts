import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { parseDeadline, computeDeadlineStatus, assessAlert, computeProductionSummary, classifyShippingStatus } from "@/lib/quantity-service";

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
    const kpiRow = await db.$queryRawUnsafe<any[]>(`
      SELECT
        SUM(CASE WHEN LOWER(shippingStatus) LIKE '1%' OR LOWER(shippingStatus) = 'order' THEN COALESCE(qty1, 0) ELSE 0 END) AS orderQty,
        SUM(CASE WHEN LOWER(shippingStatus) LIKE '2%' OR LOWER(shippingStatus) = 'output' THEN COALESCE(qty1, 0) ELSE 0 END) AS outputQty,
        SUM(CASE WHEN LOWER(shippingStatus) LIKE '4%' OR LOWER(shippingStatus) = 'input' THEN COALESCE(qty1, 0) ELSE 0 END) AS inputQty,
        COUNT(DISTINCT factoryPO) AS factoryPOCount,
        COUNT(DISTINCT poNo) AS poNoCount
      FROM MasterData WHERE productType = ?
    `, productType);
    const orderQty = Number(kpiRow[0]?.orderQty) || 0;
    const outputQty = Number(kpiRow[0]?.outputQty) || 0;
    const inputQty = Number(kpiRow[0]?.inputQty) || 0;
    const completionRate = orderQty > 0 ? (inputQty / orderQty) * 100 : 0;
    const outputRate = orderQty > 0 ? (outputQty / orderQty) * 100 : 0;

    // Count overdue items (deadline < today, missing > 0)
    const now = new Date();
    const todayISO = now.toISOString().slice(0, 10);
    const overdueRows = await db.$queryRawUnsafe<any[]>(`
      SELECT poNo, factoryPO, size, deadline,
        SUM(CASE WHEN LOWER(shippingStatus) LIKE '1%' OR LOWER(shippingStatus) = 'order' THEN COALESCE(qty1, 0) ELSE 0 END) AS orderQty,
        SUM(CASE WHEN LOWER(shippingStatus) LIKE '4%' OR LOWER(shippingStatus) = 'input' THEN COALESCE(qty1, 0) ELSE 0 END) AS inputQty
      FROM MasterData
      WHERE productType = ? AND deadline IS NOT NULL AND deadline != ''
      GROUP BY poNo, factoryPO, size, deadline
      HAVING inputQty < orderQty
      LIMIT 500
    `, productType);

    let overdueCount = 0;
    let dueTodayCount = 0;
    let dueThisWeekCount = 0;
    let upcomingCount = 0;
    const dayMs = 86400000;
    const deadlineAlerts: any[] = [];

    for (const r of overdueRows) {
      const d = parseDeadline(r.deadline);
      if (!d) continue;
      const dNorm = new Date(d);
      dNorm.setHours(0, 0, 0, 0);
      const startToday = new Date(now);
      startToday.setHours(0, 0, 0, 0);
      const diff = dNorm.getTime() - startToday.getTime();
      const missing = Number(r.orderQty) - Number(r.inputQty);

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
          orderQty: Number(r.orderQty),
          inputQty: Number(r.inputQty),
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
    // Count rows with missing deadline
    // Count groups with qty mismatch (output > order or input > output)
    const qtyMismatchRows = await db.$queryRawUnsafe<any[]>(`
      SELECT poNo, factoryPO, size,
        SUM(CASE WHEN LOWER(shippingStatus) LIKE '1%' OR LOWER(shippingStatus) = 'order' THEN COALESCE(qty1, 0) ELSE 0 END) AS orderQty,
        SUM(CASE WHEN LOWER(shippingStatus) LIKE '2%' OR LOWER(shippingStatus) = 'output' THEN COALESCE(qty1, 0) ELSE 0 END) AS outputQty,
        SUM(CASE WHEN LOWER(shippingStatus) LIKE '4%' OR LOWER(shippingStatus) = 'input' THEN COALESCE(qty1, 0) ELSE 0 END) AS inputQty
      FROM MasterData WHERE productType = ?
      GROUP BY poNo, factoryPO, size
      HAVING outputQty > orderQty AND orderQty > 0 OR inputQty > outputQty AND outputQty > 0
      LIMIT 100
    `, productType);

    const inputExceedsOutput = qtyMismatchRows.filter((r) => Number(r.inputQty) > Number(r.outputQty) && Number(r.outputQty) > 0).length;
    const outputExceedsOrder = qtyMismatchRows.filter((r) => Number(r.outputQty) > Number(r.orderQty) && Number(r.orderQty) > 0).length;

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
        factoryPOCount: Number(kpiRow[0]?.factoryPOCount) || 0,
        poNoCount: Number(kpiRow[0]?.poNoCount) || 0,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to fetch dashboard insights";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
