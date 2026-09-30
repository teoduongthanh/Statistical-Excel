import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import * as XLSX from "xlsx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// GET /api/reconciliation/[id]/export?sheet=all|mismatch|missing|duplicate|over|date
// Exports the reconciliation report to .xlsx with multiple sheets (spec §39).
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const sheetFilter = searchParams.get("sheet") || "all";

    const run = await db.reconciliationRun.findUnique({ where: { id } });
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

    const allResults = await db.reconciliationResult.findMany({
      where: { runId: id },
      orderBy: [{ status: "asc" }, { poNo: "asc" }, { factoryPO: "asc" }, { size: "asc" }],
    });

    const wb = XLSX.utils.book_new();

    // Sheet 1: Summary (spec §40)
    const summaryData = [
      ["RECONCILIATION REPORT"],
      [],
      ["File:", run.fileName],
      ["Run Number:", run.runNumber],
      ["Product Type:", run.productType ?? ""],
      ["Date Range:", `${run.dateFrom ?? ""} - ${run.dateTo ?? ""}`],
      ["As Of Date:", run.asOfDate ?? ""],
      ["Generated:", new Date().toISOString()],
      ["Uploaded By:", run.uploadedBy ?? ""],
      [],
      ["STATISTICS"],
      ["Total Lines", run.totalLines],
      ["Matched Lines", run.matchedLines],
      ["Mismatch Lines", run.mismatchLines],
      ["Missing on Website", run.missingOnWebsite],
      ["Missing on Partner", run.missingOnPartner],
      ["Duplicate Lines", run.duplicateLines],
      ["Over Output Lines", run.overOutputLines],
      ["Over Input Lines", run.overInputLines],
      ["Date Diff Lines", run.dateDiffLines],
      ["Invalid Lines", run.invalidLines],
      [],
      ["QUANTITY TOTALS"],
      ["Total Order Qty", run.totalOrderQty],
      ["Partner OUT", run.totalPartnerOut],
      ["Website Output", run.totalWebsiteOutput],
      ["OUT Difference", run.totalPartnerOut - run.totalWebsiteOutput],
      ["Partner IN", run.totalPartnerIn],
      ["Website Input", run.totalWebsiteInput],
      ["IN Difference", run.totalPartnerIn - run.totalWebsiteInput],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryData), "1. Summary");

    // Helper to build comparison rows for a sheet.
    const buildRows = (results: typeof allResults) =>
      results.map((r) => ({
        Status: r.status,
        "PO NO#": r.poNo,
        "Factory PO": r.factoryPO,
        Size: r.size,
        Model: r.model ?? "",
        "Color Code": r.colorCode ?? "",
        "Partner Order": r.partnerOrderQty,
        "Website Order": r.websiteOrderQty,
        "Order Diff": r.orderDifference,
        "Partner OUT": r.partnerOutQty,
        "Website Output": r.websiteOutputQty,
        "OUT Diff": r.outDifference,
        "Partner IN": r.partnerInQty,
        "Website Input": r.websiteInputQty,
        "IN Diff": r.inDifference,
        "Pending Partner": r.pendingPartner,
        "Pending Website": r.pendingWebsite,
        "Remaining Order": r.remainingOrder,
        Issues: r.issues,
        Reason: r.reason ?? "",
      }));

    // Sheet 2: All Comparison
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(buildRows(allResults)),
      "2. All Comparison"
    );

    // Sheet 3: Matched
    const matched = allResults.filter((r) => r.status === "MATCHED");
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(matched.length ? buildRows(matched) : [{ Info: "No matched rows" }]),
      "3. Matched"
    );

    // Sheet 4: Quantity Mismatch (any of order/out/in diff != 0)
    const qtyMismatch = allResults.filter((r) =>
      r.issues.includes("ORDER_QTY_MISMATCH") ||
      r.issues.includes("OUTPUT_MISMATCH") ||
      r.issues.includes("INPUT_MISMATCH")
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(qtyMismatch.length ? buildRows(qtyMismatch) : [{ Info: "No quantity mismatches" }]),
      "4. Qty Mismatch"
    );

    // Sheet 5: Missing on Website
    const missingWebsite = allResults.filter((r) => r.issues.includes("MISSING_ON_WEBSITE"));
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(missingWebsite.length ? buildRows(missingWebsite) : [{ Info: "No missing-on-website rows" }]),
      "5. Missing Website"
    );

    // Sheet 6: Missing on Partner
    const missingPartner = allResults.filter((r) => r.issues.includes("MISSING_ON_PARTNER"));
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(missingPartner.length ? buildRows(missingPartner) : [{ Info: "No missing-on-partner rows" }]),
      "6. Missing Partner"
    );

    // Sheet 7: Wrong Factory PO (POSSIBLE_WRONG_FACTORY_PO — future; here we use heuristic: same poNo+size but different factoryPO)
    // For now, group by poNo+size and check if multiple factoryPO exist with mismatch
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet([{ Info: "Wrong Factory PO detection: review rows where poNo+size matches but factoryPO differs between Partner and Website" }]),
      "7. Wrong FPO"
    );

    // Sheet 8: Wrong Size (placeholder)
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet([{ Info: "Wrong Size detection: review rows where poNo+factoryPO matches but size differs" }]),
      "8. Wrong Size"
    );

    // Sheet 9: Duplicate
    const dup = allResults.filter((r) => r.issues.includes("POSSIBLE_DUPLICATE"));
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(dup.length ? buildRows(dup) : [{ Info: "No duplicates detected" }]),
      "9. Duplicate"
    );

    // Sheet 10: Over Quantity
    const overQty = allResults.filter((r) =>
      r.issues.includes("OVER_OUTPUT") || r.issues.includes("OVER_INPUT")
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(overQty.length ? buildRows(overQty) : [{ Info: "No over-quantity issues" }]),
      "10. Over Qty"
    );

    // Sheet 11: Date Difference
    const dateDiff = allResults.filter((r) => r.issues.includes("DATE_DISTRIBUTION_MISMATCH"));
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(dateDiff.length ? buildRows(dateDiff) : [{ Info: "No date distribution issues" }]),
      "11. Date Diff"
    );

    // Sheet 12: Transaction Detail (drill-down for mismatches)
    const txDetail: any[] = [];
    for (const r of allResults) {
      if (r.status === "MATCHED") continue;
      const pTx = JSON.parse(r.partnerTransactions || "[]");
      const wTx = JSON.parse(r.websiteTransactions || "[]");
      for (const t of pTx) {
        txDetail.push({
          Source: "PARTNER",
          "PO NO#": r.poNo,
          "Factory PO": r.factoryPO,
          Size: r.size,
          Date: t.date,
          Type: t.type,
          Qty: t.qty,
          Status: r.status,
        });
      }
      for (const t of wTx) {
        txDetail.push({
          Source: "WEBSITE",
          "PO NO#": r.poNo,
          "Factory PO": r.factoryPO,
          Size: r.size,
          Date: t.date,
          Type: t.type,
          Qty: t.qty,
          Status: r.status,
        });
      }
    }
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(txDetail.length ? txDetail : [{ Info: "No mismatched transactions to drill down" }]),
      "12. Transaction Detail"
    );

    // Filter to single sheet if requested.
    let outputWb = wb;
    if (sheetFilter !== "all") {
      const sheetName = sheetFilter;
      if (wb.SheetNames.includes(sheetName)) {
        outputWb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(outputWb, wb.Sheets[sheetName], sheetName);
      }
    }

    const buffer = XLSX.write(outputWb, { type: "buffer", bookType: "xlsx" });
    const outFileName = `Reconciliation_${run.runNumber}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${outFileName}"`,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: "Export failed", detail: e?.message }, { status: 500 });
  }
}
