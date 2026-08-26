"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Truck,
  Package,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
  Download,
  Loader2,
  RotateCcw,
  Calendar,
  Hash,
  Factory,
  Shirt,
  CalendarClock,
  Plus,
  Eye,
  Zap,
  Trash2,
  Sparkles,
  Send,
  Inbox,
  ArrowLeftRight,
  ShieldCheck,
  ClipboardList,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useAppStore, PRODUCT_THEME } from "@/store/app-store";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
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

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

interface ShipmentGroup {
  key: string;
  productType: string;
  poNo: string;
  factoryPO: string;
  size: string;
  colorCode: string;
  colorCode2: string;
  model: string;
  sku: string;
  season: string;
  mw: string;
  deadline: string | null;
  orderQty: number;
  outputQty: number;
  inputQty: number;
  pendingQty: number;
  remainingOutput: number;
  remainingInput: number;
  surplus: number;
  status: "SHORT_OUTPUT" | "BALANCED" | "SURPLUS" | "NO_ORDER";
}

interface ShipmentSummary {
  totalGroups: number;
  totalOrder: number;
  totalOutput: number;
  totalInput: number;
  totalPending: number;
  totalRemainingOutput: number;
  totalRemainingInput: number;
  totalSurplus: number;
  shortOutputCount: number;
  surplusCount: number;
  balancedCount: number;
}

interface GroupsResponse {
  groups: ShipmentGroup[];
  summary: ShipmentSummary;
}

interface ColorOption {
  code: string;
  label: string;
}

interface SurplusSource {
  key: string;
  poNo: string;
  factoryPO: string;
  size: string;
  colorCode: string;
  model: string;
  deadline: string | null;
  orderQty: number;
  outputQty: number;
  surplus: number;
}

interface TransferDestination {
  key: string;
  poNo: string;
  factoryPO: string;
  size: string;
  colorCode: string;
  model: string;
  deadline: string | null;
  orderQty: number;
  outputQty: number;
  remainingCapacity: number;
}

interface TransferProposal {
  source: SurplusSource;
  destination: TransferDestination;
  transferQty: number;
  sourceRemainingSurplus: number;
  destinationRemainingCapacity: number;
}

interface SurplusResponse {
  proposals: TransferProposal[];
  surplusSources: SurplusSource[];
}

interface ShipmentBatch {
  id: string;
  productType: string;
  batchNumber: string;
  date: string;
  colorCode: string;
  poNo: string;
  factoryPO: string;
  model: string | null;
  sku: string | null;
  season: string | null;
  size: string;
  orderQty: number;
  previousOutput: number;
  plannedQty: number;
  remainingQty: number;
  deadline: string | null;
  status: string;
  note: string | null;
  createdAt: string;
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "0";
  return Math.round(n).toLocaleString();
}

function todayLocalISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const s = String(iso).trim();
  if (!s) return "—";
  const d = new Date(s + (s.length === 10 ? "T00:00:00" : ""));
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

function isOverdue(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const s = String(iso).trim();
  if (!s) return false;
  const d = new Date(s + (s.length === 10 ? "T00:00:00" : ""));
  if (Number.isNaN(d.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d.getTime() < today.getTime();
}

const STATUS_META: Record<
  ShipmentGroup["status"],
  { label: string; row: string; badge: string; dot: string }
> = {
  SURPLUS: {
    label: "Surplus",
    row: "bg-amber-50/60 dark:bg-amber-950/15",
    badge:
      "border-amber-200 bg-amber-100 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300",
    dot: "bg-amber-500",
  },
  SHORT_OUTPUT: {
    label: "Short",
    row: "bg-rose-50/60 dark:bg-rose-950/15",
    badge:
      "border-rose-200 bg-rose-100 text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300",
    dot: "bg-rose-500",
  },
  BALANCED: {
    label: "Balanced",
    row: "bg-emerald-50/40 dark:bg-emerald-950/15",
    badge:
      "border-emerald-200 bg-emerald-100 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300",
    dot: "bg-emerald-500",
  },
  NO_ORDER: {
    label: "No Order",
    row: "bg-muted/30",
    badge:
      "border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-400",
    dot: "bg-slate-400",
  },
};

const BATCH_STATUS_META: Record<string, { label: string; badge: string }> = {
  DRAFT: {
    label: "Draft",
    badge:
      "border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-300",
  },
  CONFIRMED: {
    label: "Confirmed",
    badge:
      "border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300",
  },
  EXPORTED: {
    label: "Exported",
    badge:
      "border-teal-200 bg-teal-100 text-teal-700 dark:border-teal-900/50 dark:bg-teal-950/40 dark:text-teal-300",
  },
};

// ----------------------------------------------------------------------------
// KPI cards
// ----------------------------------------------------------------------------

interface KpiCardProps {
  label: string;
  value: string;
  sub?: string;
  icon: React.ComponentType<{ className?: string }>;
  iconClass: string;
  loading?: boolean;
}

function KpiCard({ label, value, sub, icon: Icon, iconClass, loading }: KpiCardProps) {
  return (
    <Card className="overflow-hidden">
      <CardContent className="flex items-center gap-3 py-4">
        <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", iconClass)}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </div>
          {loading ? (
            <Skeleton className="mt-1 h-6 w-20" />
          ) : (
            <div className="mt-0.5 truncate text-xl font-bold tabular-nums">{value}</div>
          )}
          {sub ? <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div> : null}
        </div>
      </CardContent>
    </Card>
  );
}

// ----------------------------------------------------------------------------
// Filter bar
// ----------------------------------------------------------------------------

interface FilterForm {
  date: string;
  colorCode: string;
  factoryPO: string;
  poNo: string;
  size: string;
  deadline: string;
}

interface FilterBarProps {
  form: FilterForm;
  onFormChange: (next: Partial<FilterForm>) => void;
  colors: ColorOption[];
  factoryPOs: string[];
  poNos: string[];
  sizes: string[];
  colorsLoading: boolean;
  factoryPOsLoading: boolean;
  poNosLoading: boolean;
  sizesLoading: boolean;
  onApply: () => void;
  onReset: () => void;
  applying: boolean;
}

function FilterBar({
  form,
  onFormChange,
  colors,
  factoryPOs,
  poNos,
  sizes,
  colorsLoading,
  factoryPOsLoading,
  poNosLoading,
  sizesLoading,
  onApply,
  onReset,
  applying,
}: FilterBarProps) {
  const hasAnyActive =
    Boolean(form.date) ||
    Boolean(form.colorCode) ||
    Boolean(form.factoryPO) ||
    Boolean(form.poNo) ||
    Boolean(form.size) ||
    Boolean(form.deadline);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Calendar className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              Filters — cascade: Color → Factory PO → PO NO# → Size
            </CardTitle>
            <CardDescription className="mt-1 text-xs">
              Pick a Color Code first; downstream dropdowns refresh automatically.
            </CardDescription>
          </div>
          <Badge variant="outline" className="gap-1 text-[11px]">
            {hasAnyActive ? "Filtered" : "No filters"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <FilterField label="Date" icon={Calendar}>
            <Input
              type="date"
              className="h-9"
              value={form.date}
              onChange={(e) => onFormChange({ date: e.target.value })}
            />
          </FilterField>

          <FilterField label="Color Code" icon={Hash}>
            <Select
              value={form.colorCode || "__ALL__"}
              onValueChange={(v) => onFormChange({ colorCode: v === "__ALL__" ? "" : v })}
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder={colorsLoading ? "Loading…" : "All colors"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__ALL__">All colors</SelectItem>
                {colors.map((c) => (
                  <SelectItem key={c.code} value={c.code}>
                    {c.code} — {c.label.length > 32 ? `${c.label.slice(0, 30)}…` : c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterField>

          <FilterField label="Factory PO" icon={Factory}>
            <Select
              value={form.factoryPO || "__ALL__"}
              onValueChange={(v) => onFormChange({ factoryPO: v === "__ALL__" ? "" : v })}
              disabled={!form.colorCode}
            >
              <SelectTrigger className="h-9">
                <SelectValue
                  placeholder={
                    !form.colorCode
                      ? "Pick a color first"
                      : factoryPOsLoading
                      ? "Loading…"
                      : "All factory POs"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__ALL__">All factory POs</SelectItem>
                {factoryPOs.map((fpo) => (
                  <SelectItem key={fpo} value={fpo}>
                    {fpo}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterField>

          <FilterField label="PO NO#" icon={Hash}>
            <Select
              value={form.poNo || "__ALL__"}
              onValueChange={(v) => onFormChange({ poNo: v === "__ALL__" ? "" : v })}
              disabled={!form.factoryPO}
            >
              <SelectTrigger className="h-9">
                <SelectValue
                  placeholder={
                    !form.factoryPO
                      ? "Pick a Factory PO first"
                      : poNosLoading
                      ? "Loading…"
                      : "All PO NO#s"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__ALL__">All PO NO#s</SelectItem>
                {poNos.map((po) => (
                  <SelectItem key={po} value={po}>
                    {po}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterField>

          <FilterField label="Size" icon={Shirt}>
            <Select
              value={form.size || "__ALL__"}
              onValueChange={(v) => onFormChange({ size: v === "__ALL__" ? "" : v })}
              disabled={!form.factoryPO}
            >
              <SelectTrigger className="h-9">
                <SelectValue
                  placeholder={
                    !form.factoryPO
                      ? "Pick a Factory PO first"
                      : sizesLoading
                      ? "Loading…"
                      : "All sizes"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__ALL__">All sizes</SelectItem>
                {sizes.map((sz) => (
                  <SelectItem key={sz} value={sz}>
                    {sz}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterField>

          <FilterField label="Deadline" icon={CalendarClock}>
            <Input
              type="date"
              className="h-9"
              value={form.deadline}
              onChange={(e) => onFormChange({ deadline: e.target.value })}
            />
          </FilterField>
        </div>

        <div className="flex items-center justify-end gap-2 border-t pt-3">
          <Button variant="outline" onClick={onReset} className="h-9" disabled={!hasAnyActive}>
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Reset
          </Button>
          <Button onClick={onApply} disabled={applying} className="h-9 bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-700 dark:hover:bg-emerald-600">
            {applying ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />}
            Apply
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function FilterField({
  label,
  icon: Icon,
  children,
}: {
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
        {Icon ? <Icon className="h-3 w-3" /> : null}
        {label}
      </Label>
      {children}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Main view
// ----------------------------------------------------------------------------

export function ShipmentPlanningView() {
  const { currentProduct, refreshKey, bumpRefresh } = useAppStore();
  const theme = PRODUCT_THEME[currentProduct];
  const qc = useQueryClient();

  // ----------------------- filter state -----------------------
  const [form, setForm] = React.useState<FilterForm>({
    date: "",
    colorCode: "",
    factoryPO: "",
    poNo: "",
    size: "",
    deadline: "",
  });
  const [committed, setCommitted] = React.useState<FilterForm>({
    date: "",
    colorCode: "",
    factoryPO: "",
    poNo: "",
    size: "",
    deadline: "",
  });
  const [applying, setApplying] = React.useState(false);

  // Planned qty per row — keyed by group.key.
  const [plannedMap, setPlannedMap] = React.useState<Record<string, number>>({});
  // Validation errors per row — keyed by group.key.
  const [plannedErrors, setPlannedErrors] = React.useState<Record<string, string>>({});

  // Preview / generate dialogs.
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const [generating, setGenerating] = React.useState(false);
  const [deleteBatchId, setDeleteBatchId] = React.useState<string | null>(null);
  const [deletingBatch, setDeletingBatch] = React.useState(false);
  const [selectedProposal, setSelectedProposal] = React.useState<TransferProposal | null>(null);

  // ----------------------- cascading dropdown queries -----------------------
  const colorsQuery = useQuery({
    queryKey: ["shipment-colors", currentProduct, refreshKey] as const,
    queryFn: () => api.getShipmentColors(currentProduct),
    staleTime: 60_000,
  });

  const factoryPOsQuery = useQuery({
    queryKey: [
      "shipment-factory-pos",
      currentProduct,
      form.colorCode,
      refreshKey,
    ] as const,
    queryFn: () => api.getShipmentFactoryPOs(currentProduct, form.colorCode),
    enabled: Boolean(form.colorCode),
    staleTime: 30_000,
  });

  const poNosQuery = useQuery({
    queryKey: [
      "shipment-po-nos",
      currentProduct,
      form.colorCode,
      form.factoryPO,
      refreshKey,
    ] as const,
    queryFn: () =>
      api.getShipmentPoNos(currentProduct, form.colorCode, form.factoryPO),
    enabled: Boolean(form.colorCode) && Boolean(form.factoryPO),
    staleTime: 30_000,
  });

  const sizesQuery = useQuery({
    queryKey: [
      "shipment-sizes",
      currentProduct,
      form.colorCode,
      form.factoryPO,
      form.poNo,
      refreshKey,
    ] as const,
    queryFn: () =>
      api.getShipmentSizes(
        currentProduct,
        form.colorCode,
        form.factoryPO,
        form.poNo || undefined
      ),
    enabled: Boolean(form.colorCode) && Boolean(form.factoryPO),
    staleTime: 30_000,
  });

  // ----------------------- main data query (groups + summary) -----------------------
  const filtersKey = React.useMemo(
    () => ({
      date: committed.date,
      colorCode: committed.colorCode,
      factoryPO: committed.factoryPO,
      poNo: committed.poNo,
      size: committed.size,
      deadline: committed.deadline,
    }),
    [committed]
  );

  const groupsQuery = useQuery({
    queryKey: ["shipment-groups", currentProduct, filtersKey, refreshKey] as const,
    queryFn: () =>
      api.getShipmentGroups(currentProduct, {
        date: filtersKey.date,
        colorCode: filtersKey.colorCode,
        factoryPO: filtersKey.factoryPO,
        poNo: filtersKey.poNo,
        size: filtersKey.size,
        deadline: filtersKey.deadline,
      }),
    staleTime: 15_000,
  });

  // ----------------------- surplus / transfers query -----------------------
  const surplusQuery = useQuery({
    queryKey: ["shipment-surplus", currentProduct, filtersKey, refreshKey] as const,
    queryFn: () =>
      api.getSurplusTransfers(currentProduct, {
        date: filtersKey.date,
        colorCode: filtersKey.colorCode,
        factoryPO: filtersKey.factoryPO,
        poNo: filtersKey.poNo,
      }),
    staleTime: 15_000,
  });

  // ----------------------- batches list query -----------------------
  const batchesQuery = useQuery({
    queryKey: ["shipment-batches", currentProduct, refreshKey] as const,
    queryFn: () => api.listShipmentBatches(currentProduct),
    staleTime: 5_000,
  });

  // ----------------------- effects: cascade reset -----------------------
  // When colorCode changes, reset downstream factoryPO/poNo/size.
  React.useEffect(() => {
    setForm((f) => ({
      ...f,
      factoryPO: "",
      poNo: "",
      size: "",
    }));
  }, [form.colorCode]);

  React.useEffect(() => {
    setForm((f) => ({
      ...f,
      poNo: "",
      size: "",
    }));
  }, [form.factoryPO]);

  React.useEffect(() => {
    setForm((f) => ({
      ...f,
      size: "",
    }));
  }, [form.poNo]);

  // ----------------------- planned qty helpers -----------------------
  function handlePlannedChange(group: ShipmentGroup, raw: string) {
    const n = raw === "" ? 0 : Number(raw);
    if (!Number.isFinite(n) || n < 0) {
      setPlannedErrors((m) => ({ ...m, [group.key]: "Enter a non-negative number" }));
      setPlannedMap((m) => ({ ...m, [group.key]: raw === "" ? 0 : n }));
      return;
    }
    setPlannedMap((m) => ({ ...m, [group.key]: n }));
    if (n > group.remainingOutput) {
      setPlannedErrors((m) => ({
        ...m,
        [group.key]: `Planned (${n}) exceeds remaining (${group.remainingOutput})`,
      }));
    } else {
      setPlannedErrors((m) => {
        const next = { ...m };
        delete next[group.key];
        return next;
      });
    }
  }

  function autoFillRemaining() {
    if (!groupsQuery.data?.groups) return;
    const next: Record<string, number> = { ...plannedMap };
    for (const g of groupsQuery.data.groups) {
      // Only fill rows that have remaining output (don't waste rows with 0).
      if (g.remainingOutput > 0) {
        next[g.key] = g.remainingOutput;
      } else {
        next[g.key] = 0;
      }
    }
    setPlannedMap(next);
    setPlannedErrors({});
    toast.success("Auto-filled planned quantities", {
      description: "All rows set to their remaining output.",
    });
  }

  function clearPlanned() {
    setPlannedMap({});
    setPlannedErrors({});
    toast.info("Planned quantities cleared");
  }

  // ----------------------- apply filters -----------------------
  function applyFilters() {
    setApplying(true);
    setCommitted({ ...form });
    setTimeout(() => setApplying(false), 100);
  }

  function resetFilters() {
    const empty: FilterForm = {
      date: "",
      colorCode: "",
      factoryPO: "",
      poNo: "",
      size: "",
      deadline: "",
    };
    setForm(empty);
    setCommitted(empty);
  }

  // ----------------------- generate shipment batches -----------------------
  const rowsForGeneration = React.useMemo(() => {
    const groups = groupsQuery.data?.groups ?? [];
    return groups
      .map((g) => ({
        group: g,
        planned: plannedMap[g.key] ?? 0,
      }))
      .filter((r) => r.planned > 0 && r.planned <= r.group.remainingOutput);
  }, [groupsQuery.data, plannedMap]);

  const totalPlanned = rowsForGeneration.reduce((s, r) => s + r.planned, 0);
  const hasAnyError = Object.keys(plannedErrors).length > 0;

  async function handleGenerate() {
    if (rowsForGeneration.length === 0) {
      toast.error("Nothing to generate", {
        description: "Set a planned quantity > 0 on at least one row.",
      });
      return;
    }
    if (hasAnyError) {
      toast.error("Fix planned quantity errors first");
      return;
    }
    setGenerating(true);
    let ok = 0;
    let failed = 0;
    const errors: string[] = [];
    const date = committed.date || todayLocalISO();
    try {
      for (const r of rowsForGeneration) {
        try {
          await api.createShipmentBatch({
            productType: currentProduct,
            date,
            colorCode: r.group.colorCode,
            poNo: r.group.poNo,
            factoryPO: r.group.factoryPO,
            model: r.group.model,
            sku: r.group.sku,
            season: r.group.season,
            size: r.group.size,
            orderQty: r.group.orderQty,
            previousOutput: r.group.outputQty,
            plannedQty: r.planned,
            remainingQty: r.group.remainingOutput,
            deadline: r.group.deadline,
          });
          ok++;
        } catch (err) {
          failed++;
          errors.push(
            `${r.group.factoryPO}/${r.group.size}: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
      if (ok > 0) {
        toast.success(`Generated ${ok} shipment batch${ok === 1 ? "" : "es"}`, {
          description: failed > 0 ? `${failed} failed` : `Total planned qty: ${totalPlanned.toLocaleString()}`,
        });
      } else if (failed > 0) {
        toast.error("All batches failed", { description: errors[0] });
      }
      // Reset planned map + refetch batches.
      setPlannedMap({});
      setPlannedErrors({});
      qc.invalidateQueries({ queryKey: ["shipment-batches"] });
      bumpRefresh();
    } finally {
      setGenerating(false);
    }
  }

  // ----------------------- export shipment Excel (IN PO [Color] format) ----
  const [exporting, setExporting] = React.useState(false);

  async function handleExportShipment() {
    setExporting(true);
    try {
      // Build planned outputs map from the current plannedMap.
      const plannedOutputs: Record<string, number> = {};
      for (const r of rowsForGeneration) {
        const normSize = r.group.size.replace(/\s+/g, " ").trim();
        const key = `${r.group.poNo}|${r.group.factoryPO}|${normSize}|${r.group.colorCode}`;
        plannedOutputs[key] = r.planned;
      }
      // Determine which color codes to export.
      const colorCodes = committed.colorCode
        ? [committed.colorCode]
        : [...new Set(rowsForGeneration.map((r) => {
            const m = r.group.colorCode.match(/\(([A-Z]+)\)/);
            return m ? m[1] : "";
          }).filter(Boolean))];

      const blob = await api.exportShipment({
        productType: currentProduct,
        date: committed.date || undefined,
        colorCodes,
        plannedOutputs,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const today = committed.date || new Date().toISOString().slice(0, 10);
      a.download = `Daily_Shipment_${today}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Shipment exported`, {
        description: `${colorCodes.length} color sheet(s) + DAILY SHIPMENT SUMMARY`,
      });
    } catch (e) {
      toast.error("Export failed", { description: e instanceof Error ? e.message : "" });
    } finally {
      setExporting(false);
    }
  }

  // ----------------------- delete batch -----------------------
  async function handleDeleteBatch() {
    if (!deleteBatchId) return;
    setDeletingBatch(true);
    try {
      await api.deleteShipmentBatch(deleteBatchId);
      toast.success("Batch deleted");
      qc.invalidateQueries({ queryKey: ["shipment-batches"] });
      setDeleteBatchId(null);
    } catch (err) {
      toast.error("Failed to delete batch", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setDeletingBatch(false);
    }
  }

  // ----------------------- derived -----------------------
  const summary = groupsQuery.data?.summary;
  const groups = groupsQuery.data?.groups ?? [];
  const surplusData = surplusQuery.data;
  const batches = batchesQuery.data?.batches ?? [];

  return (
    <div className="space-y-6">
      {/* Header banner */}
      <div
        className={cn(
          "relative overflow-hidden rounded-xl bg-gradient-to-r p-5 text-white shadow-sm",
          theme.gradient
        )}
      >
        <div className="absolute -right-12 -top-12 h-40 w-40 rounded-full bg-white/15" />
        <div className="absolute -bottom-16 -right-32 h-56 w-56 rounded-full bg-white/10" />
        <div className="absolute -bottom-8 right-24 h-24 w-24 rounded-full bg-white/10" />
        <div className="relative flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/20 backdrop-blur">
              <Truck className="h-6 w-6" />
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider opacity-90">
                Daily Shipment Planning
              </div>
              <h1 className="text-2xl font-bold leading-tight">
                Daily Shipment Planning · {currentProduct}
              </h1>
              <p className="mt-0.5 text-xs opacity-90">
                Plan today&apos;s output and detect surplus-to-short transfers automatically.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              className="bg-white/20 text-white hover:bg-white/30"
              onClick={() => bumpRefresh()}
              disabled={groupsQuery.isFetching}
            >
              {groupsQuery.isFetching ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              )}
              Refresh
            </Button>
          </div>
        </div>
      </div>

      {/* Filter bar */}
      <FilterBar
        form={form}
        onFormChange={(next) => setForm((f) => ({ ...f, ...next }))}
        colors={colorsQuery.data ?? []}
        factoryPOs={factoryPOsQuery.data ?? []}
        poNos={poNosQuery.data ?? []}
        sizes={sizesQuery.data ?? []}
        colorsLoading={colorsQuery.isLoading}
        factoryPOsLoading={factoryPOsQuery.isLoading}
        poNosLoading={poNosQuery.isLoading}
        sizesLoading={sizesQuery.isLoading}
        onApply={applyFilters}
        onReset={resetFilters}
        applying={applying}
      />

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <KpiCard
          label="Total Order"
          value={fmt(summary?.totalOrder)}
          sub={`${summary?.totalGroups ?? 0} groups`}
          icon={ClipboardList}
          iconClass="bg-slate-100 text-slate-700 dark:bg-slate-800/60 dark:text-slate-200"
          loading={groupsQuery.isLoading}
        />
        <KpiCard
          label="Total Output"
          value={fmt(summary?.totalOutput)}
          sub="Shipped so far"
          icon={Truck}
          iconClass="bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
          loading={groupsQuery.isLoading}
        />
        <KpiCard
          label="Remaining Output"
          value={fmt(summary?.totalRemainingOutput)}
          sub="Order − Output"
          icon={Package}
          iconClass="bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
          loading={groupsQuery.isLoading}
        />
        <KpiCard
          label="Total Input"
          value={fmt(summary?.totalInput)}
          sub="Received back"
          icon={CheckCircle2}
          iconClass="bg-teal-100 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300"
          loading={groupsQuery.isLoading}
        />
        <KpiCard
          label="Surplus"
          value={fmt(summary?.totalSurplus)}
          sub={`${summary?.surplusCount ?? 0} surplus rows`}
          icon={Sparkles}
          iconClass="bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
          loading={groupsQuery.isLoading}
        />
        <KpiCard
          label="Short Output"
          value={String(summary?.shortOutputCount ?? 0)}
          sub="Rows with deficit"
          icon={AlertTriangle}
          iconClass="bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
          loading={groupsQuery.isLoading}
        />
      </div>

      {/* Surplus panel — show only if surplus exists */}
      {surplusData && surplusData.surplusSources.length > 0 ? (
        <SurplusPanel
          data={surplusData}
          loading={surplusQuery.isLoading}
          onReviewProposal={(p) => setSelectedProposal(p)}
        />
      ) : null}

      {/* Main planning table */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Package className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                Shipment Plan — {currentProduct}
              </CardTitle>
              <CardDescription className="mt-1 text-xs">
                Set the planned output per row (≤ remaining output). Then click{" "}
                <span className="font-semibold">Generate Shipment</span> to create draft batches.
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={autoFillRemaining} disabled={groupsQuery.isLoading || groups.length === 0}>
                <Zap className="mr-1.5 h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                Auto Fill Remaining
              </Button>
              <Button variant="outline" size="sm" onClick={clearPlanned} disabled={Object.keys(plannedMap).length === 0}>
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                Clear Planned
              </Button>
              <Button variant="outline" size="sm" onClick={() => setPreviewOpen(true)} disabled={groupsQuery.isLoading || rowsForGeneration.length === 0}>
                <Eye className="mr-1.5 h-3.5 w-3.5" />
                Preview ({rowsForGeneration.length})
              </Button>
              <Button
                size="sm"
                className="bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-700 dark:hover:bg-emerald-600"
                onClick={handleGenerate}
                disabled={groupsQuery.isLoading || rowsForGeneration.length === 0 || hasAnyError || generating}
              >
                {generating ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Send className="mr-1.5 h-3.5 w-3.5" />
                )}
                Generate Shipment
                {rowsForGeneration.length > 0 ? ` (${rowsForGeneration.length})` : ""}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportShipment}
                disabled={exporting || groups.length === 0}
              >
                {exporting ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="mr-1.5 h-3.5 w-3.5" />
                )}
                Export Excel (IN PO)
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Aggregate planned summary */}
          <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2 text-xs">
            <span className="font-medium">Total planned: </span>
            <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
              {fmt(totalPlanned)}
            </Badge>
            {hasAnyError ? (
              <Badge className="bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
                <AlertTriangle className="mr-1 h-3 w-3" /> {Object.keys(plannedErrors).length} row(s) with errors
              </Badge>
            ) : (
              <Badge variant="outline" className="gap-1 text-emerald-700 dark:text-emerald-300">
                <ShieldCheck className="h-3 w-3" /> All valid
              </Badge>
            )}
            <span className="ml-auto text-muted-foreground">
              {groups.length} shipment group{groups.length === 1 ? "" : "s"} ·{" "}
              {summary?.balancedCount ?? 0} balanced ·{" "}
              {summary?.surplusCount ?? 0} surplus ·{" "}
              {summary?.shortOutputCount ?? 0} short
            </span>
          </div>

          {groupsQuery.isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : groupsQuery.isError ? (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Failed to load shipment groups</AlertTitle>
              <AlertDescription>
                {groupsQuery.error instanceof Error
                  ? groupsQuery.error.message
                  : String(groupsQuery.error)}
              </AlertDescription>
            </Alert>
          ) : groups.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                <Inbox className="h-6 w-6" />
              </div>
              <p className="mt-3 text-sm font-medium">No shipment groups</p>
              <p className="mt-1 max-w-md text-xs text-muted-foreground">
                No {currentProduct} rows match the current filters. Try clearing
                filters or picking another color.
              </p>
            </div>
          ) : (
            <div className="max-h-[640px] overflow-auto scroll-thin rounded-lg border">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-muted/95 backdrop-blur">
                  <TableRow>
                    <TableHead className="min-w-[140px]">Color</TableHead>
                    <TableHead className="min-w-[110px]">PO NO#</TableHead>
                    <TableHead className="min-w-[120px]">Factory PO</TableHead>
                    <TableHead className="min-w-[80px]">Size</TableHead>
                    <TableHead className="text-right">Order</TableHead>
                    <TableHead className="text-right">Output</TableHead>
                    <TableHead className="text-right">Input</TableHead>
                    <TableHead className="text-right">Remaining Output</TableHead>
                    <TableHead className="text-right">Surplus</TableHead>
                    <TableHead className="min-w-[110px]">Planned Output</TableHead>
                    <TableHead className="min-w-[110px]">Deadline</TableHead>
                    <TableHead className="min-w-[100px]">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groups.map((g) => {
                    const meta = STATUS_META[g.status];
                    const planned = plannedMap[g.key] ?? 0;
                    const error = plannedErrors[g.key];
                    const overdue = isOverdue(g.deadline);
                    return (
                      <TableRow key={g.key} className={cn("hover:bg-muted/40", meta.row)}>
                        <TableCell className="font-medium">
                          <div className="flex flex-col">
                            <span className="text-xs">{g.colorCode || "—"}</span>
                            {g.colorCode2 ? (
                              <span className="text-[10px] text-muted-foreground">
                                {g.colorCode2.length > 28 ? `${g.colorCode2.slice(0, 26)}…` : g.colorCode2}
                              </span>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{g.poNo}</TableCell>
                        <TableCell className="font-mono text-xs">{g.factoryPO}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="font-mono text-[11px]">
                            {g.size}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{fmt(g.orderQty)}</TableCell>
                        <TableCell className="text-right tabular-nums text-amber-700 dark:text-amber-300">
                          {fmt(g.outputQty)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-emerald-700 dark:text-emerald-300">
                          {fmt(g.inputQty)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-semibold">
                          {fmt(g.remainingOutput)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {g.surplus > 0 ? (
                            <span className="font-semibold text-amber-700 dark:text-amber-300">
                              +{fmt(g.surplus)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">0</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min={0}
                            inputMode="numeric"
                            placeholder={String(g.remainingOutput)}
                            value={planned === 0 ? "" : String(planned)}
                            onChange={(e) => handlePlannedChange(g, e.target.value)}
                            className={cn(
                              "h-8 w-24 tabular-nums",
                              error
                                ? "border-rose-400 focus-visible:ring-rose-300"
                                : planned > 0
                                ? "border-emerald-400 focus-visible:ring-emerald-300"
                                : ""
                            )}
                            disabled={g.remainingOutput <= 0}
                          />
                          {error ? (
                            <div className="mt-0.5 text-[10px] text-rose-600 dark:text-rose-400">
                              {error}
                            </div>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className={cn(overdue ? "text-rose-700 dark:text-rose-300 font-semibold" : "")}>
                              {formatDate(g.deadline)}
                            </span>
                            {overdue ? (
                              <span className="text-[10px] uppercase tracking-wide text-rose-600 dark:text-rose-400">
                                Overdue
                              </span>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={cn("gap-1", meta.badge)}>
                            <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
                            {meta.label}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Shipment batches list */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Send className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                Shipment Batches — {currentProduct}
              </CardTitle>
              <CardDescription className="mt-1 text-xs">
                Draft batches created from this view. Edit a batch to confirm or export.
              </CardDescription>
            </div>
            <Badge variant="outline" className="text-[11px]">
              {batches.length} batch{batches.length === 1 ? "" : "es"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {batchesQuery.isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : batchesQuery.isError ? (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Failed to load batches</AlertTitle>
              <AlertDescription>
                {batchesQuery.error instanceof Error
                  ? batchesQuery.error.message
                  : String(batchesQuery.error)}
              </AlertDescription>
            </Alert>
          ) : batches.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-10 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                <Inbox className="h-6 w-6" />
              </div>
              <p className="mt-3 text-sm font-medium">No shipment batches yet</p>
              <p className="mt-1 max-w-md text-xs text-muted-foreground">
                Set planned output on the rows above and click{" "}
                <span className="font-semibold">Generate Shipment</span> to create draft batches.
              </p>
            </div>
          ) : (
            <div className="max-h-96 overflow-auto scroll-thin rounded-lg border">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-muted/95 backdrop-blur">
                  <TableRow>
                    <TableHead>Batch #</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Color</TableHead>
                    <TableHead>PO NO#</TableHead>
                    <TableHead>Factory PO</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead className="text-right">Order</TableHead>
                    <TableHead className="text-right">Prev. Output</TableHead>
                    <TableHead className="text-right">Planned</TableHead>
                    <TableHead className="text-right">Remaining</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {batches.map((b) => {
                    const meta = BATCH_STATUS_META[b.status] ?? BATCH_STATUS_META.DRAFT;
                    return (
                      <TableRow key={b.id} className="hover:bg-muted/40">
                        <TableCell className="font-mono text-xs">{b.batchNumber}</TableCell>
                        <TableCell className="text-xs">{formatDate(b.date)}</TableCell>
                        <TableCell className="text-xs">{b.colorCode}</TableCell>
                        <TableCell className="font-mono text-xs">{b.poNo}</TableCell>
                        <TableCell className="font-mono text-xs">{b.factoryPO}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="font-mono text-[11px]">
                            {b.size}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{fmt(b.orderQty)}</TableCell>
                        <TableCell className="text-right tabular-nums text-amber-700 dark:text-amber-300">
                          {fmt(b.previousOutput)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-semibold text-emerald-700 dark:text-emerald-300">
                          {fmt(b.plannedQty)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{fmt(b.remainingQty)}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={meta.badge}>
                            {meta.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-destructive hover:bg-rose-50 hover:text-destructive dark:hover:bg-rose-950/30"
                            onClick={() => setDeleteBatchId(b.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Preview dialog */}
      <PreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        rows={rowsForGeneration}
        totalPlanned={totalPlanned}
        date={committed.date || todayLocalISO()}
        productType={currentProduct}
        onConfirm={handleGenerate}
        generating={generating}
      />

      {/* Transfer proposal dialog */}
      <TransferProposalDialog
        proposal={selectedProposal}
        onClose={() => setSelectedProposal(null)}
      />

      {/* Delete batch alert dialog */}
      <AlertDialog
        open={Boolean(deleteBatchId)}
        onOpenChange={(o) => !o && setDeleteBatchId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-4 w-4" />
              Delete Shipment Batch
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this shipment batch? This action
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingBatch}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteBatch}
              disabled={deletingBatch}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletingBatch ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              )}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Surplus panel
// ----------------------------------------------------------------------------

function SurplusPanel({
  data,
  loading,
  onReviewProposal,
}: {
  data: SurplusResponse;
  loading: boolean;
  onReviewProposal: (p: TransferProposal) => void;
}) {
  return (
    <Card className="border-amber-200 bg-gradient-to-br from-amber-50/70 via-orange-50/40 to-rose-50/60 dark:border-amber-900/40 dark:from-amber-950/20 dark:via-orange-950/10 dark:to-rose-950/20">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base text-amber-800 dark:text-amber-300">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-200 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
                <ArrowLeftRight className="h-4 w-4" />
              </span>
              Surplus Transfer Suggestions
            </CardTitle>
            <CardDescription className="mt-1 text-xs">
              {data.surplusSources.length} surplus source{data.surplusSources.length === 1 ? "" : "s"} ·{" "}
              {data.proposals.length} transfer proposal{data.proposals.length === 1 ? "" : "s"} (within same PO NO# + Color + Size).
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <Skeleton className="h-32 w-full" />
        ) : (
          <>
            {/* Surplus sources */}
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">
                Surplus Sources
              </div>
              <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                {data.surplusSources.map((s) => (
                  <div
                    key={s.key}
                    className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-xs dark:border-amber-900/40 dark:bg-amber-950/20"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-semibold">{s.factoryPO}</span>
                      <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                        +{fmt(s.surplus)} surplus
                      </Badge>
                    </div>
                    <div className="mt-1 text-muted-foreground">
                      PO: <span className="font-mono">{s.poNo}</span> · Size{" "}
                      <span className="font-mono">{s.size}</span>
                    </div>
                    <div className="mt-1 text-muted-foreground">
                      Order: {fmt(s.orderQty)} · Output: {fmt(s.outputQty)}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Transfer proposals */}
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">
                Transfer Proposals
              </div>
              {data.proposals.length === 0 ? (
                <div className="rounded-lg border border-dashed border-amber-200 p-4 text-xs text-muted-foreground dark:border-amber-900/40">
                  No matching destinations found for the current surplus sources
                  (must share PO NO# + Color + Size).
                </div>
              ) : (
                <div className="grid gap-2 md:grid-cols-2">
                  {data.proposals.map((p, i) => (
                    <div
                      key={`${p.source.key}-${p.destination.key}-${i}`}
                      className="rounded-lg border bg-card p-3 text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-semibold text-amber-700 dark:text-amber-300">
                          {p.source.factoryPO}
                        </span>
                        <ArrowRight className="h-3 w-3 text-muted-foreground" />
                        <span className="font-mono font-semibold text-rose-700 dark:text-rose-300">
                          {p.destination.factoryPO}
                        </span>
                        <Badge className="ml-auto bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                          Move {fmt(p.transferQty)}
                        </Badge>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
                        <div>
                          Source surplus after:{" "}
                          <span className="font-semibold text-foreground">
                            {fmt(p.sourceRemainingSurplus)}
                          </span>
                        </div>
                        <div>
                          Dest. capacity after:{" "}
                          <span className="font-semibold text-foreground">
                            {fmt(p.destinationRemainingCapacity)}
                          </span>
                        </div>
                        <div>
                          PO: <span className="font-mono">{p.destination.poNo}</span>
                        </div>
                        <div>
                          Size: <span className="font-mono">{p.destination.size}</span>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-2 h-7 w-full"
                        onClick={() => onReviewProposal(p)}
                      >
                        <Eye className="mr-1.5 h-3 w-3" /> Review Transfer
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ----------------------------------------------------------------------------
// Preview dialog
// ----------------------------------------------------------------------------

function PreviewDialog({
  open,
  onOpenChange,
  rows,
  totalPlanned,
  date,
  productType,
  onConfirm,
  generating,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: { group: ShipmentGroup; planned: number }[];
  totalPlanned: number;
  date: string;
  productType: string;
  onConfirm: () => void;
  generating: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-auto scroll-thin">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Eye className="h-4 w-4" />
            Preview Shipment Batches
          </DialogTitle>
          <DialogDescription>
            {rows.length} batch{rows.length === 1 ? "" : "es"} will be created for{" "}
            <span className="font-semibold">{productType}</span> on{" "}
            <span className="font-semibold">{date}</span>. Total planned qty:{" "}
            <span className="font-semibold text-emerald-700 dark:text-emerald-300">
              {fmt(totalPlanned)}
            </span>
            .
          </DialogDescription>
        </DialogHeader>

        {rows.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            No rows have a planned quantity yet.
          </div>
        ) : (
          <div className="max-h-[55vh] overflow-auto scroll-thin rounded-lg border">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-muted/95 backdrop-blur">
                <TableRow>
                  <TableHead>Color</TableHead>
                  <TableHead>PO NO#</TableHead>
                  <TableHead>Factory PO</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead className="text-right">Remaining</TableHead>
                  <TableHead className="text-right">Planned</TableHead>
                  <TableHead>Deadline</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(({ group, planned }) => (
                  <TableRow key={group.key}>
                    <TableCell className="text-xs">{group.colorCode}</TableCell>
                    <TableCell className="font-mono text-xs">{group.poNo}</TableCell>
                    <TableCell className="font-mono text-xs">{group.factoryPO}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-mono text-[11px]">
                        {group.size}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(group.remainingOutput)}</TableCell>
                    <TableCell className="text-right tabular-nums font-semibold text-emerald-700 dark:text-emerald-300">
                      {fmt(planned)}
                    </TableCell>
                    <TableCell className={cn(isOverdue(group.deadline) ? "text-rose-700 dark:text-rose-300 font-semibold" : "")}>
                      {formatDate(group.deadline)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={generating}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              onConfirm();
            }}
            disabled={rows.length === 0 || generating}
            className="bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-700 dark:hover:bg-emerald-600"
          >
            {generating ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="mr-1.5 h-3.5 w-3.5" />
            )}
            Generate {rows.length} Batch{rows.length === 1 ? "" : "es"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ----------------------------------------------------------------------------
// Transfer proposal dialog
// ----------------------------------------------------------------------------

function TransferProposalDialog({
  proposal,
  onClose,
}: {
  proposal: TransferProposal | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={Boolean(proposal)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-amber-800 dark:text-amber-300">
            <ArrowLeftRight className="h-4 w-4" />
            Review Surplus Transfer
          </DialogTitle>
          <DialogDescription>
            Suggested move between two Factory POs sharing the same PO NO#, Color, and Size.
          </DialogDescription>
        </DialogHeader>

        {proposal ? (
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              {/* Source */}
              <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-900/40 dark:bg-amber-950/20">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                  Source (Surplus)
                </div>
                <div className="font-mono text-sm font-semibold">{proposal.source.factoryPO}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  PO: <span className="font-mono">{proposal.source.poNo}</span>
                  <br />
                  Size: <span className="font-mono">{proposal.source.size}</span>
                  <br />
                  Order: {fmt(proposal.source.orderQty)} · Output: {fmt(proposal.source.outputQty)}
                  <br />
                  Surplus: <span className="font-semibold text-amber-700 dark:text-amber-300">+{fmt(proposal.source.surplus)}</span>
                </div>
              </div>

              {/* Destination */}
              <div className="rounded-lg border border-rose-200 bg-rose-50/60 p-3 dark:border-rose-900/40 dark:bg-rose-950/20">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-rose-700 dark:text-rose-300">
                  Destination (Short)
                </div>
                <div className="font-mono text-sm font-semibold">{proposal.destination.factoryPO}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  PO: <span className="font-mono">{proposal.destination.poNo}</span>
                  <br />
                  Size: <span className="font-mono">{proposal.destination.size}</span>
                  <br />
                  Order: {fmt(proposal.destination.orderQty)} · Output: {fmt(proposal.destination.outputQty)}
                  <br />
                  Capacity: <span className="font-semibold text-rose-700 dark:text-rose-300">{fmt(proposal.destination.remainingCapacity)}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-center gap-2 rounded-lg border bg-muted/40 py-3">
              <span className="text-sm text-muted-foreground">Transfer</span>
              <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 text-base">
                {fmt(proposal.transferQty)}
              </Badge>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                from {proposal.source.factoryPO} → {proposal.destination.factoryPO}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
              <div>
                Source surplus after:{" "}
                <span className="font-semibold text-foreground">
                  {fmt(proposal.sourceRemainingSurplus)}
                </span>
              </div>
              <div>
                Dest. capacity after:{" "}
                <span className="font-semibold text-foreground">
                  {fmt(proposal.destinationRemainingCapacity)}
                </span>
              </div>
            </div>

            <Alert className="border-emerald-200 bg-emerald-50/60 dark:border-emerald-900/40 dark:bg-emerald-950/20">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <AlertTitle className="text-sm text-emerald-800 dark:text-emerald-300">
                Transfer is valid
              </AlertTitle>
              <AlertDescription className="text-xs">
                This transfer does not exceed the source surplus or the
                destination&apos;s remaining capacity. After the transfer, both
                rows can be planned for shipment.
              </AlertDescription>
            </Alert>
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            <Download className="mr-1.5 h-3.5 w-3.5" /> Export Note
          </Button>
          <Button onClick={onClose} className="bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-700 dark:hover:bg-emerald-600">
            <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" /> Acknowledge
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
