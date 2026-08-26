// Typed API client wrappers for the Smart Excel Data Entry System.
import type {
  AppSettings,
  AutocompleteSuggestion,
  DashboardStats,
  EntryData,
  ImportHistoryItem,
  LookupRuleConfig,
  MasterGroup,
  OrderNote,
  ParseResult,
  ProductionStats,
  QtyValidationGroup,
} from "@/types";
import type { CanonicalField } from "@/lib/fields";

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      msg = body.error || body.errors?.join(", ") || JSON.stringify(body);
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export const api = {
  // Excel parse
  parseExcel: async (
    file: File,
    sheet?: string
  ): Promise<ParseResult & { autoMapping: Record<string, CanonicalField | ""> }> => {
    const fd = new FormData();
    fd.append("file", file);
    if (sheet) fd.append("sheet", sheet);
    const res = await fetch("/api/excel/parse", { method: "POST", body: fd });
    return jsonOrThrow(res);
  },

  importExcel: async (body: {
    fileName: string;
    sheetName: string;
    fileBase64: string;
    mapping: Record<string, CanonicalField | "">;
    replaceExisting?: boolean;
    productType?: string;
  }) => {
    const res = await fetch("/api/excel/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return jsonOrThrow(res);
  },

  exportExcel: async (body: {
    source: "entries" | "master";
    columns?: CanonicalField[];
    mode?: "all" | "filtered" | "selected";
    ids?: string[];
    filters?: Record<string, string>;
    sortOrder?: "asc" | "desc";
  }): Promise<Blob> => {
    const res = await fetch("/api/excel/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error("Export failed");
    return res.blob();
  },

  // Master data
  listMaster: async (params: Record<string, string | number>) => {
    const q = new URLSearchParams(
      Object.entries(params).map(([k, v]) => [k, String(v)])
    ).toString();
    const res = await fetch(`/api/master-data?${q}`);
    return jsonOrThrow<{
      total: number;
      page: number;
      pageSize: number;
      totalPages: number;
      rows: any[];
    }>(res);
  },

  updateMasterRow: async (id: string, body: Record<string, any>) => {
    const res = await fetch(`/api/master-data/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return jsonOrThrow(res);
  },

  deleteMasterRow: async (id: string) => {
    const res = await fetch(`/api/master-data/${id}`, { method: "DELETE" });
    return jsonOrThrow(res);
  },

  searchMaster: async (
    q: string,
    field: CanonicalField,
    limit = 15,
    prioritizeByDeadline = true,
    productType?: string,
    poNo?: string
  ): Promise<AutocompleteSuggestion[]> => {
    const params = new URLSearchParams({
      q, field, limit: String(limit),
      prioritizeByDeadline: String(prioritizeByDeadline),
    });
    if (productType) params.set("productType", productType);
    if (poNo) params.set("poNo", poNo);
    const res = await fetch(`/api/master-data/search?${params}`);
    return jsonOrThrow(res);
  },

  lookupFactoryPO: async (factoryPO: string, productType?: string): Promise<MasterGroup> => {
    const params = new URLSearchParams();
    if (productType) params.set("productType", productType);
    const qs = params.toString();
    const res = await fetch(`/api/master-data/factory-po/${encodeURIComponent(factoryPO)}${qs ? `?${qs}` : ""}`);
    return jsonOrThrow(res);
  },

  // Entries
  listEntries: async (params: Record<string, string | number>) => {
    const q = new URLSearchParams(
      Object.entries(params).map(([k, v]) => [k, String(v)])
    ).toString();
    const res = await fetch(`/api/entries?${q}`);
    return jsonOrThrow<{
      total: number;
      page: number;
      pageSize: number;
      totalPages: number;
      rows: EntryData[];
    }>(res);
  },

  createEntry: async (body: {
    productType: string; // MANDATORY — entry is scoped to one product.
    factoryPO: string;
    size: string;
    qty1: string;
    autoCalcQty2?: boolean;
    note?: string;
  }) => {
    const res = await fetch("/api/entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return jsonOrThrow<{ ok: boolean; entry?: EntryData; errors?: string[] }>(res);
  },

  // Preview an entry (no DB write) — validates, looks up Master Data, computes qty2.
  previewEntry: async (body: {
    productType: string;
    shippingStatus: string;
    poNo: string;
    factoryPO: string;
    size: string;
    qty: string;
  }) => {
    const res = await fetch("/api/entries/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return jsonOrThrow<any>(res);
  },

  // Confirm an entry (atomic DB transaction). For Output, creates paired Pending.
  confirmEntry: async (body: {
    productType: string;
    shippingStatus: string;
    poNo: string;
    factoryPO: string;
    size: string;
    qty: string;
  }) => {
    const res = await fetch("/api/entries/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return jsonOrThrow<{ ok: boolean; created?: any[]; merged?: any[]; preview?: any; errors?: string[] }>(res);
  },

  bulkEntries: async (
    items: { factoryPO: string; size: string; qty1: string; productType?: string }[],
    autoCalcQty2 = true
  ) => {
    const res = await fetch("/api/entries/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items, autoCalcQty2 }),
    });
    return jsonOrThrow(res);
  },

  // Bulk delete entries by IDs. Entries that belong to an Output+Pending
  // transaction group will have their paired sibling deleted too.
  bulkDeleteEntries: async (ids: string[]) => {
    const res = await fetch("/api/entries/bulk", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    return jsonOrThrow<{
      ok: boolean;
      requested: number;
      deleted: number;
      skipped: number;
      deletedIds: string[];
      skippedIds: { id: string; reason: string }[];
    }>(res);
  },

  updateEntry: async (id: string, body: any) => {
    const res = await fetch(`/api/entries/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return jsonOrThrow(res);
  },

  deleteEntry: async (id: string, forceGroup = false) => {
    const res = await fetch(`/api/entries/${id}${forceGroup ? "?forceGroup=true" : ""}`, { method: "DELETE" });
    const body = await res.json().catch(() => ({}));
    if (res.ok) return body as { ok: boolean; deleted?: string[] };
    // 409 = needsConfirm (transaction group delete) — return as data, not throw.
    if (res.status === 409 && body.needsConfirm) {
      return body as { ok: false; needsConfirm: { pairedId: string; message: string } };
    }
    throw new Error(body.error || `HTTP ${res.status}`);
  },

  checkDuplicate: async (factoryPO: string, size: string) => {
    const res = await fetch("/api/entries/check-duplicate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ factoryPO, size }),
    });
    return jsonOrThrow<{ duplicate: boolean; existing: any }>(res);
  },

  // Order notes
  listNotes: async (params: { factoryPO?: string; size?: string; noteDate?: string }): Promise<OrderNote[]> => {
    const q = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v).map(([k, v]) => [k, String(v)])
    ).toString();
    const res = await fetch(`/api/order-notes?${q}`);
    return jsonOrThrow(res);
  },

  createNote: async (body: {
    factoryPO: string;
    size: string;
    poNo?: string;
    noteDate: string;
    content: string;
    author?: string;
  }): Promise<OrderNote> => {
    const res = await fetch("/api/order-notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return jsonOrThrow(res);
  },

  updateNote: async (id: string, body: any) => {
    const res = await fetch(`/api/order-notes/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return jsonOrThrow(res);
  },

  deleteNote: async (id: string) => {
    const res = await fetch(`/api/order-notes/${id}`, { method: "DELETE" });
    return jsonOrThrow(res);
  },

  // Quantity validation
  validateQuantities: async (filters?: {
    factoryPO?: string;
    poNo?: string;
    productType?: string;
  }): Promise<{
    total: number;
    inconsistent: number;
    consistent: number;
    totalMissing: number;
    groups: QtyValidationGroup[];
  }> => {
    const q = new URLSearchParams(
      Object.entries(filters || {}).filter(([, v]) => v).map(([k, v]) => [k, String(v)])
    ).toString();
    const res = await fetch(`/api/quantity-validation?${q}`);
    return jsonOrThrow(res);
  },

  // Production stats
  getProductionStats: async (filters?: {
    productType?: string;
    factoryPO?: string;
  }): Promise<ProductionStats> => {
    const q = new URLSearchParams(
      Object.entries(filters || {}).filter(([, v]) => v).map(([k, v]) => [k, String(v)])
    ).toString();
    const res = await fetch(`/api/production-stats?${q}`);
    return jsonOrThrow(res);
  },

  // Production aggregation (product-scoped)
  getKPIs: async (productType: string, filters?: Record<string, string>) => {
    const params = new URLSearchParams({ productType, ...(filters || {}) });
    const res = await fetch(`/api/production/kpis?${params}`);
    return jsonOrThrow<any>(res);
  },

  getProductionGroups: async (productType: string, filters?: Record<string, string>) => {
    const params = new URLSearchParams({ productType, ...(filters || {}) });
    const res = await fetch(`/api/production/groups?${params}`);
    return jsonOrThrow<{ total: number; groups: any[] }>(res);
  },

  getByDimension: async (productType: string, dimension: string, filters?: Record<string, string>) => {
    const params = new URLSearchParams({ productType, dimension, ...(filters || {}) });
    const res = await fetch(`/api/production/by-dimension?${params}`);
    return jsonOrThrow<{ dimension: string; rows: any[] }>(res);
  },

  getAlerts: async (productType: string, limit = 20) => {
    const res = await fetch(`/api/production/alerts?productType=${productType}&limit=${limit}`);
    return jsonOrThrow<{ total: number; high: number; medium: number; low: number; alerts: any[] }>(res);
  },

  getTimeline: async (productType: string, statusBucket: "order" | "output" | "input") => {
    const res = await fetch(`/api/production/timeline?productType=${productType}&statusBucket=${statusBucket}`);
    return jsonOrThrow<{ statusBucket: string; series: any[] }>(res);
  },

  getGlobalDashboard: async () => {
    const res = await fetch("/api/global-dashboard");
    return jsonOrThrow<{ products: any[] }>(res);
  },

  // Shipment planning (Daily Shipment Planning module)
  getShipmentGroups: async (productType: string, filters?: Record<string, string>) => {
    const params = new URLSearchParams({ productType, ...(filters || {}) });
    const res = await fetch(`/api/shipment/groups?${params}`);
    return jsonOrThrow<{ total: number; shortOutput: number; surplus: number; complete: number; groups: any[] }>(res);
  },

  getShipmentColors: async (productType: string) => {
    const res = await fetch(`/api/shipment/colors?productType=${productType}`);
    return jsonOrThrow<{ colors: string[] }>(res);
  },

  getSurplusTransfers: async (productType: string) => {
    const res = await fetch(`/api/shipment/surplus?productType=${productType}`);
    return jsonOrThrow<{ total: number; totalTransferable: number; proposals: any[] }>(res);
  },

  exportShipment: async (body: {
    productType: string;
    selectedColors: string[];
    plannedOutputs: any[];
    templatePath?: string;
  }): Promise<Blob> => {
    const res = await fetch("/api/shipment/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error("Shipment export failed");
    return res.blob();
  },

  // Production Report & Data Validation
  getReportGroups: async (productType: string, filters?: Record<string, string>) => {
    const params = new URLSearchParams({ productType, ...(filters || {}) });
    const res = await fetch(`/api/report/groups?${params}`);
    return jsonOrThrow<{ groups: any[]; errors: any[]; summary: any }>(res);
  },

  exportReport: async (body: { productType: string; poNo?: string; factoryPO?: string; colorCode?: string; size?: string }): Promise<Blob> => {
    const res = await fetch("/api/report/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error("Report export failed");
    return res.blob();
  },

  // Dashboard & history
  dashboard: async (): Promise<DashboardStats> => {
    const res = await fetch("/api/dashboard");
    return jsonOrThrow(res);
  },

  importHistory: async (): Promise<ImportHistoryItem[]> => {
    const res = await fetch("/api/import-history");
    return jsonOrThrow(res);
  },

  // Settings
  getSettings: async (): Promise<AppSettings> => {
    const res = await fetch("/api/settings");
    return jsonOrThrow(res);
  },
  saveSettings: async (body: Partial<AppSettings>): Promise<AppSettings> => {
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return jsonOrThrow(res);
  },

  // Lookup rules
  listLookupRules: async (): Promise<LookupRuleConfig[]> => {
    const res = await fetch("/api/lookup-rules");
    return jsonOrThrow(res);
  },
  saveLookupRule: async (body: LookupRuleConfig & { id?: string }) => {
    const res = await fetch("/api/lookup-rules", {
      method: body.id ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return jsonOrThrow(res);
  },
  deleteLookupRule: async (id: string) => {
    const res = await fetch(`/api/lookup-rules?id=${id}`, { method: "DELETE" });
    return jsonOrThrow(res);
  },
};

export type { CanonicalField };
