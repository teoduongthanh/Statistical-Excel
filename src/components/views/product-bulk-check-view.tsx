"use client";

// ProductBulkCheckView
// Bulk Data Validation view — paste tab-separated Excel rows, auto-map columns,
// validate against Master Data + sequential quantity simulation, review errors,
// then confirm import (atomic transaction).
//
// Pipeline: PASTE → AUTO-DETECT HEADERS → COLUMN MAPPING → VALIDATE (API) →
// SUMMARY + FILTERED TABLE + GROUPED ERRORS → INLINE EDIT → CONFIRM IMPORT.
//
// API contracts (see src/lib/api-client.ts):
//   - api.bulkValidate({ productType, rows }) → BulkValidationResult
//   - api.bulkImport({ productType, rows, mode, selectedRowNumbers, importedBy })
//   - api.bulkImportHistory(limit)

import * as React from "react";
import {
  ClipboardCheck,
  ClipboardPaste,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  XCircle,
  Loader2,
  Upload,
  RefreshCw,
  Eye,
  Trash2,
  Pencil,
  FileSpreadsheet,
  Info,
  ChevronDown,
  ChevronRight,
  Layers,
  Save,
  Ban,
  Wrench,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { useAppStore, PRODUCT_THEME } from "@/store/app-store";
import { buildAutoMapping, mappingOptions } from "@/lib/header-normalize";
import type { CanonicalField } from "@/lib/fields";
import { FIELD_LABELS } from "@/lib/fields";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

// ===== Constants =====

// Required canonical fields for bulk validation. If any of these is unmapped
// after column auto-detection, we show "MISSING REQUIRED COLUMN".
const REQUIRED_FIELDS: CanonicalField[] = [
  "shippingStatus",
  "poNo",
  "factoryPO",
  "size",
  "qty1",
];

// Default column order when the pasted data has NO header row.
const DEFAULT_HEADERS: CanonicalField[] = [
  "shippingStatus",
  "poNo",
  "factoryPO",
  "size",
  "qty1",
];

// Tabs for filtering the preview table by row status.
type FilterKey = "all" | "valid" | "warning" | "error";

// Styling per status bucket (row-level tinting).
const STATUS_TINT: Record<string, string> = {
  valid: "bg-emerald-50/50 dark:bg-emerald-950/20 hover:bg-emerald-50 dark:hover:bg-emerald-950/30",
  warning: "bg-amber-50/50 dark:bg-amber-950/20 hover:bg-amber-50 dark:hover:bg-amber-950/30",
  error: "bg-rose-50/50 dark:bg-rose-950/20 hover:bg-rose-50 dark:hover:bg-rose-950/30",
};

const STATUS_BADGE: Record<string, string> = {
  valid: "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800",
  warning: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800",
  error: "bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800",
};

const SEVERITY_BADGE: Record<string, string> = {
  CRITICAL: "bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800",
  ERROR: "bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800",
  WARNING: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800",
  INFO: "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-900/50 dark:text-slate-300 dark:border-slate-700",
};

// ===== Helpers =====

// Parse the pasted text into a list of raw row arrays (one cell array per line).
// Empty lines are skipped. Both \r\n and \n are supported.
function parseRawLines(text: string): string[][] {
  if (!text) return [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[][] = [];
  for (const line of lines) {
    if (line.trim() === "") continue;
    out.push(line.split("\t"));
  }
  return out;
}

// Heuristic: does the first row look like a header?
// True if any cell matches a known canonical alias (e.g. "Shipping status",
// "Factory PO", "Q'ty 1", "Size", "PO NO#").
function detectHeaderRow(firstRow: string[]): boolean {
  if (!firstRow || firstRow.length === 0) return false;
  const known = [
    "shippingstatus", "shipstatus", "status", "shipping",
    "pono", "po", "ponumber",
    "factorypo", "facpo",
    "size",
    "qty1", "qty", "quantity1", "quantity", "q1",
    "model", "sku", "deadline", "dl",
  ];
  const hits = firstRow.filter((cell) => {
    const norm = String(cell || "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    return known.includes(norm);
  });
  return hits.length >= 2;
}

// Build the canonical-keyed rows from raw lines + the mapping.
//   headers: list of EXCEL header strings (one per column index)
//   mapping: Record<excelHeader, CanonicalField | "">
//   dataRows: string[][] (each inner array = one row's cells, indexed by column)
// Returns: Record<string, string>[] — objects keyed by canonical field name.
function buildCanonicalRows(
  headers: string[],
  mapping: Record<string, CanonicalField | "">,
  dataRows: string[][]
): Record<string, string>[] {
  return dataRows.map((cells) => {
    const row: Record<string, string> = {};
    headers.forEach((header, idx) => {
      const canonical = mapping[header];
      if (!canonical) return;
      const cell = cells[idx] ?? "";
      // Don't overwrite with empty if the same canonical field is already set
      // (rare — only happens if two columns map to the same canonical field).
      if (row[canonical] === undefined || row[canonical] === "") {
        row[canonical] = cell;
      }
    });
    return row;
  });
}

// Group the row results by status bucket for the filter tabs.
function countByStatus(rows: any[]): { valid: number; warning: number; error: number } {
  let valid = 0, warning = 0, error = 0;
  for (const r of rows) {
    if (r.status === "valid") valid++;
    else if (r.status === "warning") warning++;
    else if (r.status === "error") error++;
  }
  return { valid, warning, error };
}

// ===== Component =====

export function ProductBulkCheckView() {
  const { currentProduct, bumpRefresh, refreshKey } = useAppStore();
  const theme = PRODUCT_THEME[currentProduct];

  // State (per spec)
  const [pastedText, setPastedText] = React.useState("");
  const [rows, setRows] = React.useState<Record<string, string>[]>([]); // parsed canonical rows
  const [headers, setHeaders] = React.useState<string[]>([]); // excel headers (one per column)
  const [mapping, setMapping] = React.useState<Record<string, CanonicalField | "">>({});
  const [hasHeader, setHasHeader] = React.useState(true);
  const [mappingOpen, setMappingOpen] = React.useState(true);

  const [validating, setValidating] = React.useState(false);
  const [result, setResult] = React.useState<any>(null); // BulkValidationResult
  const [filter, setFilter] = React.useState<FilterKey>("all");
  const [selectedRow, setSelectedRow] = React.useState<any>(null); // detail dialog
  const [importing, setImporting] = React.useState(false);
  const [showImportPreview, setShowImportPreview] = React.useState(false);

  // Inline-edit state for the Qty cell.
  const [editingRowNum, setEditingRowNum] = React.useState<number | null>(null);
  const [editValue, setEditValue] = React.useState("");

  const options = mappingOptions();

  // ===== Parse pasted text whenever it changes (build headers + mapping + rows).
  React.useEffect(() => {
    if (!pastedText.trim()) {
      setHeaders([]);
      setMapping({});
      setRows([]);
      return;
    }
    const rawLines = parseRawLines(pastedText);
    if (rawLines.length === 0) {
      setHeaders([]);
      setMapping({});
      setRows([]);
      return;
    }

    let detectedHasHeader = true;
    let excelHeaders: string[] = [];
    let dataRows: string[][] = [];

    if (detectHeaderRow(rawLines[0])) {
      detectedHasHeader = true;
      excelHeaders = rawLines[0].map((h, idx) => String(h || `Column ${idx + 1}`).trim() || `Column ${idx + 1}`);
      dataRows = rawLines.slice(1);
    } else {
      detectedHasHeader = false;
      // Use default headers (DEFAULT_HEADERS) — one per column, capped at first row width.
      const colCount = rawLines[0].length;
      excelHeaders = DEFAULT_HEADERS.slice(0, colCount).map((f) => FIELD_LABELS[f]);
      dataRows = rawLines;
    }
    setHasHeader(detectedHasHeader);
    setHeaders(excelHeaders);

    // Auto-build mapping from the headers (canonical field per excel header).
    // For default-header case, the labels map back to canonical fields directly.
    let autoMapping: Record<string, CanonicalField | "">;
    if (detectedHasHeader) {
      autoMapping = buildAutoMapping(excelHeaders);
    } else {
      // Map the label back to the canonical key.
      autoMapping = {};
      DEFAULT_HEADERS.slice(0, excelHeaders.length).forEach((f, idx) => {
        autoMapping[excelHeaders[idx]] = f;
      });
    }
    setMapping(autoMapping);

    // Build canonical rows.
    const canonicalRows = buildCanonicalRows(excelHeaders, autoMapping, dataRows);
    setRows(canonicalRows);

    // Reset validation result + filter when input changes.
    setResult(null);
    setFilter("all");
    setMappingOpen(true);
  }, [pastedText]);

  // ===== Check Data — call the validation API.
  async function handleValidate() {
    if (!rows.length) {
      toast.error("Nothing to validate. Paste some data first.");
      return;
    }
    // Check required-field mapping coverage before calling the API.
    const mappedFields = new Set(Object.values(mapping).filter(Boolean) as CanonicalField[]);
    const missingRequired = REQUIRED_FIELDS.filter((f) => !mappedFields.has(f));
    if (missingRequired.length > 0) {
      toast.error(`Missing required columns: ${missingRequired.map((f) => FIELD_LABELS[f]).join(", ")}`);
      return;
    }

    setValidating(true);
    setResult(null);
    try {
      const res = await api.bulkValidate({
        productType: currentProduct,
        rows,
      });
      setResult(res);
      setFilter("all");
      if (res.summary?.errorRows > 0) {
        toast.warning(`Validated ${res.summary.totalRows} rows — ${res.summary.errorRows} error(s) found.`);
      } else if (res.summary?.warningRows > 0) {
        toast.success(`Validated ${res.summary.totalRows} rows — ${res.summary.warningRows} warning(s).`);
      } else {
        toast.success(`Validated ${res.summary.totalRows} rows — all valid!`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Validation failed";
      toast.error(msg);
    } finally {
      setValidating(false);
    }
  }

  // ===== Inline edit a Qty cell → re-validate.
  function startEditQty(rowResult: any) {
    setEditingRowNum(rowResult.rowNumber);
    setEditValue(String(rowResult.qty1 ?? ""));
  }
  function cancelEditQty() {
    setEditingRowNum(null);
    setEditValue("");
  }
  async function commitEditQty(rowNumber: number) {
    const newQty = editValue.trim();
    setEditingRowNum(null);
    setEditValue("");
    if (!newQty) return;

    // Find the canonical row by Excel row number (rowNumber = idx + 2 → idx = rowNumber-2)
    const idx = rowNumber - 2;
    if (idx < 0 || idx >= rows.length) return;
    if (String(rows[idx].qty1 ?? "") === newQty) return; // no change

    const updated = rows.map((r, i) =>
      i === idx ? { ...r, qty1: newQty } : r
    );
    setRows(updated);

    // Re-validate with updated rows.
    setValidating(true);
    try {
      const res = await api.bulkValidate({ productType: currentProduct, rows: updated });
      setResult(res);
      toast.success(`Row ${rowNumber} updated — re-validated.`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Re-validation failed";
      toast.error(msg);
    } finally {
      setValidating(false);
    }
  }

  // ===== Reset everything.
  function resetView() {
    setPastedText("");
    setRows([]);
    setHeaders([]);
    setMapping({});
    setResult(null);
    setFilter("all");
    setSelectedRow(null);
    setShowImportPreview(false);
    setEditingRowNum(null);
    setEditValue("");
  }

  // ===== Confirm Import.
  async function handleConfirmImport() {
    if (!result) return;
    const importable = result.rows.filter(
      (r: any) => r.status === "valid" || r.status === "warning"
    );
    if (importable.length === 0) {
      toast.error("No importable rows. Fix errors first.");
      return;
    }

    setImporting(true);
    try {
      const payload = importable.map((r: any) => ({
        shippingStatus: r.shippingStatus,
        poNo: r.poNo,
        factoryPO: r.factoryPO,
        size: r.size,
        qty1: Number(r.qty1Num) || Number(r.qty1) || 0,
        confirmReason: r.needsConfirm ? "User confirmed warnings in bulk check" : undefined,
      }));
      const res = await api.bulkImport({
        productType: currentProduct,
        rows: payload,
        mode: "all_valid",
        importedBy: "bulk-check",
      });
      if (!res.ok) {
        throw new Error(res.errors?.join("; ") || "Import failed");
      }
      toast.success(`Imported ${res.imported} row(s) · skipped ${res.skipped}.`);
      bumpRefresh();
      resetView();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Import failed";
      toast.error(msg);
    } finally {
      setImporting(false);
      setShowImportPreview(false);
    }
  }

  // ===== Derived values.
  const summary = result?.summary;
  const allRows: any[] = result?.rows ?? [];
  const filteredRows = React.useMemo(() => {
    if (filter === "all") return allRows;
    return allRows.filter((r) => r.status === filter);
  }, [allRows, filter]);
  const counts = React.useMemo(() => countByStatus(allRows), [allRows]);
  const groupedErrors: any[] = result?.groupedErrors ?? [];

  const mappedFields = new Set(Object.values(mapping).filter(Boolean) as CanonicalField[]);
  const missingRequired = REQUIRED_FIELDS.filter((f) => !mappedFields.has(f));
  const hasMappingError = headers.length > 0 && missingRequired.length > 0;

  const errorRowCount = summary?.errorRows ?? 0;
  const importDisabled = !result || errorRowCount > 0 || importing || validating;
  const importableRows = allRows.filter((r: any) => r.status === "valid" || r.status === "warning");
  const affectedProducts = React.useMemo(
    () => new Set(importableRows.map((r: any) => r.groupKey)).size,
    [importableRows]
  );

  // Suppress unused refreshKey warning — it's reserved for query keys.
  void refreshKey;

  return (
    <div className="space-y-5">
      {/* ===== Header ===== */}
      <div className={cn("relative overflow-hidden rounded-xl border bg-gradient-to-r p-5 text-white shadow-sm", theme.gradient)}>
        <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-white/10" />
        <div className="relative flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/15 backdrop-blur">
              <ClipboardCheck className="h-6 w-6" />
            </div>
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider text-white/80">Bulk Data Validation</p>
              <h1 className="text-2xl font-bold tracking-tight">Bulk Check · {currentProduct}</h1>
              <p className="text-xs text-white/80">
                Paste tab-separated rows from Excel → validate against Master Data + sequential quantity simulation → confirm import.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge className="border-white/30 bg-white/15 text-white">{currentProduct}</Badge>
            <Badge className="flex items-center gap-1 border-white/30 bg-white/15 text-white">
              <ClipboardPaste className="h-3 w-3" /> Copy from Excel
            </Badge>
          </div>
        </div>
      </div>

      {/* ===== Paste Area ===== */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ClipboardPaste className="h-4 w-4 text-primary" />
            Paste Excel Rows
            <span className="text-xs font-normal text-muted-foreground">
              · select cells in Excel, copy (Ctrl+C), then paste here (Ctrl+V)
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={pastedText}
            onChange={(e) => setPastedText(e.target.value)}
            placeholder={"Shipping status\tPO NO#\tFactory PO\tSize\tQ'ty 1\n1.Order\tPO-001\tMH25100234\tS\t100\n2.Output\tPO-001\tMH25100234\tS\t80"}
            className="min-h-[160px] font-mono text-xs scroll-thin"
            spellCheck={false}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={handleValidate}
              disabled={validating || !rows.length || hasMappingError}
              className={cn("gap-1.5", theme.bg, "text-white hover:opacity-90")}
            >
              {validating ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardCheck className="h-4 w-4" />}
              {validating ? "Checking…" : "Check Data"}
            </Button>
            <Button variant="outline" size="sm" onClick={resetView} disabled={!pastedText && !result} className="gap-1.5">
              <Trash2 className="h-3.5 w-3.5" /> Clear
            </Button>
            <label className="ml-auto flex items-center gap-2 text-xs">
              <Switch checked={hasHeader} onCheckedChange={(v) => {
                // Toggle re-parse: simulate by toggling the pastedText effect.
                // We force a re-detection by clearing mapping and rebuilding via effect.
                if (v === hasHeader) return;
                // We rebuild manually so the user's manual toggle wins over auto-detect.
                const rawLines = parseRawLines(pastedText);
                if (rawLines.length === 0) return;
                let excelHeaders: string[];
                let dataRows: string[][];
                if (v) {
                  excelHeaders = rawLines[0].map((h, idx) => String(h || `Column ${idx + 1}`).trim() || `Column ${idx + 1}`);
                  dataRows = rawLines.slice(1);
                } else {
                  const colCount = rawLines[0].length;
                  excelHeaders = DEFAULT_HEADERS.slice(0, colCount).map((f) => FIELD_LABELS[f]);
                  dataRows = rawLines;
                }
                setHasHeader(v);
                setHeaders(excelHeaders);
                let autoMapping: Record<string, CanonicalField | "">;
                if (v) {
                  autoMapping = buildAutoMapping(excelHeaders);
                } else {
                  autoMapping = {};
                  DEFAULT_HEADERS.slice(0, excelHeaders.length).forEach((f, idx) => {
                    autoMapping[excelHeaders[idx]] = f;
                  });
                }
                setMapping(autoMapping);
                setRows(buildCanonicalRows(excelHeaders, autoMapping, dataRows));
                setResult(null);
                setFilter("all");
              }} />
              First row is header
            </label>
            {rows.length > 0 && (
              <Badge variant="outline" className="text-[10px]">
                {rows.length} data row{rows.length === 1 ? "" : "s"} parsed
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ===== Column Mapping (collapsible) ===== */}
      {headers.length > 0 && (
        <Collapsible open={mappingOpen} onOpenChange={setMappingOpen}>
          <Card>
            <CollapsibleTrigger asChild>
              <CardHeader className="cursor-pointer pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  {mappingOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  <Layers className="h-4 w-4 text-primary" />
                  Column Mapping
                  <Badge variant="outline" className="ml-1 text-[10px]">{headers.length} columns</Badge>
                  {hasMappingError ? (
                    <Badge className="ml-1 bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800 text-[10px]">
                      <XCircle className="h-3 w-3 mr-0.5" /> MISSING REQUIRED COLUMN
                    </Badge>
                  ) : (
                    <Badge className="ml-1 bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800 text-[10px]">
                      <CheckCircle2 className="h-3 w-3 mr-0.5" /> Required OK
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="space-y-3 pt-0">
                {hasMappingError && (
                  <Alert variant="destructive">
                    <XCircle className="h-4 w-4" />
                    <AlertTitle>❌ MISSING REQUIRED COLUMN</AlertTitle>
                    <AlertDescription>
                      These required columns are not mapped:{" "}
                      <strong>{missingRequired.map((f) => FIELD_LABELS[f]).join(", ")}</strong>.
                      Either rename the column in Excel to match a known alias, or manually map it below.
                    </AlertDescription>
                  </Alert>
                )}
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
                  {headers.map((header) => {
                    const canonical = mapping[header] || "";
                    const isRequired = canonical
                      ? REQUIRED_FIELDS.includes(canonical as CanonicalField)
                      : false;
                    return (
                      <div key={header} className="flex items-center gap-2 rounded-md border bg-card p-2">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-medium" title={header}>{header}</div>
                          <div className="text-[10px] text-muted-foreground">Excel column</div>
                        </div>
                        <div className="text-muted-foreground">→</div>
                        <div className="w-[160px]">
                          <Select
                            value={canonical}
                            onValueChange={(v) => {
                              const next = v === "__none__" ? "" : (v as CanonicalField);
                              setMapping((prev) => ({ ...prev, [header]: next }));
                              setResult(null);
                            }}
                          >
                            <SelectTrigger size="sm" className="w-full">
                              <SelectValue placeholder="— skip —" />
                            </SelectTrigger>
                            <SelectContent className="max-h-72 scroll-thin">
                              <SelectItem value="__none__">— skip —</SelectItem>
                              {options.map((opt) => (
                                <SelectItem key={opt.value} value={opt.value}>
                                  {opt.label}
                                  {REQUIRED_FIELDS.includes(opt.value as CanonicalField) ? " *" : ""}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {canonical && isRequired && (
                            <div className="mt-0.5 text-[10px] text-rose-600 dark:text-rose-400">required</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Info className="h-3 w-3" />
                  Fields marked <strong>*</strong> are required for bulk validation.
                  Auto-detection uses known aliases (e.g. "Shipping status", "PO NO#", "Factory PO", "Size", "Q'ty 1").
                </div>
                {/* Manual re-mapping rebuilds rows immediately. */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (!pastedText) return;
                    const rawLines = parseRawLines(pastedText);
                    if (rawLines.length === 0) return;
                    const dataRows = hasHeader ? rawLines.slice(1) : rawLines;
                    setRows(buildCanonicalRows(headers, mapping, dataRows));
                    setResult(null);
                    toast.info("Rows rebuilt from updated mapping.");
                  }}
                  className="gap-1.5"
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Rebuild rows from mapping
                </Button>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      )}

      {/* ===== Validation Summary ===== */}
      {summary && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-5">
          <SummaryCard label="Total Rows" value={summary.totalRows} icon={FileSpreadsheet} tone="slate" />
          <SummaryCard label="Valid" value={summary.validRows} icon={CheckCircle2} tone="emerald" />
          <SummaryCard label="Warning" value={summary.warningRows} icon={AlertTriangle} tone="amber" />
          <SummaryCard label="Error" value={summary.errorRows} icon={XCircle} tone="rose" />
          <SummaryCard label="Products Affected" value={summary.productGroupsAffected} icon={Layers} tone={theme.text} />
        </div>
      )}

      {/* ===== Filter Tabs + Preview Table ===== */}
      {result && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <CardTitle className="flex items-center gap-2 text-base">
                <FileSpreadsheet className="h-4 w-4 text-primary" />
                Validation Results
              </CardTitle>
              <Tabs value={filter} onValueChange={(v) => setFilter(v as FilterKey)}>
                <TabsList>
                  <TabsTrigger value="all">
                    VIEW ALL <Badge variant="secondary" className="ml-1 text-[9px]">{allRows.length}</Badge>
                  </TabsTrigger>
                  <TabsTrigger value="valid">
                    VIEW VALID <Badge variant="secondary" className="ml-1 text-[9px]">{counts.valid}</Badge>
                  </TabsTrigger>
                  <TabsTrigger value="warning">
                    VIEW WARNING <Badge variant="secondary" className="ml-1 text-[9px]">{counts.warning}</Badge>
                  </TabsTrigger>
                  <TabsTrigger value="error">
                    VIEW ERROR <Badge variant="secondary" className="ml-1 text-[9px]">{counts.error}</Badge>
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="max-h-[600px] overflow-y-auto scroll-thin">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-muted/80 backdrop-blur">
                  <TableRow>
                    <TableHead className="w-[60px] text-[10px] uppercase">Row#</TableHead>
                    <TableHead className="w-[100px] text-[10px] uppercase">Status</TableHead>
                    <TableHead className="text-[10px] uppercase">PO NO#</TableHead>
                    <TableHead className="text-[10px] uppercase">Factory PO</TableHead>
                    <TableHead className="text-[10px] uppercase">Size</TableHead>
                    <TableHead className="text-[10px] uppercase text-right">Qty</TableHead>
                    <TableHead className="text-[10px] uppercase">Validation Result</TableHead>
                    <TableHead className="text-[10px] uppercase">Error</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="py-10 text-center text-muted-foreground text-xs">
                        No rows match this filter.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredRows.map((r: any) => {
                      const isEditing = editingRowNum === r.rowNumber;
                      const errorList = r.errors || [];
                      const firstErr = errorList.find((e: any) => e.severity === "ERROR" || e.severity === "CRITICAL");
                      return (
                        <TableRow
                          key={r.rowNumber}
                          className={cn("cursor-pointer border-t", STATUS_TINT[r.status] || "")}
                          onClick={() => setSelectedRow(r)}
                        >
                          <TableCell className="px-3 py-1.5 text-xs tabular-nums text-muted-foreground">
                            {r.rowNumber}
                          </TableCell>
                          <TableCell className="px-3 py-1.5">
                            <Badge variant="outline" className={cn("text-[9px]", STATUS_BADGE[r.status] || "")}>
                              {r.status === "valid" && <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" />}
                              {r.status === "warning" && <AlertTriangle className="h-2.5 w-2.5 mr-0.5" />}
                              {r.status === "error" && <XCircle className="h-2.5 w-2.5 mr-0.5" />}
                              {r.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="px-3 py-1.5 text-xs whitespace-nowrap">{r.poNo || "—"}</TableCell>
                          <TableCell className="px-3 py-1.5 text-xs font-medium whitespace-nowrap">{r.factoryPO || "—"}</TableCell>
                          <TableCell className="px-3 py-1.5">
                            <Badge variant="outline" className="text-[9px] font-mono">{r.size || "—"}</Badge>
                          </TableCell>
                          <TableCell
                            className="px-3 py-1.5 text-xs text-right tabular-nums"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {isEditing ? (
                              <div className="flex items-center justify-end gap-1">
                                <Input
                                  autoFocus
                                  value={editValue}
                                  onChange={(e) => setEditValue(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") commitEditQty(r.rowNumber);
                                    if (e.key === "Escape") cancelEditQty();
                                  }}
                                  className="h-6 w-16 text-xs text-right"
                                />
                                <Button size="sm" variant="ghost" className="h-6 px-1.5"
                                  onClick={() => commitEditQty(r.rowNumber)}>
                                  <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                                </Button>
                                <Button size="sm" variant="ghost" className="h-6 px-1.5"
                                  onClick={cancelEditQty}>
                                  <XCircle className="h-3 w-3 text-rose-600" />
                                </Button>
                              </div>
                            ) : (
                              <span className="inline-flex items-center gap-1">
                                {r.qty1}
                                <button
                                  type="button"
                                  className="opacity-50 hover:opacity-100"
                                  title="Edit quantity"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    startEditQty(r);
                                  }}
                                >
                                  <Pencil className="h-3 w-3" />
                                </button>
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="px-3 py-1.5 text-xs">
                            <div className="flex flex-wrap gap-1">
                              {errorList.slice(0, 2).map((err: any, i: number) => (
                                <Badge
                                  key={i}
                                  variant="outline"
                                  className={cn("text-[9px]", SEVERITY_BADGE[err.severity] || "")}
                                  title={err.description}
                                >
                                  {err.severity === "WARNING" ? <AlertTriangle className="h-2.5 w-2.5 mr-0.5" /> :
                                   err.severity === "ERROR" || err.severity === "CRITICAL" ? <XCircle className="h-2.5 w-2.5 mr-0.5" /> :
                                   <Info className="h-2.5 w-2.5 mr-0.5" />}
                                  {err.title}
                                </Badge>
                              ))}
                              {errorList.length > 2 && (
                                <Badge variant="outline" className="text-[9px]">
                                  +{errorList.length - 2} more
                                </Badge>
                              )}
                              {errorList.length === 0 && (
                                <span className="text-emerald-600 text-[10px]">✓ No issues</span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="px-3 py-1.5 text-xs text-rose-600 dark:text-rose-400">
                            {firstErr ? firstErr.title : "—"}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
            <div className="flex items-center justify-between border-t px-4 py-2 text-xs text-muted-foreground">
              <span>
                Showing {filteredRows.length} of {allRows.length} rows
              </span>
              <span className="flex items-center gap-1">
                <Info className="h-3 w-3" /> Click a row to see full detail · click the pencil to edit Qty
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ===== Grouped Errors ===== */}
      {result && groupedErrors.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertCircle className="h-4 w-4 text-rose-600" />
              Grouped Errors
              <Badge variant="outline" className="text-[10px]">{groupedErrors.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="max-h-[400px] overflow-y-auto scroll-thin">
              <Table>
                <TableHeader className="sticky top-0 bg-muted/80 backdrop-blur">
                  <TableRow>
                    <TableHead className="text-[10px] uppercase">PO / Factory / Size</TableHead>
                    <TableHead className="text-[10px] uppercase">Rows</TableHead>
                    <TableHead className="text-[10px] uppercase text-right">Current (O / I / In)</TableHead>
                    <TableHead className="text-[10px] uppercase text-right">New (O / I / In)</TableHead>
                    <TableHead className="text-[10px] uppercase text-right">Excess</TableHead>
                    <TableHead className="text-[10px] uppercase">Error</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groupedErrors.map((g: any, idx: number) => (
                    <TableRow key={`${g.groupKey}-${g.code}-${idx}`} className="border-t hover:bg-muted/30">
                      <TableCell className="px-3 py-1.5">
                        <div className="text-xs">
                          <div className="font-medium">{g.poNo} · {g.factoryPO}</div>
                          <div className="text-muted-foreground">
                            <Badge variant="outline" className="text-[9px] font-mono mr-1">{g.size}</Badge>
                            {g.model && <span className="text-[10px]">{g.model}</span>}
                            {g.colorCode && <span className="text-[10px] text-muted-foreground"> · {g.colorCode}</span>}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="px-3 py-1.5">
                        <div className="flex flex-wrap gap-1">
                          {g.rowNumbers.map((rn: number) => (
                            <Badge key={rn} variant="outline" className="text-[9px]">{rn}</Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="px-3 py-1.5 text-xs text-right tabular-nums">
                        {g.current.order} / {g.current.output} / {g.current.input}
                      </TableCell>
                      <TableCell className="px-3 py-1.5 text-xs text-right tabular-nums font-medium">
                        {g.newTotal.order} / {g.newTotal.output} / {g.newTotal.input}
                      </TableCell>
                      <TableCell className="px-3 py-1.5 text-xs text-right tabular-nums">
                        {g.excess > 0 ? (
                          <Badge className="bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800 text-[9px]">
                            +{g.excess}
                          </Badge>
                        ) : "—"}
                      </TableCell>
                      <TableCell className="px-3 py-1.5">
                        <Badge
                          variant="outline"
                          className={cn("text-[9px]", SEVERITY_BADGE[g.severity] || "")}
                          title={g.description}
                        >
                          {g.title}
                        </Badge>
                        <div className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">{g.description}</div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ===== Action Bar ===== */}
      {result && (
        <Card>
          <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {errorRowCount > 0 ? (
                <Alert variant="destructive" className="py-2 pr-3">
                  <XCircle className="h-4 w-4" />
                  <AlertDescription>
                    <strong>{errorRowCount} error row(s)</strong> block import. Fix the data and re-check, or remove those rows from your paste.
                  </AlertDescription>
                </Alert>
              ) : (
                <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800">
                  <CheckCircle2 className="h-3 w-3 mr-1" /> Ready to import
                </Badge>
              )}
              <Badge variant="outline" className="text-[10px]">
                {importableRows.length} importable · {allRows.length - importableRows.length} skipped
              </Badge>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={resetView} className="gap-1.5">
                <Ban className="h-3.5 w-3.5" /> Cancel
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setPastedText("");
                  setRows([]);
                  setHeaders([]);
                  setMapping({});
                  setResult(null);
                  setFilter("all");
                  toast.info("Cleared — fix your pasted data and check again.");
                }}
                className="gap-1.5"
              >
                <Wrench className="h-3.5 w-3.5" /> Fix Data
              </Button>
              <Button
                size="sm"
                disabled={importDisabled}
                onClick={() => setShowImportPreview(true)}
                className={cn("gap-1.5", theme.bg, "text-white hover:opacity-90")}
              >
                <Upload className="h-3.5 w-3.5" /> Confirm Import
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ===== Row Detail Dialog ===== */}
      <Dialog open={!!selectedRow} onOpenChange={(o) => !o && setSelectedRow(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto scroll-thin">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="h-5 w-5 text-primary" />
              Product Validation Detail
              {selectedRow && (
                <Badge variant="outline" className={cn("text-[10px] ml-1", STATUS_BADGE[selectedRow.status] || "")}>
                  Row #{selectedRow.rowNumber} · {selectedRow.status}
                </Badge>
              )}
            </DialogTitle>
            <DialogDescription>
              Full validation breakdown for this row, including current DB state, expected post-save totals, and all errors/warnings.
            </DialogDescription>
          </DialogHeader>
          {selectedRow && (
            <div className="space-y-4">
              {/* Identity */}
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 text-xs">
                <DetailField label="PO NO#" value={selectedRow.poNo} />
                <DetailField label="Factory PO" value={selectedRow.factoryPO} />
                <DetailField label="MODEL" value={selectedRow.model} />
                <DetailField label="SKU" value={selectedRow.sku} />
                <DetailField label="Color" value={selectedRow.colorCode} />
                <DetailField label="Size" value={selectedRow.size} mono />
                <DetailField label="Deadline" value={selectedRow.deadline} />
                <DetailField label="Master Data Found" value={selectedRow.masterDataFound ? "Yes" : "No"} tone={selectedRow.masterDataFound ? "emerald" : "rose"} />
                <DetailField label="Group Key" value={selectedRow.groupKey} mono />
              </div>

              {/* Pasted Data */}
              <div className="rounded-md border bg-muted/30 p-3">
                <div className="text-[10px] font-semibold uppercase text-muted-foreground mb-2">Pasted Data</div>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <DetailField label="Shipping Status" value={selectedRow.shippingStatus} />
                  <DetailField label="Qty" value={String(selectedRow.qty1 ?? "")} mono />
                </div>
              </div>

              {/* Current DB + After Save */}
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="rounded-md border bg-muted/30 p-3">
                  <div className="text-[10px] font-semibold uppercase text-muted-foreground mb-2">Current DB State</div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <DetailNumber label="Order" value={selectedRow.current?.order} />
                    <DetailNumber label="Output" value={selectedRow.current?.output} />
                    <DetailNumber label="Input" value={selectedRow.current?.input} />
                  </div>
                </div>
                <div className="rounded-md border bg-emerald-50/50 dark:bg-emerald-950/20 p-3">
                  <div className="text-[10px] font-semibold uppercase text-emerald-700 dark:text-emerald-400 mb-2">Expected Result (after save)</div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <DetailNumber label="Order" value={selectedRow.afterSave?.order} tone="emerald" />
                    <DetailNumber label="Output" value={selectedRow.afterSave?.output} tone="emerald" />
                    <DetailNumber label="Input" value={selectedRow.afterSave?.input} tone="emerald" />
                  </div>
                </div>
              </div>

              {/* Validation Result */}
              <div>
                <div className="text-[10px] font-semibold uppercase text-muted-foreground mb-2">
                  Validation Result ({(selectedRow.errors || []).length} issue{(selectedRow.errors || []).length === 1 ? "" : "s"})
                </div>
                {(selectedRow.errors || []).length === 0 ? (
                  <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 p-3 text-xs text-emerald-700 dark:text-emerald-300">
                    <CheckCircle2 className="h-4 w-4" /> No issues — this row is fully valid.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {(selectedRow.errors || []).map((err: any, i: number) => (
                      <div
                        key={i}
                        className={cn(
                          "rounded-md border p-3 text-xs",
                          err.severity === "ERROR" || err.severity === "CRITICAL"
                            ? "border-rose-200 bg-rose-50 dark:bg-rose-950/30"
                            : err.severity === "WARNING"
                            ? "border-amber-200 bg-amber-50 dark:bg-amber-950/30"
                            : "border-slate-200 bg-slate-50 dark:bg-slate-900/30"
                        )}
                      >
                        <div className="flex items-center gap-1.5">
                          {err.severity === "ERROR" || err.severity === "CRITICAL" ? (
                            <XCircle className="h-3.5 w-3.5 text-rose-600" />
                          ) : err.severity === "WARNING" ? (
                            <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                          ) : (
                            <Info className="h-3.5 w-3.5 text-slate-600" />
                          )}
                          <Badge
                            variant="outline"
                            className={cn("text-[9px]", SEVERITY_BADGE[err.severity] || "")}
                          >
                            {err.code}
                          </Badge>
                          <span className="font-medium">{err.title}</span>
                          {typeof err.excess === "number" && err.excess > 0 && (
                            <Badge className="bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800 text-[9px]">
                              excess: +{err.excess}
                            </Badge>
                          )}
                          {err.duplicateRowNumbers && err.duplicateRowNumbers.length > 0 && (
                            <span className="text-[10px] text-muted-foreground">
                              (rows: {err.duplicateRowNumbers.join(", ")})
                            </span>
                          )}
                        </div>
                        <div className="mt-1 text-muted-foreground text-[11px]">{err.description}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setSelectedRow(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== Import Preview Dialog ===== */}
      <Dialog open={showImportPreview} onOpenChange={(o) => !o && setShowImportPreview(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5 text-primary" />
              Import Preview
            </DialogTitle>
            <DialogDescription>
              Review the final import summary. This will write {importableRows.length} row(s) into the {currentProduct} database
              inside a single transaction.
            </DialogDescription>
          </DialogHeader>
          {result && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <SummaryCard label="Total Rows" value={summary.totalRows} icon={FileSpreadsheet} tone="slate" />
                <SummaryCard label="Will Import" value={importableRows.length} icon={CheckCircle2} tone="emerald" />
                <SummaryCard label="Skipped" value={summary.totalRows - importableRows.length} icon={Ban} tone="rose" />
                <SummaryCard label="Products Affected" value={affectedProducts} icon={Layers} tone={theme.text} />
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <SummaryLine label="Valid rows" value={summary.validRows} tone="emerald" />
                <SummaryLine label="Warning rows" value={summary.warningRows} tone="amber" />
                <SummaryLine label="Error rows (skipped)" value={summary.errorRows} tone="rose" />
                <SummaryLine label="Quantity errors" value={summary.quantityErrors} tone="rose" />
                <SummaryLine label="Master data errors" value={summary.masterDataErrors} tone="rose" />
                <SummaryLine label="Deadline warnings" value={summary.deadlineErrors} tone="amber" />
                <SummaryLine label="Possible duplicates" value={summary.duplicatePossible} tone="amber" />
                <SummaryLine label="Mode" value="all_valid" tone="slate" />
              </div>

              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription>
                  Mode <strong>all_valid</strong> imports every row whose status is{" "}
                  <Badge variant="outline" className="text-[9px] mx-0.5 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">valid</Badge> or{" "}
                  <Badge variant="outline" className="text-[9px] mx-0.5 bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">warning</Badge>.
                  Error rows are skipped. The import runs inside a single transaction — if any error occurs, all inserts roll back.
                </AlertDescription>
              </Alert>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowImportPreview(false)}>Cancel</Button>
            <Button
              size="sm"
              disabled={importing || importableRows.length === 0}
              onClick={handleConfirmImport}
              className={cn("gap-1.5", theme.bg, "text-white hover:opacity-90")}
            >
              {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              {importing ? "Importing…" : "Confirm Import"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default ProductBulkCheckView;

// ===== Sub-components =====

function SummaryCard({
  label,
  value,
  icon: Icon,
  tone = "slate",
}: {
  label: string;
  value: number | string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "slate" | "emerald" | "amber" | "rose" | string;
}) {
  const toneClass = (() => {
    switch (tone) {
      case "emerald": return "text-emerald-600 dark:text-emerald-400";
      case "amber": return "text-amber-600 dark:text-amber-400";
      case "rose": return "text-rose-600 dark:text-rose-400";
      case "slate": return "text-slate-700 dark:text-slate-200";
      default: return tone; // custom Tailwind class (e.g. theme.text)
    }
  })();
  return (
    <Card className="border-border/60">
      <CardContent className="flex items-center gap-3 p-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted/60">
          <Icon className={cn("h-4 w-4", toneClass)} />
        </div>
        <div className="min-w-0">
          <div className={cn("text-xl font-bold tabular-nums leading-tight", toneClass)}>
            {typeof value === "number" ? value.toLocaleString() : value}
          </div>
          <div className="text-[11px] text-muted-foreground leading-tight">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function DetailField({
  label,
  value,
  mono,
  tone = "default",
}: {
  label: string;
  value: string | undefined | null;
  mono?: boolean;
  tone?: "default" | "emerald" | "rose";
}) {
  const toneClass = tone === "emerald"
    ? "text-emerald-600 dark:text-emerald-400"
    : tone === "rose"
    ? "text-rose-600 dark:text-rose-400"
    : "text-foreground";
  return (
    <div>
      <div className="text-[10px] font-medium uppercase text-muted-foreground">{label}</div>
      <div className={cn("text-xs font-medium break-words", mono && "font-mono", toneClass)}>
        {value || <span className="text-muted-foreground/40">—</span>}
      </div>
    </div>
  );
}

function DetailNumber({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number | undefined | null;
  tone?: "default" | "emerald";
}) {
  const toneClass = tone === "emerald" ? "text-emerald-600 dark:text-emerald-400" : "text-foreground";
  return (
    <div>
      <div className="text-[10px] font-medium uppercase text-muted-foreground">{label}</div>
      <div className={cn("text-sm font-bold tabular-nums", toneClass)}>
        {typeof value === "number" ? value.toLocaleString() : "—"}
      </div>
    </div>
  );
}

function SummaryLine({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone: "emerald" | "amber" | "rose" | "slate";
}) {
  const toneClass = (() => {
    switch (tone) {
      case "emerald": return "text-emerald-600 dark:text-emerald-400";
      case "amber": return "text-amber-600 dark:text-amber-400";
      case "rose": return "text-rose-600 dark:text-rose-400";
      default: return "text-foreground";
    }
  })();
  return (
    <div className="flex items-center justify-between rounded-md border bg-card px-3 py-1.5">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-semibold tabular-nums", toneClass)}>{value}</span>
    </div>
  );
}
