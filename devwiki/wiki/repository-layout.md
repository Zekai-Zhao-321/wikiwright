---
type: source-map
title: Repository layout
description: "Current file-to-purpose map for the v2 engine repository."
tags: [repo]
pin:
  commit: 103376a247d7df103132abded5c579a7e432459d
  origin: .
  covers: ["packages/core/src/index.ts", "packages/cli/src/main.ts", "libraries/kit-code/types/subsystem.yaml", "devwiki/config/engine.json", "fixtures/handbooks/orchard/config/engine.json", "tools/run-suite.ts", "test/episode.test.ts", "docs/architecture.md", "AGENTS.md"]
updated: 2026-09-26
---

# Repository layout

## Layout

The repository separates a pure kernel, an imperative CLI, data libraries, synthetic bundles, build and test tools, and documentation.

| Path | Purpose |
|---|---|
| packages/core/src/index.ts | Pure kernel export surface |
| packages/cli/src/main.ts | CLI dispatch and envelope writing |
| libraries/kit-code/types/subsystem.yaml | Example data library type |
| devwiki/config/engine.json | This repository's own bundle law |
| fixtures/handbooks/orchard/config/engine.json | Synthetic handbook law |
| tools/run-suite.ts | Per-file Bun test runner |
| test/episode.test.ts | Synthetic first-delivery episode |
| docs/architecture.md | Package and invariant map |
| AGENTS.md | Repository operating rules |

Current source at this pin: `packages/core/src/index.ts`, `packages/cli/src/main.ts`, `libraries/kit-code/types/subsystem.yaml`, `devwiki/config/engine.json`, `fixtures/handbooks/orchard/config/engine.json`, `tools/run-suite.ts`, `test/episode.test.ts`, `docs/architecture.md`, `AGENTS.md`.
