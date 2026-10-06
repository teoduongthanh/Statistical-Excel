import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import * as XLSX from "xlsx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/entry-staging/[id]/export?sheet=all|valid|warning|error|reviewed
// Exports staging rows to .xlsx with multiple sheets (spec §66).
// Sheet "Warnings Detail" provides full breakdown of quantity issues + causes,
// matching the detail shown in the UI row detail dialog.
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

    // ── Helper: parse issues from validationErrors JSON ────────────────────
    function parseIssues(r: any): any[] {
      try { return JSON.parse(r.validationErrors || "[]"); } catch { return []; }
    }

    // ── Helper: build row data for summary sheets ──────────────────────────
    const buildRowData = (filterFn: (r: any) => boolean) => {
      return rows.filter(filterFn).map((r) => {
        const issues = parseIssues(r);
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

    // ── Sheet 1: Summary ───────────────────────────────────────────────────
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

    // ── Sheet 2: All Rows ─────────────────────────────────────────────────
    const allRows = buildRowData(() => true);
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(allRows.length ? allRows : [{ Info: "No rows" }]),
      "2. All Rows"
    );

    // ── Sheet 3: Valid ─────────────────────────────────────────────────────
    const validRows = buildRowData((r) => r.validationStatus === "VALID");
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(validRows.length ? validRows : [{ Info: "No valid rows" }]),
      "3. Valid"
    );

    // ── Sheet 4: Warning ──────────────────────────────────────────────────
    const warningRows = buildRowData((r) => r.validationStatus === "WARNING");
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(warningRows.length ? warningRows : [{ Info: "No warning rows" }]),
      "4. Warning"
    );

    // ── Sheet 5: Error ────────────────────────────────────────────────────
    const errorRows = buildRowData((r) => r.validationStatus === "ERROR");
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(errorRows.length ? errorRows : [{ Info: "No error rows" }]),
      "5. Error"
    );

    // ── Sheet 6: Reviewed ─────────────────────────────────────────────────
    const reviewedRows = buildRowData((r) => r.validationStatus === "REVIEWED");
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(reviewedRows.length ? reviewedRows : [{ Info: "No reviewed rows" }]),
      "6. Reviewed"
    );

    // ── Sheet 7: Issues Detail (expanded per-issue rows) ──────────────────
    const issueDetailRows: any[] = [];
    for (const r of rows) {
      const issues = parseIssues(r);
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

    // ── Sheet 8: Imported ─────────────────────────────────────────────────
    const importedRows = buildRowData((r) => r.imported);
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(importedRows.length ? importedRows : [{ Info: "No imported rows" }]),
      "8. Imported"
    );

    // ── Sheet 9: Warnings Detail (full breakdown — matches UI row detail) ─
    // This sheet provides FULL detail about each warning/error row:
    //   - Input data (what user entered)
    //   - Matched Order info (from auto-fill)
    //   - Quantity comparison (Order Qty, Previous Output/Input, Batch qty, Total)
    //   - Each issue with full detail text (including numbers)
    //   - Recommended action
    const warningDetailRows: any[] = [];
    for (const r of rows) {
      const issues = parseIssues(r);
      if (issues.length === 0) continue;
      // Only include WARNING and ERROR rows (not REVIEWED unless user wants)
      if (r.validationStatus !== "WARNING" && r.validationStatus !== "ERROR" && r.validationStatus !== "REVIEWED") continue;

      // Parse detail from each issue — the "detail" field contains the full
      // breakdown with numbers (e.g. "Order Qty: 100\nPrevious Output: 80\n...").
      // We split it into separate columns for easier Excel analysis.
      for (const issue of issues) {
        const detailLines = (issue.detail || "").split("\n").filter(Boolean);
        const detailParsed: Record<string, string> = {};
        for (const line of detailLines) {
          const m = line.match(/^([^:]+):\s*(.+)$/);
          if (m) {
            detailParsed[m[1].trim()] = m[2].trim();
          }
        }

        warningDetailRows.push({
          "Row #": r.rowNumber,
          "Validation Status": r.validationStatus,
          "Issue Severity": issue.severity,
          "Issue Category": issue.category,
          "Issue Code": issue.code,
          "Issue Message": issue.message,
          // ── Input Data (what user entered) ──
          "Input Shipping Status": r.shippingStatus || "",
          "Input PO NO#": r.poNo || "",
          "Input Factory PO": r.factoryPO || "",
          "Input Size": r.size || "",
          "Input Qty": r.qty,
          "Input Date": r.date || "",
          "Input Deadline": r.deadline || "",
          // ── Auto-Fill / Matched Order ──
          "Matched Model": r.model || "",
          "Matched SKU": r.sku || "",
          "Matched Season": r.season || "",
          "Matched Color Code": r.colorCode || "",
          "Matched Color Name": r.colorCode2 || "",
          "Auto-Fill Source": r.autoFillSource || "",
          "Matched Order Key": r.matchedOrderKey || "",
          // ── Quantity breakdown (parsed from issue.detail) ──
          "Order Qty": detailParsed["Order Qty"] || "",
          "Previous Output": detailParsed["Previous Output"] || "",
          "Batch Output": detailParsed["Batch Output"] || "",
          "Total Output": detailParsed["Total Output"] || "",
          "Output Qty": detailParsed["Output Qty"] || "",
          "Excess": detailParsed["Excess"] || detailParsed["Excess Input"] || "",
          "Input Qty (Ref)": detailParsed["Input Qty"] || "",
          "Excess Input": detailParsed["Excess Input"] || "",
          // ── Full detail text (complete, unedited) ──
          "Full Detail": issue.detail || "",
          // ── Recommended action ──
          "Recommended Action": issue.recommendedAction || "",
          // ── Warning acceptance status ──
          "Warning Accepted": r.warningAccepted ? "Yes" : "No",
          "Warning Accepted By": r.warningAcceptedBy || "",
          "Warning Accept Reason": r.warningAcceptReason || "",
        });
      }
    }
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(warningDetailRows.length ? warningDetailRows : [{ Info: "No warning/error rows" }]),
      "9. Warnings Detail"
    );

    // ── Sheet 10: Quantity Comparison (summary per business key) ──────────
    // Groups rows by poNo|factoryPO|size and shows:
    //   - Batch total Output vs Order Qty
    //   - Batch total Input vs Output
    //   - Whether the group has issues
    const groupMap = new Map<string, {
      poNo: string; factoryPO: string; size: string;
      orderQty: number; batchOutput: number; batchInput: number;
      issues: string[]; rowNumbers: number[];
    }>();

    for (const r of rows) {
      const key = `${r.poNo}|${r.factoryPO}|${r.size}`;
      let g = groupMap.get(key);
      if (!g) {
        g = {
          poNo: r.poNo || "", factoryPO: r.factoryPO || "", size: r.size || "",
          orderQty: 0, batchOutput: 0, batchInput: 0,
          issues: [], rowNumbers: [],
        };
        groupMap.set(key, g);
      }
      g.rowNumbers.push(r.rowNumber);
      const bucket = (r.shippingStatus || "").toLowerCase();
      if (bucket.startsWith("1") || bucket === "order") g.orderQty += r.qty;
      else if (bucket.startsWith("2") || bucket === "output") g.batchOutput += r.qty;
      else if (bucket.startsWith("4") || bucket === "input") g.batchInput += r.qty;

      const issues = parseIssues(r);
      for (const issue of issues) {
        if (issue.severity === "WARNING" || issue.severity === "ERROR") {
          g.issues.push(`Row ${r.rowNumber}: [${issue.code}] ${issue.message}`);
        }
      }
    }

    const quantityComparisonRows = Array.from(groupMap.values()).map((g) => ({
      "PO NO#": g.poNo,
      "Factory PO": g.factoryPO,
      "Size": g.size,
      "Rows in Group": g.rowNumbers.length,
      "Row Numbers": g.rowNumbers.join(", "),
      "Order Qty (batch)": g.orderQty,
      "Batch Output Qty": g.batchOutput,
      "Batch Input Qty": g.batchInput,
      "Remaining (Order - Output)": g.orderQty - g.batchOutput,
      "Pending (Output - Input)": g.batchOutput - g.batchInput,
      "Has Issues": g.issues.length > 0 ? "Yes" : "No",
      "Issues Count": g.issues.length,
      "Issues Summary": g.issues.join(" | "),
    }));

    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(quantityComparisonRows.length ? quantityComparisonRows : [{ Info: "No groups" }]),
      "10. Quantity Comparison"
    );

    // ── Filter to single sheet if requested ───────────────────────────────
    let outputWb = wb;
    if (sheetFilter !== "all") {
      const sheetMap: Record<string, string> = {
        valid: "3. Valid",
        warning: "4. Warning",
        error: "5. Error",
        reviewed: "6. Reviewed",
        issues: "7. Issues Detail",
        imported: "8. Imported",
        "warnings-detail": "9. Warnings Detail",
        "quantity": "10. Quantity Comparison",
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
