import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  classifyShippingStatus,
  computeProductionSummary,
} from "@/lib/quantity-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/global-dashboard
// Compares MAFATE vs ONYX vs MIZUNO side-by-side for the Global Dashboard.
// Pending is calculated dynamically (= -Output) — no longer stored in DB.
export async function GET() {
  const products = ["MAFATE", "ONYX", "MIZUNO"];
  const result: any[] = [];
  for (const productType of products) {
    const rows = await db.masterData.findMany({
      where: { productType },
      select: {
        poNo: true, factoryPO: true, model: true, sku: true,
        shippingStatus: true, qty1: true,
      },
    });

    let orderQty = 0, outputQty = 0, inputQty = 0;
    const poSet = new Set<string>();
    const fpoSet = new Set<string>();
    const modelSet = new Set<string>();
    const skuSet = new Set<string>();
    for (const r of rows) {
      const q = r.qty1 ?? 0;
      const bucket = classifyShippingStatus(r.shippingStatus);
      if (bucket === "order") orderQty += q;
      else if (bucket === "output") outputQty += q;
      else if (bucket === "input") inputQty += q;
      if (r.poNo) poSet.add(r.poNo);
      if (r.factoryPO) fpoSet.add(r.factoryPO);
      if (r.model) modelSet.add(r.model);
      if (r.sku) skuSet.add(r.sku);
    }

    const summary = computeProductionSummary({
      orderQty,
      outputQty,
      pendingQty: -outputQty, // Pending = -Output (dynamic, not stored)
      inputQty,
    });
    result.push({
      productType,
      ...summary,
      totalPOs: poSet.size,
      totalFactoryPOs: fpoSet.size,
      totalModels: modelSet.size,
      totalSKUs: skuSet.size,
      totalRows: rows.length,
    });
  }
  return NextResponse.json({ products: result });
}
