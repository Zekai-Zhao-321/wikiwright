---
type: testing-guide
title: "Testing the engine"
description: "Two runners over one suite, every test in a temporary copy under os.tmpdir(), a pinned clock, and the helpers that install the code kit into a copy."
tags: [repo]
pin: e61cee334e0a045f2b5fb6fa607ae7aff7e34411
origin: .
covers: [package.json, scripts/, packages/cli/test/fixtures/, packages/core/test/helpers/, packages/cli/test/dry-run.test.ts, packages/cli/test/bundles.test.ts, packages/cli/test/store-lock.test.ts, packages/cli/test/multi-bundle.test.ts, fixtures/handbooks/, packages/cli/test/judge-property.test.ts, packages/core/test/kernel-import-boundary.test.ts, tools/run-suite.ts]
---

# Testing the engine

## Running tests

The gate is `bun run check` (`package.json:26`): biome,
`bun run build` — `tsc -b` and the build-info stamp (`:20`) — the test-project
typecheck under `tsconfig.test.json`, which includes `packages/*/test/**` and
`tools/**` (`tsconfig.test.json:9`), and the whole suite under Bun, which
`tools/run-suite.ts` runs as one `bun test` process per file, as many at once
as the machine has cores, a test or a hook given twenty seconds
(`tools/run-suite.ts:73`, `:185`); `bun run test` is the build and that run
(`package.json:22`). Under Bun the runner sets `WIKIWRIGHT_CLI_RUNTIME` to
the `node` on PATH as an absolute path, a relative PATH entry resolved
against its own directory, unless the variable is set already; with no
`node` to find it exits 2 before any file runs rather than let the CLI run
under Bun; and its summary names the runtime (`tools/run-suite.ts:17-21`,
`:79-117`, `:155-163`, `:193`). Every test that spawns the CLI spawns it
under `CLI_RUNTIME`, that variable or the test's own runtime
(`packages/cli/test/fixtures/runtime.ts:1-11`). The engine ships for Node,
and under load Bun 1.3.11's synchronous spawn handed back a child's piped
stdout cut short with exit 0 — 7 of 900 calls in a stress run, none of
3,600 under Node — which was the gate's intermittent `lint --staged`
failure; the engine now reads every git answer from a file git writes
itself, so a test that calls an engine function in its own process under
Bun reads git that way too (`docs/roadmap.md`; see [[git]]). A test that means Bun names
`bun`: `run-suite.test.ts` drives the runner with it, and one
`vocabulary-show.test.ts` case compares Bun's output with Node's. One file is
`bun test ./packages/cli/test/write-verb.test.ts`; the `./` makes the argument
a file, where a bare path is a substring filter. The node runner is
`bun run test:node` (`package.json:23`): `node --test` over
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
The suite is sensitive to load from outside it: on a machine busy indexing or
scanning, spawned processes slow down, a single test or a `before` hook's
`bun install` can exceed its budget, and the gate fails on a change that is
sound. The sensitivity predates the connected-bundles work; run the gate on a
quiet machine (`docs/roadmap.md`, "The suite is sensitive to machine load").

Every test that judges `devwiki` or the `code` starter installs the kit into a
copy under `os.tmpdir()`; the shipped tree is never installed into
(`packages/cli/test/fixtures/kit-code.ts:1-6`). A fresh clone needs
`bun install` and nothing else before `check --root devwiki` judges anything:
every load proves the kit (`docs/architecture.md`, "Developing"; see
[[loading-a-module]]). The invariant table
in `docs/architecture.md` names, for each invariant, the test file that fails
by name when it breaks: `kernel-import-boundary` for the four layers,
`judge-property` for one judge at every write path, `routing-xor` and
`pass-table` for total routing, `dry-run` for the dry-run law and the closed
set of writers, `generate` and `generated-tracked` for deterministic
artifacts, `module-conformance`, `module-path`, `purity`, `pack-install` and
`kit-code` for the module ladder, `store-lock` for the lock the bundles
registry is written under, `bundle-identity` for the bundle every vault envelope names, and
`multi-bundle` — the connected-bundles scenario end to end — with `bundles`,
`read-verb` and `bundle-identity` for connected bundles told apart.

The two gardening handbooks under `fixtures/handbooks` are corpora too, and
declare no module, so nothing is installed to judge them:
`fixture-verdicts` holds each at zero findings of any severity under `lint`
and `check` (`packages/cli/test/fixture-verdicts.test.ts:105-114`),
`generated-tracked` rebuilds their tracked `generated/` and their rendered
exports under `skills/` byte for byte, each copied under its own name, since
an export's marker names the bundle by its label
(`packages/cli/test/generated-tracked.test.ts:30-35`, `:47-53`), `export-copy`
installs their exports by a plain copy and reads them as a host would (see
[[exports]]), and `multi-bundle`,
`bundles`, `read-verb` and `hooks-scripts` read temporary copies of them,
never the shipped fixtures (`packages/cli/test/multi-bundle.test.ts:22-25`).
The lock the registry is written under is tested over the registry itself:
an update reads the store after the lock is held, an empty change writes
nothing, a lock whose process is gone or that nobody claimed is broken, one a
live process or another host holds never is, and four `bundles add` at once
all land (`packages/cli/test/store-lock.test.ts:1-4`, `:70-207`).

## Writing tests

Tests use `node:test` and `node:assert/strict` so the same file runs under both
runners (`packages/core/test/kernel-import-boundary.test.ts:10-13`;
`packages/cli/test/judge-property.test.ts:9-11`). Every test writes under
`os.tmpdir()`, never in the repository (`docs/architecture.md`, "Developing").
A test that spawns a verb that stamps a date sets `WIKIWRIGHT_TODAY`: spread
`PINNED_CLOCK` from `packages/cli/test/fixtures/clock.ts` (`:1-5`, today
`2026-09-04`) into the spawn's `env`, so no page carries the wall clock. A
test that connects a bundle points `WIKIWRIGHT_BUNDLES_FILE` at a registry
under its temporary directory, so the developer's registry is neither read
nor written
(`packages/cli/test/bundles.test.ts:65-71`).

For a bundle over the code kit, `packages/cli/test/fixtures/kit-code.ts`
carries the helpers: `installKit(root)` rewrites the bundle's `package.json`
to depend on the shipped package by absolute `file:` path and runs
`bun install`, then replaces every symlink with the bytes it points at so an
edit in the copy never writes through
(`packages/cli/test/fixtures/kit-code.ts:48-68`, `:34-46`); `kitEnv()` is
the spawn environment, the pinned clock (`:29-32`); `runKit(root, argv)`
spawns the built CLI with `--root` and parses the envelope, treating a
non-zero exit as a verdict rather than a failure (`:76-87`);
`installedCopy(source, prefix)` copies a bundle without its `node_modules`
and installs the kit, nothing else (`:89-103`). A bundle that carries a kit
by a declared `path` copies the neutral gardening kit,
`packages/cli/test/fixtures/kit-garden/`, to `kit/garden` in a bundle under
the temporary directory (`packages/cli/test/fixtures/kit-garden/index.js:1-9`). The judge's own behaviour tests load the memory law — a small
claims-bearing constitution that is test data, not a starter
(`packages/cli/test/fixtures/memory-law.ts:1-19`) — and core tests build a
law in memory through `constitutionOf` in
`packages/core/test/helpers/constitution.ts`, which fills in the document
envelope once so no fixture repeats it (`:1-5`, `:26-56`).

A verb that writes is driven twice, dry and real, and the plan's path set is
asserted equal to the real filesystem delta, and the bundles registry may not
move under a dry run; every case owns one, so no case reads or writes the
developer's (`packages/cli/test/dry-run.test.ts:1-13`, `:174-200`). The one
verb an installed copy does not refuse, `bundles`, is held, with the registry
placed outside the vault, to plan only absolute store paths; the exemption is
by verb (`:1034-1069`). The source scans read text: the import
graph and the vault-loading declaration check share one recognizer of
runtime import edges (`packages/cli/test/fixtures/imports.ts:1-27`), and
each scan says where it is defined what it cannot see; the one module
outside the Writer that writes a file of its own, the stdout file a git
child writes to, is declared there with its reason, as `artifacts.ts` is
for the export files it removes (`packages/cli/test/dry-run.test.ts:933-952`). A git
answer is tested by cutting it, not by trusting a parser to notice:
`packages/cli/test/git-short-read.test.ts` puts an `sh` launcher named `git`
first on PATH that runs the real git and prints one command's answer cut —
without its last byte, only its first line, without its last NUL record or
its last line, or empty — or fails it, and holds each verb that reads it to
`git-short-read`, `git-inconsistent-read` or the refusal the real run
gives; the engine hands git a file for its stdout, so what the launcher
prints is exactly what the engine reads. `packages/core/test/gitplan-batch.test.ts`
shows what a stream cut between records parses as when nothing checks it. A
case that reads a state asserts the pages the state holds before any
verdict read from it, since an empty or short state judges clean
(`packages/cli/test/judge-property.test.ts:131-144`). A property that must hold across
runtimes — the same fixture judged through every state constructor — lives in
a file both `test` and `test:node` glob
(`packages/cli/test/judge-property.test.ts:9-11`). Biome formats and lints
`packages/**`, `tools/**` and the root JSON files at line width 100
(`biome.json:9-16`).

## Relations

- part_of [[wikiwright-architecture]]
