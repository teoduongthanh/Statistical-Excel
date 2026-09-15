import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { parseDeadline } from "@/lib/quantity-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/order-progress?productType=MAFATE&poNo=&factoryPO=&dateFrom=&dateTo=&mode=current|asOf|range&asOfDate=
//
// Returns:
//   1. Daily snapshot table — per-date cumulative Order/Output/Input/Pending/Remaining + progress %
//   2. Summary stats — total orders, total output, total input, pending, remaining, avg progress
//   3. Anomalies — over output, input exceeds output, deadline risk, data errors
//   4. Order status breakdown — NOT_STARTED / IN_PROGRESS / OUTPUT_COMPLETED / INPUT_COMPLETED / OVER_OUTPUT / OVER_INPUT
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const productType = searchParams.get("productType") || "";
    if (!productType) {
      return NextResponse.json({ ok: false, error: "productType is required" }, { status: 400 });
    }
    const poNo = searchParams.get("poNo") || undefined;
    const factoryPO = searchParams.get("factoryPO") || undefined;
    const dateFrom = searchParams.get("dateFrom") || undefined;
    const dateTo = searchParams.get("dateTo") || undefined;
    const mode = (searchParams.get("mode") || "current") as "current" | "asOf" | "range";
    const asOfDate = searchParams.get("asOfDate") || undefined;

    // Build WHERE conditions
    const conditions: string[] = ["productType = ?"];
    const params: any[] = [productType];
    if (poNo) { conditions.push("poNo = ?"); params.push(poNo); }
    if (factoryPO) { conditions.push("factoryPO = ?"); params.push(factoryPO); }
    const whereClause = conditions.join(" AND ");

    // Fetch all MasterData rows matching filters (needed for daily aggregation)
    const rows = await db.masterData.findMany({
      where: {
        productType,
        ...(poNo ? { poNo } : {}),
        ...(factoryPO ? { factoryPO } : {}),
      },
      select: {
        date: true, shippingStatus: true, qty1: true,
        poNo: true, factoryPO: true, size: true, deadline: true,
        model: true, sku: true, colorCode: true,
      },
    });

    // Parse date helper (handles Excel serial, dd/MM/yyyy, ISO)
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

    // Group by date → daily output/input
    const dailyMap = new Map<string, { date: string; dailyOutput: number; dailyInput: number; dailyOrder: number }>();
    for (const r of rows) {
      const dateStr = parseDate(r.date);
      if (!dateStr) continue;
      const bucket = classifyStatus(r.shippingStatus || "");
      const qty = Number(r.qty1) || 0;
      if (!dailyMap.has(dateStr)) {
        dailyMap.set(dateStr, { date: dateStr, dailyOutput: 0, dailyInput: 0, dailyOrder: 0 });
      }
      const d = dailyMap.get(dateStr)!;
      if (bucket === "output") d.dailyOutput += qty;
      else if (bucket === "input") d.dailyInput += qty;
      else if (bucket === "order") d.dailyOrder += qty;
    }

    // Sort by date ascending + compute cumulative
    const dailySorted = [...dailyMap.values()].sort((a, b) => a.date.localeCompare(b.date));

    // Total order qty (from all order rows, not just dated ones)
    let totalOrderQty = 0;
    let totalOutputQty = 0;
    let totalInputQty = 0;
    for (const r of rows) {
      const bucket = classifyStatus(r.shippingStatus || "");
      const qty = Number(r.qty1) || 0;
      if (bucket === "order") totalOrderQty += qty;
      else if (bucket === "output") totalOutputQty += qty;
      else if (bucket === "input") totalInputQty += qty;
    }

    // Build cumulative daily snapshot
    let cumOutput = 0;
    let cumInput = 0;
    let cumOrder = 0;
    const dailySnapshots = dailySorted.map((d) => {
      cumOutput += d.dailyOutput;
      cumInput += d.dailyInput;
      cumOrder += d.dailyOrder;
      const pending = cumOutput - cumInput;
      const remaining = Math.max(0, totalOrderQty - cumOutput);
      const outputProgress = totalOrderQty > 0 ? Math.round((cumOutput / totalOrderQty) * 1000) / 10 : 0;
      const inputProgress = totalOrderQty > 0 ? Math.round((cumInput / totalOrderQty) * 1000) / 10 : 0;
      const inputVsOutput = cumOutput > 0 ? Math.round((cumInput / cumOutput) * 1000) / 10 : 0;

      // Determine status
      const statuses: string[] = [];
      if (cumOutput === 0) statuses.push("NOT_STARTED");
      else if (cumOutput < totalOrderQty) statuses.push("IN_PROGRESS");
      if (cumOutput >= totalOrderQty && totalOrderQty > 0) statuses.push("OUTPUT_COMPLETED");
      if (cumInput < cumOutput) statuses.push("INPUT_IN_PROGRESS");
      if (cumInput >= cumOutput && cumOutput > 0) statuses.push("INPUT_COMPLETED");
      if (cumOutput > totalOrderQty && totalOrderQty > 0) statuses.push("OVER_OUTPUT");
      if (cumInput > totalOrderQty && totalOrderQty > 0) statuses.push("OVER_INPUT");

      return {
        date: d.date,
        dailyOrder: d.dailyOrder,
        dailyOutput: d.dailyOutput,
        dailyInput: d.dailyInput,
        totalOutput: cumOutput,
        totalInput: cumInput,
        pending: Math.max(0, pending),
        remaining,
        outputProgress,
        inputProgress,
        inputVsOutput,
        status: statuses.join(", "),
      };
    });

    // Filter by mode
    let filteredSnapshots = dailySnapshots;
    if (mode === "asOf" && asOfDate) {
      filteredSnapshots = dailySnapshots.filter((d) => d.date <= asOfDate);
    } else if (mode === "range" && dateFrom && dateTo) {
      filteredSnapshots = dailySnapshots.filter((d) => d.date >= dateFrom && d.date <= dateTo);
    }

    // Summary stats
    const pending = Math.max(0, totalOutputQty - totalInputQty);
    const remaining = Math.max(0, totalOrderQty - totalOutputQty);
    const avgOutputProgress = totalOrderQty > 0 ? Math.round((totalOutputQty / totalOrderQty) * 1000) / 10 : 0;
    const avgInputProgress = totalOrderQty > 0 ? Math.round((totalInputQty / totalOrderQty) * 1000) / 10 : 0;
    const avgInputVsOutput = totalOutputQty > 0 ? Math.round((totalInputQty / totalOutputQty) * 1000) / 10 : 0;

    // Order status counts
    const orderGroups = new Map<string, { orderQty: number; outputQty: number; inputQty: number; deadline: string | null }>();
    for (const r of rows) {
      const key = `${r.poNo || ""}|${r.factoryPO || ""}|${r.size || ""}`;
      if (!orderGroups.has(key)) {
        orderGroups.set(key, { orderQty: 0, outputQty: 0, inputQty: 0, deadline: r.deadline });
      }
      const g = orderGroups.get(key)!;
      const bucket = classifyStatus(r.shippingStatus || "");
      const qty = Number(r.qty1) || 0;
      if (bucket === "order") g.orderQty += qty;
      else if (bucket === "output") g.outputQty += qty;
      else if (bucket === "input") g.inputQty += qty;
    }

    let notStarted = 0, inProgress = 0, outputCompleted = 0, inputCompleted = 0, overOutput = 0, overInput = 0;
    const anomalies: any[] = [];
    const now = new Date();
    const dayMs = 86400000;

    for (const [key, g] of orderGroups) {
      if (g.outputQty === 0 && g.orderQty > 0) notStarted++;
      else if (g.outputQty > 0 && g.outputQty < g.orderQty) inProgress++;
      if (g.outputQty >= g.orderQty && g.orderQty > 0) outputCompleted++;
      if (g.inputQty >= g.outputQty && g.outputQty > 0) inputCompleted++;
      if (g.outputQty > g.orderQty && g.orderQty > 0) {
        overOutput++;
        anomalies.push({
          type: "OVER_OUTPUT",
          severity: "ERROR",
          key,
          poNo: key.split("|")[0],
          factoryPO: key.split("|")[1],
          size: key.split("|")[2],
          orderQty: g.orderQty,
          outputQty: g.outputQty,
          excess: g.outputQty - g.orderQty,
          description: `Output (${g.outputQty}) exceeds Order (${g.orderQty}) by ${g.outputQty - g.orderQty}`,
        });
      }
      if (g.inputQty > g.outputQty && g.outputQty > 0) {
        overInput++;
        anomalies.push({
          type: "INPUT_EXCEEDS_OUTPUT",
          severity: "ERROR",
          key,
          poNo: key.split("|")[0],
          factoryPO: key.split("|")[1],
          size: key.split("|")[2],
          outputQty: g.outputQty,
          inputQty: g.inputQty,
          excess: g.inputQty - g.outputQty,
          description: `Input (${g.inputQty}) exceeds Output (${g.outputQty}) by ${g.inputQty - g.outputQty}`,
        });
      }
      // Deadline risk
      if (g.deadline && g.orderQty > 0 && g.inputQty < g.orderQty) {
        const d = parseDeadline(g.deadline);
        if (d) {
          const dNorm = new Date(d);
          dNorm.setHours(0, 0, 0, 0);
          const startToday = new Date(now);
          startToday.setHours(0, 0, 0, 0);
          const diff = dNorm.getTime() - startToday.getTime();
          if (diff < 0) {
            anomalies.push({
              type: "DEADLINE_RISK",
              severity: "HIGH",
              key,
              poNo: key.split("|")[0],
              factoryPO: key.split("|")[1],
              size: key.split("|")[2],
              deadline: g.deadline,
              daysLate: Math.floor(Math.abs(diff) / dayMs),
              missing: g.orderQty - g.inputQty,
              description: `Deadline passed ${Math.floor(Math.abs(diff) / dayMs)} days ago, ${g.orderQty - g.inputQty} units still missing`,
            });
          } else if (diff < 7 * dayMs) {
            anomalies.push({
              type: "DEADLINE_RISK",
              severity: "MEDIUM",
              key,
              poNo: key.split("|")[0],
              factoryPO: key.split("|")[1],
              size: key.split("|")[2],
              deadline: g.deadline,
              daysUntilDeadline: Math.floor(diff / dayMs),
              missing: g.orderQty - g.inputQty,
              description: `Deadline in ${Math.floor(diff / dayMs)} days, ${g.orderQty - g.inputQty} units still missing`,
            });
          }
        }
      }
    }

    const summary = {
      totalOrderQty,
      totalOutputQty,
      totalInputQty,
      pending,
      remaining,
      avgOutputProgress,
      avgInputProgress,
      avgInputVsOutput,
      totalOrders: orderGroups.size,
      notStarted,
      inProgress,
      outputCompleted,
      inputCompleted,
      overOutput,
      overInput,
      anomalyCount: anomalies.length,
    };

    return NextResponse.json({
      ok: true,
      summary,
      dailySnapshots: filteredSnapshots,
      anomalies: anomalies.slice(0, 50),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to fetch order progress";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
