"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Search,
  Filter,
  TrendingDown,
  RotateCcw,
  ChevronDown,
  ChevronRight,
  PackageCheck,
  Layers,
  XCircle,
  Factory,
} from "lucide-react";
import { api } from "@/lib/api-client";
import type { QtyValidationGroup } from "@/types";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// Product type options. Empty string ("all" sentinel) means "no filter".
const PRODUCT_TYPES = ["Mafate", "Onyx", "Hoong Won"] as const;
const ALL_PRODUCT_TYPES = "all";

interface ValidationFilters {
  factoryPO: string;
  poNo: string;
  productType: string;
}

const EMPTY_FILTERS: ValidationFilters = {
  factoryPO: "",
  poNo: "",
  productType: "",
};

/**
 * QuantityValidationView
 *
 * Displays quantity validation results grouped by (poNo + factoryPO + size).
 * Each group compares Order / Output / Input quantities and flags any
 * mismatch as inconsistent with a list of human-readable errors.
 */
export function QuantityValidationView() {
  const [form, setForm] = React.useState<ValidationFilters>(EMPTY_FILTERS);
  const [applied, setApplied] = React.useState<ValidationFilters>(EMPTY_FILTERS);
  const [expandedRows, setExpandedRows] = React.useState<Set<string>>(new Set());

  // ===== Client-side pagination for the validation table =====
  const [valPage, setValPage] = React.useState(1);
  const VAL_PAGE_SIZE = 20;

  const q = useQuery({
    queryKey: ["quantity-validation", applied],
    queryFn: () => api.validateQuantities(applied),
  });

  function applyFilters() {
    setApplied(form);
    setExpandedRows(new Set());
    setValPage(1);
  }

  function resetFilters() {
    setForm(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    setExpandedRows(new Set());
    setValPage(1);
  }

  function toggleRow(key: string) {
    setExpandedRows((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const data = q.data;
  const groups = data?.groups ?? [];
  const pagedGroups = groups.slice(
    (valPage - 1) * VAL_PAGE_SIZE,
    valPage * VAL_PAGE_SIZE
  );
  const valTotalPages = Math.max(1, Math.ceil(groups.length / VAL_PAGE_SIZE));
  const stats = {
    total: data?.total ?? 0,
    inconsistent: data?.inconsistent ?? 0,
    consistent: data?.consistent ?? 0,
    totalMissing: data?.totalMissing ?? 0,
  };

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Filter className="h-4 w-4 text-primary" /> Filters
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="qv-factory-po">
                Factory PO
              </label>
              <Input
                id="qv-factory-po"
                value={form.factoryPO}
                onChange={(e) => setForm((f) => ({ ...f, factoryPO: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") applyFilters();
                }}
                placeholder="e.g. MH26110228"
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="qv-po-no">
                PO NO#
              </label>
              <Input
                id="qv-po-no"
                value={form.poNo}
                onChange={(e) => setForm((f) => ({ ...f, poNo: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") applyFilters();
                }}
                placeholder="e.g. H411351070"
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="qv-product-type">
                Product Type
              </label>
              <Select
                    value={form.productType || ALL_PRODUCT_TYPES}
                    onValueChange={(v) =>
                      setForm((f) => ({
                        ...f,
                        productType: v === ALL_PRODUCT_TYPES ? "" : v,
                      }))
                    }
              >
                <SelectTrigger id="qv-product-type" className="h-9 w-full">
                  <SelectValue placeholder="All product types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_PRODUCT_TYPES}>All product types</SelectItem>
                  {PRODUCT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={applyFilters}>
              <Search className="mr-1.5 h-4 w-4" /> Apply
            </Button>
            <Button size="sm" variant="outline" onClick={resetFilters}>
              <RotateCcw className="mr-1.5 h-4 w-4" /> Reset
            </Button>
            {q.isFetching && !q.isLoading && (
              <Badge variant="secondary" className="text-[10px]">
                refreshing…
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Summary stat cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Total Groups"
          value={stats.total}
          icon={Layers}
          tone="primary"
          loading={q.isLoading}
        />
        <StatCard
          label="Inconsistent"
          value={stats.inconsistent}
          icon={AlertTriangle}
          tone="danger"
          loading={q.isLoading}
        />
        <StatCard
          label="Consistent"
          value={stats.consistent}
          icon={CheckCircle2}
          tone="success"
          loading={q.isLoading}
        />
        <StatCard
          label="Missing Units"
          value={stats.totalMissing}
          icon={TrendingDown}
          tone="warning"
          loading={q.isLoading}
        />
      </div>

      {/* Validation table */}
      <Card>
        <CardContent className="p-0">
          <div className="flex items-center justify-between border-b px-4 py-2.5">
            <div className="flex items-center gap-2 text-sm">
              <PackageCheck className="h-4 w-4 text-primary" />
              <span className="font-medium">{groups.length}</span>
              <span className="text-muted-foreground">groups</span>
              {stats.inconsistent > 0 && (
                <Badge
                  variant="outline"
                  className="bg-red-50 text-[10px] text-red-700 dark:bg-red-950/40 dark:text-red-300"
                >
                  {stats.inconsistent} flagged
                </Badge>
              )}
            </div>
            <span className="hidden text-[11px] text-muted-foreground sm:inline">
              Order = Output = Input → consistent
            </span>
          </div>

          <div className="overflow-x-auto scroll-thin">
            <table className="w-full text-xs">
              <thead className="bg-muted/40">
                <tr>
                  <th className="w-8 px-2 py-2"></th>
                  <th className="whitespace-nowrap px-3 py-2 text-left text-[10px] font-semibold uppercase text-muted-foreground">
                    PO NO#
                  </th>
                  <th className="whitespace-nowrap px-3 py-2 text-left text-[10px] font-semibold uppercase text-muted-foreground">
                    Factory PO
                  </th>
                  <th className="whitespace-nowrap px-3 py-2 text-left text-[10px] font-semibold uppercase text-muted-foreground">
                    Size
                  </th>
                  <th className="whitespace-nowrap px-3 py-2 text-left text-[10px] font-semibold uppercase text-muted-foreground">
                    Model
                  </th>
                  <th className="whitespace-nowrap px-3 py-2 text-left text-[10px] font-semibold uppercase text-muted-foreground">
                    Type
                  </th>
                  <th className="whitespace-nowrap px-3 py-2 text-right text-[10px] font-semibold uppercase text-muted-foreground">
                    Order
                  </th>
                  <th className="whitespace-nowrap px-3 py-2 text-right text-[10px] font-semibold uppercase text-muted-foreground">
                    Output
                  </th>
                  <th className="whitespace-nowrap px-3 py-2 text-right text-[10px] font-semibold uppercase text-muted-foreground">
                    Input
                  </th>
                  <th className="whitespace-nowrap px-3 py-2 text-right text-[10px] font-semibold uppercase text-muted-foreground">
                    Pending
                  </th>
                  <th className="whitespace-nowrap px-3 py-2 text-right text-[10px] font-semibold uppercase text-muted-foreground">
                    Missing
                  </th>
                  <th className="whitespace-nowrap px-3 py-2 text-center text-[10px] font-semibold uppercase text-muted-foreground">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {q.isLoading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i} className="border-t">
                      <td colSpan={12} className="px-3 py-3">
                        <div className="h-3 w-full animate-pulse rounded bg-muted" />
                      </td>
                    </tr>
                  ))
                ) : q.isError ? (
                  <tr>
                    <td colSpan={12} className="px-3 py-10">
                      <div className="flex flex-col items-center justify-center gap-2 text-center">
                        <AlertCircle className="h-8 w-8 text-red-500" />
                        <div className="text-sm font-medium text-red-700 dark:text-red-300">
                          Failed to load validation data
                        </div>
                        <div className="max-w-md text-xs text-muted-foreground">
                          {q.error instanceof Error
                            ? q.error.message
                            : "Unknown error occurred."}
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="mt-1"
                          onClick={() => q.refetch()}
                        >
                          <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Retry
                        </Button>
                      </div>
                    </td>
                  </tr>
                ) : groups.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="px-3 py-10 text-center text-muted-foreground">
                      <Factory className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" />
                      No validation groups found. Adjust filters or import data first.
                    </td>
                  </tr>
                ) : (
                  pagedGroups.map((g) => (
                    <ValidationRow
                      key={g.key}
                      group={g}
                      expanded={expandedRows.has(g.key)}
                      onToggle={() => toggleRow(g.key)}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>

          {groups.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2">
              <span className="text-xs text-muted-foreground">
                Page {valPage} of {valTotalPages} ({groups.length} groups)
              </span>
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={valPage <= 1}
                  onClick={() => setValPage((p) => Math.max(1, p - 1))}
                >
                  Prev
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={valPage >= valTotalPages}
                  onClick={() => setValPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
          {groups.length > 0 && (
            <div className="flex items-center justify-between border-t px-4 py-2 text-[11px] text-muted-foreground">
              <span>
                Showing {pagedGroups.length} group{pagedGroups.length === 1 ? "" : "s"}
              </span>
              <span>
                {stats.inconsistent} inconsistent · {stats.consistent} consistent
              </span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ValidationRow({
  group,
  expanded,
  onToggle,
}: {
  group: QtyValidationGroup;
  expanded: boolean;
  onToggle: () => void;
}) {
  const hasErrors = !group.isConsistent && group.errors.length > 0;
  const missing = group.missingQty ?? 0;
  const pending = group.pendingQty ?? 0;

  return (
    <>
      <tr
        className={cn(
          "border-t transition-colors",
          !group.isConsistent
            ? "bg-red-50/60 hover:bg-red-50 dark:bg-red-950/20 dark:hover:bg-red-950/30"
            : "hover:bg-muted/30"
        )}
      >
        <td className="px-2 py-1.5">
          {hasErrors ? (
            <button
              onClick={onToggle}
              className="flex h-6 w-6 items-center justify-center rounded hover:bg-accent"
              aria-label={expanded ? "Collapse errors" : "Expand errors"}
              aria-expanded={expanded}
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
        </td>
        <td className="whitespace-nowrap px-3 py-1.5 font-medium text-primary">
          {group.poNo || "—"}
        </td>
        <td className="whitespace-nowrap px-3 py-1.5">
          <span className="font-mono text-[11px]">{group.factoryPO || "—"}</span>
        </td>
        <td className="whitespace-nowrap px-3 py-1.5">
          {group.size ? (
            <Badge variant="outline" className="font-mono text-[10px]">
              {group.size}
            </Badge>
          ) : (
            <span className="text-muted-foreground/40">—</span>
          )}
        </td>
        <td className="max-w-[160px] truncate px-3 py-1.5" title={group.model ?? ""}>
          {group.model || <span className="text-muted-foreground/40">—</span>}
        </td>
        <td className="whitespace-nowrap px-3 py-1.5">
          {group.productType ? (
            <Badge variant="secondary" className="text-[10px]">
              {group.productType}
            </Badge>
          ) : (
            <span className="text-muted-foreground/40">—</span>
          )}
        </td>
        <td className="px-3 py-1.5 text-right tabular-nums">{fmtQty(group.orderQty)}</td>
        <td className="px-3 py-1.5 text-right tabular-nums">{fmtQty(group.outputQty)}</td>
        <td className="px-3 py-1.5 text-right tabular-nums">{fmtQty(group.inputQty)}</td>
        <td
          className={cn(
            "px-3 py-1.5 text-right tabular-nums",
            pending > 0 && "text-amber-600 dark:text-amber-400"
          )}
        >
          {fmtQty(group.pendingQty)}
        </td>
        <td
          className={cn(
            "px-3 py-1.5 text-right font-medium tabular-nums",
            missing > 0 && "text-red-600 dark:text-red-400",
            missing < 0 && "text-amber-600 dark:text-amber-400"
          )}
        >
          {fmtQty(group.missingQty)}
        </td>
        <td className="px-3 py-1.5 text-center">
          {group.isConsistent ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <Badge className="border-transparent bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/50 dark:text-emerald-300">
                    <CheckCircle2 /> OK
                  </Badge>
                </span>
              </TooltipTrigger>
              <TooltipContent>Quantities match</TooltipContent>
            </Tooltip>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <Badge className="border-transparent bg-red-100 text-red-700 hover:bg-red-100 dark:bg-red-950/50 dark:text-red-300">
                    <XCircle /> Error
                  </Badge>
                </span>
              </TooltipTrigger>
              <TooltipContent
                side="left"
                className="max-w-xs whitespace-pre-wrap text-left"
              >
                {group.errors.join("\n")}
              </TooltipContent>
            </Tooltip>
          )}
        </td>
      </tr>
      {hasErrors && expanded && (
        <tr className="bg-red-50/40 dark:bg-red-950/10">
          <td colSpan={12} className="px-6 py-3">
            <div className="rounded-md border border-red-500/20 bg-background/80 p-3">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-red-700 dark:text-red-300">
                <AlertTriangle className="h-3.5 w-3.5" />
                {group.errors.length} issue{group.errors.length === 1 ? "" : "s"} detected
              </div>
              <ul className="space-y-1">
                {group.errors.map((err, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 text-[11px] text-red-800 dark:text-red-200"
                  >
                    <span className="mt-0.5 text-red-400">•</span>
                    <span className="break-words">{err}</span>
                  </li>
                ))}
              </ul>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function fmtQty(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString();
}

type StatTone = "primary" | "danger" | "success" | "warning";

const STAT_TONES: Record<
  StatTone,
  { text: string; bg: string; ring: string }
> = {
  primary: {
    text: "text-emerald-600 dark:text-emerald-400",
    bg: "bg-emerald-50 dark:bg-emerald-950/40",
    ring: "ring-emerald-500/20",
  },
  danger: {
    text: "text-red-600 dark:text-red-400",
    bg: "bg-red-50 dark:bg-red-950/40",
    ring: "ring-red-500/20",
  },
  success: {
    text: "text-teal-600 dark:text-teal-400",
    bg: "bg-teal-50 dark:bg-teal-950/40",
    ring: "ring-teal-500/20",
  },
  warning: {
    text: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-50 dark:bg-amber-950/40",
    ring: "ring-amber-500/20",
  },
};

function StatCard({
  label,
  value,
  icon: Icon,
  tone,
  loading,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  tone: StatTone;
  loading?: boolean;
}) {
  const t = STAT_TONES[tone];
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4">
        <div
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-lg ring-1",
            t.bg,
            t.ring
          )}
        >
          <Icon className={cn("h-4 w-4", t.text)} />
        </div>
        <div
          className={cn(
            "mt-2 text-2xl font-bold tracking-tight tabular-nums",
            loading ? "text-muted-foreground" : t.text
          )}
        >
          {loading ? "—" : value.toLocaleString()}
        </div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  );
}
