import * as XLSX from "xlsx";
import type { CanonicalField } from "./fields";
import { FIELD_LABELS } from "./fields";
import type { ColumnMapping, SheetInfo } from "@/types";

export interface ParsedSheet {
  headers: string[];
  rows: Record<string, string>[];
}

// Read an Excel/CSV file buffer and return sheets metadata.
export function readWorkbook(buffer: ArrayBuffer): {
  wb: XLSX.WorkBook;
  sheets: SheetInfo[];
} {
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheets: SheetInfo[] = wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    const ref = ws["!ref"];
    const range = ref ? XLSX.utils.decode_range(ref) : { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } };
    return {
      name,
      totalRows: range.e.r - range.s.r,
      totalCols: range.e.c - range.s.c + 1,
    };
  });
  return { wb, sheets };
}

// Parse a sheet into header + row objects (stringified values, whitespace-normalized).
export function parseSheet(
  wb: XLSX.WorkBook,
  sheetName: string,
  maxRows?: number
): ParsedSheet {
  const ws = wb.Sheets[sheetName];
  if (!ws) return { headers: [], rows: [] };
  const raw: unknown[][] = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    raw: true,
    defval: "",
    blankrows: false,
  });
  if (raw.length === 0) return { headers: [], rows: [] };
  const headerRow = raw[0] as unknown[];
  const headers = headerRow.map((h, i) => {
    const s = String(h ?? "").trim();
    return s || `Column_${i + 1}`;
  });

  const limit = maxRows ?? raw.length - 1;
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < raw.length && rows.length < limit; i++) {
    const r = raw[i] as unknown[];
    // Skip fully empty rows.
    if (!r || r.every((c) => c === "" || c === null || c === undefined)) continue;
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      let val = r[idx];
      if (val instanceof Date) {
        // Excel date serial handling already done by cellDates:true; format as yyyy-mm-dd.
        val = val.toISOString().slice(0, 10);
      } else if (typeof val === "number") {
        // Keep numbers as-is unless they look like a date serial (handled above).
        val = String(val);
      } else {
        val = String(val ?? "").replace(/\r\n/g, " ").replace(/\n/g, " ").trim();
      }
      obj[h] = String(val);
    });
    rows.push(obj);
  }
  return { headers, rows };
}

// Apply a column mapping to parsed rows → array of normalized records keyed by canonical field.
export function applyMapping(
  rows: Record<string, string>[],
  mapping: ColumnMapping
): Partial<Record<CanonicalField, string>>[] {
  return rows.map((row) => {
    const out: Partial<Record<CanonicalField, string>> = {};
    for (const [excelHeader, field] of Object.entries(mapping)) {
      if (!field) continue;
      const v = row[excelHeader];
      if (v !== undefined && v !== "") out[field] = String(v).trim();
    }
    return out;
  });
}

// Format a deadline/date string to M/D/YYYY (e.g. "2026-08-15" → "8/15/2026").
// Handles: yyyy-MM-dd, yyyy/MM/dd, dd/MM/yyyy, Excel serial numbers, and
// already-formatted M/D/YYYY strings (returned as-is).
export function formatDeadline(raw: string | number | null | undefined): string {
  if (raw === null || raw === undefined || raw === "") return "";
  const s = String(raw).trim();
  if (!s) return "";

  // Already M/D/YYYY or M/D/YY? Leave as-is.
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(s)) return s;

  // yyyy-MM-dd or yyyy/MM/dd
  const isoMatch = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (isoMatch) {
    const y = Number(isoMatch[1]);
    const m = Number(isoMatch[2]);
    const d = Number(isoMatch[3]);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return `${m}/${d}/${y}`;
  }

  // dd/MM/yyyy
  const dmyMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmyMatch) {
    const d = Number(dmyMatch[1]);
    const m = Number(dmyMatch[2]);
    const y = Number(dmyMatch[3]);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return `${m}/${d}/${y}`;
  }

  // Try generic Date parse (ISO, etc.) → reformat.
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = parsed.getMonth() + 1;
    const d = parsed.getDate();
    return `${m}/${d}/${y}`;
  }

  // Excel serial (number of days since 1899-12-30).
  const n = Number(s);
  if (!isNaN(n) && n > 1000) {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    epoch.setDate(epoch.getDate() + n);
    const y = epoch.getFullYear();
    const m = epoch.getMonth() + 1;
    const d = epoch.getDate();
    return `${m}/${d}/${y}`;
  }

  return s;
}

// Build an Excel workbook from entry/master rows and return a Node Buffer.
// Rows are exported in the order provided (caller controls sort order).
// qty1/qty2 are exported as numbers; deadline/date are formatted as M/D/YYYY.
export function buildExcelBuffer(
  rows: Partial<Record<CanonicalField, string | number | null | undefined>>[],
  columns: CanonicalField[]
): Buffer {
  const wb = XLSX.utils.book_new();
  const headerLabels = columns.map((c) => FIELD_LABELS[c]);
  const data = rows.map((row) => {
    const o: Record<string, string | number | null> = {};
    columns.forEach((c) => {
      const raw = row[c];
      if (c === "qty1" || c === "qty2") {
        // Export as number (integer). Parse if string, default 0 if empty/null.
        const n = typeof raw === "number" ? raw : parseInt(String(raw ?? "0"), 10);
        o[FIELD_LABELS[c]] = isNaN(n) ? 0 : n;
      } else if (c === "deadline" || c === "date") {
        // Format deadline/date as M/D/YYYY (e.g. "2026-08-15" → "8/15/2026").
        o[FIELD_LABELS[c]] = formatDeadline(raw);
      } else {
        o[FIELD_LABELS[c]] = (raw as string | number | null) ?? "";
      }
    });
    return o;
  });
  const ws = XLSX.utils.json_to_sheet(data, { header: headerLabels });
  XLSX.utils.book_append_sheet(wb, ws, "Export");
  const out = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return out;
}

// Parse pasted tab-separated text (from Excel clipboard) into rows.
export function parsePastedText(text: string): string[][] {
  const lines = text.replace(/\r\n/g, "\n").split("\n").filter((l) => l.trim() !== "");
  return lines.map((line) => line.split("\t"));
}
