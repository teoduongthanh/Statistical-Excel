"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Download,
  FileSpreadsheet,
  Loader2,
  CheckCheck,
  Boxes,
  Filter,
  Table2,
  Search,
  Eye,
  ChevronLeft,
  ChevronRight,
  Package,
  Pencil,
  Trash2,
  Save,
  X,
  AlertTriangle,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FIELD_LABELS, type CanonicalField } from "@/lib/fields";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAppStore, PRODUCT_THEME } from "@/store/app-store";

type Source = "entries" | "master";
type Mode = "all" | "filtered" | "selected";

// Fixed export column order per spec §24.
const EXPORT_COLUMNS: CanonicalField[] = [
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
];

// Columns shown in the row-preview table (subset for readability).
const PREVIEW_COLUMNS: CanonicalField[] = [
  "shippingStatus",
  "poNo",
  "factoryPO",
  "model",
  "size",
  "qty1",
  "qty2",
  "season",
  "colorCode",
  "deadline",
];

const FILTER_FIELDS: CanonicalField[] = [
  "factoryPO",
  "model",
  "sku",
  "season",
  "size",
  "shippingStatus",
  "poNo",
];

// Fields editable in the Edit dialog (entries only).
const EDITABLE_FIELDS: CanonicalField[] = [
  "shippingStatus",
  "poNo",
  "factoryPO",
  "size",
  "qty1",
  "qty2",
  "model",
  "sku",
  "season",
  "colorCode",
  "colorCode2",
  "painting",
  "printingColor",
  "deadline",
];

export function ProductExportView() {
  const { currentProduct, refreshKey, bumpRefresh } = useAppStore();
  const theme = PRODUCT_THEME[currentProduct];
  const qc = useQueryClient();

  const [source, setSource] = React.useState<Source>("entries");
  const [mode, setMode] = React.useState<Mode>("all");
  const [columns, setColumns] = React.useState<Set<CanonicalField>>(new Set(EXPORT_COLUMNS));
  const [filters, setFilters] = React.useState<Record<string, string>>({});
  const [search, setSearch] = React.useState("");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [pageSize] = React.useState(50);
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [exporting, setExporting] = React.useState(false);

  // Edit / Delete state for entry rows.
  const [editRow, setEditRow] = React.useState<any>(null);
  const [editData, setEditData] = React.useState<Record<string, string>>({});
  const [savingEdit, setSavingEdit] = React.useState(false);
  const [deleteRow, setDeleteRow] = React.useState<any>(null);
  const [deleting, setDeleting] = React.useState(false);
  const [deleteWarn, setDeleteWarn] = React.useState<{ id: string; message: string } | null>(null);

  React.useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setPage(1); }, 400);
    return () => clearTimeout(t);
  }, [search]);

  // Reset selection + filters when product changes.
  React.useEffect(() => {
    setFilters({});
    setSearch("");
    setSelectedIds(new Set());
    setMode("all");
  }, [currentProduct]);

  // Fetch entries (or master) for the row-preview table.
  // Uses the list API which supports productType + filters + pagination.
  const previewParams = {
    productType: currentProduct,
    page,
    pageSize,
    search: debouncedSearch,
    ...filters,
  };

  const entriesQ = useQuery({
    queryKey: ["export-preview-entries", previewParams, refreshKey, source],
    queryFn: () => source === "entries"
      ? api.listEntries(previewParams)
      : api.listMaster(previewParams),
    enabled: source === "entries" || source === "master",
  });

  const rows = entriesQ.data?.rows ?? [];
  const total = entriesQ.data?.total ?? 0;

  function toggleColumn(c: CanonicalField) {
    setColumns((s) => {
      const n = new Set(s);
      if (n.has(c)) n.delete(c);
      else n.add(c);
      return n;
    });
  }
  function selectAllCols() { setColumns(new Set(EXPORT_COLUMNS)); }
  function clearAllCols() { setColumns(new Set()); }

  function toggleRow(id: string) {
    setSelectedIds((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function toggleAllRows() {
    if (selectedIds.size === rows.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(rows.map((r: any) => r.id)));
    }
  }
  function selectAllFiltered() {
    // Add all currently-visible row IDs to the selection.
    setSelectedIds((s) => {
      const n = new Set(s);
      rows.forEach((r: any) => n.add(r.id));
      return n;
    });
  }
  function clearSelection() { setSelectedIds(new Set()); }

  async function handleExport() {
    if (columns.size === 0) {
      toast.error("Select at least one column");
      return;
    }
    if (mode === "selected" && selectedIds.size === 0) {
      toast.error("Select at least one row to export (use the checkboxes in the preview table)");
      return;
    }
    setExporting(true);
    try {
      const exportFilters: Record<string, string> = { productType: currentProduct };
      if (mode === "filtered") {
        Object.assign(exportFilters, filters);
        if (debouncedSearch) exportFilters.search = debouncedSearch;
      }
      const body: Parameters<typeof api.exportExcel>[0] = {
        source,
        columns: [...columns],
        mode,
        filters: exportFilters,
        sortOrder: "asc",
      };
      if (mode === "selected") {
        body.ids = [...selectedIds];
      }

      const blob = await api.exportExcel(body);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${currentProduct.toLowerCase()}_${source}_${mode}_${new Date()
        .toISOString()
        .slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);

      const rowCount = mode === "selected" ? selectedIds.size : mode === "filtered" ? total : total;
      toast.success(
        `Exported ${rowCount} rows × ${columns.size} columns from ${currentProduct}`,
      );
    } catch (e) {
      toast.error("Export failed", { description: e instanceof Error ? e.message : "" });
    } finally {
      setExporting(false);
    }
  }

  // ===== Edit / Delete handlers (entries only) =====
  function openEdit(row: any) {
    setEditRow(row);
    const data: Record<string, string> = {};
    EDITABLE_FIELDS.forEach((f) => { data[f] = row[f] ?? ""; });
    setEditData(data);
  }

  async function saveEdit() {
    if (!editRow) return;
    setSavingEdit(true);
    try {
      await api.updateEntry(editRow.id, editData);
      toast.success("Entry updated");
      setEditRow(null);
      qc.invalidateQueries({ queryKey: ["export-preview-entries"] });
      bumpRefresh();
    } catch (e) {
      toast.error("Update failed", { description: e instanceof Error ? e.message : "" });
    } finally {
      setSavingEdit(false);
    }
  }

  function openDelete(row: any) {
    setDeleteRow(row);
    setDeleteWarn(null);
  }

  async function confirmDelete() {
    if (!deleteRow) return;
    setDeleting(true);
    try {
      // First attempt — may return needsConfirm if the row is part of a transaction group.
      const res = await api.deleteEntry(deleteRow.id, false);
      if (!res.ok && "needsConfirm" in res && res.needsConfirm) {
        setDeleteWarn({ id: deleteRow.id, message: res.needsConfirm.message });
        setDeleting(false);
        return;
      }
      toast.success("Entry deleted");
      setSelectedIds((s) => { const n = new Set(s); n.delete(deleteRow.id); return n; });
      setDeleteRow(null);
      qc.invalidateQueries({ queryKey: ["export-preview-entries"] });
      bumpRefresh();
    } catch (e) {
      toast.error("Delete failed", { description: e instanceof Error ? e.message : "" });
    } finally {
      setDeleting(false);
    }
  }

  async function confirmDeleteGroup() {
    if (!deleteWarn) return;
    setDeleting(true);
    try {
      const res = await api.deleteEntry(deleteWarn.id, true);
      if (res.ok) {
        toast.success("Entry and paired transaction deleted");
        setSelectedIds((s) => { const n = new Set(s); n.delete(deleteWarn.id); return n; });
        setDeleteWarn(null);
        setDeleteRow(null);
        qc.invalidateQueries({ queryKey: ["export-preview-entries"] });
        bumpRefresh();
      } else {
        toast.error("Delete failed");
      }
    } catch (e) {
      toast.error("Delete failed", { description: e instanceof Error ? e.message : "" });
    } finally {
      setDeleting(false);
    }
  }

  // ===== Bulk delete (entries only) — deletes all checked rows at once =====
  const [bulkDeleteOpen, setBulkDeleteOpen] = React.useState(false);
  const [bulkDeleting, setBulkDeleting] = React.useState(false);

  function openBulkDelete() {
    if (selectedIds.size === 0) {
      toast.error("Select at least one row first (use the checkboxes)");
      return;
    }
    setBulkDeleteOpen(true);
  }

  async function confirmBulkDelete() {
    setBulkDeleting(true);
    try {
      const ids = [...selectedIds];
      const res = await api.bulkDeleteEntries(ids);
      if (res.ok) {
        let msg = `${res.deleted} entries deleted`;
        if (res.deleted > ids.length) {
          msg += ` (includes ${res.deleted - ids.length} paired transaction records)`;
        }
        if (res.skipped > 0) {
          msg += ` · ${res.skipped} skipped`;
        }
        toast.success(msg);
        setSelectedIds(new Set());
        setBulkDeleteOpen(false);
        qc.invalidateQueries({ queryKey: ["export-preview-entries"] });
        bumpRefresh();
      } else {
        toast.error("Bulk delete failed");
      }
    } catch (e) {
      toast.error("Bulk delete failed", { description: e instanceof Error ? e.message : "" });
    } finally {
      setBulkDeleting(false);
    }
  }

  const summary = React.useMemo(() => {
    const parts: string[] = [currentProduct, source];
    parts.push(mode === "all" ? "all rows" : mode === "filtered" ? "filtered" : `${selectedIds.size} selected`);
    parts.push(`${columns.size} cols`);
    return parts.join(" · ");
  }, [currentProduct, source, mode, columns.size, selectedIds.size]);

  return (
    <div className="space-y-6">
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
                Export Wizard
              </p>
              <h1 className="text-2xl font-bold tracking-tight">
                Exporting from: {currentProduct}
              </h1>
              <p className="text-xs text-white/80">
                Preview the rows, select which ones to export, choose columns, then download.
              </p>
            </div>
          </div>
          <Badge
            variant="secondary"
            className="bg-white/20 text-white border-0 font-mono text-[10px]"
          >
            {summary}
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Config */}
        <div className="lg:col-span-1 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center justify-between text-sm">
                <span>1 · Data Source</span>
                <Badge variant="outline" className={cn("text-[10px]", theme.badge)}>
                  {currentProduct}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {(["entries", "master"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => { setSource(s); setSelectedIds(new Set()); setPage(1); }}
                  className={cn(
                    "flex w-full items-center justify-between rounded-md border px-3 py-2 text-sm transition-colors",
                    source === s
                      ? cn(theme.border, "bg-primary/5")
                      : "hover:bg-muted/40",
                  )}
                >
                  <span className="flex items-center gap-2">
                    <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
                    {s === "entries" ? "Entry Data" : "Master Data"}
                  </span>
                  {source === s && <CheckCheck className={cn("h-4 w-4", theme.text)} />}
                </button>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">2 · Export Mode</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {(["all", "filtered", "selected"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={cn(
                    "flex w-full items-center justify-between rounded-md border px-3 py-2 text-sm transition-colors",
                    mode === m
                      ? cn(theme.border, "bg-primary/5")
                      : "hover:bg-muted/40",
                  )}
                >
                  <span className="flex items-center gap-2">
                    {m === "selected" && <Eye className="h-3.5 w-3.5 text-muted-foreground" />}
                    {m === "all" ? "All rows" : m === "filtered" ? "Filtered rows" : "Selected rows (pick from table)"}
                  </span>
                  {mode === m && <CheckCheck className={cn("h-4 w-4", theme.text)} />}
                </button>
              ))}
              {mode === "selected" && (
                <div className="mt-2 rounded-md border bg-muted/30 p-2.5 text-xs">
                  <div className="font-medium">{selectedIds.size} row(s) selected</div>
                  <p className="text-muted-foreground mt-0.5">
                    Use the checkboxes in the preview table to pick rows. Only selected rows will be exported.
                  </p>
                  <div className="flex gap-1.5 mt-2">
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={selectAllFiltered}>
                      Select visible
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={clearSelection}>
                      Clear
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center justify-between text-sm">
                <span>3 · Columns ({columns.size})</span>
                <span className="flex gap-1">
                  <Button variant="ghost" size="sm" onClick={selectAllCols}>All</Button>
                  <Button variant="ghost" size="sm" onClick={clearAllCols}>Clear</Button>
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-1.5">
                {EXPORT_COLUMNS.map((f) => (
                  <label
                    key={f}
                    className={cn(
                      "flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs cursor-pointer transition-colors",
                      columns.has(f)
                        ? cn(theme.border, "bg-primary/5")
                        : "hover:bg-muted/40",
                    )}
                  >
                    <Checkbox checked={columns.has(f)} onCheckedChange={() => toggleColumn(f)} />
                    <span className="truncate">{FIELD_LABELS[f]}</span>
                  </label>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground mt-2">
                Column order is fixed per spec: Date → Shipping status → MODEL → … → Dead Line.
              </p>
            </CardContent>
          </Card>

          <Button
            className={cn("w-full", theme.bg, "hover:opacity-90")}
            size="lg"
            onClick={handleExport}
            disabled={exporting || columns.size === 0 || (mode === "selected" && selectedIds.size === 0)}
          >
            {exporting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            Export {mode === "selected" ? `${selectedIds.size} rows` : total.toLocaleString()} rows
          </Button>
        </div>

        {/* Row preview table */}
        <div className="lg:col-span-2">
          <Card className="h-full">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  <Table2 className="h-4 w-4 text-primary" /> Row Preview
                  {entriesQ.isFetching && <Badge variant="secondary" className="text-[10px]">loading…</Badge>}
                </span>
                <span className="flex items-center gap-2">
                  {source === "entries" && selectedIds.size > 0 && (
                    <Button
                      size="sm"
                      variant="destructive"
                      className="h-7 text-xs"
                      onClick={openBulkDelete}
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-1" />
                      Delete Selected ({selectedIds.size})
                    </Button>
                  )}
                  <span className="text-xs text-muted-foreground">{total.toLocaleString()} rows total</span>
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {/* Search + filters */}
              <div className="border-b px-3 py-2 space-y-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search rows…"
                    className="pl-9 h-9 text-sm"
                  />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Filter className="h-3.5 w-3.5 text-muted-foreground self-center" />
                  {FILTER_FIELDS.map((f) => (
                    <Input
                      key={f}
                      value={filters[f] ?? ""}
                      onChange={(e) => { setFilters((p) => ({ ...p, [f]: e.target.value })); setPage(1); }}
                      placeholder={FIELD_LABELS[f]}
                      className="h-7 w-28 text-[11px]"
                    />
                  ))}
                </div>
              </div>

              {/* Table */}
              <div className="overflow-x-auto scroll-thin">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40 sticky top-0">
                    <tr>
                      <th className="px-2 py-2 w-8">
                        <Checkbox
                          checked={rows.length > 0 && selectedIds.size === rows.length}
                          onCheckedChange={toggleAllRows}
                        />
                      </th>
                      <th className="px-2 py-2 text-left text-[10px] font-semibold uppercase text-muted-foreground">#</th>
                      {PREVIEW_COLUMNS.map((c) => (
                        <th key={c} className="px-2 py-2 text-left text-[10px] font-semibold uppercase text-muted-foreground whitespace-nowrap">
                          {FIELD_LABELS[c]}
                        </th>
                      ))}
                      {source === "entries" && (
                        <th className="px-2 py-2 text-right text-[10px] font-semibold uppercase text-muted-foreground">Actions</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {entriesQ.isLoading ? (
                      Array.from({ length: 8 }).map((_, i) => (
                        <tr key={i} className="border-t">
                          <td colSpan={PREVIEW_COLUMNS.length + 2 + (source === "entries" ? 1 : 0)} className="px-3 py-3">
                            <div className="h-3 w-full animate-pulse rounded bg-muted" />
                          </td>
                        </tr>
                      ))
                    ) : rows.length === 0 ? (
                      <tr>
                        <td colSpan={PREVIEW_COLUMNS.length + 2 + (source === "entries" ? 1 : 0)} className="px-3 py-10 text-center text-muted-foreground">
                          No {source} found for {currentProduct}.
                        </td>
                      </tr>
                    ) : (
                      rows.map((r: any, i) => {
                        const isSelected = selectedIds.has(r.id);
                        return (
                          <tr
                            key={r.id}
                            onClick={() => mode === "selected" && toggleRow(r.id)}
                            className={cn(
                              "border-t hover:bg-muted/30 transition-colors",
                              isSelected && "bg-primary/5",
                              mode === "selected" && "cursor-pointer",
                            )}
                          >
                            <td className="px-2 py-1.5">
                              <Checkbox
                                checked={isSelected}
                                onCheckedChange={() => toggleRow(r.id)}
                                onClick={(e) => e.stopPropagation()}
                              />
                            </td>
                            <td className="px-2 py-1.5 text-muted-foreground tabular-nums">{(page - 1) * pageSize + i + 1}</td>
                            {PREVIEW_COLUMNS.map((c) => (
                              <td key={c} className="px-2 py-1.5 whitespace-nowrap max-w-[180px] truncate" title={r[c] ?? ""}>
                                {c === "shippingStatus" ? (
                                  <Badge
                                    variant="outline"
                                    className={cn("text-[9px]", shippingBadgeClass(r[c]))}
                                  >
                                    {r[c] || "—"}
                                  </Badge>
                                ) : c === "factoryPO" ? (
                                  <span className="font-medium text-primary">{r[c]}</span>
                                ) : c === "size" ? (
                                  <Badge variant="outline" className="text-[9px] font-mono">{r[c]}</Badge>
                                ) : c === "qty2" ? (
                                  <span className={cn("tabular-nums", Number(r[c]) < 0 && "text-rose-600")}>{r[c]}</span>
                                ) : r[c] ? (
                                  r[c]
                                ) : (
                                  <span className="text-muted-foreground/40">—</span>
                                )}
                              </td>
                            ))}
                            {source === "entries" && (
                              <td className="px-2 py-1.5 text-right">
                                <div className="flex justify-end gap-0.5">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7"
                                    onClick={(e) => { e.stopPropagation(); openEdit(r); }}
                                    title="Edit"
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 text-destructive hover:text-destructive"
                                    onClick={(e) => { e.stopPropagation(); openDelete(r); }}
                                    title="Delete"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              </td>
                            )}
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between border-t px-3 py-2">
                <span className="text-xs text-muted-foreground">
                  Page {page} of {entriesQ.data?.totalPages ?? 1}
                  {mode === "selected" && selectedIds.size > 0 && (
                    <span className="ml-2 text-primary font-medium">· {selectedIds.size} selected</span>
                  )}
                </span>
                <div className="flex gap-1">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button variant="outline" size="sm" disabled={page >= (entriesQ.data?.totalPages ?? 1)} onClick={() => setPage((p) => p + 1)}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Edit dialog (entries only) */}
      <Dialog open={!!editRow} onOpenChange={(o) => !o && setEditRow(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto scroll-thin">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-4 w-4 text-primary" /> Edit Entry
            </DialogTitle>
            <DialogDescription>
              Edit this entry row. Changes only affect Entry Data — Master Data is not modified.
            </DialogDescription>
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
            <Button variant="outline" onClick={() => setEditRow(null)}>
              <X className="h-4 w-4 mr-1.5" /> Cancel
            </Button>
            <Button onClick={saveEdit} disabled={savingEdit}>
              {savingEdit ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Save className="h-4 w-4 mr-1.5" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation (entries only) */}
      <AlertDialog open={!!deleteRow && !deleteWarn} onOpenChange={(o) => { if (!o) { setDeleteRow(null); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-destructive" /> Delete Entry
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this entry?
              {deleteRow && (
                <span className="mt-2 block text-xs font-mono bg-muted/40 rounded p-2">
                  {deleteRow.shippingStatus} · {deleteRow.factoryPO} · {deleteRow.size} · Qty1={deleteRow.qty1} Qty2={deleteRow.qty2}
                </span>
              )}
              {deleteRow?.transactionGroupId && (
                <span className="mt-2 block text-xs text-amber-600">
                  ⚠ This entry is part of an Output+Pending transaction group. Deleting it may leave the paired record orphaned.
                  You will be asked to confirm deleting both.
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

      {/* Delete group confirmation (Output+Pending pair) */}
      <AlertDialog open={!!deleteWarn} onOpenChange={(o) => { if (!o) { setDeleteWarn(null); setDeleteRow(null); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" /> Delete Both Records?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteWarn?.message}
              <span className="mt-2 block text-xs">
                This will delete both the Output entry and its paired Pending entry (same transaction group).
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); confirmDeleteGroup(); }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Trash2 className="h-4 w-4 mr-1.5" />}
              Delete Both
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk delete confirmation — deletes all checked rows */}
      <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" /> Delete {selectedIds.size} Selected Entries?
            </AlertDialogTitle>
            <AlertDialogDescription>
              You are about to delete <strong>{selectedIds.size}</strong> entry row(s).
              {selectedIds.size > 0 && (
                <span className="mt-2 block text-xs text-amber-600">
                  ⚠ Any selected entry that belongs to an Output+Pending transaction group
                  will have its paired record deleted too. This action cannot be undone.
                </span>
              )}
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
              Delete {selectedIds.size} Entries
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
