// EntryService
// Implements the Preview → Confirm → Insert workflow for data entry.
//
// Key business rules (per spec):
//   - Shipping Status is MANDATORY and chosen first.
//   - Q'ty 2 is computed from Q'ty 1 + Shipping Status:
//       1.Order   → qty2 = qty
//       2.Output  → qty2 = qty  (AND auto-create a paired 3.Pending record with qty2 = -qty)
//       3.Pending → qty2 = -qty
//       4.Input   → qty2 = qty
//   - Date = today (set at CONFIRM time, not form-open time).
//   - Master Data is READ-ONLY: lookup fills reference fields, but entries never mutate master data.
//   - Output + Pending are an atomic transaction sharing a transactionGroupId.
//   - Merge: if an existing entry has ALL business fields identical, sum qty (don't create duplicate).
//
// Preview never touches the DB. Confirm runs inside a $transaction.

import { db } from "./db";
import { lookupFactoryPO } from "./master-service";
import { classifyShippingStatus } from "./quantity-service";
import type { MasterGroup } from "@/types";

export const SHIPPING_STATUSES = [
  { value: "1.Order", label: "1.Order" },
  { value: "2.Output", label: "2.Output" },
  { value: "3.Pending", label: "3.Pending" },
  { value: "4.Input", label: "4.Input" },
] as const;

// Compute Q'ty 2 from Q'ty 1 + Shipping Status (spec §10).
export function computeQty2(shippingStatus: string, qty1: string): string {
  const n = Number(qty1);
  if (isNaN(n)) return "0";
  const bucket = classifyShippingStatus(shippingStatus);
  switch (bucket) {
    case "pending":
      return String(-Math.abs(n)); // 3.Pending → qty2 = -qty
    case "order":
    case "output":
    case "input":
      return String(n); // 1.Order, 2.Output, 4.Input → qty2 = qty
    default:
      return String(n);
  }
}

// Whether a given shipping status triggers the paired Output+Pending transaction.
export function isOutputStatus(shippingStatus: string): boolean {
  return classifyShippingStatus(shippingStatus) === "output";
}

// Whether this status is normally auto-created (Pending from Output) and thus
// manually creating it should warn the user (spec §19).
export function isPendingStatus(shippingStatus: string): boolean {
  return classifyShippingStatus(shippingStatus) === "pending";
}

export interface EntryInput {
  productType: string;
  shippingStatus: string;
  poNo: string;
  factoryPO: string;
  size: string;
  qty: string; // user-entered qty → mapped to qty1
}

export interface EntryPreview {
  ok: boolean;
  errors: string[];
  warnings: string[];
  // Computed fields
  date: string;
  qty1: string;
  qty2: string;
  // Auto-filled from Master Data (empty if not found)
  model: string;
  sku: string;
  item: string;
  season: string;
  colorCode: string;
  colorCode2: string;
  painting: string;
  printingColor: string;
  deadline: string;
  masterDataReference: { factoryPO: string; poNo: string; size: string } | null;
  masterDataFound: boolean;
  // For Output status: the paired Pending record that will be created.
  pairedPending?: EntryPreviewRecord;
  // Whether an existing identical entry will be merged (qty summed).
  mergeInfo?: { existingId: string; existingQty: number; newQty: number };
}

export interface EntryPreviewRecord {
  shippingStatus: string;
  qty1: string;
  qty2: string;
}

// PREVIEW: validate + lookup + compute, NO database write (spec §38).
export async function previewEntry(input: EntryInput): Promise<EntryPreview> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Validation (spec §13)
  if (!input.shippingStatus) errors.push("Shipping Status is required");
  if (!input.poNo) errors.push("PO NO# is required");
  if (!input.factoryPO) errors.push("Factory PO is required");
  if (!input.size) errors.push("Size is required");
  const qtyNum = Number(input.qty);
  if (!input.qty) errors.push("Qty is required");
  else if (isNaN(qtyNum)) errors.push("Qty must be a number");
  else if (qtyNum <= 0) errors.push("Qty must be greater than 0");

  // Warn if user manually selects 3.Pending (usually auto-created from Output, spec §19)
  if (isPendingStatus(input.shippingStatus)) {
    warnings.push("Pending is normally auto-created from Output. Continue only if this is a manual adjustment.");
  }

  if (errors.length > 0) {
    return {
      ok: false,
      errors,
      warnings,
      date: "",
      qty1: "",
      qty2: "",
      model: "",
      sku: "",
      item: "",
      season: "",
      colorCode: "",
      colorCode2: "",
      painting: "",
      printingColor: "",
      deadline: "",
      masterDataReference: null,
      masterDataFound: false,
    };
  }

  // Lookup Master Data (product-scoped). Lookup ≠ Insert.
  const group: MasterGroup | null = await lookupFactoryPO(input.factoryPO, input.productType);
  const masterDataFound = !!group;

  let model = "", sku = "", item = "", season = "";
  let colorCode = "", colorCode2 = "", painting = "", printingColor = "", deadline = "";
  let masterDataReference: { factoryPO: string; poNo: string; size: string } | null = null;

  if (group) {
    // Verify the size belongs to this Factory PO.
    const norm = (s: string) => s.replace(/\s+/g, " ").trim();
    const sizeExists = group.sizes.some((s) => norm(s) === norm(input.size));
    if (!sizeExists) {
      warnings.push(`Size "${input.size}" is not in the size list for Factory PO ${input.factoryPO} (proceeding anyway).`);
    }
    // Fill reference fields from Master Group.
    model = group.model || "";
    sku = group.sku || "";
    item = group.item || "";
    season = group.season || "";
    colorCode = group.colorCode || "";
    colorCode2 = group.colorCode2 || "";
    painting = group.painting || "";
    printingColor = group.printingColor || "";
    deadline = group.nearestDeadline || group.deadline || "";
    masterDataReference = { factoryPO: input.factoryPO, poNo: input.poNo, size: input.size };
  } else {
    // Master Data not found: leave reference fields blank (spec §7, §46 — never guess).
    warnings.push(`Reference data not found for Factory PO "${input.factoryPO}". Fields will be left blank.`);
  }

  // Date = today (at preview we show today, but final date is set at confirm).
  const date = new Date().toISOString().slice(0, 10);
  const qty1 = String(qtyNum);
  const qty2 = computeQty2(input.shippingStatus, input.qty);

  const preview: EntryPreview = {
    ok: true,
    errors,
    warnings,
    date,
    qty1,
    qty2,
    model,
    sku,
    item,
    season,
    colorCode,
    colorCode2,
    painting,
    printingColor,
    deadline,
    masterDataReference,
    masterDataFound,
  };

  // For Output, prepare the paired Pending record (spec §17).
  if (isOutputStatus(input.shippingStatus)) {
    preview.pairedPending = {
      shippingStatus: "3.Pending",
      qty1: qty1,           // same qty1
      qty2: String(-Math.abs(qtyNum)), // negated qty2
    };
  }

  // Auto-merge is DISABLED per user request: each entry creates a separate row
  // so the user can inspect each one individually. No mergeInfo is computed.

  return preview;
}

// Auto-merge is DISABLED per user request (findMergeCandidate kept for reference but unused).
// Each entry creates a separate row so the user can inspect each one individually.

// Generate a transaction group ID: OUT-<factoryPO>-<yyyyMMdd>-<seq>
function makeTransactionGroupId(factoryPO: string): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const seq = String(Math.floor(Math.random() * 9000) + 1000);
  return `OUT-${factoryPO}-${ymd}-${seq}`;
}

// CONFIRM: atomic database transaction (spec §39, §40).
// For Output: creates BOTH Output and Pending records sharing a transactionGroupId.
// Applies merge logic if an identical entry exists.
export async function confirmEntry(input: EntryInput, preview: EntryPreview): Promise<{
  ok: boolean;
  errors: string[];
  created?: any[];
  merged?: { id: string; newQty: string }[];
}> {
  // Re-validate (spec §39: validate again at confirm time).
  if (!preview.ok) {
    return { ok: false, errors: preview.errors.length ? preview.errors : ["Preview is invalid"] };
  }
  const qtyNum = Number(input.qty);
  if (isNaN(qtyNum) || qtyNum <= 0) {
    return { ok: false, errors: ["Invalid Qty"] };
  }

  // Re-lookup master data (don't trust stale preview, spec §39).
  const group = await lookupFactoryPO(input.factoryPO, input.productType);
  const today = new Date().toISOString().slice(0, 10);
  const qty1 = String(qtyNum);
  const qty2 = computeQty2(input.shippingStatus, input.qty);
  const masterDataReference = group
    ? JSON.stringify({ factoryPO: input.factoryPO, poNo: input.poNo, size: input.size })
    : null;

  const sharedData = {
    date: today,
    model: group?.model || "",
    sku: group?.sku || "",
    poNo: input.poNo,
    factoryPO: input.factoryPO,
    item: group?.item || "",
    season: group?.season || "",
    colorCode: group?.colorCode || "",
    colorCode2: group?.colorCode2 || "",
    painting: group?.painting || "",
    printingColor: group?.printingColor || "",
    deadline: group?.nearestDeadline || group?.deadline || "",
    productType: input.productType,
    size: input.size,
    masterDataReference,
  };

  try {
    // Run everything in a single transaction for atomicity (spec §40).
    // Auto-merge is DISABLED per user request: each entry creates a separate row.
    //
    // PENDING IS NO LONGER STORED: Previously, creating a 2.Output entry also
    // created a paired 3.Pending record. This doubled the data volume and slowed
    // the website. Pending is now calculated dynamically (= -Output) wherever
    // needed. Only the main record is created here.
    const result = await db.$transaction(async (tx) => {
      const created: any[] = [];

      // Main record (user's chosen status) — always CREATE, never merge.
      const mainRec = await tx.entryData.create({
        data: {
          ...sharedData,
          shippingStatus: input.shippingStatus,
          qty1,
          qty2,
        },
      });
      created.push(mainRec);

      return { created, merged: [] as { id: string; newQty: number }[] };
    });
    return { ok: true, errors: [], created: result.created, merged: result.merged };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Database transaction failed";
    return { ok: false, errors: [msg] };
  }
}

// Delete with transaction-group awareness (spec §32).
// If deleting an Output record that has a paired Pending, warn and offer to delete both.
export async function deleteEntryWithGroup(id: string): Promise<{
  ok: boolean;
  pairedDeleted?: string[];
  needsConfirm?: { pairedId: string; message: string };
}> {
  const entry = await db.entryData.findUnique({ where: { id } });
  if (!entry) return { ok: false };

  // If this entry is part of a transaction group, find its sibling.
  if (entry.transactionGroupId) {
    const siblings = await db.entryData.findMany({
      where: { transactionGroupId: entry.transactionGroupId, id: { not: id } },
      select: { id: true, shippingStatus: true, qty1: true },
    });
    if (siblings.length > 0) {
      const paired = siblings[0];
      const isOutput = classifyShippingStatus(entry.shippingStatus || "") === "output";
      const message = isOutput
        ? `This Output has an associated Pending transaction (Qty1=${paired.qty1}). Delete both?`
        : `This Pending was auto-created from an Output. Delete both?`;
      return {
        ok: false,
        needsConfirm: { pairedId: paired.id, message },
      };
    }
  }

  await db.entryData.delete({ where: { id } });
  return { ok: true };
}

// Delete both the entry and its transaction-group sibling (atomic).
export async function deleteEntryGroup(id: string): Promise<{ ok: boolean; deleted: string[] }> {
  const entry = await db.entryData.findUnique({ where: { id } });
  if (!entry) return { ok: false, deleted: [] };
  const deleted: string[] = [];
  await db.$transaction(async (tx) => {
    if (entry.transactionGroupId) {
      const siblings = await tx.entryData.findMany({
        where: { transactionGroupId: entry.transactionGroupId },
        select: { id: true },
      });
      for (const s of siblings) {
        await tx.entryData.delete({ where: { id: s.id } });
        deleted.push(s.id);
      }
    } else {
      await tx.entryData.delete({ where: { id } });
      deleted.push(id);
    }
  });
  return { ok: true, deleted };
}
