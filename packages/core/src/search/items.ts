// docs/cli.md §search (`--items`: the grammar items themselves, ranked) ·
// docs/concepts.md §Generated artifacts (one tokenizer, one BM25, rebuilt per
// invocation) · docs/concepts.md §Section grammar (an item and its rationale).
//
// Item search ranks the items the loaded grammars parse rather than pages. An
// item exists here exactly when the judge would see it: each page's sections
// are parsed through `grammarBindings` and `parseSections` under the page's
// effective type, the construction the arms, the census and the graph use.
// The kernel reads the envelope it attaches — `line`, `raw`, `rationale` — and
// the item's `kind`; everything a grammar put on the item travels as `fields`,
// unnamed here.
import { type ParseOptions, parseSections, type RationaleLine } from "../grammar/index.ts";
import { codeUnitCompare, normalizeIdentity } from "../identity/index.ts";
import { grammarBindings } from "../lint/index.ts";
import type { NamedPage } from "../names/index.ts";
import type { FlattenedRegistry } from "../registry/model.ts";
import { buildTextIndex, rankKeys } from "./bm25.ts";
import { pageFilter, type SearchFilters, type SearchOptions } from "./index.ts";
import { TOKENIZATION_MODE, tokenize } from "./tokenize.ts";

/** One item as a search candidate: where it is, its envelope and the grammar's own fields. */
export interface ItemCandidate {
  path: string;
  line: number;
  /** The section heading as the page writes it. */
  section: string;
  kind: string;
  /** The grammar the section declares. */
  grammar: string;
  raw: string;
  rationale: RationaleLine[];
  /** The grammar's parse of the item, minus the kernel's envelope. */
  fields: Record<string, unknown>;
  retired: boolean;
}

export interface ItemResult {
  path: string;
  line: number;
  section: string;
  kind: string;
  grammar: string;
  raw: string;
  rationale: RationaleLine[];
  /** Where the first matching term sits: the item's own line, or a rationale line under it. */
  matched_in: "core" | "rationale";
  fields: Record<string, unknown>;
  score: number;
  match_reasons: string[];
}

export interface ItemCoverage {
  tiers_executed: string[];
  corpus_size: number;
  pages_considered: number;
  items_considered: number;
  tokenization: string;
  caps: { limit: number; found: number; hit: boolean };
}

export interface ItemOutcome {
  results: ItemResult[];
  coverage: ItemCoverage;
}

const LEXICAL_TIER = "lexical:bm25";
/** An item whose text holds a query term inside a longer word: found, unranked by BM25. */
const CONTAINS_TIER = "text:contains";
const RETIRED_REASON = "status:retired";

/**
 * Every item the judge would see on `pages`, in page order and line order:
 * the sections of each page's effective type that declare a grammar, parsed
 * under the bundle's parse options. A page whose type declares no grammar
 * section contributes none.
 */
export function collectItems(
  pages: readonly NamedPage[],
  registry: FlattenedRegistry,
  parseOptions?: ParseOptions,
): ItemCandidate[] {
  const out: ItemCandidate[] = [];
  for (const page of [...pages].sort((a, b) => codeUnitCompare(a.path, b.path))) {
    const fm = page.doc.frontmatter.value;
    const declared = typeof fm["type"] === "string" ? fm["type"] : undefined;
    const effective = declared === undefined ? undefined : registry.types.get(declared);
    if (effective === undefined) continue;
    const bindings = grammarBindings(effective, registry.modules);
    if (!bindings.some((b) => b.grammar !== "prose")) continue;
    const retired = fm["status"] === "retired";
    for (const section of parseSections(page.doc, bindings, parseOptions).sections) {
      if (section.grammar === "prose") continue;
      for (const item of section.items) {
        const { line, raw, rationale, ...fields } = item;
        out.push({
          path: page.path,
          line,
          section: section.heading,
          kind: item.kind,
          grammar: section.grammar,
          raw,
          rationale,
          fields,
          retired,
        });
      }
    }
  }
  return out;
}

/** An item's key in the text index: its path, then its line, in an order code-unit comparison keeps numeric. */
function keyOf(item: ItemCandidate): string {
  return `${item.path}\u0000${String(item.line).padStart(10, "0")}`;
}

function textOf(item: ItemCandidate): string {
  return [item.raw, ...item.rationale.map((r) => r.text)].join("\n");
}

function round6(x: number): number {
  return Math.round(x * 1e6) / 1e6;
}

/**
 * docs/cli.md §search: rank the items of the pages the filters keep. BM25
 * over each item's line and its rationale lines, with statistics from the
 * items of every walked page, so a filter subsets without reordering; then
 * every other item whose text holds a query term inside a longer word, as a
 * line search would find it, unranked after them. The identity ladder does not
 * apply: an item has no name.
 */
export function searchItems(
  pages: readonly NamedPage[],
  registry: FlattenedRegistry,
  query: string,
  filters: SearchFilters,
  limit: number,
  options?: SearchOptions & { parseOptions?: ParseOptions | undefined },
): ItemOutcome {
  const keeps = pageFilter(filters, options);
  const kept = pages.filter(keeps);
  const all = collectItems(pages, registry, options?.parseOptions);
  return rankItemCandidates(all, new Set(kept.map((p) => p.path)), query, limit, pages.length);
}

/**
 * Rank the candidates of the kept pages: the ranking `searchItems` applies,
 * over candidates any reader collected — the old grammars' or the v2
 * records (v2 contracts §9.6) — with statistics from every candidate.
 */
export function rankItemCandidates(
  all: readonly ItemCandidate[],
  keptPaths: ReadonlySet<string>,
  query: string,
  limit: number,
  corpusSize: number,
): ItemOutcome {
  const candidates = all.filter((item) => keptPaths.has(item.path));
  const byKey = new Map(candidates.map((item) => [keyOf(item), item]));
  const index = buildTextIndex(all.map((item) => ({ key: keyOf(item), text: textOf(item) })));
  const terms = [...new Set(tokenize(query))];
  const hasTerm = (text: string): boolean => {
    const tokens = new Set(tokenize(text));
    if (terms.some((t) => tokens.has(t))) return true;
    const normalized = normalizeIdentity(text);
    return terms.some((t) => normalized.includes(t));
  };

  const ranked = rankKeys(index, query, [...byKey.keys()]);
  const seen = new Set<string>();
  const results: ItemResult[] = [];
  const push = (item: ItemCandidate, score: number, reasons: string[]): void => {
    const matchedIn = hasTerm(item.raw) ? "core" : "rationale";
    const demoted = item.retired;
    results.push({
      path: item.path,
      line: item.line,
      section: item.section,
      kind: item.kind,
      grammar: item.grammar,
      raw: item.raw,
      rationale: item.rationale,
      matched_in: matchedIn,
      fields: item.fields,
      // Retirement demotes, as it does a page, and never removes.
      score: round6(demoted ? score / 2 : score),
      match_reasons: demoted ? [...reasons, RETIRED_REASON] : reasons,
    });
  };
  for (const hit of ranked) {
    const item = byKey.get(hit.path);
    if (item === undefined) continue;
    seen.add(hit.path);
    push(item, hit.score, [LEXICAL_TIER]);
  }
  const contained: ItemCandidate[] = [];
  for (const [key, item] of byKey) {
    if (seen.has(key)) continue;
    const normalized = normalizeIdentity(textOf(item));
    if (terms.length > 0 && terms.some((t) => normalized.includes(t))) contained.push(item);
  }
  for (const item of contained) push(item, 0, [CONTAINS_TIER]);
  results.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    return codeUnitCompare(a.path, b.path) || a.line - b.line;
  });

  return {
    results: results.slice(0, limit),
    coverage: {
      tiers_executed: [LEXICAL_TIER, CONTAINS_TIER],
      corpus_size: corpusSize,
      pages_considered: keptPaths.size,
      items_considered: candidates.length,
      tokenization: TOKENIZATION_MODE,
      caps: { limit, found: results.length, hit: results.length > limit },
    },
  };
}
