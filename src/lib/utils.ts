import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Format any date value to dd/MM/yyyy display format.
// Handles: Excel serials (e.g. "45840"), yyyy-MM-dd, dd/MM/yyyy, ISO, Date objects.
// This is the SINGLE source of truth for date display across all views.
// Always outputs dd/MM/yyyy (e.g. "16/09/2026") to match the Excel file format.
export function formatDateDisplay(raw: string | number | Date | null | undefined): string {
  if (raw === null || raw === undefined || raw === "") return "—";

  // Date object
  if (raw instanceof Date) {
    if (isNaN(raw.getTime())) return "—";
    const d = raw.getDate();
    const m = raw.getMonth() + 1;
    const y = raw.getFullYear();
    return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
  }

  const s = String(raw).trim();
  if (!s) return "—";

  // Already dd/MM/yyyy or d/M/yyyy → normalize to dd/MM/yyyy
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(s)) {
    const parts = s.split("/");
    let d = Number(parts[0]);
    let m = Number(parts[1]);
    let y = Number(parts[2]);
    if (y < 100) y += 2000;
    return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
  }

  // yyyy-MM-dd or yyyy/MM/dd → dd/MM/yyyy
  const isoMatch = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (isoMatch) {
    const y = Number(isoMatch[1]);
    const m = Number(isoMatch[2]);
    const d = Number(isoMatch[3]);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
    }
  }

  // Excel serial (pure number like "45840") — MUST be checked BEFORE `new Date(s)`
  // because `new Date("45840")` interprets it as year 45840.
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n > 1000 && n < 100000) {
      const epoch = new Date(Date.UTC(1899, 11, 30));
      epoch.setDate(epoch.getDate() + Math.floor(n));
      const y = epoch.getFullYear();
      const m = epoch.getMonth() + 1;
      const d = epoch.getDate();
      return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
    }
    // Small numbers (like ONYX deadline "1", "2") → not real dates
    return s;
  }

  // Try generic Date parse (ISO, etc.) → reformat to dd/MM/yyyy
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    const d = parsed.getDate();
    const m = parsed.getMonth() + 1;
    const y = parsed.getFullYear();
    return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
  }

  return s;
}
