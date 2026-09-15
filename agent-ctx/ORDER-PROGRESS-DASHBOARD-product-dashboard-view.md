# ORDER-PROGRESS-DASHBOARD — Work Record

**Task ID:** ORDER-PROGRESS-DASHBOARD
**Agent:** general-purpose
**Target file:** `src/components/views/product-dashboard-view.tsx`
**Prior context read:** `/home/z/my-project/worklog.md` (DASHBOARD-INSIGHTS-1, REPORT-ENHANCE-1, etc.)

## Objective
Add a 5-tab system below the existing insights section in the Product Dashboard view. The existing dashboard content (KPI cards, Health Score, Deadline Alerts, Data Quality, Quick Stats, Charts, Alert Table, Production by Dimension) is wrapped in the "Overview" tab. Four new tabs are added: "Order Progress", "Daily Activity", "Anomaly Detection", "Data Change History".

## Backend APIs (already built — verified before edits)
- `api.getOrderProgress({ productType, poNo?, factoryPO?, dateFrom?, dateTo?, mode?, asOfDate? })` →
  - `summary` (16 fields: totalOrderQty, totalOutputQty, totalInputQty, pending, remaining, avgOutputProgress, avgInputProgress, avgInputVsOutput, totalOrders, notStarted, inProgress, outputCompleted, inputCompleted, overOutput, overInput, anomalyCount)
  - `dailySnapshots` array (12 fields incl. `status` from `NOT_STARTED|IN_PROGRESS|OUTPUT_COMPLETED|INPUT_COMPLETED|OVER_OUTPUT|OVER_INPUT|INPUT_IN_PROGRESS`)
  - `anomalies` array ({ type, severity, key, poNo, factoryPO, size, description, ...extra })
- `api.getDataChangeHistory({ productType, dateFrom?, dateTo?, limit? })` →
  - `history` array ({ id, timestamp, user, action, entityType, entityId, oldValue, newValue, detail, productType })
  - `summary` ({ total, byAction: Record<string, number> })

Anomaly types returned by the API: `OVER_OUTPUT` (severity ERROR), `INPUT_EXCEEDS_OUTPUT` (severity ERROR), `DEADLINE_RISK` (severity HIGH | MEDIUM).
AuditLog actions (from `prisma/schema.prisma`): `IMPORT | EDIT | DELETE | EXPORT | ENTRY_CREATE | ENTRY_EDIT | ENTRY_DELETE`.

## Changes made

### 1. Imports added
- shadcn Tabs primitives: `Tabs, TabsList, TabsTrigger, TabsContent` from `@/components/ui/tabs`.
- Lucide icons: `LayoutDashboard, BarChart3, History as HistoryIcon, Bug, CheckCircle2, Clock, User as UserIcon, Database, PlusCircle, PencilLine, Trash2, Download, CircleDot, Hourglass, PackageCheck as PackageCheck2, AlertOctagon, TimerReset`.
- Recharts `BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend` were already imported by the existing file (no change needed).

### 2. New helpers added (above `ProductDashboardView`)
- `type DashboardTab = "overview" | "progress" | "daily" | "anomaly" | "history"`.
- `PROGRESS_STATUS_BADGE` map + `progressStatusBadgeClass(status)` + `progressStatusLabel(status)` — exactly the 7 status colours requested (NOT_STARTED=slate, IN_PROGRESS=amber, OUTPUT_COMPLETED=emerald, INPUT_COMPLETED=emerald, OVER_OUTPUT=rose, OVER_INPUT=rose, INPUT_IN_PROGRESS=teal).
- `anomalyToneClass(severity)` + `anomalyBadgeClass(severity)` — ERROR/HIGH → rose, MEDIUM/WARNING → amber, otherwise slate.
- `bucketAction(action)` — re-buckets raw AuditLog actions into CREATE / UPDATE / DELETE / IMPORT / EXPORT / OTHER with the requested colour mapping (CREATE=emerald, UPDATE=amber, DELETE=rose, IMPORT=teal).
- `formatTimestamp(s)` + `formatShortDate(s)` — safe date formatting for ISO strings.
- `MiniStat` sub-component — compact stat tile with icon chip + label + value + optional tone + sub-text, used by all 4 new tabs.

### 3. State + queries added (inside `ProductDashboardView`)
- `const [dashboardTab, setDashboardTab] = React.useState<DashboardTab>("overview");`
- `orderProgressQ = useQuery(["order-progress", currentProduct, appliedFilters, refreshKey], ...)` — passes `applied.poNo/factoryPO/dateFrom/dateTo` from the existing filter bar and auto-selects `mode: "range"` when a date range is applied, else `"current"`. `staleTime: 30_000` (matches existing pattern).
- `historyQ = useQuery(["data-change-history", currentProduct, appliedFilters, refreshKey], ...)` — `limit: 200`, same stale-time pattern.
- Derived memo: `anomalyTypeCounts` (grouped by anomaly `type`), `dailyActivityTotals` (sum of `dailyOutput` + `dailyInput`), `historyBuckets` (CREATE/UPDATE/DELETE/IMPORT/EXPORT/OTHER counts via `bucketAction`).
- `refreshKey` is part of every query key (existing convention) so the Refresh button re-fetches all tabs.

### 4. Tab system inserted
Placed immediately after the Error banner, before the existing KPI cards:

```tsx
<Tabs value={dashboardTab} onValueChange={(v) => setDashboardTab(v as DashboardTab)} className="space-y-4">
  <TabsList className="grid h-auto w-full grid-cols-2 sm:grid-cols-5">
    <TabsTrigger value="overview" ...>Overview</TabsTrigger>
    <TabsTrigger value="progress" ...>Order Progress</TabsTrigger>
    <TabsTrigger value="daily" ...>Daily Activity</TabsTrigger>
    <TabsTrigger value="anomaly" ...>Anomaly Detection</TabsTrigger>
    <TabsTrigger value="history" ...>Data Change History</TabsTrigger>
  </TabsList>
  <TabsContent value="overview"> ... existing content ... </TabsContent>
  <TabsContent value="progress"> ... </TabsContent>
  <TabsContent value="daily"> ... </TabsContent>
  <TabsContent value="anomaly"> ... </TabsContent>
  <TabsContent value="history"> ... </TabsContent>
</Tabs>
```

The `TabsList` uses `grid grid-cols-2 sm:grid-cols-5 w-full` so it renders as a 2-col grid on mobile and a single-row 5-col grid on desktop (overrides the default `inline-flex w-fit`).

### 5. Overview tab (existing content)
ALL existing dashboard content was wrapped inside `<TabsContent value="overview" className="space-y-6 outline-none">`. This includes:
- KPI cards (8)
- Production Health Score card
- Deadline Alert Center card
- Data Quality Summary card
- Quick Stats & Actions card
- Order vs Output vs Input chart
- Production by Date line chart
- Priority Alerts table
- Production by Size / Color / Model bar charts

Nothing else was changed — the Overview tab is the existing dashboard 1:1.

### 6. Tab 2 — Order Progress
- 8 stat cards (`grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8`): Total Order (slate), Total Output (amber), Total Input (emerald), Pending (amber, "output − input"), Remaining (slate, "order − output"), Avg Output % (auto-colours by threshold), Avg Input % (auto-colours), Input vs Output % (teal).
- 4 status cards (`grid grid-cols-2 lg:grid-cols-4`): Not Started (slate), In Progress (amber), Output Completed (emerald), Input Completed (emerald).
- 2 over-status cards (`grid grid-cols-2`): Over Output (rose), Over Input (rose) — both with `valueTone="text-rose-700 dark:text-rose-400"`.
- Daily Snapshots table with sticky header, `max-h-[500px] overflow-y-auto scroll-thin`. Columns: Date | Daily Output | Daily Input | Total Output | Total Input | Pending | Remaining | Output % | Input % | Input vs Output % | Status. Status badge uses `progressStatusBadgeClass()` (the 7-colour map). Output% / Input% cells use the existing `rateTone()` helper for emerald/amber/rose text.

### 7. Tab 3 — Daily Activity
- A `BarChart` (Recharts `ResponsiveContainer` at `h-80`) using `dailySnapshots` data: X-axis = `date` (formatted via `formatShortDate`), bars = `dailyOutput` (emerald `oklch(0.6 0.13 162)`, `maxBarSize=48`) + `dailyInput` (teal `oklch(0.6 0.1 195)`, `maxBarSize=48`). Includes `CartesianGrid`, `Tooltip` (with `formatShortDate` label formatter), and `Legend`.
- Below the chart: 2 summary cards (`grid grid-cols-1 sm:grid-cols-2`) — Total Daily Output (emerald) + Total Daily Input (teal) for the selected range, computed via `dailyActivityTotals` memo.

### 8. Tab 4 — Anomaly Detection
- Summary cards (`grid grid-cols-2 lg:grid-cols-4`): Total Anomalies (slate), Over Output (rose), Input Exceeds Output (rose), Deadline Risk (amber).
- Scrollable list (`max-h-[500px] space-y-2 overflow-y-auto scroll-thin`) of anomaly cards, each tinted by `anomalyToneClass(severity)` (rose for ERROR/HIGH, amber for MEDIUM/WARNING, slate otherwise). Each card shows: severity badge (rose/amber), type badge (mono), PO NO# (mono), Factory PO (mono), Size (mono badge), and description text.
- Empty state with `CheckCircle2` icon when no anomalies.

### 9. Tab 5 — Data Change History
- Summary cards (`grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5`): Total Changes (slate) + Create (emerald) + Update (amber) + Delete (rose) + Import (teal). Counts come from the `historyBuckets` memo (which re-buckets raw actions like `ENTRY_CREATE` → CREATE bucket).
- Timeline list inside a `Card` (`max-h-[500px] space-y-2 overflow-y-auto scroll-thin`). Each entry shows: user avatar (`UserIcon` in a muted circle), action badge (coloured via `bucketAction().badgeClass`), entity-type badge, user name, detail text, and a timestamp pill with `Clock` icon.
- Empty state with `HistoryIcon` when no changes.

### 10. Loading / error / empty states
- Each tab has its own loading skeleton (different layouts to match the tab content).
- Each tab has its own `Alert variant="destructive"` for query errors, with a "Try again" button calling `bumpRefresh()`.
- Each tab has an `EmptyState` with a contextual message when there is no data.

## Verification

### TypeScript
```
npx tsc --noEmit -p tsconfig.json 2>&1 | grep product-dashboard
```
Result: **no output** (zero TypeScript errors in the dashboard file).

### ESLint
```
npx eslint src/components/views/product-dashboard-view.tsx
```
Result: exit 0, no output (clean).

### Dev server log (runtime)
The dev server picked up the changes automatically. Subsequent `GET /` returns 200 OK, and the new APIs are being fetched successfully when switching tabs:
- `GET /api/order-progress?productType=MAFATE&mode=current 200` ✓
- `GET /api/data-change-history?productType=MAFATE&limit=200 200` ✓

### API sanity check (curl)
```
curl /api/order-progress?productType=MAFATE → 200
{
  "summary": { totalOrderQty:266823, totalOutputQty:276370, totalInputQty:251719, pending:24651,
               remaining:0, avgOutputProgress:103.6, avgInputProgress:94.3, avgInputVsOutput:91.1,
               totalOrders:5461, notStarted:326, inProgress:1057, outputCompleted:3991,
               inputCompleted:3515, overOutput:947, overInput:1061, anomalyCount:2008 },
  "dailySnapshots": [...312 days...],
  "anomalies": [...50 entries, types: OVER_OUTPUT / INPUT_EXCEEDS_OUTPUT / DEADLINE_RISK...]
}

curl /api/data-change-history?productType=MAFATE → 200
{
  "summary": { total:2, byAction: { "ENTRY_CREATE": 2 } },
  "history": [...2 entries with action="ENTRY_CREATE", entityType="OutputSlip", user="output-slip-ui"...]
}
```

## Preserved behaviour
- Existing filter bar still drives the new queries (poNo / factoryPO / dateFrom / dateTo flow through to order-progress + history).
- `bumpRefresh()` (Refresh button) still re-fetches all queries via the shared `refreshKey`.
- No existing imports, components, or styling were removed — only wrapped.
- All existing colour conventions maintained: emerald (input/completed), teal (input/completed input), amber (in-progress/warning), rose (over/error), slate (not started/neutral). No indigo / blue.

## File delta
- File grew from 1507 → 2467 lines (~960 new lines: 22 imports, ~180 lines of helpers/types/MiniStat component, ~60 lines of state + queries + derived memos, ~700 lines of new TabsContent sections).
- 0 backend changes — both APIs were already built.
- 0 type errors, 0 lint errors.
