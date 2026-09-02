"use client";

// ProductReconciliationView
// Data Reconciliation & Duplicate Check view — upload an Excel file, select a sheet,
// auto-map columns, choose a date range, then compare Excel rows against Website
// (MasterData) rows. READ-ONLY — never writes data. Reports status per group:
// MATCHED / QTY_MISMATCH / MISSING_ON_WEBSITE / MISSING_IN_EXCEL /
// POSSIBLE_WRONG_FACTORY_PO / POSSIBLE_WRONG_SIZE / POSSIBLE_DUPLICATE /
// EXACT_DUPLICATE / INVALID_DATA.
//
// Pipeline (spec §27):
//   Excel Data → Filter By Date → Normalize → Group By (PO+FactoryPO+Size) → SUM Qty
//   Website Data → Filter Same Date Range → Normalize → Group → SUM Qty
//   FULL OUTER COMPARISON → MATCH / MISMATCH / MISSING / DUPLICATE
//
// API contracts (see src/lib/api-client.ts):
//   - api.parseExcel(file, sheet?) → { headers, preview(50 rows), sheets, autoMapping, ... }
//   - api.reconcileData({ productType, dateFrom, dateTo, excelRows }) → { ok, summary, results }
// Excel full parse (client-side):
//   - readWorkbook(ArrayBuffer) → { wb, sheets }
//   - parseSheet(wb, sheetName, maxRows?) → { headers, rows: Record<string,string>[] }

import * as React from "react";
import {
  GitCompare,
  Upload,
  FileSpreadsheet,
  Calendar,
  Search,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Eye,
  Loader2,
  X,
  Filter,
  Copy,
  Info,
  RefreshCw,
  Trash2,
  Layers,
  Sheet as SheetIcon,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { useAppStore, PRODUCT_THEME } from "@/store/app-store";
import { buildAutoMapping, mappingOptions } from "@/lib/header-normalize";
import type { CanonicalField } from "@/lib/fields";
import { FIELD_LABELS } from "@/lib/fields";
import { readWorkbook, parseSheet } from "@/lib/excel";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

// ===== Constants =====

// Required canonical fields for reconciliation. Mapping must cover all of these
// before the "Compare with Website Data" button is enabled.
const REQUIRED_FIELDS: CanonicalField[] = ["date", "poNo", "factoryPO", "size", "qty1"];

// Sentinel value used for unmapped columns (Radix Select can't use empty string).
const SKIP_VALUE = "__skip__";

// Status tone map (row tint + badge color).
type Tone = "emerald" | "amber" | "rose" | "slate";

const STATUS_TONE: Record<string, Tone> = {
  MATCHED: "emerald",
  QTY_MISMATCH: "amber",
  MISSING_ON_WEBSITE: "rose",
  MISSING_IN_EXCEL: "amber",
  POSSIBLE_WRONG_FACTORY_PO: "amber",
  POSSIBLE_WRONG_SIZE: "amber",
  POSSIBLE_DUPLICATE: "rose",
  EXACT_DUPLICATE: "rose",
  INVALID_DATA: "slate",
};

const STATUS_ROW_TINT: Record<Tone, string> = {
  emerald: "bg-emerald-50/50 dark:bg-emerald-950/20 hover:bg-emerald-50 dark:hover:bg-emerald-950/30",
  amber: "bg-amber-50/50 dark:bg-amber-950/20 hover:bg-amber-50 dark:hover:bg-amber-950/30",
  rose: "bg-rose-50/50 dark:bg-rose-950/20 hover:bg-rose-50 dark:hover:bg-rose-950/30",
  slate: "bg-slate-50/50 dark:bg-slate-900/20 hover:bg-slate-50 dark:hover:bg-slate-900/30",
};

const STATUS_BADGE: Record<Tone, string> = {
  emerald: "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800",
  amber: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800",
  rose: "bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800",
  slate: "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-900/50 dark:text-slate-300 dark:border-slate-700",
};

const STATUS_ICON: Record<Tone, React.ComponentType<{ className?: string }>> = {
  emerald: CheckCircle2,
  amber: AlertTriangle,
  rose: AlertCircle,
  slate: Info,
};

// Filter tabs.
type FilterKey =
  | "all"
  | "MATCHED"
  | "QTY_MISMATCH"
  | "MISSING_ON_WEBSITE"
  | "MISSING_IN_EXCEL"
  | "DUPLICATE"
  | "FACTORY_PO_ERROR"
  | "SIZE_ERROR";

const FILTER_TABS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "ALL" },
  { key: "MATCHED", label: "MATCHED" },
  { key: "QTY_MISMATCH", label: "QTY MISMATCH" },
  { key: "MISSING_ON_WEBSITE", label: "MISSING ON WEBSITE" },
  { key: "MISSING_IN_EXCEL", label: "MISSING IN EXCEL" },
  { key: "DUPLICATE", label: "DUPLICATE" },
  { key: "FACTORY_PO_ERROR", label: "FACTORY PO ERROR" },
  { key: "SIZE_ERROR", label: "SIZE ERROR" },
];

// ===== Helpers =====

// Parse a date string to yyyy-MM-dd. Mirrors server logic in
// reconciliation-service.ts:parseDate. Handles Excel serials, dd/MM/yyyy, ISO.
function parseDateToISO(raw: string | number | null | undefined): string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const s = String(raw).trim();
  if (!s) return null;
  // Excel serial (number of days since 1899-12-30).
  const n = Number(s);
  if (!isNaN(n) && n > 1000 && n < 100000) {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    epoch.setDate(epoch.getDate() + n);
    return epoch.toISOString().slice(0, 10);
  }
  // dd/MM/yyyy
  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) {
    const d = new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  // yyyy-MM-dd or generic ISO
  const iso = new Date(s);
  if (!isNaN(iso.getTime())) return iso.toISOString().slice(0, 10);
  return null;
}

// Convert raw Excel rows (keyed by Excel header) → canonical rows keyed by
// { date, poNo, factoryPO, size, qty } using the user's column mapping.
// mapping values can be canonicalField strings or "__skip__".
function buildCanonicalRows(
  allRows: Record<string, string>[],
  mapping: Record<string, string>
): Array<{ date?: string; poNo?: string; factoryPO?: string; size?: string; qty?: string }> {
  // Build reverse lookup: canonicalField → excelHeader (first match wins).
  const reverse: Partial<Record<CanonicalField, string>> = {};
  for (const [header, field] of Object.entries(mapping)) {
    if (!field || field === SKIP_VALUE) continue;
    if (!reverse[field as CanonicalField]) {
      reverse[field as CanonicalField] = header;
    }
  }
  const dh = reverse.date;
  const ph = reverse.poNo;
  const fh = reverse.factoryPO;
  const sh = reverse.size;
  const qh = reverse.qty1;
  return allRows.map((row) => {
    const out: { date?: string; poNo?: string; factoryPO?: string; size?: string; qty?: string } = {};
    if (dh) out.date = row[dh] ?? "";
    if (ph) out.poNo = row[ph] ?? "";
    if (fh) out.factoryPO = row[fh] ?? "";
    if (sh) out.size = row[sh] ?? "";
    if (qh) out.qty = row[qh] ?? "";
    return out;
  });
}

// Filter canonical rows by date range. Rows without a parseable date or outside
// the [from, to] window are excluded (matches server-side filter logic).
// Generic in T so the caller's row shape (canonical fields) is preserved.
function filterRowsByDate<T extends { date?: string }>(
  rows: T[],
  from: string,
  to: string
): T[] {
  if (!from || !to) return rows;
  return rows.filter((r) => {
    if (!r.date) return false;
    const iso = parseDateToISO(r.date);
    if (!iso) return false;
    return iso >= from && iso <= to;
  });
}

// Format a number with thousands separator. Empty/NaN → em dash.
function fmtNum(n: number | undefined | null): string {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return n.toLocaleString();
}

// Format a difference with explicit + or - sign.
function fmtDiff(n: number | undefined | null): string {
  if (n === null || n === undefined || isNaN(n) || n === 0) return "0";
  return n > 0 ? `+${n.toLocaleString()}` : n.toLocaleString();
}

// Human-readable explanation for each comparison status.
function statusExplanation(status: string): string {
  switch (status) {
    case "MATCHED":
      return "Excel and Website have the same Qty for this PO NO# + Factory PO + Size combination. No action needed.";
    case "QTY_MISMATCH":
      return "Both sources have this combination, but the summed quantities differ. Verify which side is correct, then update.";
    case "MISSING_ON_WEBSITE":
      return "This combination exists in Excel but is missing on the Website (MasterData). Consider importing it into Master Data.";
    case "MISSING_IN_EXCEL":
      return "This combination exists on the Website but is missing in the uploaded Excel file. Possibly not yet shipped, or filtered out by date.";
    case "POSSIBLE_WRONG_FACTORY_PO":
      return "The Excel Factory PO was not found on the Website, but a different Factory PO for the same PO NO# + Size exists. Likely a typo in the Factory PO column.";
    case "POSSIBLE_WRONG_SIZE":
      return "The Excel Size was not found on the Website, but a different Size for the same PO NO# + Factory PO exists. Likely a typo or wrong size code.";
    case "POSSIBLE_DUPLICATE":
      return "Excel and Website totals match, but multiple rows were grouped together — possibly the same record was entered more than once.";
    case "EXACT_DUPLICATE":
      return "An identical record (same Date + PO + Factory PO + Size + Qty) appears more than once within a single source. Likely a duplicate entry.";
    case "INVALID_DATA":
      return "Row is missing required PO NO#, Factory PO, or Size — skipped from comparison. Fix the source data and re-upload.";
    default:
      return "Unknown status.";
  }
}

// Get today - 6 days as { from, to } in yyyy-MM-dd (last 7 days inclusive).
function last7DaysRange(): { from: string; to: string } {
  const today = new Date();
  const start = new Date(today);
  start.setDate(today.getDate() - 6);
  return {
    from: start.toISOString().slice(0, 10),
    to: today.toISOString().slice(0, 10),
  };
}

// Apply filter tab to a result row (multiple statuses can fall under one tab).
function rowMatchesFilter(status: string, filter: FilterKey): boolean {
  if (filter === "all") return true;
  if (filter === "DUPLICATE") return status === "POSSIBLE_DUPLICATE" || status === "EXACT_DUPLICATE";
  if (filter === "FACTORY_PO_ERROR") return status === "POSSIBLE_WRONG_FACTORY_PO";
  if (filter === "SIZE_ERROR") return status === "POSSIBLE_WRONG_SIZE";
  return status === filter;
}

// ===== Component =====

export function ProductReconciliationView() {
  const { currentProduct, bumpRefresh, refreshKey } = useAppStore();
  const theme = PRODUCT_THEME[currentProduct];

  // Spec-required state.
  const [file, setFile] = React.useState<File | null>(null);
  const [parsing, setParsing] = React.useState(false);
  const [parseResult, setParseResult] = React.useState<any>(null);
  const [allRows, setAllRows] = React.useState<Record<string, string>[]>([]);
  const [sheet, setSheet] = React.useState("");
  const [mapping, setMapping] = React.useState<Record<string, string>>({});
  const [dateFrom, setDateFrom] = React.useState("");
  const [dateTo, setDateTo] = React.useState("");
  const [comparing, setComparing] = React.useState(false);
  const [result, setResult] = React.useState<any>(null);
  const [filter, setFilter] = React.useState<string>("all");
  const [showOnlyIssues, setShowOnlyIssues] = React.useState(true);
  const [detailRow, setDetailRow] = React.useState<any>(null);

  // Workbook is a large non-serializable XLSX.WorkBook — store in a ref.
  const wbRef = React.useRef<any>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = React.useState(false);

  // Initialize date range default (last 7 days).
  React.useEffect(() => {
    const r = last7DaysRange();
    setDateFrom(r.from);
    setDateTo(r.to);
  }, []);

  // ===== Handle file upload (drag-drop or input).
  async function handleFileSelect(selectedFile: File | null | undefined) {
    if (!selectedFile) return;
    const name = selectedFile.name.toLowerCase();
    if (!name.endsWith(".xlsx") && !name.endsWith(".xls")) {
      toast.error("Please upload an .xlsx or .xls file.");
      return;
    }
    setFile(selectedFile);
    setParsing(true);
    setParseResult(null);
    setAllRows([]);
    setSheet("");
    setMapping({});
    setResult(null);
    setFilter("all");
    try {
      // 1) Server preview (50 rows + sheets + autoMapping for default sheet).
      const preview = await api.parseExcel(selectedFile);
      setParseResult(preview);

      // 2) Client-side full parse — read the workbook once, store in ref.
      const buf = await selectedFile.arrayBuffer();
      const { wb, sheets } = readWorkbook(buf);
      wbRef.current = wb;

      // Auto-select the first sheet (or the api's selectedSheet).
      const firstSheet =
        preview.selectedSheet || preview.sheets?.[0]?.name || sheets[0]?.name || "";
      if (firstSheet) {
        setSheet(firstSheet);
        const { headers, rows } = parseSheet(wb, firstSheet);
        setAllRows(rows);
        // Initialize mapping via buildAutoMapping (canonical field per excel header).
        const autoMapping = buildAutoMapping(headers);
        // Convert Record<string, CanonicalField | ""> to Record<string, string>
        // using "__skip__" sentinel for empty values.
        const initMapping: Record<string, string> = {};
        for (const h of headers) {
          const f = autoMapping[h] || "";
          initMapping[h] = f || SKIP_VALUE;
        }
        setMapping(initMapping);
        toast.success(
          `Parsed ${rows.length.toLocaleString()} rows from sheet "${firstSheet}".`
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to parse Excel file";
      toast.error(msg);
      setFile(null);
    } finally {
      setParsing(false);
    }
  }

  // ===== Handle sheet change — re-parse client-side, rebuild mapping.
  function handleSheetChange(nextSheet: string) {
    if (!wbRef.current || nextSheet === sheet) return;
    setSheet(nextSheet);
    setAllRows([]);
    setMapping({});
    setResult(null);
    setFilter("all");
    try {
      const { headers, rows } = parseSheet(wbRef.current, nextSheet);
      setAllRows(rows);
      const autoMapping = buildAutoMapping(headers);
      const initMapping: Record<string, string> = {};
      for (const h of headers) {
        const f = autoMapping[h] || "";
        initMapping[h] = f || SKIP_VALUE;
      }
      setMapping(initMapping);
      toast.info(
        `Switched to sheet "${nextSheet}" — ${rows.length.toLocaleString()} rows parsed.`
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to parse sheet";
      toast.error(msg);
    }
  }

  // ===== Update a single column mapping entry.
  function handleMappingChange(header: string, value: string) {
    setMapping((prev) => ({ ...prev, [header]: value }));
    setResult(null);
  }

  // ===== Compare Excel rows with Website data.
  async function handleCompare() {
    if (!allRows.length) {
      toast.error("No Excel rows to compare. Upload and select a sheet first.");
      return;
    }
    // Required-field coverage check.
    const mappedFields = new Set(
      Object.values(mapping).filter((v) => v && v !== SKIP_VALUE) as CanonicalField[]
    );
    const missing = REQUIRED_FIELDS.filter((f) => !mappedFields.has(f));
    if (missing.length > 0) {
      toast.error(
        `Missing required columns: ${missing.map((f) => FIELD_LABELS[f]).join(", ")}`
      );
      return;
    }
    if (!dateFrom || !dateTo) {
      toast.error("Please select a date range (From + To).");
      return;
    }
    if (dateFrom > dateTo) {
      toast.error("Date From must be on or before Date To.");
      return;
    }

    setComparing(true);
    setResult(null);
    try {
      // Build canonical rows from raw rows + user mapping.
      const canonicalRows = buildCanonicalRows(allRows, mapping);
      const res = await api.reconcileData({
        productType: currentProduct,
        dateFrom,
        dateTo,
        excelRows: canonicalRows,
      });
      setResult(res);
      setFilter("all");
      const issues = res.summary?.totalIssues ?? 0;
      const matched = res.summary?.matched ?? 0;
      if (issues > 0) {
        toast.warning(
          `Reconciled ${res.summary.totalGroups} groups — ${matched} matched, ${issues} issue(s).`
        );
      } else {
        toast.success(
          `Reconciled ${res.summary.totalGroups} groups — all matched!`
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Reconciliation failed";
      toast.error(msg);
    } finally {
      setComparing(false);
    }
  }

  // ===== Reset everything.
  function resetAll() {
    setFile(null);
    setParsing(false);
    setParseResult(null);
    setAllRows([]);
    setSheet("");
    setMapping({});
    setResult(null);
    setFilter("all");
    setShowOnlyIssues(true);
    setDetailRow(null);
    wbRef.current = null;
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // ===== Derived values.
  const headers = parseResult?.headers ?? [];
  const previewRows: Record<string, string>[] = parseResult?.preview ?? [];
  const sheets = parseResult?.sheets ?? [];

  // In-range Excel rows (canonical) for preview table + counts.
  const canonicalRows = React.useMemo(
    () => buildCanonicalRows(allRows, mapping),
    [allRows, mapping]
  );
  const inRangeRows = React.useMemo(
    () => filterRowsByDate(canonicalRows, dateFrom, dateTo),
    [canonicalRows, dateFrom, dateTo]
  );
  const excelTotalRecords = allRows.length;
  const excelInDateRange = inRangeRows.length;
  const excelExcluded = Math.max(0, excelTotalRecords - excelInDateRange);

  // Required-field coverage.
  const mappedFields = new Set(
    Object.values(mapping).filter((v) => v && v !== SKIP_VALUE) as CanonicalField[]
  );
  const missingRequired = REQUIRED_FIELDS.filter((f) => !mappedFields.has(f));
  const hasMappingError = headers.length > 0 && missingRequired.length > 0;
  const canCompare =
    !comparing &&
    !parsing &&
    allRows.length > 0 &&
    missingRequired.length === 0 &&
    excelInDateRange > 0 &&
    !!dateFrom &&
    !!dateTo;

  // Filtered result rows.
  const allResults: any[] = result?.results ?? [];
  const filteredResults = React.useMemo(() => {
    let list = allResults;
    if (filter !== "all") {
      list = list.filter((r) => rowMatchesFilter(r.status, filter as FilterKey));
    }
    if (showOnlyIssues) {
      list = list.filter((r) => r.status !== "MATCHED");
    }
    return list;
  }, [allResults, filter, showOnlyIssues]);

  // Tab counts.
  const tabCounts = React.useMemo(() => {
    const m: Record<FilterKey, number> = {
      all: allResults.length,
      MATCHED: 0,
      QTY_MISMATCH: 0,
      MISSING_ON_WEBSITE: 0,
      MISSING_IN_EXCEL: 0,
      DUPLICATE: 0,
      FACTORY_PO_ERROR: 0,
      SIZE_ERROR: 0,
    };
    for (const r of allResults) {
      if (r.status === "MATCHED") m.MATCHED++;
      else if (r.status === "QTY_MISMATCH") m.QTY_MISMATCH++;
      else if (r.status === "MISSING_ON_WEBSITE") m.MISSING_ON_WEBSITE++;
      else if (r.status === "MISSING_IN_EXCEL") m.MISSING_IN_EXCEL++;
      else if (r.status === "POSSIBLE_DUPLICATE" || r.status === "EXACT_DUPLICATE")
        m.DUPLICATE++;
      else if (r.status === "POSSIBLE_WRONG_FACTORY_PO") m.FACTORY_PO_ERROR++;
      else if (r.status === "POSSIBLE_WRONG_SIZE") m.SIZE_ERROR++;
    }
    return m;
  }, [allResults]);

  // Suppress unused warning for refreshKey (reserved for query keys).
  void refreshKey;
  // bumpRefresh is included per spec; reconcile is read-only so we don't
  // need to call it, but keep the destructure for consistency with sibling views.
  void bumpRefresh;

  const summary = result?.summary;

  return (
    <div className="space-y-5">
      {/* ===== Header ===== */}
      <div
        className={cn(
          "relative overflow-hidden rounded-xl border bg-gradient-to-r p-5 text-white shadow-sm",
          theme.gradient
        )}
      >
        <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-white/10" />
        <div className="relative flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/15 backdrop-blur">
              <GitCompare className="h-6 w-6" />
            </div>
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider text-white/80">
                Data Reconciliation &amp; Duplicate Check
              </p>
              <h1 className="text-2xl font-bold tracking-tight">
                Reconciliation · {currentProduct}
              </h1>
              <p className="text-xs text-white/80">
                Upload an Excel file → filter by date → compare with Website MasterData →
                spot mismatches, missing rows, duplicates, and likely typos.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge className="border-white/30 bg-white/15 text-white">{currentProduct}</Badge>
            {file && (
              <Badge className="flex items-center gap-1 border-white/30 bg-white/15 text-white">
                <FileSpreadsheet className="h-3 w-3" /> {file.name}
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* ===== Section 1: File Upload + Sheet Selection ===== */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Upload className="h-4 w-4 text-primary" />
            Upload Excel File
            {file && (
              <Badge variant="outline" className="ml-1 text-[10px]">
                {allRows.length.toLocaleString()} rows
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Drag-drop area or file summary */}
          {!file ? (
            <div
              className={cn(
                "flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center transition-colors",
                dragOver
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/40 hover:bg-muted/30"
              )}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const f = e.dataTransfer.files?.[0];
                if (f) handleFileSelect(f);
              }}
            >
              <FileSpreadsheet className="mb-2 h-10 w-10 text-muted-foreground" />
              <p className="text-sm font-medium">
                Drag &amp; drop an Excel file here, or click to browse
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Supports .xlsx and .xls — full row set will be parsed client-side
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3 gap-1.5"
                disabled={parsing}
                onClick={() => fileInputRef.current?.click()}
              >
                {parsing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Upload className="h-3.5 w-3.5" />
                )}
                {parsing ? "Parsing…" : "Browse"}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFileSelect(f);
                }}
              />
            </div>
          ) : (
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-950/40">
                  <FileSpreadsheet className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div>
                  <div className="text-sm font-medium break-all">{file.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {allRows.length.toLocaleString()} rows parsed
                    {parsing && " · loading…"}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={parsing}
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Replace
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-rose-600 hover:text-rose-700"
                  onClick={resetAll}
                  disabled={parsing || comparing}
                >
                  <Trash2 className="h-3.5 w-3.5" /> Remove
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFileSelect(f);
                  }}
                />
              </div>
            </div>
          )}

          {/* Sheet selector */}
          {sheets.length > 0 && (
            <div className="flex flex-col gap-2 md:flex-row md:items-end">
              <div className="flex-1">
                <Label className="text-xs font-medium">Select Sheet</Label>
                <Select value={sheet} onValueChange={handleSheetChange} disabled={parsing}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="— select a sheet —" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72 scroll-thin">
                    {sheets.map((s: any) => (
                      <SelectItem key={s.name} value={s.name}>
                        <span className="flex items-center gap-2">
                          <SheetIcon className="h-3.5 w-3.5" />
                          {s.name}
                          <Badge variant="outline" className="ml-1 text-[9px]">
                            {(s.totalRows ?? 0).toLocaleString()} rows
                          </Badge>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ===== Section 2: Column Mapping ===== */}
      {headers.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Layers className="h-4 w-4 text-primary" />
              Column Mapping
              <Badge variant="outline" className="ml-1 text-[10px]">
                {headers.length} columns
              </Badge>
              {hasMappingError ? (
                <Badge className="ml-1 bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800 text-[10px]">
                  MISSING REQUIRED COLUMN
                </Badge>
              ) : (
                <Badge className="ml-1 bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800 text-[10px]">
                  Required OK
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {hasMappingError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Missing required column(s)</AlertTitle>
                <AlertDescription>
                  These required columns are not mapped:{" "}
                  <strong>
                    {missingRequired.map((f) => FIELD_LABELS[f]).join(", ")}
                  </strong>
                  . Either rename the column in Excel to match a known alias, or
                  manually map it below.
                </AlertDescription>
              </Alert>
            )}
            <div className="max-h-96 overflow-y-auto scroll-thin rounded-md border">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-muted/80 backdrop-blur">
                  <TableRow>
                    <TableHead className="w-1/3 text-[10px] uppercase">Excel Column</TableHead>
                    <TableHead className="w-1/3 text-[10px] uppercase">Sample Value</TableHead>
                    <TableHead className="w-12 text-[10px] uppercase text-center">→</TableHead>
                    <TableHead className="w-1/3 text-[10px] uppercase">System Field</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {headers.map((h: string) => {
                    const canonical = mapping[h] || SKIP_VALUE;
                    const sample = previewRows[0]?.[h] ?? allRows[0]?.[h] ?? "";
                    const isRequired =
                      canonical !== SKIP_VALUE &&
                      REQUIRED_FIELDS.includes(canonical as CanonicalField);
                    return (
                      <TableRow key={h} className="border-t">
                        <TableCell className="px-3 py-2 text-xs font-medium break-all">
                          {h}
                          {REQUIRED_FIELDS.includes(canonical as CanonicalField) && (
                            <span className="ml-1 text-rose-600">*</span>
                          )}
                        </TableCell>
                        <TableCell className="px-3 py-2 text-xs text-muted-foreground break-all">
                          {sample ? (
                            <span className="line-clamp-1">{sample}</span>
                          ) : (
                            <span className="text-muted-foreground/40">—</span>
                          )}
                        </TableCell>
                        <TableCell className="px-3 py-2 text-center text-muted-foreground">
                          →
                        </TableCell>
                        <TableCell className="px-3 py-2">
                          <Select
                            value={canonical}
                            onValueChange={(v) => handleMappingChange(h, v)}
                          >
                            <SelectTrigger size="sm" className="w-full">
                              <SelectValue placeholder="— skip —" />
                            </SelectTrigger>
                            <SelectContent className="max-h-72 scroll-thin">
                              <SelectItem value={SKIP_VALUE}>— skip —</SelectItem>
                              {mappingOptions().map((opt) => (
                                <SelectItem key={opt.value} value={opt.value}>
                                  {opt.label}
                                  {REQUIRED_FIELDS.includes(opt.value as CanonicalField)
                                    ? " *"
                                    : ""}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {isRequired && (
                            <div className="mt-0.5 text-[10px] text-rose-600 dark:text-rose-400">
                              required
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Info className="h-3 w-3" />
              Fields marked <strong>*</strong> are required for reconciliation:
              Date, PO NO#, Factory PO, Size, Q&apos;ty 1.
            </div>
          </CardContent>
        </Card>
      )}

      {/* ===== Section 3: Date Range Filter ===== */}
      {allRows.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Calendar className="h-4 w-4 text-primary" />
              Date Range Filter
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <Label htmlFor="date-from" className="text-xs font-medium">
                  From
                </Label>
                <Input
                  id="date-from"
                  type="date"
                  value={dateFrom}
                  onChange={(e) => {
                    setDateFrom(e.target.value);
                    setResult(null);
                  }}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="date-to" className="text-xs font-medium">
                  To
                </Label>
                <Input
                  id="date-to"
                  type="date"
                  value={dateTo}
                  onChange={(e) => {
                    setDateTo(e.target.value);
                    setResult(null);
                  }}
                  className="mt-1"
                />
              </div>
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Info className="h-3 w-3" />
              Only data with <strong>Date</strong> in this range will be compared. Rows
              without a parseable Date or outside this window are excluded.
            </div>
          </CardContent>
        </Card>
      )}

      {/* ===== Section 4: Preview Filtered Data ===== */}
      {allRows.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Search className="h-4 w-4 text-primary" />
              Preview Filtered Data
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <StatBox label="Total Excel Rows" value={excelTotalRecords} tone="slate" />
              <StatBox label="In Date Range" value={excelInDateRange} tone="emerald" />
              <StatBox label="Excluded" value={excelExcluded} tone="rose" />
            </div>
            {/* First 10 in-range rows */}
            <div className="rounded-md border">
              <Table>
                <TableHeader className="bg-muted/80 backdrop-blur">
                  <TableRow>
                    <TableHead className="text-[10px] uppercase">#</TableHead>
                    <TableHead className="text-[10px] uppercase">Date</TableHead>
                    <TableHead className="text-[10px] uppercase">PO NO#</TableHead>
                    <TableHead className="text-[10px] uppercase">Factory PO</TableHead>
                    <TableHead className="text-[10px] uppercase">Size</TableHead>
                    <TableHead className="text-[10px] uppercase text-right">Qty</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {inRangeRows.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="py-8 text-center text-xs text-muted-foreground"
                      >
                        No rows in the selected date range.
                      </TableCell>
                    </TableRow>
                  ) : (
                    inRangeRows.slice(0, 10).map((r, i) => (
                      <TableRow key={i} className="border-t">
                        <TableCell className="px-3 py-1.5 text-[10px] tabular-nums text-muted-foreground">
                          {i + 1}
                        </TableCell>
                        <TableCell className="px-3 py-1.5 text-xs whitespace-nowrap">
                          {r.date || "—"}
                        </TableCell>
                        <TableCell className="px-3 py-1.5 text-xs whitespace-nowrap">
                          {r.poNo || "—"}
                        </TableCell>
                        <TableCell className="px-3 py-1.5 text-xs font-medium whitespace-nowrap">
                          {r.factoryPO || "—"}
                        </TableCell>
                        <TableCell className="px-3 py-1.5">
                          {r.size ? (
                            <Badge variant="outline" className="text-[9px] font-mono">
                              {r.size}
                            </Badge>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell className="px-3 py-1.5 text-xs text-right tabular-nums">
                          {r.qty ?? "—"}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
            {inRangeRows.length > 10 && (
              <div className="text-center text-[11px] text-muted-foreground">
                Showing first 10 of {inRangeRows.length.toLocaleString()} in-range rows.
              </div>
            )}
            <div className="flex justify-end">
              <Button
                onClick={handleCompare}
                disabled={!canCompare}
                className={cn("gap-1.5", theme.bg, "text-white hover:opacity-90")}
              >
                {comparing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <GitCompare className="h-4 w-4" />
                )}
                {comparing ? "Comparing…" : "Compare with Website Data"}
              </Button>
            </div>
            {!canCompare && allRows.length > 0 && (
              <div className="text-right text-[11px] text-muted-foreground">
                {missingRequired.length > 0
                  ? `Map required columns first: ${missingRequired
                      .map((f) => FIELD_LABELS[f])
                      .join(", ")}`
                  : excelInDateRange === 0
                  ? "No rows in date range — adjust the filter or upload a different file."
                  : ""}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ===== Section 5: Comparison Summary ===== */}
      {summary && (
        <>
          {/* 9 summary cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <SummaryCard
              label="Matched"
              value={summary.matched}
              icon={CheckCircle2}
              tone="emerald"
            />
            <SummaryCard
              label="Qty Mismatch"
              value={summary.qtyMismatch}
              icon={AlertTriangle}
              tone="amber"
            />
            <SummaryCard
              label="Missing on Website"
              value={summary.missingOnWebsite}
              icon={AlertCircle}
              tone="rose"
            />
            <SummaryCard
              label="Missing in Excel"
              value={summary.missingInExcel}
              icon={AlertTriangle}
              tone="amber"
            />
            <SummaryCard
              label="Possible Wrong Factory PO"
              value={summary.possibleWrongFactoryPO}
              icon={AlertTriangle}
              tone="amber"
            />
            <SummaryCard
              label="Possible Wrong Size"
              value={summary.possibleWrongSize}
              icon={AlertTriangle}
              tone="amber"
            />
            <SummaryCard
              label="Possible Duplicate"
              value={summary.possibleDuplicate}
              icon={AlertCircle}
              tone="rose"
            />
            <SummaryCard
              label="Exact Duplicate"
              value={summary.exactDuplicate}
              icon={AlertCircle}
              tone="rose"
            />
            <SummaryCard
              label="Total Issues"
              value={summary.totalIssues}
              icon={AlertCircle}
              tone="rose"
            />
          </div>

          {/* Date Range Safety card */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Info className="h-4 w-4 text-primary" />
                Date Range Safety
                <Badge variant="outline" className="ml-1 text-[10px]">
                  {summary.dateRange?.from} → {summary.dateRange?.to}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {/* Excel */}
                <div className="rounded-md border bg-muted/30 p-3">
                  <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
                    <FileSpreadsheet className="h-3.5 w-3.5" /> Excel Source
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <StatBox
                      label="Total"
                      value={summary.excelTotalRecords}
                      tone="slate"
                      compact
                    />
                    <StatBox
                      label="In Range"
                      value={summary.excelRecordsInDateRange}
                      tone="emerald"
                      compact
                    />
                    <StatBox
                      label="Excluded"
                      value={summary.excelExcluded}
                      tone="rose"
                      compact
                    />
                  </div>
                </div>
                {/* Website */}
                <div className="rounded-md border bg-muted/30 p-3">
                  <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
                    <GitCompare className="h-3.5 w-3.5" /> Website Source
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <StatBox
                      label="Total"
                      value={summary.websiteTotalRecords}
                      tone="slate"
                      compact
                    />
                    <StatBox
                      label="In Range"
                      value={summary.websiteRecordsInDateRange}
                      tone="emerald"
                      compact
                    />
                    <StatBox
                      label="Excluded"
                      value={summary.websiteExcluded}
                      tone="rose"
                      compact
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* ===== Section 6 & 7: Filter Tabs + Results Table ===== */}
      {result && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <CardTitle className="flex items-center gap-2 text-base">
                <FileSpreadsheet className="h-4 w-4 text-primary" />
                Comparison Results
                <Badge variant="outline" className="ml-1 text-[10px]">
                  {allResults.length.toLocaleString()} groups
                </Badge>
              </CardTitle>
              <label className="flex items-center gap-2 text-xs">
                <Switch
                  checked={showOnlyIssues}
                  onCheckedChange={(v) => {
                    setShowOnlyIssues(v);
                    setFilter("all");
                  }}
                />
                Show only issues
              </label>
            </div>
            <Tabs
              value={filter}
              onValueChange={(v) => setFilter(v as string)}
              className="mt-2"
            >
              <TabsList className="flex w-full flex-wrap gap-1">
                {FILTER_TABS.map((t) => (
                  <TabsTrigger key={t.key} value={t.key} className="text-[10px]">
                    {t.label}
                    <Badge variant="secondary" className="ml-1 text-[9px]">
                      {tabCounts[t.key]}
                    </Badge>
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </CardHeader>
          <CardContent className="p-0">
            <div className="max-h-[600px] overflow-y-auto scroll-thin">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-muted/80 backdrop-blur">
                  <TableRow>
                    <TableHead className="w-[120px] text-[10px] uppercase">Status</TableHead>
                    <TableHead className="text-[10px] uppercase">PO NO#</TableHead>
                    <TableHead className="text-[10px] uppercase">Factory PO</TableHead>
                    <TableHead className="text-[10px] uppercase">Size</TableHead>
                    <TableHead className="text-[10px] uppercase text-right">Excel Qty</TableHead>
                    <TableHead className="text-[10px] uppercase text-right">Website Qty</TableHead>
                    <TableHead className="text-[10px] uppercase text-right">Difference</TableHead>
                    <TableHead className="w-[100px] text-[10px] uppercase text-center">
                      Actions
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredResults.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={8}
                        className="py-10 text-center text-xs text-muted-foreground"
                      >
                        No rows match this filter.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredResults.map((r: any, idx: number) => {
                      const tone = STATUS_TONE[r.status] || "slate";
                      const Icon = STATUS_ICON[tone];
                      const diff = r.difference ?? 0;
                      const diffTone =
                        diff > 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : diff < 0
                          ? "text-rose-600 dark:text-rose-400"
                          : "text-muted-foreground";
                      return (
                        <TableRow
                          key={`${r.poNo}-${r.factoryPO}-${r.size}-${idx}`}
                          className={cn(
                            "cursor-pointer border-t",
                            STATUS_ROW_TINT[tone]
                          )}
                          onClick={() => setDetailRow(r)}
                        >
                          <TableCell className="px-3 py-1.5">
                            <Badge
                              variant="outline"
                              className={cn("text-[9px]", STATUS_BADGE[tone])}
                            >
                              <Icon className="mr-0.5 h-2.5 w-2.5" />
                              {r.status.replace(/_/g, " ")}
                            </Badge>
                          </TableCell>
                          <TableCell className="px-3 py-1.5 text-xs whitespace-nowrap">
                            {r.poNo || "—"}
                          </TableCell>
                          <TableCell className="px-3 py-1.5 text-xs font-medium whitespace-nowrap">
                            {r.factoryPO || "—"}
                          </TableCell>
                          <TableCell className="px-3 py-1.5">
                            {r.size ? (
                              <Badge variant="outline" className="text-[9px] font-mono">
                                {r.size}
                              </Badge>
                            ) : (
                              "—"
                            )}
                          </TableCell>
                          <TableCell className="px-3 py-1.5 text-xs text-right tabular-nums">
                            {fmtNum(r.excelQty)}
                          </TableCell>
                          <TableCell className="px-3 py-1.5 text-xs text-right tabular-nums">
                            {fmtNum(r.websiteQty)}
                          </TableCell>
                          <TableCell
                            className={cn(
                              "px-3 py-1.5 text-xs text-right tabular-nums font-semibold",
                              diffTone
                            )}
                          >
                            {fmtDiff(diff)}
                          </TableCell>
                          <TableCell className="px-3 py-1.5 text-center">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 gap-1"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDetailRow(r);
                              }}
                            >
                              <Eye className="h-3.5 w-3.5" />
                              <span className="text-[10px]">View</span>
                            </Button>
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
                Showing {filteredResults.length.toLocaleString()} of{" "}
                {allResults.length.toLocaleString()} groups
              </span>
              <span className="flex items-center gap-1">
                <Filter className="h-3 w-3" /> Click a row to view detail
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ===== Section 8: Detail Dialog (READ-ONLY) ===== */}
      <Dialog open={!!detailRow} onOpenChange={(o) => !o && setDetailRow(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto scroll-thin">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="h-5 w-5 text-primary" />
              Reconciliation Detail
              {detailRow && (
                <Badge
                  variant="outline"
                  className={cn(
                    "ml-1 text-[10px]",
                    STATUS_BADGE[STATUS_TONE[detailRow.status] || "slate"]
                  )}
                >
                  {detailRow.status.replace(/_/g, " ")}
                </Badge>
              )}
            </DialogTitle>
            <DialogDescription>
              Read-only detail of one comparison group (PO NO# + Factory PO + Size).
            </DialogDescription>
          </DialogHeader>
          {detailRow && (
            <div className="space-y-4">
              {/* Identity */}
              <div className="grid grid-cols-3 gap-3">
                <DetailField label="PO NO#" value={detailRow.poNo} />
                <DetailField label="Factory PO" value={detailRow.factoryPO} />
                <DetailField label="Size" value={detailRow.size} mono />
              </div>

              {/* Quantities */}
              <div className="grid grid-cols-3 gap-3 rounded-md border bg-muted/30 p-3">
                <DetailNumber label="Excel Qty" value={detailRow.excelQty} />
                <DetailNumber label="Website Qty" value={detailRow.websiteQty} />
                <div>
                  <div className="text-[10px] font-medium uppercase text-muted-foreground">
                    Difference
                  </div>
                  <div
                    className={cn(
                      "text-sm font-bold tabular-nums",
                      (detailRow.difference ?? 0) > 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : (detailRow.difference ?? 0) < 0
                        ? "text-rose-600 dark:text-rose-400"
                        : "text-foreground"
                    )}
                  >
                    {fmtDiff(detailRow.difference)}
                  </div>
                </div>
              </div>

              {/* Status + explanation */}
              <div
                className={cn(
                  "rounded-md border p-3 text-xs",
                  STATUS_BADGE[STATUS_TONE[detailRow.status] || "slate"]
                )}
              >
                <div className="flex items-center gap-1.5 font-semibold">
                  <Badge
                    variant="outline"
                    className={cn("text-[9px]", STATUS_BADGE[STATUS_TONE[detailRow.status] || "slate"])}
                  >
                    {detailRow.status.replace(/_/g, " ")}
                  </Badge>
                  Status Explanation
                </div>
                <p className="mt-1.5 text-foreground/90">
                  {statusExplanation(detailRow.status)}
                </p>
              </div>

              {/* Suggestions for typo statuses */}
              {detailRow.status === "POSSIBLE_WRONG_FACTORY_PO" &&
                detailRow.suggestedFactoryPO && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 p-3 text-xs">
                    <div className="mb-1 flex items-center gap-1.5 font-semibold text-amber-700 dark:text-amber-300">
                      <AlertTriangle className="h-3.5 w-3.5" /> Suggested Factory PO
                    </div>
                    <div className="flex items-center gap-2">
                      <code className="rounded bg-amber-100 dark:bg-amber-950/60 px-2 py-1 font-mono text-amber-800 dark:text-amber-200">
                        {detailRow.suggestedFactoryPO}
                      </code>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 gap-1"
                        onClick={() => {
                          navigator.clipboard
                            .writeText(detailRow.suggestedFactoryPO)
                            .then(() => toast.success("Copied to clipboard."))
                            .catch(() => toast.error("Failed to copy."));
                        }}
                      >
                        <Copy className="h-3 w-3" /> Copy
                      </Button>
                    </div>
                    <p className="mt-2 text-amber-700/80 dark:text-amber-300/80">
                      A different Factory PO for the same PO NO# + Size exists on the
                      Website — likely a typo in the Excel file.
                    </p>
                  </div>
                )}

              {detailRow.status === "POSSIBLE_WRONG_SIZE" && detailRow.suggestedSize && (
                <div className="rounded-md border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 p-3 text-xs">
                  <div className="mb-1 flex items-center gap-1.5 font-semibold text-amber-700 dark:text-amber-300">
                    <AlertTriangle className="h-3.5 w-3.5" /> Suggested Size
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="rounded bg-amber-100 dark:bg-amber-950/60 px-2 py-1 font-mono text-amber-800 dark:text-amber-200">
                      {detailRow.suggestedSize}
                    </code>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1"
                      onClick={() => {
                        navigator.clipboard
                          .writeText(detailRow.suggestedSize)
                          .then(() => toast.success("Copied to clipboard."))
                          .catch(() => toast.error("Failed to copy."));
                      }}
                    >
                      <Copy className="h-3 w-3" /> Copy
                    </Button>
                  </div>
                  <p className="mt-2 text-amber-700/80 dark:text-amber-300/80">
                    A different Size for the same PO NO# + Factory PO exists on the
                    Website — likely a typo or wrong size code in the Excel file.
                  </p>
                </div>
              )}

              {detailRow.status === "EXACT_DUPLICATE" &&
                typeof detailRow.duplicateCount === "number" && (
                  <div className="rounded-md border border-rose-200 bg-rose-50 dark:border-rose-800 dark:bg-rose-950/30 p-3 text-xs">
                    <div className="mb-1 flex items-center gap-1.5 font-semibold text-rose-700 dark:text-rose-300">
                      <AlertCircle className="h-3.5 w-3.5" /> Duplicate Count
                    </div>
                    <p>
                      An identical record (Date + PO + Factory PO + Size + Qty) appears{" "}
                      <strong>{detailRow.duplicateCount}</strong> time(s) within a single
                      source. Likely a duplicate entry that should be removed.
                    </p>
                  </div>
                )}

              {/* Row counts */}
              <div className="grid grid-cols-2 gap-3">
                <DetailNumber
                  label="Excel Row Count"
                  value={detailRow.excelRowCount}
                  tone="default"
                />
                <DetailNumber
                  label="Website Row Count"
                  value={detailRow.websiteRowCount}
                  tone="default"
                />
              </div>

              {/* Read-only notice */}
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription>
                  This view is <strong>read-only</strong>. Edit data in Data Entry or
                  Master Data.
                </AlertDescription>
              </Alert>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDetailRow(null)}>
              <X className="h-3.5 w-3.5" /> Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default ProductReconciliationView;

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
  tone?: Tone;
}) {
  const toneClass = (() => {
    switch (tone) {
      case "emerald":
        return "text-emerald-600 dark:text-emerald-400";
      case "amber":
        return "text-amber-600 dark:text-amber-400";
      case "rose":
        return "text-rose-600 dark:text-rose-400";
      default:
        return "text-slate-700 dark:text-slate-200";
    }
  })();
  const iconBg = (() => {
    switch (tone) {
      case "emerald":
        return "bg-emerald-100 dark:bg-emerald-950/40";
      case "amber":
        return "bg-amber-100 dark:bg-amber-950/40";
      case "rose":
        return "bg-rose-100 dark:bg-rose-950/40";
      default:
        return "bg-slate-100 dark:bg-slate-900/40";
    }
  })();
  return (
    <Card className="border-border/60">
      <CardContent className="flex items-center gap-3 p-3">
        <div className={cn("flex h-9 w-9 items-center justify-center rounded-lg", iconBg)}>
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

function StatBox({
  label,
  value,
  tone = "slate",
  compact = false,
}: {
  label: string;
  value: number | string;
  tone?: Tone;
  compact?: boolean;
}) {
  const toneClass = (() => {
    switch (tone) {
      case "emerald":
        return "text-emerald-600 dark:text-emerald-400";
      case "amber":
        return "text-amber-600 dark:text-amber-400";
      case "rose":
        return "text-rose-600 dark:text-rose-400";
      default:
        return "text-slate-700 dark:text-slate-200";
    }
  })();
  return (
    <div className="rounded-md border bg-card p-2 text-center">
      <div className={cn("font-bold tabular-nums", compact ? "text-sm" : "text-lg", toneClass)}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </div>
      <div className="text-[10px] text-muted-foreground leading-tight">{label}</div>
    </div>
  );
}

function DetailField({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | undefined | null;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] font-medium uppercase text-muted-foreground">{label}</div>
      <div className={cn("text-xs font-medium break-words", mono && "font-mono")}>
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
