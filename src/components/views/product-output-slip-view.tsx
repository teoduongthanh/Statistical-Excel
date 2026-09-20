"use client";

// =====================================================================
// ProductOutputSlipView
// ---------------------------------------------------------------------
// BULK OUTPUT SLIP GENERATOR for the currently-selected product.
//
// Workflow:
//   1. User enters a PO NO# and hits Search.
//   2. /api/output-slips/factory-pos returns all Factory PO groups for
//      that PO NO# with per-size Remaining Output (Order - Output).
//   3. User selects Factory POs (multi-row checkboxes) and optionally
//      expands a row to fine-tune the "Qty to Output" per size.
//      "Select All Ready" selects only rows with remainingOutput > 0.
//   4. Selection summary shows aggregate counts / quantities.
//   5. User clicks "Generate Output Slip" → modal lets them pick a
//      slip mode (combined / separate / group_by_color) → confirm.
//   6. /api/output-slips/generate creates a slip record (NO EntryData
//      write — this is just a prep doc).
//   7. Preview card shows the generated slip. Actions:
//        - Export Excel → /api/output-slips/export (multi_sheet)
//        - Print → window.print()
//        - Confirm Actual Output → /api/output-slips/confirm
//          (re-validates Remaining Output, then writes the real 2.Output
//          entries to EntryData in an atomic transaction). On conflict
//          the API returns 400 with an error message — surface as toast.
//        - Cancel Slip → AlertDialog → /api/output-slips/{id} DELETE.
//   8. Existing slips list (useQuery with refreshKey in key) below.
//
// Business rules:
//   * REMAINING OUTPUT = ORDER - OUTPUT, per (productType, poNo,
//     factoryPO, size) — NOT per PO NO# alone.
//   * Generating a slip is a preparation doc (no EntryData write).
//   * Only "Confirm Actual Output" creates real 2.Output entries.
//   * qtyToOutput must be <= remainingOutput (validated client-side
//     and server-side).
//   * "Select All Ready" only selects rows with remainingOutput > 0.
// =====================================================================

import * as React from "react";
import { useQuery } from "@tanstack/react-query";

import {
  FileOutput,
  Search,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Loader2,
  Download,
  Printer,
  Check,
  X,
  ChevronDown,
  ChevronRight,
  RotateCcw,
  Truck,
  Filter,
  Clock,
  Boxes,
  Layers,
  Factory,
  Calendar,
  RefreshCw,
} from "lucide-react";

import { api } from "@/lib/api-client";
import { cn, formatDateDisplay } from "@/lib/utils";
import { useAppStore, PRODUCT_THEME } from "@/store/app-store";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
  RadioGroup,
  RadioGroupItem,
} from "@/components/ui/radio-group";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { toast } from "sonner";

// =====================================================================
// Types — mirror shapes returned by /api/output-slips/*
// =====================================================================

interface SizeRow {
  size: string;
  orderQty: number;
  outputQty: number;
  remainingOutput: number;
}

interface FactoryPOGroup {
  factoryPO: string;
  poNo: string;
  model: string;
  sku: string;
  season: string;
  colorCode: string;
  colorCode2: string;
  painting: string;
  printingColor: string;
  deadline: string | null;
  sizes: SizeRow[];
  totalOrder: number;
  totalOutput: number;
  totalRemaining: number;
  status: "READY_TO_OUTPUT" | "COMPLETED";
}

interface SlipItem {
  factoryPO: string;
  poNo: string;
  model: string;
  sku: string;
  season: string;
  colorCode: string;
  colorCode2: string;
  painting: string;
  printingColor: string;
  size: string;
  qtyToOutput: number;
  orderQty: number;
  outputQty: number;
  remainingOutput: number;
  deadline: string | null;
}

type SlipMode = "combined" | "separate" | "group_by_color";

interface SlipRecord {
  id: string;
  slipNumber: string;
  productType: string;
  poNo: string;
  slipMode: string;
  status: string;
  items: string; // JSON string of SlipItem[]
  totalOrder: number;
  totalOutput: number;
  totalRemaining: number;
  totalToOutput: number;
  factoryPOCount: number;
  sizeCount: number;
  createdBy: string | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
  note: string | null;
  createdAt: string;
}

// =====================================================================
// Helpers
// =====================================================================

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString();
}

function formatDeadline(s: string | null | undefined): string {
  return formatDateDisplay(s);
}

function fmtDateTime(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s);
  if (isNaN(d.getTime())) return String(s);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Convert a date string (DD/MM/YYYY or ISO) to a sortable YYYY-MM-DD key.
function deadlineSortKey(s: string | null | undefined): string {
  if (!s) return "9999-99-99"; // empty deadlines go LAST
  const str = String(s).trim();
  const dmy = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) {
    const y = dmy[3];
    const m = String(dmy[2]).padStart(2, "0");
    const d = String(dmy[1]).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const iso = new Date(str);
  if (!isNaN(iso.getTime())) {
    return iso.toISOString().slice(0, 10);
  }
  return str;
}

function parseSlipItems(slip: SlipRecord): SlipItem[] {
  try {
    return JSON.parse(slip.items || "[]") as SlipItem[];
  } catch {
    return [];
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case "draft":
      return "Draft";
    case "generated":
      return "Generated";
    case "printed":
      return "Printed";
    case "confirmed_output":
      return "Output Confirmed";
    case "cancelled":
      return "Cancelled";
    default:
      return status;
  }
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case "generated":
    case "printed":
      return "border-amber-300 bg-amber-100 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/50 dark:text-amber-300";
    case "confirmed_output":
      return "border-emerald-300 bg-emerald-100 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/50 dark:text-emerald-300";
    case "cancelled":
      return "border-rose-300 bg-rose-100 text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/50 dark:text-rose-300";
    default:
      return "border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-800/60 dark:bg-slate-800/40 dark:text-slate-300";
  }
}

function modeLabel(mode: string): string {
  switch (mode) {
    case "combined":
      return "Combined";
    case "separate":
      return "Separate per FPO";
    case "group_by_color":
      return "Group by Color";
    default:
      return mode;
  }
}

// =====================================================================
// Small UI atoms
// =====================================================================

function StatCard({
  label,
  value,
  icon: Icon,
  tone,
  loading,
  sub,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: "primary" | "warning" | "danger" | "ok" | "muted";
  loading?: boolean;
  sub?: React.ReactNode;
}) {
  const TONES: Record<
    "primary" | "warning" | "danger" | "ok" | "muted",
    { text: string; bg: string; ring: string }
  > = {
    primary: {
      text: "text-emerald-600 dark:text-emerald-400",
      bg: "bg-emerald-50 dark:bg-emerald-950/40",
      ring: "ring-emerald-500/20",
    },
    warning: {
      text: "text-amber-600 dark:text-amber-400",
      bg: "bg-amber-50 dark:bg-amber-950/40",
      ring: "ring-amber-500/20",
    },
    danger: {
      text: "text-rose-600 dark:text-rose-400",
      bg: "bg-rose-50 dark:bg-rose-950/40",
      ring: "ring-rose-500/20",
    },
    ok: {
      text: "text-teal-600 dark:text-teal-400",
      bg: "bg-teal-50 dark:bg-teal-950/40",
      ring: "ring-teal-500/20",
    },
    muted: {
      text: "text-slate-600 dark:text-slate-300",
      bg: "bg-slate-50 dark:bg-slate-800/40",
      ring: "ring-slate-500/20",
    },
  };
  const t = TONES[tone];
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
            {loading ? (
              <Skeleton className="mt-2 h-7 w-24" />
            ) : (
              <p className={cn("mt-1 text-2xl font-bold tracking-tight tabular-nums", t.text)}>
                {value}
              </p>
            )}
            {sub ? <div className="mt-1 text-[11px] text-muted-foreground">{sub}</div> : null}
          </div>
          <div
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1",
              t.bg,
              t.ring
            )}
          >
            <Icon className={cn("h-4 w-4", t.text)} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function TableSkeleton({ rows = 4, cols = 9 }: { rows?: number; cols?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <TableRow key={`sk-${i}`}>
          {Array.from({ length: cols }).map((__, j) => (
            <TableCell key={`sk-${i}-${j}`} className="px-3 py-2">
              <div className="h-3 w-full animate-pulse rounded bg-muted" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

function EmptyRow({
  colSpan,
  message,
  hint,
  icon: Icon = Boxes,
}: {
  colSpan: number;
  message: string;
  hint?: string;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={colSpan} className="px-3 py-10 text-center">
        <div className="flex flex-col items-center justify-center gap-2">
          <Icon className="h-8 w-8 text-muted-foreground/40" />
          <div className="text-sm font-medium">{message}</div>
          {hint ? (
            <div className="max-w-md text-xs text-muted-foreground">{hint}</div>
          ) : null}
        </div>
      </TableCell>
    </TableRow>
  );
}

// =====================================================================
// Main component
// =====================================================================

export function ProductOutputSlipView() {
  const { currentProduct, bumpRefresh, refreshKey } = useAppStore();
  const theme = PRODUCT_THEME[currentProduct];

  // --- Section 1: PO NO# search state ---
  const [poNoSearch, setPoNoSearch] = React.useState("");
  const [poNo, setPoNo] = React.useState("");

  // --- Section 2: Factory PO list state ---
  const [groups, setGroups] = React.useState<FactoryPOGroup[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [searchError, setSearchError] = React.useState<string | null>(null);

  // --- Section 3: Selection + expand + qty state ---
  const [selectedFpos, setSelectedFpos] = React.useState<Set<string>>(new Set());
  const [expandedFpo, setExpandedFpo] = React.useState<string | null>(null);
  // key: `${factoryPO}|${size}` → qtyToOutput
  const [qtyToOutput, setQtyToOutput] = React.useState<Map<string, number>>(new Map());

  // --- Section 5: Generate slip state ---
  const [autoPriority, setAutoPriority] = React.useState(false);
  const [showModeDialog, setShowModeDialog] = React.useState(false);
  const [slipMode, setSlipMode] = React.useState<SlipMode>("combined");
  const [generating, setGenerating] = React.useState(false);

  // --- Section 6: Generated slip preview state ---
  const [generatedSlip, setGeneratedSlip] = React.useState<SlipRecord | null>(null);
  const [exportingId, setExportingId] = React.useState<string | null>(null);
  const [confirmingId, setConfirmingId] = React.useState<string | null>(null);
  const [showCancelDialog, setShowCancelDialog] = React.useState(false);
  const [cancelTarget, setCancelTarget] = React.useState<SlipRecord | null>(null);

  // Reset transient state when the active product changes.
  React.useEffect(() => {
    setPoNoSearch("");
    setPoNo("");
    setGroups([]);
    setLoading(false);
    setSearchError(null);
    setSelectedFpos(new Set());
    setExpandedFpo(null);
    setQtyToOutput(new Map());
    setGeneratedSlip(null);
    setShowModeDialog(false);
    setAutoPriority(false);
  }, [currentProduct]);

  // =====================================================================
  // Section 1 — search Factory POs by PO NO#
  // =====================================================================
  async function searchFactoryPOs() {
    const q = poNoSearch.trim();
    if (!q) {
      toast.error("Enter a PO NO# to search.");
      return;
    }
    setPoNo(q);
    setLoading(true);
    setSearchError(null);
    setGroups([]);
    setSelectedFpos(new Set());
    setExpandedFpo(null);
    setQtyToOutput(new Map());
    setGeneratedSlip(null);
    try {
      const res = await api.getOutputSlipFactoryPOs(currentProduct, q);
      setGroups(res.groups ?? []);
      if (!res.groups || res.groups.length === 0) {
        toast.info(`No Factory POs found for PO NO# "${q}" in ${currentProduct}.`);
      } else {
        toast.success(`Loaded ${res.groups.length} Factory PO${res.groups.length === 1 ? "" : "s"} for ${q}.`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Search failed";
      setSearchError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  // =====================================================================
  // Sections 2-3 — Derived data + selection helpers
  // =====================================================================

  // Apply auto-priority sort: READY_TO_OUTPUT first, by deadline nearest first.
  // COMPLETED rows go to the bottom. Stable on factoryPO.
  const displayedGroups = React.useMemo(() => {
    if (!autoPriority) return groups;
    return [...groups].sort((a, b) => {
      if (a.status !== b.status) {
        return a.status === "READY_TO_OUTPUT" ? -1 : 1;
      }
      return deadlineSortKey(a.deadline).localeCompare(deadlineSortKey(b.deadline));
    });
  }, [groups, autoPriority]);

  const readyGroups = React.useMemo(
    () => groups.filter((g) => g.totalRemaining > 0),
    [groups]
  );

  function toggleFpo(factoryPO: string) {
    setSelectedFpos((prev) => {
      const next = new Set(prev);
      if (next.has(factoryPO)) next.delete(factoryPO);
      else next.add(factoryPO);
      return next;
    });
  }

  function selectAllReady() {
    setSelectedFpos(new Set(readyGroups.map((g) => g.factoryPO)));
  }

  function clearSelection() {
    setSelectedFpos(new Set());
  }

  // When a group becomes selected, default its qtyToOutput for every size
  // to the full remainingOutput. Prune qty entries for Factory POs no
  // longer present.
  React.useEffect(() => {
    setQtyToOutput((prev) => {
      const next = new Map(prev);
      const presentKeys = new Set<string>();
      for (const g of groups) {
        for (const s of g.sizes) {
          const k = `${g.factoryPO}|${s.size}`;
          presentKeys.add(k);
          if (!next.has(k)) {
            next.set(k, Math.max(0, s.remainingOutput));
          }
        }
      }
      for (const k of Array.from(next.keys())) {
        if (!presentKeys.has(k)) next.delete(k);
      }
      return next;
    });
  }, [groups]);

  // Selected Factory PO groups (in displayed order).
  const selectedGroups = React.useMemo(
    () => displayedGroups.filter((g) => selectedFpos.has(g.factoryPO)),
    [displayedGroups, selectedFpos]
  );

  // Per-(factoryPO, size) validation: qtyToOutput must be 0..remainingOutput.
  const validationErrors = React.useMemo(() => {
    const errs: { key: string; message: string }[] = [];
    for (const g of selectedGroups) {
      for (const s of g.sizes) {
        const k = `${g.factoryPO}|${s.size}`;
        const q = qtyToOutput.get(k) ?? s.remainingOutput;
        if (q < 0) {
          errs.push({
            key: k,
            message: `${g.factoryPO} / ${s.size}: qty to output cannot be negative.`,
          });
        } else if (q > s.remainingOutput) {
          errs.push({
            key: k,
            message: `${g.factoryPO} / ${s.size}: qty to output (${fmt(q)}) exceeds Remaining (${fmt(s.remainingOutput)}).`,
          });
        }
      }
    }
    return errs;
  }, [selectedGroups, qtyToOutput]);

  // Aggregate counts for the summary.
  const summary = React.useMemo(() => {
    let selectedSizes = 0;
    let totalRemaining = 0;
    let totalToOutput = 0;
    let totalOrder = 0;
    let totalOutput = 0;
    for (const g of selectedGroups) {
      for (const s of g.sizes) {
        selectedSizes++;
        totalRemaining += s.remainingOutput;
        totalOrder += s.orderQty;
        totalOutput += s.outputQty;
        const k = `${g.factoryPO}|${s.size}`;
        totalToOutput += qtyToOutput.get(k) ?? s.remainingOutput;
      }
    }
    return {
      selectedFpoCount: selectedGroups.length,
      selectedSizes,
      totalRemaining,
      totalToOutput,
      totalOrder,
      totalOutput,
    };
  }, [selectedGroups, qtyToOutput]);

  function setQty(factoryPO: string, size: string, raw: number) {
    const safe = Number.isFinite(raw) ? raw : 0;
    setQtyToOutput((prev) => {
      const next = new Map(prev);
      next.set(`${factoryPO}|${size}`, safe);
      return next;
    });
  }

  function autoFillRemaining() {
    setQtyToOutput((prev) => {
      const next = new Map(prev);
      for (const g of selectedGroups) {
        for (const s of g.sizes) {
          next.set(`${g.factoryPO}|${s.size}`, Math.max(0, s.remainingOutput));
        }
      }
      return next;
    });
    toast.success("Qty to Output auto-filled with the full Remaining Output for all selected Factory POs.");
  }

  // =====================================================================
  // Section 5 — Generate slip
  // =====================================================================

  function openGenerateDialog() {
    if (selectedGroups.length === 0) {
      toast.error("Select at least one Factory PO before generating a slip.");
      return;
    }
    if (validationErrors.length > 0) {
      toast.error(
        `Fix ${validationErrors.length} validation issue${validationErrors.length === 1 ? "" : "s"} before generating the slip.`
      );
      return;
    }
    setShowModeDialog(true);
  }

  async function confirmGenerate() {
    if (selectedGroups.length === 0) return;
    // Build the items array — each (factoryPO, size) row → 1 SlipItem.
    const items: SlipItem[] = [];
    for (const g of selectedGroups) {
      for (const s of g.sizes) {
        const k = `${g.factoryPO}|${s.size}`;
        const q = qtyToOutput.get(k) ?? s.remainingOutput;
        if (q <= 0) continue; // skip zero-output rows
        items.push({
          factoryPO: g.factoryPO,
          poNo: g.poNo,
          model: g.model,
          sku: g.sku,
          season: g.season,
          colorCode: g.colorCode,
          colorCode2: g.colorCode2,
          painting: g.painting,
          printingColor: g.printingColor,
          size: s.size,
          qtyToOutput: q,
          orderQty: s.orderQty,
          outputQty: s.outputQty,
          remainingOutput: s.remainingOutput,
          deadline: g.deadline,
        });
      }
    }

    if (items.length === 0) {
      toast.error("No items to output. Adjust the Qty to Output for at least one size.");
      return;
    }

    setGenerating(true);
    try {
      const res = await api.generateOutputSlip({
        productType: currentProduct,
        poNo,
        slipMode,
        items,
        createdBy: "output-slip-ui",
      });
      if (!res.ok || !res.slip) {
        throw new Error(res.error || "Generate failed");
      }
      setGeneratedSlip(res.slip as SlipRecord);
      setShowModeDialog(false);
      toast.success(
        `Output Slip ${res.slip.slipNumber} generated (${items.length} item${items.length === 1 ? "" : "s"}, ${selectedGroups.length} Factory PO${selectedGroups.length === 1 ? "" : "s"}).`
      );
      // Refresh the slips list query.
      bumpRefresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Generate failed";
      toast.error(msg);
    } finally {
      setGenerating(false);
    }
  }

  // =====================================================================
  // Section 6 — Slip preview actions
  // =====================================================================

  async function handleExport(slipId: string, slipNumber: string) {
    setExportingId(slipId);
    try {
      const blob = await api.exportOutputSlip({ slipId, format: "multi_sheet" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Output_Slip_${slipNumber}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(`Slip ${slipNumber} exported to Excel.`);
      bumpRefresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Export failed";
      toast.error(msg);
    } finally {
      setExportingId(null);
    }
  }

  function handlePrint(slip: SlipRecord) {
    const items = parseSlipItems(slip);
    const win = window.open("", "_blank", "width=1100,height=800");
    if (!win) {
      toast.error("Pop-up blocked. Allow pop-ups to print the slip.");
      return;
    }
    const rows = items
      .map(
        (i) => `<tr>
          <td>${i.factoryPO}</td>
          <td>${i.size}</td>
          <td style="text-align:right">${i.qtyToOutput.toLocaleString()}</td>
          <td style="text-align:right">${i.orderQty.toLocaleString()}</td>
          <td style="text-align:right">${i.outputQty.toLocaleString()}</td>
          <td style="text-align:right">${i.remainingOutput.toLocaleString()}</td>
          <td>${i.deadline || "—"}</td>
        </tr>`
      )
      .join("");
    const html = `<!doctype html><html><head><title>Output Slip ${slip.slipNumber}</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; padding: 24px; color: #0f172a; }
        h1 { font-size: 18px; margin: 0 0 8px 0; }
        h2 { font-size: 13px; margin: 16px 0 8px 0; color: #475569; font-weight: 500; }
        table { width: 100%; border-collapse: collapse; font-size: 12px; }
        th, td { border: 1px solid #e2e8f0; padding: 6px 8px; text-align: left; }
        th { background: #f1f5f9; font-weight: 600; }
        .meta { display: flex; gap: 24px; margin-bottom: 16px; font-size: 12px; }
        .meta div b { display: inline-block; min-width: 90px; color: #475569; }
      </style></head>
      <body>
        <h1>OUTPUT SLIP — ${slip.slipNumber}</h1>
        <div class="meta">
          <div><b>PO NO#</b> ${slip.poNo}</div>
          <div><b>Product</b> ${slip.productType}</div>
          <div><b>Mode</b> ${modeLabel(slip.slipMode)}</div>
          <div><b>Status</b> ${statusLabel(slip.status)}</div>
        </div>
        <h2>Items</h2>
        <table>
          <thead><tr>
            <th>Factory PO</th><th>Size</th><th>Qty to Output</th>
            <th>Order</th><th>Output</th><th>Remaining</th><th>Deadline</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <p style="margin-top: 16px; font-size: 11px; color: #64748b;">
          Total to Output: <b>${slip.totalToOutput.toLocaleString()}</b> ·
          Factory POs: <b>${slip.factoryPOCount}</b> ·
          Created: <b>${fmtDateTime(slip.createdAt)}</b>
        </p>
      </body></html>`;
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 350);
  }

  async function handleConfirm(slip: SlipRecord) {
    setConfirmingId(slip.id);
    try {
      const res = await api.confirmOutputSlip({ slipId: slip.id, confirmedBy: "output-slip-ui" });
      toast.success(
        `Output confirmed — ${res.createdCount ?? 0} entr${(res.createdCount ?? 0) === 1 ? "y" : "ies"} created in EntryData.`
      );
      setGeneratedSlip(null);
      bumpRefresh();
    } catch (e) {
      // The confirm endpoint returns 400 with { ok: false, errors: [...] }
      // for a Remaining Output conflict. jsonOrThrow surfaces the message.
      const msg = e instanceof Error ? e.message : "Confirm failed";
      toast.error(msg);
    } finally {
      setConfirmingId(null);
    }
  }

  function openCancelDialog(slip: SlipRecord) {
    setCancelTarget(slip);
    setShowCancelDialog(true);
  }

  async function confirmCancel() {
    if (!cancelTarget) return;
    try {
      const res = await api.cancelOutputSlip(cancelTarget.id);
      toast.success(`Slip ${cancelTarget.slipNumber} cancelled.`);
      if (generatedSlip?.id === cancelTarget.id) {
        setGeneratedSlip(null);
      }
      bumpRefresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Cancel failed";
      toast.error(msg);
    } finally {
      setShowCancelDialog(false);
      setCancelTarget(null);
    }
  }

  // =====================================================================
  // Section 7 — Existing slips list query
  // =====================================================================

  const slipsQuery = useQuery({
    queryKey: ["output-slips", currentProduct, refreshKey],
    queryFn: () => api.listOutputSlips({ productType: currentProduct, limit: 20 }),
    enabled: Boolean(currentProduct),
  });

  const slips: SlipRecord[] = slipsQuery.data?.slips ?? [];

  // =====================================================================
  // Render
  // =====================================================================

  const productLabel = theme.label;

  return (
    <div className="space-y-5">
      {/* ---------------- Header ---------------- */}
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold tracking-tight">Bulk Output Slip Generator</h1>
          <Badge className={cn("gap-1 text-[10px]", theme.badge)}>
            <FileOutput className="h-3 w-3" />
            {productLabel}
          </Badge>
          {slipsQuery.isFetching && !slipsQuery.isLoading ? (
            <Badge variant="secondary" className="text-[10px]">
              <Loader2 className="h-3 w-3 animate-spin" />
              refreshing slips
            </Badge>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            className="ml-auto h-8 gap-1 text-xs"
            onClick={bumpRefresh}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Prepare bulk Output Slips for <strong>{productLabel}</strong>. Search by PO NO#,
          select Factory POs, fine-tune the qty to output per size, then generate a slip. Only
          <strong> Confirm Actual Output</strong> writes real 2.Output entries to EntryData.
        </p>
      </div>

      {/* ============================================================= */}
      {/* Section 1 — PO NO# Search                                      */}
      {/* ============================================================= */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Search className="h-4 w-4 text-primary" /> PO NO# Search
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="po-no-search" className="text-xs font-medium text-muted-foreground">
                PO NO#
              </Label>
              <Input
                id="po-no-search"
                value={poNoSearch}
                onChange={(e) => setPoNoSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") searchFactoryPOs();
                }}
                placeholder="e.g. H411351971"
                className="h-9 w-72 font-mono text-sm"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <Button
              size="sm"
              className={cn("h-9 gap-1.5 text-xs", theme.bg, "text-white hover:opacity-90")}
              onClick={searchFactoryPOs}
              disabled={loading}
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
              {loading ? "Searching…" : "Search"}
            </Button>
            {poNo ? (
              <Badge variant="outline" className="gap-1 text-[10px]">
                <Filter className="h-3 w-3" />
                PO NO# <span className="font-mono">{poNo}</span>
              </Badge>
            ) : null}
          </div>
          {searchError ? (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Search failed</AlertTitle>
              <AlertDescription>{searchError}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      {/* ============================================================= */}
      {/* Section 2 — Factory PO List                                    */}
      {/* ============================================================= */}
      {poNo ? (
        <Card>
          <CardContent className="p-0">
            {/* Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Factory className="h-4 w-4 text-primary" />
                <span className="font-medium">Factory PO List</span>
                <Badge variant="outline" className="text-[10px]">
                  {groups.length} total
                </Badge>
                {readyGroups.length !== groups.length ? (
                  <Badge
                    variant="outline"
                    className="border-emerald-300 bg-emerald-50 text-[10px] text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300"
                  >
                    {readyGroups.length} ready
                  </Badge>
                ) : null}
                {selectedFpos.size > 0 ? (
                  <Badge className={cn("text-[10px]", theme.badge)}>
                    {selectedFpos.size} selected
                  </Badge>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {/* Auto Priority switch */}
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" />
                  <span>Auto Priority (deadline)</span>
                  <Switch checked={autoPriority} onCheckedChange={setAutoPriority} aria-label="Auto Priority" />
                </label>
                {/* Select All Ready + Clear */}
                <label className="flex items-center gap-2 text-xs">
                  <Checkbox
                    checked={readyGroups.length > 0 && readyGroups.every((g) => selectedFpos.has(g.factoryPO))}
                    onCheckedChange={(v) => {
                      if (v) selectAllReady();
                      else clearSelection();
                    }}
                    disabled={readyGroups.length === 0}
                  />
                  <span className="text-muted-foreground">Select All Ready</span>
                </label>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1 text-xs"
                  onClick={clearSelection}
                  disabled={selectedFpos.size === 0}
                >
                  <X className="h-3 w-3" />
                  Clear Selection
                </Button>
              </div>
            </div>

            {/* Table */}
            <div className="max-h-[500px] overflow-y-auto scroll-thin">
              <Table className="text-xs">
                <TableHeader className="sticky top-0 z-10 bg-muted/80 backdrop-blur">
                  <TableRow>
                    <TableHead className="w-10 px-2 py-2" />
                    <TableHead className="px-2 py-2 w-8" />
                    <TableHead className="whitespace-nowrap px-3 py-2 text-[10px] font-semibold uppercase text-muted-foreground">
                      Factory PO
                    </TableHead>
                    <TableHead className="whitespace-nowrap px-3 py-2 text-[10px] font-semibold uppercase text-muted-foreground">
                      Model
                    </TableHead>
                    <TableHead className="whitespace-nowrap px-3 py-2 text-[10px] font-semibold uppercase text-muted-foreground">
                      Color
                    </TableHead>
                    <TableHead className="whitespace-nowrap px-3 py-2 text-[10px] font-semibold uppercase text-muted-foreground">
                      Deadline
                    </TableHead>
                    <TableHead className="whitespace-nowrap px-3 py-2 text-right text-[10px] font-semibold uppercase text-muted-foreground">
                      Order
                    </TableHead>
                    <TableHead className="whitespace-nowrap px-3 py-2 text-right text-[10px] font-semibold uppercase text-muted-foreground">
                      Output
                    </TableHead>
                    <TableHead className="whitespace-nowrap px-3 py-2 text-right text-[10px] font-semibold uppercase text-muted-foreground">
                      Remaining
                    </TableHead>
                    <TableHead className="whitespace-nowrap px-3 py-2 text-[10px] font-semibold uppercase text-muted-foreground">
                      Status
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableSkeleton rows={4} cols={10} />
                  ) : displayedGroups.length === 0 ? (
                    <EmptyRow
                      colSpan={10}
                      message="No Factory POs for this PO NO#"
                      hint={`No MasterData rows match product "${productLabel}" + PO NO# "${poNo}". Try a different PO NO#.`}
                      icon={Factory}
                    />
                  ) : (
                    displayedGroups.flatMap((g) => {
                      const isExpanded = expandedFpo === g.factoryPO;
                      const isSelected = selectedFpos.has(g.factoryPO);
                      const rowTint =
                        g.status === "COMPLETED"
                          ? "hover:bg-muted/30"
                          : isSelected
                            ? "bg-emerald-50/50 hover:bg-emerald-50/70 dark:bg-emerald-950/20 dark:hover:bg-emerald-950/30"
                            : "hover:bg-muted/30";
                      const rows = [
                        <TableRow
                          key={g.factoryPO}
                          className={cn("border-t transition-colors cursor-pointer", rowTint)}
                          onClick={() => setExpandedFpo(isExpanded ? null : g.factoryPO)}
                        >
                          <TableCell
                            className="px-2 py-1.5"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => toggleFpo(g.factoryPO)}
                              disabled={g.status === "COMPLETED"}
                              aria-label={`Select Factory PO ${g.factoryPO}`}
                            />
                          </TableCell>
                          <TableCell className="px-2 py-1.5">
                            {isExpanded ? (
                              <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="h-4 w-4 text-muted-foreground" />
                            )}
                          </TableCell>
                          <TableCell className="whitespace-nowrap px-3 py-1.5 font-mono text-[11px]">
                            {g.factoryPO}
                          </TableCell>
                          <TableCell className="max-w-[140px] truncate px-3 py-1.5" title={g.model}>
                            {g.model || <span className="text-muted-foreground/40">—</span>}
                          </TableCell>
                          <TableCell className="px-3 py-1.5">
                            {g.colorCode ? (
                              <Badge variant="outline" className="font-mono text-[10px]">
                                {g.colorCode}
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground/40">—</span>
                            )}
                          </TableCell>
                          <TableCell className="whitespace-nowrap px-3 py-1.5 text-[11px] text-muted-foreground">
                            {g.deadline ? (
                              <span className="inline-flex items-center gap-1">
                                <Calendar className="h-3 w-3" />
                                {formatDeadline(g.deadline)}
                              </span>
                            ) : (
                              <span className="text-muted-foreground/40">—</span>
                            )}
                          </TableCell>
                          <TableCell className="px-3 py-1.5 text-right tabular-nums">{fmt(g.totalOrder)}</TableCell>
                          <TableCell className="px-3 py-1.5 text-right tabular-nums">{fmt(g.totalOutput)}</TableCell>
                          <TableCell className="px-3 py-1.5 text-right tabular-nums">
                            {g.totalRemaining > 0 ? (
                              <Badge
                                variant="outline"
                                className="border-rose-300 bg-rose-50 text-[10px] text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300"
                              >
                                {fmt(g.totalRemaining)}
                              </Badge>
                            ) : (
                              <Badge
                                variant="outline"
                                className="border-slate-300 bg-slate-50 text-[10px] text-slate-600 dark:border-slate-800/60 dark:bg-slate-800/40 dark:text-slate-300"
                              >
                                {fmt(g.totalRemaining)}
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="px-3 py-1.5">
                            {g.status === "READY_TO_OUTPUT" ? (
                              <Badge
                                variant="outline"
                                className="border-amber-300 bg-amber-100 text-[10px] text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/50 dark:text-amber-300"
                              >
                                READY TO OUTPUT
                              </Badge>
                            ) : (
                              <Badge
                                variant="outline"
                                className="border-slate-300 bg-slate-100 text-[10px] text-slate-600 dark:border-slate-800/60 dark:bg-slate-800/40 dark:text-slate-300"
                              >
                                COMPLETED
                              </Badge>
                            )}
                          </TableCell>
                        </TableRow>,
                      ];

                      // Expanded detail: per-size breakdown with editable Qty to Output.
                      if (isExpanded) {
                        rows.push(
                          <TableRow
                            key={`${g.factoryPO}-detail`}
                            className="border-t bg-muted/20 hover:bg-transparent"
                          >
                            <TableCell colSpan={10} className="px-4 py-3">
                              <div className="rounded-md border bg-card p-3">
                                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                                  <div className="flex flex-wrap items-center gap-2 text-xs">
                                    <Layers className="h-3.5 w-3.5 text-primary" />
                                    <span className="font-medium">{g.factoryPO}</span>
                                    <Badge variant="outline" className="font-mono text-[10px]">
                                      {g.sizes.length} size{g.sizes.length === 1 ? "" : "s"}
                                    </Badge>
                                    {g.sku ? (
                                      <span className="text-[11px] text-muted-foreground">SKU: {g.sku}</span>
                                    ) : null}
                                    {g.season ? (
                                      <span className="text-[11px] text-muted-foreground">Season: {g.season}</span>
                                    ) : null}
                                  </div>
                                  {isSelected ? (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 gap-1 text-xs"
                                      onClick={autoFillRemaining}
                                    >
                                      <RotateCcw className="h-3 w-3" />
                                      Reset to Remaining
                                    </Button>
                                  ) : (
                                    <Badge variant="outline" className="text-[10px]">
                                      Tick the row to enable Qty to Output
                                    </Badge>
                                  )}
                                </div>
                                <div className="overflow-x-auto scroll-thin rounded-md border">
                                  <Table className="text-xs">
                                    <TableHeader className="bg-muted/40">
                                      <TableRow>
                                        <TableHead className="px-3 py-2 text-[10px] font-semibold uppercase text-muted-foreground">
                                          Size
                                        </TableHead>
                                        <TableHead className="px-3 py-2 text-right text-[10px] font-semibold uppercase text-muted-foreground">
                                          Order
                                        </TableHead>
                                        <TableHead className="px-3 py-2 text-right text-[10px] font-semibold uppercase text-muted-foreground">
                                          Output
                                        </TableHead>
                                        <TableHead className="px-3 py-2 text-right text-[10px] font-semibold uppercase text-muted-foreground">
                                          Remaining
                                        </TableHead>
                                        <TableHead className="px-3 py-2 text-right text-[10px] font-semibold uppercase text-muted-foreground">
                                          Qty to Output
                                        </TableHead>
                                      </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                      {g.sizes.map((s) => {
                                        const k = `${g.factoryPO}|${s.size}`;
                                        const q = qtyToOutput.get(k) ?? s.remainingOutput;
                                        const overQty = q > s.remainingOutput;
                                        const negative = q < 0;
                                        return (
                                          <TableRow key={s.size} className="border-t hover:bg-muted/30">
                                            <TableCell className="px-3 py-1.5">
                                              <Badge variant="outline" className="font-mono text-[10px]">
                                                {s.size}
                                              </Badge>
                                            </TableCell>
                                            <TableCell className="px-3 py-1.5 text-right tabular-nums">{fmt(s.orderQty)}</TableCell>
                                            <TableCell className="px-3 py-1.5 text-right tabular-nums">{fmt(s.outputQty)}</TableCell>
                                            <TableCell className="px-3 py-1.5 text-right tabular-nums">
                                              {s.remainingOutput > 0 ? (
                                                <span className="font-medium text-amber-600 dark:text-amber-400">
                                                  {fmt(s.remainingOutput)}
                                                </span>
                                              ) : (
                                                <span className="text-muted-foreground">0</span>
                                              )}
                                            </TableCell>
                                            <TableCell className="px-3 py-1.5">
                                              <div className="flex flex-col items-end gap-1">
                                                <Input
                                                  type="number"
                                                  min={0}
                                                  max={s.remainingOutput}
                                                  value={Number.isFinite(q) ? q : 0}
                                                  onChange={(e) => setQty(g.factoryPO, s.size, Number(e.target.value))}
                                                  disabled={!isSelected}
                                                  className={cn(
                                                    "h-8 w-28 text-right tabular-nums text-xs",
                                                    !isSelected && "bg-muted/40 text-muted-foreground",
                                                    (overQty || negative) &&
                                                      "border-rose-400 focus-visible:ring-rose-500/30 dark:border-rose-700"
                                                  )}
                                                  aria-invalid={overQty || negative}
                                                />
                                                {overQty ? (
                                                  <span className="text-[10px] text-rose-600 dark:text-rose-400">
                                                    Exceeds Remaining ({fmt(s.remainingOutput)})
                                                  </span>
                                                ) : null}
                                                {negative ? (
                                                  <span className="text-[10px] text-rose-600 dark:text-rose-400">
                                                    Cannot be negative
                                                  </span>
                                                ) : null}
                                              </div>
                                            </TableCell>
                                          </TableRow>
                                        );
                                      })}
                                      {/* Per-size totals */}
                                      <TableRow className="border-t-2 bg-muted/40 font-medium">
                                        <TableCell className="px-3 py-2 text-[11px] uppercase text-muted-foreground">
                                          Total
                                        </TableCell>
                                        <TableCell className="px-3 py-2 text-right tabular-nums">
                                          {fmt(g.sizes.reduce((a, b) => a + b.orderQty, 0))}
                                        </TableCell>
                                        <TableCell className="px-3 py-2 text-right tabular-nums">
                                          {fmt(g.sizes.reduce((a, b) => a + b.outputQty, 0))}
                                        </TableCell>
                                        <TableCell className="px-3 py-2 text-right tabular-nums">
                                          {fmt(g.totalRemaining)}
                                        </TableCell>
                                        <TableCell className="px-3 py-2 text-right tabular-nums">
                                          {fmt(
                                            g.sizes.reduce(
                                              (a, b) =>
                                                a + (qtyToOutput.get(`${g.factoryPO}|${b.size}`) ?? b.remainingOutput),
                                              0
                                            )
                                          )}
                                        </TableCell>
                                      </TableRow>
                                    </TableBody>
                                  </Table>
                                </div>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      }

                      return rows;
                    })
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Footer: Generate Slip button */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/30 px-4 py-2.5">
              <div className="text-xs text-muted-foreground">
                <span className="font-medium">{selectedFpos.size}</span> Factory PO
                {selectedFpos.size === 1 ? "" : "s"} selected
                {validationErrors.length > 0 ? (
                  <Badge
                    variant="outline"
                    className="ml-2 border-rose-300 bg-rose-50 text-[10px] text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300"
                  >
                    {validationErrors.length} validation issue
                    {validationErrors.length === 1 ? "" : "s"}
                  </Badge>
                ) : null}
              </div>
              <Button
                size="sm"
                className={cn("h-9 gap-1.5 text-xs", theme.bg, "text-white hover:opacity-90")}
                onClick={openGenerateDialog}
                disabled={selectedFpos.size === 0 || validationErrors.length > 0}
              >
                <FileOutput className="h-4 w-4" />
                Generate Output Slip
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* ============================================================= */}
      {/* Section 4 — Selection Summary                                  */}
      {/* ============================================================= */}
      {poNo && groups.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Selected Factory POs"
            value={fmt(summary.selectedFpoCount)}
            icon={Factory}
            tone="primary"
            sub={<span>of {fmt(groups.length)} loaded</span>}
          />
          <StatCard
            label="Selected Sizes"
            value={fmt(summary.selectedSizes)}
            icon={Layers}
            tone="muted"
          />
          <StatCard
            label="Total Remaining"
            value={fmt(summary.totalRemaining)}
            icon={AlertTriangle}
            tone="warning"
            sub={<span>Order {fmt(summary.totalOrder)} · Output {fmt(summary.totalOutput)}</span>}
          />
          <StatCard
            label="Total To Output"
            value={fmt(summary.totalToOutput)}
            icon={Truck}
            tone="ok"
            sub={<span>will be written to slip</span>}
          />
        </div>
      ) : null}

      {/* ============================================================= */}
      {/* Section 6 — Generated Slip Preview + Actions                   */}
      {/* ============================================================= */}
      {generatedSlip ? (
        <GeneratedSlipPreview
          slip={generatedSlip}
          theme={theme}
          exporting={exportingId === generatedSlip.id}
          confirming={confirmingId === generatedSlip.id}
          onExport={() => handleExport(generatedSlip.id, generatedSlip.slipNumber)}
          onPrint={() => handlePrint(generatedSlip)}
          onConfirm={() => handleConfirm(generatedSlip)}
          onCancel={() => openCancelDialog(generatedSlip)}
          onDismiss={() => setGeneratedSlip(null)}
        />
      ) : null}

      {/* ============================================================= */}
      {/* Section 7 — Existing Slips List                                */}
      {/* ============================================================= */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <FileOutput className="h-4 w-4 text-primary" />
            Existing Output Slips
            <Badge variant="outline" className="text-[10px]">
              {slips.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="max-h-[500px] overflow-y-auto scroll-thin">
            <Table className="text-xs">
              <TableHeader className="sticky top-0 z-10 bg-muted/80 backdrop-blur">
                <TableRow>
                  <TableHead className="whitespace-nowrap px-3 py-2 text-[10px] font-semibold uppercase text-muted-foreground">
                    Slip#
                  </TableHead>
                  <TableHead className="whitespace-nowrap px-3 py-2 text-[10px] font-semibold uppercase text-muted-foreground">
                    PO NO#
                  </TableHead>
                  <TableHead className="whitespace-nowrap px-3 py-2 text-[10px] font-semibold uppercase text-muted-foreground">
                    Mode
                  </TableHead>
                  <TableHead className="whitespace-nowrap px-3 py-2 text-[10px] font-semibold uppercase text-muted-foreground">
                    Status
                  </TableHead>
                  <TableHead className="whitespace-nowrap px-3 py-2 text-right text-[10px] font-semibold uppercase text-muted-foreground">
                    Factory POs
                  </TableHead>
                  <TableHead className="whitespace-nowrap px-3 py-2 text-right text-[10px] font-semibold uppercase text-muted-foreground">
                    Total To Output
                  </TableHead>
                  <TableHead className="whitespace-nowrap px-3 py-2 text-[10px] font-semibold uppercase text-muted-foreground">
                    Created At
                  </TableHead>
                  <TableHead className="whitespace-nowrap px-3 py-2 text-right text-[10px] font-semibold uppercase text-muted-foreground">
                    Actions
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {slipsQuery.isLoading ? (
                  <TableSkeleton rows={4} cols={8} />
                ) : slipsQuery.isError ? (
                  <EmptyRow
                    colSpan={8}
                    message="Failed to load slips"
                    hint={
                      slipsQuery.error instanceof Error
                        ? slipsQuery.error.message
                        : "Unknown error. Try Refresh."
                    }
                    icon={AlertTriangle}
                  />
                ) : slips.length === 0 ? (
                  <EmptyRow
                    colSpan={8}
                    message="No output slips yet"
                    hint={`Generate one above — it will appear here for ${productLabel}.`}
                    icon={FileOutput}
                  />
                ) : (
                  slips.map((s) => (
                    <ExistingSlipRow
                      key={s.id}
                      slip={s}
                      theme={theme}
                      onExport={() => handleExport(s.id, s.slipNumber)}
                      onConfirm={() => handleConfirm(s)}
                      onCancel={() => openCancelDialog(s)}
                      exporting={exportingId === s.id}
                      confirming={confirmingId === s.id}
                    />
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* ============================================================= */}
      {/* Section 5 dialog — Generate slip mode selection                */}
      {/* ============================================================= */}
      <Dialog
        open={showModeDialog}
        onOpenChange={(o) => {
          if (!generating) setShowModeDialog(o);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileOutput className="h-4 w-4 text-primary" />
              Generate Output Slip
            </DialogTitle>
            <DialogDescription>
              Choose how to organize the slip. This creates a slip record — it does NOT write
              entries to EntryData yet.
            </DialogDescription>
          </DialogHeader>

          {/* Summary of what will be generated */}
          <div className="rounded-md border bg-muted/30 p-3 text-xs">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-muted-foreground">Factory POs:</span>{" "}
                <strong className="tabular-nums">{fmt(summary.selectedFpoCount)}</strong>
              </div>
              <div>
                <span className="text-muted-foreground">Sizes:</span>{" "}
                <strong className="tabular-nums">{fmt(summary.selectedSizes)}</strong>
              </div>
              <div>
                <span className="text-muted-foreground">Total to Output:</span>{" "}
                <strong className="tabular-nums">{fmt(summary.totalToOutput)}</strong>
              </div>
              <div>
                <span className="text-muted-foreground">PO NO#:</span>{" "}
                <span className="font-mono">{poNo}</span>
              </div>
            </div>
          </div>

          <RadioGroup
            value={slipMode}
            onValueChange={(v) => setSlipMode(v as SlipMode)}
            className="gap-2"
          >
            <label
              className={cn(
                "flex items-start gap-3 rounded-md border p-3 text-xs cursor-pointer transition-colors",
                slipMode === "combined"
                  ? "border-primary bg-primary/5"
                  : "hover:bg-muted/30"
              )}
            >
              <RadioGroupItem value="combined" className="mt-0.5" />
              <div>
                <div className="font-medium">One Combined Slip</div>
                <div className="text-muted-foreground">
                  All selected Factory POs in a single slip document.
                </div>
              </div>
            </label>
            <label
              className={cn(
                "flex items-start gap-3 rounded-md border p-3 text-xs cursor-pointer transition-colors",
                slipMode === "separate"
                  ? "border-primary bg-primary/5"
                  : "hover:bg-muted/30"
              )}
            >
              <RadioGroupItem value="separate" className="mt-0.5" />
              <div>
                <div className="font-medium">Separate Slip per Factory PO</div>
                <div className="text-muted-foreground">
                  One slip per Factory PO — exported with one sheet per Factory PO.
                </div>
              </div>
            </label>
            <label
              className={cn(
                "flex items-start gap-3 rounded-md border p-3 text-xs cursor-pointer transition-colors",
                slipMode === "group_by_color"
                  ? "border-primary bg-primary/5"
                  : "hover:bg-muted/30"
              )}
            >
              <RadioGroupItem value="group_by_color" className="mt-0.5" />
              <div>
                <div className="font-medium">Group by Color / PO NO#</div>
                <div className="text-muted-foreground">
                  Group items by colorCode within the same PO NO#.
                </div>
              </div>
            </label>
          </RadioGroup>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-9 text-xs"
              onClick={() => setShowModeDialog(false)}
              disabled={generating}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className={cn("h-9 gap-1.5 text-xs", theme.bg, "text-white hover:opacity-90")}
              onClick={confirmGenerate}
              disabled={generating}
            >
              {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              {generating ? "Generating…" : "Confirm Generate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel confirmation dialog */}
      <AlertDialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-rose-500" />
              Cancel Output Slip?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {cancelTarget ? (
                <>
                  This will mark slip{" "}
                  <strong className="font-mono">{cancelTarget.slipNumber}</strong> as
                  <strong> cancelled</strong>. The action cannot be undone. No EntryData rows
                  will be deleted (no entries have been created yet — confirming is what writes
                  them).
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Slip</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-500 text-white hover:bg-rose-600 dark:bg-rose-600 dark:hover:bg-rose-700"
              onClick={confirmCancel}
            >
              <X className="mr-1 h-4 w-4" />
              Cancel Slip
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// =====================================================================
// GeneratedSlipPreview — Section 6 preview card with item table + actions
// =====================================================================

function GeneratedSlipPreview({
  slip,
  theme,
  exporting,
  confirming,
  onExport,
  onPrint,
  onConfirm,
  onCancel,
  onDismiss,
}: {
  slip: SlipRecord;
  theme: { bg: string; text: string; badge: string };
  exporting: boolean;
  confirming: boolean;
  onExport: () => void;
  onPrint: () => void;
  onConfirm: () => void;
  onCancel: () => void;
  onDismiss: () => void;
}) {
  const items = React.useMemo(() => parseSlipItems(slip), [slip]);
  const totalToOutput = items.reduce((s, i) => s + i.qtyToOutput, 0);
  const totalOrder = items.reduce((s, i) => s + i.orderQty, 0);
  const totalOutput = items.reduce((s, i) => s + i.outputQty, 0);
  const totalRemaining = items.reduce((s, i) => s + i.remainingOutput, 0);
  const isConfirmed = slip.status === "confirmed_output";
  const isCancelled = slip.status === "cancelled";

  return (
    <Card className={cn("overflow-hidden", isConfirmed && "ring-1 ring-emerald-500/30")}>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
            <CheckCircle2 className={cn("h-4 w-4", isConfirmed ? "text-emerald-500" : "text-primary")} />
            Generated Slip Preview
            <Badge variant="outline" className="font-mono text-[10px]">
              {slip.slipNumber}
            </Badge>
            <Badge className={cn("text-[10px]", statusBadgeClass(slip.status))}>
              {statusLabel(slip.status)}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              {modeLabel(slip.slipMode)}
            </Badge>
          </CardTitle>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0"
            onClick={onDismiss}
            aria-label="Dismiss preview"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Meta line */}
        <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          <span>
            PO NO#: <span className="font-mono text-foreground">{slip.poNo}</span>
          </span>
          <span>
            Product: <strong className="text-foreground">{slip.productType}</strong>
          </span>
          <span>
            Factory POs: <strong className="tabular-nums text-foreground">{slip.factoryPOCount}</strong>
          </span>
          <span>
            Sizes: <strong className="tabular-nums text-foreground">{slip.sizeCount}</strong>
          </span>
          {slip.createdAt ? (
            <span>
              Created: <strong className="text-foreground">{fmtDateTime(slip.createdAt)}</strong>
            </span>
          ) : null}
        </div>

        {/* Items table */}
        <div className="overflow-x-auto scroll-thin rounded-md border">
          <Table className="text-xs">
            <TableHeader className="bg-muted/40">
              <TableRow>
                <TableHead className="whitespace-nowrap px-3 py-2 text-[10px] font-semibold uppercase text-muted-foreground">
                  Factory PO
                </TableHead>
                <TableHead className="whitespace-nowrap px-3 py-2 text-[10px] font-semibold uppercase text-muted-foreground">
                  Size
                </TableHead>
                <TableHead className="whitespace-nowrap px-3 py-2 text-right text-[10px] font-semibold uppercase text-muted-foreground">
                  Qty to Output
                </TableHead>
                <TableHead className="whitespace-nowrap px-3 py-2 text-right text-[10px] font-semibold uppercase text-muted-foreground">
                  Order
                </TableHead>
                <TableHead className="whitespace-nowrap px-3 py-2 text-right text-[10px] font-semibold uppercase text-muted-foreground">
                  Output
                </TableHead>
                <TableHead className="whitespace-nowrap px-3 py-2 text-right text-[10px] font-semibold uppercase text-muted-foreground">
                  Remaining
                </TableHead>
                <TableHead className="whitespace-nowrap px-3 py-2 text-[10px] font-semibold uppercase text-muted-foreground">
                  Deadline
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <EmptyRow colSpan={7} message="No items in this slip" icon={AlertTriangle} />
              ) : (
                items.map((i, idx) => (
                  <TableRow key={`${i.factoryPO}-${i.size}-${idx}`} className="border-t hover:bg-muted/30">
                    <TableCell className="whitespace-nowrap px-3 py-1.5 font-mono text-[11px]">
                      {i.factoryPO}
                    </TableCell>
                    <TableCell className="px-3 py-1.5">
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {i.size}
                      </Badge>
                    </TableCell>
                    <TableCell className="px-3 py-1.5 text-right tabular-nums font-medium text-emerald-600 dark:text-emerald-400">
                      {fmt(i.qtyToOutput)}
                    </TableCell>
                    <TableCell className="px-3 py-1.5 text-right tabular-nums">{fmt(i.orderQty)}</TableCell>
                    <TableCell className="px-3 py-1.5 text-right tabular-nums">{fmt(i.outputQty)}</TableCell>
                    <TableCell className="px-3 py-1.5 text-right tabular-nums">{fmt(i.remainingOutput)}</TableCell>
                    <TableCell className="whitespace-nowrap px-3 py-1.5 text-[11px] text-muted-foreground">
                      {i.deadline ? formatDeadline(i.deadline) : "—"}
                    </TableCell>
                  </TableRow>
                ))
              )}
              {/* Totals row */}
              {items.length > 0 ? (
                <TableRow className="border-t-2 bg-muted/40 font-medium">
                  <TableCell className="px-3 py-2 text-[11px] uppercase text-muted-foreground" colSpan={2}>
                    Total
                  </TableCell>
                  <TableCell className="px-3 py-2 text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                    {fmt(totalToOutput)}
                  </TableCell>
                  <TableCell className="px-3 py-2 text-right tabular-nums">{fmt(totalOrder)}</TableCell>
                  <TableCell className="px-3 py-2 text-right tabular-nums">{fmt(totalOutput)}</TableCell>
                  <TableCell className="px-3 py-2 text-right tabular-nums">{fmt(totalRemaining)}</TableCell>
                  <TableCell className="px-3 py-2" />
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>

        {/* Action buttons */}
        {!isCancelled ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-9 gap-1.5 text-xs"
              onClick={onExport}
              disabled={exporting}
            >
              {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              {exporting ? "Exporting…" : "Export Excel"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-9 gap-1.5 text-xs"
              onClick={onPrint}
            >
              <Printer className="h-3.5 w-3.5" />
              Print
            </Button>
            {!isConfirmed ? (
              <>
                <Button
                  size="sm"
                  className={cn("h-9 gap-1.5 text-xs", theme.bg, "text-white hover:opacity-90")}
                  onClick={onConfirm}
                  disabled={confirming}
                >
                  {confirming ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                  {confirming ? "Confirming…" : "Confirm Actual Output"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-9 gap-1.5 text-xs text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:text-rose-400 dark:hover:bg-rose-950/40"
                  onClick={onCancel}
                >
                  <X className="h-3.5 w-3.5" />
                  Cancel Slip
                </Button>
              </>
            ) : (
              <Badge
                variant="outline"
                className="gap-1 border-emerald-300 bg-emerald-50 text-[10px] text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/50 dark:text-emerald-300"
              >
                <CheckCircle2 className="h-3 w-3" />
                Output already confirmed
              </Badge>
            )}
          </div>
        ) : (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>This slip has been cancelled</AlertTitle>
            <AlertDescription>
              Export is still available for record-keeping. Confirm / Cancel actions are disabled.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

// =====================================================================
// ExistingSlipRow — one row in the Section 7 list
// =====================================================================

function ExistingSlipRow({
  slip,
  theme,
  onExport,
  onConfirm,
  onCancel,
  exporting,
  confirming,
}: {
  slip: SlipRecord;
  theme: { bg: string; badge: string };
  onExport: () => void;
  onConfirm: () => void;
  onCancel: () => void;
  exporting: boolean;
  confirming: boolean;
}) {
  const canConfirm = slip.status === "generated" || slip.status === "printed";
  const canCancel = slip.status !== "confirmed_output" && slip.status !== "cancelled";
  return (
    <TableRow className="border-t hover:bg-muted/30">
      <TableCell className="whitespace-nowrap px-3 py-1.5 font-mono text-[11px]">
        {slip.slipNumber}
      </TableCell>
      <TableCell className="whitespace-nowrap px-3 py-1.5 font-mono text-[11px]">
        {slip.poNo || "—"}
      </TableCell>
      <TableCell className="whitespace-nowrap px-3 py-1.5 text-[11px]">
        {modeLabel(slip.slipMode)}
      </TableCell>
      <TableCell className="px-3 py-1.5">
        <Badge className={cn("text-[10px]", statusBadgeClass(slip.status))}>
          {statusLabel(slip.status)}
        </Badge>
      </TableCell>
      <TableCell className="px-3 py-1.5 text-right tabular-nums">{fmt(slip.factoryPOCount)}</TableCell>
      <TableCell className="px-3 py-1.5 text-right tabular-nums font-medium">
        {fmt(slip.totalToOutput)}
      </TableCell>
      <TableCell className="whitespace-nowrap px-3 py-1.5 text-[11px] text-muted-foreground">
        {fmtDateTime(slip.createdAt)}
      </TableCell>
      <TableCell className="px-3 py-1.5">
        <div className="flex items-center justify-end gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0"
            onClick={onExport}
            disabled={exporting}
            aria-label={`Export slip ${slip.slipNumber}`}
            title="Export Excel"
          >
            {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0"
            onClick={onConfirm}
            disabled={!canConfirm || confirming}
            aria-label={`Confirm slip ${slip.slipNumber}`}
            title={canConfirm ? "Confirm Actual Output" : "Cannot confirm (status)"}
          >
            {confirming ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0 text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:text-rose-400 dark:hover:bg-rose-950/40"
            onClick={onCancel}
            disabled={!canCancel}
            aria-label={`Cancel slip ${slip.slipNumber}`}
            title={canCancel ? "Cancel Slip" : "Cannot cancel (already confirmed)"}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

export default ProductOutputSlipView;
