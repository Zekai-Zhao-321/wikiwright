// docs/concepts.md §Generated artifacts (`lexical:bm25`, the 3× field boost, the index is
// rebuilt per invocation and never persisted — the index-rebuild tripwire) ·
// deterministic (byte-identical across runs and engines: terms are summed in
// code-unit order and the logarithm is computed here, not by Math.log, because
// Math.log is not specified to the last bit) · zero dependencies.
import { codeUnitCompare, normalizeIdentity } from "../identity/index.ts";
import { basenameOf, type NamedPage } from "../names/index.ts";
import { tokenize } from "./tokenize.ts";

/** BM25 parameters, fixed by docs/concepts.md §Generated artifacts */
export const BM25_K1 = 1.2;
export const BM25_B = 0.75;
/** basename ∪ aliases ∪ tags ∪ headings count this many times against body. */
export const FIELD_BOOST = 3;

// ECMA-262 defines Math.LN2 as the Number value nearest ln 2 — one exact double
// on every conforming engine. Math.log, by contrast, is only "implementation-
// approximated", which is why the series below exists.
const LN2 = Math.LN2;
/** Terms after the 24th contribute below 1e-23 — the series is fully converged. */
const LN_TERMS = 24;

/**
 * Natural logarithm from IEEE-754 `+ − × ÷` only: decompose x = m·2^e with
 * m ∈ [1,2), then ln m = 2·Σ z^(2i+1)/(2i+1) with z = (m−1)/(m+1). Every
 * operation is exactly specified, so two engines agree bit for bit;
 * `Math.log` carries no such guarantee.
 */
export function deterministicLn(x: number): number {
  if (!(x > 0) || !Number.isFinite(x)) return Number.NaN;
  let mantissa = x;
  let exponent = 0;
  while (mantissa >= 2) {
    mantissa /= 2;
    exponent += 1;
  }
  while (mantissa < 1) {
    mantissa *= 2;
    exponent -= 1;
  }
  const z = (mantissa - 1) / (mantissa + 1);
  const zSquared = z * z;
  let term = z;
  let sum = z;
  for (let i = 1; i < LN_TERMS; i += 1) {
    term = term * zSquared;
    sum += term / (2 * i + 1);
  }
  return exponent * LN2 + 2 * sum;
}

export interface LexicalDoc {
  path: string;
  /** Weighted term frequency: body occurrences + FIELD_BOOST × boosted-field ones. */
  tf: ReadonlyMap<string, number>;
  /** Weighted length, the BM25 normalizer. */
  length: number;
  /** The page source under normalizeIdentity — the `body:phrase` tier's haystack. */
  normalizedSource: string;
}

export interface LexicalIndex {
  docs: readonly LexicalDoc[];
  byPath: ReadonlyMap<string, LexicalDoc>;
  df: ReadonlyMap<string, number>;
  /** Corpus size the statistics were computed over (before any filter). */
  corpusSize: number;
  averageLength: number;
}

export interface LexicalHit {
  path: string;
  score: number;
}

function boostedText(page: NamedPage): string {
  const fm = page.doc.frontmatter.value;
  const parts: string[] = [basenameOf(page.path)];
  const aliases = fm["aliases"];
  if (Array.isArray(aliases)) {
    for (const a of aliases) if (typeof a === "string") parts.push(a);
  }
  const tags = fm["tags"];
  if (Array.isArray(tags)) {
    for (const t of tags) if (typeof t === "string") parts.push(t);
  }
  const title = fm["title"];
  if (typeof title === "string") parts.push(title);
  for (const h of page.doc.headings) parts.push(h.text);
  return parts.join("\n");
}

/**
 * Build the inverted index over the walked pages. Rebuilt per invocation: no
 * cache file, no daemon (docs/concepts.md §Generated artifacts; a persisted postings file is
 * admitted only above a measured latency tripwire).
 */
export function buildLexicalIndex(pages: readonly NamedPage[]): LexicalIndex {
  const docs: LexicalDoc[] = [];
  const df = new Map<string, number>();
  let total = 0;
  for (const page of pages) {
    const tf = new Map<string, number>();
    for (const term of tokenize(page.doc.source)) tf.set(term, (tf.get(term) ?? 0) + 1);
    for (const term of tokenize(boostedText(page))) {
      tf.set(term, (tf.get(term) ?? 0) + FIELD_BOOST);
    }
    let length = 0;
    for (const [term, count] of tf) {
      length += count;
      df.set(term, (df.get(term) ?? 0) + 1);
    }
    total += length;
    docs.push({
      path: page.path,
      tf,
      length,
      normalizedSource: normalizeIdentity(page.doc.source),
    });
  }
  docs.sort((a, b) => codeUnitCompare(a.path, b.path));
  return {
    docs,
    byPath: new Map(docs.map((d) => [d.path, d])),
    df,
    corpusSize: docs.length,
    averageLength: docs.length === 0 ? 0 : total / docs.length,
  };
}

/**
 * Rank `kept` by BM25 over the index's corpus statistics. Statistics come from
 * the walked corpus, not from `kept`, so a filter subsets the list without
 * reordering what survives (docs/concepts.md §Generated artifacts). Terms are deduplicated and
 * summed in code-unit order, so the score never depends on query word order or
 * on floating-point accumulation order.
 */
export function rankLexical(
  index: LexicalIndex,
  query: string,
  kept: readonly NamedPage[],
): LexicalHit[] {
  const terms = [...new Set(tokenize(query))].sort(codeUnitCompare);
  if (terms.length === 0 || index.corpusSize === 0) return [];
  const hits: LexicalHit[] = [];
  for (const page of kept) {
    const doc = index.byPath.get(page.path);
    if (doc === undefined) continue;
    let score = 0;
    for (const term of terms) {
      const tf = doc.tf.get(term);
      if (tf === undefined || tf === 0) continue;
      const documentFrequency = index.df.get(term) ?? 0;
      const idf = deterministicLn(
        1 + (index.corpusSize - documentFrequency + 0.5) / (documentFrequency + 0.5),
      );
      const norm =
        index.averageLength === 0 ? 1 : 1 - BM25_B + (BM25_B * doc.length) / index.averageLength;
      score += (idf * (tf * (BM25_K1 + 1))) / (tf + BM25_K1 * norm);
    }
    if (score > 0) hits.push({ path: page.path, score });
  }
  hits.sort((a, b) => (a.score === b.score ? codeUnitCompare(a.path, b.path) : b.score - a.score));
  return hits;
}
