---
type: subsystem
title: "Search"
description: "Deterministic lexical retrieval: an identity ladder fused with BM25 by reciprocal rank fusion, a CJK-capable tokenizer over explicit code-point ranges, a per-invocation index, item search, an unranked file listing, and a coverage block on every answer."
tags: [kernel, cli]
pin: 29dbfb9c8b6bf1679bca419d1f3a7479c3f00532
origin: .
covers: [packages/core/src/search/, packages/cli/src/verbs/search.ts]
---

# Search

## Responsibilities

`searchPages` (`packages/core/src/search/index.ts:184`) normalizes the query
through `normalizeIdentity` (`:191`), keeps the pages `pageFilter` passes
(`:192`, `:217`) — `pageFilter` normalizes every filter the same way and
matches the type chain, a tag or a title substring (`:155-182`) — and scores
each kept page on the identity ladder: `name:exact`, `alias:exact`,
`name:stem` after one trailing ` (…)` qualifier (`:222-242`; `stripQualifier`
at `packages/core/src/search/near.ts:51`), `title:exact` or `title:contains`,
`heading`, `tag`, `description:contains` and `body:phrase`
(`packages/core/src/search/index.ts:243-271`), with
power-of-two weights spaced so the sum of every lower tier never outranks one
higher hit (`:91-105`). A retired page's score is halved and never reaches
zero (`:277-282`). The ladder list and the BM25 list (`rankLexical`,
`packages/core/src/search/bm25.ts:163`) are fused by reciprocal rank fusion
at k=60 (`packages/core/src/search/index.ts:89`, `:294-329`); results are
ordered by band — an identity hit is never reordered by fusion — then score,
then path (`:351-358`). `--band` keeps one band after that order is set, so
the kept results keep their places and the cap counts only them
(`:359-366`). Every answer carries a coverage block: the tiers executed, the
corpus size, the tokenization mode, the fusion method and the caps
(`:380-393`); `--near` adds an advisory candidate list under its own cap of
20 (`:394-403`; `packages/core/src/search/near.ts:25`).

`searchFiles` (`packages/core/src/search/index.ts:428-478`) is `--files`:
every page with a match, in code-unit order by path, unranked and uncapped
(`caps.limit` is `null`, `:475`). Every ranked match is classified first,
whatever band was asked for: the ranked search's pages with each page's band
and tier reasons, without the fusion's list positions (`:434-449`), then
every other kept page whose normalized source holds a query term inside a
longer word, reason `text:contains`, in the relevance band (`:419`,
`:450-463`). `--band` applies to that whole list, so no identity match comes
back as a substring match and the two bands split the unbanded list
(`:464-467`).

`searchItems` (`packages/core/src/search/items.ts:133-206`) is `--items`: it
ranks grammar items rather than pages. `collectItems` (`:77-110`) takes every
item the judge would see, parsing each page's sections through
`grammarBindings` and `parseSections` under its effective type and skipping
prose (`:85-93`). Each item is keyed by path and zero-padded line (`:113-115`)
and indexed over its own line and its rationale lines by `buildTextIndex`
(`packages/core/src/search/bm25.ts:117-119`), with statistics from the items
of every walked page, so a filter subsets without reordering
(`packages/core/src/search/items.ts:141-147`). BM25 ranks the kept items
(`:156`, `:177-182`); every other kept item whose text holds a query term
inside a longer word follows, unranked, as `text:contains` (`:183-189`). A
result says whether the term sits on the item's own line or only under it
(`matched_in`, `:160`), a retired page's item is halved and marked
(`:172-174`), and the coverage block counts the pages and items considered
(`:195-205`).

`packages/core/src/search/tokenize.ts` is the one tokenizer: Latin words plus
CJK unigrams and bigrams, classified over explicit code-point ranges rather
than Unicode property escapes or `Intl`, so two engines built against
different Unicode versions tokenize identically (`:5-11`, `:13-52`).
`packages/core/src/search/bm25.ts` fixes k1 at 1.2, b at 0.75 and a 3×
boost for basename, aliases, tags and headings (`:10-14`), and computes the
logarithm from a series rather than `Math.log`, which is not specified to the
last bit (`:16-50`). A page and an item are scored by the same `indexOf` and
`rankKeys` (`:121-154`, `:176-203`); only a page has boosted fields. The verb
(`packages/cli/src/verbs/search.ts`) requires a query or at least one filter
(`:76-91`), defaults the cap to 20 and lets `--all` lift it (`:92-98`),
refuses `--items` without a query (`:99-105`) and an unknown `--band`
(`:106-118`), keeps `--items` apart from `--files`, `--band` and `--near`,
and `--near` apart from `--files` (`:119-156`), resolves a `--tag` alias to
its canonical entry (`:162-166`), hands the type chains over so `--type`
matches descendants (`:167`), and dispatches to item search, the file
listing or the page search (`:168-197`).

## Entry points

- `searchPages`, `searchFiles`, `pageFilter`, `SEARCH_BANDS`,
  `buildLexicalIndex`, `buildTextIndex`, `rankLexical`, `rankKeys`,
  `collectItems`, `searchItems`, `buildNearIndex`, `nearCandidates`,
  `nameFormsOf`, `stripQualifier`, `tokenize`
  (the package barrel, `packages/core/src/index.ts`).
- `searchCommand` (`packages/cli/src/verbs/search.ts:20`).
- The write path's identity gate reads `nameFormsOf` and `nearCandidates`
  from the same module (`packages/cli/src/verbs/write.ts`; see
  [[writer-and-staged-gate]]).

## State

None persisted: the lexical index, the item index and the near index are
built per invocation and passing one in is a memo, never a policy
(`packages/core/src/search/index.ts:123-130`, `:197-198`, `:395`;
`packages/core/src/search/items.ts:147`).

## Invariants

- Identity hits assert which page this is and relevance hits how well it
  matches; fusion may reorder relevance and may never reorder identity
  (`packages/core/src/search/index.ts:28-33`, `:110-111`, `:351-358`).
- Neither list's internal order depends on which pages a filter removed
  (`:294-306`); item statistics come from every walked page's items
  (`packages/core/src/search/items.ts:147`).
- Deterministic and locale-free: ties break on the code-unit path
  (`packages/core/src/search/index.ts:300`, `:357`), an item's on path then
  line (`packages/core/src/search/items.ts:190-193`), and `--files` sorts by
  path (`packages/core/src/search/index.ts:468`); scores are rounded to six
  places (`:145-147`); the tokenizer and the logarithm are specified to the
  bit (`tokenize.ts:5-7`, `bm25.ts:2-5`).
- A query-less invocation ran the `filter` tier and only that, and the
  coverage block says so rather than stamping nine tiers that never looked
  (`:368-379`); an empty query string is not a query
  (`packages/cli/src/verbs/search.ts:67-72`).
- Not-found is only as good as the coverage block: `caps.hit` reports that
  the cap cut the list (`packages/core/src/search/index.ts:391`), the
  advisory list is capped by its own cap, never by `--limit` (`:396-402`),
  and the file listing has no cap to hit (`:475`).
- Every demoted result names its demotion in `match_reasons` (`:341-348`;
  an item's at `packages/core/src/search/items.ts:172-174`).

## Failure modes

- `missing-argument` when neither a query nor a filter is given, or for
  `--items` without a query (`packages/cli/src/verbs/search.ts:76-91`,
  `:99-105`); `invalid-limit` for a non-positive cap (`:94-96`);
  `invalid-value` for a band that is not `identity` or `relevance`
  (`:106-118`); `invalid-arguments` for `--items` beside `--files`, `--band`
  or `--near`, and `--near` beside `--files` (`:119-156`).
- A multi-word query matches a page or an item holding any one of its terms;
  `text:contains` matches a term inside a longer word, so a short term finds
  more than the words it spells.
- The near list's Han-to-Latin bridge is built from the bundle's own alias
  pairs, never a transliteration table, so a name with no alias in the other
  script is not bridged (`packages/core/src/search/near.ts:4-5`, `:44-48`).

## Relations

- part_of [[wikiwright-architecture]]
- mapped_in [[repository-layout]]
- verified_by [[testing-guide]]
