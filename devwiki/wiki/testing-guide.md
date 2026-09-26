---
type: testing-guide
title: "Testing the engine"
description: "Bun gate, synthetic corpora, temporary fixtures and end-to-end CLI probes."
tags: [repo]
pin:
  commit: 5e9abce0e1f7ae60507b3ec1c6ef22663f72d245
  origin: .
  covers: ["tools/run-suite.ts", "packages/cli/test/fixtures/garden-cli.ts", "packages/cli/test/fixture-verdicts.test.ts", "packages/cli/test/source-policy.test.ts", "test/episode.test.ts", "scripts/release-matrix.sh"]
---

# Testing the engine

## Running tests

Bun run check runs Biome, the build, test-project typecheck and the whole suite. The runner starts one Bun test process per file with a wider timeout under parallel load.

Current source at this pin: `tools/run-suite.ts`, `packages/cli/test/fixtures/garden-cli.ts`, `packages/cli/test/fixture-verdicts.test.ts`, `packages/cli/test/source-policy.test.ts`, `test/episode.test.ts`, `scripts/release-matrix.sh`.

The CLI tests use temporary gardening bundles and read the spawned CLI envelope from a file. Fixture-verdicts judges the six checked-in corpora; the episode runs the correction loop twice. The source-policy fixture tests Unicode page names, source-only retyping, staged disagreement, deletion and moves.

## Writing tests

Every test write is under os.tmpdir(), a dated write sets WIKIWRIGHT_TODAY, and a generated artifact is compared with its generator.

Heavy external load can cause a timeout. The packed-install test needs network access; Windows and the manual release matrix remain separate verification boundaries.

## Relations

- part-of [[wikiwright-architecture]]
