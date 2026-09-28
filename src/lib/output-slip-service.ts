// OutputSlipService
// Business logic for the BULK OUTPUT SLIP GENERATOR.
//
// Key business rules:
//   1. REMAINING OUTPUT = TOTAL ORDER - TOTAL OUTPUT, computed per
//      (productType + poNo + factoryPO + size). NOT per PO NO# alone.
//   2. Generating a slip does NOT write to EntryData. It's a preparation doc.
//   3. Only "Confirm Actual Output" creates the real 2.Output entries.
//   4. Conflict check: re-validate Remaining Output at confirm time — if the
//      DB changed since the slip was generated, refuse confirm.

import { db } from "./db";
import { classifyShippingStatus, parseDeadline } from "./quantity-service";
import * as XLSX from "xlsx";

// ===== Types =====

export interface FactoryPOGroup {
  factoryPO: string;
  poNo: string;
  model: string;
  sku: string;
  season: string;
  colorCode: string;
  colorCode2: string;
  painting: string;
  printingColor: string;
  deadline: string | null;
  // Per-size breakdown
  sizes: SizeRow[];
  // Aggregates
  totalOrder: number;
  totalOutput: number;
  totalRemaining: number;
  // "READY_TO_OUTPUT" if remaining > 0, else "COMPLETED"
  status: "READY_TO_OUTPUT" | "COMPLETED";
}

export interface SizeRow {
  size: string;
  orderQty: number;
  outputQty: number;
  remainingOutput: number;
}

export interface SlipItem {
  factoryPO: string;
  poNo: string;
  model: string;
  sku: string;
  season: string;
  colorCode: string;
  colorCode2: string;
  painting: string;
  printingColor: string;
  size: string;
  qtyToOutput: number;
  orderQty: number;
  outputQty: number;
  remainingOutput: number;
  deadline: string | null;
}

export type SlipMode = "combined" | "separate" | "group_by_color";
export type SlipStatus = "draft" | "generated" | "printed" | "confirmed_output" | "cancelled";

// ===== Compute Remaining Output =====

// Fetch all (factoryPO, size) groups for a given (productType + poNo) with their
// Order / Output totals. Remaining Output = Order - Output, per size.
export async function getFactoryPOGroupsByPoNo(
  productType: string,
  poNo: string
): Promise<FactoryPOGroup[]> {
  // Fetch raw rows; aggregation done in JS (MongoDB-compatible).
  const rows = await db.masterData.findMany({
    where: {
      productType,
      poNo,
      factoryPO: { not: null, not: "" },
      size: { not: null, not: "" },
    },
    select: {
      factoryPO: true, poNo: true, size: true,
      model: true, sku: true, season: true,
      colorCode: true, colorCode2: true,
      painting: true, printingColor: true,
      deadline: true, shippingStatus: true, qty1: true,
    },
  });

  // Group by factoryPO and size, computing Order/Output sums via classifyShippingStatus.
  // We also track the first non-empty value per group for shared metadata columns.
  type SizeAgg = SizeRow & { metaDeadline: Date | null };
  const byFpo = new Map<string, SizeAgg[]>();
  const meta = new Map<string, {
    model: string; sku: string; season: string;
    colorCode: string; colorCode2: string;
    painting: string; printingColor: string;
    nearestDeadline: Date | null;
  }>();

  for (const r of rows) {
    const fpo = r.factoryPO ?? "";
    if (!fpo) continue;
    if (!byFpo.has(fpo)) {
      byFpo.set(fpo, []);
      meta.set(fpo, {
        model: "", sku: "", season: "",
        colorCode: "", colorCode2: "",
        painting: "", printingColor: "",
        nearestDeadline: null,
      });
    }
    const m = meta.get(fpo)!;
    if (r.model) m.model = r.model;
    if (r.sku) m.sku = r.sku;
    if (r.season) m.season = r.season;
    if (r.colorCode) m.colorCode = r.colorCode;
    if (r.colorCode2) m.colorCode2 = r.colorCode2;
    if (r.painting) m.painting = r.painting;
    if (r.printingColor) m.printingColor = r.printingColor;
    if (r.deadline) {
      const d = parseDeadline(r.deadline);
      if (d) {
        if (!m.nearestDeadline || d.getTime() < m.nearestDeadline.getTime()) {
          m.nearestDeadline = d;
        }
      }
    }

    const orderQty = classifyShippingStatus(r.shippingStatus) === "order" ? (r.qty1 ?? 0) : 0;
    const outputQty = classifyShippingStatus(r.shippingStatus) === "output" ? (r.qty1 ?? 0) : 0;
    const sizeArr = byFpo.get(fpo)!;
    // Try to find existing SizeAgg entry with same size.
    const norm = (s: string) => s.replace(/\s+/g, " ").trim();
    const rSize = r.size ?? "";
    const rSizeNorm = norm(rSize);
    let entry = sizeArr.find((s) => norm(s.size) === rSizeNorm);
    if (!entry) {
      entry = {
        size: rSize,
        orderQty: 0, outputQty: 0, remainingOutput: 0,
        metaDeadline: null,
      };
      sizeArr.push(entry);
    }
    entry.orderQty += orderQty;
    entry.outputQty += outputQty;
    if (r.deadline) {
      const d = parseDeadline(r.deadline);
      if (d) {
        if (!entry.metaDeadline || d.getTime() < entry.metaDeadline.getTime()) {
          entry.metaDeadline = d;
        }
      }
    }
  }

  // Sort sizes alphabetically and finalize remainingOutput.
  const groups: FactoryPOGroup[] = [];
  for (const [fpo, sizes] of byFpo.entries()) {
    sizes.sort((a, b) => a.size.localeCompare(b.size));
    for (const s of sizes) s.remainingOutput = s.orderQty - s.outputQty;
    const m = meta.get(fpo)!;
    const totalOrder = sizes.reduce((s, r) => s + r.orderQty, 0);
    const totalOutput = sizes.reduce((s, r) => s + r.outputQty, 0);
    const totalRemaining = totalOrder - totalOutput;
    groups.push({
      factoryPO: fpo,
      poNo,
      model: m.model,
      sku: m.sku,
      season: m.season,
      colorCode: m.colorCode,
      colorCode2: m.colorCode2,
      painting: m.painting,
      printingColor: m.printingColor,
      deadline: m.nearestDeadline ? m.nearestDeadline.toISOString().slice(0, 10) : null,
      sizes: sizes.map(({ size, orderQty, outputQty, remainingOutput }) => ({ size, orderQty, outputQty, remainingOutput })),
      totalOrder,
      totalOutput,
      totalRemaining,
      status: totalRemaining > 0 ? "READY_TO_OUTPUT" : "COMPLETED",
    });
  }

  // Sort: READY_TO_OUTPUT first (by deadline asc), then COMPLETED.
  groups.sort((a, b) => {
    if (a.status !== b.status) return a.status === "READY_TO_OUTPUT" ? -1 : 1;
    return String(a.deadline || "").localeCompare(String(b.deadline || ""));
  });
  return groups;
}

// Re-fetch current Remaining Output for a set of (factoryPO, size) pairs.
// Used by the conflict check at confirm time.
export async function getCurrentRemaining(
  productType: string,
  poNo: string,
  items: { factoryPO: string; size: string }[]
): Promise<Map<string, number>> {
  if (items.length === 0) return new Map();
  const factoryPOs = [...new Set(items.map((i) => i.factoryPO))];
  const rows = await db.masterData.findMany({
    where: {
      productType,
      poNo,
      factoryPO: { in: factoryPOs },
      size: { not: null, not: "" },
    },
    select: { factoryPO: true, size: true, shippingStatus: true, qty1: true },
  });

  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  const groups = new Map<string, { orderQty: number; outputQty: number }>();
  for (const r of rows) {
    const key = `${r.factoryPO}|${norm(r.size ?? "")}`;
    if (!groups.has(key)) groups.set(key, { orderQty: 0, outputQty: 0 });
    const g = groups.get(key)!;
    const bucket = classifyShippingStatus(r.shippingStatus);
    const q = r.qty1 ?? 0;
    if (bucket === "order") g.orderQty += q;
    else if (bucket === "output") g.outputQty += q;
  }

  const result = new Map<string, number>();
  for (const [key, g] of groups) {
    result.set(key, g.orderQty - g.outputQty);
  }
  return result;
}

// ===== Slip number generator =====

export function generateSlipNumber(): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const seq = String(Math.floor(Math.random() * 9000) + 1000);
  return `OS-${ymd}-${seq}`;
}

// ===== Create slip in DB =====

export interface CreateSlipInput {
  productType: string;
  poNo: string;
  slipMode: SlipMode;
  items: SlipItem[];
  createdBy?: string;
  note?: string;
}

export async function createSlip(input: CreateSlipInput) {
  const slipNumber = generateSlipNumber();
  const totalOrder = input.items.reduce((s, i) => s + i.orderQty, 0);
  const totalOutput = input.items.reduce((s, i) => s + i.outputQty, 0);
  const totalRemaining = input.items.reduce((s, i) => s + i.remainingOutput, 0);
  const totalToOutput = input.items.reduce((s, i) => s + i.qtyToOutput, 0);
  const factoryPOCount = new Set(input.items.map((i) => i.factoryPO)).size;
  const sizeCount = new Set(input.items.map((i) => i.size)).size;

  const slip = await db.outputSlip.create({
    data: {
      slipNumber,
      productType: input.productType,
      poNo: input.poNo,
      slipMode: input.slipMode,
      status: "generated",
      items: JSON.stringify(input.items),
      totalOrder,
      totalOutput,
      totalRemaining,
      totalToOutput,
      factoryPOCount,
      sizeCount,
      createdBy: input.createdBy || null,
      note: input.note || null,
    },
  });
  return slip;
}

// ===== Confirm Actual Output =====

export async function confirmOutputSlip(
  slipId: string,
  confirmedBy?: string
): Promise<{ ok: boolean; errors: string[]; slip?: any; createdCount?: number }> {
  const slip = await db.outputSlip.findUnique({ where: { id: slipId } });
  if (!slip) {
    return { ok: false, errors: ["Slip not found"] };
  }
  if (slip.status !== "generated" && slip.status !== "printed") {
    return { ok: false, errors: [`Slip status is "${slip.status}" — only generated/printed slips can be confirmed`] };
  }

  const items: SlipItem[] = JSON.parse(slip.items || "[]");
  if (items.length === 0) {
    return { ok: false, errors: ["Slip has no items"] };
  }

  // CONFLICT CHECK: re-fetch current Remaining Output for all items.
  const currentRemaining = await getCurrentRemaining(slip.productType, slip.poNo, items);
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();

  // Validate each item: qtyToOutput must not exceed current Remaining Output.
  for (const item of items) {
    const key = `${item.factoryPO}|${norm(item.size)}`;
    const current = currentRemaining.get(key) ?? 0;
    if (item.qtyToOutput > current) {
      return {
        ok: false,
        errors: [
          `OUTPUT QUANTITY CHANGED — Factory PO ${item.factoryPO}, Size ${item.size}: ` +
          `original Remaining was ${item.remainingOutput}, current Remaining is ${current}, ` +
          `requested qty is ${item.qtyToOutput}. Please regenerate the slip.`
        ],
      };
    }
  }

  // Create the actual 2.Output entries in EntryData (atomic transaction).
  // Pending is NOT stored (it's calculated as -Output dynamically).
  const today = new Date().toISOString().slice(0, 10);
  let createdCount = 0;

  try {
    const result = await db.$transaction(async (tx) => {
      // Batch lookup MasterGroup for auto-fill fields.
      const factoryPOs = [...new Set(items.map((i) => i.factoryPO))];
      const groups = await tx.masterGroup.findMany({
        where: { productType: slip.productType, factoryPO: { in: factoryPOs } },
      });
      const groupByFpo = new Map(groups.map((g) => [g.factoryPO, g]));

      for (const item of items) {
        const g = groupByFpo.get(item.factoryPO);
        const masterDataReference = JSON.stringify({
          factoryPO: item.factoryPO,
          poNo: item.poNo,
          size: item.size,
        });
        await tx.entryData.create({
          data: {
            productType: slip.productType,
            date: today,
            shippingStatus: "2.Output",
            model: g?.model || item.model || "",
            sku: g?.sku || item.sku || "",
            poNo: item.poNo,
            factoryPO: item.factoryPO,
            item: g?.item || "",
            season: g?.season || item.season || "",
            colorCode: g?.colorCode || item.colorCode || "",
            colorCode2: g?.colorCode2 || item.colorCode2 || "",
            painting: g?.painting || item.painting || "",
            printingColor: g?.printingColor || item.printingColor || "",
            deadline: g?.nearestDeadline || g?.deadline || item.deadline || "",
            size: item.size,
            qty1: item.qtyToOutput,
            qty2: item.qtyToOutput, // 2.Output → qty2 = qty (positive)
            masterDataReference,
            note: `Output Slip ${slip.slipNumber}`,
          },
        });
        createdCount++;
      }

      // Update slip status.
      const updated = await tx.outputSlip.update({
        where: { id: slipId },
        data: {
          status: "confirmed_output",
          confirmedBy: confirmedBy || null,
          confirmedAt: new Date(),
        },
      });

      // Audit log.
      await tx.auditLog.create({
        data: {
          productType: slip.productType,
          user: confirmedBy || "output-slip-confirm",
          action: "ENTRY_CREATE",
          entityType: "OutputSlip",
          entityId: slip.slipNumber,
          oldValue: JSON.stringify({ status: slip.status, items: items.length }),
          newValue: JSON.stringify({ status: "confirmed_output", createdCount }),
          detail: `Confirmed Output Slip ${slip.slipNumber}: ${createdCount} entries created`,
        },
      });

      return updated;
    });

    return { ok: true, errors: [], slip: result, createdCount };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Confirm failed";
    return { ok: false, errors: [msg] };
  }
}

// ===== Generate Excel =====

export function generateSlipExcel(
  slip: { slipNumber: string; productType: string; poNo: string; slipMode: string; items: string },
  items: SlipItem[],
  format: "multi_sheet" | "combined" | "separate_files"
): Buffer {
  const wb = XLSX.utils.book_new();
  const today = new Date().toISOString().slice(0, 10);

  if (format === "multi_sheet") {
    // One sheet per Factory PO + a Summary sheet.
    const factoryPOs = [...new Set(items.map((i) => i.factoryPO))];
    for (const fpo of factoryPOs) {
      const fpoItems = items.filter((i) => i.factoryPO === fpo);
      const rows = fpoItems.map((i) => ({
        Date: today,
        "PO NO#": i.poNo,
        "Factory PO": i.factoryPO,
        MODEL: i.model,
        SKU: i.sku,
        Season: i.season,
        "Color Code": i.colorCode,
        "COLOR CODE": i.colorCode2,
        PAINTING: i.painting,
        "PRINTING COLOR": i.printingColor,
        Size: i.size,
        "Qty to Output": i.qtyToOutput,
        Order: i.orderQty,
        Output: i.outputQty,
        Remaining: i.remainingOutput,
        Deadline: i.deadline || "",
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      const sheetName = fpo.replace(/[\\/:?*\[\]]/g, "").slice(0, 31);
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    }
  }

  // Combined sheet (always added — for "combined" format this is the only sheet;
  // for "multi_sheet" it's an extra summary sheet).
  const summaryRows = items.map((i) => ({
    Date: today,
    "PO NO#": i.poNo,
    "Factory PO": i.factoryPO,
    MODEL: i.model,
    SKU: i.sku,
    Season: i.season,
    "Color Code": i.colorCode,
    "COLOR CODE": i.colorCode2,
    PAINTING: i.painting,
    "PRINTING COLOR": i.printingColor,
    Size: i.size,
    "Qty to Output": i.qtyToOutput,
    Order: i.orderQty,
    Output: i.outputQty,
    Remaining: i.remainingOutput,
    Deadline: i.deadline || "",
  }));
  const summaryWs = XLSX.utils.json_to_sheet(summaryRows);
  XLSX.utils.book_append_sheet(wb, summaryWs, "OUTPUT SLIP");

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

// ===== List slips =====

export async function listSlips(filters?: {
  productType?: string;
  poNo?: string;
  status?: SlipStatus;
  limit?: number;
}): Promise<any[]> {
  const where: any = {};
  if (filters?.productType) where.productType = filters.productType;
  if (filters?.poNo) where.poNo = filters.poNo;
  if (filters?.status) where.status = filters.status;
  const limit = filters?.limit || 50;
  return db.outputSlip.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}
