"use client";

// FvoStechTrackingView
// Onyx FVO ↔ STECH Inventory & Production Tracking (spec 15 sections)
//
// Links two data sources (FVO = ONYX_FVO productType, STECH = ONYX productType)
// by composite key: poNo + factoryPO(ART) + canonicalSize.
//
// Shows full production flow:
//   FVO Order → STECH Output → STECH Received → FVO Stock → FVO Output → Remaining
//
// READ-ONLY: never modifies source data (spec §12).

import * as React from "react";
import { ArrowLeftRight, Loader2, AlertTriangle, Filter } from "lucide-react";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const STATUS_META: Record<string, { color: string; label: string }> = {
  WAITING_STECH: { color: "bg-amber-100 text-amber-700 border-amber-300", label: "Waiting STECH" },
  IN_STOCK: { color: "bg-emerald-100 text-emerald-700 border-emerald-300", label: "In Stock" },
  PARTIAL_OUTPUT: { color: "bg-blue-100 text-blue-700 border-blue-300", label: "Partial Output" },
  SHORTAGE: { color: "bg-rose-100 text-rose-700 border-rose-300", label: "Shortage / Error" },
  COMPLETED: { color: "bg-slate-100 text-slate-700 border-slate-300", label: "Completed" },
};

export function FvoStechTrackingView() {
  const [loading, setLoading] = React.useState(true);
  const [data, setData] = React.useState<any>(null);
  const [page, setPage] = React.useState(1);
  const [filters, setFilters] = React.useState({
    poNo: "", art: "", size: "", model: "", colorCode: "", status: "", gender: "",
  });
  const [appliedFilters, setAppliedFilters] = React.useState<any>({});

  async function loadData(p = 1, f = appliedFilters) {
    setLoading(true);
    try {
      const result = await api.fvoStechTracking({ ...f, page: p, pageSize: 50 });
      setData(result);
      setPage(p);
    } catch (e: any) {
      toast.error("Failed to load tracking data", { description: e?.message });
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    loadData(1, {});
  }, []);

  function applyFilters() {
    const f: any = {};
    if (filters.poNo) f.poNo = filters.poNo;
    if (filters.art) f.art = filters.art;
    if (filters.size) f.size = filters.size;
    if (filters.model) f.model = filters.model;
    if (filters.colorCode) f.colorCode = filters.colorCode;
    if (filters.status) f.status = filters.status;
    if (filters.gender) f.gender = filters.gender;
    setAppliedFilters(f);
    loadData(1, f);
  }

  function resetFilters() {
    setFilters({ poNo: "", art: "", size: "", model: "", colorCode: "", status: "", gender: "" });
    setAppliedFilters({});
    loadData(1, {});
  }

  const summary = data?.summary;
  const rows = data?.rows || [];
  const total = data?.total || 0;
  const totalPages = data?.totalPages || 1;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="relative overflow-hidden rounded-xl bg-gradient-to-r from-teal-600 to-emerald-600 p-6 text-white">
        <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-white/10" />
        <div className="absolute -bottom-10 right-24 h-32 w-32 rounded-full bg-white/5" />
        <div className="relative flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/15 backdrop-blur">
            <ArrowLeftRight className="h-6 w-6" />
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-white/70">Inventory & Production Tracking</div>
            <h1 className="text-2xl font-bold">Onyx FVO ↔ STECH Tracking</h1>
            <p className="text-xs text-white/70 mt-1">
              FVO Order → STECH Output → STECH Received → FVO Stock → FVO Output · READ-ONLY
            </p>
          </div>
        </div>
      </div>

      {/* Summary KPIs (spec §10) */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
          <KpiCard label="Total Lines" value={summary.totalLines} color="bg-slate-100 text-slate-700" />
          <KpiCard label="FVO Order" value={summary.totalFvoOrder} color="bg-blue-100 text-blue-700" />
          <KpiCard label="STECH Output" value={summary.totalStechOutput} color="bg-amber-100 text-amber-700" />
          <KpiCard label="STECH Received" value={summary.totalStechReceived} color="bg-emerald-100 text-emerald-700" />
          <KpiCard label="FVO Output" value={summary.totalFvoOutput} color="bg-teal-100 text-teal-700" />
          <KpiCard label="FVO Stock" value={summary.totalFvoStock} color="bg-violet-100 text-violet-700" />
          <KpiCard label="Remaining Receive" value={summary.totalRemainingToReceive} color="bg-orange-100 text-orange-700" />
          <KpiCard label="Shortage Lines" value={summary.shortageLines} color="bg-rose-100 text-rose-700" />
        </div>
      )}

      {/* Status breakdown + Gender breakdown */}
      {summary?.statusCounts && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(summary.statusCounts).map(([status, count]) => {
            const meta = STATUS_META[status] || { color: "bg-muted text-muted-foreground", label: status };
            return (
              <Badge key={status} className={cn("text-xs", meta.color)}>
                {meta.label}: {count as number}
              </Badge>
            );
          })}
          {summary?.genderCounts && (
            <>
              <Badge className="text-xs bg-sky-100 text-sky-700 border-sky-300">
                Men: {summary.genderCounts.M}
              </Badge>
              <Badge className="text-xs bg-pink-100 text-pink-700 border-pink-300">
                Women: {summary.genderCounts.W}
              </Badge>
              {summary.genderCounts.unknown > 0 && (
                <Badge className="text-xs bg-muted text-muted-foreground">
                  Unknown: {summary.genderCounts.unknown}
                </Badge>
              )}
            </>
          )}
        </div>
      )}

      {/* Filters (spec §10) */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Filter className="h-4 w-4" /> Filters
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
            <Input placeholder="PO NO#" value={filters.poNo} onChange={(e) => setFilters({ ...filters, poNo: e.target.value })} className="h-8 text-xs" />
            <Input placeholder="ART" value={filters.art} onChange={(e) => setFilters({ ...filters, art: e.target.value })} className="h-8 text-xs" />
            <Input placeholder="Size" value={filters.size} onChange={(e) => setFilters({ ...filters, size: e.target.value })} className="h-8 text-xs" />
            <Input placeholder="Model" value={filters.model} onChange={(e) => setFilters({ ...filters, model: e.target.value })} className="h-8 text-xs" />
            <Input placeholder="Color Code" value={filters.colorCode} onChange={(e) => setFilters({ ...filters, colorCode: e.target.value })} className="h-8 text-xs" />
            <Select value={filters.status || "__all__"} onValueChange={(v) => setFilters({ ...filters, status: v === "__all__" ? "" : v })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="All status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All status</SelectItem>
                {Object.keys(STATUS_META).map((s) => (
                  <SelectItem key={s} value={s}>{STATUS_META[s].label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filters.gender || "__all__"} onValueChange={(v) => setFilters({ ...filters, gender: v === "__all__" ? "" : v })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="All gender" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All gender</SelectItem>
                <SelectItem value="M">Men</SelectItem>
                <SelectItem value="W">Women</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2 mt-2">
            <Button size="sm" onClick={applyFilters}>Apply</Button>
            <Button size="sm" variant="outline" onClick={resetFilters}>Reset</Button>
          </div>
        </CardContent>
      </Card>

      {/* Tracking table (spec §2) */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            Tracking Lines ({total})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-8 text-center"><Loader2 className="h-6 w-6 mx-auto animate-spin" /></div>
          ) : rows.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">No tracking data found</div>
          ) : (
            <div className="overflow-x-auto scroll-thin rounded-md border max-h-[600px]">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted/80 backdrop-blur z-10">
                  <tr>
                    <th className="px-2 py-1.5 text-left">Status</th>
                    <th className="px-2 py-1.5 text-left">Gender</th>
                    <th className="px-2 py-1.5 text-left">FVO PO NO#</th>
                    <th className="px-2 py-1.5 text-left">ART</th>
                    <th className="px-2 py-1.5 text-left">Size</th>
                    <th className="px-2 py-1.5 text-left">Model</th>
                    <th className="px-2 py-1.5 text-right">FVO Order</th>
                    <th className="px-2 py-1.5 text-right">STECH Out</th>
                    <th className="px-2 py-1.5 text-right">STECH Recv</th>
                    <th className="px-2 py-1.5 text-right">FVO Output</th>
                    <th className="px-2 py-1.5 text-right">FVO Stock</th>
                    <th className="px-2 py-1.5 text-right">Rem. Recv</th>
                    <th className="px-2 py-1.5 text-right">Rem. Output</th>
                    <th className="px-2 py-1.5 text-left">Issues</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r: any, i: number) => {
                    const meta = STATUS_META[r.status] || { color: "bg-muted", label: r.status };
                    return (
                      <tr key={i} className="border-t hover:bg-accent/30">
                        <td className="px-2 py-1.5">
                          <span className={cn("inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-semibold", meta.color)}>
                            {meta.label}
                          </span>
                        </td>
                        <td className="px-2 py-1.5">
                          {r.gender === "M" ? (
                            <Badge className="text-[9px] bg-sky-100 text-sky-700">Men</Badge>
                          ) : r.gender === "W" ? (
                            <Badge className="text-[9px] bg-pink-100 text-pink-700">Women</Badge>
                          ) : (
                            <span className="text-[9px] text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 font-mono">{r.fvoPoNo}</td>
                        <td className="px-2 py-1.5 font-mono text-muted-foreground">{r.fvoArt}</td>
                        <td className="px-2 py-1.5 font-mono">{r.size}</td>
                        <td className="px-2 py-1.5 truncate max-w-[120px]" title={r.model || ""}>{r.model || "—"}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{r.fvoOrderQty}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{r.stechOutputQty}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{r.stechReceivedQty}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{r.fvoOutputQty}</td>
                        <td className={cn("px-2 py-1.5 text-right font-mono font-bold", r.fvoStock < 0 ? "text-rose-600" : "text-emerald-600")}>{r.fvoStock}</td>
                        <td className={cn("px-2 py-1.5 text-right font-mono", r.remainingToReceive > 0 ? "text-orange-600" : "text-muted-foreground")}>{r.remainingToReceive}</td>
                        <td className={cn("px-2 py-1.5 text-right font-mono", r.remainingToOutput > 0 ? "text-amber-600" : "text-muted-foreground")}>{r.remainingToOutput}</td>
                        <td className="px-2 py-1.5 max-w-[200px]">
                          {r.issues.length > 0 ? (
                            <div className="flex items-start gap-1">
                              <AlertTriangle className="h-3 w-3 text-rose-500 shrink-0 mt-0.5" />
                              <span className="text-[10px] text-rose-600 truncate" title={r.issues.join("; ")}>{r.issues[0]}</span>
                            </div>
                          ) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-3 text-xs">
              <div className="text-muted-foreground">Page {page} of {totalPages} · {total} lines</div>
              <div className="flex gap-1">
                <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => loadData(page - 1)}>Prev</Button>
                <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => loadData(page + 1)}>Next</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Formula reference (spec §4-7) + Size rules */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Quantity Formulas & Size Rules</CardTitle>
        </CardHeader>
        <CardContent className="text-xs space-y-2 text-muted-foreground">
          <div><b>FVO Stock</b> = STECH Received − FVO Output</div>
          <div><b>Remaining to Receive</b> = FVO Order − STECH Received</div>
          <div><b>Remaining to Output</b> = FVO Order − FVO Output</div>
          <div><b>Available to Output</b> = STECH Received − FVO Output</div>
          <div className="text-rose-600"><b>SHORTAGE</b> when FVO Output &gt; STECH Received</div>
          <div className="border-t pt-2 mt-2">
            <b>Size Normalization:</b>
            <div className="ml-3 mt-1 space-y-0.5">
              <div>STECH "M07/W08T" + Men model → extract M07 = <b>7</b></div>
              <div>STECH "M05/W06T" + Women model → extract W06T = <b>6.5</b> (T = +0.5)</div>
              <div>Men range: 7–14 (M07–M14)</div>
              <div>Women range: 5–10.5 (W05–W10T)</div>
              <div>FVO sizes are plain numbers, gender-specific (no conversion)</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-md border p-2 text-center">
      <div className={cn("inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold mb-1", color)}>{label}</div>
      <div className="font-bold text-lg">{(value || 0).toLocaleString()}</div>
    </div>
  );
}
