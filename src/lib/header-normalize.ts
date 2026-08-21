import { FIELDS, type CanonicalField } from "./fields";

// Normalize a header string to a comparable key: lowercase, alphanumeric only.
export function normalizeHeader(header: string): string {
  return String(header || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

// Preserve case but strip non-alphanumeric. Used for case-sensitive alias matching.
export function normalizeHeaderCaseSensitive(header: string): string {
  return String(header || "")
    .trim()
    .replace(/[^a-zA-Z0-9]/g, "");
}

// Auto-detect the best canonical field for an excel header.
// Strategy:
//   1. Case-sensitive exact match (distinguishes "Color Code" vs "COLOR CODE")
//   2. Case-insensitive exact alias match
//   3. Case-sensitive partial contains
//   4. Case-insensitive partial contains (last resort, min alias length 5)
export function detectField(header: string): CanonicalField | "" {
  const csNorm = normalizeHeaderCaseSensitive(header);
  const ciNorm = normalizeHeader(header);
  if (!csNorm) return "";

  // 1. Case-sensitive exact match first (highest priority).
  for (const f of FIELDS) {
    if (f.caseSensitiveAliases?.includes(csNorm)) return f.key;
  }
  // 2. Case-insensitive exact alias match.
  for (const f of FIELDS) {
    if (f.aliases.includes(ciNorm)) return f.key;
  }
  // 3. Case-sensitive partial contains.
  for (const f of FIELDS) {
    if (f.caseSensitiveAliases) {
      for (const alias of f.caseSensitiveAliases) {
        if (csNorm.includes(alias) || alias.includes(csNorm)) {
          if (alias.length >= 4 || csNorm.length >= 4) return f.key;
        }
      }
    }
  }
  // 4. Case-insensitive partial contains (min alias length 5 to avoid
  //    false positives like "Size Group" matching "size").
  for (const f of FIELDS) {
    for (const alias of f.aliases) {
      if (alias.length < 5) continue; // skip short aliases for partial match
      if (ciNorm.includes(alias) || alias.includes(ciNorm)) {
        if (alias.length >= 5 || ciNorm.length >= 5) return f.key;
      }
    }
  }
  return "";
}

// Check if a header is an EXACT match (case-sensitive or case-insensitive alias).
function isExactMatch(header: string): CanonicalField | "" {
  const csNorm = normalizeHeaderCaseSensitive(header);
  const ciNorm = normalizeHeader(header);
  if (!csNorm) return "";
  for (const f of FIELDS) {
    if (f.caseSensitiveAliases?.includes(csNorm)) return f.key;
  }
  for (const f of FIELDS) {
    if (f.aliases.includes(ciNorm)) return f.key;
  }
  return "";
}

// Build an initial column mapping from a list of excel headers.
// Two-pass: exact matches first (ensures "Size" wins over "Size Group"),
// then partial matches for remaining headers.
export function buildAutoMapping(headers: string[]): Record<string, CanonicalField | ""> {
  const mapping: Record<string, CanonicalField | ""> = {};
  const assigned = new Set<CanonicalField>();

  // Pass 1: exact matches.
  for (const h of headers) {
    const field = isExactMatch(h);
    if (field && !assigned.has(field)) {
      mapping[h] = field;
      assigned.add(field);
    } else {
      mapping[h] = "";
    }
  }

  // Pass 2: partial matches for headers that didn't get an exact match.
  for (const h of headers) {
    if (mapping[h]) continue; // already assigned
    const field = detectField(h);
    if (field && !assigned.has(field)) {
      mapping[h] = field;
      assigned.add(field);
    }
  }

  return mapping;
}

// List of canonical fields available for mapping (for the dropdown).
export function mappingOptions() {
  return FIELDS.map((f) => ({ value: f.key, label: f.label }));
}
