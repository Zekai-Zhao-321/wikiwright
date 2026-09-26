---
type: subsystem
title: "Search"
description: "Deterministic page, record and file retrieval with per-result evidence status."
tags: [kernel, cli]
pin:
  commit: 179fb9f6edc0eec03b113c33bd5c2c0648231ff2
  origin: .
  covers: ["packages/core/src/search/index.ts", "packages/core/src/search/bm25.ts", "packages/core/src/search/tokenize.ts", "packages/cli/src/verbs/search.ts"]
---

# Search

## Responsibilities

Search combines identity matches with lexical BM25 ranking and Unicode-aware, CJK-capable tokens. It can return pages, parsed grammar items or file matches, with reasons and coverage.

## Entry points

Current source at this pin: `packages/core/src/search/index.ts`, `packages/core/src/search/bm25.ts`, `packages/core/src/search/tokenize.ts`, `packages/cli/src/verbs/search.ts`.

## State

The search index is rebuilt for each invocation from the selected working tree. Each returned result gets the same staleness and queue status that read would compute for its page.

## Invariants

A ranked near-name suggestion is not a resolved identity. A type filter includes descendants, and an output limit does not turn unsearched candidates into an absence claim.

## Failure modes

Search is not semantic retrieval and has no persistent index. Git work for status grows with the number of results returned.

## Relations

- part-of [[wikiwright-architecture]]
- mapped-in [[repository-layout]]
- verified-by [[testing-guide]]
