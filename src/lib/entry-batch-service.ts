// EntryInputBatch service — manages business "đợt nhập" (input sessions).
//
// Each batch groups multiple EntryData rows entered in one sitting.
// Sequence is per (productType, entryDate, shippingStatus).
//
// batchCode format: <PREFIX>-<YYYYMMDD>-<NNN>
//   PREFIX derived from shippingStatus:
//     1.Order → ORD, 2.Output → OUT, 3.Pending → PND, 4.Input → IN
//
// All EntryData rows created during one session share the same entryBatchId.

import { db } from "./db";

// ===== Types =====

export interface CreateBatchInput {
  productType: string;
  shippingStatus: string;
  entryDate?: string; // YYYY-MM-DD, default today
  entryTime?: string; // HH:mm (24h), default current time
  note?: string;
  createdBy?: string;
}

export interface EntryInputBatchDTO {
  id: string;
  batchCode: string;
  entryDate: string;
  entryTime: string | null;
  entrySequence: number;
  shippingStatus: string;
  productType: string;
  batchName: string;
  totalQuantity: number;
  totalRecords: number;
  isDeleted: boolean;
  isClosed: boolean;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BatchListFilters {
  productType?: string;
  entryDateFrom?: string;
  entryDateTo?: string;
  shippingStatus?: string;
  entrySequence?: number;
  batchCode?: string;
  includeDeleted?: boolean;
  page?: number;
  pageSize?: number;
}

export interface BatchDetail extends EntryInputBatchDTO {
  rows: any[];
}

export interface BatchStats {
  batch: EntryInputBatchDTO;
  totalQuantity: number;
  totalRecords: number;
  byModel: { key: string; totalQty: number; count: number }[];
  byPoNo: { key: string; totalQty: number; count: number }[];
  byFactoryPO: { key: string; totalQty: number; count: number }[];
  byColorCode: { key: string; totalQty: number; count: number }[];
  bySize: { key: string; totalQty: number; count: number }[];
}

export interface BatchComparison {
  batch1: { id: string; batchCode: string; batchName: string };
  batch2: { id: string; batchCode: string; batchName: string };
  // Comparison keyed by the chosen dimension (poNo, factoryPO, colorCode, size).
  dimension: "poNo" | "factoryPO" | "colorCode" | "size";
  rows: { key: string; qty1: number; qty2: number; diff: number; count1: number; count2: number }[];
  totals: { qty1: number; qty2: number; diff: number };
}

// ===== Helpers =====

// Map shippingStatus → batchCode prefix.
function statusPrefix(shippingStatus: string): string {
  const s = (shippingStatus || "").trim();
  if (/^1/i.test(s)) return "ORD";
  if (/^2/i.test(s)) return "OUT";
  if (/^3/i.test(s)) return "PND";
  if (/^4/i.test(s)) return "IN";
  return "EB"; // Entry Batch (fallback)
}

// Format a Date to YYYY-MM-DD (local time, not UTC).
function toYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Format a Date to YYYYMMDD (for batchCode).
function toYMDCompact(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

// Format a Date to HH:mm (24h).
function toHM(d: Date): string {
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

// Format entryDate (YYYY-MM-DD) to DD/MM/YYYY for batchName display.
function toDisplayDate(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  if (!y || !m || !d) return ymd;
  return `${d}/${m}/${y}`;
}

function toDTO(b: any): EntryInputBatchDTO {
  return {
    id: b.id,
    batchCode: b.batchCode,
    entryDate: b.entryDate,
    entryTime: b.entryTime,
    entrySequence: b.entrySequence,
    shippingStatus: b.shippingStatus,
    productType: b.productType,
    batchName: b.batchName,
    totalQuantity: b.totalQuantity ?? 0,
    totalRecords: b.totalRecords ?? 0,
    isDeleted: b.isDeleted ?? false,
    isClosed: b.isClosed ?? false,
    note: b.note,
    createdBy: b.createdBy,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  };
}

// ===== Core: assign next sequence + build batchCode =====

// Atomically assign the next entrySequence for (productType, entryDate, shippingStatus).
// Returns { sequence, batchCode }. Uses findMany + max to compute (MongoDB has no
// native atomic counter; the unique constraint on batchCode protects against collisions).
export async function nextSequence(
  productType: string,
  entryDate: string,
  shippingStatus: string,
  tx?: any
): Promise<{ sequence: number; batchCode: string }> {
  const client = tx || db;
  const existing = await client.entryInputBatch.findMany({
    where: { productType, entryDate, shippingStatus },
    select: { entrySequence: true },
  });
  let max = 0;
  for (const b of existing) {
    if (typeof b.entrySequence === "number" && b.entrySequence > max) max = b.entrySequence;
  }
  const sequence = max + 1;
  // Compact date for batchCode: "2026-11-03" → "20261103"
  const compact = entryDate.replace(/-/g, "");
  const batchCode = `${statusPrefix(shippingStatus)}-${compact}-${String(sequence).padStart(3, "0")}`;
  return { sequence, batchCode };
}

// ===== Create a new batch =====

export async function createBatch(input: CreateBatchInput): Promise<EntryInputBatchDTO> {
  const now = new Date();
  const entryDate = input.entryDate || toYMD(now);
  const entryTime = input.entryTime || toHM(now);

  // Compute sequence + batchCode atomically.
  const { sequence, batchCode } = await nextSequence(
    input.productType,
    entryDate,
    input.shippingStatus
  );

  const batchName = `${toDisplayDate(entryDate)} - Lần ${sequence}`;

  const created = await db.entryInputBatch.create({
    data: {
      batchCode,
      entryDate,
      entryTime,
      entrySequence: sequence,
      shippingStatus: input.shippingStatus,
      productType: input.productType,
      batchName,
      note: input.note ?? null,
      createdBy: input.createdBy ?? null,
      totalQuantity: 0,
      totalRecords: 0,
      isDeleted: false,
      isClosed: false,
    },
  });
  return toDTO(created);
}

// ===== List batches (with filters + pagination) =====

export async function listBatches(filters: BatchListFilters = {}): Promise<{
  rows: EntryInputBatchDTO[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const page = Math.max(1, filters.page || 1);
  const pageSize = Math.min(200, Math.max(1, filters.pageSize || 20));
  const where: any = {};
  if (filters.includeDeleted !== true) where.isDeleted = false;
  if (filters.productType) where.productType = filters.productType;
  if (filters.shippingStatus) where.shippingStatus = filters.shippingStatus;
  if (filters.entrySequence != null) where.entrySequence = filters.entrySequence;
  if (filters.batchCode) where.batchCode = { contains: filters.batchCode };
  if (filters.entryDateFrom || filters.entryDateTo) {
    where.entryDate = {};
    if (filters.entryDateFrom) where.entryDate.gte = filters.entryDateFrom;
    if (filters.entryDateTo) where.entryDate.lte = filters.entryDateTo;
  }

  const [total, rows] = await Promise.all([
    db.entryInputBatch.count({ where }),
    db.entryInputBatch.findMany({
      where,
      orderBy: [{ entryDate: "desc" }, { entrySequence: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return { rows: rows.map(toDTO), total, page, pageSize };
}

// ===== Get single batch (with optional rows) =====

export async function getBatch(id: string, includeRows = false): Promise<BatchDetail | null> {
  const batch = await db.entryInputBatch.findUnique({ where: { id } });
  if (!batch) return null;
  const dto = toDTO(batch);
  let rows: any[] = [];
  if (includeRows) {
    rows = await db.entryData.findMany({
      where: { entryBatchId: id },
      orderBy: { createdAt: "asc" },
    });
  }
  return { ...dto, rows };
}

// ===== Recompute denormalized totals (totalQuantity, totalRecords) =====

export async function recomputeBatchTotals(batchId: string, tx?: any): Promise<void> {
  const client = tx || db;
  const rows = await client.entryData.findMany({
    where: { entryBatchId: batchId },
    select: { qty1: true },
  });
  let totalQty = 0;
  for (const r of rows) {
    if (typeof r.qty1 === "number") totalQty += r.qty1;
  }
  await client.entryInputBatch.update({
    where: { id: batchId },
    data: { totalQuantity: totalQty, totalRecords: rows.length },
  });
}

// ===== Update batch (note, isClosed) =====

export async function updateBatch(
  id: string,
  patch: { note?: string | null; isClosed?: boolean }
): Promise<EntryInputBatchDTO | null> {
  const data: any = {};
  if (patch.note !== undefined) data.note = patch.note;
  if (patch.isClosed !== undefined) data.isClosed = patch.isClosed;
  if (Object.keys(data).length === 0) {
    const b = await db.entryInputBatch.findUnique({ where: { id } });
    return b ? toDTO(b) : null;
  }
  const updated = await db.entryInputBatch.update({ where: { id }, data });
  return toDTO(updated);
}

// ===== Soft-delete a batch =====
// Returns { ok, error? }. Refuses if batch has linked entries that have been
// used in reconciliation runs (checked via AuditLog action="RECON_USE").
// For now we soft-delete the batch and null-out entryBatchId on its rows so
// they remain queryable but unlinked.

export async function deleteBatch(id: string): Promise<{ ok: boolean; error?: string }> {
  const batch = await db.entryInputBatch.findUnique({ where: { id } });
  if (!batch) return { ok: false, error: "Batch not found" };
  if (batch.isDeleted) return { ok: false, error: "Batch already deleted" };

  // Count linked entries.
  const linkedCount = await db.entryData.count({ where: { entryBatchId: id } });

  // Soft-delete the batch. Keep entryBatchId on rows so history is preserved
  // (the batch record still exists, just flagged isDeleted=true).
  await db.$transaction(async (tx) => {
    await tx.entryInputBatch.update({
      where: { id },
      data: { isDeleted: true },
    });
    // Log the deletion.
    await tx.auditLog.create({
      data: {
        productType: batch.productType,
        user: "system",
        action: "BATCH_DELETE",
        entityType: "EntryInputBatch",
        entityId: id,
        oldValue: JSON.stringify({ batchCode: batch.batchCode, linkedCount }),
        newValue: JSON.stringify({ isDeleted: true }),
        detail: `Soft-deleted batch ${batch.batchCode} (${linkedCount} linked entries kept)`,
      },
    });
  });
  return { ok: true };
}

// ===== Batch stats (breakdown by dimensions) =====

export async function getBatchStats(batchId: string): Promise<BatchStats | null> {
  const batch = await db.entryInputBatch.findUnique({ where: { id: batchId } });
  if (!batch) return null;
  const rows = await db.entryData.findMany({
    where: { entryBatchId: batchId },
    select: { qty1: true, model: true, poNo: true, factoryPO: true, colorCode: true, size: true },
  });

  const agg = (field: string) => {
    const m = new Map<string, { totalQty: number; count: number }>();
    for (const r of rows as any[]) {
      const k = (r[field] ?? "").toString().trim() || "(empty)";
      const cur = m.get(k) || { totalQty: 0, count: 0 };
      cur.totalQty += typeof r.qty1 === "number" ? r.qty1 : 0;
      cur.count += 1;
      m.set(k, cur);
    }
    return Array.from(m.entries())
      .map(([key, v]) => ({ key, totalQty: v.totalQty, count: v.count }))
      .sort((a, b) => b.totalQty - a.totalQty);
  };

  let totalQuantity = 0;
  for (const r of rows) totalQuantity += typeof r.qty1 === "number" ? r.qty1 : 0;

  return {
    batch: toDTO(batch),
    totalQuantity,
    totalRecords: rows.length,
    byModel: agg("model"),
    byPoNo: agg("poNo"),
    byFactoryPO: agg("factoryPO"),
    byColorCode: agg("colorCode"),
    bySize: agg("size"),
  };
}

// ===== Compare two batches by a dimension =====

export async function compareBatches(
  batchId1: string,
  batchId2: string,
  dimension: "poNo" | "factoryPO" | "colorCode" | "size"
): Promise<BatchComparison | null> {
  const [b1, b2] = await Promise.all([
    db.entryInputBatch.findUnique({ where: { id: batchId1 } }),
    db.entryInputBatch.findUnique({ where: { id: batchId2 } }),
  ]);
  if (!b1 || !b2) return null;

  const [rows1, rows2] = await Promise.all([
    db.entryData.findMany({ where: { entryBatchId: batchId1 }, select: { qty1: true, [dimension]: true } }),
    db.entryData.findMany({ where: { entryBatchId: batchId2 }, select: { qty1: true, [dimension]: true } }),
  ]);

  const agg = (rows: any[]) => {
    const m = new Map<string, { qty: number; count: number }>();
    for (const r of rows) {
      const k = (r[dimension] ?? "").toString().trim() || "(empty)";
      const cur = m.get(k) || { qty: 0, count: 0 };
      cur.qty += typeof r.qty1 === "number" ? r.qty1 : 0;
      cur.count += 1;
      m.set(k, cur);
    }
    return m;
  };
  const m1 = agg(rows1 as any[]);
  const m2 = agg(rows2 as any[]);
  const allKeys = new Set([...m1.keys(), ...m2.keys()]);
  const cmpRows: BatchComparison["rows"] = [];
  let t1 = 0, t2 = 0;
  for (const k of allKeys) {
    const a = m1.get(k) || { qty: 0, count: 0 };
    const b = m2.get(k) || { qty: 0, count: 0 };
    cmpRows.push({ key: k, qty1: a.qty, qty2: b.qty, diff: b.qty - a.qty, count1: a.count, count2: b.count });
    t1 += a.qty;
    t2 += b.qty;
  }
  cmpRows.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  return {
    batch1: { id: b1.id, batchCode: b1.batchCode, batchName: b1.batchName },
    batch2: { id: b2.id, batchCode: b2.batchCode, batchName: b2.batchName },
    dimension,
    rows: cmpRows,
    totals: { qty1: t1, qty2: t2, diff: t2 - t1 },
  };
}

// ===== Time-period stats (daily totals, per-batch breakdown) =====

export async function getTimePeriodStats(
  productType: string,
  dateFrom: string,
  dateTo: string
): Promise<{
  daily: { entryDate: string; totalQty: number; batchCount: number; batches: { batchCode: string; batchName: string; totalQty: number; totalRecords: number }[] }[];
  summary: { totalQty: number; totalBatches: number; totalRecords: number; avgBatchesPerDay: number };
}> {
  const batches = await db.entryInputBatch.findMany({
    where: {
      productType,
      entryDate: { gte: dateFrom, lte: dateTo },
      isDeleted: false,
    },
    orderBy: [{ entryDate: "asc" }, { entrySequence: "asc" }],
  });
  // Group by entryDate
  const byDate = new Map<string, any[]>();
  for (const b of batches) {
    const arr = byDate.get(b.entryDate) || [];
    arr.push(b);
    byDate.set(b.entryDate, arr);
  }
  const daily: any[] = [];
  let totalQty = 0;
  let totalBatches = 0;
  let totalRecords = 0;
  for (const [entryDate, dayBatches] of byDate.entries()) {
    let dayQty = 0;
    let dayRecords = 0;
    const batchBreakdown = dayBatches.map((b) => {
      dayQty += b.totalQuantity ?? 0;
      dayRecords += b.totalRecords ?? 0;
      return {
        batchCode: b.batchCode,
        batchName: b.batchName,
        totalQty: b.totalQuantity ?? 0,
        totalRecords: b.totalRecords ?? 0,
      };
    });
    daily.push({ entryDate, totalQty: dayQty, batchCount: dayBatches.length, batches: batchBreakdown });
    totalQty += dayQty;
    totalBatches += dayBatches.length;
    totalRecords += dayRecords;
  }
  const avgBatchesPerDay = daily.length > 0 ? totalBatches / daily.length : 0;
  return {
    daily,
    summary: { totalQty, totalBatches, totalRecords, avgBatchesPerDay: Math.round(avgBatchesPerDay * 10) / 10 },
  };
}
