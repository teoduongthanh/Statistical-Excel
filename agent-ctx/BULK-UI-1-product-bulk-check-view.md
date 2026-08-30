# BULK-UI-1 — ProductBulkCheckView

**Agent**: Z.ai Code (subagent)
**Task ID**: BULK-UI-1
**Scope**: UI view for the BULK DATA VALIDATION feature.

## Deliverable
`src/components/views/product-bulk-check-view.tsx` — single `"use client"` component, named + default export `ProductBulkCheckView`.

## What I built
Complete bulk-validation UI matching the design spec, with these sections:

1. **Header** — gradient banner using `PRODUCT_THEME[currentProduct].gradient`, title "Bulk Check · {currentProduct}", product badge + "Copy from Excel" hint.
2. **Paste Area** — large monospaced `<Textarea>` + "Check Data" button + "Clear" + "First row is header" Switch + parsed-row count badge.
3. **Column Mapping (Collapsible)** — per-column Select dropdowns (Excel column → canonical field); required fields marked with `*`; "❌ MISSING REQUIRED COLUMN" `Alert` if any required field unmapped; "Rebuild rows from mapping" button.
4. **Validation Summary** — 5 cards: Total Rows, Valid, Warning, Error, Products Affected.
5. **Filter Tabs** — VIEW ALL / VIEW VALID / VIEW WARNING / VIEW ERROR with row-count badges.
6. **Preview Data Table** — `max-h-[600px] overflow-y-auto scroll-thin`; columns: Row# | Status | PO NO# | Factory PO | Size | Qty (inline-editable) | Validation Result | Error. Status-tinted rows.
7. **Row Detail Dialog** — full breakdown: identity, current DB (Order/Output/Input), expected after-save totals, all errors/warnings with codes & severity badges.
8. **Grouped Errors** — `Card` with Table of grouped (poNo+factoryPO+size+errorCode) errors showing row numbers, current vs new totals, excess.
9. **Action Bar** — Cancel / Fix Data / Confirm Import (disabled when error rows exist).
10. **Import Preview Dialog** — totals + affected products + mode info → calls `api.bulkImport` with mode `"all_valid"`.

## Key behaviors
- Pasted-text parse: split `\n`/`\r\n` then `\t`; auto-detect header via known-alias heuristic.
- `buildAutoMapping` from `@/lib/header-normalize` used to map excel headers → canonical fields.
- Pre-flight check: refuses validation if any of `REQUIRED_FIELDS` (shippingStatus, poNo, factoryPO, size, qty1) is unmapped.
- Inline qty edit: pencil icon → Input (Enter to commit, Esc to cancel) → updates `rows` state → re-calls `api.bulkValidate`.
- After successful import: `toast.success()` + `bumpRefresh()` + full view reset.
- `refreshKey` captured (suppressed unused warning); reserved for query keys.

## Styling
- Colors: emerald (valid), amber (warning), rose (error), slate (neutral). NO indigo/blue.
- `PRODUCT_THEME[currentProduct]` used for accent (gradient, primary buttons, theme.text tone on "Products Affected" card).
- Responsive: grid stacks on mobile, multi-column on desktop; tabs scroll horizontally if needed.

## Verification
- `npx tsc --noEmit -p tsconfig.json 2>&1 | grep "product-bulk-check-view"` → **NO ERRORS** (other pre-existing project TS errors are unrelated to this file).
- `npx eslint src/components/views/product-bulk-check-view.tsx` → **passes** with no warnings.
- Dev server log shows `GET / 200` (compile successful).
