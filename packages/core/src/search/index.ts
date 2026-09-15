// docs/concepts.md §Generated artifacts (the tokenizer law, the banded tier ladder,
// RRF fusion at k=60, the per-invocation index, `name:near`)
// (band, ladder_score, rrf reasons) (not-found is
// never confirmed-absent) (all comparisons through normalizeIdentity;
// bigram-capable CJK search) · filter flags, no query DSL
// deterministic ordering · type chains (retired
// demoted, never removed).
import { type FieldSources, resolveDescription, resolveTitle } from "../fields/index.ts";
import { codeUnitCompare, normalizeIdentity } from "../identity/index.ts";
import { basenameOf, type NamedPage } from "../names/index.ts";
import { buildLexicalIndex, type LexicalIndex, rankLexical } from "./bm25.ts";
import {
  buildNearIndex,
  NEAR_LIMIT,
  type NearCandidate,
  type NearIndex,
  nearCandidatesAll,
  stripQualifier,
} from "./near.ts";
import { TOKENIZATION_MODE } from "./tokenize.ts";

export interface SearchFilters {
  type?: string;
  tag?: string;
  titleContains?: string;
}

/**
 * Identity hits assert *which page this is*; relevance hits assert *how well it
 * matches*. Fusion may reorder relevance and may never reorder identity
 * (docs/concepts.md §Generated artifacts).
 */
export type SearchBand = "identity" | "relevance";

export interface SearchResult {
  path: string;
  type: string | null;
  title: string | null;
  /** The fused score. Comparable WITHIN a band; the band orders across. */
  score: number;
  band: SearchBand;
  /** The power-of-two ladder score; 0 when only `lexical:bm25` found the page. */
  ladder_score: number;
  match_reasons: string[];
}

export interface SearchCoverage {
  tiers_executed: string[];
  corpus_size: number;
  tokenization: string;
  fusion: { method: string; k: number; lists: string[] };
  /**
   * `limit` is the cap asked for, `found` is how many results the search
   * actually produced, and `hit` is `found > limit`. `near_limit` / `near_hit`
   * report the advisory list's separate cap and appear only under `--near`
   * (docs/concepts.md §Generated artifacts).
   */
  caps: { limit: number; found: number; hit: boolean; near_limit?: number; near_hit?: boolean };
}

export interface SearchOutcome {
  results: SearchResult[];
  coverage: SearchCoverage;
  /** Present only under `--near`: advisory candidates that never touch a rank. */
  near?: NearCandidate[];
}

/** The ladder's tiers, in the order docs/concepts.md §Generated artifacts states them. */
const LADDER_TIERS = [
  "name",
  "alias",
  "name:stem",
  "title",
  "heading",
  "tag",
  "description",
  "body:phrase",
] as const;

const LEXICAL_TIER = "lexical:bm25";
const NEAR_TIER = "name:near";
/** What a query-less (filters-only) invocation ran, and the only thing it ran. */
const FILTER_TIER = "filter";

/** Reciprocal rank fusion's constant (Cormack, Clarke & Büttcher, SIGIR 2009). */
export const RRF_K = 60;

// Tier weights are powers of two spaced so that the SUM of every lower tier can
// never outrank one hit in a higher tier — spec 08's staged order holds under
// additive scoring by construction.
const WEIGHT = {
  name: 1 << 13,
  alias: 1 << 12,
  nameStem: 1 << 11,
  titleExact: 1 << 10,
  titleContains: 1 << 9,
  heading: 1 << 8,
  tag: 1 << 7,
  description: 1 << 6,
  bodyPhrase: 1 << 5,
  filterOnly: 1 << 4,
} as const;

/** The reason a demoted result carries, whichever list found it. */
const RETIRED_REASON = "status:retired";

/** The tiers whose hit is an identity assertion (docs/concepts.md §Generated artifacts). */
const IDENTITY_REASONS = new Set(["name:exact", "alias:exact", "name:stem", "title:exact"]);

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

export interface SearchOptions {
  fieldSources?: FieldSources | undefined;
  /** D11: type name → its effective chain, so --type matches descendants. */
  typeChains?: ReadonlyMap<string, readonly string[]> | undefined;
  /** `--near`: run the advisory candidate ranker beside the results. */
  near?: boolean | undefined;
  /**
   * A prebuilt index over the SAME pages. The index is a pure function of the
   * page set, so passing one is a memo, never a policy: callers that search the
   * same corpus repeatedly (the evaluation harness) build once; the CLI builds
   * per invocation and persists nothing (docs/concepts.md §Generated artifacts).
   */
  lexicalIndex?: LexicalIndex | undefined;
  nearIndex?: NearIndex | undefined;
}

interface LadderRow {
  page: NamedPage;
  type: string | null;
  title: string | null;
  ladderScore: number;
  reasons: string[];
  band: SearchBand;
  retired: boolean;
}

function round6(x: number): number {
  return Math.round(x * 1e6) / 1e6;
}

export function searchPages(
  pages: NamedPage[],
  query: string | undefined,
  filters: SearchFilters,
  limit: number,
  options?: SearchOptions,
): SearchOutcome {
  const q = query === undefined ? undefined : normalizeIdentity(query);
  const nFilterType = filters.type === undefined ? undefined : normalizeIdentity(filters.type);
  const nFilterTag = filters.tag === undefined ? undefined : normalizeIdentity(filters.tag);
  const nTitleContains =
    filters.titleContains === undefined ? undefined : normalizeIdentity(filters.titleContains);

  // The lexical index carries the corpus statistics AND the normalized page
  // source the `body:phrase` tier compares against, so both are computed once
  // per invocation rather than once per page per query.
  const lexicalIndex =
    q === undefined ? undefined : (options?.lexicalIndex ?? buildLexicalIndex(pages));

  const kept: NamedPage[] = [];
  const rows: LadderRow[] = [];

  for (const page of pages) {
    const fm = page.doc.frontmatter.value;
    const type = str(fm["type"]);
    const title = resolveTitle(page.doc, page.path, options?.fieldSources);
    const description = resolveDescription(page.doc, options?.fieldSources);
    const tags = Array.isArray(fm["tags"])
      ? fm["tags"].filter((t): t is string => typeof t === "string")
      : [];
    const aliases = Array.isArray(fm["aliases"])
      ? fm["aliases"].filter((a): a is string => typeof a === "string")
      : [];

    if (nFilterType !== undefined) {
      // D11: exact type, any ancestor, or the archetype — the chain carries
      // all three, so one flag serves every altitude.
      const chain = type === null ? [] : (options?.typeChains?.get(type) ?? [type]);
      if (!chain.some((t) => normalizeIdentity(t) === nFilterType)) continue;
    }
    if (nFilterTag !== undefined && !tags.some((t) => normalizeIdentity(t) === nFilterTag)) {
      continue;
    }
    if (nTitleContains !== undefined) {
      if (title === null || !normalizeIdentity(title).includes(nTitleContains)) continue;
    }
    kept.push(page);

    let score = 0;
    const reasons: string[] = [];
    if (q !== undefined) {
      const basename = basenameOf(page.path);
      if (normalizeIdentity(basename) === q) {
        score += WEIGHT.name;
        reasons.push("name:exact");
      }
      if (aliases.some((a) => normalizeIdentity(a) === q)) {
        score += WEIGHT.alias;
        reasons.push("alias:exact");
      }
      // name:stem — exact equality after stripping ONE trailing ` (…)`
      // qualifier, so `Li Wei` reaches `Li Wei (barber)` mechanically.
      if (!reasons.includes("name:exact") && !reasons.includes("alias:exact")) {
        const stems = [basename, ...aliases]
          .map((n) => stripQualifier(n))
          .filter((n): n is string => n !== null);
        if (stems.some((s) => normalizeIdentity(s) === q)) {
          score += WEIGHT.nameStem;
          reasons.push("name:stem");
        }
      }
      if (title !== null) {
        const nTitle = normalizeIdentity(title);
        if (nTitle === q) {
          score += WEIGHT.titleExact;
          reasons.push("title:exact");
        } else if (nTitle.includes(q)) {
          score += WEIGHT.titleContains;
          reasons.push("title:contains");
        }
      }
      const heading = page.doc.headings.find((h) => normalizeIdentity(h.text).includes(q));
      if (heading !== undefined) {
        score += WEIGHT.heading;
        reasons.push(`heading:${heading.text}`);
      }
      if (tags.some((t) => normalizeIdentity(t) === q)) {
        score += WEIGHT.tag;
        reasons.push(`tag:${query ?? ""}`);
      }
      if (description !== null && normalizeIdentity(description).includes(q)) {
        score += WEIGHT.description;
        reasons.push("description:contains");
      }
      const normalizedSource =
        lexicalIndex?.byPath.get(page.path)?.normalizedSource ?? normalizeIdentity(page.doc.source);
      if (normalizedSource.includes(q)) {
        score += WEIGHT.bodyPhrase;
        reasons.push("body:phrase");
      }
    } else {
      score = WEIGHT.filterOnly;
      reasons.push("filter:match");
    }

    const retired = str(fm["status"]) === "retired";
    if (score > 0 && retired) {
      // Retired pages demote but never vanish or go negative.
      score = Math.max(1, score >> 1);
      reasons.push(RETIRED_REASON);
    }
    rows.push({
      page,
      type,
      title,
      ladderScore: score,
      reasons,
      band: reasons.some((r) => IDENTITY_REASONS.has(r)) ? "identity" : "relevance",
      retired,
    });
  }

  // List 1: the ladder, in its own order. List 2: BM25. Neither list's internal
  // order depends on which pages a filter removed (docs/concepts.md §Generated artifacts).
  const ladderList = rows
    .filter((r) => r.ladderScore > 0)
    .sort((a, b) =>
      a.ladderScore === b.ladderScore
        ? codeUnitCompare(a.page.path, b.page.path)
        : b.ladderScore - a.ladderScore,
    );
  const lexicalList =
    q === undefined || lexicalIndex === undefined
      ? []
      : rankLexical(lexicalIndex, query ?? "", kept);

  const byPath = new Map(rows.map((r) => [r.page.path, r]));
  const fused = new Map<string, { row: LadderRow; score: number; reasons: string[] }>();
  const contribute = (path: string, list: string, rank: number, tier?: string): void => {
    const row = byPath.get(path);
    if (row === undefined) return;
    let entry = fused.get(path);
    if (entry === undefined) {
      entry = { row, score: 0, reasons: [...row.reasons] };
      fused.set(path, entry);
    }
    if (tier !== undefined && !entry.reasons.includes(tier)) entry.reasons.push(tier);
    entry.score += 1 / (RRF_K + rank);
    entry.reasons.push(`rrf:${list}#${rank}`);
  };
  for (let i = 0; i < ladderList.length; i += 1) {
    const row = ladderList[i];
    if (row !== undefined) contribute(row.page.path, "ladder", i + 1);
  }
  for (let i = 0; i < lexicalList.length; i += 1) {
    const hit = lexicalList[i];
    if (hit !== undefined) contribute(hit.path, LEXICAL_TIER, i + 1, LEXICAL_TIER);
  }

  const results: SearchResult[] = [...fused.values()].map((e) => ({
    path: e.row.page.path,
    type: e.row.type,
    title: e.row.title,
    // Retirement demotes in BOTH bands: the ladder score is already halved, and
    // the fused score halves here, so a retired page falls behind its active
    // peers under fusion too and never reaches zero.
    score: round6(e.row.retired ? e.score / 2 : e.score),
    band: e.row.band,
    ladder_score: e.row.ladderScore,
    // A page only `lexical:bm25` reached has a ladder score of 0 and so never
    // passed through the ladder's demotion branch, but its fused score was
    // halved above all the same. The consumer is told to trust the reasons over
    // the order, so every demoted result names its demotion.
    match_reasons:
      e.row.retired && !e.reasons.includes(RETIRED_REASON)
        ? [...e.reasons, RETIRED_REASON]
        : e.reasons,
  }));

  results.sort((a, b) => {
    if (a.band !== b.band) return a.band === "identity" ? -1 : 1;
    if (a.band === "identity" && a.ladder_score !== b.ladder_score) {
      return b.ladder_score - a.ladder_score;
    }
    if (a.score !== b.score) return b.score - a.score;
    return codeUnitCompare(a.path, b.path);
  });

  const capped = results.length > limit;
  // A query-less invocation matched by filter membership and consulted no tier
  // at all — reporting the ladder there would stamp the most absence-shaped
  // answer `search` can give with nine tiers that never looked
  // (docs/concepts.md §Generated artifacts).
  const runNear = options?.near === true && query !== undefined;
  const tiers =
    q === undefined
      ? [FILTER_TIER]
      : runNear
        ? [...LADDER_TIERS, LEXICAL_TIER, NEAR_TIER]
        : [...LADDER_TIERS, LEXICAL_TIER];
  const outcome: SearchOutcome = {
    results: results.slice(0, limit),
    coverage: {
      tiers_executed: tiers,
      corpus_size: pages.length,
      tokenization: TOKENIZATION_MODE,
      fusion: {
        method: "rrf",
        k: RRF_K,
        lists: q === undefined ? ["ladder"] : ["ladder", LEXICAL_TIER],
      },
      caps: { limit, found: results.length, hit: capped },
    },
  };
  if (runNear && query !== undefined) {
    const nearIndex = options.nearIndex ?? buildNearIndex(pages);
    // The advisory list is capped by its own cap and never by `--limit`: the
    // identity guard's candidate set is not a display (docs/concepts.md §Generated artifacts),
    // and the cap it did hit is reported rather than left silent.
    const all = nearCandidatesAll(nearIndex, query);
    outcome.near = all.slice(0, NEAR_LIMIT);
    outcome.coverage.caps.near_limit = NEAR_LIMIT;
    outcome.coverage.caps.near_hit = all.length > NEAR_LIMIT;
  }
  return outcome;
}
