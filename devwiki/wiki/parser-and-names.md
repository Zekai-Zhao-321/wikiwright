---
type: subsystem
title: "The parser and the names it binds"
description: "Markdown and YAML parsing, Unicode page identity and name resolution."
tags: [kernel]
pin:
  commit: 179fb9f6edc0eec03b113c33bd5c2c0648231ff2
  origin: .
  covers: ["packages/core/src/parse/index.ts", "packages/core/src/names/index.ts", "packages/core/src/identity/index.ts", "packages/core/src/interface/index.ts"]
---

# The parser and the names it binds

## Responsibilities

The parser reads YAML frontmatter, CommonMark headings and wikilinks into a line map. The page interface parses declared grammar items and exposes their raw text and locations.

## Entry points

Current source at this pin: `packages/core/src/parse/index.ts`, `packages/core/src/names/index.ts`, `packages/core/src/identity/index.ts`, `packages/core/src/interface/index.ts`.

## State

Names, aliases and titles are indexed from the selected pages. Unicode NFC and full case folding decide identity; search adds ranked retrieval without changing which page a name resolves to.

## Invariants

A page has one nominal type. A duplicate key, malformed frontmatter or colliding identity is reported rather than guessed away.

## Failure modes

An unparsed list item stays item-unparsed, and a name collision needs review. A normalisation-sensitive filesystem can hold two disk paths the engine normalizes to one key.

## Relations

- part-of [[wikiwright-architecture]]
- mapped-in [[repository-layout]]
- verified-by [[testing-guide]]
