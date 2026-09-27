---
type: subsystem
title: Registry pipeline
description: "Historical v1 JSON registry pipeline; the v2 loader composes type documents."
tags: [kernel, cli]
status: retired
pin:
  commit: 61cf635d842b8f465a66b0b666b163b39127f909
  origin: .
  covers: ["packages/core/src/law/load.ts", "packages/cli/src/lawfiles.ts", "CHANGELOG.md"]
updated: 2026-09-26
---

# Registry pipeline

## Responsibilities

The old config/constitution.json registry and its module composition left. LoadTypeLaw now takes a LawSnapshot, resolves data libraries, reads type, fragment and vocabulary documents, composes them and compiles shapes and rules.

## Entry points

Current disposition at this pin: `packages/core/src/law/load.ts`, `packages/cli/src/lawfiles.ts`, `CHANGELOG.md`.

## State

Lawfiles builds snapshots from disk, index or revision bytes. A failed library or invalid document stops the law load before any page is judged.

## Invariants

The same law bytes yield the same compiled law and digest regardless of adapter. A bundle document may extend a qualified library document.

## Failure modes

A v1 registry file does not make a v2 bundle. A file with a foreign extension or a linked law directory is refused rather than partially loaded.

## Relations

- part-of [[wikiwright-architecture]]
- mapped-in [[repository-layout]]
- verified-by [[testing-guide]]

## History

- 2026-09-07 — re-read and re-pinned: the page cited packages/core/src/registry/v3.ts, a file that did not exist at its pin; the loader is packages/core/src/registry/index.ts.
