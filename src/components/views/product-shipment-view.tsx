"use client";

// =====================================================================
// ProductShipmentView
// ---------------------------------------------------------------------
// Daily Shipment Planning UI for the currently-selected product.
//
// Three sections (tabbed):
//   1. Shipment Groups Table — filter bar, 4 summary stat cards, and a
//      row-selectable table where each row carries a Planned Output
//      input (default = remainingOutput, capped at remainingOutput).
//   2. Surplus Transfer Panel — loads surplus transfer proposals from
//      /api/shipment/surplus and renders source cards + suggested
//      destination cards. This is read-only (proposals only).
//   3. Generate Shipment Sheet — shows the selected rows from §1 with
//      their Planned Output (editable, validated against remainingOutput),
//      an AUTO FILL REMAINING button, and a GENERATE SHIPMENT button that
//      calls /api/shipment/export and downloads the resulting .xlsx.
//
// All API calls are product-scoped: `currentProduct` is the mandatory
// first argument to every shipment API client method. `refreshKey` from
// the app store participates in query keys so the global refresh button
// triggers refetch.
// =====================================================================

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Truck,
  Package,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
  Download,
  Wand2,
  Loader2,
  Search,
  Filter,
  RotateCcw,
  RefreshCw,
  Factory,
  Boxes,
  Layers,
  ArrowLeftRight,
  ClipboardList,
  Info,
  Calendar,
} from "lucide-react";

import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useAppStore, PRODUCT_THEME } from "@/store/app-store";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import { toast } from "sonner";

// =====================================================================
// Types — mirror the shapes returned by /api/shipment/* (shipment-service.ts)
// =====================================================================

type ShipmentStatus = "SHORT_OUTPUT" | "COMPLETE" | "SURPLUS" | "NO_OUTPUT";

interface ShipmentGroup {
  key: string;
  poNo: string;
  factoryPO: string;
  model: string;
  sku: string;
  season: string;
  colorCode: string;
  colorCode2: string;
  painting: string;
  printingColor: string;
  size: string;
  deadline: string | null;
  orderQty: number;
  outputQty: number;
  inputQty: number;
  remainingOutput: number;
  remainingInput: number;
  surplus: number;
  status: ShipmentStatus;
}

interface GroupsResponse {
  total: number;
  shortOutput: number;
  surplus: number;
  complete: number;
  groups: ShipmentGroup[];
}

interface SurplusSource {
  key: string;
  poNo: string;
  factoryPO: string;
  model: string;
  colorCode: string;
  size: string;
  deadline: string | null;
  orderQty: number;
  outputQty: number;
  surplus: number;
}

interface TransferDestination {
  key: string;
  poNo: string;
  factoryPO: string;
  model: string;
  colorCode: string;
  size: string;
  deadline: string | null;
  orderQty: number;
  outputQty: number;
  remainingCapacity: number;
}

interface TransferProposal {
  source: SurplusSource;
  destinations: { dest: TransferDestination; transferQty: number }[];
  totalTransferable: number;
}

interface SurplusResponse {
  total: number;
  totalTransferable: number;
  proposals: TransferProposal[];
}

interface ShipmentFilters {
  colorCode: string; // "all" sentinel = no filter
  factoryPO: string;
  poNo: string;
  size: string;
  model: string;
  date: string;
  deadline: string;
}

const EMPTY_FILTERS: ShipmentFilters = {
  colorCode: "all",
  factoryPO: "",
  poNo: "",
  size: "",
  model: "",
  date: "",
  deadline: "",
};

type TabKey = "groups" | "surplus" | "generate";

// =====================================================================
// Status visual meta — row tint + badge color
// =====================================================================

const STATUS_META: Record<
  ShipmentStatus,
  {
    label: string;
    badge: string;
    row: string;
    dot: string;
  }
> = {
  SHORT_OUTPUT: {
    label: "SHORT",
    badge:
      "border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/50 dark:text-amber-300",
    row: "bg-amber-50/40 hover:bg-amber-50 dark:bg-amber-950/10 dark:hover:bg-amber-950/20",
    dot: "🟠",
  },
  SURPLUS: {
    label: "SURPLUS",
    badge:
      "border-rose-200 bg-rose-100 text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/50 dark:text-rose-300",
    row: "bg-rose-50/50 hover:bg-rose-50 dark:bg-rose-950/20 dark:hover:bg-rose-950/30",
    dot: "🔴",
  },
  COMPLETE: {
    label: "COMPLETE",
    badge:
      "border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/50 dark:text-emerald-300",
    row: "hover:bg-emerald-50/30 dark:hover:bg-emerald-950/10",
    dot: "🟢",
  },
  NO_OUTPUT: {
    label: "NO OUTPUT",
    badge:
      "border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-800/60 dark:bg-slate-800/40 dark:text-slate-300",
    row: "hover:bg-muted/30",
    dot: "⚪",
  },
};

// =====================================================================
// Helpers
// =====================================================================

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString();
}

function formatDeadline(s: string | null | undefined): string {
  if (!s) return "—";
  const str = String(s).trim();
  if (!str) return "—";
  const dmy = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) {
    const d = new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "2-digit",
      });
    }
  }
  const iso = new Date(str);
  if (!isNaN(iso.getTime())) {
    return iso.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
    });
  }
  return str;
}

function todayLocalISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// =====================================================================
// Small UI atoms
// =====================================================================

type StatTone = "primary" | "warning" | "danger" | "ok";

const STAT_TONES: Record<StatTone, { text: string; bg: string; ring: string }> = {
  primary: {
    text: "text-emerald-600 dark:text-emerald-400",
    bg: "bg-emerald-50 dark:bg-emerald-950/40",
    ring: "ring-emerald-500/20",
  },
  warning: {
    text: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-50 dark:bg-amber-950/40",
    ring: "ring-amber-500/20",
  },
  danger: {
    text: "text-rose-600 dark:text-rose-400",
    bg: "bg-rose-50 dark:bg-rose-950/40",
    ring: "ring-rose-500/20",
  },
  ok: {
    text: "text-teal-600 dark:text-teal-400",
    bg: "bg-teal-50 dark:bg-teal-950/40",
    ring: "ring-teal-500/20",
  },
};

function StatCard({
  label,
  value,
  icon: Icon,
  tone,
  loading,
  sub,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: StatTone;
  loading?: boolean;
  sub?: React.ReactNode;
}) {
  const t = STAT_TONES[tone];
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
            {loading ? (
              <Skeleton className="mt-2 h-7 w-24" />
            ) : (
              <p className={cn("mt-1 text-2xl font-bold tracking-tight tabular-nums", t.text)}>
                {value}
              </p>
            )}
            {sub ? <div className="mt-1 text-[11px] text-muted-foreground">{sub}</div> : null}
          </div>
          <div
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1",
              t.bg,
              t.ring
            )}
          >
            <Icon className={cn("h-4 w-4", t.text)} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: ShipmentStatus }) {
  const m = STATUS_META[status] ?? STATUS_META.NO_OUTPUT;
  return (
    <Badge className={cn("gap-1 text-[10px]", m.badge)}>
      <span aria-hidden>{m.dot}</span>
      {m.label}
    </Badge>
  );
}

function TableSkeleton({ rows = 6, cols = 9 }: { rows?: number; cols?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <TableRow key={`sk-${i}`}>
          {Array.from({ length: cols }).map((__, j) => (
            <TableCell key={`sk-${i}-${j}`} className="px-3 py-2">
              <div className="h-3 w-full animate-pulse rounded bg-muted" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

function EmptyRow({
  colSpan,
  message,
  hint,
  icon: Icon = Boxes,
}: {
  colSpan: number;
  message: string;
  hint?: string;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={colSpan} className="px-3 py-10 text-center">
        <div className="flex flex-col items-center justify-center gap-2">
          <Icon className="h-8 w-8 text-muted-foreground/40" />
          <div className="text-sm font-medium">{message}</div>
          {hint ? (
            <div className="max-w-md text-xs text-muted-foreground">{hint}</div>
          ) : null}
        </div>
      </TableCell>
    </TableRow>
  );
}

// =====================================================================
// Main component
// =====================================================================

export function ProductShipmentView() {
  const { currentProduct, refreshKey, bumpRefresh } = useAppStore();
  const theme = PRODUCT_THEME[currentProduct];

  // --- Filter state: `form` is what the user types, `applied` is what
  // actually triggers the query (only committed on Apply / Enter). ---
  const [form, setForm] = React.useState<ShipmentFilters>(EMPTY_FILTERS);
  const [applied, setApplied] = React.useState<ShipmentFilters>(EMPTY_FILTERS);

  // --- Selection + planned-output state (the spec requires Map + Set) ---
  const [selectedKeys, setSelectedKeys] = React.useState<Set<string>>(new Set());
  const [plannedOutputs, setPlannedOutputs] = React.useState<Map<string, number>>(new Map());

  // --- UI state ---
  const [tab, setTab] = React.useState<TabKey>("groups");
  const [surplusEnabled, setSurplusEnabled] = React.useState(false);
  const [generating, setGenerating] = React.useState(false);

  // Reset state when the active product changes — filters / selection /
  // planned outputs almost never make sense across products.
  React.useEffect(() => {
    setForm(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    setSelectedKeys(new Set());
    setPlannedOutputs(new Map());
    setSurplusEnabled(false);
    setTab("groups");
  }, [currentProduct]);

  // ---- Query: distinct colors for the dropdown ----
  const colorsQuery = useQuery({
    queryKey: ["shipment-colors", currentProduct, refreshKey],
    queryFn: () => api.getShipmentColors(currentProduct),
    enabled: Boolean(currentProduct),
  });

  // ---- Compose filter params for /api/shipment/groups ----
  const filterParams = React.useMemo(() => {
    const params: Record<string, string> = {};
    if (applied.colorCode && applied.colorCode !== "all")
      params.colorCode = applied.colorCode;
    if (applied.factoryPO) params.factoryPO = applied.factoryPO;
    if (applied.poNo) params.poNo = applied.poNo;
    if (applied.size) params.size = applied.size;
    if (applied.model) params.model = applied.model;
    if (applied.date) params.date = applied.date;
    if (applied.deadline) params.deadline = applied.deadline;
    return params;
  }, [applied]);

  // ---- Query: shipment groups ----
  const groupsQuery = useQuery({
    queryKey: ["shipment-groups", currentProduct, filterParams, refreshKey],
    queryFn: () => api.getShipmentGroups(currentProduct, filterParams),
    enabled: Boolean(currentProduct),
  });

  // ---- Query: surplus transfers (lazy — only after the user opts in) ----
  const surplusQuery = useQuery({
    queryKey: ["shipment-surplus", currentProduct, refreshKey],
    queryFn: () => api.getSurplusTransfers(currentProduct),
    enabled: Boolean(currentProduct) && surplusEnabled,
  });

  const groups: ShipmentGroup[] = groupsQuery.data?.groups ?? [];
  const groupsLoading = groupsQuery.isLoading;
  const groupsFetching = groupsQuery.isFetching;

  // Default the planned-output for every group to its remainingOutput when
  // groups load. Existing user-edited values are preserved.
  React.useEffect(() => {
    if (!groupsQuery.data?.groups) return;
    setPlannedOutputs((prev) => {
      const next = new Map(prev);
      for (const g of groupsQuery.data!.groups) {
        if (!next.has(g.key)) {
          next.set(g.key, Math.max(0, g.remainingOutput));
        }
      }
      // Drop keys for groups that are no longer present (e.g. after a filter
      // change) so we don't carry stale state into the generate step.
      const present = new Set(groupsQuery.data!.groups.map((g) => g.key));
      for (const k of Array.from(next.keys())) {
        if (!present.has(k)) next.delete(k);
      }
      return next;
    });
    // Prune selection the same way.
    setSelectedKeys((prev) => {
      const present = new Set(groupsQuery.data!.groups.map((g) => g.key));
      const next = new Set<string>();
      for (const k of prev) if (present.has(k)) next.add(k);
      return next;
    });
  }, [groupsQuery.data]);

  // ---- Selection helpers ----
  function toggleRow(key: string) {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function selectAllVisible() {
    setSelectedKeys(new Set(groups.map((g) => g.key)));
  }

  function clearSelection() {
    setSelectedKeys(new Set());
  }

  function setPlanned(key: string, raw: number) {
    setPlannedOutputs((prev) => {
      const next = new Map(prev);
      next.set(key, Number.isFinite(raw) ? raw : 0);
      return next;
    });
  }

  function autoFillRemaining() {
    setPlannedOutputs((prev) => {
      const next = new Map(prev);
      for (const key of selectedKeys) {
        const g = groups.find((x) => x.key === key);
        if (g) next.set(key, Math.max(0, g.remainingOutput));
      }
      return next;
    });
    toast.success("Planned Output auto-filled with Remaining Output for all selected rows.");
  }

  // ---- Filter actions ----
  function applyFilters() {
    setApplied(form);
  }

  function resetFilters() {
    setForm(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
  }

  const hasActiveFilters = React.useMemo(() => {
    return (
      (applied.colorCode && applied.colorCode !== "all") ||
      applied.factoryPO ||
      applied.poNo ||
      applied.size ||
      applied.model ||
      applied.date ||
      applied.deadline
    );
  }, [applied]);

  // ---- Derived data for the Generate tab ----
  const selectedGroups = React.useMemo(
    () => groups.filter((g) => selectedKeys.has(g.key)),
    [groups, selectedKeys]
  );

  const validationErrors = React.useMemo(() => {
    const errs: { key: string; message: string }[] = [];
    for (const g of selectedGroups) {
      const planned = plannedOutputs.get(g.key) ?? g.remainingOutput;
      if (planned > g.remainingOutput) {
        errs.push({
          key: g.key,
          message: `Planned ${fmt(planned)} exceeds Remaining Output ${fmt(
            g.remainingOutput
          )} for ${g.poNo} / ${g.factoryPO} / ${g.size}`,
        });
      }
      if (planned < 0) {
        errs.push({
          key: g.key,
          message: `Planned Output cannot be negative for ${g.poNo} / ${g.factoryPO} / ${g.size}`,
        });
      }
    }
    return errs;
  }, [selectedGroups, plannedOutputs]);

  // ---- Generate shipment ----
  async function generateShipment() {
    if (selectedGroups.length === 0) {
      toast.error("Select at least one row before generating a shipment sheet.");
      return;
    }
    if (validationErrors.length > 0) {
      toast.error(
        `Fix ${validationErrors.length} validation error${
          validationErrors.length === 1 ? "" : "s"
        } before generating.`
      );
      return;
    }

    const selectedColors = Array.from(
      new Set(
        selectedGroups
          .map((g) => g.colorCode)
          .filter((c): c is string => Boolean(c) && c.trim().length > 0)
      )
    ).sort();

    const plannedBody = selectedGroups.map((g) => ({
      poNo: g.poNo,
      factoryPO: g.factoryPO,
      model: g.model,
      colorCode: g.colorCode,
      size: g.size,
      plannedQty: plannedOutputs.get(g.key) ?? g.remainingOutput,
      deadline: g.deadline,
    }));

    setGenerating(true);
    try {
      const blob = await api.exportShipment({
        productType: currentProduct,
        selectedColors,
        plannedOutputs: plannedBody,
      });

      // Download the Excel blob as Daily_Shipment_YYYY-MM-DD.xlsx.
      const today = todayLocalISO();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Daily_Shipment_${today}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success(
        `Shipment sheet generated — ${plannedBody.length} row${
          plannedBody.length === 1 ? "" : "s"
        }, ${selectedColors.length} color${selectedColors.length === 1 ? "" : "s"} (${
          currentProduct
        }).`
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Shipment export failed.");
    } finally {
      setGenerating(false);
    }
  }

  const productLabel = theme.label;
  const groupsData = groupsQuery.data;

  // =====================================================================
  // Render
  // =====================================================================

  return (
    <div className="space-y-5">
      {/* ---------------- Header ---------------- */}
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold tracking-tight">Daily Shipment Planning</h1>
          <Badge className={cn("gap-1 text-[10px]", theme.badge)}>
            <Truck className="h-3 w-3" />
            {productLabel}
          </Badge>
          {groupsFetching && !groupsLoading ? (
            <Badge variant="secondary" className="text-[10px]">
              <Loader2 className="h-3 w-3 animate-spin" />
              refreshing
            </Badge>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            className="ml-auto h-8 gap-1 text-xs"
            onClick={bumpRefresh}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Plan daily shipment output for <strong>{productLabel}</strong>. Filter the production
          groups, select rows to ship, and generate a per-color Daily Shipment Excel sheet.
        </p>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)} className="space-y-4">
        <TabsList className="grid w-full grid-cols-3 sm:w-auto sm:grid-cols-none sm:inline-flex">
          <TabsTrigger value="groups" className="gap-1.5 text-xs">
            <Package className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Shipment Groups</span>
            <span className="sm:hidden">Groups</span>
          </TabsTrigger>
          <TabsTrigger value="surplus" className="gap-1.5 text-xs">
            <ArrowLeftRight className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Surplus Transfers</span>
            <span className="sm:hidden">Surplus</span>
          </TabsTrigger>
          <TabsTrigger value="generate" className="gap-1.5 text-xs">
            <ClipboardList className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Generate Shipment</span>
            <span className="sm:hidden">Generate</span>
            {selectedKeys.size > 0 ? (
              <Badge
                className={cn(
                  "ml-1 h-4 px-1 text-[9px] leading-none",
                  theme.badge
                )}
              >
                {selectedKeys.size}
              </Badge>
            ) : null}
          </TabsTrigger>
        </TabsList>

        {/* ============================================================= */}
        {/* Section 1 — Shipment Groups Table                              */}
        {/* ============================================================= */}
        <TabsContent value="groups" className="space-y-4 m-0">
          {/* Filter bar */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Filter className="h-4 w-4 text-primary" /> Filters
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3 lg:grid-cols-4">
                {/* Color Code dropdown */}
                <div className="space-y-1.5">
                  <label
                    className="text-xs font-medium text-muted-foreground"
                    htmlFor="ship-color"
                  >
                    Color Code
                  </label>
                  <Select
                    value={form.colorCode}
                    onValueChange={(v) => setForm((f) => ({ ...f, colorCode: v }))}
                  >
                    <SelectTrigger id="ship-color" className="h-9">
                      <SelectValue placeholder="All colors" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All colors</SelectItem>
                      {colorsQuery.isLoading ? (
                        <SelectItem value="__loading" disabled>
                          Loading…
                        </SelectItem>
                      ) : colorsQuery.data?.colors?.length ? (
                        colorsQuery.data.colors.map((c) => (
                          <SelectItem key={c} value={c}>
                            {c}
                          </SelectItem>
                        ))
                      ) : (
                        <SelectItem value="__empty" disabled>
                          No colors found
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>

                <FilterInput
                  id="ship-factory-po"
                  label="Factory PO"
                  value={form.factoryPO}
                  onChange={(v) => setForm((f) => ({ ...f, factoryPO: v }))}
                  onEnter={applyFilters}
                  placeholder="e.g. MH26110228"
                />
                <FilterInput
                  id="ship-po-no"
                  label="PO NO#"
                  value={form.poNo}
                  onChange={(v) => setForm((f) => ({ ...f, poNo: v }))}
                  onEnter={applyFilters}
                  placeholder="e.g. IN-PO-1234"
                />
                <FilterInput
                  id="ship-size"
                  label="Size"
                  value={form.size}
                  onChange={(v) => setForm((f) => ({ ...f, size: v }))}
                  onEnter={applyFilters}
                  placeholder="e.g. 42"
                />
                <FilterInput
                  id="ship-model"
                  label="Model"
                  value={form.model}
                  onChange={(v) => setForm((f) => ({ ...f, model: v }))}
                  onEnter={applyFilters}
                  placeholder="e.g. MAFATE-R1"
                />
                <FilterInput
                  id="ship-date"
                  label="Date"
                  type="date"
                  value={form.date}
                  onChange={(v) => setForm((f) => ({ ...f, date: v }))}
                  onEnter={applyFilters}
                />
                <FilterInput
                  id="ship-deadline"
                  label="Deadline"
                  type="date"
                  value={form.deadline}
                  onChange={(v) => setForm((f) => ({ ...f, deadline: v }))}
                  onEnter={applyFilters}
                />
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={applyFilters}>
                  <Search className="h-3.5 w-3.5" />
                  Apply
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5 text-xs"
                  onClick={resetFilters}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Reset
                </Button>
                {hasActiveFilters ? (
                  <Badge variant="outline" className="text-[10px]">
                    Filters active
                  </Badge>
                ) : null}
              </div>
            </CardContent>
          </Card>

          {/* Summary stat cards */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              label="Total Groups"
              value={fmt(groupsData?.total ?? 0)}
              icon={Boxes}
              tone="primary"
              loading={groupsLoading}
              sub={<span>(PO NO# + Factory PO + Size)</span>}
            />
            <StatCard
              label="Short Output (need to ship)"
              value={fmt(groupsData?.shortOutput ?? 0)}
              icon={AlertTriangle}
              tone="warning"
              loading={groupsLoading}
              sub={<span>Output &lt; Order</span>}
            />
            <StatCard
              label="Surplus (over-shipped)"
              value={fmt(groupsData?.surplus ?? 0)}
              icon={ArrowLeftRight}
              tone="danger"
              loading={groupsLoading}
              sub={<span>Output &gt; Order</span>}
            />
            <StatCard
              label="Complete"
              value={fmt(groupsData?.complete ?? 0)}
              icon={CheckCircle2}
              tone="ok"
              loading={groupsLoading}
              sub={<span>Fully shipped &amp; received</span>}
            />
          </div>

          {/* Shipment groups table */}
          <Card>
            <CardContent className="p-0">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
                <div className="flex items-center gap-2 text-sm">
                  <Package className="h-4 w-4 text-primary" />
                  <span className="font-medium">Shipment Groups</span>
                  <Badge variant="outline" className="text-[10px]">
                    {groups.length}
                  </Badge>
                  {selectedKeys.size > 0 ? (
                    <Badge className={cn("text-[10px]", theme.badge)}>
                      {selectedKeys.size} selected
                    </Badge>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={selectAllVisible}
                    disabled={groups.length === 0}
                  >
                    Select all
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={clearSelection}
                    disabled={selectedKeys.size === 0}
                  >
                    Clear
                  </Button>
                </div>
              </div>

              <div className="overflow-x-auto scroll-thin">
                <Table className="text-xs">
                  <TableHeader className="bg-muted/40">
                    <TableRow>
                      <TableHead className="w-10 px-2 py-2" />
                      <TableHead className="whitespace-nowrap px-3 py-2 text-[10px] font-semibold uppercase text-muted-foreground">
                        Color
                      </TableHead>
                      <TableHead className="whitespace-nowrap px-3 py-2 text-[10px] font-semibold uppercase text-muted-foreground">
                        PO NO#
                      </TableHead>
                      <TableHead className="whitespace-nowrap px-3 py-2 text-[10px] font-semibold uppercase text-muted-foreground">
                        Factory PO
                      </TableHead>
                      <TableHead className="whitespace-nowrap px-3 py-2 text-[10px] font-semibold uppercase text-muted-foreground">
                        Model
                      </TableHead>
                      <TableHead className="whitespace-nowrap px-3 py-2 text-[10px] font-semibold uppercase text-muted-foreground">
                        Size
                      </TableHead>
                      <TableHead className="whitespace-nowrap px-3 py-2 text-right text-[10px] font-semibold uppercase text-muted-foreground">
                        Order
                      </TableHead>
                      <TableHead className="whitespace-nowrap px-3 py-2 text-right text-[10px] font-semibold uppercase text-muted-foreground">
                        Output
                      </TableHead>
                      <TableHead className="whitespace-nowrap px-3 py-2 text-right text-[10px] font-semibold uppercase text-muted-foreground">
                        Input
                      </TableHead>
                      <TableHead className="whitespace-nowrap px-3 py-2 text-right text-[10px] font-semibold uppercase text-muted-foreground">
                        Rem. Output
                      </TableHead>
                      <TableHead className="whitespace-nowrap px-3 py-2 text-right text-[10px] font-semibold uppercase text-muted-foreground">
                        Rem. Input
                      </TableHead>
                      <TableHead className="whitespace-nowrap px-3 py-2 text-right text-[10px] font-semibold uppercase text-muted-foreground">
                        Surplus
                      </TableHead>
                      <TableHead className="whitespace-nowrap px-3 py-2 text-[10px] font-semibold uppercase text-muted-foreground">
                        Status
                      </TableHead>
                      <TableHead className="whitespace-nowrap px-3 py-2 text-[10px] font-semibold uppercase text-muted-foreground">
                        Deadline
                      </TableHead>
                      <TableHead className="whitespace-nowrap px-3 py-2 text-right text-[10px] font-semibold uppercase text-muted-foreground">
                        Planned Output
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {groupsLoading ? (
                      <TableSkeleton rows={6} cols={15} />
                    ) : groupsQuery.isError ? (
                      <EmptyRow
                        colSpan={15}
                        message="Failed to load shipment groups"
                        hint={
                          groupsQuery.error instanceof Error
                            ? groupsQuery.error.message
                            : "Unknown error. Try Refresh."
                        }
                        icon={AlertTriangle}
                      />
                    ) : groups.length === 0 ? (
                      <EmptyRow
                        colSpan={15}
                        message="No shipment groups found"
                        hint={
                          hasActiveFilters
                            ? "Try widening your filters or clicking Reset."
                            : `No production data for ${productLabel}. Make sure order / output / input rows have been entered for this product.`
                        }
                        icon={Truck}
                      />
                    ) : (
                      groups.map((g) => {
                        const m = STATUS_META[g.status] ?? STATUS_META.NO_OUTPUT;
                        const isSelected = selectedKeys.has(g.key);
                        const planned = plannedOutputs.get(g.key) ?? g.remainingOutput;
                        const plannedError = planned > g.remainingOutput;
                        return (
                          <TableRow
                            key={g.key}
                            className={cn("border-t transition-colors", m.row, isSelected && "ring-1 ring-inset ring-primary/20")}
                          >
                            <TableCell className="px-2 py-1.5">
                              <Checkbox
                                checked={isSelected}
                                onCheckedChange={() => toggleRow(g.key)}
                                aria-label={`Select ${g.poNo} ${g.factoryPO} ${g.size}`}
                              />
                            </TableCell>
                            <TableCell className="px-3 py-1.5">
                              {g.colorCode ? (
                                <Badge variant="outline" className="font-mono text-[10px]">
                                  {g.colorCode}
                                </Badge>
                              ) : (
                                <span className="text-muted-foreground/40">—</span>
                              )}
                            </TableCell>
                            <TableCell className="whitespace-nowrap px-3 py-1.5 font-mono text-[11px]">
                              {g.poNo || "—"}
                            </TableCell>
                            <TableCell className="whitespace-nowrap px-3 py-1.5 font-mono text-[11px]">
                              {g.factoryPO || "—"}
                            </TableCell>
                            <TableCell className="max-w-[140px] truncate px-3 py-1.5" title={g.model}>
                              {g.model || <span className="text-muted-foreground/40">—</span>}
                            </TableCell>
                            <TableCell className="px-3 py-1.5">
                              {g.size ? (
                                <Badge variant="outline" className="font-mono text-[10px]">
                                  {g.size}
                                </Badge>
                              ) : (
                                <span className="text-muted-foreground/40">—</span>
                              )}
                            </TableCell>
                            <TableCell className="px-3 py-1.5 text-right tabular-nums">{fmt(g.orderQty)}</TableCell>
                            <TableCell className="px-3 py-1.5 text-right tabular-nums">{fmt(g.outputQty)}</TableCell>
                            <TableCell className="px-3 py-1.5 text-right tabular-nums">{fmt(g.inputQty)}</TableCell>
                            <TableCell
                              className={cn(
                                "px-3 py-1.5 text-right tabular-nums",
                                g.remainingOutput > 0
                                  ? "text-amber-600 dark:text-amber-400 font-medium"
                                  : "text-muted-foreground"
                              )}
                            >
                              {fmt(g.remainingOutput)}
                            </TableCell>
                            <TableCell
                              className={cn(
                                "px-3 py-1.5 text-right tabular-nums",
                                g.remainingInput > 0
                                  ? "text-amber-600 dark:text-amber-400"
                                  : "text-muted-foreground"
                              )}
                            >
                              {fmt(g.remainingInput)}
                            </TableCell>
                            <TableCell
                              className={cn(
                                "px-3 py-1.5 text-right tabular-nums",
                                g.surplus > 0
                                  ? "text-rose-600 dark:text-rose-400 font-medium"
                                  : "text-muted-foreground"
                              )}
                            >
                              {fmt(g.surplus)}
                            </TableCell>
                            <TableCell className="px-3 py-1.5">
                              <StatusBadge status={g.status} />
                            </TableCell>
                            <TableCell className="whitespace-nowrap px-3 py-1.5 text-[11px] text-muted-foreground">
                              {g.deadline ? (
                                <span className="inline-flex items-center gap-1">
                                  <Calendar className="h-3 w-3" />
                                  {formatDeadline(g.deadline)}
                                </span>
                              ) : (
                                <span className="text-muted-foreground/40">—</span>
                              )}
                            </TableCell>
                            <TableCell className="px-3 py-1.5">
                              <Input
                                type="number"
                                min={0}
                                max={g.remainingOutput}
                                value={Number.isFinite(planned) ? planned : 0}
                                onChange={(e) =>
                                  setPlanned(g.key, Number(e.target.value))
                                }
                                disabled={!isSelected}
                                className={cn(
                                  "h-8 w-24 text-right tabular-nums text-xs",
                                  !isSelected && "bg-muted/40 text-muted-foreground",
                                  plannedError &&
                                    "border-rose-400 focus-visible:ring-rose-500/30 dark:border-rose-700"
                                )}
                                aria-invalid={plannedError}
                              />
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>

              {/* Selection footer */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/30 px-4 py-2.5">
                <div className="text-xs text-muted-foreground">
                  <span className="font-medium">{selectedKeys.size}</span> row
                  {selectedKeys.size === 1 ? "" : "s"} selected
                  {validationErrors.length > 0 ? (
                    <Badge
                      variant="outline"
                      className="ml-2 border-rose-300 bg-rose-50 text-[10px] text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300"
                    >
                      {validationErrors.length} validation issue
                      {validationErrors.length === 1 ? "" : "s"}
                    </Badge>
                  ) : null}
                </div>
                <Button
                  size="sm"
                  className={cn("h-8 gap-1.5 text-xs", theme.bg, "text-white hover:opacity-90")}
                  onClick={() => setTab("generate")}
                  disabled={selectedKeys.size === 0}
                >
                  Go to Generate
                  <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ============================================================= */}
        {/* Section 2 — Surplus Transfer Panel                             */}
        {/* ============================================================= */}
        <TabsContent value="surplus" className="space-y-4 m-0">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <ArrowLeftRight className="h-4 w-4 text-rose-500" />
                Surplus Transfer Proposals
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="max-w-3xl text-xs text-muted-foreground">
                  Detects Factory POs that over-shipped (surplus) and proposes transferring the
                  surplus to other Factory POs that share the same PO NO# + Color + Size but still
                  have remaining capacity. This is a read-only proposal — review the suggestion,
                  then make the actual adjustment elsewhere.
                </p>
                <div className="flex items-center gap-2">
                  {surplusQuery.data ? (
                    <Badge variant="outline" className="text-[10px]">
                      {surplusQuery.data.total} source
                      {surplusQuery.data.total === 1 ? "" : "s"} ·{" "}
                      {fmt(surplusQuery.data.totalTransferable)} transferable
                    </Badge>
                  ) : null}
                  {!surplusEnabled ? (
                    <Button
                      size="sm"
                      className={cn("h-8 gap-1.5 text-xs", theme.bg, "text-white hover:opacity-90")}
                      onClick={() => setSurplusEnabled(true)}
                    >
                      <Wand2 className="h-3.5 w-3.5" />
                      Load Surplus Proposals
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1.5 text-xs"
                      onClick={() => surplusQuery.refetch()}
                      disabled={surplusQuery.isFetching}
                    >
                      {surplusQuery.isFetching ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3.5 w-3.5" />
                      )}
                      Refresh proposals
                    </Button>
                  )}
                </div>
              </div>

              {surplusQuery.isLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Card key={`surplus-sk-${i}`}>
                      <CardContent className="p-4">
                        <Skeleton className="h-5 w-1/3" />
                        <Skeleton className="mt-3 h-20 w-full" />
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : surplusQuery.isError ? (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>Failed to load surplus proposals</AlertTitle>
                  <AlertDescription>
                    {surplusQuery.error instanceof Error
                      ? surplusQuery.error.message
                      : "Unknown error. Try Refresh."}
                  </AlertDescription>
                </Alert>
              ) : !surplusEnabled ? (
                <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                  <ArrowLeftRight className="h-8 w-8 text-muted-foreground/40" />
                  <div className="text-sm font-medium">No proposals loaded yet</div>
                  <div className="max-w-md text-xs text-muted-foreground">
                    Click <strong>Load Surplus Proposals</strong> to detect Factory POs with
                    surplus and suggest transfers to under-shipped peers.
                  </div>
                </div>
              ) : !surplusQuery.data?.proposals?.length ? (
                <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                  <CheckCircle2 className="h-8 w-8 text-emerald-500/60" />
                  <div className="text-sm font-medium">No surplus detected</div>
                  <div className="max-w-md text-xs text-muted-foreground">
                    Every Factory PO in <strong>{productLabel}</strong> is at-or-below its order
                    quantity. Nothing to transfer.
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {surplusQuery.data.proposals.map((p, idx) => (
                    <SurplusProposalCard
                      key={p.source.key || `prop-${idx}`}
                      proposal={p}
                      index={idx}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ============================================================= */}
        {/* Section 3 — Generate Shipment Sheet                           */}
        {/* ============================================================= */}
        <TabsContent value="generate" className="space-y-4 m-0">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <ClipboardList className="h-4 w-4 text-primary" />
                Generate Daily Shipment Sheet
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-xs text-muted-foreground">
                Review the rows you selected in the Shipment Groups tab. Adjust Planned Output
                (cannot exceed Remaining Output), then generate a per-color Daily Shipment Excel
                sheet for <strong>{productLabel}</strong>.
              </p>

              {/* Action bar */}
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5 text-xs"
                  onClick={autoFillRemaining}
                  disabled={selectedGroups.length === 0}
                >
                  <Wand2 className="h-3.5 w-3.5" />
                  Auto Fill Remaining
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 gap-1.5 text-xs"
                  onClick={() => setTab("groups")}
                >
                  <ArrowRight className="h-3.5 w-3.5 rotate-180" />
                  Back to Groups
                </Button>
                <Button
                  size="sm"
                  className={cn(
                    "ml-auto h-8 gap-1.5 text-xs",
                    theme.bg,
                    "text-white hover:opacity-90"
                  )}
                  onClick={generateShipment}
                  disabled={
                    generating ||
                    selectedGroups.length === 0 ||
                    validationErrors.length > 0
                  }
                >
                  {generating ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Download className="h-3.5 w-3.5" />
                  )}
                  {generating ? "Generating…" : "Generate Shipment"}
                </Button>
              </div>

              {/* Validation errors */}
              {validationErrors.length > 0 ? (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>
                    {validationErrors.length} validation issue
                    {validationErrors.length === 1 ? "" : "s"} to fix
                  </AlertTitle>
                  <AlertDescription>
                    <ul className="ml-4 list-disc space-y-0.5 text-xs">
                      {validationErrors.slice(0, 5).map((e) => (
                        <li key={e.key}>{e.message}</li>
                      ))}
                      {validationErrors.length > 5 ? (
                        <li>
                          …and {validationErrors.length - 5} more. Fix the highlighted rows in
                          the table below.
                        </li>
                      ) : null}
                    </ul>
                  </AlertDescription>
                </Alert>
              ) : null}

              {/* Selected rows table */}
              <div className="overflow-x-auto scroll-thin rounded-md border">
                <Table className="text-xs">
                  <TableHeader className="bg-muted/40">
                    <TableRow>
                      <TableHead className="whitespace-nowrap px-3 py-2 text-[10px] font-semibold uppercase text-muted-foreground">
                        Color
                      </TableHead>
                      <TableHead className="whitespace-nowrap px-3 py-2 text-[10px] font-semibold uppercase text-muted-foreground">
                        PO NO#
                      </TableHead>
                      <TableHead className="whitespace-nowrap px-3 py-2 text-[10px] font-semibold uppercase text-muted-foreground">
                        Factory PO
                      </TableHead>
                      <TableHead className="whitespace-nowrap px-3 py-2 text-[10px] font-semibold uppercase text-muted-foreground">
                        Size
                      </TableHead>
                      <TableHead className="whitespace-nowrap px-3 py-2 text-right text-[10px] font-semibold uppercase text-muted-foreground">
                        Deadline
                      </TableHead>
                      <TableHead className="whitespace-nowrap px-3 py-2 text-right text-[10px] font-semibold uppercase text-muted-foreground">
                        Remaining Output
                      </TableHead>
                      <TableHead className="whitespace-nowrap px-3 py-2 text-right text-[10px] font-semibold uppercase text-muted-foreground">
                        Planned Output
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedGroups.length === 0 ? (
                      <EmptyRow
                        colSpan={7}
                        message="No rows selected"
                        hint="Go to the Shipment Groups tab and tick the rows you want to ship today."
                        icon={ClipboardList}
                      />
                    ) : (
                      selectedGroups.map((g) => {
                        const planned = plannedOutputs.get(g.key) ?? g.remainingOutput;
                        const plannedError = planned > g.remainingOutput;
                        return (
                          <TableRow
                            key={g.key}
                            className={cn(
                              "border-t transition-colors hover:bg-muted/30",
                              plannedError && "bg-rose-50/50 dark:bg-rose-950/20"
                            )}
                          >
                            <TableCell className="px-3 py-1.5">
                              {g.colorCode ? (
                                <Badge variant="outline" className="font-mono text-[10px]">
                                  {g.colorCode}
                                </Badge>
                              ) : (
                                <span className="text-muted-foreground/40">—</span>
                              )}
                            </TableCell>
                            <TableCell className="whitespace-nowrap px-3 py-1.5 font-mono text-[11px]">
                              {g.poNo || "—"}
                            </TableCell>
                            <TableCell className="whitespace-nowrap px-3 py-1.5 font-mono text-[11px]">
                              {g.factoryPO || "—"}
                            </TableCell>
                            <TableCell className="px-3 py-1.5">
                              {g.size ? (
                                <Badge variant="outline" className="font-mono text-[10px]">
                                  {g.size}
                                </Badge>
                              ) : (
                                <span className="text-muted-foreground/40">—</span>
                              )}
                            </TableCell>
                            <TableCell className="whitespace-nowrap px-3 py-1.5 text-right text-[11px] text-muted-foreground">
                              {g.deadline ? formatDeadline(g.deadline) : "—"}
                            </TableCell>
                            <TableCell className="px-3 py-1.5 text-right tabular-nums">
                              {fmt(g.remainingOutput)}
                            </TableCell>
                            <TableCell className="px-3 py-1.5">
                              <Input
                                type="number"
                                min={0}
                                max={g.remainingOutput}
                                value={Number.isFinite(planned) ? planned : 0}
                                onChange={(e) => setPlanned(g.key, Number(e.target.value))}
                                className={cn(
                                  "h-8 w-28 text-right tabular-nums text-xs",
                                  plannedError &&
                                    "border-rose-400 focus-visible:ring-rose-500/30 dark:border-rose-700"
                                )}
                                aria-invalid={plannedError}
                              />
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>

              {/* Footer summary */}
              {selectedGroups.length > 0 ? (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/30 px-4 py-2.5 text-xs">
                  <div className="flex flex-wrap items-center gap-3">
                    <span>
                      <strong>{selectedGroups.length}</strong> row
                      {selectedGroups.length === 1 ? "" : "s"}
                    </span>
                    <span>
                      <strong>
                        {fmt(
                          selectedGroups.reduce(
                            (sum, g) =>
                              sum + (plannedOutputs.get(g.key) ?? g.remainingOutput),
                            0
                          )
                        )}
                      </strong>{" "}
                      total planned
                    </span>
                    <span>
                      <strong>
                        {new Set(
                          selectedGroups
                            .map((g) => g.colorCode)
                            .filter((c): c is string => Boolean(c))
                        ).size}
                      </strong>{" "}
                      color
                      {new Set(
                        selectedGroups
                          .map((g) => g.colorCode)
                          .filter((c): c is string => Boolean(c))
                      ).size === 1
                        ? ""
                        : "s"}
                    </span>
                  </div>
                  <Button
                    size="sm"
                    className={cn(
                      "h-8 gap-1.5 text-xs",
                      theme.bg,
                      "text-white hover:opacity-90"
                    )}
                    onClick={generateShipment}
                    disabled={
                      generating || validationErrors.length > 0
                    }
                  >
                    {generating ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Download className="h-3.5 w-3.5" />
                    )}
                    {generating ? "Generating…" : "Generate Shipment"}
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// =====================================================================
// FilterInput — small wrapper for label + Input with Enter-to-apply.
// =====================================================================

function FilterInput({
  id,
  label,
  value,
  onChange,
  onEnter,
  placeholder,
  type = "text",
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  onEnter?: () => void;
  placeholder?: string;
  type?: "text" | "date";
}) {
  return (
    <div className="space-y-1.5">
      <label
        className="text-xs font-medium text-muted-foreground"
        htmlFor={id}
      >
        {label}
      </label>
      <Input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && onEnter) onEnter();
        }}
        placeholder={placeholder}
        className="h-9"
        autoComplete="off"
        spellCheck={false}
      />
    </div>
  );
}

// =====================================================================
// SurplusProposalCard — renders one source + its destination suggestions
// =====================================================================

function SurplusProposalCard({
  proposal,
  index,
}: {
  proposal: TransferProposal;
  index: number;
}) {
  const { source, destinations, totalTransferable } = proposal;
  const [reviewed, setReviewed] = React.useState(false);

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        {/* Source row */}
        <div className="flex flex-wrap items-center gap-3 border-b border-rose-200/60 bg-rose-50/40 px-4 py-3 dark:border-rose-900/40 dark:bg-rose-950/20">
          <Badge
            variant="outline"
            className="border-rose-300 bg-rose-100 text-[10px] text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/50 dark:text-rose-300"
          >
            SOURCE #{index + 1}
          </Badge>
          <div className="flex items-center gap-2 text-xs">
            <Factory className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-mono">{source.factoryPO || "—"}</span>
          </div>
          <div className="text-xs text-muted-foreground">
            PO NO#: <span className="font-mono">{source.poNo || "—"}</span>
          </div>
          <div className="text-xs text-muted-foreground">
            Size:{" "}
            {source.size ? (
              <Badge variant="outline" className="font-mono text-[10px]">
                {source.size}
              </Badge>
            ) : (
              "—"
            )}
          </div>
          {source.colorCode ? (
            <Badge variant="outline" className="font-mono text-[10px]">
              {source.colorCode}
            </Badge>
          ) : null}
          <div className="ml-auto flex items-center gap-4 text-xs">
            <span>
              Order:{" "}
              <span className="font-semibold tabular-nums">{fmt(source.orderQty)}</span>
            </span>
            <span>
              Output:{" "}
              <span className="font-semibold tabular-nums">{fmt(source.outputQty)}</span>
            </span>
            <span className="inline-flex items-center gap-1 text-rose-700 dark:text-rose-300">
              <AlertTriangle className="h-3.5 w-3.5" />
              Surplus:{" "}
              <span className="font-bold tabular-nums">{fmt(source.surplus)}</span>
            </span>
          </div>
        </div>

        {/* Destinations */}
        <div className="px-4 py-3">
          <div className="mb-2 flex items-center gap-2 text-xs">
            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-medium">Suggested destinations</span>
            <Badge variant="outline" className="text-[10px]">
              {destinations.length}
            </Badge>
            <Badge
              variant="outline"
              className="border-emerald-300 bg-emerald-50 text-[10px] text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300"
            >
              {fmt(totalTransferable)} / {fmt(source.surplus)} transferable
            </Badge>
          </div>

          {destinations.length === 0 ? (
            <div className="rounded-md border border-dashed bg-muted/20 px-3 py-4 text-center text-xs text-muted-foreground">
              <Info className="mx-auto mb-1 h-4 w-4 text-muted-foreground/50" />
              No destination candidates found for this source (no peers with the same PO NO# +
              Color + Size and remaining capacity).
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
              {destinations.map(({ dest, transferQty }, i) => (
                <div
                  key={dest.key || `dest-${i}`}
                  className="rounded-md border bg-card p-3 text-xs"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono">{dest.factoryPO}</span>
                    {dest.size ? (
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {dest.size}
                      </Badge>
                    ) : null}
                    {dest.deadline ? (
                      <span className="text-[10px] text-muted-foreground">
                        <Calendar className="mr-1 inline h-3 w-3" />
                        {formatDeadline(dest.deadline)}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] text-muted-foreground">
                    <div>
                      Order
                      <div className="text-foreground tabular-nums">{fmt(dest.orderQty)}</div>
                    </div>
                    <div>
                      Output
                      <div className="text-foreground tabular-nums">{fmt(dest.outputQty)}</div>
                    </div>
                    <div>
                      Rem. cap.
                      <div className="text-emerald-600 dark:text-emerald-400 tabular-nums">
                        {fmt(dest.remainingCapacity)}
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-between rounded bg-emerald-50 px-2 py-1 dark:bg-emerald-950/30">
                    <span className="text-[10px] uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                      Suggested transfer
                    </span>
                    <span className="font-bold tabular-nums text-emerald-700 dark:text-emerald-300">
                      {fmt(transferQty)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-3 flex justify-end">
            <Button
              size="sm"
              variant={reviewed ? "outline" : "default"}
              className={cn(
                "h-8 gap-1.5 text-xs",
                !reviewed && "bg-rose-500 text-white hover:bg-rose-600 dark:bg-rose-600 dark:hover:bg-rose-700"
              )}
              onClick={() => {
                setReviewed(true);
                toast.info(
                  `Proposal reviewed: ${fmt(totalTransferable)} units transferable from ${
                    source.factoryPO
                  } to ${destinations.length} destination${
                    destinations.length === 1 ? "" : "s"
                  }.`
                );
              }}
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              {reviewed ? "Reviewed" : "Review Transfer"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default ProductShipmentView;
