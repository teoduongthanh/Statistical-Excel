"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Package,
  Truck,
  PackageCheck,
  TrendingUp,
  AlertCircle,
  Factory,
  Search,
  Loader2,
  RotateCcw,
  X,
} from "lucide-react";
import { api } from "@/lib/api-client";
import type { ProductionStats } from "@/types";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/app-store";

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
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

interface FactoryPORow {
  factoryPO: string;
  ordered: number;
  sent: number;
  received: number;
  missing: number;
}

interface ProductTypeRow {
  productType: string;
  ordered: number;
  sent: number;
  received: number;
}

interface ProductionFilters {
  productType?: string;
  factoryPO?: string;
}

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

const PRODUCT_TYPES = ["Mafate", "Onyx", "Hoong Won"] as const;
const ALL_VALUE = "all";

/**
 * Color scheme — emerald/teal primary.
 * - ordered    -> neutral slate (low chroma, avoids indigo/blue)
 * - sent       -> amber  (in-progress / output)
 * - received   -> emerald/teal (complete / input)
 * - missing    -> rose   (shortfall / danger)
 */
const CHART_COLORS = {
  ordered: "oklch(0.55 0.025 220)", // near-neutral slate
  sent: "oklch(0.74 0.16 75)", // amber
  received: "oklch(0.6 0.13 162)", // emerald/teal
  missing: "oklch(0.62 0.21 18)", // rose
} as const;

/** Pie palette — warm green → amber → rose, no blue. */
const PIE_PALETTE = [
  "oklch(0.55 0.13 162)", // emerald
  "oklch(0.62 0.14 145)", // green
  "oklch(0.7 0.15 120)", // lime
  "oklch(0.74 0.16 75)", // amber
  "oklch(0.68 0.17 40)", // orange
  "oklch(0.62 0.21 18)", // rose
  "oklch(0.58 0.13 145)",
  "oklch(0.66 0.15 100)",
] as const;

const DEBOUNCE_MS = 400;
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

function fmt(n: number): string {
  return n.toLocaleString();
}

function pct(value: number, total: number): number {
  if (!total || total <= 0) return 0;
  return (value / total) * 100;
}

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

function completionTone(rate: number): {
  badge: string;
  text: string;
} {
  if (rate >= 95) {
    return {
      badge: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300",
      text: "text-emerald-600 dark:text-emerald-400",
    };
  }
  if (rate >= 80) {
    return {
      badge: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300",
      text: "text-amber-600 dark:text-amber-400",
    };
  }
  return {
    badge: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300",
    text: "text-rose-600 dark:text-rose-400",
  };
}

function withCompletion(
  rows: ProductTypeRow[]
): { productType: string; ordered: number; sent: number; received: number; completionRate: number }[] {
  return rows.map((r) => ({
    ...r,
    completionRate: clampPct(pct(r.received, r.ordered)),
  }));
}

// ----------------------------------------------------------------------------
// Stat card
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
              iconClass
            )}
          >
            <Icon className="h-4 w-4" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ----------------------------------------------------------------------------
// Loading skeleton blocks
// ----------------------------------------------------------------------------

function ChartSkeleton() {
  return (
    <div className="flex h-72 w-full items-center justify-center">
      <Skeleton className="h-72 w-full" />
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

// ----------------------------------------------------------------------------
// Empty state
// ----------------------------------------------------------------------------

function EmptyState({ message }: { message: string }) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center justify-center py-12 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <Package className="h-6 w-6" />
        </div>
        <p className="mt-3 text-sm font-medium">No production data</p>
        <p className="mt-1 max-w-sm text-xs text-muted-foreground">{message}</p>
      </CardContent>
    </Card>
  );
}

// ----------------------------------------------------------------------------
// Main view
// ----------------------------------------------------------------------------

export function ProductionStatsView() {
  const { refreshKey, bumpRefresh } = useAppStore();

  // ---- Filters state ----
  const [productType, setProductType] = React.useState<string>(ALL_VALUE);
  const [factoryPOInput, setFactoryPOInput] = React.useState<string>("");
  const [debouncedFactoryPO, setDebouncedFactoryPO] = React.useState<string>("");

  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedFactoryPO(factoryPOInput.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [factoryPOInput]);

  const filters: ProductionFilters = React.useMemo(
    () => ({
      productType: productType && productType !== ALL_VALUE ? productType : undefined,
      factoryPO: debouncedFactoryPO || undefined,
    }),
    [productType, debouncedFactoryPO]
  );

  const hasFilters = Boolean(filters.productType || filters.factoryPO);

  // ---- Query ----
  const q = useQuery({
    queryKey: ["production-stats", filters, refreshKey],
    queryFn: () => api.getProductionStats(filters),
    staleTime: 30_000,
  });

  const data: ProductionStats | undefined = q.data;
  const isLoading = q.isLoading || q.isFetching;
  const isError = q.isError;
  const isEmpty =
    !isLoading &&
    !isError &&
    (data?.totalOrdered ?? 0) === 0 &&
    (data?.byFactoryPO?.length ?? 0) === 0;

  // ---- Derived chart data ----
  const productTypeChart = React.useMemo(
    () => withCompletion(data?.byProductType ?? []),
    [data?.byProductType]
  );

  const pieData = React.useMemo(
    () =>
      productTypeChart.map((r) => ({
        name: r.productType || "Unknown",
        value: Number.isFinite(r.completionRate) ? Number(r.completionRate.toFixed(2)) : 0,
        ordered: r.ordered,
        received: r.received,
      })),
    [productTypeChart]
  );

  const factoryRows: FactoryPORow[] = React.useMemo(
    () => (data?.byFactoryPO ?? []) as FactoryPORow[],
    [data?.byFactoryPO]
  );

  const completionRate = data?.completionRate ?? 0;
  const completionToneState = completionTone(clampPct(completionRate));

  function handleReset() {
    setProductType(ALL_VALUE);
    setFactoryPOInput("");
    setDebouncedFactoryPO("");
  }

  return (
    <div className="space-y-6">
      {/* ---------------- Header / title ---------------- */}
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold tracking-tight">Production Statistics</h1>
        <p className="text-sm text-muted-foreground">
          Ordered vs sent (output) vs received (input) across product types and Factory POs.
        </p>
      </div>

      {/* ---------------- Filter bar ---------------- */}
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:gap-4">
            {/* Product Type */}
            <div className="flex flex-col gap-1.5 md:w-60">
              <label className="text-xs font-medium text-muted-foreground">Product Type</label>
              <Select value={productType} onValueChange={setProductType}>
                <SelectTrigger className="h-9 w-full">
                  <SelectValue placeholder="All product types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_VALUE}>All product types</SelectItem>
                  {PRODUCT_TYPES.map((pt) => (
                    <SelectItem key={pt} value={pt}>
                      {pt}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Factory PO */}
            <div className="flex flex-1 flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Factory PO</label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={factoryPOInput}
                  onChange={(e) => setFactoryPOInput(e.target.value)}
                  placeholder="e.g. MH26110228"
                  className="h-9 pl-8 pr-8"
                  autoComplete="off"
                  spellCheck={false}
                />
                {factoryPOInput ? (
                  <button
                    type="button"
                    onClick={() => setFactoryPOInput("")}
                    aria-label="Clear Factory PO filter"
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => q.refetch()}
                disabled={isLoading}
                className="h-9"
              >
                {isLoading ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                )}
                Refresh
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleReset}
                disabled={!hasFilters && !factoryPOInput}
                className="h-9"
              >
                Reset
              </Button>
            </div>
          </div>

          {/* Active filter chips */}
          {hasFilters ? (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Filters:</span>
              {filters.productType ? (
                <Badge variant="secondary" className="gap-1">
                  <Factory className="h-3 w-3" />
                  {filters.productType}
                  <button
                    type="button"
                    onClick={() => setProductType(ALL_VALUE)}
                    className="ml-0.5 rounded-sm hover:bg-accent"
                    aria-label={`Remove ${filters.productType} filter`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ) : null}
              {filters.factoryPO ? (
                <Badge variant="secondary" className="gap-1">
                  PO: {filters.factoryPO}
                  <button
                    type="button"
                    onClick={() => {
                      setFactoryPOInput("");
                      setDebouncedFactoryPO("");
                    }}
                    className="ml-0.5 rounded-sm hover:bg-accent"
                    aria-label="Remove Factory PO filter"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* ---------------- Error ---------------- */}
      {isError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Failed to load production stats</AlertTitle>
          <AlertDescription>
            {q.error instanceof Error ? q.error.message : "Unknown error."}{" "}
            <button
              type="button"
              onClick={() => q.refetch()}
              className="underline underline-offset-2 hover:opacity-80"
            >
              Try again
            </button>
          </AlertDescription>
        </Alert>
      ) : null}

      {/* ---------------- Summary stat cards ---------------- */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total Ordered"
          value={fmt(data?.totalOrdered ?? 0)}
          icon={Package}
          iconClass="bg-slate-100 text-slate-600 dark:bg-slate-800/60 dark:text-slate-300"
          loading={isLoading}
          sub={<span>Customer demand</span>}
        />
        <StatCard
          label="Total Sent (Output)"
          value={fmt(data?.totalSent ?? 0)}
          icon={Truck}
          iconClass="bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
          loading={isLoading}
          sub={
            <span>
              {clampPct(pct(data?.totalSent ?? 0, data?.totalOrdered ?? 0)).toFixed(1)}% of ordered
            </span>
          }
        />
        <StatCard
          label="Total Received (Input)"
          value={fmt(data?.totalReceived ?? 0)}
          icon={PackageCheck}
          iconClass="bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
          loading={isLoading}
          sub={
            <span>
              {clampPct(pct(data?.totalReceived ?? 0, data?.totalOrdered ?? 0)).toFixed(1)}% of
              ordered
            </span>
          }
        />
        <StatCard
          label="Completion Rate"
          value={`${clampPct(completionRate).toFixed(1)}%`}
          icon={TrendingUp}
          iconClass={cn(
            "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
            completionRate < 80 &&
              "bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300",
            completionRate >= 80 &&
              completionRate < 95 &&
              "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
          )}
          loading={isLoading}
          sub={
            <span className={completionToneState.text}>
              received / ordered
            </span>
          }
        />
      </div>

      {/* ---------------- Charts ---------------- */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        {/* Bar chart */}
        <Card className="lg:col-span-3">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Factory className="h-4 w-4 text-primary" /> Ordered vs Sent vs Received by Product
              Type
            </CardTitle>
            <CardDescription className="text-xs">
              Grouped totals per product type.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <ChartSkeleton />
            ) : isEmpty || productTypeChart.length === 0 ? (
              <EmptyState message="No product-type breakdown for the current filters." />
            ) : (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={productTypeChart}
                    margin={{ top: 5, right: 10, left: -10, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                    <XAxis
                      dataKey="productType"
                      tick={{ fontSize: 11 }}
                      className="text-muted-foreground"
                      interval={0}
                    />
                    <YAxis tick={{ fontSize: 10 }} allowDecimals={false} width={48} />
                    <Tooltip
                      contentStyle={TOOLTIP_STYLE}
                      cursor={{ fill: "var(--muted)", opacity: 0.35 }}
                      formatter={(value: number, name: string) => [fmt(value), name]}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar
                      dataKey="ordered"
                      name="Ordered"
                      fill={CHART_COLORS.ordered}
                      radius={[4, 4, 0, 0]}
                    />
                    <Bar
                      dataKey="sent"
                      name="Sent"
                      fill={CHART_COLORS.sent}
                      radius={[4, 4, 0, 0]}
                    />
                    <Bar
                      dataKey="received"
                      name="Received"
                      fill={CHART_COLORS.received}
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Pie chart */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <TrendingUp className="h-4 w-4 text-primary" /> Completion Rate by Product Type
            </CardTitle>
            <CardDescription className="text-xs">
              received / ordered (%) per product type.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <ChartSkeleton />
            ) : isEmpty || pieData.length === 0 ? (
              <EmptyState message="No completion data for the current filters." />
            ) : (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={90}
                      innerRadius={45}
                      paddingAngle={2}
                      label={(entry: { name?: string; value?: number }) =>
                        `${entry.name ?? ""}: ${(entry.value ?? 0).toFixed(1)}%`
                      }
                      labelLine={false}
                      isAnimationActive={false}
                    >
                      {pieData.map((_, i) => (
                        <Cell key={i} fill={PIE_PALETTE[i % PIE_PALETTE.length]} />
                      ))}
                    </Pie>
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Tooltip
                      contentStyle={TOOLTIP_STYLE}
                      formatter={(value: number, name: string, entry: any) => {
                        const ordered = entry?.payload?.ordered ?? 0;
                        const received = entry?.payload?.received ?? 0;
                        return [
                          `${(value as number).toFixed(1)}% (${fmt(received)}/${fmt(ordered)})`,
                          name,
                        ];
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ---------------- Factory PO breakdown table ---------------- */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between gap-2 text-sm">
            <span className="flex items-center gap-2">
              <Factory className="h-4 w-4 text-primary" /> Factory PO Breakdown
            </span>
            <span className="text-xs font-normal text-muted-foreground tabular-nums">
              {factoryRows.length} {factoryRows.length === 1 ? "row" : "rows"}
            </span>
          </CardTitle>
          <CardDescription className="text-xs">
            Per-Factory-PO ordered, sent, received, missing, and completion rate.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <TableSkeleton />
          ) : isEmpty || factoryRows.length === 0 ? (
            <EmptyState message="No Factory PO records match the current filters." />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[140px]">Factory PO</TableHead>
                    <TableHead className="text-right">Ordered</TableHead>
                    <TableHead className="text-right">Sent</TableHead>
                    <TableHead className="text-right">Received</TableHead>
                    <TableHead className="text-right">Missing</TableHead>
                    <TableHead className="text-right">Completion %</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {factoryRows.map((row) => {
                    const rate = clampPct(pct(row.received, row.ordered));
                    const tone = completionTone(rate);
                    const missingTone =
                      row.missing > 0
                        ? "text-rose-600 dark:text-rose-400 font-semibold"
                        : "text-emerald-600 dark:text-emerald-400";
                    return (
                      <TableRow key={row.factoryPO} className="hover:bg-accent/40">
                        <TableCell className="font-medium">
                          <span className="inline-flex items-center gap-1.5">
                            <Factory className="h-3.5 w-3.5 text-muted-foreground" />
                            {row.factoryPO}
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmt(row.ordered)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-amber-600 dark:text-amber-400">
                          {fmt(row.sent)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                          {fmt(row.received)}
                        </TableCell>
                        <TableCell className={cn("text-right tabular-nums", missingTone)}>
                          {fmt(row.missing)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge variant="outline" className={cn("tabular-nums", tone.badge)}>
                            {rate.toFixed(1)}%
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
    </div>
  );
}

export default ProductionStatsView;
