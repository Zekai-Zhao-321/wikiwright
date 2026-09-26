---
type: architecture-overview
title: wikiwright architecture
description: "Kernel, data-library and bundle layers and the four adapters that reach one judge."
tags: [kernel, stdlib, cli, kit]
pin:
  commit: 103376a247d7df103132abded5c579a7e432459d
  origin: .
  covers: ["packages/core/src/index.ts", "packages/cli/src/main.ts", "packages/cli/src/lawstate.ts", "docs/architecture.md"]
updated: 2026-09-26
---

# wikiwright architecture

## System shape

WikiWright is a pure core over bytes plus an imperative Bun CLI. Type documents in libraries and bundles declare law, including section scope and exact child paths; the kernel fixes grammar, schemas, CEL profile, judge and artifacts.

Current source at this pin: `packages/core/src/index.ts`, `packages/cli/src/main.ts`, `packages/cli/src/lawstate.ts`, `docs/architecture.md`.

## Layers

The CLI builds working-tree, draft, index or revision states and loads each state with its matching law. Eight verbs expose the same JSON envelope and closed exit taxonomy.

A type system is held at both acceptance boundaries: write judges one captured law and page state, preflights every destination and moved-from parent, then rechecks the state after staging, before the first rename; gate judges what a commit would contain. The engine checks conformance, not truth.

A direct editor change is judged when staged for the gate, not at the moment the host lands it. There is no daemon, executable library hook or mechanical session role bound.

The detailed v1 descriptions remain in Git history at 35f5c01; these pages describe the v2 binary and do not present removed code as current.

## Relations

- mapped-in [[repository-layout]]
- verified-by [[wikiwright-quickstart]]
- decided-by [[D-004]]
- verified-by [[testing-guide]]
