// Typed API client wrappers for the Smart Excel Data Entry System.
import type {
  AppSettings,
  AutocompleteSuggestion,
  CanonicalField as _CF,
  DashboardStats,
  EntryData,
  ImportHistoryItem,
  LookupRuleConfig,
  MasterGroup,
  ParseResult,
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
  parseExcel: async (file: File, sheet?: string): Promise<ParseResult & { autoMapping: Record<string, CanonicalField | ""> }> => {
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

  searchMaster: async (q: string, field: CanonicalField, limit = 15): Promise<AutocompleteSuggestion[]> => {
    const res = await fetch(
      `/api/master-data/search?q=${encodeURIComponent(q)}&field=${field}&limit=${limit}`
    );
    return jsonOrThrow(res);
  },

  lookupFactoryPO: async (factoryPO: string): Promise<MasterGroup> => {
    const res = await fetch(`/api/master-data/factory-po/${encodeURIComponent(factoryPO)}`);
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
    factoryPO: string;
    size: string;
    qty1: string;
    autoCalcQty2?: boolean;
  }) => {
    const res = await fetch("/api/entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return jsonOrThrow<{ ok: boolean; entry?: EntryData; errors?: string[] }>(res);
  },

  bulkEntries: async (items: { factoryPO: string; size: string; qty1: string }[], autoCalcQty2 = true) => {
    const res = await fetch("/api/entries/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items, autoCalcQty2 }),
    });
    return jsonOrThrow(res);
  },

  updateEntry: async (id: string, body: any) => {
    const res = await fetch(`/api/entries/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return jsonOrThrow(res);
  },

  deleteEntry: async (id: string) => {
    const res = await fetch(`/api/entries/${id}`, { method: "DELETE" });
    return jsonOrThrow(res);
  },

  checkDuplicate: async (factoryPO: string, size: string) => {
    const res = await fetch("/api/entries/check-duplicate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ factoryPO, size }),
    });
    return jsonOrThrow<{ duplicate: boolean; existing: any }>(res);
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
