import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getProject } from "@/lib/project-service";
import * as XLSX from "xlsx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

// GET /api/recon-v2/projects/[id]/export?runId=PR-...&format=xlsx|json
//   - format=json  → project config JSON (for backup / template)
//   - format=xlsx  → multi-sheet Excel (config + summary + results + audit)
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const project = await getProject(id);
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const { searchParams } = new URL(req.url);
    let runId = searchParams.get("runId");
    if (!runId) runId = project.lastRunId ?? undefined;
    const format = searchParams.get("format") || "xlsx";

    const configJson = {
      name: project.name,
      description: project.description,
      tags: project.tags,
      sourceConfig: project.sourceConfig,
      targetConfig: project.targetConfig,
      fieldMappings: project.fieldMappings,
      matchKeyFields: project.matchKeyFields,
      rules: project.rules,
      comparisonConfig: project.comparisonConfig,
      statusMapping: project.statusMapping,
      sizeTables: project.sizeTables,
      template: project.template,
    };

    if (format === "json") {
      return NextResponse.json({ ok: true, project: configJson });
    }

    // xlsx export
    const wb = XLSX.utils.book_new();

    // Sheet 1: Config
    const configRows: (string | number)[][] = [
      ["RECON V2 PROJECT CONFIG"],
      [],
      ["Name", project.name],
      ["Description", project.description ?? ""],
      ["Tags", project.tags.join(", ")],
      ["Source Dataset", project.sourceConfig.dataset],
      ["Target Dataset", project.targetConfig.dataset],
      ["Match Key Fields", project.matchKeyFields.join(", ")],
      ["Mode", project.comparisonConfig.mode ?? "aggregate"],
      ["Tolerance Type", project.comparisonConfig.tolerance?.type ?? "absolute"],
      ["Tolerance Value", project.comparisonConfig.tolerance?.value ?? 0],
      ["Pre-filter shippingStatus", project.comparisonConfig.preFilter?.shippingStatus ?? ""],
      [],
      ["Field Mappings"],
      ["Source Field", "Target Field", "Role", "Transform Rule"],
      ...project.fieldMappings.map((m) => [m.sourceField, m.targetField, m.role, m.transformRule ?? ""]),
      [],
      ["Rules (Size Transform)"],
      ["ID", "Name", "Type", "Condition", "Table", "Regex", "Enabled"],
      ...project.rules.map((r) => [r.id, r.name, r.type, r.condition ?? "", r.tableId ?? "", r.regex ?? "", r.enabled ? "yes" : "no"]),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(configRows), "1. Config");

    let run: any = null;
    if (runId) {
      run = await db.projectRun.findUnique({ where: { runId } });
    }
    if (run) {
      const summaryRows: (string | number)[][] = [
        ["RUN SUMMARY"],
        [],
        ["Run ID", run.runId],
        ["Trigger", run.trigger],
        ["Started At", run.startedAt?.toISOString?.() ?? ""],
        ["Completed At", run.completedAt?.toISOString?.() ?? ""],
        ["Duration (ms)", run.duration ?? 0],
        ["Status", run.status],
        [],
        ["KPIs"],
        ["Total Lines", run.totalLines],
        ["Matched OK", run.matchedOk],
        ["Partial", run.partial],
        ["Over", run.over],
        ["Missing Out", run.missingOut],
        ["Orphan", run.orphan],
        ["Duplicate", run.dup],
        ["Attr Mismatch", run.attrMismatch],
        ["Fmt Fixed", run.fmtFixed],
        ["Suspect PO", run.suspectPo],
        ["Match %", run.matchPercent],
        [],
        ["Quantity Totals"],
        ["Source Total Qty", run.sourceTotalQty],
        ["Target Total Qty", run.targetTotalQty],
        ["Total Difference", run.totalDifference],
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryRows), "2. Summary");

      // Sheet 3: Results
      const resultRows = await db.projectResultRow.findMany({
        where: { runId: run.runId },
        orderBy: [{ statusCode: "asc" }, { key: "asc" }],
        take: 50000,
      });
      const data = resultRows.map((r) => {
        const src = safeParse(r.sourceData, {});
        const tgt = safeParse(r.targetData, {});
        return {
          Status: r.statusCode,
          Key: r.key,
          "Source PO NO#": src.poNo ?? "",
          "Source Factory PO": src.factoryPO ?? "",
          "Source Size": src.size ?? "",
          "Source Raw Size": src.rawSize ?? "",
          "Source Model": src.model ?? "",
          "Source Color": src.colorCode ?? "",
          "Source Qty": r.sourceQty,
          "Target PO NO#": tgt.poNo ?? "",
          "Target Factory PO": tgt.factoryPO ?? "",
          "Target Size": tgt.size ?? "",
          "Target Raw Size": tgt.rawSize ?? "",
          "Target Model": tgt.model ?? "",
          "Target Color": tgt.colorCode ?? "",
          "Target Qty": r.targetQty,
          Difference: r.difference,
          Resolved: r.resolved ? "yes" : "no",
          Note: r.note ?? "",
          AssignedTo: r.assignedTo ?? "",
        };
      });
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(data.length ? data : [{ Info: "No rows" }]),
        "3. Results"
      );
    }

    // Sheet 4: Audit log (last 100 entries)
    const audit = await db.projectAuditLog.findMany({
      where: { projectId: id },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const auditData = audit.map((a) => ({
      Action: a.action,
      EntityType: a.entityType,
      EntityId: a.entityId ?? "",
      User: a.user ?? "",
      Detail: a.detail ?? "",
      OldValue: a.oldValue ?? "",
      NewValue: a.newValue ?? "",
      CreatedAt: a.createdAt?.toISOString?.() ?? "",
    }));
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(auditData.length ? auditData : [{ Info: "No audit entries" }]),
      "4. Audit"
    );

    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    const outFileName = `ReconV2_${project.name}_${runId ?? "no-run"}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${outFileName}"`,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Export failed", detail: e?.message ?? String(e) },
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
