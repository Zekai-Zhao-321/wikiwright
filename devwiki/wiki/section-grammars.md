---
type: code-concept
title: "Section grammars"
description: "The kernel's fixed claims, relations and dated-entry record grammars."
tags: [kernel, stdlib]
pin:
  commit: 103376a247d7df103132abded5c579a7e432459d
  origin: .
  covers: ["packages/core/src/records/index.ts", "packages/core/src/records/schemas.ts", "packages/core/src/interface/index.ts", "packages/core/src/verdict/grammar.ts"]
updated: 2026-09-26
---

# Section grammars

## Mechanism

A declared section parses each top-level list item in its physical heading's direct content as a claim, relation or dated entry. With scope: descendants, undeclared child headings inherit that policy; an exact under path can replace it, including grammar: prose for an ordinary region. The parser keeps each heading's raw subtree, direct span, item text, rationale and UTF-8 locations without copying child records into parent items. Each parsed record is validated against its engine schema.

Claims recognize only final page-link, URL or declared source-path provenance, plus canonical lifecycle clauses. Relations resolve names and optional headings or aliases. Entries carry day, month or year precision.

A top-level item that does not match its grammar is item-unparsed. A relation can require labels and record removals in History; an entries section can be append-only.

## Where it lives

Current source at this pin: `packages/core/src/records/index.ts`, `packages/core/src/records/schemas.ts`, `packages/core/src/interface/index.ts`, `packages/core/src/verdict/grammar.ts`.

Alternative v1 spellings and one-to-three-space top-level bullets are not silently accepted. Nested bullets under a record remain rationale, including across a nested fenced block. A separate opaque block ends that item, so a later bullet is judged on its own. Without a base, transition rows are unevaluated; with one, a removed open claim, relation or entry can be refused.

## Relations

- part-of [[wikiwright-architecture]]
