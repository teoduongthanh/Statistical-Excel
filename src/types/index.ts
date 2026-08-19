import type { CanonicalField } from "./fields";

// Shared DTO types used by both API and frontend.

export interface MasterDataRow {
  id: string;
  date?: string | null;
  shippingStatus?: string | null;
  model?: string | null;
  sku?: string | null;
  poNo?: string | null;
  factoryPO?: string | null;
  item?: string | null;
  season?: string | null;
  colorCode?: string | null;
  colorCode2?: string | null;
  painting?: string | null;
  printingColor?: string | null;
  size?: string | null;
  qty1?: string | null;
  qty2?: string | null;
  deadline?: string | null;
  sourceFile?: string | null;
  sheetName?: string | null;
  rowIndex?: number;
}

export interface SharedFlags {
  model?: boolean;
  sku?: boolean;
  poNo?: boolean;
  item?: boolean;
  season?: boolean;
  colorCode?: boolean;
  colorCode2?: boolean;
  painting?: boolean;
  printingColor?: boolean;
  date?: boolean;
  shippingStatus?: boolean;
  deadline?: boolean;
}

export interface MasterGroup {
  id: string;
  factoryPO: string;
  date?: string | null;
  shippingStatus?: string | null;
  model?: string | null;
  sku?: string | null;
  poNo?: string | null;
  item?: string | null;
  season?: string | null;
  colorCode?: string | null;
  colorCode2?: string | null;
  painting?: string | null;
  printingColor?: string | null;
  sizes: string[];
  sharedFlags: SharedFlags;
  rowCount: number;
  sourceFile?: string | null;
}

export interface EntryData {
  id: string;
  factoryPO: string;
  size: string;
  qty1: string;
  qty2: string;
  date?: string | null;
  shippingStatus?: string | null;
  model?: string | null;
  sku?: string | null;
  poNo?: string | null;
  item?: string | null;
  season?: string | null;
  colorCode?: string | null;
  colorCode2?: string | null;
  painting?: string | null;
  printingColor?: string | null;
  deadline?: string | null;
  sourceMasterId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AutocompleteSuggestion {
  value: string;
  label: string;
  sub?: string;
  score: number;
}

export interface ImportError {
  row: number;
  message: string;
  data?: Record<string, string>;
}

export interface ImportHistoryItem {
  id: string;
  fileName: string;
  sheetName?: string | null;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  errors: ImportError[];
  importedAt: string;
}

export interface ColumnMapping {
  [excelHeader: string]: CanonicalField | "";
}

export interface SheetInfo {
  name: string;
  totalRows: number;
  totalCols: number;
}

export interface ParseResult {
  fileName: string;
  sheets: SheetInfo[];
  selectedSheet: string;
  headers: string[];
  preview: Record<string, string>[];
  totalRows: number;
}

export interface LookupRuleConfig {
  id?: string;
  name: string;
  primaryKey: CanonicalField;
  secondaryKey?: CanonicalField | null;
  lookupFields: CanonicalField[];
  autoCalcQty2: boolean;
  active: boolean;
}

export interface AppSettings {
  autoCalcQty2: boolean;
  allowNegativeQty1: boolean;
  duplicateDetection: boolean;
  defaultExportColumns: CanonicalField[];
}

export interface DashboardStats {
  totalMaster: number;
  totalEntries: number;
  totalFactoryPO: number;
  totalSKU: number;
  totalModels: number;
  todayEntries: number;
  entriesByDate: { date: string; count: number }[];
  entriesByFactoryPO: { factoryPO: string; count: number }[];
  entriesByModel: { model: string; count: number }[];
  entriesBySeason: { season: string; count: number }[];
}
