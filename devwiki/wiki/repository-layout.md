---
type: source-map
title: Repository layout
description: "Current file-to-purpose map for the v2 engine repository."
tags: [repo]
pin:
  commit: 1a1a90c11329d82c9b2c6e92c6fa8e16160c0613
  origin: .
  covers: ["packages/core/src/index.ts", "packages/core/src/verdict/sourcepaths.ts", "packages/cli/src/main.ts", "libraries/kit-code/types/subsystem.yaml", "libraries/source-kit/types/observation.yaml", "devwiki/config/engine.json", "fixtures/handbooks/orchard/config/engine.json", "fixtures/source-policy/config/engine.json", "tools/run-suite.ts", "test/episode.test.ts", "docs/architecture.md", "AGENTS.md"]
updated: 2026-09-26
---

# Repository layout

## Layout

The repository separates a pure kernel, an imperative CLI, data libraries, synthetic bundles, build and test tools, and documentation.
The synthetic source-policy bundle imports a garden source library and tests
the nominal type of cited page sources across working-tree, write and staged
states.

| Path | Purpose |
|---|---|
| packages/core/src/index.ts | Pure kernel export surface |
| packages/core/src/verdict/sourcepaths.ts | Selected-state source-path existence judgment |
| packages/cli/src/main.ts | CLI dispatch and envelope writing |
| libraries/kit-code/types/subsystem.yaml | Example data library type |
| libraries/source-kit/types/observation.yaml | Synthetic source-type policy |
| devwiki/config/engine.json | This repository's own bundle law |
| fixtures/handbooks/orchard/config/engine.json | Synthetic handbook law |
| fixtures/source-policy/config/engine.json | Synthetic source-policy bundle law |
| tools/run-suite.ts | Per-file Bun test runner |
| test/episode.test.ts | Synthetic first-delivery episode |
| docs/architecture.md | Package and invariant map |
| AGENTS.md | Repository operating rules |

Current source at this pin: `packages/core/src/index.ts`, `packages/core/src/verdict/sourcepaths.ts`, `packages/cli/src/main.ts`, `libraries/kit-code/types/subsystem.yaml`, `libraries/source-kit/types/observation.yaml`, `devwiki/config/engine.json`, `fixtures/handbooks/orchard/config/engine.json`, `fixtures/source-policy/config/engine.json`, `tools/run-suite.ts`, `test/episode.test.ts`, `docs/architecture.md`, `AGENTS.md`.
