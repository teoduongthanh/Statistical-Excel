import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import * as XLSX from "xlsx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// GET /api/comparison-studio/[runId]/export — export results to .xlsx with sheets:
//   1. Summary, 2. All, 3. Matched, 4. Mismatch, 5. Missing Source,
//   6. Missing Target, 7. Ambiguous, 8. Shortage, 9. Overage
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const { runId } = await params;
    const run = await db.comparisonRun.findUnique({ where: { runId } });
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

    const allResults = await db.comparisonResult.findMany({
      where: { runId },
      orderBy: [{ status: "asc" }, { key: "asc" }],
    });

    const wb = XLSX.utils.book_new();

    // Sheet 1: Summary
    const summaryData: (string | number)[][] = [
      ["COMPARISON STUDIO REPORT"],
      [],
      ["Run ID:", run.runId],
      ["Profile:", run.profileName],
      ["Profile Version:", run.profileVersion],
      ["Source Dataset:", run.sourceDataset],
      ["Target Dataset:", run.targetDataset],
      ["Filters:", run.filters],
      ["Status:", run.status],
      ["Started At:", run.startedAt.toISOString()],
      ["Completed At:", run.completedAt?.toISOString() ?? ""],
      ["Duration (ms):", run.duration ?? 0],
      [],
      ["STATISTICS"],
      ["Total Compared", run.totalCompared],
      ["Matched", run.matchedCount],
      ["Mismatch", run.mismatchCount],
      ["Missing Source", run.missingSource],
      ["Missing Target", run.missingTarget],
      ["Ambiguous", run.ambiguousCount],
      ["Shortage", run.shortageCount],
      ["Overage", run.overageCount],
      ["Match %", run.matchPercentage],
      [],
      ["QUANTITY TOTALS"],
      ["Source Total Qty", run.sourceTotalQty],
      ["Target Total Qty", run.targetTotalQty],
      ["Total Difference", run.totalDifference],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryData), "1. Summary");

    // Helper to flatten a result row
    function buildRow(r: typeof allResults[number]) {
      const src = safeParse(r.sourceData, {});
      const tgt = safeParse(r.targetData, {});
      return {
        Status: r.status,
        Key: r.key,
        "Match Type": r.matchType ?? "",
        "Source PO NO#": src.poNo ?? "",
        "Source Factory PO": src.factoryPO ?? "",
        "Source Size": src.size ?? "",
        "Source Model": src.model ?? "",
        "Source Color": src.colorCode ?? "",
        "Source Qty": r.sourceQty,
        "Target PO NO#": tgt.poNo ?? "",
        "Target Factory PO": tgt.factoryPO ?? "",
        "Target Size": tgt.size ?? "",
        "Target Model": tgt.model ?? "",
        "Target Color": tgt.colorCode ?? "",
        "Target Qty": r.targetQty,
        Difference: r.difference,
        Percentage: r.percentage,
        Issues: r.issues,
        "Source Row Count": src.rowCount ?? 0,
        "Target Row Count": tgt.rowCount ?? 0,
      };
    }

    function addSheet(name: string, rows: typeof allResults) {
      const data = rows.length ? rows.map(buildRow) : [{ Info: "No rows" }];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), name);
    }

    addSheet("2. All", allResults);
    addSheet("3. Matched", allResults.filter((r) => r.status === "MATCHED"));
    addSheet("4. Mismatch", allResults.filter((r) => r.status === "QTY_MISMATCH"));
    addSheet("5. Missing Source", allResults.filter((r) => r.status === "MISSING_SOURCE"));
    addSheet("6. Missing Target", allResults.filter((r) => r.status === "MISSING_TARGET"));
    addSheet("7. Ambiguous", allResults.filter((r) => r.status === "AMBIGUOUS"));
    addSheet("8. Shortage", allResults.filter((r) => r.status === "SHORTAGE"));
    addSheet("9. Overage", allResults.filter((r) => r.status === "OVERAGE"));

    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    const outFileName = `Comparison_${run.runId}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${outFileName}"`,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Export failed", detail: e?.message }, { status: 500 });
  }
}

function safeParse<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}
