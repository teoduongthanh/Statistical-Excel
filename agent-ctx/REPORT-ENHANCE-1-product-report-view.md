# REPORT-ENHANCE-1 — Product Report View Enhancements

## Task
Add 3 enhancements to `src/components/views/product-report-view.tsx`:
1. Multi-error type filter (multi-select checkboxes, collapsible panel)
2. Variance % columns + sortable table columns
3. Variance badge in detail dialog

Backend `lib/report-service.ts` already exposes `outputVariancePercent` and `inputVariancePercent` on each `ReportGroup`.

## Approach (all client-side — no API/backend changes)
- Added new state: `selectedErrorTypes`, `showOnlyErrors`, `sortColumn`, `sortDirection`, `filterPanelOpen`.
- Mirrored backend type changes: extended `ErrorType` union with `DATA_ERROR`, added `outputVariancePercent` / `inputVariancePercent` to `ReportGroup`, added `DATA_ERROR` to `ERROR_TYPE_SEVERITY` (severity `WARNING`).
- Added `ALL_ERROR_TYPES` array (14 types in the exact order requested) and a `SORT_ACCESSORS` map keyed by sortable column id.
- Computed `errorTypeCounts` (Map<ErrorType, count>) and `filteredSortedGroups` via `useMemo`. Filtering = OR on selected error types + optional "errors only" filter. Sorting = 3-state (asc → desc → none) with string `localeCompare` for text columns and numeric compare for numbers; missing deadlines sort to the end.
- Table header replaced with `SortHeader` helper component showing ↑/↓ arrow (lucide `ArrowUp`/`ArrowDown`) on the active sort column.
- Added 2 new columns: **Output Var%** and **Input Var%** (between Input% and Deadline), rendered with `varianceColorClass` (emerald for positive excess, rose for negative deficit, muted-foreground for zero/missing). Updated `colSpan` from 17 → 18 (16 visible + 2 new).
- Added collapsible "Error Type Filter" `Card` above the report table containing a `Switch` ("Show Only Errors"), a `CollapsibleTrigger` ("Show/Hide Error Types"), "Select All Errors" + "Clear" buttons, and a responsive grid of checkboxes (one per error type) each showing the per-type count badge coloured by the error severity.
- Table now paginates / counts / empties on `filteredSortedGroups` (the filtered + sorted list), while the tab badge and export still use the full `groups`/`errors` arrays.
- Added "Variance Analysis" section to the row detail `Dialog` (between Progress and Status) with two `VarianceCard` components showing `from → to` quantities, signed delta, signed percent, and a proportional colored bar. `Output vs Order` uses orderQty → outputQty; `Input vs Output` uses outputQty → inputQty.

## Files changed
- `src/components/views/product-report-view.tsx` — extended types, added state/memos/handlers/UI atoms (SortHeader, VarianceCard), Error Type Filter panel, 2 new sortable variance columns, Variance Analysis dialog section. ~600 lines added; file grew from 1944 → 2548 lines.

## Verification
- `npx tsc --noEmit -p tsconfig.json 2>&1 | grep product-report` → no output (clean).
- `npx eslint src/components/views/product-report-view.tsx --max-warnings=0` → exit 0 (no errors / no warnings).
- `bun run lint` (project-wide) → no output (clean).

## Backward compatibility
- Filter bar, pagination, row selection, export, dashboard tab, data errors tab, and detail dialog existing sections (Product Info / Quantities / Progress / Status / Transaction History) all preserved untouched.
- API client and backend untouched — all filtering/sorting is purely client-side on the existing `groups` payload.
- `useEffect` resets all new state on `currentProduct` change to mirror existing product-reset behaviour.
