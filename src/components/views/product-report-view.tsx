"use client";

// =====================================================================
// ProductReportView
// ---------------------------------------------------------------------
// Production Report & Data Validation UI for the currently-selected
// product. Three tabbed sections driven by `/api/report/groups`:
//
//   1. Production Dashboard — 8 summary cards + Output/Input progress
//      bars + Completed / Not Started / Surplus counts.
//   2. Production Report Table — filter bar + 14-column row-selectable
//      table with status badges, error row tinting, row-click detail
//      dialog, client-side pagination (20/page), and Excel export.
//   3. Data Errors — paginated list of all detected errors with
//      severity badges, descriptions, possible causes & solutions.
//
// All API calls are product-scoped: `currentProduct` is the mandatory
// first argument. `refreshKey` from the app store participates in
// query keys so the global refresh button triggers refetch.
// =====================================================================

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  FileText,
  Boxes,
  ShoppingCart,
  PackageCheck,
  PackageOpen,
  AlertTriangle,
  Bug,
  CalendarClock,
  TrendingUp,
  CheckCircle2,
  Hourglass,
  Layers,
  Download,
  Loader2,
  Search,
  Filter,
  RotateCcw,
  RefreshCw,
  Eye,
  Calendar,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  ArrowUp,
  ArrowDown,
  ArrowRight,
  Info,
  AlertOctagon,
  Ban,
  ArrowUpRight,
  CheckCheck,
  X,
  Percent,
} from "lucide-react";

import { api } from "@/lib/api-client";
import { cn, formatDateDisplay } from "@/lib/utils";
import { useAppStore, PRODUCT_THEME } from "@/store/app-store";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";

// =====================================================================
// Types — mirror lib/report-service.ts shapes
// =====================================================================

type ProductionStatus =
  | "NOT_STARTED"
  | "PARTIALLY_OUTPUT"
  | "OUTPUT_COMPLETED"
  | "PARTIALLY_RECEIVED"
  | "FULLY_RECEIVED"
  | "WAITING_FOR_INPUT"
  | "OVERDUE"
  | "OUTPUT_EXCEEDS_ORDER"
  | "INPUT_EXCEEDS_OUTPUT"
  | "INPUT_EXCEEDS_ORDER"
  | "OUTPUT_WITHOUT_ORDER"
  | "INPUT_WITHOUT_OUTPUT"
  | "DATA_ERROR";

type ErrorType =
  | "OUTPUT_EXCEEDS_ORDER"
  | "INPUT_EXCEEDS_OUTPUT"
  | "INPUT_EXCEEDS_ORDER"
  | "OUTPUT_WITHOUT_ORDER"
  | "INPUT_WITHOUT_OUTPUT"
  | "OVERDUE_OUTPUT"
  | "OVERDUE_INPUT"
  | "NO_OUTPUT_OVERDUE"
  | "NO_INPUT_RECEIVED"
  | "DUPLICATE_OUTPUT"
  | "DUPLICATE_INPUT"
  | "INVALID_PO_FACTORY_COMBINATION"
  | "MISSING_DEADLINE"
  | "DATA_ERROR";

type Severity = "CRITICAL" | "ERROR" | "WARNING" | "INFO";

type ResolutionStatus = "OPEN" | "INVESTIGATING" | "RESOLVED" | "IGNORED";

interface TransactionRecord {
  date: string;
  shippingStatus: string;
  qty1: number;
  qty2: number;
}

interface ReportGroup {
  key: string;
  productType: string;
  poNo: string;
  factoryPO: string;
  model: string;
  sku: string;
  item: string;
  season: string;
  colorCode: string;
  colorCode2: string;
  painting: string;
  printingColor: string;
  size: string;
  deadline: string | null;
  deadlineStatus: string;
  orderQty: number;
  outputQty: number;
  inputQty: number;
  pendingQty: number;
  remainingOutput: number;
  remainingInput: number;
  outputProgress: number;
  inputProgress: number;
  inputPercentage: number;
  outputVariance: number;
  inputVariance: number;
  outputVariancePercent: number;
  inputVariancePercent: number;
  productionStatus: ProductionStatus;
  errorType: ErrorType | null;
  rowCount: number;
  transactions: TransactionRecord[];
}

interface ReportError {
  errorType: ErrorType;
  severity: Severity;
  poNo: string;
  factoryPO: string;
  size: string;
  colorCode: string;
  orderQty: number;
  outputQty: number;
  inputQty: number;
  pendingQty: number;
  deadline: string | null;
  description: string;
  possibleCauses: string[];
  suggestedSolutions: string[];
  resolutionStatus: ResolutionStatus;
}

interface ReportSummary {
  totalGroups: number;
  totalOrder: number;
  totalOutput: number;
  totalInput: number;
  totalPending: number;
  totalRemainingOutput: number;
  totalRemainingInput: number;
  outputProgress: number;
  inputProgress: number;
  overdueCount: number;
  errorCount: number;
  surplusCount: number;
  completedCount: number;
  notStartedCount: number;
}

interface ReportResponse {
  groups: ReportGroup[];
  errors: ReportError[];
  summary: ReportSummary;
}

interface ReportFilters {
  poNo: string;
  factoryPO: string;
  model: string;
  size: string;
  colorCode: string;
  season: string;
  dateFrom: string;
  dateTo: string;
}

const EMPTY_FILTERS: ReportFilters = {
  poNo: "",
  factoryPO: "",
  model: "",
  size: "",
  colorCode: "",
  season: "",
  dateFrom: "",
  dateTo: "",
};

type TabKey = "dashboard" | "table" | "errors";

const PAGE_SIZE = 20;

// =====================================================================
// Production status visual meta — badge + row tint
// (emerald/teal primary, rose for errors, amber for warnings, slate for
// neutral. NO indigo/blue.)
// =====================================================================

const STATUS_META: Record<
  ProductionStatus,
  {
    label: string;
    badge: string;
    row: string;
    dot: string;
  }
> = {
  FULLY_RECEIVED: {
    label: "FULLY RECEIVED",
    badge:
      "border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/50 dark:text-emerald-300",
    row: "bg-emerald-50/30 hover:bg-emerald-50/60 dark:bg-emerald-950/10 dark:hover:bg-emerald-950/20",
    dot: "🟢",
  },
  PARTIALLY_RECEIVED: {
    label: "PARTIALLY RECEIVED",
    badge:
      "border-teal-200 bg-teal-100 text-teal-700 dark:border-teal-900/50 dark:bg-teal-950/50 dark:text-teal-300",
    row: "bg-teal-50/30 hover:bg-teal-50/60 dark:bg-teal-950/10 dark:hover:bg-teal-950/20",
    dot: "🔵",
  },
  OUTPUT_COMPLETED: {
    label: "OUTPUT COMPLETED",
    badge:
      "border-teal-200 bg-teal-100 text-teal-700 dark:border-teal-900/50 dark:bg-teal-950/50 dark:text-teal-300",
    row: "bg-teal-50/20 hover:bg-teal-50/50 dark:bg-teal-950/10 dark:hover:bg-teal-950/20",
    dot: "🟦",
  },
  PARTIALLY_OUTPUT: {
    label: "PARTIALLY OUTPUT",
    badge:
      "border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/50 dark:text-amber-300",
    row: "bg-amber-50/30 hover:bg-amber-50/60 dark:bg-amber-950/10 dark:hover:bg-amber-950/20",
    dot: "🟠",
  },
  WAITING_FOR_INPUT: {
    label: "WAITING FOR INPUT",
    badge:
      "border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/50 dark:text-amber-300",
    row: "bg-amber-50/20 hover:bg-amber-50/50 dark:bg-amber-950/10 dark:hover:bg-amber-950/20",
    dot: "⏳",
  },
  NOT_STARTED: {
    label: "NOT STARTED",
    badge:
      "border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-800/60 dark:bg-slate-800/40 dark:text-slate-300",
    row: "hover:bg-muted/30",
    dot: "⚪",
  },
  OVERDUE: {
    label: "OVERDUE",
    badge:
      "border-red-200 bg-red-100 text-red-700 dark:border-red-900/50 dark:bg-red-950/50 dark:text-red-300",
    row: "bg-red-50/40 hover:bg-red-50/70 dark:bg-red-950/20 dark:hover:bg-red-950/30",
    dot: "🔴",
  },
  OUTPUT_EXCEEDS_ORDER: {
    label: "OUTPUT > ORDER",
    badge:
      "border-rose-200 bg-rose-100 text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/50 dark:text-rose-300",
    row: "bg-rose-50/40 hover:bg-rose-50/70 dark:bg-rose-950/20 dark:hover:bg-rose-950/30",
    dot: "⛔",
  },
  INPUT_EXCEEDS_OUTPUT: {
    label: "INPUT > OUTPUT",
    badge:
      "border-rose-200 bg-rose-100 text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/50 dark:text-rose-300",
    row: "bg-rose-50/40 hover:bg-rose-50/70 dark:bg-rose-950/20 dark:hover:bg-rose-950/30",
    dot: "⛔",
  },
  INPUT_EXCEEDS_ORDER: {
    label: "INPUT > ORDER",
    badge:
      "border-rose-300 bg-rose-200 text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/60 dark:text-rose-200",
    row: "bg-rose-100/40 hover:bg-rose-100/70 dark:bg-rose-950/30 dark:hover:bg-rose-950/40",
    dot: "⛔",
  },
  OUTPUT_WITHOUT_ORDER: {
    label: "OUTPUT WITHOUT ORDER",
    badge:
      "border-rose-200 bg-rose-100 text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/50 dark:text-rose-300",
    row: "bg-rose-50/40 hover:bg-rose-50/70 dark:bg-rose-950/20 dark:hover:bg-rose-950/30",
    dot: "⚠️",
  },
  INPUT_WITHOUT_OUTPUT: {
    label: "INPUT WITHOUT OUTPUT",
    badge:
      "border-rose-200 bg-rose-100 text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/50 dark:text-rose-300",
    row: "bg-rose-50/40 hover:bg-rose-50/70 dark:bg-rose-950/20 dark:hover:bg-rose-950/30",
    dot: "⚠️",
  },
  DATA_ERROR: {
    label: "DATA ERROR",
    badge:
      "border-rose-200 bg-rose-100 text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/50 dark:text-rose-300",
    row: "bg-rose-50/40 hover:bg-rose-50/70 dark:bg-rose-950/20 dark:hover:bg-rose-950/30",
    dot: "⛔",
  },
};

// =====================================================================
// Severity visual meta — for the Data Errors tab
// =====================================================================

const SEVERITY_META: Record<
  Severity,
  { label: string; badge: string; ring: string; icon: React.ComponentType<{ className?: string }> }
> = {
  CRITICAL: {
    label: "CRITICAL",
    badge:
      "border-red-300 bg-red-100 text-red-700 dark:border-red-900/60 dark:bg-red-950/60 dark:text-red-300",
    ring: "ring-red-500/30",
    icon: AlertOctagon,
  },
  ERROR: {
    label: "ERROR",
    badge:
      "border-rose-300 bg-rose-100 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/60 dark:text-rose-300",
    ring: "ring-rose-500/30",
    icon: AlertTriangle,
  },
  WARNING: {
    label: "WARNING",
    badge:
      "border-amber-300 bg-amber-100 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/60 dark:text-amber-300",
    ring: "ring-amber-500/30",
    icon: AlertTriangle,
  },
  INFO: {
    label: "INFO",
    badge:
      "border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-800/60 dark:bg-slate-800/40 dark:text-slate-300",
    ring: "ring-slate-500/20",
    icon: Info,
  },
};

// =====================================================================
// ErrorType → Severity mapping (mirrors report-service.ts buildError())
// Used to colour the per-row Error badge in the report table.
// =====================================================================

const ERROR_TYPE_SEVERITY: Record<ErrorType, Severity> = {
  OUTPUT_EXCEEDS_ORDER: "ERROR",
  INPUT_EXCEEDS_OUTPUT: "ERROR",
  INPUT_EXCEEDS_ORDER: "CRITICAL",
  OUTPUT_WITHOUT_ORDER: "ERROR",
  INPUT_WITHOUT_OUTPUT: "ERROR",
  OVERDUE_OUTPUT: "WARNING",
  OVERDUE_INPUT: "WARNING",
  NO_OUTPUT_OVERDUE: "WARNING",
  NO_INPUT_RECEIVED: "INFO",
  DUPLICATE_OUTPUT: "WARNING",
  DUPLICATE_INPUT: "WARNING",
  INVALID_PO_FACTORY_COMBINATION: "WARNING",
  MISSING_DEADLINE: "INFO",
  DATA_ERROR: "WARNING",
};

function errorTypeSeverity(t: ErrorType): Severity {
  return ERROR_TYPE_SEVERITY[t] ?? "WARNING";
}

// =====================================================================
// All error types — used by the multi-select error-type filter panel
// =====================================================================

const ALL_ERROR_TYPES: ErrorType[] = [
  "OUTPUT_EXCEEDS_ORDER",
  "INPUT_EXCEEDS_OUTPUT",
  "INPUT_EXCEEDS_ORDER",
  "OUTPUT_WITHOUT_ORDER",
  "INPUT_WITHOUT_OUTPUT",
  "OVERDUE_OUTPUT",
  "OVERDUE_INPUT",
  "NO_OUTPUT_OVERDUE",
  "NO_INPUT_RECEIVED",
  "DUPLICATE_OUTPUT",
  "DUPLICATE_INPUT",
  "INVALID_PO_FACTORY_COMBINATION",
  "MISSING_DEADLINE",
  "DATA_ERROR",
];

// =====================================================================
// Sortable column accessors — keys match the `column` arg passed to
// toggleSort() and SortableHeader. Returns a comparable number/string.
// =====================================================================

type SortDir = "asc" | "desc" | null;

const SORT_ACCESSORS: Record<string, (g: ReportGroup) => number | string> = {
  poNo: (g) => g.poNo || "",
  factoryPO: (g) => g.factoryPO || "",
  size: (g) => g.size || "",
  order: (g) => g.orderQty,
  output: (g) => g.outputQty,
  input: (g) => g.inputQty,
  remainingOutput: (g) => g.remainingOutput,
  remainingInput: (g) => g.remainingInput,
  outputPct: (g) => g.outputProgress,
  inputPct: (g) => g.inputProgress,
  outputVarPct: (g) => g.outputVariancePercent,
  inputVarPct: (g) => g.inputVariancePercent,
  deadline: (g) => parseDeadlineTime(g.deadline),
};

function parseDeadlineTime(s: string | null | undefined): number {
  if (!s) return Number.POSITIVE_INFINITY;
  const str = String(s).trim();
  if (!str) return Number.POSITIVE_INFINITY;
  // dd/mm/yyyy
  const dmy = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) {
    const d = new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
    if (!isNaN(d.getTime())) return d.getTime();
  }
  const iso = new Date(str);
  if (!isNaN(iso.getTime())) return iso.getTime();
  return Number.POSITIVE_INFINITY;
}

// =====================================================================
// Helpers
// =====================================================================

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString();
}

function formatDeadline(s: string | null | undefined): string {
  return formatDateDisplay(s);
}

function formatTxDate(s: string | null | undefined): string {
  return formatDateDisplay(s);
}

function pct(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `${n.toFixed(1)}%`;
}

function varianceColorClass(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v) || v === 0) {
    return "text-muted-foreground";
  }
  return v > 0
    ? "text-emerald-600 dark:text-emerald-400"
    : "text-rose-600 dark:text-rose-400";
}

function formatVariancePercent(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}%`;
}

function formatSignedInt(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toLocaleString()}`;
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

type StatTone = "primary" | "warning" | "danger" | "ok" | "neutral";

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
  neutral: {
    text: "text-slate-600 dark:text-slate-300",
    bg: "bg-slate-50 dark:bg-slate-800/40",
    ring: "ring-slate-500/20",
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

function StatusBadge({ status }: { status: ProductionStatus }) {
  const m = STATUS_META[status] ?? STATUS_META.NOT_STARTED;
  return (
    <Badge className={cn("gap-1 text-[10px]", m.badge)}>
      <span aria-hidden>{m.dot}</span>
      {m.label}
    </Badge>
  );
}

function SeverityBadge({ severity }: { severity: Severity }) {
  const m = SEVERITY_META[severity] ?? SEVERITY_META.INFO;
  const Icon = m.icon;
  return (
    <Badge className={cn("gap-1 text-[10px]", m.badge)}>
      <Icon className="h-3 w-3" />
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
      <label className="text-xs font-medium text-muted-foreground" htmlFor={id}>
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
// Pagination footer — generic, works for any client-side list
// =====================================================================

function PaginationFooter({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (p: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const from = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const to = Math.min(total, safePage * pageSize);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2.5">
      <span className="text-xs text-muted-foreground">
        Showing <span className="font-medium tabular-nums">{from}</span>–
        <span className="font-medium tabular-nums">{to}</span> of{" "}
        <span className="font-medium tabular-nums">{total}</span>
      </span>
      <div className="flex items-center gap-1">
        <Button
          size="sm"
          variant="outline"
          className="h-8 w-8 p-0"
          disabled={safePage <= 1}
          onClick={() => onPageChange(safePage - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="px-2 text-xs tabular-nums">
          {safePage} / {totalPages}
        </span>
        <Button
          size="sm"
          variant="outline"
          className="h-8 w-8 p-0"
          disabled={safePage >= totalPages}
          onClick={() => onPageChange(safePage + 1)}
          aria-label="Next page"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// =====================================================================
// SortHeader — clickable table header cell with sort-direction indicator
// (3-state cycle: asc → desc → none). Non-active columns show a faint
// up/down hint on hover.
// =====================================================================

function SortHeader({
  column,
  sortColumn,
  sortDirection,
  onSort,
  align = "left",
  className,
  children,
}: {
  column: string;
  sortColumn: string;
  sortDirection: SortDir;
  onSort: (col: string) => void;
  align?: "left" | "right";
  className?: string;
  children: React.ReactNode;
}) {
  const isActive = sortColumn === column;
  const Arrow =
    !isActive || !sortDirection
      ? null
      : sortDirection === "asc"
        ? ArrowUp
        : ArrowDown;
  return (
    <TableHead
      className={cn(
        "whitespace-nowrap px-3 py-2 text-[10px] font-semibold uppercase text-muted-foreground",
        align === "right" ? "text-right" : "",
        isActive && "text-foreground",
        className
      )}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        aria-label={`Sort by ${column}`}
        className={cn(
          "inline-flex items-center gap-1 transition-colors hover:text-foreground focus:outline-none focus-visible:text-foreground",
          align === "right" && "flex-row-reverse"
        )}
      >
        <span>{children}</span>
        {Arrow ? (
          <Arrow
            className={cn(
              "h-3 w-3",
              isActive ? "text-primary" : "text-muted-foreground"
            )}
          />
        ) : null}
      </button>
    </TableHead>
  );
}

// =====================================================================
// Main component
// =====================================================================

export function ProductReportView() {
  const { currentProduct, refreshKey, bumpRefresh } = useAppStore();
  const theme = PRODUCT_THEME[currentProduct];

  // --- Filter state: `form` is what user types, `applied` triggers query ---
  const [form, setForm] = React.useState<ReportFilters>(EMPTY_FILTERS);
  const [applied, setApplied] = React.useState<ReportFilters>(EMPTY_FILTERS);

  // --- UI state ---
  const [tab, setTab] = React.useState<TabKey>("dashboard");
  const [selectedGroup, setSelectedGroup] = React.useState<ReportGroup | null>(null);
  const [selectedKeys, setSelectedKeys] = React.useState<Set<string>>(new Set());
  const [tablePage, setTablePage] = React.useState(1);
  const [errorPage, setErrorPage] = React.useState(1);
  const [exporting, setExporting] = React.useState(false);

  // --- Error-type filter + sort state (Tab 2) ---
  const [selectedErrorTypes, setSelectedErrorTypes] = React.useState<Set<string>>(new Set());
  const [showOnlyErrors, setShowOnlyErrors] = React.useState(false);
  const [sortColumn, setSortColumn] = React.useState<string>("");
  const [sortDirection, setSortDirection] = React.useState<SortDir>(null);
  const [filterPanelOpen, setFilterPanelOpen] = React.useState(false);

  // Reset state when the active product changes — filters / selection /
  // pagination don't carry across products.
  React.useEffect(() => {
    setForm(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    setSelectedKeys(new Set());
    setSelectedGroup(null);
    setTablePage(1);
    setErrorPage(1);
    setTab("dashboard");
    setSelectedErrorTypes(new Set());
    setShowOnlyErrors(false);
    setSortColumn("");
    setSortDirection(null);
    setFilterPanelOpen(false);
  }, [currentProduct]);

  // ---- Compose filter params for /api/report/groups ----
  const filterParams = React.useMemo(() => {
    const params: Record<string, string> = {};
    if (applied.poNo) params.poNo = applied.poNo;
    if (applied.factoryPO) params.factoryPO = applied.factoryPO;
    if (applied.model) params.model = applied.model;
    if (applied.size) params.size = applied.size;
    if (applied.colorCode) params.colorCode = applied.colorCode;
    if (applied.season) params.season = applied.season;
    if (applied.dateFrom) params.dateFrom = applied.dateFrom;
    if (applied.dateTo) params.dateTo = applied.dateTo;
    return params;
  }, [applied]);

  // ---- Query: report groups + errors + summary (single endpoint) ----
  const reportQuery = useQuery({
    queryKey: ["report-groups", currentProduct, filterParams, refreshKey],
    queryFn: () => api.getReportGroups(currentProduct, filterParams),
    enabled: Boolean(currentProduct),
  });

  const data = reportQuery.data as ReportResponse | undefined;
  const groups: ReportGroup[] = data?.groups ?? [];
  const errors: ReportError[] = data?.errors ?? [];
  const summary: ReportSummary | null = data?.summary ?? null;
  const loading = reportQuery.isLoading;
  const fetching = reportQuery.isFetching;

  // ---- Filter actions ----
  function applyFilters() {
    setApplied(form);
    setTablePage(1);
    setErrorPage(1);
  }

  function resetFilters() {
    setForm(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    setTablePage(1);
    setErrorPage(1);
  }

  const hasActiveFilters = React.useMemo(() => {
    return Boolean(
      applied.poNo ||
        applied.factoryPO ||
        applied.model ||
        applied.size ||
        applied.colorCode ||
        applied.season ||
        applied.dateFrom ||
        applied.dateTo
    );
  }, [applied]);

  // ---- Per-error-type counts (for the multi-select filter panel) ----
  const errorTypeCounts = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const g of groups) {
      if (g.errorType) {
        map.set(g.errorType, (map.get(g.errorType) ?? 0) + 1);
      }
    }
    return map;
  }, [groups]);

  // ---- Multi-select error-type filter handlers ----
  function toggleErrorType(t: string) {
    setSelectedErrorTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
    setTablePage(1);
  }

  function selectAllErrorTypes() {
    setSelectedErrorTypes(new Set(ALL_ERROR_TYPES));
    setTablePage(1);
  }

  function clearErrorTypes() {
    setSelectedErrorTypes(new Set());
    setTablePage(1);
  }

  // ---- Sort handler (asc → desc → none → asc …) ----
  function toggleSort(col: string) {
    if (sortColumn !== col) {
      setSortColumn(col);
      setSortDirection("asc");
    } else if (sortDirection === "asc") {
      setSortDirection("desc");
    } else if (sortDirection === "desc") {
      setSortColumn("");
      setSortDirection(null);
    } else {
      setSortColumn(col);
      setSortDirection("asc");
    }
  }

  // ---- Final filtered + sorted groups for the table (client-side) ----
  const filteredSortedGroups = React.useMemo(() => {
    let result = groups;

    // Multi-select OR filter on errorType
    if (selectedErrorTypes.size > 0) {
      result = result.filter(
        (g) => Boolean(g.errorType) && selectedErrorTypes.has(g.errorType as string)
      );
    }

    // Show-only-errors switch
    if (showOnlyErrors) {
      result = result.filter((g) => Boolean(g.errorType));
    }

    // Sort (3-state: asc / desc / none)
    if (sortColumn && sortDirection) {
      const accessor = SORT_ACCESSORS[sortColumn];
      if (accessor) {
        const dir = sortDirection === "asc" ? 1 : -1;
        result = [...result].sort((a, b) => {
          const av = accessor(a);
          const bv = accessor(b);
          if (typeof av === "string" && typeof bv === "string") {
            return av.localeCompare(bv) * dir;
          }
          const an = typeof av === "number" ? av : Number(av);
          const bn = typeof bv === "number" ? bv : Number(bv);
          // Push missing deadlines / NaN values to the end regardless of dir.
          if (!Number.isFinite(an) && !Number.isFinite(bn)) return 0;
          if (!Number.isFinite(an)) return 1;
          if (!Number.isFinite(bn)) return -1;
          return (an - bn) * dir;
        });
      }
    }

    return result;
  }, [groups, selectedErrorTypes, showOnlyErrors, sortColumn, sortDirection]);

  const hasErrorTypeFilter = selectedErrorTypes.size > 0 || showOnlyErrors;

  // ---- Row selection ----
  function toggleRow(key: string) {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function selectAllVisible(keys: string[]) {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      for (const k of keys) next.add(k);
      return next;
    });
  }

  function clearSelection() {
    setSelectedKeys(new Set());
  }

  // ---- Pagination slices (client-side) ----
  const tableSlice = React.useMemo(() => {
    const start = (tablePage - 1) * PAGE_SIZE;
    return filteredSortedGroups.slice(start, start + PAGE_SIZE);
  }, [filteredSortedGroups, tablePage]);

  const errorSlice = React.useMemo(() => {
    const start = (errorPage - 1) * PAGE_SIZE;
    return errors.slice(start, start + PAGE_SIZE);
  }, [errors, errorPage]);

  // Reset page when list shrinks below current page.
  React.useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(filteredSortedGroups.length / PAGE_SIZE));
    if (tablePage > maxPage) setTablePage(maxPage);
  }, [filteredSortedGroups.length, tablePage]);

  React.useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(errors.length / PAGE_SIZE));
    if (errorPage > maxPage) setErrorPage(maxPage);
  }, [errors.length, errorPage]);

  // ---- Export report (Excel) ----
  async function exportReport() {
    if (groups.length === 0 && errors.length === 0) {
      toast.error("Nothing to export — the report is empty for the current filters.");
      return;
    }
    setExporting(true);
    try {
      const blob = await api.exportReport({
        productType: currentProduct,
        poNo: applied.poNo || undefined,
        factoryPO: applied.factoryPO || undefined,
        colorCode: applied.colorCode || undefined,
        size: applied.size || undefined,
      });
      const today = todayLocalISO();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Production_Report_${currentProduct}_${today}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(
        `Exported ${groups.length} group${groups.length === 1 ? "" : "s"} and ${errors.length} error${errors.length === 1 ? "" : "s"} to Excel.`
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Report export failed.");
    } finally {
      setExporting(false);
    }
  }

  const productLabel = theme.label;

  // =====================================================================
  // Render
  // =====================================================================

  return (
    <div className="space-y-5">
      {/* ---------------- Header ---------------- */}
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold tracking-tight">Production Report &amp; Data Validation</h1>
          <Badge className={cn("gap-1 text-[10px]", theme.badge)}>
            <FileText className="h-3 w-3" />
            {productLabel}
          </Badge>
          {fetching && !loading ? (
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
          Production dashboard, full report table, and data-error insights for{" "}
          <strong>{productLabel}</strong>. Filter by PO / Factory PO / Model / Size / Color / Season /
          date range. Export to Excel anytime.
        </p>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)} className="space-y-4">
        <TabsList className="grid w-full grid-cols-3 sm:w-auto sm:grid-cols-none sm:inline-flex">
          <TabsTrigger value="dashboard" className="gap-1.5 text-xs">
            <TrendingUp className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Dashboard</span>
            <span className="sm:hidden">Dash</span>
          </TabsTrigger>
          <TabsTrigger value="table" className="gap-1.5 text-xs">
            <FileText className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Report Table</span>
            <span className="sm:hidden">Table</span>
            <Badge variant="outline" className="ml-1 h-4 px-1 text-[9px] leading-none">
              {groups.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="errors" className="gap-1.5 text-xs">
            <Bug className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Data Errors</span>
            <span className="sm:hidden">Errors</span>
            {errors.length > 0 ? (
              <Badge
                className={cn(
                  "ml-1 h-4 px-1 text-[9px] leading-none",
                  errors.length > 0
                    ? "border-rose-300 bg-rose-100 text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/50 dark:text-rose-300"
                    : ""
                )}
              >
                {errors.length}
              </Badge>
            ) : null}
          </TabsTrigger>
        </TabsList>

        {/* ============================================================= */}
        {/* Tab 1 — Production Dashboard                                  */}
        {/* ============================================================= */}
        <TabsContent value="dashboard" className="space-y-4 m-0">
          {/* 8 summary cards */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
            <StatCard
              label="Total Groups"
              value={fmt(summary?.totalGroups ?? 0)}
              icon={Boxes}
              tone="primary"
              loading={loading}
              sub={<span>(PO + Factory PO + Size)</span>}
            />
            <StatCard
              label="Total Order"
              value={fmt(summary?.totalOrder ?? 0)}
              icon={ShoppingCart}
              tone="neutral"
              loading={loading}
              sub={<span>Order Qty (1xx)</span>}
            />
            <StatCard
              label="Total Output"
              value={fmt(summary?.totalOutput ?? 0)}
              icon={PackageCheck}
              tone="ok"
              loading={loading}
              sub={<span>Output Qty (2xx)</span>}
            />
            <StatCard
              label="Total Input"
              value={fmt(summary?.totalInput ?? 0)}
              icon={PackageOpen}
              tone="ok"
              loading={loading}
              sub={<span>Input Qty (4xx)</span>}
            />
            <StatCard
              label="Remaining Output"
              value={fmt(summary?.totalRemainingOutput ?? 0)}
              icon={Hourglass}
              tone="warning"
              loading={loading}
              sub={<span>Order − Output (≥0)</span>}
            />
            <StatCard
              label="Remaining Input"
              value={fmt(summary?.totalRemainingInput ?? 0)}
              icon={Hourglass}
              tone="warning"
              loading={loading}
              sub={<span>Output − Input (≥0)</span>}
            />
            <StatCard
              label="Overdue"
              value={fmt(summary?.overdueCount ?? 0)}
              icon={CalendarClock}
              tone="danger"
              loading={loading}
              sub={<span>Deadline passed, output pending</span>}
            />
            <StatCard
              label="Data Errors"
              value={fmt(summary?.errorCount ?? 0)}
              icon={Bug}
              tone="danger"
              loading={loading}
              sub={<span>Detected anomalies</span>}
            />
          </div>

          {/* Two progress bars */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <TrendingUp className="h-4 w-4 text-primary" /> Overall Progress
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <ProgressBar
                label="Output Progress"
                value={summary?.outputProgress ?? 0}
                totals={
                  summary
                    ? `${fmt(summary.totalOutput)} / ${fmt(summary.totalOrder)}`
                    : "—"
                }
                tone="primary"
                loading={loading}
              />
              <ProgressBar
                label="Input Progress"
                value={summary?.inputProgress ?? 0}
                totals={
                  summary
                    ? `${fmt(summary.totalInput)} / ${fmt(summary.totalOrder)}`
                    : "—"
                }
                tone="ok"
                loading={loading}
              />
            </CardContent>
          </Card>

          {/* Completed / Not Started / Surplus counts */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <StatCard
              label="Completed"
              value={fmt(summary?.completedCount ?? 0)}
              icon={CheckCircle2}
              tone="ok"
              loading={loading}
              sub={<span>Fully received groups</span>}
            />
            <StatCard
              label="Not Started"
              value={fmt(summary?.notStartedCount ?? 0)}
              icon={Ban}
              tone="neutral"
              loading={loading}
              sub={<span>No output yet</span>}
            />
            <StatCard
              label="Surplus"
              value={fmt(summary?.surplusCount ?? 0)}
              icon={ArrowUpRight}
              tone="danger"
              loading={loading}
              sub={<span>Output exceeds order</span>}
            />
          </div>
        </TabsContent>

        {/* ============================================================= */}
        {/* Tab 2 — Production Report Table                              */}
        {/* ============================================================= */}
        <TabsContent value="table" className="space-y-4 m-0">
          {/* Filter bar */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Filter className="h-4 w-4 text-primary" /> Filters
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3 lg:grid-cols-4">
                <FilterInput
                  id="rpt-po-no"
                  label="PO NO#"
                  value={form.poNo}
                  onChange={(v) => setForm((f) => ({ ...f, poNo: v }))}
                  onEnter={applyFilters}
                  placeholder="e.g. IN-PO-1234"
                />
                <FilterInput
                  id="rpt-factory-po"
                  label="Factory PO"
                  value={form.factoryPO}
                  onChange={(v) => setForm((f) => ({ ...f, factoryPO: v }))}
                  onEnter={applyFilters}
                  placeholder="e.g. MH26110228"
                />
                <FilterInput
                  id="rpt-model"
                  label="Model"
                  value={form.model}
                  onChange={(v) => setForm((f) => ({ ...f, model: v }))}
                  onEnter={applyFilters}
                  placeholder="e.g. MAFATE-R1"
                />
                <FilterInput
                  id="rpt-size"
                  label="Size"
                  value={form.size}
                  onChange={(v) => setForm((f) => ({ ...f, size: v }))}
                  onEnter={applyFilters}
                  placeholder="e.g. 42"
                />
                <FilterInput
                  id="rpt-color-code"
                  label="Color Code"
                  value={form.colorCode}
                  onChange={(v) => setForm((f) => ({ ...f, colorCode: v }))}
                  onEnter={applyFilters}
                  placeholder="e.g. BLK"
                />
                <FilterInput
                  id="rpt-season"
                  label="Season"
                  value={form.season}
                  onChange={(v) => setForm((f) => ({ ...f, season: v }))}
                  onEnter={applyFilters}
                  placeholder="e.g. SS26"
                />
                <FilterInput
                  id="rpt-date-from"
                  label="Date From"
                  type="date"
                  value={form.dateFrom}
                  onChange={(v) => setForm((f) => ({ ...f, dateFrom: v }))}
                  onEnter={applyFilters}
                />
                <FilterInput
                  id="rpt-date-to"
                  label="Date To"
                  type="date"
                  value={form.dateTo}
                  onChange={(v) => setForm((f) => ({ ...f, dateTo: v }))}
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
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto h-8 gap-1.5 text-xs"
                  onClick={exportReport}
                  disabled={exporting || (groups.length === 0 && errors.length === 0)}
                >
                  {exporting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Download className="h-3.5 w-3.5" />
                  )}
                  Export Report
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* =========================================================== */}
          {/* Error Type Filter — collapsible multi-select panel          */}
          {/* =========================================================== */}
          <Card>
            <Collapsible open={filterPanelOpen} onOpenChange={setFilterPanelOpen}>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Filter className="h-4 w-4 text-primary" /> Error Type Filter
                    {selectedErrorTypes.size > 0 ? (
                      <Badge className={cn("text-[10px]", theme.badge)}>
                        {selectedErrorTypes.size} selected
                      </Badge>
                    ) : null}
                    {hasErrorTypeFilter ? (
                      <Badge variant="outline" className="text-[10px]">
                        filtering
                      </Badge>
                    ) : null}
                  </CardTitle>
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2">
                      <Switch
                        id="only-errors-switch"
                        checked={showOnlyErrors}
                        onCheckedChange={(v) => {
                          setShowOnlyErrors(Boolean(v));
                          setTablePage(1);
                        }}
                      />
                      <Label
                        htmlFor="only-errors-switch"
                        className="text-xs text-muted-foreground"
                      >
                        Show Only Errors
                      </Label>
                    </div>
                    <CollapsibleTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1 text-xs"
                      >
                        {filterPanelOpen ? (
                          <ChevronUp className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5" />
                        )}
                        {filterPanelOpen ? "Hide" : "Show"} Error Types
                      </Button>
                    </CollapsibleTrigger>
                  </div>
                </div>
              </CardHeader>
              <CollapsibleContent>
                <CardContent className="space-y-3 pt-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1.5 text-xs"
                      onClick={selectAllErrorTypes}
                    >
                      <CheckCheck className="h-3 w-3" />
                      Select All Errors
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 gap-1.5 text-xs"
                      onClick={clearErrorTypes}
                      disabled={selectedErrorTypes.size === 0}
                    >
                      <X className="h-3 w-3" />
                      Clear
                    </Button>
                    {selectedErrorTypes.size > 0 ? (
                      <Badge variant="outline" className="text-[10px]">
                        Filtering {selectedErrorTypes.size} of {ALL_ERROR_TYPES.length} types
                      </Badge>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">
                        No error-type filter active — all groups are shown.
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                    {ALL_ERROR_TYPES.map((t) => {
                      const count = errorTypeCounts.get(t) ?? 0;
                      const checked = selectedErrorTypes.has(t);
                      const sev = errorTypeSeverity(t);
                      const m = SEVERITY_META[sev];
                      return (
                        <label
                          key={t}
                          className={cn(
                            "flex cursor-pointer items-center gap-2 rounded-md border p-2 text-xs transition-colors hover:bg-muted/40",
                            checked
                              ? "border-primary/50 bg-primary/5"
                              : "border-border"
                          )}
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={() => toggleErrorType(t)}
                            aria-label={`Filter by ${t}`}
                          />
                          <span
                            className="flex-1 font-mono text-[10px] leading-tight"
                            title={t}
                          >
                            {t}
                          </span>
                          <Badge className={cn("text-[9px] leading-none", m.badge)}>
                            {count}
                          </Badge>
                        </label>
                      );
                    })}
                  </div>
                </CardContent>
              </CollapsibleContent>
            </Collapsible>
          </Card>

          {/* Report groups table */}
          <Card>
            <CardContent className="p-0">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
                <div className="flex items-center gap-2 text-sm">
                  <FileText className="h-4 w-4 text-primary" />
                  <span className="font-medium">Production Report</span>
                  <Badge variant="outline" className="text-[10px]">
                    {filteredSortedGroups.length}
                  </Badge>
                  {hasErrorTypeFilter && filteredSortedGroups.length !== groups.length ? (
                    <Badge variant="outline" className="text-[10px]">
                      of {groups.length}
                    </Badge>
                  ) : null}
                  {selectedKeys.size > 0 ? (
                    <Badge className={cn("text-[10px]", theme.badge)}>
                      {selectedKeys.size} selected
                    </Badge>
                  ) : null}
                  {sortColumn && sortDirection ? (
                    <Badge variant="outline" className="text-[10px]">
                      sorted: {sortColumn} {sortDirection}
                    </Badge>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={() => selectAllVisible(tableSlice.map((g) => g.key))}
                    disabled={tableSlice.length === 0}
                  >
                    Select page
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
                      <SortHeader
                        column="poNo"
                        sortColumn={sortColumn}
                        sortDirection={sortDirection}
                        onSort={toggleSort}
                      >
                        PO NO#
                      </SortHeader>
                      <SortHeader
                        column="factoryPO"
                        sortColumn={sortColumn}
                        sortDirection={sortDirection}
                        onSort={toggleSort}
                      >
                        Factory PO
                      </SortHeader>
                      <SortHeader
                        column="size"
                        sortColumn={sortColumn}
                        sortDirection={sortDirection}
                        onSort={toggleSort}
                      >
                        Size
                      </SortHeader>
                      <SortHeader
                        column="order"
                        align="right"
                        sortColumn={sortColumn}
                        sortDirection={sortDirection}
                        onSort={toggleSort}
                      >
                        Order
                      </SortHeader>
                      <SortHeader
                        column="output"
                        align="right"
                        sortColumn={sortColumn}
                        sortDirection={sortDirection}
                        onSort={toggleSort}
                      >
                        Output
                      </SortHeader>
                      <SortHeader
                        column="input"
                        align="right"
                        sortColumn={sortColumn}
                        sortDirection={sortDirection}
                        onSort={toggleSort}
                      >
                        Input
                      </SortHeader>
                      <TableHead className="whitespace-nowrap px-3 py-2 text-right text-[10px] font-semibold uppercase text-muted-foreground">
                        Pending
                      </TableHead>
                      <SortHeader
                        column="remainingOutput"
                        align="right"
                        sortColumn={sortColumn}
                        sortDirection={sortDirection}
                        onSort={toggleSort}
                      >
                        Rem. Output
                      </SortHeader>
                      <SortHeader
                        column="remainingInput"
                        align="right"
                        sortColumn={sortColumn}
                        sortDirection={sortDirection}
                        onSort={toggleSort}
                      >
                        Rem. Input
                      </SortHeader>
                      <SortHeader
                        column="outputPct"
                        align="right"
                        sortColumn={sortColumn}
                        sortDirection={sortDirection}
                        onSort={toggleSort}
                      >
                        Output%
                      </SortHeader>
                      <SortHeader
                        column="inputPct"
                        align="right"
                        sortColumn={sortColumn}
                        sortDirection={sortDirection}
                        onSort={toggleSort}
                      >
                        Input%
                      </SortHeader>
                      <SortHeader
                        column="outputVarPct"
                        align="right"
                        sortColumn={sortColumn}
                        sortDirection={sortDirection}
                        onSort={toggleSort}
                      >
                        Output Var%
                      </SortHeader>
                      <SortHeader
                        column="inputVarPct"
                        align="right"
                        sortColumn={sortColumn}
                        sortDirection={sortDirection}
                        onSort={toggleSort}
                      >
                        Input Var%
                      </SortHeader>
                      <SortHeader
                        column="deadline"
                        sortColumn={sortColumn}
                        sortDirection={sortDirection}
                        onSort={toggleSort}
                      >
                        Deadline
                      </SortHeader>
                      <TableHead className="whitespace-nowrap px-3 py-2 text-[10px] font-semibold uppercase text-muted-foreground">
                        Status
                      </TableHead>
                      <TableHead className="whitespace-nowrap px-3 py-2 text-[10px] font-semibold uppercase text-muted-foreground">
                        Error
                      </TableHead>
                      <TableHead className="w-10 px-2 py-2" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      <TableSkeleton rows={6} cols={18} />
                    ) : reportQuery.isError ? (
                      <EmptyRow
                        colSpan={18}
                        message="Failed to load report"
                        hint={
                          reportQuery.error instanceof Error
                            ? reportQuery.error.message
                            : "Unknown error. Try Refresh."
                        }
                        icon={AlertTriangle}
                      />
                    ) : filteredSortedGroups.length === 0 ? (
                      <EmptyRow
                        colSpan={18}
                        message={
                          groups.length === 0
                            ? "No production groups found"
                            : "No groups match the active filters"
                        }
                        hint={
                          groups.length === 0
                            ? hasActiveFilters
                              ? "Try widening your filters or clicking Reset."
                              : `No production data for ${productLabel}. Make sure order / output / input rows have been entered for this product.`
                            : "Adjust the error-type filter or clear sorting to see more rows."
                        }
                        icon={FileText}
                      />
                    ) : (
                      tableSlice.map((g) => {
                        const m = STATUS_META[g.productionStatus] ?? STATUS_META.NOT_STARTED;
                        const isSelected = selectedKeys.has(g.key);
                        const hasError = Boolean(g.errorType);
                        return (
                          <TableRow
                            key={g.key}
                            onClick={() => setSelectedGroup(g)}
                            className={cn(
                              "cursor-pointer border-t transition-colors",
                              m.row,
                              isSelected && "ring-1 ring-inset ring-primary/20",
                              hasError && g.productionStatus !== "OVERDUE" &&
                                "bg-amber-50/40 hover:bg-amber-50/70 dark:bg-amber-950/15 dark:hover:bg-amber-950/25"
                            )}
                          >
                            <TableCell
                              className="px-2 py-1.5"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Checkbox
                                checked={isSelected}
                                onCheckedChange={() => toggleRow(g.key)}
                                aria-label={`Select ${g.poNo} ${g.factoryPO} ${g.size}`}
                              />
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
                            <TableCell className="px-3 py-1.5 text-right tabular-nums">
                              {fmt(g.orderQty)}
                            </TableCell>
                            <TableCell className="px-3 py-1.5 text-right tabular-nums">
                              {fmt(g.outputQty)}
                            </TableCell>
                            <TableCell className="px-3 py-1.5 text-right tabular-nums">
                              {fmt(g.inputQty)}
                            </TableCell>
                            <TableCell
                              className={cn(
                                "px-3 py-1.5 text-right tabular-nums",
                                g.pendingQty !== 0
                                  ? "text-amber-600 dark:text-amber-400"
                                  : "text-muted-foreground"
                              )}
                            >
                              {fmt(g.pendingQty)}
                            </TableCell>
                            <TableCell
                              className={cn(
                                "px-3 py-1.5 text-right tabular-nums",
                                g.remainingOutput > 0
                                  ? "text-amber-600 dark:text-amber-400 font-medium"
                                  : g.remainingOutput < 0
                                    ? "text-rose-600 dark:text-rose-400"
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
                                  : g.remainingInput < 0
                                    ? "text-rose-600 dark:text-rose-400"
                                    : "text-muted-foreground"
                              )}
                            >
                              {fmt(g.remainingInput)}
                            </TableCell>
                            <TableCell className="px-3 py-1.5 text-right tabular-nums">
                              {pct(g.outputProgress)}
                            </TableCell>
                            <TableCell className="px-3 py-1.5 text-right tabular-nums">
                              {pct(g.inputProgress)}
                            </TableCell>
                            <TableCell
                              className={cn(
                                "px-3 py-1.5 text-right tabular-nums font-medium",
                                varianceColorClass(g.outputVariancePercent)
                              )}
                            >
                              {formatVariancePercent(g.outputVariancePercent)}
                            </TableCell>
                            <TableCell
                              className={cn(
                                "px-3 py-1.5 text-right tabular-nums font-medium",
                                varianceColorClass(g.inputVariancePercent)
                              )}
                            >
                              {formatVariancePercent(g.inputVariancePercent)}
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
                              <StatusBadge status={g.productionStatus} />
                            </TableCell>
                            <TableCell className="px-3 py-1.5">
                              {g.errorType ? (
                                <Badge
                                  className={cn(
                                    "gap-1 text-[10px]",
                                    SEVERITY_META[errorTypeSeverity(g.errorType)].badge
                                  )}
                                >
                                  {g.errorType}
                                </Badge>
                              ) : (
                                <span className="text-muted-foreground/40">—</span>
                              )}
                            </TableCell>
                            <TableCell className="px-2 py-1.5 text-right">
                              <Eye className="h-3.5 w-3.5 text-muted-foreground/60" />
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>

              <PaginationFooter
                page={tablePage}
                pageSize={PAGE_SIZE}
                total={filteredSortedGroups.length}
                onPageChange={setTablePage}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* ============================================================= */}
        {/* Tab 3 — Data Errors                                           */}
        {/* ============================================================= */}
        <TabsContent value="errors" className="space-y-4 m-0">
          <Card>
            <CardContent className="p-0">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
                <div className="flex items-center gap-2 text-sm">
                  <Bug className="h-4 w-4 text-rose-500" />
                  <span className="font-medium">Data Errors</span>
                  <Badge variant="outline" className="text-[10px]">
                    {errors.length}
                  </Badge>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {(["CRITICAL", "ERROR", "WARNING", "INFO"] as Severity[]).map((s) => {
                    const count = errors.filter((e) => e.severity === s).length;
                    const m = SEVERITY_META[s];
                    return (
                      <Badge key={s} className={cn("text-[10px]", m.badge)}>
                        {m.label}: {count}
                      </Badge>
                    );
                  })}
                </div>
              </div>

              {loading ? (
                <div className="space-y-3 p-4">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={`esk-${i}`} className="h-32 w-full" />
                  ))}
                </div>
              ) : reportQuery.isError ? (
                <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                  Failed to load errors.{" "}
                  {reportQuery.error instanceof Error ? reportQuery.error.message : ""}
                </div>
              ) : errors.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
                  <CheckCircle2 className="h-10 w-10 text-emerald-500/60" />
                  <div className="text-sm font-medium">No data errors detected</div>
                  <div className="max-w-md text-xs text-muted-foreground">
                    {hasActiveFilters
                      ? "Try widening your filters — the current filters returned no error groups."
                      : `All production groups for ${productLabel} passed validation.`}
                  </div>
                </div>
              ) : (
                <>
                  <div className="space-y-3 p-4">
                    {errorSlice.map((err, i) => (
                      <ErrorCard
                        key={`${err.errorType}-${err.poNo}-${err.factoryPO}-${err.size}-${i}`}
                        error={err}
                        index={(errorPage - 1) * PAGE_SIZE + i + 1}
                      />
                    ))}
                  </div>
                  <PaginationFooter
                    page={errorPage}
                    pageSize={PAGE_SIZE}
                    total={errors.length}
                    onPageChange={setErrorPage}
                  />
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ---------------- Row detail dialog ---------------- */}
      <DetailDialog group={selectedGroup} onClose={() => setSelectedGroup(null)} />
    </div>
  );
}

// =====================================================================
// ProgressBar — labelled progress bar with tone + value display
// =====================================================================

function ProgressBar({
  label,
  value,
  totals,
  tone,
  loading,
}: {
  label: string;
  value: number;
  totals: string;
  tone: "primary" | "ok";
  loading?: boolean;
}) {
  const v = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  const barClass =
    tone === "primary"
      ? "[&>[data-slot=progress-indicator]]:bg-emerald-500"
      : "[&>[data-slot=progress-indicator]]:bg-teal-500";
  const textClass =
    tone === "primary"
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-teal-600 dark:text-teal-400";
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {loading ? (
          <Skeleton className="h-4 w-20" />
        ) : (
          <span className={cn("text-xs font-semibold tabular-nums", textClass)}>
            {v.toFixed(1)}% <span className="text-muted-foreground">· {totals}</span>
          </span>
        )}
      </div>
      {loading ? (
        <Skeleton className="h-2 w-full" />
      ) : (
        <Progress value={v} className={cn("h-2", barClass)} />
      )}
    </div>
  );
}

// =====================================================================
// ErrorCard — single error row on the Data Errors tab
// =====================================================================

function ErrorCard({ error, index }: { error: ReportError; index: number }) {
  const m = SEVERITY_META[error.severity] ?? SEVERITY_META.INFO;
  const Icon = m.icon;
  return (
    <div
      className={cn(
        "rounded-lg border bg-card p-4 shadow-sm ring-1",
        m.ring,
        error.severity === "CRITICAL" || error.severity === "ERROR"
          ? "border-rose-200 dark:border-rose-900/40"
          : error.severity === "WARNING"
            ? "border-amber-200 dark:border-amber-900/40"
            : "border-slate-200 dark:border-slate-800"
      )}
    >
      {/* Header row */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-semibold text-muted-foreground tabular-nums">
            #{index}
          </span>
          <SeverityBadge severity={error.severity} />
          <Badge variant="outline" className="font-mono text-[10px]">
            {error.errorType}
          </Badge>
          {error.resolutionStatus && error.resolutionStatus !== "OPEN" ? (
            <Badge variant="outline" className="text-[10px]">
              {error.resolutionStatus}
            </Badge>
          ) : null}
        </div>
      </div>

      {/* Description */}
      <p className="mt-2 text-sm">{error.description}</p>

      {/* Key fields grid */}
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-3 lg:grid-cols-6">
        <KeyVal label="PO NO#" value={error.poNo} mono />
        <KeyVal label="Factory PO" value={error.factoryPO} mono />
        <KeyVal
          label="Size"
          value={error.size}
          mono
        />
        <KeyVal
          label="Color"
          value={error.colorCode}
          mono
        />
        <KeyVal label="Order" value={fmt(error.orderQty)} tabular />
        <KeyVal label="Output" value={fmt(error.outputQty)} tabular />
        <KeyVal label="Input" value={fmt(error.inputQty)} tabular />
        <KeyVal label="Pending" value={fmt(error.pendingQty)} tabular />
        <KeyVal label="Deadline" value={formatDeadline(error.deadline)} />
      </div>

      {/* Causes + Solutions */}
      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="rounded-md border border-rose-200/60 bg-rose-50/40 p-2.5 dark:border-rose-900/40 dark:bg-rose-950/15">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-rose-700 dark:text-rose-300">
            <AlertTriangle className="h-3 w-3" />
            Possible Causes
          </div>
          {error.possibleCauses.length > 0 ? (
            <ul className="mt-1.5 space-y-0.5">
              {error.possibleCauses.map((c, i) => (
                <li key={i} className="flex items-start gap-1.5 text-xs">
                  <span className="mt-0.5 text-rose-500">•</span>
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1.5 text-xs text-muted-foreground">No causes listed.</p>
          )}
        </div>
        <div className="rounded-md border border-emerald-200/60 bg-emerald-50/40 p-2.5 dark:border-emerald-900/40 dark:bg-emerald-950/15">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="h-3 w-3" />
            Suggested Solutions
          </div>
          {error.suggestedSolutions.length > 0 ? (
            <ul className="mt-1.5 space-y-0.5">
              {error.suggestedSolutions.map((s, i) => (
                <li key={i} className="flex items-start gap-1.5 text-xs">
                  <span className="mt-0.5 text-emerald-500">→</span>
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1.5 text-xs text-muted-foreground">No solutions listed.</p>
          )}
        </div>
      </div>

      {/* Footer hint */}
      <div className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground">
        <Icon className="h-3 w-3" />
        Generated by production report engine — verify against transaction history before acting.
      </div>
    </div>
  );
}

function KeyVal({
  label,
  value,
  mono,
  tabular,
}: {
  label: string;
  value: string;
  mono?: boolean;
  tabular?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          "truncate text-xs font-medium",
          mono && "font-mono",
          tabular && "tabular-nums"
        )}
        title={value}
      >
        {value || <span className="text-muted-foreground/40">—</span>}
      </div>
    </div>
  );
}

// =====================================================================
// DetailDialog — opens when a report row is clicked
// =====================================================================

function DetailDialog({
  group,
  onClose,
}: {
  group: ReportGroup | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={Boolean(group)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto scroll-thin">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Eye className="h-4 w-4 text-primary" />
            Group Detail
            {group ? (
              <Badge variant="outline" className="ml-1 font-mono text-[10px]">
                {group.poNo} / {group.factoryPO} / {group.size}
              </Badge>
            ) : null}
          </DialogTitle>
          <DialogDescription>
            Full product info, quantities, progress, status, and transaction history for this group.
          </DialogDescription>
        </DialogHeader>

        {group ? (
          <div className="space-y-4">
            {/* Product info */}
            <section>
              <SectionTitle icon={Layers}>Product Info</SectionTitle>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-4">
                <KeyVal label="MODEL" value={group.model} mono />
                <KeyVal label="SKU" value={group.sku} mono />
                <KeyVal label="PO NO#" value={group.poNo} mono />
                <KeyVal label="Factory PO" value={group.factoryPO} mono />
                <KeyVal label="ITEM" value={group.item} />
                <KeyVal label="Season" value={group.season} />
                <KeyVal label="Color Code" value={group.colorCode} mono />
                <KeyVal label="COLOR CODE" value={group.colorCode2} mono />
                <KeyVal label="PAINTING" value={group.painting} />
                <KeyVal label="PRINTING COLOR" value={group.printingColor} />
                <KeyVal label="Size" value={group.size} mono />
                <KeyVal label="Deadline" value={formatDeadline(group.deadline)} />
              </div>
            </section>

            <Separator />

            {/* Quantities */}
            <section>
              <SectionTitle icon={ShoppingCart}>Quantities</SectionTitle>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-6">
                <KeyVal label="Order" value={fmt(group.orderQty)} tabular />
                <KeyVal label="Output" value={fmt(group.outputQty)} tabular />
                <KeyVal label="Input" value={fmt(group.inputQty)} tabular />
                <KeyVal label="Pending" value={fmt(group.pendingQty)} tabular />
                <KeyVal label="Remaining Output" value={fmt(group.remainingOutput)} tabular />
                <KeyVal label="Remaining Input" value={fmt(group.remainingInput)} tabular />
              </div>
            </section>

            <Separator />

            {/* Progress */}
            <section className="space-y-3">
              <SectionTitle icon={TrendingUp}>Progress</SectionTitle>
              <ProgressBar
                label="Output Progress (Output / Order)"
                value={group.outputProgress}
                totals={`${fmt(group.outputQty)} / ${fmt(group.orderQty)}`}
                tone="primary"
              />
              <ProgressBar
                label="Input Progress (Input / Order)"
                value={group.inputProgress}
                totals={`${fmt(group.inputQty)} / ${fmt(group.orderQty)}`}
                tone="ok"
              />
              <ProgressBar
                label="Input Percentage (Input / Output)"
                value={group.inputPercentage}
                totals={`${fmt(group.inputQty)} / ${fmt(group.outputQty)}`}
                tone="ok"
              />
            </section>

            <Separator />

            {/* Variance Analysis */}
            <section>
              <SectionTitle icon={Percent}>Variance Analysis</SectionTitle>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <VarianceCard
                  label="Output vs Order"
                  from={group.orderQty}
                  to={group.outputQty}
                  variancePercent={group.outputVariancePercent}
                  hint={`${fmt(group.outputQty)} out / ${fmt(group.orderQty)} ordered`}
                />
                <VarianceCard
                  label="Input vs Output"
                  from={group.outputQty}
                  to={group.inputQty}
                  variancePercent={group.inputVariancePercent}
                  hint={`${fmt(group.inputQty)} received / ${fmt(group.outputQty)} produced`}
                />
              </div>
            </section>

            <Separator />

            {/* Status */}
            <section>
              <SectionTitle icon={CheckCircle2}>Status</SectionTitle>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Production Status:</span>
                  <StatusBadge status={group.productionStatus} />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Deadline Status:</span>
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[10px]",
                      group.deadlineStatus === "OVERDUE"
                        ? "border-red-300 bg-red-100 text-red-700 dark:border-red-900/50 dark:bg-red-950/50 dark:text-red-300"
                        : group.deadlineStatus === "DUE_SOON"
                          ? "border-amber-300 bg-amber-100 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/50 dark:text-amber-300"
                          : "border-emerald-300 bg-emerald-100 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/50 dark:text-emerald-300"
                    )}
                  >
                    {group.deadlineStatus || "—"}
                  </Badge>
                </div>
                {group.errorType ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Error Type:</span>
                    <Badge
                      className={cn(
                        "text-[10px]",
                        "border-rose-300 bg-rose-100 text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/50 dark:text-rose-300"
                      )}
                    >
                      {group.errorType}
                    </Badge>
                  </div>
                ) : null}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Row count:</span>
                  <Badge variant="outline" className="text-[10px] tabular-nums">
                    {group.rowCount}
                  </Badge>
                </div>
              </div>
            </section>

            <Separator />

            {/* Transaction history */}
            <section>
              <SectionTitle icon={Calendar}>Transaction History</SectionTitle>
              {group.transactions.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-1.5 py-6 text-center">
                  <Info className="h-6 w-6 text-muted-foreground/40" />
                  <div className="text-xs text-muted-foreground">No transactions recorded.</div>
                </div>
              ) : (
                <div className="overflow-x-auto scroll-thin rounded-md border">
                  <Table className="text-xs">
                    <TableHeader className="bg-muted/40">
                      <TableRow>
                        <TableHead className="whitespace-nowrap px-3 py-2 text-[10px] font-semibold uppercase text-muted-foreground">
                          Date
                        </TableHead>
                        <TableHead className="whitespace-nowrap px-3 py-2 text-[10px] font-semibold uppercase text-muted-foreground">
                          Shipping Status
                        </TableHead>
                        <TableHead className="whitespace-nowrap px-3 py-2 text-right text-[10px] font-semibold uppercase text-muted-foreground">
                          Qty 1
                        </TableHead>
                        <TableHead className="whitespace-nowrap px-3 py-2 text-right text-[10px] font-semibold uppercase text-muted-foreground">
                          Qty 2
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {group.transactions.map((t, i) => {
                        const s = (t.shippingStatus || "").toLowerCase();
                        const tone =
                          s.startsWith("1") || s === "order"
                            ? "border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300"
                            : s.startsWith("2") || s === "output"
                              ? "border-teal-200 bg-teal-100 text-teal-700 dark:border-teal-900/50 dark:bg-teal-950/50 dark:text-teal-300"
                              : s.startsWith("4") || s === "input"
                                ? "border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/50 dark:text-emerald-300"
                                : "border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300";
                        return (
                          <TableRow key={i} className="border-t">
                            <TableCell className="whitespace-nowrap px-3 py-1.5 font-mono text-[11px]">
                              {formatTxDate(t.date)}
                            </TableCell>
                            <TableCell className="px-3 py-1.5">
                              <Badge className={cn("font-mono text-[10px]", tone)}>
                                {t.shippingStatus || "—"}
                              </Badge>
                            </TableCell>
                            <TableCell className="px-3 py-1.5 text-right tabular-nums">
                              {fmt(t.qty1)}
                            </TableCell>
                            <TableCell className="px-3 py-1.5 text-right tabular-nums">
                              {fmt(t.qty2)}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </section>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function SectionTitle({
  icon: Icon,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5 text-sm font-semibold">
      <Icon className="h-4 w-4 text-primary" />
      {children}
    </div>
  );
}

// =====================================================================
// VarianceCard — side-by-side from → to quantity with delta + %
// (used by the Variance Analysis section of the detail dialog).
// Positive delta = excess (emerald), negative = deficit (rose), zero = neutral.
// =====================================================================

function VarianceCard({
  label,
  from,
  to,
  variancePercent,
  hint,
}: {
  label: string;
  from: number;
  to: number;
  variancePercent: number;
  hint?: string;
}) {
  const diff = to - from;
  const isPositive = diff > 0;
  const isNegative = diff < 0;
  const colorClass = isPositive
    ? "text-emerald-600 dark:text-emerald-400"
    : isNegative
      ? "text-rose-600 dark:text-rose-400"
      : "text-muted-foreground";
  const barClass = isPositive
    ? "bg-emerald-500"
    : isNegative
      ? "bg-rose-500"
      : "bg-slate-400";
  return (
    <div className="rounded-md border bg-card p-3 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        {isPositive || isNegative ? (
          <Badge
            className={cn(
              "text-[9px]",
              isPositive
                ? "border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/50 dark:text-emerald-300"
                : "border-rose-200 bg-rose-100 text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/50 dark:text-rose-300"
            )}
          >
            {isPositive ? "EXCESS" : "DEFICIT"}
          </Badge>
        ) : null}
      </div>
      <div className="mt-2 flex items-center gap-2 text-sm">
        <span className="tabular-nums font-medium">{fmt(from)}</span>
        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="tabular-nums font-medium">{fmt(to)}</span>
      </div>
      <div className="mt-1.5 flex items-baseline gap-2">
        <span className={cn("text-sm font-semibold tabular-nums", colorClass)}>
          {formatSignedInt(diff)}
        </span>
        <span className={cn("text-xs font-medium tabular-nums", colorClass)}>
          ({formatVariancePercent(variancePercent)})
        </span>
      </div>
      {/* Proportional bar visualising the variance direction */}
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full transition-all", barClass)}
          style={{
            width: `${Math.min(100, Math.abs(Number.isFinite(variancePercent) ? variancePercent : 0))}%`,
          }}
        />
      </div>
      {hint ? (
        <div className="mt-1.5 text-[10px] text-muted-foreground">{hint}</div>
      ) : null}
    </div>
  );
}
