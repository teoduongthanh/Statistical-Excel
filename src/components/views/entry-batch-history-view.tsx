"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Layers,
  Search,
  Eye,
  Trash2,
  Loader2,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronRight as ChevronRightIcon,
  GitCompareArrows,
  CalendarRange,
  RefreshCw,
  X,
  Hash,
  Package,
  BarChart3,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { useAppStore, PRODUCT_THEME } from "@/store/app-store";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
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
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

// Shipping status options used for the dropdown filter.
const SHIPPING_STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "1.Order", label: "1.Order" },
  { value: "2.Output", label: "2.Output" },
  { value: "4.Input", label: "4.Input" },
  { value: "3.Pending", label: "3.Pending" },
];

// Comparison dimensions supported by the backend compare endpoint.
const COMPARE_DIMENSIONS = [
  { value: "size", label: "Size" },
  { value: "poNo", label: "PO NO#" },
  { value: "factoryPO", label: "Factory PO" },
  { value: "colorCode", label: "Color Code" },
];

// Format an ISO date string into YYYY-MM-DD (the API uses this format).
function todayYMD(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function shippingBadgeClass(status: string | null | undefined): string {
  if (!status) return "";
  const s = status.toLowerCase();
  if (s.startsWith("1")) return "bg-slate-100 text-slate-700 dark:bg-slate-900/40 dark:text-slate-300";
  if (s.startsWith("2")) return "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300";
  if (s.startsWith("3")) return "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300";
  if (s.startsWith("4")) return "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300";
  return "";
}

// ============================================================================
// Main view
// ============================================================================

export function EntryBatchHistoryView() {
  const { currentProduct, refreshKey } = useAppStore();
  const theme = PRODUCT_THEME[currentProduct];
  const qc = useQueryClient();

  // Filters
  const [entryDateFrom, setEntryDateFrom] = React.useState("");
  const [entryDateTo, setEntryDateTo] = React.useState("");
  const [shippingStatus, setShippingStatus] = React.useState<string>("all");
  const [batchCode, setBatchCode] = React.useState("");
  const [debouncedBatchCode, setDebouncedBatchCode] = React.useState("");
  const [includeDeleted, setIncludeDeleted] = React.useState(false);

  // Pagination
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(20);

  // Detail dialog state
  const [detailId, setDetailId] = React.useState<string | null>(null);

  // Delete confirm state
  const [deleteRow, setDeleteRow] = React.useState<any>(null);
  const [deleting, setDeleting] = React.useState(false);

  // Debounce batch code search.
  React.useEffect(() => {
    const t = setTimeout(() => { setDebouncedBatchCode(batchCode); setPage(1); }, 400);
    return () => clearTimeout(t);
  }, [batchCode]);

  // Build the filter params sent to the list endpoint.
  const listParams = {
    productType: currentProduct,
    entryDateFrom: entryDateFrom || undefined,
    entryDateTo: entryDateTo || undefined,
    shippingStatus: shippingStatus === "all" ? undefined : shippingStatus,
    batchCode: debouncedBatchCode || undefined,
    includeDeleted,
    page,
    pageSize,
  };

  const batchesQ = useQuery({
    queryKey: ["entry-batches", listParams, refreshKey],
    queryFn: () => api.listEntryBatches(listParams),
  });

  const rows = batchesQ.data?.rows ?? [];
  const total = batchesQ.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  async function confirmDelete() {
    if (!deleteRow) return;
    setDeleting(true);
    try {
      await api.deleteEntryBatch(deleteRow.id);
      toast.success(`Batch ${deleteRow.batchCode} deleted`);
      setDeleteRow(null);
      qc.invalidateQueries({ queryKey: ["entry-batches"] });
    } catch (e) {
      toast.error("Delete failed", { description: e instanceof Error ? e.message : "" });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Header banner */}
      <div className={cn("relative overflow-hidden rounded-xl border bg-gradient-to-r p-5 text-white shadow-sm", theme?.gradient || "from-slate-500 to-slate-700")}>
        <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-white/10" />
        <div className="relative flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/15 backdrop-blur">
            <Layers className="h-6 w-6" />
          </div>
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-white/80">Entry Input Batches</p>
            <h1 className="text-2xl font-bold tracking-tight">Entry Batch History · {currentProduct}</h1>
            <p className="text-xs text-white/80">
              Browse, inspect, compare and review all "đợt nhập" (input sessions) for this product.
            </p>
          </div>
        </div>
      </div>

      <Tabs defaultValue="list" className="space-y-4">
        <TabsList>
          <TabsTrigger value="list"><Layers className="h-4 w-4 mr-1.5" />Batches List</TabsTrigger>
          <TabsTrigger value="compare"><GitCompareArrows className="h-4 w-4 mr-1.5" />Compare</TabsTrigger>
          <TabsTrigger value="stats"><CalendarRange className="h-4 w-4 mr-1.5" />Time Period Stats</TabsTrigger>
        </TabsList>

        {/* ===== LIST TAB ===== */}
        <TabsContent value="list" className="space-y-4">
          {/* Filters */}
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-5">
                <div className="space-y-1.5">
                  <Label className="text-xs">Entry Date From</Label>
                  <Input
                    type="date"
                    value={entryDateFrom}
                    onChange={(e) => { setEntryDateFrom(e.target.value); setPage(1); }}
                    className="h-9 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Entry Date To</Label>
                  <Input
                    type="date"
                    value={entryDateTo}
                    onChange={(e) => { setEntryDateTo(e.target.value); setPage(1); }}
                    className="h-9 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Shipping Status</Label>
                  <Select
                    value={shippingStatus}
                    onValueChange={(v) => { setShippingStatus(v); setPage(1); }}
                  >
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="All statuses" />
                    </SelectTrigger>
                    <SelectContent>
                      {SHIPPING_STATUS_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Batch Code</Label>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={batchCode}
                      onChange={(e) => setBatchCode(e.target.value)}
                      placeholder="e.g. ORD-20260101-001"
                      className="pl-8 h-9 text-sm"
                    />
                  </div>
                </div>
                <div className="flex items-end gap-2 pb-0.5">
                  <div className="flex items-center gap-2 h-9">
                    <Checkbox
                      id="include-deleted"
                      checked={includeDeleted}
                      onCheckedChange={(v) => { setIncludeDeleted(!!v); setPage(1); }}
                    />
                    <Label htmlFor="include-deleted" className="text-xs cursor-pointer">Include deleted</Label>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Table */}
          <Card>
            <CardContent className="p-0">
              <div className="flex items-center justify-between px-4 py-2.5 border-b">
                <div className="flex items-center gap-2 text-sm">
                  <Layers className="h-4 w-4 text-primary" />
                  <span className="font-medium">{total.toLocaleString()}</span>
                  <span className="text-muted-foreground">batches</span>
                  {batchesQ.isFetching && <Badge variant="secondary" className="text-[10px]">loading…</Badge>}
                </div>
                <select
                  value={pageSize}
                  onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
                  className="rounded border bg-transparent px-1 py-0.5 text-xs"
                >
                  {[20, 50, 100, 200].map((n) => <option key={n} value={n}>{n}/page</option>)}
                </select>
              </div>
              <div className="overflow-x-auto scroll-thin">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase text-muted-foreground">Batch Code</th>
                      <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase text-muted-foreground">Batch Name</th>
                      <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase text-muted-foreground">Entry Date</th>
                      <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase text-muted-foreground">Entry Time</th>
                      <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase text-muted-foreground">Seq</th>
                      <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase text-muted-foreground">Shipping Status</th>
                      <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase text-muted-foreground">Records</th>
                      <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase text-muted-foreground">Total Qty</th>
                      <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase text-muted-foreground">Status</th>
                      <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase text-muted-foreground">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batchesQ.isLoading ? (
                      Array.from({ length: 8 }).map((_, i) => (
                        <tr key={i} className="border-t">
                          <td colSpan={10} className="px-3 py-3"><div className="h-3 w-full animate-pulse rounded bg-muted" /></td>
                        </tr>
                      ))
                    ) : rows.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="px-3 py-10 text-center text-muted-foreground">
                          No batches found for {currentProduct}. Use the Data Entry view to create one.
                        </td>
                      </tr>
                    ) : (
                      rows.map((r: any) => (
                        <tr key={r.id} className="border-t hover:bg-muted/30">
                          <td className="px-3 py-1.5 font-mono font-medium text-primary whitespace-nowrap">{r.batchCode}</td>
                          <td className="px-3 py-1.5 whitespace-nowrap">{r.batchName}</td>
                          <td className="px-3 py-1.5 whitespace-nowrap tabular-nums">{r.entryDate}</td>
                          <td className="px-3 py-1.5 whitespace-nowrap tabular-nums text-muted-foreground">{r.entryTime ?? "—"}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{r.entrySequence}</td>
                          <td className="px-3 py-1.5">
                            <Badge variant="outline" className={cn("text-[9px]", shippingBadgeClass(r.shippingStatus))}>
                              {r.shippingStatus || "—"}
                            </Badge>
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{r.totalRecords ?? 0}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums font-medium">{(r.totalQuantity ?? 0).toLocaleString()}</td>
                          <td className="px-3 py-1.5">
                            {r.isDeleted ? (
                              <Badge variant="outline" className="text-[9px] bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300">
                                Deleted
                              </Badge>
                            ) : r.isClosed ? (
                              <Badge variant="outline" className="text-[9px] bg-slate-100 text-slate-700 dark:bg-slate-900/40 dark:text-slate-300">
                                Closed
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-[9px] bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300">
                                Open
                              </Badge>
                            )}
                          </td>
                          <td className="px-3 py-1.5">
                            <div className="flex justify-end gap-0.5">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7"
                                onClick={() => setDetailId(r.id)}
                              >
                                <Eye className="h-3.5 w-3.5 mr-1" /> Detail
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-destructive hover:text-destructive"
                                onClick={() => setDeleteRow(r)}
                                title="Delete batch"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              {/* Pagination */}
              <div className="flex items-center justify-between border-t px-4 py-2.5">
                <span className="text-xs text-muted-foreground">Page {page} of {totalPages}</span>
                <div className="flex gap-1">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== COMPARE TAB ===== */}
        <TabsContent value="compare" className="space-y-4">
          <BatchCompareTab batches={rows} loading={batchesQ.isLoading} productType={currentProduct} />
        </TabsContent>

        {/* ===== TIME PERIOD STATS TAB ===== */}
        <TabsContent value="stats" className="space-y-4">
          <TimePeriodStatsTab productType={currentProduct} />
        </TabsContent>
      </Tabs>

      {/* ===== Detail Dialog ===== */}
      <EntryBatchDetailDialog
        batchId={detailId}
        onClose={() => setDetailId(null)}
      />

      {/* ===== Delete Confirmation ===== */}
      <AlertDialog open={!!deleteRow} onOpenChange={(o) => !o && setDeleteRow(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-destructive" /> Delete Entry Batch
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to soft-delete this batch? The linked entry rows are preserved, but the batch
              will be hidden from the default list.
              {deleteRow && (
                <span className="mt-2 block text-xs font-mono bg-muted/40 rounded p-2">
                  {deleteRow.batchCode} · {deleteRow.batchName} · {deleteRow.totalRecords} records · {(deleteRow.totalQuantity ?? 0).toLocaleString()} qty
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); confirmDelete(); }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Trash2 className="h-4 w-4 mr-1.5" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ============================================================================
// Detail Dialog — shows batch header, stats, breakdowns, all entry rows,
//                  and a Recompute Totals button.
// ============================================================================

function EntryBatchDetailDialog({
  batchId,
  onClose,
}: {
  batchId: string | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [recomputing, setRecomputing] = React.useState(false);

  // Fetch the batch with its rows.
  const batchQ = useQuery({
    queryKey: ["entry-batch-detail", batchId],
    queryFn: () => api.getEntryBatch(batchId!, true),
    enabled: !!batchId,
  });

  // Fetch the stats (breakdowns).
  const statsQ = useQuery({
    queryKey: ["entry-batch-stats", batchId],
    queryFn: () => api.getEntryBatchStats(batchId!),
    enabled: !!batchId,
  });

  const batch = batchQ.data;
  const stats = statsQ.data;

  async function handleRecompute() {
    if (!batchId) return;
    setRecomputing(true);
    try {
      await api.updateEntryBatch(batchId, { recompute: true });
      toast.success("Totals recomputed");
      qc.invalidateQueries({ queryKey: ["entry-batch-detail", batchId] });
      qc.invalidateQueries({ queryKey: ["entry-batch-stats", batchId] });
      qc.invalidateQueries({ queryKey: ["entry-batches"] });
    } catch (e) {
      toast.error("Recompute failed", { description: e instanceof Error ? e.message : "" });
    } finally {
      setRecomputing(false);
    }
  }

  return (
    <Dialog open={!!batchId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto scroll-thin">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-primary" /> Entry Batch Detail
          </DialogTitle>
          <DialogDescription>
            Inspect this batch's header, breakdowns and all entry rows.
          </DialogDescription>
        </DialogHeader>

        {batchQ.isLoading || !batch ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            {/* Header info */}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <HeaderCell label="Batch Code" value={batch.batchCode} mono />
              <HeaderCell label="Batch Name" value={batch.batchName} />
              <HeaderCell label="Entry Date" value={batch.entryDate} />
              <HeaderCell label="Entry Time" value={batch.entryTime ?? "—"} />
              <HeaderCell label="Sequence" value={String(batch.entrySequence)} />
              <HeaderCell label="Shipping Status" value={batch.shippingStatus ?? "—"} />
              <HeaderCell label="Status" value={
                batch.isDeleted ? "Deleted" : batch.isClosed ? "Closed" : "Open"
              } />
              <HeaderCell label="Product" value={batch.productType} />
            </div>
            {batch.note && (
              <div className="rounded-md border bg-muted/30 p-3 text-xs">
                <div className="text-[10px] font-semibold uppercase text-muted-foreground mb-0.5">Note</div>
                <div className="whitespace-pre-wrap">{batch.note}</div>
              </div>
            )}

            {/* Summary stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCell
                icon={<Hash className="h-4 w-4" />}
                label="Total Records"
                value={stats?.totalRecords ?? batch.totalRecords ?? 0}
              />
              <StatCell
                icon={<Package className="h-4 w-4" />}
                label="Total Quantity"
                value={stats?.totalQuantity ?? batch.totalQuantity ?? 0}
              />
              <StatCell
                icon={<BarChart3 className="h-4 w-4" />}
                label="Distinct Models"
                value={stats?.byModel?.length ?? 0}
              />
              <StatCell
                icon={<BarChart3 className="h-4 w-4" />}
                label="Distinct Sizes"
                value={stats?.bySize?.length ?? 0}
              />
            </div>

            {/* Breakdowns (collapsible) */}
            <BreakdownCard title="By Model" rows={stats?.byModel} defaultOpen />
            <BreakdownCard title="By PO NO#" rows={stats?.byPoNo} defaultOpen />
            <BreakdownCard title="By Factory PO" rows={stats?.byFactoryPO} defaultOpen={false} />
            <BreakdownCard title="By Color Code" rows={stats?.byColorCode} defaultOpen={false} />
            <BreakdownCard title="By Size" rows={stats?.bySize} defaultOpen />

            {/* Entry rows table */}
            <div className="rounded-md border">
              <div className="flex items-center justify-between border-b px-3 py-2">
                <div className="text-xs font-semibold uppercase text-muted-foreground">
                  Entry Rows ({batch.rows?.length ?? 0})
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7"
                  onClick={handleRecompute}
                  disabled={recomputing}
                >
                  {recomputing ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  Recompute Totals
                </Button>
              </div>
              <div className="max-h-80 overflow-y-auto scroll-thin">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40 sticky top-0">
                    <tr>
                      <th className="px-2 py-1.5 text-left text-[9px] font-semibold uppercase text-muted-foreground">Factory PO</th>
                      <th className="px-2 py-1.5 text-left text-[9px] font-semibold uppercase text-muted-foreground">PO NO#</th>
                      <th className="px-2 py-1.5 text-left text-[9px] font-semibold uppercase text-muted-foreground">Size</th>
                      <th className="px-2 py-1.5 text-left text-[9px] font-semibold uppercase text-muted-foreground">Model</th>
                      <th className="px-2 py-1.5 text-left text-[9px] font-semibold uppercase text-muted-foreground">Color</th>
                      <th className="px-2 py-1.5 text-right text-[9px] font-semibold uppercase text-muted-foreground">Qty1</th>
                      <th className="px-2 py-1.5 text-right text-[9px] font-semibold uppercase text-muted-foreground">Qty2</th>
                      <th className="px-2 py-1.5 text-right text-[9px] font-semibold uppercase text-muted-foreground">Lần</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(batch.rows ?? []).length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">
                          This batch has no entry rows.
                        </td>
                      </tr>
                    ) : (
                      (batch.rows ?? []).map((r: any) => (
                        <tr key={r.id} className="border-t hover:bg-muted/30">
                          <td className="px-2 py-1 font-medium text-primary whitespace-nowrap">{r.factoryPO}</td>
                          <td className="px-2 py-1 whitespace-nowrap text-muted-foreground">{r.poNo ?? "—"}</td>
                          <td className="px-2 py-1">
                            <Badge variant="outline" className="text-[9px] font-mono">{r.size}</Badge>
                          </td>
                          <td className="px-2 py-1 whitespace-nowrap">{r.model ?? "—"}</td>
                          <td className="px-2 py-1 whitespace-nowrap max-w-[160px] truncate text-muted-foreground" title={r.colorCode ?? ""}>
                            {r.colorCode ?? "—"}
                          </td>
                          <td className="px-2 py-1 text-right tabular-nums">{r.qty1}</td>
                          <td className="px-2 py-1 text-right tabular-nums text-rose-600">{r.qty2}</td>
                          <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">{r.batchNumber ?? "—"}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex justify-end">
              <Button variant="outline" onClick={onClose}>
                <X className="h-4 w-4 mr-1.5" /> Close
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Compare Tab
// ============================================================================

function BatchCompareTab({
  batches,
  loading,
  productType,
}: {
  batches: any[];
  loading: boolean;
  productType: string;
}) {
  const [batchId1, setBatchId1] = React.useState<string>("");
  const [batchId2, setBatchId2] = React.useState<string>("");
  const [dimension, setDimension] = React.useState<string>("size");
  const [comparing, setComparing] = React.useState(false);
  const [result, setResult] = React.useState<any>(null);

  async function handleCompare() {
    if (!batchId1 || !batchId2) {
      toast.error("Pick both batches to compare");
      return;
    }
    if (batchId1 === batchId2) {
      toast.error("Pick two different batches");
      return;
    }
    setComparing(true);
    try {
      const r = await api.compareEntryBatches({
        batchId1,
        batchId2,
        dimension: dimension as "poNo" | "factoryPO" | "colorCode" | "size",
      });
      setResult(r);
      if (!r) toast.error("Comparison returned no result");
    } catch (e) {
      toast.error("Compare failed", { description: e instanceof Error ? e.message : "" });
    } finally {
      setComparing(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <GitCompareArrows className="h-4 w-4 text-primary" /> Compare Two Batches
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-xs text-muted-foreground">
          Pick two batches from the current list ({productType}) and a dimension to compare by. The result lists every
          key from either batch, with quantity diffs highlighted.
        </div>

        {/* Pickers */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Batch 1</Label>
            <Select value={batchId1} onValueChange={setBatchId1}>
              <SelectTrigger className="text-sm"><SelectValue placeholder="Select first batch" /></SelectTrigger>
              <SelectContent>
                {batches.map((b: any) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.batchCode} · {b.batchName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Batch 2</Label>
            <Select value={batchId2} onValueChange={setBatchId2}>
              <SelectTrigger className="text-sm"><SelectValue placeholder="Select second batch" /></SelectTrigger>
              <SelectContent>
                {batches.map((b: any) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.batchCode} · {b.batchName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Dimension</Label>
            <Select value={dimension} onValueChange={setDimension}>
              <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {COMPARE_DIMENSIONS.map((d) => (
                  <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button onClick={handleCompare} disabled={comparing || !batchId1 || !batchId2 || loading}>
            {comparing ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <GitCompareArrows className="h-4 w-4 mr-1.5" />}
            Compare
          </Button>
          {batches.length === 0 && !loading && (
            <span className="text-xs text-muted-foreground">No batches loaded — adjust filters in the Batches List tab.</span>
          )}
        </div>

        {/* Results */}
        {result && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-md border bg-muted/30 p-3 text-xs">
                <div className="text-[10px] font-semibold uppercase text-muted-foreground">Batch 1</div>
                <div className="font-mono mt-0.5">{result.batch1?.batchCode}</div>
                <div className="text-muted-foreground">{result.batch1?.batchName}</div>
              </div>
              <div className="rounded-md border bg-muted/30 p-3 text-xs">
                <div className="text-[10px] font-semibold uppercase text-muted-foreground">Batch 2</div>
                <div className="font-mono mt-0.5">{result.batch2?.batchCode}</div>
                <div className="text-muted-foreground">{result.batch2?.batchName}</div>
              </div>
            </div>
            <div className="rounded-md border overflow-x-auto scroll-thin">
              <table className="w-full text-xs">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase text-muted-foreground">Key</th>
                    <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase text-muted-foreground">Batch 1 Qty</th>
                    <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase text-muted-foreground">Batch 2 Qty</th>
                    <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase text-muted-foreground">Diff (B2 − B1)</th>
                  </tr>
                </thead>
                <tbody>
                  {(result.rows ?? []).map((row: any, i: number) => {
                    const diff = row.diff ?? 0;
                    return (
                      <tr key={`${row.key}-${i}`} className="border-t hover:bg-muted/30">
                        <td className="px-3 py-1.5 font-medium">{row.key}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{row.qty1}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{row.qty2}</td>
                        <td className={cn(
                          "px-3 py-1.5 text-right tabular-nums font-medium",
                          diff > 0 && "text-emerald-600",
                          diff < 0 && "text-rose-600",
                          diff === 0 && "text-muted-foreground"
                        )}>
                          {diff > 0 ? "+" : ""}{diff.toLocaleString()}
                        </td>
                      </tr>
                    );
                  })}
                  {(result.rows ?? []).length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">
                        No keys in either batch for this dimension.
                      </td>
                    </tr>
                  )}
                </tbody>
                {result.totals && (
                  <tfoot className="bg-muted/40">
                    <tr className="border-t-2">
                      <td className="px-3 py-2 font-semibold">Totals</td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold">{result.totals.qty1}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold">{result.totals.qty2}</td>
                      <td className={cn(
                        "px-3 py-2 text-right tabular-nums font-semibold",
                        result.totals.diff > 0 && "text-emerald-600",
                        result.totals.diff < 0 && "text-rose-600"
                      )}>
                        {result.totals.diff > 0 ? "+" : ""}{result.totals.diff.toLocaleString()}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Time Period Stats Tab
// ============================================================================

function TimePeriodStatsTab({ productType }: { productType: string }) {
  // Default range: last 30 days.
  const [dateFrom, setDateFrom] = React.useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const [dateTo, setDateTo] = React.useState(todayYMD());
  const [loading, setLoading] = React.useState(false);
  const [data, setData] = React.useState<any>(null);

  async function handleFetch() {
    if (!dateFrom || !dateTo) {
      toast.error("Pick both dates");
      return;
    }
    if (dateFrom > dateTo) {
      toast.error("Date From must be ≤ Date To");
      return;
    }
    setLoading(true);
    try {
      const r = await api.compareEntryBatches({ productType, dateFrom, dateTo });
      setData(r);
      if (!r) toast.error("No data returned");
    } catch (e) {
      toast.error("Failed to fetch stats", { description: e instanceof Error ? e.message : "" });
    } finally {
      setLoading(false);
    }
  }

  // Auto-fetch on first mount with the default range.
  React.useEffect(() => {
    handleFetch();
  }, []);

  const summary = data?.summary;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarRange className="h-4 w-4 text-primary" /> Time Period Stats
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Date From</Label>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-9 text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Date To</Label>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-9 text-sm" />
          </div>
          <div className="flex items-end">
            <Button onClick={handleFetch} disabled={loading} className="w-full md:w-auto">
              {loading ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <CalendarRange className="h-4 w-4 mr-1.5" />}
              Load Stats
            </Button>
          </div>
        </div>

        {/* Summary */}
        {summary && (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCell icon={<Package className="h-4 w-4" />} label="Total Quantity" value={summary.totalQty ?? 0} />
            <StatCell icon={<Layers className="h-4 w-4" />} label="Total Batches" value={summary.totalBatches ?? 0} />
            <StatCell icon={<Hash className="h-4 w-4" />} label="Total Records" value={summary.totalRecords ?? 0} />
            <StatCell icon={<BarChart3 className="h-4 w-4" />} label="Avg Batches/Day" value={Number(summary.avgBatchesPerDay ?? 0).toFixed(2)} />
          </div>
        )}

        {/* Daily breakdown table */}
        <div className="rounded-md border overflow-x-auto scroll-thin">
          <table className="w-full text-xs">
            <thead className="bg-muted/40">
              <tr>
                <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase text-muted-foreground">Date</th>
                <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase text-muted-foreground">Total Qty</th>
                <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase text-muted-foreground">Batches</th>
                <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase text-muted-foreground">Per-Batch Breakdown</th>
              </tr>
            </thead>
            <tbody>
              {loading && !data ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-t">
                    <td colSpan={4} className="px-3 py-3"><div className="h-3 w-full animate-pulse rounded bg-muted" /></td>
                  </tr>
                ))
              ) : (data?.daily ?? []).length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-10 text-center text-muted-foreground">
                    No batches in this date range for {productType}.
                  </td>
                </tr>
              ) : (
                (data?.daily ?? []).map((d: any) => (
                  <tr key={d.entryDate} className="border-t align-top hover:bg-muted/30">
                    <td className="px-3 py-1.5 font-medium tabular-nums whitespace-nowrap">{d.entryDate}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{(d.totalQty ?? 0).toLocaleString()}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{d.batchCount ?? 0}</td>
                    <td className="px-3 py-1.5">
                      <div className="flex flex-wrap gap-1">
                        {(d.batches ?? []).map((b: any) => (
                          <Badge key={b.batchCode} variant="outline" className="text-[9px] font-mono">
                            {b.batchCode} · {(b.totalQty ?? 0).toLocaleString()}qty · {b.totalRecords ?? 0}rec
                          </Badge>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Small presentational helpers
// ============================================================================

function HeaderCell({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-md border bg-muted/30 p-2">
      <div className="text-[10px] font-semibold uppercase text-muted-foreground">{label}</div>
      <div className={cn("text-sm font-medium mt-0.5 truncate", mono && "font-mono")} title={value}>
        {value}
      </div>
    </div>
  );
}

function StatCell({ icon, label, value }: { icon: React.ReactNode; label: string; value: number | string }) {
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        {icon}
        <span className="text-[11px]">{label}</span>
      </div>
      <div className="text-xl font-bold tabular-nums mt-1">
        {typeof value === "number" ? value.toLocaleString() : value}
      </div>
    </div>
  );
}

function BreakdownCard({
  title,
  rows,
  defaultOpen,
}: {
  title: string;
  rows?: { key: string; totalQty: number; count: number }[];
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = React.useState(!!defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="rounded-md border">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-muted/40"
          >
            <div className="flex items-center gap-2">
              {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRightIcon className="h-4 w-4" />}
              <span className="text-xs font-semibold uppercase text-muted-foreground">{title}</span>
              <Badge variant="outline" className="text-[9px]">{rows?.length ?? 0} keys</Badge>
            </div>
            {rows && rows.length > 0 && (
              <span className="text-xs text-muted-foreground tabular-nums">
                Σ {(rows.reduce((s, r) => s + (r.totalQty || 0), 0)).toLocaleString()}
              </span>
            )}
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border-t">
            <table className="w-full text-xs">
              <thead className="bg-muted/40">
                <tr>
                  <th className="px-3 py-1.5 text-left text-[9px] font-semibold uppercase text-muted-foreground">Key</th>
                  <th className="px-3 py-1.5 text-right text-[9px] font-semibold uppercase text-muted-foreground">Total Qty</th>
                  <th className="px-3 py-1.5 text-right text-[9px] font-semibold uppercase text-muted-foreground">Count</th>
                </tr>
              </thead>
              <tbody>
                {!rows || rows.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-3 py-4 text-center text-muted-foreground">
                      No data
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.key} className="border-t hover:bg-muted/30">
                      <td className="px-3 py-1 font-medium">{r.key || "(empty)"}</td>
                      <td className="px-3 py-1 text-right tabular-nums">{(r.totalQty ?? 0).toLocaleString()}</td>
                      <td className="px-3 py-1 text-right tabular-nums text-muted-foreground">{r.count}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
