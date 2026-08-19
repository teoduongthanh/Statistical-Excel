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
  FileDown,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { mappingOptions } from "@/lib/header-normalize";
import type { CanonicalField, ParseResult } from "@/types";
import { FIELD_LABELS } from "@/lib/fields";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/app-store";

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

export function ImportExcelView() {
  const qc = useQueryClient();
  const { bumpRefresh, setView } = useAppStore();
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
      toast.success(`Parsed "${f.name}"`, { description: `${r.sheets.length} sheets · ${r.totalRows} rows` });
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
    } catch (e) {
      toast.error("Sheet parse failed");
    } finally {
      setParsing(false);
    }
  }

  async function handleImport() {
    if (!file || !parseResult) return;
    setImporting(true);
    setResult(null);
    try {
      const buf = await file.arrayBuffer();
      const base64 = arrayBufferToBase64(buf);
      const r = await api.importExcel({
        fileName: file.name,
        sheetName: sheet,
        fileBase64: base64,
        mapping,
        replaceExisting: replace,
      });
      setResult(r);
      if (r.ok) {
        toast.success(`Imported ${r.inserted} rows`, {
          description: `${r.validRows} valid · ${r.invalidRows} invalid`,
        });
        bumpRefresh();
        qc.invalidateQueries({ queryKey: ["dashboard"] });
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
      {/* Step 1: Upload */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs">1</span>
            Upload Excel File
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/30 p-8 text-center transition-colors hover:border-primary/50 hover:bg-primary/5"
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
                <FileSpreadsheet className="h-10 w-10 text-emerald-600" />
                <div className="text-sm font-medium">{file.name}</div>
                <div className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(1)} KB</div>
              </div>
            ) : parsing ? (
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <span className="text-sm text-muted-foreground">Parsing…</span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <Upload className="h-8 w-8 text-muted-foreground" />
                <div className="text-sm font-medium">Drop file or click to browse</div>
                <div className="text-xs text-muted-foreground">Supports .xlsx, .xls, .csv</div>
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
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs">2</span>
              Select Sheet & Map Columns
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
              <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
                {mappedCount}/{Object.keys(mapping).length} mapped
              </Badge>
            </div>

            {/* Mapping table */}
            <div className="overflow-x-auto scroll-thin rounded-md border">
              <table className="w-full text-xs">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase text-muted-foreground">Excel Column</th>
                    <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase text-muted-foreground">Sample Value</th>
                    <th className="px-3 py-2 w-8 text-center"></th>
                    <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase text-muted-foreground">System Field</th>
                  </tr>
                </thead>
                <tbody>
                  {parseResult.headers.map((h) => {
                    const sample = parseResult.preview[0]?.[h] ?? "";
                    return (
                      <tr key={h} className="border-t">
                        <td className="px-3 py-1.5 font-medium">{h}</td>
                        <td className="px-3 py-1.5 text-muted-foreground max-w-[280px] truncate" title={sample}>{sample}</td>
                        <td className="px-3 py-1.5 text-center text-muted-foreground"><ArrowRight className="h-3 w-3 inline" /></td>
                        <td className="px-3 py-1.5">
                          <Select
                            value={mapping[h] ?? ""}
                            onValueChange={(v) => setMapping((m) => ({ ...m, [h]: v as CanonicalField | "" }))}
                          >
                            <SelectTrigger className="h-8 w-48 text-xs">
                              <SelectValue placeholder="(skip)" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="">— Skip —</SelectItem>
                              {options.map((o) => (
                                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
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
              <Button onClick={handleImport} disabled={importing || mappedCount === 0}>
                {importing ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Upload className="mr-1.5 h-4 w-4" />}
                Import {mappedCount} columns
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
              <Table2 className="h-4 w-4 text-primary" /> Data Preview (first {parseResult.preview.length} rows)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-72 overflow-auto scroll-thin rounded-md border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                  <tr>
                    {parseResult.headers.map((h) => (
                      <th key={h} className="whitespace-nowrap px-2 py-1.5 text-left text-[10px] font-semibold uppercase text-muted-foreground">
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
              {result.ok ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <AlertTriangle className="h-4 w-4 text-destructive" />}
              Import Result
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <Stat label="Total Rows" value={result.totalRows} />
              <Stat label="Valid" value={result.validRows} tone="emerald" />
              <Stat label="Invalid" value={result.invalidRows} tone={result.invalidRows > 0 ? "amber" : "muted"} />
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
              <Button variant="outline" onClick={() => setView("master-data")}>
                View Master Data
              </Button>
              <Button variant="outline" onClick={() => setView("data-entry")}>
                Start Data Entry
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value, tone = "muted" }: { label: string; value: number; tone?: "muted" | "emerald" | "amber" }) {
  const tones = {
    muted: "text-foreground",
    emerald: "text-emerald-600",
    amber: "text-amber-600",
  };
  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <div className={cn("text-xl font-bold tabular-nums", tones[tone])}>{value.toLocaleString()}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}
