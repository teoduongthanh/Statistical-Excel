"use client";

import * as React from "react";
import {
  Download,
  FileSpreadsheet,
  Loader2,
  CheckCheck,
  Boxes,
  Filter,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ALL_FIELDS, FIELD_LABELS, type CanonicalField } from "@/lib/fields";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAppStore, PRODUCT_THEME } from "@/store/app-store";

type Source = "entries" | "master";
type Mode = "all" | "filtered" | "selected";

// Filter fields shared between entries/master sources.
const FILTER_FIELDS: CanonicalField[] = [
  "factoryPO",
  "model",
  "sku",
  "season",
  "size",
  "shippingStatus",
];

/**
 * Product-scoped export view.
 *
 * Same flow as `ExportExcelView` (source → mode → columns → export) but the
 * product is FIXED by the current context. There is no source-product selector
 * — `productType: currentProduct` is always sent as a filter so only the active
 * product's rows are exported.
 */
export function ProductExportView() {
  const { currentProduct } = useAppStore();
  const theme = PRODUCT_THEME[currentProduct];

  const [source, setSource] = React.useState<Source>("entries");
  const [mode, setMode] = React.useState<Mode>("all");
  const [columns, setColumns] = React.useState<Set<CanonicalField>>(new Set(ALL_FIELDS));
  const [filters, setFilters] = React.useState<Record<string, string>>({});
  const [selectedIds, setSelectedIds] = React.useState<string>("");
  const [exporting, setExporting] = React.useState(false);

  // Reset transient state when the product context changes — the filter values
  // and any pasted IDs almost never make sense across products.
  React.useEffect(() => {
    setFilters({});
    setSelectedIds("");
    setMode("all");
  }, [currentProduct]);

  function toggle(c: CanonicalField) {
    setColumns((s) => {
      const n = new Set(s);
      if (n.has(c)) n.delete(c);
      else n.add(c);
      return n;
    });
  }
  function selectAll() {
    setColumns(new Set(ALL_FIELDS));
  }
  function clearAll() {
    setColumns(new Set());
  }

  async function handleExport() {
    if (columns.size === 0) {
      toast.error("Select at least one column");
      return;
    }
    setExporting(true);
    try {
      // Always include productType in the filter so the export is scoped.
      const exportFilters: Record<string, string> = { productType: currentProduct };
      if (mode === "filtered") {
        Object.assign(exportFilters, filters);
      }
      const body: Parameters<typeof api.exportExcel>[0] = {
        source,
        columns: [...columns],
        mode,
        filters: exportFilters,
      };
      if (mode === "selected") {
        const ids = selectedIds
          .split(/[\s,]+/)
          .map((s) => s.trim())
          .filter(Boolean);
        if (ids.length === 0) {
          toast.error("Provide at least one entry ID for 'selected' mode");
          setExporting(false);
          return;
        }
        body.ids = ids;
      }

      const blob = await api.exportExcel(body);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${currentProduct.toLowerCase()}_export_${source}_${new Date()
        .toISOString()
        .slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(
        `Exported ${columns.size} columns from ${currentProduct} ${source}`,
      );
    } catch (e) {
      toast.error("Export failed", { description: e instanceof Error ? e.message : "" });
    } finally {
      setExporting(false);
    }
  }

  // Compute a short summary line for the active configuration.
  const summary = React.useMemo(() => {
    const parts: string[] = [currentProduct, source];
    parts.push(mode === "all" ? "all rows" : mode === "filtered" ? "filtered" : "selected IDs");
    parts.push(`${columns.size} cols`);
    return parts.join(" · ");
  }, [currentProduct, source, mode, columns.size]);

  return (
    <div className="space-y-6">
      {/* Product banner — Exporting from: {currentProduct} */}
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
                The exported workbook will contain only rows tagged as{" "}
                <span className="font-semibold">{currentProduct}</span>. Switch products from the
                sidebar to export from another scope.
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
                  onClick={() => setSource(s)}
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
                  <span>
                    {m === "all"
                      ? "All rows"
                      : m === "filtered"
                      ? "Filtered rows"
                      : "Selected IDs"}
                  </span>
                  {mode === m && <CheckCheck className={cn("h-4 w-4", theme.text)} />}
                </button>
              ))}
              {mode === "filtered" && (
                <div className="mt-2 space-y-2">
                  <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase text-muted-foreground">
                    <Filter className="h-3 w-3" /> Filters (within {currentProduct})
                  </div>
                  {FILTER_FIELDS.map((f) => (
                    <Input
                      key={f}
                      value={filters[f] ?? ""}
                      onChange={(e) =>
                        setFilters((p) => ({ ...p, [f]: e.target.value }))
                      }
                      placeholder={`Filter by ${FIELD_LABELS[f]}…`}
                      className="h-8 text-xs"
                    />
                  ))}
                </div>
              )}
              {mode === "selected" && (
                <div className="mt-2 space-y-2">
                  <div className="text-[10px] font-semibold uppercase text-muted-foreground">
                    Entry IDs (comma or whitespace separated)
                  </div>
                  <textarea
                    value={selectedIds}
                    onChange={(e) => setSelectedIds(e.target.value)}
                    rows={4}
                    placeholder="clxxxxx, clyyyyy…"
                    className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-xs shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring scroll-thin"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Only rows whose <code>id</code> is listed AND tagged as{" "}
                    <strong>{currentProduct}</strong> will be exported.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <Button
            className={cn("w-full", theme.bg, "hover:opacity-90")}
            size="lg"
            onClick={handleExport}
            disabled={exporting || columns.size === 0}
          >
            {exporting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            Export {columns.size} column{columns.size !== 1 ? "s" : ""} from {currentProduct}
          </Button>
        </div>

        {/* Column selection */}
        <div className="lg:col-span-2">
          <Card className="h-full">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center justify-between text-sm">
                <span>3 · Select Columns to Export</span>
                <span className="flex gap-1">
                  <Button variant="ghost" size="sm" onClick={selectAll}>
                    Select all
                  </Button>
                  <Button variant="ghost" size="sm" onClick={clearAll}>
                    Clear
                  </Button>
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {ALL_FIELDS.map((f) => (
                  <label
                    key={f}
                    className={cn(
                      "flex items-center gap-2 rounded-md border px-3 py-2 text-sm cursor-pointer transition-colors",
                      columns.has(f)
                        ? cn(theme.border, "bg-primary/5")
                        : "hover:bg-muted/40",
                    )}
                  >
                    <Checkbox checked={columns.has(f)} onCheckedChange={() => toggle(f)} />
                    <span className="truncate">{FIELD_LABELS[f]}</span>
                  </label>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
