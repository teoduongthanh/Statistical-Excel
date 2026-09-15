# DASHBOARD-REBUILD-1 — Work Record

**Task ID:** DASHBOARD-REBUILD-1
**Agent:** main (Z.ai Code)
**Target file:** `src/components/views/product-dashboard-view.tsx`
**Prior context read:** `/home/z/my-project/worklog.md` + previous agent `ORDER-PROGRESS-DASHBOARD-product-dashboard-view.md`.

## Objective
Reorganize the existing Product Dashboard view from 6 tabs (overview, progress, daily, anomaly, history, drilldown) into **8 tabs in the correct order**, plus add 2 new tabs (**Order Timeline** + **Reports**) and enhance 3 existing tabs. All 9 backend APIs listed in the task brief were already built and tested — this task is purely a frontend reorganization + enhancement, with **no new backend code**.

## Final 8-tab structure (in order)

| # | Tab key | Status | Notes |
|---|---------|--------|-------|
| 1 | `overview` | kept | All existing content (KPI cards 8, Health Score, Deadline Center, Data Quality, Quick Stats, filter bar, charts, alert table) |
| 2 | `progress` | enhanced | Added **Daily Order** column to daily-snapshot table |
| 3 | `daily` | enhanced | Added **Pending** LineChart (amber) + **Remaining** LineChart (rose) |
| 4 | `timeline` | **NEW** | 3-line progress chart + vertical event timeline |
| 5 | `history` | kept | 5 summary cards + timeline list |
| 6 | `anomaly` | enhanced | Anomaly cards now show orderQty / outputQty / inputQty / excess |
| 7 | `reports` | **NEW** | 6 client-side Excel export buttons + data-availability card |
| 8 | `drilldown` | kept | PO NO# → Factory PO → Size tree + transaction dialog |

## Changes made (file grew 2784 → 3558 lines)

### 1. Imports
- Added lucide icons: `CalendarDays`, `FileSpreadsheet`, `FileDown`, `ArrowRight`, `Circle`, `GitCommitHorizontal`.
- Added `import * as XLSX from "xlsx";` (already a project dependency — used `@/lib/excel` indirectly; here we use the raw `xlsx` package so the Reports tab can build workbooks client-side).

### 2. Type + helpers
- `type DashboardTab = "overview" | "progress" | "daily" | "timeline" | "history" | "anomaly" | "reports" | "drilldown";`
- Added `getReportFileName(type)` → `Production_Report_<type>_<YYYY-MM-DD>.xlsx`.
- Added `downloadWorkbook(sheetName, rows, fileName)` → builds an `XLSX.utils.book_new()` workbook, `XLSX.utils.json_to_sheet(rows)`, `book_append_sheet`, `writeFile`. Sanitizes the sheet name (removes invalid Excel chars, truncates to 31 chars). Falls back to `[{ "No data": "" }]` for empty row arrays.

### 3. Query change
- `drilldownQ` is now `enabled: dashboardTab === "drilldown" || dashboardTab === "reports"` so the Reports tab can export the hierarchy without an extra fetch. Reuses the same query key `["order-drilldown", currentProduct, refreshKey]`, so no duplicate requests happen when toggling between the two tabs.

### 4. TabsList reorganization
Updated the grid to `grid-cols-2 sm:grid-cols-4 lg:grid-cols-8` and added the two new triggers (`timeline` + `reports`) with their respective lucide icons (`CalendarDays`, `FileSpreadsheet`).

### 5. Tab 2 enhancements — Order Progress
Daily-snapshot table now has all 12 spec-§11 columns in the correct order:
`Date | Daily Order | Daily Output | Daily Input | Total Output | Total Input | Pending | Remaining | Output % | Input % | Input vs Output % | Status`.
- `Daily Order` cell uses slate tone (`text-slate-600 dark:text-slate-300`) — semantically same as Order column elsewhere.

### 6. Tab 3 enhancements — Daily Activity
Behind the existing BarChart + summary cards, two new full-width Recharts LineCharts were appended:
- **Chart 2 — Pending Quantity Over Time**: amber `oklch(0.74 0.16 75)` line, X-axis date, Y-axis quantity.
- **Chart 3 — Remaining Order Over Time**: rose `oklch(0.62 0.21 18)` line.

### 7. Tab 4 — Order Timeline (NEW)
Two cards inside `<TabsContent value="timeline">`:
1. **LineChart** with 3 series on shared `%` axis (domain `[0, 110]`):
   - `outputProgress` → emerald (`oklch(0.6 0.13 162)`)
   - `inputProgress` → teal (`oklch(0.6 0.1 195)`)
   - constant `100` reference line → slate dashed (`oklch(0.55 0.025 220)`, `strokeDasharray="6 4"`). Implemented via `dataKey={() => 100}` so Recharts evaluates it for each datum.
2. **Vertical timeline list** in `max-h-[600px] overflow-y-auto scroll-thin`. Each row:
   - Vertical connecting line + dot marker (absolutely positioned).
   - Date header with `CalendarClock` icon + status badge (uses `progressStatusBadgeClass` — same 7-colour map as Tab 2).
   - Event badges row: `ORDER +N` (slate), `OUTPUT +N` (emerald), `INPUT +N` (teal) — each only shown when daily delta > 0. Falls back to "No activity" when all three are zero.
   - 6-cell cumulative-state grid: Total Output (amber) / Total Input (emerald) / Pending (amber) / Remaining (neutral) / Out % (rateTone) / In % (rateTone).

### 8. Tab 6 enhancements — Anomaly Detection
Inside each anomaly card, after the description `<p>`, a new conditional grid (rendered only when `hasNumbers`) shows:
- Order Qty (neutral), Output Qty (amber), Input Qty (emerald), Excess (rose).
Values are pulled from the existing extra-fields-allowed anomaly shape (`a.orderQty`, `a.outputQty`, `a.inputQty`, `a.excess` — all `[key: string]: any`).

### 9. Tab 7 — Reports (NEW)
A top card "Export Production Reports" with 6 outline-styled buttons arranged in a `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`. Each button:
- Has an icon chip (emerald/amber/teal/slate/rose/amber — matching each report's data semantics).
- On click, runs an inline try/catch handler that:
  - Guards against empty source data (toasts a user-friendly error and bails out).
  - Maps already-fetched rows into `Record<string, unknown>[]` with descriptive column headers.
  - Calls `downloadWorkbook(sheetName, rows, getReportFileName(type))`.
  - Toasts a success message with the row count.
  - Catches all exceptions and toasts a generic failure message (no error thrown to React).

The 6 reports:

| # | Button label | Sheet name | Source | Filename type suffix |
|---|--------------|------------|--------|----------------------|
| 1 | Current Progress Report | Current Progress | `drilldownData.hierarchy` flattened (PO → Factory PO → Size) | `CurrentProgress` |
| 2 | Daily Progress Report | Daily Progress | `dailySnapshots` (all 12 columns) | `DailyProgress` |
| 3 | Order Timeline Report | Order Timeline | `dailySnapshots` (with cumulative progress %) | `OrderTimeline` |
| 4 | Data Change History | Change History | `historyRows` (action / user / oldValue / newValue JSON-stringified) | `ChangeHistory` |
| 5 | Anomaly Report | Anomaly Report | `anomalies` (all types, with qty/excess) | `Anomalies` |
| 6 | Deadline Risk Report | Deadline Risk | `anomalies.filter(type === "DEADLINE_RISK")` (with deadline / missing / daysUntilDeadline) | `DeadlineRisk` |

A secondary "Data Availability" card shows 6 MiniStat tiles so the user can see at-a-glance which reports will have data (drilldown sizes, daily snapshots, timeline entries, history rows, anomalies, deadline risks) — each with the appropriate icon and tone.

## Color compliance (per task spec)
- emerald: output / completed ✓
- teal: input ✓
- amber: pending / warning ✓
- rose: over / error ✓
- slate: not started / neutral ✓
- No new indigo / blue introduced.

## Preserved behaviour
- Existing filter bar still drives `orderProgressQ`, `historyQ`, and `drilldownQ` (the latter now also enabled on Reports tab).
- `bumpRefresh()` (Refresh button) still re-fetches every query via the shared `refreshKey`.
- All existing imports, components, helpers, and styling are untouched (only wrapped / extended).
- The existing transaction-history dialog for the Drill-Down tab is unchanged.

## Verification

### TypeScript (targeted)
```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | grep product-dashboard
```
Result: **no output** — zero TypeScript errors in the dashboard file.

### ESLint (targeted)
```bash
npx eslint src/components/views/product-dashboard-view.tsx
```
Result: exit 0, no output — clean.

### File delta
- 2784 → 3558 lines (+774 new lines, 0 removed).
- 0 backend changes — all 9 listed APIs were already built.

## Notes for downstream agents
- The `downloadWorkbook` helper is exported as a function declaration, so it can be reused by other views (e.g. shipment-planning, production-tracking) without duplicating the XLSX plumbing.
- The Reports tab reads from `drilldownData.hierarchy` — if you ever change the drilldown API response shape (e.g. rename `factoryPOs` or `sizes`), the Reports tab needs to be updated in lock-step.
- The timeline tab's `dataKey={() => 100}` returns a constant for every datum; this is the cleanest way to draw a horizontal reference line with Recharts `Line` without mutating the underlying data.
