"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Monitor,
  Calendar,
  AlertTriangle,
  ChevronRight,
  ChevronDown,
  Search,
  Loader2,
  Filter,
  Download,
  Package,
  TrendingUp,
  TrendingDown,
  Clock,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  RotateCcw,
  Layers,
  Grid3x3,
  Table2,
  Activity,
} from "lucide-react";
import { toast } from "sonner";

import { api } from "@/lib/api-client";
import { cn, formatDateDisplay } from "@/lib/utils";
import { useAppStore, PRODUCT_THEME } from "@/store/app-store";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
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
  Tooltip as RTooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

type MonitorMode = "creation" | "deadline" | "daily" | "matrix" | "detail";

interface SizeRow {
  size: string;
  orderQty: number;
  outputQty: number;
  inputQty: number;
  pending: number;
  remaining: number;
  outputProgress: number;
  inputProgress: number;
  inputVsOutput: number;
  deadline: string | null;
  status: string[];
}

interface ColorNode {
  colorCode: string;
  orderQty: number;
  outputQty: number;
  inputQty: number;
  pending: number;
  remaining: number;
  outputProgress: number;
  inputProgress: number;
  sizes: SizeRow[];
}

interface FactoryPONode {
  factoryPO: string;
  orderQty: number;
  outputQty: number;
  inputQty: number;
  pending: number;
  remaining: number;
  outputProgress: number;
  inputProgress: number;
  colors: ColorNode[];
}

interface PoNode {
  poNo: string;
  orderQty: number;
  outputQty: number;
  inputQty: number;
  factoryPOs: FactoryPONode[];
}

interface ModelNode {
  model: string;
  orderQty: number;
  outputQty: number;
  inputQty: number;
  poNOs: PoNode[];
}

interface CreationDateNode {
  createdDate: string;
  orderQty: number;
  outputQty: number;
  inputQty: number;
  pending: number;
  remaining: number;
  outputProgress: number;
  inputProgress: number;
  models: ModelNode[];
}

interface CreationResponse {
  ok: boolean;
  hierarchy: CreationDateNode[];
  summary: { totalDates: number; totalOrderQty: number };
}

interface DeadlineGroup {
  model: string;
  poNo: string;
  factoryPO: string;
  colorCode: string;
  size: string;
  orderQty: number;
  outputQty: number;
  inputQty: number;
  pending: number;
  remaining: number;
  outputProgress: number;
  inputProgress: number;
  inputVsOutput: number;
  createdDate: string;
  status: string[];
}

interface DeadlineNode {
  deadline: string;
  orderQty: number;
  outputQty: number;
  inputQty: number;
  pending: number;
  remaining: number;
  outputProgress: number;
  inputProgress: number;
  orderCount: number;
  groups: DeadlineGroup[];
}

interface DeadlineResponse {
  ok: boolean;
  deadlines: DeadlineNode[];
  noDeadlineCount: number;
}

interface MatrixRow {
  createdDate: string;
  deadline: string;
  orderQty: number;
  outputQty: number;
  inputQty: number;
  pending: number;
  remaining: number;
  inputProgress: number;
}

interface MatrixResponse {
  ok: boolean;
  matrix: MatrixRow[];
}

interface DailyRow {
  date: string;
  dailyOutput: number;
  dailyInput: number;
  cumOutput: number;
  cumInput: number;
  pending: number;
  remaining: number;
  outputProgress: number;
  inputProgress: number;
  inputVsOutput: number;
}

interface DailyResponse {
  ok: boolean;
  daily: DailyRow[];
  summary: { totalOrder: number; totalOutput: number; totalInput: number };
}

interface DetailRow {
  createdDate: string;
  model: string;
  poNo: string;
  factoryPO: string;
  colorCode: string;
  colorCode2: string;
  size: string;
  orderQty: number;
  outputQty: number;
  inputQty: number;
  pending: number;
  remaining: number;
  outputProgress: number;
  inputProgress: number;
  inputVsOutput: number;
  deadline: string | null;
  daysRemaining: number | null;
  status: string;
  season: string;
  sku: string;
}

interface DetailResponse {
  ok: boolean;
  detail: DetailRow[];
  summary: {
    totalLines: number;
    totalOrderQty: number;
    totalOutputQty: number;
    totalInputQty: number;
    totalPending: number;
    totalRemaining: number;
    outputProgress: number;
    inputProgress: number;
    overdue: number;
    dueToday: number;
    upcoming: number;
  };
}

interface AppliedFilters {
  createdFrom: string;
  createdTo: string;
  deadlineFrom: string;
  deadlineTo: string;
  asOfDate: string;
  search: string;
}

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

const MONITOR_TABS: { key: MonitorMode; label: string; icon: React.ComponentType<{ className?: string }>; short: string }[] = [
  { key: "creation", label: "Creation Monitor", icon: Layers, short: "Creation" },
  { key: "deadline", label: "Deadline Monitor", icon: Calendar, short: "Deadline" },
  { key: "daily", label: "Daily Progress", icon: Activity, short: "Daily" },
  { key: "matrix", label: "Matrix", icon: Grid3x3, short: "Matrix" },
  { key: "detail", label: "Detail", icon: Table2, short: "Detail" },
];

const TOOLTIP_STYLE = {
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--popover)",
  color: "var(--popover-foreground)",
  fontSize: 12,
} as const;

const CHART_COLORS = {
  output: "oklch(0.6 0.13 162)", // emerald
  input: "oklch(0.6 0.13 180)", // teal
  pending: "oklch(0.74 0.16 75)", // amber
  remaining: "oklch(0.62 0.21 18)", // rose
} as const;

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "0";
  return Math.round(n).toLocaleString();
}

function fmtPct(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

/** Status badge color tokens (output/input/status semantics). */
function statusBadgeClass(status: string): string {
  const base = "border text-[10px] px-1.5 py-0.5 rounded-md font-medium whitespace-nowrap";
  switch (status) {
    case "NOT_STARTED":
      return cn(base, "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-300");
    case "IN_PROGRESS":
    case "INPUT_IN_PROGRESS":
      return cn(base, "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300");
    case "OUTPUT_COMPLETED":
    case "INPUT_COMPLETED":
      return cn(base, "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300");
    case "OVER_OUTPUT":
    case "OVER_INPUT":
      return cn(base, "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300");
    default:
      return cn(base, "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-300");
  }
}

function StatusBadges({ statuses, compact = false }: { statuses: string[]; compact?: boolean }) {
  const list = (statuses && statuses.length ? statuses : ["NOT_STARTED"]);
  return (
    <div className={cn("flex flex-wrap gap-1", compact && "gap-0.5")}>
      {list.map((s) => (
        <span key={s} className={statusBadgeClass(s)}>
          {s.replace(/_/g, " ")}
        </span>
      ))}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  return <span className={statusBadgeClass(status)}>{status.replace(/_/g, " ")}</span>;
}

/** Returns a row tint class based on a list of statuses. */
function statusRowTint(statuses: string[] | string): string {
  const list = Array.isArray(statuses) ? statuses : statuses.split(",").map((s) => s.trim());
  if (list.some((s) => s === "OVER_OUTPUT" || s === "OVER_INPUT")) {
    return "bg-rose-50/60 dark:bg-rose-950/15";
  }
  if (list.some((s) => s === "IN_PROGRESS" || s === "INPUT_IN_PROGRESS")) {
    return "bg-amber-50/40 dark:bg-amber-950/15";
  }
  if (list.some((s) => s === "OUTPUT_COMPLETED" || s === "INPUT_COMPLETED")) {
    return "bg-emerald-50/40 dark:bg-emerald-950/15";
  }
  return "";
}

/** Color for input-progress cell based on threshold. */
function inputPctCellClass(pct: number): string {
  if (pct >= 90) return "text-emerald-700 dark:text-emerald-300 font-semibold";
  if (pct >= 50) return "text-amber-700 dark:text-amber-300 font-medium";
  return "text-rose-700 dark:text-rose-300 font-medium";
}

function outputPctCellClass(pct: number): string {
  if (pct >= 90) return "text-emerald-700 dark:text-emerald-300 font-semibold";
  if (pct >= 50) return "text-amber-700 dark:text-amber-300 font-medium";
  return "text-rose-700 dark:text-rose-300 font-medium";
}

// ----------------------------------------------------------------------------
// Small UI atoms
// ----------------------------------------------------------------------------

function ChartSkeleton({ height = 280 }: { height?: number }) {
  return (
    <div className="flex w-full items-center justify-center" style={{ height }}>
      <Skeleton className="h-full w-full" />
    </div>
  );
}

function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}

function EmptyState({ message, icon: Icon = Package }: { message: string; icon?: React.ComponentType<{ className?: string }> }) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center justify-center py-10 text-center">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <Icon className="h-5 w-5" />
        </div>
        <p className="mt-3 text-sm font-medium">No data</p>
        <p className="mt-1 max-w-sm text-xs text-muted-foreground">{message}</p>
      </CardContent>
    </Card>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Alert variant="destructive">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>Failed to load</AlertTitle>
      <AlertDescription className="flex flex-col gap-2">
        <span className="text-xs break-words">{message}</span>
        {onRetry ? (
          <Button size="sm" variant="outline" onClick={onRetry} className="w-fit">
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Retry
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

interface StatCardProps {
  label: string;
  value: string;
  sub?: React.ReactNode;
  icon: React.ComponentType<{ className?: string }>;
  iconClass: string;
  loading?: boolean;
}

function StatCard({ label, value, sub, icon: Icon, iconClass, loading }: StatCardProps) {
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
            {loading ? (
              <Skeleton className="mt-2 h-6 w-20" />
            ) : (
              <p className="mt-1 text-xl font-bold tracking-tight tabular-nums">{value}</p>
            )}
            {sub ? <div className="mt-1 text-[11px] text-muted-foreground">{sub}</div> : null}
          </div>
          <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", iconClass)}>
            <Icon className="h-4 w-4" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ----------------------------------------------------------------------------
// Filter bar (two-dimension: created + deadline + as-of + search)
// ----------------------------------------------------------------------------

interface FilterBarProps {
  createdFrom: string;
  createdTo: string;
  deadlineFrom: string;
  deadlineTo: string;
  asOfDate: string;
  search: string;
  onCreatedFrom: (v: string) => void;
  onCreatedTo: (v: string) => void;
  onDeadlineFrom: (v: string) => void;
  onDeadlineTo: (v: string) => void;
  onAsOfDate: (v: string) => void;
  onSearch: (v: string) => void;
  onApply: () => void;
  onReset: () => void;
  applying: boolean;
}

function FilterBar(props: FilterBarProps) {
  const {
    createdFrom, createdTo, deadlineFrom, deadlineTo, asOfDate, search,
    onCreatedFrom, onCreatedTo, onDeadlineFrom, onDeadlineTo, onAsOfDate, onSearch,
    onApply, onReset, applying,
  } = props;

  const hasAnyActive =
    Boolean(createdFrom) || Boolean(createdTo) ||
    Boolean(deadlineFrom) || Boolean(deadlineTo) ||
    Boolean(asOfDate) || Boolean(search);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm">Filters</CardTitle>
          <Badge variant="outline" className="gap-1 text-[11px]">
            <Filter className="h-3 w-3" />
            {hasAnyActive ? "Active" : "No filters"}
          </Badge>
        </div>
        <CardDescription className="text-xs">
          Two-dimension date filtering (created-date + deadline) plus as-of-date snapshot.
          Click Apply to commit filters.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Created From</label>
            <Input type="date" className="h-9" value={createdFrom} onChange={(e) => onCreatedFrom(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Created To</label>
            <Input type="date" className="h-9" value={createdTo} onChange={(e) => onCreatedTo(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Deadline From</label>
            <Input type="date" className="h-9" value={deadlineFrom} onChange={(e) => onDeadlineFrom(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Deadline To</label>
            <Input type="date" className="h-9" value={deadlineTo} onChange={(e) => onDeadlineTo(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">As-Of Date</label>
            <Input type="date" className="h-9" value={asOfDate} onChange={(e) => onAsOfDate(e.target.value)} />
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t pt-3 md:flex-row md:items-end md:justify-between">
          <div className="flex flex-1 flex-col gap-1.5 md:max-w-md">
            <label className="text-xs font-medium text-muted-foreground">
              Search (model / PO NO# / Factory PO / size)
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-9 pl-8"
                placeholder="Type to filter results across these dimensions"
                value={search}
                onChange={(e) => onSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onApply();
                }}
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button onClick={onApply} disabled={applying} className="h-9">
              {applying ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Filter className="mr-1.5 h-3.5 w-3.5" />}
              Apply Filters
            </Button>
            <Button variant="outline" onClick={onReset} className="h-9">
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Reset
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ----------------------------------------------------------------------------
// Progress bar cell (mini horizontal bar)
// ----------------------------------------------------------------------------

function MiniProgress({ pct, tone = "output" }: { pct: number; tone?: "output" | "input" | "pending" | "remaining" }) {
  const v = clampPct(pct);
  const color =
    tone === "output" ? "bg-emerald-500" :
    tone === "input" ? "bg-teal-500" :
    tone === "pending" ? "bg-amber-500" : "bg-rose-500";
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-1.5 flex-1 min-w-[40px] overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", color)} style={{ width: `${v}%` }} />
      </div>
      <span className="text-[11px] tabular-nums text-muted-foreground">{fmtPct(pct)}</span>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Creation Monitor (View 1)
// ----------------------------------------------------------------------------

interface CreationViewProps {
  productType: string;
  filters: AppliedFilters;
  refreshKey: number;
  theme: { bg: string; text: string; border: string; badge: string; gradient: string };
}

function CreationView({ productType, filters, refreshKey, theme }: CreationViewProps) {
  const { currentProduct } = useAppStore();
  const [expandedNodes, setExpandedNodes] = React.useState<Set<string>>(new Set());
  void currentProduct;

  const query = useQuery({
    queryKey: ["order-monitor", "creation", productType, filters, refreshKey],
    queryFn: () =>
      api.orderMonitor({
        productType,
        mode: "creation",
        createdFrom: filters.createdFrom || undefined,
        createdTo: filters.createdTo || undefined,
        deadlineFrom: filters.deadlineFrom || undefined,
        deadlineTo: filters.deadlineTo || undefined,
        asOfDate: filters.asOfDate || undefined,
      }),
    enabled: productType.length > 0,
  });

  // Reset expansion when product changes
  React.useEffect(() => {
    setExpandedNodes(new Set());
  }, [productType]);

  const toggleNode = React.useCallback((id: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const isExpanded = React.useCallback((id: string) => expandedNodes.has(id), [expandedNodes]);

  // Auto-expand top-level date nodes on first load (top 3)
  const autoExpanded = React.useRef(false);
  React.useEffect(() => {
    if (autoExpanded.current) return;
    if (query.data?.hierarchy?.length) {
      autoExpanded.current = true;
      setExpandedNodes((prev) => {
        const next = new Set(prev);
        query.data.hierarchy.slice(0, 3).forEach((h) => next.add(`date:${h.createdDate}`));
        return next;
      });
    }
  }, [query.data]);

  // Apply search filter across model/poNo/factoryPO/size — prune tree
  const search = filters.search.trim().toLowerCase();
  const hierarchy = React.useMemo(() => {
    if (!query.data?.hierarchy) return [];
    if (!search) return query.data.hierarchy;
    return query.data.hierarchy
      .map((dateNode) => {
        const models = dateNode.models
          .map((m) => {
            const poList = m.poNOs
              .map((po) => {
                const fpoList = po.factoryPOs
                  .map((fpo) => {
                    const colorList = fpo.colors
                      .map((col) => {
                        const sizes = col.sizes.filter((s) =>
                          [m.model, po.poNo, fpo.factoryPO, s.size].some((v) =>
                            String(v || "").toLowerCase().includes(search)
                          )
                        );
                        if (sizes.length === 0) return null;
                        const orderQty = sizes.reduce((a, s) => a + s.orderQty, 0);
                        const outputQty = sizes.reduce((a, s) => a + s.outputQty, 0);
                        const inputQty = sizes.reduce((a, s) => a + s.inputQty, 0);
                        return {
                          ...col,
                          orderQty,
                          outputQty,
                          inputQty,
                          pending: Math.max(0, outputQty - inputQty),
                          remaining: Math.max(0, orderQty - outputQty),
                          outputProgress: orderQty > 0 ? Math.round((outputQty / orderQty) * 1000) / 10 : 0,
                          inputProgress: orderQty > 0 ? Math.round((inputQty / orderQty) * 1000) / 10 : 0,
                          sizes,
                        };
                      })
                      .filter(Boolean) as ColorNode[];
                    if (colorList.length === 0) return null;
                    const orderQty = colorList.reduce((a, c) => a + c.orderQty, 0);
                    const outputQty = colorList.reduce((a, c) => a + c.outputQty, 0);
                    const inputQty = colorList.reduce((a, c) => a + c.inputQty, 0);
                    return {
                      ...fpo,
                      orderQty,
                      outputQty,
                      inputQty,
                      pending: Math.max(0, outputQty - inputQty),
                      remaining: Math.max(0, orderQty - outputQty),
                      outputProgress: orderQty > 0 ? Math.round((outputQty / orderQty) * 1000) / 10 : 0,
                      inputProgress: orderQty > 0 ? Math.round((inputQty / orderQty) * 1000) / 10 : 0,
                      colors: colorList,
                    };
                  })
                  .filter(Boolean) as FactoryPONode[];
                if (fpoList.length === 0) return null;
                const orderQty = fpoList.reduce((a, f) => a + f.orderQty, 0);
                const outputQty = fpoList.reduce((a, f) => a + f.outputQty, 0);
                const inputQty = fpoList.reduce((a, f) => a + f.inputQty, 0);
                return {
                  ...po,
                  orderQty,
                  outputQty,
                  inputQty,
                  factoryPOs: fpoList,
                };
              })
              .filter(Boolean) as PoNode[];
            if (poList.length === 0) return null;
            const orderQty = poList.reduce((a, p) => a + p.orderQty, 0);
            const outputQty = poList.reduce((a, p) => a + p.outputQty, 0);
            const inputQty = poList.reduce((a, p) => a + p.inputQty, 0);
            return { ...m, orderQty, outputQty, inputQty, poNOs: poList };
          })
          .filter(Boolean) as ModelNode[];
        if (models.length === 0) return null;
        const orderQty = models.reduce((a, m) => a + m.orderQty, 0);
        const outputQty = models.reduce((a, m) => a + m.outputQty, 0);
        const inputQty = models.reduce((a, m) => a + m.inputQty, 0);
        return {
          ...dateNode,
          orderQty,
          outputQty,
          inputQty,
          pending: Math.max(0, outputQty - inputQty),
          remaining: Math.max(0, orderQty - outputQty),
          outputProgress: orderQty > 0 ? Math.round((outputQty / orderQty) * 1000) / 10 : 0,
          inputProgress: orderQty > 0 ? Math.round((inputQty / orderQty) * 1000) / 10 : 0,
          models,
        };
      })
      .filter(Boolean) as CreationDateNode[];
  }, [query.data, search]);

  const summary = query.data?.summary;
  const totalOrder = summary?.totalOrderQty ?? 0;
  const totalOutput = hierarchy.reduce((a, h) => a + h.outputQty, 0);
  const totalInput = hierarchy.reduce((a, h) => a + h.inputQty, 0);
  const totalPending = hierarchy.reduce((a, h) => a + h.pending, 0);
  const totalRemaining = hierarchy.reduce((a, h) => a + h.remaining, 0);
  const outPct = totalOrder > 0 ? Math.round((totalOutput / totalOrder) * 1000) / 10 : 0;
  const inPct = totalOrder > 0 ? Math.round((totalInput / totalOrder) * 1000) / 10 : 0;
  const inOutPct = totalOutput > 0 ? Math.round((totalInput / totalOutput) * 1000) / 10 : 0;

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <StatCard label="Total Order Qty" value={fmt(totalOrder)} icon={Package} iconClass="bg-slate-100 text-slate-700 dark:bg-slate-900/40 dark:text-slate-300" loading={query.isLoading} />
        <StatCard label="Total Output" value={fmt(totalOutput)} icon={TrendingUp} iconClass="bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" loading={query.isLoading} />
        <StatCard label="Total Input" value={fmt(totalInput)} icon={TrendingDown} iconClass="bg-teal-100 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300" loading={query.isLoading} />
        <StatCard label="Total Pending" value={fmt(totalPending)} icon={Clock} iconClass="bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300" loading={query.isLoading} />
        <StatCard label="Total Remaining" value={fmt(totalRemaining)} icon={AlertTriangle} iconClass="bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300" loading={query.isLoading} />
        <StatCard label="Output %" value={fmtPct(outPct)} icon={Activity} iconClass="bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" loading={query.isLoading} />
        <StatCard label="Input %" value={fmtPct(inPct)} icon={Activity} iconClass="bg-teal-100 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300" loading={query.isLoading} />
        <StatCard label="Input / Output %" value={fmtPct(inOutPct)} icon={Activity} iconClass="bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300" loading={query.isLoading} />
      </div>

      {query.isError ? (
        <ErrorState
          message={query.error instanceof Error ? query.error.message : "Failed to load creation data"}
          onRetry={() => query.refetch()}
        />
      ) : null}

      {query.isLoading ? (
        <Card>
          <CardContent className="p-4">
            <TableSkeleton rows={6} />
          </CardContent>
        </Card>
      ) : hierarchy.length === 0 ? (
        <EmptyState message="No creation-date hierarchy found for the current filters." icon={Layers} />
      ) : (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <CardTitle className="text-sm">Creation Date Hierarchy</CardTitle>
                <CardDescription className="text-xs">
                  Drill down: Created Date → Model → PO NO# → Factory PO → Color → Size.
                  Summary uses {summary?.totalDates ?? 0} date groups.
                </CardDescription>
              </div>
              <Badge className={theme.badge}>{hierarchy.length} date groups</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-1">
            {hierarchy.map((dateNode) => {
              const dateKey = `date:${dateNode.createdDate}`;
              const dateOpen = isExpanded(dateKey);
              return (
                <div key={dateKey} className="rounded-md border">
                  <button
                    type="button"
                    onClick={() => toggleNode(dateKey)}
                    className="flex w-full items-center gap-2 bg-muted/40 px-3 py-2 text-left hover:bg-muted/70"
                  >
                    {dateOpen ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
                    <Calendar className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="font-semibold text-sm">{formatDateDisplay(dateNode.createdDate)}</span>
                    <Badge variant="outline" className="ml-1 text-[10px]">{dateNode.models.length} models</Badge>
                    <span className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] tabular-nums">
                      <span className="text-muted-foreground">Order <span className="font-semibold text-foreground">{fmt(dateNode.orderQty)}</span></span>
                      <span className="text-emerald-600 dark:text-emerald-400">Out {fmt(dateNode.outputQty)}</span>
                      <span className="text-teal-600 dark:text-teal-400">In {fmt(dateNode.inputQty)}</span>
                      <span className="text-amber-600 dark:text-amber-400">Pend {fmt(dateNode.pending)}</span>
                      <span className="text-rose-600 dark:text-rose-400">Rem {fmt(dateNode.remaining)}</span>
                      <span className={outputPctCellClass(dateNode.outputProgress)}>Out% {fmtPct(dateNode.outputProgress)}</span>
                      <span className={inputPctCellClass(dateNode.inputProgress)}>In% {fmtPct(dateNode.inputProgress)}</span>
                    </span>
                  </button>
                  {dateOpen ? (
                    <div className="border-t">
                      {dateNode.models.map((m) => {
                        const mKey = `${dateKey}|model:${m.model}`;
                        const mOpen = isExpanded(mKey);
                        return (
                          <div key={mKey} className="border-b last:border-b-0">
                            <button
                              type="button"
                              onClick={() => toggleNode(mKey)}
                              className="flex w-full items-center gap-2 px-3 py-2 pl-6 text-left hover:bg-muted/40"
                            >
                              {mOpen ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                              <span className="text-sm font-medium">{m.model || "—"}</span>
                              <Badge variant="outline" className="text-[10px]">{m.poNOs.length} POs</Badge>
                              <span className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] tabular-nums">
                                <span className="text-muted-foreground">Order <span className="font-semibold text-foreground">{fmt(m.orderQty)}</span></span>
                                <span className="text-emerald-600 dark:text-emerald-400">Out {fmt(m.outputQty)}</span>
                                <span className="text-teal-600 dark:text-teal-400">In {fmt(m.inputQty)}</span>
                                <span className={outputPctCellClass(m.outputProgress)}>Out% {fmtPct(m.outputProgress)}</span>
                                <span className={inputPctCellClass(m.inputProgress)}>In% {fmtPct(m.inputProgress)}</span>
                              </span>
                            </button>
                            {mOpen ? (
                              <div className="border-t bg-muted/10">
                                {m.poNOs.map((po) => {
                                  const poKey = `${mKey}|po:${po.poNo}`;
                                  const poOpen = isExpanded(poKey);
                                  return (
                                    <div key={poKey} className="border-b last:border-b-0">
                                      <button
                                        type="button"
                                        onClick={() => toggleNode(poKey)}
                                        className="flex w-full items-center gap-2 px-3 py-2 pl-10 text-left hover:bg-muted/40"
                                      >
                                        {poOpen ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                                        <span className="text-xs font-medium">PO NO# {po.poNo || "—"}</span>
                                        <Badge variant="outline" className="text-[10px]">{po.factoryPOs.length} FPOs</Badge>
                                        <span className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] tabular-nums">
                                          <span className="text-muted-foreground">Order <span className="font-semibold text-foreground">{fmt(po.orderQty)}</span></span>
                                          <span className="text-emerald-600 dark:text-emerald-400">Out {fmt(po.outputQty)}</span>
                                          <span className="text-teal-600 dark:text-teal-400">In {fmt(po.inputQty)}</span>
                                          <span className={outputPctCellClass(po.outputProgress)}>Out% {fmtPct(po.outputProgress)}</span>
                                          <span className={inputPctCellClass(po.inputProgress)}>In% {fmtPct(po.inputProgress)}</span>
                                        </span>
                                      </button>
                                      {poOpen ? (
                                        <div className="border-t bg-background">
                                          {po.factoryPOs.map((fpo) => {
                                            const fpoKey = `${poKey}|fpo:${fpo.factoryPO}`;
                                            const fpoOpen = isExpanded(fpoKey);
                                            return (
                                              <div key={fpoKey} className="border-b last:border-b-0">
                                                <button
                                                  type="button"
                                                  onClick={() => toggleNode(fpoKey)}
                                                  className="flex w-full items-center gap-2 px-3 py-2 pl-14 text-left hover:bg-muted/40"
                                                >
                                                  {fpoOpen ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                                                  <span className="text-xs font-medium">Factory PO {fpo.factoryPO || "—"}</span>
                                                  <Badge variant="outline" className="text-[10px]">{fpo.colors.length} colors</Badge>
                                                  <span className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] tabular-nums">
                                                    <span className="text-muted-foreground">Order <span className="font-semibold text-foreground">{fmt(fpo.orderQty)}</span></span>
                                                    <span className="text-emerald-600 dark:text-emerald-400">Out {fmt(fpo.outputQty)}</span>
                                                    <span className="text-teal-600 dark:text-teal-400">In {fmt(fpo.inputQty)}</span>
                                                    <span className={outputPctCellClass(fpo.outputProgress)}>Out% {fmtPct(fpo.outputProgress)}</span>
                                                    <span className={inputPctCellClass(fpo.inputProgress)}>In% {fmtPct(fpo.inputProgress)}</span>
                                                  </span>
                                                </button>
                                                {fpoOpen ? (
                                                  <div className="border-t bg-background">
                                                    {fpo.colors.map((col) => {
                                                      const colKey = `${fpoKey}|color:${col.colorCode}`;
                                                      const colOpen = isExpanded(colKey);
                                                      return (
                                                        <div key={colKey} className="border-b last:border-b-0">
                                                          <button
                                                            type="button"
                                                            onClick={() => toggleNode(colKey)}
                                                            className="flex w-full items-center gap-2 px-3 py-2 pl-20 text-left hover:bg-muted/40"
                                                          >
                                                            {colOpen ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                                                            <span className="text-xs font-medium">Color {col.colorCode || "—"}</span>
                                                            <Badge variant="outline" className="text-[10px]">{col.sizes.length} sizes</Badge>
                                                            <span className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] tabular-nums">
                                                              <span className="text-muted-foreground">Order <span className="font-semibold text-foreground">{fmt(col.orderQty)}</span></span>
                                                              <span className="text-emerald-600 dark:text-emerald-400">Out {fmt(col.outputQty)}</span>
                                                              <span className="text-teal-600 dark:text-teal-400">In {fmt(col.inputQty)}</span>
                                                              <span className={outputPctCellClass(col.outputProgress)}>Out% {fmtPct(col.outputProgress)}</span>
                                                              <span className={inputPctCellClass(col.inputProgress)}>In% {fmtPct(col.inputProgress)}</span>
                                                            </span>
                                                          </button>
                                                          {colOpen ? (
                                                            <div className="overflow-x-auto scroll-thin border-t bg-background">
                                                              <Table>
                                                                <TableHeader>
                                                                  <TableRow className="bg-muted/40">
                                                                    <TableHead className="h-8 text-[11px]">Size</TableHead>
                                                                    <TableHead className="h-8 text-right text-[11px]">Order</TableHead>
                                                                    <TableHead className="h-8 text-right text-[11px]">Output</TableHead>
                                                                    <TableHead className="h-8 text-right text-[11px]">Input</TableHead>
                                                                    <TableHead className="h-8 text-right text-[11px]">Pending</TableHead>
                                                                    <TableHead className="h-8 text-right text-[11px]">Remaining</TableHead>
                                                                    <TableHead className="h-8 text-[11px]">Out%</TableHead>
                                                                    <TableHead className="h-8 text-[11px]">In%</TableHead>
                                                                    <TableHead className="h-8 text-[11px]">In/Out%</TableHead>
                                                                    <TableHead className="h-8 text-[11px]">Deadline</TableHead>
                                                                    <TableHead className="h-8 text-[11px]">Status</TableHead>
                                                                  </TableRow>
                                                                </TableHeader>
                                                                <TableBody>
                                                                  {col.sizes.map((s) => (
                                                                    <TableRow key={s.size} className={statusRowTint(s.status)}>
                                                                      <TableCell className="py-1.5 text-xs font-medium">{s.size || "—"}</TableCell>
                                                                      <TableCell className="py-1.5 text-right text-xs tabular-nums">{fmt(s.orderQty)}</TableCell>
                                                                      <TableCell className="py-1.5 text-right text-xs tabular-nums text-emerald-700 dark:text-emerald-300">{fmt(s.outputQty)}</TableCell>
                                                                      <TableCell className="py-1.5 text-right text-xs tabular-nums text-teal-700 dark:text-teal-300">{fmt(s.inputQty)}</TableCell>
                                                                      <TableCell className="py-1.5 text-right text-xs tabular-nums text-amber-700 dark:text-amber-300">{fmt(s.pending)}</TableCell>
                                                                      <TableCell className="py-1.5 text-right text-xs tabular-nums text-rose-700 dark:text-rose-300">{fmt(s.remaining)}</TableCell>
                                                                      <TableCell className="py-1.5 text-[11px]"><MiniProgress pct={s.outputProgress} tone="output" /></TableCell>
                                                                      <TableCell className="py-1.5 text-[11px]"><MiniProgress pct={s.inputProgress} tone="input" /></TableCell>
                                                                      <TableCell className="py-1.5 text-right text-[11px] tabular-nums text-muted-foreground">{fmtPct(s.inputVsOutput)}</TableCell>
                                                                      <TableCell className="py-1.5 text-[11px]">{formatDateDisplay(s.deadline)}</TableCell>
                                                                      <TableCell className="py-1.5"><StatusBadges statuses={s.status} compact /></TableCell>
                                                                    </TableRow>
                                                                  ))}
                                                                </TableBody>
                                                              </Table>
                                                            </div>
                                                          ) : null}
                                                        </div>
                                                      );
                                                    })}
                                                  </div>
                                                ) : null}
                                              </div>
                                            );
                                          })}
                                        </div>
                                      ) : null}
                                    </div>
                                  );
                                })}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Deadline Monitor (View 2)
// ----------------------------------------------------------------------------

interface DeadlineViewProps {
  productType: string;
  filters: AppliedFilters;
  refreshKey: number;
  theme: { bg: string; text: string; border: string; badge: string; gradient: string };
}

function DeadlineView({ productType, filters, refreshKey, theme }: DeadlineViewProps) {
  const [expandedNodes, setExpandedNodes] = React.useState<Set<string>>(new Set());

  const query = useQuery({
    queryKey: ["order-monitor", "deadline", productType, filters, refreshKey],
    queryFn: () =>
      api.orderMonitor({
        productType,
        mode: "deadline",
        createdFrom: filters.createdFrom || undefined,
        createdTo: filters.createdTo || undefined,
        deadlineFrom: filters.deadlineFrom || undefined,
        deadlineTo: filters.deadlineTo || undefined,
        asOfDate: filters.asOfDate || undefined,
      }),
    enabled: productType.length > 0,
  });

  React.useEffect(() => {
    setExpandedNodes(new Set());
  }, [productType]);

  const toggleNode = React.useCallback((id: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Warning cards
  const today = React.useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }, []);
  const dayMs = 86400000;

  const stats = React.useMemo(() => {
    const list = query.data?.deadlines ?? [];
    let overdue = 0, dueToday = 0, dueThisWeek = 0, upcoming = 0;
    for (const d of list) {
      if (!d.deadline) continue;
      const t = d.deadline.includes("-") ? new Date(d.deadline) : new Date(Date.UTC(1899, 11, 30) + Number(d.deadline) * 86400000);
      t.setHours(0, 0, 0, 0);
      const diff = Math.floor((t.getTime() - today) / dayMs);
      const rem = d.remaining > 0;
      if (diff < 0 && rem) overdue += 1;
      else if (diff === 0) dueToday += 1;
      else if (diff > 0 && diff <= 7) dueThisWeek += 1;
      else if (diff > 7) upcoming += 1;
    }
    return { overdue, dueToday, dueThisWeek, upcoming };
  }, [query.data, today]);

  // Search filter (client-side)
  const search = filters.search.trim().toLowerCase();
  const deadlines = React.useMemo(() => {
    if (!query.data?.deadlines) return [];
    if (!search) return query.data.deadlines;
    return query.data.deadlines
      .map((d) => ({
        ...d,
        groups: d.groups.filter((g) =>
          [g.model, g.poNo, g.factoryPO, g.size, g.colorCode].some((v) =>
            String(v || "").toLowerCase().includes(search)
          )
        ),
      }))
      .filter((d) => d.groups.length > 0);
  }, [query.data, search]);

  return (
    <div className="space-y-4">
      {/* Warning cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Overdue"
          value={fmt(stats.overdue)}
          icon={AlertTriangle}
          iconClass="bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
          loading={query.isLoading}
          sub={<span className="text-rose-600 dark:text-rose-400">Past deadline, still pending</span>}
        />
        <StatCard
          label="Due Today"
          value={fmt(stats.dueToday)}
          icon={Clock}
          iconClass="bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
          loading={query.isLoading}
        />
        <StatCard
          label="Due This Week"
          value={fmt(stats.dueThisWeek)}
          icon={Calendar}
          iconClass="bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
          loading={query.isLoading}
          sub={<span>Within 7 days</span>}
        />
        <StatCard
          label="Upcoming"
          value={fmt(stats.upcoming)}
          icon={Calendar}
          iconClass="bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
          loading={query.isLoading}
          sub={<span>Beyond 7 days</span>}
        />
      </div>

      {query.isError ? (
        <ErrorState
          message={query.error instanceof Error ? query.error.message : "Failed to load deadline data"}
          onRetry={() => query.refetch()}
        />
      ) : null}

      {query.isLoading ? (
        <Card>
          <CardContent className="p-4">
            <TableSkeleton rows={6} />
          </CardContent>
        </Card>
      ) : deadlines.length === 0 ? (
        <EmptyState message="No deadline groups found for the current filters." icon={Calendar} />
      ) : (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <CardTitle className="text-sm">Deadline Load</CardTitle>
                <CardDescription className="text-xs">
                  Sorted by deadline (ascending). Click a deadline row to expand its detail groups.
                </CardDescription>
              </div>
              <Badge className={theme.badge}>{deadlines.length} deadlines</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-1">
            {/* Deadline summary table */}
            <div className="overflow-x-auto scroll-thin rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead className="h-9 text-xs">Deadline</TableHead>
                    <TableHead className="h-9 text-right text-xs">Order Qty</TableHead>
                    <TableHead className="h-9 text-right text-xs">Output</TableHead>
                    <TableHead className="h-9 text-right text-xs">Input</TableHead>
                    <TableHead className="h-9 text-right text-xs">Remaining</TableHead>
                    <TableHead className="h-9 text-xs">Input %</TableHead>
                    <TableHead className="h-9 text-right text-xs">Orders</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {deadlines.map((d) => {
                    const rowKey = `deadline:${d.deadline}`;
                    const open = expandedNodes.has(rowKey);
                    let diff = 999;
                    if (d.deadline) {
                      const t = d.deadline.includes("-") ? new Date(d.deadline) : new Date(Date.UTC(1899, 11, 30) + Number(d.deadline) * 86400000);
                      t.setHours(0, 0, 0, 0);
                      diff = Math.floor((t.getTime() - today) / dayMs);
                    }
                    const isOverdue = diff < 0 && d.remaining > 0;
                    return (
                      <React.Fragment key={rowKey}>
                        <TableRow
                          className={cn("cursor-pointer hover:bg-muted/40", isOverdue && "bg-rose-50/60 dark:bg-rose-950/15")}
                          onClick={() => toggleNode(rowKey)}
                        >
                          <TableCell className="py-2 text-xs">
                            <div className="flex items-center gap-2">
                              {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                              <span className="font-medium">{formatDateDisplay(d.deadline)}</span>
                              {isOverdue ? (
                                <Badge variant="outline" className="border-rose-300 text-rose-700 dark:border-rose-800 dark:text-rose-300 text-[10px]">Overdue</Badge>
                              ) : diff === 0 ? (
                                <Badge variant="outline" className="border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-300 text-[10px]">Today</Badge>
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell className="py-2 text-right text-xs tabular-nums">{fmt(d.orderQty)}</TableCell>
                          <TableCell className="py-2 text-right text-xs tabular-nums text-emerald-700 dark:text-emerald-300">{fmt(d.outputQty)}</TableCell>
                          <TableCell className="py-2 text-right text-xs tabular-nums text-teal-700 dark:text-teal-300">{fmt(d.inputQty)}</TableCell>
                          <TableCell className="py-2 text-right text-xs tabular-nums text-rose-700 dark:text-rose-300">{fmt(d.remaining)}</TableCell>
                          <TableCell className="py-2 text-xs"><MiniProgress pct={d.inputProgress} tone="input" /></TableCell>
                          <TableCell className="py-2 text-right text-xs tabular-nums">{fmt(d.orderCount)}</TableCell>
                        </TableRow>
                        {open ? (
                          <TableRow>
                            <TableCell colSpan={7} className="bg-muted/10 p-0">
                              <div className="max-h-96 overflow-y-auto scroll-thin">
                                <Table>
                                  <TableHeader>
                                    <TableRow className="bg-muted/40 sticky top-0">
                                      <TableHead className="h-8 text-[11px]">Model</TableHead>
                                      <TableHead className="h-8 text-[11px]">PO NO#</TableHead>
                                      <TableHead className="h-8 text-[11px]">Factory PO</TableHead>
                                      <TableHead className="h-8 text-[11px]">Color</TableHead>
                                      <TableHead className="h-8 text-[11px]">Size</TableHead>
                                      <TableHead className="h-8 text-right text-[11px]">Order</TableHead>
                                      <TableHead className="h-8 text-right text-[11px]">Output</TableHead>
                                      <TableHead className="h-8 text-right text-[11px]">Input</TableHead>
                                      <TableHead className="h-8 text-right text-[11px]">Pending</TableHead>
                                      <TableHead className="h-8 text-right text-[11px]">Remaining</TableHead>
                                      <TableHead className="h-8 text-[11px]">Out%</TableHead>
                                      <TableHead className="h-8 text-[11px]">In%</TableHead>
                                      <TableHead className="h-8 text-[11px]">Created</TableHead>
                                      <TableHead className="h-8 text-[11px]">Status</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {d.groups.map((g, i) => (
                                      <TableRow key={`${g.poNo}-${g.factoryPO}-${g.size}-${i}`} className={statusRowTint(g.status)}>
                                        <TableCell className="py-1.5 text-xs">{g.model || "—"}</TableCell>
                                        <TableCell className="py-1.5 text-xs">{g.poNo || "—"}</TableCell>
                                        <TableCell className="py-1.5 text-xs">{g.factoryPO || "—"}</TableCell>
                                        <TableCell className="py-1.5 text-xs">{g.colorCode || "—"}</TableCell>
                                        <TableCell className="py-1.5 text-xs">{g.size || "—"}</TableCell>
                                        <TableCell className="py-1.5 text-right text-xs tabular-nums">{fmt(g.orderQty)}</TableCell>
                                        <TableCell className="py-1.5 text-right text-xs tabular-nums text-emerald-700 dark:text-emerald-300">{fmt(g.outputQty)}</TableCell>
                                        <TableCell className="py-1.5 text-right text-xs tabular-nums text-teal-700 dark:text-teal-300">{fmt(g.inputQty)}</TableCell>
                                        <TableCell className="py-1.5 text-right text-xs tabular-nums text-amber-700 dark:text-amber-300">{fmt(g.pending)}</TableCell>
                                        <TableCell className="py-1.5 text-right text-xs tabular-nums text-rose-700 dark:text-rose-300">{fmt(g.remaining)}</TableCell>
                                        <TableCell className="py-1.5 text-[11px]"><MiniProgress pct={g.outputProgress} tone="output" /></TableCell>
                                        <TableCell className="py-1.5 text-[11px]"><MiniProgress pct={g.inputProgress} tone="input" /></TableCell>
                                        <TableCell className="py-1.5 text-[11px]">{formatDateDisplay(g.createdDate)}</TableCell>
                                        <TableCell className="py-1.5"><StatusBadges statuses={g.status} compact /></TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              </div>
                            </TableCell>
                          </TableRow>
                        ) : null}
                      </React.Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            {query.data?.noDeadlineCount ? (
              <p className="pt-2 text-[11px] text-muted-foreground">
                <AlertTriangle className="mr-1 inline h-3 w-3 text-amber-500" />
                {fmt(query.data.noDeadlineCount)} order group(s) have no deadline set.
              </p>
            ) : null}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Daily Progress (View 3)
// ----------------------------------------------------------------------------

interface DailyViewProps {
  productType: string;
  filters: AppliedFilters;
  refreshKey: number;
  theme: { bg: string; text: string; border: string; badge: string; gradient: string };
}

function DailyView({ productType, filters, refreshKey, theme }: DailyViewProps) {
  const query = useQuery({
    queryKey: ["order-monitor", "daily", productType, filters, refreshKey],
    queryFn: () =>
      api.orderMonitor({
        productType,
        mode: "daily",
        createdFrom: filters.createdFrom || undefined,
        createdTo: filters.createdTo || undefined,
        deadlineFrom: filters.deadlineFrom || undefined,
        deadlineTo: filters.deadlineTo || undefined,
        asOfDate: filters.asOfDate || undefined,
      }),
    enabled: productType.length > 0,
  });

  const data = query.data;
  const daily = data?.daily ?? [];
  const summary = data?.summary;

  const progressChartData = React.useMemo(
    () => daily.map((d) => ({
      date: formatDateDisplay(d.date),
      outputProgress: clampPct(d.outputProgress),
      inputProgress: clampPct(d.inputProgress),
    })),
    [daily]
  );

  const dailyBarsData = React.useMemo(
    () => daily.map((d) => ({
      date: formatDateDisplay(d.date),
      Output: d.dailyOutput,
      Input: d.dailyInput,
    })),
    [daily]
  );

  const pendingRemainingData = React.useMemo(
    () => daily.map((d) => ({
      date: formatDateDisplay(d.date),
      Pending: d.pending,
      Remaining: d.remaining,
    })),
    [daily]
  );

  return (
    <div className="space-y-4">
      {summary ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <StatCard label="Total Order" value={fmt(summary.totalOrder)} icon={Package} iconClass="bg-slate-100 text-slate-700 dark:bg-slate-900/40 dark:text-slate-300" loading={query.isLoading} />
          <StatCard label="Total Output" value={fmt(summary.totalOutput)} icon={TrendingUp} iconClass="bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" loading={query.isLoading} />
          <StatCard label="Total Input" value={fmt(summary.totalInput)} icon={TrendingDown} iconClass="bg-teal-100 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300" loading={query.isLoading} />
        </div>
      ) : null}

      {query.isError ? (
        <ErrorState
          message={query.error instanceof Error ? query.error.message : "Failed to load daily progress"}
          onRetry={() => query.refetch()}
        />
      ) : null}

      {query.isLoading ? (
        <div className="grid grid-cols-1 gap-4">
          <ChartSkeleton />
          <ChartSkeleton />
          <ChartSkeleton />
        </div>
      ) : daily.length === 0 ? (
        <EmptyState message="No daily progress timeline available." icon={Activity} />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {/* Chart 1: Output/Input progress % */}
            <Card className="xl:col-span-2">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <CardTitle className="text-sm">Output & Input Progress %</CardTitle>
                    <CardDescription className="text-xs">Cumulative completion percentage over time</CardDescription>
                  </div>
                  <Activity className="h-4 w-4 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={progressChartData} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted/40" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} angle={-25} textAnchor="end" height={60} interval="preserveStartEnd" />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} unit="%" />
                    <RTooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number, n: string) => [`${v.toFixed(1)}%`, n]} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line type="monotone" dataKey="outputProgress" name="Output %" stroke={CHART_COLORS.output} strokeWidth={2} dot={{ r: 2 }} />
                    <Line type="monotone" dataKey="inputProgress" name="Input %" stroke={CHART_COLORS.input} strokeWidth={2} dot={{ r: 2 }} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Chart 2: Daily output/input bars */}
            <Card className="xl:col-span-2">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <CardTitle className="text-sm">Daily Output & Input</CardTitle>
                    <CardDescription className="text-xs">Daily transaction volumes (output vs input)</CardDescription>
                  </div>
                  <BarChart className="h-4 w-4 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={dailyBarsData} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted/40" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} angle={-25} textAnchor="end" height={60} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                    <RTooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number, n: string) => [fmt(v), n]} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="Output" fill={CHART_COLORS.output} radius={[3, 3, 0, 0]} />
                    <Bar dataKey="Input" fill={CHART_COLORS.input} radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Chart 3: Pending & Remaining */}
            <Card className="xl:col-span-2">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <CardTitle className="text-sm">Pending & Remaining Over Time</CardTitle>
                    <CardDescription className="text-xs">Pending (output−input) and remaining (order−output) trend</CardDescription>
                  </div>
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                </div>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={pendingRemainingData} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted/40" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} angle={-25} textAnchor="end" height={60} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                    <RTooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number, n: string) => [fmt(v), n]} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line type="monotone" dataKey="Pending" stroke={CHART_COLORS.pending} strokeWidth={2} dot={{ r: 2 }} />
                    <Line type="monotone" dataKey="Remaining" stroke={CHART_COLORS.remaining} strokeWidth={2} dot={{ r: 2 }} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          {/* Daily snapshot table */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-sm">Daily Snapshot</CardTitle>
                  <CardDescription className="text-xs">Cumulative daily metrics for output / input / pending / remaining</CardDescription>
                </div>
                <Badge className={theme.badge}>{daily.length} days</Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="max-h-[500px] overflow-y-auto scroll-thin rounded-md border">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-muted/40">
                    <TableRow>
                      <TableHead className="h-9 text-xs">Date</TableHead>
                      <TableHead className="h-9 text-right text-xs">Daily Output</TableHead>
                      <TableHead className="h-9 text-right text-xs">Daily Input</TableHead>
                      <TableHead className="h-9 text-right text-xs">Cum Output</TableHead>
                      <TableHead className="h-9 text-right text-xs">Cum Input</TableHead>
                      <TableHead className="h-9 text-right text-xs">Pending</TableHead>
                      <TableHead className="h-9 text-right text-xs">Remaining</TableHead>
                      <TableHead className="h-9 text-xs">Output %</TableHead>
                      <TableHead className="h-9 text-xs">Input %</TableHead>
                      <TableHead className="h-9 text-right text-xs">Input/Output %</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {daily.map((d) => (
                      <TableRow key={d.date}>
                        <TableCell className="py-2 text-xs font-medium">{formatDateDisplay(d.date)}</TableCell>
                        <TableCell className="py-2 text-right text-xs tabular-nums text-emerald-700 dark:text-emerald-300">{fmt(d.dailyOutput)}</TableCell>
                        <TableCell className="py-2 text-right text-xs tabular-nums text-teal-700 dark:text-teal-300">{fmt(d.dailyInput)}</TableCell>
                        <TableCell className="py-2 text-right text-xs tabular-nums">{fmt(d.cumOutput)}</TableCell>
                        <TableCell className="py-2 text-right text-xs tabular-nums">{fmt(d.cumInput)}</TableCell>
                        <TableCell className="py-2 text-right text-xs tabular-nums text-amber-700 dark:text-amber-300">{fmt(d.pending)}</TableCell>
                        <TableCell className="py-2 text-right text-xs tabular-nums text-rose-700 dark:text-rose-300">{fmt(d.remaining)}</TableCell>
                        <TableCell className="py-2 text-[11px]"><MiniProgress pct={d.outputProgress} tone="output" /></TableCell>
                        <TableCell className="py-2 text-[11px]"><MiniProgress pct={d.inputProgress} tone="input" /></TableCell>
                        <TableCell className="py-2 text-right text-[11px] tabular-nums text-muted-foreground">{fmtPct(d.inputVsOutput)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Matrix (View 4)
// ----------------------------------------------------------------------------

interface MatrixViewProps {
  productType: string;
  filters: AppliedFilters;
  refreshKey: number;
  theme: { bg: string; text: string; border: string; badge: string; gradient: string };
}

function MatrixView({ productType, filters, refreshKey, theme }: MatrixViewProps) {
  const query = useQuery({
    queryKey: ["order-monitor", "matrix", productType, filters, refreshKey],
    queryFn: () =>
      api.orderMonitor({
        productType,
        mode: "matrix",
        createdFrom: filters.createdFrom || undefined,
        createdTo: filters.createdTo || undefined,
        deadlineFrom: filters.deadlineFrom || undefined,
        deadlineTo: filters.deadlineTo || undefined,
        asOfDate: filters.asOfDate || undefined,
      }),
    enabled: productType.length > 0,
  });

  const matrix = query.data?.matrix ?? [];

  return (
    <div className="space-y-4">
      {query.isError ? (
        <ErrorState
          message={query.error instanceof Error ? query.error.message : "Failed to load matrix"}
          onRetry={() => query.refetch()}
        />
      ) : null}

      {query.isLoading ? (
        <Card>
          <CardContent className="p-4">
            <TableSkeleton rows={8} />
          </CardContent>
        </Card>
      ) : matrix.length === 0 ? (
        <EmptyState message="No Created Date × Deadline matrix entries." icon={Grid3x3} />
      ) : (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <CardTitle className="text-sm">Created Date × Deadline Matrix</CardTitle>
                <CardDescription className="text-xs">
                  Cross-tab of order groups by created date and deadline. Sorted by Created Date then Deadline.
                </CardDescription>
              </div>
              <Badge className={theme.badge}>{matrix.length} cells</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="max-h-[600px] overflow-auto scroll-thin rounded-md border">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-muted/40">
                  <TableRow>
                    <TableHead className="h-9 text-xs">Created Date</TableHead>
                    <TableHead className="h-9 text-xs">Deadline</TableHead>
                    <TableHead className="h-9 text-right text-xs">Order Qty</TableHead>
                    <TableHead className="h-9 text-right text-xs">Output</TableHead>
                    <TableHead className="h-9 text-right text-xs">Input</TableHead>
                    <TableHead className="h-9 text-right text-xs">Pending</TableHead>
                    <TableHead className="h-9 text-right text-xs">Remaining</TableHead>
                    <TableHead className="h-9 text-xs">Input %</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {matrix.map((r, i) => (
                    <TableRow key={`${r.createdDate}-${r.deadline}-${i}`}>
                      <TableCell className="py-2 text-xs font-medium">{formatDateDisplay(r.createdDate)}</TableCell>
                      <TableCell className="py-2 text-xs">{formatDateDisplay(r.deadline)}</TableCell>
                      <TableCell className="py-2 text-right text-xs tabular-nums">{fmt(r.orderQty)}</TableCell>
                      <TableCell className="py-2 text-right text-xs tabular-nums text-emerald-700 dark:text-emerald-300">{fmt(r.outputQty)}</TableCell>
                      <TableCell className="py-2 text-right text-xs tabular-nums text-teal-700 dark:text-teal-300">{fmt(r.inputQty)}</TableCell>
                      <TableCell className="py-2 text-right text-xs tabular-nums text-amber-700 dark:text-amber-300">{fmt(r.pending)}</TableCell>
                      <TableCell className="py-2 text-right text-xs tabular-nums text-rose-700 dark:text-rose-300">{fmt(r.remaining)}</TableCell>
                      <TableCell className="py-2">
                        <span className={cn(
                          "inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium tabular-nums",
                          r.inputProgress >= 90
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300"
                            : r.inputProgress >= 50
                            ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300"
                            : "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300"
                        )}>
                          {fmtPct(r.inputProgress)}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Detail (View 5)
// ----------------------------------------------------------------------------

type DetailSortKey =
  | "createdDate"
  | "model"
  | "poNo"
  | "factoryPO"
  | "colorCode"
  | "size"
  | "orderQty"
  | "outputQty"
  | "inputQty"
  | "pending"
  | "remaining"
  | "outputProgress"
  | "inputProgress"
  | "inputVsOutput"
  | "deadline"
  | "daysRemaining";

interface DetailViewProps {
  productType: string;
  filters: AppliedFilters;
  refreshKey: number;
  theme: { bg: string; text: string; border: string; badge: string; gradient: string };
}

const DETAIL_SORT_KEYS: { key: DetailSortKey; label: string; numeric?: boolean }[] = [
  { key: "createdDate", label: "Created Date" },
  { key: "model", label: "Model" },
  { key: "poNo", label: "PO NO#" },
  { key: "factoryPO", label: "Factory PO" },
  { key: "colorCode", label: "Color" },
  { key: "size", label: "Size" },
  { key: "orderQty", label: "Order", numeric: true },
  { key: "outputQty", label: "Output", numeric: true },
  { key: "inputQty", label: "Input", numeric: true },
  { key: "pending", label: "Pending", numeric: true },
  { key: "remaining", label: "Remaining", numeric: true },
  { key: "outputProgress", label: "Out%", numeric: true },
  { key: "inputProgress", label: "In%", numeric: true },
  { key: "inputVsOutput", label: "In/Out%", numeric: true },
  { key: "deadline", label: "Deadline" },
  { key: "daysRemaining", label: "Days Left", numeric: true },
];

function DetailView({ productType, filters, refreshKey, theme }: DetailViewProps) {
  const [sortKey, setSortKey] = React.useState<DetailSortKey>("orderQty");
  const [sortDir, setSortDir] = React.useState<"asc" | "desc">("desc");
  const [localSearch, setLocalSearch] = React.useState("");

  const query = useQuery({
    queryKey: ["order-monitor", "detail", productType, filters, refreshKey],
    queryFn: () =>
      api.orderMonitor({
        productType,
        mode: "detail",
        createdFrom: filters.createdFrom || undefined,
        createdTo: filters.createdTo || undefined,
        deadlineFrom: filters.deadlineFrom || undefined,
        deadlineTo: filters.deadlineTo || undefined,
        asOfDate: filters.asOfDate || undefined,
      }),
    enabled: productType.length > 0,
  });

  const toggleSort = React.useCallback((key: DetailSortKey) => {
    setSortKey((prev) => {
      if (prev !== key) {
        setSortDir("asc");
        return key;
      }
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      return prev;
    });
  }, []);

  const search = (localSearch || filters.search || "").trim().toLowerCase();

  const rows = React.useMemo(() => {
    let list = query.data?.detail ?? [];
    if (search) {
      list = list.filter((r) =>
        [r.model, r.poNo, r.factoryPO, r.colorCode, r.size].some((v) =>
          String(v || "").toLowerCase().includes(search)
        )
      );
    }
    const sortMeta = DETAIL_SORT_KEYS.find((k) => k.key === sortKey);
    const numeric = sortMeta?.numeric ?? false;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      const av = a[sortKey] as string | number | null;
      const bv = b[sortKey] as string | number | null;
      if (av === null || av === undefined || av === "") return 1;
      if (bv === null || bv === undefined || bv === "") return -1;
      if (numeric) {
        return (Number(av) - Number(bv)) * dir;
      }
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [query.data, search, sortKey, sortDir]);

  const summary = query.data?.summary;

  const onExport = React.useCallback(() => {
    if (!rows.length) {
      toast.error("No data to export");
      return;
    }
    try {
      const headers = ["Created Date", "Model", "PO NO#", "Factory PO", "Color", "Color 2", "Size", "Order", "Output", "Input", "Pending", "Remaining", "Out%", "In%", "In/Out%", "Deadline", "Days Remaining", "Status", "Season", "SKU"];
      const lines = [headers.join(",")];
      for (const r of rows) {
        const cells = [
          r.createdDate,
          r.model,
          r.poNo,
          r.factoryPO,
          r.colorCode,
          r.colorCode2,
          r.size,
          r.orderQty,
          r.outputQty,
          r.inputQty,
          r.pending,
          r.remaining,
          r.outputProgress,
          r.inputProgress,
          r.inputVsOutput,
          r.deadline ?? "",
          r.daysRemaining ?? "",
          r.status,
          r.season,
          r.sku,
        ].map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`);
        lines.push(cells.join(","));
      }
      const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `order-detail-${productType}-${Date.now()}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(`Exported ${rows.length} rows`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    }
  }, [rows, productType]);

  return (
    <div className="space-y-4">
      {summary ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
          <StatCard label="Total Lines" value={fmt(summary.totalLines)} icon={Table2} iconClass="bg-slate-100 text-slate-700 dark:bg-slate-900/40 dark:text-slate-300" loading={query.isLoading} />
          <StatCard label="Total Order" value={fmt(summary.totalOrderQty)} icon={Package} iconClass="bg-slate-100 text-slate-700 dark:bg-slate-900/40 dark:text-slate-300" loading={query.isLoading} />
          <StatCard label="Total Output" value={fmt(summary.totalOutputQty)} icon={TrendingUp} iconClass="bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" loading={query.isLoading} />
          <StatCard label="Total Input" value={fmt(summary.totalInputQty)} icon={TrendingDown} iconClass="bg-teal-100 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300" loading={query.isLoading} />
          <StatCard label="Output %" value={fmtPct(summary.outputProgress)} icon={Activity} iconClass="bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" loading={query.isLoading} />
          <StatCard label="Input %" value={fmtPct(summary.inputProgress)} icon={Activity} iconClass="bg-teal-100 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300" loading={query.isLoading} />
        </div>
      ) : null}

      {summary ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
          <StatCard label="Overdue" value={fmt(summary.overdue)} icon={AlertTriangle} iconClass="bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300" loading={query.isLoading} />
          <StatCard label="Due Today" value={fmt(summary.dueToday)} icon={Clock} iconClass="bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300" loading={query.isLoading} />
          <StatCard label="Upcoming (≤7d)" value={fmt(summary.upcoming)} icon={Calendar} iconClass="bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300" loading={query.isLoading} />
          <StatCard label="Total Pending" value={fmt(summary.totalPending)} icon={Clock} iconClass="bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300" loading={query.isLoading} />
        </div>
      ) : null}

      {query.isError ? (
        <ErrorState
          message={query.error instanceof Error ? query.error.message : "Failed to load detail"}
          onRetry={() => query.refetch()}
        />
      ) : null}

      {query.isLoading ? (
        <Card>
          <CardContent className="p-4">
            <TableSkeleton rows={8} />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <CardTitle className="text-sm">Full Detail Table</CardTitle>
                <CardDescription className="text-xs">
                  {rows.length} of {summary?.totalLines ?? rows.length} rows. Click a column header to sort.
                  Rows tinted by status (rose=over, amber=in-progress, emerald=completed).
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative w-full md:w-64">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="h-9 pl-8"
                    placeholder="Filter rows…"
                    value={localSearch}
                    onChange={(e) => setLocalSearch(e.target.value)}
                  />
                </div>
                <Button variant="outline" size="sm" className="h-9" onClick={onExport}>
                  <Download className="mr-1.5 h-3.5 w-3.5" /> Export CSV
                </Button>
                <Badge className={theme.badge}>{rows.length} rows</Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {rows.length === 0 ? (
              <EmptyState message="No detail rows match the current filters." icon={Table2} />
            ) : (
              <div className="max-h-[600px] overflow-auto scroll-thin rounded-md border">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-muted/40">
                    <TableRow>
                      {DETAIL_SORT_KEYS.map((col) => {
                        const active = sortKey === col.key;
                        return (
                          <TableHead
                            key={col.key}
                            className={cn("h-9 text-xs cursor-pointer select-none hover:bg-muted/70", col.numeric ? "text-right" : "text-left")}
                            onClick={() => toggleSort(col.key)}
                          >
                            <span className={cn("inline-flex items-center gap-1", col.numeric && "justify-end")}>
                              {col.label}
                              {active ? (
                                sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                              ) : (
                                <ArrowUpDown className="h-3 w-3 opacity-40" />
                              )}
                            </span>
                          </TableHead>
                        );
                      })}
                      <TableHead className="h-9 text-xs">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r, i) => (
                      <TableRow key={`${r.poNo}-${r.factoryPO}-${r.size}-${i}`} className={statusRowTint(r.status)}>
                        <TableCell className="py-1.5 text-xs">{formatDateDisplay(r.createdDate)}</TableCell>
                        <TableCell className="py-1.5 text-xs">{r.model || "—"}</TableCell>
                        <TableCell className="py-1.5 text-xs">{r.poNo || "—"}</TableCell>
                        <TableCell className="py-1.5 text-xs">{r.factoryPO || "—"}</TableCell>
                        <TableCell className="py-1.5 text-xs">{r.colorCode || "—"}</TableCell>
                        <TableCell className="py-1.5 text-xs">{r.size || "—"}</TableCell>
                        <TableCell className="py-1.5 text-right text-xs tabular-nums">{fmt(r.orderQty)}</TableCell>
                        <TableCell className="py-1.5 text-right text-xs tabular-nums text-emerald-700 dark:text-emerald-300">{fmt(r.outputQty)}</TableCell>
                        <TableCell className="py-1.5 text-right text-xs tabular-nums text-teal-700 dark:text-teal-300">{fmt(r.inputQty)}</TableCell>
                        <TableCell className="py-1.5 text-right text-xs tabular-nums text-amber-700 dark:text-amber-300">{fmt(r.pending)}</TableCell>
                        <TableCell className="py-1.5 text-right text-xs tabular-nums text-rose-700 dark:text-rose-300">{fmt(r.remaining)}</TableCell>
                        <TableCell className="py-1.5 text-[11px]"><MiniProgress pct={r.outputProgress} tone="output" /></TableCell>
                        <TableCell className="py-1.5 text-[11px]"><MiniProgress pct={r.inputProgress} tone="input" /></TableCell>
                        <TableCell className="py-1.5 text-right text-[11px] tabular-nums text-muted-foreground">{fmtPct(r.inputVsOutput)}</TableCell>
                        <TableCell className="py-1.5 text-[11px]">{formatDateDisplay(r.deadline)}</TableCell>
                        <TableCell className="py-1.5 text-right text-[11px] tabular-nums">
                          {r.daysRemaining === null ? "—" : (
                            <span className={cn(
                              r.daysRemaining < 0 ? "text-rose-700 dark:text-rose-300 font-semibold" :
                              r.daysRemaining === 0 ? "text-amber-700 dark:text-amber-300 font-semibold" :
                              "text-muted-foreground"
                            )}>
                              {r.daysRemaining}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="py-1.5">
                          <div className="flex flex-wrap gap-0.5">
                            {r.status.split(",").map((s) => s.trim()).filter(Boolean).map((s) => (
                              <StatusBadge key={s} status={s} />
                            ))}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Main view
// ----------------------------------------------------------------------------

export function ProductOrderMonitorView() {
  const { currentProduct, refreshKey } = useAppStore();
  const theme = PRODUCT_THEME[currentProduct];

  const [monitorView, setMonitorView] = React.useState<MonitorMode>("creation");
  const [createdFrom, setCreatedFrom] = React.useState("");
  const [createdTo, setCreatedTo] = React.useState("");
  const [deadlineFrom, setDeadlineFrom] = React.useState("");
  const [deadlineTo, setDeadlineTo] = React.useState("");
  const [asOfDate, setAsOfDate] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [expandedNodes, setExpandedNodes] = React.useState<Set<string>>(new Set());
  void expandedNodes; // expandedNodes is also used internally by sub-views; retained at top-level for potential shared control.
  void setExpandedNodes;

  // Applied filters (committed on Apply click)
  const [applied, setApplied] = React.useState<AppliedFilters>({
    createdFrom: "", createdTo: "", deadlineFrom: "", deadlineTo: "", asOfDate: "", search: "",
  });
  const [filtersVersion, setFiltersVersion] = React.useState(0);
  const [applying, setApplying] = React.useState(false);

  // Reset draft + applied filters when product changes
  React.useEffect(() => {
    setCreatedFrom("");
    setCreatedTo("");
    setDeadlineFrom("");
    setDeadlineTo("");
    setAsOfDate("");
    setSearch("");
    setApplied({ createdFrom: "", createdTo: "", deadlineFrom: "", deadlineTo: "", asOfDate: "", search: "" });
    setFiltersVersion((v) => v + 1);
  }, [currentProduct]);

  const handleApply = React.useCallback(() => {
    setApplying(true);
    setApplied({
      createdFrom, createdTo, deadlineFrom, deadlineTo, asOfDate, search,
    });
    setFiltersVersion((v) => v + 1);
    toast.success("Filters applied");
    // brief loading state for UX feedback
    setTimeout(() => setApplying(false), 350);
  }, [createdFrom, createdTo, deadlineFrom, deadlineTo, asOfDate, search]);

  const handleReset = React.useCallback(() => {
    setCreatedFrom("");
    setCreatedTo("");
    setDeadlineFrom("");
    setDeadlineTo("");
    setAsOfDate("");
    setSearch("");
    setApplied({ createdFrom: "", createdTo: "", deadlineFrom: "", deadlineTo: "", asOfDate: "", search: "" });
    setFiltersVersion((v) => v + 1);
    toast.info("Filters cleared");
  }, []);

  // Combined refreshKey (product + applied + manual bump). Product is already in
  // the queryKey so we just need a numeric composite that increments on either
  // filter commit or global app refresh.
  const combinedRefreshKey = filtersVersion + refreshKey;

  return (
    <div className="flex min-h-screen flex-col gap-4 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <div className={cn("flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-sm", theme.gradient)}>
            <Monitor className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight md:text-xl">
              Order Monitor <span className={cn("ml-2 rounded-md border px-1.5 py-0.5 text-xs font-medium", theme.badge)}>{theme.label}</span>
            </h1>
            <p className="text-xs text-muted-foreground">
              Unified order monitoring — creation timeline, deadline tracker, daily progress, matrix, and detail.
            </p>
          </div>
        </div>
      </div>

      {/* Sub-tabs */}
      <Tabs value={monitorView} onValueChange={(v) => setMonitorView(v as MonitorMode)}>
        <TabsList className="grid h-auto w-full grid-cols-2 md:flex md:w-fit md:flex-wrap">
          {MONITOR_TABS.map((t) => {
            const Icon = t.icon;
            return (
              <TabsTrigger key={t.key} value={t.key} className="gap-1.5 text-xs md:text-sm">
                <Icon className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{t.label}</span>
                <span className="sm:hidden">{t.short}</span>
              </TabsTrigger>
            );
          })}
        </TabsList>

        {/* Filter bar (shared, persistent across sub-tabs) */}
        <div className="mt-3">
          <FilterBar
            createdFrom={createdFrom}
            createdTo={createdTo}
            deadlineFrom={deadlineFrom}
            deadlineTo={deadlineTo}
            asOfDate={asOfDate}
            search={search}
            onCreatedFrom={setCreatedFrom}
            onCreatedTo={setCreatedTo}
            onDeadlineFrom={setDeadlineFrom}
            onDeadlineTo={setDeadlineTo}
            onAsOfDate={setAsOfDate}
            onSearch={setSearch}
            onApply={handleApply}
            onReset={handleReset}
            applying={applying}
          />
        </div>

        <TabsContent value="creation" className="mt-4">
          {monitorView === "creation" ? (
            <CreationView productType={currentProduct} filters={applied} refreshKey={combinedRefreshKey} theme={theme} />
          ) : null}
        </TabsContent>
        <TabsContent value="deadline" className="mt-4">
          {monitorView === "deadline" ? (
            <DeadlineView productType={currentProduct} filters={applied} refreshKey={combinedRefreshKey} theme={theme} />
          ) : null}
        </TabsContent>
        <TabsContent value="daily" className="mt-4">
          {monitorView === "daily" ? (
            <DailyView productType={currentProduct} filters={applied} refreshKey={combinedRefreshKey} theme={theme} />
          ) : null}
        </TabsContent>
        <TabsContent value="matrix" className="mt-4">
          {monitorView === "matrix" ? (
            <MatrixView productType={currentProduct} filters={applied} refreshKey={combinedRefreshKey} theme={theme} />
          ) : null}
        </TabsContent>
        <TabsContent value="detail" className="mt-4">
          {monitorView === "detail" ? (
            <DetailView productType={currentProduct} filters={applied} refreshKey={combinedRefreshKey} theme={theme} />
          ) : null}
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default ProductOrderMonitorView;
