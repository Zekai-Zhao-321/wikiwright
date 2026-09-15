---
type: subsystem
title: "Search"
description: "Deterministic lexical retrieval: an identity ladder fused with BM25 by reciprocal rank fusion, a CJK-capable tokenizer over explicit code-point ranges, a per-invocation index, and a coverage block on every answer."
tags: [kernel, cli]
pin: 869444ed94e955fb7f3e51ac4d7495ee9d58aa03
origin: .
covers: [packages/core/src/search/, packages/cli/src/verbs/search.ts]
---

# Search

## Responsibilities

`searchPages` (`packages/core/src/search/index.ts:144`) normalizes the query
and every filter through `normalizeIdentity` (`:151-155`), keeps the pages
whose type chain, tag or title pass the filters (`:178-190`), and scores each
kept page on the identity ladder: `name:exact`, `alias:exact`, `name:stem`
after one trailing ` (…)` qualifier (`:194-214`; `stripQualifier` at
`packages/core/src/search/near.ts:51`), `title:exact` or `title:contains`,
`heading`, `tag`, `description:contains` and `body:phrase`
(`packages/core/src/search/index.ts:215-243`), with
power-of-two weights spaced so the sum of every lower tier never outranks one
higher hit (`:87-101`). A retired page's score is halved and never reaches
zero (`:249-254`). The ladder list and the BM25 list (`rankLexical`,
`packages/core/src/search/bm25.ts:138`) are fused by reciprocal rank fusion
at k=60 (`packages/core/src/search/index.ts:86`, `:266-301`); results are ordered by band — an identity hit is
never reordered by fusion — then score, then path (`:323-330`). Every answer
carries a coverage block: the tiers executed, the corpus size, the
tokenization mode, the fusion method and the caps (`:344-357`); `--near` adds
an advisory candidate list under its own cap of 20 (`:358-367`;
`packages/core/src/search/near.ts:25`).

`packages/core/src/search/tokenize.ts` is the one tokenizer: Latin words plus
CJK unigrams and bigrams, classified over explicit code-point ranges rather
than Unicode property escapes or `Intl`, so two engines built against
different Unicode versions tokenize identically (`:5-11`, `:13-52`).
`packages/core/src/search/bm25.ts` fixes k1 at 1.2, b at 0.75 and a 3×
boost for basename, aliases, tags and headings (`:10-14`), and computes the
logarithm from a series rather than `Math.log`, which is not specified to the
last bit (`:16-50`). The verb (`packages/cli/src/verbs/search.ts`) requires a
query or at least one filter (`:47-62`), defaults the cap to 20 (`:63-67`),
resolves a `--tag` alias to its canonical entry (`:73-77`) and hands the type
chains over so `--type` matches descendants (`:78-82`).

## Entry points

- `searchPages`, `buildLexicalIndex`, `rankLexical`, `buildNearIndex`,
  `nearCandidates`, `nameFormsOf`, `stripQualifier`, `tokenize`
  (`packages/core/src/index.ts:200-212`).
- `searchCommand` (`packages/cli/src/verbs/search.ts:11`).
- The write path's identity gate reads `nameFormsOf` and `nearCandidates`
  from the same module (`packages/cli/src/verbs/write.ts:21-22`, `:111-112`).

## State

None persisted: the lexical index and the near index are built per invocation
and passing one in is a memo, never a policy
(`packages/core/src/search/index.ts:120-127`, `:160-161`, `:359`).

## Invariants

- Identity hits assert which page this is and relevance hits how well it
  matches; fusion may reorder relevance and may never reorder identity
  (`packages/core/src/search/index.ts:28-33`, `:107-108`, `:323-330`).
- Neither list's internal order depends on which pages a filter removed
  (`:266-278`).
- Deterministic and locale-free: ties break on the code-unit path (`:272`,
  `:329`); scores are rounded to six places (`:140-142`); the tokenizer and
  the logarithm are specified to the bit (`tokenize.ts:5-7`,
  `bm25.ts:2-5`).
- A query-less invocation ran the `filter` tier and only that, and the
  coverage block says so rather than stamping nine tiers that never looked
  (`:332-343`); an empty query string is not a query
  (`packages/cli/src/verbs/search.ts:38-43`).
- Not-found is only as good as the coverage block: `caps.hit` reports that
  the cap cut the list (`packages/core/src/search/index.ts:355`), and the
  advisory list is capped by its own
  cap, never by `--limit` (`:360-366`).
- Every demoted result names its demotion in `match_reasons` (`:313-320`).

## Failure modes

- `missing-argument` when neither a query nor a filter is given
  (`packages/cli/src/verbs/search.ts:53-62`); `invalid-limit` for a
  non-positive cap (`:65-67`).
- The near list's Han-to-Latin bridge is built from the bundle's own alias
  pairs, never a transliteration table, so a name with no alias in the other
  script is not bridged (`packages/core/src/search/near.ts:4-5`, `:44-48`).

## Relations

- part_of [[wikiwright-architecture]]
- mapped_in [[repository-layout]]
- verified_by [[testing-guide]]
