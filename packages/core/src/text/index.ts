// Pure text similarity used by name search and the claim-transition check.
// No locale comparison or clock enters either path.

/**
 * The character trigrams of a string, padded by one space at each end so a
 * one- or two-character string still yields comparable trigrams. The
 * correction tolerance and near-name index both read this implementation.
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
