import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rebuildMasterGroups } from "@/lib/master-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface BulkMasterRow {
  productType: string;
  factoryPO: string;
  size: string;
  poNo?: string;
  shippingStatus?: string;
  model?: string;
  sku?: string;
  item?: string;
  season?: string;
  colorCode?: string;
  colorCode2?: string;
  painting?: string;
  printingColor?: string;
  qty1?: string | number;
  qty2?: string | number;
  deadline?: string;
  date?: string;
}

// POST /api/master-data/bulk
// Adds multiple master data rows in a single transaction, then rebuilds the
// MasterGroup index ONCE (not per row — much faster for bulk entry → add-to-master).
// NO duplicate check: multiple rows with same PO + FPO + Size are allowed
// (split shipment scenario).
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { rows: BulkMasterRow[] };
    if (!Array.isArray(body.rows) || body.rows.length === 0) {
      return NextResponse.json({ error: "rows must be a non-empty array" }, { status: 400 });
    }
    if (body.rows.length > 500) {
      return NextResponse.json({ error: "Maximum 500 rows per bulk request" }, { status: 400 });
    }

    // Group rows by productType so we can rebuild the index per product.
    const productTypes = new Set<string>();
    for (const r of body.rows) {
      if (!r.productType) {
        return NextResponse.json({ error: "Each row must have productType" }, { status: 400 });
      }
      if (!r.factoryPO || !r.size) {
        return NextResponse.json({ error: "Each row must have factoryPO and size" }, { status: 400 });
      }
      productTypes.add(r.productType);
    }

    // Insert all rows in a single transaction (atomic).
    let inserted = 0;
    const createdIds: string[] = [];

    await db.$transaction(async (tx) => {
      for (const r of body.rows) {
        const created = await tx.masterData.create({
          data: {
            productType: r.productType,
            date: r.date || null,
            shippingStatus: r.shippingStatus || null,
            model: r.model || null,
            sku: r.sku || null,
            poNo: r.poNo || null,
            factoryPO: r.factoryPO,
            item: r.item || null,
            season: r.season || null,
            colorCode: r.colorCode || null,
            colorCode2: r.colorCode2 || null,
            painting: r.painting || null,
            printingColor: r.printingColor || null,
            size: r.size,
            qty1: r.qty1 !== undefined && r.qty1 !== "" ? parseInt(String(r.qty1), 10) || 0 : null,
            qty2: r.qty2 !== undefined && r.qty2 !== "" ? parseInt(String(r.qty2), 10) || 0 : null,
            deadline: r.deadline || null,
            sourceFile: "manual-entry",
          },
        });
        createdIds.push(created.id);
        inserted++;
      }
    });

    // Rebuild MasterGroup index ONCE per affected product (not per row).
    // This is the critical performance fix: previously each addMasterRow call
    // rebuilt the entire index, so adding 10 rows = 10 full rebuilds.
    for (const pt of productTypes) {
      try {
        await rebuildMasterGroups(undefined, pt);
      } catch (rebuildErr) {
        console.error(`rebuildMasterGroups failed for ${pt}:`, rebuildErr);
      }
    }

    return NextResponse.json({
      ok: true,
      inserted,
      createdIds,
      productsAffected: productTypes.size,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Bulk add failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
