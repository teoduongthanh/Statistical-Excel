"use client";

// ProductReconciliationView (NEW — Partner File vs Website)
// Upload partner Excel → preview → run reconciliation → view summary + comparison + issues.
//
// Spec: 53 sections covering partner file (orders, order_size_summary, transactions)
//   compared against Website MasterData by business key (PO NO# + Factory PO + Size).
//   READ-ONLY — never modifies Website data. Only reports.
//
// 4-section layout (spec §53):
//   1. Import Partner File (upload + date range + run button)
//   2. Summary (matched / mismatch / missing / duplicate counts)
//   3. Comparison Table (filterable)
//   4. Issue Detail (drill-down to transactions)

import * as React from "react";
import {
  GitCompare,
  Upload,
  FileSpreadsheet,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Eye,
  Filter,
  RefreshCw,
  Download,
  History,
  X,
  ArrowRight,
  Calendar,
  Boxes,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { useAppStore, PRODUCT_THEME } from "@/store/app-store";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

// Status color mapping (spec §23 — must be explicit text, not just colors)
const STATUS_META: Record<string, { color: string; label: string }> = {
  MATCHED: { color: "bg-emerald-100 text-emerald-700 border-emerald-300", label: "Matched" },
  ORDER_QTY_MISMATCH: { color: "bg-amber-100 text-amber-700 border-amber-300", label: "Order Qty Mismatch" },
  OUTPUT_MISMATCH: { color: "bg-orange-100 text-orange-700 border-orange-300", label: "Output Mismatch" },
  INPUT_MISMATCH: { color: "bg-orange-100 text-orange-700 border-orange-300", label: "Input Mismatch" },
  MISSING_ON_WEBSITE: { color: "bg-rose-100 text-rose-700 border-rose-300", label: "Missing on Website" },
  MISSING_ON_PARTNER: { color: "bg-violet-100 text-violet-700 border-violet-300", label: "Missing on Partner" },
  OVER_OUTPUT: { color: "bg-red-100 text-red-700 border-red-300", label: "Over Output" },
  OVER_INPUT: { color: "bg-red-100 text-red-700 border-red-300", label: "Over Input" },
  POSSIBLE_DUPLICATE: { color: "bg-yellow-100 text-yellow-700 border-yellow-300", label: "Possible Duplicate" },
  DATE_DISTRIBUTION_MISMATCH: { color: "bg-blue-100 text-blue-700 border-blue-300", label: "Date Diff" },
  INVALID_DATA: { color: "bg-red-100 text-red-700 border-red-300", label: "Invalid Data" },
  POSSIBLE_WRONG_FACTORY_PO: { color: "bg-orange-100 text-orange-700 border-orange-300", label: "Wrong FPO" },
  POSSIBLE_WRONG_SIZE: { color: "bg-orange-100 text-orange-700 border-orange-300", label: "Wrong Size" },
};

function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? { color: "bg-muted text-muted-foreground border-border", label: status };
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold", meta.color)} title={status}>
      {meta.label}
    </span>
  );
}

export function ProductReconciliationView() {
  const { currentProduct, bumpRefresh } = useAppStore();
  const theme = PRODUCT_THEME[currentProduct];

  // Step 1: Upload state
  const [fileName, setFileName] = React.useState("");
  const [uploading, setUploading] = React.useState(false);
  const [previewing, setPreviewing] = React.useState(false);
  const [preview, setPreview] = React.useState<any>(null);
  const [running, setRunning] = React.useState(false);
  const [runResult, setRunResult] = React.useState<any>(null);
  const [summary, setSummary] = React.useState<any>(null);

  // Date filters
  const [dateFrom, setDateFrom] = React.useState("");
  const [dateTo, setDateTo] = React.useState("");

  // Step 3: Comparison table state
  const [details, setDetails] = React.useState<any[]>([]);
  const [detailsLoading, setDetailsLoading] = React.useState(false);
  const [detailsTotal, setDetailsTotal] = React.useState(0);
  const [detailsPage, setDetailsPage] = React.useState(1);
  const [detailsStatus, setDetailsStatus] = React.useState("");
  const [detailsPo, setDetailsPo] = React.useState("");
  const [detailsFactoryPo, setDetailsFactoryPo] = React.useState("");
  const [detailsSize, setDetailsSize] = React.useState("");

  // Step 4: Issue detail dialog
  const [issueRow, setIssueRow] = React.useState<any>(null);

  // History dialog
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [historyRuns, setHistoryRuns] = React.useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = React.useState(false);

  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = React.useState(false);

  async function handleFile(file: File) {
    setUploading(true);
    setPreview(null);
    setRunResult(null);
    setSummary(null);
    setDetails([]);
    try {
      const r = await api.reconciliationUpload(file);
      setFileName(r.fileName);
      toast.success(`Uploaded ${r.fileName}`, { description: `${r.sizeMB} MB` });
      // Auto-preview
      await loadPreview(r.fileName);
    } catch (e: any) {
      toast.error("Upload failed", { description: e?.message });
    } finally {
      setUploading(false);
    }
  }

  async function loadPreview(fname: string) {
    setPreviewing(true);
    try {
      const r = await api.reconciliationPreview({ fileName: fname });
      setPreview(r.preview);
    } catch (e: any) {
      toast.error("Preview failed", { description: e?.message });
    } finally {
      setPreviewing(false);
    }
  }

  async function handleRun() {
    if (!fileName) return;
    setRunning(true);
    setRunResult(null);
    setSummary(null);
    setDetails([]);
    try {
      const r = await api.reconciliationRun({
        fileName,
        productType: currentProduct,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      });
      setRunResult(r);
      setSummary(r.summary);
      toast.success(`Reconciliation ${r.runNumber} complete`, {
        description: `${r.summary.matchedLines} matched, ${r.summary.mismatchLines} mismatch of ${r.summary.totalLines} lines`,
      });
      bumpRefresh();
      // Load details
      await loadDetails(r.runId);
    } catch (e: any) {
      toast.error("Reconciliation failed", { description: e?.message });
    } finally {
      setRunning(false);
    }
  }

  async function loadDetails(runId: string, page = 1) {
    setDetailsLoading(true);
    try {
      const r = await api.reconciliationDetails(runId, {
        status: detailsStatus || undefined,
        po: detailsPo || undefined,
        factoryPo: detailsFactoryPo || undefined,
        size: detailsSize || undefined,
        page,
        pageSize: 50,
      });
      setDetails(r.rows);
      setDetailsTotal(r.total);
      setDetailsPage(r.page);
    } catch (e: any) {
      toast.error("Load details failed", { description: e?.message });
    } finally {
      setDetailsLoading(false);
    }
  }

  async function loadHistory() {
    setHistoryOpen(true);
    setHistoryLoading(true);
    try {
      const r = await api.reconciliationHistory(20);
      setHistoryRuns(r.runs);
    } catch (e: any) {
      toast.error("Load history failed", { description: e?.message });
    } finally {
      setHistoryLoading(false);
    }
  }

  // Reload details when filters change
  React.useEffect(() => {
    if (runResult?.runId) loadDetails(runResult.runId, 1);
  }, [detailsStatus, detailsPo, detailsFactoryPo, detailsSize, runResult?.runId]);

  const hasRun = !!runResult;

  return (
    <div className="space-y-6">
      {/* Header banner */}
      <div className={cn("relative overflow-hidden rounded-xl bg-gradient-to-r p-6 text-white", theme.gradient)}>
        <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-white/10" />
        <div className="absolute -bottom-10 right-24 h-32 w-32 rounded-full bg-white/5" />
        <div className="relative flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/15 backdrop-blur">
              <GitCompare className="h-6 w-6" />
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-white/70">Reconciliation</div>
              <h1 className="text-2xl font-bold">{currentProduct} · Data Compare</h1>
              <p className="text-xs text-white/70 mt-1">
                Upload partner Excel → compare with Website data by PO NO# + Factory PO + Size. READ-ONLY.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" className="bg-white/20 text-white hover:bg-white/30" onClick={loadHistory}>
              <History className="mr-1.5 h-4 w-4" /> History
            </Button>
          </div>
        </div>
      </div>

      {/* Section 1: Import Partner File */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <span className={cn("flex h-6 w-6 items-center justify-center rounded-full text-xs text-white", theme.bg)}>1</span>
            Import Partner File
            {fileName && <Badge variant="secondary" className="ml-auto text-[10px]">{fileName}</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Upload Excel file from partner (must contain sheets: <code className="px-1 bg-muted rounded">orders</code>,{" "}
            <code className="px-1 bg-muted rounded">order_size_summary</code>,{" "}
            <code className="px-1 bg-muted rounded">transactions</code>). File is parsed and compared against Website
            MasterData. <b>Website data is never modified</b>.
          </p>

          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const f = e.dataTransfer.files[0];
              if (f) handleFile(f);
            }}
            className={cn(
              "rounded-lg border-2 border-dashed p-6 text-center transition-colors cursor-pointer",
              dragOver ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30" : "border-muted-foreground/30 hover:border-emerald-400"
            )}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
                e.target.value = "";
              }}
            />
            {uploading ? (
              <><Loader2 className="h-8 w-8 mx-auto text-emerald-500 mb-2 animate-spin" />
              <div className="text-sm font-medium">Uploading…</div></>
            ) : (
              <><Upload className="h-8 w-8 mx-auto text-emerald-500 mb-2" />
              <div className="text-sm font-medium">Drop Excel file here or click to browse</div>
              <div className="text-[11px] text-muted-foreground mt-1">.xlsx, .xls · single file</div></>
            )}
          </div>

          {/* Date range filter */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs flex items-center gap-1"><Calendar className="h-3 w-3" /> Transaction Date From</Label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-9" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs flex items-center gap-1"><Calendar className="h-3 w-3" /> Transaction Date To</Label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-9" />
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Filters apply to <b>transactions</b> (OUT/IN) only — Order Qty is not date-filtered.
          </p>

          {preview && (
            <div className="rounded-md border border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/20 p-3 text-xs space-y-2">
              <div className="flex items-center gap-1.5 font-medium text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="h-3.5 w-3.5" /> Preview: {preview.fileName}
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded bg-background/60 p-2">
                  <div className="font-bold text-base">{preview.ordersCount}</div>
                  <div className="text-[10px] text-muted-foreground">Orders</div>
                </div>
                <div className="rounded bg-background/60 p-2">
                  <div className="font-bold text-base">{preview.summaryCount}</div>
                  <div className="text-[10px] text-muted-foreground">Size Lines</div>
                </div>
                <div className="rounded bg-background/60 p-2">
                  <div className="font-bold text-base">{preview.transactionsCount}</div>
                  <div className="text-[10px] text-muted-foreground">Transactions</div>
                </div>
              </div>
              <div className="text-[10px] text-muted-foreground">
                Sheets detected: {preview.sheets.join(", ")}
              </div>
            </div>
          )}

          <Button
            size="sm"
            className="w-full bg-emerald-600 hover:bg-emerald-700"
            disabled={!fileName || running || previewing}
            onClick={handleRun}
          >
            {running ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Running reconciliation…</>
            ) : (
              <><Boxes className="mr-2 h-4 w-4" /> Start Reconciliation</>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Section 2: Summary */}
      {summary && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <span className={cn("flex h-6 w-6 items-center justify-center rounded-full text-xs text-white", theme.bg)}>2</span>
              Reconciliation Summary
              {runResult?.runNumber && <Badge variant="secondary" className="ml-auto text-[10px]">{runResult.runNumber}</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <SummaryCard label="Total Lines" value={summary.totalLines} color="bg-slate-100 text-slate-700" />
              <SummaryCard label="Matched" value={summary.matchedLines} color="bg-emerald-100 text-emerald-700" />
              <SummaryCard label="Mismatch" value={summary.mismatchLines} color="bg-amber-100 text-amber-700" />
              <SummaryCard label="Missing on Website" value={summary.missingOnWebsite} color="bg-rose-100 text-rose-700" />
              <SummaryCard label="Missing on Partner" value={summary.missingOnPartner} color="bg-violet-100 text-violet-700" />
              <SummaryCard label="Duplicates" value={summary.duplicateLines} color="bg-yellow-100 text-yellow-700" />
              <SummaryCard label="Over Output" value={summary.overOutputLines} color="bg-red-100 text-red-700" />
              <SummaryCard label="Over Input" value={summary.overInputLines} color="bg-red-100 text-red-700" />
              <SummaryCard label="Date Diff" value={summary.dateDiffLines} color="bg-blue-100 text-blue-700" />
              <SummaryCard label="Invalid" value={summary.invalidLines} color="bg-red-100 text-red-700" />
            </div>

            <div className="mt-4 grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
              <QtyCard label="Order Qty" partner={summary.totalOrderQty} website={summary.totalOrderQty} />
              <QtyCard label="OUT / Output" partner={summary.totalPartnerOut} website={summary.totalWebsiteOutput} />
              <QtyCard label="IN / Input" partner={summary.totalPartnerIn} website={summary.totalWebsiteInput} />
              <div className="rounded-md border p-2">
                <div className="text-[10px] text-muted-foreground">OUT Difference</div>
                <div className={cn("font-bold text-sm", summary.totalPartnerOut - summary.totalWebsiteOutput === 0 ? "text-emerald-700" : "text-rose-700")}>
                  {summary.totalPartnerOut - summary.totalWebsiteOutput > 0 ? "+" : ""}{summary.totalPartnerOut - summary.totalWebsiteOutput}
                </div>
              </div>
              <div className="rounded-md border p-2">
                <div className="text-[10px] text-muted-foreground">IN Difference</div>
                <div className={cn("font-bold text-sm", summary.totalPartnerIn - summary.totalWebsiteInput === 0 ? "text-emerald-700" : "text-rose-700")}>
                  {summary.totalPartnerIn - summary.totalWebsiteInput > 0 ? "+" : ""}{summary.totalPartnerIn - summary.totalWebsiteInput}
                </div>
              </div>
            </div>

            {runResult?.runId && (
              <div className="mt-3 flex gap-2">
                <a href={api.reconciliationExportUrl(runResult.runId, "all")} download>
                  <Button size="sm" variant="outline"><Download className="mr-1.5 h-3.5 w-3.5" /> Export Report (.xlsx)</Button>
                </a>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Section 3: Comparison Table */}
      {hasRun && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <span className={cn("flex h-6 w-6 items-center justify-center rounded-full text-xs text-white", theme.bg)}>3</span>
              Comparison ({detailsTotal} lines)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Filters */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <Select value={detailsStatus || "__all__"} onValueChange={(v) => setDetailsStatus(v === "__all__" ? "" : v)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="All status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All status</SelectItem>
                  {Object.keys(STATUS_META).map((s) => (
                    <SelectItem key={s} value={s}>{STATUS_META[s].label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input placeholder="PO NO#" value={detailsPo} onChange={(e) => setDetailsPo(e.target.value)} className="h-8 text-xs" />
              <Input placeholder="Factory PO" value={detailsFactoryPo} onChange={(e) => setDetailsFactoryPo(e.target.value)} className="h-8 text-xs" />
              <Input placeholder="Size" value={detailsSize} onChange={(e) => setDetailsSize(e.target.value)} className="h-8 text-xs" />
            </div>

            {/* Table */}
            <div className="overflow-x-auto scroll-thin rounded-md border max-h-[600px]">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted/80 backdrop-blur z-10">
                  <tr>
                    <th className="px-2 py-1.5 text-left">Status</th>
                    <th className="px-2 py-1.5 text-left">PO NO#</th>
                    <th className="px-2 py-1.5 text-left">Factory PO</th>
                    <th className="px-2 py-1.5 text-left">Size</th>
                    <th className="px-2 py-1.5 text-right">P.Order</th>
                    <th className="px-2 py-1.5 text-right">W.Order</th>
                    <th className="px-2 py-1.5 text-right">P.OUT</th>
                    <th className="px-2 py-1.5 text-right">W.Output</th>
                    <th className="px-2 py-1.5 text-right">P.IN</th>
                    <th className="px-2 py-1.5 text-right">W.Input</th>
                    <th className="px-2 py-1.5 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {detailsLoading ? (
                    <tr><td colSpan={11} className="py-8 text-center text-muted-foreground">
                      <Loader2 className="h-5 w-5 mx-auto animate-spin" />
                    </td></tr>
                  ) : details.length === 0 ? (
                    <tr><td colSpan={11} className="py-8 text-center text-muted-foreground">No rows found</td></tr>
                  ) : (
                    details.map((r) => (
                      <tr key={r.id} className="border-t hover:bg-accent/30">
                        <td className="px-2 py-1.5"><StatusBadge status={r.status} /></td>
                        <td className="px-2 py-1.5 font-mono">{r.poNo}</td>
                        <td className="px-2 py-1.5 font-mono">{r.factoryPO}</td>
                        <td className="px-2 py-1.5">{r.size}</td>
                        <td className="px-2 py-1.5 text-right">{r.partnerOrderQty}</td>
                        <td className="px-2 py-1.5 text-right">{r.websiteOrderQty}</td>
                        <td className="px-2 py-1.5 text-right">{r.partnerOutQty}</td>
                        <td className="px-2 py-1.5 text-right">{r.websiteOutputQty}</td>
                        <td className="px-2 py-1.5 text-right">{r.partnerInQty}</td>
                        <td className="px-2 py-1.5 text-right">{r.websiteInputQty}</td>
                        <td className="px-2 py-1.5 text-center">
                          <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setIssueRow(r)}>
                            <Eye className="h-3 w-3" />
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {detailsTotal > 50 && (
              <div className="flex items-center justify-between text-xs">
                <div className="text-muted-foreground">Page {detailsPage} of {Math.ceil(detailsTotal / 50)}</div>
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" disabled={detailsPage <= 1} onClick={() => loadDetails(runResult.runId, detailsPage - 1)}>Prev</Button>
                  <Button size="sm" variant="outline" disabled={detailsPage >= Math.ceil(detailsTotal / 50)} onClick={() => loadDetails(runResult.runId, detailsPage + 1)}>Next</Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Section 4: Issue Detail Dialog */}
      <Dialog open={!!issueRow} onOpenChange={(o) => !o && setIssueRow(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <StatusBadge status={issueRow?.status ?? ""} />
              Issue Detail
            </DialogTitle>
            <DialogDescription>
              PO: <span className="font-mono font-medium">{issueRow?.poNo}</span> · Factory PO: <span className="font-mono font-medium">{issueRow?.factoryPO}</span> · Size: <span className="font-mono font-medium">{issueRow?.size}</span>
            </DialogDescription>
          </DialogHeader>
          {issueRow && (
            <div className="space-y-4 text-xs">
              {/* Quantities */}
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-md border p-2">
                  <div className="text-[10px] text-muted-foreground">Order Qty</div>
                  <div className="font-mono text-sm">P: {issueRow.partnerOrderQty} · W: {issueRow.websiteOrderQty}</div>
                  <div className={cn("text-[10px]", issueRow.orderDifference === 0 ? "text-emerald-600" : "text-rose-600")}>Diff: {issueRow.orderDifference > 0 ? "+" : ""}{issueRow.orderDifference}</div>
                </div>
                <div className="rounded-md border p-2">
                  <div className="text-[10px] text-muted-foreground">OUT / Output</div>
                  <div className="font-mono text-sm">P: {issueRow.partnerOutQty} · W: {issueRow.websiteOutputQty}</div>
                  <div className={cn("text-[10px]", issueRow.outDifference === 0 ? "text-emerald-600" : "text-rose-600")}>Diff: {issueRow.outDifference > 0 ? "+" : ""}{issueRow.outDifference}</div>
                </div>
                <div className="rounded-md border p-2">
                  <div className="text-[10px] text-muted-foreground">IN / Input</div>
                  <div className="font-mono text-sm">P: {issueRow.partnerInQty} · W: {issueRow.websiteInputQty}</div>
                  <div className={cn("text-[10px]", issueRow.inDifference === 0 ? "text-emerald-600" : "text-rose-600")}>Diff: {issueRow.inDifference > 0 ? "+" : ""}{issueRow.inDifference}</div>
                </div>
              </div>

              {/* Reason */}
              {issueRow.reason && (
                <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/20 p-2">
                  <div className="font-medium text-amber-700 dark:text-amber-300 mb-0.5">Explanation</div>
                  <div className="text-[11px] text-muted-foreground">{issueRow.reason}</div>
                </div>
              )}

              {/* Issues list */}
              {(() => {
                try {
                  const issues = JSON.parse(issueRow.issues || "[]");
                  if (issues.length === 0) return null;
                  return (
                    <div>
                      <div className="font-medium mb-1">Issues ({issues.length})</div>
                      <div className="flex flex-wrap gap-1">
                        {issues.map((iss: string, i: number) => (
                          <StatusBadge key={i} status={iss} />
                        ))}
                      </div>
                    </div>
                  );
                } catch { return null; }
              })()}

              {/* Partner transactions */}
              <div>
                <div className="font-medium mb-1">Partner Transactions</div>
                <div className="rounded-md border max-h-40 overflow-y-auto scroll-thin">
                  {(() => {
                    try {
                      const tx = JSON.parse(issueRow.partnerTransactions || "[]");
                      if (tx.length === 0) return <div className="p-2 text-muted-foreground text-[11px]">No partner transactions</div>;
                      return (
                        <table className="w-full text-[11px]">
                          <thead className="bg-muted/50 sticky top-0">
                            <tr><th className="px-2 py-1 text-left">Date</th><th className="px-2 py-1 text-left">Type</th><th className="px-2 py-1 text-right">Qty</th></tr>
                          </thead>
                          <tbody>
                            {tx.map((t: any, i: number) => (
                              <tr key={i} className="border-t">
                                <td className="px-2 py-1 font-mono">{t.date}</td>
                                <td className="px-2 py-1">{t.type}</td>
                                <td className="px-2 py-1 text-right font-mono">{t.qty}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      );
                    } catch { return <div className="p-2 text-muted-foreground text-[11px]">Parse error</div>; }
                  })()}
                </div>
              </div>

              {/* Website transactions */}
              <div>
                <div className="font-medium mb-1">Website Transactions</div>
                <div className="rounded-md border max-h-40 overflow-y-auto scroll-thin">
                  {(() => {
                    try {
                      const tx = JSON.parse(issueRow.websiteTransactions || "[]");
                      if (tx.length === 0) return <div className="p-2 text-muted-foreground text-[11px]">No website transactions</div>;
                      return (
                        <table className="w-full text-[11px]">
                          <thead className="bg-muted/50 sticky top-0">
                            <tr><th className="px-2 py-1 text-left">Date</th><th className="px-2 py-1 text-left">Type</th><th className="px-2 py-1 text-right">Qty</th></tr>
                          </thead>
                          <tbody>
                            {tx.map((t: any, i: number) => (
                              <tr key={i} className="border-t">
                                <td className="px-2 py-1 font-mono">{t.date}</td>
                                <td className="px-2 py-1">{t.type}</td>
                                <td className="px-2 py-1 text-right font-mono">{t.qty}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      );
                    } catch { return <div className="p-2 text-muted-foreground text-[11px]">Parse error</div>; }
                  })()}
                </div>
              </div>

              {/* Balances */}
              <div className="grid grid-cols-3 gap-2 text-[11px]">
                <div className="rounded-md border p-2">
                  <div className="text-muted-foreground">Pending Partner</div>
                  <div className="font-mono font-bold">{issueRow.pendingPartner}</div>
                  <div className="text-[9px] text-muted-foreground">OUT - IN (partner)</div>
                </div>
                <div className="rounded-md border p-2">
                  <div className="text-muted-foreground">Pending Website</div>
                  <div className="font-mono font-bold">{issueRow.pendingWebsite}</div>
                  <div className="text-[9px] text-muted-foreground">Output - Input (website)</div>
                </div>
                <div className="rounded-md border p-2">
                  <div className="text-muted-foreground">Remaining Order</div>
                  <div className="font-mono font-bold">{issueRow.remainingOrder}</div>
                  <div className="text-[9px] text-muted-foreground">Order - Output</div>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* History Dialog */}
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><History className="h-4 w-4" /> Reconciliation History</DialogTitle>
            <DialogDescription>Past reconciliation runs (most recent 20)</DialogDescription>
          </DialogHeader>
          {historyLoading ? (
            <div className="py-8 text-center"><Loader2 className="h-6 w-6 mx-auto animate-spin" /></div>
          ) : historyRuns.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">No runs yet</div>
          ) : (
            <div className="space-y-2">
              {historyRuns.map((run) => (
                <div key={run.id} className="rounded-md border p-3 text-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <div className="font-medium">{run.runNumber}</div>
                    <Badge variant="secondary" className="text-[9px]">{run.status}</Badge>
                  </div>
                  <div className="text-muted-foreground">{run.fileName} · {run.productType}</div>
                  <div className="text-muted-foreground">
                    {new Date(run.createdAt).toLocaleString("vi-VN")} · {run.totalLines} lines · {run.matchedLines} matched · {run.mismatchLines} mismatch
                  </div>
                  <div className="flex gap-1 mt-1">
                    <a href={api.reconciliationExportUrl(run.id, "all")} download>
                      <Button size="sm" variant="outline" className="h-6 text-[10px]"><Download className="mr-1 h-3 w-3" /> Export</Button>
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-md border p-2 text-center">
      <div className={cn("inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold", color)}>{label}</div>
      <div className="font-bold text-lg mt-1">{value.toLocaleString()}</div>
    </div>
  );
}

function QtyCard({ label, partner, website }: { label: string; partner: number; website: number }) {
  return (
    <div className="rounded-md border p-2">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="font-mono text-[11px]">P: {partner} · W: {website}</div>
    </div>
  );
}
