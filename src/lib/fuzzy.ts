// Fuzzy / smart search utilities.
// Strategy (priority order):
//   1. Exact match
//   2. Last-N-chars match (e.g. "606" matches "MH26110606" by last 3 chars) — HIGH priority
//   3. startsWith
//   4. word-boundary startsWith
//   5. contains
//   6. endsWith (low priority — already covered by #2 but kept for fallback)
//   7. subsequence
//   8. Levenshtein typo tolerance
// All comparisons are case-insensitive and ignore extra whitespace.

function clean(s: string): string {
  return String(s ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[n];
}

// Subsequence match: does query appear as a subsequence of target?
function isSubsequence(query: string, target: string): boolean {
  let i = 0;
  for (let j = 0; j < target.length && i < query.length; j++) {
    if (target[j] === query[i]) i++;
  }
  return i === query.length;
}

export interface Scored {
  value: string;
  score: number;
}

// Score a candidate value against the query. Higher = better. 0 = no match.
//
// LAST-N-CHARS PRIORITY:
// When the user types "606", we want "MH26110606" (ends with 606) to rank
// higher than "MH60612345" (contains 606 in the middle). We extract the
// trailing portion of the value and boost scores for suffix matches.
export function scoreMatch(query: string, value: string): number {
  const q = clean(query);
  const v = clean(value);
  if (!q || !v) return 0;

  // 1. Exact match — highest priority.
  if (v === q) return 2000;

  let score = 0;

  // 2. LAST-N-CHARS match (NEW — highest non-exact priority).
  // If the value ends with the query, give it a very high score.
  // Shorter values that end with the query rank higher (more precise match).
  if (v.endsWith(q)) {
    // e.g. "MH26110606".endsWith("606") → true → score ~950
    // The shorter the remaining prefix, the better.
    const remainingLen = v.length - q.length;
    score = Math.max(score, 950 - remainingLen);
  }

  // 3. startsWith (e.g. "MH26110228" startsWith "MH26")
  if (v.startsWith(q)) {
    score = Math.max(score, 800 - (v.length - q.length));
  }

  // 4. Word-boundary startsWith (e.g. value contains "/" separators).
  const parts = v.split(/[^a-z0-9]+/);
  for (const p of parts) {
    if (p && p.startsWith(q)) {
      score = Math.max(score, 700 - (p.length - q.length));
    }
  }

  // 5. contains (anywhere in the value)
  if (v.includes(q)) {
    score = Math.max(score, 500 - (v.indexOf(q)));
  }

  // 6. Subsequence match (e.g. "228" as subsequence in "MH26110228")
  if (isSubsequence(q, v)) {
    score = Math.max(score, 300 - (v.length - q.length));
  }

  // 7. Levenshtein fuzzy for typo tolerance.
  const dist = levenshtein(q, v);
  const maxLen = Math.max(q.length, v.length);
  if (maxLen > 0) {
    const ratio = 1 - dist / maxLen;
    if (ratio >= 0.6) {
      score = Math.max(score, Math.round(ratio * 250));
    }
  }

  return score;
}

// Sort + limit suggestions.
export function rankSuggestions(
  query: string,
  candidates: { value: string; sub?: string }[],
  limit = 15
): Scored[] {
  const results: Scored[] = [];
  for (const c of candidates) {
    const s = scoreMatch(query, c.value);
    if (s > 0) {
      // Boost if sub (e.g. season) also matches.
      let final = s;
      if (c.sub) {
        final += scoreMatch(query, c.sub) * 0.3;
      }
      results.push({ value: c.value, score: final });
    }
  }
  results.sort((a, b) => b.score - a.score);
  // Deduplicate by value keeping highest score.
  const seen = new Map<string, number>();
  for (const r of results) {
    if (!seen.has(r.value) || seen.get(r.value)! < r.score) seen.set(r.value, r.score);
  }
  return [...seen.entries()]
    .map(([value, score]) => ({ value, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// SQLite-friendly filter expression for server-side pre-filtering.
export function buildLikeClauses(query: string): string[] {
  const q = clean(query);
  if (!q) return [];
  return [`%${q}%`];
}
