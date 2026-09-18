# ORDER-MONITOR-UI — Product Order Monitor View

## Task
Create `src/components/views/product-order-monitor-view.tsx` — unified Order Monitor view with 5 sub-views (Creation, Deadline, Daily, Matrix, Detail) consuming the existing `api.orderMonitor` 5-mode backend.

## Approach
Single-file `"use client"` component, ~2010 lines, structured as:
- Strong TypeScript types for each backend response shape (creation hierarchy, deadline list, matrix, daily timeline, detail flat list + summaries).
- Shared UI atoms (StatCard, ChartSkeleton, TableSkeleton, EmptyState, ErrorState, MiniProgress, StatusBadge(s), FilterBar).
- 5 mode-specific sub-view components, each with its own `useQuery` (lazy `enabled` via conditional mount inside `TabsContent`).
- Top-level state exactly as specified: `monitorView`, `createdFrom/To`, `deadlineFrom/To`, `asOfDate`, `search`, `expandedNodes`. Plus draft-vs-applied filter pattern (`applied` + `filtersVersion` for queryKey invalidation).

## Files
- `src/components/views/product-order-monitor-view.tsx` — NEW (~2010 lines).

## Verification
- `npx tsc --noEmit -p tsconfig.json 2>&1 | grep product-order-monitor` → no output (clean).
- `npx eslint src/components/views/product-order-monitor-view.tsx --max-warnings=0` → exit 0.
- `dev.log` empty — no runtime errors.
- View pre-registered in `page.tsx`, `app-store.ts` (ViewKey), sidebar, header — no registration changes needed.

## Notes for downstream agents
- Backend is READ-ONLY (no API changes made).
- All date displays go through `formatDateDisplay` (dd/MM/yyyy).
- Status tone mapping: NOT_STARTED=slate, IN_PROGRESS/INPUT_IN_PROGRESS=amber, OUTPUT_COMPLETED/INPUT_COMPLETED=emerald, OVER_OUTPUT/OVER_INPUT=rose. Detail-table rows are tinted by these tones.
- Search field performs client-side OR filtering across model/poNo/factoryPO/size (hierarchy pruning for creation mode, flat-list filter for deadline/matrix/daily/detail).
- Detail-table CSV export is client-side (Blob → download).
EOF
