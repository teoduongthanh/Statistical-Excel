import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { lookupFactoryPO } from "@/lib/master-service";
import { computeQty2 } from "@/lib/entry-service";
import { classifyShippingStatus } from "@/lib/quantity-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface BatchGenerateItem {
  factoryPO: string;
  sizes?: string[];   // if omitted, use ALL sizes from master group
  qty: number;        // qty per size
}

interface BatchGenerateBody {
  productType: string;
  shippingStatus: string;
  poNo?: string;      // optional PO NO# override (else from master)
  items: BatchGenerateItem[];
}

interface GeneratedEntry {
  factoryPO: string;
  size: string;
  qty: number;
  ok: boolean;
  entry?: any;
  error?: string;
  model?: string;
  sku?: string;
  colorCode?: string;
  deadline?: string;
}

// POST /api/entries/batch-generate
// Creates entries for MULTIPLE Factory POs at once. For each Factory PO, creates
// entries for each size (either all sizes from master data, or a user-specified
// subset). All entries share the same shippingStatus + qty.
//
// Atomic: all succeed or all fail (ROLLBACK on error).
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as BatchGenerateBody;
    const productType = body.productType;
    if (!productType) {
      return NextResponse.json(
        { ok: false, error: "productType is required" },
        { status: 400 }
      );
    }
    if (!body.shippingStatus) {
      return NextResponse.json(
        { ok: false, error: "shippingStatus is required" },
        { status: 400 }
      );
    }
    if (!Array.isArray(body.items) || body.items.length === 0) {
      return NextResponse.json(
        { ok: false, error: "items array is required and must not be empty" },
        { status: 400 }
      );
    }
    if (body.items.length > 200) {
      return NextResponse.json(
        { ok: false, error: "Cannot generate more than 200 Factory POs at once" },
        { status: 400 }
      );
    }

    // Validate qty
    for (const it of body.items) {
      const qty = Number(it.qty);
      if (isNaN(qty) || qty <= 0) {
        return NextResponse.json(
          { ok: false, error: `Invalid qty for Factory PO "${it.factoryPO}": must be > 0` },
          { status: 400 }
        );
      }
    }

    // Pre-lookup all Factory PO groups (batch) so we can validate before insert.
    const factoryPOs = body.items.map((it) => it.factoryPO.trim());
    const groups = await db.masterGroup.findMany({
      where: { productType, factoryPO: { in: factoryPOs } },
    });
    const groupMap = new Map(groups.map((g) => [g.factoryPO, g]));

    // Build the full list of entries to create.
    const entriesToCreate: GeneratedEntry[] = [];
    const notFound: string[] = [];

    for (const it of body.items) {
      const fpo = it.factoryPO.trim();
      const group = groupMap.get(fpo);
      if (!group) {
        notFound.push(fpo);
        entriesToCreate.push({
          factoryPO: fpo,
          size: "—",
          qty: it.qty,
          ok: false,
          error: `Factory PO "${fpo}" not found in Master Data`,
        });
        continue;
      }

      // Determine sizes: user-specified or all from master group.
      let sizes: string[];
      try {
        const allSizes: string[] = JSON.parse(group.sizes || "[]");
        if (it.sizes && it.sizes.length > 0) {
          // Filter to only sizes that exist in the master group.
          const norm = (s: string) => s.replace(/\s+/g, " ").trim();
          const masterSet = new Set(allSizes.map(norm));
          sizes = it.sizes.filter((s) => masterSet.has(norm(s)));
          if (sizes.length === 0) {
            // If none of the user sizes match, use all master sizes.
            sizes = allSizes;
          }
        } else {
          sizes = allSizes;
        }
      } catch {
        sizes = [];
      }

      if (sizes.length === 0) {
        entriesToCreate.push({
          factoryPO: fpo,
          size: "—",
          qty: it.qty,
          ok: false,
          error: `Factory PO "${fpo}" has no sizes in Master Data`,
        });
        continue;
      }

      const qtyNum = Number(it.qty);
      for (const size of sizes) {
        entriesToCreate.push({
          factoryPO: fpo,
          size,
          qty: qtyNum,
          ok: true,
          model: group.model || "",
          sku: group.sku || "",
          colorCode: group.colorCode || "",
          deadline: group.nearestDeadline || group.deadline || "",
        });
      }
    }

    // Atomic transaction: insert all valid entries.
    const validEntries = entriesToCreate.filter((e) => e.ok);
    const today = new Date().toISOString().slice(0, 10);
    const qty2 = computeQty2(body.shippingStatus, validEntries[0]?.qty || 0);

    const result = await db.$transaction(async (tx) => {
      const created: any[] = [];
      for (const e of validEntries) {
        const group = groupMap.get(e.factoryPO)!;
        const masterDataReference = JSON.stringify({
          factoryPO: e.factoryPO,
          poNo: body.poNo || group.poNo || "",
          size: e.size,
        });
        const entry = await tx.entryData.create({
          data: {
            productType,
            date: today,
            shippingStatus: body.shippingStatus,
            model: group.model || "",
            sku: group.sku || "",
            poNo: body.poNo || group.poNo || "",
            factoryPO: e.factoryPO,
            item: group.item || "",
            season: group.season || "",
            colorCode: group.colorCode || "",
            colorCode2: group.colorCode2 || "",
            painting: group.painting || "",
            printingColor: group.printingColor || "",
            deadline: group.nearestDeadline || group.deadline || "",
            size: e.size,
            qty1: e.qty,
            qty2: computeQty2(body.shippingStatus, e.qty),
            masterDataReference,
          },
        });
        created.push(entry);
        e.entry = entry;
      }

      // Audit log.
      await tx.auditLog.create({
        data: {
          productType,
          user: "batch-generate",
          action: "BATCH_GENERATE",
          entityType: "EntryData",
          entityId: created.map((c) => c.id).join(","),
          detail: JSON.stringify({
            shippingStatus: body.shippingStatus,
            factoryPOCount: body.items.length,
            totalEntries: created.length,
            factoryPOs: body.items.map((it) => ({
              factoryPO: it.factoryPO,
              sizes: it.sizes || "all",
              qty: it.qty,
            })),
          }),
        },
      });

      return { created };
    });

    // Update the entriesToCreate with the created entry references.
    const createdById = new Map(result.created.map((c: any) => [c.id, c]));
    let createdIdx = 0;
    for (const e of entriesToCreate) {
      if (e.ok && createdIdx < result.created.length) {
        e.entry = result.created[createdIdx];
        createdIdx++;
      }
    }

    const successCount = entriesToCreate.filter((e) => e.ok).length;
    const failCount = entriesToCreate.filter((e) => !e.ok).length;
    const totalCreated = result.created.length;

    return NextResponse.json({
      ok: true,
      totalCreated,
      totalFactoryPOs: body.items.length,
      factoryPOsProcessed: body.items.length - notFound.length,
      factoryPOsNotFound: notFound.length,
      notFoundList: notFound,
      entries: entriesToCreate,
      summary: {
        success: successCount,
        failed: failCount,
        created: totalCreated,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Batch generate failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
