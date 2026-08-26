"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCheck, AlertTriangle, Search, ChevronLeft, ChevronRight,
  RefreshCw, TrendingDown, TrendingUp, Equal, StickyNote,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { useAppStore } from "@/store/app-store";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { OrderNotePanel } from "@/components/common/order-note-panel";

const COMPANY_BADGE: Record<string, string> = {
  mafate: "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300",
  onyx: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300",
  hoongwon: "bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300",
};

export function QuantityCheckView() {
  const { company, refreshKey } = useAppStore();
  const qc = useQueryClient();
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(20);
  const [poNo, setPoNo] = React.useState("");
  const [factoryPO, setFactoryPO] = React.useState("");
  const [onlyErrors, setOnlyErrors] = React.useState(true);
  const [onlyShortage, setOnlyShortage] = React.useState(false);
  const [recomputing, setRecomputing] = React.useState(false);
  const [noteRow, setNoteRow] = React.useState<any | null>(null);

  const params = {
    page, pageSize, company: company === "all" ? "all" : company,
    poNo, factoryPO, onlyErrors, onlyShortage,
  };
  const q = useQuery({
    queryKey: ["quantity-check", params, refreshKey],
    queryFn: () => api.listQuantityCheck(params),
  });

  React.useEffect(() => { setPage(1); }, [company, onlyErrors, onlyShortage]);

  async function recompute() {
    setRecomputing(true);
    try {
      const r = await api.recomputeQuantityCheck();
      toast.success(`Recomputed ${r.computed} quantity checks`);
      qc.invalidateQueries({ queryKey: ["quantity-check"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    } catch (e) {
      toast.error("Recompute failed");
    } finally {
      setRecomputing(false);
    }
  }

  const rows = q.data?.rows ?? [];
  const total = q.data?.total ?? 0;
  const stats = q.data?.stats;

  return (
    <div className="space-y-4">
      {/* KPI cards */}
      {stats && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
          <Kpi icon={TrendingUp} label="Total Order" value={stats.totalOrder} color="text-emerald-600" />
          <Kpi icon={TrendingUp} label="Total Output" value={stats.totalOutput} color="text-teal-600" />
          <Kpi icon={TrendingDown} label="Total Input" value={stats.totalInput} color="text-cyan-600" />
          <Kpi icon={AlertTriangle} label="Quantity Errors" value={stats.errorCount} color="text-amber-600" />
          <Kpi icon={TrendingDown} label="Shortage Orders" value={stats.shortageCount} color="text-rose-600" />
          <Kpi icon={Equal} label="Net Shortage" value={stats.totalShortage} color={stats.totalShortage > 0 ? "text-rose-600" : "text-emerald-600"} />
        </div>
      )}

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={factoryPO} onChange={(e) => { setFactoryPO(e.target.value); setPage(1); }} placeholder="Filter by Factory PO…" className="pl-9 h-9" />
            </div>
            <Input value={poNo} onChange={(e) => { setPoNo(e.target.value); setPage(1); }} placeholder="Filter by PO NO#…" className="h-9 w-44" />
            <label className="flex items-center gap-1.5 text-xs cursor-pointer">
              <Checkbox checked={onlyErrors} onCheckedChange={(v) => setOnlyErrors(!!v)} />
              Only errors
            </label>
            <label className="flex items-center gap-1.5 text-xs cursor-pointer">
              <Checkbox checked={onlyShortage} onCheckedChange={(v) => setOnlyShortage(!!v)} />
              Only shortage
            </label>
            <Button variant="outline" size="sm" onClick={recompute} disabled={recomputing}>
              <RefreshCw className={cn("mr-1.5 h-4 w-4", recomputing && "animate-spin")} /> Recompute
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="flex items-center justify-between px-4 py-2.5 border-b">
            <div className="flex items-center gap-2 text-sm">
              <CheckCheck className="h-4 w-4 text-primary" />
              <span className="font-medium">{total.toLocaleString()}</span>
              <span className="text-muted-foreground">checks</span>
              {q.isFetching && <Badge variant="secondary" className="text-[10px]">loading…</Badge>}
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
                  <th className="px-2 py-2 text-left text-[10px] font-semibold uppercase text-muted-foreground">Co.</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase text-muted-foreground">PO NO#</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase text-muted-foreground">Factory PO</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase text-muted-foreground">Size</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase text-muted-foreground">Model</th>
                  <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase text-muted-foreground">Order</th>
                  <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase text-muted-foreground">Output</th>
                  <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase text-muted-foreground">Spending</th>
                  <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase text-muted-foreground">Input</th>
                  <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase text-muted-foreground">Shortage</th>
                  <th className="px-3 py-2 text-center text-[10px] font-semibold uppercase text-muted-foreground">Status</th>
                  <th className="px-2 py-2 text-right text-[10px] font-semibold uppercase text-muted-foreground">Note</th>
                </tr>
              </thead>
              <tbody>
                {q.isLoading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="border-t"><td colSpan={12} className="px-3 py-3"><div className="h-3 w-full animate-pulse rounded bg-muted" /></td></tr>
                  ))
                ) : rows.length === 0 ? (
                  <tr><td colSpan={12} className="px-3 py-10 text-center text-muted-foreground">No quantity issues found.</td></tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.id} className={cn("border-t hover:bg-muted/30", !r.match && "bg-amber-50/30 dark:bg-amber-950/10")}>
                      <td className="px-2 py-1.5">
                        <Badge variant="outline" className={cn("text-[9px] py-0 px-1", COMPANY_BADGE[r.company])}>{r.company?.[0]?.toUpperCase()}</Badge>
                      </td>
                      <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground">{r.poNo}</td>
                      <td className="px-3 py-1.5 font-medium text-primary whitespace-nowrap">{r.factoryPO}</td>
                      <td className="px-3 py-1.5"><Badge variant="outline" className="font-mono text-[10px]">{r.size}</Badge></td>
                      <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground">{r.model || "—"}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums font-medium">{r.orderQty}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{r.outputQty}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{r.spendingQty}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{r.inputQty}</td>
                      <td className={cn("px-3 py-1.5 text-right tabular-nums font-semibold",
                        r.shortage > 0 ? "text-rose-600" : r.shortage < 0 ? "text-amber-600" : "text-emerald-600")}>
                        {r.shortage > 0 ? `−${r.shortage}` : r.shortage < 0 ? `+${Math.abs(r.shortage)}` : "0"}
                      </td>
                      <td className="px-3 py-1.5 text-center">
                        {r.match ? (
                          <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300 text-[10px]">✓ OK</Badge>
                        ) : (
                          <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 text-[10px]">⚠ Mismatch</Badge>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setNoteRow(r)} title="Add note">
                          <StickyNote className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t px-4 py-2.5">
            <span className="text-xs text-muted-foreground">Page {page} of {q.data?.totalPages ?? 1}</span>
            <div className="flex gap-1">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}><ChevronLeft className="h-4 w-4" /></Button>
              <Button variant="outline" size="sm" disabled={page >= (q.data?.totalPages ?? 1)} onClick={() => setPage((p) => p + 1)}><ChevronRight className="h-4 w-4" /></Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Order note panel */}
      <Dialog open={!!noteRow} onOpenChange={(o) => !o && setNoteRow(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><StickyNote className="h-4 w-4 text-primary" /> Order Notes</DialogTitle>
          </DialogHeader>
          {noteRow && (
            <OrderNotePanel
              company={noteRow.company}
              poNo={noteRow.poNo}
              factoryPO={noteRow.factoryPO}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Kpi({ icon: Icon, label, value, color }: { icon: any; label: string; value: number; color: string }) {
  return (
    <Card><CardContent className="p-4">
      <Icon className={cn("h-4 w-4 mb-1", color)} />
      <div className={cn("text-xl font-bold tabular-nums", color)}>{value.toLocaleString()}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </CardContent></Card>
  );
}
