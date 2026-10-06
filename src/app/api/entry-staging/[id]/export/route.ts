import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import * as XLSX from "xlsx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/entry-staging/[id]/export?sheet=all|valid|warning|error|reviewed
// Exports staging rows to .xlsx with multiple sheets (spec §66).
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const sheetFilter = searchParams.get("sheet") || "all";

    const batch = await db.entryBatch.findUnique({ where: { id } });
    if (!batch) return NextResponse.json({ error: "Batch not found" }, { status: 404 });

    const rows = await db.entryStagingRow.findMany({
      where: { batchId: id },
      orderBy: { rowNumber: "asc" },
    });

    const wb = XLSX.utils.book_new();

    // Helper: build row data for a sheet
    const buildRowData = (filterFn: (r: any) => boolean) => {
      return rows.filter(filterFn).map((r) => {
        let issues: any[] = [];
        try { issues = JSON.parse(r.validationErrors || "[]"); } catch {}
        return {
          "Row #": r.rowNumber,
          "Validation Status": r.validationStatus,
          "Shipping Status": r.shippingStatus || "",
          "PO NO#": r.poNo || "",
          "Factory PO": r.factoryPO || "",
          "Size": r.size || "",
          "Qty": r.qty,
          "Date": r.date || "",
          "Deadline": r.deadline || "",
          "Model": r.model || "",
          "SKU": r.sku || "",
          "Season": r.season || "",
          "Color Code": r.colorCode || "",
          "Color Name": r.colorCode2 || "",
          "Auto-Fill Source": r.autoFillSource || "",
          "Matched Order Key": r.matchedOrderKey || "",
          "Warning Accepted": r.warningAccepted ? "Yes" : "No",
          "Imported": r.imported ? "Yes" : "No",
          "Issues Count": issues.length,
          "Issues": issues.map((i: any) => `[${i.severity}] ${i.code}: ${i.message}`).join(" | "),
          "Recommended Actions": issues.map((i: any) => i.recommendedAction || "").filter(Boolean).join(" | "),
        };
      });
    };

    // Sheet 1: Summary
    const summaryData = [
      ["STAGING BATCH EXPORT"],
      [],
      ["Batch ID:", batch.batchId],
      ["Product Type:", batch.productType],
      ["Status:", batch.status],
      ["Created By:", batch.uploadedBy || ""],
      ["Created At:", batch.createdAt.toISOString()],
      [],
      ["STATISTICS"],
      ["Total Rows", batch.totalRows],
      ["Valid Rows", batch.validRows],
      ["Warning Rows", batch.warningRows],
      ["Error Rows", batch.errorRows],
      ["Reviewed Rows", batch.reviewedRows],
      ["Imported Rows", batch.importedRows],
      [],
      ["FILTER APPLIED:", sheetFilter],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryData), "1. Summary");

    // Sheet 2: All Rows
    const allRows = buildRowData(() => true);
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(allRows.length ? allRows : [{ Info: "No rows" }]),
      "2. All Rows"
    );

    // Sheet 3: Valid
    const validRows = buildRowData((r) => r.validationStatus === "VALID");
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(validRows.length ? validRows : [{ Info: "No valid rows" }]),
      "3. Valid"
    );

    // Sheet 4: Warning
    const warningRows = buildRowData((r) => r.validationStatus === "WARNING");
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(warningRows.length ? warningRows : [{ Info: "No warning rows" }]),
      "4. Warning"
    );

    // Sheet 5: Error
    const errorRows = buildRowData((r) => r.validationStatus === "ERROR");
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(errorRows.length ? errorRows : [{ Info: "No error rows" }]),
      "5. Error"
    );

    // Sheet 6: Reviewed
    const reviewedRows = buildRowData((r) => r.validationStatus === "REVIEWED");
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(reviewedRows.length ? reviewedRows : [{ Info: "No reviewed rows" }]),
      "6. Reviewed"
    );

    // Sheet 7: Issues Detail (rows with issues, expanded)
    const issueDetailRows: any[] = [];
    for (const r of rows) {
      let issues: any[] = [];
      try { issues = JSON.parse(r.validationErrors || "[]"); } catch {}
      if (issues.length === 0) continue;
      for (const issue of issues) {
        issueDetailRows.push({
          "Row #": r.rowNumber,
          "Validation Status": r.validationStatus,
          "Severity": issue.severity,
          "Category": issue.category,
          "Code": issue.code,
          "Message": issue.message,
          "Detail": issue.detail || "",
          "Recommended Action": issue.recommendedAction || "",
          "Shipping Status": r.shippingStatus || "",
          "PO NO#": r.poNo || "",
          "Factory PO": r.factoryPO || "",
          "Size": r.size || "",
          "Qty": r.qty,
          "Warning Accepted": r.warningAccepted ? "Yes" : "No",
        });
      }
    }
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(issueDetailRows.length ? issueDetailRows : [{ Info: "No issues found" }]),
      "7. Issues Detail"
    );

    // Sheet 8: Imported (rows already imported to EntryData)
    const importedRows = buildRowData((r) => r.imported);
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(importedRows.length ? importedRows : [{ Info: "No imported rows" }]),
      "8. Imported"
    );

    // Filter to single sheet if requested
    let outputWb = wb;
    if (sheetFilter !== "all") {
      const sheetMap: Record<string, string> = {
        valid: "3. Valid",
        warning: "4. Warning",
        error: "5. Error",
        reviewed: "6. Reviewed",
        issues: "7. Issues Detail",
        imported: "8. Imported",
      };
      const sheetName = sheetMap[sheetFilter];
      if (sheetName && wb.SheetNames.includes(sheetName)) {
        outputWb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(outputWb, wb.Sheets[sheetName], sheetName);
      }
    }

    const buffer = XLSX.write(outputWb, { type: "buffer", bookType: "xlsx" });
    const outFileName = `Staging_${batch.batchId}_${new Date().toISOString().slice(0, 10)}.xlsx`;

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
