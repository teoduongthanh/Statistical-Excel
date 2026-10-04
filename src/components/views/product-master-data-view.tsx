"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Database,
  Search,
  Filter,
  ChevronLeft,
  ChevronRight,
  Download,
  Pencil,
  Trash2,
  Save,
  X,
  Package,
  Boxes,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
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
import { toast } from "sonner";
import { FIELD_LABELS, type CanonicalField } from "@/lib/fields";
import { cn, formatDateDisplay } from "@/lib/utils";
import { useAppStore, PRODUCT_THEME } from "@/store/app-store";

// Master data columns displayed in the table. productType is intentionally
// omitted — the entire view is scoped to a single product so showing the same
// value on every row would be noise.
const COLUMNS: CanonicalField[] = [
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

const FILTER_FIELDS: CanonicalField[] = [
  "factoryPO",
  "model",
  "sku",
  "poNo",
  "season",
  "colorCode",
  "size",
  "shippingStatus",
];

const EDITABLE_FIELDS: CanonicalField[] = [
  "date",
  "shippingStatus",
  "model",
  "sku",
  "poNo",
  "factoryPO",
  "item",
  "season",
  "colorCode",
  "colorCode2",
  "painting",
  "printingColor",
  "size",
  "qty1",
  "qty2",
  "deadline",
  "productType",
];

/**
 * Product-scoped master data browser.
 *
 * Like `MasterDataView` but the product is fixed by context (`currentProduct`
 * from the Zustand store). All list/export API calls include
 * `productType: currentProduct` so only rows belonging to the active product
 * are shown — no productType filter dropdown needed.
 */
export function ProductMasterDataView({ statusFilter }: { statusFilter?: string }) {
  const qc = useQueryClient();
  const { currentProduct, refreshKey, bumpRefresh } = useAppStore();
  const theme = PRODUCT_THEME[currentProduct];

  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(20);
  const [search, setSearch] = React.useState("");
  const [filters, setFilters] = React.useState<Record<string, string>>({});
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  const [sort, setSort] = React.useState<{ key: string; order: "asc" | "desc" }>({
    key: "factoryPO",
    order: "asc",
  });
  const [editRow, setEditRow] = React.useState<any>(null);
  const [editData, setEditData] = React.useState<Record<string, string>>({});
  const [savingEdit, setSavingEdit] = React.useState(false);
  const [deleteRow, setDeleteRow] = React.useState<any>(null);
  const [deleting, setDeleting] = React.useState(false);
  // Bulk select + bulk delete
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = React.useState(false);
  const [bulkDeleting, setBulkDeleting] = React.useState(false);

  React.useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 400);
    return () => clearTimeout(t);
  }, [search]);

  // Reset paging/filters when the product context changes — different product
  // means different row counts and sort orders.
  React.useEffect(() => {
    setPage(1);
    setSearch("");
    setDebouncedSearch("");
    setFilters({});
  }, [currentProduct]);

  const params = {
    page,
    pageSize,
    search: debouncedSearch,
    ...filters,
    productType: currentProduct,
    shippingStatus: statusFilter || undefined,
    sort: sort.key,
    order: sort.order,
  };

  const q = useQuery({
    queryKey: ["product-master-data", currentProduct, params, refreshKey],
    queryFn: () => api.listMaster(params),
  });

  function toggleSort(key: string) {
    setSort((s) =>
      s.key === key ? { key, order: s.order === "asc" ? "desc" : "asc" } : { key, order: "asc" }
    );
  }

  async function handleExport() {
    try {
      const blob = await api.exportExcel({
        source: "master",
        columns: COLUMNS,
        mode: "filtered",
        filters: { search: debouncedSearch, ...filters, productType: currentProduct },
        sortOrder: "asc",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${currentProduct.toLowerCase()}_master_data_${new Date()
        .toISOString()
        .slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`${currentProduct} master data exported`);
    } catch (e) {
      toast.error("Export failed", { description: e instanceof Error ? e.message : "" });
    }
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
    setSavingEdit(true);
    try {
      await api.updateMasterRow(editRow.id, { ...editData, productType: currentProduct });
      toast.success(`${currentProduct} master data row updated`);
      setEditRow(null);
      qc.invalidateQueries({ queryKey: ["product-master-data"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      bumpRefresh();
    } catch (e) {
      toast.error("Update failed", { description: e instanceof Error ? e.message : "" });
    } finally {
      setSavingEdit(false);
    }
  }

  function openDelete(row: any) {
    setDeleteRow(row);
  }

  async function confirmDelete() {
    if (!deleteRow) return;
    setDeleting(true);
    try {
      await api.deleteMasterRow(deleteRow.id);
      toast.success(`${currentProduct} master data row deleted`);
      setSelectedIds((s) => { const n = new Set(s); n.delete(deleteRow.id); return n; });
      setDeleteRow(null);
      qc.invalidateQueries({ queryKey: ["product-master-data"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      bumpRefresh();
    } catch (e) {
      toast.error("Delete failed", { description: e instanceof Error ? e.message : "" });
    } finally {
      setDeleting(false);
    }
  }

  // Bulk select handlers
  function toggleRow(id: string) {
    setSelectedIds((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function toggleAllRows() {
    if (selectedIds.size === rows.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(rows.map((r: any) => r.id)));
  }

  async function confirmBulkDelete() {
    setBulkDeleting(true);
    try {
      const ids = [...selectedIds];
      let deleted = 0;
      for (const id of ids) {
        await api.deleteMasterRow(id);
        deleted++;
      }
      toast.success(`${deleted} master data rows deleted`);
      setSelectedIds(new Set());
      setBulkDeleteOpen(false);
      qc.invalidateQueries({ queryKey: ["product-master-data"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      bumpRefresh();
    } catch (e) {
      toast.error("Bulk delete failed", { description: e instanceof Error ? e.message : "" });
    } finally {
      setBulkDeleting(false);
    }
  }

  const rows = q.data?.rows ?? [];
  const total = q.data?.total ?? 0;

  return (
    <div className="space-y-4">
      {/* Product banner */}
      <div
        className={cn(
          "relative overflow-hidden rounded-xl border bg-gradient-to-r p-5 text-white shadow-sm",
          theme.gradient,
        )}
      >
        <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-white/10" />
        <div className="absolute -bottom-10 right-24 h-32 w-32 rounded-full bg-white/5" />
        <div className="relative flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/15 backdrop-blur">
              <Boxes className="h-6 w-6" />
            </div>
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider text-white/80">
                Master Data
              </p>
              <h1 className="text-2xl font-bold tracking-tight">{currentProduct}</h1>
              <p className="text-xs text-white/80">
                Browsing rows scoped to{" "}
                <span className="font-semibold">{currentProduct}</span>. Use the sidebar switcher to
                change product context.
              </p>
            </div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleExport}
            disabled={q.isFetching}
            className="h-9 bg-white/20 text-white hover:bg-white/30 hover:text-white"
          >
            <Download className="mr-1.5 h-3.5 w-3.5" /> Export {currentProduct}
          </Button>
        </div>
      </div>

      {/* Filter bar */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[240px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={`Search across ${currentProduct} Factory PO, SKU, MODEL, Season…`}
                className="pl-9 h-10"
              />
            </div>
            <Badge variant="outline" className={cn("text-[10px]", theme.badge)}>
              <Package className="h-2.5 w-2.5 mr-0.5" /> {currentProduct}
            </Badge>
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
              <Database className={cn("h-4 w-4", theme.text)} />
              <span className="font-medium">{total.toLocaleString()}</span>
              <span className="text-muted-foreground">rows in {currentProduct}</span>
              {q.isFetching && <Badge variant="secondary" className="text-[10px]">loading…</Badge>}
            </div>
            <div className="flex items-center gap-2">
              {selectedIds.size > 0 && (
                <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={() => setBulkDeleteOpen(true)}>
                  <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete Selected ({selectedIds.size})
                </Button>
              )}
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Filter className="h-3.5 w-3.5" />
                <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
                className="rounded border bg-transparent px-1 py-0.5"
              >
                {[20, 50, 100, 200].map((n) => (
                  <option key={n} value={n}>
                    {n}/page
                  </option>
                ))}
              </select>
              </div>
            </div>
          </div>
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full text-xs">
              <thead className="bg-muted/40">
                <tr>
                  <th className="px-2 py-2 w-8">
                    <Checkbox
                      checked={rows.length > 0 && selectedIds.size === rows.length}
                      onCheckedChange={toggleAllRows}
                    />
                  </th>
                  <th className="px-2 py-2 text-left text-[10px] font-semibold uppercase text-muted-foreground">
                    #
                  </th>
                  {COLUMNS.map((c) => (
                    <th
                      key={c}
                      onClick={() => toggleSort(c)}
                      className="cursor-pointer whitespace-nowrap px-3 py-2 text-left text-[10px] font-semibold uppercase text-muted-foreground hover:text-foreground"
                    >
                      {FIELD_LABELS[c]}
                      {sort.key === c && (
                        <span className="ml-1">{sort.order === "asc" ? "▲" : "▼"}</span>
                      )}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase text-muted-foreground">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {q.isLoading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="border-t">
                      <td colSpan={COLUMNS.length + 3} className="px-3 py-3">
                        <div className="h-3 w-full animate-pulse rounded bg-muted" />
                      </td>
                    </tr>
                  ))
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={COLUMNS.length + 3} className="px-3 py-10 text-center text-muted-foreground">
                      No {currentProduct} master data rows found.
                    </td>
                  </tr>
                ) : (
                  rows.map((r: any, i) => {
                    const isSelected = selectedIds.has(r.id);
                    return (
                    <tr key={r.id} className={cn("border-t hover:bg-muted/30 group", isSelected && "bg-primary/5")}>
                      <td className="px-2 py-1.5">
                        <Checkbox checked={isSelected} onCheckedChange={() => toggleRow(r.id)} />
                      </td>
                      <td className="px-2 py-1.5 text-muted-foreground tabular-nums">
                        {(page - 1) * pageSize + i + 1}
                      </td>
                      {COLUMNS.map((c) => (
                        <td
                          key={c}
                          className="px-3 py-1.5 whitespace-nowrap max-w-[220px] truncate"
                          title={r[c] ?? ""}
                        >
                          {c === "factoryPO" ? (
                            <span className={cn("font-medium", theme.text)}>{r[c]}</span>
                          ) : c === "size" ? (
                            <Badge variant="outline" className="font-mono text-[10px]">
                              {r[c]}
                            </Badge>
                          ) : c === "date" || c === "deadline" ? (
                            r[c] ? (
                              <span className="tabular-nums">{formatDateDisplay(r[c])}</span>
                            ) : (
                              <span className="text-muted-foreground/40">—</span>
                            )
                          ) : r[c] ? (
                            r[c]
                          ) : (
                            <span className="text-muted-foreground/40">—</span>
                          )}
                        </td>
                      ))}
                      <td className="px-3 py-1.5">
                        <div className="flex justify-end gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => openEdit(r)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            onClick={() => openDelete(r)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
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
            <span className="text-xs text-muted-foreground">
              Page {page} of {q.data?.totalPages ?? 1}
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= (q.data?.totalPages ?? 1)}
                onClick={() => setPage((p) => p + 1)}
              >
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
              <Pencil className={cn("h-4 w-4", theme.text)} /> Edit {currentProduct} Master Data Row
              <Badge variant="outline" className={cn("ml-1 text-[10px]", theme.badge)}>
                {currentProduct}
              </Badge>
            </DialogTitle>
          </DialogHeader>
          {editRow && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                {EDITABLE_FIELDS.map((f) => (
                  <div key={f} className="space-y-1">
                    <label className="text-[10px] font-semibold uppercase text-muted-foreground">
                      {FIELD_LABELS[f]}
                    </label>
                    <Input
                      value={editData[f] ?? ""}
                      onChange={(e) =>
                        setEditData((d) => ({ ...d, [f]: e.target.value }))
                      }
                      className="h-8 text-xs"
                      inputMode={f === "qty1" || f === "qty2" ? "numeric" : undefined}
                      disabled={f === "productType"}
                    />
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">
                Product Type is locked to <span className="font-semibold">{currentProduct}</span> by
                context — use the sidebar product switcher to edit rows for another product.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditRow(null)}>
              <X className="mr-1.5 h-4 w-4" /> Cancel
            </Button>
            <Button onClick={saveEdit} disabled={savingEdit} className={cn(theme.bg, "hover:opacity-90")}>
              {savingEdit ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />} Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Single delete confirmation */}
      <AlertDialog open={!!deleteRow} onOpenChange={(o) => { if (!o) setDeleteRow(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-destructive" /> Delete Master Data Row
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this {currentProduct} master data row?
              This will also rebuild the Factory PO index.
              {deleteRow && (
                <span className="mt-2 block text-xs font-mono bg-muted/40 rounded p-2">
                  {deleteRow.shippingStatus || "—"} · {deleteRow.factoryPO} · {deleteRow.size} · Qty1={deleteRow.qty1}
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

      {/* Bulk delete confirmation */}
      <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" /> Delete {selectedIds.size} Selected Rows?
            </AlertDialogTitle>
            <AlertDialogDescription>
              You are about to delete <strong>{selectedIds.size}</strong> master data row(s).
              <span className="mt-2 block text-xs text-amber-600">
                ⚠ This will also rebuild the Factory PO index. This action cannot be undone.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); confirmBulkDelete(); }}
              disabled={bulkDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {bulkDeleting ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Trash2 className="h-4 w-4 mr-1.5" />}
              Delete {selectedIds.size} Rows
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
