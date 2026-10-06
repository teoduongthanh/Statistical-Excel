"use client";

// Comparison Studio View — Dynamic data relationship & comparison engine (spec 85 sections)
//
// Sections:
//   1. Profile selector + "New Profile" button + Run section (date filters, [Run Comparison])
//   2. Profile Builder (spec §66 wizard, simplified):
//        Source / Target dataset dropdowns, Field mappings table, Match key checkboxes,
//        Status mapping, Aggregation config, Metrics, Mode, [Save Profile]
//   3. Results section: Summary cards + filterable paginated table + [Export Excel]
//   4. Run history — list past runs with re-export links
//
// READ-ONLY: never modifies source data (spec §62).

import * as React from "react";
import {
  GitCompare,
  Loader2,
  Plus,
  Save,
  Trash2,
  Play,
  Filter,
  Download,
  History,
  Settings2,
  ArrowLeftRight,
  CheckCircle2,
  AlertTriangle,
  X,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

// ── Status metadata ────────────────────────────────────────────────────────
const STATUS_META: Record<string, { color: string; label: string }> = {
  MATCHED: { color: "bg-emerald-100 text-emerald-700 border-emerald-300", label: "Matched" },
  QTY_MISMATCH: { color: "bg-amber-100 text-amber-700 border-amber-300", label: "Qty Mismatch" },
  MISSING_SOURCE: { color: "bg-rose-100 text-rose-700 border-rose-300", label: "Missing Source" },
  MISSING_TARGET: { color: "bg-violet-100 text-violet-700 border-violet-300", label: "Missing Target" },
  AMBIGUOUS: { color: "bg-yellow-100 text-yellow-700 border-yellow-300", label: "Ambiguous" },
  SHORTAGE: { color: "bg-orange-100 text-orange-700 border-orange-300", label: "Shortage" },
  OVERAGE: { color: "bg-red-100 text-red-700 border-red-300", label: "Overage" },
};

const FIELD_TYPES = ["EXACT", "NORMALIZED", "TRANSFORMED", "COMPARE"] as const;
const FIELD_OPTIONS = [
  "poNo", "factoryPO", "size", "model", "sku", "colorCode", "colorCode2",
  "season", "item", "qty1", "qty2", "deadline", "date", "shippingStatus",
];
const STATUS_KEYS = ["1.Order", "2.Output", "3.Pending", "4.Input"];
const MODES = ["STRICT", "BALANCED", "SMART"] as const;

function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? { color: "bg-muted text-muted-foreground border-border", label: status };
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold", meta.color)} title={status}>
      {meta.label}
    </span>
  );
}

// ── Default empty profile form ────────────────────────────────────────────
const EMPTY_PROFILE = {
  name: "",
  description: "",
  sourceDataset: "",
  targetDataset: "",
  statusMapping: { "2.Output": "4.Input" },
  matchKeyFields: ["poNo", "factoryPO", "size"],
  fieldMappings: [
    { sourceField: "poNo", targetField: "poNo", type: "EXACT" },
    { sourceField: "factoryPO", targetField: "factoryPO", type: "EXACT" },
    { sourceField: "size", targetField: "size", type: "NORMALIZED" },
    { sourceField: "qty1", targetField: "qty1", type: "COMPARE" },
  ],
  aggregationConfig: { qtyField: "qty1", method: "SUM" },
  metrics: [
    { type: "DIFFERENCE", direction: "SOURCE_MINUS_TARGET" },
    { type: "PERCENTAGE" },
  ],
  rules: [
    { condition: "difference === 0", status: "MATCHED", priority: 1 },
    { condition: "missingTarget", status: "MISSING_TARGET", priority: 2 },
    { condition: "missingSource", status: "MISSING_SOURCE", priority: 3 },
    { condition: "difference < 0", status: "SHORTAGE", priority: 4 },
    { condition: "difference > 0", status: "OVERAGE", priority: 5 },
  ],
  mode: "SMART" as const,
};

export function ComparisonStudioView() {
  const [products, setProducts] = React.useState<any[]>([]);
  const [profiles, setProfiles] = React.useState<any[]>([]);
  const [activeProfileId, setActiveProfileId] = React.useState<string>("");
  const [builderOpen, setBuilderOpen] = React.useState(false);
  const [draftProfile, setDraftProfile] = React.useState<any>(null);

  // Run section
  const [dateFrom, setDateFrom] = React.useState("");
  const [dateTo, setDateTo] = React.useState("");
  const [running, setRunning] = React.useState(false);
  const [activeRunId, setActiveRunId] = React.useState<string>("");
  const [runSummary, setRunSummary] = React.useState<any>(null);

  // Results section
  const [results, setResults] = React.useState<any[]>([]);
  const [resultsTotal, setResultsTotal] = React.useState(0);
  const [resultsPage, setResultsPage] = React.useState(1);
  const [resultsPageSize] = React.useState(50);
  const [resultsTotalPages, setResultsTotalPages] = React.useState(1);
  const [resultsLoading, setResultsLoading] = React.useState(false);
  const [statusFilter, setStatusFilter] = React.useState<string>("");
  const [poNoFilter, setPoNoFilter] = React.useState("");
  const [factoryPOFilter, setFactoryPOFilter] = React.useState("");
  const [sizeFilter, setSizeFilter] = React.useState("");

  // History
  const [history, setHistory] = React.useState<any[]>([]);
  const [historyOpen, setHistoryOpen] = React.useState(false);

  // Bootstrap: load products + profiles
  React.useEffect(() => {
    api.listComparisonProfiles().then((r) => {
      setProfiles(r.profiles);
      if (r.profiles.length > 0 && !activeProfileId) {
        setActiveProfileId(r.profiles[0].id);
      }
    }).catch((e) => toast.error("Failed to load profiles", { description: e?.message }));
    api.listProducts().then((r) => {
      if (r.ok) setProducts(r.products);
    }).catch(() => { /* ignore */ });
  }, []);

  const activeProfile = profiles.find((p) => p.id === activeProfileId);

  // ── Run comparison ────────────────────────────────────────────────────────
  async function handleRun() {
    if (!activeProfileId) {
      toast.error("Select a profile first");
      return;
    }
    setRunning(true);
    try {
      const result = await api.runComparison({
        profileId: activeProfileId,
        filters: {
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
        },
      });
      setActiveRunId(result.runId);
      setRunSummary(result.summary);
      toast.success(`Comparison complete: ${result.summary.totalCompared} rows compared`);
      loadResults(result.runId, 1);
    } catch (e: any) {
      toast.error("Comparison failed", { description: e?.message });
    } finally {
      setRunning(false);
    }
  }

  // ── Load results (paginated) ──────────────────────────────────────────────
  async function loadResults(runId: string, page = 1) {
    if (!runId) return;
    setResultsLoading(true);
    try {
      const r = await api.getComparisonResults(runId, {
        status: statusFilter || undefined,
        poNo: poNoFilter || undefined,
        factoryPO: factoryPOFilter || undefined,
        size: sizeFilter || undefined,
        page,
        pageSize: resultsPageSize,
      });
      setResults(r.rows);
      setResultsTotal(r.total);
      setResultsPage(r.page);
      setResultsTotalPages(r.totalPages);
      if (r.summary) setRunSummary(r.summary);
    } catch (e: any) {
      toast.error("Failed to load results", { description: e?.message });
    } finally {
      setResultsLoading(false);
    }
  }

  React.useEffect(() => {
    if (activeRunId) loadResults(activeRunId, 1);
  }, [statusFilter]);

  function applyResultFilters() {
    if (activeRunId) loadResults(activeRunId, 1);
  }

  function resetResultFilters() {
    setStatusFilter("");
    setPoNoFilter("");
    setFactoryPOFilter("");
    setSizeFilter("");
    if (activeRunId) {
      // Re-trigger after state updates
      setTimeout(() => loadResults(activeRunId, 1), 0);
    }
  }

  // ── Profile builder ─────────────────────────────────────────────────────
  function openNewProfile() {
    setDraftProfile({ ...EMPTY_PROFILE, fieldMappings: [...EMPTY_PROFILE.fieldMappings] });
    setBuilderOpen(true);
  }
  function openEditProfile() {
    if (!activeProfile) return;
    setDraftProfile({
      id: activeProfile.id,
      name: activeProfile.name,
      description: activeProfile.description || "",
      sourceDataset: activeProfile.sourceDataset,
      targetDataset: activeProfile.targetDataset,
      statusMapping: activeProfile.statusMapping || {},
      matchKeyFields: activeProfile.matchKeyFields || [],
      fieldMappings: activeProfile.fieldMappings || [],
      aggregationConfig: activeProfile.aggregationConfig || {},
      metrics: activeProfile.metrics || [],
      rules: activeProfile.rules || [],
      mode: activeProfile.mode || "SMART",
    });
    setBuilderOpen(true);
  }
  async function saveProfile() {
    if (!draftProfile) return;
    if (!draftProfile.name) return toast.error("Name is required");
    if (!draftProfile.sourceDataset) return toast.error("Source dataset is required");
    if (!draftProfile.targetDataset) return toast.error("Target dataset is required");
    try {
      if (draftProfile.id) {
        await api.updateComparisonProfile(draftProfile.id, draftProfile);
        toast.success("Profile updated");
      } else {
        const r = await api.createComparisonProfile(draftProfile);
        if (r.profile) setActiveProfileId(r.profile.id);
        toast.success("Profile created");
      }
      // Refresh profiles list
      const list = await api.listComparisonProfiles();
      setProfiles(list.profiles);
      setBuilderOpen(false);
      setDraftProfile(null);
    } catch (e: any) {
      toast.error("Failed to save profile", { description: e?.message });
    }
  }
  async function deleteProfile() {
    if (!activeProfile) return;
    if (!confirm(`Delete profile "${activeProfile.name}"?`)) return;
    try {
      await api.deleteComparisonProfile(activeProfile.id);
      toast.success("Profile deleted");
      const list = await api.listComparisonProfiles();
      setProfiles(list.profiles);
      if (list.profiles.length > 0) setActiveProfileId(list.profiles[0].id);
      else setActiveProfileId("");
    } catch (e: any) {
      toast.error("Failed to delete profile", { description: e?.message });
    }
  }

  // ── History ─────────────────────────────────────────────────────────────
  async function openHistory() {
    setHistoryOpen(true);
    try {
      const r = await api.listComparisonRuns(20);
      setHistory(r.runs);
    } catch (e: any) {
      toast.error("Failed to load history", { description: e?.message });
    }
  }

  // ── Export ──────────────────────────────────────────────────────────────
  function handleExport(runId: string) {
    if (!runId) return;
    window.open(api.comparisonExportUrl(runId), "_blank");
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="relative overflow-hidden rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 p-6 text-white">
        <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-white/10" />
        <div className="absolute -bottom-10 right-24 h-32 w-32 rounded-full bg-white/5" />
        <div className="relative flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/15 backdrop-blur">
            <GitCompare className="h-6 w-6" />
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-white/70">Data Relationship & Comparison</div>
            <h1 className="text-2xl font-bold">Comparison Studio</h1>
            <p className="text-xs text-white/70 mt-1">
              Compare any two datasets by composite key · READ-ONLY · Dynamic profiles
            </p>
          </div>
        </div>
      </div>

      {/* Profile selector + actions */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Settings2 className="h-4 w-4" /> Profile
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[240px]">
              <Label className="text-xs mb-1 block text-muted-foreground">Active Profile</Label>
              <Select value={activeProfileId} onValueChange={setActiveProfileId}>
                <SelectTrigger><SelectValue placeholder="Select a profile" /></SelectTrigger>
                <SelectContent>
                  {profiles.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} ({p.sourceDataset} → {p.targetDataset})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" size="sm" onClick={openEditProfile} disabled={!activeProfile}>
              <Settings2 className="h-4 w-4 mr-1" /> Edit
            </Button>
            <Button variant="outline" size="sm" onClick={deleteProfile} disabled={!activeProfile}>
              <Trash2 className="h-4 w-4 mr-1" /> Delete
            </Button>
            <Button size="sm" onClick={openNewProfile}>
              <Plus className="h-4 w-4 mr-1" /> New Profile
            </Button>
          </div>

          {activeProfile && (
            <div className="mt-3 text-xs text-muted-foreground space-y-1">
              <div><b className="text-foreground">Source → Target:</b> {activeProfile.sourceDataset} → {activeProfile.targetDataset}</div>
              <div><b className="text-foreground">Match Keys:</b> {(activeProfile.matchKeyFields || []).join(" + ") || "—"}</div>
              <div><b className="text-foreground">Mode:</b> {activeProfile.mode} · <b className="text-foreground">Version:</b> {activeProfile.version}</div>
              {activeProfile.description && <div className="italic">{activeProfile.description}</div>}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Run section */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Play className="h-4 w-4" /> Run Comparison
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label className="text-xs mb-1 block text-muted-foreground">Date From</Label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-9 w-[180px]" />
            </div>
            <div>
              <Label className="text-xs mb-1 block text-muted-foreground">Date To</Label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-9 w-[180px]" />
            </div>
            <Button onClick={handleRun} disabled={running || !activeProfileId}>
              {running ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Play className="h-4 w-4 mr-1" />}
              {running ? "Running..." : "Run Comparison"}
            </Button>
            <Button variant="outline" onClick={openHistory}>
              <History className="h-4 w-4 mr-1" /> History
            </Button>
            {activeRunId && (
              <Button variant="outline" onClick={() => handleExport(activeRunId)}>
                <Download className="h-4 w-4 mr-1" /> Export Excel
              </Button>
            )}
          </div>
          <div className="mt-2 text-[11px] text-muted-foreground">
            Optional date range filters MasterData rows by their <code>date</code> field. Leave blank to compare all rows.
          </div>
        </CardContent>
      </Card>

      {/* Summary cards */}
      {runSummary && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
          <KpiCard label="Total" value={runSummary.totalCompared} color="bg-slate-100 text-slate-700" />
          <KpiCard label="Matched" value={runSummary.matchedCount} color="bg-emerald-100 text-emerald-700" />
          <KpiCard label="Mismatch" value={runSummary.mismatchCount} color="bg-amber-100 text-amber-700" />
          <KpiCard label="Missing Src" value={runSummary.missingSource} color="bg-rose-100 text-rose-700" />
          <KpiCard label="Missing Tgt" value={runSummary.missingTarget} color="bg-violet-100 text-violet-700" />
          <KpiCard label="Ambiguous" value={runSummary.ambiguousCount} color="bg-yellow-100 text-yellow-700" />
          <KpiCard label="Shortage" value={runSummary.shortageCount} color="bg-orange-100 text-orange-700" />
          <KpiCard label="Overage" value={runSummary.overageCount} color="bg-red-100 text-red-700" />
        </div>
      )}

      {/* Quantity totals */}
      {runSummary && (
        <Card>
          <CardContent className="pt-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div className="rounded-md border p-3">
                <div className="text-[10px] uppercase text-muted-foreground">Source Total Qty</div>
                <div className="font-bold text-lg">{(runSummary.sourceTotalQty || 0).toLocaleString()}</div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-[10px] uppercase text-muted-foreground">Target Total Qty</div>
                <div className="font-bold text-lg">{(runSummary.targetTotalQty || 0).toLocaleString()}</div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-[10px] uppercase text-muted-foreground">Total Difference</div>
                <div className={cn("font-bold text-lg", (runSummary.totalDifference || 0) > 0 ? "text-red-600" : (runSummary.totalDifference || 0) < 0 ? "text-orange-600" : "text-emerald-600")}>
                  {(runSummary.totalDifference || 0).toLocaleString()}
                </div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-[10px] uppercase text-muted-foreground">Match %</div>
                <div className="font-bold text-lg">{(runSummary.matchPercentage || 0).toFixed(2)}%</div>
              </div>
            </div>
            {activeRunId && (
              <div className="mt-2 text-[11px] text-muted-foreground">
                Run ID: <code>{activeRunId}</code> · Duration: {(runSummary.duration || 0).toLocaleString()} ms
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Results table */}
      {activeRunId && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Filter className="h-4 w-4" /> Results ({resultsTotal.toLocaleString()})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {/* Filters */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-2 mb-3">
              <Select value={statusFilter || "__all__"} onValueChange={(v) => setStatusFilter(v === "__all__" ? "" : v)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="All status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All status</SelectItem>
                  {Object.keys(STATUS_META).map((s) => (
                    <SelectItem key={s} value={s}>{STATUS_META[s].label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input placeholder="PO NO#" value={poNoFilter} onChange={(e) => setPoNoFilter(e.target.value)} className="h-8 text-xs" />
              <Input placeholder="Factory PO" value={factoryPOFilter} onChange={(e) => setFactoryPOFilter(e.target.value)} className="h-8 text-xs" />
              <Input placeholder="Size" value={sizeFilter} onChange={(e) => setSizeFilter(e.target.value)} className="h-8 text-xs" />
              <div className="flex gap-2">
                <Button size="sm" onClick={applyResultFilters}>Apply</Button>
                <Button size="sm" variant="outline" onClick={resetResultFilters}>Reset</Button>
              </div>
            </div>

            {/* Table */}
            {resultsLoading ? (
              <div className="py-8 text-center"><Loader2 className="h-6 w-6 mx-auto animate-spin" /></div>
            ) : results.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">No results match filters</div>
            ) : (
              <div className="overflow-x-auto scroll-thin rounded-md border max-h-[600px]">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted/80 backdrop-blur z-10">
                    <tr>
                      <th className="px-2 py-1.5 text-left">Status</th>
                      <th className="px-2 py-1.5 text-left">Source PO#</th>
                      <th className="px-2 py-1.5 text-left">Source FPO</th>
                      <th className="px-2 py-1.5 text-left">Size</th>
                      <th className="px-2 py-1.5 text-right">Source Qty</th>
                      <th className="px-2 py-1.5 text-right">Target Qty</th>
                      <th className="px-2 py-1.5 text-right">Diff</th>
                      <th className="px-2 py-1.5 text-right">%</th>
                      <th className="px-2 py-1.5 text-left">Match Type</th>
                      <th className="px-2 py-1.5 text-left">Issues</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((r, i) => {
                      const src = r.sourceData || {};
                      const tgt = r.targetData || {};
                      return (
                        <tr key={i} className="border-t hover:bg-accent/30">
                          <td className="px-2 py-1.5"><StatusBadge status={r.status} /></td>
                          <td className="px-2 py-1.5 font-mono">{src.poNo || tgt.poNo || "—"}</td>
                          <td className="px-2 py-1.5 font-mono text-muted-foreground">{src.factoryPO || tgt.factoryPO || "—"}</td>
                          <td className="px-2 py-1.5 font-mono">{src.size || tgt.size || "—"}</td>
                          <td className="px-2 py-1.5 text-right font-mono">{r.sourceQty}</td>
                          <td className="px-2 py-1.5 text-right font-mono">{r.targetQty}</td>
                          <td className={cn("px-2 py-1.5 text-right font-mono font-bold", r.difference > 0 ? "text-red-600" : r.difference < 0 ? "text-orange-600" : "text-emerald-600")}>{r.difference}</td>
                          <td className="px-2 py-1.5 text-right font-mono">{r.percentage?.toFixed(1)}%</td>
                          <td className="px-2 py-1.5"><Badge variant="outline" className="text-[9px]">{r.matchType || "—"}</Badge></td>
                          <td className="px-2 py-1.5 max-w-[200px]">
                            {(r.issues || []).length > 0 ? (
                              <div className="flex items-start gap-1">
                                <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0 mt-0.5" />
                                <span className="text-[10px] text-muted-foreground truncate" title={(r.issues || []).join("; ")}>
                                  {(r.issues || []).join("; ")}
                                </span>
                              </div>
                            ) : (
                              <span className="text-[10px] text-emerald-600 flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> OK</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination */}
            {resultsTotalPages > 1 && (
              <div className="flex items-center justify-between mt-3 text-xs">
                <div className="text-muted-foreground">
                  Page {resultsPage} of {resultsTotalPages} · {resultsTotal.toLocaleString()} rows
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" disabled={resultsPage <= 1} onClick={() => loadResults(activeRunId, resultsPage - 1)}>Prev</Button>
                  <Button size="sm" variant="outline" disabled={resultsPage >= resultsTotalPages} onClick={() => loadResults(activeRunId, resultsPage + 1)}>Next</Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {!activeRunId && (
        <Card>
          <CardContent className="py-16 text-center">
            <ArrowLeftRight className="h-12 w-12 mx-auto text-muted-foreground/40 mb-3" />
            <div className="text-sm text-muted-foreground">
              {activeProfile
                ? "Click \"Run Comparison\" to compare datasets and view results."
                : "Select or create a profile to begin."}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Profile Builder Dialog */}
      <Dialog open={builderOpen} onOpenChange={setBuilderOpen}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{draftProfile?.id ? "Edit Profile" : "New Comparison Profile"}</DialogTitle>
            <DialogDescription>
              Configure source/target datasets, field mappings, match keys, aggregation, metrics, and rules.
            </DialogDescription>
          </DialogHeader>

          {draftProfile && (
            <div className="space-y-4">
              {/* Basic info */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs mb-1 block">Profile Name *</Label>
                  <Input value={draftProfile.name} onChange={(e) => setDraftProfile({ ...draftProfile, name: e.target.value })} placeholder="e.g., ONYX_STECH_VS_FVO" />
                </div>
                <div>
                  <Label className="text-xs mb-1 block">Mode</Label>
                  <Select value={draftProfile.mode} onValueChange={(v) => setDraftProfile({ ...draftProfile, mode: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {MODES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label className="text-xs mb-1 block">Description</Label>
                <Input value={draftProfile.description} onChange={(e) => setDraftProfile({ ...draftProfile, description: e.target.value })} placeholder="Optional description" />
              </div>

              {/* Source / Target datasets */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs mb-1 block">Source Dataset *</Label>
                  <Select value={draftProfile.sourceDataset} onValueChange={(v) => setDraftProfile({ ...draftProfile, sourceDataset: v })}>
                    <SelectTrigger><SelectValue placeholder="Pick source productType" /></SelectTrigger>
                    <SelectContent>
                      {products.map((p) => (
                        <SelectItem key={p.id} value={p.productType}>{p.label} ({p.productType})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs mb-1 block">Target Dataset *</Label>
                  <Select value={draftProfile.targetDataset} onValueChange={(v) => setDraftProfile({ ...draftProfile, targetDataset: v })}>
                    <SelectTrigger><SelectValue placeholder="Pick target productType" /></SelectTrigger>
                    <SelectContent>
                      {products.map((p) => (
                        <SelectItem key={p.id} value={p.productType}>{p.label} ({p.productType})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Match key fields */}
              <div>
                <Label className="text-xs mb-1 block">Match Key Fields</Label>
                <div className="flex flex-wrap gap-3 rounded-md border p-3">
                  {FIELD_OPTIONS.map((f) => {
                    const checked = (draftProfile.matchKeyFields || []).includes(f);
                    return (
                      <label key={f} className="flex items-center gap-2 text-xs cursor-pointer">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(c) => {
                            const arr = new Set(draftProfile.matchKeyFields || []);
                            if (c) arr.add(f); else arr.delete(f);
                            setDraftProfile({ ...draftProfile, matchKeyFields: Array.from(arr) });
                          }}
                        />
                        {f}
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Field mappings */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <Label className="text-xs">Field Mappings</Label>
                  <Button size="sm" variant="outline" onClick={() => setDraftProfile({
                    ...draftProfile,
                    fieldMappings: [...(draftProfile.fieldMappings || []), { sourceField: "poNo", targetField: "poNo", type: "EXACT" }],
                  })}>
                    <Plus className="h-3 w-3 mr-1" /> Add
                  </Button>
                </div>
                <div className="rounded-md border overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="px-2 py-1.5 text-left">Source Field</th>
                        <th className="px-2 py-1.5 text-left">Target Field</th>
                        <th className="px-2 py-1.5 text-left">Type</th>
                        <th className="px-2 py-1.5"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {(draftProfile.fieldMappings || []).map((m: any, idx: number) => (
                        <tr key={idx} className="border-t">
                          <td className="px-2 py-1.5">
                            <Select value={m.sourceField} onValueChange={(v) => {
                              const fm = [...draftProfile.fieldMappings];
                              fm[idx] = { ...m, sourceField: v };
                              setDraftProfile({ ...draftProfile, fieldMappings: fm });
                            }}>
                              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {FIELD_OPTIONS.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="px-2 py-1.5">
                            <Select value={m.targetField} onValueChange={(v) => {
                              const fm = [...draftProfile.fieldMappings];
                              fm[idx] = { ...m, targetField: v };
                              setDraftProfile({ ...draftProfile, fieldMappings: fm });
                            }}>
                              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {FIELD_OPTIONS.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="px-2 py-1.5">
                            <Select value={m.type} onValueChange={(v) => {
                              const fm = [...draftProfile.fieldMappings];
                              fm[idx] = { ...m, type: v };
                              setDraftProfile({ ...draftProfile, fieldMappings: fm });
                            }}>
                              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {FIELD_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="px-2 py-1.5">
                            <Button size="sm" variant="ghost" onClick={() => {
                              const fm = draftProfile.fieldMappings.filter((_: any, i: number) => i !== idx);
                              setDraftProfile({ ...draftProfile, fieldMappings: fm });
                            }}>
                              <X className="h-3 w-3" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                      {(draftProfile.fieldMappings || []).length === 0 && (
                        <tr><td colSpan={4} className="px-2 py-3 text-center text-muted-foreground">No field mappings — add at least one.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Status mapping */}
              <div>
                <Label className="text-xs mb-1 block">Status Mapping (source status → target status)</Label>
                <div className="space-y-2 rounded-md border p-3">
                  {STATUS_KEYS.map((src) => (
                    <div key={src} className="flex items-center gap-2 text-xs">
                      <Badge variant="outline" className="w-20 justify-center">{src}</Badge>
                      <ArrowLeftRight className="h-3 w-3 text-muted-foreground" />
                      <Select
                        value={(draftProfile.statusMapping || {})[src] || ""}
                        onValueChange={(v) => setDraftProfile({
                          ...draftProfile,
                          statusMapping: { ...(draftProfile.statusMapping || {}), [src]: v },
                        })}
                      >
                        <SelectTrigger className="h-8 text-xs w-40"><SelectValue placeholder="—" /></SelectTrigger>
                        <SelectContent>
                          {STATUS_KEYS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              </div>

              {/* Aggregation config */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs mb-1 block">Aggregation Qty Field</Label>
                  <Select
                    value={draftProfile.aggregationConfig?.qtyField || "qty1"}
                    onValueChange={(v) => setDraftProfile({
                      ...draftProfile,
                      aggregationConfig: { ...(draftProfile.aggregationConfig || {}), qtyField: v },
                    })}
                  >
                    <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["qty1", "qty2"].map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs mb-1 block">Aggregation Method</Label>
                  <Select
                    value={draftProfile.aggregationConfig?.method || "SUM"}
                    onValueChange={(v) => setDraftProfile({
                      ...draftProfile,
                      aggregationConfig: { ...(draftProfile.aggregationConfig || {}), method: v },
                    })}
                  >
                    <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["SUM", "MAX", "MIN", "AVG"].map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Rules JSON editor */}
              <div>
                <Label className="text-xs mb-1 block">Rules (JSON array — conditions evaluated in priority order)</Label>
                <Textarea
                  className="font-mono text-xs"
                  rows={6}
                  value={JSON.stringify(draftProfile.rules || [], null, 2)}
                  onChange={(e) => {
                    try {
                      const parsed = JSON.parse(e.target.value);
                      setDraftProfile({ ...draftProfile, rules: parsed });
                    } catch { /* ignore parse errors while typing */ }
                  }}
                />
                <div className="text-[10px] text-muted-foreground mt-1">
                  Supported conditions: <code>difference === 0</code>, <code>difference &lt; 0</code>, <code>difference &gt; 0</code>, <code>missingSource</code>, <code>missingTarget</code>, <code>ambiguous</code>, <code>always</code>.
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setBuilderOpen(false)}>Cancel</Button>
            <Button onClick={saveProfile}><Save className="h-4 w-4 mr-1" /> Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* History dialog */}
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Run History</DialogTitle>
            <DialogDescription>Past comparison runs. Click a run to view results.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {history.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">No runs yet.</div>
            ) : (
              history.map((run) => (
                <div key={run.id} className="flex items-center gap-3 rounded-md border p-3 hover:bg-accent/30 transition-colors">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{run.runId}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {run.profileName} · {run.sourceDataset} → {run.targetDataset}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      {new Date(run.startedAt).toLocaleString()} · {(run.duration ?? 0).toLocaleString()}ms · {run.status}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-xs shrink-0">
                    <Badge variant="outline">{run.totalCompared} rows</Badge>
                    <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">{run.matchedCount}</Badge>
                    {run.mismatchCount > 0 && <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">{run.mismatchCount}</Badge>}
                    <Button size="sm" variant="outline" onClick={() => {
                      setActiveRunId(run.runId);
                      setRunSummary(null);
                      loadResults(run.runId, 1);
                      setHistoryOpen(false);
                    }}>
                      View
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => handleExport(run.runId)}>
                      <Download className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function KpiCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-md border p-2 text-center">
      <div className={cn("inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold mb-1", color)}>{label}</div>
      <div className="font-bold text-lg">{(value || 0).toLocaleString()}</div>
    </div>
  );
}
