"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Table2,
  Search,
  Pencil,
  Trash2,
  Copy,
  Download,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Save,
  X,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { SmartAutocomplete } from "@/components/common/smart-autocomplete";
import { buildExcelBuffer } from "@/lib/excel";
import { FIELD_LABELS, type CanonicalField } from "@/lib/fields";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { useAppStore } from "@/store/app-store";

const COLUMNS: CanonicalField[] = [
  "factoryPO",
  "size",
  "qty1",
  "qty2",
  "model",
  "sku",
  "season",
  "colorCode",
  "poNo",
  "shippingStatus",
  "deadline",
];

export function DataManagementView() {
  const { refreshKey } = useAppStore();
  const qc = useQueryClient();
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(20);
  const [search, setSearch] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  const [filters, setFilters] = React.useState<Record<string, string>>({});
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [editId, setEditId] = React.useState<string | null>(null);
  const [editData, setEditData] = React.useState<any>(null);
  const [editGroup, setEditGroup] = React.useState<any>(null);

  React.useEffect(() => {
    const t = setTimeout(() => { setDebounced(search); setPage(1); }, 400);
    return () => clearTimeout(t);
  }, [search]);

  const params = { page, pageSize, search: debounced, ...filters };
  const q = useQuery({
    queryKey: ["entries", params, refreshKey],
    queryFn: () => api.listEntries(params),
  });

  const rows = q.data?.rows ?? [];
  const total = q.data?.total ?? 0;

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function toggleAll() {
    if (selected.size === rows.length) setSelected(new Set());
    else setSelected(new Set(rows.map((r: any) => r.id)));
  }

  async function handleExport(mode: "all" | "selected") {
    let exportRows: any[] = [];
    if (mode === "selected") {
      exportRows = rows.filter((r: any) => selected.has(r.id));
    } else {
      const allRes = await api.listEntries({ page: 1, pageSize: Math.max(total, 1), search: debounced, ...filters });
      exportRows = allRes.rows;
    }
    const buf = buildExcelBuffer(exportRows, COLUMNS);
    const url = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `entries_${mode}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${exportRows.length} rows`);
  }

  async function openEdit(r: any) {
    setEditId(r.id);
    setEditData({ factoryPO: r.factoryPO, size: r.size, qty1: r.qty1 });
    setEditGroup(null);
    try {
      const g = await api.lookupFactoryPO(r.factoryPO);
      setEditGroup(g);
    } catch { /* ignore */ }
  }

  async function saveEdit() {
    if (!editId || !editData) return;
    try {
      await api.updateEntry(editId, { ...editData, autoCalcQty2: true });
      toast.success("Entry updated");
      setEditId(null);
      qc.invalidateQueries({ queryKey: ["entries"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    } catch (e) {
      toast.error("Update failed", { description: e instanceof Error ? e.message : "" });
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this entry?")) return;
    try {
      await api.deleteEntry(id);
      toast.success("Entry deleted");
      setSelected((s) => { const n = new Set(s); n.delete(id); return n; });
      qc.invalidateQueries({ queryKey: ["entries"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    } catch (e) {
      toast.error("Delete failed");
    }
  }

  async function handleDuplicate(r: any) {
    try {
      await api.createEntry({ factoryPO: r.factoryPO, size: r.size, qty1: r.qty1, autoCalcQty2: true });
      toast.success("Duplicated");
      qc.invalidateQueries({ queryKey: ["entries"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    } catch (e) {
      toast.error("Duplicate failed");
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[240px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search entries by Factory PO, SKU, MODEL…"
                className="pl-9 h-10"
              />
            </div>
            <Button variant="outline" size="sm" onClick={() => handleExport("all")}>
              <Download className="mr-1.5 h-4 w-4" /> Export all
            </Button>
            {selected.size > 0 && (
              <Button size="sm" onClick={() => handleExport("selected")}>
                <Download className="mr-1.5 h-4 w-4" /> Export selected ({selected.size})
              </Button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-8">
            {(["factoryPO", "model", "sku", "season", "colorCode", "size", "shippingStatus", "poNo"] as CanonicalField[]).map((f) => (
              <Input
                key={f}
                value={filters[f] ?? ""}
                onChange={(e) => { setFilters((p) => ({ ...p, [f]: e.target.value })); setPage(1); }}
                placeholder={FIELD_LABELS[f]}
                className="h-9 text-xs"
              />
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="flex items-center justify-between px-4 py-2.5 border-b">
            <div className="flex items-center gap-2 text-sm">
              <Table2 className="h-4 w-4 text-primary" />
              <span className="font-medium">{total.toLocaleString()}</span>
              <span className="text-muted-foreground">entries</span>
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
                  <th className="px-2 py-2 w-8">
                    <Checkbox checked={selected.size === rows.length && rows.length > 0} onCheckedChange={toggleAll} />
                  </th>
                  <th className="px-2 py-2 text-left text-[10px] font-semibold uppercase text-muted-foreground">Factory PO</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase text-muted-foreground">Size</th>
                  <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase text-muted-foreground">Qty1</th>
                  <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase text-muted-foreground">Qty2</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase text-muted-foreground">Model</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase text-muted-foreground">SKU</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase text-muted-foreground">Season</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase text-muted-foreground">Color</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase text-muted-foreground">PO NO#</th>
                  <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {q.isLoading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="border-t">
                      <td colSpan={11} className="px-3 py-3"><div className="h-3 w-full animate-pulse rounded bg-muted" /></td>
                    </tr>
                  ))
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-3 py-10 text-center text-muted-foreground">
                      No entries yet. Use Data Entry to create one.
                    </td>
                  </tr>
                ) : (
                  rows.map((r: any) => (
                    <tr key={r.id} className="border-t hover:bg-muted/30">
                      <td className="px-2 py-1.5">
                        <Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggle(r.id)} />
                      </td>
                      <td className="px-2 py-1.5 font-medium text-primary whitespace-nowrap">{r.factoryPO}</td>
                      <td className="px-3 py-1.5"><Badge variant="outline" className="font-mono text-[10px]">{r.size}</Badge></td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{r.qty1}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-rose-600">{r.qty2}</td>
                      <td className="px-3 py-1.5 whitespace-nowrap">{r.model}</td>
                      <td className="px-3 py-1.5 whitespace-nowrap">{r.sku}</td>
                      <td className="px-3 py-1.5"><Badge variant="secondary" className="text-[10px]">{r.season}</Badge></td>
                      <td className="px-3 py-1.5 max-w-[180px] truncate text-muted-foreground" title={r.colorCode ?? ""}>{r.colorCode}</td>
                      <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground">{r.poNo}</td>
                      <td className="px-3 py-1.5">
                        <div className="flex justify-end gap-0.5">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(r)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDuplicate(r)}>
                            <Copy className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => handleDelete(r.id)}>
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
          <div className="flex items-center justify-between border-t px-4 py-2.5">
            <span className="text-xs text-muted-foreground">Page {page} of {q.data?.totalPages ?? 1}</span>
            <div className="flex gap-1">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" disabled={page >= (q.data?.totalPages ?? 1)} onClick={() => setPage((p) => p + 1)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Edit dialog */}
      <Dialog open={!!editId} onOpenChange={(o) => !o && setEditId(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Pencil className="h-4 w-4 text-primary" /> Edit Entry</DialogTitle>
          </DialogHeader>
          {editData && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Factory PO</label>
                <SmartAutocomplete
                  field="factoryPO"
                  value={editData.factoryPO}
                  onChange={(v) => setEditData((d: any) => ({ ...d, factoryPO: v }))}
                  onSelect={async (s) => {
                    setEditData((d: any) => ({ ...d, factoryPO: s.value }));
                    try {
                      const g = await api.lookupFactoryPO(s.value);
                      setEditGroup(g);
                    } catch {}
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Size {editGroup && `(${editGroup.sizes.length} available)`}</label>
                <Input
                  value={editData.size}
                  onChange={(e) => setEditData((d: any) => ({ ...d, size: e.target.value }))}
                />
                {editGroup && (
                  <div className="flex flex-wrap gap-1">
                    {editGroup.sizes.slice(0, 10).map((s: string) => (
                      <button key={s} onClick={() => setEditData((d: any) => ({ ...d, size: s }))}
                        className="rounded border px-1.5 py-0.5 text-[10px] hover:bg-accent">
                        {s}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Qty 1</label>
                <Input value={editData.qty1} onChange={(e) => setEditData((d: any) => ({ ...d, qty1: e.target.value.replace(/[^0-9.\-]/g, "") }))} inputMode="numeric" />
                <p className="text-[11px] text-muted-foreground">Qty 2 will auto-calculate as -|Qty1|</p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditId(null)}><X className="mr-1.5 h-4 w-4" /> Cancel</Button>
            <Button onClick={saveEdit}><Save className="mr-1.5 h-4 w-4" /> Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
