"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Upload,
  FileSpreadsheet,
  Sheet,
  Table2,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Boxes,
  ShieldAlert,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { mappingOptions } from "@/lib/header-normalize";
import type { ParseResult } from "@/types";
import { type CanonicalField, FIELD_LABELS } from "@/lib/fields";
import { cn } from "@/lib/utils";
import { useAppStore, PRODUCT_THEME } from "@/store/app-store";
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

// Browser-safe ArrayBuffer → base64 conversion (chunked to avoid call stack limits).
function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return btoa(binary);
}

/**
 * Product-scoped import wizard.
 *
 * Same flow as `ImportExcelView` (upload → sheet → mapping → preview → import)
 * but the product is FIXED by the user's current context (`currentProduct`).
 * There is no product selector — a confirmation dialog reminds the user which
 * product they're about to write into before the API call fires.
 */
export function ProductImportView() {
  const qc = useQueryClient();
  const { currentProduct, bumpRefresh, setView } = useAppStore();
  const theme = PRODUCT_THEME[currentProduct];

  const [file, setFile] = React.useState<File | null>(null);
  const [sheet, setSheet] = React.useState("");
  const [parsing, setParsing] = React.useState(false);
  const [parseResult, setParseResult] = React.useState<
    (ParseResult & { autoMapping: Record<string, CanonicalField | ""> }) | null
  >(null);
  const [mapping, setMapping] = React.useState<Record<string, CanonicalField | "">>({});
  const [replace, setReplace] = React.useState(false);
  const [importing, setImporting] = React.useState(false);
  const [result, setResult] = React.useState<any>(null);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const options = mappingOptions();

  async function handleFile(f: File) {
    setFile(f);
    setResult(null);
    setParsing(true);
    try {
      const r = await api.parseExcel(f);
      setParseResult(r);
      setSheet(r.selectedSheet);
      setMapping(r.autoMapping);
      toast.success(`Parsed "${f.name}"`, {
        description: `${r.sheets.length} sheets · ${r.totalRows} rows`,
      });
    } catch (e) {
      toast.error("Parse failed", { description: e instanceof Error ? e.message : "" });
    } finally {
      setParsing(false);
    }
  }

  async function switchSheet(name: string) {
    if (!file) return;
    setSheet(name);
    setParsing(true);
    try {
      const r = await api.parseExcel(file, name);
      setParseResult(r);
      setMapping(r.autoMapping);
    } catch {
      toast.error("Sheet parse failed");
    } finally {
      setParsing(false);
    }
  }

  function requestImport() {
    if (!file || !parseResult) return;
    if (mappedCount === 0) {
      toast.error("Map at least one column before importing");
      return;
    }
    setConfirmOpen(true);
  }

  async function confirmAndImport() {
    if (!file || !parseResult) return;
    setConfirmOpen(false);
    setImporting(true);
    setResult(null);
    try {
      const buf = await file.arrayBuffer();
      const base64 = arrayBufferToBase64(buf);
      const r = (await api.importExcel({
        fileName: file.name,
        sheetName: sheet,
        fileBase64: base64,
        mapping,
        replaceExisting: replace,
        productType: currentProduct,
      })) as {
        ok: boolean;
        inserted?: number;
        validRows?: number;
        invalidRows?: number;
        totalRows?: number;
        errors?: { row: number; message: string }[];
      };
      setResult(r);
      if (r.ok) {
        toast.success(`Imported ${r.inserted ?? 0} rows into ${currentProduct}`, {
          description: `${r.validRows ?? 0} valid · ${r.invalidRows ?? 0} invalid`,
        });
        bumpRefresh();
        qc.invalidateQueries({ queryKey: ["dashboard"] });
        qc.invalidateQueries({ queryKey: ["product-master-data"] });
        qc.invalidateQueries({ queryKey: ["master-data"] });
      }
    } catch (e) {
      toast.error("Import failed", { description: e instanceof Error ? e.message : "" });
    } finally {
      setImporting(false);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  }

  const mappedCount = Object.values(mapping).filter(Boolean).length;

  return (
    <div className="space-y-6">
      {/* Product banner — Importing into: {currentProduct} */}
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
                Import Wizard
              </p>
              <h1 className="text-2xl font-bold tracking-tight">
                Importing into: {currentProduct}
              </h1>
              <p className="text-xs text-white/80">
                Every parsed row will be tagged as{" "}
                <span className="font-semibold">{currentProduct}</span>. Switch products from the
                sidebar to import into a different scope.
              </p>
            </div>
          </div>
          {file && (
            <Badge
              variant="secondary"
              className="bg-white/20 text-white border-0 truncate max-w-[240px]"
              title={file.name}
            >
              <FileSpreadsheet className="h-3 w-3 mr-1 shrink-0" />
              <span className="truncate">{file.name}</span>
            </Badge>
          )}
        </div>
      </div>

      {/* Step 1: Upload */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <span
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded-full text-xs text-white",
                theme.bg,
              )}
            >
              1
            </span>
            Upload Excel File
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/30 p-8 text-center transition-colors hover:bg-primary/5",
              `hover:${theme.border}`,
            )}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            />
            {file ? (
              <div className="flex flex-col items-center gap-2">
                <FileSpreadsheet className={cn("h-10 w-10", theme.text)} />
                <div className="text-sm font-medium">{file.name}</div>
                <div className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(1)} KB</div>
              </div>
            ) : parsing ? (
              <div className="flex flex-col items-center gap-2">
                <Loader2 className={cn("h-8 w-8 animate-spin", theme.text)} />
                <span className="text-sm text-muted-foreground">Parsing…</span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <Upload className="h-8 w-8 text-muted-foreground" />
                <div className="text-sm font-medium">Drop file or click to browse</div>
                <div className="text-xs text-muted-foreground">
                  Supports .xlsx, .xls, .csv · rows will be tagged as {currentProduct}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Step 2: Sheet + mapping */}
      {parseResult && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <span
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-full text-xs text-white",
                  theme.bg,
                )}
              >
                2
              </span>
              Select Sheet &amp; Map Columns
              <Badge variant="outline" className={cn("ml-auto text-[10px]", theme.badge)}>
                {currentProduct}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Sheet selector */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 text-sm">
                <Sheet className="h-4 w-4 text-muted-foreground" /> Sheet:
              </div>
              <Select value={sheet} onValueChange={switchSheet}>
                <SelectTrigger className="w-64 h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {parseResult.sheets.map((s) => (
                    <SelectItem key={s.name} value={s.name}>
                      {s.name} ({s.totalRows} rows)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Badge variant="secondary">{parseResult.totalRows.toLocaleString()} rows</Badge>
              <Badge variant="outline" className={cn(theme.badge)}>
                {mappedCount}/{Object.keys(mapping).length} mapped
              </Badge>
            </div>

            {/* Mapping table */}
            <div className="overflow-x-auto scroll-thin rounded-md border">
              <table className="w-full text-xs">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase text-muted-foreground">
                      Excel Column
                    </th>
                    <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase text-muted-foreground">
                      Sample Value
                    </th>
                    <th className="px-3 py-2 w-8 text-center"></th>
                    <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase text-muted-foreground">
                      System Field
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {parseResult.headers.map((h) => {
                    const sample = parseResult.preview[0]?.[h] ?? "";
                    return (
                      <tr key={h} className="border-t">
                        <td className="px-3 py-1.5 font-medium">{h}</td>
                        <td className="px-3 py-1.5 text-muted-foreground max-w-[280px] truncate" title={sample}>
                          {sample}
                        </td>
                        <td className="px-3 py-1.5 text-center text-muted-foreground">
                          <ArrowRight className="h-3 w-3 inline" />
                        </td>
                        <td className="px-3 py-1.5">
                          <Select
                            value={mapping[h] ?? ""}
                            onValueChange={(v) =>
                              setMapping((m) => ({ ...m, [h]: v as CanonicalField | "" }))
                            }
                          >
                            <SelectTrigger className="h-8 w-48 text-xs">
                              <SelectValue placeholder="(skip)" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="">— Skip —</SelectItem>
                              {options.map((o) => (
                                <SelectItem key={o.value} value={o.value}>
                                  {o.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Options + import */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={replace} onCheckedChange={setReplace} />
                <span>Replace existing rows from same file</span>
              </label>
              <Button
                onClick={requestImport}
                disabled={importing || mappedCount === 0}
                className={cn(theme.bg, "hover:opacity-90")}
              >
                {importing ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="mr-1.5 h-4 w-4" />
                )}
                Import to {currentProduct}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3: preview */}
      {parseResult && parseResult.preview.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Table2 className={cn("h-4 w-4", theme.text)} /> Data Preview (first{" "}
              {parseResult.preview.length} rows)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-72 overflow-auto scroll-thin rounded-md border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                  <tr>
                    {parseResult.headers.map((h) => (
                      <th
                        key={h}
                        className="whitespace-nowrap px-2 py-1.5 text-left text-[10px] font-semibold uppercase text-muted-foreground"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {parseResult.preview.map((r, i) => (
                    <tr key={i} className="border-t hover:bg-muted/30">
                      {parseResult.headers.map((h) => (
                        <td key={h} className="whitespace-nowrap px-2 py-1 max-w-[200px] truncate" title={r[h]}>
                          {r[h] || <span className="text-muted-foreground/40">—</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Result */}
      {result && (
        <Card className={cn(result.ok ? "border-emerald-500/40" : "border-destructive/40")}>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              {result.ok ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-destructive" />
              )}
              Import Result — {currentProduct}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <Stat label="Total Rows" value={result.totalRows} />
              <Stat label="Valid" value={result.validRows} tone="emerald" />
              <Stat
                label="Invalid"
                value={result.invalidRows}
                tone={result.invalidRows > 0 ? "amber" : "muted"}
              />
            </div>
            {result.errors?.length > 0 && (
              <div className="rounded-md border border-amber-500/30 bg-amber-50 dark:bg-amber-950/20 p-3">
                <div className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-300">
                  <AlertTriangle className="h-3.5 w-3.5" /> Error Report (first {result.errors.length})
                </div>
                <ul className="mt-1.5 space-y-1 max-h-40 overflow-y-auto scroll-thin text-[11px]">
                  {result.errors.map((e: any, i: number) => (
                    <li key={i} className="text-amber-800 dark:text-amber-200">
                      Row {e.row}: {e.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setView("product-master-data")}>
                View {currentProduct} Master Data
              </Button>
              <Button variant="outline" onClick={() => setView("product-data-entry")}>
                Start Data Entry
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pre-import confirmation dialog */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ShieldAlert className={cn("h-5 w-5", theme.text)} /> Confirm Import to {currentProduct}
            </AlertDialogTitle>
            <AlertDialogDescription>
              You are importing data into{" "}
              <strong className={theme.text}>{currentProduct}</strong>.
              {file && (
                <>
                  {" "}
                  File: <strong>{file.name}</strong>
                  {parseResult && (
                    <>
                      {" "}
                      · Sheet: <strong>{sheet}</strong>
                    </>
                  )}
                  {replace ? (
                    <>
                      {" "}
                      · Existing rows from this file will be{" "}
                      <strong className="text-amber-600">replaced</strong>.
                    </>
                  ) : null}
                </>
              )}
              <span className="mt-2 block text-xs">
                {mappedCount} of {Object.keys(mapping).length} columns are mapped. All imported rows
                will be tagged with <strong>productType = {currentProduct}</strong> and isolated from
                other products. This cannot be undone.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmAndImport}
              className={cn(theme.bg, "hover:opacity-90")}
            >
              Import to {currentProduct}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "muted",
}: {
  label: string;
  value: number;
  tone?: "muted" | "emerald" | "amber";
}) {
  const tones = {
    muted: "text-foreground",
    emerald: "text-emerald-600",
    amber: "text-amber-600",
  };
  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <div className={cn("text-xl font-bold tabular-nums", tones[tone])}>
        {value.toLocaleString()}
      </div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}
