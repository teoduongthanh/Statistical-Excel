import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/entry-staging/[id]/rows/[rowId]/accept-warning
// Body: { reason?: string, user?: string }
// Marks the row's warning as accepted by the user:
//   - warningAccepted = true
//   - validationStatus = "REVIEWED"
//   - stores warningAcceptedBy / warningAcceptedAt / warningAcceptReason
//   - writes EntryAuditLog entry (action: "ACCEPT_WARNING")
// Returns: { ok, row }
export async function POST(
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

    const body = (await req.json().catch(() => ({}))) as {
      reason?: string;
      user?: string;
    };
    const user = body.user ?? "system";
    const reason = body.reason?.trim() ?? "";

    const existing = await db.entryStagingRow.findFirst({
      where: { id: rowId, batchId: id },
    });
    if (!existing) {
      return NextResponse.json(
        { ok: false, error: "Row not found in this batch" },
        { status: 404 }
      );
    }

    if (existing.imported) {
      return NextResponse.json(
        { ok: false, error: "Cannot accept warning on an imported row" },
        { status: 400 }
      );
    }

    const now = new Date();
    const updated = await db.entryStagingRow.update({
      where: { id: rowId },
      data: {
        warningAccepted: true,
        validationStatus: "REVIEWED",
        warningAcceptedBy: user,
        warningAcceptedAt: now,
        warningAcceptReason: reason || null,
      },
    });

    await db.entryAuditLog.create({
      data: {
        batchId: id,
        rowId,
        action: "ACCEPT_WARNING",
        field: "validationStatus",
        oldValue: existing.validationStatus,
        newValue: "REVIEWED",
        user,
        detail: reason
          ? `Accepted warning. Reason: ${reason}`
          : "Accepted warning (no reason given).",
      },
    });

    return NextResponse.json({
      ok: true,
      row: {
        id: updated.id,
        rowNumber: updated.rowNumber,
        validationStatus: updated.validationStatus,
        warningAccepted: updated.warningAccepted,
        warningAcceptedBy: updated.warningAcceptedBy ?? "",
        warningAcceptedReason: updated.warningAcceptReason ?? "",
        warningAcceptedAt:
          updated.warningAcceptedAt instanceof Date
            ? updated.warningAcceptedAt.toISOString()
            : updated.warningAcceptedAt ?? null,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to accept warning";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
