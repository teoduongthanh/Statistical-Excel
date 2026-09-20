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
  ListTree,
  ChevronRight,
  ChevronDown,
  Tag,
  Shirt,
  Layers,
  ShieldCheck,
  Zap,
  PenLine,
  ClipboardCheck,
  FileOutput,
  GitCompare,
  LayoutDashboard,
  BarChart3,
  History as HistoryIcon,
  Bug,
  CheckCircle2,
  Clock,
  User as UserIcon,
  Database,
  PlusCircle,
  PencilLine,
  Trash2,
  Download,
  CircleDot,
  Hourglass,
  PackageCheck as PackageCheck2,
  AlertOctagon,
  TimerReset,
  CalendarDays,
  FileSpreadsheet,
  FileDown,
  ArrowRight,
  Circle,
  GitCommitHorizontal,
  CalendarCheck,
  Filter,
} from "lucide-react";
import * as XLSX from "xlsx";
import { api } from "@/lib/api-client";
import { cn, formatDateDisplay } from "@/lib/utils";
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
import { toast } from "sonner";

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
  return formatDateDisplay(s);
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

/** Small info cell used in the Order Created detail dialog. */
function InfoCell({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="rounded border bg-muted/20 p-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("mt-0.5 text-xs font-medium", mono && "font-mono")}>{value}</div>
    </div>
  );
}

/** Quantity cell used in the Order Created detail dialog. */
function QtyCell({ label, value, tone }: { label: string; value: number; tone?: "emerald" | "teal" | "amber" | "rose" }) {
  const toneClass =
    tone === "emerald"
      ? "text-emerald-700 dark:text-emerald-300"
      : tone === "teal"
        ? "text-teal-700 dark:text-teal-300"
        : tone === "amber"
          ? "text-amber-700 dark:text-amber-300"
          : tone === "rose"
            ? "text-rose-700 dark:text-rose-300"
            : "text-foreground";
  return (
    <div className="rounded border bg-muted/20 p-2 text-center">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("mt-0.5 text-base font-bold tabular-nums", toneClass)}>{value.toLocaleString()}</div>
    </div>
  );
}

/** Progress cell used in the Order Created detail dialog. */
function ProgressCell({ label, value, tone }: { label: string; value: number; tone?: "emerald" | "teal" }) {
  const toneClass =
    tone === "emerald"
      ? "text-emerald-700 dark:text-emerald-300"
      : tone === "teal"
        ? "text-teal-700 dark:text-teal-300"
        : "text-foreground";
  return (
    <div className="rounded border bg-muted/20 p-2 text-center">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("mt-0.5 text-base font-bold tabular-nums", toneClass)}>{value}%</div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Order Progress / Anomaly / History helpers
// ----------------------------------------------------------------------------

type DashboardTab = "overview" | "progress" | "daily" | "timeline" | "history" | "anomaly" | "reports" | "drilldown" | "created";

/** Badge classes for Order Progress daily-snapshot status values. */
const PROGRESS_STATUS_BADGE: Record<string, string> = {
  NOT_STARTED:
    "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-300",
  IN_PROGRESS:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300",
  OUTPUT_COMPLETED:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300",
  INPUT_COMPLETED:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300",
  OVER_OUTPUT:
    "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300",
  OVER_INPUT:
    "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300",
  INPUT_IN_PROGRESS:
    "border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-900/50 dark:bg-teal-950/40 dark:text-teal-300",
};

function progressStatusBadgeClass(status: string): string {
  return (
    PROGRESS_STATUS_BADGE[(status || "").toUpperCase()] ??
    "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-300"
  );
}

function progressStatusLabel(status: string): string {
  const s = (status || "").replace(/_/g, " ").toLowerCase();
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Anomaly severity → card tint + badge classes. */
function anomalyToneClass(severity: string): string {
  const s = (severity || "").toUpperCase();
  if (s === "ERROR" || s === "HIGH")
    return "border-rose-200 bg-rose-50 dark:border-rose-900/50 dark:bg-rose-950/40";
  if (s === "MEDIUM" || s === "WARNING")
    return "border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/40";
  return "border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/40";
}

function anomalyBadgeClass(severity: string): string {
  const s = (severity || "").toUpperCase();
  if (s === "ERROR" || s === "HIGH")
    return "border-rose-300 bg-rose-100 text-rose-700 dark:border-rose-800 dark:bg-rose-950/60 dark:text-rose-300";
  if (s === "MEDIUM" || s === "WARNING")
    return "border-amber-300 bg-amber-100 text-amber-700 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300";
  return "border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300";
}

/** Bucket a raw AuditLog action into one of CREATE/UPDATE/DELETE/IMPORT/EXPORT/OTHER. */
function bucketAction(action: string): {
  bucket: "CREATE" | "UPDATE" | "DELETE" | "IMPORT" | "EXPORT" | "OTHER";
  label: string;
  badgeClass: string;
} {
  const a = (action || "").toUpperCase();
  if (a === "IMPORT")
    return {
      bucket: "IMPORT",
      label: "IMPORT",
      badgeClass:
        "border-teal-300 bg-teal-100 text-teal-700 dark:border-teal-800 dark:bg-teal-950/60 dark:text-teal-300",
    };
  if (a === "EXPORT")
    return {
      bucket: "EXPORT",
      label: "EXPORT",
      badgeClass:
        "border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300",
    };
  if (a.includes("CREATE"))
    return {
      bucket: "CREATE",
      label: a.includes("ENTRY") ? "ENTRY CREATE" : "CREATE",
      badgeClass:
        "border-emerald-300 bg-emerald-100 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
    };
  if (a.includes("DELETE"))
    return {
      bucket: "DELETE",
      label: a.includes("ENTRY") ? "ENTRY DELETE" : "DELETE",
      badgeClass:
        "border-rose-300 bg-rose-100 text-rose-700 dark:border-rose-800 dark:bg-rose-950/60 dark:text-rose-300",
    };
  if (a.includes("EDIT") || a.includes("UPDATE"))
    return {
      bucket: "UPDATE",
      label: a.includes("ENTRY") ? "ENTRY EDIT" : "UPDATE",
      badgeClass:
        "border-amber-300 bg-amber-100 text-amber-700 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
    };
  return {
    bucket: "OTHER",
    label: a || "OTHER",
    badgeClass:
      "border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300",
  };
}

function formatTimestamp(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s);
  if (isNaN(d.getTime())) return String(s);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatShortDate(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s);
  if (isNaN(d.getTime())) return String(s);
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

// ----------------------------------------------------------------------------
// XLSX (client-side) export helpers — used by the "Reports" tab.
// Builds a workbook from already-fetched data and triggers a download.
// Filename format: Production_Report_<type>_<YYYY-MM-DD>.xlsx
// ----------------------------------------------------------------------------

function getReportFileName(type: string): string {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  return `Production_Report_${type}_${yyyy}-${mm}-${dd}.xlsx`;
}

function downloadWorkbook(sheetName: string, rows: Record<string, unknown>[], fileName: string): void {
  const wb = XLSX.utils.book_new();
  // Truncate sheet name to 31 chars (Excel limit) and remove invalid chars.
  const safeName = (sheetName || "Sheet1").replace(/[:\\/?*\[\]]/g, "").slice(0, 31) || "Sheet1";
  const ws = XLSX.utils.json_to_sheet(rows.length > 0 ? rows : [{ "No data": "" }]);
  XLSX.utils.book_append_sheet(wb, ws, safeName);
  XLSX.writeFile(wb, fileName);
}

// ----------------------------------------------------------------------------
// Small stat tile for the new tabs (more compact than the main StatCard)
// ----------------------------------------------------------------------------

interface MiniStatProps {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  iconClass: string;
  loading?: boolean;
  valueTone?: string;
  sub?: string;
}

function MiniStat({ label, value, icon: Icon, iconClass, loading, valueTone, sub }: MiniStatProps) {
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-3">
        <div className="flex items-center gap-2.5">
          <div
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
              iconClass,
            )}
          >
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {label}
            </p>
            {loading ? (
              <Skeleton className="mt-1 h-5 w-16" />
            ) : (
              <p
                className={cn(
                  "text-lg font-bold leading-tight tabular-nums",
                  valueTone,
                )}
              >
                {value}
              </p>
            )}
            {sub ? <p className="mt-0.5 text-[10px] text-muted-foreground">{sub}</p> : null}
          </div>
        </div>
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

  // ---- Dashboard tab state ----
  const [dashboardTab, setDashboardTab] = React.useState<DashboardTab>("overview");

  // ---- Order Progress (Tab 2/3/4) ----
  // Re-uses the filter-bar's applied poNo/factoryPO/dateFrom/dateTo so the
  // progress tab respects the same filters as the rest of the dashboard.
  const orderProgressQ = useQuery({
    queryKey: ["order-progress", currentProduct, appliedFilters, refreshKey],
    queryFn: () =>
      api.getOrderProgress({
        productType: currentProduct,
        poNo: applied.poNo,
        factoryPO: applied.factoryPO,
        dateFrom: applied.dateFrom,
        dateTo: applied.dateTo,
        mode: applied.dateFrom || applied.dateTo ? "range" : "current",
      }),
    staleTime: 30_000,
  });
  const orderProgress = orderProgressQ.data;
  const orderProgressLoading = orderProgressQ.isLoading || orderProgressQ.isFetching;
  const orderProgressError = orderProgressQ.error;
  const progressSummary = orderProgress?.summary;
  const dailySnapshots = orderProgress?.dailySnapshots ?? [];
  const anomalies = orderProgress?.anomalies ?? [];

  // ---- Data Change History (Tab 5) ----
  const historyQ = useQuery({
    queryKey: ["data-change-history", currentProduct, appliedFilters, refreshKey],
    queryFn: () =>
      api.getDataChangeHistory({
        productType: currentProduct,
        dateFrom: applied.dateFrom,
        dateTo: applied.dateTo,
        limit: 200,
      }),
    staleTime: 30_000,
  });
  const historyData = historyQ.data;
  const historyLoading = historyQ.isLoading || historyQ.isFetching;
  const historyError = historyQ.error;
  const historyRows = historyData?.history ?? [];
  const historySummary = historyData?.summary;

  // ---- Drill-Down (Tab 6) ----
  const [drilldownSearch, setDrilldownSearch] = React.useState("");
  const [expandedPOs, setExpandedPOs] = React.useState<Set<string>>(new Set());
  const [expandedFPOs, setExpandedFPOs] = React.useState<Set<string>>(new Set());
  const [sizeDetail, setSizeDetail] = React.useState<{ poNo: string; factoryPO: string; size: string } | null>(null);
  const [sizeTransactions, setSizeTransactions] = React.useState<any[] | null>(null);
  const [loadingTransactions, setLoadingTransactions] = React.useState(false);

  const drilldownQ = useQuery({
    queryKey: ["order-drilldown", currentProduct, refreshKey],
    queryFn: () => api.getOrderDrilldown({ productType: currentProduct }),
    // Enabled on both drilldown + reports tabs (reports tab exports the hierarchy).
    enabled: dashboardTab === "drilldown" || dashboardTab === "reports",
    staleTime: 30_000,
  });
  const drilldownData = drilldownQ.data;
  const drilldownLoading = drilldownQ.isLoading || drilldownQ.isFetching;

  // Filter hierarchy by search
  const filteredHierarchy = React.useMemo(() => {
    if (!drilldownData?.hierarchy) return [];
    const q = drilldownSearch.trim().toLowerCase();
    if (!q) return drilldownData.hierarchy;
    return drilldownData.hierarchy
      .map((po) => {
        const poMatch = po.poNo.toLowerCase().includes(q);
        const filteredFPOs = po.factoryPOs
          .map((fpo) => {
            const fpoMatch = fpo.factoryPO.toLowerCase().includes(q) || poMatch;
            const filteredSizes = fpo.sizes.filter((s) =>
              fpoMatch || s.size.toLowerCase().includes(q) || s.model.toLowerCase().includes(q) || s.sku.toLowerCase().includes(q)
            );
            if (filteredSizes.length === 0 && !fpoMatch) return null;
            return { ...fpo, sizes: fpoMatch ? fpo.sizes : filteredSizes };
          })
          .filter(Boolean) as any[];
        if (filteredFPOs.length === 0 && !poMatch) return null;
        return { ...po, factoryPOs: poMatch ? po.factoryPOs : filteredFPOs };
      })
      .filter(Boolean) as any[];
  }, [drilldownData, drilldownSearch]);

  async function loadSizeTransactions(poNo: string, factoryPO: string, size: string) {
    setSizeDetail({ poNo, factoryPO, size });
    setSizeTransactions(null);
    setLoadingTransactions(true);
    try {
      const res = await api.getOrderDrilldown({ productType: currentProduct, poNo, factoryPO, size, mode: "transactions" });
      setSizeTransactions(res.transactions || []);
    } catch (e) {
      toast.error("Failed to load transactions");
    } finally {
      setLoadingTransactions(false);
    }
  }

  function togglePO(poNo: string) {
    setExpandedPOs((prev) => {
      const next = new Set(prev);
      if (next.has(poNo)) next.delete(poNo);
      else next.add(poNo);
      return next;
    });
  }
  function toggleFPO(key: string) {
    setExpandedFPOs((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // ---- Order Created (Tab 9) ----
  // Track progress of all orders created on a specific date.
  const [selectedCreatedDate, setSelectedCreatedDate] = React.useState<string>("");
  const [createdSizeDetail, setCreatedSizeDetail] = React.useState<any>(null);
  const [createdTransactions, setCreatedTransactions] = React.useState<any[] | null>(null);
  const [loadingCreatedTx, setLoadingCreatedTx] = React.useState(false);

  const createdProgressQ = useQuery({
    queryKey: ["order-created-progress", currentProduct, selectedCreatedDate, refreshKey],
    queryFn: () =>
      api.getOrderCreatedProgress({
        productType: currentProduct,
        createdDate: selectedCreatedDate || undefined,
        mode: "batch",
      }),
    enabled: dashboardTab === "created",
    staleTime: 30_000,
  });
  const createdGroups = createdProgressQ.data?.groups ?? [];
  const createdSummary = createdProgressQ.data?.summary;
  const createdDateOptions = createdProgressQ.data?.dateOptions ?? [];
  const createdLoading = createdProgressQ.isLoading || createdProgressQ.isFetching;
  const createdError = createdProgressQ.error;

  // Pick the largest group's timeline for the progress charts.
  const createdTimelineForCharts = React.useMemo(() => {
    if (createdGroups.length === 0) return [];
    let largest = createdGroups[0];
    for (const g of createdGroups) {
      if ((g.timeline?.length ?? 0) > (largest.timeline?.length ?? 0)) largest = g;
    }
    return (largest.timeline ?? []).map((t) => ({
      date: formatDateDisplay(t.date),
      outputProgress: Number(t.outputProgress ?? 0),
      inputProgress: Number(t.inputProgress ?? 0),
      dailyOutput: Number(t.dailyOutput ?? 0),
      dailyInput: Number(t.dailyInput ?? 0),
    }));
  }, [createdGroups]);

  async function loadCreatedTransactions(poNo: string, factoryPO: string, size: string) {
    setCreatedSizeDetail({ poNo, factoryPO, size });
    setCreatedTransactions(null);
    setLoadingCreatedTx(true);
    try {
      const res = await api.getOrderCreatedProgress({
        productType: currentProduct,
        mode: "transactions",
        poNo,
        factoryPO,
        size,
      });
      setCreatedTransactions(res.transactions || []);
    } catch (e) {
      toast.error("Failed to load transactions");
    } finally {
      setLoadingCreatedTx(false);
    }
  }

  // Derived: anomaly counts by type for the Anomaly tab summary cards
  const anomalyTypeCounts = React.useMemo(() => {
    const counts = { OVER_OUTPUT: 0, INPUT_EXCEEDS_OUTPUT: 0, DEADLINE_RISK: 0 } as Record<string, number>;
    for (const a of anomalies) {
      const t = (a.type || "").toUpperCase();
      counts[t] = (counts[t] ?? 0) + 1;
    }
    return counts;
  }, [anomalies]);

  // Derived: daily-activity totals for the Daily Activity tab summary
  const dailyActivityTotals = React.useMemo(() => {
    let totalOutput = 0;
    let totalInput = 0;
    for (const s of dailySnapshots) {
      totalOutput += Number(s.dailyOutput ?? 0) || 0;
      totalInput += Number(s.dailyInput ?? 0) || 0;
    }
    return { totalOutput, totalInput };
  }, [dailySnapshots]);

  // Derived: history by-action breakdown (re-bucketed into CREATE/UPDATE/DELETE/IMPORT/EXPORT/OTHER)
  const historyBuckets = React.useMemo(() => {
    const out = {
      CREATE: 0,
      UPDATE: 0,
      DELETE: 0,
      IMPORT: 0,
      EXPORT: 0,
      OTHER: 0,
    } as Record<string, number>;
    for (const h of historyRows) {
      const { bucket } = bucketAction(h.action);
      out[bucket] = (out[bucket] ?? 0) + 1;
    }
    return out;
  }, [historyRows]);

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

      {/* ---------------- Dashboard Tabs ---------------- */}
      <Tabs
        value={dashboardTab}
        onValueChange={(v) => setDashboardTab(v as DashboardTab)}
        className="space-y-4"
      >
        <TabsList className="grid h-auto w-full grid-cols-2 sm:grid-cols-4 lg:grid-cols-9">
          <TabsTrigger value="overview" className="gap-1.5 py-1.5 text-xs">
            <LayoutDashboard className="h-3.5 w-3.5" /> Overview
          </TabsTrigger>
          <TabsTrigger value="progress" className="gap-1.5 py-1.5 text-xs">
            <TrendingUp className="h-3.5 w-3.5" /> Order Progress
          </TabsTrigger>
          <TabsTrigger value="daily" className="gap-1.5 py-1.5 text-xs">
            <BarChart3 className="h-3.5 w-3.5" /> Daily Activity
          </TabsTrigger>
          <TabsTrigger value="timeline" className="gap-1.5 py-1.5 text-xs">
            <CalendarDays className="h-3.5 w-3.5" /> Order Timeline
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-1.5 py-1.5 text-xs">
            <HistoryIcon className="h-3.5 w-3.5" /> Data Change History
          </TabsTrigger>
          <TabsTrigger value="anomaly" className="gap-1.5 py-1.5 text-xs">
            <Bug className="h-3.5 w-3.5" /> Anomaly Detection
          </TabsTrigger>
          <TabsTrigger value="reports" className="gap-1.5 py-1.5 text-xs">
            <FileSpreadsheet className="h-3.5 w-3.5" /> Reports
          </TabsTrigger>
          <TabsTrigger value="drilldown" className="gap-1.5 py-1.5 text-xs">
            <ListTree className="h-3.5 w-3.5" /> Drill-Down
          </TabsTrigger>
          <TabsTrigger value="created" className="gap-1.5 py-1.5 text-xs">
            <CalendarCheck className="h-3.5 w-3.5" /> Order Created
          </TabsTrigger>
        </TabsList>

      {/* ---------------- Tab: Overview (wraps ALL existing dashboard content) ---------------- */}
      <TabsContent value="overview" className="space-y-6 outline-none">

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

      </TabsContent>
      {/* ---------------- /Tab: Overview ---------------- */}

      {/* ================================================================== */}
      {/* Tab 2: Order Progress                                              */}
      {/* ================================================================== */}
      <TabsContent value="progress" className="space-y-4 outline-none">
        {orderProgressLoading ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-20" />
              ))}
            </div>
            <Skeleton className="h-64" />
          </div>
        ) : orderProgressError ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Failed to load order progress</AlertTitle>
            <AlertDescription>
              {orderProgressError instanceof Error ? orderProgressError.message : "Unknown error."}{" "}
              <button
                type="button"
                onClick={() => bumpRefresh()}
                className="underline underline-offset-2 hover:opacity-80"
              >
                Try again
              </button>
            </AlertDescription>
          </Alert>
        ) : !progressSummary ? (
          <EmptyState
            message={`No order-progress data available for ${currentProduct}.`}
            icon={TrendingUp}
          />
        ) : (
          <>
            {/* 8 stat cards: Total Order / Total Output / Total Input / Pending / Remaining / Avg Output % / Avg Input % / Input vs Output % */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
              <MiniStat
                label="Total Order"
                value={fmt(progressSummary.totalOrderQty)}
                icon={ClipboardList}
                iconClass="bg-slate-100 text-slate-600 dark:bg-slate-800/60 dark:text-slate-300"
                sub={`${fmt(progressSummary.totalOrders)} orders`}
              />
              <MiniStat
                label="Total Output"
                value={fmt(progressSummary.totalOutputQty)}
                icon={Truck}
                iconClass="bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
              />
              <MiniStat
                label="Total Input"
                value={fmt(progressSummary.totalInputQty)}
                icon={PackageCheck}
                iconClass="bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
              />
              <MiniStat
                label="Pending"
                value={fmt(progressSummary.pending)}
                icon={Hourglass}
                iconClass="bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
                sub="output − input"
              />
              <MiniStat
                label="Remaining"
                value={fmt(progressSummary.remaining)}
                icon={TimerReset}
                iconClass="bg-slate-100 text-slate-600 dark:bg-slate-800/60 dark:text-slate-300"
                sub="order − output"
              />
              <MiniStat
                label="Avg Output %"
                value={fmtPct(progressSummary.avgOutputProgress)}
                icon={TrendingUp}
                iconClass={cn(
                  "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
                  clampPct(progressSummary.avgOutputProgress) >= 95 &&
                    "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
                  clampPct(progressSummary.avgOutputProgress) < 80 &&
                    "bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300",
                )}
              />
              <MiniStat
                label="Avg Input %"
                value={fmtPct(progressSummary.avgInputProgress)}
                icon={Gauge}
                iconClass={cn(
                  "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
                  clampPct(progressSummary.avgInputProgress) < 80 &&
                    "bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300",
                  clampPct(progressSummary.avgInputProgress) >= 80 &&
                    clampPct(progressSummary.avgInputProgress) < 95 &&
                    "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
                )}
              />
              <MiniStat
                label="Input vs Output %"
                value={fmtPct(progressSummary.avgInputVsOutput)}
                icon={GitCompare}
                iconClass={cn(
                  "bg-teal-100 text-teal-700 dark:bg-teal-950/50 dark:text-teal-300",
                  clampPct(progressSummary.avgInputVsOutput) < 80 &&
                    "bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300",
                )}
              />
            </div>

            {/* 4 status cards: Not Started / In Progress / Output Completed / Input Completed */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <MiniStat
                label="Not Started"
                value={fmt(progressSummary.notStarted)}
                icon={CircleDot}
                iconClass="bg-slate-100 text-slate-600 dark:bg-slate-800/60 dark:text-slate-300"
              />
              <MiniStat
                label="In Progress"
                value={fmt(progressSummary.inProgress)}
                icon={Activity}
                iconClass="bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
              />
              <MiniStat
                label="Output Completed"
                value={fmt(progressSummary.outputCompleted)}
                icon={CheckCircle2}
                iconClass="bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
              />
              <MiniStat
                label="Input Completed"
                value={fmt(progressSummary.inputCompleted)}
                icon={PackageCheck2}
                iconClass="bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
              />
            </div>

            {/* 2 over-status cards: Over Output / Over Input (rose colored) */}
            <div className="grid grid-cols-2 gap-3">
              <MiniStat
                label="Over Output"
                value={fmt(progressSummary.overOutput)}
                icon={AlertOctagon}
                iconClass="bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300"
                valueTone="text-rose-700 dark:text-rose-400"
                sub="output > order"
              />
              <MiniStat
                label="Over Input"
                value={fmt(progressSummary.overInput)}
                icon={AlertOctagon}
                iconClass="bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300"
                valueTone="text-rose-700 dark:text-rose-400"
                sub="input > output"
              />
            </div>

            {/* Daily snapshot table */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex items-center gap-2">
                    <Layers className="h-4 w-4" style={{ color: theme.chart }} />
                    Daily Snapshots
                  </span>
                  <Badge variant="secondary" className="text-[10px] tabular-nums">
                    {dailySnapshots.length} days
                  </Badge>
                </CardTitle>
                <CardDescription className="text-xs">
                  Daily output / input progress for {currentProduct}.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {dailySnapshots.length === 0 ? (
                  <EmptyState
                    message="No daily snapshots for the current filters."
                    icon={Layers}
                  />
                ) : (
                  <div className="max-h-[500px] overflow-y-auto scroll-thin">
                    <Table>
                      <TableHeader className="sticky top-0 z-10 bg-card">
                        <TableRow>
                          <TableHead className="min-w-[110px]">Date</TableHead>
                          <TableHead className="text-right">Daily Order</TableHead>
                          <TableHead className="text-right">Daily Output</TableHead>
                          <TableHead className="text-right">Daily Input</TableHead>
                          <TableHead className="text-right">Total Output</TableHead>
                          <TableHead className="text-right">Total Input</TableHead>
                          <TableHead className="text-right">Pending</TableHead>
                          <TableHead className="text-right">Remaining</TableHead>
                          <TableHead className="text-right">Output %</TableHead>
                          <TableHead className="text-right">Input %</TableHead>
                          <TableHead className="text-right">Input vs Output %</TableHead>
                          <TableHead className="min-w-[120px]">Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {dailySnapshots.map((s) => (
                          <TableRow key={s.date} className="hover:bg-accent/40">
                            <TableCell className="text-xs tabular-nums">
                              {formatShortDate(s.date)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-slate-600 dark:text-slate-300">
                              {fmt(s.dailyOrder)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-amber-600 dark:text-amber-400">
                              {fmt(s.dailyOutput)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                              {fmt(s.dailyInput)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {fmt(s.totalOutput)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {fmt(s.totalInput)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-amber-600 dark:text-amber-400">
                              {fmt(s.pending)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-slate-600 dark:text-slate-300">
                              {fmt(s.remaining)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              <span className={rateTone(clampPct(s.outputProgress))}>
                                {fmtPct(s.outputProgress)}
                              </span>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              <span className={rateTone(clampPct(s.inputProgress))}>
                                {fmtPct(s.inputProgress)}
                              </span>
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-teal-600 dark:text-teal-400">
                              {fmtPct(s.inputVsOutput)}
                            </TableCell>
                            <TableCell>
                              <Badge
                                className={cn("border", progressStatusBadgeClass(s.status))}
                                variant="outline"
                              >
                                {progressStatusLabel(s.status)}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </TabsContent>

      {/* ================================================================== */}
      {/* Tab 3: Daily Activity                                              */}
      {/* ================================================================== */}
      <TabsContent value="daily" className="space-y-4 outline-none">
        {orderProgressLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-80" />
            <div className="grid grid-cols-2 gap-3">
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
            </div>
          </div>
        ) : orderProgressError ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Failed to load daily activity</AlertTitle>
            <AlertDescription>
              {orderProgressError instanceof Error ? orderProgressError.message : "Unknown error."}{" "}
              <button
                type="button"
                onClick={() => bumpRefresh()}
                className="underline underline-offset-2 hover:opacity-80"
              >
                Try again
              </button>
            </AlertDescription>
          </Alert>
        ) : dailySnapshots.length === 0 ? (
          <EmptyState
            message={`No daily activity for ${currentProduct} with the current filters.`}
            icon={BarChart3}
          />
        ) : (
          <>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <BarChart3 className="h-4 w-4" style={{ color: theme.chart }} />
                  Daily Output vs Input
                </CardTitle>
                <CardDescription className="text-xs">
                  Daily shipped output vs received input for {currentProduct}.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={dailySnapshots}
                      margin={{ top: 5, right: 20, left: -10, bottom: 0 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        className="stroke-muted"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 10 }}
                        className="text-muted-foreground"
                        minTickGap={16}
                        tickFormatter={(v: string) => formatShortDate(v)}
                      />
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
                        labelFormatter={(label: string) => `Date: ${formatShortDate(label)}`}
                      />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar
                        dataKey="dailyOutput"
                        name="Daily Output"
                        fill="oklch(0.6 0.13 162)"
                        radius={[3, 3, 0, 0]}
                        maxBarSize={48}
                      />
                      <Bar
                        dataKey="dailyInput"
                        name="Daily Input"
                        fill="oklch(0.6 0.1 195)"
                        radius={[3, 3, 0, 0]}
                        maxBarSize={48}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <MiniStat
                label="Total Daily Output (range)"
                value={fmt(dailyActivityTotals.totalOutput)}
                icon={Truck}
                iconClass="bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                sub={`across ${dailySnapshots.length} day${dailySnapshots.length === 1 ? "" : "s"}`}
              />
              <MiniStat
                label="Total Daily Input (range)"
                value={fmt(dailyActivityTotals.totalInput)}
                icon={PackageCheck}
                iconClass="bg-teal-100 text-teal-700 dark:bg-teal-950/50 dark:text-teal-300"
                sub={`across ${dailySnapshots.length} day${dailySnapshots.length === 1 ? "" : "s"}`}
              />
            </div>

            {/* Chart 2: Pending quantity over time (amber line) */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Hourglass className="h-4 w-4 text-amber-500" />
                  Pending Quantity Over Time
                </CardTitle>
                <CardDescription className="text-xs">
                  Daily pending (output − input) quantity for {currentProduct}.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={dailySnapshots}
                      margin={{ top: 5, right: 20, left: -10, bottom: 0 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        className="stroke-muted"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 10 }}
                        className="text-muted-foreground"
                        minTickGap={16}
                        tickFormatter={(v: string) => formatShortDate(v)}
                      />
                      <YAxis
                        tick={{ fontSize: 10 }}
                        allowDecimals={false}
                        width={64}
                        tickFormatter={(v: number) => fmt(v)}
                      />
                      <Tooltip
                        contentStyle={TOOLTIP_STYLE}
                        formatter={(value: number) => [fmt(value), "Pending"]}
                        labelFormatter={(label: string) => `Date: ${formatShortDate(label)}`}
                      />
                      <Line
                        type="monotone"
                        dataKey="pending"
                        name="Pending"
                        stroke="oklch(0.74 0.16 75)"
                        strokeWidth={2.5}
                        dot={{ r: 2, fill: "oklch(0.74 0.16 75)", strokeWidth: 0 }}
                        activeDot={{ r: 5 }}
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Chart 3: Remaining order over time (rose line) */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <TimerReset className="h-4 w-4 text-rose-500" />
                  Remaining Order Over Time
                </CardTitle>
                <CardDescription className="text-xs">
                  Daily remaining (order − output) quantity for {currentProduct}.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={dailySnapshots}
                      margin={{ top: 5, right: 20, left: -10, bottom: 0 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        className="stroke-muted"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 10 }}
                        className="text-muted-foreground"
                        minTickGap={16}
                        tickFormatter={(v: string) => formatShortDate(v)}
                      />
                      <YAxis
                        tick={{ fontSize: 10 }}
                        allowDecimals={false}
                        width={64}
                        tickFormatter={(v: number) => fmt(v)}
                      />
                      <Tooltip
                        contentStyle={TOOLTIP_STYLE}
                        formatter={(value: number) => [fmt(value), "Remaining"]}
                        labelFormatter={(label: string) => `Date: ${formatShortDate(label)}`}
                      />
                      <Line
                        type="monotone"
                        dataKey="remaining"
                        name="Remaining"
                        stroke="oklch(0.62 0.21 18)"
                        strokeWidth={2.5}
                        dot={{ r: 2, fill: "oklch(0.62 0.21 18)", strokeWidth: 0 }}
                        activeDot={{ r: 5 }}
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </TabsContent>

      {/* ================================================================== */}
      {/* Tab 4: Order Timeline (NEW — LineChart + vertical event timeline)  */}
      {/* ================================================================== */}
      <TabsContent value="timeline" className="space-y-4 outline-none">
        {orderProgressLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-80" />
            <Skeleton className="h-96" />
          </div>
        ) : orderProgressError ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Failed to load order timeline</AlertTitle>
            <AlertDescription>
              {orderProgressError instanceof Error ? orderProgressError.message : "Unknown error."}{" "}
              <button
                type="button"
                onClick={() => bumpRefresh()}
                className="underline underline-offset-2 hover:opacity-80"
              >
                Try again
              </button>
            </AlertDescription>
          </Alert>
        ) : dailySnapshots.length === 0 ? (
          <EmptyState
            message={`No order timeline data for ${currentProduct} with the current filters.`}
            icon={CalendarDays}
          />
        ) : (
          <>
            {/* Chart: 3-line progress chart (Output % / Input % / Order 100% ref) */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <CalendarDays className="h-4 w-4" style={{ color: theme.chart }} />
                  Output / Input Progress Over Time
                </CardTitle>
                <CardDescription className="text-xs">
                  Daily cumulative output &amp; input progress (%) vs the 100% order reference line.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={dailySnapshots}
                      margin={{ top: 5, right: 20, left: -10, bottom: 0 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        className="stroke-muted"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 10 }}
                        className="text-muted-foreground"
                        minTickGap={16}
                        tickFormatter={(v: string) => formatShortDate(v)}
                      />
                      <YAxis
                        tick={{ fontSize: 10 }}
                        allowDecimals={false}
                        width={48}
                        domain={[0, 110]}
                        tickFormatter={(v: number) => `${v}%`}
                      />
                      <Tooltip
                        contentStyle={TOOLTIP_STYLE}
                        formatter={(value: number, name: string) => [`${Number(value).toFixed(1)}%`, name]}
                        labelFormatter={(label: string) => `Date: ${formatShortDate(label)}`}
                      />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Line
                        type="monotone"
                        dataKey="outputProgress"
                        name="Output %"
                        stroke="oklch(0.6 0.13 162)"
                        strokeWidth={2.5}
                        dot={false}
                        activeDot={{ r: 4 }}
                        isAnimationActive={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="inputProgress"
                        name="Input %"
                        stroke="oklch(0.6 0.1 195)"
                        strokeWidth={2.5}
                        dot={false}
                        activeDot={{ r: 4 }}
                        isAnimationActive={false}
                      />
                      <Line
                        type="monotone"
                        dataKey={() => 100}
                        name="Order (100%)"
                        stroke="oklch(0.55 0.025 220)"
                        strokeWidth={1.5}
                        strokeDasharray="6 4"
                        dot={false}
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Vertical timeline list */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex items-center gap-2">
                    <GitCommitHorizontal className="h-4 w-4" style={{ color: theme.chart }} />
                    Daily Events Timeline
                  </span>
                  <Badge variant="secondary" className="text-[10px] tabular-nums">
                    {dailySnapshots.length} days
                  </Badge>
                </CardTitle>
                <CardDescription className="text-xs">
                  Daily OUTPUT / INPUT / ORDER deltas with cumulative state after each date.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="max-h-[600px] space-y-3 overflow-y-auto scroll-thin pr-2">
                  {dailySnapshots.map((s, i) => {
                    const dOrder = Number(s.dailyOrder ?? 0) || 0;
                    const dOutput = Number(s.dailyOutput ?? 0) || 0;
                    const dInput = Number(s.dailyInput ?? 0) || 0;
                    return (
                      <div key={`${s.date}-${i}`} className="relative pl-6">
                        {/* Vertical line + dot */}
                        <div className="absolute left-[7px] top-1 h-full w-px bg-border" aria-hidden />
                        <div
                          className="absolute left-0 top-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 border-background bg-foreground/40"
                          aria-hidden
                        >
                          <Circle className="h-1.5 w-1.5 fill-current text-foreground/60" />
                        </div>

                        {/* Date header */}
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="text-sm font-semibold tabular-nums">
                              {formatShortDate(s.date)}
                            </span>
                            <Badge
                              className={cn("border text-[9px]", progressStatusBadgeClass(s.status))}
                              variant="outline"
                            >
                              {progressStatusLabel(s.status)}
                            </Badge>
                          </div>
                        </div>

                        {/* Events row */}
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          {dOrder > 0 ? (
                            <Badge
                              variant="outline"
                              className="border-slate-300 bg-slate-50 text-[10px] text-slate-700 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300"
                            >
                              <ArrowRight className="mr-0.5 h-2.5 w-2.5" />
                              ORDER +{fmt(dOrder)}
                            </Badge>
                          ) : null}
                          {dOutput > 0 ? (
                            <Badge
                              variant="outline"
                              className="border-emerald-300 bg-emerald-50 text-[10px] text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                            >
                              <ArrowRight className="mr-0.5 h-2.5 w-2.5" />
                              OUTPUT +{fmt(dOutput)}
                            </Badge>
                          ) : null}
                          {dInput > 0 ? (
                            <Badge
                              variant="outline"
                              className="border-teal-300 bg-teal-50 text-[10px] text-teal-700 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-300"
                            >
                              <ArrowRight className="mr-0.5 h-2.5 w-2.5" />
                              INPUT +{fmt(dInput)}
                            </Badge>
                          ) : null}
                          {dOrder === 0 && dOutput === 0 && dInput === 0 ? (
                            <span className="text-[10px] text-muted-foreground">No activity</span>
                          ) : null}
                        </div>

                        {/* Cumulative state */}
                        <div className="mt-2 grid grid-cols-3 gap-1.5 sm:grid-cols-6">
                          <div className="rounded bg-muted/50 px-2 py-1">
                            <div className="text-[9px] uppercase text-muted-foreground">Total Output</div>
                            <div className="text-[11px] font-semibold tabular-nums text-amber-600 dark:text-amber-400">
                              {fmt(s.totalOutput)}
                            </div>
                          </div>
                          <div className="rounded bg-muted/50 px-2 py-1">
                            <div className="text-[9px] uppercase text-muted-foreground">Total Input</div>
                            <div className="text-[11px] font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                              {fmt(s.totalInput)}
                            </div>
                          </div>
                          <div className="rounded bg-muted/50 px-2 py-1">
                            <div className="text-[9px] uppercase text-muted-foreground">Pending</div>
                            <div className="text-[11px] font-semibold tabular-nums text-amber-600 dark:text-amber-400">
                              {fmt(s.pending)}
                            </div>
                          </div>
                          <div className="rounded bg-muted/50 px-2 py-1">
                            <div className="text-[9px] uppercase text-muted-foreground">Remaining</div>
                            <div className="text-[11px] font-semibold tabular-nums">
                              {fmt(s.remaining)}
                            </div>
                          </div>
                          <div className="rounded bg-muted/50 px-2 py-1">
                            <div className="text-[9px] uppercase text-muted-foreground">Out %</div>
                            <div className={cn("text-[11px] font-semibold tabular-nums", rateTone(clampPct(s.outputProgress)))}>
                              {fmtPct(s.outputProgress)}
                            </div>
                          </div>
                          <div className="rounded bg-muted/50 px-2 py-1">
                            <div className="text-[9px] uppercase text-muted-foreground">In %</div>
                            <div className={cn("text-[11px] font-semibold tabular-nums", rateTone(clampPct(s.inputProgress)))}>
                              {fmtPct(s.inputProgress)}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </TabsContent>

      {/* ================================================================== */}
      {/* Tab 5: Anomaly Detection                                           */}
      {/* ================================================================== */}
      <TabsContent value="anomaly" className="space-y-4 outline-none">
        {orderProgressLoading ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-20" />
              ))}
            </div>
            <Skeleton className="h-64" />
          </div>
        ) : orderProgressError ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Failed to load anomalies</AlertTitle>
            <AlertDescription>
              {orderProgressError instanceof Error ? orderProgressError.message : "Unknown error."}{" "}
              <button
                type="button"
                onClick={() => bumpRefresh()}
                className="underline underline-offset-2 hover:opacity-80"
              >
                Try again
              </button>
            </AlertDescription>
          </Alert>
        ) : (
          <>
            {/* Summary cards: Total Anomalies / Over Output / Input Exceeds Output / Deadline Risk */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <MiniStat
                label="Total Anomalies"
                value={fmt(progressSummary?.anomalyCount ?? anomalies.length)}
                icon={Bug}
                iconClass="bg-slate-100 text-slate-600 dark:bg-slate-800/60 dark:text-slate-300"
              />
              <MiniStat
                label="Over Output"
                value={fmt(anomalyTypeCounts.OVER_OUTPUT ?? 0)}
                icon={AlertOctagon}
                iconClass="bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300"
                valueTone="text-rose-700 dark:text-rose-400"
              />
              <MiniStat
                label="Input Exceeds Output"
                value={fmt(anomalyTypeCounts.INPUT_EXCEEDS_OUTPUT ?? 0)}
                icon={AlertOctagon}
                iconClass="bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300"
                valueTone="text-rose-700 dark:text-rose-400"
              />
              <MiniStat
                label="Deadline Risk"
                value={fmt(anomalyTypeCounts.DEADLINE_RISK ?? 0)}
                icon={CalendarClock}
                iconClass="bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
                valueTone="text-amber-700 dark:text-amber-400"
              />
            </div>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex items-center gap-2">
                    <Bug className="h-4 w-4 text-rose-500" />
                    Anomalies
                  </span>
                  <Badge variant="secondary" className="text-[10px] tabular-nums">
                    {anomalies.length} found
                  </Badge>
                </CardTitle>
                <CardDescription className="text-xs">
                  Quantity and deadline anomalies detected for {currentProduct}.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {anomalies.length === 0 ? (
                  <EmptyState
                    message={`No anomalies detected for ${currentProduct}. Everything looks healthy.`}
                    icon={CheckCircle2}
                  />
                ) : (
                  <div className="max-h-[500px] space-y-2 overflow-y-auto scroll-thin pr-1">
                    {anomalies.map((a, i) => {
                      const tone = anomalyToneClass(a.severity);
                      const badge = anomalyBadgeClass(a.severity);
                      const orderQty = Number(a.orderQty ?? 0) || 0;
                      const outputQty = Number(a.outputQty ?? 0) || 0;
                      const inputQty = Number(a.inputQty ?? 0) || 0;
                      const excess = Number(a.excess ?? 0) || 0;
                      const hasNumbers = orderQty > 0 || outputQty > 0 || inputQty > 0 || excess > 0;
                      return (
                        <div
                          key={a.key || `${a.type}-${i}`}
                          className={cn(
                            "rounded-lg border p-3 shadow-sm",
                            tone,
                          )}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge
                              className={cn("border text-[10px]", badge)}
                              variant="outline"
                            >
                              {a.severity || "INFO"}
                            </Badge>
                            <Badge
                              variant="outline"
                              className="text-[10px] font-mono"
                            >
                              {a.type || "ANOMALY"}
                            </Badge>
                            <span className="text-xs font-medium text-muted-foreground">
                              PO NO#
                            </span>
                            <span className="font-mono text-xs">{a.poNo || "—"}</span>
                            <span className="text-xs font-medium text-muted-foreground">
                              Factory PO
                            </span>
                            <span className="font-mono text-xs">{a.factoryPO || "—"}</span>
                            <span className="text-xs font-medium text-muted-foreground">
                              Size
                            </span>
                            <Badge variant="outline" className="font-mono text-[10px]">
                              {a.size || "—"}
                            </Badge>
                          </div>
                          <p className="mt-1.5 text-xs text-foreground/90">
                            {a.description || "No description provided."}
                          </p>
                          {hasNumbers ? (
                            <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                              <div className="rounded bg-card/70 px-2 py-1">
                                <div className="text-[9px] uppercase text-muted-foreground">Order Qty</div>
                                <div className="text-xs font-semibold tabular-nums">{fmt(orderQty)}</div>
                              </div>
                              <div className="rounded bg-card/70 px-2 py-1">
                                <div className="text-[9px] uppercase text-muted-foreground">Output Qty</div>
                                <div className="text-xs font-semibold tabular-nums text-amber-600 dark:text-amber-400">{fmt(outputQty)}</div>
                              </div>
                              <div className="rounded bg-card/70 px-2 py-1">
                                <div className="text-[9px] uppercase text-muted-foreground">Input Qty</div>
                                <div className="text-xs font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{fmt(inputQty)}</div>
                              </div>
                              <div className="rounded bg-card/70 px-2 py-1">
                                <div className="text-[9px] uppercase text-muted-foreground">Excess</div>
                                <div className="text-xs font-semibold tabular-nums text-rose-600 dark:text-rose-400">{fmt(excess)}</div>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </TabsContent>

      {/* ================================================================== */}
      {/* Tab 5: Data Change History                                         */}
      {/* ================================================================== */}
      <TabsContent value="history" className="space-y-4 outline-none">
        {historyLoading ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-20" />
              ))}
            </div>
            <Skeleton className="h-64" />
          </div>
        ) : historyError ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Failed to load change history</AlertTitle>
            <AlertDescription>
              {historyError instanceof Error ? historyError.message : "Unknown error."}{" "}
              <button
                type="button"
                onClick={() => bumpRefresh()}
                className="underline underline-offset-2 hover:opacity-80"
              >
                Try again
              </button>
            </AlertDescription>
          </Alert>
        ) : (
          <>
            {/* Summary cards: Total Changes + by-action breakdown */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <MiniStat
                label="Total Changes"
                value={fmt(historySummary?.total ?? historyRows.length)}
                icon={HistoryIcon}
                iconClass="bg-slate-100 text-slate-600 dark:bg-slate-800/60 dark:text-slate-300"
              />
              <MiniStat
                label="Create"
                value={fmt(historyBuckets.CREATE ?? 0)}
                icon={PlusCircle}
                iconClass="bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                valueTone="text-emerald-700 dark:text-emerald-400"
              />
              <MiniStat
                label="Update"
                value={fmt(historyBuckets.UPDATE ?? 0)}
                icon={PencilLine}
                iconClass="bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
                valueTone="text-amber-700 dark:text-amber-400"
              />
              <MiniStat
                label="Delete"
                value={fmt(historyBuckets.DELETE ?? 0)}
                icon={Trash2}
                iconClass="bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300"
                valueTone="text-rose-700 dark:text-rose-400"
              />
              <MiniStat
                label="Import"
                value={fmt(historyBuckets.IMPORT ?? 0)}
                icon={Download}
                iconClass="bg-teal-100 text-teal-700 dark:bg-teal-950/50 dark:text-teal-300"
                valueTone="text-teal-700 dark:text-teal-400"
              />
            </div>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex items-center gap-2">
                    <Database className="h-4 w-4" style={{ color: theme.chart }} />
                    Change History Timeline
                  </span>
                  <Badge variant="secondary" className="text-[10px] tabular-nums">
                    {historyRows.length} entries
                  </Badge>
                </CardTitle>
                <CardDescription className="text-xs">
                  Audit log of data changes for {currentProduct}.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {historyRows.length === 0 ? (
                  <EmptyState
                    message={`No change history for ${currentProduct} with the current filters.`}
                    icon={HistoryIcon}
                  />
                ) : (
                  <div className="max-h-[500px] space-y-2 overflow-y-auto scroll-thin pr-1">
                    {historyRows.map((h) => {
                      const bucketed = bucketAction(h.action);
                      return (
                        <div
                          key={h.id}
                          className="flex flex-col gap-2 rounded-lg border bg-card p-3 shadow-sm sm:flex-row sm:items-center"
                        >
                          <div className="flex flex-1 items-center gap-3">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                              <UserIcon className="h-4 w-4" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge
                                  className={cn("border text-[10px]", bucketed.badgeClass)}
                                  variant="outline"
                                >
                                  {bucketed.label}
                                </Badge>
                                <Badge variant="outline" className="text-[10px]">
                                  {h.entityType || "—"}
                                </Badge>
                                <span className="text-xs font-medium">
                                  {h.user || "system"}
                                </span>
                              </div>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {h.detail || `${h.entityType} ${h.entityId ?? ""}`.trim()}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 text-[11px] text-muted-foreground sm:flex-col sm:items-end">
                            <span className="inline-flex items-center gap-1 tabular-nums">
                              <Clock className="h-3 w-3" />
                              {formatTimestamp(h.timestamp)}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </TabsContent>

      {/* ================================================================== */}
      {/* Tab 7: Reports (NEW — 6 client-side Excel export buttons)          */}
      {/* ================================================================== */}
      <TabsContent value="reports" className="space-y-4 outline-none">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <FileSpreadsheet className="h-4 w-4" style={{ color: theme.chart }} />
              Export Production Reports
            </CardTitle>
            <CardDescription className="text-xs">
              Generate Excel files from the already-fetched data for {currentProduct}. Files are named{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-[10px]">
                Production_Report_&lt;type&gt;_&lt;date&gt;.xlsx
              </code>
              .
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {/* 1. Current Progress Report (drilldown hierarchy) */}
              <Button
                variant="outline"
                className="h-auto flex-col items-start gap-1 p-4 text-left"
                onClick={() => {
                  try {
                    if (!drilldownData?.hierarchy || drilldownData.hierarchy.length === 0) {
                      toast.error("No drilldown data available — open the Drill-Down tab first or wait for data to load.");
                      return;
                    }
                    const rows: Record<string, unknown>[] = [];
                    for (const po of drilldownData.hierarchy) {
                      for (const fpo of po.factoryPOs) {
                        for (const s of fpo.sizes) {
                          rows.push({
                            "PO NO#": po.poNo,
                            "Factory PO": fpo.factoryPO,
                            "Size": s.size,
                            "Model": s.model || "",
                            "SKU": s.sku || "",
                            "Season": s.season || "",
                            "Color Code": s.colorCode || "",
                            "Order Qty": s.orderQty,
                            "Output Qty": s.outputQty,
                            "Input Qty": s.inputQty,
                            "Pending": s.pending,
                            "Remaining": s.remaining,
                            "Output %": s.outputProgress,
                            "Input %": s.inputProgress,
                            "Input vs Output %": s.inputVsOutput,
                            "Status": (s.status || []).join(", "),
                            "Anomalies": (s.anomalies || []).join(", "),
                          });
                        }
                      }
                    }
                    downloadWorkbook("Current Progress", rows, getReportFileName("CurrentProgress"));
                    toast.success(`Exported ${rows.length} rows`);
                  } catch (e) {
                    toast.error("Failed to export current progress report");
                  }
                }}
              >
                <div className="flex w-full items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                    <ListTree className="h-4 w-4" />
                  </div>
                  <span className="text-sm font-semibold">Current Progress Report</span>
                  <FileDown className="ml-auto h-3.5 w-3.5 text-muted-foreground" />
                </div>
                <p className="text-[11px] font-normal text-muted-foreground">
                  Drilldown hierarchy (PO NO# → Factory PO → Size) with full progress metrics.
                </p>
              </Button>

              {/* 2. Daily Progress Report (dailySnapshots) */}
              <Button
                variant="outline"
                className="h-auto flex-col items-start gap-1 p-4 text-left"
                onClick={() => {
                  try {
                    if (dailySnapshots.length === 0) {
                      toast.error("No daily snapshot data available.");
                      return;
                    }
                    const rows: Record<string, unknown>[] = dailySnapshots.map((s) => ({
                      "Date": s.date,
                      "Daily Order": s.dailyOrder,
                      "Daily Output": s.dailyOutput,
                      "Daily Input": s.dailyInput,
                      "Total Output": s.totalOutput,
                      "Total Input": s.totalInput,
                      "Pending": s.pending,
                      "Remaining": s.remaining,
                      "Output %": s.outputProgress,
                      "Input %": s.inputProgress,
                      "Input vs Output %": s.inputVsOutput,
                      "Status": s.status,
                    }));
                    downloadWorkbook("Daily Progress", rows, getReportFileName("DailyProgress"));
                    toast.success(`Exported ${rows.length} days`);
                  } catch (e) {
                    toast.error("Failed to export daily progress report");
                  }
                }}
              >
                <div className="flex w-full items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
                    <Layers className="h-4 w-4" />
                  </div>
                  <span className="text-sm font-semibold">Daily Progress Report</span>
                  <FileDown className="ml-auto h-3.5 w-3.5 text-muted-foreground" />
                </div>
                <p className="text-[11px] font-normal text-muted-foreground">
                  Daily snapshot table with all 12 columns (order / output / input / progress).
                </p>
              </Button>

              {/* 3. Order Timeline Report */}
              <Button
                variant="outline"
                className="h-auto flex-col items-start gap-1 p-4 text-left"
                onClick={() => {
                  try {
                    if (dailySnapshots.length === 0) {
                      toast.error("No order timeline data available.");
                      return;
                    }
                    const rows: Record<string, unknown>[] = dailySnapshots.map((s) => ({
                      "Date": s.date,
                      "Daily Order": s.dailyOrder,
                      "Daily Output": s.dailyOutput,
                      "Daily Input": s.dailyInput,
                      "Cumulative Output": s.totalOutput,
                      "Cumulative Input": s.totalInput,
                      "Pending": s.pending,
                      "Remaining": s.remaining,
                      "Output Progress %": s.outputProgress,
                      "Input Progress %": s.inputProgress,
                      "Input vs Output %": s.inputVsOutput,
                      "Status": s.status,
                    }));
                    downloadWorkbook("Order Timeline", rows, getReportFileName("OrderTimeline"));
                    toast.success(`Exported ${rows.length} timeline entries`);
                  } catch (e) {
                    toast.error("Failed to export order timeline report");
                  }
                }}
              >
                <div className="flex w-full items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-100 text-teal-700 dark:bg-teal-950/50 dark:text-teal-300">
                    <CalendarDays className="h-4 w-4" />
                  </div>
                  <span className="text-sm font-semibold">Order Timeline Report</span>
                  <FileDown className="ml-auto h-3.5 w-3.5 text-muted-foreground" />
                </div>
                <p className="text-[11px] font-normal text-muted-foreground">
                  Daily OUTPUT / INPUT deltas with cumulative progress %.
                </p>
              </Button>

              {/* 4. Data Change History */}
              <Button
                variant="outline"
                className="h-auto flex-col items-start gap-1 p-4 text-left"
                onClick={() => {
                  try {
                    if (historyRows.length === 0) {
                      toast.error("No change history available.");
                      return;
                    }
                    const rows: Record<string, unknown>[] = historyRows.map((h) => ({
                      "Timestamp": h.timestamp,
                      "User": h.user,
                      "Action": h.action,
                      "Entity Type": h.entityType,
                      "Entity ID": h.entityId ?? "",
                      "Detail": h.detail ?? "",
                      "Product Type": h.productType ?? "",
                      "Old Value": typeof h.oldValue === "object" ? JSON.stringify(h.oldValue) : (h.oldValue ?? ""),
                      "New Value": typeof h.newValue === "object" ? JSON.stringify(h.newValue) : (h.newValue ?? ""),
                    }));
                    downloadWorkbook("Change History", rows, getReportFileName("ChangeHistory"));
                    toast.success(`Exported ${rows.length} history entries`);
                  } catch (e) {
                    toast.error("Failed to export data change history");
                  }
                }}
              >
                <div className="flex w-full items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
                    <HistoryIcon className="h-4 w-4" />
                  </div>
                  <span className="text-sm font-semibold">Data Change History</span>
                  <FileDown className="ml-auto h-3.5 w-3.5 text-muted-foreground" />
                </div>
                <p className="text-[11px] font-normal text-muted-foreground">
                  Audit log entries (create / update / delete / import) with timestamps.
                </p>
              </Button>

              {/* 5. Anomaly Report (all anomalies) */}
              <Button
                variant="outline"
                className="h-auto flex-col items-start gap-1 p-4 text-left"
                onClick={() => {
                  try {
                    if (anomalies.length === 0) {
                      toast.error("No anomalies detected — nothing to export.");
                      return;
                    }
                    const rows: Record<string, unknown>[] = anomalies.map((a) => ({
                      "Type": a.type,
                      "Severity": a.severity,
                      "PO NO#": a.poNo,
                      "Factory PO": a.factoryPO,
                      "Size": a.size,
                      "Description": a.description,
                      "Order Qty": a.orderQty ?? "",
                      "Output Qty": a.outputQty ?? "",
                      "Input Qty": a.inputQty ?? "",
                      "Excess": a.excess ?? "",
                    }));
                    downloadWorkbook("Anomaly Report", rows, getReportFileName("Anomalies"));
                    toast.success(`Exported ${rows.length} anomalies`);
                  } catch (e) {
                    toast.error("Failed to export anomaly report");
                  }
                }}
              >
                <div className="flex w-full items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
                    <Bug className="h-4 w-4" />
                  </div>
                  <span className="text-sm font-semibold">Anomaly Report</span>
                  <FileDown className="ml-auto h-3.5 w-3.5 text-muted-foreground" />
                </div>
                <p className="text-[11px] font-normal text-muted-foreground">
                  All detected anomalies (over output / input exceeds output / deadline risk) with details.
                </p>
              </Button>

              {/* 6. Deadline Risk Report (DEADLINE_RISK anomalies only) */}
              <Button
                variant="outline"
                className="h-auto flex-col items-start gap-1 p-4 text-left"
                onClick={() => {
                  try {
                    const deadlineRisks = anomalies.filter(
                      (a) => (a.type || "").toUpperCase() === "DEADLINE_RISK",
                    );
                    if (deadlineRisks.length === 0) {
                      toast.error("No deadline-risk anomalies detected — nothing to export.");
                      return;
                    }
                    const rows: Record<string, unknown>[] = deadlineRisks.map((a) => ({
                      "Type": a.type,
                      "Severity": a.severity,
                      "PO NO#": a.poNo,
                      "Factory PO": a.factoryPO,
                      "Size": a.size,
                      "Description": a.description,
                      "Order Qty": a.orderQty ?? "",
                      "Output Qty": a.outputQty ?? "",
                      "Input Qty": a.inputQty ?? "",
                      "Missing Qty": a.missing ?? "",
                      "Deadline": a.deadline ?? "",
                      "Days Until Deadline": a.daysUntilDeadline ?? "",
                    }));
                    downloadWorkbook("Deadline Risk", rows, getReportFileName("DeadlineRisk"));
                    toast.success(`Exported ${rows.length} deadline-risk items`);
                  } catch (e) {
                    toast.error("Failed to export deadline risk report");
                  }
                }}
              >
                <div className="flex w-full items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
                    <CalendarClock className="h-4 w-4" />
                  </div>
                  <span className="text-sm font-semibold">Deadline Risk Report</span>
                  <FileDown className="ml-auto h-3.5 w-3.5 text-muted-foreground" />
                </div>
                <p className="text-[11px] font-normal text-muted-foreground">
                  Only <code className="text-[10px]">DEADLINE_RISK</code> anomalies with deadline &amp; missing qty.
                </p>
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Helpful hints / data status */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Database className="h-4 w-4 text-primary" />
              Data Availability
            </CardTitle>
            <CardDescription className="text-xs">
              Reports use already-fetched dashboard data. Click "Refresh" if a report shows as empty.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <MiniStat
                label="Drilldown Hierarchy"
                value={fmt(drilldownData?.summary?.totalSizes ?? 0)}
                icon={ListTree}
                iconClass="bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                sub={drilldownLoading ? "loading…" : "sizes"}
              />
              <MiniStat
                label="Daily Snapshots"
                value={fmt(dailySnapshots.length)}
                icon={Layers}
                iconClass="bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
                sub="days"
              />
              <MiniStat
                label="Timeline Entries"
                value={fmt(dailySnapshots.length)}
                icon={CalendarDays}
                iconClass="bg-teal-100 text-teal-700 dark:bg-teal-950/50 dark:text-teal-300"
                sub="days"
              />
              <MiniStat
                label="History Rows"
                value={fmt(historyRows.length)}
                icon={HistoryIcon}
                iconClass="bg-slate-100 text-slate-700 dark:bg-slate-800/60 dark:text-slate-300"
                sub="entries"
              />
              <MiniStat
                label="Anomalies"
                value={fmt(anomalies.length)}
                icon={Bug}
                iconClass="bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300"
                sub="found"
              />
              <MiniStat
                label="Deadline Risks"
                value={fmt(anomalies.filter((a) => (a.type || "").toUpperCase() === "DEADLINE_RISK").length)}
                icon={CalendarClock}
                iconClass="bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
                sub="at risk"
              />
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      {/* ---------------- Tab: Drill-Down (PO NO# → Factory PO → Size hierarchy) ---------------- */}
      <TabsContent value="drilldown" className="space-y-4 outline-none">
        {/* Summary + search */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-4 text-xs">
            <span className="text-muted-foreground">POs: <span className="font-bold tabular-nums text-foreground">{drilldownData?.summary?.totalPOs ?? 0}</span></span>
            <span className="text-muted-foreground">Factory POs: <span className="font-bold tabular-nums text-foreground">{drilldownData?.summary?.totalFactoryPOs ?? 0}</span></span>
            <span className="text-muted-foreground">Sizes: <span className="font-bold tabular-nums text-foreground">{drilldownData?.summary?.totalSizes ?? 0}</span></span>
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search PO NO#, Factory PO, Size, Model..."
              value={drilldownSearch}
              onChange={(e) => setDrilldownSearch(e.target.value)}
              className="h-8 pl-7 text-xs"
            />
          </div>
        </div>

        {drilldownLoading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filteredHierarchy.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            No data found. {drilldownSearch ? "Try a different search." : ""}
          </div>
        ) : (
          <div className="space-y-2">
            {/* PO NO# rows */}
            {filteredHierarchy.slice(0, 200).map((po) => (
              <div key={po.poNo} className="rounded-lg border">
                {/* PO NO# header row */}
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/50"
                  onClick={() => togglePO(po.poNo)}
                >
                  {expandedPOs.has(po.poNo) ? (
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <Badge className={cn("text-[10px]", theme.badge)}>{po.poNo}</Badge>
                  <span className="text-xs text-muted-foreground">{po.factoryPOCount} Factory POs</span>
                  <span className="ml-auto flex gap-3 text-xs tabular-nums">
                    <span>Order: <strong>{po.orderQty.toLocaleString()}</strong></span>
                    <span>Output: <strong className="text-emerald-600 dark:text-emerald-400">{po.outputQty.toLocaleString()}</strong></span>
                    <span>Input: <strong className="text-teal-600 dark:text-teal-400">{po.inputQty.toLocaleString()}</strong></span>
                    <span>Out%: <strong>{po.outputProgress}%</strong></span>
                  </span>
                </button>

                {/* Factory PO rows (expanded) */}
                {expandedPOs.has(po.poNo) && (
                  <div className="border-t bg-muted/20">
                    {po.factoryPOs.map((fpo: any) => {
                      const fpoKey = `${po.poNo}|${fpo.factoryPO}`;
                      return (
                        <div key={fpoKey} className="border-b last:border-b-0">
                          <button
                            className="flex w-full items-center gap-2 px-6 py-1.5 text-left hover:bg-muted/30"
                            onClick={() => toggleFPO(fpoKey)}
                          >
                            {expandedFPOs.has(fpoKey) ? (
                              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            )}
                            <span className="font-mono text-xs font-medium">{fpo.factoryPO}</span>
                            <span className="text-[10px] text-muted-foreground">{fpo.model} · {fpo.season}</span>
                            <span className="ml-auto flex gap-2 text-[10px] tabular-nums">
                              <span>O: <strong>{fpo.orderQty.toLocaleString()}</strong></span>
                              <span>Out: <strong className="text-emerald-600">{fpo.outputQty.toLocaleString()}</strong></span>
                              <span>In: <strong className="text-teal-600">{fpo.inputQty.toLocaleString()}</strong></span>
                              <span>Pend: <strong className="text-amber-600">{fpo.pending.toLocaleString()}</strong></span>
                              <span>{fpo.outputProgress}%</span>
                            </span>
                          </button>

                          {/* Size rows (expanded) */}
                          {expandedFPOs.has(fpoKey) && (
                            <div className="border-t border-dashed">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="border-b text-[10px] text-muted-foreground">
                                    <th className="px-8 py-1 text-left">Size</th>
                                    <th className="px-2 py-1 text-right">Order</th>
                                    <th className="px-2 py-1 text-right">Output</th>
                                    <th className="px-2 py-1 text-right">Input</th>
                                    <th className="px-2 py-1 text-right">Pending</th>
                                    <th className="px-2 py-1 text-right">Remaining</th>
                                    <th className="px-2 py-1 text-right">Out%</th>
                                    <th className="px-2 py-1 text-right">In%</th>
                                    <th className="px-2 py-1 text-right">In/Out%</th>
                                    <th className="px-2 py-1 text-center">Status</th>
                                    <th className="px-2 py-1"></th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {fpo.sizes.map((s: any) => (
                                    <tr
                                      key={s.size}
                                      className="border-b last:border-b-0 hover:bg-muted/30 cursor-pointer"
                                      onClick={() => loadSizeTransactions(po.poNo, fpo.factoryPO, s.size)}
                                    >
                                      <td className="px-8 py-1 font-mono">{s.size}</td>
                                      <td className="px-2 py-1 text-right tabular-nums">{s.orderQty.toLocaleString()}</td>
                                      <td className="px-2 py-1 text-right tabular-nums text-emerald-600 dark:text-emerald-400">{s.outputQty.toLocaleString()}</td>
                                      <td className="px-2 py-1 text-right tabular-nums text-teal-600 dark:text-teal-400">{s.inputQty.toLocaleString()}</td>
                                      <td className="px-2 py-1 text-right tabular-nums text-amber-600 dark:text-amber-400">{s.pending.toLocaleString()}</td>
                                      <td className="px-2 py-1 text-right tabular-nums text-rose-600 dark:text-rose-400">{s.remaining.toLocaleString()}</td>
                                      <td className={cn("px-2 py-1 text-right tabular-nums", s.outputProgress > 100 ? "text-rose-600" : "text-emerald-600")}>{s.outputProgress}%</td>
                                      <td className="px-2 py-1 text-right tabular-nums">{s.inputProgress}%</td>
                                      <td className="px-2 py-1 text-right tabular-nums">{s.inputVsOutput}%</td>
                                      <td className="px-2 py-1 text-center">
                                        {s.status.map((st: string) => (
                                          <Badge key={st} variant="outline" className={cn("text-[8px] mr-0.5",
                                            st === "OVER_OUTPUT" || st === "OVER_INPUT" ? "border-rose-300 text-rose-600" :
                                            st === "OUTPUT_COMPLETED" || st === "INPUT_COMPLETED" ? "border-emerald-300 text-emerald-600" :
                                            st === "NOT_STARTED" ? "border-slate-300 text-slate-500" :
                                            "border-amber-300 text-amber-600"
                                          )}>{st.replace(/_/g, " ")}</Badge>
                                        ))}
                                      </td>
                                      <td className="px-2 py-1">
                                        {s.anomalies.length > 0 && (
                                          <AlertTriangle className="h-3 w-3 text-rose-500" />
                                        )}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
            {filteredHierarchy.length > 200 && (
              <div className="py-2 text-center text-xs text-muted-foreground">
                Showing first 200 PO NO#s. Use search to narrow down.
              </div>
            )}
          </div>
        )}
      </TabsContent>

      {/* ---------------- Size Detail Dialog (Transaction History) ---------------- */}
      <Dialog open={!!sizeDetail} onOpenChange={(o) => { if (!o) { setSizeDetail(null); setSizeTransactions(null); } }}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto scroll-thin">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <ListTree className="h-4 w-4 text-primary" />
              Size Detail: {sizeDetail?.poNo} / {sizeDetail?.factoryPO} / {sizeDetail?.size}
            </DialogTitle>
            <DialogDescription>
              Transaction history with cumulative progress at each step.
            </DialogDescription>
          </DialogHeader>

          {loadingTransactions ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : sizeTransactions && sizeTransactions.length > 0 ? (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="rounded border p-2 text-center">
                  <div className="text-muted-foreground">Total Order</div>
                  <div className="text-lg font-bold tabular-nums">{sizeTransactions[sizeTransactions.length - 1]?.cumulativeOrder.toLocaleString() ?? 0}</div>
                </div>
                <div className="rounded border p-2 text-center">
                  <div className="text-muted-foreground">Total Output</div>
                  <div className="text-lg font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{sizeTransactions[sizeTransactions.length - 1]?.cumulativeOutput.toLocaleString() ?? 0}</div>
                </div>
                <div className="rounded border p-2 text-center">
                  <div className="text-muted-foreground">Total Input</div>
                  <div className="text-lg font-bold tabular-nums text-teal-600 dark:text-teal-400">{sizeTransactions[sizeTransactions.length - 1]?.cumulativeInput.toLocaleString() ?? 0}</div>
                </div>
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-[10px] text-muted-foreground">
                    <th className="px-2 py-1 text-left">Date</th>
                    <th className="px-2 py-1 text-left">Status</th>
                    <th className="px-2 py-1 text-right">Qty</th>
                    <th className="px-2 py-1 text-right">Cum. Output</th>
                    <th className="px-2 py-1 text-right">Cum. Input</th>
                    <th className="px-2 py-1 text-right">Pending</th>
                    <th className="px-2 py-1 text-right">Out%</th>
                    <th className="px-2 py-1 text-right">In%</th>
                  </tr>
                </thead>
                <tbody>
                  {sizeTransactions.map((t, i) => (
                    <tr key={i} className="border-b last:border-b-0">
                      <td className="px-2 py-1 font-mono">{t.date || "—"}</td>
                      <td className="px-2 py-1">
                        <Badge variant="outline" className={cn("text-[9px]",
                          t.bucket === "order" ? "border-slate-300 text-slate-600" :
                          t.bucket === "output" ? "border-emerald-300 text-emerald-600" :
                          t.bucket === "input" ? "border-teal-300 text-teal-600" :
                          "border-muted text-muted-foreground"
                        )}>{t.shippingStatus}</Badge>
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums font-medium">{t.qty.toLocaleString()}</td>
                      <td className="px-2 py-1 text-right tabular-nums text-emerald-600 dark:text-emerald-400">{t.cumulativeOutput.toLocaleString()}</td>
                      <td className="px-2 py-1 text-right tabular-nums text-teal-600 dark:text-teal-400">{t.cumulativeInput.toLocaleString()}</td>
                      <td className="px-2 py-1 text-right tabular-nums text-amber-600 dark:text-amber-400">{t.pending.toLocaleString()}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{t.outputProgress}%</td>
                      <td className="px-2 py-1 text-right tabular-nums">{t.inputProgress}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-8 text-center text-sm text-muted-foreground">No transactions found.</div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setSizeDetail(null); setSizeTransactions(null); }}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------------- Tab: Order Created (Tab 9) ---------------- */}
      <TabsContent value="created" className="space-y-4 outline-none">
        {/* Step 1: Date Selector */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <CalendarCheck className="h-4 w-4 text-primary" />
              Order Created Date
            </CardTitle>
            <CardDescription className="text-xs">
              Select an order created date to track progress of all orders created on that day. Leave empty to view all orders.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="flex items-center gap-2">
                <Filter className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-medium text-muted-foreground">Created Date:</span>
              </div>
              <Select value={selectedCreatedDate} onValueChange={(v) => setSelectedCreatedDate(v === "__all__" ? "" : v)}>
                <SelectTrigger size="sm" className="w-full sm:w-64">
                  <SelectValue placeholder={selectedCreatedDate ? formatDateDisplay(selectedCreatedDate) : "All dates (showing all orders)"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All dates (show all orders)</SelectItem>
                  {createdDateOptions.map((d) => (
                    <SelectItem key={d.iso} value={d.iso}>
                      {formatDateDisplay(d.raw)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedCreatedDate && (
                <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setSelectedCreatedDate("")}>
                  Clear filter
                </Button>
              )}
              <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
                <span>Available dates: <span className="font-bold tabular-nums text-foreground">{createdDateOptions.length}</span></span>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => bumpRefresh()} disabled={createdLoading}>
                  <RefreshCw className={cn("h-3.5 w-3.5", createdLoading && "animate-spin")} />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {createdError ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Failed to load order created progress</AlertTitle>
            <AlertDescription>
              {createdError instanceof Error ? createdError.message : "Unknown error."}
            </AlertDescription>
          </Alert>
        ) : null}

        {/* Step 2: Summary Cards (8 cards) */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
          <StatCard label="Orders Created" value={fmt(createdSummary?.totalOrders ?? 0)} icon={ClipboardCheck} iconClass="bg-slate-100 text-slate-700 dark:bg-slate-900/50 dark:text-slate-300" loading={createdLoading} />
          <StatCard label="Order Qty" value={fmt(createdSummary?.totalOrderQty ?? 0)} icon={Boxes} iconClass="bg-slate-100 text-slate-700 dark:bg-slate-900/50 dark:text-slate-300" loading={createdLoading} />
          <StatCard label="Total Output" value={fmt(createdSummary?.totalOutputQty ?? 0)} icon={PackageCheck} iconClass="bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300" loading={createdLoading} />
          <StatCard label="Total Input" value={fmt(createdSummary?.totalInputQty ?? 0)} icon={FactoryIcon} iconClass="bg-teal-100 text-teal-700 dark:bg-teal-950/50 dark:text-teal-300" loading={createdLoading} />
          <StatCard label="Pending" value={fmt(createdSummary?.totalPending ?? 0)} icon={Hourglass} iconClass="bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300" loading={createdLoading} />
          <StatCard label="Remaining" value={fmt(createdSummary?.totalRemaining ?? 0)} icon={PackageX} iconClass="bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300" loading={createdLoading} />
          <StatCard label="Avg Output %" value={`${Math.round(createdSummary?.avgOutputProgress ?? 0)}%`} icon={TrendingUp} iconClass="bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300" loading={createdLoading} />
          <StatCard label="Avg Input %" value={`${Math.round(createdSummary?.avgInputProgress ?? 0)}%`} icon={Gauge} iconClass="bg-teal-100 text-teal-700 dark:bg-teal-950/50 dark:text-teal-300" loading={createdLoading} />
        </div>

        {/* Step 3: Status Cards (6 small cards) */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {[
            { label: "Not Started", value: createdSummary?.notStarted ?? 0, tone: "border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/40", text: "text-slate-700 dark:text-slate-300" },
            { label: "In Progress", value: createdSummary?.inProgress ?? 0, tone: "border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/40", text: "text-amber-700 dark:text-amber-300" },
            { label: "Output Completed", value: createdSummary?.outputCompleted ?? 0, tone: "border-emerald-200 bg-emerald-50 dark:border-emerald-900/50 dark:bg-emerald-950/40", text: "text-emerald-700 dark:text-emerald-300" },
            { label: "Input Completed", value: createdSummary?.inputCompleted ?? 0, tone: "border-emerald-200 bg-emerald-50 dark:border-emerald-900/50 dark:bg-emerald-950/40", text: "text-emerald-700 dark:text-emerald-300" },
            { label: "Over Output", value: createdSummary?.overOutput ?? 0, tone: "border-rose-200 bg-rose-50 dark:border-rose-900/50 dark:bg-rose-950/40", text: "text-rose-700 dark:text-rose-300" },
            { label: "Over Input", value: createdSummary?.overInput ?? 0, tone: "border-rose-200 bg-rose-50 dark:border-rose-900/50 dark:bg-rose-950/40", text: "text-rose-700 dark:text-rose-300" },
          ].map((s) => (
            <Card key={s.label} className={cn("border", s.tone)}>
              <CardContent className="p-3">
                <p className="text-[10px] font-medium text-muted-foreground">{s.label}</p>
                <p className={cn("mt-1 text-2xl font-bold tabular-nums", s.text)}>
                  {createdLoading ? <Skeleton className="h-7 w-10" /> : s.value}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Step 4: Order Batch Table */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <ListTree className="h-4 w-4 text-primary" />
              Order Batch
              <Badge variant="outline" className={cn("text-[10px]", theme.badge)}>
                {createdGroups.length} batches
              </Badge>
            </CardTitle>
            <CardDescription className="text-xs">
              Click any row to view detailed timeline and transaction history.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {createdLoading ? (
              <TableSkeleton />
            ) : createdGroups.length === 0 ? (
              <EmptyState message="No orders found for the selected date." icon={CalendarCheck} />
            ) : (
              <div className="max-h-[32rem] overflow-y-auto scroll-thin">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-background z-10">
                    <tr className="border-b text-[10px] text-muted-foreground">
                      <th className="px-2 py-1.5 text-left">PO NO#</th>
                      <th className="px-2 py-1.5 text-left">Factory PO</th>
                      <th className="px-2 py-1.5 text-left">Size</th>
                      <th className="px-2 py-1.5 text-right">Order</th>
                      <th className="px-2 py-1.5 text-right">Output</th>
                      <th className="px-2 py-1.5 text-right">Input</th>
                      <th className="px-2 py-1.5 text-right">Pending</th>
                      <th className="px-2 py-1.5 text-right">Remaining</th>
                      <th className="px-2 py-1.5 text-right">Out%</th>
                      <th className="px-2 py-1.5 text-right">In%</th>
                      <th className="px-2 py-1.5 text-right">In/Out%</th>
                      <th className="px-2 py-1.5 text-left">Deadline</th>
                      <th className="px-2 py-1.5 text-center">Status</th>
                      <th className="px-2 py-1.5"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {createdGroups.slice(0, 300).map((g, i) => (
                      <tr
                        key={`${g.poNo}|${g.factoryPO}|${g.size}|${i}`}
                        className="border-b last:border-b-0 cursor-pointer hover:bg-muted/40"
                        onClick={() => loadCreatedTransactions(g.poNo, g.factoryPO, g.size)}
                      >
                        <td className="px-2 py-1 font-mono">{g.poNo}</td>
                        <td className="px-2 py-1 font-mono">{g.factoryPO}</td>
                        <td className="px-2 py-1 font-mono">{g.size}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{g.orderQty.toLocaleString()}</td>
                        <td className="px-2 py-1 text-right tabular-nums text-emerald-600 dark:text-emerald-400">{g.outputQty.toLocaleString()}</td>
                        <td className="px-2 py-1 text-right tabular-nums text-teal-600 dark:text-teal-400">{g.inputQty.toLocaleString()}</td>
                        <td className="px-2 py-1 text-right tabular-nums text-amber-600 dark:text-amber-400">{g.pending.toLocaleString()}</td>
                        <td className="px-2 py-1 text-right tabular-nums text-rose-600 dark:text-rose-400">{g.remaining.toLocaleString()}</td>
                        <td className={cn("px-2 py-1 text-right tabular-nums", g.outputProgress > 100 ? "text-rose-600" : "text-emerald-600")}>{g.outputProgress}%</td>
                        <td className="px-2 py-1 text-right tabular-nums">{g.inputProgress}%</td>
                        <td className="px-2 py-1 text-right tabular-nums">{g.inputVsOutput}%</td>
                        <td className="px-2 py-1 font-mono text-[10px]">{formatDateDisplay(g.deadline)}</td>
                        <td className="px-2 py-1 text-center">
                          <div className="flex flex-wrap justify-center gap-0.5">
                            {(g.status || []).map((st) => (
                              <Badge key={st} variant="outline" className={cn("text-[8px]", progressStatusBadgeClass(st))}>
                                {progressStatusLabel(st)}
                              </Badge>
                            ))}
                          </div>
                        </td>
                        <td className="px-2 py-1">
                          {(g.anomalies?.length ?? 0) > 0 && (
                            <AlertTriangle className="h-3 w-3 text-rose-500" />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {createdGroups.length > 300 && (
                  <div className="py-2 text-center text-xs text-muted-foreground">
                    Showing first 300 batches. Total: {createdGroups.length}.
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Step 5: Progress Charts */}
        {createdTimelineForCharts.length > 0 && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Chart 1: LineChart — Output Progress % + Input Progress % */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <TrendingUp className="h-4 w-4 text-primary" />
                  Output vs Input Progress %
                </CardTitle>
                <CardDescription className="text-xs">
                  Cumulative progress percentages over time (largest batch timeline).
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={createdTimelineForCharts} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} className="text-muted-foreground" />
                    <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} unit="%" className="text-muted-foreground" />
                    <Tooltip
                      contentStyle={{ fontSize: 11, borderRadius: 8, padding: "6px 8px" }}
                      formatter={(v: number, name: string) => [`${v}%`, name]}
                    />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <Line type="monotone" dataKey="outputProgress" name="Output %" stroke="#10b981" strokeWidth={2} dot={{ r: 2 }} />
                    <Line type="monotone" dataKey="inputProgress" name="Input %" stroke="#14b8a6" strokeWidth={2} dot={{ r: 2 }} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Chart 2: BarChart — Daily Output + Daily Input */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <BarChart3 className="h-4 w-4 text-primary" />
                  Daily Output vs Daily Input
                </CardTitle>
                <CardDescription className="text-xs">
                  Daily transaction quantities over time (largest batch timeline).
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={createdTimelineForCharts} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} className="text-muted-foreground" />
                    <YAxis tick={{ fontSize: 10 }} className="text-muted-foreground" />
                    <Tooltip
                      contentStyle={{ fontSize: 11, borderRadius: 8, padding: "6px 8px" }}
                      formatter={(v: number, name: string) => [v.toLocaleString(), name]}
                    />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <Bar dataKey="dailyOutput" name="Daily Output" fill="#10b981" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="dailyInput" name="Daily Input" fill="#14b8a6" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        )}
      </TabsContent>

      {/* ---------------- Order Created Size Detail Dialog ---------------- */}
      <Dialog open={!!createdSizeDetail} onOpenChange={(o) => { if (!o) { setCreatedSizeDetail(null); setCreatedTransactions(null); } }}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto scroll-thin">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <CalendarCheck className="h-4 w-4 text-primary" />
              Order Created Detail: {createdSizeDetail?.poNo} / {createdSizeDetail?.factoryPO} / {createdSizeDetail?.size}
            </DialogTitle>
            <DialogDescription>
              Order info, progress, timeline, and transaction history.
            </DialogDescription>
          </DialogHeader>

          {(() => {
            const g = createdGroups.find(
              (x) =>
                x.poNo === createdSizeDetail?.poNo &&
                x.factoryPO === createdSizeDetail?.factoryPO &&
                x.size === createdSizeDetail?.size,
            );
            if (!g) {
              return (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  Order batch not found. It may have been filtered out — close and try again.
                </div>
              );
            }
            return (
              <div className="space-y-4">
                {/* Order Info */}
                <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3 lg:grid-cols-4">
                  <InfoCell label="PO NO#" value={g.poNo} mono />
                  <InfoCell label="Factory PO" value={g.factoryPO} mono />
                  <InfoCell label="Size" value={g.size} mono />
                  <InfoCell label="Model" value={g.model || "—"} />
                  <InfoCell label="SKU" value={g.sku || "—"} mono />
                  <InfoCell label="Color" value={g.colorCode || "—"} mono />
                  <InfoCell label="Season" value={g.season || "—"} />
                  <InfoCell label="Deadline" value={formatDateDisplay(g.deadline)} mono />
                </div>

                {/* Quantity */}
                <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
                  <QtyCell label="Order" value={g.orderQty} />
                  <QtyCell label="Output" value={g.outputQty} tone="emerald" />
                  <QtyCell label="Input" value={g.inputQty} tone="teal" />
                  <QtyCell label="Pending" value={g.pending} tone="amber" />
                  <QtyCell label="Remaining" value={g.remaining} tone="rose" />
                </div>

                {/* Progress */}
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <ProgressCell label="Output %" value={g.outputProgress} tone="emerald" />
                  <ProgressCell label="Input %" value={g.inputProgress} tone="teal" />
                  <ProgressCell label="Input vs Output %" value={g.inputVsOutput} tone="teal" />
                </div>

                {/* Status badges + anomalies */}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground">Status:</span>
                  {(g.status || []).length === 0 ? (
                    <span className="text-xs text-muted-foreground">—</span>
                  ) : (
                    g.status.map((st) => (
                      <Badge key={st} variant="outline" className={cn("text-[10px]", progressStatusBadgeClass(st))}>
                        {progressStatusLabel(st)}
                      </Badge>
                    ))
                  )}
                  {(g.anomalies?.length ?? 0) > 0 && (
                    <div className="flex w-full items-start gap-2 mt-2">
                      <AlertTriangle className="h-4 w-4 text-rose-500 shrink-0 mt-0.5" />
                      <div className="flex flex-wrap gap-1">
                        {g.anomalies.map((a, i) => (
                          <Badge key={i} variant="outline" className="text-[10px] border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300">
                            {a}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Timeline table */}
                <div>
                  <h4 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Timeline</h4>
                  <div className="max-h-72 overflow-y-auto scroll-thin rounded border">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-muted/50">
                        <tr className="border-b text-[10px] text-muted-foreground">
                          <th className="px-2 py-1 text-left">Date</th>
                          <th className="px-2 py-1 text-right">Daily Output</th>
                          <th className="px-2 py-1 text-right">Daily Input</th>
                          <th className="px-2 py-1 text-right">Cum Output</th>
                          <th className="px-2 py-1 text-right">Cum Input</th>
                          <th className="px-2 py-1 text-right">Pending</th>
                          <th className="px-2 py-1 text-right">Remaining</th>
                          <th className="px-2 py-1 text-right">Out%</th>
                          <th className="px-2 py-1 text-right">In%</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(g.timeline || []).length === 0 ? (
                          <tr>
                            <td colSpan={9} className="px-2 py-6 text-center text-muted-foreground">
                              No timeline data available.
                            </td>
                          </tr>
                        ) : (
                          g.timeline.map((t, i) => (
                            <tr key={i} className="border-b last:border-b-0 hover:bg-muted/30">
                              <td className="px-2 py-1 font-mono text-[10px]">{formatDateDisplay(t.date)}</td>
                              <td className="px-2 py-1 text-right tabular-nums text-emerald-600 dark:text-emerald-400">{t.dailyOutput.toLocaleString()}</td>
                              <td className="px-2 py-1 text-right tabular-nums text-teal-600 dark:text-teal-400">{t.dailyInput.toLocaleString()}</td>
                              <td className="px-2 py-1 text-right tabular-nums text-emerald-600 dark:text-emerald-400">{t.cumOutput.toLocaleString()}</td>
                              <td className="px-2 py-1 text-right tabular-nums text-teal-600 dark:text-teal-400">{t.cumInput.toLocaleString()}</td>
                              <td className="px-2 py-1 text-right tabular-nums text-amber-600 dark:text-amber-400">{t.pending.toLocaleString()}</td>
                              <td className="px-2 py-1 text-right tabular-nums text-rose-600 dark:text-rose-400">{t.remaining.toLocaleString()}</td>
                              <td className={cn("px-2 py-1 text-right tabular-nums", t.outputProgress > 100 ? "text-rose-600" : "text-emerald-600")}>{t.outputProgress}%</td>
                              <td className="px-2 py-1 text-right tabular-nums">{t.inputProgress}%</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Transaction history (loaded separately) */}
                <div>
                  <h4 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Transaction History</h4>
                  {loadingCreatedTx ? (
                    <div className="flex h-20 items-center justify-center">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : createdTransactions && createdTransactions.length > 0 ? (
                    <div className="max-h-72 overflow-y-auto scroll-thin rounded border">
                      <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-muted/50">
                          <tr className="border-b text-[10px] text-muted-foreground">
                            <th className="px-2 py-1 text-left">Date</th>
                            <th className="px-2 py-1 text-left">Status</th>
                            <th className="px-2 py-1 text-right">Qty</th>
                            <th className="px-2 py-1 text-right">Cum Output</th>
                            <th className="px-2 py-1 text-right">Cum Input</th>
                            <th className="px-2 py-1 text-right">Pending</th>
                            <th className="px-2 py-1 text-right">Out%</th>
                            <th className="px-2 py-1 text-right">In%</th>
                          </tr>
                        </thead>
                        <tbody>
                          {createdTransactions.map((t, i) => (
                            <tr key={i} className="border-b last:border-b-0">
                              <td className="px-2 py-1 font-mono text-[10px]">{formatDateDisplay(t.date)}</td>
                              <td className="px-2 py-1">
                                <Badge variant="outline" className={cn("text-[9px]",
                                  t.bucket === "order" ? "border-slate-300 text-slate-600" :
                                  t.bucket === "output" ? "border-emerald-300 text-emerald-600" :
                                  t.bucket === "input" ? "border-teal-300 text-teal-600" :
                                  "border-muted text-muted-foreground"
                                )}>{t.shippingStatus}</Badge>
                              </td>
                              <td className="px-2 py-1 text-right tabular-nums font-medium">{t.qty.toLocaleString()}</td>
                              <td className="px-2 py-1 text-right tabular-nums text-emerald-600 dark:text-emerald-400">{t.cumulativeOutput.toLocaleString()}</td>
                              <td className="px-2 py-1 text-right tabular-nums text-teal-600 dark:text-teal-400">{t.cumulativeInput.toLocaleString()}</td>
                              <td className="px-2 py-1 text-right tabular-nums text-amber-600 dark:text-amber-400">{t.pending.toLocaleString()}</td>
                              <td className="px-2 py-1 text-right tabular-nums">{t.outputProgress}%</td>
                              <td className="px-2 py-1 text-right tabular-nums">{t.inputProgress}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="py-6 text-center text-sm text-muted-foreground">No transactions found.</div>
                  )}
                </div>
              </div>
            );
          })()}

          <DialogFooter>
            <Button variant="outline" onClick={() => { setCreatedSizeDetail(null); setCreatedTransactions(null); }}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      </Tabs>
    </div>
  );
}

export default ProductDashboardView;
