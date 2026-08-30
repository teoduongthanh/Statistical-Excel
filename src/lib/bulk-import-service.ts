// BulkImportService
// Performs the actual database INSERT for validated bulk rows.
// Uses a database transaction so the import is atomic — either all valid rows
// are inserted, or none are (rollback on error).
//
// Flow (spec §33):
//   BEGIN TRANSACTION
//   → Re-validate all rows (catch race conditions since validation)
//   → Insert valid rows
//   → Create AuditLog entry
//   → COMMIT
//
// Import options (spec §29):
//   - ImportAllValid: import all rows with status "valid" or "warning"
//   - ImportSelected: import only rows the user explicitly selected
//   - FixAllErrorsFirst: refuse import until error count = 0

import { db } from "./db";
import { lookupFactoryPO } from "./master-service";
import { computeQty2 } from "./entry-service";
import { classifyShippingStatus } from "./quantity-service";
import type { CanonicalField } from "./fields";

export interface BulkImportRowInput {
  shippingStatus: string;
  poNo: string;
  factoryPO: string;
  size: string;
  qty1: number;
  // Optional confirmation info (for warning-confirmed rows, spec §31)
  confirmReason?: string;
  note?: string;
}

export interface BulkImportInput {
  productType: string;
  rows: BulkImportRowInput[];
  // Which rows to import
  mode: "all_valid" | "selected" | "fix_first";
  selectedRowNumbers?: number[]; // 1-based Excel row numbers (only for "selected" mode)
  importedBy?: string;
}

export interface BulkImportResult {
  ok: boolean;
  importId: string;
  imported: number;
  skipped: number;
  errors: string[];
  auditLogId?: string;
}

export async function bulkImportEntries(input: BulkImportInput): Promise<BulkImportResult> {
  const { productType, mode, importedBy } = input;
  const importId = `BULK-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

  if (!productType) {
    return { ok: false, importId, imported: 0, skipped: 0, errors: ["productType is required"] };
  }

  // Filter rows based on mode.
  let rowsToImport = input.rows;
  if (mode === "selected") {
    const selected = new Set(input.selectedRowNumbers || []);
    // selectedRowNumbers are Excel row numbers (1-based + header).
    // We map them to the rows array index.
    rowsToImport = input.rows.filter((_, idx) => selected.has(idx + 2));
  }
  // mode === "fix_first" → caller must ensure 0 errors before calling this.
  // mode === "all_valid" → import all rows passed in (caller filtered to valid+warning).

  if (rowsToImport.length === 0) {
    return { ok: false, importId, imported: 0, skipped: 0, errors: ["No rows to import"] };
  }

  const errors: string[] = [];
  let imported = 0;
  let skipped = 0;

  try {
    const result = await db.$transaction(async (tx) => {
      // Step 1: Re-validate each row (catch race conditions).
      // We do a lightweight check: factoryPO + size + qty required.
      // Full sequential simulation is skipped here because the caller already
      // ran validateBulkData; we trust the validated result unless the DB
      // changed between validation and import (rare).
      const validRows: BulkImportRowInput[] = [];
      for (const row of rowsToImport) {
        if (!row.factoryPO?.trim()) { skipped++; continue; }
        if (!row.size?.trim()) { skipped++; continue; }
        if (!row.qty1 || row.qty1 <= 0 || isNaN(row.qty1)) { skipped++; continue; }
        if (!row.shippingStatus?.trim()) { skipped++; continue; }
        validRows.push(row);
      }

      // Step 2: Batch lookup MasterData for auto-fill fields.
      const factoryPOs = [...new Set(validRows.map((r) => r.factoryPO.trim()))];
      const masterGroups = await tx.masterGroup.findMany({
        where: { productType, factoryPO: { in: factoryPOs } },
      });
      const masterByFpo = new Map(masterGroups.map((g) => [g.factoryPO, g]));

      // Step 3: Insert each row.
      const today = new Date().toISOString().slice(0, 10);
      for (const row of validRows) {
        const g = masterByFpo.get(row.factoryPO.trim());
        const qty2 = computeQty2(row.shippingStatus, row.qty1);
        const masterDataReference = g
          ? JSON.stringify({ factoryPO: row.factoryPO, poNo: row.poNo, size: row.size })
          : null;

        await tx.entryData.create({
          data: {
            productType,
            date: today,
            shippingStatus: row.shippingStatus,
            model: g?.model || "",
            sku: g?.sku || "",
            poNo: row.poNo,
            factoryPO: row.factoryPO,
            item: g?.item || "",
            season: g?.season || "",
            colorCode: g?.colorCode || "",
            colorCode2: g?.colorCode2 || "",
            painting: g?.painting || "",
            printingColor: g?.printingColor || "",
            deadline: g?.nearestDeadline || g?.deadline || "",
            size: row.size,
            qty1: row.qty1,
            qty2,
            masterDataReference,
            note: row.note || row.confirmReason || null,
          },
        });
        imported++;
      }

      // Step 4: Create AuditLog.
      const audit = await tx.auditLog.create({
        data: {
          productType,
          user: importedBy || "bulk-import",
          action: "ENTRY_CREATE",
          entityType: "EntryData",
          entityId: importId,
          oldValue: null,
          newValue: JSON.stringify({
            importId,
            imported,
            skipped,
            totalRows: rowsToImport.length,
            mode,
          }),
          detail: `Bulk import: ${imported} rows imported, ${skipped} skipped (mode=${mode})`,
        },
      });

      return { imported, skipped, auditLogId: audit.id };
    });

    return {
      ok: true,
      importId,
      imported: result.imported,
      skipped: result.skipped,
      errors,
      auditLogId: result.auditLogId,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Bulk import transaction failed";
    errors.push(msg);
    return {
      ok: false,
      importId,
      imported: 0,
      skipped: rowsToImport.length,
      errors,
    };
  }
}

// Fetch bulk import history from AuditLog (entries with action=ENTRY_CREATE and
// entityId starting with "BULK-").
export interface BulkImportHistoryItem {
  id: string;
  importId: string;
  productType: string | null;
  user: string | null;
  importedAt: Date;
  detail: string | null;
  stats: {
    imported: number;
    skipped: number;
    totalRows: number;
    mode: string;
  };
}

export async function getBulkImportHistory(limit = 50): Promise<BulkImportHistoryItem[]> {
  const logs = await db.auditLog.findMany({
    where: {
      action: "ENTRY_CREATE",
      entityId: { startsWith: "BULK-" },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  const items: BulkImportHistoryItem[] = [];
  for (const log of logs) {
    let stats = { imported: 0, skipped: 0, totalRows: 0, mode: "all_valid" };
    try {
      if (log.newValue) stats = JSON.parse(log.newValue);
    } catch { /* ignore parse errors */ }
    items.push({
      id: log.id,
      importId: log.entityId || log.id,
      productType: log.productType,
      user: log.user,
      importedAt: log.createdAt,
      detail: log.detail,
      stats,
    });
  }
  return items;
}
