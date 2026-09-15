// docs/extending.md §An arm (the generic text metrics stay kernel
// utilities) · docs/architecture.md §Directories determinism (no locale, no clock, code-unit ordering only).
//
// String functions, not claim concepts. They live here rather than in
// `grammar/` because `vocabulary show` uses Levenshtein for nearest-name
// suggestions on a path with nothing to do with claims, and because the
// claim-semantic composition OVER them is `stdlib/claims`'. A kit's
// `isCorrection` reaches these the same way the standard library does.

/** Iterative-row Levenshtein, bounded: past `max` the exact value is not needed. */
export function boundedLevenshtein(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const A = [...a];
  const B = [...b];
  let prev = Array.from({ length: B.length + 1 }, (_, i) => i);
  for (let i = 1; i <= A.length; i += 1) {
    const row = [i, ...new Array<number>(B.length).fill(0)];
    let best = i;
    for (let j = 1; j <= B.length; j += 1) {
      const cost = A[i - 1] === B[j - 1] ? 0 : 1;
      const value = Math.min((row[j - 1] ?? 0) + 1, (prev[j] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
      row[j] = value;
      if (value < best) best = value;
    }
    if (best > max) return max + 1;
    prev = row;
  }
  return prev[B.length] ?? max + 1;
}

/**
 * The character trigrams of a string, padded by one space at each end so a
 * one- or two-character string still yields comparable trigrams. The one
 * implementation: the correction tolerance and the near-name index both read it.
 */
export function trigrams(text: string): Set<string> {
  const out = new Set<string>();
  const cp = [...text];
  if (cp.length === 0) return out;
  const padded = [" ", ...cp, " "];
  for (let i = 0; i + 3 <= padded.length; i += 1) out.add(padded.slice(i, i + 3).join(""));
  return out;
}

export function trigramJaccard(a: string, b: string): number {
  const A = trigrams(a);
  const B = trigrams(b);
  if (A.size === 0 && B.size === 0) return 1;
  let shared = 0;
  for (const g of A) if (B.has(g)) shared += 1;
  return shared / (A.size + B.size - shared);
}
