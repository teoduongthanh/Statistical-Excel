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

  // Add a new row to Master Data from the Data Entry form.
  // Used when a Factory PO doesn't exist yet and the user wants to create it.
  addMasterRow: async (body: {
    productType: string;
    factoryPO: string;
    size: string;
    shippingStatus?: string;
    model?: string;
    sku?: string;
    poNo?: string;
    item?: string;
    season?: string;
    colorCode?: string;
    colorCode2?: string;
    painting?: string;
    printingColor?: string;
    qty1?: string | number;
    qty2?: string | number;
    deadline?: string;
    date?: string;
  }) => {
    const res = await fetch("/api/master-data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return jsonOrThrow<{ ok: boolean; row?: any; error?: string }>(res);
  },

  // Bulk add master data rows in a single transaction + single MasterGroup
  // rebuild (much faster than calling addMasterRow N times).
  bulkAddMasterRows: async (rows: Array<{
    productType: string;
    factoryPO: string;
    size: string;
    poNo?: string;
    shippingStatus?: string;
    model?: string;
    sku?: string;
    item?: string;
    season?: string;
    colorCode?: string;
    colorCode2?: string;
    painting?: string;
    printingColor?: string;
    qty1?: string | number;
    qty2?: string | number;
    deadline?: string;
    date?: string;
  }>) => {
    const res = await fetch("/api/master-data/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows }),
    });
    return jsonOrThrow<{ ok: boolean; inserted: number; createdIds: string[]; productsAffected: number; error?: string }>(res);
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

  // ─────────────────────────────────────────────────────────────────────────
  // SMART ENTRY DATA SYSTEM — 4-LEVEL MATCHING ENGINE
  // POST /api/master-data/smart-lookup
  //
  // Replaces the basic lookupFactoryPO call when richer matching is needed.
  // Returns the matched MasterGroup (Levels 1-3), a list of candidate Factory
  // POs (Level 4), or the available sizes for the (factoryPO + poNo) combo
  // (Level 2). Confidence (HIGH/MEDIUM/LOW/NONE) tells the UI whether to
  // auto-save, show a preview dialog, or refuse to save.
  // ─────────────────────────────────────────────────────────────────────────
  smartLookup: async (body: {
    productType: string;
    poNo?: string;
    factoryPO?: string;
    size?: string;
  }): Promise<{
    ok: boolean;
    level: 0 | 1 | 2 | 3 | 4;
    confidence: "HIGH" | "MEDIUM" | "LOW" | "NONE";
    masterGroup?: MasterGroup;
    candidates?: Array<{
      factoryPO: string;
      poNo: string;
      model: string;
      sku: string;
      colorCode: string;
      colorCode2: string;
      painting: string;
      printingColor: string;
      season: string;
      deadline: string | null;
      sizes: string[];
    }>;
    availableSizes?: string[];
  }> => {
    const res = await fetch("/api/master-data/smart-lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
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

  // ===== Bulk Data Validation (Copy & Paste from Excel) =====
  // Validates a batch of pasted Excel rows WITHOUT writing to the database.
  // Returns the full validation result: summary, per-row results, grouped errors,
  // current DB totals, and final simulated totals.
  bulkValidate: async (body: {
    productType: string;
    rows: Record<string, string>[];
  }) => {
    const res = await fetch("/api/bulk-validation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return jsonOrThrow<{
      ok: boolean;
      summary: {
        totalRows: number;
        validRows: number;
        warningRows: number;
        errorRows: number;
        productGroupsAffected: number;
        duplicatePossible: number;
        quantityErrors: number;
        masterDataErrors: number;
        deadlineErrors: number;
      };
      rows: any[];
      groupedErrors: any[];
      warnings: any[];
      currentGroups: Record<string, any>;
      finalGroups: Record<string, any>;
    }>(res);
  },

  // Performs the actual database INSERT for validated bulk rows.
  // Uses a transaction so the import is atomic.
  bulkImport: async (body: {
    productType: string;
    rows: {
      shippingStatus: string;
      poNo: string;
      factoryPO: string;
      size: string;
      qty1: number;
      confirmReason?: string;
      note?: string;
    }[];
    mode: "all_valid" | "selected" | "fix_first";
    selectedRowNumbers?: number[];
    importedBy?: string;
  }) => {
    const res = await fetch("/api/bulk-import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return jsonOrThrow<{
      ok: boolean;
      importId: string;
      imported: number;
      skipped: number;
      errors: string[];
      auditLogId?: string;
    }>(res);
  },

  // Fetch bulk import history (from AuditLog).
  bulkImportHistory: async (limit = 50) => {
    const res = await fetch(`/api/bulk-import/history?limit=${limit}`);
    return jsonOrThrow<{
      ok: boolean;
      history: {
        id: string;
        importId: string;
        productType: string | null;
        user: string | null;
        importedAt: string;
        detail: string | null;
        stats: {
          imported: number;
          skipped: number;
          totalRows: number;
          mode: string;
        };
      }[];
    }>(res);
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

  // ===== Bulk Entry Validation + Import =====
  // Validates a batch of entry rows (Shipping Status + PO NO# + Factory PO +
  // Size + Qty) WITHOUT writing to DB. Runs the full sequential simulation
  // engine: required fields, master data lookup, quantity limits, duplicates.
  bulkValidateEntries: async (body: {
    productType: string;
    rows: Record<string, string>[];
  }) => {
    const res = await fetch("/api/entries/bulk-validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return jsonOrThrow<{
      ok: boolean;
      summary: {
        totalRows: number;
        validRows: number;
        warningRows: number;
        errorRows: number;
        productGroupsAffected: number;
        duplicatePossible: number;
        quantityErrors: number;
        masterDataErrors: number;
        deadlineErrors: number;
      };
      rows: any[];
      groupedErrors: any[];
      warnings: any[];
      currentGroups: Record<string, any>;
      finalGroups: Record<string, any>;
    }>(res);
  },

  // Performs the actual database INSERT for validated bulk entry rows.
  // Uses a transaction so the import is atomic.
  bulkImportEntries: async (body: {
    productType: string;
    rows: {
      shippingStatus: string;
      poNo: string;
      factoryPO: string;
      size: string;
      qty1: number;
      confirmReason?: string;
      note?: string;
    }[];
    mode: "all_valid" | "selected" | "fix_first";
    selectedRowNumbers?: number[];
    importedBy?: string;
  }) => {
    const res = await fetch("/api/bulk-import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return jsonOrThrow<{
      ok: boolean;
      importId: string;
      imported: number;
      skipped: number;
      errors: string[];
      auditLogId?: string;
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
    selectedPoNos: string[];
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

  // ===== Bulk Output Slip Generator =====
  // Fetch all Factory PO groups for a PO NO# with per-size Remaining Output.
  getOutputSlipFactoryPOs: async (productType: string, poNo: string) => {
    const params = new URLSearchParams({ productType, poNo });
    const res = await fetch(`/api/output-slips/factory-pos?${params}`);
    return jsonOrThrow<{
      ok: boolean;
      groups: Array<{
        factoryPO: string; poNo: string; model: string; sku: string; season: string;
        colorCode: string; colorCode2: string; painting: string; printingColor: string;
        deadline: string | null;
        sizes: Array<{ size: string; orderQty: number; outputQty: number; remainingOutput: number }>;
        totalOrder: number; totalOutput: number; totalRemaining: number;
        status: "READY_TO_OUTPUT" | "COMPLETED";
      }>;
    }>(res);
  },

  // Generate an Output Slip (creates a DB record, does NOT write to EntryData).
  generateOutputSlip: async (body: {
    productType: string;
    poNo: string;
    slipMode: "combined" | "separate" | "group_by_color";
    items: Array<{
      factoryPO: string; poNo: string; model: string; sku: string; season: string;
      colorCode: string; colorCode2: string; painting: string; printingColor: string;
      size: string; qtyToOutput: number; orderQty: number; outputQty: number;
      remainingOutput: number; deadline: string | null;
    }>;
    createdBy?: string;
    note?: string;
  }) => {
    const res = await fetch("/api/output-slips/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return jsonOrThrow<{ ok: boolean; slip: any; error?: string }>(res);
  },

  // Export an Output Slip to Excel.
  exportOutputSlip: async (body: {
    slipId: string;
    format?: "multi_sheet" | "combined" | "separate_files";
  }): Promise<Blob> => {
    const res = await fetch("/api/output-slips/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error("Slip export failed");
    return res.blob();
  },

  // Confirm Actual Output — creates the real 2.Output entries in EntryData.
  confirmOutputSlip: async (body: { slipId: string; confirmedBy?: string }) => {
    const res = await fetch("/api/output-slips/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return jsonOrThrow<{ ok: boolean; slip?: any; createdCount?: number; errors?: string[] }>(res);
  },

  // List output slips (filtered).
  listOutputSlips: async (params?: { productType?: string; poNo?: string; status?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.productType) q.set("productType", params.productType);
    if (params?.poNo) q.set("poNo", params.poNo);
    if (params?.status) q.set("status", params.status);
    if (params?.limit) q.set("limit", String(params.limit));
    const res = await fetch(`/api/output-slips?${q}`);
    return jsonOrThrow<{ ok: boolean; slips: any[] }>(res);
  },

  // Cancel an output slip.
  cancelOutputSlip: async (id: string) => {
    const res = await fetch(`/api/output-slips/${id}`, { method: "DELETE" });
    return jsonOrThrow<{ ok: boolean; slip?: any; error?: string }>(res);
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

  // ===== Data Reconciliation & Duplicate Check =====
  // Compares imported Excel data with Website MasterData within a date range.
  // READ-ONLY — never writes data. Returns comparison results + summary.
  // Comparison key: Factory PO + Size (PO NO# is NOT compared).
  reconcileData: async (body: {
    productType: string;
    dateFrom: string;
    dateTo: string;
    excelRows: Array<{ date?: string; factoryPO?: string; size?: string; qty?: string | number }>;
  }) => {
    const res = await fetch("/api/reconcile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return jsonOrThrow<{
      ok: boolean;
      summary: {
        dateRange: { from: string; to: string };
        excelTotalRecords: number;
        excelRecordsInDateRange: number;
        excelExcluded: number;
        websiteTotalRecords: number;
        websiteRecordsInDateRange: number;
        websiteExcluded: number;
        matched: number;
        qtyMismatch: number;
        missingOnWebsite: number;
        missingInExcel: number;
        possibleWrongFactoryPO: number;
        possibleWrongSize: number;
        possibleDuplicate: number;
        exactDuplicate: number;
        invalidData: number;
        totalIssues: number;
        totalGroups: number;
      };
      results: Array<{
        status: string;
        factoryPO: string;
        size: string;
        excelQty: number;
        websiteQty: number;
        difference: number;
        suggestedFactoryPO?: string;
        suggestedSize?: string;
        excelRowCount: number;
        websiteRowCount: number;
        duplicateCount?: number;
      }>;
    }>(res);
  },
};

export type { CanonicalField };
