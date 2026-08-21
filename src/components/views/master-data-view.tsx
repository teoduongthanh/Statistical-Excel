"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Database, Search, Filter, ChevronLeft, ChevronRight, Download, Pencil, Trash2, Save, X, Package } from "lucide-react";
import { api } from "@/lib/api-client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { ALL_FIELDS, FIELD_LABELS, type CanonicalField } from "@/lib/fields";
import { cn } from "@/lib/utils";

const COLUMNS: CanonicalField[] = [
  "productType",
  "factoryPO",
  "model",
  "sku",
  "poNo",
  "season",
  "colorCode",
  "colorCode2",
  "size",
  "qty1",
  "qty2",
  "shippingStatus",
  "deadline",
];

const FILTER_FIELDS: CanonicalField[] = ["factoryPO", "model", "sku", "poNo", "season", "colorCode", "size", "shippingStatus"];

const EDITABLE_FIELDS: CanonicalField[] = [
  "date", "shippingStatus", "model", "sku", "poNo", "factoryPO",
  "item", "season", "colorCode", "colorCode2", "painting",
  "printingColor", "size", "qty1", "qty2", "deadline", "productType",
];

export function MasterDataView() {
  const qc = useQueryClient();
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(20);
  const [search, setSearch] = React.useState("");
  const [filters, setFilters] = React.useState<Record<string, string>>({});
  const [productTypeFilter, setProductTypeFilter] = React.useState("");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  const [sort, setSort] = React.useState<{ key: string; order: "asc" | "desc" }>({ key: "factoryPO", order: "asc" });
  const [editRow, setEditRow] = React.useState<any>(null);
  const [editData, setEditData] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 400);
    return () => clearTimeout(t);
  }, [search]);

  const params = {
    page,
    pageSize,
    search: debouncedSearch,
    ...filters,
    productType: productTypeFilter,
    sort: sort.key,
    order: sort.order,
  };

  const q = useQuery({
    queryKey: ["master-data", params],
    queryFn: () => api.listMaster(params),
  });

  function toggleSort(key: string) {
    setSort((s) =>
      s.key === key ? { key, order: s.order === "asc" ? "desc" : "asc" } : { key, order: "asc" }
    );
  }

  async function handleExport() {
    const blob = await api.exportExcel({
      source: "master",
      columns: COLUMNS,
      mode: "filtered",
      filters: { search: debouncedSearch, ...filters, productType: productTypeFilter },
      sortOrder: "asc",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `master_data_${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Master data exported");
  }

  function openEdit(row: any) {
    setEditRow(row);
    const data: Record<string, string> = {};
    for (const f of EDITABLE_FIELDS) {
      data[f] = row[f] ?? "";
    }
    setEditData(data);
  }

  async function saveEdit() {
    if (!editRow) return;
    try {
      await api.updateMasterRow(editRow.id, editData);
      toast.success("Master data row updated");
      setEditRow(null);
      qc.invalidateQueries({ queryKey: ["master-data"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    } catch (e) {
      toast.error("Update failed", { description: e instanceof Error ? e.message : "" });
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this master data row? This will also rebuild the Factory PO index.")) return;
    try {
      await api.deleteMasterRow(id);
      toast.success("Master data row deleted");
      qc.invalidateQueries({ queryKey: ["master-data"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    } catch (e) {
      toast.error("Delete failed");
    }
  }

  const rows = q.data?.rows ?? [];
  const total = q.data?.total ?? 0;

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[240px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Global search across Factory PO, SKU, MODEL, Season…"
                className="pl-9 h-10"
              />
            </div>
            <Select value={productTypeFilter || "all"} onValueChange={(v) => { setProductTypeFilter(v === "all" ? "" : v); setPage(1); }}>
              <SelectTrigger className="w-40 h-10">
                <SelectValue placeholder="Product Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Products</SelectItem>
                <SelectItem value="Mafate">Mafate</SelectItem>
                <SelectItem value="Onyx">Onyx</SelectItem>
                <SelectItem value="Hoong Won">Hoong Won</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={handleExport}>
              <Download className="mr-1.5 h-4 w-4" /> Export
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-8">
            {FILTER_FIELDS.map((f) => (
              <Input
                key={f}
                value={filters[f] ?? ""}
                onChange={(e) => {
                  setFilters((p) => ({ ...p, [f]: e.target.value }));
                  setPage(1);
                }}
                placeholder={FIELD_LABELS[f]}
                className="h-9 text-xs"
              />
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="flex items-center justify-between px-4 py-2.5 border-b">
            <div className="flex items-center gap-2 text-sm">
              <Database className="h-4 w-4 text-primary" />
              <span className="font-medium">{total.toLocaleString()}</span>
              <span className="text-muted-foreground">rows</span>
              {q.isFetching && <Badge variant="secondary" className="text-[10px]">loading…</Badge>}
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Filter className="h-3.5 w-3.5" />
              <select
                value={pageSize}
                onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
                className="rounded border bg-transparent px-1 py-0.5"
              >
                {[20, 50, 100, 200].map((n) => <option key={n} value={n}>{n}/page</option>)}
              </select>
            </div>
          </div>
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full text-xs">
              <thead className="bg-muted/40">
                <tr>
                  <th className="px-2 py-2 text-left text-[10px] font-semibold uppercase text-muted-foreground">#</th>
                  {COLUMNS.map((c) => (
                    <th
                      key={c}
                      onClick={() => toggleSort(c)}
                      className="cursor-pointer whitespace-nowrap px-3 py-2 text-left text-[10px] font-semibold uppercase text-muted-foreground hover:text-foreground"
                    >
                      {FIELD_LABELS[c]}
                      {sort.key === c && <span className="ml-1">{sort.order === "asc" ? "▲" : "▼"}</span>}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {q.isLoading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="border-t">
                      <td colSpan={COLUMNS.length + 2} className="px-3 py-3">
                        <div className="h-3 w-full animate-pulse rounded bg-muted" />
                      </td>
                    </tr>
                  ))
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={COLUMNS.length + 2} className="px-3 py-10 text-center text-muted-foreground">
                      No master data rows found.
                    </td>
                  </tr>
                ) : (
                  rows.map((r: any, i) => (
                    <tr key={r.id} className="border-t hover:bg-muted/30 group">
                      <td className="px-2 py-1.5 text-muted-foreground tabular-nums">{(page - 1) * pageSize + i + 1}</td>
                      {COLUMNS.map((c) => (
                        <td key={c} className="px-3 py-1.5 whitespace-nowrap max-w-[220px] truncate" title={r[c] ?? ""}>
                          {c === "factoryPO" ? (
                            <span className="font-medium text-primary">{r[c]}</span>
                          ) : c === "size" ? (
                            <Badge variant="outline" className="font-mono text-[10px]">{r[c]}</Badge>
                          ) : c === "productType" ? (
                            <Badge variant="secondary" className={cn(
                              "text-[10px]",
                              r[c] === "Mafate" && "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
                              r[c] === "Onyx" && "bg-teal-100 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300",
                              r[c] === "Hoong Won" && "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
                            )}>
                              <Package className="h-2.5 w-2.5 mr-0.5" />{r[c] || "—"}
                            </Badge>
                          ) : r[c] ? (
                            r[c]
                          ) : (
                            <span className="text-muted-foreground/40">—</span>
                          )}
                        </td>
                      ))}
                      <td className="px-3 py-1.5">
                        <div className="flex justify-end gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(r)}>
                            <Pencil className="h-3.5 w-3.5" />
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

          {/* Pagination */}
          <div className="flex items-center justify-between border-t px-4 py-2.5">
            <span className="text-xs text-muted-foreground">
              Page {page} of {q.data?.totalPages ?? 1}
            </span>
            <div className="flex items-center gap-1">
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
      <Dialog open={!!editRow} onOpenChange={(o) => !o && setEditRow(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto scroll-thin">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-4 w-4 text-primary" /> Edit Master Data Row
            </DialogTitle>
          </DialogHeader>
          {editRow && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                {EDITABLE_FIELDS.map((f) => (
                  <div key={f} className="space-y-1">
                    <label className="text-[10px] font-semibold uppercase text-muted-foreground">{FIELD_LABELS[f]}</label>
                    <Input
                      value={editData[f] ?? ""}
                      onChange={(e) => setEditData((d) => ({ ...d, [f]: e.target.value }))}
                      className="h-8 text-xs"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditRow(null)}><X className="mr-1.5 h-4 w-4" /> Cancel</Button>
            <Button onClick={saveEdit}><Save className="mr-1.5 h-4 w-4" /> Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
