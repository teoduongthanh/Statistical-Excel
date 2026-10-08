"use client";

// Reconciliation Tool View — spec F1–F9 wizard.
//
// Steps:
//   1. Import/Select       — choose source + target datasets
//   2. Column Scan         — show column profiles for both datasets
//   3. Mapping             — map source columns to target columns with roles
//   4. Rules               — configure size transformation (Men/Women tables), normalization
//   5. Config              — match keys, tolerance, mode, pre-filter
//   6. Run                 — execute reconciliation
//   7. Results             — summary cards (9 status types) + table + charts
//   8. Export              — download Excel
//
// READ-ONLY: never modifies source data.

import * as React from "react";
import {
  GitCompare,
  Loader2,
  Play,
  Filter,
  Download,
  CheckCircle2,
  AlertTriangle,
  ArrowLeftRight,
  ArrowRight,
  ArrowLeft,
  Database,
  Ruler,
  Settings2,
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
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

// ── Constants ─────────────────────────────────────────────────────────────────

const STEPS = [
  { id: 1, label: "Datasets", icon: Database },
  { id: 2, label: "Column Scan", icon: Filter },
  { id: 3, label: "Mapping", icon: ArrowLeftRight },
  { id: 4, label: "Rules", icon: Ruler },
  { id: 5, label: "Config", icon: Settings2 },
  { id: 6, label: "Run", icon: Play },
  { id: 7, label: "Results", icon: GitCompare },
  { id: 8, label: "Export", icon: Download },
];

const FIELD_OPTIONS = [
  "poNo", "factoryPO", "size", "model", "sku", "colorCode", "colorCode2",
  "season", "item", "qty1", "qty2", "deadline", "date", "shippingStatus",
];

const FIELD_ROLES = [
  "PRIMARY_KEY",
  "SECONDARY_KEY",
  "ATTRIBUTE",
  "QUANTITY",
  "DATE",
  "FILTER",
] as const;

const STATUS_META: Record<string, { color: string; label: string }> = {
  MATCHED_OK: { color: "bg-emerald-100 text-emerald-700 border-emerald-300", label: "Matched" },
  PARTIAL: { color: "bg-amber-100 text-amber-700 border-amber-300", label: "Partial" },
  OVER: { color: "bg-red-100 text-red-700 border-red-300", label: "Over" },
  MISSING_OUT: { color: "bg-violet-100 text-violet-700 border-violet-300", label: "Missing Out" },
  ORPHAN: { color: "bg-pink-100 text-pink-700 border-pink-300", label: "Orphan" },
  DUP: { color: "bg-yellow-100 text-yellow-700 border-yellow-300", label: "Duplicate" },
  ATTR_MISMATCH: { color: "bg-cyan-100 text-cyan-700 border-cyan-300", label: "Attr Mismatch" },
  FMT_FIXED: { color: "bg-blue-100 text-blue-700 border-blue-300", label: "Format Fixed" },
  SUSPECT_PO: { color: "bg-orange-100 text-orange-700 border-orange-300", label: "Suspect PO" },
};

const DONUT_COLORS: Record<string, string> = {
  MATCHED_OK: "#10b981",
  PARTIAL: "#f59e0b",
  OVER: "#ef4444",
  MISSING_OUT: "#8b5cf6",
  ORPHAN: "#ec4899",
  DUP: "#eab308",
  ATTR_MISMATCH: "#06b6d4",
  FMT_FIXED: "#3b82f6",
  SUSPECT_PO: "#f97316",
};

function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? { color: "bg-muted text-muted-foreground border-border", label: status };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold",
        meta.color
      )}
      title={status}
    >
      {meta.label}
    </span>
  );
}

function KpiCard({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div className={cn("rounded-md border p-3", color)}>
      <div className="text-[10px] uppercase tracking-wider opacity-80">{label}</div>
      <div className="text-xl font-bold">{typeof value === "number" ? value.toLocaleString() : value}</div>
    </div>
  );
}

// ── Default empty draft config ──────────────────────────────────────────────

const DEFAULT_DRAFT = {
  sourceDataset: "ONYX_FVO",
  targetDataset: "ONYX",
  fieldMappings: [
    { sourceField: "poNo", targetField: "factoryPO", role: "PRIMARY_KEY" },
    { sourceField: "factoryPO", targetField: "poNo", role: "PRIMARY_KEY" },
    { sourceField: "size", targetField: "size", role: "PRIMARY_KEY", transformRule: "size_normalize" },
    { sourceField: "model", targetField: "model", role: "ATTRIBUTE" },
    { sourceField: "colorCode", targetField: "colorCode", role: "ATTRIBUTE" },
    { sourceField: "qty1", targetField: "qty1", role: "QUANTITY" },
    { sourceField: "deadline", targetField: "deadline", role: "DATE" },
    { sourceField: "shippingStatus", targetField: "shippingStatus", role: "FILTER" },
  ],
  matchKeys: ["poNo", "factoryPO", "size"],
  statusMapping: { "1.Order": "1.Order" },
  tolerance: { type: "absolute" as const, value: 0 },
  mode: "aggregate" as const,
  preFilter: { shippingStatus: "1.Order" },
  sizeTransformRules: [
    { id: "men-rule", name: "Men size (3MH prefix)", type: "if_then" as const, condition: "gender==M", tableId: "men" as const, enabled: true },
    { id: "women-rule", name: "Women size (3WH prefix)", type: "if_then" as const, condition: "gender==W", tableId: "women" as const, enabled: true },
    { id: "regex-rule", name: "Extract M/W token (default)", type: "regex_extract" as const, regex: "[MW]\\d{1,2}T?", enabled: true },
  ],
  normalizeConfig: { trim: true, upper: true, removeWhitespace: true, commaToDot: true },
};

// ── Main view ────────────────────────────────────────────────────────────────

export function ReconToolView() {
  const [step, setStep] = React.useState(1);
  const [products, setProducts] = React.useState<any[]>([]);
  const [profiles, setProfiles] = React.useState<any[]>([]);
  const [activeProfileId, setActiveProfileId] = React.useState<string>("");
  const [draft, setDraft] = React.useState<any>(DEFAULT_DRAFT);

  // Scan state
  const [sourceProfiles, setSourceProfiles] = React.useState<any[]>([]);
  const [targetProfiles, setTargetProfiles] = React.useState<any[]>([]);
  const [scanning, setScanning] = React.useState(false);

  // Run state
  const [running, setRunning] = React.useState(false);
  const [activeRunId, setActiveRunId] = React.useState<string>("");
  const [runSummary, setRunSummary] = React.useState<any>(null);
  const [chartData, setChartData] = React.useState<any>(null);

  // Results state
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

  // Bootstrap
  React.useEffect(() => {
    api.listProducts().then((r) => {
      if (r.ok) setProducts(r.products);
    }).catch(() => { /* ignore */ });
    api.listReconToolProfiles().then((r) => {
      setProfiles(r.profiles);
      if (r.profiles.length > 0) {
        const first = r.profiles[0];
        setActiveProfileId(first.id);
        // Hydrate draft from the default profile so the wizard shows real config.
        setDraft({
          sourceDataset: first.sourceDataset,
          targetDataset: first.targetDataset,
          fieldMappings: first.fieldMappings || DEFAULT_DRAFT.fieldMappings,
          matchKeys: first.matchKeys || DEFAULT_DRAFT.matchKeys,
          statusMapping: first.statusMapping || DEFAULT_DRAFT.statusMapping,
          tolerance: first.tolerance || DEFAULT_DRAFT.tolerance,
          mode: first.mode || DEFAULT_DRAFT.mode,
          preFilter: first.preFilter || DEFAULT_DRAFT.preFilter,
          sizeTransformRules: first.sizeTransformRules || DEFAULT_DRAFT.sizeTransformRules,
          normalizeConfig: first.normalizeConfig || DEFAULT_DRAFT.normalizeConfig,
        });
      }
    }).catch((e) => toast.error("Failed to load profiles", { description: e?.message }));
  }, []);

  const activeProfile = profiles.find((p) => p.id === activeProfileId);

  // ── Step 2: scan columns ────────────────────────────────────────────────────
  async function handleScan() {
    if (!draft.sourceDataset || !draft.targetDataset) {
      toast.error("Pick both datasets first");
      return;
    }
    setScanning(true);
    setSourceProfiles([]);
    setTargetProfiles([]);
    try {
      const [s, t] = await Promise.all([
        api.reconToolScan(draft.sourceDataset),
        api.reconToolScan(draft.targetDataset),
      ]);
      setSourceProfiles(s.profiles);
      setTargetProfiles(t.profiles);
      toast.success(`Scanned: source ${s.profiles.length} cols · target ${t.profiles.length} cols`);
    } catch (e: any) {
      toast.error("Scan failed", { description: e?.message });
    } finally {
      setScanning(false);
    }
  }

  // ── Step 6: run reconciliation ─────────────────────────────────────────────
  async function handleRun() {
    setRunning(true);
    setRunSummary(null);
    setChartData(null);
    setResults([]);
    try {
      const result = await api.runReconTool({
        profileId: activeProfileId || undefined,
        config: !activeProfileId ? draft : undefined,
        overrides: {
          tolerance: draft.tolerance,
          mode: draft.mode,
          preFilter: draft.preFilter,
          matchKeys: draft.matchKeys,
        },
      });
      setActiveRunId(result.runId);
      setRunSummary(result.summary);
      toast.success(`Reconciliation complete: ${result.summary.totalLines} rows`);
      // Load chart data + results
      const summaryRes = await api.getReconToolSummary(result.runId);
      setChartData(summaryRes.chartData);
      await loadResults(result.runId, 1);
      setStep(7);
    } catch (e: any) {
      toast.error("Reconciliation failed", { description: e?.message });
    } finally {
      setRunning(false);
    }
  }

  // ── Results pagination ────────────────────────────────────────────────────
  async function loadResults(runId: string, page = 1) {
    if (!runId) return;
    setResultsLoading(true);
    try {
      const r = await api.getReconToolResults(runId, {
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
  }, [statusFilter, activeRunId]);

  function applyResultFilters() {
    if (activeRunId) loadResults(activeRunId, 1);
  }
  function resetResultFilters() {
    setStatusFilter("");
    setPoNoFilter("");
    setFactoryPOFilter("");
    setSizeFilter("");
    if (activeRunId) setTimeout(() => loadResults(activeRunId, 1), 0);
  }

  function handleExport() {
    if (!activeRunId) return;
    window.open(api.reconToolExportUrl(activeRunId), "_blank");
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 p-4 md:p-6">
      {/* Header */}
      <div className="relative overflow-hidden rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 p-6 text-white">
        <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-white/10" />
        <div className="absolute -bottom-10 right-24 h-32 w-32 rounded-full bg-white/5" />
        <div className="relative flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/15 backdrop-blur">
            <GitCompare className="h-6 w-6" />
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-white/70">Spec F1–F9</div>
            <h1 className="text-2xl font-bold">Reconciliation Tool</h1>
            <p className="text-xs text-white/70 mt-1">
              Compare two datasets with size-transform rules (Men/Women), 9-status engine, multi-sheet export
            </p>
          </div>
        </div>
      </div>

      {/* Stepper */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap items-center gap-1.5">
            {STEPS.map((s, i) => {
              const Icon = s.icon;
              const isActive = step === s.id;
              const isDone = step > s.id;
              return (
                <React.Fragment key={s.id}>
                  <button
                    type="button"
                    onClick={() => setStep(s.id)}
                    className={cn(
                      "flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                      isActive
                        ? "bg-primary text-primary-foreground border-primary"
                        : isDone
                        ? "bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800"
                        : "bg-background hover:bg-accent"
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {s.id}. {s.label}
                    {isDone && <CheckCircle2 className="h-3 w-3" />}
                  </button>
                  {i < STEPS.length - 1 && <ArrowRight className="h-3 w-3 text-muted-foreground/50" />}
                </React.Fragment>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Profile selector */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Settings2 className="h-4 w-4" /> Profile
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[240px]">
              <Label className="text-xs mb-1 block text-muted-foreground">Active Profile (loads defaults)</Label>
              <Select value={activeProfileId} onValueChange={(v) => {
                setActiveProfileId(v);
                const p = profiles.find((pp) => pp.id === v);
                if (p) {
                  setDraft({
                    sourceDataset: p.sourceDataset,
                    targetDataset: p.targetDataset,
                    fieldMappings: p.fieldMappings || DEFAULT_DRAFT.fieldMappings,
                    matchKeys: p.matchKeys || DEFAULT_DRAFT.matchKeys,
                    statusMapping: p.statusMapping || DEFAULT_DRAFT.statusMapping,
                    tolerance: p.tolerance || DEFAULT_DRAFT.tolerance,
                    mode: p.mode || DEFAULT_DRAFT.mode,
                    preFilter: p.preFilter || DEFAULT_DRAFT.preFilter,
                    sizeTransformRules: p.sizeTransformRules || DEFAULT_DRAFT.sizeTransformRules,
                    normalizeConfig: p.normalizeConfig || DEFAULT_DRAFT.normalizeConfig,
                  });
                }
              }}>
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
            {activeProfile && (
              <div className="text-xs text-muted-foreground">
                <b className="text-foreground">Mode:</b> {activeProfile.mode} ·{" "}
                <b className="text-foreground">Match keys:</b>{" "}
                {(activeProfile.matchKeys || []).join(" + ") || "—"}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Step content */}
      {step === 1 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Database className="h-4 w-4" /> Step 1 — Select Datasets
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs mb-1 block">Source Dataset (A)</Label>
                <Select value={draft.sourceDataset} onValueChange={(v) => setDraft({ ...draft, sourceDataset: v })}>
                  <SelectTrigger><SelectValue placeholder="Pick source productType" /></SelectTrigger>
                  <SelectContent>
                    {products.map((p) => (
                      <SelectItem key={p.id} value={p.productType}>{p.label} ({p.productType})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="text-[10px] text-muted-foreground mt-1">
                  Typically ONYX_FVO (poNo = OCF…, factoryPO = ART)
                </div>
              </div>
              <div>
                <Label className="text-xs mb-1 block">Target Dataset (B)</Label>
                <Select value={draft.targetDataset} onValueChange={(v) => setDraft({ ...draft, targetDataset: v })}>
                  <SelectTrigger><SelectValue placeholder="Pick target productType" /></SelectTrigger>
                  <SelectContent>
                    {products.map((p) => (
                      <SelectItem key={p.id} value={p.productType}>{p.label} ({p.productType})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="text-[10px] text-muted-foreground mt-1">
                  Typically ONYX (factoryPO = OCF…, poNo = ART)
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button onClick={() => setStep(2)} disabled={!draft.sourceDataset || !draft.targetDataset}>
                Next: Scan Columns <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Filter className="h-4 w-4" /> Step 2 — Column Scan
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <Button onClick={handleScan} disabled={scanning}>
                {scanning ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Filter className="h-4 w-4 mr-1" />}
                Scan Both Datasets
              </Button>
              <Button variant="outline" onClick={() => setStep(1)}>
                <ArrowLeft className="h-4 w-4 mr-1" /> Back
              </Button>
              <Button variant="outline" onClick={() => setStep(3)}>
                Next: Mapping <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </div>

            {sourceProfiles.length > 0 && targetProfiles.length > 0 && (
              <div className="grid grid-cols-2 gap-3">
                <ColumnScanTable title={`Source — ${draft.sourceDataset}`} profiles={sourceProfiles} />
                <ColumnScanTable title={`Target — ${draft.targetDataset}`} profiles={targetProfiles} />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {step === 3 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <ArrowLeftRight className="h-4 w-4" /> Step 3 — Column Mapping
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-xs text-muted-foreground">
                Map source fields (left) to target fields (right) with a role. PRIMARY_KEY fields are used to build the composite match key.
              </div>
              <Button size="sm" variant="outline" onClick={() => setDraft({
                ...draft,
                fieldMappings: [...draft.fieldMappings, { sourceField: "poNo", targetField: "poNo", role: "ATTRIBUTE" }],
              })}>
                Add Row
              </Button>
            </div>
            <div className="rounded-md border overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-2 py-1.5 text-left">Source Field</th>
                    <th className="px-2 py-1.5 text-left">Target Field</th>
                    <th className="px-2 py-1.5 text-left">Role</th>
                    <th className="px-2 py-1.5 text-left">Transform Rule</th>
                    <th className="px-2 py-1.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {draft.fieldMappings.map((m: any, idx: number) => (
                    <tr key={idx} className="border-t">
                      <td className="px-2 py-1.5">
                        <Select value={m.sourceField} onValueChange={(v) => {
                          const fm = [...draft.fieldMappings];
                          fm[idx] = { ...m, sourceField: v };
                          setDraft({ ...draft, fieldMappings: fm });
                        }}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {FIELD_OPTIONS.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-2 py-1.5">
                        <Select value={m.targetField} onValueChange={(v) => {
                          const fm = [...draft.fieldMappings];
                          fm[idx] = { ...m, targetField: v };
                          setDraft({ ...draft, fieldMappings: fm });
                        }}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {FIELD_OPTIONS.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-2 py-1.5">
                        <Select value={m.role} onValueChange={(v) => {
                          const fm = [...draft.fieldMappings];
                          fm[idx] = { ...m, role: v };
                          setDraft({ ...draft, fieldMappings: fm });
                        }}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {FIELD_ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-2 py-1.5">
                        <Input
                          value={m.transformRule || ""}
                          onChange={(e) => {
                            const fm = [...draft.fieldMappings];
                            fm[idx] = { ...m, transformRule: e.target.value };
                            setDraft({ ...draft, fieldMappings: fm });
                          }}
                          placeholder="e.g. size_normalize"
                          className="h-8 text-xs"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            const fm = draft.fieldMappings.filter((_: any, i: number) => i !== idx);
                            setDraft({ ...draft, fieldMappings: fm });
                          }}
                        >
                          ✕
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-between pt-2">
              <Button variant="outline" onClick={() => setStep(2)}>
                <ArrowLeft className="h-4 w-4 mr-1" /> Back
              </Button>
              <Button onClick={() => setStep(4)}>
                Next: Rules <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 4 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Ruler className="h-4 w-4" /> Step 4 — Size Transformation Rules (F3.5)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-xs text-muted-foreground">
              The engine evaluates each rule in order. Conditional (<code>if_then</code>) rules use gender detection:
              ART prefix <code>3MH</code> → Men, <code>3WH</code> → Women. Falls back to model-based gender detection,
              then to the built-in stechSizeToCanonical / fvoSizeToCanonical helpers.
            </div>

            {/* Normalize config */}
            <div className="rounded-md border p-3">
              <Label className="text-xs mb-2 block">Normalization Flags (F3.1)</Label>
              <div className="flex flex-wrap gap-4">
                {(["trim", "upper", "removeWhitespace", "commaToDot"] as const).map((k) => (
                  <label key={k} className="flex items-center gap-2 text-xs cursor-pointer">
                    <Checkbox
                      checked={!!draft.normalizeConfig[k]}
                      onCheckedChange={(c) => setDraft({
                        ...draft,
                        normalizeConfig: { ...draft.normalizeConfig, [k]: !!c },
                      })}
                    />
                    {k}
                  </label>
                ))}
              </div>
            </div>

            {/* Size transform rules */}
            <div className="rounded-md border p-3 space-y-2">
              <Label className="text-xs block">Size Transformation Rules</Label>
              {draft.sizeTransformRules.map((r: any, idx: number) => (
                <div key={r.id || idx} className="grid grid-cols-12 gap-2 items-center text-xs">
                  <div className="col-span-3">
                    <Input
                      value={r.name || ""}
                      onChange={(e) => {
                        const arr = [...draft.sizeTransformRules];
                        arr[idx] = { ...r, name: e.target.value };
                        setDraft({ ...draft, sizeTransformRules: arr });
                      }}
                      className="h-8 text-xs"
                      placeholder="Rule name"
                    />
                  </div>
                  <div className="col-span-2">
                    <Select
                      value={r.type}
                      onValueChange={(v) => {
                        const arr = [...draft.sizeTransformRules];
                        arr[idx] = { ...r, type: v };
                        setDraft({ ...draft, sizeTransformRules: arr });
                      }}
                    >
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="if_then">if_then</SelectItem>
                        <SelectItem value="regex_extract">regex_extract</SelectItem>
                        <SelectItem value="lookup">lookup</SelectItem>
                        <SelectItem value="formula">formula</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-3">
                    <Input
                      value={r.condition || r.regex || ""}
                      onChange={(e) => {
                        const arr = [...draft.sizeTransformRules];
                        const key = r.type === "regex_extract" ? "regex" : "condition";
                        arr[idx] = { ...r, [key]: e.target.value };
                        setDraft({ ...draft, sizeTransformRules: arr });
                      }}
                      className="h-8 text-xs"
                      placeholder={r.type === "regex_extract" ? "regex e.g. [MW]\\d{1,2}T?" : "condition e.g. gender==M"}
                    />
                  </div>
                  <div className="col-span-2">
                    <Select
                      value={r.tableId || ""}
                      onValueChange={(v) => {
                        const arr = [...draft.sizeTransformRules];
                        arr[idx] = { ...r, tableId: v === "__none__" ? undefined : v };
                        setDraft({ ...draft, sizeTransformRules: arr });
                      }}
                    >
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Table" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">(none)</SelectItem>
                        <SelectItem value="men">Men</SelectItem>
                        <SelectItem value="women">Women</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-1 flex justify-center">
                    <Checkbox
                      checked={!!r.enabled}
                      onCheckedChange={(c) => {
                        const arr = [...draft.sizeTransformRules];
                        arr[idx] = { ...r, enabled: !!c };
                        setDraft({ ...draft, sizeTransformRules: arr });
                      }}
                    />
                  </div>
                  <div className="col-span-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        const arr = draft.sizeTransformRules.filter((_: any, i: number) => i !== idx);
                        setDraft({ ...draft, sizeTransformRules: arr });
                      }}
                    >
                      ✕
                    </Button>
                  </div>
                </div>
              ))}
              <Button
                size="sm"
                variant="outline"
                onClick={() => setDraft({
                  ...draft,
                  sizeTransformRules: [...draft.sizeTransformRules, {
                    id: `rule-${Date.now()}`,
                    name: "New rule",
                    type: "if_then",
                    condition: "gender==M",
                    tableId: "men",
                    enabled: true,
                  }],
                })}
              >
                Add Rule
              </Button>
            </div>

            {/* Status mapping */}
            <div className="rounded-md border p-3 space-y-2">
              <Label className="text-xs block">Status Mapping (F4 — source → target)</Label>
              <Textarea
                value={JSON.stringify(draft.statusMapping, null, 2)}
                onChange={(e) => {
                  try {
                    const parsed = JSON.parse(e.target.value);
                    setDraft({ ...draft, statusMapping: parsed });
                  } catch { /* ignore invalid JSON while typing */ }
                }}
                className="font-mono text-xs h-20"
              />
            </div>

            <div className="flex justify-between pt-2">
              <Button variant="outline" onClick={() => setStep(3)}>
                <ArrowLeft className="h-4 w-4 mr-1" /> Back
              </Button>
              <Button onClick={() => setStep(5)}>
                Next: Config <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 5 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Settings2 className="h-4 w-4" /> Step 5 — Comparison Config (F4)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <Label className="text-xs mb-1 block">Mode</Label>
                <Select
                  value={draft.mode}
                  onValueChange={(v) => setDraft({ ...draft, mode: v })}
                >
                  <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="aggregate">aggregate (SUM by key)</SelectItem>
                    <SelectItem value="row_to_row">row_to_row (1-1)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs mb-1 block">Tolerance Type</Label>
                <Select
                  value={draft.tolerance.type}
                  onValueChange={(v) => setDraft({ ...draft, tolerance: { ...draft.tolerance, type: v } })}
                >
                  <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="absolute">absolute (±pairs)</SelectItem>
                    <SelectItem value="percentage">percentage (±%)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs mb-1 block">Tolerance Value</Label>
                <Input
                  type="number"
                  value={draft.tolerance.value}
                  onChange={(e) => setDraft({
                    ...draft,
                    tolerance: { ...draft.tolerance, value: Number(e.target.value) },
                  })}
                  className="h-9 text-xs"
                />
              </div>
              <div>
                <Label className="text-xs mb-1 block">Pre-filter Shipping Status</Label>
                <Input
                  value={draft.preFilter.shippingStatus || ""}
                  onChange={(e) => setDraft({
                    ...draft,
                    preFilter: { ...draft.preFilter, shippingStatus: e.target.value || undefined },
                  })}
                  placeholder='e.g. "1.Order"'
                  className="h-9 text-xs"
                />
              </div>
            </div>

            <div>
              <Label className="text-xs mb-1 block">Match Keys</Label>
              <div className="flex flex-wrap gap-3 rounded-md border p-3">
                {FIELD_OPTIONS.map((f) => {
                  const checked = (draft.matchKeys || []).includes(f);
                  return (
                    <label key={f} className="flex items-center gap-2 text-xs cursor-pointer">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(c) => {
                          const arr = new Set(draft.matchKeys || []);
                          if (c) arr.add(f); else arr.delete(f);
                          setDraft({ ...draft, matchKeys: Array.from(arr) });
                        }}
                      />
                      {f}
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="flex justify-between pt-2">
              <Button variant="outline" onClick={() => setStep(4)}>
                <ArrowLeft className="h-4 w-4 mr-1" /> Back
              </Button>
              <Button onClick={() => setStep(6)}>
                Next: Run <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 6 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Play className="h-4 w-4" /> Step 6 — Run Reconciliation
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-md border bg-muted/30 p-3 text-xs space-y-1">
              <div><b className="text-foreground">Source → Target:</b> {draft.sourceDataset} → {draft.targetDataset}</div>
              <div><b className="text-foreground">Mode:</b> {draft.mode} · <b className="text-foreground">Tolerance:</b> ±{draft.tolerance.value} {draft.tolerance.type === "absolute" ? "pairs" : "%"}</div>
              <div><b className="text-foreground">Match keys:</b> {(draft.matchKeys || []).join(" + ") || "—"}</div>
              <div><b className="text-foreground">Pre-filter:</b> {draft.preFilter.shippingStatus ? `shippingStatus = "${draft.preFilter.shippingStatus}"` : "none"}</div>
              <div><b className="text-foreground">Size transform rules:</b> {(draft.sizeTransformRules || []).filter((r: any) => r.enabled).length} enabled</div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(5)}>
                <ArrowLeft className="h-4 w-4 mr-1" /> Back
              </Button>
              <Button onClick={handleRun} disabled={running || !draft.sourceDataset || !draft.targetDataset}>
                {running ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Play className="h-4 w-4 mr-1" />}
                {running ? "Running..." : "Run Reconciliation"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 7: Results */}
      {step === 7 && (
        <>
          {runSummary && (
            <>
              {/* KPIs */}
              <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-9 gap-2">
                <KpiCard label="Total Lines" value={runSummary.totalLines} color="bg-slate-100 text-slate-700 dark:bg-slate-800/40 dark:text-slate-200" />
                <KpiCard label="Matched OK" value={runSummary.statusCounts?.MATCHED_OK ?? 0} color="bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" />
                <KpiCard label="Partial" value={runSummary.statusCounts?.PARTIAL ?? 0} color="bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300" />
                <KpiCard label="Over" value={runSummary.statusCounts?.OVER ?? 0} color="bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300" />
                <KpiCard label="Missing Out" value={runSummary.statusCounts?.MISSING_OUT ?? 0} color="bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300" />
                <KpiCard label="Orphan" value={runSummary.statusCounts?.ORPHAN ?? 0} color="bg-pink-100 text-pink-700 dark:bg-pink-950/40 dark:text-pink-300" />
                <KpiCard label="Duplicate" value={runSummary.statusCounts?.DUP ?? 0} color="bg-yellow-100 text-yellow-700 dark:bg-yellow-950/40 dark:text-yellow-300" />
                <KpiCard label="Attr Mismatch" value={runSummary.statusCounts?.ATTR_MISMATCH ?? 0} color="bg-cyan-100 text-cyan-700 dark:bg-cyan-950/40 dark:text-cyan-300" />
                <KpiCard label="Suspect PO" value={runSummary.statusCounts?.SUSPECT_PO ?? 0} color="bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300" />
              </div>

              {/* Quantity totals */}
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
                      <div className={cn(
                        "font-bold text-lg",
                        (runSummary.totalDifference || 0) > 0 ? "text-red-600"
                          : (runSummary.totalDifference || 0) < 0 ? "text-orange-600"
                          : "text-emerald-600"
                      )}>
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
                      Run ID: <code>{activeRunId}</code> · Duration: {(runSummary.durationMs || 0).toLocaleString()} ms
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Charts */}
              {chartData && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm">Status Distribution (Donut)</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ResponsiveContainer width="100%" height={260}>
                        <PieChart>
                          <Pie
                            data={chartData.donut || []}
                            dataKey="value"
                            nameKey="label"
                            cx="50%"
                            cy="50%"
                            outerRadius={80}
                            label={(entry: any) => `${entry.label}: ${entry.value}`}
                          >
                            {(chartData.donut || []).map((entry: any, i: number) => (
                              <Cell key={i} fill={DONUT_COLORS[entry.label] || "#94a3b8"} />
                            ))}
                          </Pie>
                          <Tooltip />
                          <Legend />
                        </PieChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm">Top Shortage</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {(chartData.topShortage || []).length === 0 ? (
                        <div className="py-8 text-center text-xs text-muted-foreground">No shortages detected</div>
                      ) : (
                        <ResponsiveContainer width="100%" height={260}>
                          <BarChart data={chartData.topShortage || []} layout="vertical">
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis type="number" />
                            <YAxis type="category" dataKey="key" width={140} tick={{ fontSize: 10 }} />
                            <Tooltip />
                            <Bar dataKey="missing" fill="#ef4444" />
                          </BarChart>
                        </ResponsiveContainer>
                      )}
                    </CardContent>
                  </Card>

                  <Card className="lg:col-span-2">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm">Status by Gender (Stacked Bar)</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ResponsiveContainer width="100%" height={260}>
                        <BarChart data={chartData.stackedBar || []}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                          <YAxis />
                          <Tooltip />
                          <Legend />
                          <Bar dataKey="M" stackId="a" fill="#3b82f6" />
                          <Bar dataKey="W" stackId="a" fill="#ec4899" />
                          <Bar dataKey="unknown" stackId="a" fill="#94a3b8" />
                        </BarChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>
                </div>
              )}

              {/* Results table */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Filter className="h-4 w-4" /> Results ({resultsTotal.toLocaleString()})
                  </CardTitle>
                </CardHeader>
                <CardContent>
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
                            <th className="px-2 py-1.5 text-left">PO#</th>
                            <th className="px-2 py-1.5 text-left">Factory PO</th>
                            <th className="px-2 py-1.5 text-left">Size (canonical)</th>
                            <th className="px-2 py-1.5 text-left">Size (raw)</th>
                            <th className="px-2 py-1.5 text-right">Source Qty</th>
                            <th className="px-2 py-1.5 text-right">Target Qty</th>
                            <th className="px-2 py-1.5 text-right">Diff</th>
                            <th className="px-2 py-1.5 text-right">%</th>
                            <th className="px-2 py-1.5 text-left">Match Type</th>
                            <th className="px-2 py-1.5 text-left">Issues</th>
                          </tr>
                        </thead>
                        <tbody>
                          {results.map((r: any, i: number) => {
                            const src = r.sourceData || {};
                            const tgt = r.targetData || {};
                            return (
                              <tr key={i} className="border-t hover:bg-accent/30">
                                <td className="px-2 py-1.5"><StatusBadge status={r.status} /></td>
                                <td className="px-2 py-1.5 font-mono">{src.poNo || tgt.poNo || "—"}</td>
                                <td className="px-2 py-1.5 font-mono text-muted-foreground">{src.factoryPO || tgt.factoryPO || "—"}</td>
                                <td className="px-2 py-1.5 font-mono">{src.size || tgt.size || "—"}</td>
                                <td className="px-2 py-1.5 font-mono text-muted-foreground">{src.rawSize || tgt.rawSize || "—"}</td>
                                <td className="px-2 py-1.5 text-right font-mono">{r.sourceQty}</td>
                                <td className="px-2 py-1.5 text-right font-mono">{r.targetQty}</td>
                                <td className={cn(
                                  "px-2 py-1.5 text-right font-mono font-bold",
                                  r.difference > 0 ? "text-red-600"
                                    : r.difference < 0 ? "text-orange-600"
                                    : "text-emerald-600"
                                )}>
                                  {r.difference}
                                </td>
                                <td className="px-2 py-1.5 text-right font-mono">{r.percentage?.toFixed(1)}%</td>
                                <td className="px-2 py-1.5">
                                  <Badge variant="outline" className="text-[9px]">{r.matchType || "—"}</Badge>
                                </td>
                                <td className="px-2 py-1.5 max-w-[220px]">
                                  {(r.issues || []).length > 0 ? (
                                    <div className="flex items-start gap-1">
                                      <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0 mt-0.5" />
                                      <span className="text-[10px] text-muted-foreground truncate" title={(r.issues || []).join("; ")}>
                                        {(r.issues || []).join("; ")}
                                      </span>
                                    </div>
                                  ) : (
                                    <span className="text-[10px] text-emerald-600 flex items-center gap-1">
                                      <CheckCircle2 className="h-3 w-3" /> OK
                                    </span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

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

              <div className="flex justify-end">
                <Button onClick={() => setStep(8)}>
                  Next: Export <ArrowRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </>
          )}

          {!runSummary && (
            <Card>
              <CardContent className="py-16 text-center">
                <GitCompare className="h-12 w-12 mx-auto text-muted-foreground/40 mb-3" />
                <div className="text-sm text-muted-foreground">
                  No run yet. Go back to step 6 and click "Run Reconciliation".
                </div>
                <Button className="mt-3" onClick={() => setStep(6)}>Go to Run</Button>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {step === 8 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Download className="h-4 w-4" /> Step 8 — Export (F8)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-xs text-muted-foreground">
              Download a multi-sheet Excel workbook: <b>1. Summary</b>, <b>2. Detail</b>, <b>3. Urgent</b>
              (PARTIAL/OVER/MISSING_OUT/ORPHAN/SUSPECT_PO), <b>4. Errors</b> (DUP/ATTR_MISMATCH/FMT_FIXED).
            </div>
            {activeRunId ? (
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={handleExport}>
                  <Download className="h-4 w-4 mr-1" /> Download Excel
                </Button>
                <div className="text-xs text-muted-foreground">
                  Run ID: <code>{activeRunId}</code>
                </div>
              </div>
            ) : (
              <div className="py-8 text-center text-sm text-muted-foreground">
                No active run. Run a reconciliation first.
              </div>
            )}
            <div className="flex justify-start pt-2">
              <Button variant="outline" onClick={() => setStep(7)}>
                <ArrowLeft className="h-4 w-4 mr-1" /> Back to Results
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ColumnScanTable({ title, profiles }: { title: string; profiles: any[] }) {
  return (
    <div>
      <div className="text-xs font-semibold mb-2">{title}</div>
      <div className="rounded-md border overflow-x-auto max-h-[400px]">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-muted/80 backdrop-blur">
            <tr>
              <th className="px-2 py-1.5 text-left">Field</th>
              <th className="px-2 py-1.5 text-left">Type</th>
              <th className="px-2 py-1.5 text-right">Empty %</th>
              <th className="px-2 py-1.5 text-right">Unique</th>
              <th className="px-2 py-1.5 text-left">Samples</th>
            </tr>
          </thead>
          <tbody>
            {profiles.map((p) => (
              <tr key={p.field} className="border-t">
                <td className="px-2 py-1.5 font-mono">{p.field}</td>
                <td className="px-2 py-1.5">
                  <Badge variant="outline" className="text-[9px]">{p.type}</Badge>
                </td>
                <td className="px-2 py-1.5 text-right font-mono">{p.emptyPct}%</td>
                <td className="px-2 py-1.5 text-right font-mono">{p.uniqueCount}</td>
                <td className="px-2 py-1.5 text-[10px] text-muted-foreground">
                  {p.samples?.slice(0, 3).join(", ") || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
