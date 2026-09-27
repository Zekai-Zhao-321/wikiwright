---
type: subsystem
title: "The parser and the names it binds"
description: "Markdown and YAML parsing, Unicode page identity and name resolution."
tags: [kernel]
pin:
  commit: 61cf635d842b8f465a66b0b666b163b39127f909
  origin: .
  covers: ["packages/core/src/parse/index.ts", "packages/core/src/names/index.ts", "packages/core/src/identity/index.ts", "packages/core/src/interface/index.ts"]
updated: 2026-09-27
---

# The parser and the names it binds

## Responsibilities

The parser reads YAML frontmatter, document-level CommonMark headings and wikilinks into a line map. Headings inside quotes or lists remain block content. The page interface keeps each heading's raw subtree separate from its direct content, and parses grammar items only in that direct region.

## Entry points

Current source at this pin: `packages/core/src/parse/index.ts`, `packages/core/src/names/index.ts`, `packages/core/src/identity/index.ts`, `packages/core/src/interface/index.ts`.

## State

Names, aliases and titles are indexed from the selected pages. Unicode NFC and full case folding decide identity; search adds ranked retrieval without changing which page a name resolves to.
A claim's lexical provenance keeps its authored page name. The rule interface
projects the resolved page path and nominal type from the name index, so a
Unicode citation needs no CEL reconstruction of a normalized map key.
Relation records also keep the authored target name, heading and alias.
The CEL page interface projects target resolution, path and type from the
current name index, or from the base name index in `before`; a shared parsed
page therefore cannot leak current target metadata into a historical rule.

## Invariants

A page has one nominal type. A duplicate key, malformed frontmatter or colliding identity is reported rather than guessed away.

## Failure modes

A top-level list item with one to three leading spaces is item-unparsed rather than silently skipped; nested bullets remain rationale. A separate fence, comment or thematic break ends the previous item, so a later bullet is judged on its own. A fence nested inside the item preserves its rationale. Cyclic YAML aliases are malformed input, not an internal stack error. A name collision needs review, and a normalisation-sensitive filesystem can hold two disk paths the engine normalizes to one key.

## Relations

- part-of [[wikiwright-architecture]]
- mapped-in [[repository-layout]]
- verified-by [[testing-guide]]
