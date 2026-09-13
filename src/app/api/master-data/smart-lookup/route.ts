import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { lookupFactoryPO } from "@/lib/master-service";
import type { MasterGroup } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ────────────────────────────────────────────────────────────────────────────
// SMART ENTRY DATA SYSTEM — 4-LEVEL MATCHING ENGINE + DEADLINE LOOKUP
// ────────────────────────────────────────────────────────────────────────────
// POST /api/master-data/smart-lookup
// Body: { productType, poNo?, factoryPO?, size? }
//
// Matching levels (highest priority first):
//   Level 1 — EXACT MATCH    (Product Type + PO NO# + Factory PO + Size) → HIGH
//   Level 2 — FACTORY PO + PO NO# (no valid Size yet)                    → MEDIUM
//   Level 3 — FACTORY PO only (no PO NO# match, or no PO NO#)            → MEDIUM
//   Level 4 — PARTIAL MATCH (last 3-4 digits of Factory PO)              → LOW
//   Level 0  = no match at all                                           → NONE
//
// DEADLINE LOOKUP (spec §4):
//   The deadline is retrieved from MasterData rows with Shipping Status =
//   "1.Order" (the master source). Priority:
//     1. Exact (poNo + factoryPO + size) in 1.Order rows → 100%
//     2. (poNo + factoryPO + size) in any status → 95%
//     3. (factoryPO + size) in 1.Order rows → 90%
//     4. (factoryPO + size) in any status, single deadline → 80-90%
//     5. (factoryPO) only → MULTIPLE DEADLINES, user must pick → <80%
// ────────────────────────────────────────────────────────────────────────────

interface SmartLookupBody {
  productType?: string;
  poNo?: string;
  factoryPO?: string;
  size?: string;
}

export interface DeadlineInfo {
  deadline: string | null;
  deadlineSource: "1.Order" | "other" | "multiple" | "none";
  deadlineSourceRecordId?: string;
  deadlineConfidence: number; // 0-100
  deadlineMatchLevel: 1 | 2 | 3 | 4 | 5;
  deadlineOptions?: Array<{ poNo: string; size: string; deadline: string | null; recordId: string }>;
}

export interface SmartCandidate {
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
}

export interface SmartLookupResult {
  ok: boolean;
  level: 0 | 1 | 2 | 3 | 4;
  confidence: "HIGH" | "MEDIUM" | "LOW" | "NONE";
  masterGroup?: MasterGroup;
  candidates?: SmartCandidate[];
  availableSizes?: string[];
  deadlineInfo?: DeadlineInfo;
}

// Normalize a size string for comparison:
//  - trims leading/trailing spaces
//  - removes line breaks (\r, \n)
//  - collapses duplicate internal whitespace into a single space
// PRESERVES the T suffix (e.g. "M(10)" ≠ "M(10T)") — we only touch whitespace,
// not other characters.
export function normalizeSize(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/\r?\n/g, " ") // remove line breaks (CR, LF)
    .replace(/\s+/g, " ")   // collapse duplicate spaces / tabs
    .trim();                 // trim leading/trailing whitespace
}

// ── Deadline Lookup Engine ────────────────────────────────────────────────
// Finds the deadline from MasterData, prioritizing Shipping Status = 1.Order.
// Returns DeadlineInfo with confidence + source record ID.
async function lookupDeadline(
  productType: string,
  poNo: string,
  factoryPO: string,
  size: string
): Promise<DeadlineInfo> {
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  const sizeNorm = norm(size);

  // LEVEL 1: Exact (poNo + factoryPO + size) in 1.Order rows → 100%
  const orderRows = await db.masterData.findMany({
    where: {
      productType,
      poNo,
      factoryPO,
      shippingStatus: { startsWith: "1" },
    },
    select: { id: true, size: true, deadline: true, shippingStatus: true },
  });
  const orderSizeMatch = orderRows.find((r) => norm(r.size || "") === sizeNorm);
  if (orderSizeMatch && orderSizeMatch.deadline) {
    return {
      deadline: orderSizeMatch.deadline,
      deadlineSource: "1.Order",
      deadlineSourceRecordId: orderSizeMatch.id,
      deadlineConfidence: 100,
      deadlineMatchLevel: 1,
    };
  }

  // LEVEL 2: Exact (poNo + factoryPO + size) in any status → 95%
  const anyRows = await db.masterData.findMany({
    where: { productType, poNo, factoryPO },
    select: { id: true, size: true, deadline: true, shippingStatus: true },
  });
  const anySizeMatch = anyRows.find((r) => norm(r.size || "") === sizeNorm);
  if (anySizeMatch && anySizeMatch.deadline) {
    // Prefer 1.Order deadline if multiple exist for same key
    const orderMatch = anyRows.find(
      (r) => norm(r.size || "") === sizeNorm && (r.shippingStatus || "").startsWith("1")
    );
    if (orderMatch && orderMatch.deadline) {
      return {
        deadline: orderMatch.deadline,
        deadlineSource: "1.Order",
        deadlineSourceRecordId: orderMatch.id,
        deadlineConfidence: 100,
        deadlineMatchLevel: 1,
      };
    }
    return {
      deadline: anySizeMatch.deadline,
      deadlineSource: "other",
      deadlineSourceRecordId: anySizeMatch.id,
      deadlineConfidence: 95,
      deadlineMatchLevel: 2,
    };
  }

  // LEVEL 3: (factoryPO + size) in 1.Order rows → 90%
  const fpoOrderRows = await db.masterData.findMany({
    where: { productType, factoryPO, shippingStatus: { startsWith: "1" } },
    select: { id: true, poNo: true, size: true, deadline: true, shippingStatus: true },
  });
  const fpoOrderSizeMatch = fpoOrderRows.find((r) => norm(r.size || "") === sizeNorm);
  if (fpoOrderSizeMatch && fpoOrderSizeMatch.deadline) {
    return {
      deadline: fpoOrderSizeMatch.deadline,
      deadlineSource: "1.Order",
      deadlineSourceRecordId: fpoOrderSizeMatch.id,
      deadlineConfidence: 90,
      deadlineMatchLevel: 3,
    };
  }

  // LEVEL 4: (factoryPO + size) in any status, single deadline → 80-90%
  const fpoAnyRows = await db.masterData.findMany({
    where: { productType, factoryPO },
    select: { id: true, poNo: true, size: true, deadline: true, shippingStatus: true },
  });
  const fpoAnySizeMatch = fpoAnyRows
    .filter((r) => norm(r.size || "") === sizeNorm)
    .filter((r) => r.deadline);
  if (fpoAnySizeMatch.length === 1) {
    return {
      deadline: fpoAnySizeMatch[0]!.deadline,
      deadlineSource: (fpoAnySizeMatch[0]!.shippingStatus || "").startsWith("1") ? "1.Order" : "other",
      deadlineSourceRecordId: fpoAnySizeMatch[0]!.id,
      deadlineConfidence: 85,
      deadlineMatchLevel: 4,
    };
  }
  if (fpoAnySizeMatch.length > 1) {
    // Multiple deadlines for same (factoryPO + size) → user must pick
    const deadlines = Array.from(
      new Map(fpoAnySizeMatch.map((r) => [r.deadline, r])).values()
    );
    if (deadlines.length === 1) {
      // Same deadline across all → safe to use
      return {
        deadline: deadlines[0]!.deadline,
        deadlineSource: "other",
        deadlineSourceRecordId: deadlines[0]!.id,
        deadlineConfidence: 85,
        deadlineMatchLevel: 4,
      };
    }
    return {
      deadline: null,
      deadlineSource: "multiple",
      deadlineConfidence: 60,
      deadlineMatchLevel: 5,
      deadlineOptions: deadlines.map((r) => ({
        poNo: r.poNo || "",
        size: r.size || "",
        deadline: r.deadline,
        recordId: r.id,
      })),
    };
  }

  // No deadline found at all
  return {
    deadline: null,
    deadlineSource: "none",
    deadlineConfidence: 0,
    deadlineMatchLevel: 5,
  };
}

export async function POST(req: NextRequest) {
  let body: SmartLookupBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, level: 0, confidence: "NONE", error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const productType = (body.productType || "").trim();
  const poNo = (body.poNo || "").trim();
  const factoryPO = (body.factoryPO || "").trim();
  const size = (body.size || "").trim();

  if (!productType || !factoryPO) {
    return NextResponse.json({
      ok: false,
      level: 0,
      confidence: "NONE",
    } satisfies SmartLookupResult);
  }

  // ── Try exact MasterGroup lookup (Levels 1, 2, 3 all require this) ──────
  const group = await lookupFactoryPO(factoryPO, productType);

  if (group) {
    // factoryPO exists in Master Data. Decide between Level 1 / 2 / 3.

    if (poNo) {
      // Check if (factoryPO + poNo) co-occurs in MasterData.
      const matchingRows = await db.masterData.findMany({
        where: { productType, factoryPO, poNo },
        select: { size: true },
      });
      const distinctSizes = Array.from(
        new Set(
          matchingRows
            .map((r) => (r.size || "").trim())
            .filter(Boolean)
        )
      ).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

      if (distinctSizes.length > 0) {
        // poNo matches → at least Level 2 (MEDIUM confidence).
        if (size) {
          const sizeMatch = distinctSizes.some(
            (s) => normalizeSize(s) === normalizeSize(size)
          );
          if (sizeMatch) {
            // ✅ Level 1: all 4 fields match exactly → HIGH confidence.
            // Fetch deadline from 1.Order rows (spec §4-5).
            const deadlineInfo = await lookupDeadline(productType, poNo, factoryPO, size);
            // Override the masterGroup's deadline with the precise one.
            const masterGroupWithDeadline = {
              ...group,
              deadline: deadlineInfo.deadline || group.deadline,
              nearestDeadline: deadlineInfo.deadline || group.nearestDeadline,
            };
            return NextResponse.json({
              ok: true,
              level: 1,
              confidence: "HIGH",
              masterGroup: masterGroupWithDeadline,
              availableSizes: distinctSizes,
              deadlineInfo,
            } satisfies SmartLookupResult);
          }
          // Size given but doesn't match the (factoryPO + poNo) sizes.
          // Fall through to Level 2 (show available sizes).
        }
        // Level 2: factoryPO + poNo match, no valid size yet (MEDIUM).
        return NextResponse.json({
          ok: true,
          level: 2,
          confidence: "MEDIUM",
          masterGroup: group,
          availableSizes: distinctSizes,
        } satisfies SmartLookupResult);
      }
      // poNo doesn't match any row → fall to Level 3 (group found, poNo mismatch).
    }

    // Level 3: factoryPO found, no poNo match (or no poNo at all).
    // If size is provided, try deadline lookup by (factoryPO + size).
    let deadlineInfo: DeadlineInfo | undefined;
    if (size) {
      deadlineInfo = await lookupDeadline(productType, poNo || "", factoryPO, size);
    }
    return NextResponse.json({
      ok: true,
      level: 3,
      confidence: "MEDIUM",
      masterGroup: deadlineInfo
        ? { ...group, deadline: deadlineInfo.deadline || group.deadline, nearestDeadline: deadlineInfo.deadline || group.nearestDeadline }
        : group,
      availableSizes: group.sizes,
      deadlineInfo,
    } satisfies SmartLookupResult);
  }

  // ── factoryPO not found exactly → Level 4 (partial match by suffix) ────
  // Take the last 3-4 chars of the input Factory PO and search MasterGroup
  // for any factoryPO ending with that tail.
  const tailLen = Math.min(Math.max(factoryPO.length, 3), 4);
  const tail = factoryPO.slice(-tailLen);

  // Primary: endsWith on the tail (matches "last 3-4 digits" rule).
  let partialGroups = await db.masterGroup.findMany({
    where: {
      productType,
      factoryPO: { endsWith: tail },
    },
    take: 25,
    select: {
      factoryPO: true, poNo: true, model: true, sku: true,
      colorCode: true, colorCode2: true, painting: true,
      printingColor: true, season: true, deadline: true,
      nearestDeadline: true, sizes: true,
    },
  });

  // Secondary fallback: if endsWith returned nothing, try contains with the
  // full input string (handles in-the-middle typos).
  if (partialGroups.length === 0 && factoryPO.length >= 3) {
    partialGroups = await db.masterGroup.findMany({
      where: {
        productType,
        factoryPO: { contains: factoryPO },
      },
      take: 25,
      select: {
        factoryPO: true, poNo: true, model: true, sku: true,
        colorCode: true, colorCode2: true, painting: true,
        printingColor: true, season: true, deadline: true,
        nearestDeadline: true, sizes: true,
      },
    });
  }

  if (partialGroups.length > 0) {
    const candidates: SmartCandidate[] = partialGroups.map((g) => ({
      factoryPO: g.factoryPO,
      poNo: g.poNo || "",
      model: g.model || "",
      sku: g.sku || "",
      colorCode: g.colorCode || "",
      colorCode2: g.colorCode2 || "",
      painting: g.painting || "",
      printingColor: g.printingColor || "",
      season: g.season || "",
      deadline: g.deadline || g.nearestDeadline || null,
      sizes: JSON.parse(g.sizes || "[]") as string[],
    }));
    return NextResponse.json({
      ok: true,
      level: 4,
      confidence: "LOW",
      candidates,
    } satisfies SmartLookupResult);
  }

  // No match at any level.
  return NextResponse.json({
    ok: false,
    level: 0,
    confidence: "NONE",
  } satisfies SmartLookupResult);
}
