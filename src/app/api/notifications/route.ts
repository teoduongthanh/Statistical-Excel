import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  classifyShippingStatus,
  computeDeadlineStatus,
  parseDeadline,
} from "@/lib/quantity-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/notifications?productType=MAFATE
// Aggregates alerts from multiple sources:
//   1. Overdue (deadline passed + remaining output > 0)
//   2. Data Errors (Output > Order, Input > Output, etc.)
//   3. Deadline Today / Tomorrow
//   4. Surplus (Output > Order)
// Returns a prioritized, categorized list for the notification center.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const productType = searchParams.get("productType") || "";
  if (!productType) {
    return NextResponse.json({ error: "productType is required" }, { status: 400 });
  }

  // Fetch all production rows for this product, then group in JS.
  const rows = await db.masterData.findMany({
    where: {
      productType,
      poNo: { not: null, not: "" },
      factoryPO: { not: null, not: "" },
      size: { not: null, not: "" },
    },
    select: {
      poNo: true, factoryPO: true, size: true,
      model: true, colorCode: true,
      deadline: true, shippingStatus: true, qty1: true,
    },
    take: 50000, // generous cap; original SQL had no cap but grouped to 5000
  });

  // Group by (poNo + factoryPO + size).
  type Acc = {
    poNo: string; factoryPO: string; size: string;
    model: string; colorCode: string;
    nearestDeadline: Date | null;
    orderQty: number; outputQty: number; inputQty: number;
  };
  const groupsMap = new Map<string, Acc>();

  for (const r of rows) {
    const poNo = r.poNo ?? "";
    const fpo = r.factoryPO ?? "";
    const sz = r.size ?? "";
    const key = `${poNo}|${fpo}|${sz}`;
    if (!groupsMap.has(key)) {
      groupsMap.set(key, {
        poNo, factoryPO: fpo, size: sz,
        model: r.model ?? "", colorCode: r.colorCode ?? "",
        nearestDeadline: null,
        orderQty: 0, outputQty: 0, inputQty: 0,
      });
    }
    const g = groupsMap.get(key)!;
    if (r.model) g.model = r.model;
    if (r.colorCode) g.colorCode = r.colorCode;
    if (r.deadline) {
      const d = parseDeadline(r.deadline);
      if (d) {
        if (!g.nearestDeadline || d.getTime() < g.nearestDeadline.getTime()) {
          g.nearestDeadline = d;
        }
      }
    }
    const q = r.qty1 ?? 0;
    const bucket = classifyShippingStatus(r.shippingStatus);
    if (bucket === "order") g.orderQty += q;
    else if (bucket === "output") g.outputQty += q;
    else if (bucket === "input") g.inputQty += q;
  }

  const grouped = [...groupsMap.values()].slice(0, 5000);
  const notifications: NotificationItem[] = [];
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const dayMs = 86400000;

  for (const r of grouped) {
    const orderQty = r.orderQty;
    const outputQty = r.outputQty;
    const inputQty = r.inputQty;
    const remainingOutput = orderQty - outputQty;
    const remainingInput = outputQty - inputQty;
    const deadline = r.nearestDeadline ? r.nearestDeadline.toISOString().slice(0, 10) : null;

    const dlStatus = computeDeadlineStatus(deadline, orderQty > 0 && outputQty >= orderQty && inputQty >= orderQty);

    // 1. OVERDUE — deadline passed + still need to output
    if (dlStatus === "OVERDUE" && remainingOutput > 0) {
      const lateDays = r.nearestDeadline ? Math.floor((now.getTime() - r.nearestDeadline.getTime()) / dayMs) : 0;
      notifications.push({
        id: `overdue-output|${r.poNo}|${r.factoryPO}|${r.size}`,
        type: "OVERDUE",
        severity: "CRITICAL",
        title: `Overdue: ${r.factoryPO} · ${r.size}`,
        description: `Deadline ${deadline} passed ${lateDays}d ago. ${remainingOutput} units not yet output.`,
        poNo: r.poNo, factoryPO: r.factoryPO, size: r.size,
        colorCode: r.colorCode,
        deadline,
        action: "product-production-tracking",
      });
    }

    // 2. OVERDUE INPUT — deadline passed + still waiting for input
    if (dlStatus === "OVERDUE" && remainingInput > 0 && remainingOutput <= 0) {
      notifications.push({
        id: `overdue-input|${r.poNo}|${r.factoryPO}|${r.size}`,
        type: "OVERDUE_INPUT",
        severity: "WARNING",
        title: `Late Input: ${r.factoryPO} · ${r.size}`,
        description: `Deadline ${deadline} passed. ${remainingInput} units not yet received.`,
        poNo: r.poNo, factoryPO: r.factoryPO, size: r.size,
        colorCode: r.colorCode, deadline,
        action: "product-production-tracking",
      });
    }

    // 3. DEADLINE TODAY
    if (dlStatus === "DUE_TODAY" && remainingOutput > 0) {
      notifications.push({
        id: `due-today|${r.poNo}|${r.factoryPO}|${r.size}`,
        type: "DEADLINE_TODAY",
        severity: "WARNING",
        title: `Due Today: ${r.factoryPO} · ${r.size}`,
        description: `${remainingOutput} units need to be output today.`,
        poNo: r.poNo, factoryPO: r.factoryPO, size: r.size,
        colorCode: r.colorCode, deadline,
        action: "product-production-tracking",
      });
    }

    // 4. DEADLINE TOMORROW
    if (dlStatus === "DUE_TOMORROW" && remainingOutput > 0) {
      notifications.push({
        id: `due-tomorrow|${r.poNo}|${r.factoryPO}|${r.size}`,
        type: "DEADLINE_TOMORROW",
        severity: "INFO",
        title: `Due Tomorrow: ${r.factoryPO} · ${r.size}`,
        description: `${remainingOutput} units need to be output by tomorrow.`,
        poNo: r.poNo, factoryPO: r.factoryPO, size: r.size,
        colorCode: r.colorCode, deadline,
        action: "product-production-tracking",
      });
    }

    // 5. DATA ERROR: Output > Order
    if (outputQty > orderQty && orderQty > 0) {
      notifications.push({
        id: `error-output-exceeds|${r.poNo}|${r.factoryPO}|${r.size}`,
        type: "DATA_ERROR",
        severity: "ERROR",
        title: `Output > Order: ${r.factoryPO} · ${r.size}`,
        description: `Output ${outputQty} exceeds Order ${orderQty} by ${outputQty - orderQty}.`,
        poNo: r.poNo, factoryPO: r.factoryPO, size: r.size,
        colorCode: r.colorCode, deadline,
        action: "product-report",
      });
    }

    // 6. DATA ERROR: Input > Output
    if (inputQty > outputQty && outputQty > 0) {
      notifications.push({
        id: `error-input-exceeds|${r.poNo}|${r.factoryPO}|${r.size}`,
        type: "DATA_ERROR",
        severity: "ERROR",
        title: `Input > Output: ${r.factoryPO} · ${r.size}`,
        description: `Input ${inputQty} exceeds Output ${outputQty} by ${inputQty - outputQty}.`,
        poNo: r.poNo, factoryPO: r.factoryPO, size: r.size,
        colorCode: r.colorCode, deadline,
        action: "product-report",
      });
    }

    // 7. SURPLUS (Output > Order — over-shipped)
    if (outputQty > orderQty && orderQty > 0) {
      notifications.push({
        id: `surplus|${r.poNo}|${r.factoryPO}|${r.size}`,
        type: "SURPLUS",
        severity: "WARNING",
        title: `Surplus: ${r.factoryPO} · ${r.size}`,
        description: `${outputQty - orderQty} excess units. Consider transferring to another Factory PO.`,
        poNo: r.poNo, factoryPO: r.factoryPO, size: r.size,
        colorCode: r.colorCode, deadline,
        action: "product-shipment",
      });
    }

    // 8. NO OUTPUT (Order > 0 but Output = 0)
    if (orderQty > 0 && outputQty === 0) {
      notifications.push({
        id: `no-output|${r.poNo}|${r.factoryPO}|${r.size}`,
        type: "NO_OUTPUT",
        severity: "INFO",
        title: `No Output: ${r.factoryPO} · ${r.size}`,
        description: `Order ${orderQty} but nothing output yet.`,
        poNo: r.poNo, factoryPO: r.factoryPO, size: r.size,
        colorCode: r.colorCode, deadline,
        action: "product-production-tracking",
      });
    }
  }

  // Sort by severity priority.
  const severityOrder = { CRITICAL: 0, ERROR: 1, WARNING: 2, INFO: 3 };
  notifications.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  // Summary counts.
  const summary = {
    total: notifications.length,
    critical: notifications.filter((n) => n.severity === "CRITICAL").length,
    error: notifications.filter((n) => n.severity === "ERROR").length,
    warning: notifications.filter((n) => n.severity === "WARNING").length,
    info: notifications.filter((n) => n.severity === "INFO").length,
    overdue: notifications.filter((n) => n.type === "OVERDUE").length,
    dataErrors: notifications.filter((n) => n.type === "DATA_ERROR").length,
    deadlineToday: notifications.filter((n) => n.type === "DEADLINE_TODAY").length,
    surplus: notifications.filter((n) => n.type === "SURPLUS").length,
  };

  return NextResponse.json({ notifications: notifications.slice(0, 50), summary });
}

export interface NotificationItem {
  id: string;
  type: "OVERDUE" | "OVERDUE_INPUT" | "DEADLINE_TODAY" | "DEADLINE_TOMORROW" | "DATA_ERROR" | "SURPLUS" | "NO_OUTPUT";
  severity: "CRITICAL" | "ERROR" | "WARNING" | "INFO";
  title: string;
  description: string;
  poNo: string;
  factoryPO: string;
  size: string;
  colorCode: string;
  deadline: string | null;
  action: string; // ViewKey to navigate to
}
