// Query invalidation helpers for data consistency.
//
// When data changes (entry created, master data added/edited/deleted, import),
// multiple views' caches become stale. This helper invalidates ALL relevant
// query keys so that every view — Dashboard, Master Data, Statistics, Shipment,
// Report, Production Tracking, etc. — refetches fresh data on next access.
//
// Usage:
//   const qc = useQueryClient();
//   invalidateAllDataQueries(qc);
//   bumpRefresh(); // also bump the refreshKey for views that key on it

import type { QueryClient } from "@tanstack/react-query";

// All query key prefixes that depend on MasterData or EntryData.
// When master data or entry data changes, ALL of these become stale.
const DATA_QUERY_PREFIXES = [
  "product-kpis",
  "product-alerts",
  "product-timeline",
  "product-dim",
  "product-master-data",
  "data-entry-entries",
  "entries",
  "master-data",
  "dashboard",
  "global-dashboard",
  "production-alerts",
  "production-groups",
  "production-stats",
  "prod-statistics-kpis",
  "prod-statistics-dim",
  "prod-statistics-timeline",
  "shipment-colors",
  "shipment-groups",
  "shipment-surplus",
  "shipment-batches",
  "report-groups",
  "review-entries",
  "quantity-check",
  "quantity-validation",
  "export-preview-entries",
  "import-history",
] as const;

// Invalidate ALL data-related queries so every view refetches.
// This is called after: entry create, entry edit, entry delete,
// add-to-master, master-data edit, master-data delete, bulk import.
export function invalidateAllDataQueries(qc: QueryClient) {
  for (const prefix of DATA_QUERY_PREFIXES) {
    qc.invalidateQueries({ queryKey: [prefix] });
  }
}

// Invalidate only master-data-dependent queries (when only master data changed,
// not entries). Used after: add-to-master, master-data edit/delete.
export function invalidateMasterDataQueries(qc: QueryClient) {
  const masterPrefixes = [
    "product-master-data",
    "master-data",
    "product-kpis",
    "product-alerts",
    "product-timeline",
    "product-dim",
    "global-dashboard",
    "production-alerts",
    "production-groups",
    "prod-statistics-kpis",
    "prod-statistics-dim",
    "prod-statistics-timeline",
    "shipment-colors",
    "shipment-groups",
    "shipment-surplus",
    "shipment-batches",
    "report-groups",
    "quantity-check",
    "quantity-validation",
  ] as const;
  for (const prefix of masterPrefixes) {
    qc.invalidateQueries({ queryKey: [prefix] });
  }
}
