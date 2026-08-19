import { FIELDS, type CanonicalField } from "./fields";

// Normalize a header string to a comparable key: lowercase, alphanumeric only.
export function normalizeHeader(header: string): string {
  return String(header || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

// Auto-detect the best canonical field for an excel header based on aliases.
export function detectField(header: string): CanonicalField | "" {
  const norm = normalizeHeader(header);
  if (!norm) return "";
  // Exact alias match first.
  for (const f of FIELDS) {
    if (f.aliases.includes(norm)) return f.key;
  }
  // Partial contains.
  for (const f of FIELDS) {
    for (const alias of f.aliases) {
      if (norm.includes(alias) || alias.includes(norm)) {
        // Avoid overly greedy matches for very short aliases.
        if (alias.length >= 4 || norm.length >= 4) return f.key;
      }
    }
  }
  return "";
}

// Build an initial column mapping from a list of excel headers.
export function buildAutoMapping(headers: string[]): Record<string, CanonicalField | ""> {
  const mapping: Record<string, CanonicalField | ""> = {};
  for (const h of headers) {
    mapping[h] = detectField(h);
  }
  return mapping;
}

// List of canonical fields available for mapping (for the dropdown).
export function mappingOptions() {
  return FIELDS.map((f) => ({ value: f.key, label: f.label }));
}
