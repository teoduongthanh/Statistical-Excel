"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  GitCompareArrows,
  Search,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  ArrowRight,
  Database,
  Table2,
  Eye,
  X,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { useAppStore, PRODUCT_THEME } from "@/store/app-store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// Fields compared side-by-side between Entry Data and Master Data.
const COMPARE_FIELDS: { key: string; label: string }[] = [
  { key: "model", label: "MODEL" },
  { key: "sku", label: "SKU" },
  { key: "poNo", label: "PO NO#" },
  { key: "item", label: "ITEM" },
  { key: "season", label: "Season" },
  { key: "colorCode", label: "Color Code" },
  { key: "colorCode2", label: "COLOR CODE" },
  { key: "painting", label: "PAINTING" },
  { key: "printingColor", label: "PRINTING COLOR" },
  { key: "deadline", label: "Dead Line" },
];

export function ProductReviewView() {
  const { currentProduct, refreshKey } = useAppStore();
  const theme = PRODUCT_THEME[currentProduct];
  const qc = useQueryClient();

  const [search, setSearch] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  const [page, setPage] = React.useState(1);
  const pageSize = 20;
  const [selectedEntry, setSelectedEntry] = React.useState<any>(null);
  const [masterForEntry, setMasterForEntry] = React.useState<any>(null);
  const [loadingMaster, setLoadingMaster] = React.useState(false);

  React.useEffect(() => {
    const t = setTimeout(() => { setDebounced(search); setPage(1); }, 400);
    return () => clearTimeout(t);
  }, [search]);

  // Fetch entries for this product.
  const entriesQ = useQuery({
    queryKey: ["review-entries", currentProduct, debounced, page, refreshKey],
    queryFn: () => api.listEntries({ productType: currentProduct, search: debounced, page, pageSize }),
  });

  const rows = entriesQ.data?.rows ?? [];
  const total = entriesQ.data?.total ?? 0;

  // Stats: how many entries match / differ / have no master ref.
  const stats = React.useMemo(() => {
    let matched = 0, differed = 0, noRef = 0;
    rows.forEach((r: any) => {
      if (!r.factoryPO) { noRef++; return; }
      // We can only know by loading master; use masterDataReference presence as proxy.
      if (r.masterDataReference) matched++;
      else noRef++;
    });
    return { matched, differed, noRef, total: rows.length };
  }, [rows]);

  async function openReview(entry: any) {
    setSelectedEntry(entry);
    setMasterForEntry(null);
    if (!entry.factoryPO) return;
    setLoadingMaster(true);
    try {
      const g = await api.lookupFactoryPO(entry.factoryPO, currentProduct);
      setMasterForEntry(g);
    } catch {
      setMasterForEntry(null);
    } finally {
      setLoadingMaster(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Banner */}
      <div className={cn("relative overflow-hidden rounded-xl border bg-gradient-to-r p-5 text-white shadow-sm", theme.gradient)}>
        <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-white/10" />
        <div className="relative flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/15 backdrop-blur">
            <GitCompareArrows className="h-6 w-6" />
          </div>
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-white/80">Review & Merge</p>
            <h1 className="text-2xl font-bold tracking-tight">Review Entry Data vs Master Data · {currentProduct}</h1>
            <p className="text-xs text-white/80">
              Compare each entry row against its Master Data reference. Spot mismatches before merging.
            </p>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Total Entries" value={total} icon={Table2} tone="muted" />
        <StatCard label="Has Master Ref" value={stats.matched} icon={Database} tone="emerald" />
        <StatCard label="No Master Ref" value={stats.noRef} icon={AlertTriangle} tone="amber" />
        <StatCard label="Page" value={`${page} / ${entriesQ.data?.totalPages ?? 1}`} icon={Eye} tone="muted" />
      </div>

      {/* Search */}
      <Card>
        <CardContent className="p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search entries by Factory PO, SKU, MODEL, Size…"
              className="pl-9 h-10"
            />
          </div>
        </CardContent>
      </Card>

      {/* Entry table */}
      <Card>
        <CardContent className="p-0">
          <div className="flex items-center justify-between px-4 py-2.5 border-b">
            <div className="flex items-center gap-2 text-sm">
              <Table2 className="h-4 w-4 text-primary" />
              <span className="font-medium">{total.toLocaleString()}</span>
              <span className="text-muted-foreground">entries</span>
              {entriesQ.isFetching && <Badge variant="secondary" className="text-[10px]">loading…</Badge>}
            </div>
          </div>
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full text-xs">
              <thead className="bg-muted/40">
                <tr>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase text-muted-foreground">#</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase text-muted-foreground">Shipping Status</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase text-muted-foreground">Factory PO</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase text-muted-foreground">PO NO#</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase text-muted-foreground">Size</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase text-muted-foreground">MODEL</th>
                  <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase text-muted-foreground">Qty1</th>
                  <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase text-muted-foreground">Qty2</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase text-muted-foreground">Master Ref</th>
                  <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase text-muted-foreground">Action</th>
                </tr>
              </thead>
              <tbody>
                {entriesQ.isLoading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="border-t">
                      <td colSpan={10} className="px-3 py-3"><div className="h-3 w-full animate-pulse rounded bg-muted" /></td>
                    </tr>
                  ))
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-3 py-10 text-center text-muted-foreground">
                      No entries found for {currentProduct}.
                    </td>
                  </tr>
                ) : (
                  rows.map((r: any, i) => {
                    const hasRef = !!r.masterDataReference;
                    return (
                      <tr key={r.id} className="border-t hover:bg-muted/30">
                        <td className="px-3 py-1.5 text-muted-foreground tabular-nums">{(page - 1) * pageSize + i + 1}</td>
                        <td className="px-3 py-1.5">
                          <Badge variant="outline" className={cn("text-[9px]", shippingBadgeClass(r.shippingStatus))}>
                            {r.shippingStatus || "—"}
                          </Badge>
                        </td>
                        <td className="px-3 py-1.5 font-medium text-primary whitespace-nowrap">{r.factoryPO}</td>
                        <td className="px-3 py-1.5 whitespace-nowrap">{r.poNo}</td>
                        <td className="px-3 py-1.5"><Badge variant="outline" className="text-[9px] font-mono">{r.size}</Badge></td>
                        <td className="px-3 py-1.5 whitespace-nowrap">{r.model}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{r.qty1}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{r.qty2}</td>
                        <td className="px-3 py-1.5">
                          {hasRef ? (
                            <Badge variant="outline" className="text-[9px] bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300">
                              <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" /> Yes
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[9px] bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300">
                              <AlertTriangle className="h-2.5 w-2.5 mr-0.5" /> None
                            </Badge>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          <Button size="sm" variant="ghost" className="h-7" onClick={() => openReview(r)}>
                            <Eye className="h-3.5 w-3.5 mr-1" /> Review
                          </Button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          {/* Pagination */}
          <div className="flex items-center justify-between border-t px-4 py-2.5">
            <span className="text-xs text-muted-foreground">Page {page} of {entriesQ.data?.totalPages ?? 1}</span>
            <div className="flex gap-1">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Prev</Button>
              <Button variant="outline" size="sm" disabled={page >= (entriesQ.data?.totalPages ?? 1)} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Review dialog */}
      <Dialog open={!!selectedEntry} onOpenChange={(o) => !o && setSelectedEntry(null)}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto scroll-thin">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GitCompareArrows className="h-5 w-5 text-primary" /> Entry vs Master Data
            </DialogTitle>
            <DialogDescription>
              Compare the entry values (left) against the Master Data reference (right). Mismatches are highlighted.
            </DialogDescription>
          </DialogHeader>
          {selectedEntry && (
            <div className="space-y-4">
              {/* Entry header */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-md border bg-muted/30 p-3">
                  <div className="text-[10px] font-semibold uppercase text-muted-foreground">Entry Data</div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <Badge variant="outline" className="text-[10px]">{selectedEntry.shippingStatus}</Badge>
                    <Badge variant="outline" className="text-[10px] font-mono">{selectedEntry.size}</Badge>
                    <Badge className={cn("text-[10px]", theme.badge)}>{selectedEntry.productType}</Badge>
                  </div>
                  <div className="mt-2 text-xs space-y-0.5">
                    <div><span className="text-muted-foreground">Factory PO:</span> <span className="font-medium">{selectedEntry.factoryPO}</span></div>
                    <div><span className="text-muted-foreground">PO NO#:</span> <span className="font-medium">{selectedEntry.poNo}</span></div>
                    <div><span className="text-muted-foreground">Qty1 / Qty2:</span> <span className="font-mono">{selectedEntry.qty1} / {selectedEntry.qty2}</span></div>
                    <div><span className="text-muted-foreground">Created:</span> {new Date(selectedEntry.createdAt).toLocaleString()}</div>
                  </div>
                </div>
                <div className="rounded-md border bg-muted/30 p-3">
                  <div className="text-[10px] font-semibold uppercase text-muted-foreground">Master Data Reference</div>
                  {loadingMaster ? (
                    <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" /> Loading master data…
                    </div>
                  ) : masterForEntry ? (
                    <div className="mt-2 text-xs space-y-0.5">
                      <div><span className="text-muted-foreground">Factory PO:</span> <span className="font-medium">{masterForEntry.factoryPO}</span></div>
                      <div><span className="text-muted-foreground">PO NO#:</span> <span className="font-medium">{masterForEntry.poNo}</span></div>
                      <div><span className="text-muted-foreground">Sizes:</span> <span className="font-mono">{masterForEntry.sizes?.length || 0}</span></div>
                      <div><span className="text-muted-foreground">Rows:</span> {masterForEntry.rowCount}</div>
                    </div>
                  ) : (
                    <div className="mt-2 flex items-center gap-1.5 text-xs text-amber-600">
                      <AlertTriangle className="h-3 w-3" /> Factory PO not found in Master Data
                    </div>
                  )}
                </div>
              </div>

              {/* Side-by-side comparison table */}
              <div className="overflow-x-auto scroll-thin rounded-md border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase text-muted-foreground">Field</th>
                      <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase text-muted-foreground">Entry Value</th>
                      <th className="px-3 py-2 w-10 text-center"></th>
                      <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase text-muted-foreground">Master Value</th>
                      <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase text-muted-foreground">Match</th>
                    </tr>
                  </thead>
                  <tbody>
                    {COMPARE_FIELDS.map((f) => {
                      const entryVal = (selectedEntry as any)[f.key] || "";
                      const masterVal = (masterForEntry as any)?.[f.key] || "";
                      const match = entryVal === masterVal;
                      const bothEmpty = !entryVal && !masterVal;
                      return (
                        <tr key={f.key} className={cn("border-t", !match && !bothEmpty && "bg-amber-50 dark:bg-amber-950/20")}>
                          <td className="px-3 py-1.5 font-medium text-muted-foreground">{f.label}</td>
                          <td className="px-3 py-1.5 break-words max-w-[240px]">{entryVal || <span className="text-muted-foreground/40">—</span>}</td>
                          <td className="px-3 py-1.5 text-center text-muted-foreground"><ArrowRight className="h-3 w-3 inline" /></td>
                          <td className="px-3 py-1.5 break-words max-w-[240px]">{masterVal || <span className="text-muted-foreground/40">—</span>}</td>
                          <td className="px-3 py-1.5">
                            {bothEmpty ? (
                              <span className="text-muted-foreground/50 text-[10px]">—</span>
                            ) : match ? (
                              <Badge variant="outline" className="text-[9px] bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300">
                                <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" /> Match
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-[9px] bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300">
                                <XCircle className="h-2.5 w-2.5 mr-0.5" /> Differs
                              </Badge>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Info note */}
              <div className="rounded-md border border-blue-200 bg-blue-50 dark:bg-blue-950/20 p-3 text-xs text-blue-700 dark:text-blue-300 flex items-start gap-1.5">
                <Eye className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <div>
                  <strong>Review only.</strong> Entry Data is independent from Master Data. Editing the entry here
                  does not change Master Data. To update Master Data, go to the <strong>Master Data</strong> view.
                  To edit this entry, go to <strong>Master Data → Data Management</strong> or use the entry's edit action.
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setSelectedEntry(null)}>
                  <X className="h-4 w-4 mr-1.5" /> Close
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatCard({ label, value, icon: Icon, tone = "muted" }: { label: string; value: any; icon: any; tone?: "muted" | "emerald" | "amber" }) {
  const tones = { muted: "text-foreground", emerald: "text-emerald-600", amber: "text-amber-600" };
  return (
    <div className="rounded-md border bg-card p-3">
      <Icon className={cn("h-4 w-4 mb-1", tones[tone])} />
      <div className={cn("text-xl font-bold tabular-nums", tones[tone])}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
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
