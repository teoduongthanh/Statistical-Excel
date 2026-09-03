# SMART-ENTRY-2 — Smart Entry Data System (4-level matching engine)

**Task ID:** SMART-ENTRY-2
**Agent:** main (Z.ai Code)
**Date:** 2026-05-21
**Status:** ✅ Complete

## Summary

Enhanced the existing Data Entry view (`src/components/views/product-data-entry-view.tsx`)
to implement a SMART ENTRY DATA SYSTEM with a 4-level matching engine. The
previous flow did only Level 1 (exact `lookupFactoryPO`); now the view calls
`POST /api/master-data/smart-lookup` which figures out the right level and
returns richer data (candidates, availableSizes, confidence).

## What was built

### 1. New API route — `src/app/api/master-data/smart-lookup/route.ts`

`POST /api/master-data/smart-lookup` accepting `{ productType, poNo?, factoryPO?, size? }`
and returning:

```ts
{
  ok: boolean;
  level: 0 | 1 | 2 | 3 | 4;
  confidence: "HIGH" | "MEDIUM" | "LOW" | "NONE";
  masterGroup?: MasterGroup;       // Levels 1-3
  candidates?: SmartCandidate[];  // Level 4
  availableSizes?: string[];      // Levels 1-3 (filtered by poNo when present)
}
```

Matching levels (highest priority first):
- **Level 1 — EXACT MATCH** (`HIGH`): all 4 fields match a row in MasterData.
- **Level 2 — FACTORY PO + PO NO#** (`MEDIUM`): factoryPO exists + poNo co-occurs,
  but size missing/invalid. Returns the subset of sizes valid for this combo.
- **Level 3 — FACTORY PO only** (`MEDIUM`): factoryPO found in MasterGroup, no
  poNo match. Returns the full MasterGroup + all sizes.
- **Level 4 — PARTIAL MATCH** (`LOW`): factoryPO not found exactly. Searches
  MasterGroup for entries ending with the last 3-4 chars of the input;
  falls back to `contains` if endsWith returns nothing. Returns up to 25
  candidates.
- **Level 0 — NONE**: nothing matched.

Server-side `normalizeSize()` helper is exported (trims spaces, removes line
breaks, collapses duplicate whitespace; preserves the T suffix so `M(10)` ≠
`M(10T)`).

### 2. New api-client method — `api.smartLookup(...)` in `src/lib/api-client.ts`

Typed wrapper around the new endpoint, returning the same shape. Inserted
right after `api.lookupFactoryPO` (which is kept untouched for backward
compatibility with other callers).

### 3. View enhancements — `src/components/views/product-data-entry-view.tsx`

**a. New state (added near existing autoFill):**
- `lookupLevel` (0/1/2/3/4), `lookupConfidence` ("HIGH"/"MEDIUM"/"LOW"/"NONE")
- `candidates` (Level 4 list), `availableSizes` (Level 1/2 filtered sizes)
- `previewOpen` (preview dialog visibility)

**b. Replaced the debounced `lookupFactoryPO` useEffect** with a `smartLookup`
call. The lookup now fires on any of `[factoryPO, poNo, size, currentProduct]`
change (was previously `[factoryPO, size, currentProduct]`). Lookup triggers
as soon as the user types a Factory PO — Level 3 by default, escalating to
Level 2 when a poNo is also set, and to Level 1 when a matching size is picked.

**c. `normalizeSize()` client-side helper** added at top of file (mirrors the
server one). Used in:
- `sizeIsValid` derived state (validates the typed size against `sizeOptions`).
- Size chip highlight (replaces the strict `size === s` check).
- Size dropdown suggestions still come from the SizeInput subcomponent.

**d. `sizeOptions` derived state** — prefers `availableSizes` (Level 1/2 —
filtered by poNo) and falls back to `autoFill.sizes` (Level 3 — all sizes for
the Factory PO). Drives the Size input dropdown + chips + count badge.

**e. `ConfidenceBadge` component** — emerald (HIGH), amber (MEDIUM), rose (LOW),
muted (NONE). Added to the Factory PO label area + to the Preview dialog header.

**f. Confidence-driven UI messaging** under the Factory PO field:
- Level 2: "Factory PO + PO NO# match — pick a Size from the filtered list below."
- Level 3 + poNo set: "PO NO# doesn't match any row for this Factory PO."
- "Factory PO not in Master Data" warning now hidden when candidates exist.

**g. Suggestion Panel (spec §3)** — appears below the form (inside the input
form column, after the Recent Entries card) when `candidates.length > 0`.
Renders each candidate as a clickable card showing Factory PO, deadline, PO NO#,
model, SKU, season, color badges (CC / CC2 / Paint / Print), and size summary.
Clicking calls `applyCandidate(c)` which fills `factoryPO` + `poNo`, clears
the candidates, and re-focuses the Size field — the smartLookup useEffect
re-fires and resolves to Level 1-3.

**h. Preview-Before-Save Dialog (spec §4)** — `handleAddData()` now opens the
`previewOpen` dialog instead of saving immediately. The dialog shows:
- Confidence badge in the header.
- "Entered" grid: Shipping Status, PO NO#, Factory PO, Size, Qty, Q'ty 2 computed.
- "Auto-Filled From Master Data" grid: MODEL, SKU, Season, the 4 separate
  color fields (with the Color Data Protection comment), Dead Line, Available Sizes.
- Validation Status checklist: Shipping Status selected, PO NO# entered,
  Factory PO confirmed (level-aware), Size valid (uses normalizeSize), Qty positive.
- Buttons: `[Cancel]` `[Edit]` `[Confirm Entry]`.
- `[Confirm Entry]` is disabled when `lookupConfidence === "LOW"` — the user
  must first pick a candidate from the Suggestion Panel. `handleAddData()` also
  short-circuits in this case with a toast error.
- The real save happens in `confirmEntryFromPreview()` (extracted from the
  previous `handleAddData` body — same `api.confirmEntry` call, same toast,
  same recent/bumpRefresh/resetForm flow).
- Keyboard navigation still works: pressing Enter in the Qty field triggers
  `handleAddData()` → opens the preview dialog.

**i. KEEP CONTEXT indicator (spec §7)** — emerald-tinted bar shown above the
entry mode toggle when at least one keep-toggle is on AND its corresponding
field is populated. Shows the carried-over context as badges (Status / PO:… /
FPO:…) so the user always knows what will be reused on the next entry.

**j. Color Data Protection comment (spec §5)** — added a top-of-component
comment block to `AutoFillGrid` explaining that colorCode, colorCode2,
painting, and printingColor are SEPARATE MasterData columns, never derived
from each other, and that `rebuildMasterGroups()` picks the single shared
value per Factory PO independently. Each color row in `rows` is annotated
with `// Each of these 4 color fields is sourced from its own MasterData column:`.
The Preview dialog repeats this guarantee in a comment block above the
4 color PreviewFields.

### 4. Other changes (cleanup / consistency)

- `resetForm()` now also clears `lookupLevel`, `lookupConfidence`,
  `candidates`, `availableSizes` so stale confidence / candidates don't
  leak across entries.
- `Ctrl+Alt+W` keyboard shortcut clears the same smart-lookup state in
  addition to the existing size/qty/autoFill clear.
- Updated Size chip's active-state check from strict `size === s` to
  `normalizeSize(size) === normalizeSize(s)` for whitespace tolerance.

## Files modified

- `src/app/api/master-data/smart-lookup/route.ts` (new, 219 lines)
- `src/lib/api-client.ts` (+42 lines: `smartLookup` method + comments)
- `src/components/views/product-data-entry-view.tsx` (+~540 lines:
  helpers, state, UI, dialog, suggestion panel, KEEP CONTEXT indicator,
  AutoFillGrid color-protection comment)

## Verification

### TypeScript
```
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "smart-lookup|product-data-entry|api-client"
```
Result: 2 pre-existing errors in `product-data-entry-view.tsx` lines 649/650
about `deleteEntry`'s return type narrowing (`Property 'needsConfirm' does not
exist on type …`). Verified pre-existing by `git stash` → those errors existed
on the unmodified file at lines 471/472. Outside this task's scope (delete
flow, not smart entry). **No new TypeScript errors introduced.**

### ESLint
```
npx eslint src/components/views/product-data-entry-view.tsx \
              src/app/api/master-data/smart-lookup/route.ts \
              src/lib/api-client.ts
```
Result: **0 warnings, 0 errors.**

### API endpoint smoke tests (curl, dev server)

| Test | Body | Result |
| --- | --- | --- |
| Level 1 (exact) | `MAFATE / MH25100234 / H411040101 / M(04)/W(05)` | `level=1, confidence=HIGH, masterGroup returned` ✅ |
| Level 1 fall-through (wrong size) | same as above + `size=INVALID_SIZE` | `level=2, confidence=MEDIUM` ✅ |
| Level 2 (factoryPO + poNo) | `MAFATE / MH25100234 / H411040101` | `level=2, availableSizes returned` ✅ |
| Level 3 (factoryPO only) | `MAFATE / MH25100234` | `level=3, masterGroup + all sizes returned` ✅ |
| Level 4 (suffix match) | `MAFATE / XXXX0234` | `level=4, candidates=[MH25100234, …]` ✅ |
| Level 0 (no match) | `MAFATE / ZZZZZZZ999` | `level=0, confidence=NONE` ✅ |
| Missing productType | `{}` | `level=0, confidence=NONE` ✅ |
| Missing factoryPO | `{productType:"MAFATE"}` | `level=0, confidence=NONE` ✅ |
| Invalid JSON | `not json` | HTTP 400 with `error: "Invalid JSON body"` ✅ |
| Cross-product isolation | `MAFATE / LOSS` (ONYX Factory PO) | `level=3` (LOSS also exists in MAFATE) ✅ |

## Constraints honored

- ✅ Did NOT remove or break: keyboard shortcuts (Ctrl+Alt+Q/W), bulk entry
  mode, entries table, edit/delete dialogs, add-to-master-data, AutoFillGrid.
- ✅ Did NOT change the store, sidebar, header, or page router.
- ✅ Used existing shadcn/ui components (`Dialog`, `Card`, `Badge`, `Button`,
  `Input`, `Label`, `Switch`, `Textarea`, `Tabs`, `Select`, `Checkbox`,
  `AlertDialog`) + lucide-react icons (`ShieldCheck`, `Lightbulb`, `Eye`,
  `Save`, `Pencil`, etc.).
- ✅ Colors used: emerald (HIGH/success), amber (MEDIUM/warning), rose
  (LOW/error). No indigo/blue introduced.
- ✅ Preview dialog uses shadcn `<Dialog>`.
- ✅ `z-ai-web-dev-sdk` not touched (no client-side usage).
- ✅ No test code written.

## Pre-existing TypeScript errors (NOT in scope, NOT introduced)

`src/components/views/product-data-entry-view.tsx` lines 649/650:
`Property 'needsConfirm' does not exist on type '{ ok: boolean; deleted?: string[] | undefined; } | { ok: false; needsConfirm: …; }'.`
This is a TypeScript narrowing issue in the existing `confirmDeleteEntry()`
function (delete-entry flow, not smart entry). Pre-existing on the unmodified
file (verified via `git stash`).
