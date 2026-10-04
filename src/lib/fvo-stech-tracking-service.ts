// FVO ↔ STECH Tracking Service
// Links two data sources (FVO and STECH) to track the full production flow:
//   FVO Order → Send to STECH → STECH processes → Receive from STECH → FVO Stock → FVO Output
//
// Composite matching key (spec §1):
//   FVO: poNo + factoryPO(ART) + size  →  "OCF26060136|3MH10325626|8.5"
//   STECH: factoryPO + poNo + size     →  "OCF26060136|3MH10325626|8.5"
//   Both produce the SAME key → match!
//
// Size normalization (critical — FVO uses US sizes, STECH uses combined M/W):
//   FVO: "8.5" (Men model) or "10" (Women model)
//   STECH: "M08T/W10" (Men 8.5 / Women 10)
//   Canonical: convert both to Men's US size number
//     STECH "M08T/W10" → 8.5 (extract M part: M08=8, T=.5)
//     FVO Men "8.5" → 8.5
//     FVO Women "10" → 8.5 (W - 1.5 = M equivalent)
//
// READ-ONLY (spec §12): never modifies source data. Only reads + aggregates.

import { db } from "./db";
import { classifyShippingStatus } from "./quantity-service";

// ── Size normalization ──────────────────────────────────────────────────────

// Convert STECH combined size (e.g., "M08T/W10") to canonical Men's US size.
// "M08" → 8, "M08T" → 8.5, "M09" → 9, "M09T" → 9.5, "M10" → 10, etc.
// If no M part, try W part and convert (W - 1.5 = M equivalent).
function stechSizeToCanonical(size: string): string {
  const s = String(size || "").trim().toUpperCase();
  if (!s) return "";

  // Try to extract M part: M## or M##T
  const mMatch = s.match(/M(\d{1,2})(T)?/);
  if (mMatch) {
    const base = parseInt(mMatch[1], 10);
    const half = mMatch[2] === "T" ? 0.5 : 0;
    return String(base + half);
  }

  // Try W part: W## or W##T → convert to Men's (W - 1.5)
  const wMatch = s.match(/W(\d{1,2})(T)?/);
  if (wMatch) {
    const base = parseInt(wMatch[1], 10);
    const half = wMatch[2] === "T" ? 0.5 : 0;
    const womenSize = base + half;
    const menSize = womenSize - 1.5;
    return String(menSize);
  }

  // Already a plain number
  const n = Number(s);
  if (!isNaN(n)) return s;

  return s; // fallback: return as-is
}

// Convert FVO size + model gender to canonical Men's US size.
// FVO Men model: size as-is (already Men's)
// FVO Women model: W - 1.5 = M equivalent
function fvoSizeToCanonical(size: string, model: string | null | undefined): string {
  const s = String(size || "").trim();
  if (!s) return "";
  const n = Number(s);
  if (isNaN(n)) return s;

  const modelUpper = String(model || "").toUpperCase();
  // Women's model: convert W to M equivalent
  if (/\bW\b/.test(modelUpper) && !/\bM\b/.test(modelUpper)) {
    return String(n - 1.5);
  }
  // Men's model: size as-is
  return s;
}

// ── Types ───────────────────────────────────────────────────────────────────

export interface TrackingRow {
  key: string; // canonical composite key: poNo|factoryPO|canonicalSize
  fvoPoNo: string;
  fvoArt: string; // = STECH PO NO#
  size: string; // canonical size
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
}

// ── Aggregate source data ────────────────────────────────────────────────────

interface SourceAgg {
  poNo: string;
  factoryPO: string;
  size: string;
  canonicalSize: string;
  model: string | null;
  colorCode: string | null;
  colorName: string | null;
  deadline: string | null;
  orderQty: number;
  outputQty: number;
  inputQty: number;
}

// Aggregate FVO data (productType = ONYX_FVO) by composite key.
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
    const canonicalSize = fvoSizeToCanonical(rawSize, r.model);
    const key = `${poNo}|${factoryPO}|${canonicalSize}`;

    let entry = map.get(key);
    if (!entry) {
      entry = {
        poNo, factoryPO, size: canonicalSize, canonicalSize,
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
// STECH: factoryPO = FVO's poNo, poNo = FVO's ART → same key!
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
    const canonicalSize = stechSizeToCanonical(rawSize);
    // Key: factoryPO|poNo|canonicalSize = same as FVO's poNo|factoryPO|canonicalSize
    const key = `${factoryPO}|${poNo}|${canonicalSize}`;

    let entry = map.get(key);
    if (!entry) {
      entry = {
        poNo: factoryPO, // for display: FVO poNo = STECH factoryPO
        factoryPO: poNo, // for display: FVO ART = STECH poNo
        size: canonicalSize, canonicalSize,
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

    // Determine status (spec §9)
    const issues: string[] = [];
    let status: string;

    if (fvoOutputQty > stechReceivedQty && stechReceivedQty > 0) {
      // Spec §8: FVO Output > STECH Received → SHORTAGE
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

    rows.push({
      key,
      fvoPoNo: fvo?.poNo ?? stech?.poNo ?? "",
      fvoArt: fvo?.factoryPO ?? stech?.factoryPO ?? "",
      size: fvo?.canonicalSize ?? stech?.canonicalSize ?? "",
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
  };

  return { rows: paginated, total, summary };
}
