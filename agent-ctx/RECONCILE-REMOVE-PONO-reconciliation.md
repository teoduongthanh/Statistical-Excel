# RECONCILE-REMOVE-PONO — Remove PO NO# from Reconciliation

**Agent**: Z.ai Code (subagent)
**Task ID**: RECONCILE-REMOVE-PONO
**Scope**: Remove the PO NO# column entirely from the DATA RECONCILIATION & DUPLICATE CHECK feature. Comparison key becomes `Factory PO + Size` (no PO NO#).

## Files modified
1. `src/lib/reconciliation-service.ts`
2. `src/components/views/product-reconciliation-view.tsx`
3. `src/lib/api-client.ts`

(`src/app/api/reconcile/route.ts` was unchanged — it just passes through to the service.)

## What changed

### `src/lib/reconciliation-service.ts`
- Top-of-file comments updated: pipeline key now "FactoryPO+Size"; explicit note that comparison key is `Factory PO + Size` (PO NO# is NOT compared).
- Removed `poNo?` from `ReconciliationInput.excelRows`.
- Removed `poNo` from `ComparisonResult`, internal `GroupedRow`, internal `ExactDuplicate`.
- `groupAndSum()`: grouping key now `${factoryPO}|${size}` (was `${poNo}|${factoryPO}|${size}`).
- `findExactDuplicates()`: dedup key now `${date}|${factoryPO}|${size}|${qty}` (was `${date}|${poNo}|${factoryPO}|${size}|${qty}`).
- `reconcileData()`:
  - Excel normalization no longer extracts `row.poNo`; invalid-data check now requires only `factoryPO && size`.
  - Website fetch `select` no longer includes `poNo`.
  - Lookup indexes rebuilt without poNo: `websiteBySize` (size → distinct factoryPOs) and `websiteByFpo` (factoryPO → distinct sizes), replacing `websiteByPoSize` and `websiteByPoFpo`.
  - Every `ComparisonResult` push no longer carries `poNo`.
  - `POSSIBLE_WRONG_FACTORY_PO` now triggers when an Excel group's `(factoryPO, size)` is missing AND `websiteBySize.get(excel.size)` yields a different factoryPO.
  - `POSSIBLE_WRONG_SIZE` now triggers when `(factoryPO, size)` is missing AND no factoryPO candidate exists BUT `websiteByFpo.get(excel.factoryPO)` yields a different size.
- `ReconciliationSummary` unchanged (counts only).

### `src/components/views/product-reconciliation-view.tsx`
- `REQUIRED_FIELDS`: dropped `"poNo"` → `["date", "factoryPO", "size", "qty1"]`.
- `SAMPLE_PASTE_TEMPLATE` / `SAMPLE_PLACEHOLDER`: header `Date\tFactory PO\tSize\tQty` (4 cols); sample rows had their PO NO# column removed.
- `buildCanonicalRows()`: output type dropped `poNo?`; removed `ph = reverse.poNo` lookup + assignment.
- Helper texts updated: "Required columns: Date, Factory PO, Size, Qty" + "Date, Factory PO, Size, Q'ty 1."
- Preview Filtered Data table: removed `PO NO#` header + cell; `colSpan` 6 → 5.
- Comparison Results table: removed `PO NO#` header + cell; `colSpan` 8 → 7; row `key` from `${r.poNo}-${r.factoryPO}-${r.size}-${idx}` → `${r.factoryPO}-${r.size}-${idx}`.
- Detail Dialog: subtitle "Factory PO + Size" (was "PO NO# + Factory PO + Size"); identity grid `grid-cols-3` → `grid-cols-2` with only Factory PO + Size.
- `statusExplanation()` strings: dropped all PO NO# mentions; "Factory PO + Size" replaces "PO NO# + Factory PO + Size".
- Detail dialog suggestion panels: "same Size" / "same Factory PO" replace "same PO NO# + Size" / "same PO NO# + Factory PO"; EXACT_DUPLICATE description now "Date + Factory PO + Size + Qty".

### `src/lib/api-client.ts`
- `reconcileData()` method: removed `poNo?` from `excelRows` array element type; removed `poNo: string;` from `results` array element type. Added comment "Comparison key: Factory PO + Size (PO NO# is NOT compared)."

## Verification
- `npx tsc --noEmit -p tsconfig.json` filtered for the 3 modified files → **0 errors**.
- `npx eslint src/components/views/product-reconciliation-view.tsx src/lib/reconciliation-service.ts src/lib/api-client.ts` → **0 warnings, 0 errors**.
- Pre-existing tsc errors in unrelated views (login-dialog, quantity-check-view, shipment-planning-view, statistics-view, users-view) are NOT caused by this task — they reference api-client methods that don't exist in the current codebase.

## Key invariants preserved
- Date is filter-only (not a comparison key).
- Comparison key: `Factory PO + Size`.
- Qty summed per group before comparison.
- All 9 status types preserved: MATCHED, QTY_MISMATCH, MISSING_ON_WEBSITE, MISSING_IN_EXCEL, POSSIBLE_WRONG_FACTORY_PO, POSSIBLE_WRONG_SIZE, POSSIBLE_DUPLICATE, EXACT_DUPLICATE, INVALID_DATA.
