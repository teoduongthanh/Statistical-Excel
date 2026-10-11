"use client";

// Reconciliation V2 View — spec F10–F12.
//
// Sections:
//   1. Project Cards (F10) — grid of projects with mini-KPIs + status + last run
//   2. Project Detail — Tabs:
//      - Sources & Sync (F12)  : data source cards + sync button + snapshot history
//      - Mapping   (F2)        : field mapping table (read-only display + edit)
//      - Rules     (F3)        : transformation rules + size tables
//      - Config    (F4)        : match keys, tolerance, mode, pre-filter
//      - Run       (F5)        : execute button + run history
//      - Results   (F5/F11)    : paginated table + status badges + diagnostic modal
//      - Dashboard (F6)        : KPI cards + Recharts donut
//   3. Diagnostic Modal (F11) — opens when clicking a result row.
//
// All config changes auto-save (PATCH) to the project + audit-logged.
// READ-ONLY: never modifies MasterData.

import * as React from "react";
import {
  Layers, Play, RefreshCw, ArrowLeft, Loader2, Download, Database,
  CheckCircle2, AlertTriangle, Bell, FileClock, Activity, Pencil, Plus,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend,
} from "recharts";

// ── Constants ────────────────────────────────────────────────────────────────

const STATUS_META: Record<string, { color: string; label: string; donut: string }> = {
  MATCHED_OK:    { color: "bg-emerald-100 text-emerald-700 border-emerald-300", label: "Matched",    donut: "#10b981" },
  PARTIAL:      { color: "bg-amber-100 text-amber-700 border-amber-300",        label: "Partial",    donut: "#f59e0b" },
  OVER:         { color: "bg-red-100 text-red-700 border-red-300",             label: "Over",       donut: "#ef4444" },
  MISSING_OUT:  { color: "bg-violet-100 text-violet-700 border-violet-300",   label: "Missing Out", donut: "#8b5cf6" },
  ORPHAN:       { color: "bg-pink-100 text-pink-700 border-pink-300",          label: "Orphan",     donut: "#ec4899" },
  DUP:          { color: "bg-yellow-100 text-yellow-700 border-yellow-300",    label: "Duplicate",  donut: "#eab308" },
  ATTR_MISMATCH:{ color: "bg-cyan-100 text-cyan-700 border-cyan-300",          label: "Attr Mismatch", donut: "#06b6d4" },
  FMT_FIXED:    { color: "bg-blue-100 text-blue-700 border-blue-300",          label: "Format Fixed", donut: "#3b82f6" },
  SUSPECT_PO:   { color: "bg-orange-100 text-orange-700 border-orange-300",    label: "Suspect PO", donut: "#f97316" },
};

function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? { color: "bg-muted text-muted-foreground border-border", label: status, donut: "#94a3b8" };
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold", meta.color)}>
      {meta.label}
    </span>
  );
}

function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return "—";
  try {
    const date = typeof d === "string" ? new Date(d) : d;
    return date.toLocaleString("vi-VN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch { return String(d); }
}

function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined) return "0";
  return n.toLocaleString("vi-VN");
}

// ── Main view ────────────────────────────────────────────────────────────────

export function ReconV2View() {
  const [projects, setProjects] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.reconV2ListProjects();
      setProjects(r.projects ?? []);
    } catch (e: any) {
      toast.error(`Không tải được danh sách project: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { refresh(); }, [refresh]);

  if (selectedId) {
    return <ProjectDetail projectId={selectedId} onBack={() => { setSelectedId(null); refresh(); }} />;
  }

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Layers className="h-6 w-6 text-primary" />
            Reconciliation V2
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Project-based reconciliation engine — spec F10–F12 (CRUD, diagnostics, sync).
          </p>
        </div>
        <Button onClick={refresh} variant="outline" size="sm" disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {projects.map((p) => (
          <ProjectCard key={p.id} project={p} onOpen={() => setSelectedId(p.id)} />
        ))}
        {projects.length === 0 && !loading && (
          <Card className="col-span-full">
            <CardContent className="p-8 text-center text-muted-foreground">
              Chưa có project nào. Hệ thống sẽ tự seed project mặc định khi gọi /api/recon-v2/projects.
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

// ── Project Card ────────────────────────────────────────────────────────────

function ProjectCard({ project, onOpen }: { project: any; onOpen: () => void }) {
  const matchPct = project.lastMatchPercent ?? 0;
  const accent = matchPct >= 95 ? "border-emerald-300" : matchPct >= 80 ? "border-amber-300" : "border-red-300";
  const statusColor =
    project.status === "archived" ? "bg-gray-100 text-gray-700" :
    project.status === "template" ? "bg-blue-100 text-blue-700" :
    "bg-emerald-100 text-emerald-700";
  return (
    <Card className={cn("hover:shadow-md transition-shadow cursor-pointer border-2", accent)} onClick={onOpen}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <CardTitle className="text-base truncate">{project.name}</CardTitle>
            <p className="text-[11px] text-muted-foreground line-clamp-2 mt-1">{project.description ?? "—"}</p>
          </div>
          <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold", statusColor)}>
            {project.status}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-1">
          {(project.tags ?? []).map((t: string) => (
            <Badge key={t} variant="outline" className="text-[10px]">{t}</Badge>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <div className="rounded-md bg-muted/40 p-2">
            <div className="text-muted-foreground">Source</div>
            <div className="font-semibold truncate">{project.sourceConfig?.dataset ?? "—"}</div>
          </div>
          <div className="rounded-md bg-muted/40 p-2">
            <div className="text-muted-foreground">Target</div>
            <div className="font-semibold truncate">{project.targetConfig?.dataset ?? "—"}</div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
          <div>
            <div className="font-bold text-base">{fmtNum(project.lastTotalLines)}</div>
            <div className="text-muted-foreground">Total</div>
          </div>
          <div>
            <div className="font-bold text-base text-emerald-600">{fmtNum(project.lastMatched)}</div>
            <div className="text-muted-foreground">Matched</div>
          </div>
          <div>
            <div className={cn("font-bold text-base", matchPct >= 95 ? "text-emerald-600" : matchPct >= 80 ? "text-amber-600" : "text-red-600")}>{matchPct.toFixed(1)}%</div>
            <div className="text-muted-foreground">Match %</div>
          </div>
        </div>
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>Last run: {project.lastRunId ?? "—"}</span>
          <span>{fmtDate(project.lastRunAt)}</span>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Project Detail ──────────────────────────────────────────────────────────

function ProjectDetail({ projectId, onBack }: { projectId: string; onBack: () => void }) {
  const [project, setProject] = React.useState<any>(null);
  const [sources, setSources] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [tab, setTab] = React.useState("sources");

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.reconV2GetProject(projectId);
      setProject(r.project);
      setSources(r.sources ?? []);
    } catch (e: any) {
      toast.error(`Không tải được project: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  React.useEffect(() => { refresh(); }, [refresh]);

  if (loading || !project) {
    return (
      <div className="container mx-auto p-6 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold truncate">{project.name}</h1>
          <p className="text-xs text-muted-foreground line-clamp-1">{project.description}</p>
        </div>
        <a href={api.reconV2ExportUrl(projectId, project.lastRunId ?? undefined, "xlsx")} target="_blank" rel="noreferrer">
          <Button variant="outline" size="sm">
            <Download className="h-4 w-4" /> Export
          </Button>
        </a>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="sources">Sources & Sync</TabsTrigger>
          <TabsTrigger value="mapping">Mapping</TabsTrigger>
          <TabsTrigger value="rules">Rules</TabsTrigger>
          <TabsTrigger value="config">Config</TabsTrigger>
          <TabsTrigger value="run">Run</TabsTrigger>
          <TabsTrigger value="results">Results</TabsTrigger>
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
        </TabsList>

        <TabsContent value="sources" className="mt-4">
          <SourcesTab projectId={projectId} sources={sources} onChange={refresh} />
        </TabsContent>
        <TabsContent value="mapping" className="mt-4">
          <MappingTab projectId={projectId} project={project} onChange={refresh} />
        </TabsContent>
        <TabsContent value="rules" className="mt-4">
          <RulesTab projectId={projectId} project={project} onChange={refresh} />
        </TabsContent>
        <TabsContent value="config" className="mt-4">
          <ConfigTab projectId={projectId} project={project} onChange={refresh} />
        </TabsContent>
        <TabsContent value="run" className="mt-4">
          <RunTab projectId={projectId} project={project} onChange={refresh} />
        </TabsContent>
        <TabsContent value="results" className="mt-4">
          <ResultsTab projectId={projectId} project={project} onChange={refresh} />
        </TabsContent>
        <TabsContent value="dashboard" className="mt-4">
          <DashboardTab projectId={projectId} project={project} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── Sources & Sync Tab (F12) ────────────────────────────────────────────────

function SourcesTab({ projectId, sources, onChange }: { projectId: string; sources: any[]; onChange: () => void }) {
  const [syncing, setSyncing] = React.useState<string | null>(null);
  const [snapshots, setSnapshots] = React.useState<any[]>([]);
  const [selectedSource, setSelectedSource] = React.useState<string>("");

  const loadSnapshots = React.useCallback(async () => {
    try {
      const r = await api.reconV2ListSnapshots(projectId, selectedSource || undefined);
      setSnapshots(r.snapshots ?? []);
    } catch { setSnapshots([]); }
  }, [projectId, selectedSource]);

  React.useEffect(() => { loadSnapshots(); }, [loadSnapshots]);

  const onSync = async (sourceId: string) => {
    setSyncing(sourceId);
    try {
      const r = await api.reconV2SyncSource(projectId, sourceId);
      toast.success(`Đồng bộ xong: ${fmtNum(r.snapshot.rowCount)} dòng.`);
      onChange();
      loadSnapshots();
    } catch (e: any) {
      toast.error(`Lỗi đồng bộ: ${e.message}`);
    } finally {
      setSyncing(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {sources.map((s) => {
          const health =
            s.syncHealth === "healthy" ? "bg-emerald-500" :
            s.syncHealth === "degraded" ? "bg-amber-500" :
            s.syncHealth === "offline" ? "bg-red-500" :
            "bg-gray-400";
          return (
            <Card key={s.id}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Database className="h-4 w-4" />
                      {s.name}
                    </CardTitle>
                    <p className="text-[11px] text-muted-foreground mt-1">dataset: <code>{s.dataset}</code> · type: {s.type}</p>
                  </div>
                  <span className={cn("h-2 w-2 rounded-full", health)} title={`Sync health: ${s.syncHealth}`} />
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div>
                    <div className="text-muted-foreground">Last sync</div>
                    <div className="font-medium">{fmtDate(s.lastSyncedAt)}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Status</div>
                    <div className="font-medium">{s.lastSyncStatus}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Snapshots</div>
                    <div className="font-medium">{s.snapshotCount}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Schedule</div>
                    <div className="font-medium">{s.syncSchedule}</div>
                  </div>
                </div>
                {s.lastSyncError && (
                  <div className="text-[11px] text-red-600 bg-red-50 p-2 rounded">{s.lastSyncError}</div>
                )}
                <Button size="sm" className="w-full" onClick={() => onSync(s.id)} disabled={syncing === s.id}>
                  {syncing === s.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  Sync now
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <FileClock className="h-4 w-4" /> Snapshot history
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 mb-3">
            <Label className="text-xs">Filter by source:</Label>
            <Select value={selectedSource || "__all__"} onValueChange={(v: string) => setSelectedSource(v === "__all__" ? "" : v)}>
              <SelectTrigger className="h-8 w-64 text-xs"><SelectValue placeholder="All sources" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All sources</SelectItem>
                {sources.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={loadSnapshots}><RefreshCw className="h-3 w-3" /></Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/40">
                <tr>
                  <th className="text-left p-2">Source</th>
                  <th className="text-left p-2">Fetched at</th>
                  <th className="text-right p-2">Rows</th>
                  <th className="text-right p-2">Added</th>
                  <th className="text-right p-2">Modified</th>
                  <th className="text-right p-2">Deleted</th>
                  <th className="text-left p-2">Hash</th>
                  <th className="text-left p-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {snapshots.length === 0 && (
                  <tr><td colSpan={8} className="p-4 text-center text-muted-foreground">Chưa có snapshot nào. Bấm "Sync now" để tạo.</td></tr>
                )}
                {snapshots.map((s) => (
                  <tr key={s.id} className="border-b">
                    <td className="p-2">{s.dataSourceName ?? "—"}</td>
                    <td className="p-2">{fmtDate(s.fetchedAt)}</td>
                    <td className="p-2 text-right">{fmtNum(s.rowCount)}</td>
                    <td className="p-2 text-right text-emerald-600">+{s.changesAdded}</td>
                    <td className="p-2 text-right text-amber-600">~{s.changesModified}</td>
                    <td className="p-2 text-right text-red-600">-{s.changesDeleted}</td>
                    <td className="p-2 font-mono text-[10px] text-muted-foreground">{(s.contentHash ?? "").slice(0, 10)}</td>
                    <td className="p-2">{s.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Mapping Tab (F2) ────────────────────────────────────────────────────────

function MappingTab({ projectId, project, onChange }: { projectId: string; project: any; onChange: () => void }) {
  const [mappings, setMappings] = React.useState<any[]>(project.fieldMappings ?? []);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => { setMappings(project.fieldMappings ?? []); }, [project.fieldMappings]);

  const save = async () => {
    setSaving(true);
    try {
      await api.reconV2UpdateProject(projectId, { fieldMappings: mappings });
      toast.success("Đã lưu mapping (auto-save).");
      onChange();
    } catch (e: any) {
      toast.error(`Lỗi lưu: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const update = (idx: number, field: string, value: any) => {
    setMappings((prev) => prev.map((m, i) => i === idx ? { ...m, [field]: value } : m));
  };

  const FIELD_OPTIONS = ["poNo", "factoryPO", "size", "model", "sku", "colorCode", "colorCode2", "season", "item", "qty1", "qty2", "deadline", "date", "shippingStatus"];
  const ROLES = ["PRIMARY_KEY", "SECONDARY_KEY", "ATTRIBUTE", "QUANTITY", "DATE", "FILTER"];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <ArrowLeft /> Field Mapping (F2)
          <Button size="sm" className="ml-auto" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Save mapping
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {mappings.map((m, i) => (
            <div key={i} className="grid grid-cols-1 md:grid-cols-5 gap-2 items-center p-2 rounded-md bg-muted/30">
              <div>
                <Label className="text-[10px]">Source field</Label>
                <Select value={m.sourceField} onValueChange={(v) => update(i, "sourceField", v)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{FIELD_OPTIONS.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[10px]">Target field</Label>
                <Select value={m.targetField} onValueChange={(v) => update(i, "targetField", v)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{FIELD_OPTIONS.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[10px]">Role</Label>
                <Select value={m.role} onValueChange={(v) => update(i, "role", v)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[10px]">Transform rule</Label>
                <Input
                  className="h-8 text-xs"
                  value={m.transformRule ?? ""}
                  onChange={(e) => update(i, "transformRule", e.target.value)}
                  placeholder="size_normalize"
                />
              </div>
              <Button
                variant="ghost" size="sm"
                onClick={() => setMappings((prev) => prev.filter((_, j) => j !== i))}
              >
                Remove
              </Button>
            </div>
          ))}
          <Button
            variant="outline" size="sm"
            onClick={() => setMappings((prev) => [...prev, { sourceField: "poNo", targetField: "factoryPO", role: "PRIMARY_KEY" }])}
          >
            <Plus className="h-4 w-4" /> Add mapping
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Rules Tab (F3) ──────────────────────────────────────────────────────────

function RulesTab({ projectId, project, onChange }: { projectId: string; project: any; onChange: () => void }) {
  const [rules, setRules] = React.useState<any[]>(project.rules ?? []);
  const [menTable, setMenTable] = React.useState<Record<string, string>>(project.sizeTables?.men ?? {});
  const [womenTable, setWomenTable] = React.useState<Record<string, string>>(project.sizeTables?.women ?? {});
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    setRules(project.rules ?? []);
    setMenTable(project.sizeTables?.men ?? {});
    setWomenTable(project.sizeTables?.women ?? {});
  }, [project.rules, project.sizeTables]);

  const save = async () => {
    setSaving(true);
    try {
      await api.reconV2UpdateProject(projectId, { rules, sizeTables: { men: menTable, women: womenTable } });
      toast.success("Đã lưu rules + size tables.");
      onChange();
    } catch (e: any) {
      toast.error(`Lỗi lưu: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const updateRule = (idx: number, field: string, value: any) => {
    setRules((prev) => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            Transformation Rules (F3)
            <Button size="sm" className="ml-auto" onClick={save} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Save
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {rules.map((r, i) => (
              <div key={r.id ?? i} className="grid grid-cols-1 md:grid-cols-6 gap-2 items-center p-2 rounded-md bg-muted/30">
                <Input className="h-8 text-xs" placeholder="id" value={r.id ?? ""} onChange={(e) => updateRule(i, "id", e.target.value)} />
                <Input className="h-8 text-xs" placeholder="name" value={r.name ?? ""} onChange={(e) => updateRule(i, "name", e.target.value)} />
                <Select value={r.type ?? "if_then"} onValueChange={(v) => updateRule(i, "type", v)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="if_then">if_then</SelectItem>
                    <SelectItem value="regex_extract">regex_extract</SelectItem>
                    <SelectItem value="lookup">lookup</SelectItem>
                    <SelectItem value="formula">formula</SelectItem>
                  </SelectContent>
                </Select>
                <Input className="h-8 text-xs" placeholder="condition (gender==M)" value={r.condition ?? ""} onChange={(e) => updateRule(i, "condition", e.target.value)} />
                <Select value={r.tableId ?? "__none__"} onValueChange={(v: string) => updateRule(i, "tableId", v === "__none__" ? undefined : v)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="table" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">—</SelectItem>
                    <SelectItem value="men">men</SelectItem>
                    <SelectItem value="women">women</SelectItem>
                  </SelectContent>
                </Select>
                <div className="flex items-center gap-2">
                  <Checkbox checked={!!r.enabled} onCheckedChange={(v) => updateRule(i, "enabled", !!v)} />
                  <Button variant="ghost" size="sm" onClick={() => setRules((prev) => prev.filter((_, j) => j !== i))}>Remove</Button>
                </div>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => setRules((prev) => [...prev, { id: `rule-${Date.now()}`, name: "New rule", type: "if_then", enabled: true }])}>
              <Plus className="h-4 w-4" /> Add rule
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-sm">Men size table</CardTitle></CardHeader>
          <CardContent>
            <SizeTableEditor table={menTable} onChange={setMenTable} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Women size table</CardTitle></CardHeader>
          <CardContent>
            <SizeTableEditor table={womenTable} onChange={setWomenTable} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SizeTableEditor({ table, onChange }: { table: Record<string, string>; onChange: (t: Record<string, string>) => void }) {
  const [newKey, setNewKey] = React.useState("");
  const [newVal, setNewVal] = React.useState("");
  return (
    <div className="space-y-2">
      <div className="max-h-64 overflow-y-auto space-y-1">
        {Object.entries(table).map(([k, v]) => (
          <div key={k} className="grid grid-cols-3 gap-1 items-center">
            <code className="text-xs px-1">{k}</code>
            <Input className="h-7 text-xs" value={v} onChange={(e) => onChange({ ...table, [k]: e.target.value })} />
            <Button variant="ghost" size="sm" onClick={() => { const n = { ...table }; delete n[k]; onChange(n); }}>✕</Button>
          </div>
        ))}
        {Object.keys(table).length === 0 && <div className="text-xs text-muted-foreground p-2">Table trống.</div>}
      </div>
      <div className="grid grid-cols-3 gap-1 items-center pt-2 border-t">
        <Input className="h-7 text-xs" placeholder="raw (M07)" value={newKey} onChange={(e) => setNewKey(e.target.value)} />
        <Input className="h-7 text-xs" placeholder="canonical (7)" value={newVal} onChange={(e) => setNewVal(e.target.value)} />
        <Button size="sm" variant="outline" onClick={() => { if (newKey) { onChange({ ...table, [newKey.toUpperCase()]: newVal }); setNewKey(""); setNewVal(""); } }}>
          <Plus className="h-3 w-3" /> Add
        </Button>
      </div>
    </div>
  );
}

// ── Config Tab (F4) ─────────────────────────────────────────────────────────

function ConfigTab({ projectId, project, onChange }: { projectId: string; project: any; onChange: () => void }) {
  const [matchKeys, setMatchKeys] = React.useState<string[]>(project.matchKeyFields ?? []);
  const [tolType, setTolType] = React.useState<string>(project.comparisonConfig?.tolerance?.type ?? "absolute");
  const [tolValue, setTolValue] = React.useState<number>(project.comparisonConfig?.tolerance?.value ?? 0);
  const [mode, setMode] = React.useState<string>(project.comparisonConfig?.mode ?? "aggregate");
  const [preFilterStatus, setPreFilterStatus] = React.useState<string>(project.comparisonConfig?.preFilter?.shippingStatus ?? "1.Order");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    setMatchKeys(project.matchKeyFields ?? []);
    setTolType(project.comparisonConfig?.tolerance?.type ?? "absolute");
    setTolValue(project.comparisonConfig?.tolerance?.value ?? 0);
    setMode(project.comparisonConfig?.mode ?? "aggregate");
    setPreFilterStatus(project.comparisonConfig?.preFilter?.shippingStatus ?? "1.Order");
  }, [project]);

  const save = async () => {
    setSaving(true);
    try {
      await api.reconV2UpdateProject(projectId, {
        matchKeyFields: matchKeys,
        comparisonConfig: {
          tolerance: { type: tolType as any, value: tolValue },
          mode: mode as any,
          preFilter: { shippingStatus: preFilterStatus },
        },
      });
      toast.success("Đã lưu config.");
      onChange();
    } catch (e: any) {
      toast.error(`Lỗi lưu: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const KEY_OPTS = ["poNo", "factoryPO", "size", "model", "colorCode"];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          Comparison Config (F4)
          <Button size="sm" className="ml-auto" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Save
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label className="text-xs font-semibold">Match key fields</Label>
          <div className="flex flex-wrap gap-2 mt-1">
            {KEY_OPTS.map((k) => (
              <label key={k} className="flex items-center gap-1 text-xs">
                <Checkbox
                  checked={matchKeys.includes(k)}
                  onCheckedChange={(v) => {
                    if (v) setMatchKeys((prev) => [...prev, k]);
                    else setMatchKeys((prev) => prev.filter((x) => x !== k));
                  }}
                />
                <code>{k}</code>
              </label>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <Label className="text-xs">Tolerance type</Label>
            <Select value={tolType} onValueChange={setTolType}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="absolute">absolute</SelectItem>
                <SelectItem value="percentage">percentage</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Tolerance value</Label>
            <Input type="number" className="h-8" value={tolValue} onChange={(e) => setTolValue(Number(e.target.value))} />
          </div>
          <div>
            <Label className="text-xs">Mode</Label>
            <Select value={mode} onValueChange={setMode}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="aggregate">aggregate</SelectItem>
                <SelectItem value="row_to_row">row_to_row</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <Label className="text-xs">Pre-filter shippingStatus</Label>
          <Input className="h-8" value={preFilterStatus} onChange={(e) => setPreFilterStatus(e.target.value)} placeholder="1.Order" />
        </div>
      </CardContent>
    </Card>
  );
}

// ── Run Tab (F5) ────────────────────────────────────────────────────────────

function RunTab({ projectId, project, onChange }: { projectId: string; project: any; onChange: () => void }) {
  const [running, setRunning] = React.useState(false);
  const [runs, setRuns] = React.useState<any[]>([]);

  const loadRuns = React.useCallback(async () => {
    try {
      const r = await api.reconV2ListRuns(projectId);
      setRuns(r.runs ?? []);
    } catch { setRuns([]); }
  }, [projectId]);

  React.useEffect(() => { loadRuns(); }, [loadRuns]);

  const onRun = async () => {
    setRunning(true);
    try {
      const r = await api.reconV2Run(projectId, { trigger: "manual" });
      toast.success(`Run ${r.runId} hoàn tất. Match ${r.summary.matchPercent}%.`);
      onChange();
      loadRuns();
    } catch (e: any) {
      toast.error(`Run thất bại: ${e.message}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Play className="h-4 w-4" /> Execute reconciliation
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="text-xs text-muted-foreground">
            Sẽ tái sử dụng engine (F1–F9): load MasterData → normalize → aggregate → classify → persist V2 ProjectRun + ProjectResultRow.
            READ-ONLY — không ghi MasterData.
          </div>
          <Button onClick={onRun} disabled={running}>
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {running ? "Đang chạy..." : "Run now"}
          </Button>
          {project.lastRunId && (
            <div className="text-xs">
              Last run: <code className="font-mono">{project.lastRunId}</code> · {fmtDate(project.lastRunAt)} · Match {project.lastMatchPercent ?? 0}%
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <FileClock className="h-4 w-4" /> Run history
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/40">
                <tr>
                  <th className="text-left p-2">Run ID</th>
                  <th className="text-left p-2">Trigger</th>
                  <th className="text-left p-2">Started</th>
                  <th className="text-left p-2">Status</th>
                  <th className="text-right p-2">Lines</th>
                  <th className="text-right p-2">Matched</th>
                  <th className="text-right p-2">Diff</th>
                  <th className="text-right p-2">Match %</th>
                  <th className="text-right p-2">Duration</th>
                </tr>
              </thead>
              <tbody>
                {runs.length === 0 && (
                  <tr><td colSpan={9} className="p-4 text-center text-muted-foreground">Chưa có run nào.</td></tr>
                )}
                {runs.map((r) => (
                  <tr key={r.id} className="border-b">
                    <td className="p-2 font-mono">{r.runId}</td>
                    <td className="p-2">{r.trigger}</td>
                    <td className="p-2">{fmtDate(r.startedAt)}</td>
                    <td className="p-2">
                      <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold",
                        r.status === "completed" ? "bg-emerald-100 text-emerald-700" :
                        r.status === "failed" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700")}>
                        {r.status}
                      </span>
                    </td>
                    <td className="p-2 text-right">{fmtNum(r.totalLines)}</td>
                    <td className="p-2 text-right text-emerald-600">{fmtNum(r.matchedOk + r.fmtFixed)}</td>
                    <td className="p-2 text-right">{fmtNum(r.totalDifference)}</td>
                    <td className="p-2 text-right">{(r.matchPercent ?? 0).toFixed(1)}%</td>
                    <td className="p-2 text-right">{((r.duration ?? 0) / 1000).toFixed(1)}s</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Results Tab (F5/F11) ─────────────────────────────────────────────────────

function ResultsTab({ projectId, project, onChange }: { projectId: string; project: any; onChange: () => void }) {
  const [runId, setRunId] = React.useState<string>(project.lastRunId ?? "");
  const [status, setStatus] = React.useState<string>("");
  const [page, setPage] = React.useState(1);
  const [pageSize] = React.useState(10);
  const [data, setData] = React.useState<{ rows: any[]; total: number; summary: any; totalPages: number } | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [diagRow, setDiagRow] = React.useState<any | null>(null);

  const load = React.useCallback(async () => {
    if (!runId) {
      toast.info("Chưa có run nào. Hãy sang tab Run để chạy đối soát.");
      return;
    }
    setLoading(true);
    try {
      const r = await api.reconV2GetResults(projectId, { runId, status: status || undefined, page, pageSize });
      setData({ rows: r.rows, total: r.total, summary: r.summary, totalPages: r.totalPages });
    } catch (e: any) {
      toast.error(`Lỗi load results: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, [projectId, runId, status, page, pageSize]);

  React.useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Filters</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div>
            <Label className="text-xs">Run ID</Label>
            <Input className="h-8 w-48 text-xs" value={runId} onChange={(e) => setRunId(e.target.value)} placeholder="PR-YYYYMMDD-NNN" />
          </div>
          <div>
            <Label className="text-xs">Status filter</Label>
            <Select value={status} onValueChange={(v) => { setStatus(v === "__all" ? "" : v); setPage(1); }}>
              <SelectTrigger className="h-8 w-44 text-xs"><SelectValue placeholder="All statuses" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All statuses</SelectItem>
                {Object.keys(STATUS_META).map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button size="sm" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Refresh
          </Button>
          {data?.summary && (
            <div className="ml-auto text-xs text-muted-foreground">
              Total: <b>{fmtNum(data.total)}</b> · Matched: <b className="text-emerald-600">{fmtNum((data.summary.matchedOk ?? 0) + (data.summary.fmtFixed ?? 0))}</b> · Diff: <b>{fmtNum(data.summary.totalDifference)}</b>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/40">
                <tr>
                  <th className="text-left p-2">Status</th>
                  <th className="text-left p-2">Key</th>
                  <th className="text-left p-2">Source PO</th>
                  <th className="text-left p-2">Source FPO</th>
                  <th className="text-left p-2">Size</th>
                  <th className="text-right p-2">Src Qty</th>
                  <th className="text-right p-2">Tgt Qty</th>
                  <th className="text-right p-2">Diff</th>
                  <th className="text-left p-2">Resolved</th>
                  <th className="text-left p-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {!data || data.rows.length === 0 ? (
                  <tr><td colSpan={10} className="p-4 text-center text-muted-foreground">
                    {loading ? "Đang tải..." : "Không có dòng nào."}
                  </td></tr>
                ) : data.rows.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b hover:bg-muted/30 cursor-pointer"
                    onClick={() => setDiagRow(r)}
                  >
                    <td className="p-2"><StatusBadge status={r.statusCode} /></td>
                    <td className="p-2 font-mono text-[10px] truncate max-w-[200px]" title={r.key}>{r.key}</td>
                    <td className="p-2">{r.sourceData?.poNo ?? "—"}</td>
                    <td className="p-2">{r.sourceData?.factoryPO ?? r.targetData?.factoryPO ?? "—"}</td>
                    <td className="p-2">{r.sourceData?.size ?? r.targetData?.size ?? "—"}</td>
                    <td className="p-2 text-right">{fmtNum(r.sourceQty)}</td>
                    <td className="p-2 text-right">{fmtNum(r.targetQty)}</td>
                    <td className={cn("p-2 text-right font-semibold", r.difference > 0 ? "text-amber-600" : r.difference < 0 ? "text-red-600" : "text-emerald-600")}>{fmtNum(r.difference)}</td>
                    <td className="p-2">{r.resolved ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : "—"}</td>
                    <td className="p-2">
                      <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setDiagRow(r); }}>
                        Diagnose
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data && (
            <div className="flex items-center justify-between gap-2 p-3 text-xs">
              <span>Page {page} / {data.totalPages} · Total {fmtNum(data.total)} rows</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))}>Prev</Button>
                <Button size="sm" variant="outline" disabled={page >= data.totalPages || loading} onClick={() => setPage((p) => p + 1)}>Next</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {diagRow && (
        <DiagnosticModal
          projectId={projectId}
          runId={runId}
          row={diagRow}
          onClose={() => setDiagRow(null)}
          onResolved={() => { setDiagRow(null); load(); onChange(); }}
        />
      )}
    </div>
  );
}

// ── Diagnostic Modal (F11) ───────────────────────────────────────────────────

function DiagnosticModal({ projectId, runId, row, onClose, onResolved }: {
  projectId: string;
  runId: string;
  row: any;
  onClose: () => void;
  onResolved: () => void;
}) {
  const [diag, setDiag] = React.useState<any>(null);
  const [loading, setLoading] = React.useState(true);
  const [note, setNote] = React.useState(row.note ?? "");
  const [assignedTo, setAssignedTo] = React.useState(row.assignedTo ?? "");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const r = await api.reconV2GetDiagnostic(projectId, row.id, runId);
        if (!cancelled) setDiag(r.diagnostic);
      } catch (e: any) {
        toast.error(`Lỗi load diagnostic: ${e.message}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [projectId, row.id, runId]);

  const resolve = async (resolved: boolean) => {
    setSaving(true);
    try {
      await api.reconV2ResolveRow(projectId, row.id, { resolved, note, assignedTo }, runId);
      toast.success(resolved ? "Đã đánh dấu đã xử lý." : "Đã bỏ đánh dấu.");
      onResolved();
    } catch (e: any) {
      toast.error(`Lỗi: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const sideBySide = diag?.sideBySide;
  const fields = sideBySide ? Object.keys(sideBySide.source) : [];

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            Diagnostic — F11 drill-down
            <StatusBadge status={row.statusCode} />
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span className="ml-2 text-sm text-muted-foreground">Đang sinh diagnostic...</span>
          </div>
        ) : diag ? (
          <div className="space-y-4">
            {/* Side-by-side */}
            <Card>
              <CardHeader><CardTitle className="text-sm">1. So sánh chi tiết (side-by-side)</CardTitle></CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="font-semibold text-muted-foreground">Field</div>
                  <div className="font-semibold text-muted-foreground">Source (A)</div>
                  <div className="font-semibold text-muted-foreground">Target (B)</div>
                  {fields.map((f) => (
                    <React.Fragment key={f}>
                      <div className="font-mono text-[10px]">{f}</div>
                      <div className={cn("px-2 py-0.5 rounded", sideBySide.keyMatches[f] ? "bg-emerald-50" : "bg-amber-50")}>
                        {String(sideBySide.source[f] ?? "—")}
                      </div>
                      <div className={cn("px-2 py-0.5 rounded", sideBySide.keyMatches[f] ? "bg-emerald-50" : "bg-amber-50")}>
                        {String(sideBySide.target[f] ?? "—")}
                      </div>
                    </React.Fragment>
                  ))}
                  <div className="font-mono text-[10px]">qty (compare)</div>
                  <div className="px-2 py-0.5 rounded bg-muted/40">{fmtNum(row.sourceQty)}</div>
                  <div className={cn("px-2 py-0.5 rounded", sideBySide.keyMatches.__qtyEqual ? "bg-emerald-50" : "bg-amber-50")}>{fmtNum(row.targetQty)}</div>
                </div>
              </CardContent>
            </Card>

            {/* Match trace */}
            <Card>
              <CardHeader><CardTitle className="text-sm">2. Match trace (Vietnamese, step-by-step)</CardTitle></CardHeader>
              <CardContent>
                <ol className="space-y-1 text-xs list-decimal list-inside">
                  {diag.matchTrace.map((s: string, i: number) => (
                    <li key={i} className="text-foreground/90">{s}</li>
                  ))}
                </ol>
              </CardContent>
            </Card>

            {/* Cause suggestions */}
            <Card>
              <CardHeader><CardTitle className="text-sm">3. Cause suggestions (with confidence)</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {diag.causeSuggestions.map((c: any, i: number) => (
                    <div key={i} className="p-2 rounded-md bg-muted/30">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm">{c.cause}</span>
                        <Badge variant="outline" className={cn("text-[10px]",
                          c.confidence >= 75 ? "text-emerald-700 border-emerald-300" :
                          c.confidence >= 50 ? "text-amber-700 border-amber-300" :
                          "text-muted-foreground")}>
                          {c.confidence}%
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{c.evidence}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Similar cases */}
            <Card>
              <CardHeader><CardTitle className="text-sm">4. Similar cases ({diag.similarCases.length})</CardTitle></CardHeader>
              <CardContent>
                {diag.similarCases.length === 0 ? (
                  <div className="text-xs text-muted-foreground">Không có case tương tự.</div>
                ) : (
                  <div className="space-y-1">
                    {diag.similarCases.map((c: any) => (
                      <div key={c.resultId} className="text-xs flex items-center gap-2">
                        <StatusBadge status={c.statusCode} />
                        <code className="text-[10px]">{c.key}</code>
                        <span className="text-muted-foreground font-mono text-[10px]">{c.resultId}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Actions */}
            <Card>
              <CardHeader><CardTitle className="text-sm">5. Hành động gợi ý + Resolve</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <ul className="text-xs list-disc list-inside space-y-1">
                  {diag.resolutionActions.map((a: string, i: number) => <li key={i}>{a}</li>)}
                </ul>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-2 border-t">
                  <div>
                    <Label className="text-xs">Note</Label>
                    <Textarea className="text-xs" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
                  </div>
                  <div>
                    <Label className="text-xs">Assign to</Label>
                    <Input className="h-8 text-xs" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} placeholder="planner@..." />
                  </div>
                </div>
                <div className="flex gap-2 pt-2">
                  <Button size="sm" onClick={() => resolve(true)} disabled={saving || row.resolved}>
                    <CheckCircle2 className="h-4 w-4" /> Mark resolved
                  </Button>
                  {row.resolved && (
                    <Button size="sm" variant="outline" onClick={() => resolve(false)} disabled={saving}>
                      Bỏ resolved
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        ) : (
          <div className="text-center py-12 text-muted-foreground">Không có dữ liệu diagnostic.</div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Dashboard Tab (F6) ───────────────────────────────────────────────────────

function DashboardTab({ projectId, project }: { projectId: string; project: any }) {
  const [summary, setSummary] = React.useState<any>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    (async () => {
      if (!project.lastRunId) { setLoading(false); return; }
      try {
        const r = await api.reconV2GetResults(projectId, { runId: project.lastRunId, pageSize: 1 });
        setSummary(r.summary);
      } catch { setSummary(null); }
      finally { setLoading(false); }
    })();
  }, [projectId, project.lastRunId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (!summary) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-muted-foreground">
          Chưa có run nào. Hãy sang tab "Run" để chạy đối soát.
        </CardContent>
      </Card>
    );
  }

  const statusKeys = Object.keys(STATUS_META);
  const donut = statusKeys
    .map((k) => ({
      label: k,
      value: (summary as any)[toCamel(k)] ?? 0,
      color: STATUS_META[k].donut,
    }))
    .filter((d) => d.value > 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard title="Total Lines" value={fmtNum(summary.totalLines)} icon={<Activity className="h-4 w-4" />} />
        <KpiCard title="Match %" value={`${(summary.matchPercent ?? 0).toFixed(1)}%`} icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" />} accent={summary.matchPercent >= 95 ? "emerald" : summary.matchPercent >= 80 ? "amber" : "red"} />
        <KpiCard title="Source Qty" value={fmtNum(summary.sourceTotalQty)} icon={<Database className="h-4 w-4" />} />
        <KpiCard title="Target Qty" value={fmtNum(summary.targetTotalQty)} icon={<Database className="h-4 w-4" />} />
      </div>
      <Card>
        <CardHeader><CardTitle className="text-sm">Status distribution</CardTitle></CardHeader>
        <CardContent>
          {donut.length === 0 ? (
            <div className="text-xs text-muted-foreground text-center py-6">Không có dữ liệu.</div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie data={donut} dataKey="value" nameKey="label" outerRadius={100} cx="50%" cy="50%">
                  {donut.map((d) => <Cell key={d.label} fill={d.color} />)}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard({ title, value, icon, accent }: { title: string; value: string; icon: React.ReactNode; accent?: "emerald" | "amber" | "red" }) {
  const color = accent === "emerald" ? "text-emerald-600" : accent === "amber" ? "text-amber-600" : accent === "red" ? "text-red-600" : "";
  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">{title}</span>
          {icon}
        </div>
        <div className={cn("text-xl font-bold mt-1", color)}>{value}</div>
      </CardContent>
    </Card>
  );
}

function toCamel(s: string): string {
  const parts = s.toLowerCase().split("_");
  return parts.map((p, i) => i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1)).join("");
}
