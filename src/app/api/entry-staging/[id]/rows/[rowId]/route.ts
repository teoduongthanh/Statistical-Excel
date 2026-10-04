import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PATCH /api/entry-staging/[id]/rows/[rowId]
// Body: partial StagingRow business fields (poNo, factoryPO, size, qty, date,
// shippingStatus, deadline).
//   - Updates the row
//   - Resets validationStatus to "PENDING" and clears validationErrors
//   - Clears warningAccepted flags (a warning accepted before the edit is no longer meaningful)
//   - Writes an EntryAuditLog entry per changed field (action: "EDIT")
// Returns: { ok, row }
interface EditableFields {
  poNo?: string;
  factoryPO?: string;
  size?: string;
  qty?: number | string;
  date?: string;
  shippingStatus?: string;
  deadline?: string;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; rowId: string }> }
) {
  try {
    const { id, rowId } = await params;
    if (!id || !rowId) {
      return NextResponse.json(
        { ok: false, error: "Batch id and rowId are required" },
        { status: 400 }
      );
    }

    const body = (await req.json()) as EditableFields;

    const existing = await db.entryStagingRow.findFirst({
      where: { id: rowId, batchId: id },
    });
    if (!existing) {
      return NextResponse.json(
        { ok: false, error: "Row not found in this batch" },
        { status: 404 }
      );
    }

    // Build update payload + audit entries.
    const updates: Record<string, unknown> = {};
    const auditEntries: Array<{
      field: string;
      oldValue: string;
      newValue: string;
    }> = [];

    const fieldMap: Array<{
      key: keyof EditableFields;
      column: string;
      coerce?: (v: any) => any;
      stringify?: (v: any) => string;
    }> = [
      { key: "poNo", column: "poNo" },
      { key: "factoryPO", column: "factoryPO" },
      { key: "size", column: "size" },
      { key: "date", column: "date" },
      { key: "shippingStatus", column: "shippingStatus" },
      { key: "deadline", column: "deadline" },
      {
        key: "qty",
        column: "qty",
        coerce: (v) =>
          typeof v === "number" ? Math.trunc(v) : parseInt(String(v), 10) || 0,
        stringify: (v) => String(v),
      },
    ];

    for (const f of fieldMap) {
      if (body[f.key] === undefined) continue;
      const newValueRaw = body[f.key] as string | number;
      const newValue = f.coerce ? f.coerce(newValueRaw) : String(newValueRaw).trim();
      const oldValue = (existing as any)[f.column];
      const oldStr = oldValue === null || oldValue === undefined ? "" : String(oldValue);
      const newStr =
        f.stringify && typeof newValue !== "string"
          ? f.stringify(newValue)
          : String(newValue);
      if (oldStr === newStr) continue;
      updates[f.column] = newValue;
      auditEntries.push({ field: f.column, oldValue: oldStr, newValue: newStr });
    }

    if (auditEntries.length === 0) {
      // Nothing changed — return the row as-is.
      return NextResponse.json({ ok: true, row: existing, changed: false });
    }

    // Reset validation state — the row must be re-validated (spec §47).
    updates.validationStatus = "PENDING";
    updates.validationErrors = "[]";
    updates.warningAccepted = false;
    updates.warningAcceptedBy = null;
    updates.warningAcceptedAt = null;
    updates.warningAcceptReason = null;

    const updated = await db.entryStagingRow.update({
      where: { id: rowId },
      data: updates,
    });

    // Audit log entries — one per changed field.
    for (const ae of auditEntries) {
      await db.entryAuditLog.create({
        data: {
          batchId: id,
          rowId,
          action: "EDIT",
          field: ae.field,
          oldValue: ae.oldValue,
          newValue: ae.newValue,
          user: (body as any).user ?? "system",
          detail: `Edited field ${ae.field}: "${ae.oldValue}" → "${ae.newValue}"`,
        },
      });
    }

    return NextResponse.json({
      ok: true,
      changed: true,
      row: {
        id: updated.id,
        rowNumber: updated.rowNumber,
        shippingStatus: updated.shippingStatus ?? "",
        date: updated.date ?? "",
        poNo: updated.poNo ?? "",
        factoryPO: updated.factoryPO ?? "",
        size: updated.size ?? "",
        qty: updated.qty,
        deadline: updated.deadline ?? "",
        model: updated.model ?? "",
        sku: updated.sku ?? "",
        item: updated.item ?? "",
        season: updated.season ?? "",
        colorCode: updated.colorCode ?? "",
        colorCode2: updated.colorCode2 ?? "",
        painting: updated.painting ?? "",
        printingColor: updated.printingColor ?? "",
        autoFillSource: updated.autoFillSource ?? "",
        matchedOrderKey: updated.matchedOrderKey ?? "",
        validationStatus: updated.validationStatus,
        validationErrors: updated.validationErrors
          ? JSON.parse(updated.validationErrors)
          : [],
        warningAccepted: updated.warningAccepted,
        warningAcceptedBy: updated.warningAcceptedBy ?? "",
        warningAcceptedReason: updated.warningAcceptReason ?? "",
        warningAcceptedAt:
          updated.warningAcceptedAt instanceof Date
            ? updated.warningAcceptedAt.toISOString()
            : updated.warningAcceptedAt ?? null,
        imported: updated.imported,
        importedEntryId: updated.importedEntryId ?? null,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to edit row";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
