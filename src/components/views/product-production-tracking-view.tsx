"use client";

// =====================================================================
// ProductProductionTrackingView
// ---------------------------------------------------------------------
// Shows the Order → Output → Pending → Input production timeline and
// alert table for the currently-selected product (spec §49).
//
// All API calls are product-scoped: `api.getProductionGroups(currentProduct, …)`
// and `api.getAlerts(currentProduct, …)` — the product is mandatory and
// isolation is enforced both client-side (here) and server-side (route.ts).
// =====================================================================

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  AlertCircle,
  Activity,
  Clock,
  CheckCircle2,
  Boxes,
  Layers,
  TrendingDown,
  Search,
  Filter,
  RotateCcw,
  Loader2,
  ChevronDown,
  ChevronRight,
  Factory,
  Truck,
  PackageCheck,
  Info,
  X,
} from "lucide-react";

import { api } from "@/lib/api-client";
import { cn, formatDateDisplay } from "@/lib/utils";
import { useAppStore, PRODUCT_THEME } from "@/store/app-store";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

// =====================================================================
// Types — match the shapes returned by /api/production/groups and
// /api/production/alerts (see aggregation-service.ts).
// =====================================================================

type DeadlineStatus =
  | "OVERDUE"
  | "DUE_TODAY"
  | "DUE_TOMORROW"
  | "DUE_THIS_WEEK"
  | "UPCOMING"
  | "COMPLETED"
  | "NO_DEADLINE";

type QuantityStatus =
  | "COMPLETED"
  | "PROCESSING"
  | "WARNING"
  | "NOT_STARTED";

type AlertPriority = "HIGH" | "MEDIUM" | "LOW" | "INFO";

interface AlertInfo {
  priority: AlertPriority;
  deadlineStatus: DeadlineStatus;
  quantityStatus: QuantityStatus;
  outputRemaining: number;
  missing: number;
  messages: string[];
}

interface ProductionGroup {
  key: string;
  poNo: string;
  factoryPO: string;
  model: string;
  sku: string;
  season: string;
  colorCode: string;
  colorCode2: string;
  size: string;
  deadline: string | null;
  deadlineStatus: DeadlineStatus;
  alert: AlertInfo;
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
  quantityStatus: QuantityStatus;
  rowCount: number;
}

interface AlertsResponse {
  total: number;
  high: number;
  medium: number;
  low: number;
  alerts: ProductionGroup[];
}

interface GroupsResponse {
  total: number;
  groups: ProductionGroup[];
}

interface TrackingFilters {
  factoryPO: string;
  poNo: string;
  model: string;
  size: string;
  deadlineFrom: string;
  deadlineTo: string;
}

const EMPTY_FILTERS: TrackingFilters = {
  factoryPO: "",
  poNo: "",
  model: "",
  size: "",
  deadlineFrom: "",
  deadlineTo: "",
};

// =====================================================================
// Constants — visual mapping tables
// =====================================================================

const PRIORITY_RANK: Record<AlertPriority, number> = {
  HIGH: 0,
  MEDIUM: 1,
  LOW: 2,
  INFO: 3,
};

const PRIORITY_META: Record<
  AlertPriority,
  { dot: string; label: string; badge: string; row: string; icon: React.ComponentType<{ className?: string }> }
> = {
  HIGH: {
    dot: "🔴",
    label: "HIGH",
    badge:
      "border-rose-200 bg-rose-100 text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/50 dark:text-rose-300",
    row: "bg-rose-50/60 hover:bg-rose-50 dark:bg-rose-950/20 dark:hover:bg-rose-950/30",
    icon: AlertTriangle,
  },
  MEDIUM: {
    dot: "🟠",
    label: "MEDIUM",
    badge:
      "border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/50 dark:text-amber-300",
    row: "bg-amber-50/40 hover:bg-amber-50 dark:bg-amber-950/10 dark:hover:bg-amber-950/20",
    icon: AlertCircle,
  },
  LOW: {
    dot: "🟡",
    label: "LOW",
    badge:
      "border-yellow-200 bg-yellow-100 text-yellow-700 dark:border-yellow-900/50 dark:bg-yellow-950/50 dark:text-yellow-300",
    row: "hover:bg-muted/30",
    icon: Info,
  },
  INFO: {
    dot: "⚪",
    label: "INFO",
    badge: "border-border bg-muted text-muted-foreground",
    row: "hover:bg-muted/30",
    icon: Info,
  },
};

const DEADLINE_META: Record<DeadlineStatus, { label: string; badge: string }> = {
  OVERDUE: {
    label: "Overdue",
    badge:
      "border-rose-200 bg-rose-100 text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/50 dark:text-rose-300",
  },
  DUE_TODAY: {
    label: "Due today",
    badge:
      "border-rose-200 bg-rose-100 text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/50 dark:text-rose-300",
  },
  DUE_TOMORROW: {
    label: "Due tomorrow",
    badge:
      "border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/50 dark:text-amber-300",
  },
  DUE_THIS_WEEK: {
    label: "This week",
    badge:
      "border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/50 dark:text-amber-300",
  },
  UPCOMING: {
    label: "Upcoming",
    badge:
      "border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/50 dark:text-emerald-300",
  },
  COMPLETED: {
    label: "Completed",
    badge:
      "border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/50 dark:text-emerald-300",
  },
  NO_DEADLINE: {
    label: "No deadline",
    badge: "border-border bg-muted text-muted-foreground",
  },
};

const QTY_STATUS_META: Record<
  QuantityStatus,
  { label: string; dot: string; badge: string }
> = {
  COMPLETED: {
    label: "Completed",
    dot: "🟢",
    badge:
      "border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/50 dark:text-emerald-300",
  },
  PROCESSING: {
    label: "Processing",
    dot: "🔵",
    badge:
      "border-sky-200 bg-sky-100 text-sky-700 dark:border-sky-900/50 dark:bg-sky-950/50 dark:text-sky-300",
  },
  WARNING: {
    label: "Warning",
    dot: "🟡",
    badge:
      "border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/50 dark:text-amber-300",
  },
  NOT_STARTED: {
    label: "Not started",
    dot: "⚪",
    badge: "border-border bg-muted text-muted-foreground",
  },
};

// The four shipping statuses used by the Order → Output → Pending → Input timeline.
const SHIPPING_STATUSES = [
  {
    id: 1,
    key: "order",
    label: "1. Order",
    icon: Factory,
    desc: "Quantity ordered from the factory for outsource processing (per quarter).",
    tone: "border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300",
  },
  {
    id: 2,
    key: "output",
    label: "2. Output",
    icon: Truck,
    desc: "Quantity actually sent out to the factory for processing.",
    tone: "border-amber-300 bg-amber-100 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/50 dark:text-amber-300",
  },
  {
    id: 3,
    key: "pending",
    label: "3. Pending",
    icon: Clock,
    desc: "Mirror of Output recorded as a NEGATIVE qty (an offset, not a real order).",
    tone: "border-violet-300 bg-violet-100 text-violet-700 dark:border-violet-900/50 dark:bg-violet-950/50 dark:text-violet-300",
  },
  {
    id: 4,
    key: "input",
    label: "4. Input",
    icon: PackageCheck,
    desc: "Quantity received back from the factory after processing is complete.",
    tone: "border-emerald-300 bg-emerald-100 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/50 dark:text-emerald-300",
  },
] as const;

// =====================================================================
// Helpers
// =====================================================================

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString();
}

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

function formatDeadline(s: string | null | undefined): string {
  return formatDateDisplay(s);
}

function completionTone(rate: number): string {
  const r = clampPct(rate);
  if (r >= 95) return "text-emerald-600 dark:text-emerald-400";
  if (r >= 80) return "text-amber-600 dark:text-amber-400";
  return "text-rose-600 dark:text-rose-400";
}

function qtyCellClass(n: number, opts?: { warningZero?: boolean }): string {
  if (n === 0 && opts?.warningZero) {
    return "text-muted-foreground tabular-nums";
  }
  if (n > 0) return "tabular-nums";
  if (n < 0) return "text-amber-600 dark:text-amber-400 tabular-nums";
  return "text-muted-foreground tabular-nums";
}

// =====================================================================
// Stat card
// =====================================================================

type StatTone = "primary" | "warning" | "danger" | "info";

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
  info: {
    text: "text-sky-600 dark:text-sky-400",
    bg: "bg-sky-50 dark:bg-sky-950/40",
    ring: "ring-sky-500/20",
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

// =====================================================================
// Loading / empty helpers
// =====================================================================

function TableSkeleton({ rows = 8, cols = 12 }: { rows?: number; cols?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <TableRow key={i}>
          <TableCell colSpan={cols} className="px-3 py-3">
            <div className="h-3 w-full animate-pulse rounded bg-muted" />
          </TableCell>
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
// Small badge helpers
// =====================================================================

function PriorityBadge({ priority }: { priority: AlertPriority }) {
  const m = PRIORITY_META[priority] ?? PRIORITY_META.INFO;
  const Icon = m.icon;
  return (
    <Badge className={cn("gap-1 text-[10px]", m.badge)}>
      <span aria-hidden>{m.dot}</span>
      <Icon className="h-3 w-3" />
      {m.label}
    </Badge>
  );
}

function DeadlineBadge({ status }: { status: DeadlineStatus }) {
  const m = DEADLINE_META[status] ?? DEADLINE_META.NO_DEADLINE;
  return <Badge className={cn("text-[10px]", m.badge)}>{m.label}</Badge>;
}

function QtyStatusBadge({ status }: { status: QuantityStatus }) {
  const m = QTY_STATUS_META[status] ?? QTY_STATUS_META.NOT_STARTED;
  return (
    <Badge className={cn("gap-1 text-[10px]", m.badge)}>
      <span aria-hidden>{m.dot}</span>
      {m.label}
    </Badge>
  );
}

// =====================================================================
// Alert table row (expandable alert messages)
// =====================================================================

function AlertRow({
  group,
  expanded,
  onToggle,
}: {
  group: ProductionGroup;
  expanded: boolean;
  onToggle: () => void;
}) {
  const m = PRIORITY_META[group.alert.priority] ?? PRIORITY_META.INFO;
  const hasMessages = (group.alert.messages?.length ?? 0) > 0;
  return (
    <>
      <TableRow className={cn("border-t transition-colors", m.row)}>
        <TableCell className="px-2 py-1.5">
          {hasMessages ? (
            <button
              type="button"
              onClick={onToggle}
              aria-label={expanded ? "Collapse messages" : "Expand messages"}
              aria-expanded={expanded}
              className="flex h-6 w-6 items-center justify-center rounded hover:bg-accent"
            >
              {expanded ? (
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
              )}
            </button>
          ) : (
            <span className="block h-6 w-6" />
          )}
        </TableCell>
        <TableCell className="px-3 py-1.5">
          <PriorityBadge priority={group.alert.priority} />
        </TableCell>
        <TableCell className="px-3 py-1.5">
          <span className="font-mono text-[11px]">{group.factoryPO || "—"}</span>
        </TableCell>
        <TableCell className="max-w-[140px] truncate px-3 py-1.5" title={group.model}>
          {group.model || <span className="text-muted-foreground/40">—</span>}
        </TableCell>
        <TableCell className="px-3 py-1.5">
          {group.size ? (
            <Badge variant="outline" className="font-mono text-[10px]">
              {group.size}
            </Badge>
          ) : (
            <span className="text-muted-foreground/40">—</span>
          )}
        </TableCell>
        <TableCell className="whitespace-nowrap px-3 py-1.5 text-[11px]">
          {formatDeadline(group.deadline)}
        </TableCell>
        <TableCell className="px-3 py-1.5">
          <DeadlineBadge status={group.deadlineStatus} />
        </TableCell>
        <TableCell className="px-3 py-1.5 text-right tabular-nums">{fmt(group.orderQty)}</TableCell>
        <TableCell className="px-3 py-1.5 text-right tabular-nums">{fmt(group.outputQty)}</TableCell>
        <TableCell className="px-3 py-1.5 text-right tabular-nums">{fmt(group.inputQty)}</TableCell>
        <TableCell
          className={cn(
            "px-3 py-1.5 text-right",
            group.processing > 0
              ? "text-amber-600 dark:text-amber-400 tabular-nums"
              : "text-muted-foreground tabular-nums"
          )}
        >
          {fmt(group.processing)}
        </TableCell>
        <TableCell
          className={cn(
            "px-3 py-1.5 text-right font-medium",
            group.missing > 0
              ? "text-rose-600 dark:text-rose-400 tabular-nums"
              : "text-muted-foreground tabular-nums"
          )}
        >
          {fmt(group.missing)}
        </TableCell>
        <TableCell
          className={cn("px-3 py-1.5 text-right font-medium tabular-nums", completionTone(group.completionRate))}
        >
          {clampPct(group.completionRate).toFixed(1)}%
        </TableCell>
      </TableRow>
      {hasMessages && expanded && (
        <TableRow className={cn("border-t", m.row)}>
          <TableCell colSpan={13} className="px-6 py-3">
            <div className="rounded-md border border-border/60 bg-background/80 p-3">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-medium">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                {group.alert.messages.length} alert message
                {group.alert.messages.length === 1 ? "" : "s"}
              </div>
              <ul className="space-y-1">
                {group.alert.messages.map((msg, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 text-[11px] text-foreground/80"
                  >
                    <span className="mt-0.5 text-muted-foreground">•</span>
                    <span className="break-words whitespace-pre-wrap">{msg}</span>
                  </li>
                ))}
              </ul>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

// =====================================================================
// Production group row (expandable Order→Output→Pending→Input timeline)
// =====================================================================

function ProductionGroupRow({
  group,
  expanded,
  onToggle,
}: {
  group: ProductionGroup;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <TableRow
        className={cn(
          "border-t transition-colors hover:bg-muted/40",
          group.alert.priority === "HIGH" &&
            "bg-rose-50/40 dark:bg-rose-950/10",
          group.alert.priority === "MEDIUM" &&
            "bg-amber-50/30 dark:bg-amber-950/10"
        )}
      >
        <TableCell className="px-2 py-1.5">
          <button
            type="button"
            onClick={onToggle}
            aria-label={expanded ? "Collapse timeline" : "Expand timeline"}
            aria-expanded={expanded}
            className="flex h-6 w-6 items-center justify-center rounded hover:bg-accent"
          >
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            )}
          </button>
        </TableCell>
        <TableCell className="whitespace-nowrap px-3 py-1.5 font-medium text-primary">
          {group.poNo || "—"}
        </TableCell>
        <TableCell className="whitespace-nowrap px-3 py-1.5">
          <span className="font-mono text-[11px]">{group.factoryPO || "—"}</span>
        </TableCell>
        <TableCell className="max-w-[140px] truncate px-3 py-1.5" title={group.model}>
          {group.model || <span className="text-muted-foreground/40">—</span>}
        </TableCell>
        <TableCell className="px-3 py-1.5">
          {group.size ? (
            <Badge variant="outline" className="font-mono text-[10px]">
              {group.size}
            </Badge>
          ) : (
            <span className="text-muted-foreground/40">—</span>
          )}
        </TableCell>
        <TableCell className="px-3 py-1.5 text-[11px]">
          {group.colorCode ? (
            <span title={group.colorCode} className="block max-w-[120px] truncate">
              {group.colorCode}
            </span>
          ) : (
            <span className="text-muted-foreground/40">—</span>
          )}
        </TableCell>
        <TableCell className="px-3 py-1.5 text-right tabular-nums">{fmt(group.orderQty)}</TableCell>
        <TableCell className="px-3 py-1.5 text-right tabular-nums">{fmt(group.outputQty)}</TableCell>
        <TableCell
          className={cn(
            "px-3 py-1.5 text-right",
            group.pendingQty < 0
              ? "text-violet-600 dark:text-violet-400 tabular-nums"
              : "text-muted-foreground tabular-nums"
          )}
        >
          {fmt(group.pendingQty)}
        </TableCell>
        <TableCell className="px-3 py-1.5 text-right tabular-nums">{fmt(group.inputQty)}</TableCell>
        <TableCell
          className={cn(
            "px-3 py-1.5 text-right",
            qtyCellClass(group.processing)
          )}
        >
          {fmt(group.processing)}
        </TableCell>
        <TableCell className={cn("px-3 py-1.5 text-right", qtyCellClass(group.outputRemaining))}>
          {fmt(group.outputRemaining)}
        </TableCell>
        <TableCell className={cn("px-3 py-1.5 text-right", qtyCellClass(group.inputRemaining))}>
          {fmt(group.inputRemaining)}
        </TableCell>
        <TableCell
          className={cn("px-3 py-1.5 text-right tabular-nums", completionTone(group.outputRate))}
        >
          {clampPct(group.outputRate).toFixed(1)}%
        </TableCell>
        <TableCell
          className={cn(
            "px-3 py-1.5 text-right font-medium tabular-nums",
            completionTone(group.completionRate)
          )}
        >
          {clampPct(group.completionRate).toFixed(1)}%
        </TableCell>
        <TableCell className="whitespace-nowrap px-3 py-1.5 text-[11px]">
          {formatDeadline(group.deadline)}
        </TableCell>
        <TableCell className="px-3 py-1.5">
          <QtyStatusBadge status={group.quantityStatus} />
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow className="border-t bg-muted/20">
          <TableCell colSpan={18} className="px-4 py-4">
            <GroupTimeline group={group} />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

// =====================================================================
// Group timeline — the four-stage Order → Output → Pending → Input
// flow with quantities, rates, and remaining counters.
// =====================================================================

function GroupTimeline({ group }: { group: ProductionGroup }) {
  const stages = [
    {
      key: "order",
      label: "1. Order",
      icon: Factory,
      tone:
        "border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300",
      qty: group.orderQty,
      rate: 100,
      remaining: null as number | null,
      remainingLabel: "Demand",
      desc: "Quantity ordered from the factory.",
    },
    {
      key: "output",
      label: "2. Output",
      icon: Truck,
      tone:
        "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300",
      qty: group.outputQty,
      rate: group.outputRate,
      remaining: group.outputRemaining,
      remainingLabel: "Remaining to output",
      desc: "Quantity actually sent out for processing.",
    },
    {
      key: "pending",
      label: "3. Pending",
      icon: Clock,
      tone:
        "border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-900/50 dark:bg-violet-950/40 dark:text-violet-300",
      qty: group.pendingQty,
      rate: group.processingRate,
      remaining: group.processing,
      remainingLabel: "In processing",
      desc: "Offset entry (negative). Processing = Output − Input.",
    },
    {
      key: "input",
      label: "4. Input",
      icon: PackageCheck,
      tone:
        "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300",
      qty: group.inputQty,
      rate: group.completionRate,
      remaining: group.inputRemaining,
      remainingLabel: "Missing",
      desc: "Quantity received back from factory.",
    },
  ];

  return (
    <div className="rounded-lg border border-border/60 bg-background/80 p-4">
      {/* Heading row */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[11px] font-semibold">{group.factoryPO}</span>
          <Badge variant="outline" className="font-mono text-[10px]">
            {group.size}
          </Badge>
          {group.model ? (
            <span className="text-[11px] text-muted-foreground">{group.model}</span>
          ) : null}
          <span className="text-[11px] text-muted-foreground">·</span>
          <span className="text-[11px] text-muted-foreground">
            PO {group.poNo || "—"}
          </span>
          <span className="text-[11px] text-muted-foreground">·</span>
          <span className="text-[11px] text-muted-foreground">
            Deadline {formatDeadline(group.deadline)}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <DeadlineBadge status={group.deadlineStatus} />
          <QtyStatusBadge status={group.quantityStatus} />
          <PriorityBadge priority={group.alert.priority} />
          <Badge variant="secondary" className="text-[10px]">
            {group.rowCount} row{group.rowCount === 1 ? "" : "s"}
          </Badge>
        </div>
      </div>

      {/* Stage pipeline */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {stages.map((s, idx) => {
          const Icon = s.icon;
          return (
            <div
              key={s.key}
              className={cn("relative rounded-lg border p-3", s.tone)}
            >
              {/* Arrow connector (hidden on small screens) */}
              {idx < stages.length - 1 ? (
                <div
                  aria-hidden
                  className="absolute -right-3 top-1/2 hidden -translate-y-1/2 lg:block"
                >
                  <ChevronRight className="h-4 w-4 text-muted-foreground/60" />
                </div>
              ) : null}
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-md bg-background/60">
                  <Icon className="h-3.5 w-3.5" />
                </div>
                <div className="text-[11px] font-semibold">{s.label}</div>
              </div>
              <div className="mt-2 text-2xl font-bold tabular-nums">{fmt(s.qty)}</div>
              <div className="mt-1 flex items-center justify-between text-[10px]">
                <span className="opacity-70">{s.desc}</span>
              </div>
              {/* Progress bar */}
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-background/40">
                <div
                  className="h-full rounded-full bg-current opacity-70"
                  style={{ width: `${clampPct(s.rate)}%` }}
                />
              </div>
              <div className="mt-1.5 flex items-center justify-between text-[10px]">
                <span className="opacity-70">{clampPct(s.rate).toFixed(1)}% of order</span>
                {s.remaining !== null ? (
                  <span className="font-medium">
                    {s.remainingLabel}: {fmt(s.remaining)}
                  </span>
                ) : (
                  <span className="opacity-70">Baseline</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Inline alert messages, if any */}
      {group.alert.messages.length > 0 ? (
        <div className="mt-3 rounded-md border border-amber-300/40 bg-amber-50/60 p-2.5 dark:border-amber-900/40 dark:bg-amber-950/20">
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
            <AlertTriangle className="h-3.5 w-3.5" />
            Alert messages ({group.alert.messages.length})
          </div>
          <ul className="space-y-1">
            {group.alert.messages.map((msg, i) => (
              <li key={i} className="flex items-start gap-1.5 text-[11px] text-foreground/80">
                <span className="mt-0.5 text-amber-500">•</span>
                <span className="break-words whitespace-pre-wrap">{msg}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

// =====================================================================
// Status legend
// =====================================================================

function StatusLegend() {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Info className="h-4 w-4 text-primary" /> Status Legend
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Shipping statuses (the 4-stage flow) */}
        <div>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Shipping Statuses (production timeline)
          </div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {SHIPPING_STATUSES.map((s) => {
              const Icon = s.icon;
              return (
                <div
                  key={s.key}
                  className={cn("flex items-start gap-2 rounded-md border p-2", s.tone)}
                >
                  <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold">{s.label}</div>
                    <div className="text-[10px] leading-snug opacity-80">{s.desc}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Deadline statuses */}
        <div>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Deadline Statuses
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(DEADLINE_META) as DeadlineStatus[]).map((k) => (
              <Badge key={k} className={cn("text-[10px]", DEADLINE_META[k].badge)}>
                {DEADLINE_META[k].label}
              </Badge>
            ))}
          </div>
          <p className="mt-1.5 text-[10px] leading-snug text-muted-foreground">
            Computed relative to today. <strong>Overdue</strong> and <strong>Due today</strong> are
            high-urgency; <strong>Due tomorrow</strong> and <strong>This week</strong> are medium;
            <strong> Upcoming</strong> is low. <strong>Completed</strong> overrides deadline
            urgency; <strong>No deadline</strong> means the master row has no Dead Line value.
          </p>
        </div>

        {/* Quantity statuses */}
        <div>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Quantity Statuses
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(QTY_STATUS_META) as QuantityStatus[]).map((k) => (
              <Badge key={k} className={cn("gap-1 text-[10px]", QTY_STATUS_META[k].badge)}>
                <span aria-hidden>{QTY_STATUS_META[k].dot}</span>
                {QTY_STATUS_META[k].label}
              </Badge>
            ))}
          </div>
          <p className="mt-1.5 text-[10px] leading-snug text-muted-foreground">
            <strong>Completed</strong> (🟢): Input ≥ Order and Output ≥ Order.{" "}
            <strong>Processing</strong> (🔵): some Output or Input recorded but not yet complete.{" "}
            <strong>Warning</strong> (🟡): Order exists but nothing has been sent yet.{" "}
            <strong>Not started</strong>: no Order quantity recorded.
          </p>
        </div>

        {/* Priority badges */}
        <div>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Alert Priorities
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(PRIORITY_META) as AlertPriority[]).map((k) => (
              <PriorityBadge key={k} priority={k} />
            ))}
          </div>
          <p className="mt-1.5 text-[10px] leading-snug text-muted-foreground">
            <strong>HIGH</strong> = overdue with missing units, or due-today with output shortage.{" "}
            <strong>MEDIUM</strong> = due-soon or output shortage. <strong>LOW</strong> = completed
            but listed for visibility. <strong>INFO</strong> = no issue.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// =====================================================================
// Main view
// =====================================================================

export function ProductProductionTrackingView() {
  const { currentProduct, refreshKey, bumpRefresh } = useAppStore();
  const theme = PRODUCT_THEME[currentProduct];

  // Filters — `form` is what the user types; `applied` is what we query with.
  const [form, setForm] = React.useState<TrackingFilters>(EMPTY_FILTERS);
  const [applied, setApplied] = React.useState<TrackingFilters>(EMPTY_FILTERS);
  const [expandedAlerts, setExpandedAlerts] = React.useState<Set<string>>(new Set());
  const [expandedGroups, setExpandedGroups] = React.useState<Set<string>>(new Set());

  // ===== Client-side pagination for groups & alerts tables =====
  const [groupPage, setGroupPage] = React.useState(1);
  const [alertPage, setAlertPage] = React.useState(1);
  const GROUP_PAGE_SIZE = 20;
  const ALERT_PAGE_SIZE = 20;

  // Build the filter map passed to the API. We always pass currentProduct
  // as the first argument (mandatory) and only forward non-empty filter
  // values as additional query params.
  const filterParams = React.useMemo(() => {
    const p: Record<string, string> = {};
    if (applied.factoryPO) p.factoryPO = applied.factoryPO;
    if (applied.poNo) p.poNo = applied.poNo;
    if (applied.model) p.model = applied.model;
    if (applied.size) p.size = applied.size;
    if (applied.deadlineFrom) p.dateFrom = applied.deadlineFrom;
    if (applied.deadlineTo) p.dateTo = applied.deadlineTo;
    return p;
  }, [applied]);

  // Sort & limit the alert payload — the API returns up to `limit` items
  // already sorted by priority then deadline, but we re-sort defensively
  // in case the server changes.
  const alertsQuery = useQuery({
    queryKey: ["production-alerts", currentProduct, filterParams, refreshKey],
    queryFn: () => api.getAlerts(currentProduct, 30),
    enabled: Boolean(currentProduct),
    staleTime: 30_000,
  });

  const groupsQuery = useQuery({
    queryKey: ["production-groups", currentProduct, filterParams, refreshKey],
    queryFn: () => api.getProductionGroups(currentProduct, filterParams),
    enabled: Boolean(currentProduct),
    staleTime: 30_000,
  });

  const alertsData: AlertsResponse | undefined = alertsQuery.data as
    | AlertsResponse
    | undefined;
  const groupsData: GroupsResponse | undefined = groupsQuery.data as
    | GroupsResponse
    | undefined;

  // Defensive sort: priority asc, then deadline asc (missing deadline last).
  const sortedAlerts = React.useMemo(() => {
    const arr = (alertsData?.alerts ?? []).slice();
    arr.sort((a, b) => {
      const p =
        PRIORITY_RANK[a.alert.priority] - PRIORITY_RANK[b.alert.priority];
      if (p !== 0) return p;
      return (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999");
    });
    return arr;
  }, [alertsData?.alerts]);

  // Sorted production groups — preserve server order (already by nearest
  // deadline asc) but bump HIGH-priority rows to the top on the client for
  // visibility, then keep deadline order otherwise.
  const sortedGroups = React.useMemo(() => {
    const arr = (groupsData?.groups ?? []).slice();
    arr.sort((a, b) => {
      const pa = PRIORITY_RANK[a.alert.priority];
      const pb = PRIORITY_RANK[b.alert.priority];
      if (pa !== pb) return pa - pb;
      return (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999");
    });
    return arr;
  }, [groupsData?.groups]);

  // Summary totals (computed across all returned groups — server-side
  // pagination limit is 5000 so this is a representative sample).
  const totals = React.useMemo(() => {
    const gs = groupsData?.groups ?? [];
    let totalOrders = 0;
    let totalProcessing = 0;
    let totalMissing = 0;
    for (const g of gs) {
      totalOrders += g.orderQty || 0;
      totalProcessing += g.processing || 0;
      totalMissing += g.missing || 0;
    }
    return { totalOrders, totalProcessing, totalMissing };
  }, [groupsData?.groups]);

  const highAlerts = alertsData?.high ?? 0;
  const isLoading = groupsQuery.isLoading || alertsQuery.isLoading;
  const isFetching = groupsQuery.isFetching || alertsQuery.isFetching;
  const isError = groupsQuery.isError || alertsQuery.isError;
  const hasFilters = Object.values(applied).some(Boolean);

  // ===== Paged slices for the two tables =====
  const groupTotalPages = Math.max(1, Math.ceil(sortedGroups.length / GROUP_PAGE_SIZE));
  const alertTotalPages = Math.max(1, Math.ceil(sortedAlerts.length / ALERT_PAGE_SIZE));
  const pagedGroups = sortedGroups.slice(
    (groupPage - 1) * GROUP_PAGE_SIZE,
    groupPage * GROUP_PAGE_SIZE
  );
  const pagedAlerts = sortedAlerts.slice(
    (alertPage - 1) * ALERT_PAGE_SIZE,
    alertPage * ALERT_PAGE_SIZE
  );

  // Reset both pages to 1 when the product context changes (currentProduct
  // or refreshKey) so a stale page index never points past the end.
  React.useEffect(() => {
    setGroupPage(1);
    setAlertPage(1);
  }, [currentProduct, refreshKey]);

  function applyFilters() {
    setApplied(form);
    setExpandedAlerts(new Set());
    setExpandedGroups(new Set());
    setGroupPage(1);
    setAlertPage(1);
  }

  function resetFilters() {
    setForm(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    setExpandedAlerts(new Set());
    setExpandedGroups(new Set());
    setGroupPage(1);
    setAlertPage(1);
  }

  function toggleAlert(key: string) {
    setExpandedAlerts((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleGroup(key: string) {
    setExpandedGroups((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function expandAllGroups() {
    setExpandedGroups(new Set(sortedGroups.map((g) => g.key)));
  }

  function collapseAllGroups() {
    setExpandedGroups(new Set());
  }

  const productLabel = theme.label;

  return (
    <div className="space-y-5">
      {/* ---------------- Header ---------------- */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold tracking-tight">Production Tracking</h1>
          <Badge className={cn("gap-1 text-[10px]", theme.badge)}>
            <Factory className="h-3 w-3" />
            {productLabel}
          </Badge>
          {isFetching && !isLoading ? (
            <Badge variant="secondary" className="text-[10px]">
              <Loader2 className="h-3 w-3 animate-spin" />
              refreshing
            </Badge>
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground">
          Order → Output → Pending → Input production timeline and prioritized alerts for{" "}
          <strong>{productLabel}</strong>.
        </p>
      </div>

      {/* ---------------- Filter bar ---------------- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Filter className="h-4 w-4 text-primary" /> Filters
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3 lg:grid-cols-6">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="pt-factory-po">
                Factory PO
              </label>
              <Input
                id="pt-factory-po"
                value={form.factoryPO}
                onChange={(e) => setForm((f) => ({ ...f, factoryPO: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") applyFilters();
                }}
                placeholder="e.g. MH26110228"
                className="h-9"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="pt-po-no">
                PO NO#
              </label>
              <Input
                id="pt-po-no"
                value={form.poNo}
                onChange={(e) => setForm((f) => ({ ...f, poNo: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") applyFilters();
                }}
                placeholder="e.g. H411351070"
                className="h-9"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="pt-model">
                Model
              </label>
              <Input
                id="pt-model"
                value={form.model}
                onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") applyFilters();
                }}
                placeholder="e.g. MAFATE5 MS"
                className="h-9"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="pt-size">
                Size
              </label>
              <Input
                id="pt-size"
                value={form.size}
                onChange={(e) => setForm((f) => ({ ...f, size: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") applyFilters();
                }}
                placeholder="e.g. M(07)"
                className="h-9"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="pt-deadline-from">
                Deadline From
              </label>
              <Input
                id="pt-deadline-from"
                type="date"
                value={form.deadlineFrom}
                onChange={(e) => setForm((f) => ({ ...f, deadlineFrom: e.target.value }))}
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="pt-deadline-to">
                Deadline To
              </label>
              <Input
                id="pt-deadline-to"
                type="date"
                value={form.deadlineTo}
                onChange={(e) => setForm((f) => ({ ...f, deadlineTo: e.target.value }))}
                className="h-9"
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={applyFilters} disabled={isLoading}>
              <Search className="mr-1.5 h-3.5 w-3.5" /> Apply
            </Button>
            <Button size="sm" variant="outline" onClick={resetFilters} disabled={isLoading}>
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Reset
            </Button>
            <Button size="sm" variant="ghost" onClick={bumpRefresh} disabled={isLoading}>
              <Loader2 className={cn("mr-1.5 h-3.5 w-3.5", isFetching && "animate-spin")} />
              Refresh
            </Button>
            {hasFilters ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-muted-foreground">Active:</span>
                {Object.entries(applied).map(([k, v]) =>
                  v ? (
                    <Badge key={k} variant="secondary" className="gap-1 text-[10px]">
                      {k}: {v}
                      <button
                        type="button"
                        onClick={() => {
                          setForm((f) => ({ ...f, [k]: "" }));
                          setApplied((a) => ({ ...a, [k]: "" }));
                        }}
                        className="ml-0.5 rounded-sm hover:bg-accent"
                        aria-label={`Clear ${k} filter`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ) : null
                )}
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {/* ---------------- Error ---------------- */}
      {isError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Failed to load production tracking data</AlertTitle>
          <AlertDescription>
            {(groupsQuery.error || alertsQuery.error) instanceof Error
              ? ((groupsQuery.error || alertsQuery.error) as Error).message
              : "Unknown error."}{" "}
            <button
              type="button"
              onClick={() => {
                groupsQuery.refetch();
                alertsQuery.refetch();
              }}
              className="underline underline-offset-2 hover:opacity-80"
            >
              Try again
            </button>
          </AlertDescription>
        </Alert>
      ) : null}

      {/* ---------------- Summary stat cards ---------------- */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Total Orders"
          value={fmt(totals.totalOrders)}
          icon={Boxes}
          tone="primary"
          loading={isLoading}
          sub={
            <span>
              {groupsData?.total ?? 0} group{(groupsData?.total ?? 0) === 1 ? "" : "s"}
            </span>
          }
        />
        <StatCard
          label="Total Processing"
          value={fmt(totals.totalProcessing)}
          icon={Activity}
          tone="info"
          loading={isLoading}
          sub={<span>Output − Input (in-flight)</span>}
        />
        <StatCard
          label="Total Missing"
          value={fmt(totals.totalMissing)}
          icon={TrendingDown}
          tone="danger"
          loading={isLoading}
          sub={<span>Order − Input (not yet received)</span>}
        />
        <StatCard
          label="High Priority Alerts"
          value={fmt(highAlerts)}
          icon={AlertTriangle}
          tone="danger"
          loading={isLoading}
          sub={
            <span>
              {alertsData?.total ?? 0} total alert{(alertsData?.total ?? 0) === 1 ? "" : "s"}
            </span>
          }
        />
      </div>

      {/* ---------------- Alert table ---------------- */}
      <Card>
        <CardContent className="p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
            <div className="flex items-center gap-2 text-sm">
              <AlertTriangle className="h-4 w-4 text-rose-500" />
              <span className="font-medium">Priority Alerts</span>
              <Badge variant="outline" className="text-[10px]">
                {sortedAlerts.length} of {alertsData?.total ?? 0}
              </Badge>
              {highAlerts > 0 ? (
                <Badge
                  variant="outline"
                  className="border-rose-300 bg-rose-50 text-[10px] text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300"
                >
                  {highAlerts} high
                </Badge>
              ) : null}
            </div>
            <span className="hidden text-[11px] text-muted-foreground md:inline">
              Sorted by priority then deadline (soonest first)
            </span>
          </div>
          <div className="overflow-x-auto scroll-thin">
            <Table className="text-xs">
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead className="w-8 px-2 py-2" />
                  <TableHead className="whitespace-nowrap px-3 py-2 text-[10px] font-semibold uppercase text-muted-foreground">
                    Priority
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
                  <TableHead className="whitespace-nowrap px-3 py-2 text-[10px] font-semibold uppercase text-muted-foreground">
                    Deadline
                  </TableHead>
                  <TableHead className="whitespace-nowrap px-3 py-2 text-[10px] font-semibold uppercase text-muted-foreground">
                    Deadline Status
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
                    Processing
                  </TableHead>
                  <TableHead className="whitespace-nowrap px-3 py-2 text-right text-[10px] font-semibold uppercase text-muted-foreground">
                    Missing
                  </TableHead>
                  <TableHead className="whitespace-nowrap px-3 py-2 text-right text-[10px] font-semibold uppercase text-muted-foreground">
                    Completion%
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {alertsQuery.isLoading ? (
                  <TableSkeleton rows={6} cols={13} />
                ) : sortedAlerts.length === 0 ? (
                  <EmptyRow
                    colSpan={13}
                    message="No alerts"
                    hint="All production groups for this product are on-track given the current filters."
                    icon={CheckCircle2}
                  />
                ) : (
                  pagedAlerts.map((g) => (
                    <AlertRow
                      key={g.key}
                      group={g}
                      expanded={expandedAlerts.has(g.key)}
                      onToggle={() => toggleAlert(g.key)}
                    />
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          {sortedAlerts.length > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2">
              <span className="text-xs text-muted-foreground">
                Page {alertPage} of {alertTotalPages} ({sortedAlerts.length} alerts)
              </span>
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={alertPage <= 1}
                  onClick={() => setAlertPage((p) => Math.max(1, p - 1))}
                >
                  Prev
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={alertPage >= alertTotalPages}
                  onClick={() => setAlertPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* ---------------- Production groups table ---------------- */}
      <Card>
        <CardContent className="p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
            <div className="flex items-center gap-2 text-sm">
              <Layers className="h-4 w-4 text-primary" />
              <span className="font-medium">Production Groups</span>
              <Badge variant="outline" className="text-[10px]">
                {sortedGroups.length} group{sortedGroups.length === 1 ? "" : "s"}
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={expandAllGroups}
                disabled={sortedGroups.length === 0}
                className="h-8 text-[11px]"
              >
                <ChevronDown className="mr-1 h-3 w-3" /> Expand all
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={collapseAllGroups}
                disabled={expandedGroups.size === 0}
                className="h-8 text-[11px]"
              >
                <ChevronRight className="mr-1 h-3 w-3" /> Collapse all
              </Button>
            </div>
          </div>
          <div className="overflow-x-auto scroll-thin">
            <Table className="text-xs">
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead className="w-8 px-2 py-2" />
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
                  <TableHead className="whitespace-nowrap px-3 py-2 text-[10px] font-semibold uppercase text-muted-foreground">
                    Color
                  </TableHead>
                  <TableHead className="whitespace-nowrap px-3 py-2 text-right text-[10px] font-semibold uppercase text-muted-foreground">
                    Order
                  </TableHead>
                  <TableHead className="whitespace-nowrap px-3 py-2 text-right text-[10px] font-semibold uppercase text-muted-foreground">
                    Output
                  </TableHead>
                  <TableHead className="whitespace-nowrap px-3 py-2 text-right text-[10px] font-semibold uppercase text-muted-foreground">
                    Pending
                  </TableHead>
                  <TableHead className="whitespace-nowrap px-3 py-2 text-right text-[10px] font-semibold uppercase text-muted-foreground">
                    Input
                  </TableHead>
                  <TableHead className="whitespace-nowrap px-3 py-2 text-right text-[10px] font-semibold uppercase text-muted-foreground">
                    Processing
                  </TableHead>
                  <TableHead className="whitespace-nowrap px-3 py-2 text-right text-[10px] font-semibold uppercase text-muted-foreground">
                    Output Rem.
                  </TableHead>
                  <TableHead className="whitespace-nowrap px-3 py-2 text-right text-[10px] font-semibold uppercase text-muted-foreground">
                    Input Rem.
                  </TableHead>
                  <TableHead className="whitespace-nowrap px-3 py-2 text-right text-[10px] font-semibold uppercase text-muted-foreground">
                    Output%
                  </TableHead>
                  <TableHead className="whitespace-nowrap px-3 py-2 text-right text-[10px] font-semibold uppercase text-muted-foreground">
                    Completion%
                  </TableHead>
                  <TableHead className="whitespace-nowrap px-3 py-2 text-[10px] font-semibold uppercase text-muted-foreground">
                    Deadline
                  </TableHead>
                  <TableHead className="whitespace-nowrap px-3 py-2 text-[10px] font-semibold uppercase text-muted-foreground">
                    Qty Status
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groupsQuery.isLoading ? (
                  <TableSkeleton rows={8} cols={18} />
                ) : sortedGroups.length === 0 ? (
                  <EmptyRow
                    colSpan={18}
                    message="No production groups"
                    hint={`No ${productLabel} production data matches the current filters. Try resetting the filters or import more data.`}
                    icon={Factory}
                  />
                ) : (
                  pagedGroups.map((g) => (
                    <ProductionGroupRow
                      key={g.key}
                      group={g}
                      expanded={expandedGroups.has(g.key)}
                      onToggle={() => toggleGroup(g.key)}
                    />
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          {sortedGroups.length > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2">
              <span className="text-xs text-muted-foreground">
                Page {groupPage} of {groupTotalPages} ({sortedGroups.length} groups)
              </span>
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={groupPage <= 1}
                  onClick={() => setGroupPage((p) => Math.max(1, p - 1))}
                >
                  Prev
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={groupPage >= groupTotalPages}
                  onClick={() => setGroupPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          ) : null}
          {sortedGroups.length > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2 text-[11px] text-muted-foreground">
              <span>
                Showing {pagedGroups.length} of {groupsData?.total ?? sortedGroups.length} groups
              </span>
              <span className="tabular-nums">
                Order {fmt(totals.totalOrders)} · Missing {fmt(totals.totalMissing)} · Processing{" "}
                {fmt(totals.totalProcessing)}
              </span>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* ---------------- Status legend ---------------- */}
      <StatusLegend />
    </div>
  );
}

export default ProductProductionTrackingView;
