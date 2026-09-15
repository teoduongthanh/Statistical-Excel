import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/order-drilldown?productType=MAFATE&poNo=&factoryPO=&size=&mode=hierarchy|transactions
//
// mode=hierarchy (default):
//   Returns a 3-level tree: PO NO# → Factory PO → Size
//   Each leaf (Size) has: orderQty, outputQty, inputQty, pending, remaining,
//   outputProgress, inputProgress, inputVsOutput, deadline, status, anomalies
//   Each branch (Factory PO) has aggregated totals from its children.
//   Each root (PO NO#) has aggregated totals from its Factory POs.
//
// mode=transactions:
//   Returns transaction history for a specific (poNo + factoryPO + size):
//   [{ date, shippingStatus, qty, cumulativeOrder, cumulativeOutput, cumulativeInput, ... }]
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const productType = searchParams.get("productType") || "";
    if (!productType) {
      return NextResponse.json({ ok: false, error: "productType is required" }, { status: 400 });
    }
    const mode = (searchParams.get("mode") || "hierarchy") as "hierarchy" | "transactions";
    const poNo = searchParams.get("poNo") || undefined;
    const factoryPO = searchParams.get("factoryPO") || undefined;
    const size = searchParams.get("size") || undefined;

    // ── Parse date helper (Excel serial, dd/MM/yyyy, ISO) ──
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
      // ── Transaction history for a specific (poNo + factoryPO + size) ──
      if (!poNo || !factoryPO || !size) {
        return NextResponse.json({ ok: false, error: "poNo, factoryPO, and size are required for transactions mode" }, { status: 400 });
      }
      const rows = await db.masterData.findMany({
        where: { productType, poNo, factoryPO, size },
        select: { date: true, shippingStatus: true, qty1: true, deadline: true },
        orderBy: { date: "asc" },
      });

      let cumOrder = 0, cumOutput = 0, cumInput = 0;
      const transactions = rows
        .map((r) => {
          const dateStr = parseDate(r.date) || r.date || "";
          const bucket = classifyStatus(r.shippingStatus || "");
          const qty = Number(r.qty1) || 0;
          if (bucket === "order") cumOrder += qty;
          else if (bucket === "output") cumOutput += qty;
          else if (bucket === "input") cumInput += qty;
          const pending = Math.max(0, cumOutput - cumInput);
          const remaining = Math.max(0, cumOrder - cumOutput);
          return {
            date: dateStr,
            shippingStatus: r.shippingStatus || "",
            bucket,
            qty,
            cumulativeOrder: cumOrder,
            cumulativeOutput: cumOutput,
            cumulativeInput: cumInput,
            pending,
            remaining,
            outputProgress: cumOrder > 0 ? Math.round((cumOutput / cumOrder) * 1000) / 10 : 0,
            inputProgress: cumOrder > 0 ? Math.round((cumInput / cumOrder) * 1000) / 10 : 0,
            inputVsOutput: cumOutput > 0 ? Math.round((cumInput / cumOutput) * 1000) / 10 : 0,
          };
        })
        .sort((a, b) => (a.date || "").localeCompare(b.date || ""));

      return NextResponse.json({ ok: true, transactions, deadline: rows[0]?.deadline || null });
    }

    // ── mode = hierarchy ──
    // Fetch all MasterData rows matching filters
    const where: any = { productType };
    if (poNo) where.poNo = poNo;
    if (factoryPO) where.factoryPO = factoryPO;
    if (size) where.size = size;

    const rows = await db.masterData.findMany({
      where,
      select: {
        date: true, shippingStatus: true, qty1: true,
        poNo: true, factoryPO: true, size: true, deadline: true,
        model: true, sku: true, colorCode: true, season: true,
      },
    });

    // Build 3-level tree: poNo → factoryPO → size
    interface SizeLeaf {
      size: string;
      orderQty: number; outputQty: number; inputQty: number;
      pending: number; remaining: number;
      outputProgress: number; inputProgress: number; inputVsOutput: number;
      deadline: string | null;
      model: string; sku: string; colorCode: string; season: string;
      status: string[];
      anomalies: string[];
    }
    interface FactoryBranch {
      factoryPO: string;
      model: string; sku: string; colorCode: string; season: string;
      orderQty: number; outputQty: number; inputQty: number;
      pending: number; remaining: number;
      outputProgress: number; inputProgress: number; inputVsOutput: number;
      deadline: string | null;
      sizes: SizeLeaf[];
      sizeCount: number;
    }
    interface PoRoot {
      poNo: string;
      orderQty: number; outputQty: number; inputQty: number;
      pending: number; remaining: number;
      outputProgress: number; inputProgress: number; inputVsOutput: number;
      factoryPOs: FactoryBranch[];
      factoryPOCount: number;
    }

    const tree = new Map<string, PoRoot>();

    for (const r of rows) {
      const poNoKey = (r.poNo || "").trim();
      const fpoKey = (r.factoryPO || "").trim();
      const sizeKey = (r.size || "").trim();
      if (!poNoKey || !fpoKey || !sizeKey) continue;

      // Get or create PO root
      if (!tree.has(poNoKey)) {
        tree.set(poNoKey, {
          poNo: poNoKey, orderQty: 0, outputQty: 0, inputQty: 0,
          pending: 0, remaining: 0, outputProgress: 0, inputProgress: 0, inputVsOutput: 0,
          factoryPOs: [], factoryPOCount: 0,
        });
      }
      const poRoot = tree.get(poNoKey)!;

      // Get or create Factory PO branch
      let fpoBranch = poRoot.factoryPOs.find((f) => f.factoryPO === fpoKey);
      if (!fpoBranch) {
        fpoBranch = {
          factoryPO: fpoKey, model: "", sku: "", colorCode: "", season: "",
          orderQty: 0, outputQty: 0, inputQty: 0,
          pending: 0, remaining: 0, outputProgress: 0, inputProgress: 0, inputVsOutput: 0,
          deadline: null, sizes: [], sizeCount: 0,
        };
        poRoot.factoryPOs.push(fpoBranch);
      }

      // Get or create Size leaf
      let sizeLeaf = fpoBranch.sizes.find((s) => s.size === sizeKey);
      if (!sizeLeaf) {
        sizeLeaf = {
          size: sizeKey, orderQty: 0, outputQty: 0, inputQty: 0,
          pending: 0, remaining: 0, outputProgress: 0, inputProgress: 0, inputVsOutput: 0,
          deadline: r.deadline || null,
          model: r.model || "", sku: r.sku || "", colorCode: r.colorCode || "", season: r.season || "",
          status: [], anomalies: [],
        };
        fpoBranch.sizes.push(sizeLeaf);
      }

      // Accumulate qty by shipping status
      const bucket = classifyStatus(r.shippingStatus || "");
      const qty = Number(r.qty1) || 0;
      if (bucket === "order") {
        sizeLeaf.orderQty += qty;
        fpoBranch.orderQty += qty;
        poRoot.orderQty += qty;
      } else if (bucket === "output") {
        sizeLeaf.outputQty += qty;
        fpoBranch.outputQty += qty;
        poRoot.outputQty += qty;
      } else if (bucket === "input") {
        sizeLeaf.inputQty += qty;
        fpoBranch.inputQty += qty;
        poRoot.inputQty += qty;
      }
    }

    // Compute progress + status + anomalies for each leaf
    for (const [, poRoot] of tree) {
      for (const fpoBranch of poRoot.factoryPOs) {
        for (const sizeLeaf of fpoBranch.sizes) {
          sizeLeaf.pending = Math.max(0, sizeLeaf.outputQty - sizeLeaf.inputQty);
          sizeLeaf.remaining = Math.max(0, sizeLeaf.orderQty - sizeLeaf.outputQty);
          sizeLeaf.outputProgress = sizeLeaf.orderQty > 0 ? Math.round((sizeLeaf.outputQty / sizeLeaf.orderQty) * 1000) / 10 : 0;
          sizeLeaf.inputProgress = sizeLeaf.orderQty > 0 ? Math.round((sizeLeaf.inputQty / sizeLeaf.orderQty) * 1000) / 10 : 0;
          sizeLeaf.inputVsOutput = sizeLeaf.outputQty > 0 ? Math.round((sizeLeaf.inputQty / sizeLeaf.outputQty) * 1000) / 10 : 0;

          // Status
          const statuses: string[] = [];
          if (sizeLeaf.outputQty === 0 && sizeLeaf.orderQty > 0) statuses.push("NOT_STARTED");
          else if (sizeLeaf.outputQty > 0 && sizeLeaf.outputQty < sizeLeaf.orderQty) statuses.push("IN_PROGRESS");
          if (sizeLeaf.outputQty >= sizeLeaf.orderQty && sizeLeaf.orderQty > 0) statuses.push("OUTPUT_COMPLETED");
          if (sizeLeaf.inputQty < sizeLeaf.outputQty) statuses.push("INPUT_IN_PROGRESS");
          if (sizeLeaf.inputQty >= sizeLeaf.outputQty && sizeLeaf.outputQty > 0) statuses.push("INPUT_COMPLETED");
          if (sizeLeaf.outputQty > sizeLeaf.orderQty && sizeLeaf.orderQty > 0) statuses.push("OVER_OUTPUT");
          if (sizeLeaf.inputQty > sizeLeaf.orderQty && sizeLeaf.orderQty > 0) statuses.push("OVER_INPUT");
          sizeLeaf.status = statuses;

          // Anomalies
          const anomalies: string[] = [];
          if (sizeLeaf.outputQty > sizeLeaf.orderQty && sizeLeaf.orderQty > 0) {
            anomalies.push(`OVER_OUTPUT: excess ${sizeLeaf.outputQty - sizeLeaf.orderQty}`);
          }
          if (sizeLeaf.inputQty > sizeLeaf.outputQty && sizeLeaf.outputQty > 0) {
            anomalies.push(`INPUT_EXCEEDS_OUTPUT: excess ${sizeLeaf.inputQty - sizeLeaf.outputQty}`);
          }
          sizeLeaf.anomalies = anomalies;
        }

        // Aggregate branch
        fpoBranch.pending = Math.max(0, fpoBranch.outputQty - fpoBranch.inputQty);
        fpoBranch.remaining = Math.max(0, fpoBranch.orderQty - fpoBranch.outputQty);
        fpoBranch.outputProgress = fpoBranch.orderQty > 0 ? Math.round((fpoBranch.outputQty / fpoBranch.orderQty) * 1000) / 10 : 0;
        fpoBranch.inputProgress = fpoBranch.orderQty > 0 ? Math.round((fpoBranch.inputQty / fpoBranch.orderQty) * 1000) / 10 : 0;
        fpoBranch.inputVsOutput = fpoBranch.outputQty > 0 ? Math.round((fpoBranch.inputQty / fpoBranch.outputQty) * 1000) / 10 : 0;
        fpoBranch.sizeCount = fpoBranch.sizes.length;
        // Pick first size's meta for branch display
        if (fpoBranch.sizes.length > 0) {
          const s = fpoBranch.sizes[0]!;
          fpoBranch.model = s.model;
          fpoBranch.sku = s.sku;
          fpoBranch.colorCode = s.colorCode;
          fpoBranch.season = s.season;
          fpoBranch.deadline = s.deadline;
        }
      }

      // Aggregate root
      poRoot.pending = Math.max(0, poRoot.outputQty - poRoot.inputQty);
      poRoot.remaining = Math.max(0, poRoot.orderQty - poRoot.outputQty);
      poRoot.outputProgress = poRoot.orderQty > 0 ? Math.round((poRoot.outputQty / poRoot.orderQty) * 1000) / 10 : 0;
      poRoot.inputProgress = poRoot.orderQty > 0 ? Math.round((poRoot.inputQty / poRoot.orderQty) * 1000) / 10 : 0;
      poRoot.inputVsOutput = poRoot.outputQty > 0 ? Math.round((poRoot.inputQty / poRoot.outputQty) * 1000) / 10 : 0;
      poRoot.factoryPOCount = poRoot.factoryPOs.length;
    }

    const hierarchy = [...tree.values()].sort((a, b) => b.orderQty - a.orderQty);

    return NextResponse.json({
      ok: true,
      hierarchy,
      summary: {
        totalPOs: hierarchy.length,
        totalFactoryPOs: hierarchy.reduce((s, p) => s + p.factoryPOCount, 0),
        totalSizes: hierarchy.reduce((s, p) => s + p.factoryPOs.reduce((s2, f) => s2 + f.sizeCount, 0), 0),
        totalOrderQty: hierarchy.reduce((s, p) => s + p.orderQty, 0),
        totalOutputQty: hierarchy.reduce((s, p) => s + p.outputQty, 0),
        totalInputQty: hierarchy.reduce((s, p) => s + p.inputQty, 0),
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to fetch drill-down data";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
