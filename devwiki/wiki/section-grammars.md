---
type: code-concept
title: "Section grammars"
description: "The kernel's fixed claims, relations and dated-entry record grammars."
tags: [kernel, stdlib]
pin:
  commit: 42733023e556c175d27846546fbdd5f5c60b5edb
  origin: .
  covers: ["packages/core/src/records/index.ts", "packages/core/src/records/schemas.ts", "packages/core/src/interface/index.ts", "packages/core/src/verdict/grammar.ts"]
---

# Section grammars

## Mechanism

A declared section parses each top-level list item as a claim, relation or dated entry. The parser keeps raw text, rationale and UTF-8 spans, then validates each record against its engine schema.

Claims recognize only final page-link, URL or declared source-path provenance, plus canonical lifecycle clauses. Relations resolve names and optional headings or aliases. Entries carry day, month or year precision.

A top-level item that does not match its grammar is item-unparsed. A relation can require labels and record removals in History; an entries section can be append-only.

## Where it lives

Current source at this pin: `packages/core/src/records/index.ts`, `packages/core/src/records/schemas.ts`, `packages/core/src/interface/index.ts`, `packages/core/src/verdict/grammar.ts`.

Alternative v1 spellings and one-to-three-space top-level bullets are not silently accepted. Nested bullets under a record remain rationale. Without a base, transition rows are unevaluated; with one, a removed open claim, relation or entry can be refused.

## Relations

- part-of [[wikiwright-architecture]]
