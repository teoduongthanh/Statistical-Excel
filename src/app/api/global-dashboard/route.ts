import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { computeProductionSummary } from "@/lib/quantity-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/global-dashboard
// Compares MAFATE vs ONYX vs MIZUNO side-by-side for the Global Dashboard.
// Pending is calculated dynamically (= -Output) — no longer stored in DB.
export async function GET() {
  const products = ["MAFATE", "ONYX", "MIZUNO"];
  const result = [];
  for (const productType of products) {
    const rows = await db.$queryRawUnsafe<any[]>(`
      SELECT
        COUNT(DISTINCT poNo) AS totalPOs,
        COUNT(DISTINCT factoryPO) AS totalFactoryPOs,
        COUNT(DISTINCT model) AS totalModels,
        COUNT(DISTINCT sku) AS totalSKUs,
        COUNT(*) AS totalRows,
        SUM(CASE WHEN LOWER(shippingStatus) LIKE '1%' OR LOWER(shippingStatus) = 'order' THEN COALESCE(qty1, 0) ELSE 0 END) AS orderQty,
        SUM(CASE WHEN LOWER(shippingStatus) LIKE '2%' OR LOWER(shippingStatus) = 'output' THEN COALESCE(qty1, 0) ELSE 0 END) AS outputQty,
        SUM(CASE WHEN LOWER(shippingStatus) LIKE '4%' OR LOWER(shippingStatus) = 'input' THEN COALESCE(qty1, 0) ELSE 0 END) AS inputQty
      FROM MasterData
      WHERE productType = ?
    `, productType);
    const r = rows[0] || {};
    const outputQty = Number(r.outputQty) || 0;
    const summary = computeProductionSummary({
      orderQty: Number(r.orderQty) || 0,
      outputQty,
      pendingQty: -outputQty, // Pending = -Output (dynamic, not stored)
      inputQty: Number(r.inputQty) || 0,
    });
    result.push({
      productType,
      ...summary,
      totalPOs: Number(r.totalPOs) || 0,
      totalFactoryPOs: Number(r.totalFactoryPOs) || 0,
      totalModels: Number(r.totalModels) || 0,
      totalSKUs: Number(r.totalSKUs) || 0,
      totalRows: Number(r.totalRows) || 0,
    });
  }
  return NextResponse.json({ products: result });
}
