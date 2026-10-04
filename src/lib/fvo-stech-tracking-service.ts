// FVO ↔ STECH Tracking Service
// Links two data sources (FVO and STECH) to track the full production flow:
//   FVO Order → Send to STECH → STECH processes → Receive from STECH → FVO Stock → FVO Output
//
// Composite matching key (spec §1 + user's size normalization rules):
//   FVO: poNo + factoryPO(ART) + gender + canonicalSize
//   STECH: factoryPO + poNo + gender + canonicalSize
//   Both produce the SAME key → match!
//
// Size normalization (user's rules — gender-specific, NO W↔M conversion):
//   STECH "M07/W08T" + Men model   → extract M07  = 7    (matches FVO Men "7")
//   STECH "M05/W06T" + Women model → extract W06T = 6.5  (matches FVO Women "6.5")
//   Rule: T suffix = +0.5
//   Rule: Men sizes 7-14 (M07-M14), Women sizes 5-10.5 (W05-W10T)
//   FVO sizes are plain numbers, already gender-specific (no conversion).
//
// READ-ONLY (spec §12): never modifies source data. Only reads + aggregates.

import { db } from "./db";
import { classifyShippingStatus } from "./quantity-service";

// ── Gender detection ────────────────────────────────────────────────────────

// Detect gender from model name.
// FVO models: "CLOUDSWIFT ONYX M" → Men, "CLOUDSWIFT ONYX W" → Women
// STECH models: same convention.
export type Gender = "M" | "W" | "";

export function detectGender(model: string | null | undefined): Gender {
  if (!model) return "";
  const m = model.trim().toUpperCase();
  if (!m) return "";
  // Check for explicit " M" or " W" as last word (most common pattern)
  if (/\bMS\b\s*$/.test(m) || /\bM\b\s*$/.test(m)) return "M";
  if (/\bWS\b\s*$/.test(m) || /\bW\b\s*$/.test(m)) return "W";
  // Check for MEN/WOMEN keywords
  if (/\bMEN\b/.test(m)) return "M";
  if (/\bWOMEN\b/.test(m)) return "W";
  // Check for "Men" or "Women" in mixed case
  if (/Men\b/i.test(model) && !/Women/i.test(model)) return "M";
  if (/Women\b/i.test(model)) return "W";
  return "";
}

// ── Size normalization ──────────────────────────────────────────────────────

// Size ranges (user's spec):
//   Men:   7 to 14   (M07 to M14, M07T to M13T)
//   Women: 5 to 10.5 (W05 to W10, W05T to W10T)

export const MEN_SIZE_RANGE = { min: 7, max: 14 };
export const WOMEN_SIZE_RANGE = { min: 5, max: 10.5 };

// Validate a canonical size against gender-specific range.
export function validateSizeRange(canonicalSize: string, gender: Gender): string | null {
  const n = Number(canonicalSize);
  if (isNaN(n)) return `Size "${canonicalSize}" is not a valid number.`;
  if (gender === "M") {
    if (n < MEN_SIZE_RANGE.min || n > MEN_SIZE_RANGE.max) {
      return `Men size ${n} is out of range (${MEN_SIZE_RANGE.min}-${MEN_SIZE_RANGE.max}).`;
    }
  } else if (gender === "W") {
    if (n < WOMEN_SIZE_RANGE.min || n > WOMEN_SIZE_RANGE.max) {
      return `Women size ${n} is out of range (${WOMEN_SIZE_RANGE.min}-${WOMEN_SIZE_RANGE.max}).`;
    }
  }
  return null;
}

// Convert STECH combined size to canonical gender-specific US size.
// User's rules:
//   - "M07/W08T" + Men model   → extract M07  = 7
//   - "M05/W06T" + Women model → extract W06T = 6.5
//   - T suffix = +0.5
//   - If gender unknown, prefer M part (most STECH data is Men-model first)
export function stechSizeToCanonical(size: string, gender: Gender = ""): string {
  const s = String(size || "").trim().toUpperCase();
  if (!s) return "";

  // If gender is known, extract the matching part
  if (gender === "M") {
    // Extract M part: M## or M##T
    const mMatch = s.match(/M(\d{1,2})(T)?/);
    if (mMatch) {
      const base = parseInt(mMatch[1], 10);
      const half = mMatch[2] === "T" ? 0.5 : 0;
      return String(base + half);
    }
  }

  if (gender === "W") {
    // Extract W part: W## or W##T
    const wMatch = s.match(/W(\d{1,2})(T)?/);
    if (wMatch) {
      const base = parseInt(wMatch[1], 10);
      const half = wMatch[2] === "T" ? 0.5 : 0;
      return String(base + half);
    }
  }

  // Gender unknown — try M first, then W (most STECH sizes have M prefix first)
  const mMatch = s.match(/M(\d{1,2})(T)?/);
  if (mMatch) {
    const base = parseInt(mMatch[1], 10);
    const half = mMatch[2] === "T" ? 0.5 : 0;
    return String(base + half);
  }

  const wMatch = s.match(/W(\d{1,2})(T)?/);
  if (wMatch) {
    const base = parseInt(wMatch[1], 10);
    const half = wMatch[2] === "T" ? 0.5 : 0;
    return String(base + half);
  }

  // Already a plain number (FVO-style)
  const n = Number(s);
  if (!isNaN(n)) return s;

  return s; // fallback: return as-is
}

// Convert FVO size to canonical.
// FVO sizes are plain numbers, already gender-specific (no W↔M conversion needed).
// Just return as-is, ensuring proper number formatting.
export function fvoSizeToCanonical(size: string, _gender: Gender = ""): string {
  const s = String(size || "").trim();
  if (!s) return "";
  const n = Number(s);
  if (!isNaN(n)) {
    // Format: integer if whole, else keep decimal
    return Number.isInteger(n) ? String(n) : String(n);
  }
  return s;
}

// ── Types ───────────────────────────────────────────────────────────────────

export interface TrackingRow {
  key: string; // canonical composite key: poNo|factoryPO|gender|canonicalSize
  fvoPoNo: string;
  fvoArt: string; // = STECH PO NO#
  gender: Gender; // "M" | "W" | ""
  size: string; // canonical gender-specific US size
  rawFvoSize: string;
  rawStechSize: string;
  model: string | null;
  colorCode: string | null;
  colorName: string | null;
  deadline: string | null;
  fvoOrderQty: number;
  stechOutputQty: number;
  stechReceivedQty: number;
  fvoOutputQty: number;
  fvoStock: number;
  remainingToReceive: number;
  remainingToOutput: number;
  availableToOutput: number;
  status: string; // WAITING_STECH | IN_STOCK | PARTIAL_OUTPUT | SHORTAGE | COMPLETED
  issues: string[];
}

export interface TrackingSummary {
  totalLines: number;
  totalFvoOrder: number;
  totalStechOutput: number;
  totalStechReceived: number;
  totalFvoOutput: number;
  totalFvoStock: number;
  totalRemainingToReceive: number;
  totalRemainingToOutput: number;
  shortageLines: number;
  statusCounts: Record<string, number>;
  genderCounts: { M: number; W: number; unknown: number };
}

// ── Aggregate source data ────────────────────────────────────────────────────

interface SourceAgg {
  poNo: string;
  factoryPO: string;
  gender: Gender;
  size: string; // canonical size
  model: string | null;
  colorCode: string | null;
  colorName: string | null;
  deadline: string | null;
  orderQty: number;
  outputQty: number;
  inputQty: number;
}

// Aggregate FVO data (productType = ONYX_FVO) by composite key.
// Key: poNo|factoryPO|gender|canonicalSize
async function aggregateFvo(): Promise<Map<string, SourceAgg>> {
  const rows = await db.masterData.findMany({
    where: { productType: "ONYX_FVO" },
    select: {
      poNo: true, factoryPO: true, size: true, model: true,
      colorCode: true, colorCode2: true, deadline: true,
      shippingStatus: true, qty1: true,
    },
  });

  const map = new Map<string, SourceAgg>();
  for (const r of rows) {
    const poNo = String(r.poNo || "").trim();
    const factoryPO = String(r.factoryPO || "").trim(); // ART
    const rawSize = String(r.size || "").trim();
    if (!poNo || !factoryPO || !rawSize) continue;

    const gender = detectGender(r.model);
    const canonicalSize = fvoSizeToCanonical(rawSize, gender);
    // Key includes gender to prevent Men size 7 colliding with Women size 7
    const key = `${poNo}|${factoryPO}|${gender}|${canonicalSize}`;

    let entry = map.get(key);
    if (!entry) {
      entry = {
        poNo, factoryPO, gender, size: canonicalSize,
        model: r.model, colorCode: r.colorCode, colorName: r.colorCode2,
        deadline: r.deadline, orderQty: 0, outputQty: 0, inputQty: 0,
      };
      map.set(key, entry);
    }
    const qty = r.qty1 ?? 0;
    const bucket = classifyShippingStatus(r.shippingStatus);
    if (bucket === "order") entry.orderQty += qty;
    else if (bucket === "output") entry.outputQty += qty;
    else if (bucket === "input") entry.inputQty += qty;
  }
  return map;
}

// Aggregate STECH data (productType = ONYX) by composite key.
// STECH: factoryPO = FVO's poNo, poNo = FVO's ART → same key format!
// Key: factoryPO|poNo|gender|canonicalSize (same as FVO's poNo|factoryPO|gender|canonicalSize)
async function aggregateStech(): Promise<Map<string, SourceAgg>> {
  const rows = await db.masterData.findMany({
    where: { productType: "ONYX" },
    select: {
      poNo: true, factoryPO: true, size: true, model: true,
      colorCode: true, colorCode2: true, deadline: true,
      shippingStatus: true, qty1: true,
    },
  });

  const map = new Map<string, SourceAgg>();
  for (const r of rows) {
    const factoryPO = String(r.factoryPO || "").trim(); // = FVO's poNo
    const poNo = String(r.poNo || "").trim(); // = FVO's ART
    const rawSize = String(r.size || "").trim();
    if (!factoryPO || !poNo || !rawSize) continue;

    const gender = detectGender(r.model);
    const canonicalSize = stechSizeToCanonical(rawSize, gender);
    // Key: factoryPO|poNo|gender|canonicalSize = same as FVO's poNo|factoryPO|gender|canonicalSize
    const key = `${factoryPO}|${poNo}|${gender}|${canonicalSize}`;

    let entry = map.get(key);
    if (!entry) {
      entry = {
        poNo: factoryPO, // display: FVO poNo = STECH factoryPO
        factoryPO: poNo, // display: FVO ART = STECH poNo
        gender, size: canonicalSize,
        model: r.model, colorCode: r.colorCode, colorName: r.colorCode2,
        deadline: r.deadline, orderQty: 0, outputQty: 0, inputQty: 0,
      };
      map.set(key, entry);
    }
    const qty = r.qty1 ?? 0;
    const bucket = classifyShippingStatus(r.shippingStatus);
    if (bucket === "order") entry.orderQty += qty;
    else if (bucket === "output") entry.outputQty += qty; // STECH sent out
    else if (bucket === "input") entry.inputQty += qty; // STECH received back
  }
  return map;
}

// ── Build tracking rows ─────────────────────────────────────────────────────

export async function buildTracking(
  filters?: {
    poNo?: string;
    art?: string;
    size?: string;
    model?: string;
    colorCode?: string;
    status?: string;
    gender?: string;
    page?: number;
    pageSize?: number;
  }
): Promise<{ rows: TrackingRow[]; total: number; summary: TrackingSummary }> {
  const [fvoMap, stechMap] = await Promise.all([aggregateFvo(), aggregateStech()]);

  // Merge all keys
  const allKeys = new Set<string>([...fvoMap.keys(), ...stechMap.keys()]);
  let rows: TrackingRow[] = [];

  for (const key of allKeys) {
    const fvo = fvoMap.get(key);
    const stech = stechMap.get(key);

    const fvoOrderQty = fvo?.orderQty ?? 0;
    const fvoOutputQty = fvo?.outputQty ?? 0;
    const stechOutputQty = stech?.outputQty ?? 0;
    const stechReceivedQty = stech?.inputQty ?? 0;

    // Compute (spec §4-7)
    const fvoStock = stechReceivedQty - fvoOutputQty;
    const remainingToReceive = fvoOrderQty - stechReceivedQty;
    const remainingToOutput = fvoOrderQty - fvoOutputQty;
    const availableToOutput = stechReceivedQty - fvoOutputQty;

    // Gender (from whichever source has it)
    const gender: Gender = fvo?.gender ?? stech?.gender ?? "";
    const canonicalSize = fvo?.size ?? stech?.size ?? "";

    // Determine status (spec §9)
    const issues: string[] = [];
    let status: string;

    if (fvoOutputQty > stechReceivedQty && stechReceivedQty > 0) {
      status = "SHORTAGE";
      issues.push(
        `FVO Output (${fvoOutputQty}) exceeds STECH Received (${stechReceivedQty}) by ${fvoOutputQty - stechReceivedQty}.`
      );
    } else if (fvoOrderQty > 0 && fvoOutputQty >= fvoOrderQty) {
      status = "COMPLETED";
    } else if (fvoOutputQty > 0 && fvoOutputQty < fvoOrderQty) {
      status = "PARTIAL_OUTPUT";
    } else if (fvoStock > 0) {
      status = "IN_STOCK";
    } else if (stechReceivedQty < fvoOrderQty) {
      status = "WAITING_STECH";
    } else {
      status = "IN_STOCK";
    }

    // Additional warnings
    if (fvoOrderQty === 0 && (stechOutputQty > 0 || stechReceivedQty > 0 || fvoOutputQty > 0)) {
      issues.push("STECH data exists but no FVO Order found.");
    }
    if (stechReceivedQty > fvoOrderQty && fvoOrderQty > 0) {
      issues.push(
        `STECH Received (${stechReceivedQty}) exceeds FVO Order (${fvoOrderQty}).`
      );
    }
    // Size range validation (user's spec)
    if (gender && canonicalSize) {
      const rangeErr = validateSizeRange(canonicalSize, gender);
      if (rangeErr) issues.push(rangeErr);
    }

    rows.push({
      key,
      fvoPoNo: fvo?.poNo ?? stech?.poNo ?? "",
      fvoArt: fvo?.factoryPO ?? stech?.factoryPO ?? "",
      gender,
      size: canonicalSize,
      rawFvoSize: fvo ? fvo.size : "",
      rawStechSize: stech ? stech.size : "",
      model: fvo?.model ?? stech?.model ?? null,
      colorCode: fvo?.colorCode ?? stech?.colorCode ?? null,
      colorName: fvo?.colorName ?? stech?.colorName ?? null,
      deadline: fvo?.deadline ?? stech?.deadline ?? null,
      fvoOrderQty,
      stechOutputQty,
      stechReceivedQty,
      fvoOutputQty,
      fvoStock,
      remainingToReceive,
      remainingToOutput,
      availableToOutput,
      status,
      issues,
    });
  }

  // Apply filters
  if (filters?.poNo) {
    rows = rows.filter((r) => r.fvoPoNo.toLowerCase().includes(filters.poNo!.toLowerCase()));
  }
  if (filters?.art) {
    rows = rows.filter((r) => r.fvoArt.toLowerCase().includes(filters.art!.toLowerCase()));
  }
  if (filters?.size) {
    rows = rows.filter((r) => r.size.includes(filters.size!));
  }
  if (filters?.model) {
    rows = rows.filter((r) => (r.model || "").toLowerCase().includes(filters.model!.toLowerCase()));
  }
  if (filters?.colorCode) {
    rows = rows.filter((r) => (r.colorCode || "").toLowerCase().includes(filters.colorCode!.toLowerCase()));
  }
  if (filters?.status) {
    rows = rows.filter((r) => r.status === filters.status);
  }
  if (filters?.gender) {
    rows = rows.filter((r) => r.gender === filters.gender);
  }

  // Sort: shortage first, then by status, then by poNo
  rows.sort((a, b) => {
    const statusOrder: Record<string, number> = {
      SHORTAGE: 0, WAITING_STECH: 1, PARTIAL_OUTPUT: 2, IN_STOCK: 3, COMPLETED: 4,
    };
    const sa = statusOrder[a.status] ?? 99;
    const sb = statusOrder[b.status] ?? 99;
    if (sa !== sb) return sa - sb;
    return a.fvoPoNo.localeCompare(b.fvoPoNo);
  });

  const total = rows.length;

  // Pagination
  const page = filters?.page ?? 1;
  const pageSize = filters?.pageSize ?? 50;
  const start = (page - 1) * pageSize;
  const paginated = rows.slice(start, start + pageSize);

  // Summary
  const summary: TrackingSummary = {
    totalLines: total,
    totalFvoOrder: rows.reduce((s, r) => s + r.fvoOrderQty, 0),
    totalStechOutput: rows.reduce((s, r) => s + r.stechOutputQty, 0),
    totalStechReceived: rows.reduce((s, r) => s + r.stechReceivedQty, 0),
    totalFvoOutput: rows.reduce((s, r) => s + r.fvoOutputQty, 0),
    totalFvoStock: rows.reduce((s, r) => s + Math.max(0, r.fvoStock), 0),
    totalRemainingToReceive: rows.reduce((s, r) => s + Math.max(0, r.remainingToReceive), 0),
    totalRemainingToOutput: rows.reduce((s, r) => s + Math.max(0, r.remainingToOutput), 0),
    shortageLines: rows.filter((r) => r.status === "SHORTAGE").length,
    statusCounts: rows.reduce((acc, r) => {
      acc[r.status] = (acc[r.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>),
    genderCounts: {
      M: rows.filter((r) => r.gender === "M").length,
      W: rows.filter((r) => r.gender === "W").length,
      unknown: rows.filter((r) => r.gender === "").length,
    },
  };

  return { rows: paginated, total, summary };
}
