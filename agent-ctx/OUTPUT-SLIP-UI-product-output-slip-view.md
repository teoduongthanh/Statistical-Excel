# Agent Context — Task OUTPUT-SLIP-UI

## Task
Create `/home/z/my-project/src/components/views/product-output-slip-view.tsx` — the BULK OUTPUT SLIP GENERATOR UI for the currently-selected product (MAFATE/ONYX/MIZUNO).

## Backend already built — called via `api.*` methods
- `api.getOutputSlipFactoryPOs(productType, poNo)` → `{ ok, groups: FactoryPOGroup[] }`
- `api.generateOutputSlip({ productType, poNo, slipMode, items, createdBy, note })` → `{ ok, slip }`
- `api.exportOutputSlip({ slipId, format })` → Blob (Excel)
- `api.confirmOutputSlip({ slipId, confirmedBy })` → `{ ok, slip, createdCount, errors }`
- `api.listOutputSlips({ productType, poNo, status, limit })` → `{ ok, slips }`
- `api.cancelOutputSlip(id)` → `{ ok, slip }`

## Work Log
- Read `worklog.md` (full prior history) to understand patterns used in `product-shipment-view.tsx` (similar multi-section product-scoped view).
- Verified the API client methods in `src/lib/api-client.ts` (lines 604-683) match the spec exactly — including the `confirmOutputSlip` endpoint that returns 400 with `{ ok:false, errors:[] }` on Remaining Output conflict (handled via `jsonOrThrow` which throws an Error whose `.message` is the joined errors string → surfaced as toast.error).
- Verified the backend service (`src/lib/output-slip-service.ts`) returns per-(factoryPO+size) Remaining Output = Order − Output.
- Confirmed the view is already registered in `src/app/page.tsx` (line 14 import, line 53 render), `src/components/layout/sidebar.tsx` (line 71 — Output Slips nav item), and `src/components/layout/header.tsx` (line 26 — title "Output Slip Generator").
- The file did NOT exist before — created it from scratch.

## What was built
A complete 1948-line `"use client"` React component named `ProductOutputSlipView` (named + default export). Implements all 7 spec sections:

1. **Header** — title + product context badge using `PRODUCT_THEME[currentProduct]`.
2. **Section 1: PO NO# Search** — text input + Search button + Enter-to-search; calls `api.getOutputSlipFactoryPOs(currentProduct, poNo)` with loading state and error Alert.
3. **Section 2: Factory PO List** — sticky-header table inside `max-h-[500px] overflow-y-auto scroll-thin`. Columns: checkbox, chevron, Factory PO, Model, Color, Deadline, Order, Output, Remaining (rose badge if > 0, slate badge if = 0), Status badge (amber READY TO OUTPUT / slate COMPLETED). Toolbar above table has Auto Priority switch (sorts READY first by nearest deadline), "Select All Ready" checkbox (selects only Factory POs with `totalRemaining > 0`), "Clear Selection" button.
4. **Section 3: Selected Factory PO Detail (expandable)** — clicking a row (or chevron) expands an inline per-size breakdown table: Size | Order | Output | Remaining | Qty to Output (Input). Default qty = `remainingOutput`. Validation: rose border + helper text if qty > remaining or qty < 0. Per-size totals row at bottom. Input disabled unless row selected (so the user ticks first, then adjusts).
5. **Section 4: Selection Summary** — 4 StatCards grid: Selected Factory POs, Selected Sizes, Total Remaining (with sub showing Total Order + Already Output), Total To Output.
6. **Section 5: Generate Slip** — themed "Generate Output Slip" button disabled when no FPO selected OR validation errors exist. Clicking opens a Dialog with summary + RadioGroup of 3 modes (combined / separate / group_by_color). "Confirm Generate" builds items[] (each (factoryPO,size) → 1 item), calls `api.generateOutputSlip`, on success: toast.success + sets `generatedSlip` state + closes dialog + `bumpRefresh()`.
7. **Section 6: Generated Slip Preview + Actions** — preview Card showing slip number, mode, status badges, meta line, items table with totals row. Action buttons:
   - Export Excel → `api.exportOutputSlip({ slipId, format: "multi_sheet" })` → downloads `Output_Slip_<slipNumber>.xlsx`.
   - Print → opens a new window with HTML table + calls `win.print()`.
   - Confirm Actual Output → `api.confirmOutputSlip({ slipId })` → on success: bumpRefresh + toast.success with createdCount. On conflict (400): toast.error showing the conflict message (Remaining Output changed). Disable buttons after status becomes `confirmed_output`.
   - Cancel Slip → opens AlertDialog → `api.cancelOutputSlip(id)`.
8. **Section 7: Existing Slips List** — `useQuery({ queryKey: ["output-slips", currentProduct, refreshKey], queryFn: ... })`. Sticky-header compact table with columns Slip# | PO NO# | Mode | Status | Factory POs | Total To Output | Created At | Actions (Export, Confirm, Cancel). Per-row spinner state via `exportingId`/`confirmingId` (separate state from the preview card so the spinner shows on whichever row is being acted on).

## State (matches the spec)
```tsx
const { currentProduct, bumpRefresh, refreshKey } = useAppStore();
const theme = PRODUCT_THEME[currentProduct];
const [poNoSearch, setPoNoSearch] = React.useState("");
const [poNo, setPoNo] = React.useState("");
const [groups, setGroups] = React.useState<FactoryPOGroup[]>([]);
const [loading, setLoading] = React.useState(false);
const [selectedFpos, setSelectedFpos] = React.useState<Set<string>>(new Set());
const [expandedFpo, setExpandedFpo] = React.useState<string | null>(null);
const [qtyToOutput, setQtyToOutput] = React.useState<Map<string, number>>(new Map());
const [autoPriority, setAutoPriority] = React.useState(false);
const [showModeDialog, setShowModeDialog] = React.useState(false);
const [slipMode, setSlipMode] = React.useState<SlipMode>("combined");
const [generating, setGenerating] = React.useState(false);
const [generatedSlip, setGeneratedSlip] = React.useState<SlipRecord | null>(null);
const [exportingId, setExportingId] = React.useState<string | null>(null);   // ← per-slip loader (preview + rows)
const [confirmingId, setConfirmingId] = React.useState<string | null>(null); // ← per-slip loader
const [showCancelDialog, setShowCancelDialog] = React.useState(false);
const [cancelTarget, setCancelTarget] = React.useState<SlipRecord | null>(null);
```

## Business rules honored
1. **REMAINING OUTPUT per (productType, poNo, factoryPO, size)** — the backend computes this in `getFactoryPOGroupsByPoNo` and the UI surfaces per-size remainingOutput; client validation enforces `qtyToOutput ≤ remainingOutput` per size.
2. **Generating a slip does NOT write to EntryData** — only `confirmOutputSlip` writes the real `2.Output` entries.
3. **Only Confirm Actual Output creates 2.Output entries** — handled via `api.confirmOutputSlip`.
4. **qtyToOutput ≤ remainingOutput** — client validation flags over-qty (rose border + helper text); the GENERATE button is disabled if any selected row has an over-qty error.
5. **"Select All Ready" only selects FPOs with remainingOutput > 0** — implemented as `readyGroups = groups.filter(g => g.totalRemaining > 0)`.
6. **Completed FPOs shown but NOT auto-selected** — they're rendered (with COMPLETED slate badge) but their checkbox is `disabled={g.status === "COMPLETED"}` so the user can't even manually tick them.

## Styling
- shadcn/ui components used: Card, CardContent, CardHeader, CardTitle, Button, Input, Label, Badge, Checkbox, Dialog/DialogContent/DialogHeader/DialogTitle/DialogDescription/DialogFooter, AlertDialog/AlertDialogAction/AlertDialogCancel/AlertDialogContent/AlertDialogDescription/AlertDialogFooter/AlertDialogHeader/AlertDialogTitle, RadioGroup/RadioGroupItem, Table/TableBody/TableCell/TableHead/TableHeader/TableRow, Switch, Alert/AlertDescription/AlertTitle, Skeleton.
- Icons from lucide-react: FileOutput, Search, CheckCircle2, AlertTriangle, AlertCircle, Loader2, Download, Printer, Check, X, ChevronDown, ChevronRight, RotateCcw, Truck, Filter, Clock, Boxes, Layers, Factory, Calendar, RefreshCw.
- Colors: emerald for ready/success, amber for warnings (READY TO OUTPUT status, Generated status), rose for errors (over-qty, Remaining badge > 0, cancelled status, danger button), slate for completed. Themed accent via `PRODUCT_THEME[currentProduct].bg` + `.badge`.
- `cn()` from `@/lib/utils`.
- `toast` from `sonner`.
- Tables use `max-h-[500px] overflow-y-auto scroll-thin` for scrolling.
- Sticky table headers via `sticky top-0 z-10 bg-muted/80 backdrop-blur`.
- Responsive: grids stack on mobile (`grid-cols-2 lg:grid-cols-4`), action bars use `flex flex-wrap`.
- `refreshKey` participates in the slips query key.

## Verification
- `npx tsc --noEmit -p tsconfig.json 2>&1 | grep product-output-slip-view` → no output (grep exit 1 = no matches = file is clean). All TS errors elsewhere are pre-existing in unrelated files (scripts/, examples/, skills/, some API routes).
- `npx eslint src/components/views/product-output-slip-view.tsx` → exit 0, clean.

## Files
- Created: `/home/z/my-project/src/components/views/product-output-slip-view.tsx` (1948 lines, named + default export `ProductOutputSlipView`).
- No other files modified (view was already registered in page.tsx / sidebar / header by a prior session).
