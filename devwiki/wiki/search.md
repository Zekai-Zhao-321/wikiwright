---
type: subsystem
title: "Search"
description: "Deterministic page, record and file retrieval with per-result evidence status."
tags: [kernel, cli]
pin:
  commit: 4310263abeb8b8743da8c6b9eed5bcf736b2a200
  origin: .
  covers: ["packages/core/src/search/index.ts", "packages/core/src/search/bm25.ts", "packages/core/src/search/tokenize.ts", "packages/cli/src/verbs/search.ts"]
updated: 2026-09-26
---

# Search

## Responsibilities

Search combines identity matches with lexical BM25 ranking and Unicode-aware, CJK-capable tokens. It can return pages, parsed grammar items or file matches, with reasons and coverage. Item search includes records from governed child headings once; prose and unbound bullets are not inferred records.

## Entry points

Current source at this pin: `packages/core/src/search/index.ts`, `packages/core/src/search/bm25.ts`, `packages/core/src/search/tokenize.ts`, `packages/cli/src/verbs/search.ts`.

## State

The search index is rebuilt for each invocation from the selected working tree. Each returned result gets the same staleness and queue status that read would compute for its page.
With `--items`, a claim result also carries its current resolved source-page
path and nominal type in `fields.provenance.page`; URL and path sources carry
`null` there. The item's `raw` retains the authored link spelling.

## Invariants

A ranked near-name suggestion is not a resolved identity. A type filter includes descendants, and an output limit does not turn unsearched candidates into an absence claim.

## Failure modes

Search is not semantic retrieval and has no persistent index. Git work for status grows with the number of results returned.

## Relations

- part-of [[wikiwright-architecture]]
- mapped-in [[repository-layout]]
- verified-by [[testing-guide]]
