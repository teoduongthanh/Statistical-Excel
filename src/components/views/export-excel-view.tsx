"use client";

import * as React from "react";
import { Download, FileSpreadsheet, Loader2, CheckCheck } from "lucide-react";
import { api } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { ALL_FIELDS, FIELD_LABELS, type CanonicalField } from "@/lib/fields";
import { toast } from "sonner";

export function ExportExcelView() {
  const [source, setSource] = React.useState<"entries" | "master">("entries");
  const [mode, setMode] = React.useState<"all" | "filtered">("all");
  const [columns, setColumns] = React.useState<Set<CanonicalField>>(new Set(ALL_FIELDS));
  const [filters, setFilters] = React.useState<Record<string, string>>({});
  const [exporting, setExporting] = React.useState(false);

  const filterFields: CanonicalField[] = source === "entries"
    ? ["factoryPO", "model", "sku", "season", "size", "shippingStatus"]
    : ["factoryPO", "model", "sku", "season", "size", "shippingStatus"];

  function toggle(c: CanonicalField) {
    setColumns((s) => {
      const n = new Set(s);
      if (n.has(c)) n.delete(c);
      else n.add(c);
      return n;
    });
  }
  function selectAll() { setColumns(new Set(ALL_FIELDS)); }
  function clearAll() { setColumns(new Set()); }

  async function handleExport() {
    if (columns.size === 0) {
      toast.error("Select at least one column");
      return;
    }
    setExporting(true);
    try {
      const blob = await api.exportExcel({
        source,
        columns: [...columns],
        mode,
        filters: mode === "filtered" ? filters : undefined,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `export_${source}_${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Exported ${columns.size} columns from ${source}`);
    } catch (e) {
      toast.error("Export failed", { description: e instanceof Error ? e.message : "" });
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      {/* Config */}
      <div className="lg:col-span-1 space-y-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">1 · Data Source</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(["entries", "master"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSource(s)}
                className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-sm transition-colors ${
                  source === s ? "border-primary bg-primary/5" : "hover:bg-muted/40"
                }`}
              >
                <span className="flex items-center gap-2">
                  <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
                  {s === "entries" ? "Entry Data" : "Master Data"}
                </span>
                {source === s && <CheckCheck className="h-4 w-4 text-primary" />}
              </button>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">2 · Export Mode</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(["all", "filtered"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-sm transition-colors ${
                  mode === m ? "border-primary bg-primary/5" : "hover:bg-muted/40"
                }`}
              >
                <span>{m === "all" ? "All rows" : "Filtered rows"}</span>
                {mode === m && <CheckCheck className="h-4 w-4 text-primary" />}
              </button>
            ))}
            {mode === "filtered" && (
              <div className="mt-2 space-y-2">
                {filterFields.map((f) => (
                  <Input
                    key={f}
                    value={filters[f] ?? ""}
                    onChange={(e) => setFilters((p) => ({ ...p, [f]: e.target.value }))}
                    placeholder={`Filter by ${FIELD_LABELS[f]}…`}
                    className="h-8 text-xs"
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Button className="w-full" size="lg" onClick={handleExport} disabled={exporting || columns.size === 0}>
          {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
          Export {columns.size} column{columns.size !== 1 ? "s" : ""}
        </Button>
      </div>

      {/* Column selection */}
      <div className="lg:col-span-2">
        <Card className="h-full">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between text-sm">
              <span>3 · Select Columns to Export</span>
              <span className="flex gap-1">
                <Button variant="ghost" size="sm" onClick={selectAll}>Select all</Button>
                <Button variant="ghost" size="sm" onClick={clearAll}>Clear</Button>
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {ALL_FIELDS.map((f) => (
                <label
                  key={f}
                  className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm cursor-pointer transition-colors ${
                    columns.has(f) ? "border-primary bg-primary/5" : "hover:bg-muted/40"
                  }`}
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
  );
}
