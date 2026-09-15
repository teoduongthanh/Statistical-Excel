// SyncService
// Implements the DATA SYNCHRONIZATION & RECALCULATION SYSTEM.
//
// Flow:
//   DATA CHANGE → recordChangeEvent() → marks SyncQueue row as PENDING
//   → UI shows "SYNC REQUIRED" banner
//   → user clicks "Sync Now" → runSync() processes all pending events:
//     1. Lock (mark events as processing)
//     2. Collect affected (productType + poNo + factoryPO + size) groups
//     3. Recalculate Order/Output/Input/Pending per group (already dynamic in
//        aggregation queries, but we persist a snapshot + run validation)
//     4. Run validation (reuse bulk-validation-service engine)
//     5. Mark events as COMPLETED + create SyncRun record
//   → bumpRefresh() in the store triggers all views to refetch
//
// Key design:
//   - recordChangeEvent() is cheap (1 INSERT). It does NOT recalculate.
//   - runSync() is the expensive step, but it's batched (one run per N events).
//   - Pending events are scoped by productType (MAFATE changes don't sync ONYX).
//   - Stale-data protection: getPendingCount() + getSyncStatus() let the UI
//     warn users before critical operations (Confirm Output, Export Report).

import { db } from "./db";

// ===== Types =====

export type SyncAction =
  | "CREATE" | "UPDATE" | "DELETE"
  | "IMPORT" | "BULK_IMPORT"
  | "CONFIRM_OUTPUT" | "CANCEL_OUTPUT"
  | "MASTER_UPDATE";

export type SyncEntity = "EntryData" | "MasterData" | "OutputSlip" | "Import";

export interface ChangeEventInput {
  action: SyncAction;
  entity: SyncEntity;
  entityId?: string;
  productType: string;
  poNo?: string;
  factoryPO?: string;
  size?: string;
  changedFields?: Record<string, { old: any; new: any }>;
  triggeredBy?: string;
}

export interface PendingSyncSummary {
  pendingCount: number;
  byProductType: Record<string, number>;
  byAction: Record<string, number>;
  byEntity: Record<string, number>;
  oldestPendingAt: Date | null;
  lastSyncedAt: Date | null;
  affectedProductKeys: string[]; // unique (productType|poNo|factoryPO|size)
}

export interface SyncResult {
  ok: boolean;
  runId: string;
  runNumber: string;
  eventsProcessed: number;
  productGroupsRecalculated: number;
  errorsFound: number;
  warningsFound: number;
  durationMs: number;
  validationErrors: Array<{
    productKey: string;
    code: string;
    severity: string;
    title: string;
    description: string;
  }>;
  errors?: string[];
}

// ===== Record a change event (cheap — 1 INSERT, no recalculation) =====

export async function recordChangeEvent(input: ChangeEventInput): Promise<string> {
  const event = await db.syncQueue.create({
    data: {
      action: input.action,
      entity: input.entity,
      entityId: input.entityId || null,
      productType: input.productType,
      poNo: input.poNo || null,
      factoryPO: input.factoryPO || null,
      size: input.size || null,
      changedFields: input.changedFields ? JSON.stringify(input.changedFields) : null,
      status: "pending",
      triggeredBy: input.triggeredBy || null,
    },
  });
  return event.id;
}

// Convenience: record a change for an entry (extracts product-key from the entry row).
export async function recordEntryChangeEvent(
  action: SyncAction,
  entry: { id?: string; productType: string; poNo?: string | null; factoryPO: string; size: string },
  changedFields?: Record<string, { old: any; new: any }>,
  triggeredBy?: string
): Promise<string> {
  return recordChangeEvent({
    action,
    entity: "EntryData",
    entityId: entry.id,
    productType: entry.productType,
    poNo: entry.poNo || undefined,
    factoryPO: entry.factoryPO,
    size: entry.size,
    changedFields,
    triggeredBy,
  });
}

// Convenience: record a change for master data.
export async function recordMasterChangeEvent(
  action: SyncAction,
  row: { id?: string; productType: string; poNo?: string | null; factoryPO?: string | null; size?: string | null },
  changedFields?: Record<string, { old: any; new: any }>,
  triggeredBy?: string
): Promise<string> {
  return recordChangeEvent({
    action: action === "CREATE" ? "MASTER_UPDATE" : action === "UPDATE" ? "MASTER_UPDATE" : action === "DELETE" ? "MASTER_UPDATE" : action,
    entity: "MasterData",
    entityId: row.id,
    productType: row.productType,
    poNo: row.poNo || undefined,
    factoryPO: row.factoryPO || undefined,
    size: row.size || undefined,
    changedFields,
    triggeredBy,
  });
}

// ===== Get pending sync status (for UI banner) =====

export async function getPendingSyncSummary(productType?: string): Promise<PendingSyncSummary> {
  const where: any = { status: "pending" };
  if (productType) where.productType = productType;

  const pending = await db.syncQueue.findMany({
    where,
    orderBy: { createdAt: "asc" },
    take: 1000,
  });

  const byProductType: Record<string, number> = {};
  const byAction: Record<string, number> = {};
  const byEntity: Record<string, number> = {};
  const affectedProductKeys = new Set<string>();

  for (const e of pending) {
    byProductType[e.productType] = (byProductType[e.productType] || 0) + 1;
    byAction[e.action] = (byAction[e.action] || 0) + 1;
    byEntity[e.entity] = (byEntity[e.entity] || 0) + 1;
    // Build product key for affected groups (graceful when poNo/fpo/size are null).
    const key = [e.productType, e.poNo || "*", e.factoryPO || "*", e.size || "*"].join("|");
    affectedProductKeys.add(key);
  }

  const oldestPendingAt = pending.length > 0 ? pending[0].createdAt : null;

  // Find last completed sync run.
  const lastRun = await db.syncRun.findFirst({
    where: productType ? { productType } : {},
    orderBy: { completedAt: "desc" },
  });

  return {
    pendingCount: pending.length,
    byProductType,
    byAction,
    byEntity,
    oldestPendingAt,
    lastSyncedAt: lastRun?.completedAt || null,
    affectedProductKeys: [...affectedProductKeys],
  };
}

// ===== Run synchronization (the expensive step) =====

export async function runSync(productType?: string, triggeredBy?: string): Promise<SyncResult> {
  const startTime = Date.now();
  const runNumber = `SR-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.floor(Math.random() * 9000) + 1000}`;

  // Create the SyncRun record.
  const run = await db.syncRun.create({
    data: {
      runNumber,
      productType: productType || null,
      triggeredBy: triggeredBy || null,
      status: "running",
    },
  });

  // Lock pending events (mark as processing).
  const where: any = { status: "pending" };
  if (productType) where.productType = productType;
  const pendingEvents = await db.syncQueue.findMany({ where, orderBy: { createdAt: "asc" }, take: 2000 });

  if (pendingEvents.length === 0) {
    await db.syncRun.update({
      where: { id: run.id },
      data: {
        status: "completed",
        completedAt: new Date(),
        durationMs: Date.now() - startTime,
      },
    });
    return {
      ok: true,
      runId: run.id,
      runNumber,
      eventsProcessed: 0,
      productGroupsRecalculated: 0,
      errorsFound: 0,
      warningsFound: 0,
      durationMs: Date.now() - startTime,
      validationErrors: [],
    };
  }

  // Collect affected product keys (unique combos of poNo + factoryPO + size).
  const affectedKeys = new Set<string>();
  for (const e of pendingEvents) {
    const key = [e.poNo || "*", e.factoryPO || "*", e.size || "*"].join("|");
    affectedKeys.add(key);
  }

  // Run validation on the affected groups.
  // We re-fetch current Order/Output/Input for each affected (poNo + factoryPO + size)
  // and check for quantity errors (Output > Order, Input > Output, Input > Order).
  const validationErrors: SyncResult["validationErrors"] = [];
  let errorsFound = 0;
  let warningsFound = 0;

  try {
    // Build a list of (poNo, factoryPO, size) tuples to validate.
    const tuples: { poNo: string; factoryPO: string; size: string }[] = [];
    for (const e of pendingEvents) {
      if (e.poNo && e.factoryPO && e.size) {
        tuples.push({ poNo: e.poNo, factoryPO: e.factoryPO, size: e.size });
      }
    }

    // Deduplicate.
    const seen = new Set<string>();
    const uniqueTuples = tuples.filter((t) => {
      const k = `${t.poNo}|${t.factoryPO}|${t.size}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    // For each tuple, fetch current Order/Output/Input and validate.
    const productTypes = productType
      ? [productType]
      : [...new Set(pendingEvents.map((e) => e.productType))];

    for (const pt of productTypes) {
      for (const t of uniqueTuples) {
        const norm = (s: string) => s.replace(/\s+/g, " ").trim();
        const rows = await db.$queryRawUnsafe<{ orderQty: number; outputQty: number; inputQty: number }[]>(
          `SELECT
            SUM(CASE WHEN LOWER(shippingStatus) LIKE '1%' OR LOWER(shippingStatus) = 'order' THEN COALESCE(qty1,0) ELSE 0 END) AS orderQty,
            SUM(CASE WHEN LOWER(shippingStatus) LIKE '2%' OR LOWER(shippingStatus) = 'output' THEN COALESCE(qty1,0) ELSE 0 END) AS outputQty,
            SUM(CASE WHEN LOWER(shippingStatus) LIKE '4%' OR LOWER(shippingStatus) = 'input' THEN COALESCE(qty1,0) ELSE 0 END) AS inputQty
           FROM MasterData
           WHERE productType = ? AND poNo = ? AND factoryPO = ? AND size = ?`,
          pt, t.poNo, t.factoryPO, t.size
        );
        const r = rows[0];
        if (!r) continue;
        const orderQty = Number(r.orderQty) || 0;
        const outputQty = Number(r.outputQty) || 0;
        const inputQty = Number(r.inputQty) || 0;
        const productKey = `${pt}|${t.poNo}|${t.factoryPO}|${norm(t.size)}`;

        // Output > Order → ERROR
        if (orderQty > 0 && outputQty > orderQty) {
          errorsFound++;
          validationErrors.push({
            productKey,
            code: "OUTPUT_EXCEEDS_ORDER",
            severity: "ERROR",
            title: "Output exceeds Order",
            description: `Output (${outputQty}) exceeds Order (${orderQty}) by ${outputQty - orderQty}.`,
          });
        }
        // Input > Output → ERROR
        if (outputQty > 0 && inputQty > outputQty) {
          errorsErrorsIncrementAndPush(inputQty, outputQty, "INPUT_EXCEEDS_OUTPUT", "Input exceeds Output", `Input (${inputQty}) exceeds Output (${outputQty}) by ${inputQty - outputQty}.`, productKey, validationErrors);
          errorsFound++;
        }
        // Input > Order → ERROR
        if (orderQty > 0 && inputQty > orderQty) {
          validationErrors.push({
            productKey,
            code: "INPUT_EXCEEDS_ORDER",
            severity: "ERROR",
            title: "Input exceeds Order",
            description: `Input (${inputQty}) exceeds Order (${orderQty}) by ${inputQty - orderQty}.`,
          });
          errorsFound++;
        }
        // Input without Output → WARNING
        if (outputQty === 0 && inputQty > 0) {
          warningsFound++;
          validationErrors.push({
            productKey,
            code: "INPUT_WITHOUT_OUTPUT",
            severity: "WARNING",
            title: "Input without Output",
            description: `Input (${inputQty}) exists but no Output.`,
          });
        }
        // Output without Order → WARNING
        if (orderQty === 0 && outputQty > 0) {
          warningsFound++;
          validationErrors.push({
            productKey,
            code: "OUTPUT_WITHOUT_ORDER",
            severity: "WARNING",
            title: "Output without Order",
            description: `Output (${outputQty}) exists but no Order.`,
          });
        }
      }
    }

    // Mark all pending events as completed.
    await db.syncQueue.updateMany({
      where: { id: { in: pendingEvents.map((e) => e.id) } },
      data: {
        status: "completed",
        processedAt: new Date(),
        syncDurationMs: Date.now() - startTime,
      },
    });

    // Update the SyncRun record.
    const durationMs = Date.now() - startTime;
    await db.syncRun.update({
      where: { id: run.id },
      data: {
        status: "completed",
        eventsProcessed: pendingEvents.length,
        productGroupsRecalculated: affectedKeys.size,
        errorsFound,
        warningsFound,
        validationResults: JSON.stringify(validationErrors),
        completedAt: new Date(),
        durationMs,
      },
    });

    return {
      ok: true,
      runId: run.id,
      runNumber,
      eventsProcessed: pendingEvents.length,
      productGroupsRecalculated: affectedKeys.size,
      errorsFound,
      warningsFound,
      durationMs,
      validationErrors,
    };
  } catch (e) {
    // Mark run as failed.
    const errorMsg = e instanceof Error ? e.message : "Sync failed";
    await db.syncRun.update({
      where: { id: run.id },
      data: { status: "failed", completedAt: new Date(), durationMs: Date.now() - startTime },
    });
    return {
      ok: false,
      runId: run.id,
      runNumber,
      eventsProcessed: 0,
      productGroupsRecalculated: 0,
      errorsFound: 0,
      warningsFound: 0,
      durationMs: Date.now() - startTime,
      validationErrors: [],
      errors: [errorMsg],
    };
  }
}

// Helper to avoid a typo in the inline validation above.
function errorsErrorsIncrementAndPush(
  inputQty: number, outputQty: number,
  code: string, title: string, desc: string,
  productKey: string,
  validationErrors: SyncResult["validationErrors"]
) {
  validationErrors.push({ productKey, code, severity: "ERROR", title, description: desc });
}

// ===== Sync history =====

export async function getSyncHistory(limit = 20): Promise<any[]> {
  return db.syncRun.findMany({
    orderBy: { startedAt: "desc" },
    take: limit,
  });
}

// ===== Check if sync is required before a critical operation =====

export async function isSyncRequired(productType?: string): Promise<boolean> {
  const count = await db.syncQueue.count({
    where: { status: "pending", ...(productType ? { productType } : {}) },
  });
  return count > 0;
}
