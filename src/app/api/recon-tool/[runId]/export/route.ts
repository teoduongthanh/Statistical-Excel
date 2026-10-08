import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import * as XLSX from "xlsx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

// GET /api/recon-tool/[runId]/export — multi-sheet Excel (F8).
// Sheets: 1. Summary, 2. Detail, 3. Urgent (PARTIAL/OVER/MISSING_OUT/ORPHAN/SUSPECT_PO),
//         4. Errors (DUP/ATTR_MISMATCH/FMT_FIXED).
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const { runId } = await params;
    const run = await db.reconToolRun.findUnique({ where: { runId } });
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

    const allResults = await db.reconToolResult.findMany({
      where: { runId },
      orderBy: [{ status: "asc" }, { key: "asc" }],
    });

    const wb = XLSX.utils.book_new();

    // Sheet 1: Summary
    const summaryData: (string | number)[][] = [
      ["RECONCILIATION TOOL REPORT"],
      [],
      ["Run ID:", run.runId],
      ["Profile:", run.profileName],
      ["Source Dataset:", run.sourceDataset],
      ["Target Dataset:", run.targetDataset],
      ["Status:", run.status],
      ["Started At:", run.startedAt.toISOString()],
      ["Completed At:", run.completedAt?.toISOString() ?? ""],
      ["Duration (ms):", run.duration ?? 0],
      [],
      ["KPIs"],
      ["Total Lines", run.totalLines],
      ["Matched OK", run.matchedOk],
      ["Partial", run.partial],
      ["Over", run.over],
      ["Missing Out", run.missingOut],
      ["Orphan", run.orphan],
      ["Duplicate", run.dup],
      ["Attribute Mismatch", run.attrMismatch],
      ["Format Fixed", run.fmtFixed],
      ["Suspect PO", run.suspectPo],
      ["Match %", run.matchPercentage],
      [],
      ["QUANTITY TOTALS"],
      ["Source Total Qty", run.sourceTotalQty],
      ["Target Total Qty", run.targetTotalQty],
      ["Total Difference", run.totalDifference],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryData), "1. Summary");

    function buildRow(r: typeof allResults[number]) {
      const src = safeParse(r.sourceData, {} as any);
      const tgt = safeParse(r.targetData, {} as any);
      return {
        Status: r.status,
        Key: r.key,
        "Match Type": r.matchType ?? "",
        "Source PO NO#": src.poNo ?? "",
        "Source Factory PO": src.factoryPO ?? "",
        "Source Size (canonical)": src.size ?? "",
        "Source Size (raw)": src.rawSize ?? "",
        "Source Model": src.model ?? "",
        "Source Color": src.colorCode ?? "",
        "Source Deadline": src.deadline ?? "",
        "Source Qty": r.sourceQty,
        "Target PO NO#": tgt.poNo ?? "",
        "Target Factory PO": tgt.factoryPO ?? "",
        "Target Size (canonical)": tgt.size ?? "",
        "Target Size (raw)": tgt.rawSize ?? "",
        "Target Model": tgt.model ?? "",
        "Target Color": tgt.colorCode ?? "",
        "Target Deadline": tgt.deadline ?? "",
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

    addSheet("2. Detail", allResults);

    const urgentStatuses = ["PARTIAL", "OVER", "MISSING_OUT", "ORPHAN", "SUSPECT_PO"];
    addSheet("3. Urgent", allResults.filter((r) => urgentStatuses.includes(r.status)));

    const errorStatuses = ["DUP", "ATTR_MISMATCH", "FMT_FIXED"];
    addSheet("4. Errors", allResults.filter((r) => errorStatuses.includes(r.status)));

    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    const outFileName = `ReconTool_${run.runId}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${outFileName}"`,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Export failed", detail: e?.message },
      { status: 500 }
    );
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
