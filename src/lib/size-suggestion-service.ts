// Size Suggestion Service
// Bidirectional size lookup with gender-aware prioritization (spec DE2).
//
// This is the SINGLE SOURCE OF TRUTH for size suggestions — used by:
//   - Data Entry form (DE2 autocomplete)
//   - Rule Engine (F3 conditional mapping)
//   - Reconciliation comparison (size normalization)
//
// Gender detection (spec DE2.1):
//   1. Model suffix: "Cloudswift Onyx M" → Men, "... W" → Women
//   2. ART prefix: "3MH..." → Men, "3WH..." → Women
//   3. Cross-check: both signals match → confident; mismatch → warning
//
// Bidirectional lookup (spec DE2.2):
//   - User types NUMBER (e.g., "7") → suggest matching SIZE CODES (e.g., "M07/W08T")
//   - User types CODE (e.g., "M07") → suggest matching NUMBER (e.g., "7")
//
// Priority sorting (spec DE2.2):
//   - If model is Men → M-prefixed codes appear FIRST
//   - If model is Women → W-prefixed codes appear FIRST
//   - Each suggestion shows preview: "M07/W08T → size 7 (Onyx-FVO)"

import { detectGender, type Gender } from "./fvo-stech-tracking-service";

// ── Size lookup tables (editable, stored in DB via project config) ───────────

// Men size table: code → number
// e.g., "M07" → "7", "M07T" → "7.5" (T = +0.5), "M10" → "10"
export interface SizeLookupEntry {
  code: string;      // "M07", "W08T", "M07/W08T" (combined)
  number: string;    // "7", "8.5", "7" (for combined, primary gender's number)
  gender: "M" | "W"; // which gender this code belongs to
}

// Default Men lookup table (7-14, step 0.5)
export const DEFAULT_MEN_TABLE: SizeLookupEntry[] = [
  { code: "M07", number: "7", gender: "M" },
  { code: "M07T", number: "7.5", gender: "M" },
  { code: "M08", number: "8", gender: "M" },
  { code: "M08T", number: "8.5", gender: "M" },
  { code: "M09", number: "9", gender: "M" },
  { code: "M09T", number: "9.5", gender: "M" },
  { code: "M10", number: "10", gender: "M" },
  { code: "M10T", number: "10.5", gender: "M" },
  { code: "M11", number: "11", gender: "M" },
  { code: "M11T", number: "11.5", gender: "M" },
  { code: "M12", number: "12", gender: "M" },
  { code: "M12T", number: "12.5", gender: "M" },
  { code: "M13", number: "13", gender: "M" },
  { code: "M14", number: "14", gender: "M" },
];

// Default Women lookup table (5-10.5, step 0.5)
export const DEFAULT_WOMEN_TABLE: SizeLookupEntry[] = [
  { code: "W05", number: "5", gender: "W" },
  { code: "W05T", number: "5.5", gender: "W" },
  { code: "W06", number: "6", gender: "W" },
  { code: "W06T", number: "6.5", gender: "W" },
  { code: "W07", number: "7", gender: "W" },
  { code: "W07T", number: "7.5", gender: "W" },
  { code: "W08", number: "8", gender: "W" },
  { code: "W08T", number: "8.5", gender: "W" },
  { code: "W09", number: "9", gender: "W" },
  { code: "W09T", number: "9.5", gender: "W" },
  { code: "W10", number: "10", gender: "W" },
  { code: "W10T", number: "10.5", gender: "W" },
];

// ── Gender cross-check (spec DE2.1) ─────────────────────────────────────────

export interface GenderDetectionResult {
  fromModel: Gender;
  fromArt: Gender;
  resolved: Gender;   // final resolved gender (after cross-check)
  confident: boolean;   // true if both signals match
  conflict: boolean;  // true if signals differ
}

// Detect gender from both Model name and ART prefix, then cross-check.
export function detectGenderWithCrossCheck(
  model: string | null | undefined,
  art: string | null | undefined
): GenderDetectionResult {
  const fromModel = detectGender(model);
  const fromArt = detectGenderFromArt(art);
  const conflict = fromModel !== "" && fromArt !== "" && fromModel !== fromArt;
  const resolved = conflict ? "" : (fromModel || fromArt);
  const confident = !conflict && resolved !== "";

  return { fromModel, fromArt, resolved, confident, conflict };
}

// Detect gender from ART prefix: "3MH..." → Men, "3WH..." → Women.
export function detectGenderFromArt(art: string | null | undefined): Gender {
  if (!art) return "";
  const s = String(art).trim().toUpperCase();
  if (s.startsWith("3MH")) return "M";
  if (s.startsWith("3WH")) return "W";
  // Also check generic M/W prefix
  if (/^M\d/.test(s)) return "M";
  if (/^W\d/.test(s)) return "W";
  return "";
}

// ── Bidirectional size suggestion (spec DE2.2) ──────────────────────────────

export interface SizeSuggestion {
  code: string;        // "M07/W08T"
  number: string;      // "7"
  gender: "M" | "W";   // primary gender
  preview: string;     // "M07/W08T → size 7 (Onyx-FVO)"
  priority: number;    // lower = higher priority (gender-matching first)
}

// Given user input (could be a number like "7" or a code like "M07"),
// return sorted size suggestions with gender prioritization.
//
// Key behavior (user requirements):
//   1. NO DUPLICATES: if a combined size "M06T/W08" exists in Master Data,
//      show it as ONE suggestion (the full combined code), not separate M06T + W08.
//   2. FULL COMBINED CODE: when user types "8", show "M06T/W08" (the full code
//      from Master Data), not just "W08". But for sizes outside the combined
//      range (like M13 or W05), show the standalone code.
//   3. Priority: gender-matching combined codes first.
export function suggestSizes(
  input: string,
  gender: Gender,
  availableSizes?: string[],
  menTable: SizeLookupEntry[] = DEFAULT_MEN_TABLE,
  womenTable: SizeLookupEntry[] = DEFAULT_WOMEN_TABLE
): SizeSuggestion[] {
  const trimmed = input.trim().toUpperCase();
  if (!trimmed) return [];

  const allEntries = [...menTable, ...womenTable];
  const suggestions: SizeSuggestion[] = [];
  const seenCodes = new Set<string>(); // dedup by final code

  // Helper to add a suggestion without duplicates
  function addSuggestion(code: string, genderMatch: boolean) {
    if (seenCodes.has(code)) return;
    seenCodes.add(code);
    // Find the number from the lookup table
    const parts = code.match(/[MW]\d{1,2}T?/g) || [];
    let number = "";
    let entryGender: "M" | "W" = "M";
    for (const part of parts) {
      const entry = allEntries.find((e) => e.code === part);
      if (entry) {
        // Use the gender-matching entry's number if available
        if (!number || (gender && entry.gender === gender)) {
          number = entry.number;
          entryGender = entry.gender;
        }
      }
    }
    if (!number && parts.length > 0) {
      // Fallback: try first part
      const entry = allEntries.find((e) => e.code === parts[0]);
      if (entry) { number = entry.number; entryGender = entry.gender; }
    }
    suggestions.push({
      code,
      number: number || trimmed,
      gender: entryGender,
      preview: `${code} → size ${number || "?"}`,
      priority: genderMatch ? 0 : 1,
    });
  }

  // Determine target number from input
  let targetNumber = "";
  const isNumber = /^(\d+(\.\d+)?T?)$/.test(trimmed);
  if (isNumber) {
    targetNumber = trimmed;
    if (trimmed.endsWith("T")) {
      const base = parseFloat(trimmed.replace("T", ""));
      if (!isNaN(base)) targetNumber = String(base + 0.5);
    }
  }

  // ── PRIORITY 1: Match against availableSizes from Master Data ──────────
  // These are the ACTUAL combined codes like "M06T/W08", "M07/W08T", etc.
  // We show the FULL combined code, not individual parts.
  if (availableSizes && availableSizes.length > 0) {
    for (const rawSize of availableSizes) {
      const upperSize = rawSize.trim().toUpperCase();
      const parts = upperSize.match(/[MW]\d{1,2}T?/g) || [];

      if (isNumber) {
        // User typed a number → check if ANY part of this combined code matches
        for (const part of parts) {
          const entry = allEntries.find((e) => e.code === part);
          if (entry && entry.number === targetNumber) {
            // This combined code contains the user's number
            // Priority: gender-matching entry in the combined code
            const genderMatch = gender === entry.gender;
            addSuggestion(upperSize, genderMatch);
            break; // Only add this combined code once
          }
        }
      } else {
        // User typed a code or partial → check if input matches any part
        let matched = false;
        for (const part of parts) {
          if (part.includes(trimmed) || trimmed.includes(part) || upperSize.includes(trimmed)) {
            const entry = allEntries.find((e) => e.code === part);
            const genderMatch = entry ? gender === entry.gender : false;
            addSuggestion(upperSize, genderMatch);
            matched = true;
            break;
          }
        }
      }
    }
  }

  // ── PRIORITY 2: Standalone codes from lookup tables (for sizes like M13, W05) ─
  // These are sizes that may NOT appear in combined codes (edge of range).
  for (const entry of allEntries) {
    if (isNumber) {
      if (entry.number === targetNumber) {
        // Only add as standalone if NOT already covered by a combined code
        const alreadyCovered = suggestions.some((s) => s.code.includes(entry.code));
        if (!alreadyCovered) {
          addSuggestion(entry.code, gender === entry.gender);
        }
      }
    } else {
      if (entry.code === trimmed || entry.code.includes(trimmed) || trimmed.includes(entry.code)) {
        const alreadyCovered = suggestions.some((s) => s.code.includes(entry.code));
        if (!alreadyCovered) {
          addSuggestion(entry.code, gender === entry.gender);
        }
      }
    }
  }

  // Sort by priority (gender-matching first), then by gender (M before W)
  suggestions.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    if (a.gender !== b.gender) return a.gender === "M" ? -1 : 1;
    return 0;
  });

  return suggestions;
}

// Reverse lookup: given a size code, return the canonical number.
export function codeToNumber(
  code: string,
  menTable: SizeLookupEntry[] = DEFAULT_MEN_TABLE,
  womenTable: SizeLookupEntry[] = DEFAULT_WOMEN_TABLE
): string | null {
  const upper = code.trim().toUpperCase();
  const allEntries = [...menTable, ...womenTable];

  // Direct match
  const direct = allEntries.find((e) => e.code === upper);
  if (direct) return direct.number;

  // Try extracting first code part from combined (e.g., "M07/W08T" → "M07")
  const parts = upper.match(/[MW]\d{1,2}T?/g) || [];
  for (const part of parts) {
    const entry = allEntries.find((e) => e.code === part);
    if (entry) return entry.number;
  }

  return null;
}

// Reverse lookup: given a number + gender, return the matching code.
export function numberToCode(
  number: string,
  gender: Gender,
  menTable: SizeLookupEntry[] = DEFAULT_MEN_TABLE,
  womenTable: SizeLookupEntry[] = DEFAULT_WOMEN_TABLE
): string | null {
  const table = gender === "M" ? menTable : gender === "W" ? womenTable : [...menTable, ...womenTable];
  const entry = table.find((e) => e.number === number);
  return entry ? entry.code : null;
}
