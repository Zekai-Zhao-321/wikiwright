---
type: testing-guide
title: "Testing the engine"
description: "Two runners over one suite, every test in a temporary copy under os.tmpdir(), a pinned clock, and the helpers that install and grant the code kit in a store the test owns."
tags: [repo]
pin: a38be783d7393d145ba7950daf1b0ca2c1c4fbad
origin: .
covers: [package.json, scripts/, packages/cli/test/fixtures/, packages/core/test/helpers/, packages/cli/test/dry-run.test.ts, packages/cli/test/judge-property.test.ts, packages/core/test/kernel-import-boundary.test.ts]
---

# Testing the engine

## Running tests

The gate is `bun run check` (`package.json:26`): biome,
`bun run build` — `tsc -b` and the build-info stamp (`:20`) — the test-project
typecheck under `tsconfig.test.json`, which includes `packages/*/test/**` and
`tools/**` (`tsconfig.test.json:9`), and the whole suite under Bun, which
`tools/run-suite.ts` runs as one `bun test` process per file, as many at once
as the machine has cores; `bun run test` is the build and that run
(`package.json:22`). One file is
`bun test ./packages/cli/test/write-verb.test.ts`; the `./` makes the argument
a file, where a bare path is a substring filter. The node runner is
`bun run test:node` (`:23`): `node --test` over
`packages/core/test/*.test.ts` and `packages/cli/test/*.test.ts` — the only
thing that proves the shipped artifact is node-builtins-only, since Bun
tolerates shapes Node rejects (`scripts/release-matrix.sh:45-50`). The
workflow `.github/workflows/check.yml` runs the gate and then the node runner
on every push and pull request, on Linux and macOS (`:23-25`).
`scripts/hooks/pre-commit` runs `bun run check` in a clean git environment,
unsetting the `GIT_*` variables git exports into a hook because the suite
creates temporary repositories of its own (`:24-33`); enable it once
with `git config core.hooksPath scripts/hooks` (`:8-9`). Before a release,
`sh scripts/release-matrix.sh` runs six arms by hand — the gate, the node
runner, a pack of both packages, one corpus linted under both runtimes and
diffed, a clean build from no `dist/`, and the corpus verdicts — and prints
PASS or FAIL per arm; it covers only the operating system it runs on, and
Windows has no carrier at all (`scripts/release-matrix.sh:16-19`, `:41-100`).

Every test that judges `devwiki` or the `code` starter installs the kit into a
copy under `os.tmpdir()` and grants it in a store the test owns; the shipped
tree is never installed into or granted from
(`packages/cli/test/fixtures/kit-code.ts:1-9`). A fresh clone needs
`bun install` and a maintainer's `wikiwright trust grant
module:@wikiwright/kit-code --root devwiki`, with `--scope worktrees` to cover
every linked worktree of the clone, before `check --root devwiki` judges
anything, and the suite never reads that grant (`docs/architecture.md`,
"Developing"). The invariant table
in `docs/architecture.md` names, for each invariant, the test file that fails
by name when it breaks: `kernel-import-boundary` for the four layers,
`judge-property` for one judge at every write path, `routing-xor` and
`pass-table` for total routing, `dry-run` for the dry-run law and the closed
set of writers, `generate` and `generated-tracked` for deterministic
artifacts, `module-conformance`, `pack-install` and `kit-code` for the module
ladder.

## Writing tests

Tests use `node:test` and `node:assert/strict` so the same file runs under both
runners (`packages/core/test/kernel-import-boundary.test.ts:10-13`;
`packages/cli/test/judge-property.test.ts:9-11`). Every test writes under
`os.tmpdir()`, never in the repository (`docs/architecture.md`, "Developing").
A test that spawns a verb that stamps a date sets `WIKIWRIGHT_TODAY`: spread
`PINNED_CLOCK` from `packages/cli/test/fixtures/clock.ts` (`:1-5`, today
`2026-09-04`) into the spawn's `env`, so no page carries the wall clock.

For a bundle over the code kit, `packages/cli/test/fixtures/kit-code.ts`
carries the helpers: `installKit(root)` rewrites the bundle's `package.json`
to depend on the shipped package by absolute `file:` path and runs
`bun install`, then replaces every symlink with the bytes it points at so an
edit in the copy never writes through
(`packages/cli/test/fixtures/kit-code.ts:56-76`, `:39-53`); `kitEnv(root)`
is the spawn environment — the pinned clock and `WIKIWRIGHT_TRUST_FILE`
pointing at `<root>/.wikiwright-trust.json` (`:29-37`); `runKit(root, argv)`
spawns the built CLI with `--root` and parses the envelope, treating a
non-zero exit as a verdict rather than a failure (`:82-92`); `grantKit`
grants the kit there and asserts the grant (`:95-99`); `grantedCopy(source,
prefix)` copies a bundle without its `node_modules`, installs and grants
(`:101-116`). The judge's own behaviour tests load the memory law — a small
claims-bearing constitution that is test data, not a starter
(`packages/cli/test/fixtures/memory-law.ts:1-19`) — and core tests build a
law in memory through `constitutionOf` in
`packages/core/test/helpers/constitution.ts`, which fills in the document
envelope once so no fixture repeats it (`:1-5`, `:26-56`).

A verb that writes is driven twice, dry and real, and the plan's path set is
asserted equal to the real filesystem delta
(`packages/cli/test/dry-run.test.ts:1-13`). A property that must hold across
runtimes — the same fixture judged through every state constructor — lives in
a file both `test` and `test:node` glob
(`packages/cli/test/judge-property.test.ts:9-11`). Biome formats and lints
`packages/**`, `tools/**` and the root JSON files at line width 100
(`biome.json:9-16`).

## Relations

- part_of [[wikiwright-architecture]]
