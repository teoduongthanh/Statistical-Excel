"use client";

import * as React from "react";
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
} from "lucide-react";
import { SmartAutocomplete } from "@/components/common/smart-autocomplete";
import { api } from "@/lib/api-client";
import { useAppStore, PRODUCT_THEME } from "@/store/app-store";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

const SHIPPING_OPTIONS = [
  { value: "1.Order", label: "1.Order", color: "bg-slate-100 text-slate-700" },
  { value: "2.Output", label: "2.Output", color: "bg-amber-100 text-amber-700" },
  { value: "3.Pending", label: "3.Pending", color: "bg-violet-100 text-violet-700" },
  { value: "4.Input", label: "4.Input", color: "bg-emerald-100 text-emerald-700" },
];

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

  // Preview / Confirm state — removed. Add Data saves directly (user request).
  // Review now happens later in the "Review & Merge with Master Data" view.
  const [saving, setSaving] = React.useState(false);

  // Recent entries
  const [recent, setRecent] = React.useState<any[]>([]);

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

  // Auto-lookup Master Data when factoryPO + size are set (spec §5, §6).
  React.useEffect(() => {
    if (!factoryPO || !size || !currentProduct) {
      setAutoFill(null);
      return;
    }
    let cancelled = false;
    setLookupLoading(true);
    const t = setTimeout(async () => {
      try {
        const group = await api.lookupFactoryPO(factoryPO, currentProduct);
        if (cancelled) return;
        if (group) {
          setAutoFill(group);
        } else {
          setAutoFill(null);
        }
      } catch {
        if (!cancelled) setAutoFill(null);
      } finally {
        if (!cancelled) setLookupLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [factoryPO, size, currentProduct]);

  // Validation (spec §13)
  const validationErrors = React.useMemo(() => {
    const errs: string[] = [];
    if (!shippingStatus) errs.push("Please select Shipping Status first.");
    if (!poNo) errs.push("PO NO# is required");
    if (!factoryPO) errs.push("Factory PO is required");
    if (!size) errs.push("Size is required");
    if (!qty) errs.push("Qty is required");
    else if (isNaN(Number(qty))) errs.push("Qty must be a number");
    else if (Number(qty) <= 0) errs.push("Qty must be greater than 0");
    return errs;
  }, [shippingStatus, poNo, factoryPO, size, qty]);

  const canAdd = validationErrors.length === 0;

  // ADD DATA — saves immediately via the confirm API (atomic transaction).
  // No preview step: the user wants fast entry. Review/merge with Master Data
  // is a separate function done later in the Review view.
  async function handleAddData() {
    if (!canAdd) {
      toast.error("Please fix validation errors", { description: validationErrors[0] });
      return;
    }
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
        const mergedCount = r.merged?.length || 0;
        const totalRecords = createdCount + mergedCount;
        let msg = `${shippingStatus} saved`;
        if (shippingStatus === "2.Output") {
          msg = `Output + Pending saved (${totalRecords} records)`;
        }
        if (mergedCount > 0) {
          msg += ` · ${mergedCount} merged into existing`;
        }
        toast.success(msg, {
          description: `${factoryPO} · ${size} · Qty=${qty}`,
        });
        // Add to recent list (show the created/merged entries).
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
                  {lookupLoading && (
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" /> Looking up…
                    </span>
                  )}
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
                  />
                </div>
                {factoryPO && !lookupLoading && autoFill === null && (
                  <p className="text-xs text-amber-600">Reference data not found for this Factory PO.</p>
                )}
              </div>

              {/* Step 4: Size (filtered by Factory PO, spec §13 of prev prompt) */}
              <div className="space-y-1.5">
                <Label className="flex items-center justify-between text-xs">
                  <span>Size <span className="text-destructive">*</span></span>
                  {autoFill && (
                    <Badge variant="secondary" className="text-[10px]">
                      {autoFill.sizes?.length || 0} available
                    </Badge>
                  )}
                </Label>
                <SizeInput
                  ref={sizeRef}
                  value={size}
                  onChange={setSize}
                  sizes={autoFill?.sizes || []}
                  disabled={shippingDisabled || !factoryPO}
                  placeholder={shippingDisabled ? "Select Shipping Status first" : !factoryPO ? "Enter Factory PO first" : "Type 13, 08…"}
                  onEnter={() => qtyRef.current?.focus()}
                />
                {autoFill && autoFill.sizes?.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-1">
                    {autoFill.sizes.slice(0, 8).map((s: string) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => { setSize(s); setTimeout(() => qtyRef.current?.focus(), 50); }}
                        className={cn(
                          "rounded-md border px-1.5 py-0.5 text-[10px] transition-colors hover:bg-accent",
                          size === s ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground"
                        )}
                      >
                        {s}
                      </button>
                    ))}
                    {autoFill.sizes.length > 8 && (
                      <span className="text-[10px] text-muted-foreground self-center">+{autoFill.sizes.length - 8} more</span>
                    )}
                  </div>
                )}
              </div>

              {/* Step 5: Qty (spec §9) */}
              <div className="space-y-1.5">
                <Label className="text-xs">Qty <span className="text-destructive">*</span></Label>
                <Input
                  ref={qtyRef}
                  value={qty}
                  onChange={(e) => setQty(e.target.value.replace(/[^0-9.\-]/g, ""))}
                  onKeyDown={(e) => handleEnter(e, "qty")}
                  placeholder="e.g. 100"
                  className="h-11"
                  inputMode="numeric"
                  disabled={shippingDisabled}
                />
                {qty && !isNaN(Number(qty)) && (
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
    </div>
  );
}

// Compute Q'ty 2 preview client-side (mirrors server logic).
function computeQty2Preview(shippingStatus: string, qty: string): string {
  const n = Number(qty);
  if (isNaN(n)) return "—";
  if (shippingStatus === "3.Pending") return String(-Math.abs(n));
  return String(n);
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

function AutoFillGrid({ group, factoryPO, size, qty, shippingStatus }: { group: any; factoryPO: string; size: string; qty: string; shippingStatus: string }) {
  const rows: { label: string; value: string | null; field: string }[] = [
    { label: "MODEL", value: group.model, field: "model" },
    { label: "SKU", value: group.sku, field: "sku" },
    { label: "ITEM", value: group.item, field: "item" },
    { label: "Season", value: group.season, field: "season" },
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
