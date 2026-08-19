// Fuzzy / smart search utilities.
// Strategy: exact > startsWith > word-starts-with > contains > endsWith > subsequence.
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
export function scoreMatch(query: string, value: string): number {
  const q = clean(query);
  const v = clean(value);
  if (!q || !v) return 0;
  if (v === q) return 1000;
  let score = 0;
  if (v.startsWith(q)) score = Math.max(score, 800 - (v.length - q.length));
  // Word-boundary startsWith (e.g. value contains "/" separators).
  const parts = v.split(/[^a-z0-9]+/);
  for (const p of parts) {
    if (p && p.startsWith(q)) {
      score = Math.max(score, 700 - (p.length - q.length));
    }
  }
  if (v.includes(q)) score = Math.max(score, 500 - (v.indexOf(q)));
  if (v.endsWith(q)) score = Math.max(score, 400);
  // Subsequence match (e.g. "228" in "MH26110228").
  if (isSubsequence(q, v)) score = Math.max(score, 300 - (v.length - q.length));
  // Levenshtein fuzzy for typo tolerance.
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
// Returns SQL fragments suitable for a LIKE filter on a column, combined with OR.
export function buildLikeClauses(query: string): string[] {
  const q = clean(query);
  if (!q) return [];
  return [`%${q}%`];
}
