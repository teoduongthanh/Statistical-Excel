"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  PieChart as PieChartIcon,
  TrendingUp,
  AlertTriangle,
  Package,
  Factory,
  Search,
  RotateCcw,
  Loader2,
  ChevronLeft,
  ChevronRight,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  CalendarRange,
  ClipboardList,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useAppStore, PRODUCT_THEME } from "@/store/app-store";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

type DimensionKey =
  | "size"
  | "colorCode"
  | "model"
  | "poNo"
  | "factoryPO"
  | "season"
  | "shippingStatus";

interface DimensionRow {
  dim: string;
  rowCount: number;
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
}

interface DimensionResponse {
  dimension: string;
  rows: DimensionRow[];
}

interface ProductKPIs {
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

interface TimelinePoint {
  date: string;
  qty: number;
}

interface TimelineResponse {
  statusBucket: string;
  series: TimelinePoint[];
}

interface DailyReportRow {
  date: string;
  order: number;
  output: number;
  input: number;
}

interface StatsFilters {
  factoryPO?: string;
  poNo?: string;
  model?: string;
  season?: string;
  dateFrom?: string;
  dateTo?: string;
}

type SortKey =
  | "dim"
  | "orderQty"
  | "outputQty"
  | "inputQty"
  | "processing"
  | "missing"
  | "completionRate"
  | "outputRate"
  | "rowCount";

type SortDir = "asc" | "desc";

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

const DIMENSIONS: { key: DimensionKey; label: string; short: string }[] = [
  { key: "size", label: "By Size", short: "Size" },
  { key: "colorCode", label: "By Color", short: "Color" },
  { key: "model", label: "By Model", short: "Model" },
  { key: "poNo", label: "By PO NO#", short: "PO NO#" },
  { key: "factoryPO", label: "By Factory PO", short: "Factory PO" },
  { key: "season", label: "By Season", short: "Season" },
  { key: "shippingStatus", label: "By Shipping Status", short: "Status" },
];

const QUARTERS = ["Q1", "Q2", "Q3", "Q4"] as const;
type Quarter = (typeof QUARTERS)[number] | "all";
const QUARTER_ALL: Quarter = "all";

const PAGE_SIZE = 12;

/**
 * Color scheme — emerald/teal primary, amber for in-progress, rose for missing.
 * No indigo/blue.
 */
const CHART_COLORS = {
  order: "oklch(0.55 0.025 220)", // near-neutral slate
  output: "oklch(0.74 0.16 75)", // amber
  input: "oklch(0.6 0.13 162)", // emerald/teal
  missing: "oklch(0.62 0.21 18)", // rose
} as const;

const PIE_PALETTE = [
  "oklch(0.55 0.13 162)", // emerald
  "oklch(0.62 0.14 145)", // green
  "oklch(0.7 0.15 120)", // lime
  "oklch(0.74 0.16 75)", // amber
  "oklch(0.68 0.17 40)", // orange
  "oklch(0.62 0.21 18)", // rose
] as const;

const TOOLTIP_STYLE = {
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--popover)",
  color: "var(--popover-foreground)",
  fontSize: 12,
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

/** Classify a dimension row's completion into a tone band. */
function completionTone(rate: number): {
  band: "high" | "mid" | "low";
  badge: string;
  text: string;
  rowTint: string;
} {
  const r = clampPct(rate);
  if (r >= 95) {
    return {
      band: "high",
      badge:
        "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300",
      text: "text-emerald-600 dark:text-emerald-400",
      rowTint: "bg-emerald-50/40 dark:bg-emerald-950/15",
    };
  }
  if (r >= 80) {
    return {
      band: "mid",
      badge:
        "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300",
      text: "text-amber-600 dark:text-amber-400",
      rowTint: "bg-amber-50/40 dark:bg-amber-950/15",
    };
  }
  return {
    band: "low",
    badge:
      "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300",
    text: "text-rose-600 dark:text-rose-400",
    rowTint: "bg-rose-50/40 dark:bg-rose-950/15",
  };
}

/** True when a row has a high relative missing ratio (≥5% of orderQty). */
function isHighMissing(row: DimensionRow): boolean {
  if (row.missing <= 0) return false;
  if (row.orderQty <= 0) return true;
  return row.missing / row.orderQty >= 0.05;
}

/** Row-level tint: rose for high missing, then completion tone. */
function rowTintClass(row: DimensionRow): string {
  if (isHighMissing(row)) {
    return "bg-rose-50/60 dark:bg-rose-950/20";
  }
  return completionTone(row.completionRate).rowTint;
}

function missingCellClass(row: DimensionRow): string {
  if (row.missing <= 0) return "";
  if (isHighMissing(row)) {
    return "bg-rose-100/70 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 font-semibold";
  }
  return "text-amber-700 dark:text-amber-300 font-medium";
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

/** Map a quarter (Q1..Q4) to [dateFrom, dateTo] for the current year (YYYY-MM-DD). */
function quarterRange(q: Quarter, year = new Date().getFullYear()): { from: string; to: string } {
  const ranges: Record<Exclude<Quarter, "all">, [string, string]> = {
    Q1: [`${year}-01-01`, `${year}-03-31`],
    Q2: [`${year}-04-01`, `${year}-06-30`],
    Q3: [`${year}-07-01`, `${year}-09-30`],
    Q4: [`${year}-10-01`, `${year}-12-31`],
  };
  if (q === QUARTER_ALL) return { from: "", to: "" };
  const [from, to] = ranges[q];
  return { from, to };
}

function formatDateLabel(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

/** Convert typed StatsFilters into a plain Record<string,string> for the API client. */
function toApiFilters(filters: StatsFilters): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(filters)) {
    if (v !== undefined && v !== null && v !== "") out[k] = v;
  }
  return out;
}

// ----------------------------------------------------------------------------
// Sub-components
// ----------------------------------------------------------------------------

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
              <Skeleton className="mt-2 h-7 w-24" />
            ) : (
              <p className="mt-1 text-2xl font-bold tracking-tight tabular-nums">{value}</p>
            )}
            {sub ? <div className="mt-1 text-[11px] text-muted-foreground">{sub}</div> : null}
          </div>
          <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", iconClass)}>
            <Icon className="h-4 w-4" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

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
      <CardContent className="flex flex-col items-center justify-center py-12 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <Icon className="h-6 w-6" />
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

// ----------------------------------------------------------------------------
// Filter bar
// ----------------------------------------------------------------------------

interface FilterBarProps {
  form: StatsFilters;
  quarter: Quarter;
  onFormChange: (next: Partial<StatsFilters>) => void;
  onQuarterChange: (q: Quarter) => void;
  onApply: () => void;
  onReset: () => void;
  applying: boolean;
}

function FilterBar({
  form,
  quarter,
  onFormChange,
  onQuarterChange,
  onApply,
  onReset,
  applying,
}: FilterBarProps) {
  const hasAnyActive =
    Boolean(form.factoryPO) ||
    Boolean(form.poNo) ||
    Boolean(form.model) ||
    Boolean(form.season) ||
    Boolean(form.dateFrom) ||
    Boolean(form.dateTo) ||
    quarter !== QUARTER_ALL;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm">Filters</CardTitle>
          <Badge variant="outline" className="gap-1 text-[11px]">
            <Search className="h-3 w-3" />
            {hasAnyActive ? "Filtered" : "No filters"}
          </Badge>
        </div>
        <CardDescription className="text-xs">
          Refine the KPIs, dimension table, and daily report. Click Apply to commit filters.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <FilterField label="Factory PO">
            <Input
              className="h-9"
              placeholder="e.g. MH26110228"
              value={form.factoryPO ?? ""}
              onChange={(e) => onFormChange({ factoryPO: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") onApply();
              }}
            />
          </FilterField>
          <FilterField label="PO NO#">
            <Input
              className="h-9"
              placeholder="e.g. H411351070"
              value={form.poNo ?? ""}
              onChange={(e) => onFormChange({ poNo: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") onApply();
              }}
            />
          </FilterField>
          <FilterField label="Model">
            <Input
              className="h-9"
              placeholder="e.g. MAFATE5"
              value={form.model ?? ""}
              onChange={(e) => onFormChange({ model: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") onApply();
              }}
            />
          </FilterField>
          <FilterField label="Season">
            <Input
              className="h-9"
              placeholder="e.g. SP27"
              value={form.season ?? ""}
              onChange={(e) => onFormChange({ season: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") onApply();
              }}
            />
          </FilterField>
          <FilterField label="Date From">
            <Input
              type="date"
              className="h-9"
              value={form.dateFrom ?? ""}
              onChange={(e) => onFormChange({ dateFrom: e.target.value })}
            />
          </FilterField>
          <FilterField label="Date To">
            <Input
              type="date"
              className="h-9"
              value={form.dateTo ?? ""}
              onChange={(e) => onFormChange({ dateTo: e.target.value })}
            />
          </FilterField>
        </div>

        <div className="flex flex-col gap-3 border-t pt-3 md:flex-row md:items-end md:justify-between">
          <div className="flex flex-col gap-1.5 md:w-56">
            <label className="text-xs font-medium text-muted-foreground">
              Quarter (current year)
            </label>
            <Select value={quarter} onValueChange={(v) => onQuarterChange(v as Quarter)}>
              <SelectTrigger className="h-9 w-full">
                <CalendarRange className="mr-1.5 h-3.5 w-3.5" />
                <SelectValue placeholder="All year" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={QUARTER_ALL}>All year</SelectItem>
                {QUARTERS.map((q) => (
                  <SelectItem key={q} value={q}>
                    {q}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <Button onClick={onApply} disabled={applying} className="h-9">
              {applying ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              Apply
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

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Dimension table (sortable + paginated)
// ----------------------------------------------------------------------------

interface DimensionTableProps {
  rows: DimensionRow[];
  dimensionLabel: string;
  loading: boolean;
  isError: boolean;
  onRetry: () => void;
}

const SORT_COLUMNS: { key: SortKey; label: string; align?: "right" | "left" }[] = [
  { key: "dim", label: "Dimension" },
  { key: "orderQty", label: "Order", align: "right" },
  { key: "outputQty", label: "Output", align: "right" },
  { key: "inputQty", label: "Input", align: "right" },
  { key: "processing", label: "Processing", align: "right" },
  { key: "missing", label: "Missing", align: "right" },
  { key: "outputRate", label: "Output %", align: "right" },
  { key: "completionRate", label: "Completion %", align: "right" },
  { key: "rowCount", label: "Rows", align: "right" },
];

function DimensionTable({
  rows,
  dimensionLabel,
  loading,
  isError,
  onRetry,
}: DimensionTableProps) {
  const [sortKey, setSortKey] = React.useState<SortKey>("orderQty");
  const [sortDir, setSortDir] = React.useState<SortDir>("desc");
  const [page, setPage] = React.useState(0);

  // Reset pagination whenever the row set or sort changes.
  React.useEffect(() => {
    setPage(0);
  }, [rows, sortKey, sortDir]);

  const sorted = React.useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      let cmp: number;
      if (typeof av === "number" && typeof bv === "number") {
        cmp = av - bv;
      } else {
        cmp = String(av ?? "").localeCompare(String(bv ?? ""));
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [rows, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = sorted.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const anyHighMissing = pageRows.some(isHighMissing);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "dim" ? "asc" : "desc");
    }
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) {
      return <ArrowUpDown className="ml-1 inline h-3 w-3 opacity-40" />;
    }
    return sortDir === "asc" ? (
      <ArrowUp className="ml-1 inline h-3 w-3" />
    ) : (
      <ArrowDown className="ml-1 inline h-3 w-3" />
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="text-sm">Dimension Breakdown</CardTitle>
            <CardDescription className="text-xs">
              Aggregated by <span className="font-medium text-foreground">{dimensionLabel}</span> ·{" "}
              {rows.length} unique values
            </CardDescription>
          </div>
          <Badge variant="outline" className="text-[11px]">
            {rows.length} rows
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {isError ? (
          <ErrorState message="Failed to load dimension breakdown." onRetry={onRetry} />
        ) : loading ? (
          <TableSkeleton rows={8} />
        ) : rows.length === 0 ? (
          <EmptyState message="No rows match the current filters for this dimension." />
        ) : (
          <>
            <div className="overflow-x-auto scroll-thin rounded-md border">
              <Table className="text-xs">
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    {SORT_COLUMNS.map((col) => (
                      <TableHead
                        key={col.key}
                        className={cn(
                          "select-none whitespace-nowrap px-2 py-2 font-semibold",
                          col.align === "right" ? "text-right" : "text-left"
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => toggleSort(col.key)}
                          className="inline-flex items-center hover:text-foreground"
                        >
                          {col.label}
                          <SortIcon col={col.key} />
                        </button>
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageRows.map((row, idx) => {
                    const tone = completionTone(row.completionRate);
                    const highMissing = isHighMissing(row);
                    return (
                      <TableRow
                        key={`${row.dim}-${idx}`}
                        className={cn("transition-colors", rowTintClass(row))}
                      >
                        <TableCell className="max-w-[220px] truncate px-2 py-2 font-medium">
                          {row.dim || "—"}
                        </TableCell>
                        <TableCell className="px-2 py-2 text-right tabular-nums">
                          {fmt(row.orderQty)}
                        </TableCell>
                        <TableCell className="px-2 py-2 text-right tabular-nums">
                          {fmt(row.outputQty)}
                        </TableCell>
                        <TableCell className="px-2 py-2 text-right tabular-nums">
                          {fmt(row.inputQty)}
                        </TableCell>
                        <TableCell className="px-2 py-2 text-right tabular-nums">
                          {fmt(row.processing)}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "px-2 py-2 text-right tabular-nums",
                            missingCellClass(row)
                          )}
                        >
                          {fmt(row.missing)}
                        </TableCell>
                        <TableCell className={cn("px-2 py-2 text-right tabular-nums", tone.text)}>
                          {fmtPct(row.outputRate)}
                        </TableCell>
                        <TableCell className="px-2 py-2 text-right">
                          <Badge variant="outline" className={cn("text-[10px] font-semibold", tone.badge)}>
                            {fmtPct(row.completionRate)}
                          </Badge>
                        </TableCell>
                        <TableCell className="px-2 py-2 text-right tabular-nums text-muted-foreground">
                          {fmt(row.rowCount)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Pagination */}
            <div className="mt-3 flex flex-col items-center justify-between gap-2 sm:flex-row">
              <p className="text-[11px] text-muted-foreground">
                Showing{" "}
                <span className="font-medium text-foreground">
                  {safePage * PAGE_SIZE + 1}–{Math.min((safePage + 1) * PAGE_SIZE, sorted.length)}
                </span>{" "}
                of <span className="font-medium text-foreground">{sorted.length}</span>
              </p>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8"
                  disabled={safePage === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                >
                  <ChevronLeft className="h-3.5 w-3.5" /> Prev
                </Button>
                <span className="px-2 text-[11px] tabular-nums text-muted-foreground">
                  Page {safePage + 1} / {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8"
                  disabled={safePage >= totalPages - 1}
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                >
                  Next <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {/* Legend */}
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-3 text-[10px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-emerald-400" /> High completion (≥95%)
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-amber-400" /> Mid completion (80–95%)
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-rose-400" /> Low completion (&lt;80%) or high missing
              </span>
              {anyHighMissing ? (
                <span className="ml-auto text-rose-600 dark:text-rose-400">
                  ⚠ High-missing rows are tinted rose.
                </span>
              ) : null}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ----------------------------------------------------------------------------
// Charts row
// ----------------------------------------------------------------------------

interface ChartsRowProps {
  rows: DimensionRow[];
  dimensionLabel: string;
  loading: boolean;
}

function ChartsRow({ rows, dimensionLabel, loading }: ChartsRowProps) {
  // Chart 1: Order vs Output vs Input per dimension value (top N by orderQty).
  const topN = React.useMemo(() => {
    const copy = [...rows].sort((a, b) => b.orderQty - a.orderQty).slice(0, 10);
    return copy.map((r) => ({
      name: String(r.dim ?? "—").length > 14 ? String(r.dim).slice(0, 12) + "…" : String(r.dim ?? "—"),
      fullName: String(r.dim ?? "—"),
      Order: r.orderQty,
      Output: r.outputQty,
      Input: r.inputQty,
    }));
  }, [rows]);

  // Chart 2: Missing qty per dimension value (top N by missing desc).
  const missingTop = React.useMemo(() => {
    const copy = [...rows].sort((a, b) => b.missing - a.missing).slice(0, 10);
    return copy.map((r) => ({
      name: String(r.dim ?? "—").length > 14 ? String(r.dim).slice(0, 12) + "…" : String(r.dim ?? "—"),
      fullName: String(r.dim ?? "—"),
      Missing: r.missing,
    }));
  }, [rows]);

  // Chart 3: Completion rate distribution buckets.
  const completionBuckets = React.useMemo(() => {
    const buckets = [
      { name: "≥95%", value: 0, fill: PIE_PALETTE[0] },
      { name: "80–95%", value: 0, fill: PIE_PALETTE[3] },
      { name: "<80%", value: 0, fill: PIE_PALETTE[5] },
    ];
    for (const r of rows) {
      const rate = clampPct(r.completionRate);
      if (rate >= 95) buckets[0].value += 1;
      else if (rate >= 80) buckets[1].value += 1;
      else buckets[2].value += 1;
    }
    return buckets.filter((b) => b.value > 0);
  }, [rows]);

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      {/* Bar: Order vs Output vs Input */}
      <Card className="xl:col-span-2">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <div>
              <CardTitle className="text-sm">Order vs Output vs Input</CardTitle>
              <CardDescription className="text-xs">
                Top 10 {dimensionLabel} values by ordered qty.
              </CardDescription>
            </div>
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <ChartSkeleton />
          ) : topN.length === 0 ? (
            <EmptyState message="No dimension data available." icon={BarChart3} />
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={topN} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted/40" vertical={false} />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  interval={0}
                  angle={-25}
                  textAnchor="end"
                  height={60}
                />
                <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                <RTooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(v: number, name: string) => [fmt(v), name]}
                  labelFormatter={(_l, p) => {
                    const item = (p && p[0]) as { payload?: { fullName?: string } } | undefined;
                    return item?.payload?.fullName ?? "";
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="Order" fill={CHART_COLORS.order} radius={[3, 3, 0, 0]} />
                <Bar dataKey="Output" fill={CHART_COLORS.output} radius={[3, 3, 0, 0]} />
                <Bar dataKey="Input" fill={CHART_COLORS.input} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Bar: Missing per dimension value */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <div>
              <CardTitle className="text-sm">Missing Quantity</CardTitle>
              <CardDescription className="text-xs">
                Top 10 {dimensionLabel} values by missing qty.
              </CardDescription>
            </div>
            <AlertTriangle className="h-4 w-4 text-rose-500" />
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <ChartSkeleton height={280} />
          ) : missingTop.length === 0 || missingTop.every((m) => m.Missing === 0) ? (
            <EmptyState message="No missing units — every value is fully received." icon={AlertTriangle} />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={missingTop} layout="vertical" margin={{ top: 8, right: 12, bottom: 8, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted/40" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  width={80}
                />
                <RTooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(v: number) => [fmt(v), "Missing"]}
                  labelFormatter={(_l, p) => {
                    const item = (p && p[0]) as { payload?: { fullName?: string } } | undefined;
                    return item?.payload?.fullName ?? "";
                  }}
                />
                <Bar dataKey="Missing" fill={CHART_COLORS.missing} radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Pie: Completion rate distribution */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <div>
              <CardTitle className="text-sm">Completion Rate Distribution</CardTitle>
              <CardDescription className="text-xs">
                Count of {dimensionLabel} values per completion band.
              </CardDescription>
            </div>
            <PieChartIcon className="h-4 w-4 text-muted-foreground" />
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <ChartSkeleton height={280} />
          ) : completionBuckets.length === 0 ? (
            <EmptyState message="No completion data to chart." icon={PieChartIcon} />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <RTooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(v: number, name: string) => [`${v} value(s)`, name]}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Pie
                  data={completionBuckets}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={50}
                  outerRadius={90}
                  paddingAngle={2}
                >
                  {completionBuckets.map((b) => (
                    <Cell key={b.name} fill={b.fill} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Daily production report
// ----------------------------------------------------------------------------

interface DailyReportProps {
  orderSeries: TimelinePoint[];
  outputSeries: TimelinePoint[];
  inputSeries: TimelinePoint[];
  loading: boolean;
  isError: boolean;
  onRetry: () => void;
}

function DailyProductionReport({
  orderSeries,
  outputSeries,
  inputSeries,
  loading,
  isError,
  onRetry,
}: DailyReportProps) {
  // Merge the three timeline series by date and keep last 30 calendar days.
  const rows: DailyReportRow[] = React.useMemo(() => {
    const map = new Map<string, DailyReportRow>();
    const upsert = (date: string) => {
      if (!date) return null;
      let r = map.get(date);
      if (!r) {
        r = { date, order: 0, output: 0, input: 0 };
        map.set(date, r);
      }
      return r;
    };
    for (const p of orderSeries) {
      const r = upsert(p.date);
      if (r) r.order += p.qty;
    }
    for (const p of outputSeries) {
      const r = upsert(p.date);
      if (r) r.output += p.qty;
    }
    for (const p of inputSeries) {
      const r = upsert(p.date);
      if (r) r.input += p.qty;
    }
    const sorted = Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
    // Keep the most recent 30 dates.
    return sorted.slice(-30);
  }, [orderSeries, outputSeries, inputSeries]);

  const totals = React.useMemo(() => {
    return rows.reduce(
      (acc, r) => {
        acc.order += r.order;
        acc.output += r.output;
        acc.input += r.input;
        return acc;
      },
      { order: 0, output: 0, input: 0 }
    );
  }, [rows]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="text-sm flex items-center gap-1.5">
              <ClipboardList className="h-4 w-4 text-muted-foreground" />
              Daily Production Report
            </CardTitle>
            <CardDescription className="text-xs">
              Last 30 days — Order / Output / Input by date (per spec §45).
            </CardDescription>
          </div>
          <Badge variant="outline" className="text-[11px]">
            {rows.length} days
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {isError ? (
          <ErrorState message="Failed to load production timeline." onRetry={onRetry} />
        ) : loading ? (
          <TableSkeleton rows={8} />
        ) : rows.length === 0 ? (
          <EmptyState message="No timeline data available for this product." icon={CalendarRange} />
        ) : (
          <>
            <div className="max-h-[420px] overflow-y-auto scroll-thin rounded-md border">
              <Table className="text-xs">
                <TableHeader className="sticky top-0 z-10 bg-background">
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead className="px-2 py-2 font-semibold">Date</TableHead>
                    <TableHead className="px-2 py-2 text-right font-semibold">Order</TableHead>
                    <TableHead className="px-2 py-2 text-right font-semibold">Output</TableHead>
                    <TableHead className="px-2 py-2 text-right font-semibold">Input</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.date}>
                      <TableCell className="whitespace-nowrap px-2 py-1.5 font-medium">
                        {formatDateLabel(r.date)}
                      </TableCell>
                      <TableCell className="px-2 py-1.5 text-right tabular-nums">
                        {fmt(r.order)}
                      </TableCell>
                      <TableCell className="px-2 py-1.5 text-right tabular-nums text-amber-600 dark:text-amber-400">
                        {fmt(r.output)}
                      </TableCell>
                      <TableCell className="px-2 py-1.5 text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                        {fmt(r.input)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-end gap-x-4 gap-y-1 border-t pt-3 text-xs">
              <span className="text-muted-foreground">
                Total order:{" "}
                <span className="font-semibold text-foreground tabular-nums">{fmt(totals.order)}</span>
              </span>
              <span className="text-muted-foreground">
                Total output:{" "}
                <span className="font-semibold text-amber-600 dark:text-amber-400 tabular-nums">
                  {fmt(totals.output)}
                </span>
              </span>
              <span className="text-muted-foreground">
                Total input:{" "}
                <span className="font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">
                  {fmt(totals.input)}
                </span>
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ----------------------------------------------------------------------------
// Main view
// ----------------------------------------------------------------------------

export function ProductStatisticsView() {
  const { currentProduct, refreshKey, bumpRefresh } = useAppStore();
  const theme = PRODUCT_THEME[currentProduct];

  // ---- Dimension state ----
  const [dimension, setDimension] = React.useState<DimensionKey>("size");
  const dimensionMeta = DIMENSIONS.find((d) => d.key === dimension)!;

  // ---- Filter state (form vs applied) ----
  const [form, setForm] = React.useState<StatsFilters>({});
  const [quarter, setQuarter] = React.useState<Quarter>(QUARTER_ALL);
  const [applied, setApplied] = React.useState<StatsFilters>({});

  function applyFilters() {
    const qRange = quarterRange(quarter);
    setApplied({
      factoryPO: form.factoryPO?.trim() || undefined,
      poNo: form.poNo?.trim() || undefined,
      model: form.model?.trim() || undefined,
      season: form.season?.trim() || undefined,
      dateFrom: qRange.from || form.dateFrom || undefined,
      dateTo: qRange.to || form.dateTo || undefined,
    });
  }

  function resetFilters() {
    setForm({});
    setQuarter(QUARTER_ALL);
    setApplied({});
  }

  function onFormChange(next: Partial<StatsFilters>) {
    setForm((prev) => ({ ...prev, ...next }));
  }

  // Quarter changes apply immediately by reflecting into form's date fields so the
  // user sees the derived dates in the Date From / Date To inputs.
  function onQuarterChange(q: Quarter) {
    setQuarter(q);
    const r = quarterRange(q);
    setForm((prev) => ({ ...prev, dateFrom: r.from, dateTo: r.to }));
  }

  // ---- Queries ----
  const kpiQuery = useQuery({
    queryKey: ["prod-statistics-kpis", currentProduct, applied, refreshKey],
    queryFn: () => api.getKPIs(currentProduct, toApiFilters(applied)) as Promise<ProductKPIs>,
    staleTime: 30_000,
  });

  const dimQuery = useQuery({
    queryKey: ["prod-statistics-dim", currentProduct, dimension, applied, refreshKey],
    queryFn: () =>
      api.getByDimension(currentProduct, dimension, toApiFilters(applied)) as Promise<DimensionResponse>,
    staleTime: 30_000,
  });

  const orderTimeline = useQuery({
    queryKey: ["prod-statistics-timeline", currentProduct, "order", applied, refreshKey],
    queryFn: () =>
      api.getTimeline(currentProduct, "order") as Promise<TimelineResponse>,
    staleTime: 30_000,
  });
  const outputTimeline = useQuery({
    queryKey: ["prod-statistics-timeline", currentProduct, "output", applied, refreshKey],
    queryFn: () =>
      api.getTimeline(currentProduct, "output") as Promise<TimelineResponse>,
    staleTime: 30_000,
  });
  const inputTimeline = useQuery({
    queryKey: ["prod-statistics-timeline", currentProduct, "input", applied, refreshKey],
    queryFn: () =>
      api.getTimeline(currentProduct, "input") as Promise<TimelineResponse>,
    staleTime: 30_000,
  });

  const kpis = kpiQuery.data;
  const kpiLoading = kpiQuery.isLoading || kpiQuery.isFetching;
  const dimLoading = dimQuery.isLoading || dimQuery.isFetching;
  const timelineLoading =
    orderTimeline.isLoading ||
    outputTimeline.isLoading ||
    inputTimeline.isLoading;
  const timelineError = orderTimeline.isError || outputTimeline.isError || inputTimeline.isError;

  const dimRows: DimensionRow[] = dimQuery.data?.rows ?? [];

  // Derived KPI display values
  const totalOrder = kpis?.orderQty ?? 0;
  const totalOutput = kpis?.outputQty ?? 0;
  const totalInput = kpis?.inputQty ?? 0;
  const completionRate = clampPct(kpis?.completionRate ?? 0);
  const completionToneState = completionTone(completionRate);

  const applying =
    kpiQuery.isFetching ||
    dimQuery.isFetching ||
    orderTimeline.isFetching ||
    outputTimeline.isFetching ||
    inputTimeline.isFetching;

  function refetchAll() {
    kpiQuery.refetch();
    dimQuery.refetch();
    orderTimeline.refetch();
    outputTimeline.refetch();
    inputTimeline.refetch();
  }

  return (
    <div className="space-y-6">
      {/* ---------------- Header ---------------- */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold tracking-tight">Production Statistics</h1>
          <Badge variant="outline" className={cn("border", theme.badge)}>
            {currentProduct}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Order / Output / Input aggregated across dimensions, with daily production report and
          quarterly filtering. All data is scoped to{" "}
          <span className={cn("font-medium", theme.text)}>{currentProduct}</span>.
        </p>
      </div>

      {/* ---------------- Filter bar ---------------- */}
      <FilterBar
        form={form}
        quarter={quarter}
        onFormChange={onFormChange}
        onQuarterChange={onQuarterChange}
        onApply={applyFilters}
        onReset={resetFilters}
        applying={applying}
      />

      {/* ---------------- Summary KPIs ---------------- */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Total Order"
          value={fmt(totalOrder)}
          icon={Package}
          iconClass="bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200"
          sub={
            kpis ? (
              <span>
                {fmt(kpis.totalPOs)} POs · {fmt(kpis.totalFactoryPOs)} Factory POs
              </span>
            ) : undefined
          }
          loading={kpiLoading}
        />
        <StatCard
          label="Total Output"
          value={fmt(totalOutput)}
          icon={Factory}
          iconClass="bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
          sub={
            kpis && totalOrder > 0 ? (
              <span>Output rate {fmtPct(kpis.outputRate)}</span>
            ) : undefined
          }
          loading={kpiLoading}
        />
        <StatCard
          label="Total Input"
          value={fmt(totalInput)}
          icon={TrendingUp}
          iconClass="bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
          sub={
            kpis && kpis.missing > 0 ? (
              <span className="text-rose-600 dark:text-rose-400">
                {fmt(kpis.missing)} units missing
              </span>
            ) : (
              <span className="text-emerald-600 dark:text-emerald-400">Fully received</span>
            )
          }
          loading={kpiLoading}
        />
        <StatCard
          label="Completion Rate"
          value={fmtPct(completionRate)}
          icon={BarChart3}
          iconClass={cn(
            completionToneState.band === "high"
              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
              : completionToneState.band === "mid"
              ? "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
              : "bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300"
          )}
          sub={
            kpis ? (
              <span>
                {fmt(kpis.processing)} units in processing
              </span>
            ) : undefined
          }
          loading={kpiLoading}
        />
      </div>

      {/* ---------------- KPI error ---------------- */}
      {kpiQuery.isError ? (
        <ErrorState
          message={kpiQuery.error instanceof Error ? kpiQuery.error.message : "Unknown error"}
          onRetry={() => kpiQuery.refetch()}
        />
      ) : null}

      {/* ---------------- Dimension selector ---------------- */}
      <Tabs value={dimension} onValueChange={(v) => setDimension(v as DimensionKey)}>
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <TabsList className="flex h-9 flex-wrap gap-0.5">
            {DIMENSIONS.map((d) => (
              <TabsTrigger key={d.key} value={d.key} className="text-xs">
                {d.short}
              </TabsTrigger>
            ))}
          </TabsList>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-fit"
            onClick={() => {
              bumpRefresh();
              refetchAll();
            }}
          >
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Refresh
          </Button>
        </div>

        {/* ---------------- Charts + Table per dimension ---------------- */}
        {DIMENSIONS.map((d) => (
          <TabsContent key={d.key} value={d.key} className="space-y-4">
            {d.key === dimension ? (
              <>
                <ChartsRow
                  rows={dimRows}
                  dimensionLabel={d.label.replace("By ", "")}
                  loading={dimLoading}
                />
                <DimensionTable
                  rows={dimRows}
                  dimensionLabel={d.label.replace("By ", "")}
                  loading={dimLoading}
                  isError={dimQuery.isError}
                  onRetry={() => dimQuery.refetch()}
                />
              </>
            ) : null}
          </TabsContent>
        ))}
      </Tabs>

      {/* ---------------- Daily production report ---------------- */}
      <DailyProductionReport
        orderSeries={orderTimeline.data?.series ?? []}
        outputSeries={outputTimeline.data?.series ?? []}
        inputSeries={inputTimeline.data?.series ?? []}
        loading={timelineLoading}
        isError={timelineError}
        onRetry={() => {
          orderTimeline.refetch();
          outputTimeline.refetch();
          inputTimeline.refetch();
        }}
      />
    </div>
  );
}

export default ProductStatisticsView;
