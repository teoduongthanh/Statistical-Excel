"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  PenLine,
  Sparkles,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Plus,
  Layers,
  Calculator,
  Copy,
  Wand2,
  ClipboardPaste,
  Boxes,
} from "lucide-react";
import { SmartAutocomplete } from "@/components/common/smart-autocomplete";
import { api } from "@/lib/api-client";
import { useAppStore, PRODUCT_THEME } from "@/store/app-store";
import type { MasterGroup, AutocompleteSuggestion } from "@/types";
import { SHARED_FIELDS, FIELD_LABELS, type CanonicalField } from "@/lib/fields";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

const SHARED_LABELS: { field: CanonicalField; label: string }[] = SHARED_FIELDS.map((f) => ({
  field: f,
  label: FIELD_LABELS[f],
}));

/**
 * Product-scoped data entry view.
 *
 * Behaves like the legacy `DataEntryView` (Factory PO + Size + Qty1 → auto-fill
 * from Master Data, qty2 auto-calc, duplicate detection, bulk entry), but every
 * lookup / save call is bound to the current product (`currentProduct` from the
 * Zustand store). The product is shown prominently in a gradient banner so the
 * user is always aware of which product scope they're writing into.
 */
export function ProductDataEntryView() {
  const { currentProduct, settings, setSettings, bumpRefresh, refreshKey } = useAppStore();
  const theme = PRODUCT_THEME[currentProduct];

  // Load settings once.
  const settingsQ = useQuery({
    queryKey: ["settings", refreshKey],
    queryFn: api.getSettings,
  });
  React.useEffect(() => {
    if (settingsQ.data) setSettings(settingsQ.data);
  }, [settingsQ.data, setSettings]);

  const autoCalcQty2 = settings?.autoCalcQty2 ?? true;
  const duplicateDetection = settings?.duplicateDetection ?? true;

  const [factoryPO, setFactoryPO] = React.useState("");
  const [size, setSize] = React.useState("");
  const [qty1, setQty1] = React.useState("");
  const [group, setGroup] = React.useState<MasterGroup | null>(null);
  const [lookupLoading, setLookupLoading] = React.useState(false);
  const [recent, setRecent] = React.useState<any[]>([]);
  const [dupDialog, setDupDialog] = React.useState<null | { factoryPO: string; size: string; existing: any }>(null);
  const [bulkOpen, setBulkOpen] = React.useState(false);

  // Lookup Factory PO on selection (onSelect). Per spec §38 workflow.
  // The lookup is scoped to currentProduct — a MAFATE Factory PO will NOT
  // resolve when the user has switched to ONYX.
  async function onSelectFactoryPO(s: AutocompleteSuggestion) {
    setLookupLoading(true);
    setSize("");
    setGroup(null);
    try {
      const g = await api.lookupFactoryPO(s.value, currentProduct);
      setGroup(g);
      toast.success("Auto-filled shared data", {
        description: `${g.model ?? "—"} · ${g.season ?? "—"} · ${g.sizes.length} sizes`,
      });
    } catch {
      setGroup(null);
      toast.error(`Factory PO not found in ${currentProduct} Master Data`);
    } finally {
      setLookupLoading(false);
    }
  }

  // Recompute Qty2.
  const qty2 = React.useMemo(() => {
    if (!autoCalcQty2) return "";
    const n = Number(qty1);
    if (qty1 === "" || isNaN(n)) return "";
    return String(-Math.abs(n));
  }, [qty1, autoCalcQty2]);

  // Validation.
  const validation = React.useMemo(() => {
    const errs: string[] = [];
    if (!factoryPO) errs.push("Factory PO is required");
    if (!size) errs.push("Size is required");
    if (!qty1) errs.push("Qty 1 is required");
    else if (isNaN(Number(qty1))) errs.push("Qty 1 must be a number");
    if (group && size) {
      const norm = (s: string) => s.replace(/\s+/g, " ").trim();
      if (!group.sizes.some((s) => norm(s) === norm(size))) {
        errs.push(`Size "${size}" does not belong to ${factoryPO}`);
      }
    }
    if (!group && factoryPO) errs.push(`Factory PO not found in ${currentProduct} Master Data`);
    return errs;
  }, [factoryPO, size, qty1, group, currentProduct]);

  const canSave = validation.length === 0;

  async function handleSave(opts?: { forceDuplicate?: boolean }) {
    if (!canSave) {
      toast.error("Please fix validation errors", { description: validation[0] });
      return;
    }
    // Duplicate check.
    if (duplicateDetection && !opts?.forceDuplicate) {
      try {
        const d = await api.checkDuplicate(factoryPO, size);
        if (d.duplicate) {
          setDupDialog({ factoryPO, size, existing: d.existing });
          return;
        }
      } catch {
        /* ignore, proceed */
      }
    }
    await doSave();
  }

  async function doSave() {
    const res = await api.createEntry({
      productType: currentProduct,
      factoryPO,
      size,
      qty1,
      autoCalcQty2,
    });
    if (res.ok && res.entry) {
      toast.success(`Entry saved to ${currentProduct}`, {
        description: `${factoryPO} · ${size} · ${qty1} → ${res.entry.qty2}`,
      });
      setRecent((r) => [res.entry!, ...r].slice(0, 8));
      bumpRefresh();
      // Keep Factory PO, clear variable inputs for fast consecutive entry.
      setSize("");
      setQty1("");
    } else {
      toast.error("Save failed", { description: res.errors?.join(", ") });
    }
  }

  function resetForm() {
    setFactoryPO("");
    setSize("");
    setQty1("");
    setGroup(null);
  }

  const sizes = group?.sizes ?? [];

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
                Data Entry
              </p>
              <h1 className="text-2xl font-bold tracking-tight">{currentProduct}</h1>
              <p className="text-xs text-white/80">
                Enter 3 fields — shared attributes are auto-filled from{" "}
                <span className="font-semibold">{currentProduct}</span> Master Data.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setBulkOpen(true)}
              className="h-9 bg-white/20 text-white hover:bg-white/30 hover:text-white"
            >
              <Layers className="mr-1.5 h-3.5 w-3.5" /> Bulk Entry
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={resetForm}
              className="h-9 bg-white/10 text-white hover:bg-white/20 hover:text-white"
            >
              <Copy className="mr-1.5 h-3.5 w-3.5" /> Reset
            </Button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* Input form */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <PenLine className={cn("h-4 w-4", theme.text)} /> Input Fields
                <Badge variant="outline" className={cn("ml-auto text-[10px]", theme.badge)}>
                  {currentProduct}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Factory PO */}
              <div className="space-y-1.5">
                <Label className="flex items-center justify-between text-xs">
                  <span>Factory PO <span className="text-destructive">*</span></span>
                  {lookupLoading && (
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" /> Looking up…
                    </span>
                  )}
                </Label>
                <SmartAutocomplete
                  field="factoryPO"
                  value={factoryPO}
                  onChange={setFactoryPO}
                  onSelect={onSelectFactoryPO}
                  placeholder={`Type a ${currentProduct} Factory PO…`}
                  productType={currentProduct}
                  autoFocus
                />
                {factoryPO && !group && !lookupLoading && (
                  <p className="text-xs text-destructive">
                    Factory PO not found in {currentProduct} Master Data
                  </p>
                )}
              </div>

              {/* Size (filtered) */}
              <div className="space-y-1.5">
                <Label className="flex items-center justify-between text-xs">
                  <span>Size <span className="text-destructive">*</span></span>
                  {group && (
                    <Badge variant="secondary" className="text-[10px]">
                      {sizes.length} available
                    </Badge>
                  )}
                </Label>
                <SizeAutocomplete
                  value={size}
                  onChange={setSize}
                  sizes={sizes}
                  disabled={!group}
                  placeholder={group ? "Type a size…" : "Select Factory PO first"}
                />
                {group && sizes.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-1">
                    {sizes.slice(0, 8).map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setSize(s)}
                        className={cn(
                          "rounded-md border px-1.5 py-0.5 text-[10px] transition-colors hover:bg-accent",
                          size === s
                            ? cn(theme.border, "bg-primary/10", theme.text)
                            : "text-muted-foreground",
                        )}
                      >
                        {s}
                      </button>
                    ))}
                    {sizes.length > 8 && (
                      <span className="text-[10px] text-muted-foreground self-center">
                        +{sizes.length - 8} more
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Qty 1 */}
              <div className="space-y-1.5">
                <Label className="text-xs">Qty 1 <span className="text-destructive">*</span></Label>
                <Input
                  value={qty1}
                  onChange={(e) => setQty1(e.target.value.replace(/[^0-9.\-]/g, ""))}
                  placeholder="e.g. 20"
                  className="h-11"
                  inputMode="numeric"
                />
              </div>

              {/* Qty 2 */}
              <div className="space-y-1.5">
                <Label className="flex items-center justify-between text-xs">
                  <span>Qty 2</span>
                  <label className="flex items-center gap-1.5 text-muted-foreground cursor-pointer">
                    <Switch
                      checked={autoCalcQty2}
                      onCheckedChange={(v) => {
                        setSettings({ ...(settings as any), autoCalcQty2: v } as any);
                        api.saveSettings({ autoCalcQty2: v }).catch(() => {});
                      }}
                      className="scale-75 origin-right"
                    />
                    <span className="text-[10px]">Auto-calc</span>
                  </label>
                </Label>
                <div className="relative">
                  <Calculator className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={autoCalcQty2 ? qty2 : ""}
                    onChange={(e) => !autoCalcQty2 && setQty1?.(e.target.value)}
                    disabled={autoCalcQty2}
                    placeholder={autoCalcQty2 ? "Auto: Qty1 × -1" : "Manual"}
                    className="h-11 pl-9 bg-muted/40"
                  />
                </div>
                {autoCalcQty2 && qty2 && (
                  <p className="text-[11px] text-muted-foreground">
                    Auto-calculated as <code className="rounded bg-muted px-1">-|Qty1|</code> = {qty2}
                  </p>
                )}
              </div>

              {validation.length > 0 && (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2.5">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-destructive">
                    <AlertTriangle className="h-3.5 w-3.5" /> Validation
                  </div>
                  <ul className="mt-1 space-y-0.5 text-[11px] text-destructive/90">
                    {validation.map((e, i) => (
                      <li key={i}>• {e}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <Button
                  className={cn("flex-1", theme.bg, "hover:opacity-90")}
                  disabled={!canSave}
                  onClick={() => handleSave()}
                >
                  <Plus className="mr-1.5 h-4 w-4" /> Add to {currentProduct}
                </Button>
                <Button variant="outline" onClick={() => setBulkOpen(true)}>
                  <Layers className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Recent entries */}
          {recent.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Just Added to {currentProduct}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {recent.map((e) => (
                  <div
                    key={e.id}
                    className="flex items-center justify-between rounded-md border bg-muted/30 px-2.5 py-1.5 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="font-medium truncate">{e.factoryPO} · {e.size}</div>
                      <div className="text-muted-foreground truncate">{e.model} · {e.season}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-mono">{e.qty1} / {e.qty2}</div>
                      <CheckCircle2 className={cn("ml-auto h-3 w-3", theme.text)} />
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Auto-generated preview */}
        <div className="lg:col-span-3">
          <Card className="h-full">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Sparkles className={cn("h-4 w-4", theme.text)} /> Auto-Generated Data
                {group && (
                  <Badge variant="outline" className={cn("ml-auto text-[10px]", theme.badge)}>
                    from {currentProduct} Master
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!group ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                    <Sparkles className="h-6 w-6" />
                  </div>
                  <p className="mt-3 text-sm font-medium">Select a Factory PO to auto-fill</p>
                  <p className="mt-1 text-xs text-muted-foreground max-w-xs">
                    Shared attributes (MODEL, SKU, Season, colors, painting, printing) for{" "}
                    <span className="font-semibold">{currentProduct}</span> will appear here automatically.
                  </p>
                </div>
              ) : (
                <PreviewGrid group={group} factoryPO={factoryPO} size={size} qty1={qty1} qty2={qty2} theme={theme} />
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Duplicate dialog */}
      <AlertDialog open={!!dupDialog} onOpenChange={(o) => !o && setDupDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" /> Data already exists
            </AlertDialogTitle>
            <AlertDialogDescription>
              An entry with <strong>Factory PO: {dupDialog?.factoryPO}</strong> and{" "}
              <strong>Size: {dupDialog?.size}</strong> already exists.
              {dupDialog?.existing && (
                <span className="mt-1 block text-xs">
                  Existing Qty1: {dupDialog.existing.qty1} · created{" "}
                  {new Date(dupDialog.existing.createdAt).toLocaleString()}
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => setDupDialog(null)}
              className="bg-amber-600 hover:bg-amber-700"
            >
              Update existing
            </AlertDialogAction>
            <AlertDialogAction
              onClick={() => {
                setDupDialog(null);
                doSave();
              }}
            >
              Create duplicate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk entry dialog */}
      <BulkEntryDialog
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        onDone={() => bumpRefresh()}
        autoCalcQty2={autoCalcQty2}
        currentProduct={currentProduct}
      />
    </div>
  );
}

function PreviewGrid({
  group,
  factoryPO,
  size,
  qty1,
  qty2,
  theme,
}: {
  group: MasterGroup;
  factoryPO: string;
  size: string;
  qty1: string;
  qty2: string;
  theme: { bg: string; text: string; border: string };
}) {
  const rows: { label: string; value: string | null; field: CanonicalField }[] = [
    { label: "Date", value: group.date ?? null, field: "date" },
    { label: "Shipping Status", value: group.shippingStatus ?? null, field: "shippingStatus" },
    ...SHARED_LABELS.map((s) => ({
      label: s.label,
      value: ((group as any)[s.field] as string | null | undefined) ?? null,
      field: s.field,
    })),
    { label: "Size", value: size, field: "size" },
    { label: "Qty 1", value: qty1, field: "qty1" },
    { label: "Qty 2", value: qty2, field: "qty2" },
    { label: "Dead Line", value: group.deadline ?? null, field: "deadline" },
  ];
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {rows.map((r) => {
        const sharedFlag = (group.sharedFlags as any)?.[r.field];
        const multiple = sharedFlag === false && r.value === null;
        const input = ["factoryPO", "size", "qty1", "qty2"].includes(r.field) || (r.field === "factoryPO");
        return (
          <div
            key={r.label}
            className={cn(
              "rounded-md border p-2.5",
              input ? cn(theme.border, "bg-primary/5") : "bg-muted/30",
            )}
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {r.label}
              </span>
              {input && <Badge variant="outline" className="text-[9px] py-0">input</Badge>}
              {multiple && (
                <Badge variant="outline" className="text-[9px] py-0 bg-amber-50 text-amber-700 border-amber-200">
                  multiple
                </Badge>
              )}
            </div>
            <div className={cn("mt-0.5 text-sm font-medium break-words", !r.value && "text-muted-foreground/50")}>
              {multiple ? "⚠ Multiple values found" : r.value || "—"}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Size autocomplete that only suggests sizes belonging to the selected Factory PO.
function SizeAutocomplete({
  value,
  onChange,
  sizes,
  disabled,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  sizes: string[];
  disabled?: boolean;
  placeholder?: string;
}) {
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
        value={value}
        disabled={disabled}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
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
                  onClick={() => {
                    onChange(s);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full px-3 py-1.5 text-left text-sm hover:bg-accent",
                    s === value && "bg-accent",
                  )}
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
}

// Bulk entry: paste from Excel or manual rows. Each row is scoped to the current
// product so that all bulk-saved entries inherit the same productType.
function BulkEntryDialog({
  open,
  onOpenChange,
  onDone,
  autoCalcQty2,
  currentProduct,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
  autoCalcQty2: boolean;
  currentProduct: string;
}) {
  const theme = PRODUCT_THEME[currentProduct];
  const [text, setText] = React.useState("MH25100234\tM(07) /W(08)\t10\nMH25100234\tM(13)\t20");
  const [submitting, setSubmitting] = React.useState(false);
  const [result, setResult] = React.useState<any>(null);

  async function submit() {
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    const items = lines.map((l) => {
      const parts = l.split("\t").map((p) => p.trim());
      return {
        factoryPO: parts[0] || "",
        size: parts[1] || "",
        qty1: parts[2] || "",
        productType: currentProduct,
      };
    }).filter((it) => it.factoryPO && it.size && it.qty1);
    if (items.length === 0) {
      toast.error("No valid rows — use Tab-separated: Factory PO, Size, Qty1");
      return;
    }
    setSubmitting(true);
    try {
      const r = (await api.bulkEntries(items, autoCalcQty2)) as {
        ok: boolean;
        total: number;
        success: number;
        failed: number;
        results?: { index: number; ok: boolean; entry?: any; errors?: string[] }[];
      };
      setResult(r);
      onDone();
      toast.success(`Bulk to ${currentProduct}: ${r.success} created, ${r.failed} failed`);
    } catch (e) {
      toast.error("Bulk entry failed", { description: e instanceof Error ? e.message : "" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className={cn("h-5 w-5", theme.text)} /> Bulk Data Entry —{" "}
            <Badge variant="outline" className={cn("text-[10px]", theme.badge)}>
              {currentProduct}
            </Badge>
          </DialogTitle>
          <DialogDescription>
            Paste rows directly from Excel (Tab-separated: <code>Factory PO</code>,{" "}
            <code>Size</code>, <code>Qty1</code>). Each row is auto-looked-up from{" "}
            <span className="font-semibold">{currentProduct}</span> Master Data and saved with that
            product scope.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <ClipboardPaste className="h-3.5 w-3.5" /> Tip: copy a range in Excel and paste here.
          </div>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={8}
            className="font-mono text-xs scroll-thin"
            placeholder="MH25100234&#9;M(07) /W(08)&#9;10&#10;MH25100234&#9;M(13)&#9;20"
          />
          {result && (
            <div className="rounded-md border bg-muted/30 p-2.5 text-xs">
              <div className="font-medium">
                Total: {result.total} · Success: {result.success} · Failed: {result.failed}
              </div>
              {result.results?.filter((r: any) => !r.ok).slice(0, 5).map((r: any, i: number) => (
                <div key={i} className="mt-1 text-destructive">
                  Row {r.index + 1}: {r.errors?.join(", ")}
                </div>
              ))}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          <Button
            onClick={submit}
            disabled={submitting}
            className={cn(theme.bg, "hover:opacity-90")}
          >
            {submitting ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-1.5 h-4 w-4" />
            )}
            Add {text.split("\n").filter((l) => l.trim()).length} rows to {currentProduct}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
