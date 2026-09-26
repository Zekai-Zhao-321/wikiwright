---
type: architecture-overview
title: wikiwright architecture
description: "Kernel, data-library and bundle layers and the four adapters that reach one judge."
tags: [kernel, stdlib, cli, kit]
pin:
  commit: 1bebda0ca948b352d74c663d205f2963aea26c7f
  origin: .
  covers: ["packages/core/src/index.ts", "packages/cli/src/main.ts", "packages/cli/src/lawstate.ts", "docs/architecture.md"]
---

# wikiwright architecture

## System shape

WikiWright is a pure core over bytes plus an imperative Bun CLI. Type documents in libraries and bundles declare law; the kernel fixes grammar, schemas, CEL profile, judge and artifacts.

Current source at this pin: `packages/core/src/index.ts`, `packages/cli/src/main.ts`, `packages/cli/src/lawstate.ts`, `docs/architecture.md`.

## Layers

The CLI builds working-tree, draft, index or revision states and loads each state with its matching law. Eight verbs expose the same JSON envelope and closed exit taxonomy.

A type system is held at both acceptance boundaries: write judges one captured law and page state, preflights every destination and rechecks the state before landing; gate judges what a commit would contain. The engine checks conformance, not truth.

A direct editor change is judged when staged for the gate, not at the moment the host lands it. There is no daemon, executable library hook or mechanical session role bound.

The detailed v1 descriptions remain in Git history at 35f5c01; these pages describe the v2 binary and do not present removed code as current.

## Relations

- mapped-in [[repository-layout]]
- verified-by [[wikiwright-quickstart]]
- decided-by [[D-004]]
- verified-by [[testing-guide]]
