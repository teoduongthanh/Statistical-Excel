import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { generateSlipExcel, type SlipItem } from "@/lib/output-slip-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/output-slips/export
// Generates an Excel file for an Output Slip.
// Body: { slipId, format: "multi_sheet" | "combined" | "separate_files" }
// For "separate_files" we return a single combined Excel (multi-sheet) because
// HTTP can only return one blob per request — the UI can call this multiple
// times per FPO if truly separate files are needed.
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { slipId: string; format?: "multi_sheet" | "combined" | "separate_files" };
    if (!body.slipId) {
      return NextResponse.json({ ok: false, error: "slipId is required" }, { status: 400 });
    }
    const slip = await db.outputSlip.findUnique({ where: { id: body.slipId } });
    if (!slip) {
      return NextResponse.json({ ok: false, error: "Slip not found" }, { status: 404 });
    }
    const items: SlipItem[] = JSON.parse(slip.items || "[]");
    const format = body.format || "multi_sheet";
    const buffer = generateSlipExcel(
      { slipNumber: slip.slipNumber, productType: slip.productType, poNo: slip.poNo, slipMode: slip.slipMode, items: slip.items },
      items,
      format
    );

    // Mark slip as printed if it was just generated.
    if (slip.status === "generated") {
      await db.outputSlip.update({ where: { id: body.slipId }, data: { status: "printed" } });
    }

    const today = new Date().toISOString().slice(0, 10);
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="Output_Slip_${slip.slipNumber}_${today}.xlsx"`,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Export failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
