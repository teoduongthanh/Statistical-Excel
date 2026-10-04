"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  PenLine,
  Sparkles,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Plus,
  Wand2,
  RotateCcw,
  AlertCircle,
  Info,
  Trash2,
  Pencil,
  Save,
  X,
  Table2,
  Calculator,
  Database,
  ClipboardPaste,
  ClipboardCheck,
  Upload,
  RefreshCw,
  Eye,
  ShieldCheck,
  Lightbulb,
  FileSpreadsheet,
} from "lucide-react";
import { SmartAutocomplete } from "@/components/common/smart-autocomplete";
import { api } from "@/lib/api-client";
import { useAppStore, PRODUCT_THEME } from "@/store/app-store";
import { buildAutoMapping } from "@/lib/header-normalize";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
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

const SHIPPING_OPTIONS = [
  { value: "1.Order", label: "1.Order", color: "bg-slate-100 text-slate-700" },
  { value: "2.Output", label: "2.Output", color: "bg-amber-100 text-amber-700" },
  { value: "3.Pending", label: "3.Pending", color: "bg-violet-100 text-violet-700" },
  { value: "4.Input", label: "4.Input", color: "bg-emerald-100 text-emerald-700" },
];

// ────────────────────────────────────────────────────────────────────────────
// SMART ENTRY DATA SYSTEM — helpers
// ────────────────────────────────────────────────────────────────────────────

// normalizeSize — used when matching the user's typed Size against Master
// Data sizes. Mirrors the server-side normalizeSize() in the smart-lookup
// route. We only touch whitespace, never the T suffix: "M(10)" ≠ "M(10T)".
function normalizeSize(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/\r?\n/g, " ") // remove line breaks (CR, LF)
    .replace(/\s+/g, " ")   // collapse duplicate spaces / tabs
    .trim();                 // trim leading/trailing whitespace
}

// Confidence badge meta — keyed by the 4 levels / NONE.
// Colors per spec: emerald (HIGH), amber (MEDIUM), rose (LOW), no indigo/blue.
const CONFIDENCE_META: Record<
  string,
  { label: string; level: number; color: string; ring: string; dot: string }
> = {
  HIGH: {
    label: "HIGH — Exact Match",
    level: 1,
    color: "bg-emerald-100 text-emerald-700 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800",
    ring: "ring-emerald-500/30",
    dot: "bg-emerald-500",
  },
  MEDIUM: {
    label: "MEDIUM — Partial Match",
    level: 2,
    color: "bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800",
    ring: "ring-amber-500/30",
    dot: "bg-amber-500",
  },
  LOW: {
    label: "LOW — Suggested Match",
    level: 4,
    color: "bg-rose-100 text-rose-700 border-rose-300 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800",
    ring: "ring-rose-500/30",
    dot: "bg-rose-500",
  },
  NONE: {
    label: "No Match",
    level: 0,
    color: "bg-muted text-muted-foreground border-border",
    ring: "ring-transparent",
    dot: "bg-muted-foreground",
  },
};

function ConfidenceBadge({
  confidence,
  level,
  className,
}: {
  confidence: "HIGH" | "MEDIUM" | "LOW" | "NONE";
  level?: 0 | 1 | 2 | 3 | 4;
  className?: string;
}) {
  const meta = CONFIDENCE_META[confidence];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        meta.color,
        className
      )}
      title={`Match Level ${level ?? meta.level}`}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
      {meta.label}
    </span>
  );
}

export function ProductDataEntryView() {
  const { currentProduct, bumpRefresh, refreshKey } = useAppStore();
  const theme = PRODUCT_THEME[currentProduct];

  // Form state — 5 user inputs (spec §1)
  const [shippingStatus, setShippingStatus] = React.useState("");
  const [poNo, setPoNo] = React.useState("");
  const [factoryPO, setFactoryPO] = React.useState("");
  const [size, setSize] = React.useState("");
  const [qty, setQty] = React.useState("");

  // Auto-filled from Master Data (spec §6)
  const [autoFill, setAutoFill] = React.useState<any>(null);
  const [lookupLoading, setLookupLoading] = React.useState(false);

  // ── SMART ENTRY DATA SYSTEM — 4-level matching state ───────────────────
  // lookupLevel: 0 (no match) | 1 (exact) | 2 (fpo+po) | 3 (fpo only) | 4 (partial)
  // lookupConfidence: HIGH (Level 1) | MEDIUM (Level 2/3) | LOW (Level 4) | NONE
  // candidates: Level 4 list of Factory POs matching the suffix
  // availableSizes: Level 2 list of sizes valid for this (factoryPO + poNo) combo
  const [lookupLevel, setLookupLevel] = React.useState<0 | 1 | 2 | 3 | 4>(0);
  const [lookupConfidence, setLookupConfidence] = React.useState<"HIGH" | "MEDIUM" | "LOW" | "NONE">("NONE");
  const [candidates, setCandidates] = React.useState<any[]>([]);
  const [availableSizes, setAvailableSizes] = React.useState<string[]>([]);

  // Preview-Before-Save dialog (spec §4). When user clicks "Add Data" and
  // validation passes, we open this dialog so they can review the auto-filled
  // data + confidence badge before committing. Only [CONFIRM ENTRY] saves.
  const [previewOpen, setPreviewOpen] = React.useState(false);

  // Preview / Confirm state — removed. Add Data saves directly (user request).
  // Review now happens later in the "Review & Merge with Master Data" view.
  const [saving, setSaving] = React.useState(false);

  // Recent entries
  const [recent, setRecent] = React.useState<any[]>([]);
  const qc = useQueryClient();

  // ===== Entries table state =====
  const [selectedEntryIds, setSelectedEntryIds] = React.useState<Set<string>>(new Set());
  const [editEntry, setEditEntry] = React.useState<any>(null);
  const [editData, setEditData] = React.useState<Record<string, string>>({});
  const [savingEdit, setSavingEdit] = React.useState(false);
  const [deleteEntryRow, setDeleteEntryRow] = React.useState<any>(null);
  const [deleting, setDeleting] = React.useState(false);
  const [deleteWarn, setDeleteWarn] = React.useState<{ id: string; message: string } | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = React.useState(false);
  const [bulkDeleting, setBulkDeleting] = React.useState(false);
  // ===== Add entries to Master Data =====
  const [selectedMasterIds, setSelectedMasterIds] = React.useState<Set<string>>(new Set());
  const [addingToMaster, setAddingToMaster] = React.useState(false);

  // ===== Bulk Entry mode =====
  // Toggle between "single" (one row at a time with autocomplete lookup) and
  // "bulk" (paste many rows from Excel, validate, then confirm import).
  // ===== Entry mode: "single" | "bulk" | "order" | "bulk-staging" =====
  const [entryMode, setEntryMode] = React.useState<"single" | "bulk" | "order" | "bulk-staging">("single");
  const [bulkPastedText, setBulkPastedText] = React.useState("");
  const [bulkHasHeader, setBulkHasHeader] = React.useState(true);
  const [bulkValidating, setBulkValidating] = React.useState(false);
  const [bulkResult, setBulkResult] = React.useState<any>(null);
  const [bulkFilter, setBulkFilter] = React.useState<"all" | "valid" | "warning" | "error">("all");
  const [bulkImporting, setBulkImporting] = React.useState(false);
  const [showBulkImportPreview, setShowBulkImportPreview] = React.useState(false);
  const [bulkExpandedRow, setBulkExpandedRow] = React.useState<number | null>(null);
  // Tracks the most recent mapping (header → canonical field) so we can show
  // the user what we detected, in the UI.
  const [bulkMapping, setBulkMapping] = React.useState<Record<string, string>>({});

  // ===== Entries table pagination (server-side via page/pageSize) =====
  const [entryPage, setEntryPage] = React.useState(1);
  const ENTRY_PAGE_SIZE = 20;

  // Fetch entries for this product (today's entries + recent), paginated.
  const entriesQ = useQuery({
    queryKey: ["data-entry-entries", currentProduct, refreshKey, entryPage],
    queryFn: () => api.listEntries({ productType: currentProduct, page: entryPage, pageSize: ENTRY_PAGE_SIZE }),
  });
  const entryRows = entriesQ.data?.rows ?? [];
  const entryTotal = entriesQ.data?.total ?? 0;
  const entryTotalPages = entriesQ.data?.totalPages ?? 1;

  // Reset to first page whenever the product context changes.
  React.useEffect(() => {
    setEntryPage(1);
  }, [currentProduct]);

  // Keep context checkboxes (spec §48 — extended to PO NO# + Factory PO)
  const [keepStatus, setKeepStatus] = React.useState(true);
  const [keepPoNo, setKeepPoNo] = React.useState(true);
  const [keepFactoryPO, setKeepFactoryPO] = React.useState(true);

  // Refs for Enter-key navigation (spec §11, §43)
  const poNoRef = React.useRef<HTMLDivElement>(null);
  const factoryPORef = React.useRef<HTMLDivElement>(null);
  const sizeRef = React.useRef<HTMLInputElement>(null);
  const qtyRef = React.useRef<HTMLInputElement>(null);

  // Focus the <input> inside a SmartAutocomplete wrapper div.
  function focusAutocomplete(wrapper: HTMLDivElement | null) {
    if (!wrapper) return;
    const input = wrapper.querySelector("input");
    input?.focus();
    input?.select();
  }

  // Reset all form fields (spec §44). Keeps selected context fields if their keep-flag is on.
  function resetForm(opts?: { keepStatus?: boolean; keepPoNo?: boolean; keepFactoryPO?: boolean }) {
    const keepStatusFlag = opts?.keepStatus ?? keepStatus;
    const keepPoNoFlag = opts?.keepPoNo ?? keepPoNo;
    const keepFactoryPOFlag = opts?.keepFactoryPO ?? keepFactoryPO;
    if (!keepStatusFlag) setShippingStatus("");
    if (!keepPoNoFlag) setPoNo("");
    if (!keepFactoryPOFlag) setFactoryPO("");
    setSize("");
    setQty("");
    setAutoFill(null);
    // Clear the Smart Entry state so stale confidence / candidates don't leak.
    setLookupLevel(0);
    setLookupConfidence("NONE");
    setCandidates([]);
    setAvailableSizes([]);
    // Focus: jump to the first cleared field, or Size if context is kept.
    setTimeout(() => {
      if (keepStatusFlag && keepPoNoFlag && keepFactoryPOFlag) {
        // All context kept → jump straight to Size for fast re-entry.
        sizeRef.current?.focus();
      } else if (keepStatusFlag && !keepPoNoFlag) {
        focusAutocomplete(poNoRef.current);
      } else if (keepStatusFlag && keepPoNoFlag && !keepFactoryPOFlag) {
        focusAutocomplete(factoryPORef.current);
      } else {
        focusAutocomplete(poNoRef.current);
      }
    }, 50);
  }

  // ── SMART LOOKUP (4-LEVEL MATCHING ENGINE) ──────────────────────────────
  // Replaces the previous debounced `lookupFactoryPO` call.
  // Fires whenever the user has selected a Factory PO (with or without
  // PO NO# / Size). The smart-lookup endpoint figures out the right level:
  //   Level 1 — all 4 fields exact-match (HIGH)        → auto-fill everything
  //   Level 2 — factoryPO + poNo co-occur (MEDIUM)      → show available sizes
  //   Level 3 — factoryPO found, no poNo match (MEDIUM) → show group info + sizes
  //   Level 4 — factoryPO not found, partial suffix match (LOW) → show candidates
  //   Level 0 — no match at all (NONE)
  React.useEffect(() => {
    if (!factoryPO || !currentProduct) {
      setAutoFill(null);
      setLookupLevel(0);
      setLookupConfidence("NONE");
      setCandidates([]);
      setAvailableSizes([]);
      return;
    }
    let cancelled = false;
    setLookupLoading(true);
    const t = setTimeout(async () => {
      try {
        const result = await api.smartLookup({
          productType: currentProduct,
          poNo: poNo || undefined,
          factoryPO,
          size: size || undefined,
        });
        if (cancelled) return;
        setAutoFill(result.masterGroup ?? null);
        setLookupLevel(result.level);
        setLookupConfidence(result.confidence);
        setCandidates(result.candidates ?? []);
        setAvailableSizes(result.availableSizes ?? []);
      } catch {
        if (!cancelled) {
          setAutoFill(null);
          setLookupLevel(0);
          setLookupConfidence("NONE");
          setCandidates([]);
          setAvailableSizes([]);
        }
      } finally {
        if (!cancelled) setLookupLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [factoryPO, poNo, size, currentProduct]);

  // Clicking a Level 4 candidate: fill the Factory PO + PO NO# fields, then
  // the lookup useEffect above will fire again and resolve to Level 1-3.
  function applyCandidate(c: any) {
    setFactoryPO(c.factoryPO || "");
    if (c.poNo) setPoNo(c.poNo);
    // Clear candidates immediately so the panel disappears while re-looking up.
    setCandidates([]);
    setLookupConfidence("NONE");
    setLookupLevel(0);
    setTimeout(() => sizeRef.current?.focus(), 120);
  }

  // ===== Keyboard shortcuts (Data Entry) =====
  // Ctrl+Alt+Q: clear PO NO# field and jump focus to it (for fast PO switching).
  // Ctrl+Alt+W: clear Factory PO field and jump focus to it (for fast FPO switching).
  // NOTE: Using Ctrl+Alt+ (instead of just Ctrl+) avoids conflicts with the
  // browser's built-in shortcuts (Ctrl+W closes the tab, Ctrl+Q quits the
  // browser). Ctrl+Alt+Q/W have no default browser behavior.
  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!((e.ctrlKey || e.metaKey) && e.altKey)) return;
      // Ctrl+Alt+Q → clear + focus PO NO#
      if (e.key === "q" || e.key === "Q") {
        e.preventDefault();
        setPoNo("");
        setTimeout(() => focusAutocomplete(poNoRef.current), 0);
        return;
      }
      // Ctrl+Alt+W → clear + focus Factory PO
      if (e.key === "w" || e.key === "W") {
        e.preventDefault();
        setFactoryPO("");
        // Clearing Factory PO invalidates the size dropdown (it depends on FPO
        // lookup), so reset size + qty + autoFill + smart-lookup state too.
        setSize("");
        setQty("");
        setAutoFill(null);
        setLookupLevel(0);
        setLookupConfidence("NONE");
        setCandidates([]);
        setAvailableSizes([]);
        setTimeout(() => focusAutocomplete(factoryPORef.current), 0);
        return;
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Validation (spec §13)
  const validationErrors = React.useMemo(() => {
    const errs: string[] = [];
    if (!shippingStatus) errs.push("Please select Shipping Status first.");
    if (!poNo) errs.push("PO NO# is required");
    if (!factoryPO) errs.push("Factory PO is required");
    if (!size) errs.push("Size is required");
    if (!qty) errs.push("Qty is required");
    else {
      // If qty still contains an expression (user hasn't blurred yet), try to evaluate.
      let valToCheck = qty;
      if (/[+\-*/]/.test(qty.replace(/^\s*-/, "").trim())) {
        const { value, computed } = evaluateQtyExpression(qty);
        if (computed) valToCheck = value;
        else { errs.push("Qty expression is invalid — press Enter to calculate"); }
      }
      if (errs.length === 0) {
        if (isNaN(Number(valToCheck))) errs.push("Qty must be a number");
        else if (Number(valToCheck) <= 0) errs.push("Qty must be greater than 0");
      }
    }
    return errs;
  }, [shippingStatus, poNo, factoryPO, size, qty]);

  const canAdd = validationErrors.length === 0;

  // ── Derived size state for the Smart Entry System ───────────────────────
  // sizeOptions: the list shown in the Size input dropdown + chips.
  //   Priority: availableSizes (Level 1/2 — filtered by poNo) > autoFill.sizes (Level 3 fallback).
  // sizeIsValid: whether the user's typed Size matches any of the Master Data
  //   sizes for this Factory PO. Uses normalizeSize() so trailing spaces /
  //   line breaks / double spaces don't cause false negatives.
  const sizeOptions = React.useMemo<string[]>(() => {
    if (availableSizes.length > 0) return availableSizes;
    if (autoFill?.sizes && Array.isArray(autoFill.sizes)) return autoFill.sizes as string[];
    return [];
  }, [availableSizes, autoFill]);

  const sizeIsValid = React.useMemo<boolean>(() => {
    if (!size) return false;
    if (sizeOptions.length === 0) return false;
    const normInput = normalizeSize(size);
    return sizeOptions.some((s) => normalizeSize(s) === normInput);
  }, [size, sizeOptions]);

  // ADD DATA — opens the Preview-Before-Save dialog (spec §4 of Smart Entry
  // Data System). The actual save happens in `confirmEntryFromPreview()` only
  // when the user clicks [CONFIRM ENTRY]. This preserves the previous "fast
  // entry" feel: validation still runs up-front, but the user gets one last
  // look at the auto-filled data + confidence badge before committing.
  // Keyboard navigation still works: pressing Enter in the Qty field triggers
  // this same preview step (via handleEnter → case "qty").
  function handleAddData() {
    if (!canAdd) {
      toast.error("Please fix validation errors", { description: validationErrors[0] });
      return;
    }
    // LOW confidence (Level 4 partial match) means the Factory PO wasn't found
    // exactly — auto-save would create bad data. Refuse and tell the user.
    if (lookupConfidence === "LOW") {
      toast.error("Cannot save — Factory PO not in Master Data", {
        description: "Pick a candidate from the suggestion panel below, or add it to Master Data first.",
      });
      return;
    }
    setPreviewOpen(true);
  }

  // Real save — called from the preview dialog's [CONFIRM ENTRY] button.
  async function confirmEntryFromPreview() {
    if (!canAdd) {
      toast.error("Please fix validation errors", { description: validationErrors[0] });
      return;
    }
    setPreviewOpen(false);
    setSaving(true);
    try {
      const r = await api.confirmEntry({
        productType: currentProduct,
        shippingStatus,
        poNo,
        factoryPO,
        size,
        qty,
      });
      if (r.ok) {
        const createdCount = r.created?.length || 0;
        let msg = `${shippingStatus} saved`;
        if (shippingStatus === "2.Output") {
          msg = `Output + Pending saved (${createdCount} records)`;
        }
        toast.success(msg, {
          description: `${factoryPO} · ${size} · Qty=${qty}`,
        });
        // Add to recent list (show the created entries).
        if (r.created && r.created.length > 0) {
          setRecent((prev) => [...r.created!, ...prev].slice(0, 10));
        }
        bumpRefresh();
        // Reset form: keep selected context fields per checkboxes.
        resetForm();
      } else {
        toast.error("Save failed", { description: r.errors?.join(", ") });
      }
    } catch (e) {
      toast.error("Save failed", { description: e instanceof Error ? e.message : "" });
    } finally {
      setSaving(false);
    }
  }

  // Enter-key navigation (spec §11, §43).
  // When in an autocomplete dropdown that is open, Enter selects the suggestion first.
  // When the dropdown is closed (or no suggestion), Enter moves to the next field.

  // ===== Add entries to Master Data handlers =====
  function toggleMasterRow(id: string) {
    setSelectedMasterIds((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function toggleAllMasterRows() {
    if (selectedMasterIds.size === entryRows.length) setSelectedMasterIds(new Set());
    else setSelectedMasterIds(new Set(entryRows.map((r: any) => r.id)));
  }

  async function addEntriesToMasterData(mode: "selected" | "all") {
    const rowsToAdd = mode === "selected"
      ? entryRows.filter((r: any) => selectedMasterIds.has(r.id))
      : entryRows;
    if (rowsToAdd.length === 0) {
      toast.error("No rows to add");
      return;
    }
    setAddingToMaster(true);
    try {
      // Use the BULK endpoint: insert all rows in a single transaction +
      // rebuild MasterGroup index ONCE (not per row). This is much faster
      // and ensures all dashboards reflect the new data immediately.
      const bulkRows = rowsToAdd.map((r: any) => ({
        productType: currentProduct,
        factoryPO: r.factoryPO,
        size: r.size,
        poNo: r.poNo,
        shippingStatus: r.shippingStatus,
        model: r.model,
        sku: r.sku,
        item: r.item,
        season: r.season,
        colorCode: r.colorCode,
        colorCode2: r.colorCode2,
        painting: r.painting,
        printingColor: r.printingColor,
        deadline: r.deadline,
        qty1: r.qty1,
        qty2: r.qty2,
      }));
      const res = await api.bulkAddMasterRows(bulkRows);
      const added = res.inserted;
      toast.success(`${added} rows added to Master Data`, {
        description: `${res.productsAffected} product(s) index rebuilt`,
      });
      setSelectedMasterIds(new Set());
      // bumpRefresh triggers ALL views (dashboards, statistics, shipments,
      // reports, autocomplete lookups) to refetch because they all include
      // refreshKey in their query keys.
      bumpRefresh();
    } catch (e) {
      toast.error("Failed to add to Master Data", { description: e instanceof Error ? e.message : "" });
    } finally {
      setAddingToMaster(false);
    }
  }
  function handleEnter(e: React.KeyboardEvent, currentField: string) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    // Order: shippingStatus → poNo → factoryPO → size → qty → save
    switch (currentField) {
      case "poNo":
        focusAutocomplete(factoryPORef.current);
        break;
      case "factoryPO":
        sizeRef.current?.focus();
        break;
      case "size":
        qtyRef.current?.focus();
        break;
      case "qty":
        // From Qty, Enter saves immediately (fast entry — no preview step).
        if (canAdd) handleAddData();
        break;
    }
  }

  // ===== Entries table handlers =====
  function toggleEntry(id: string) {
    setSelectedEntryIds((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function toggleAllEntries() {
    if (selectedEntryIds.size === entryRows.length) setSelectedEntryIds(new Set());
    else setSelectedEntryIds(new Set(entryRows.map((r: any) => r.id)));
  }

  // Calculate totals for checked rows.
  const totals = React.useMemo(() => {
    let qty1Sum = 0, qty2Sum = 0;
    for (const r of entryRows) {
      if (selectedEntryIds.has(r.id)) {
        qty1Sum += Number(r.qty1) || 0;
        qty2Sum += Number(r.qty2) || 0;
      }
    }
    return { qty1Sum, qty2Sum, count: selectedEntryIds.size };
  }, [entryRows, selectedEntryIds]);

  function openEditEntry(row: any) {
    setEditEntry(row);
    setEditData({
      shippingStatus: row.shippingStatus || "",
      poNo: row.poNo || "",
      factoryPO: row.factoryPO || "",
      size: row.size || "",
      qty1: String(row.qty1 ?? ""),
      qty2: String(row.qty2 ?? ""),
      model: row.model || "",
      sku: row.sku || "",
      season: row.season || "",
      colorCode: row.colorCode || "",
      colorCode2: row.colorCode2 || "",
      deadline: row.deadline || "",
      note: row.note || "",
    });
  }

  async function saveEditEntry() {
    if (!editEntry) return;
    setSavingEdit(true);
    try {
      await api.updateEntry(editEntry.id, editData);
      toast.success("Entry updated");
      setEditEntry(null);
      qc.invalidateQueries({ queryKey: ["data-entry-entries"] });
      bumpRefresh();
    } catch (e) {
      toast.error("Update failed", { description: e instanceof Error ? e.message : "" });
    } finally {
      setSavingEdit(false);
    }
  }

  function openDeleteEntry(row: any) {
    setDeleteEntryRow(row);
    setDeleteWarn(null);
  }

  async function confirmDeleteEntry() {
    if (!deleteEntryRow) return;
    setDeleting(true);
    try {
      const res = await api.deleteEntry(deleteEntryRow.id, false);
      if (!res.ok && "needsConfirm" in res && res.needsConfirm) {
        setDeleteWarn({ id: deleteEntryRow.id, message: res.needsConfirm.message });
        setDeleting(false);
        return;
      }
      toast.success("Entry deleted");
      setSelectedEntryIds((s) => { const n = new Set(s); n.delete(deleteEntryRow.id); return n; });
      setDeleteEntryRow(null);
      qc.invalidateQueries({ queryKey: ["data-entry-entries"] });
      bumpRefresh();
    } catch (e) {
      toast.error("Delete failed", { description: e instanceof Error ? e.message : "" });
    } finally {
      setDeleting(false);
    }
  }

  async function confirmDeleteEntryGroup() {
    if (!deleteWarn) return;
    setDeleting(true);
    try {
      const res = await api.deleteEntry(deleteWarn.id, true);
      if (res.ok) {
        toast.success("Entry and paired transaction deleted");
        setSelectedEntryIds((s) => { const n = new Set(s); n.delete(deleteWarn.id); return n; });
        setDeleteWarn(null);
        setDeleteEntryRow(null);
        qc.invalidateQueries({ queryKey: ["data-entry-entries"] });
        bumpRefresh();
      }
    } catch (e) {
      toast.error("Delete failed", { description: e instanceof Error ? e.message : "" });
    } finally {
      setDeleting(false);
    }
  }

  async function confirmBulkDeleteEntries() {
    setBulkDeleting(true);
    try {
      const ids = [...selectedEntryIds];
      const res = await api.bulkDeleteEntries(ids);
      if (res.ok) {
        let msg = `${res.deleted} entries deleted`;
        if (res.deleted > ids.length) {
          msg += ` (includes ${res.deleted - ids.length} paired transaction records)`;
        }
        toast.success(msg);
        setSelectedEntryIds(new Set());
        setBulkDeleteOpen(false);
        qc.invalidateQueries({ queryKey: ["data-entry-entries"] });
        bumpRefresh();
      }
    } catch (e) {
      toast.error("Bulk delete failed", { description: e instanceof Error ? e.message : "" });
    } finally {
      setBulkDeleting(false);
    }
  }

  // ===== Bulk Entry handlers =====
  // Parse the pasted TSV → canonical rows → call bulkValidateEntries.
  async function handleBulkValidate() {
    const trimmed = bulkPastedText.trim();
    if (!trimmed) {
      toast.error("Nothing to check", { description: "Paste some rows first." });
      return;
    }
    setBulkValidating(true);
    setBulkResult(null);
    setBulkExpandedRow(null);
    setBulkFilter("all");
    try {
      const rawRows = parseBulkText(trimmed, bulkHasHeader);
      if (rawRows.length === 0) {
        toast.error("No data rows found", { description: "Check that rows are tab-separated." });
        return;
      }
      // Capture the detected header mapping for display.
      if (bulkHasHeader) {
        const headers = Object.keys(rawRows[0]);
        const mapping = buildAutoMapping(headers);
        setBulkMapping(
          Object.fromEntries(Object.entries(mapping).map(([k, v]) => [k, v || ""]))
        );
      } else {
        setBulkMapping({
          shippingStatus: "shippingStatus",
          poNo: "poNo",
          factoryPO: "factoryPO",
          size: "size",
          qty1: "qty1",
        });
      }
      const canonicalRows = mapRowsToCanonical(rawRows, bulkHasHeader);
      const result = await api.bulkValidateEntries({
        productType: currentProduct,
        rows: canonicalRows,
      });
      setBulkResult(result);
      toast.success(`Checked ${result.summary.totalRows} rows`, {
        description: `${result.summary.validRows} valid · ${result.summary.warningRows} warnings · ${result.summary.errorRows} errors`,
      });
    } catch (e) {
      toast.error("Bulk validation failed", {
        description: e instanceof Error ? e.message : "",
      });
    } finally {
      setBulkValidating(false);
    }
  }

  // Filtered rows for the results table (by bucket).
  const filteredBulkRows = React.useMemo<any[]>(() => {
    if (!bulkResult?.rows) return [];
    if (bulkFilter === "all") return bulkResult.rows;
    return bulkResult.rows.filter((r: any) => r.statusBucket === bulkFilter);
  }, [bulkResult, bulkFilter]);

  // Open the import preview dialog (Confirm Import button).
  function handleBulkConfirmClick() {
    if (!bulkResult) return;
    if (bulkResult.summary.errorRows > 0) {
      toast.error("Cannot import — fix errors first", {
        description: `${bulkResult.summary.errorRows} row(s) have errors. Filter to ERROR to review.`,
      });
      return;
    }
    setShowBulkImportPreview(true);
  }

  // Actually perform the import (from the preview dialog).
  async function handleBulkImport() {
    if (!bulkResult) return;
    setShowBulkImportPreview(false);
    setBulkImporting(true);
    try {
      const importableRows = (bulkResult.rows as any[])
        .filter((r) => r.statusBucket === "valid" || r.statusBucket === "warning")
        .map((r) => ({
          shippingStatus: r.shippingStatus || "",
          poNo: r.poNo || "",
          factoryPO: r.factoryPO || "",
          size: r.size || "",
          qty1: Number(r.qty1Num ?? r.qty1) || 0,
          confirmReason: r.needsConfirm ? "bulk-import-warning" : undefined,
        }));
      if (importableRows.length === 0) {
        toast.error("No importable rows", { description: "Need at least one valid or warning row." });
        return;
      }
      const res = await api.bulkImportEntries({
        productType: currentProduct,
        rows: importableRows,
        mode: "all_valid",
        importedBy: "bulk-entry",
      });
      if (res.ok) {
        toast.success(`Imported ${res.imported} entries`, {
          description: res.skipped > 0 ? `${res.skipped} skipped` : "All rows written to DB.",
        });
        // Reset bulk panel + switch back to single mode.
        setBulkPastedText("");
        setBulkResult(null);
        setBulkMapping({});
        setBulkFilter("all");
        setBulkExpandedRow(null);
        setEntryMode("single");
        bumpRefresh();
        qc.invalidateQueries({ queryKey: ["data-entry-entries"] });
      } else {
        toast.error("Import failed", { description: res.errors?.join(", ") });
      }
    } catch (e) {
      toast.error("Import failed", { description: e instanceof Error ? e.message : "" });
    } finally {
      setBulkImporting(false);
    }
  }

  // Cancel: clear everything and return to single-entry mode.
  function handleBulkCancel() {
    setBulkPastedText("");
    setBulkResult(null);
    setBulkMapping({});
    setBulkFilter("all");
    setBulkExpandedRow(null);
    setEntryMode("single");
  }

  // "Fix Data": clears the result but keeps the pasted text so the user can
  // edit it and click Check Data again.
  function handleBulkFix() {
    setBulkResult(null);
    setBulkFilter("all");
    setBulkExpandedRow(null);
    toast.info("Edit the pasted data above, then click Check Data again.");
  }

  const shippingDisabled = !shippingStatus;
  const shippingColor = SHIPPING_OPTIONS.find((s) => s.value === shippingStatus)?.color;

  return (
    <div className="space-y-6">
      {/* Intro banner */}
      <Card className={cn("border-primary/20 bg-gradient-to-br", theme.gradient, "text-white")}>
        <CardContent className="flex flex-col gap-3 p-5 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-xl bg-white/20 backdrop-blur">
              <Wand2 className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold">Product Data Entry · {currentProduct}</h2>
              <p className="text-sm text-white/90">
                Select Shipping Status → PO NO# → Factory PO → Size → Qty → Enter to save instantly.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap items-center gap-1.5 bg-white/15 rounded-md px-2 py-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-white/80 mr-1">Keep:</span>
              <label className="flex items-center gap-1.5 text-xs font-medium cursor-pointer">
                <Switch checked={keepStatus} onCheckedChange={setKeepStatus} className="scale-[0.6] origin-left" />
                Status
              </label>
              <label className="flex items-center gap-1.5 text-xs font-medium cursor-pointer">
                <Switch checked={keepPoNo} onCheckedChange={setKeepPoNo} className="scale-[0.6] origin-left" />
                PO NO#
              </label>
              <label className="flex items-center gap-1.5 text-xs font-medium cursor-pointer">
                <Switch checked={keepFactoryPO} onCheckedChange={setKeepFactoryPO} className="scale-[0.6] origin-left" />
                Factory PO
              </label>
            </div>
            <Button variant="secondary" size="sm" onClick={() => resetForm({ keepStatus: false, keepPoNo: false, keepFactoryPO: false })} className="bg-white/20 hover:bg-white/30 text-white border-0">
              <RotateCcw className="mr-1.5 h-4 w-4" /> Reset
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── KEEP CONTEXT indicator (spec §7) ────────────────────────────────
          Shows the current carried-over context so the user always knows what
          will be reused on the next entry. Only visible when at least one
          keep-toggle is on AND its corresponding field is populated. */}
      {(keepStatus && shippingStatus) || (keepPoNo && poNo) || (keepFactoryPO && factoryPO) ? (
        <div className="flex items-center gap-2 rounded-md border border-emerald-300/60 bg-emerald-50 dark:bg-emerald-950/15 px-3 py-1.5 text-xs text-emerald-800 dark:text-emerald-300">
          <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
          <span className="font-semibold uppercase tracking-wide text-[10px]">Keep Context</span>
          <span className="text-emerald-700/80 dark:text-emerald-300/80">·</span>
          <span className="flex flex-wrap items-center gap-1.5">
            {keepStatus && shippingStatus && (
              <Badge variant="outline" className={cn("text-[9px]", shippingColor)}>
                {shippingStatus}
              </Badge>
            )}
            {keepPoNo && poNo && (
              <Badge variant="outline" className="text-[9px] font-mono">
                PO: {poNo}
              </Badge>
            )}
            {keepFactoryPO && factoryPO && (
              <Badge variant="outline" className="text-[9px] font-mono">
                FPO: {factoryPO}
              </Badge>
            )}
          </span>
        </div>
      ) : null}

      {/* Entry mode toggle: Single vs Bulk */}
      <div className="flex items-center justify-center">
        <Tabs value={entryMode} onValueChange={(v) => setEntryMode(v as "single" | "bulk" | "order" | "bulk-staging")}>
          <TabsList>
            <TabsTrigger value="single" className="px-4">
              <PenLine className="h-4 w-4 mr-1.5" /> Single Entry
            </TabsTrigger>
            <TabsTrigger value="bulk" className="px-4">
              <ClipboardPaste className="h-4 w-4 mr-1.5" /> Bulk Entry
            </TabsTrigger>
            <TabsTrigger value="bulk-staging" className="px-4">
              <ShieldCheck className="h-4 w-4 mr-1.5" /> Bulk Staging
            </TabsTrigger>
            <TabsTrigger value="order" className="px-4">
              <FileSpreadsheet className="h-4 w-4 mr-1.5" /> Order Entry
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {entryMode === "single" && (
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* Input form */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <PenLine className="h-4 w-4 text-primary" /> Input Fields
                {shippingStatus && (
                  <Badge className={cn("ml-auto text-[10px]", shippingColor)}>
                    {shippingStatus}
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Step 1: Shipping Status (MUST be first, spec §2) */}
              <div className="space-y-1.5">
                <Label className="flex items-center justify-between text-xs">
                  <span>Shipping Status <span className="text-destructive">*</span></span>
                  <span className="text-[10px] text-muted-foreground">Step 1 — select first</span>
                </Label>
                <Select value={shippingStatus} onValueChange={(v) => { setShippingStatus(v); setTimeout(() => focusAutocomplete(poNoRef.current), 50); }}>
                  <SelectTrigger className="h-11">
                    <SelectValue placeholder="Select Shipping Status…" />
                  </SelectTrigger>
                  <SelectContent>
                    {SHIPPING_OPTIONS.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        <span className="flex items-center gap-2">
                          <span className={cn("h-2 w-2 rounded-full", s.color.split(" ")[0])} />
                          {s.label}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!shippingStatus && (
                  <p className="text-xs text-amber-600 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" /> Please select Shipping Status first.
                  </p>
                )}
                {shippingStatus === "2.Output" && (
                  <p className="text-[11px] text-amber-600 flex items-center gap-1">
                    <Info className="h-3 w-3" /> Output will auto-create a paired Pending record (Q'ty 2 = -Qty).
                  </p>
                )}
                {shippingStatus === "3.Pending" && (
                  <p className="text-[11px] text-violet-600 flex items-center gap-1">
                    <Info className="h-3 w-3" /> Pending is normally auto-created from Output. Manual entry only for adjustments.
                  </p>
                )}
              </div>

              {/* Step 2: PO NO# (autocomplete, spec §3) */}
              <div className="space-y-1.5">
                <Label className="text-xs">PO NO# <span className="text-destructive">*</span></Label>
                <div ref={poNoRef} onKeyDown={(e) => handleEnter(e, "poNo")}>
                  <SmartAutocomplete
                    field="poNo"
                    value={poNo}
                    onChange={setPoNo}
                    onSelect={() => setTimeout(() => factoryPORef.current?.focus(), 100)}
                    placeholder={shippingDisabled ? "Select Shipping Status first" : "Type PO NO#…"}
                    disabled={shippingDisabled}
                    productType={currentProduct}
                  />
                </div>
                <p className="text-[10px] text-muted-foreground">Searches {currentProduct} Master Data. If not found, you can still continue.</p>
              </div>

              {/* Step 3: Factory PO (autocomplete, spec §4, §5) */}
              <div className="space-y-1.5">
                <Label className="flex items-center justify-between text-xs">
                  <span>Factory PO <span className="text-destructive">*</span></span>
                  <span className="flex items-center gap-2">
                    {factoryPO && !lookupLoading && lookupConfidence !== "NONE" && (
                      <ConfidenceBadge confidence={lookupConfidence} level={lookupLevel} />
                    )}
                    {lookupLoading && (
                      <span className="flex items-center gap-1 text-muted-foreground">
                        <Loader2 className="h-3 w-3 animate-spin" /> Looking up…
                      </span>
                    )}
                  </span>
                </Label>
                <div ref={factoryPORef} onKeyDown={(e) => handleEnter(e, "factoryPO")}>
                  <SmartAutocomplete
                    field="factoryPO"
                    value={factoryPO}
                    onChange={setFactoryPO}
                    onSelect={() => setTimeout(() => sizeRef.current?.focus(), 100)}
                    placeholder={shippingDisabled ? "Select Shipping Status first" : "Type 051, 228, MH27…"}
                    disabled={shippingDisabled}
                    productType={currentProduct}
                    poNo={poNo || undefined}
                  />
                </div>
                {factoryPO && !lookupLoading && autoFill === null && candidates.length === 0 && (
                  <p className="text-xs text-amber-600 flex items-center gap-1">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Factory PO not in Master Data — you can add it to Master Data from the list below after saving.
                  </p>
                )}
                {factoryPO && !lookupLoading && lookupLevel === 3 && poNo && (
                  <p className="text-xs text-amber-600 flex items-center gap-1">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    PO NO# doesn't match any row for this Factory PO — using Factory PO info only.
                  </p>
                )}
                {factoryPO && !lookupLoading && lookupLevel === 2 && (
                  <p className="text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-1">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Factory PO + PO NO# match — pick a Size from the filtered list below.
                  </p>
                )}
              </div>

              {/* Step 4: Size (filtered by Factory PO, spec §13 of prev prompt).
                  Size source priority:
                    1. availableSizes (Level 1/2/3 — sizes filtered by poNo when present)
                    2. autoFill?.sizes    (Level 3 fallback — all sizes for the Factory PO) */}
              <div className="space-y-1.5">
                <Label className="flex items-center justify-between text-xs">
                  <span>Size <span className="text-destructive">*</span></span>
                  {sizeOptions.length > 0 && (
                    <Badge variant="secondary" className="text-[10px]">
                      {sizeOptions.length} available
                      {availableSizes.length > 0 && poNo && (
                        <span className="ml-1 opacity-70">· for {poNo}</span>
                      )}
                    </Badge>
                  )}
                </Label>
                <SizeInput
                  ref={sizeRef}
                  value={size}
                  onChange={setSize}
                  sizes={sizeOptions}
                  disabled={shippingDisabled || !factoryPO}
                  placeholder={shippingDisabled ? "Select Shipping Status first" : !factoryPO ? "Enter Factory PO first" : "Type 13, 08…"}
                  onEnter={() => qtyRef.current?.focus()}
                />
                {sizeOptions.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-1">
                    {sizeOptions.slice(0, 8).map((s: string) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => { setSize(s); setTimeout(() => qtyRef.current?.focus(), 50); }}
                        className={cn(
                          "rounded-md border px-1.5 py-0.5 text-[10px] transition-colors hover:bg-accent",
                          normalizeSize(size) === normalizeSize(s)
                            ? "border-primary bg-primary/10 text-primary"
                            : "text-muted-foreground"
                        )}
                      >
                        {s}
                      </button>
                    ))}
                    {sizeOptions.length > 8 && (
                      <span className="text-[10px] text-muted-foreground self-center">+{sizeOptions.length - 8} more</span>
                    )}
                  </div>
                )}
                {/* Size-match status indicator (uses normalizeSize for comparison) */}
                {size && autoFill && !lookupLoading && (
                  <p className={cn(
                    "text-[11px] flex items-center gap-1",
                    sizeIsValid
                      ? "text-emerald-700 dark:text-emerald-300"
                      : "text-rose-600 dark:text-rose-400"
                  )}>
                    {sizeIsValid ? (
                      <><CheckCircle2 className="h-3 w-3" /> Size valid for this Factory PO.</>
                    ) : (
                      <><AlertCircle className="h-3 w-3" /> Size not in Master Data — verify before saving.</>
                    )}
                  </p>
                )}
              </div>

              {/* Step 5: Qty (spec §9).
                  Supports simple math expressions like "5+6+2+7+8" (Excel-like).
                  User types the expression → on blur or Enter, it's evaluated
                  and the field auto-fills with the result. */}
              <div className="space-y-1.5">
                <Label className="flex items-center justify-between text-xs">
                  <span>Qty <span className="text-destructive">*</span></span>
                  <span className="text-[10px] text-muted-foreground">
                    Supports math: 5+6+2+7+8 → 28
                  </span>
                </Label>
                <Input
                  ref={qtyRef}
                  value={qty}
                  onChange={(e) => {
                    // Allow digits, + - * / ( ) . and whitespace (for expressions).
                    const v = e.target.value;
                    setQty(v);
                  }}
                  onBlur={() => {
                    // On blur, evaluate the expression if it contains operators.
                    if (/[+\-*/]/.test(qty.replace(/^\s*-/, "").trim())) {
                      const { value, computed } = evaluateQtyExpression(qty);
                      if (computed) {
                        setQty(value);
                        toast.success(`Calculated: ${qty.trim()} = ${value}`);
                      }
                    }
                  }}
                  onKeyDown={(e) => {
                    // On Enter, evaluate expression first, then proceed with save.
                    if (e.key === "Enter") {
                      if (/[+\-*/]/.test(qty.replace(/^\s*-/, "").trim())) {
                        const { value, computed } = evaluateQtyExpression(qty);
                        if (computed) {
                          setQty(value);
                          toast.success(`Calculated: ${qty.trim()} = ${value}`);
                          // Don't proceed with save yet — let user see the result.
                          e.preventDefault();
                          return;
                        }
                      }
                    }
                    handleEnter(e, "qty");
                  }}
                  placeholder="e.g. 100 or 5+6+2+7+8"
                  className="h-11"
                  inputMode="text"
                  disabled={shippingDisabled}
                />
                {/* Expression preview — shows live result while typing */}
                {qty && /[+\-*/]/.test(qty.replace(/^\s*-/, "").trim()) && (
                  (() => {
                    const { value, computed } = evaluateQtyExpression(qty);
                    if (computed) {
                      return (
                        <p className="text-[11px] text-emerald-600 flex items-center gap-1">
                          <Calculator className="h-3 w-3" />
                          {qty.trim()} = <span className="font-mono font-bold">{value}</span>
                          <span className="text-muted-foreground ml-1">(press Enter or click outside to apply)</span>
                        </p>
                      );
                    }
                    return null;
                  })()
                )}
                {qty && !isNaN(Number(qty)) && !/[+\-*/]/.test(qty.replace(/^\s*-/, "").trim()) && (
                  <p className="text-[11px] text-muted-foreground">
                    Q'ty 1 = {qty} · Q'ty 2 ={" "}
                    <span className="font-mono font-medium text-foreground">
                      {computeQty2Preview(shippingStatus, qty)}
                    </span>
                  </p>
                )}
              </div>

              {validationErrors.length > 0 && (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2.5">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-destructive">
                    <AlertTriangle className="h-3.5 w-3.5" /> Validation
                  </div>
                  <ul className="mt-1 space-y-0.5 text-[11px] text-destructive/90">
                    {validationErrors.map((e, i) => (
                      <li key={i}>• {e}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <Button className="flex-1" disabled={!canAdd || saving} onClick={handleAddData}>
                  {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Plus className="mr-1.5 h-4 w-4" />}
                  Add Data
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Recent entries */}
          {recent.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Just Added</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {recent.map((e) => (
                  <div
                    key={e.id}
                    className="flex items-center justify-between rounded-md border bg-muted/30 px-2.5 py-1.5 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="font-medium truncate">{e.factoryPO} · {e.size}</div>
                      <div className="text-muted-foreground truncate">
                        <Badge variant="outline" className="text-[9px] mr-1">{e.shippingStatus}</Badge>
                        {e.model} · {e.season}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-mono">{e.qty1} / {e.qty2}</div>
                      <CheckCircle2 className="ml-auto h-3 w-3 text-emerald-500" />
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* ── SUGGESTION PANEL (spec §3) ──────────────────────────────────
              Shown when smart-lookup returns Level 4 candidates (the typed
              Factory PO didn't match exactly, but the suffix matched others).
              Each row is clickable: applying a candidate fills Factory PO +
              PO NO# and triggers a fresh lookup (which should resolve to
              Level 1-3). */}
          {candidates.length > 0 && (
            <Card className="border-rose-300/60 dark:border-rose-800/40">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Lightbulb className="h-4 w-4 text-rose-500" />
                  Did you mean…
                  <Badge variant="outline" className="ml-auto text-[10px]">
                    {candidates.length} similar Factory PO{candidates.length === 1 ? "" : "s"}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5">
                <p className="text-[11px] text-muted-foreground mb-1">
                  No exact match for <code className="font-mono bg-muted/60 px-1 rounded">{factoryPO}</code>.
                  Click a candidate to fill the form and re-lookup:
                </p>
                <div className="max-h-72 overflow-y-auto scroll-thin space-y-1.5">
                  {candidates.map((c) => (
                    <button
                      key={c.factoryPO}
                      type="button"
                      onClick={() => applyCandidate(c)}
                      className="w-full text-left rounded-md border border-rose-200 dark:border-rose-900/50 bg-rose-50/60 dark:bg-rose-950/15 hover:bg-rose-100 dark:hover:bg-rose-950/30 hover:border-rose-300 dark:hover:border-rose-800 transition-colors px-2.5 py-1.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono font-semibold text-sm text-rose-700 dark:text-rose-300 truncate">
                          {c.factoryPO}
                        </span>
                        {c.deadline && (
                          <Badge variant="outline" className="text-[9px] shrink-0">
                            {c.deadline}
                          </Badge>
                        )}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
                        {c.poNo && <span>PO: <strong className="text-foreground">{c.poNo}</strong></span>}
                        {c.model && <span>· {c.model}</span>}
                        {c.sku && <span>· SKU {c.sku}</span>}
                        {c.season && <span>· {c.season}</span>}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1">
                        {c.colorCode && <Badge variant="outline" className="text-[9px]">CC {c.colorCode}</Badge>}
                        {c.colorCode2 && <Badge variant="outline" className="text-[9px]">CC2 {c.colorCode2}</Badge>}
                        {c.painting && <Badge variant="outline" className="text-[9px]">Paint {c.painting}</Badge>}
                        {c.printingColor && <Badge variant="outline" className="text-[9px]">Print {c.printingColor}</Badge>}
                        {c.sizes?.length > 0 && (
                          <span className="text-[9px] text-muted-foreground">
                            {c.sizes.length} size{c.sizes.length === 1 ? "" : "s"}: {c.sizes.slice(0, 4).join(", ")}
                            {c.sizes.length > 4 && ` +${c.sizes.length - 4}`}
                          </span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Auto-generated data panel */}
        <div className="lg:col-span-3">
          <Card className="h-full">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Sparkles className="h-4 w-4 text-primary" /> Auto-Generated Data
                {autoFill && (
                  <Badge variant="outline" className="ml-auto text-[10px]">from Master Data</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!autoFill ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                    <Sparkles className="h-6 w-6" />
                  </div>
                  <p className="mt-3 text-sm font-medium">Auto-fill appears after Factory PO + Size</p>
                  <p className="mt-1 text-xs text-muted-foreground max-w-xs">
                    Shared attributes (MODEL, SKU, Season, colors, painting, printing, deadline) will appear here from Master Data lookup.
                  </p>
                </div>
              ) : (
                <AutoFillGrid group={autoFill} factoryPO={factoryPO} size={size} qty={qty} shippingStatus={shippingStatus} />
              )}
            </CardContent>
          </Card>
        </div>
      </div>
      )}

      {/* ===== Order Entry panel (Bulk Entry Order) ===== */}
      {entryMode === "order" && (
        <OrderEntryPanel
          currentProduct={currentProduct}
          theme={theme}
          onImported={() => { bumpRefresh(); qc.invalidateQueries({ queryKey: ["data-entry-entries"] }); }}
        />
      )}

      {/* ===== Bulk Entry panel (when in bulk mode) ===== */}
      {entryMode === "bulk" && (
        <BulkEntryPanel
          pastedText={bulkPastedText}
          setPastedText={setBulkPastedText}
          hasHeader={bulkHasHeader}
          setHasHeader={setBulkHasHeader}
          validating={bulkValidating}
          result={bulkResult}
          filter={bulkFilter}
          setFilter={setBulkFilter}
          filteredRows={filteredBulkRows}
          importing={bulkImporting}
          onCheck={handleBulkValidate}
          onConfirmClick={handleBulkConfirmClick}
          onCancel={handleBulkCancel}
          onFix={handleBulkFix}
          expandedRow={bulkExpandedRow}
          setExpandedRow={setBulkExpandedRow}
          mapping={bulkMapping}
          currentProduct={currentProduct}
          theme={theme}
        />
      )}

      {/* ===== Bulk Staging panel (staging service: parse → validate → review → confirm) ===== */}
      {entryMode === "bulk-staging" && (
        <BulkStagingPanel
          currentProduct={currentProduct}
          theme={theme}
          onImported={() => {
            bumpRefresh();
            qc.invalidateQueries({ queryKey: ["data-entry-entries"] });
          }}
        />
      )}

      {/* ===== Entries Table ===== */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2">
              <Table2 className="h-4 w-4 text-primary" /> Entries Data ({entryTotal})
              {entriesQ.isFetching && <Badge variant="secondary" className="text-[10px]">loading…</Badge>}
            </span>
            <span className="flex items-center gap-2">
              {selectedEntryIds.size > 0 && (
                <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={() => setBulkDeleteOpen(true)}>
                  <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete Selected ({selectedEntryIds.size})
                </Button>
              )}
              {selectedMasterIds.size > 0 && (
                <Button
                  size="sm"
                  className={cn("h-7 text-xs", theme.bg, "hover:opacity-90")}
                  disabled={addingToMaster}
                  onClick={() => addEntriesToMasterData("selected")}
                >
                  {addingToMaster ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Database className="h-3.5 w-3.5 mr-1" />}
                  Add Selected to Master Data ({selectedMasterIds.size})
                </Button>
              )}
              {entryRows.length > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  disabled={addingToMaster}
                  onClick={() => addEntriesToMasterData("all")}
                >
                  {addingToMaster ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Database className="h-3.5 w-3.5 mr-1" />}
                  Add All to Master Data
                </Button>
              )}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {entriesQ.isLoading ? (
            <div className="p-6 space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-8 w-full animate-pulse rounded bg-muted" />
              ))}
            </div>
          ) : entryRows.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              No entries yet for {currentProduct}. Add data using the form above.
            </div>
          ) : (
            <>
            <div className="overflow-x-auto scroll-thin">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 sticky top-0">
                  <tr>
                    <th className="px-2 py-2 w-8">
                      <Checkbox
                        checked={entryRows.length > 0 && selectedEntryIds.size === entryRows.length}
                        onCheckedChange={toggleAllEntries}
                      />
                    </th>
                    <th className="px-2 py-2 w-8" title="Select for Add to Master Data">
                      <Checkbox
                        checked={entryRows.length > 0 && selectedMasterIds.size === entryRows.length}
                        onCheckedChange={toggleAllMasterRows}
                      />
                    </th>
                    <th className="px-2 py-2 text-left text-[10px] font-semibold uppercase text-muted-foreground">Status</th>
                    <th className="px-2 py-2 text-left text-[10px] font-semibold uppercase text-muted-foreground">PO NO#</th>
                    <th className="px-2 py-2 text-left text-[10px] font-semibold uppercase text-muted-foreground">Factory PO</th>
                    <th className="px-2 py-2 text-left text-[10px] font-semibold uppercase text-muted-foreground">Model</th>
                    <th className="px-2 py-2 text-left text-[10px] font-semibold uppercase text-muted-foreground">Size</th>
                    <th className="px-2 py-2 text-right text-[10px] font-semibold uppercase text-muted-foreground">Qty1</th>
                    <th className="px-2 py-2 text-right text-[10px] font-semibold uppercase text-muted-foreground">Qty2</th>
                    <th className="px-2 py-2 text-left text-[10px] font-semibold uppercase text-muted-foreground">Season</th>
                    <th className="px-2 py-2 text-left text-[10px] font-semibold uppercase text-muted-foreground">Deadline</th>
                    <th className="px-2 py-2 text-right text-[10px] font-semibold uppercase text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {entryRows.map((r: any) => {
                    const isSelected = selectedEntryIds.has(r.id);
                    const isMasterSelected = selectedMasterIds.has(r.id);
                    return (
                      <tr key={r.id} className={cn("border-t hover:bg-muted/30", isSelected && "bg-primary/5", isMasterSelected && "bg-emerald-50 dark:bg-emerald-950/20")}>
                        <td className="px-2 py-1.5">
                          <Checkbox checked={isSelected} onCheckedChange={() => toggleEntry(r.id)} />
                        </td>
                        <td className="px-2 py-1.5">
                          <Checkbox checked={isMasterSelected} onCheckedChange={() => toggleMasterRow(r.id)} />
                        </td>
                        <td className="px-2 py-1.5">
                          <Badge variant="outline" className={cn("text-[9px]", shippingBadgeClass(r.shippingStatus))}>
                            {r.shippingStatus || "—"}
                          </Badge>
                        </td>
                        <td className="px-2 py-1.5 whitespace-nowrap">{r.poNo}</td>
                        <td className="px-2 py-1.5 font-medium text-primary whitespace-nowrap">{r.factoryPO}</td>
                        <td className="px-2 py-1.5 whitespace-nowrap">{r.model}</td>
                        <td className="px-2 py-1.5"><Badge variant="outline" className="text-[9px] font-mono">{r.size}</Badge></td>
                        <td className="px-2 py-1.5 text-right tabular-nums font-medium">{r.qty1}</td>
                        <td className={cn("px-2 py-1.5 text-right tabular-nums", Number(r.qty2) < 0 && "text-rose-600")}>{r.qty2}</td>
                        <td className="px-2 py-1.5"><Badge variant="secondary" className="text-[9px]">{r.season}</Badge></td>
                        <td className="px-2 py-1.5 whitespace-nowrap text-muted-foreground">{r.deadline || "—"}</td>
                        <td className="px-2 py-1.5">
                          <div className="flex justify-end gap-0.5">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditEntry(r)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => openDeleteEntry(r)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {/* Totals footer */}
                {selectedEntryIds.size > 0 && (
                  <tfoot className="bg-primary/5 border-t-2 border-primary/20">
                    <tr>
                      <td colSpan={7} className="px-2 py-2 text-right text-[11px] font-semibold uppercase text-muted-foreground">
                        <Calculator className="h-3 w-3 inline mr-1" />
                        Total ({totals.count} selected):
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums font-bold text-primary text-sm">{totals.qty1Sum}</td>
                      <td className={cn("px-2 py-2 text-right tabular-nums font-bold text-sm", totals.qty2Sum < 0 && "text-rose-600")}>{totals.qty2Sum}</td>
                      <td colSpan={4}></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            <div className="flex items-center justify-between border-t px-3 py-2">
              <span className="text-xs text-muted-foreground">
                Page {entryPage} of {entryTotalPages} ({entryTotal} total)
              </span>
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={entryPage <= 1}
                  onClick={() => setEntryPage((p) => Math.max(1, p - 1))}
                >
                  Prev
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={entryPage >= entryTotalPages}
                  onClick={() => setEntryPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
          )}
        </CardContent>
      </Card>

      {/* Edit entry dialog */}
      <Dialog open={!!editEntry} onOpenChange={(o) => !o && setEditEntry(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto scroll-thin">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-4 w-4 text-primary" /> Edit Entry
            </DialogTitle>
            <DialogDescription>Edit this entry. Master Data is not affected.</DialogDescription>
          </DialogHeader>
          {editEntry && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                {[
                  { f: "shippingStatus", l: "Shipping Status" },
                  { f: "poNo", l: "PO NO#" },
                  { f: "factoryPO", l: "Factory PO" },
                  { f: "size", l: "Size" },
                  { f: "qty1", l: "Q'ty 1" },
                  { f: "qty2", l: "Q'ty 2" },
                  { f: "model", l: "MODEL" },
                  { f: "sku", l: "SKU" },
                  { f: "season", l: "Season" },
                  { f: "colorCode", l: "Color Code" },
                  { f: "colorCode2", l: "COLOR CODE" },
                  { f: "deadline", l: "Dead Line" },
                ].map(({ f, l }) => (
                  <div key={f} className="space-y-1">
                    <label className="text-[10px] font-semibold uppercase text-muted-foreground">{l}</label>
                    <Input value={editData[f] ?? ""} onChange={(e) => setEditData((d) => ({ ...d, [f]: e.target.value }))} className="h-8 text-xs" />
                  </div>
                ))}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditEntry(null)}><X className="h-4 w-4 mr-1.5" /> Cancel</Button>
            <Button onClick={saveEditEntry} disabled={savingEdit}>
              {savingEdit ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Save className="h-4 w-4 mr-1.5" />} Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete entry dialog */}
      <AlertDialog open={!!deleteEntryRow && !deleteWarn} onOpenChange={(o) => { if (!o) setDeleteEntryRow(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-destructive" /> Delete Entry
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this entry?
              {deleteEntryRow && (
                <span className="mt-2 block text-xs font-mono bg-muted/40 rounded p-2">
                  {deleteEntryRow.shippingStatus} · {deleteEntryRow.factoryPO} · {deleteEntryRow.size} · Qty1={deleteEntryRow.qty1} Qty2={deleteEntryRow.qty2}
                </span>
              )}
              {deleteEntryRow?.transactionGroupId && (
                <span className="mt-2 block text-xs text-amber-600">
                  ⚠ Part of an Output+Pending transaction group. You will be asked to delete both.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); confirmDeleteEntry(); }} disabled={deleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleting ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Trash2 className="h-4 w-4 mr-1.5" />} Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete group warning */}
      <AlertDialog open={!!deleteWarn} onOpenChange={(o) => { if (!o) { setDeleteWarn(null); setDeleteEntryRow(null); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" /> Delete Both Records?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteWarn?.message}
              <span className="mt-2 block text-xs">This will delete both the Output and its paired Pending entry.</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); confirmDeleteEntryGroup(); }} disabled={deleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleting ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Trash2 className="h-4 w-4 mr-1.5" />} Delete Both
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk delete dialog */}
      <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" /> Delete {selectedEntryIds.size} Selected Entries?
            </AlertDialogTitle>
            <AlertDialogDescription>
              You are about to delete <strong>{selectedEntryIds.size}</strong> entry row(s).
              <span className="mt-2 block text-xs text-amber-600">
                ⚠ Entries belonging to an Output+Pending transaction group will have their paired record deleted too.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); confirmBulkDeleteEntries(); }} disabled={bulkDeleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {bulkDeleting ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Trash2 className="h-4 w-4 mr-1.5" />}
              Delete {selectedEntryIds.size} Entries
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ===== Bulk Import preview dialog ===== */}
      <Dialog open={showBulkImportPreview} onOpenChange={(o) => { if (!bulkImporting) setShowBulkImportPreview(o); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="h-4 w-4 text-emerald-600" /> Confirm Bulk Import
            </DialogTitle>
            <DialogDescription>
              Review the summary below. Valid + warning rows will be written to the database.
            </DialogDescription>
          </DialogHeader>
          {bulkResult && (
            <div className="space-y-2 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-md border bg-muted/30 p-2">
                  <div className="text-[10px] uppercase text-muted-foreground">Total checked</div>
                  <div className="text-lg font-semibold">{bulkResult.summary.totalRows}</div>
                </div>
                <div className="rounded-md border border-emerald-300/50 bg-emerald-50 dark:bg-emerald-950/20 p-2">
                  <div className="text-[10px] uppercase text-emerald-700 dark:text-emerald-300">Will import</div>
                  <div className="text-lg font-semibold text-emerald-700 dark:text-emerald-300">
                    {bulkResult.summary.validRows + bulkResult.summary.warningRows}
                  </div>
                </div>
              </div>
              <div className="rounded-md border border-rose-300/50 bg-rose-50 dark:bg-rose-950/20 p-2 text-rose-700 dark:text-rose-300 text-xs">
                <AlertCircle className="h-3.5 w-3.5 inline mr-1" />
                Skipped (errors): <strong>{bulkResult.summary.errorRows}</strong>
              </div>
              <div className="text-xs text-muted-foreground">
                <Database className="h-3 w-3 inline mr-1" />
                Product: <strong>{currentProduct}</strong> · Mode: <code className="rounded bg-muted px-1">all_valid</code>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBulkImportPreview(false)} disabled={bulkImporting}>
              <X className="h-4 w-4 mr-1.5" /> Cancel
            </Button>
            <Button onClick={handleBulkImport} disabled={bulkImporting} className="bg-emerald-600 hover:bg-emerald-700 text-white">
              {bulkImporting ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Upload className="h-4 w-4 mr-1.5" />}
              Confirm Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── PREVIEW-BEFORE-SAVE DIALOG (spec §4) ──────────────────────────
          Shown when the user clicks "Add Data" and validation passes.
          Lets them review entered + auto-filled data, the match confidence,
          and per-field validation status. Only [CONFIRM ENTRY] commits the
          row to the database; [EDIT] returns to the form (closes dialog,
          keeps the data); [CANCEL] is the same as [EDIT] in this UI (the
          form is still editable when the dialog is closed). */}
      <Dialog open={previewOpen} onOpenChange={(o) => { if (!saving) setPreviewOpen(o); }}>
        <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto scroll-thin">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="h-4 w-4 text-primary" /> Preview Before Save
              <ConfidenceBadge confidence={lookupConfidence} level={lookupLevel} className="ml-auto" />
            </DialogTitle>
            <DialogDescription>
              Review the entry. Master Data auto-fill is shown below. Click
              <strong> Confirm Entry </strong> to save, or <strong>Edit </strong>
              to return to the form.
            </DialogDescription>
          </DialogHeader>

          {/* Entered fields */}
          <div className="space-y-2">
            <div className="text-[10px] font-semibold uppercase text-muted-foreground">Entered</div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              <PreviewField label="Shipping Status" value={shippingStatus} ok={!!shippingStatus} />
              <PreviewField label="PO NO#" value={poNo} ok={!!poNo} mono />
              <PreviewField label="Factory PO" value={factoryPO} ok={lookupConfidence !== "NONE" && lookupConfidence !== "LOW"} mono />
              <PreviewField label="Size" value={size} ok={sizeIsValid || !autoFill} mono />
              <PreviewField label="Qty" value={qty} ok={!!qty && !isNaN(Number(qty)) && Number(qty) > 0} mono />
              <PreviewField
                label="Q'ty 2 (computed)"
                value={computeQty2Preview(shippingStatus, qty)}
                ok={!!qty && !isNaN(Number(qty))}
                mono
                muted
              />
            </div>
          </div>

          {/* Auto-filled fields (from Master Data) */}
          {autoFill ? (
            <div className="space-y-2">
              <div className="text-[10px] font-semibold uppercase text-muted-foreground flex items-center gap-1.5">
                <Sparkles className="h-3 w-3" /> Auto-Filled From Master Data
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                <PreviewField label="MODEL" value={autoFill.model} ok={!!autoFill.model} />
                <PreviewField label="SKU" value={autoFill.sku} ok={!!autoFill.sku} mono />
                <PreviewField label="Season" value={autoFill.season} ok={!!autoFill.season} />
                {/* ── Color Data Protection (spec §5) ────────────────────────
                    colorCode, colorCode2, painting, and printingColor are
                    SEPARATE columns in MasterData — they are NEVER derived
                    from each other. The AutoFillGrid component renders each
                    one as its own labeled cell, and the server's
                    rebuildMasterGroups() picks the single shared value per
                    Factory PO (or null if rows disagree). This preview
                    mirrors that exact separation: each color field shows
                    its own value or "—". */}
                <PreviewField label="Color Code" value={autoFill.colorCode} ok={!!autoFill.colorCode} mono />
                <PreviewField label="COLOR CODE" value={autoFill.colorCode2} ok={!!autoFill.colorCode2} mono />
                <PreviewField label="PAINTING" value={autoFill.painting} ok={!!autoFill.painting} mono />
                <PreviewField label="PRINTING COLOR" value={autoFill.printingColor} ok={!!autoFill.printingColor} mono />
                <PreviewField
                  label="Dead Line"
                  value={autoFill.nearestDeadline || autoFill.deadline}
                  ok={!!(autoFill.nearestDeadline || autoFill.deadline)}
                  mono
                />
                <PreviewField
                  label="Available Sizes"
                  value={sizeOptions.length > 0 ? `${sizeOptions.length} size(s): ${sizeOptions.slice(0, 5).join(", ")}${sizeOptions.length > 5 ? ` +${sizeOptions.length - 5}` : ""}` : ""}
                  ok={sizeOptions.length > 0}
                />
              </div>
            </div>
          ) : (
            <div className="rounded-md border border-amber-300/60 bg-amber-50 dark:bg-amber-950/15 p-2.5 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>
                <strong>No Master Data match.</strong> This entry will be
                saved without auto-filled attributes. You can add it to Master
                Data from the entries table after saving.
              </span>
            </div>
          )}

          {/* Validation status checklist */}
          <div className="rounded-md border bg-muted/30 p-2.5 space-y-1">
            <div className="text-[10px] font-semibold uppercase text-muted-foreground mb-1">
              Validation Status
            </div>
            <ValidationCheck ok={!!shippingStatus} label="Shipping Status selected" />
            <ValidationCheck ok={!!poNo} label="PO NO# entered" />
            <ValidationCheck
              ok={lookupConfidence === "HIGH" || lookupConfidence === "MEDIUM"}
              warn={lookupConfidence === "NONE"}
              label={
                lookupConfidence === "HIGH"
                  ? "Factory PO exact match (HIGH)"
                  : lookupConfidence === "MEDIUM"
                  ? `Factory PO found (Level ${lookupLevel} — MEDIUM)`
                  : lookupConfidence === "LOW"
                  ? "Factory PO NOT confirmed — pick from suggestions"
                  : "Factory PO not in Master Data"
              }
            />
            <ValidationCheck
              ok={sizeIsValid}
              warn={!!size && !sizeIsValid}
              label={
                sizeIsValid
                  ? "Size valid for Factory PO"
                  : size
                  ? "Size not in Master Data — will save anyway"
                  : "Size pending"
              }
            />
            <ValidationCheck
              ok={!!qty && !isNaN(Number(qty)) && Number(qty) > 0}
              label="Qty is a positive number"
            />
            {shippingStatus === "2.Output" && (
              <div className="pt-1 border-t mt-1 text-[11px] text-amber-700 dark:text-amber-300 flex items-center gap-1.5">
                <Info className="h-3 w-3" />
                Output will also auto-create a paired Pending record (Q'ty 2 = -Qty).
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setPreviewOpen(false)} disabled={saving}>
              <X className="h-4 w-4 mr-1.5" /> Cancel
            </Button>
            <Button variant="secondary" onClick={() => setPreviewOpen(false)} disabled={saving}>
              <Pencil className="h-4 w-4 mr-1.5" /> Edit
            </Button>
            <Button
              onClick={confirmEntryFromPreview}
              disabled={saving || lookupConfidence === "LOW"}
              className={cn(
                "bg-emerald-600 hover:bg-emerald-700 text-white",
                lookupConfidence === "LOW" && "opacity-50 cursor-not-allowed"
              )}
            >
              {saving ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Save className="h-4 w-4 mr-1.5" />}
              Confirm Entry
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Small preview-field cell for the Preview-Before-Save dialog.
// `ok` controls the leading check / cross / dash indicator.
function PreviewField({
  label,
  value,
  ok,
  mono,
  muted,
}: {
  label: string;
  value: string | null | undefined;
  ok?: boolean;
  mono?: boolean;
  muted?: boolean;
}) {
  const v = value ? String(value) : "";
  return (
    <div className="rounded-md border bg-background/60 p-2">
      <div className="text-[9px] font-semibold uppercase text-muted-foreground">{label}</div>
      <div className={cn(
        "mt-0.5 text-xs font-medium break-words",
        mono && "font-mono",
        muted && "text-muted-foreground",
        !v && "text-muted-foreground/50"
      )}>
        {v || "—"}
      </div>
      {ok !== undefined && (
        <div className="mt-1 flex items-center gap-1 text-[9px]">
          {ok ? (
            <><CheckCircle2 className="h-2.5 w-2.5 text-emerald-500" /><span className="text-emerald-700 dark:text-emerald-400">ok</span></>
          ) : (
            <><AlertCircle className="h-2.5 w-2.5 text-amber-500" /><span className="text-amber-700 dark:text-amber-400">pending</span></>
          )}
        </div>
      )}
    </div>
  );
}

// Validation checklist row for the Preview-Before-Save dialog.
function ValidationCheck({ ok, warn, label }: { ok: boolean; warn?: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      {ok ? (
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
      ) : warn ? (
        <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
      ) : (
        <AlertCircle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      )}
      <span className={cn(
        ok
          ? "text-foreground"
          : warn
          ? "text-amber-700 dark:text-amber-300"
          : "text-muted-foreground"
      )}>
        {label}
      </span>
    </div>
  );
}

// ── Qty expression evaluator ──────────────────────────────────────────────
// Lets the user type simple math expressions like "5+6+2+7+8" or "100-20"
// in the Qty field. The result is auto-computed (like Excel).
//
// Supported operators: + - * / and parentheses ( ).
// Safe eval: only digits, operators, whitespace, parens allowed.
// Returns the evaluated number (number) or the original input (string) if
// the expression is invalid or has no operators.
//
// Examples:
//   "5+6+2+7+8"   → 28
//   "100-20"      → 80
//   "10*5"        → 50
//   "100/4"       → 25
//   "(5+5)*2"     → 20
//   "28"          → 28 (no operators — plain number)
//   "5+"           → "5+" (incomplete — returns original)
function evaluateQtyExpression(input: string): { value: string; computed: boolean } {
  if (!input) return { value: "", computed: false };
  const trimmed = input.trim();

  // If already a plain number, return as-is (no need to compute).
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return { value: trimmed, computed: false };
  }

  // Validate: only digits, + - * / ( ) . and whitespace.
  if (!/^[\d+\-*/().\s]+$/.test(trimmed)) {
    return { value: input, computed: false };
  }

  // Must contain at least one operator (otherwise it's a plain number).
  if (!/[+\-*/]/.test(trimmed.replace(/^\s*-/, ""))) {
    return { value: input, computed: false };
  }

  try {
    // Safe evaluation using Function (only safe chars allowed at this point).
    const result = Function(`"use strict"; return (${trimmed})`)();
    if (typeof result === "number" && !isNaN(result) && isFinite(result)) {
      // Use integer if whole number, else keep decimals.
      const formatted = Number.isInteger(result) ? String(result) : String(result);
      return { value: formatted, computed: true };
    }
  } catch {
    // Invalid expression — return original input.
  }
  return { value: input, computed: false };
}

// Compute Q'ty 2 preview client-side (mirrors server logic).
function computeQty2Preview(shippingStatus: string, qty: string): string {
  const n = Number(qty);
  if (isNaN(n)) return "—";
  if (shippingStatus === "3.Pending") return String(-Math.abs(n));
  return String(n);
}

// Parse pasted Excel/TSV data into rows of { header: value } objects.
// If `hasHeader` is true, the first row is treated as headers and used as keys.
// Otherwise, columns are assumed to be in canonical order:
//   shippingStatus, poNo, factoryPO, size, qty1.
function parseBulkText(text: string, hasHeader: boolean): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return [];
  let headers: string[];
  let dataLines: string[];
  if (hasHeader) {
    headers = lines[0].split("\t").map((h) => h.trim());
    dataLines = lines.slice(1);
  } else {
    headers = ["shippingStatus", "poNo", "factoryPO", "size", "qty1"];
    dataLines = lines;
  }
  return dataLines.map((line) => {
    const cells = line.split("\t");
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = (cells[i] || "").trim();
    });
    return obj;
  });
}

// Convert raw header-keyed rows into canonical-keyed rows
// (shippingStatus, poNo, factoryPO, size, qty1) using buildAutoMapping.
function mapRowsToCanonical(rawRows: Record<string, string>[], hasHeader: boolean): Record<string, string>[] {
  if (!hasHeader) return rawRows; // already canonical keys
  if (rawRows.length === 0) return [];
  const headers = Object.keys(rawRows[0]);
  const mapping = buildAutoMapping(headers);
  return rawRows.map((r) => {
    const obj: Record<string, string> = {};
    for (const [origHeader, value] of Object.entries(r)) {
      const field = mapping[origHeader];
      if (field) obj[field] = value;
    }
    return {
      shippingStatus: obj.shippingStatus || "",
      poNo: obj.poNo || "",
      factoryPO: obj.factoryPO || "",
      size: obj.size || "",
      qty1: obj.qty1 || "",
    };
  });
}

// Bucket label/colors for the bulk results table.
const BULK_BUCKET_META: Record<string, { label: string; tint: string; badge: string; icon: typeof CheckCircle2 }> = {
  valid: {
    label: "Valid",
    tint: "bg-emerald-50/60 dark:bg-emerald-950/15",
    badge: "bg-emerald-100 text-emerald-700 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800",
    icon: CheckCircle2,
  },
  warning: {
    label: "Warning",
    tint: "bg-amber-50/60 dark:bg-amber-950/15",
    badge: "bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800",
    icon: AlertTriangle,
  },
  error: {
    label: "Error",
    tint: "bg-rose-50/60 dark:bg-rose-950/15",
    badge: "bg-rose-100 text-rose-700 border-rose-300 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800",
    icon: AlertCircle,
  },
  unknown: {
    label: "Pending",
    tint: "bg-muted/40",
    badge: "bg-muted text-muted-foreground",
    icon: Info,
  },
};

// Shipping status badge color helper.
function shippingBadgeClass(status: string | null | undefined): string {
  if (!status) return "";
  const s = status.toLowerCase();
  if (s.startsWith("1")) return "bg-slate-100 text-slate-700 dark:bg-slate-900/40 dark:text-slate-300";
  if (s.startsWith("2")) return "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300";
  if (s.startsWith("3")) return "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300";
  if (s.startsWith("4")) return "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300";
  return "";
}

// Size input with filtered suggestions.
const SizeInput = React.forwardRef<HTMLInputElement, {
  value: string;
  onChange: (v: string) => void;
  sizes: string[];
  disabled?: boolean;
  placeholder?: string;
  onEnter?: () => void;
}>(function SizeInput({ value, onChange, sizes, disabled, placeholder, onEnter }, ref) {
  const [open, setOpen] = React.useState(false);
  const wrapRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const filtered = React.useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return sizes;
    return sizes.filter((s) => s.toLowerCase().includes(q));
  }, [value, sizes]);

  return (
    <div ref={wrapRef} className="relative">
      <Input
        ref={ref}
        value={value}
        disabled={disabled}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (open && filtered.length > 0) {
              onChange(filtered[0]);
              setOpen(false);
            } else {
              onEnter?.();
            }
          }
        }}
        placeholder={placeholder}
        className="h-11"
      />
      {open && !disabled && filtered.length > 0 && (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-md border bg-popover shadow-lg">
          <ul className="max-h-56 overflow-y-auto scroll-thin py-1">
            {filtered.map((s) => (
              <li key={s}>
                <button
                  type="button"
                  onMouseEnter={() => {}}
                  onClick={() => { onChange(s); setOpen(false); onEnter?.(); }}
                  className={cn("flex w-full px-3 py-1.5 text-left text-sm hover:bg-accent", s === value && "bg-accent")}
                >
                  {s}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
});

// AutoFillGrid — renders the shared attributes pulled from MasterGroup.
//
// COLOR DATA PROTECTION (spec §5): colorCode, colorCode2, painting, and
// printingColor are SEPARATE columns in MasterData (see prisma/schema.prisma).
// They are NEVER derived from or overwritten by each other. The server's
// rebuildMasterGroups() picks the single shared value per Factory PO (or
// null if rows disagree) for each field independently. This component simply
// renders each field as its own labeled cell — no cross-field copying happens
// anywhere in the auto-fill pipeline.
function AutoFillGrid({ group, factoryPO, size, qty, shippingStatus }: { group: any; factoryPO: string; size: string; qty: string; shippingStatus: string }) {
  const rows: { label: string; value: string | null; field: string }[] = [
    { label: "MODEL", value: group.model, field: "model" },
    { label: "SKU", value: group.sku, field: "sku" },
    { label: "ITEM", value: group.item, field: "item" },
    { label: "Season", value: group.season, field: "season" },
    // Each of these 4 color fields is sourced from its own MasterData column:
    { label: "Color Code", value: group.colorCode, field: "colorCode" },
    { label: "COLOR CODE", value: group.colorCode2, field: "colorCode2" },
    { label: "PAINTING", value: group.painting, field: "painting" },
    { label: "PRINTING COLOR", value: group.printingColor, field: "printingColor" },
    { label: "Dead Line", value: group.nearestDeadline || group.deadline, field: "deadline" },
    { label: "Q'ty 1", value: qty, field: "qty1" },
    { label: "Q'ty 2", value: computeQty2Preview(shippingStatus, qty), field: "qty2" },
  ];
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {rows.map((r) => {
        const isInput = r.field === "qty1" || r.field === "qty2";
        return (
          <div key={r.label} className={cn("rounded-md border p-2.5", isInput ? "border-primary/30 bg-primary/5" : "bg-muted/30")}>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{r.label}</span>
              {isInput && <Badge variant="outline" className="text-[9px] py-0">computed</Badge>}
            </div>
            <div className={cn("mt-0.5 text-sm font-medium break-words", !r.value && "text-muted-foreground/50")}>
              {r.value || "—"}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ===== Bulk Entry panel =====
// Renders the paste area, validation summary, filter tabs, results table,
// grouped errors, and action bar. State lives in the parent so it can interact
// with the entries table query client + bumpRefresh on successful import.
type BulkEntryPanelProps = {
  pastedText: string;
  setPastedText: (v: string) => void;
  hasHeader: boolean;
  setHasHeader: (v: boolean) => void;
  validating: boolean;
  result: any;
  filter: "all" | "valid" | "warning" | "error";
  setFilter: (v: "all" | "valid" | "warning" | "error") => void;
  filteredRows: any[];
  importing: boolean;
  onCheck: () => void;
  onConfirmClick: () => void;
  onCancel: () => void;
  onFix: () => void;
  expandedRow: number | null;
  setExpandedRow: (n: number | null) => void;
  mapping: Record<string, string>;
  currentProduct: string;
  theme: { bg: string; text: string; border: string; gradient: string };
};

function BulkEntryPanel(props: BulkEntryPanelProps) {
  const {
    pastedText,
    setPastedText,
    hasHeader,
    setHasHeader,
    validating,
    result,
    filter,
    setFilter,
    filteredRows,
    importing,
    onCheck,
    onConfirmClick,
    onCancel,
    onFix,
    expandedRow,
    setExpandedRow,
    mapping,
    currentProduct,
    theme,
  } = props;

  const summary = result?.summary;
  const hasErrors = (summary?.errorRows ?? 0) > 0;
  const canImport = !!result && !hasErrors && !importing;

  return (
    <div className="space-y-4">
      {/* Paste area */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <ClipboardPaste className="h-4 w-4 text-primary" /> Paste Bulk Data
            <Badge variant="outline" className="ml-auto text-[10px]">{currentProduct}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">
              Paste rows from Excel <span className="text-muted-foreground">(tab-separated columns)</span>
            </Label>
            <Textarea
              value={pastedText}
              onChange={(e) => setPastedText(e.target.value)}
              placeholder={
                "Shipping Status\tPO NO#\tFactory PO\tSize\tQty\n" +
                "1.Order\tPO123\tMH271001\t13\t100\n" +
                "4.Input\tPO456\tMH271002\t08\t250"
              }
              className="min-h-[200px] font-mono text-sm"
              spellCheck={false}
            />
            <p className="text-[10px] text-muted-foreground">
              Columns: Shipping Status · PO NO# · Factory PO · Size · Qty. Order does not matter if header is on.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
              <Switch checked={hasHeader} onCheckedChange={setHasHeader} />
              First row is header
              <span className="text-muted-foreground">
                {hasHeader ? "(auto-detect columns)" : "(columns assumed in order)"}
              </span>
            </label>
            <Button onClick={onCheck} disabled={validating || !pastedText.trim()} className={cn(theme.bg, "hover:opacity-90")}>
              {validating ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <ClipboardCheck className="mr-1.5 h-4 w-4" />
              )}
              Check Data
            </Button>
          </div>
          {/* Show detected mapping */}
          {result && Object.keys(mapping).length > 0 && (
            <div className="rounded-md border bg-muted/30 p-2">
              <div className="text-[10px] font-semibold uppercase text-muted-foreground mb-1 flex items-center gap-1">
                <Eye className="h-3 w-3" /> Detected column mapping
              </div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(mapping).map(([orig, field]) => (
                  <Badge
                    key={orig}
                    variant="outline"
                    className={cn(
                      "text-[10px]",
                      field
                        ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-800"
                        : "border-rose-300 bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300 dark:border-rose-800"
                    )}
                  >
                    <span className="font-mono">{orig}</span>
                    <span className="mx-1 opacity-50">→</span>
                    {field || "(ignored)"}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {result && summary && (
        <>
          {/* Validation summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <SummaryCard
              icon={<Table2 className="h-4 w-4" />}
              label="Total Rows"
              value={summary.totalRows}
              tint="bg-muted/40"
            />
            <SummaryCard
              icon={<CheckCircle2 className="h-4 w-4 text-emerald-600" />}
              label="Valid"
              value={summary.validRows}
              tint="bg-emerald-50 dark:bg-emerald-950/20"
              valueClass="text-emerald-700 dark:text-emerald-300"
            />
            <SummaryCard
              icon={<AlertTriangle className="h-4 w-4 text-amber-600" />}
              label="Warnings"
              value={summary.warningRows}
              tint="bg-amber-50 dark:bg-amber-950/20"
              valueClass="text-amber-700 dark:text-amber-300"
            />
            <SummaryCard
              icon={<AlertCircle className="h-4 w-4 text-rose-600" />}
              label="Errors"
              value={summary.errorRows}
              tint="bg-rose-50 dark:bg-rose-950/20"
              valueClass="text-rose-700 dark:text-rose-300"
            />
          </div>

          {/* Secondary stats */}
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="outline" className="text-[10px]">
              <Database className="h-3 w-3 mr-1" />
              {summary.productGroupsAffected} product group(s) affected
            </Badge>
            {summary.duplicatePossible > 0 && (
              <Badge variant="outline" className="text-[10px] border-amber-300 text-amber-700 dark:text-amber-300">
                <AlertTriangle className="h-3 w-3 mr-1" />
                {summary.duplicatePossible} duplicate(s) possible
              </Badge>
            )}
            {summary.quantityErrors > 0 && (
              <Badge variant="outline" className="text-[10px] border-rose-300 text-rose-700 dark:text-rose-300">
                <AlertCircle className="h-3 w-3 mr-1" />
                {summary.quantityErrors} quantity error(s)
              </Badge>
            )}
            {summary.masterDataErrors > 0 && (
              <Badge variant="outline" className="text-[10px] border-amber-300 text-amber-700 dark:text-amber-300">
                <Database className="h-3 w-3 mr-1" />
                {summary.masterDataErrors} master data issue(s)
              </Badge>
            )}
            {summary.deadlineErrors > 0 && (
              <Badge variant="outline" className="text-[10px] border-amber-300 text-amber-700 dark:text-amber-300">
                <AlertCircle className="h-3 w-3 mr-1" />
                {summary.deadlineErrors} deadline issue(s)
              </Badge>
            )}
          </div>

          {/* Filter tabs */}
          <Tabs value={filter} onValueChange={(v) => setFilter(v as any)}>
            <TabsList>
              <TabsTrigger value="all" className="text-xs">
                All <span className="ml-1 rounded bg-muted-foreground/15 px-1.5 py-0.5 text-[10px]">{summary.totalRows}</span>
              </TabsTrigger>
              <TabsTrigger value="valid" className="text-xs">
                <CheckCircle2 className="h-3 w-3 mr-1 text-emerald-600" />
                Valid <span className="ml-1 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-700 dark:text-emerald-300">{summary.validRows}</span>
              </TabsTrigger>
              <TabsTrigger value="warning" className="text-xs">
                <AlertTriangle className="h-3 w-3 mr-1 text-amber-600" />
                Warning <span className="ml-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-300">{summary.warningRows}</span>
              </TabsTrigger>
              <TabsTrigger value="error" className="text-xs">
                <AlertCircle className="h-3 w-3 mr-1 text-rose-600" />
                Error <span className="ml-1 rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] text-rose-700 dark:text-rose-300">{summary.errorRows}</span>
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Results table */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Table2 className="h-4 w-4 text-primary" /> Validation Results
                <span className="ml-auto text-xs text-muted-foreground">
                  Showing {filteredRows.length} of {summary.totalRows}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="max-h-[500px] overflow-y-auto scroll-thin">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40 sticky top-0 z-10">
                    <tr>
                      <th className="px-2 py-2 w-10 text-left text-[10px] font-semibold uppercase text-muted-foreground">Row</th>
                      <th className="px-2 py-2 text-left text-[10px] font-semibold uppercase text-muted-foreground">Status</th>
                      <th className="px-2 py-2 text-left text-[10px] font-semibold uppercase text-muted-foreground">PO NO#</th>
                      <th className="px-2 py-2 text-left text-[10px] font-semibold uppercase text-muted-foreground">Factory PO</th>
                      <th className="px-2 py-2 text-left text-[10px] font-semibold uppercase text-muted-foreground">Size</th>
                      <th className="px-2 py-2 text-right text-[10px] font-semibold uppercase text-muted-foreground">Qty</th>
                      <th className="px-2 py-2 text-left text-[10px] font-semibold uppercase text-muted-foreground">Model</th>
                      <th className="px-2 py-2 text-left text-[10px] font-semibold uppercase text-muted-foreground">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-3 py-10 text-center text-muted-foreground">
                          No rows in this filter.
                        </td>
                      </tr>
                    ) : (
                      filteredRows.map((r: any) => {
                        const bucket = r.statusBucket || "unknown";
                        const meta = BULK_BUCKET_META[bucket] || BULK_BUCKET_META.unknown;
                        const Icon = meta.icon;
                        const isExpanded = expandedRow === r.rowNumber;
                        const hasErrs = (r.errors?.length ?? 0) > 0;
                        return (
                          <React.Fragment key={r.rowNumber ?? Math.random()}>
                            <tr
                              className={cn(
                                "border-t cursor-pointer transition-colors",
                                meta.tint,
                                hasErrs ? "hover:bg-muted/50" : "hover:bg-muted/30"
                              )}
                              onClick={() =>
                                setExpandedRow(isExpanded ? null : (r.rowNumber ?? null))
                              }
                            >
                              <td className="px-2 py-1.5 text-muted-foreground tabular-nums">{r.rowNumber}</td>
                              <td className="px-2 py-1.5">
                                <Badge variant="outline" className={cn("text-[9px]", shippingBadgeClass(r.shippingStatus))}>
                                  {r.shippingStatus || "—"}
                                </Badge>
                              </td>
                              <td className="px-2 py-1.5 whitespace-nowrap">{r.poNo || "—"}</td>
                              <td className="px-2 py-1.5 font-medium text-primary whitespace-nowrap">{r.factoryPO || "—"}</td>
                              <td className="px-2 py-1.5">
                                <Badge variant="outline" className="text-[9px] font-mono">{r.size || "—"}</Badge>
                              </td>
                              <td className="px-2 py-1.5 text-right tabular-nums font-medium">{r.qty1 ?? "—"}</td>
                              <td className="px-2 py-1.5 whitespace-nowrap text-muted-foreground">{r.model || "—"}</td>
                              <td className="px-2 py-1.5">
                                <Badge variant="outline" className={cn("text-[9px] gap-1", meta.badge)}>
                                  <Icon className="h-3 w-3" />
                                  {meta.label}
                                  {hasErrs && (
                                    <span className="ml-1 rounded bg-rose-500/20 px-1 text-[9px]">
                                      {r.errors.length}
                                    </span>
                                  )}
                                </Badge>
                              </td>
                            </tr>
                            {isExpanded && hasErrs && (
                              <tr className={cn("border-t", meta.tint)}>
                                <td colSpan={8} className="px-3 py-2">
                                  <div className="space-y-1.5">
                                    {r.errors.map((err: any, i: number) => (
                                      <div
                                        key={i}
                                        className={cn(
                                          "rounded-md border p-2 text-[11px]",
                                          err.severity === "error"
                                            ? "border-rose-300 bg-rose-50 text-rose-800 dark:bg-rose-950/30 dark:text-rose-200 dark:border-rose-800"
                                            : "border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-200 dark:border-amber-800"
                                        )}
                                      >
                                        <div className="flex items-start gap-1.5">
                                          {err.severity === "error" ? (
                                            <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                                          ) : (
                                            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                                          )}
                                          <div className="min-w-0 flex-1">
                                            <div className="font-semibold">{err.title}</div>
                                            {err.description && (
                                              <div className="text-[10px] mt-0.5 opacity-90">{err.description}</div>
                                            )}
                                            {err.excess != null && (
                                              <div className="text-[10px] mt-0.5 font-mono">
                                                Excess: <strong>{err.excess}</strong>
                                              </div>
                                            )}
                                            {err.duplicateRowNumbers?.length > 0 && (
                                              <div className="text-[10px] mt-0.5">
                                                Duplicate rows: {err.duplicateRowNumbers.join(", ")}
                                              </div>
                                            )}
                                            <div className="text-[9px] mt-0.5 opacity-70 font-mono">
                                              code: {err.code}
                                            </div>
                                          </div>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Grouped errors */}
          {result.groupedErrors && result.groupedErrors.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <AlertCircle className="h-4 w-4 text-rose-600" /> Grouped Issues
                  <Badge variant="outline" className="ml-auto text-[10px]">
                    {result.groupedErrors.length} group(s)
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {result.groupedErrors.map((g: any, i: number) => (
                  <div
                    key={i}
                    className="rounded-md border border-rose-300/50 bg-rose-50/50 dark:bg-rose-950/15 p-2.5"
                  >
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <Badge variant="outline" className="text-[10px] font-mono">
                        {g.poNo || "—"} · {g.factoryPO || "—"} · {g.size || "—"}
                      </Badge>
                      {g.rowNumbers?.length > 0 && (
                        <span className="text-muted-foreground">
                          Rows: <strong className="text-rose-700 dark:text-rose-300">{g.rowNumbers.join(", ")}</strong>
                        </span>
                      )}
                    </div>
                    <div className="mt-1.5 grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
                      {g.currentOrder != null && (
                        <StatBox label="Current Order" value={g.currentOrder} />
                      )}
                      {g.currentOutput != null && (
                        <StatBox label="Current Output" value={g.currentOutput} />
                      )}
                      {g.currentInput != null && (
                        <StatBox label="Current Input" value={g.currentInput} />
                      )}
                      {g.expectedQty != null && (
                        <StatBox label="Expected Qty" value={g.expectedQty} />
                      )}
                      {g.excess != null && (
                        <StatBox
                          label="Excess"
                          value={g.excess}
                          highlight="rose"
                        />
                      )}
                    </div>
                    {g.message && (
                      <p className="mt-1.5 text-[11px] text-rose-700 dark:text-rose-300">{g.message}</p>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Action bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/30 p-3">
            <Button variant="ghost" size="sm" onClick={onCancel} disabled={importing}>
              <X className="mr-1.5 h-4 w-4" /> Cancel
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={onFix} disabled={validating || importing}>
                <RefreshCw className="mr-1.5 h-4 w-4" /> Fix Data
              </Button>
              <Button
                size="sm"
                onClick={onConfirmClick}
                disabled={!canImport}
                className={cn("bg-emerald-600 hover:bg-emerald-700 text-white", !canImport && "opacity-50 cursor-not-allowed")}
              >
                {importing ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="mr-1.5 h-4 w-4" />
                )}
                Confirm Import
              </Button>
            </div>
          </div>

          {/* Helper note when errors block import */}
          {hasErrors && (
            <div className="rounded-md border border-rose-300/50 bg-rose-50 dark:bg-rose-950/20 p-2.5 text-xs text-rose-700 dark:text-rose-300 flex items-start gap-1.5">
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>
                <strong>{summary.errorRows} error row(s)</strong> must be fixed before import.
                Filter to ERROR above, expand rows to see details, edit your pasted data, then click Check Data again.
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Small summary card for the bulk validation overview.
function SummaryCard({
  icon,
  label,
  value,
  tint,
  valueClass,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tint: string;
  valueClass?: string;
}) {
  return (
    <div className={cn("rounded-lg border p-3", tint)}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase text-muted-foreground">{label}</span>
        {icon}
      </div>
      <div className={cn("mt-1 text-2xl font-bold tabular-nums", valueClass)}>{value}</div>
    </div>
  );
}

// Small stat box for grouped error details.
function StatBox({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number | string;
  highlight?: "rose" | "emerald" | "amber";
}) {
  const color =
    highlight === "rose"
      ? "text-rose-700 dark:text-rose-300"
      : highlight === "emerald"
      ? "text-emerald-700 dark:text-emerald-300"
      : highlight === "amber"
      ? "text-amber-700 dark:text-amber-300"
      : "text-foreground";
  return (
    <div className="rounded-md border bg-background/60 p-1.5">
      <div className="text-[9px] uppercase text-muted-foreground">{label}</div>
      <div className={cn("text-sm font-mono font-semibold tabular-nums", color)}>{value}</div>
    </div>
  );
}

// ============================================================================
// OrderEntryPanel — Bulk Entry Order (spec §4-14)
// Paste Excel data → auto-detect columns → validate → preview → confirm import
// Only accepts Shipping Status = 1.Order. Warns if other statuses detected.
// ============================================================================

interface OrderEntryPanelProps {
  currentProduct: string;
  theme: any;
  onImported: () => void;
}

function OrderEntryPanel({ currentProduct, theme, onImported }: OrderEntryPanelProps) {
  const [pastedText, setPastedText] = React.useState("");
  const [hasHeader, setHasHeader] = React.useState(true);
  const [parsing, setParsing] = React.useState(false);
  const [parsedRows, setParsedRows] = React.useState<Record<string, string>[]>([]);
  const [headers, setHeaders] = React.useState<string[]>([]);
  const [mapping, setMapping] = React.useState<Record<string, string>>({});
  const [validating, setValidating] = React.useState(false);
  const [validationResult, setValidationResult] = React.useState<any>(null);
  const [importing, setImporting] = React.useState(false);
  const [showPreview, setShowPreview] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Parse pasted TSV text into rows + auto-detect column mapping
  function handleParse() {
    const text = pastedText.trim();
    if (!text) { setError("Please paste some data first."); return; }
    setError(null);
    setParsing(true);
    setParsedRows([]);
    setValidationResult(null);
    try {
      const lines = text.split(/\r\n|\n|\r/).filter((l) => l.trim() !== "");
      if (lines.length < 2) { setError("Need at least a header row + 1 data row."); setParsing(false); return; }
      const rawHeaders = lines[0].split("\t").map((h) => h.trim());
      const detectedHeaders = rawHeaders.map((h, i) => h || `Column_${i + 1}`);
      const dataRows: Record<string, string>[] = [];
      for (let i = 1; i < lines.length; i++) {
        const cells = lines[i].split("\t");
        const row: Record<string, string> = {};
        detectedHeaders.forEach((h, idx) => { row[h] = (cells[idx] ?? "").trim(); });
        dataRows.push(row);
      }
      setHeaders(detectedHeaders);
      setParsedRows(dataRows);
      const autoMapping = buildAutoMapping(detectedHeaders);
      const initMapping: Record<string, string> = {};
      for (const h of detectedHeaders) { initMapping[h] = autoMapping[h] || ""; }
      setMapping(initMapping);

      // Check for non-Order shipping statuses
      const statusCol = detectedHeaders.find((h) => {
        const f = autoMapping[h];
        return f === "shippingStatus";
      });
      if (statusCol) {
        const nonOrderStatuses = new Set<string>();
        for (const row of dataRows) {
          const status = (row[statusCol] || "").trim().toLowerCase();
          if (status && !status.startsWith("1") && status !== "order") {
            nonOrderStatuses.add(row[statusCol]);
          }
        }
        if (nonOrderStatuses.size > 0) {
          setError(`⚠ This Bulk Entry is for Order Data only. Detected non-Order statuses: ${[...nonOrderStatuses].join(", ")}. Please use the Output/Input Entry tabs for those.`);
        }
      }
      toast.success(`Parsed ${dataRows.length} rows from pasted data (${detectedHeaders.length} columns detected).`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to parse pasted data");
    } finally {
      setParsing(false);
    }
  }

  // Build canonical rows from parsed rows using mapping
  function buildCanonicalRows(): Record<string, string>[] {
    return parsedRows.map((row) => {
      const out: Record<string, string> = {};
      for (const [excelHeader, field] of Object.entries(mapping)) {
        if (!field || field === "__skip__") continue;
        out[field] = row[excelHeader] ?? "";
      }
      // Force shippingStatus to "1.Order" if not set
      if (!out.shippingStatus) out.shippingStatus = "1.Order";
      return out;
    });
  }

  // Validate parsed rows
  async function handleValidate() {
    const canonicalRows = buildCanonicalRows();
    if (canonicalRows.length === 0) { setError("No rows to validate."); return; }
    setError(null);
    setValidating(true);
    setValidationResult(null);
    try {
      const result = await api.bulkValidateEntries({ productType: currentProduct, rows: canonicalRows });
      setValidationResult(result);
      toast.success(`Validated ${result.summary.totalRows} rows — ${result.summary.validRows} valid, ${result.summary.errorRows} errors`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Validation failed");
    } finally {
      setValidating(false);
    }
  }

  // Import confirmed rows
  async function handleImport() {
    if (!validationResult) return;
    setShowPreview(false);
    setImporting(true);
    try {
      const canonicalRows = buildCanonicalRows();
      const importableRows = (validationResult.rows as any[])
        .filter((r) => r.statusBucket === "valid" || r.statusBucket === "warning")
        .map((r, i) => ({
          shippingStatus: "1.Order",
          poNo: canonicalRows[i]?.poNo || r.poNo || "",
          factoryPO: canonicalRows[i]?.factoryPO || r.factoryPO || "",
          size: canonicalRows[i]?.size || r.size || "",
          qty1: Number(r.qty1Num ?? r.qty1) || 0,
          confirmReason: r.needsConfirm ? "bulk-order-entry-warning" : undefined,
        }));
      if (importableRows.length === 0) { toast.error("No importable rows"); return; }
      const res = await api.bulkImportEntries({ productType: currentProduct, rows: importableRows, mode: "all_valid", importedBy: "bulk-order-entry" });
      if (res.ok) {
        toast.success(`Imported ${res.imported} Order entries`, { description: `${res.skipped} skipped` });
        setPastedText(""); setParsedRows([]); setHeaders([]); setMapping({}); setValidationResult(null);
        onImported();
      } else {
        toast.error("Import failed", { description: res.errors?.join(", ") });
      }
    } catch (e) {
      toast.error("Import failed", { description: e instanceof Error ? e.message : "" });
    } finally {
      setImporting(false);
    }
  }

  // Also add to Master Data (spec §22)
  async function handleAddToMaster() {
    const canonicalRows = buildCanonicalRows();
    if (canonicalRows.length === 0) { toast.error("No rows to add"); return; }
    setImporting(true);
    try {
      const masterRows = canonicalRows.map((r) => ({
        productType: currentProduct,
        factoryPO: r.factoryPO || "",
        size: r.size || "",
        poNo: r.poNo || "",
        shippingStatus: r.shippingStatus || "1.Order",
        model: r.model || undefined,
        sku: r.sku || undefined,
        item: r.item || undefined,
        season: r.season || undefined,
        colorCode: r.colorCode || undefined,
        colorCode2: r.colorCode2 || undefined,
        painting: r.painting || undefined,
        printingColor: r.printingColor || undefined,
        deadline: r.deadline || undefined,
        qty1: r.qty1 || undefined,
        qty2: r.qty2 || undefined,
        date: r.date || undefined,
      }));
      const res = await api.bulkAddMasterRows(masterRows);
      toast.success(`${res.inserted} rows added to Master Data`, { description: `${res.productsAffected} product(s) index rebuilt` });
      onImported();
    } catch (e) {
      toast.error("Failed to add to Master Data", { description: e instanceof Error ? e.message : "" });
    } finally {
      setImporting(false);
    }
  }

  const options = React.useMemo(() => {
    return headers.map((h) => ({ value: h, label: h }));
  }, [headers]);

  const REQUIRED_FIELDS = ["poNo", "factoryPO", "size", "qty1"];
  const mappedFields = new Set(Object.values(mapping).filter((v) => v && v !== "__skip__"));
  const missingRequired = REQUIRED_FIELDS.filter((f) => !mappedFields.has(f));
  const canValidate = parsedRows.length > 0 && missingRequired.length === 0 && !error;
  const canImport = validationResult && validationResult.summary.errorRows === 0;

  return (
    <div className="space-y-4">
      {/* Info banner */}
      <Card className={cn("border-primary/20 bg-gradient-to-br", theme.gradient, "text-white")}>
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <FileSpreadsheet className="h-5 w-5 mt-0.5 shrink-0" />
            <div>
              <h3 className="text-sm font-semibold">Bulk Entry Order</h3>
              <p className="text-xs text-white/90 mt-0.5">
                Paste Order data (Shipping Status = 1.Order) from Excel. The system will auto-detect columns,
                validate, preview, and import. Non-Order statuses will be rejected.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Step 1: Paste area */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <ClipboardPaste className="h-4 w-4 text-primary" /> Step 1: Paste Excel Data
            {parsedRows.length > 0 && <Badge variant="outline" className="ml-1 text-[10px]">{parsedRows.length} rows parsed</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-medium">Paste tab-separated data from Excel (Ctrl+V)</Label>
            <div className="flex gap-2">
              <label className="flex items-center gap-1.5 text-xs">
                <Switch checked={hasHeader} onCheckedChange={setHasHeader} className="scale-[0.6] origin-left" />
                First row is header
              </label>
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => { setPastedText(""); setParsedRows([]); setHeaders([]); setMapping({}); setValidationResult(null); setError(null); }}>
                Clear
              </Button>
            </div>
          </div>
          <Textarea
            className="min-h-[180px] font-mono text-xs"
            placeholder={"Date\tShipping status\tMODEL\tSKU\tPO NO#\tFactory PO\tSize\tQ'ty 1\tDead Line\n27/08\t1.Order\tMAFATE5 MS\t1168723-GDNS\tH411351971\tMH26110909\tM4/W5T\t100\t05/09/2026\n27/08\t1.Order\tMAFATE5 MS\t1168723-GDNS\tH411351971\tMH26110909\tM5/W6T\t120\t05/09/2026"}
            value={pastedText}
            onChange={(e) => setPastedText(e.target.value)}
            disabled={parsing}
            spellCheck={false}
          />
          <Button className={cn("gap-1.5 text-white", theme.bg)} onClick={handleParse} disabled={parsing || !pastedText.trim()}>
            {parsing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
            {parsing ? "Parsing…" : "Parse Data"}
          </Button>
          {error && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription className="text-xs">{error}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Step 2: Column Mapping */}
      {parsedRows.length > 0 && headers.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Database className="h-4 w-4 text-primary" /> Step 2: Column Mapping
              {missingRequired.length > 0 ? (
                <Badge className="ml-1 text-[10px] bg-rose-100 text-rose-700 border-rose-200">Missing: {missingRequired.join(", ")}</Badge>
              ) : (
                <Badge className="ml-1 text-[10px] bg-emerald-100 text-emerald-700 border-emerald-200">All required mapped</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-[10px] text-muted-foreground">
                    <th className="px-2 py-1 text-left">Excel Column</th>
                    <th className="px-2 py-1 text-left">Sample Value</th>
                    <th className="px-2 py-1 text-center">→</th>
                    <th className="px-2 py-1 text-left">System Field</th>
                  </tr>
                </thead>
                <tbody>
                  {headers.map((h) => {
                    const mapped = mapping[h] || "";
                    const isRequired = REQUIRED_FIELDS.includes(mapped);
                    return (
                      <tr key={h} className="border-b last:border-b-0">
                        <td className="px-2 py-1 font-mono font-medium">{h}</td>
                        <td className="px-2 py-1 text-muted-foreground max-w-[200px] truncate" title={parsedRows[0]?.[h] ?? ""}>{parsedRows[0]?.[h] ?? "—"}</td>
                        <td className="px-2 py-1 text-center text-muted-foreground">→</td>
                        <td className="px-2 py-1">
                          <Select value={mapped || "__skip__"} onValueChange={(v) => setMapping((prev) => ({ ...prev, [h]: v === "__skip__" ? "" : v }))}>
                            <SelectTrigger className="h-7 w-40 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__skip__">— Skip —</SelectItem>
                              {["date", "shippingStatus", "model", "sku", "poNo", "factoryPO", "item", "season", "colorCode", "colorCode2", "painting", "printingColor", "size", "qty1", "qty2", "deadline"].map((f) => (
                                <SelectItem key={f} value={f}>
                                  {f}{REQUIRED_FIELDS.includes(f) ? " *" : ""}
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
            <p className="mt-2 text-[10px] text-muted-foreground">* = required field. Columns marked "Skip" will be ignored.</p>
          </CardContent>
        </Card>
      )}

      {/* Step 3: Validate + Preview */}
      {parsedRows.length > 0 && missingRequired.length === 0 && !error && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <ShieldCheck className="h-4 w-4 text-primary" /> Step 3: Validate & Import
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={handleValidate} disabled={validating}>
                {validating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                {validating ? "Validating…" : "Validate Data"}
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={handleAddToMaster} disabled={importing}>
                <Database className="h-3.5 w-3.5" /> Add to Master Data
              </Button>
              {validationResult && validationResult.summary.errorRows === 0 && (
                <Button className={cn("gap-1.5 text-xs ml-auto", theme.bg)} onClick={() => setShowPreview(true)}>
                  <Upload className="h-3.5 w-3.5" /> Confirm Import
                </Button>
              )}
            </div>

            {/* Validation result summary */}
            {validationResult && (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 text-xs">
                <div className="rounded border p-2 text-center">
                  <div className="text-muted-foreground">Total</div>
                  <div className="text-lg font-bold tabular-nums">{validationResult.summary.totalRows}</div>
                </div>
                <div className="rounded border p-2 text-center bg-emerald-50 dark:bg-emerald-950/30">
                  <div className="text-emerald-600">Valid</div>
                  <div className="text-lg font-bold tabular-nums text-emerald-600">{validationResult.summary.validRows}</div>
                </div>
                <div className="rounded border p-2 text-center bg-amber-50 dark:bg-amber-950/30">
                  <div className="text-amber-600">Warnings</div>
                  <div className="text-lg font-bold tabular-nums text-amber-600">{validationResult.summary.warningRows}</div>
                </div>
                <div className="rounded border p-2 text-center bg-rose-50 dark:bg-rose-950/30">
                  <div className="text-rose-600">Errors</div>
                  <div className="text-lg font-bold tabular-nums text-rose-600">{validationResult.summary.errorRows}</div>
                </div>
              </div>
            )}

            {/* Preview table */}
            {parsedRows.length > 0 && (
              <div className="max-h-[400px] overflow-y-auto scroll-thin rounded border">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted/95 backdrop-blur">
                    <tr className="border-b text-[10px] text-muted-foreground">
                      <th className="px-2 py-1 text-left">#</th>
                      {["Date", "Model", "PO NO#", "Factory PO", "Size", "Qty", "Deadline", "Status"].map((h) => (
                        <th key={h} className="px-2 py-1 text-left">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parsedRows.slice(0, 100).map((row, i) => {
                      const cr = buildCanonicalRows()[i];
                      const vr = validationResult?.rows?.[i];
                      return (
                        <tr key={i} className={cn("border-b last:border-b-0 hover:bg-muted/30",
                          vr?.statusBucket === "error" && "bg-rose-50 dark:bg-rose-950/15",
                          vr?.statusBucket === "warning" && "bg-amber-50 dark:bg-amber-950/15",
                        )}>
                          <td className="px-2 py-1 text-muted-foreground tabular-nums">{i + 1}</td>
                          <td className="px-2 py-1 tabular-nums">{cr?.date || "—"}</td>
                          <td className="px-2 py-1">{cr?.model || "—"}</td>
                          <td className="px-2 py-1 font-mono">{cr?.poNo || "—"}</td>
                          <td className="px-2 py-1 font-mono">{cr?.factoryPO || "—"}</td>
                          <td className="px-2 py-1 font-mono">{cr?.size || "—"}</td>
                          <td className="px-2 py-1 tabular-nums">{cr?.qty1 || "—"}</td>
                          <td className="px-2 py-1 tabular-nums">{cr?.deadline || "—"}</td>
                          <td className="px-2 py-1">
                            {vr ? (
                              <Badge variant="outline" className={cn("text-[9px]",
                                vr.statusBucket === "valid" && "border-emerald-300 text-emerald-600",
                                vr.statusBucket === "warning" && "border-amber-300 text-amber-600",
                                vr.statusBucket === "error" && "border-rose-300 text-rose-600",
                              )}>{vr.statusBucket}</Badge>
                            ) : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {parsedRows.length > 100 && (
              <p className="text-center text-xs text-muted-foreground">Showing first 100 of {parsedRows.length} rows</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Import Preview Dialog */}
      <Dialog open={showPreview} onOpenChange={setShowPreview}>
        <DialogHeader>
          <DialogTitle className="text-base">Import Preview — Bulk Order Entry</DialogTitle>
          <DialogDescription>Confirm to import these Order entries into the database.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 text-xs">
          {validationResult && (
            <>
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded border p-2 text-center">
                  <div className="text-muted-foreground">Total Rows</div>
                  <div className="text-lg font-bold">{validationResult.summary.totalRows}</div>
                </div>
                <div className="rounded border p-2 text-center bg-emerald-50 dark:bg-emerald-950/30">
                  <div className="text-emerald-600">Will Import</div>
                  <div className="text-lg font-bold text-emerald-600">{validationResult.summary.validRows + validationResult.summary.warningRows}</div>
                </div>
                <div className="rounded border p-2 text-center bg-rose-50 dark:bg-rose-950/30">
                  <div className="text-rose-600">Skipped (Errors)</div>
                  <div className="text-lg font-bold text-rose-600">{validationResult.summary.errorRows}</div>
                </div>
              </div>
              <p className="text-muted-foreground">Shipping Status will be set to "1.Order" for all imported rows.</p>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setShowPreview(false)}>Cancel</Button>
          <Button className={cn(theme.bg, "text-white")} onClick={handleImport} disabled={importing}>
            {importing ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Upload className="h-4 w-4 mr-1" />}
            {importing ? "Importing…" : "Confirm Import"}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// BULK STAGING PANEL — uses the staging service (parse → auto-fill → validate
// → review → confirm). Spec §1, §62.
// ────────────────────────────────────────────────────────────────────────────

interface BulkStagingPanelProps {
  currentProduct: string;
  theme: { bg: string; text: string; border: string; gradient: string };
  onImported: () => void;
}

const STAGING_STATUS_META: Record<
  string,
  { label: string; badge: string; card: string; dot: string }
> = {
  VALID: {
    label: "Valid",
    badge: "bg-emerald-100 text-emerald-700 border-emerald-200",
    card: "border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30",
    dot: "bg-emerald-500",
  },
  WARNING: {
    label: "Warning",
    badge: "bg-amber-100 text-amber-700 border-amber-200",
    card: "border-amber-200 bg-amber-50 dark:bg-amber-950/30",
    dot: "bg-amber-500",
  },
  ERROR: {
    label: "Error",
    badge: "bg-rose-100 text-rose-700 border-rose-200",
    card: "border-rose-200 bg-rose-50 dark:bg-rose-950/30",
    dot: "bg-rose-500",
  },
  REVIEWED: {
    label: "Reviewed",
    badge: "bg-blue-100 text-blue-700 border-blue-200",
    card: "border-blue-200 bg-blue-50 dark:bg-blue-950/30",
    dot: "bg-blue-500",
  },
  PENDING: {
    label: "Pending",
    badge: "bg-slate-100 text-slate-600 border-slate-200",
    card: "border-slate-200 bg-slate-50 dark:bg-slate-900/40",
    dot: "bg-slate-400",
  },
};

const STAGING_STATUS_FILTERS = [
  { value: "all", label: "All" },
  { value: "VALID", label: "Valid" },
  { value: "WARNING", label: "Warning" },
  { value: "ERROR", label: "Error" },
  { value: "REVIEWED", label: "Reviewed" },
  { value: "PENDING", label: "Pending" },
];

const STAGING_SAMPLE_TEXT =
  "2.Output\tH411040101\tMH25100234\tM(04)/W(05)\t10\t2026-10-04\n4.Input\tH411040101\tMH25100234\tM(04)/W(05)\t5\t2026-10-04";

function BulkStagingPanel({ currentProduct, theme, onImported }: BulkStagingPanelProps) {
  // ── Paste + create state ──────────────────────────────────────────────
  const [pastedText, setPastedText] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [batchDbId, setBatchDbId] = React.useState<string | null>(null);
  const [batchMeta, setBatchMeta] = React.useState<{
    batchId: string;
    totalRows: number;
  } | null>(null);

  // ── Validate state ────────────────────────────────────────────────────
  const [validating, setValidating] = React.useState(false);
  const [lastValidation, setLastValidation] = React.useState<any>(null);

  // ── Summary + rows state ───────────────────────────────────────────────
  const [summary, setSummary] = React.useState<any>(null);
  const [statusFilter, setStatusFilter] = React.useState<string>("all");
  const [page, setPage] = React.useState(1);
  const [pageSize] = React.useState(25);
  const [rowsData, setRowsData] = React.useState<any>({ rows: [], total: 0, totalPages: 1 });
  const [loadingRows, setLoadingRows] = React.useState(false);

  // ── Row detail dialog ─────────────────────────────────────────────────
  const [selectedRow, setSelectedRow] = React.useState<any>(null);
  const [editMode, setEditMode] = React.useState(false);
  const [editForm, setEditForm] = React.useState<Record<string, string>>({});
  const [savingEdit, setSavingEdit] = React.useState(false);
  const [acceptingWarning, setAcceptingWarning] = React.useState(false);
  const [acceptReason, setAcceptReason] = React.useState("");

  // ── Confirm dialog ─────────────────────────────────────────────────────
  const [showConfirm, setShowConfirm] = React.useState(false);
  const [confirmMode, setConfirmMode] = React.useState<"valid_only" | "valid_and_accepted">(
    "valid_only"
  );
  const [confirming, setConfirming] = React.useState(false);

  // ── History dialog ─────────────────────────────────────────────────────
  const [showHistory, setShowHistory] = React.useState(false);
  const [history, setHistory] = React.useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = React.useState(false);

  // ── "Use Existing Entries Data" dialog ──────────────────────────────────
  const [showFromEntries, setShowFromEntries] = React.useState(false);
  const [fromEntriesLoading, setFromEntriesLoading] = React.useState(false);
  const [fromEntriesFilters, setFromEntriesFilters] = React.useState({
    shippingStatus: "",
    dateFrom: "",
    dateTo: "",
    poNo: "",
    factoryPO: "",
    size: "",
    limit: "500",
  });

  const scrollRef = React.useRef<HTMLDivElement>(null);

  // Reset state when batch changes.
  function resetBatchState() {
    setBatchDbId(null);
    setBatchMeta(null);
    setLastValidation(null);
    setSummary(null);
    setRowsData({ rows: [], total: 0, totalPages: 1 });
    setStatusFilter("all");
    setPage(1);
    setSelectedRow(null);
    setShowConfirm(false);
    setEditMode(false);
  }

  // ── Create batch ──────────────────────────────────────────────────────
  async function handleCreate() {
    const text = pastedText.trim();
    if (!text) {
      toast.error("Please paste some rows first.");
      return;
    }
    if (!currentProduct) {
      toast.error("No product selected.");
      return;
    }
    setCreating(true);
    try {
      const result = await api.stagingCreate({
        productType: currentProduct,
        text,
        createdBy: "ui-user",
      });
      setBatchDbId(result.batchDbId);
      setBatchMeta({ batchId: result.batchId, totalRows: result.totalRows });
      toast.success(
        `Created batch ${result.batchId} with ${result.totalRows} rows.`
      );
      // Auto-load summary
      setTimeout(() => loadSummary(result.batchDbId), 50);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create batch");
    } finally {
      setCreating(false);
    }
  }

  // ── Create batch from existing EntryData ────────────────────────────────
  async function handleCreateFromEntries() {
    if (!currentProduct) {
      toast.error("No product selected.");
      return;
    }
    setFromEntriesLoading(true);
    resetBatchState();
    try {
      const filters: any = {};
      if (fromEntriesFilters.shippingStatus) filters.shippingStatus = fromEntriesFilters.shippingStatus;
      if (fromEntriesFilters.dateFrom) filters.dateFrom = fromEntriesFilters.dateFrom;
      if (fromEntriesFilters.dateTo) filters.dateTo = fromEntriesFilters.dateTo;
      if (fromEntriesFilters.poNo) filters.poNo = fromEntriesFilters.poNo;
      if (fromEntriesFilters.factoryPO) filters.factoryPO = fromEntriesFilters.factoryPO;
      if (fromEntriesFilters.size) filters.size = fromEntriesFilters.size;
      const limitNum = parseInt(fromEntriesFilters.limit, 10);
      if (!isNaN(limitNum) && limitNum > 0) filters.limit = limitNum;

      const result = await api.stagingCreateFromEntries({
        productType: currentProduct,
        createdBy: "ui-user",
        filters,
      });
      setBatchDbId(result.batchDbId);
      setBatchMeta({ batchId: result.batchId, totalRows: result.totalRows });
      toast.success(
        `Created batch ${result.batchId} from ${result.sourceCount} EntryData rows.`
      );
      setShowFromEntries(false);
      // Auto-load summary
      setTimeout(() => loadSummary(result.batchDbId), 50);
    } catch (e: any) {
      toast.error(e?.message || "Failed to create batch from entries");
    } finally {
      setFromEntriesLoading(false);
    }
  }

  // ── Validate ──────────────────────────────────────────────────────────
  async function handleValidate() {
    if (!batchDbId) return;
    setValidating(true);
    try {
      const result = await api.stagingValidate(batchDbId);
      setLastValidation(result);
      toast.success(
        `Validation run #${result.runNumber}: ${result.validRows} valid, ${result.warningRows} warning, ${result.errorRows} error, ${result.reviewedRows} reviewed.`
      );
      await Promise.all([loadSummary(batchDbId), loadRows()]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Validation failed");
    } finally {
      setValidating(false);
    }
  }

  // ── Load summary ───────────────────────────────────────────────────────
  async function loadSummary(id?: string) {
    const target = id ?? batchDbId;
    if (!target) return;
    try {
      const result = await api.stagingSummary(target);
      setSummary(result);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load summary");
    }
  }

  // ── Load rows (paginated, filtered) ───────────────────────────────────
  async function loadRows() {
    if (!batchDbId) return;
    setLoadingRows(true);
    try {
      const result = await api.stagingRows(batchDbId, {
        status: statusFilter === "all" ? undefined : statusFilter,
        page,
        pageSize,
      });
      setRowsData(result);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load rows");
    } finally {
      setLoadingRows(false);
    }
  }

  React.useEffect(() => {
    if (batchDbId) loadRows();
  }, [batchDbId, statusFilter, page, pageSize]);

  // ── Open row detail ───────────────────────────────────────────────────
  function openRow(row: any) {
    setSelectedRow(row);
    setEditMode(false);
    setAcceptReason(row.warningAcceptedReason ?? "");
    setEditForm({
      shippingStatus: row.shippingStatus ?? "",
      poNo: row.poNo ?? "",
      factoryPO: row.factoryPO ?? "",
      size: row.size ?? "",
      qty: String(row.qty ?? ""),
      date: row.date ?? "",
      deadline: row.deadline ?? "",
    });
  }

  // ── Save edit ─────────────────────────────────────────────────────────
  async function handleSaveEdit() {
    if (!batchDbId || !selectedRow) return;
    setSavingEdit(true);
    try {
      await api.stagingEditRow(batchDbId, selectedRow.id, {
        shippingStatus: editForm.shippingStatus,
        poNo: editForm.poNo,
        factoryPO: editForm.factoryPO,
        size: editForm.size,
        qty: editForm.qty,
        date: editForm.date,
        deadline: editForm.deadline,
        user: "ui-user",
      });
      toast.success("Row updated. Status reset to PENDING — re-validate to refresh.");
      setEditMode(false);
      await Promise.all([loadSummary(), loadRows()]);
      // Refresh the selected row from new data.
      const fresh = await api.stagingRows(batchDbId, {
        status: undefined,
        page: 1,
        pageSize: 200,
      });
      const found = fresh.rows.find((r: any) => r.id === selectedRow.id);
      if (found) setSelectedRow(found);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save edit");
    } finally {
      setSavingEdit(false);
    }
  }

  // ── Accept warning ─────────────────────────────────────────────────────
  async function handleAcceptWarning() {
    if (!batchDbId || !selectedRow) return;
    setAcceptingWarning(true);
    try {
      await api.stagingAcceptWarning(batchDbId, selectedRow.id, {
        reason: acceptReason,
        user: "ui-user",
      });
      toast.success("Warning accepted. Row marked as REVIEWED.");
      await Promise.all([loadSummary(), loadRows()]);
      // Refresh selected row
      const fresh = await api.stagingRows(batchDbId, {
        status: undefined,
        page: 1,
        pageSize: 200,
      });
      const found = fresh.rows.find((r: any) => r.id === selectedRow.id);
      if (found) setSelectedRow(found);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to accept warning");
    } finally {
      setAcceptingWarning(false);
    }
  }

  // ── Confirm import ────────────────────────────────────────────────────
  async function handleConfirm() {
    if (!batchDbId) return;
    setConfirming(true);
    try {
      const result = await api.stagingConfirm(batchDbId, {
        mode: confirmMode,
        user: "ui-user",
      });
      toast.success(
        `Imported ${result.imported} rows. ${result.remaining} remaining in staging.`
      );
      setShowConfirm(false);
      await Promise.all([loadSummary(), loadRows()]);
      onImported();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Confirm import failed");
    } finally {
      setConfirming(false);
    }
  }

  // ── History ────────────────────────────────────────────────────────────
  async function loadHistory() {
    setLoadingHistory(true);
    try {
      const result = await api.stagingList(currentProduct, 20);
      setHistory(result.batches);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load history");
    } finally {
      setLoadingHistory(false);
    }
  }

  async function loadBatchById(id: string) {
    setShowHistory(false);
    resetBatchState();
    setBatchDbId(id);
    try {
      const summaryResult = await api.stagingSummary(id);
      setBatchMeta({
        batchId: summaryResult.batch?.batchId ?? id,
        totalRows: summaryResult.batch?.totalRows ?? 0,
      });
      setSummary(summaryResult);
      setBatchDbId(id);
      setPage(1);
      setStatusFilter("all");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load batch");
    }
  }

  const counts = summary?.counts ?? {
    total: 0,
    valid: 0,
    warning: 0,
    error: 0,
    reviewed: 0,
    pending: 0,
  };
  const hasErrors = (counts.error ?? 0) > 0;

  return (
    <div ref={scrollRef} className="space-y-4">
      {/* ── Paste area ─────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <ClipboardPaste className="h-4 w-4 text-primary" /> 1. Paste Rows
            <Badge variant="outline" className="ml-auto text-[10px]">{currentProduct}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={pastedText}
            onChange={(e) => setPastedText(e.target.value)}
            rows={6}
            placeholder={
              "TSV format: status<TAB>po<TAB>factoryPO<TAB>size<TAB>qty<TAB>date\n" +
              "e.g.\n2.Output\tH411040101\tMH25100234\tM(04)/W(05)\t10\t2026-10-04\n4.Input\tH411040101\tMH25100234\tM(04)/W(05)\t5\t2026-10-04"
            }
            className="font-mono text-xs"
          />
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              onClick={handleCreate}
              disabled={creating || !pastedText.trim()}
              className={cn(theme.bg, "hover:opacity-90")}
            >
              {creating ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : (
                <ClipboardCheck className="h-4 w-4 mr-1.5" />
              )}
              {creating ? "Creating…" : "Parse & Create Batch"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPastedText(STAGING_SAMPLE_TEXT)}
            >
              Load Sample
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                resetBatchState();
                setPastedText("");
              }}
            >
              <RotateCcw className="h-3.5 w-3.5 mr-1" /> Reset
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setShowHistory(true);
                loadHistory();
              }}
            >
              <Database className="h-3.5 w-3.5 mr-1" /> History
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowFromEntries(true)}
              className="border-emerald-300 text-emerald-700 hover:bg-emerald-50"
            >
              <Database className="h-3.5 w-3.5 mr-1" /> Use Existing Entries Data
            </Button>
            <span className="text-[10px] text-muted-foreground ml-auto">
              Columns: status · po · factoryPO · size · qty · date [· deadline]
            </span>
          </div>
        </CardContent>
      </Card>

      {/* ── Batch info ──────────────────────────────────────────────────── */}
      {batchMeta && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Database className="h-4 w-4 text-primary" /> 2. Batch Info
              <Badge variant="secondary" className="ml-auto text-[10px]">
                {summary?.batch?.status ?? "staging"}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
              <div className="rounded border p-2">
                <div className="text-muted-foreground">Batch ID</div>
                <div className="font-mono font-semibold break-all">{batchMeta.batchId}</div>
              </div>
              <div className="rounded border p-2">
                <div className="text-muted-foreground">Total Rows</div>
                <div className="text-lg font-bold">{batchMeta.totalRows}</div>
              </div>
              <div className="rounded border p-2">
                <div className="text-muted-foreground">Validated</div>
                <div className="text-lg font-bold">
                  {lastValidation ? `Run #${lastValidation.runNumber}` : "—"}
                </div>
              </div>
              <div className="rounded border p-2">
                <div className="text-muted-foreground">Imported</div>
                <div className="text-lg font-bold">
                  {summary?.batch?.importedRows ?? 0} / {batchMeta.totalRows}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                onClick={handleValidate}
                disabled={validating}
                className={cn(theme.bg, "hover:opacity-90")}
              >
                {validating ? (
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                ) : (
                  <ShieldCheck className="h-4 w-4 mr-1.5" />
                )}
                {validating ? "Validating…" : "Validate Batch"}
              </Button>
              {lastValidation && (
                <Button
                  onClick={() => setShowConfirm(true)}
                  variant="outline"
                >
                  <Upload className="h-4 w-4 mr-1.5" /> Confirm Import
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => loadSummary()}>
                <RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh Summary
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Validation summary cards ────────────────────────────────────── */}
      {summary && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <ShieldCheck className="h-4 w-4 text-primary" /> 3. Validation Summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {[
                { key: "total", label: "Total", count: counts.total, meta: STAGING_STATUS_META.PENDING },
                { key: "valid", label: "Valid", count: counts.valid, meta: STAGING_STATUS_META.VALID },
                { key: "warning", label: "Warning", count: counts.warning, meta: STAGING_STATUS_META.WARNING },
                { key: "error", label: "Error", count: counts.error, meta: STAGING_STATUS_META.ERROR },
                { key: "reviewed", label: "Reviewed", count: counts.reviewed, meta: STAGING_STATUS_META.REVIEWED },
                { key: "pending", label: "Pending", count: counts.pending, meta: STAGING_STATUS_META.PENDING },
              ].map((card) => (
                <div
                  key={card.key}
                  className={cn(
                    "rounded-md border p-3 text-center",
                    card.meta.card
                  )}
                >
                  <div className="flex items-center justify-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                    <span className={cn("h-1.5 w-1.5 rounded-full", card.meta.dot)} />
                    {card.label}
                  </div>
                  <div className="text-2xl font-bold">{card.count ?? 0}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Rows table ─────────────────────────────────────────────────── */}
      {batchDbId && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Table2 className="h-4 w-4 text-primary" /> 4. Staging Rows
              <span className="ml-auto flex items-center gap-2">
                <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
                  <SelectTrigger className="h-8 w-32 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STAGING_STATUS_FILTERS.map((f) => (
                      <SelectItem key={f.value} value={f.value}>
                        {f.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {loadingRows ? (
              <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Loading rows…
              </div>
            ) : rowsData.rows.length === 0 ? (
              <div className="text-center py-6 text-sm text-muted-foreground">
                No rows match this filter.
              </div>
            ) : (
              <div className="overflow-x-auto rounded border">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40">
                      <TableHead className="w-10 text-xs">#</TableHead>
                      <TableHead className="text-xs">Status</TableHead>
                      <TableHead className="text-xs">Shipping</TableHead>
                      <TableHead className="text-xs">PO</TableHead>
                      <TableHead className="text-xs">Factory PO</TableHead>
                      <TableHead className="text-xs">Size</TableHead>
                      <TableHead className="text-xs text-right">Qty</TableHead>
                      <TableHead className="text-xs">Date</TableHead>
                      <TableHead className="text-xs text-center">Issues</TableHead>
                      <TableHead className="text-xs text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rowsData.rows.map((row: any) => {
                      const meta = STAGING_STATUS_META[row.validationStatus] ?? STAGING_STATUS_META.PENDING;
                      const issueCount = (row.validationErrors ?? []).length;
                      return (
                        <TableRow
                          key={row.id}
                          className="cursor-pointer hover:bg-muted/30"
                          onClick={() => openRow(row)}
                        >
                          <TableCell className="text-xs text-muted-foreground">{row.rowNumber}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={cn("text-[10px]", meta.badge)}>
                              {meta.label}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs">{row.shippingStatus || "—"}</TableCell>
                          <TableCell className="text-xs font-mono">{row.poNo || "—"}</TableCell>
                          <TableCell className="text-xs font-mono">{row.factoryPO || "—"}</TableCell>
                          <TableCell className="text-xs">{row.size || "—"}</TableCell>
                          <TableCell className="text-xs text-right tabular-nums">{row.qty}</TableCell>
                          <TableCell className="text-xs">{row.date || "—"}</TableCell>
                          <TableCell className="text-xs text-center">
                            {issueCount > 0 ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] text-amber-700">
                                <AlertTriangle className="h-3 w-3" /> {issueCount}
                              </span>
                            ) : row.validationStatus === "VALID" ? (
                              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 inline" />
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={(e) => {
                                e.stopPropagation();
                                openRow(row);
                              }}
                            >
                              <Eye className="h-3.5 w-3.5 mr-1" /> View
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}

            {/* Pagination */}
            {(rowsData.totalPages ?? 1) > 1 && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">
                  Page {rowsData.page} of {rowsData.totalPages} · {rowsData.total} rows
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    Prev
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page >= rowsData.totalPages}
                    onClick={() => setPage((p) => Math.min(rowsData.totalPages, p + 1))}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Row detail dialog ──────────────────────────────────────────── */}
      <Dialog open={!!selectedRow} onOpenChange={(o) => { if (!o) { setSelectedRow(null); setEditMode(false); } }}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              Row #{selectedRow?.rowNumber}
              {selectedRow && (
                <Badge
                  variant="outline"
                  className={cn(
                    "text-[10px]",
                    (STAGING_STATUS_META[selectedRow.validationStatus] ?? STAGING_STATUS_META.PENDING).badge
                  )}
                >
                  {(STAGING_STATUS_META[selectedRow.validationStatus] ?? STAGING_STATUS_META.PENDING).label}
                </Badge>
              )}
              {selectedRow?.warningAccepted && (
                <Badge className="text-[10px] bg-blue-100 text-blue-700 border-blue-200">
                  Warning Accepted
                </Badge>
              )}
            </DialogTitle>
            <DialogDescription className="text-xs">
              Review input data, matched order info, and validation issues.
            </DialogDescription>
          </DialogHeader>

          {selectedRow && (
            <div className="space-y-4">
              {/* Input data */}
              <div className="rounded border p-3 bg-muted/20">
                <div className="text-xs font-semibold mb-2 flex items-center gap-1">
                  <Info className="h-3.5 w-3.5" /> Input Data
                </div>
                {editMode ? (
                  <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
                    <div>
                      <Label className="text-[10px]">Shipping Status</Label>
                      <Input
                        className="h-8 text-xs"
                        value={editForm.shippingStatus}
                        onChange={(e) => setEditForm({ ...editForm, shippingStatus: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label className="text-[10px]">PO NO#</Label>
                      <Input
                        className="h-8 text-xs font-mono"
                        value={editForm.poNo}
                        onChange={(e) => setEditForm({ ...editForm, poNo: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label className="text-[10px]">Factory PO</Label>
                      <Input
                        className="h-8 text-xs font-mono"
                        value={editForm.factoryPO}
                        onChange={(e) => setEditForm({ ...editForm, factoryPO: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label className="text-[10px]">Size</Label>
                      <Input
                        className="h-8 text-xs"
                        value={editForm.size}
                        onChange={(e) => setEditForm({ ...editForm, size: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label className="text-[10px]">Qty</Label>
                      <Input
                        className="h-8 text-xs"
                        type="number"
                        value={editForm.qty}
                        onChange={(e) => setEditForm({ ...editForm, qty: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label className="text-[10px]">Date</Label>
                      <Input
                        className="h-8 text-xs"
                        value={editForm.date}
                        onChange={(e) => setEditForm({ ...editForm, date: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label className="text-[10px]">Deadline</Label>
                      <Input
                        className="h-8 text-xs"
                        value={editForm.deadline}
                        onChange={(e) => setEditForm({ ...editForm, deadline: e.target.value })}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                    {[
                      ["Shipping", selectedRow.shippingStatus],
                      ["PO NO#", selectedRow.poNo],
                      ["Factory PO", selectedRow.factoryPO],
                      ["Size", selectedRow.size],
                      ["Qty", String(selectedRow.qty ?? "")],
                      ["Date", selectedRow.date],
                      ["Deadline", selectedRow.deadline],
                      ["Source", selectedRow.autoFillSource || "—"],
                    ].map(([label, val]) => (
                      <div key={label}>
                        <div className="text-[10px] text-muted-foreground">{label}</div>
                        <div className="font-mono text-xs break-all">{val || "—"}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Matched order info */}
              {selectedRow.matchedOrderKey && (
                <div className="rounded border p-3 bg-emerald-50 dark:bg-emerald-950/30">
                  <div className="text-xs font-semibold mb-2 flex items-center gap-1 text-emerald-700">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Matched Order
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                    {[
                      ["Model", selectedRow.model],
                      ["SKU", selectedRow.sku],
                      ["Item", selectedRow.item],
                      ["Season", selectedRow.season],
                      ["Color Code", selectedRow.colorCode],
                      ["Color Code 2", selectedRow.colorCode2],
                      ["Painting", selectedRow.painting],
                      ["Printing Color", selectedRow.printingColor],
                    ].map(([label, val]) => (
                      <div key={label}>
                        <div className="text-[10px] text-muted-foreground">{label}</div>
                        <div className="text-xs">{val || "—"}</div>
                      </div>
                    ))}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-2">
                    Source: <span className="font-mono">{selectedRow.autoFillSource}</span>
                    {" · "}Key: <span className="font-mono">{selectedRow.matchedOrderKey}</span>
                  </div>
                </div>
              )}

              {/* Validation issues */}
              <div className="rounded border p-3">
                <div className="text-xs font-semibold mb-2 flex items-center gap-1">
                  <AlertTriangle className="h-3.5 w-3.5" /> Validation Issues
                  <Badge variant="secondary" className="ml-auto text-[10px]">
                    {(selectedRow.validationErrors ?? []).length} found
                  </Badge>
                </div>
                {(selectedRow.validationErrors ?? []).length === 0 ? (
                  <p className="text-xs text-muted-foreground">No issues — row is clean.</p>
                ) : (
                  <div className="space-y-2">
                    {(selectedRow.validationErrors ?? []).map((iss: any, i: number) => (
                      <div
                        key={i}
                        className={cn(
                          "rounded border p-2 text-xs",
                          iss.severity === "ERROR"
                            ? "border-rose-200 bg-rose-50 dark:bg-rose-950/30"
                            : iss.severity === "WARNING"
                            ? "border-amber-200 bg-amber-50 dark:bg-amber-950/30"
                            : "border-slate-200 bg-slate-50 dark:bg-slate-900/40"
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-[10px]",
                              iss.severity === "ERROR"
                                ? "border-rose-300 text-rose-700"
                                : iss.severity === "WARNING"
                                ? "border-amber-300 text-amber-700"
                                : "border-slate-300 text-slate-600"
                            )}
                          >
                            {iss.severity}
                          </Badge>
                          <span className="text-[10px] font-mono text-muted-foreground">{iss.category}</span>
                          <span className="text-[10px] font-mono text-muted-foreground">{iss.code}</span>
                        </div>
                        <p className="mt-1 text-xs">{iss.message}</p>
                        {iss.detail && (
                          <pre className="mt-1 whitespace-pre-wrap rounded bg-background/60 p-2 text-[10px] font-mono">
                            {iss.detail}
                          </pre>
                        )}
                        {iss.recommendedAction && (
                          <p className="mt-1 text-[10px] text-emerald-700 flex items-start gap-1">
                            <Lightbulb className="h-3 w-3 mt-0.5" /> {iss.recommendedAction}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Accept warning form */}
              {selectedRow.validationStatus === "WARNING" && (
                <div className="rounded border border-blue-200 bg-blue-50 dark:bg-blue-950/30 p-3">
                  <div className="text-xs font-semibold mb-2 flex items-center gap-1 text-blue-700">
                    <ShieldCheck className="h-3.5 w-3.5" /> Accept Warning
                  </div>
                  <Label className="text-[10px]">Reason (optional)</Label>
                  <Textarea
                    rows={2}
                    className="text-xs"
                    placeholder="Why is this warning acceptable?"
                    value={acceptReason}
                    onChange={(e) => setAcceptReason(e.target.value)}
                  />
                </div>
              )}
            </div>
          )}

          <DialogFooter className="flex gap-2 sm:justify-between">
            <div className="flex gap-2">
              {editMode ? (
                <>
                  <Button
                    size="sm"
                    onClick={handleSaveEdit}
                    disabled={savingEdit}
                    className={cn(theme.bg, "hover:opacity-90")}
                  >
                    {savingEdit ? (
                      <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                    ) : (
                      <Save className="h-3.5 w-3.5 mr-1" />
                    )}
                    Save
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setEditMode(false)}>
                    Cancel
                  </Button>
                </>
              ) : (
                <Button size="sm" variant="outline" onClick={() => setEditMode(true)}>
                  <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
                </Button>
              )}
              {selectedRow?.validationStatus === "WARNING" && (
                <Button
                  size="sm"
                  onClick={handleAcceptWarning}
                  disabled={acceptingWarning}
                  className="bg-blue-600 text-white hover:bg-blue-700"
                >
                  {acceptingWarning ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                  ) : (
                    <ShieldCheck className="h-3.5 w-3.5 mr-1" />
                  )}
                  Accept Warning
                </Button>
              )}
            </div>
            <Button size="sm" variant="ghost" onClick={() => { setSelectedRow(null); setEditMode(false); }}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Confirm Import dialog ──────────────────────────────────────── */}
      <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Upload className="h-4 w-4 text-primary" /> Confirm Import
            </DialogTitle>
            <DialogDescription className="text-xs">
              Import validated rows into EntryData. Errors must be fixed first.
            </DialogDescription>
          </DialogHeader>

          {summary && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div className="rounded border p-2 bg-emerald-50 dark:bg-emerald-950/30">
                  <div className="text-emerald-700">Valid</div>
                  <div className="text-lg font-bold">{counts.valid}</div>
                </div>
                <div className="rounded border p-2 bg-blue-50 dark:bg-blue-950/30">
                  <div className="text-blue-700">Reviewed</div>
                  <div className="text-lg font-bold">{counts.reviewed}</div>
                </div>
                <div className="rounded border p-2 bg-rose-50 dark:bg-rose-950/30">
                  <div className="text-rose-700">Errors</div>
                  <div className="text-lg font-bold">{counts.error}</div>
                </div>
              </div>

              {hasErrors && (
                <Alert variant="destructive" className="text-xs">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    {counts.error} row(s) have errors and will be skipped. Fix them or accept the warnings and re-validate to clear them.
                  </AlertDescription>
                </Alert>
              )}

              <div className="space-y-2">
                <Label className="text-xs">Import Mode</Label>
                <Select
                  value={confirmMode}
                  onValueChange={(v) => setConfirmMode(v as "valid_only" | "valid_and_accepted")}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="valid_only">
                      Valid only (skip warnings &amp; reviewed)
                    </SelectItem>
                    <SelectItem value="valid_and_accepted">
                      Valid + accepted warnings (valid + reviewed)
                    </SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground">
                  {confirmMode === "valid_only"
                    ? `Will import ${counts.valid} VALID row(s). Warnings/errors stay in staging.`
                    : `Will import ${counts.valid + counts.reviewed} row(s) (VALID + REVIEWED). Warnings/errors stay in staging.`}
                </p>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfirm(false)}>Cancel</Button>
            <Button
              onClick={handleConfirm}
              disabled={confirming}
              className={cn(theme.bg, "hover:opacity-90")}
            >
              {confirming ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Upload className="h-4 w-4 mr-1" />}
              {confirming ? "Importing…" : "Confirm Import"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── History dialog ──────────────────────────────────────────────── */}
      <Dialog open={showHistory} onOpenChange={setShowHistory}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Database className="h-4 w-4 text-primary" /> Recent Batches
              <Badge variant="outline" className="text-[10px]">{currentProduct}</Badge>
            </DialogTitle>
            <DialogDescription className="text-xs">
              Click a batch to load it for review.
            </DialogDescription>
          </DialogHeader>
          {loadingHistory ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading…
            </div>
          ) : history.length === 0 ? (
            <div className="text-center py-6 text-xs text-muted-foreground">
              No batches found.
            </div>
          ) : (
            <div className="overflow-x-auto rounded border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead className="text-xs">Batch ID</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                    <TableHead className="text-xs text-right">Total</TableHead>
                    <TableHead className="text-xs text-right">Valid</TableHead>
                    <TableHead className="text-xs text-right">Warn</TableHead>
                    <TableHead className="text-xs text-right">Err</TableHead>
                    <TableHead className="text-xs text-right">Imported</TableHead>
                    <TableHead className="text-xs">Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.map((b) => (
                    <TableRow
                      key={b.id}
                      className="cursor-pointer hover:bg-muted/30"
                      onClick={() => loadBatchById(b.id)}
                    >
                      <TableCell className="text-xs font-mono">{b.batchId}</TableCell>
                      <TableCell className="text-xs">
                        <Badge variant="secondary" className="text-[10px]">{b.status}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-right tabular-nums">{b.totalRows}</TableCell>
                      <TableCell className="text-xs text-right tabular-nums text-emerald-700">{b.validRows}</TableCell>
                      <TableCell className="text-xs text-right tabular-nums text-amber-700">{b.warningRows}</TableCell>
                      <TableCell className="text-xs text-right tabular-nums text-rose-700">{b.errorRows}</TableCell>
                      <TableCell className="text-xs text-right tabular-nums">{b.importedRows}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(b.createdAt).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowHistory(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── "Use Existing Entries Data" dialog ─────────────────────────── */}
      <Dialog open={showFromEntries} onOpenChange={setShowFromEntries}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Database className="h-4 w-4" /> Create Batch from Existing Entries Data
            </DialogTitle>
            <DialogDescription>
              Load EntryData rows into a staging batch (no copy-paste needed).
              Filters are optional — leave blank to load all rows for{" "}
              <b>{currentProduct}</b>.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-xs">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-[10px]">Shipping Status</Label>
                <Select
                  value={fromEntriesFilters.shippingStatus || "__all__"}
                  onValueChange={(v) =>
                    setFromEntriesFilters((f) => ({ ...f, shippingStatus: v === "__all__" ? "" : v }))
                  }
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="All status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All status</SelectItem>
                    <SelectItem value="1.Order">1.Order</SelectItem>
                    <SelectItem value="2.Output">2.Output</SelectItem>
                    <SelectItem value="3.Pending">3.Pending</SelectItem>
                    <SelectItem value="4.Input">4.Input</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">Limit (max 5000)</Label>
                <Input
                  type="number"
                  value={fromEntriesFilters.limit}
                  onChange={(e) => setFromEntriesFilters((f) => ({ ...f, limit: e.target.value }))}
                  className="h-8 text-xs"
                  min={1}
                  max={5000}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-[10px]">Date From</Label>
                <Input
                  type="date"
                  value={fromEntriesFilters.dateFrom}
                  onChange={(e) => setFromEntriesFilters((f) => ({ ...f, dateFrom: e.target.value }))}
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">Date To</Label>
                <Input
                  type="date"
                  value={fromEntriesFilters.dateTo}
                  onChange={(e) => setFromEntriesFilters((f) => ({ ...f, dateTo: e.target.value }))}
                  className="h-8 text-xs"
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label className="text-[10px]">PO NO#</Label>
                <Input
                  value={fromEntriesFilters.poNo}
                  onChange={(e) => setFromEntriesFilters((f) => ({ ...f, poNo: e.target.value }))}
                  className="h-8 text-xs"
                  placeholder="contains…"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">Factory PO</Label>
                <Input
                  value={fromEntriesFilters.factoryPO}
                  onChange={(e) => setFromEntriesFilters((f) => ({ ...f, factoryPO: e.target.value }))}
                  className="h-8 text-xs"
                  placeholder="contains…"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">Size</Label>
                <Input
                  value={fromEntriesFilters.size}
                  onChange={(e) => setFromEntriesFilters((f) => ({ ...f, size: e.target.value }))}
                  className="h-8 text-xs"
                  placeholder="contains…"
                />
              </div>
            </div>
            <div className="rounded-md border border-emerald-200 bg-emerald-50/50 p-2 text-[11px] text-muted-foreground">
              <b>Tip:</b> Loaded rows will go through the same validation pipeline
              (normalize → auto-match Order → validate). You can review warnings
              and re-import without copy-pasting.
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowFromEntries(false)}>Cancel</Button>
            <Button
              className={cn(theme.bg, "hover:opacity-90")}
              disabled={fromEntriesLoading}
              onClick={handleCreateFromEntries}
            >
              {fromEntriesLoading ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : (
                <Database className="h-4 w-4 mr-1.5" />
              )}
              {fromEntriesLoading ? "Loading…" : "Load Entries & Create Batch"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

