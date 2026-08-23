"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  Boxes,
  CheckCircle2,
  Factory,
  Layers,
  Loader2,
  Package,
  PackageCheck,
  RotateCcw,
  Sparkles,
  TrendingUp,
  TriangleAlert,
  Truck,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useAppStore, PRODUCT_THEME, type ProductType } from "@/store/app-store";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

// ----------------------------------------------------------------------------
// Types — matches the response shape of GET /api/global-dashboard
// ----------------------------------------------------------------------------

interface ProductSummary {
  productType: string;
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
  quantityStatus: "COMPLETED" | "PROCESSING" | "WARNING" | "NOT_STARTED" | string;
  totalPOs: number;
  totalFactoryPOs: number;
  totalModels: number;
  totalSKUs: number;
  totalRows: number;
}

interface GlobalDashboardData {
  products: ProductSummary[];
}

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

const PRODUCT_ORDER: ProductType[] = ["MAFATE", "ONYX", "MIZUNO"];

const TOOLTIP_STYLE = {
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--popover)",
  color: "var(--popover-foreground)",
  fontSize: 12,
} as const;

/**
 * Series colors for the grouped Order/Output/Input chart.
 * Order → near-neutral slate; Output → amber (in-progress); Input → emerald (received).
 */
const SERIES_COLORS = {
  order: "oklch(0.55 0.025 220)", // slate
  output: "oklch(0.74 0.16 75)", // amber
  input: "oklch(0.6 0.13 162)", // emerald
} as const;

const STATUS_BADGES: Record<
  string,
  { label: string; className: string; icon: React.ComponentType<{ className?: string }> }
> = {
  COMPLETED: {
    label: "Completed",
    className:
      "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300",
    icon: CheckCircle2,
  },
  PROCESSING: {
    label: "Processing",
    className:
      "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300",
    icon: Loader2,
  },
  WARNING: {
    label: "Warning",
    className:
      "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300",
    icon: TriangleAlert,
  },
  NOT_STARTED: {
    label: "Not started",
    className:
      "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300",
    icon: AlertCircle,
  },
};

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function fmt(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return Math.round(n).toLocaleString("en-US");
}

function fmtPct(n: number, digits = 1): string {
  if (!Number.isFinite(n)) n = 0;
  return `${n.toFixed(digits)}%`;
}

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

function completionTone(rate: number): {
  text: string;
  badge: string;
} {
  if (rate >= 95) {
    return {
      text: "text-emerald-600 dark:text-emerald-400",
      badge:
        "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300",
    };
  }
  if (rate >= 80) {
    return {
      text: "text-amber-600 dark:text-amber-400",
      badge:
        "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300",
    };
  }
  return {
    text: "text-rose-600 dark:text-rose-400",
    badge:
      "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300",
  };
}

/** Sort products so they always appear MAFATE → ONYX → MIZUNO regardless of API order. */
function sortProducts(products: ProductSummary[]): ProductSummary[] {
  return [...products].sort((a, b) => {
    const ai = PRODUCT_ORDER.indexOf(a.productType as ProductType);
    const bi = PRODUCT_ORDER.indexOf(b.productType as ProductType);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
}

// ----------------------------------------------------------------------------
// Loading skeleton blocks
// ----------------------------------------------------------------------------

function ProductCardSkeleton() {
  return (
    <Card>
      <div className="h-1.5 w-full rounded-t-xl bg-muted" />
      <CardContent className="space-y-3 p-4">
        <Skeleton className="h-5 w-24" />
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
        <Skeleton className="h-9 w-full" />
      </CardContent>
    </Card>
  );
}

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
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}

function InsightsSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-8 w-full" />
      ))}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Product comparison card
// ----------------------------------------------------------------------------

interface ProductCardProps {
  product: ProductSummary;
  loading?: boolean;
}

function MiniMetric({
  label,
  value,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "default" | "warning" | "danger" | "success";
}) {
  return (
    <div className="rounded-lg border bg-card/60 p-2.5">
      <div className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <div
        className={cn(
          "mt-1 text-sm font-semibold tabular-nums",
          tone === "warning" && "text-amber-600 dark:text-amber-400",
          tone === "danger" && "text-rose-600 dark:text-rose-400",
          tone === "success" && "text-emerald-600 dark:text-emerald-400",
          tone === "default" && "text-foreground"
        )}
      >
        {value}
      </div>
    </div>
  );
}

function ProductCard({ product, loading }: ProductCardProps) {
  const pt = (product.productType || "MAFATE") as ProductType;
  const theme = PRODUCT_THEME[pt] ?? PRODUCT_THEME.MAFATE;
  const statusBadge = STATUS_BADGES[product.quantityStatus] ?? STATUS_BADGES.WARNING;
  const StatusIcon = statusBadge.icon;
  const completionToneState = completionTone(clampPct(product.completionRate));
  const outputTone = completionTone(clampPct(product.outputRate));

  return (
    <Card className="overflow-hidden border-l-4 py-0 gap-0" style={{ borderLeftColor: "var(--chart-3)" }}>
      <div className={cn("h-1.5 w-full bg-gradient-to-r", theme.gradient)} />
      <CardHeader className="pb-2 pt-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className={cn("flex h-9 w-9 items-center justify-center rounded-lg text-white", theme.bg)}>
              <Factory className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className={cn("text-base font-bold tracking-tight", theme.text)}>
                {theme.label}
              </CardTitle>
              <CardDescription className="text-[11px]">
                {fmt(product.totalRows)} master rows · {fmt(product.totalFactoryPOs)} Factory POs
              </CardDescription>
            </div>
          </div>
          <Badge variant="outline" className={cn("gap-1", statusBadge.className)}>
            <StatusIcon className="h-3 w-3" />
            {statusBadge.label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-2">
        {/* Mini-metric grid */}
        <div className="grid grid-cols-2 gap-2">
          <MiniMetric
            label="Ordered"
            value={loading ? "—" : fmt(product.orderQty)}
            icon={Package}
          />
          <MiniMetric
            label="Output"
            value={loading ? "—" : fmt(product.outputQty)}
            icon={Truck}
            tone={product.outputQty > 0 ? "success" : "default"}
          />
          <MiniMetric
            label="Input"
            value={loading ? "—" : fmt(product.inputQty)}
            icon={PackageCheck}
            tone={product.inputQty > 0 ? "success" : "default"}
          />
          <MiniMetric
            label="Processing"
            value={loading ? "—" : fmt(product.processing)}
            icon={Loader2}
            tone={product.processing > 0 ? "warning" : "default"}
          />
          <MiniMetric
            label="Missing"
            value={loading ? "—" : fmt(product.missing)}
            icon={TriangleAlert}
            tone={product.missing > 0 ? "danger" : "success"}
          />
          <MiniMetric
            label="Pending"
            value={loading ? "—" : fmt(product.pendingQty)}
            icon={Boxes}
          />
        </div>

        {/* Rate bars */}
        <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
          <RateRow
            label="Output Rate"
            value={clampPct(product.outputRate)}
            colorClass={outputTone.text}
            barClass={outputTone.text.replace("text-", "bg-")}
          />
          <RateRow
            label="Completion Rate"
            value={clampPct(product.completionRate)}
            colorClass={completionToneState.text}
            barClass={completionToneState.text.replace("text-", "bg-")}
          />
          <RateRow
            label="Processing Rate"
            value={clampPct(product.processingRate)}
            colorClass="text-slate-600 dark:text-slate-300"
            barClass="bg-slate-400 dark:bg-slate-500"
          />
        </div>

        {/* Totals */}
        <div className="grid grid-cols-3 gap-2">
          <MiniMetric label="Total POs" value={fmt(product.totalPOs)} icon={Layers} />
          <MiniMetric label="Factory POs" value={fmt(product.totalFactoryPOs)} icon={Factory} />
          <MiniMetric label="Models" value={fmt(product.totalModels)} icon={Boxes} />
        </div>
      </CardContent>
    </Card>
  );
}

function RateRow({
  label,
  value,
  colorClass,
  barClass,
}: {
  label: string;
  value: number;
  colorClass: string;
  barClass: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-muted-foreground">{label}</span>
        <span className={cn("font-semibold tabular-nums", colorClass)}>{fmtPct(value)}</span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full transition-all", barClass)}
          style={{ width: `${value}%` }}
        />
      </div>
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
          <Boxes className="h-6 w-6" />
        </div>
        <p className="mt-3 text-sm font-medium">No global data</p>
        <p className="mt-1 max-w-sm text-xs text-muted-foreground">{message}</p>
      </CardContent>
    </Card>
  );
}

// ----------------------------------------------------------------------------
// Insights generator
// ----------------------------------------------------------------------------

interface Insight {
  icon: React.ComponentType<{ className?: string }>;
  iconClass: string;
  text: React.ReactNode;
}

function buildInsights(products: ProductSummary[]): Insight[] {
  const out: Insight[] = [];
  if (products.length === 0) return out;

  // Completion-rate winner
  const sortedByCompletion = [...products].sort(
    (a, b) => b.completionRate - a.completionRate
  );
  const winner = sortedByCompletion[0];
  if (winner && winner.orderQty > 0) {
    const wt = PRODUCT_THEME[(winner.productType as ProductType) ?? "MAFATE"];
    out.push({
      icon: TrendingUp,
      iconClass: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
      text: (
        <>
          <span className={cn("font-semibold", wt.text)}>{wt.label}</span> has the highest
          completion rate at{" "}
          <span className="font-semibold tabular-nums">
            {fmtPct(clampPct(winner.completionRate))}
          </span>{" "}
          ({fmt(winner.inputQty)} / {fmt(winner.orderQty)} units received).
        </>
      ),
    });
  }

  // Highest processing backlog
  const sortedByProcessing = [...products].sort((a, b) => b.processing - a.processing);
  const proc = sortedByProcessing[0];
  if (proc && proc.processing > 0) {
    const pt = PRODUCT_THEME[(proc.productType as ProductType) ?? "MAFATE"];
    out.push({
      icon: Loader2,
      iconClass: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
      text: (
        <>
          <span className={cn("font-semibold", pt.text)}>{pt.label}</span> has{" "}
          <span className="font-semibold tabular-nums">{fmt(proc.processing)}</span> units
          still in processing (output sent but not yet received).
        </>
      ),
    });
  }

  // Fully completed product(s)
  const completed = products.filter(
    (p) => p.quantityStatus === "COMPLETED" || (p.orderQty > 0 && p.missing === 0)
  );
  if (completed.length > 0) {
    out.push({
      icon: CheckCircle2,
      iconClass:
        "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
      text: (
        <>
          {completed.map((p) => PRODUCT_THEME[(p.productType as ProductType) ?? "MAFATE"].label).join(", ")}{" "}
          {completed.length === 1 ? "is" : "are"} fully completed — received all{" "}
          {completed.length === 1 ? "its" : "their"} ordered units.
        </>
      ),
    });
  }

  // Highest missing units
  const sortedByMissing = [...products].sort((a, b) => b.missing - a.missing);
  const missing = sortedByMissing[0];
  if (missing && missing.missing > 0) {
    const mt = PRODUCT_THEME[(missing.productType as ProductType) ?? "MAFATE"];
    out.push({
      icon: TriangleAlert,
      iconClass: "bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300",
      text: (
        <>
          <span className={cn("font-semibold", mt.text)}>{mt.label}</span> has the largest
          shortfall — <span className="font-semibold tabular-nums">{fmt(missing.missing)}</span>{" "}
          units still missing against orders.
        </>
      ),
    });
  }

  // Largest order volume
  const sortedByOrder = [...products].sort((a, b) => b.orderQty - a.orderQty);
  const top = sortedByOrder[0];
  if (top && top.orderQty > 0) {
    const tt = PRODUCT_THEME[(top.productType as ProductType) ?? "MAFATE"];
    out.push({
      icon: Package,
      iconClass: "bg-slate-100 text-slate-700 dark:bg-slate-800/60 dark:text-slate-300",
      text: (
        <>
          <span className={cn("font-semibold", tt.text)}>{tt.label}</span> carries the largest
          order volume with{" "}
          <span className="font-semibold tabular-nums">{fmt(top.orderQty)}</span> ordered units
          across {fmt(top.totalPOs)} POs.
        </>
      ),
    });
  }

  return out;
}

// ----------------------------------------------------------------------------
// Main view
// ----------------------------------------------------------------------------

export function GlobalDashboardView() {
  const { refreshKey, bumpRefresh } = useAppStore();

  const q = useQuery({
    queryKey: ["global-dashboard", refreshKey],
    queryFn: () => api.getGlobalDashboard() as Promise<GlobalDashboardData>,
    staleTime: 30_000,
  });

  const isLoading = q.isLoading || q.isFetching;
  const isError = q.isError;

  const products: ProductSummary[] = React.useMemo(
    () => sortProducts(q.data?.products ?? []),
    [q.data?.products]
  );

  const isEmpty = !isLoading && !isError && products.every((p) => p.totalRows === 0);

  // Chart data — grouped bar (Order vs Output vs Input)
  const groupedBarData = React.useMemo(
    () =>
      products.map((p) => ({
        productType: p.productType,
        Order: p.orderQty,
        Output: p.outputQty,
        Input: p.inputQty,
      })),
    [products]
  );

  // Chart data — completion rate comparison
  const completionBarData = React.useMemo(
    () =>
      products.map((p) => ({
        productType: p.productType,
        completionRate: Number(clampPct(p.completionRate).toFixed(2)),
        orderQty: p.orderQty,
        inputQty: p.inputQty,
      })),
    [products]
  );

  const insights = React.useMemo(
    () => (isEmpty ? [] : buildInsights(products)),
    [products, isEmpty]
  );

  return (
    <div className="space-y-6">
      {/* ---------------- Header banner ---------------- */}
      <div className="relative overflow-hidden rounded-xl border">
        <div className="absolute inset-0 bg-gradient-to-r from-emerald-500 via-violet-500 to-rose-500 opacity-90" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_50%,rgba(255,255,255,0.15),transparent_50%)]" />
        <div className="relative flex flex-col gap-3 px-5 py-6 text-white md:flex-row md:items-center md:justify-between md:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/30 backdrop-blur">
              <Boxes className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight md:text-xl">
                Global Production Dashboard
              </h1>
              <p className="text-xs text-white/85 md:text-sm">
                MAFATE vs ONYX vs MIZUNO comparison — side-by-side production health across all
                product lines.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Product color chips */}
            <div className="hidden items-center gap-1.5 sm:flex">
              {PRODUCT_ORDER.map((p) => (
                <span
                  key={p}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold",
                    "bg-white/15 ring-1 ring-white/25 backdrop-blur"
                  )}
                >
                  <span
                    className={cn("h-2 w-2 rounded-full", PRODUCT_THEME[p].bg)}
                    aria-hidden
                  />
                  {PRODUCT_THEME[p].label}
                </span>
              ))}
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => q.refetch()}
              disabled={isLoading}
              className="h-9 bg-white/90 text-slate-900 hover:bg-white"
            >
              {isLoading ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              )}
              Refresh
            </Button>
          </div>
        </div>
      </div>

      {/* ---------------- Error ---------------- */}
      {isError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Failed to load global dashboard</AlertTitle>
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

      {/* ---------------- Comparison cards ---------------- */}
      {isEmpty ? (
        <EmptyState message="No production data found for any product. Import master data for MAFATE, ONYX, or MIZUNO to populate the comparison." />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {isLoading
            ? Array.from({ length: 3 }).map((_, i) => <ProductCardSkeleton key={i} />)
            : products.map((p) => <ProductCard key={p.productType} product={p} />)}
        </div>
      )}

      {/* ---------------- Charts ---------------- */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        {/* Grouped bar chart: Order vs Output vs Input */}
        <Card className="lg:col-span-3">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Factory className="h-4 w-4 text-primary" /> Order vs Output vs Input by Product
            </CardTitle>
            <CardDescription className="text-xs">
              Grouped bar chart comparing customer demand, shipped output, and received input across
              all three products.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <ChartSkeleton />
            ) : isEmpty || groupedBarData.length === 0 ? (
              <EmptyState message="No order/output/input data for the current filters." />
            ) : (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={groupedBarData}
                    margin={{ top: 5, right: 12, left: -8, bottom: 0 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      className="stroke-muted"
                      vertical={false}
                    />
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
                      dataKey="Order"
                      name="Order"
                      fill={SERIES_COLORS.order}
                      radius={[4, 4, 0, 0]}
                    />
                    <Bar
                      dataKey="Output"
                      name="Output"
                      fill={SERIES_COLORS.output}
                      radius={[4, 4, 0, 0]}
                    />
                    <Bar
                      dataKey="Input"
                      name="Input"
                      fill={SERIES_COLORS.input}
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Completion rate comparison */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <TrendingUp className="h-4 w-4 text-primary" /> Completion Rate Comparison
            </CardTitle>
            <CardDescription className="text-xs">
              Received input ÷ ordered units (%) per product.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <ChartSkeleton />
            ) : isEmpty || completionBarData.length === 0 ? (
              <EmptyState message="No completion data available." />
            ) : (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={completionBarData}
                    layout="vertical"
                    margin={{ top: 5, right: 36, left: 8, bottom: 0 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      className="stroke-muted"
                      horizontal={false}
                    />
                    <XAxis
                      type="number"
                      domain={[0, 100]}
                      tick={{ fontSize: 10 }}
                      tickFormatter={(v: number) => `${v}%`}
                      className="text-muted-foreground"
                    />
                    <YAxis
                      type="category"
                      dataKey="productType"
                      tick={{ fontSize: 11 }}
                      width={64}
                      className="text-muted-foreground"
                    />
                    <Tooltip
                      contentStyle={TOOLTIP_STYLE}
                      cursor={{ fill: "var(--muted)", opacity: 0.35 }}
                      formatter={(value: number, _name: string, entry: any) => {
                        const p = entry?.payload;
                        return [
                          `${(value as number).toFixed(1)}% (${fmt(p?.inputQty ?? 0)} / ${fmt(
                            p?.orderQty ?? 0
                          )} units)`,
                          "Completion",
                        ];
                      }}
                    />
                    <Bar dataKey="completionRate" name="Completion %" radius={[0, 4, 4, 0]}>
                      {completionBarData.map((entry) => (
                        <Cell
                          key={entry.productType}
                          fill={
                            PRODUCT_THEME[entry.productType as ProductType]?.chart ??
                            SERIES_COLORS.input
                          }
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ---------------- Summary table ---------------- */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between gap-2 text-sm">
            <span className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-primary" /> Summary Comparison Table
            </span>
            <span className="text-xs font-normal text-muted-foreground tabular-nums">
              {products.length} {products.length === 1 ? "product" : "products"}
            </span>
          </CardTitle>
          <CardDescription className="text-xs">
            Side-by-side production metrics across MAFATE, ONYX, and MIZUNO.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <TableSkeleton />
          ) : isEmpty ? (
            <EmptyState message="No data to summarize." />
          ) : (
            <div className="overflow-x-auto scroll-thin">
              <Table className="text-xs">
                <TableHeader>
                  <TableRow>
                    <TableHead className="sticky left-0 z-10 bg-background">Product</TableHead>
                    <TableHead className="text-right">Order</TableHead>
                    <TableHead className="text-right">Output</TableHead>
                    <TableHead className="text-right">Input</TableHead>
                    <TableHead className="text-right">Processing</TableHead>
                    <TableHead className="text-right">Missing</TableHead>
                    <TableHead className="text-right">Output%</TableHead>
                    <TableHead className="text-right">Completion%</TableHead>
                    <TableHead className="text-right">Total POs</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {products.map((p) => {
                    const theme = PRODUCT_THEME[(p.productType as ProductType) ?? "MAFATE"];
                    const ct = completionTone(clampPct(p.completionRate));
                    const ot = completionTone(clampPct(p.outputRate));
                    return (
                      <TableRow key={p.productType} className="hover:bg-muted/40">
                        <TableCell className="sticky left-0 z-10 bg-background font-medium">
                          <div className="flex items-center gap-2">
                            <span className={cn("h-2.5 w-2.5 rounded-full", theme.bg)} aria-hidden />
                            <span className={cn("font-semibold", theme.text)}>{theme.label}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{fmt(p.orderQty)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmt(p.outputQty)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmt(p.inputQty)}</TableCell>
                        <TableCell
                          className={cn(
                            "text-right tabular-nums",
                            p.processing > 0 && "text-amber-600 dark:text-amber-400"
                          )}
                        >
                          {fmt(p.processing)}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-right tabular-nums",
                            p.missing > 0 && "text-rose-600 dark:text-rose-400",
                            p.missing === 0 && p.orderQty > 0 && "text-emerald-600 dark:text-emerald-400"
                          )}
                        >
                          {fmt(p.missing)}
                        </TableCell>
                        <TableCell className={cn("text-right tabular-nums", ot.text)}>
                          {fmtPct(clampPct(p.outputRate))}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          <Badge variant="outline" className={cn("gap-1", ct.badge)}>
                            {fmtPct(clampPct(p.completionRate))}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{fmt(p.totalPOs)}</TableCell>
                      </TableRow>
                    );
                  })}

                  {/* Totals row */}
                  <TableRow className="border-t-2 border-muted/60 bg-muted/30 font-semibold">
                    <TableCell className="sticky left-0 z-10 bg-muted/30">TOTAL</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmt(products.reduce((s, p) => s + p.orderQty, 0))}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmt(products.reduce((s, p) => s + p.outputQty, 0))}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmt(products.reduce((s, p) => s + p.inputQty, 0))}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmt(products.reduce((s, p) => s + p.processing, 0))}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmt(products.reduce((s, p) => s + p.missing, 0))}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtPct(
                        clampPct(
                          (() => {
                            const tot = products.reduce((s, p) => s + p.orderQty, 0);
                            const out = products.reduce((s, p) => s + p.outputQty, 0);
                            return tot > 0 ? (out / tot) * 100 : 0;
                          })()
                        )
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtPct(
                        clampPct(
                          (() => {
                            const tot = products.reduce((s, p) => s + p.orderQty, 0);
                            const inp = products.reduce((s, p) => s + p.inputQty, 0);
                            return tot > 0 ? (inp / tot) * 100 : 0;
                          })()
                        )
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmt(products.reduce((s, p) => s + p.totalPOs, 0))}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---------------- Insights ---------------- */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Sparkles className="h-4 w-4 text-primary" /> Auto-Generated Insights
          </CardTitle>
          <CardDescription className="text-xs">
            Highlights derived from the live production data — refreshes automatically.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <InsightsSkeleton />
          ) : isEmpty || insights.length === 0 ? (
            <div className="rounded-lg border border-dashed py-8 text-center text-xs text-muted-foreground">
              No insights to show yet — import data for at least one product to populate.
            </div>
          ) : (
            <ul className="space-y-2">
              {insights.map((insight, i) => {
                const Icon = insight.icon;
                return (
                  <li
                    key={i}
                    className="flex items-start gap-3 rounded-lg border bg-card/60 p-3 text-sm"
                  >
                    <div
                      className={cn(
                        "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                        insight.iconClass
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <p className="leading-relaxed text-foreground/90">{insight.text}</p>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ---------------- Refresh trigger (silent) ---------------- */}
      <button
        type="button"
        onClick={bumpRefresh}
        className="hidden"
        aria-hidden
        tabIndex={-1}
        data-testid="global-dashboard-bump-refresh"
      >
        refresh
      </button>
    </div>
  );
}

export default GlobalDashboardView;
