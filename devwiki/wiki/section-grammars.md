---
type: code-concept
title: "Section grammars"
description: "The kernel's fixed claims, relations and dated-entry record grammars."
tags: [kernel, stdlib]
pin:
  commit: 61cf635d842b8f465a66b0b666b163b39127f909
  origin: .
  covers: ["packages/core/src/records/index.ts", "packages/core/src/records/schemas.ts", "packages/core/src/interface/index.ts", "packages/core/src/verdict/grammar.ts"]
updated: 2026-09-27
---

# Section grammars

## Mechanism

A declared section parses each top-level list item in its physical heading's direct content as a claim, relation or dated entry. With scope: descendants, undeclared child headings inherit that policy; an exact under path can replace it, including grammar: prose for an ordinary region. The parser keeps each heading's raw subtree, direct span, item text, rationale and UTF-8 locations without copying child records into parent items. Each parsed record is validated against its engine schema.

Claims recognize only final page-link, URL or declared source-path provenance, plus canonical lifecycle clauses. A source path is one slash-separated token under a source root; a trailing slash requires a directory, and the judge checks its selected-state existence. Relations resolve names and optional headings or aliases. Entries carry day, month or year precision.
For CEL, a relation's authored name, heading and display alias stay lexical,
while `target.resolved`, `target.path` and `target.type` are projected from
current names or the base names for `before.section`, `before.sections` and
`before.page.sections`. Internal relation-removal matching is unchanged.
The parsed claim keeps the authored page-name component and a lexical
unresolved slot. A rule or item search sees that slot projected through the
selected state's name index as a resolved path and nominal type. A resolved
page name does not check a heading or prove the source's claim true.

A top-level item that does not match its grammar is item-unparsed. A relation can require labels and record removals in History; an entries section can be append-only.

## Where it lives

Current source at this pin: `packages/core/src/records/index.ts`, `packages/core/src/records/schemas.ts`, `packages/core/src/interface/index.ts`, `packages/core/src/verdict/grammar.ts`.

Alternative v1 spellings and one-to-three-space top-level bullets are not silently accepted. Nested bullets under a record remain rationale, including across a nested fenced block. A separate opaque block ends that item, so a later bullet is judged on its own. Without a base, transition rows are unevaluated; with one, a removed open claim, relation or entry can be refused.

## Relations

- part-of [[wikiwright-architecture]]
