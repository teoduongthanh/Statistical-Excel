// Reconciliation V2 Project Service — spec F10/F11/F12.
//
// Project management CRUD + run + diagnostics, layered on top of the existing
// reconciliation-tool-service engine (F1–F9) and fvo-stech-tracking-service
// (size/gender normalization).
//
// Key design:
//   - Reuses `runReconciliation` (writes to reconToolRun/reconToolResult).
//   - For each V2 run we ALSO create a ProjectRun record + copy rows into
//     ProjectResultRow (with diagnostic field reserved for F11 drill-down).
//   - READ-ONLY: never modifies MasterData.
//   - All config edits are auto-saved (audit-logged).
//
// Spec coverage:
//   F10 — Project CRUD, duplicate, archive/restore, templates.
//   F11 — Diagnostic drill-down (see diagnostic-engine.ts).
//   F12 — Data sources + snapshots + sync (basic manual sync).

import { db } from "./db";
import {
  runReconciliation,
  DEFAULT_MEN_TABLE,
  DEFAULT_WOMEN_TABLE,
  DEFAULT_RECON_PROFILE,
  type ReconciliationConfig,
  type FieldMapping,
  type SizeTransformRule,
  type ToleranceConfig,
  type PreFilter,
  type NormalizeConfig,
} from "./reconciliation-tool-service";
import { generateDiagnostic, type DiagnosticDetail } from "./diagnostic-engine";

// ── Types ────────────────────────────────────────────────────────────────────

export interface ProjectSourceConfig {
  dataset: string;       // productType for source (e.g. "ONYX_FVO")
  productType?: string;  // alias kept for spec parity
  label?: string;
}

export interface ProjectTargetConfig {
  dataset: string;       // productType for target (e.g. "ONYX")
  productType?: string;
  label?: string;
}

export interface ProjectComparisonConfig {
  tolerance?: ToleranceConfig;
  mode?: "row_to_row" | "aggregate";
  preFilter?: PreFilter;
  nullHandling?: "strict" | "ignore";
}

export interface SizeTables {
  men?: Record<string, string>;
  women?: Record<string, string>;
}

export interface CreateProjectInput {
  name: string;
  description?: string;
  tags?: string[];
  sourceConfig?: ProjectSourceConfig;
  targetConfig?: ProjectTargetConfig;
  fieldMappings?: FieldMapping[];
  matchKeyFields?: string[];
  rules?: SizeTransformRule[];
  comparisonConfig?: ProjectComparisonConfig;
  statusMapping?: Record<string, string>;
  sizeTables?: SizeTables;
  template?: boolean;
}

export interface HydratedProject {
  id: string;
  name: string;
  description: string | null;
  tags: string[];
  sourceConfig: ProjectSourceConfig;
  targetConfig: ProjectTargetConfig;
  fieldMappings: FieldMapping[];
  matchKeyFields: string[];
  rules: SizeTransformRule[];
  comparisonConfig: ProjectComparisonConfig;
  statusMapping: Record<string, string>;
  sizeTables: SizeTables;
  status: string;
  template: boolean;
  lastRunId: string | null;
  lastRunAt: Date | null;
  lastMatchPercent: number;
  lastTotalLines: number;
  lastMatched: number;
  lastMismatch: number;
  lastMissing: number;
  lastOrphan: number;
  syncStatus: string;
  lastSyncAt: Date | null;
  nextSyncAt: Date | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RunSummary {
  runId: string;
  projectId: string;
  totalLines: number;
  matchedOk: number;
  partial: number;
  over: number;
  missingOut: number;
  orphan: number;
  dup: number;
  attrMismatch: number;
  fmtFixed: number;
  suspectPo: number;
  sourceTotalQty: number;
  targetTotalQty: number;
  totalDifference: number;
  matchPercent: number;
  durationMs: number;
  status: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function safeParse<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

function safeStringify(v: unknown): string {
  return JSON.stringify(v ?? {});
}

export function hydrateProject(p: any): HydratedProject {
  return {
    id: p.id,
    name: p.name,
    description: p.description ?? null,
    tags: safeParse<string[]>(p.tags, []),
    sourceConfig: safeParse<ProjectSourceConfig>(p.sourceConfig, { dataset: "ONYX_FVO" }),
    targetConfig: safeParse<ProjectTargetConfig>(p.targetConfig, { dataset: "ONYX" }),
    fieldMappings: safeParse<FieldMapping[]>(p.fieldMappings, []),
    matchKeyFields: safeParse<string[]>(p.matchKeyFields, []),
    rules: safeParse<SizeTransformRule[]>(p.rules, []),
    comparisonConfig: safeParse<ProjectComparisonConfig>(p.comparisonConfig, {}),
    statusMapping: safeParse<Record<string, string>>(p.statusMapping, {}),
    sizeTables: safeParse<SizeTables>(p.sizeTables, { men: {}, women: {} }),
    status: p.status ?? "active",
    template: p.template ?? false,
    lastRunId: p.lastRunId ?? null,
    lastRunAt: p.lastRunAt ?? null,
    lastMatchPercent: p.lastMatchPercent ?? 0,
    lastTotalLines: p.lastTotalLines ?? 0,
    lastMatched: p.lastMatched ?? 0,
    lastMismatch: p.lastMismatch ?? 0,
    lastMissing: p.lastMissing ?? 0,
    lastOrphan: p.lastOrphan ?? 0,
    syncStatus: p.syncStatus ?? "never",
    lastSyncAt: p.lastSyncAt ?? null,
    nextSyncAt: p.nextSyncAt ?? null,
    createdBy: p.createdBy ?? null,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

// Build the engine-compatible ReconciliationConfig from a project.
export function projectToConfig(project: HydratedProject): ReconciliationConfig {
  const sourceDataset = project.sourceConfig.dataset || project.sourceConfig.productType || "ONYX_FVO";
  const targetDataset = project.targetConfig.dataset || project.targetConfig.productType || "ONYX";
  const tol: ToleranceConfig = project.comparisonConfig.tolerance ?? { type: "absolute", value: 0 };
  const preFilter: PreFilter = project.comparisonConfig.preFilter ?? { shippingStatus: "1.Order" };
  const mode = project.comparisonConfig.mode ?? "aggregate";
  const normalizeConfig: NormalizeConfig = { trim: true, upper: true, removeWhitespace: true, commaToDot: true };
  const rules: SizeTransformRule[] = project.rules && project.rules.length > 0
    ? project.rules
    : DEFAULT_RECON_PROFILE.sizeTransformRules;
  return {
    sourceDataset,
    targetDataset,
    fieldMappings: project.fieldMappings,
    matchKeys: project.matchKeyFields,
    statusMapping: project.statusMapping,
    tolerance: tol,
    mode,
    preFilter,
    sizeTransformRules: rules,
    normalizeConfig,
    sizeConversionTables: [DEFAULT_MEN_TABLE, DEFAULT_WOMEN_TABLE],
  };
}

async function writeAudit(
  projectId: string,
  action: string,
  entityType: string,
  entityId: string | null,
  oldValue: unknown,
  newValue: unknown,
  user: string | null,
  detail?: string
): Promise<void> {
  try {
    await db.projectAuditLog.create({
      data: {
        projectId,
        action,
        entityType,
        entityId: entityId ?? null,
        oldValue: oldValue ? safeStringify(oldValue) : null,
        newValue: newValue ? safeStringify(newValue) : null,
        user: user ?? null,
        detail: detail ?? null,
      },
    });
  } catch {
    // Audit log is best-effort — don't fail the operation.
  }
}

// ── Project CRUD (F10) ───────────────────────────────────────────────────────

export async function createProject(input: CreateProjectInput, user?: string): Promise<HydratedProject> {
  const name = (input.name || "").trim();
  if (!name) throw new Error("name is required");
  const existing = await db.reconProject.findUnique({ where: { name } });
  if (existing) throw new Error(`Project "${name}" already exists`);

  const project = await db.reconProject.create({
    data: {
      name,
      description: input.description ?? null,
      tags: safeStringify(input.tags ?? []),
      sourceConfig: safeStringify(input.sourceConfig ?? { dataset: "ONYX_FVO" }),
      targetConfig: safeStringify(input.targetConfig ?? { dataset: "ONYX" }),
      fieldMappings: safeStringify(input.fieldMappings ?? DEFAULT_RECON_PROFILE.fieldMappings),
      matchKeyFields: safeStringify(input.matchKeyFields ?? DEFAULT_RECON_PROFILE.matchKeys),
      rules: safeStringify(input.rules ?? DEFAULT_RECON_PROFILE.sizeTransformRules),
      comparisonConfig: safeStringify(input.comparisonConfig ?? {
        tolerance: DEFAULT_RECON_PROFILE.tolerance,
        mode: DEFAULT_RECON_PROFILE.mode,
        preFilter: DEFAULT_RECON_PROFILE.preFilter,
      }),
      statusMapping: safeStringify(input.statusMapping ?? DEFAULT_RECON_PROFILE.statusMapping),
      sizeTables: safeStringify(input.sizeTables ?? { men: DEFAULT_MEN_TABLE.entries, women: DEFAULT_WOMEN_TABLE.entries }),
      status: "active",
      template: input.template ?? false,
      createdBy: user ?? null,
    },
  });
  await writeAudit(project.id, "CREATE", "project", project.id, null, { name }, user ?? null, "Project created");
  return hydrateProject(project);
}

export async function listProjects(status?: string): Promise<HydratedProject[]> {
  const where: any = {};
  if (status) where.status = status;
  const rows = await db.reconProject.findMany({
    where,
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
  });
  return rows.map(hydrateProject);
}

export async function getProject(id: string): Promise<HydratedProject | null> {
  const project = await db.reconProject.findUnique({ where: { id } });
  return project ? hydrateProject(project) : null;
}

export async function updateProject(
  id: string,
  data: Partial<CreateProjectInput> & { status?: string },
  user?: string
): Promise<HydratedProject> {
  const current = await db.reconProject.findUnique({ where: { id } });
  if (!current) throw new Error("Project not found");

  const patch: Record<string, any> = {};
  if (data.name !== undefined) patch.name = data.name;
  if (data.description !== undefined) patch.description = data.description;
  if (data.tags !== undefined) patch.tags = safeStringify(data.tags);
  if (data.sourceConfig !== undefined) patch.sourceConfig = safeStringify(data.sourceConfig);
  if (data.targetConfig !== undefined) patch.targetConfig = safeStringify(data.targetConfig);
  if (data.fieldMappings !== undefined) patch.fieldMappings = safeStringify(data.fieldMappings);
  if (data.matchKeyFields !== undefined) patch.matchKeyFields = safeStringify(data.matchKeyFields);
  if (data.rules !== undefined) patch.rules = safeStringify(data.rules);
  if (data.comparisonConfig !== undefined) patch.comparisonConfig = safeStringify(data.comparisonConfig);
  if (data.statusMapping !== undefined) patch.statusMapping = safeStringify(data.statusMapping);
  if (data.sizeTables !== undefined) patch.sizeTables = safeStringify(data.sizeTables);
  if (data.template !== undefined) patch.template = data.template;
  if (data.status !== undefined) patch.status = data.status;

  const updated = await db.reconProject.update({ where: { id }, data: patch });
  await writeAudit(id, "UPDATE", "project", id, hydrateProject(current), hydrateProject(updated), user ?? null, "Project updated");
  return hydrateProject(updated);
}

export async function deleteProject(id: string, user?: string): Promise<void> {
  // Soft delete → archive. Real deletion only when status is already archived.
  const project = await db.reconProject.findUnique({ where: { id } });
  if (!project) return;
  if (project.status === "archived") {
    // Hard delete only on already-archived projects (still keep audit trail).
    await db.reconProject.delete({ where: { id } });
    await writeAudit(id, "DELETE", "project", id, hydrateProject(project), null, user ?? null, "Project deleted (hard)");
    return;
  }
  await db.reconProject.update({ where: { id }, data: { status: "archived" } });
  await writeAudit(id, "DELETE", "project", id, hydrateProject(project), { status: "archived" }, user ?? null, "Project archived (soft delete)");
}

export async function archiveProject(id: string, user?: string): Promise<HydratedProject> {
  const project = await db.reconProject.findUnique({ where: { id } });
  if (!project) throw new Error("Project not found");
  const updated = await db.reconProject.update({ where: { id }, data: { status: "archived" } });
  await writeAudit(id, "ARCHIVE", "project", id, hydrateProject(project), hydrateProject(updated), user ?? null, "Project archived");
  return hydrateProject(updated);
}

export async function restoreProject(id: string, user?: string): Promise<HydratedProject> {
  const project = await db.reconProject.findUnique({ where: { id } });
  if (!project) throw new Error("Project not found");
  const updated = await db.reconProject.update({ where: { id }, data: { status: "active" } });
  await writeAudit(id, "RESTORE", "project", id, hydrateProject(project), hydrateProject(updated), user ?? null, "Project restored");
  return hydrateProject(updated);
}

export async function duplicateProject(id: string, newName: string, user?: string): Promise<HydratedProject> {
  const src = await db.reconProject.findUnique({ where: { id } });
  if (!src) throw new Error("Source project not found");
  const existing = await db.reconProject.findUnique({ where: { name: newName } });
  if (existing) throw new Error(`Project "${newName}" already exists`);

  const created = await db.reconProject.create({
    data: {
      name: newName,
      description: src.description,
      tags: src.tags,
      sourceConfig: src.sourceConfig,
      targetConfig: src.targetConfig,
      fieldMappings: src.fieldMappings,
      matchKeyFields: src.matchKeyFields,
      rules: src.rules,
      comparisonConfig: src.comparisonConfig,
      statusMapping: src.statusMapping,
      sizeTables: src.sizeTables,
      status: "active",
      template: false,
      createdBy: user ?? null,
    },
  });
  await writeAudit(created.id, "DUPLICATE", "project", created.id, { sourceId: id }, { name: newName }, user ?? null, `Duplicated from ${id}`);
  return hydrateProject(created);
}

// ── Data Sources + Sync (F12) ────────────────────────────────────────────────

export async function getProjectSources(projectId: string): Promise<any[]> {
  const sources = await db.reconDataSource.findMany({
    where: { projectId },
    orderBy: [{ createdAt: "asc" }],
  });
  return sources;
}

export async function ensureDefaultSources(projectId: string, project: HydratedProject): Promise<void> {
  const existing = await db.reconDataSource.findMany({ where: { projectId } });
  if (existing.length > 0) return;
  const srcDataset = project.sourceConfig.dataset || "ONYX_FVO";
  const tgtDataset = project.targetConfig.dataset || "ONYX";
  await db.reconDataSource.createMany({
    data: [
      {
        projectId,
        name: `Source A (${srcDataset})`,
        dataset: srcDataset,
        type: "database",
        config: safeStringify({ kind: "mongodb", collection: "MasterData", filter: { productType: srcDataset } }),
        syncSchedule: "manual",
        syncHealth: "unknown",
      },
      {
        projectId,
        name: `Source B (${tgtDataset})`,
        dataset: tgtDataset,
        type: "database",
        config: safeStringify({ kind: "mongodb", collection: "MasterData", filter: { productType: tgtDataset } }),
        syncSchedule: "manual",
        syncHealth: "unknown",
      },
    ],
  });
}

// Alias — easier to remember at the API layer.
export const ensureProjectSources = ensureDefaultSources;

// Trigger a sync — for DB-type sources this means: read current MasterData
// row count for that productType, compute a contentHash from a sample,
// store a new ReconSnapshot, and return the snapshot. We also diff against
// the previous snapshot to populate changesAdded/Modified/Deleted.
export async function syncDataSource(dataSourceId: string, user?: string): Promise<any> {
  const ds = await db.reconDataSource.findUnique({ where: { id: dataSourceId } });
  if (!ds) throw new Error("Data source not found");
  await db.reconDataSource.update({
    where: { id: dataSourceId },
    data: { lastSyncStatus: "syncing", lastSyncError: null },
  });
  try {
    const dataset = ds.dataset;
    const rows = await db.masterData.findMany({
      where: { productType: dataset },
      select: { poNo: true, factoryPO: true, size: true, qty1: true, shippingStatus: true, updatedAt: true },
      take: 50000,
    });
    const rowCount = rows.length;
    // Build a quick contentHash from first/last sample + total.
    const sample = rows.slice(0, 1000).map((r) => `${r.poNo}|${r.factoryPO}|${r.size}|${r.qty1}|${r.shippingStatus}`).join(";");
    const crypto = await import("crypto");
    const contentHash = crypto.createHash("md5").update(sample + `#${rowCount}`).digest("hex");

    const prevSnaps = await db.reconSnapshot.findMany({
      where: { dataSourceId },
      orderBy: { fetchedAt: "desc" },
      take: 1,
    });
    const prev = prevSnaps[0];
    let added = 0, modified = 0, deleted = 0;
    if (prev) {
      // Quick comparison: row count delta + hash diff.
      const prevCount = prev.rowCount;
      if (rowCount > prevCount) added = rowCount - prevCount;
      else if (rowCount < prevCount) deleted = prevCount - rowCount;
      if (prev.contentHash && prev.contentHash !== contentHash && added === 0 && deleted === 0) {
        modified = Math.min(rowCount, prevCount);
      }
    }

    const snapshot = await db.reconSnapshot.create({
      data: {
        dataSourceId,
        projectId: ds.projectId,
        rowCount,
        contentHash,
        changesAdded: added,
        changesModified: modified,
        changesDeleted: deleted,
        status: "completed",
      },
    });
    await db.reconDataSource.update({
      where: { id: dataSourceId },
      data: {
        lastSyncedAt: new Date(),
        lastSyncStatus: "ok",
        syncHealth: "healthy",
        snapshotCount: (await db.reconSnapshot.count({ where: { dataSourceId } })),
      },
    });
    await db.reconProject.update({
      where: { id: ds.projectId },
      data: { lastSyncAt: new Date(), syncStatus: "ok" },
    });
    // Notification (F12)
    await db.projectNotification.create({
      data: {
        projectId: ds.projectId,
        type: "sync_completed",
        severity: "success",
        title: `Đồng bộ xong: ${ds.name}`,
        message: `Đã lấy ${rowCount} dòng từ dataset "${dataset}". Thay đổi: +${added} / ~${modified} / -${deleted}.`,
        actionData: safeStringify({ dataSourceId, snapshotId: snapshot.id }),
      },
    });
    await writeAudit(ds.projectId, "SYNC", "source", dataSourceId, null, { rowCount, contentHash }, user ?? null, `Synced ${ds.name}`);
    return snapshot;
  } catch (e: any) {
    await db.reconDataSource.update({
      where: { id: dataSourceId },
      data: { lastSyncStatus: "error", lastSyncError: e?.message ?? String(e), syncHealth: "degraded" },
    });
    await db.projectNotification.create({
      data: {
        projectId: ds.projectId,
        type: "sync_error",
        severity: "error",
        title: `Lỗi đồng bộ: ${ds.name}`,
        message: e?.message ?? String(e),
        actionData: safeStringify({ dataSourceId }),
      },
    });
    throw e;
  }
}

export async function getSnapshots(dataSourceId: string): Promise<any[]> {
  return db.reconSnapshot.findMany({
    where: { dataSourceId },
    orderBy: { fetchedAt: "desc" },
    take: 50,
  });
}

export async function compareSnapshots(oldId: string, newId: string): Promise<{ added: number; modified: number; deleted: number }> {
  const [oldSnap, newSnap] = await Promise.all([
    db.reconSnapshot.findUnique({ where: { id: oldId } }),
    db.reconSnapshot.findUnique({ where: { id: newId } }),
  ]);
  if (!oldSnap || !newSnap) throw new Error("Snapshot not found");
  return {
    added: Math.max(0, newSnap.rowCount - oldSnap.rowCount),
    deleted: Math.max(0, oldSnap.rowCount - newSnap.rowCount),
    modified: oldSnap.contentHash === newSnap.contentHash ? 0 : Math.min(oldSnap.rowCount, newSnap.rowCount),
  };
}

// ── Run (reuse existing engine) ──────────────────────────────────────────────

// Generate a V2 project run ID: PR-YYYYMMDD-NNN
async function generateProjectRunId(): Promise<string> {
  const today = new Date();
  const ymd =
    today.getFullYear().toString() +
    String(today.getMonth() + 1).padStart(2, "0") +
    String(today.getDate()).padStart(2, "0");
  const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  // ProjectRun schema uses `startedAt` not `createdAt`.
  const count = await db.projectRun.count({
    where: { startedAt: { gte: startOfDay, lt: endOfDay } },
  });
  const seq = String(count + 1).padStart(3, "0");
  return `PR-${ymd}-${seq}`;
}

export async function runProjectReconciliation(
  projectId: string,
  trigger: "manual" | "auto" | "scheduled" = "manual",
  user?: string
): Promise<{ runId: string; summary: RunSummary }> {
  const projectRow = await db.reconProject.findUnique({ where: { id: projectId } });
  if (!projectRow) throw new Error("Project not found");
  const project = hydrateProject(projectRow);
  const config = projectToConfig(project);

  const startedAt = Date.now();
  // Reuse the engine — writes to reconToolRun/reconToolResult and returns a runId.
  const engineResult = await runReconciliation(config, { id: project.id, name: project.name });
  const legacyRunId = engineResult.runId;
  const summary = engineResult.summary;

  // Create a V2 ProjectRun record.
  const projectRunId = await generateProjectRunId();
  const projectRun = await db.projectRun.create({
    data: {
      runId: projectRunId,
      projectId,
      sourceSnapshotId: null,
      targetSnapshotId: null,
      trigger,
      triggeredBy: user ?? null,
      totalLines: summary.totalLines,
      matchedOk: summary.statusCounts.MATCHED_OK ?? 0,
      partial: summary.statusCounts.PARTIAL ?? 0,
      over: summary.statusCounts.OVER ?? 0,
      missingOut: summary.statusCounts.MISSING_OUT ?? 0,
      orphan: summary.statusCounts.ORPHAN ?? 0,
      dup: summary.statusCounts.DUP ?? 0,
      attrMismatch: summary.statusCounts.ATTR_MISMATCH ?? 0,
      fmtFixed: summary.statusCounts.FMT_FIXED ?? 0,
      suspectPo: summary.statusCounts.SUSPECT_PO ?? 0,
      sourceTotalQty: summary.sourceTotalQty,
      targetTotalQty: summary.targetTotalQty,
      totalDifference: summary.totalDifference,
      matchPercent: summary.matchPercentage,
      status: "completed",
      duration: summary.durationMs,
      startedAt: new Date(startedAt),
      completedAt: new Date(),
    },
  });

  // Copy results from reconToolResult → ProjectResultRow.
  // We persist sourceData + targetData + status so the V2 surface can be
  // queried independently. Diagnostic is generated lazily on F11 drill-down.
  const legacyRows = await db.reconToolResult.findMany({
    where: { runId: legacyRunId },
    orderBy: [{ status: "asc" }, { key: "asc" }],
  });
  const CHUNK_SIZE = 500;
  for (let i = 0; i < legacyRows.length; i += CHUNK_SIZE) {
    const chunk = legacyRows.slice(i, i + CHUNK_SIZE);
    const payload = chunk.map((r) => ({
      runId: projectRunId,
      projectId,
      key: r.key,
      sourceData: r.sourceData,
      targetData: r.targetData,
      sourceQty: r.sourceQty,
      targetQty: r.targetQty,
      difference: r.difference,
      statusCode: r.status,
      diagnostic: "{}",
    }));
    await db.projectResultRow.createMany({ data: payload as any });
  }

  // Update ReconProject mini-KPI cache.
  const totalLines = summary.totalLines;
  const matched = (summary.statusCounts.MATCHED_OK ?? 0) + (summary.statusCounts.FMT_FIXED ?? 0);
  const mismatch =
    (summary.statusCounts.PARTIAL ?? 0) +
    (summary.statusCounts.OVER ?? 0) +
    (summary.statusCounts.DUP ?? 0) +
    (summary.statusCounts.ATTR_MISMATCH ?? 0);
  const missing = summary.statusCounts.MISSING_OUT ?? 0;
  const orphan = summary.statusCounts.ORPHAN ?? 0;
  await db.reconProject.update({
    where: { id: projectId },
    data: {
      lastRunId: projectRunId,
      lastRunAt: new Date(),
      lastMatchPercent: summary.matchPercentage,
      lastTotalLines: totalLines,
      lastMatched: matched,
      lastMismatch: mismatch,
      lastMissing: missing,
      lastOrphan: orphan,
    },
  });

  // Notification + audit.
  await db.projectNotification.create({
    data: {
      projectId,
      type: "run_completed",
      severity: summary.matchPercentage >= 95 ? "success" : summary.matchPercentage >= 80 ? "warning" : "error",
      title: `Đối soát xong: ${project.name}`,
      message: `Run ${projectRunId} hoàn tất. Match ${summary.matchPercentage}% (${matched}/${totalLines}). Chênh lệch: ${summary.totalDifference} đôi.`,
      actionData: safeStringify({ runId: projectRunId }),
    },
  });
  await writeAudit(projectId, "RUN", "run", projectRunId, null, { runId: projectRunId, legacyRunId, summary }, user ?? null, `Run triggered (${trigger})`);

  return {
    runId: projectRunId,
    projectId,
    totalLines,
    matchedOk: summary.statusCounts.MATCHED_OK ?? 0,
    partial: summary.statusCounts.PARTIAL ?? 0,
    over: summary.statusCounts.OVER ?? 0,
    missingOut: summary.statusCounts.MISSING_OUT ?? 0,
    orphan: summary.statusCounts.ORPHAN ?? 0,
    dup: summary.statusCounts.DUP ?? 0,
    attrMismatch: summary.statusCounts.ATTR_MISMATCH ?? 0,
    fmtFixed: summary.statusCounts.FMT_FIXED ?? 0,
    suspectPo: summary.statusCounts.SUSPECT_PO ?? 0,
    sourceTotalQty: summary.sourceTotalQty,
    targetTotalQty: summary.targetTotalQty,
    totalDifference: summary.totalDifference,
    matchPercent: summary.matchPercentage,
    durationMs: summary.durationMs,
    status: "completed",
  };
}

// ── Run history ─────────────────────────────────────────────────────────────

export async function getProjectRuns(projectId: string, limit = 20): Promise<any[]> {
  return db.projectRun.findMany({
    where: { projectId },
    orderBy: { startedAt: "desc" },
    take: limit,
  });
}

// ── Results + diagnostics (F11) ─────────────────────────────────────────────

export interface ResultFilters {
  status?: string;
  page?: number;
  pageSize?: number;
}

export async function getProjectResults(
  runId: string,
  filters?: ResultFilters
): Promise<{ rows: any[]; total: number; summary: RunSummary | null }> {
  const run = await db.projectRun.findUnique({ where: { runId } });
  if (!run) return { rows: [], total: 0, summary: null };

  const where: any = { runId };
  if (filters?.status) where.statusCode = filters.status;
  const total = await db.projectResultRow.count({ where });

  const page = Math.max(1, filters?.page ?? 1);
  const pageSize = Math.min(500, filters?.pageSize ?? 50);
  const skip = (page - 1) * pageSize;

  const dbRows = await db.projectResultRow.findMany({
    where,
    orderBy: [{ statusCode: "asc" }, { key: "asc" }],
    skip,
    take: pageSize,
  });
  const rows = dbRows.map((r) => ({
    id: r.id,
    runId: r.runId,
    projectId: r.projectId,
    key: r.key,
    sourceData: safeParse(r.sourceData, {}),
    targetData: safeParse(r.targetData, {}),
    sourceQty: r.sourceQty,
    targetQty: r.targetQty,
    difference: r.difference,
    statusCode: r.statusCode,
    resolved: r.resolved,
    note: r.note,
    assignedTo: r.assignedTo,
    createdAt: r.createdAt,
  }));

  const summary: RunSummary = {
    runId: run.runId,
    projectId: run.projectId,
    totalLines: run.totalLines,
    matchedOk: run.matchedOk,
    partial: run.partial,
    over: run.over,
    missingOut: run.missingOut,
    orphan: run.orphan,
    dup: run.dup,
    attrMismatch: run.attrMismatch,
    fmtFixed: run.fmtFixed,
    suspectPo: run.suspectPo,
    sourceTotalQty: run.sourceTotalQty,
    targetTotalQty: run.targetTotalQty,
    totalDifference: run.totalDifference,
    matchPercent: run.matchPercent,
    durationMs: run.duration ?? 0,
    status: run.status,
  };

  return { rows, total, summary };
}

export async function getDiagnostic(runId: string, resultId: string): Promise<DiagnosticDetail> {
  const row = await db.projectResultRow.findFirst({
    where: { id: resultId, runId },
  });
  if (!row) throw new Error("Result row not found");
  const run = await db.projectRun.findUnique({ where: { runId } });
  if (!run) throw new Error("Run not found");
  const project = await db.reconProject.findUnique({ where: { id: row.projectId } });
  if (!project) throw new Error("Project not found");

  return generateDiagnostic(
    {
      id: row.id,
      runId: row.runId,
      projectId: row.projectId,
      key: row.key,
      sourceData: safeParse(row.sourceData, {}),
      targetData: safeParse(row.targetData, {}),
      sourceQty: row.sourceQty,
      targetQty: row.targetQty,
      difference: row.difference,
      statusCode: row.statusCode,
      note: row.note ?? null,
      resolved: row.resolved,
      assignedTo: row.assignedTo ?? null,
    },
    {
      project: hydrateProject(project),
      run,
    }
  );
}

// Resolve a result row + optional note (F11 action).
export async function resolveResultRow(
  runId: string,
  resultId: string,
  data: { resolved?: boolean; note?: string; assignedTo?: string },
  user?: string
): Promise<any> {
  const row = await db.projectResultRow.findFirst({ where: { id: resultId, runId } });
  if (!row) throw new Error("Result row not found");
  const patch: any = {};
  if (data.resolved !== undefined) {
    patch.resolved = data.resolved;
    patch.resolvedBy = user ?? null;
    patch.resolvedAt = data.resolved ? new Date() : null;
  }
  if (data.note !== undefined) patch.note = data.note;
  if (data.assignedTo !== undefined) patch.assignedTo = data.assignedTo;
  const updated = await db.projectResultRow.update({ where: { id: resultId }, data: patch });
  await writeAudit(row.projectId, "UPDATE", "result", resultId, { resolved: row.resolved, note: row.note }, patch, user ?? null, `Result ${resultId} updated`);
  return updated;
}

// ── Notifications ────────────────────────────────────────────────────────────

export async function getProjectNotifications(projectId: string, limit = 50): Promise<any[]> {
  return db.projectNotification.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

// ── Audit log ────────────────────────────────────────────────────────────────

export async function getProjectAudit(projectId: string, limit = 100): Promise<any[]> {
  return db.projectAuditLog.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

// ── Seed default project ─────────────────────────────────────────────────────

export const DEFAULT_V2_PROJECT_NAME = "ONYX_FVO_vs_STECH";

export async function ensureDefaultProjectSeeded(): Promise<HydratedProject> {
  const existing = await db.reconProject.findUnique({ where: { name: DEFAULT_V2_PROJECT_NAME } });
  if (existing) {
    const hydrated = hydrateProject(existing);
    await ensureDefaultSources(existing.id, hydrated);
    return hydrated;
  }
  const project = await createProject({
    name: DEFAULT_V2_PROJECT_NAME,
    description: "Default V2 project: ONYX_FVO (orders) ↔ ONYX (Stech outputs). READ-ONLY.",
    tags: ["default", "onyx", "fvo", "stech"],
    sourceConfig: { dataset: "ONYX_FVO", productType: "ONYX_FVO", label: "FVO Orders" },
    targetConfig: { dataset: "ONYX", productType: "ONYX", label: "Stech Outputs" },
    fieldMappings: DEFAULT_RECON_PROFILE.fieldMappings,
    matchKeyFields: DEFAULT_RECON_PROFILE.matchKeys,
    rules: DEFAULT_RECON_PROFILE.sizeTransformRules,
    comparisonConfig: {
      tolerance: DEFAULT_RECON_PROFILE.tolerance,
      mode: DEFAULT_RECON_PROFILE.mode,
      preFilter: DEFAULT_RECON_PROFILE.preFilter,
    },
    statusMapping: DEFAULT_RECON_PROFILE.statusMapping,
    sizeTables: {
      men: DEFAULT_MEN_TABLE.entries,
      women: DEFAULT_WOMEN_TABLE.entries,
    },
    template: false,
  });
  await ensureDefaultSources(project.id, project);
  return project;
}
