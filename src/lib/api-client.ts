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

  // Upload Excel files to server filesystem (/home/z/my-project/upload/).
  uploadExcelFiles: async (files: File[]): Promise<{
    ok: boolean;
    uploaded: number;
    skipped: number;
    errors: number;
    total: number;
    files: Array<{ fileName: string; size: number; savedPath: string; status: "ok" | "skipped" | "error"; message?: string }>;
  }> => {
    const fd = new FormData();
    for (const f of files) fd.append("files", f);
    const res = await fetch("/api/excel/upload", { method: "POST", body: fd });
    return jsonOrThrow(res);
  },

  // List Excel files already on the server filesystem.
  listUploadedFiles: async (): Promise<{
    files: Array<{ name: string; size: number; sizeMB: number; mtime: string }>;
    total: number;
  }> => {
    const res = await fetch("/api/excel/upload");
    return jsonOrThrow(res);
  },

  // Import DATA sheet from uploaded files into DB.
  // If `files` omitted, auto-detects newest file per product type.
  importDataFromUpload: async (files?: Array<{ fileName: string; productType: string }>): Promise<{
    ok: boolean;
    results: Array<{
      fileName: string;
      productType: string;
      totalRows: number;
      validRows: number;
      pendingSkipped: number;
      invalidSkipped: number;
      duplicatesSkipped: number;
      groups: number;
      status: "ok" | "error";
      error?: string;
    }>;
    verification: Array<{ productType: string; rows: number; groups: number; pending: number }>;
  }> => {
    const res = await fetch("/api/excel/import-data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files }),
    });
    return jsonOrThrow(res);
  },

  // ── Reconciliation (partner file vs website) ────────────────────────────────
  // Upload partner Excel file to server.
  reconciliationUpload: async (file: File): Promise<{
    ok: boolean;
    fileName: string;
    savedPath: string;
    size: number;
    sizeMB: number;
  }> => {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/reconciliation/upload", { method: "POST", body: fd });
    return jsonOrThrow(res);
  },

  // Preview uploaded partner file (sheets, headers, row counts).
  reconciliationPreview: async (body: {
    fileName: string;
    mapping?: any;
  }): Promise<{
    ok: boolean;
    preview: {
      fileName: string;
      sheets: string[];
      ordersCount: number;
      summaryCount: number;
      transactionsCount: number;
      headers: { orders: string[]; summary: string[]; transactions: string[] };
      preview: { orders: any[]; summary: any[]; transactions: any[] };
    };
  }> => {
    const res = await fetch("/api/reconciliation/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return jsonOrThrow(res);
  },

  // Run reconciliation (parse partner, load website, compare, save results).
  reconciliationRun: async (body: {
    fileName: string;
    productType: string;
    dateFrom?: string;
    dateTo?: string;
    asOfDate?: string;
    mapping?: any;
    uploadedBy?: string;
  }): Promise<{
    ok: boolean;
    runId: string;
    runNumber: string;
    summary: any;
    resultsCount: number;
  }> => {
    const res = await fetch("/api/reconciliation/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return jsonOrThrow(res);
  },

  // List past reconciliation runs.
  reconciliationHistory: async (limit = 20): Promise<{
    ok: boolean;
    runs: any[];
    total: number;
  }> => {
    const res = await fetch(`/api/reconciliation/history?limit=${limit}`);
    return jsonOrThrow(res);
  },

  // Get run summary.
  reconciliationSummary: async (runId: string): Promise<{ ok: boolean; summary: any }> => {
    const res = await fetch(`/api/reconciliation/${runId}/summary`);
    return jsonOrThrow(res);
  },

  // Get paginated comparison details with filters.
  reconciliationDetails: async (
    runId: string,
    filters: { status?: string; po?: string; factoryPo?: string; size?: string; model?: string; page?: number; pageSize?: number } = {}
  ): Promise<{ ok: boolean; page: number; pageSize: number; total: number; totalPages: number; rows: any[] }> => {
    const q = new URLSearchParams();
    if (filters.status) q.set("status", filters.status);
    if (filters.po) q.set("po", filters.po);
    if (filters.factoryPo) q.set("factoryPo", filters.factoryPo);
    if (filters.size) q.set("size", filters.size);
    if (filters.model) q.set("model", filters.model);
    q.set("page", String(filters.page ?? 1));
    q.set("pageSize", String(filters.pageSize ?? 50));
    const res = await fetch(`/api/reconciliation/${runId}/details?${q}`);
    return jsonOrThrow(res);
  },

  // Get only mismatched/error rows (issues only).
  reconciliationIssues: async (
    runId: string,
    filters: { status?: string; page?: number; pageSize?: number } = {}
  ): Promise<{ ok: boolean; page: number; pageSize: number; total: number; totalPages: number; rows: any[] }> => {
    const q = new URLSearchParams();
    if (filters.status) q.set("status", filters.status);
    q.set("page", String(filters.page ?? 1));
    q.set("pageSize", String(filters.pageSize ?? 50));
    const res = await fetch(`/api/reconciliation/${runId}/issues?${q}`);
    return jsonOrThrow(res);
  },

  // Export URL (returns .xlsx).
  reconciliationExportUrl: (runId: string, sheet: string = "all"): string =>
    `/api/reconciliation/${runId}/export?sheet=${sheet}`,

  // ── FVO ↔ STECH Tracking ────────────────────────────────────────────────
  fvoStechTracking: async (filters: {
    poNo?: string;
    art?: string;
    size?: string;
    model?: string;
    colorCode?: string;
    status?: string;
    gender?: string;
    page?: number;
    pageSize?: number;
  } = {}): Promise<{
    ok: boolean;
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    rows: any[];
    summary: any;
  }> => {
    const q = new URLSearchParams();
    if (filters.poNo) q.set("poNo", filters.poNo);
    if (filters.art) q.set("art", filters.art);
    if (filters.size) q.set("size", filters.size);
    if (filters.model) q.set("model", filters.model);
    if (filters.colorCode) q.set("colorCode", filters.colorCode);
    if (filters.status) q.set("status", filters.status);
    if (filters.gender) q.set("gender", filters.gender);
    q.set("page", String(filters.page ?? 1));
    q.set("pageSize", String(filters.pageSize ?? 50));
    const res = await fetch(`/api/fvo-stech-tracking?${q}`);
    return jsonOrThrow(res);
  },

  // ── Entry Staging (bulk data entry → validate → confirm) ───────────────────
  stagingCreate: async (body: {
    productType: string;
    text: string;
    createdBy?: string;
  }): Promise<{ ok: boolean; batchId: string; batchDbId: string; totalRows: number }> => {
    const res = await fetch("/api/entry-staging/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return jsonOrThrow(res);
  },

  // Create staging batch from EXISTING EntryData rows (no copy-paste needed).
  // Useful for re-validating already-entered data against current MasterData.
  stagingCreateFromEntries: async (body: {
    productType: string;
    createdBy?: string;
    filters?: {
      dateFrom?: string;
      dateTo?: string;
      shippingStatus?: string;
      poNo?: string;
      factoryPO?: string;
      size?: string;
      limit?: number;
    };
  }): Promise<{
    ok: boolean;
    batchId: string;
    batchDbId: string;
    totalRows: number;
    sourceCount: number;
    filters?: any;
  }> => {
    const res = await fetch("/api/entry-staging/create-from-entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return jsonOrThrow(res);
  },

  stagingValidate: async (
    batchDbId: string
  ): Promise<{
    ok: boolean;
    runNumber: number;
    totalRows: number;
    validRows: number;
    warningRows: number;
    errorRows: number;
    reviewedRows: number;
  }> => {
    const res = await fetch(`/api/entry-staging/${batchDbId}/validate`, {
      method: "POST",
    });
    return jsonOrThrow(res);
  },

  stagingSummary: async (batchDbId: string): Promise<{ ok: boolean; batch: any; counts: any }> => {
    const res = await fetch(`/api/entry-staging/${batchDbId}/summary`);
    return jsonOrThrow(res);
  },

  stagingRows: async (
    batchDbId: string,
    filters: { status?: string; page?: number; pageSize?: number } = {}
  ): Promise<{ ok: boolean; page: number; pageSize: number; total: number; totalPages: number; rows: any[] }> => {
    const q = new URLSearchParams();
    if (filters.status) q.set("status", filters.status);
    q.set("page", String(filters.page ?? 1));
    q.set("pageSize", String(filters.pageSize ?? 50));
    const res = await fetch(`/api/entry-staging/${batchDbId}/rows?${q}`);
    return jsonOrThrow(res);
  },

  stagingEditRow: async (
    batchDbId: string,
    rowId: string,
    body: any
  ): Promise<{ ok: boolean; row: any }> => {
    const res = await fetch(`/api/entry-staging/${batchDbId}/rows/${rowId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return jsonOrThrow(res);
  },

  stagingAcceptWarning: async (
    batchDbId: string,
    rowId: string,
    body: { reason?: string; user?: string }
  ): Promise<{ ok: boolean; row: any }> => {
    const res = await fetch(
      `/api/entry-staging/${batchDbId}/rows/${rowId}/accept-warning`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );
    return jsonOrThrow(res);
  },

  stagingConfirm: async (
    batchDbId: string,
    body: { mode: "valid_only" | "valid_and_accepted"; user?: string }
  ): Promise<{ ok: boolean; imported: number; remaining: number }> => {
    const res = await fetch(`/api/entry-staging/${batchDbId}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return jsonOrThrow(res);
  },

  // Export URL for staging batch (.xlsx with 8 sheets).
  stagingExportUrl: (batchDbId: string, sheet: string = "all"): string =>
    `/api/entry-staging/${batchDbId}/export?sheet=${sheet}`,

  stagingList: async (
    productType?: string,
    limit = 20
  ): Promise<{ ok: boolean; batches: any[] }> => {
    const q = new URLSearchParams();
    if (productType) q.set("productType", productType);
    q.set("limit", String(limit));
    const res = await fetch(`/api/entry-staging/list?${q}`);
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
    deadlineInfo?: {
      deadline: string | null;
      deadlineSource: "1.Order" | "other" | "multiple" | "none";
      deadlineSourceRecordId?: string;
      deadlineConfidence: number;
      deadlineMatchLevel: 1 | 2 | 3 | 4 | 5;
      deadlineOptions?: Array<{ poNo: string; size: string; deadline: string | null; recordId: string }>;
    };
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
  listNotes: async (params: { factoryPO?: string; size?: string; noteDate?: string; company?: string; poNo?: string; entryId?: string }): Promise<OrderNote[]> => {
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
    company?: string;
    entryId?: string;
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

  // ===== Sync System =====
  getPendingSync: async (productType?: string) => {
    const q = productType ? `?productType=${encodeURIComponent(productType)}` : "";
    const res = await fetch(`/api/sync/pending${q}`);
    return jsonOrThrow<{
      ok: boolean; pendingCount: number;
      byProductType: Record<string, number>;
      byAction: Record<string, number>; byEntity: Record<string, number>;
      oldestPendingAt: string | null; lastSyncedAt: string | null;
      affectedProductKeys: string[];
    }>(res);
  },
  runSync: async (body?: { productType?: string; triggeredBy?: string }) => {
    const res = await fetch("/api/sync/run", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    return jsonOrThrow<{
      ok: boolean; runId: string; runNumber: string;
      eventsProcessed: number; productGroupsRecalculated: number;
      errorsFound: number; warningsFound: number; durationMs: number;
      validationErrors: any[];
    }>(res);
  },
  getSyncHistory: async (limit = 20) => {
    const res = await fetch(`/api/sync/history?limit=${limit}`);
    return jsonOrThrow<{ ok: boolean; history: any[] }>(res);
  },

  // ===== Notifications =====
  getNotifications: async (productType: string) => {
    const res = await fetch(`/api/notifications?productType=${encodeURIComponent(productType)}`);
    return jsonOrThrow<{ ok: boolean; notifications: any[]; summary: any }>(res);
  },

  // ===== Auth =====
  registerUser: async (body: { username: string; password: string; email?: string }) => {
    const res = await fetch("/api/auth/register", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return jsonOrThrow<{ ok: boolean; user?: any; error?: string }>(res);
  },

  // ===== Dashboard Insights (Health Score + Deadline Alerts + Data Quality) =====
  getDashboardInsights: async (productType: string) => {
    const res = await fetch(`/api/dashboard-insights?productType=${encodeURIComponent(productType)}`);
    return jsonOrThrow<{
      ok: boolean;
      healthScore: {
        score: number;
        status: "EXCELLENT" | "GOOD" | "WARNING" | "CRITICAL";
        completionRate: number;
        outputRate: number;
        deadlinePenalty: number;
        dataQualityPenalty: number;
        components: { completion: number; output: number; deadline: number; dataQuality: number };
      };
      deadlineCenter: {
        overdue: number;
        dueToday: number;
        dueThisWeek: number;
        upcoming: number;
        alerts: Array<{
          poNo: string;
          factoryPO: string;
          size: string;
          deadline: string;
          deadlineStatus: string;
          missing: number;
          orderQty: number;
          inputQty: number;
          daysUntilDeadline: number;
          priority: string;
        }>;
      };
      dataQuality: {
        totalRows: number;
        missingDeadline: number;
        missingDeadlinePercent: number;
        outputExceedsOrder: number;
        inputExceedsOutput: number;
        totalIssues: number;
        qualityScore: number;
      };
      quickStats: {
        entryCountToday: number;
        activeFactoryPOs: number;
        remainingOutput: number;
        remainingInput: number;
        processing: number;
      };
      kpis: {
        orderQty: number;
        outputQty: number;
        inputQty: number;
        factoryPOCount: number;
        poNoCount: number;
      };
    }>(res);
  },

  // ===== Order Progress Monitoring (daily snapshot + cumulative + anomalies) =====
  getOrderProgress: async (params: {
    productType: string;
    poNo?: string;
    factoryPO?: string;
    dateFrom?: string;
    dateTo?: string;
    mode?: "current" | "asOf" | "range";
    asOfDate?: string;
  }) => {
    const q = new URLSearchParams({ productType: params.productType });
    if (params.poNo) q.set("poNo", params.poNo);
    if (params.factoryPO) q.set("factoryPO", params.factoryPO);
    if (params.dateFrom) q.set("dateFrom", params.dateFrom);
    if (params.dateTo) q.set("dateTo", params.dateTo);
    if (params.mode) q.set("mode", params.mode);
    if (params.asOfDate) q.set("asOfDate", params.asOfDate);
    const res = await fetch(`/api/order-progress?${q}`);
    return jsonOrThrow<{
      ok: boolean;
      summary: {
        totalOrderQty: number;
        totalOutputQty: number;
        totalInputQty: number;
        pending: number;
        remaining: number;
        avgOutputProgress: number;
        avgInputProgress: number;
        avgInputVsOutput: number;
        totalOrders: number;
        notStarted: number;
        inProgress: number;
        outputCompleted: number;
        inputCompleted: number;
        overOutput: number;
        overInput: number;
        anomalyCount: number;
      };
      dailySnapshots: Array<{
        date: string;
        dailyOrder: number;
        dailyOutput: number;
        dailyInput: number;
        totalOutput: number;
        totalInput: number;
        pending: number;
        remaining: number;
        outputProgress: number;
        inputProgress: number;
        inputVsOutput: number;
        status: string;
      }>;
      anomalies: Array<{
        type: string;
        severity: string;
        key: string;
        poNo: string;
        factoryPO: string;
        size: string;
        description: string;
        [key: string]: any;
      }>;
    }>(res);
  },

  // ===== Data Change History (audit log filtered by product/date) =====
  getDataChangeHistory: async (params: {
    productType: string;
    dateFrom?: string;
    dateTo?: string;
    limit?: number;
  }) => {
    const q = new URLSearchParams({ productType: params.productType });
    if (params.dateFrom) q.set("dateFrom", params.dateFrom);
    if (params.dateTo) q.set("dateTo", params.dateTo);
    if (params.limit) q.set("limit", String(params.limit));
    const res = await fetch(`/api/data-change-history?${q}`);
    return jsonOrThrow<{
      ok: boolean;
      history: Array<{
        id: string;
        timestamp: string;
        user: string;
        action: string;
        entityType: string;
        entityId: string | null;
        oldValue: any;
        newValue: any;
        detail: string | null;
        productType: string | null;
      }>;
      summary: { total: number; byAction: Record<string, number> };
    }>(res);
  },

  // ===== Order Drill-Down (PO NO# → Factory PO → Size hierarchy + transactions) =====
  getOrderDrilldown: async (params: {
    productType: string;
    poNo?: string;
    factoryPO?: string;
    size?: string;
    mode?: "hierarchy" | "transactions";
  }) => {
    const q = new URLSearchParams({ productType: params.productType });
    if (params.poNo) q.set("poNo", params.poNo);
    if (params.factoryPO) q.set("factoryPO", params.factoryPO);
    if (params.size) q.set("size", params.size);
    q.set("mode", params.mode || "hierarchy");
    const res = await fetch(`/api/order-drilldown?${q}`);
    return jsonOrThrow<{
      ok: boolean;
      hierarchy?: Array<{
        poNo: string;
        orderQty: number; outputQty: number; inputQty: number;
        pending: number; remaining: number;
        outputProgress: number; inputProgress: number; inputVsOutput: number;
        factoryPOCount: number;
        factoryPOs: Array<{
          factoryPO: string;
          model: string; sku: string; colorCode: string; season: string;
          orderQty: number; outputQty: number; inputQty: number;
          pending: number; remaining: number;
          outputProgress: number; inputProgress: number; inputVsOutput: number;
          deadline: string | null;
          sizeCount: number;
          sizes: Array<{
            size: string;
            orderQty: number; outputQty: number; inputQty: number;
            pending: number; remaining: number;
            outputProgress: number; inputProgress: number; inputVsOutput: number;
            deadline: string | null;
            model: string; sku: string; colorCode: string; season: string;
            status: string[];
            anomalies: string[];
          }>;
        }>;
      }>;
      summary?: {
        totalPOs: number; totalFactoryPOs: number; totalSizes: number;
        totalOrderQty: number; totalOutputQty: number; totalInputQty: number;
      };
      transactions?: Array<{
        date: string; shippingStatus: string; bucket: string; qty: number;
        cumulativeOrder: number; cumulativeOutput: number; cumulativeInput: number;
        pending: number; remaining: number;
        outputProgress: number; inputProgress: number; inputVsOutput: number;
      }>;
      deadline?: string | null;
    }>(res);
  },

  // ===== Order Created Date Progress (batch by created date + timeline) =====
  getOrderCreatedProgress: async (params: {
    productType: string;
    createdDate?: string;
    mode?: "batch" | "transactions";
    poNo?: string;
    factoryPO?: string;
    size?: string;
  }) => {
    const q = new URLSearchParams({ productType: params.productType });
    if (params.createdDate) q.set("createdDate", params.createdDate);
    q.set("mode", params.mode || "batch");
    if (params.poNo) q.set("poNo", params.poNo);
    if (params.factoryPO) q.set("factoryPO", params.factoryPO);
    if (params.size) q.set("size", params.size);
    const res = await fetch(`/api/order-created-progress?${q}`);
    return jsonOrThrow<{
      ok: boolean;
      groups?: Array<{
        createdDate: string;
        poNo: string; factoryPO: string; size: string;
        orderQty: number; outputQty: number; inputQty: number;
        pending: number; remaining: number;
        outputProgress: number; inputProgress: number; inputVsOutput: number;
        deadline: string | null;
        model: string; sku: string; colorCode: string; season: string;
        status: string[];
        anomalies: string[];
        timeline: Array<{
          date: string; dailyOutput: number; dailyInput: number;
          cumOutput: number; cumInput: number;
          pending: number; remaining: number;
          outputProgress: number; inputProgress: number; inputVsOutput: number;
        }>;
      }>;
      summary?: {
        totalOrders: number; totalOrderQty: number;
        totalOutputQty: number; totalInputQty: number;
        totalPending: number; totalRemaining: number;
        avgOutputProgress: number; avgInputProgress: number;
        notStarted: number; inProgress: number;
        outputCompleted: number; inputCompleted: number;
        overOutput: number; overInput: number; anomalyCount: number;
      };
      dateOptions?: Array<{ raw: string; iso: string }>;
      transactions?: Array<{
        date: string; shippingStatus: string; bucket: string; qty: number;
        cumulativeOrder: number; cumulativeOutput: number; cumulativeInput: number;
        pending: number; remaining: number;
        outputProgress: number; inputProgress: number; inputVsOutput: number;
      }>;
    }>(res);
  },

  // Production Report & Data Validation
  getReportGroups: async (productType: string, filters?: Record<string, string>) => {
    const params = new URLSearchParams({ productType, ...(filters || {}) });
    const res = await fetch(`/api/report/groups?${params}`);
    return jsonOrThrow<{ groups: any[]; errors: any[]; summary: any }>(res);
  },

  // ===== Unified Order Monitor API =====
  orderMonitor: async (params: {
    productType: string;
    mode: "creation" | "deadline" | "matrix" | "daily" | "detail";
    createdFrom?: string; createdTo?: string;
    deadlineFrom?: string; deadlineTo?: string;
    asOfDate?: string;
    model?: string; poNo?: string; factoryPO?: string; size?: string;
  }) => {
    const q = new URLSearchParams({ productType: params.productType, mode: params.mode });
    if (params.createdFrom) q.set("createdFrom", params.createdFrom);
    if (params.createdTo) q.set("createdTo", params.createdTo);
    if (params.deadlineFrom) q.set("deadlineFrom", params.deadlineFrom);
    if (params.deadlineTo) q.set("deadlineTo", params.deadlineTo);
    if (params.asOfDate) q.set("asOfDate", params.asOfDate);
    if (params.model) q.set("model", params.model);
    if (params.poNo) q.set("poNo", params.poNo);
    if (params.factoryPO) q.set("factoryPO", params.factoryPO);
    if (params.size) q.set("size", params.size);
    const res = await fetch(`/api/order-monitor?${q}`);
    return jsonOrThrow<any>(res);
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
