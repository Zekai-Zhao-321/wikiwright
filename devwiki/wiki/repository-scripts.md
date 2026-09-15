---
type: ops-reference
title: "Repository scripts"
description: "The package.json scripts, the development gate, the release matrix run by hand, the tools that generate what nothing hand-edits, and the CLI reference renderer."
tags: [repo]
pin: a38be783d7393d145ba7950daf1b0ca2c1c4fbad
origin: .
covers: [package.json, scripts/, tools/, docs/render-cli.ts, tsconfig.test.json, biome.json, .github/]
---

# Repository scripts

## Reference

| Script | Runs | Notes |
| --- | --- | --- |
| `bun run build` | `tsc -b && bun tools/write-build-info.ts` | the compiler owns `dist/`; the stamp lands after it (`package.json:20`; `tools/write-build-info.ts:6-9`) |
| `bun run clean` | `tsc -b --clean` | `package.json:21` |
| `bun run test` | `bun run build && bun tools/run-suite.ts` | the suite, one `bun test` process per file (`package.json:22`) |
| `bun run test:node` | the build, then `node --test` over `packages/core/test/*.test.ts` and `packages/cli/test/*.test.ts` | the cross-runtime half of the gate (`package.json:23`) |
| `bun run typecheck` | the build, then `tsc -p tsconfig.test.json` | the tests and `tools/` typecheck without emitting (`package.json:24`; `tsconfig.test.json:3-9`) |
| `bun run lint` | `biome check .` | over `packages/**`, `tools/**` and the root JSON, line width 100 (`package.json:25`; `biome.json:9-16`) |
| `bun run check` | `biome check . && bun run build && tsc -p tsconfig.test.json && bun tools/run-suite.ts` | the gate (`package.json:26`) |

Engines: Node `>=22.12.0`, Bun `>=1.3.11` (`package.json:15-18`); workspaces
`packages/*` and `devwiki` (`package.json:11-14`).

| Script | Purpose |
| --- | --- |
| `scripts/hooks/pre-commit` | the development gate: `bun run check` in a git environment with the hook's `GIT_*` exports unset; skipped, and says so, when `bun` is absent (`:17-38`). Enable with `git config core.hooksPath scripts/hooks` (`:8-9`) |
| `scripts/release-matrix.sh` | six arms, PASS or FAIL each, exit non-zero on any failure: the gate, the node runner, a pack of both packages, one corpus linted under both runtimes and diffed, a clean build from no `dist/`, the corpus verdicts (`:41-94`); nothing invokes it and it does not cover Windows or another operating system (`:16-19`, `:100`) |
| `tools/write-build-info.ts` | writes `dist/build-info.json` under `packages/cli/` — the commit the binary was built from, no timestamp — after `tsc -b` (`:1-9`) |
| `tools/render-playbook.ts` | renders `packages/cli/skills/wikiwright-maintain/lint-response.md` from the composed pass table and the fixer registry; `--check` compares (`:1-7`) |
| `tools/generate-casefold.ts` | regenerates `packages/core/src/identity/casefold-data.ts` from the vendored Unicode `CaseFolding.txt`, statuses C and F (`:1-3`) |
| `tools/uncovered.ts` | lists, per source root (default every package's `src`), the top-level directories no page's `covers` reaches; `--vault` and a repeatable `--root` (`:8-13`); a report, never a gate |
| `tools/run-suite.ts` | the suite as one `bun test` process per file, as many at once as the machine has cores, the largest file first (`:1-15`); each file has a 20-second budget per test and per hook, four times Bun's default, because a file under that load takes about 2.4 times as long as alone (`:60-67`); each argument is passed as `./<file>`, since a bare path is a substring filter to `bun test` (`:76-77`); a file passes only when its process exits 0 and reports a test, and the run exits 1 when any file does not, printing that file's output (`:92`) |
| `tools/benchmark-check.ts` | times `check`, `check --write` and `lint --staged` in fresh processes over synthetic vaults of 1,000, 5,000 and 10,000 pages, optionally against a baseline build, and fails unless every envelope and generated file is identical (`:1-2`, `:11-21`) |
| `docs/render-cli.ts` | renders the verb reference in `docs/cli.md` from `wikiwright schema`; `--write` replaces the block between the markers, `--check` exits 1 when the document is behind the binary (`:1-7`) |
| `.github/workflows/check.yml` | on every push and pull request, on `ubuntu-latest` and `macos-latest`: `bun install --frozen-lockfile`, `bun run check`, `bun run test:node` (`:1-25`) |

Generated files and their one generator, none hand-edited:
`devwiki/generated/*`, the brief included, from
`wikiwright check --write --root devwiki`; the playbook from
`bun tools/render-playbook.ts`; `docs/cli.md`'s verb block from
`bun docs/render-cli.ts --write`; the case-fold table from
`bun tools/generate-casefold.ts` (`docs/architecture.md`, "Developing").

## Relations

- part_of [[wikiwright-architecture]]
- mapped_in [[repository-layout]]
