"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Boxes,
  ClipboardList,
  PackageCheck,
  Factory as FactoryIcon,
  TrendingUp,
  Truck,
  PackageX,
  Activity,
  Gauge,
  AlertTriangle,
  RefreshCw,
  Search,
  Loader2,
  CalendarClock,
  Hash,
  Tag,
  Shirt,
  Layers,
  ShieldCheck,
  Zap,
  PenLine,
  ClipboardCheck,
  FileOutput,
  GitCompare,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useAppStore, PRODUCT_THEME, type ProductType } from "@/store/app-store";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

interface KPIs {
  orderQty: number;
  outputQty: number;
  pendingQty: number;
  inputQty: number;
  outputRemaining: number;
  processing: number;
  inputRemaining: number;
  outputRate: number;
  completionRate: number;
  processingRate: number;
  missing: number;
  quantityStatus: string;
  totalPOs: number;
  totalFactoryPOs: number;
  totalModels: number;
  totalSKUs: number;
  totalRows: number;
}

interface AlertRow {
  key: string;
  poNo: string;
  factoryPO: string;
  model: string;
  sku?: string;
  size: string;
  deadline: string | null;
  deadlineStatus: string;
  quantityStatus: string;
  orderQty: number;
  outputQty: number;
  inputQty: number;
  processing: number;
  missing: number;
  outputRemaining: number;
  completionRate: number;
  outputRate: number;
  alert: {
    priority: "HIGH" | "MEDIUM" | "LOW" | "INFO";
    deadlineStatus: string;
    quantityStatus: string;
    messages: string[];
  };
}

interface AlertsResponse {
  total: number;
  high: number;
  medium: number;
  low: number;
  alerts: AlertRow[];
}

interface DimensionRow {
  dim: string;
  orderQty: number;
  outputQty: number;
  inputQty: number;
  processing: number;
  missing: number;
  completionRate: number;
  outputRate: number;
  rowCount?: number;
}

interface DimensionResponse {
  dimension: string;
  rows: DimensionRow[];
}

interface TimelinePoint {
  date: string;
  qty: number;
}

interface TimelineResponse {
  statusBucket: string;
  series: TimelinePoint[];
}

interface DashboardFilters {
  factoryPO?: string;
  poNo?: string;
  model?: string;
  season?: string;
  dateFrom?: string;
  dateTo?: string;
}

// Form state always has all fields as strings (empty string = unset).
// This is committed to `DashboardFilters` (optional fields) on Apply.
interface FilterFormState {
  factoryPO: string;
  poNo: string;
  model: string;
  season: string;
  dateFrom: string;
  dateTo: string;
}

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

const TOOLTIP_STYLE = {
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--popover)",
  color: "var(--popover-foreground)",
  fontSize: 12,
} as const;

/**
 * Fixed quantity colors — independent of product theme so the
 * Order/Output/Input semantics are consistent across MAFATE / ONYX / MIZUNO.
 *  - order    -> slate (neutral demand)
 *  - output   -> amber (in-progress / sent out)
 *  - input    -> emerald (received / completed)
 *  - missing  -> rose   (shortfall / danger)
 */
const QTY_COLORS = {
  order: "oklch(0.55 0.025 220)", // slate
  output: "oklch(0.74 0.16 75)", // amber
  input: "oklch(0.6 0.13 162)", // emerald/teal
  missing: "oklch(0.62 0.21 18)", // rose
} as const;

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "0";
  return Math.round(n).toLocaleString();
}

function fmtPct(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "0.0%";
  return `${n.toFixed(digits)}%`;
}

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

function rateTone(rate: number): string {
  if (rate >= 95) return "text-emerald-600 dark:text-emerald-400";
  if (rate >= 80) return "text-amber-600 dark:text-amber-400";
  return "text-rose-600 dark:text-rose-400";
}

function rateBadge(rate: number): string {
  if (rate >= 95)
    return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300";
  if (rate >= 80)
    return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300";
  return "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300";
}

const PRIORITY_BADGE: Record<
  AlertRow["alert"]["priority"],
  { label: string; dot: string; className: string }
> = {
  HIGH: {
    label: "HIGH",
    dot: "🔴",
    className:
      "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300",
  },
  MEDIUM: {
    label: "MEDIUM",
    dot: "🟠",
    className:
      "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300",
  },
  LOW: {
    label: "LOW",
    dot: "🟡",
    className:
      "border-yellow-200 bg-yellow-50 text-yellow-700 dark:border-yellow-900/50 dark:bg-yellow-950/40 dark:text-yellow-300",
  },
  INFO: {
    label: "INFO",
    dot: "ℹ️",
    className:
      "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-300",
  },
};

const DEADLINE_STATUS_BADGE: Record<string, string> = {
  OVERDUE:
    "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300",
  DUE_TODAY:
    "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300",
  DUE_TOMORROW:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300",
  DUE_THIS_WEEK:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300",
  UPCOMING:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300",
  COMPLETED:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300",
  NO_DEADLINE:
    "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-400",
};

function deadlineBadgeClass(status: string): string {
  return DEADLINE_STATUS_BADGE[status] ?? DEADLINE_STATUS_BADGE.NO_DEADLINE;
}

function deadlineLabel(status: string): string {
  return status
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDeadline(s: string | null | undefined): string {
  if (!s) return "—";
  const str = String(s).trim();
  if (!str) return "—";
  // Try yyyy-MM-dd or ISO
  const d = new Date(str);
  if (!isNaN(d.getTime())) {
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
    });
  }
  // Try dd/MM/yyyy
  const m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const dt = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    if (!isNaN(dt.getTime())) {
      return dt.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "2-digit",
      });
    }
  }
  return str;
}

// ----------------------------------------------------------------------------
// Sub-components
// ----------------------------------------------------------------------------

interface StatCardProps {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  iconClass: string;
  sub?: React.ReactNode;
  loading?: boolean;
}

function StatCard({ label, value, icon: Icon, iconClass, sub, loading }: StatCardProps) {
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
            {loading ? (
              <Skeleton className="mt-2 h-7 w-24" />
            ) : (
              <p className="mt-1 text-2xl font-bold tracking-tight tabular-nums">{value}</p>
            )}
            {sub ? <div className="mt-1 text-[11px] text-muted-foreground">{sub}</div> : null}
          </div>
          <div
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
              iconClass,
            )}
          >
            <Icon className="h-4 w-4" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ChartSkeleton({ height = "h-72" }: { height?: string }) {
  return (
    <div className={cn("flex w-full items-center justify-center", height)}>
      <Skeleton className={cn("w-full", height)} />
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}

function EmptyState({ message, icon: Icon }: { message: string; icon: React.ComponentType<{ className?: string }> }) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center justify-center py-10 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <Icon className="h-6 w-6" />
        </div>
        <p className="mt-3 text-sm font-medium">No data</p>
        <p className="mt-1 max-w-sm text-xs text-muted-foreground">{message}</p>
      </CardContent>
    </Card>
  );
}

// ----------------------------------------------------------------------------
// Main view
// ----------------------------------------------------------------------------

export function ProductDashboardView() {
  const { currentProduct, refreshKey, bumpRefresh, setView } = useAppStore();
  const theme = PRODUCT_THEME[currentProduct];

  // ---- Filter state (local form, committed on Apply) ----
  const [form, setForm] = React.useState<FilterFormState>({
    factoryPO: "",
    poNo: "",
    model: "",
    season: "",
    dateFrom: "",
    dateTo: "",
  });
  const [applied, setApplied] = React.useState<DashboardFilters>({});

  const appliedFilters: Record<string, string> = React.useMemo(() => {
    const out: Record<string, string> = {};
    if (applied.factoryPO) out.factoryPO = applied.factoryPO;
    if (applied.poNo) out.poNo = applied.poNo;
    if (applied.model) out.model = applied.model;
    if (applied.season) out.season = applied.season;
    if (applied.dateFrom) out.dateFrom = applied.dateFrom;
    if (applied.dateTo) out.dateTo = applied.dateTo;
    return out;
  }, [applied]);

  const hasFilters = Object.keys(appliedFilters).length > 0;

  function handleApply() {
    setApplied({
      factoryPO: form.factoryPO.trim(),
      poNo: form.poNo.trim(),
      model: form.model.trim(),
      season: form.season.trim(),
      dateFrom: form.dateFrom,
      dateTo: form.dateTo,
    });
  }

  function handleReset() {
    setForm({ factoryPO: "", poNo: "", model: "", season: "", dateFrom: "", dateTo: "" });
    setApplied({});
  }

  function handleEnterKey(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleApply();
    }
  }

  // ---- Queries ----
  // Every query is product-scoped: currentProduct is always the first arg.
  const kpiQ = useQuery<KPIs>({
    queryKey: ["product-kpis", currentProduct, appliedFilters, refreshKey],
    queryFn: () => api.getKPIs(currentProduct, appliedFilters),
    staleTime: 30_000,
  });

  const alertsQ = useQuery<AlertsResponse>({
    queryKey: ["product-alerts", currentProduct, appliedFilters, refreshKey],
    queryFn: () => api.getAlerts(currentProduct, 20),
    staleTime: 30_000,
  });

  const timelineQ = useQuery<TimelineResponse>({
    queryKey: ["product-timeline", currentProduct, "output", refreshKey],
    queryFn: () => api.getTimeline(currentProduct, "output"),
    staleTime: 30_000,
  });

  const sizeQ = useQuery<DimensionResponse>({
    queryKey: ["product-dim", currentProduct, "size", appliedFilters, refreshKey],
    queryFn: () => api.getByDimension(currentProduct, "size", appliedFilters),
    staleTime: 30_000,
  });

  const colorQ = useQuery<DimensionResponse>({
    queryKey: ["product-dim", currentProduct, "colorCode", appliedFilters, refreshKey],
    queryFn: () => api.getByDimension(currentProduct, "colorCode", appliedFilters),
    staleTime: 30_000,
  });

  const modelQ = useQuery<DimensionResponse>({
    queryKey: ["product-dim", currentProduct, "model", appliedFilters, refreshKey],
    queryFn: () => api.getByDimension(currentProduct, "model", appliedFilters),
    staleTime: 30_000,
  });

  // ---- Dashboard Insights (Health Score + Deadline Alerts + Data Quality + Quick Stats) ----
  const insightsQ = useQuery({
    queryKey: ["dashboard-insights", currentProduct, refreshKey],
    queryFn: () => api.getDashboardInsights(currentProduct),
    staleTime: 30_000,
  });
  const insights = insightsQ.data;
  const insightsLoading = insightsQ.isLoading || insightsQ.isFetching;

  // ---- Derived values ----
  const kpis = kpiQ.data;
  const isLoadingKpis = kpiQ.isLoading || kpiQ.isFetching;
  const alerts = alertsQ.data;
  const alertsLoading = alertsQ.isLoading || alertsQ.isFetching;
  const timeline = timelineQ.data;
  const timelineLoading = timelineQ.isLoading || timelineQ.isFetching;
  const sizeRows = sizeQ.data?.rows ?? [];
  const colorRows = colorQ.data?.rows ?? [];
  const modelRows = modelQ.data?.rows ?? [];
  const dimsLoading = sizeQ.isLoading || colorQ.isLoading || modelQ.isLoading;

  // ---- Chart data for Order vs Output vs Input (single grouped bar set) ----
  const ooiChartData = React.useMemo(() => {
    if (!kpis) return [];
    return [
      {
        name: "Quantities",
        Order: kpis.orderQty,
        Output: kpis.outputQty,
        Input: kpis.inputQty,
      },
    ];
  }, [kpis]);

  // ---- Timeline chart data ----
  const timelineData = React.useMemo(() => timeline?.series ?? [], [timeline]);

  // ---- Any error ----
  const error =
    kpiQ.error || alertsQ.error || timelineQ.error || sizeQ.error || colorQ.error || modelQ.error;
  const isError = Boolean(error);

  const kpiStats: {
    label: string;
    value: string;
    icon: React.ComponentType<{ className?: string }>;
    iconClass: string;
    sub?: React.ReactNode;
  }[] = [
    {
      label: "Total Orders",
      value: fmt(kpis?.totalFactoryPOs ?? 0),
      icon: FactoryIcon,
      iconClass: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
      sub: <span>{kpis?.totalPOs ?? 0} PO NO#s</span>,
    },
    {
      label: "Total Ordered Qty",
      value: fmt(kpis?.orderQty ?? 0),
      icon: ClipboardList,
      iconClass: "bg-slate-100 text-slate-600 dark:bg-slate-800/60 dark:text-slate-300",
      sub: <span>{kpis?.totalModels ?? 0} models · {kpis?.totalSKUs ?? 0} SKUs</span>,
    },
    {
      label: "Total Output Qty",
      value: fmt(kpis?.outputQty ?? 0),
      icon: Truck,
      iconClass: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
      sub: (
        <span>
          <span className={rateTone(clampPct(kpis?.outputRate ?? 0))}>
            {fmtPct(kpis?.outputRate ?? 0)}
          </span>{" "}
          of ordered
        </span>
      ),
    },
    {
      label: "Total Processing Qty",
      value: fmt(kpis?.processing ?? 0),
      icon: Activity,
      iconClass: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
      sub: <span>{fmtPct(kpis?.processingRate ?? 0)} of ordered</span>,
    },
    {
      label: "Total Input Qty",
      value: fmt(kpis?.inputQty ?? 0),
      icon: PackageCheck,
      iconClass: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
      sub: (
        <span className={rateTone(clampPct(kpis?.completionRate ?? 0))}>
          {fmtPct(kpis?.completionRate ?? 0)} completion
        </span>
      ),
    },
    {
      label: "Total Missing Qty",
      value: fmt(kpis?.missing ?? 0),
      icon: PackageX,
      iconClass: cn(
        "bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300",
        (kpis?.missing ?? 0) === 0 &&
          "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
      ),
      sub: <span>ordered − received</span>,
    },
    {
      label: "Output Rate",
      value: fmtPct(kpis?.outputRate ?? 0),
      icon: TrendingUp,
      iconClass: cn(
        "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
        clampPct(kpis?.outputRate ?? 0) >= 95 &&
          "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
        clampPct(kpis?.outputRate ?? 0) < 80 &&
          "bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300",
      ),
      sub: <span>output / ordered</span>,
    },
    {
      label: "Completion Rate",
      value: fmtPct(kpis?.completionRate ?? 0),
      icon: Gauge,
      iconClass: cn(
        "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
        clampPct(kpis?.completionRate ?? 0) < 80 &&
          "bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300",
        clampPct(kpis?.completionRate ?? 0) >= 80 &&
          clampPct(kpis?.completionRate ?? 0) < 95 &&
          "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
      ),
      sub: <span>input / ordered</span>,
    },
  ];

  return (
    <div className="space-y-6">
      {/* ---------------- Header banner ---------------- */}
      <div
        className={cn(
          "relative overflow-hidden rounded-xl border bg-gradient-to-r p-5 text-white shadow-sm",
          theme.gradient,
        )}
      >
        <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-white/10" />
        <div className="absolute -bottom-10 right-24 h-32 w-32 rounded-full bg-white/5" />
        <div className="relative flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/15 backdrop-blur">
              <Boxes className="h-6 w-6" />
            </div>
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider text-white/80">
                Product Dashboard
              </p>
              <h1 className="text-2xl font-bold tracking-tight">{currentProduct}</h1>
              <p className="text-xs text-white/80">
                Real-time production KPIs, alerts &amp; trends
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => bumpRefresh()}
              disabled={isLoadingKpis || alertsLoading || timelineLoading || dimsLoading}
              className="h-9 bg-white/20 text-white hover:bg-white/30 hover:text-white"
            >
              {isLoadingKpis || alertsLoading || timelineLoading || dimsLoading ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              )}
              Refresh
            </Button>
          </div>
        </div>
      </div>

      {/* ---------------- Filter bar ---------------- */}
      <Card>
        <CardContent className="py-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-6">
            {/* Factory PO */}
            <div className="flex flex-col gap-1.5">
              <label className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                <FactoryIcon className="h-3 w-3" /> Factory PO
              </label>
              <Input
                value={form.factoryPO}
                onChange={(e) => setForm((f) => ({ ...f, factoryPO: e.target.value }))}
                onKeyDown={handleEnterKey}
                placeholder="e.g. MH26110228"
                className="h-9"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            {/* PO NO# */}
            <div className="flex flex-col gap-1.5">
              <label className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                <Hash className="h-3 w-3" /> PO NO#
              </label>
              <Input
                value={form.poNo}
                onChange={(e) => setForm((f) => ({ ...f, poNo: e.target.value }))}
                onKeyDown={handleEnterKey}
                placeholder="e.g. H411351070"
                className="h-9"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            {/* Model */}
            <div className="flex flex-col gap-1.5">
              <label className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                <Tag className="h-3 w-3" /> Model
              </label>
              <Input
                value={form.model}
                onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
                onKeyDown={handleEnterKey}
                placeholder="e.g. MAFATE5 MS"
                className="h-9"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            {/* Season */}
            <div className="flex flex-col gap-1.5">
              <label className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                <Shirt className="h-3 w-3" /> Season
              </label>
              <Input
                value={form.season}
                onChange={(e) => setForm((f) => ({ ...f, season: e.target.value }))}
                onKeyDown={handleEnterKey}
                placeholder="e.g. SP27"
                className="h-9"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            {/* Date From */}
            <div className="flex flex-col gap-1.5">
              <label className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                <CalendarClock className="h-3 w-3" /> Date From
              </label>
              <Input
                type="date"
                value={form.dateFrom}
                onChange={(e) => setForm((f) => ({ ...f, dateFrom: e.target.value }))}
                onKeyDown={handleEnterKey}
                className="h-9"
              />
            </div>
            {/* Date To */}
            <div className="flex flex-col gap-1.5">
              <label className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                <CalendarClock className="h-3 w-3" /> Date To
              </label>
              <Input
                type="date"
                value={form.dateTo}
                onChange={(e) => setForm((f) => ({ ...f, dateTo: e.target.value }))}
                onKeyDown={handleEnterKey}
                className="h-9"
              />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={handleApply} className="h-9">
              <Search className="mr-1.5 h-3.5 w-3.5" />
              Apply Filters
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleReset}
              disabled={!hasFilters}
              className="h-9"
            >
              Reset
            </Button>
            {hasFilters ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted-foreground">Active:</span>
                {Object.entries(appliedFilters).map(([k, v]) => (
                  <Badge key={k} variant="secondary" className="gap-1 text-[10px]">
                    <span className="opacity-70">{k}:</span>
                    {v}
                    <button
                      type="button"
                      onClick={() =>
                        setApplied((a) => {
                          const next = { ...a };
                          delete (next as Record<string, string>)[k];
                          return next;
                        })
                      }
                      className="ml-0.5 rounded-sm hover:bg-accent"
                      aria-label={`Remove ${k} filter`}
                    >
                      ×
                    </button>
                  </Badge>
                ))}
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {/* ---------------- Error banner ---------------- */}
      {isError ? (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Failed to load dashboard data</AlertTitle>
          <AlertDescription>
            {error instanceof Error ? error.message : "Unknown error."}{" "}
            <button
              type="button"
              onClick={() => bumpRefresh()}
              className="underline underline-offset-2 hover:opacity-80"
            >
              Try again
            </button>
          </AlertDescription>
        </Alert>
      ) : null}

      {/* ---------------- KPI cards (8) ---------------- */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-4">
        {kpiStats.map((st) => (
          <StatCard
            key={st.label}
            label={st.label}
            value={st.value}
            icon={st.icon}
            iconClass={st.iconClass}
            sub={st.sub}
            loading={isLoadingKpis}
          />
        ))}
      </div>

      {/* ---------------- Dashboard Insights: Health Score + Deadline Alerts + Data Quality + Quick Stats ---------------- */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* 1. Production Health Score */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Activity className="h-4 w-4 text-primary" />
              Production Health Score
            </CardTitle>
            <CardDescription className="text-xs">
              Overall production health based on completion, output, deadlines, and data quality.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {insightsLoading ? (
              <div className="flex h-24 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : insights ? (
              <div className="space-y-3">
                <div className="flex items-center gap-4">
                  <div className={cn(
                    "flex h-20 w-20 flex-col items-center justify-center rounded-full text-2xl font-bold",
                    insights.healthScore.status === "EXCELLENT" && "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400",
                    insights.healthScore.status === "GOOD" && "bg-teal-100 text-teal-700 dark:bg-teal-950/40 dark:text-teal-400",
                    insights.healthScore.status === "WARNING" && "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
                    insights.healthScore.status === "CRITICAL" && "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400",
                  )}>
                    {insights.healthScore.score}
                    <span className="text-[10px] font-normal opacity-70">/ 100</span>
                  </div>
                  <div className="flex-1 space-y-1">
                    <Badge className={cn(
                      insights.healthScore.status === "EXCELLENT" && "bg-emerald-100 text-emerald-700 border-emerald-200",
                      insights.healthScore.status === "GOOD" && "bg-teal-100 text-teal-700 border-teal-200",
                      insights.healthScore.status === "WARNING" && "bg-amber-100 text-amber-700 border-amber-200",
                      insights.healthScore.status === "CRITICAL" && "bg-rose-100 text-rose-700 border-rose-200",
                    )}>
                      {insights.healthScore.status}
                    </Badge>
                    <div className="text-xs text-muted-foreground">
                      Completion: {insights.healthScore.completionRate}% · Output: {insights.healthScore.outputRate}%
                    </div>
                  </div>
                </div>
                {/* Score breakdown */}
                <div className="space-y-1.5">
                  {[
                    { label: "Completion (40%)", value: insights.healthScore.components.completion, max: 40, tone: "bg-emerald-500" },
                    { label: "Output Rate (30%)", value: insights.healthScore.components.output, max: 30, tone: "bg-teal-500" },
                    { label: "Deadline Health (20%)", value: insights.healthScore.components.deadline, max: 20, tone: "bg-amber-500" },
                    { label: "Data Quality (10%)", value: insights.healthScore.components.dataQuality, max: 10, tone: "bg-violet-500" },
                  ].map((comp) => (
                    <div key={comp.label} className="flex items-center gap-2">
                      <span className="w-32 text-[10px] text-muted-foreground">{comp.label}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                        <div className={cn("h-full rounded-full", comp.tone)} style={{ width: `${(comp.value / comp.max) * 100}%` }} />
                      </div>
                      <span className="w-8 text-right text-[10px] tabular-nums">{comp.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="py-6 text-center text-xs text-muted-foreground">No insights available</div>
            )}
          </CardContent>
        </Card>

        {/* 2. Deadline Alert Center */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Deadline Alert Center
            </CardTitle>
            <CardDescription className="text-xs">
              Orders with upcoming or past deadlines that still have missing quantity.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {insightsLoading ? (
              <div className="flex h-24 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : insights && insights.deadlineCenter ? (
              <div className="space-y-2">
                <div className="grid grid-cols-4 gap-2">
                  <div className="rounded-lg bg-rose-50 p-2 text-center dark:bg-rose-950/30">
                    <div className="text-lg font-bold tabular-nums text-rose-600 dark:text-rose-400">{insights.deadlineCenter.overdue}</div>
                    <div className="text-[10px] text-rose-600 dark:text-rose-400">Overdue</div>
                  </div>
                  <div className="rounded-lg bg-rose-50 p-2 text-center dark:bg-rose-950/30">
                    <div className="text-lg font-bold tabular-nums text-rose-600 dark:text-rose-400">{insights.deadlineCenter.dueToday}</div>
                    <div className="text-[10px] text-rose-600 dark:text-rose-400">Due Today</div>
                  </div>
                  <div className="rounded-lg bg-amber-50 p-2 text-center dark:bg-amber-950/30">
                    <div className="text-lg font-bold tabular-nums text-amber-600 dark:text-amber-400">{insights.deadlineCenter.dueThisWeek}</div>
                    <div className="text-[10px] text-amber-600 dark:text-amber-400">This Week</div>
                  </div>
                  <div className="rounded-lg bg-emerald-50 p-2 text-center dark:bg-emerald-950/30">
                    <div className="text-lg font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{insights.deadlineCenter.upcoming}</div>
                    <div className="text-[10px] text-emerald-600 dark:text-emerald-400">Upcoming</div>
                  </div>
                </div>
                {insights.deadlineCenter.alerts.length > 0 && (
                  <div className="max-h-40 space-y-1 overflow-y-auto scroll-thin">
                    {insights.deadlineCenter.alerts.slice(0, 8).map((a, i) => (
                      <div key={i} className={cn(
                        "flex items-center gap-2 rounded border px-2 py-1 text-xs",
                        a.priority === "HIGH" && a.daysUntilDeadline < 0
                          ? "border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/30"
                          : a.priority === "HIGH"
                          ? "border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/30"
                          : "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30"
                      )}>
                        <Badge variant="outline" className={cn(
                          "text-[9px]",
                          a.daysUntilDeadline < 0 ? "border-rose-400 text-rose-600" : "border-amber-400 text-amber-600"
                        )}>
                          {a.daysUntilDeadline < 0 ? `${Math.abs(a.daysUntilDeadline)}d late` : `${a.daysUntilDeadline}d`}
                        </Badge>
                        <span className="font-mono text-[10px]">{a.factoryPO}</span>
                        <span className="text-muted-foreground">{a.size}</span>
                        <span className="ml-auto font-medium tabular-nums">Missing: {a.missing.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="py-6 text-center text-xs text-muted-foreground">No deadline data</div>
            )}
          </CardContent>
        </Card>

        {/* 3. Data Quality Summary */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <ShieldCheck className="h-4 w-4 text-primary" />
              Data Quality Summary
            </CardTitle>
            <CardDescription className="text-xs">
              Data integrity issues that may affect reports and exports.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {insightsLoading ? (
              <div className="flex h-24 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : insights && insights.dataQuality ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Quality Score</span>
                  <Badge className={cn(
                    insights.dataQuality.qualityScore >= 90 ? "bg-emerald-100 text-emerald-700 border-emerald-200" :
                    insights.dataQuality.qualityScore >= 70 ? "bg-amber-100 text-amber-700 border-amber-200" :
                    "bg-rose-100 text-rose-700 border-rose-200"
                  )}>
                    {insights.dataQuality.qualityScore}%
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded border p-2">
                    <div className="text-muted-foreground">Missing Deadline</div>
                    <div className="text-lg font-bold tabular-nums">
                      {insights.dataQuality.missingDeadline.toLocaleString()}
                      <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                        ({insights.dataQuality.missingDeadlinePercent}%)
                      </span>
                    </div>
                  </div>
                  <div className="rounded border p-2">
                    <div className="text-muted-foreground">Output &gt; Order</div>
                    <div className="text-lg font-bold tabular-nums text-amber-600 dark:text-amber-400">
                      {insights.dataQuality.outputExceedsOrder}
                    </div>
                  </div>
                  <div className="rounded border p-2">
                    <div className="text-muted-foreground">Input &gt; Output</div>
                    <div className="text-lg font-bold tabular-nums text-rose-600 dark:text-rose-400">
                      {insights.dataQuality.inputExceedsOutput}
                    </div>
                  </div>
                  <div className="rounded border p-2">
                    <div className="text-muted-foreground">Total Rows</div>
                    <div className="text-lg font-bold tabular-nums">
                      {insights.dataQuality.totalRows.toLocaleString()}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="py-6 text-center text-xs text-muted-foreground">No quality data</div>
            )}
          </CardContent>
        </Card>

        {/* 4. Quick Stats + Quick Actions */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Zap className="h-4 w-4 text-primary" />
              Quick Stats &amp; Actions
            </CardTitle>
            <CardDescription className="text-xs">
              Today's activity and quick navigation shortcuts.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {insightsLoading ? (
              <div className="flex h-24 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : insights && insights.quickStats ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded border p-2">
                    <div className="text-muted-foreground">Entries Today</div>
                    <div className="text-lg font-bold tabular-nums">{insights.quickStats.entryCountToday}</div>
                  </div>
                  <div className="rounded border p-2">
                    <div className="text-muted-foreground">Active Factory POs</div>
                    <div className="text-lg font-bold tabular-nums">{insights.quickStats.activeFactoryPOs}</div>
                  </div>
                  <div className="rounded border p-2">
                    <div className="text-muted-foreground">Remaining Output</div>
                    <div className="text-lg font-bold tabular-nums text-amber-600 dark:text-amber-400">
                      {insights.quickStats.remainingOutput.toLocaleString()}
                    </div>
                  </div>
                  <div className="rounded border p-2">
                    <div className="text-muted-foreground">Remaining Input</div>
                    <div className="text-lg font-bold tabular-nums text-rose-600 dark:text-rose-400">
                      {insights.quickStats.remainingInput.toLocaleString()}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => setView("product-data-entry")}>
                    <PenLine className="h-3 w-3" /> Data Entry
                  </Button>
                  <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => setView("product-bulk-check")}>
                    <ClipboardCheck className="h-3 w-3" /> Bulk Check
                  </Button>
                  <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => setView("product-output-slip")}>
                    <FileOutput className="h-3 w-3" /> Output Slip
                  </Button>
                  <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => setView("product-reconciliation")}>
                    <GitCompare className="h-3 w-3" /> Reconcile
                  </Button>
                </div>
              </div>
            ) : (
              <div className="py-6 text-center text-xs text-muted-foreground">No stats available</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ---------------- Charts row: Order vs Output vs Input  +  Production by Date ---------------- */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Chart 1: Order vs Output vs Input */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Layers className="h-4 w-4" style={{ color: theme.chart }} />
              Order vs Output vs Input
            </CardTitle>
            <CardDescription className="text-xs">
              Aggregated quantity comparison for {currentProduct}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingKpis ? (
              <ChartSkeleton />
            ) : !kpis || kpis.orderQty === 0 ? (
              <EmptyState
                message="No quantity data available for the current filters."
                icon={Layers}
              />
            ) : (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={ooiChartData}
                    margin={{ top: 5, right: 20, left: -10, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} className="text-muted-foreground" />
                    <YAxis
                      tick={{ fontSize: 10 }}
                      allowDecimals={false}
                      width={64}
                      tickFormatter={(v: number) => fmt(v)}
                    />
                    <Tooltip
                      contentStyle={TOOLTIP_STYLE}
                      cursor={{ fill: "var(--muted)", opacity: 0.35 }}
                      formatter={(value: number, name: string) => [fmt(value), name]}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="Order" fill={QTY_COLORS.order} radius={[4, 4, 0, 0]} maxBarSize={80} />
                    <Bar dataKey="Output" fill={QTY_COLORS.output} radius={[4, 4, 0, 0]} maxBarSize={80} />
                    <Bar dataKey="Input" fill={QTY_COLORS.input} radius={[4, 4, 0, 0]} maxBarSize={80} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Chart 2: Production by Date (timeline, output bucket) */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <TrendingUp className="h-4 w-4" style={{ color: theme.chart }} />
              Production by Date
            </CardTitle>
            <CardDescription className="text-xs">
              Daily output quantity shipped for {currentProduct}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {timelineLoading ? (
              <ChartSkeleton />
            ) : timelineData.length === 0 ? (
              <EmptyState
                message="No output timeline records for the current filters."
                icon={TrendingUp}
              />
            ) : (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={timelineData}
                    margin={{ top: 5, right: 20, left: -10, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10 }}
                      className="text-muted-foreground"
                      minTickGap={16}
                    />
                    <YAxis
                      tick={{ fontSize: 10 }}
                      allowDecimals={false}
                      width={64}
                      tickFormatter={(v: number) => fmt(v)}
                    />
                    <Tooltip
                      contentStyle={TOOLTIP_STYLE}
                      formatter={(value: number) => [fmt(value), "Output Qty"]}
                      labelFormatter={(label: string) => `Date: ${label}`}
                    />
                    <Line
                      type="monotone"
                      dataKey="qty"
                      name="Output Qty"
                      stroke={theme.chart}
                      strokeWidth={2.5}
                      dot={{ r: 2, fill: theme.chart, strokeWidth: 0 }}
                      activeDot={{ r: 5 }}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ---------------- Alerts section ---------------- */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between gap-2 text-sm">
            <span className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Priority Alerts
            </span>
            <div className="flex items-center gap-1.5">
              {alerts && alerts.high > 0 ? (
                <Badge className={cn("border", PRIORITY_BADGE.HIGH.className)}>
                  {PRIORITY_BADGE.HIGH.dot} {alerts.high} High
                </Badge>
              ) : null}
              {alerts && alerts.medium > 0 ? (
                <Badge className={cn("border", PRIORITY_BADGE.MEDIUM.className)}>
                  {PRIORITY_BADGE.MEDIUM.dot} {alerts.medium} Medium
                </Badge>
              ) : null}
              {alerts && alerts.low > 0 ? (
                <Badge className={cn("border", PRIORITY_BADGE.LOW.className)}>
                  {PRIORITY_BADGE.LOW.dot} {alerts.low} Low
                </Badge>
              ) : null}
              <span className="ml-2 text-xs font-normal text-muted-foreground tabular-nums">
                {alerts?.alerts.length ?? 0} shown
              </span>
            </div>
          </CardTitle>
          <CardDescription className="text-xs">
            Top-priority items requiring attention — sorted by priority then deadline.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {alertsLoading ? (
            <TableSkeleton />
          ) : !alerts || alerts.alerts.length === 0 ? (
            <EmptyState
              message={`No priority alerts for ${currentProduct}. All production is on track.`}
              icon={AlertTriangle}
            />
          ) : (
            <div className="overflow-x-auto scroll-thin">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[90px]">Priority</TableHead>
                    <TableHead className="min-w-[130px]">Factory PO</TableHead>
                    <TableHead className="min-w-[120px]">Model</TableHead>
                    <TableHead className="min-w-[70px]">Size</TableHead>
                    <TableHead className="text-right">Order</TableHead>
                    <TableHead className="text-right">Output</TableHead>
                    <TableHead className="text-right">Input</TableHead>
                    <TableHead className="text-right">Missing</TableHead>
                    <TableHead className="min-w-[100px]">Deadline</TableHead>
                    <TableHead className="min-w-[120px]">Deadline Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {alerts.alerts.map((a) => {
                    const pb = PRIORITY_BADGE[a.alert.priority] ?? PRIORITY_BADGE.INFO;
                    const dsBadge = deadlineBadgeClass(a.deadlineStatus);
                    const missingTone =
                      a.missing > 0
                        ? "text-rose-600 dark:text-rose-400 font-semibold"
                        : "text-emerald-600 dark:text-emerald-400";
                    return (
                      <TableRow key={a.key} className="hover:bg-accent/40">
                        <TableCell>
                          <Badge className={cn("border", pb.className)} variant="outline">
                            <span className="mr-0.5">{pb.dot}</span>
                            {pb.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-medium">
                          <span className="inline-flex items-center gap-1.5">
                            <FactoryIcon className="h-3 w-3 text-muted-foreground" />
                            {a.factoryPO || "—"}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs">{a.model || "—"}</TableCell>
                        <TableCell className="text-xs">
                          <Badge variant="outline" className="font-mono text-[10px]">
                            {a.size || "—"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmt(a.orderQty)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-amber-600 dark:text-amber-400">
                          {fmt(a.outputQty)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                          {fmt(a.inputQty)}
                        </TableCell>
                        <TableCell className={cn("text-right tabular-nums", missingTone)}>
                          {fmt(a.missing)}
                        </TableCell>
                        <TableCell className="text-xs tabular-nums">
                          {formatDeadline(a.deadline)}
                        </TableCell>
                        <TableCell>
                          <Badge className={cn("border", dsBadge)} variant="outline">
                            {deadlineLabel(a.deadlineStatus)}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---------------- Production by Dimension (3 bar charts) ---------------- */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* By Size */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Layers className="h-4 w-4" style={{ color: theme.chart }} />
              Production by Size
            </CardTitle>
            <CardDescription className="text-xs">
              Order / Output / Input quantities per size.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {dimsLoading && sizeQ.isLoading ? (
              <ChartSkeleton height="h-64" />
            ) : sizeRows.length === 0 ? (
              <EmptyState
                message={`No size breakdown for ${currentProduct} with the current filters.`}
                icon={Layers}
              />
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={sizeRows}
                    margin={{ top: 5, right: 10, left: -15, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                    <XAxis
                      dataKey="dim"
                      tick={{ fontSize: 10 }}
                      className="text-muted-foreground"
                      interval={0}
                      angle={-25}
                      textAnchor="end"
                      height={50}
                    />
                    <YAxis
                      tick={{ fontSize: 9 }}
                      allowDecimals={false}
                      width={48}
                      tickFormatter={(v: number) => fmt(v)}
                    />
                    <Tooltip
                      contentStyle={TOOLTIP_STYLE}
                      cursor={{ fill: "var(--muted)", opacity: 0.35 }}
                      formatter={(value: number, name: string) => [fmt(value), name]}
                      labelFormatter={(label: string) => `Size: ${label}`}
                    />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <Bar dataKey="orderQty" name="Order" fill={QTY_COLORS.order} radius={[3, 3, 0, 0]} />
                    <Bar dataKey="outputQty" name="Output" fill={QTY_COLORS.output} radius={[3, 3, 0, 0]} />
                    <Bar dataKey="inputQty" name="Input" fill={QTY_COLORS.input} radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        {/* By Color */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Tag className="h-4 w-4" style={{ color: theme.chart }} />
              Production by Color
            </CardTitle>
            <CardDescription className="text-xs">
              Order / Output / Input quantities per color code.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {dimsLoading && colorQ.isLoading ? (
              <ChartSkeleton height="h-64" />
            ) : colorRows.length === 0 ? (
              <EmptyState
                message={`No color breakdown for ${currentProduct} with the current filters.`}
                icon={Tag}
              />
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={colorRows}
                    layout="vertical"
                    margin={{ top: 5, right: 10, left: 10, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" horizontal={false} />
                    <XAxis
                      type="number"
                      tick={{ fontSize: 9 }}
                      allowDecimals={false}
                      tickFormatter={(v: number) => fmt(v)}
                    />
                    <YAxis
                      dataKey="dim"
                      type="category"
                      tick={{ fontSize: 9 }}
                      width={90}
                      className="text-muted-foreground"
                    />
                    <Tooltip
                      contentStyle={TOOLTIP_STYLE}
                      cursor={{ fill: "var(--muted)", opacity: 0.35 }}
                      formatter={(value: number, name: string) => [fmt(value), name]}
                      labelFormatter={(label: string) => `Color: ${label}`}
                    />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <Bar dataKey="orderQty" name="Order" fill={QTY_COLORS.order} radius={[0, 3, 3, 0]} />
                    <Bar dataKey="outputQty" name="Output" fill={QTY_COLORS.output} radius={[0, 3, 3, 0]} />
                    <Bar dataKey="inputQty" name="Input" fill={QTY_COLORS.input} radius={[0, 3, 3, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        {/* By Model */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Tag className="h-4 w-4" style={{ color: theme.chart }} />
              Production by Model
            </CardTitle>
            <CardDescription className="text-xs">
              Order / Output / Input quantities per model.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {dimsLoading && modelQ.isLoading ? (
              <ChartSkeleton height="h-64" />
            ) : modelRows.length === 0 ? (
              <EmptyState
                message={`No model breakdown for ${currentProduct} with the current filters.`}
                icon={Tag}
              />
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={modelRows}
                    margin={{ top: 5, right: 10, left: -15, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                    <XAxis
                      dataKey="dim"
                      tick={{ fontSize: 9 }}
                      className="text-muted-foreground"
                      interval={0}
                      angle={-25}
                      textAnchor="end"
                      height={50}
                    />
                    <YAxis
                      tick={{ fontSize: 9 }}
                      allowDecimals={false}
                      width={48}
                      tickFormatter={(v: number) => fmt(v)}
                    />
                    <Tooltip
                      contentStyle={TOOLTIP_STYLE}
                      cursor={{ fill: "var(--muted)", opacity: 0.35 }}
                      formatter={(value: number, name: string) => [fmt(value), name]}
                      labelFormatter={(label: string) => `Model: ${label}`}
                    />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <Bar dataKey="orderQty" name="Order" fill={QTY_COLORS.order} radius={[3, 3, 0, 0]} />
                    <Bar dataKey="outputQty" name="Output" fill={QTY_COLORS.output} radius={[3, 3, 0, 0]} />
                    <Bar dataKey="inputQty" name="Input" fill={QTY_COLORS.input} radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default ProductDashboardView;
