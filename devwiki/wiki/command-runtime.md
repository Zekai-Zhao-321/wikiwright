---
type: subsystem
title: "The command runtime"
description: "One spec-driven registry of 22 verbs, the argv parser built from it, the envelope and exit taxonomy, the role bound, the one clock, and the place a loaded vault becomes the judge's law."
tags: [cli]
pin: a38be783d7393d145ba7950daf1b0ca2c1c4fbad
origin: .
covers: [packages/cli/src/bin.ts, packages/cli/src/main.ts, packages/cli/src/argv.ts, packages/cli/src/commands.ts, packages/cli/src/envelope.ts, packages/cli/src/spec.ts, packages/cli/src/clock.ts, packages/cli/src/law.ts, packages/cli/src/pages.ts, packages/cli/src/paths.ts, packages/cli/src/buildinfo.ts, packages/cli/src/verbs/]
---

# The command runtime

## Responsibilities

`packages/cli/src/main.ts` is the entry point: `help` and no command print the
verb list (`:35-44`, `:119-120`); `--version` and `-v` reach the `version`
verb (`:72-74`, `:122`); an unknown command is refused with the valid set
(`:123-129`); the role is read from `WIKIWRIGHT_ROLE` and an unrecognised
value refuses rather than falling back (`:78-90`, `:131-137`); a verb above
the caller's rank is refused before `--help` and before parsing, with the
verbs the caller may run listed (`:92-115`, `:139-146`); `--help` prints the
spec's own row and is never a usage error (`:17-33`); `runCommand` parses
under the registry, preloads the modules `engine.json` declares for a verb
that declares it reads the vault's law — the shell's one asynchronous step —
runs the verb and turns a throw into `unexpected-error` (`:46-70`, `:55-60`); `emit` writes one envelope to stdout, the
verb's UX text to stderr and sets the exit code (`:10-15`).

`packages/cli/src/commands.ts` is the registry, the `COMMANDS` array and
nothing else, one module per verb under `verbs/` (`:2-6`, `:31-54`).
`packages/cli/src/spec.ts` is the vocabulary they share: `CommandSpec` with a
required `writes`, a required `needsVaultModules` and a `plan` for every
writing verb (`:104-140`), the
global flags `--root` and `--help` (`:28-39`), the `CommandArgs` that carries
the registry the invocation ran under, so a verb renders the verb list without
importing the array that imports it (`:46-57`), `flagsOf` rendering `--dry-run`
from the registry for a writing verb (`:157-171`), `isDryRun` and `listFlag`
as the one reader each (`:59-64`, `:173-176`), the closed `PlanOp` kinds and
`planOf` (`:66-98`), and `ROLE_RANK` — consumer, writer, maintainer
(`:100-109`). `packages/cli/src/argv.ts` builds `parseArgs` options from the
same list and refuses an unknown flag with the valid flags, extra positionals,
a missing or unknown subcommand, each with the legal domain in `details`
(`:68-150`); `scanInvocation` finds `--help` without reading a string flag's
value as one (`:35-61`). `packages/cli/src/envelope.ts` fixes the exit table
(`:8-20`), the engine version (`:24`), the `ok` and `fail` constructors
(`:60-84`), the verdict block every judging verb prints (`:87-98`) and the cap
flags read once (`:101-119`).

`packages/cli/src/law.ts` is where a loaded vault becomes the judge's second
argument: `lawFor` (`:63-84`) carries the registry, the module set the loader
validated under, the lint options and the policy keys; `rootsOf`,
`lintOptionsFor`, `generateOptionsFor`, `moveReasonsOf` and `checkEnginePin`
(`:20-61`, `:86-118`) are the named readers of every `engine.json` key
(`packages/core/src/registry/engine.ts:115-138`). `packages/cli/src/clock.ts`
is the shell's one clock: `today()` reads `WIKIWRIGHT_TODAY` or the wall
clock once per process, and nothing the judge does reads it (`:1-4`,
`:11-22`). `packages/cli/src/pages.ts` holds the page-shaped helpers verbs
share — `collectPages`, `sortFindings`, `sectionLines`, `skeletonOf`,
`summarize`, `templateFindings` (`:32`, `:38`, `:76`, `:167`, `:187`,
`:215`). `packages/cli/src/paths.ts` is the containment half of the path law:
`vaultReadAbsolute` and `vaultAbsolute` resolve through every link and refuse
a path outside the vault, resolving each vault root's real path once per
process and a page's on every read (`:12-26`, `:39-83`), and
`contentPathRefusal` is the one question an agent-facing verb asks about a
path it was handed (`:85-113`).
`packages/cli/src/buildinfo.ts` answers which code is running: the build
stamp beside the emitted JavaScript, and the checkout the package sits in,
demoted (`:1-6`, `:29-42`, `:49-60`).

Two write verbs carry the runtime's typing of a value and its refusals.
`new --set field=value` types the value by the field's shape — text for a
string-valued kind, JSON for a list, a number, a boolean or an object — and
`tags` is a list whatever the shape table says, so `--set tags='["kernel",
"cli"]'` lands the list after the folder tags seeded from the destination,
while a bare word is `invalid-value` with the JSON spelling in the hint
(`packages/cli/src/verbs/new.ts:118-148`, `:346-350`, `:366`). A refused
draft reads like a dry run that failed: `new`'s skeleton and a `write --from`
batch are judged in one state and refused as `draft-invalid` with `pages`
rows — each draft's findings, dispositions, digest and `preview` — beside the
flat findings, `preview` at the top level for a single draft and `failing`
for a batch (`packages/cli/src/verbs/write.ts:555-585`); an accepted dry run
carries the same rows (`:674-679`). `--from` is resolved against `--root`,
and `directory-not-found` names the directory it looked in as
`details.resolved` (`:845-857`).

## Entry points

- `dist/bin.js` under `packages/cli/`, the `wikiwright` executable: it
  switches on Node's compile cache for the engine's own JavaScript and then
  loads `dist/main.js`, the engine's entry, which also runs directly
  (`packages/cli/src/bin.ts:1-14`; `docs/architecture.md`, "Developing").
- `COMMANDS` (`packages/cli/src/commands.ts:31`) — `brief`, `check`,
  `freshness`, `gate`, `graph`, `hook`, `init`, `fix`, `lint`, `modules`,
  `move`, `new`, `okf`, `retire`, `schema`, `search`, `skills`, `trust`,
  `type`, `version`, `vocabulary`, `write` — each exporting its
  `CommandSpec` with `run` and, when it writes, `plan`.
- `parseInvocation`, `scanInvocation` (`packages/cli/src/argv.ts:68`, `:41`);
  `ok`, `fail`, `verdictEnvelope`, `capOptions`
  (`packages/cli/src/envelope.ts`); `lawFor` (`packages/cli/src/law.ts:68`);
  `today` (`packages/cli/src/clock.ts:11`).

## State

Per process: the clock's one read (`packages/cli/src/clock.ts:8-9`), the
module preload cache (`packages/cli/src/moduleload.ts:522`), each vault
root's real path (`packages/cli/src/paths.ts:18`) and each vault root's
worktree scope for a trust grant, read from git at most once
(`packages/cli/src/trust.ts:386-407`). Nothing of a vault between
processes; between them Node keeps its compile cache of the engine's
JavaScript, which `bin.ts` switches on and `NODE_DISABLE_COMPILE_CACHE=1`
turns off.

## Invariants

- One envelope on stdout, UX on stderr, one writer each
  (`packages/cli/src/main.ts:10-15`); every `fail(` uses a kebab-case code
  mapped to exactly one exit type (`packages/cli/src/envelope.ts:1-2`,
  `:8-20`), and a usage error and a constitution error share exit 2 with
  different types (`:12-15`).
- The registry is the only surface: `--help`, `schema`, the brief and the
  parser render one table (`packages/cli/src/spec.ts:1-5`, `:157-171`), and
  the dry-run flag is rendered, never declared by a verb (`:163-171`).
- A verb declares whether it writes, and a writing verb answers `--dry-run`
  with exactly the plan it would apply, and the pair is one union, so a
  writing verb without a plan does not compile (`:144-155`); the meta-test
  scans each
  verb module for reachable writes (`:128-131`).
- A verb declares whether it reads the vault's law, and only one that does
  makes the entry point preload a bundle's modules; the meta-test holds each
  declaration against what that verb's imports reach, the registry's own edge
  excluded (`packages/cli/src/spec.ts:132-142`;
  `packages/cli/src/main.ts:55-60`;
  `packages/cli/test/module-loading.test.ts:1-6`).
- The role bound is a rank comparison, `consumer ⊂ writer ⊂ maintainer`, and
  a bounded caller cannot learn the shape of a verb it may not run
  (`:93-102`; `packages/cli/src/main.ts:139-142`).
- The shell has one clock and the judge never reads a date it computed
  (`packages/cli/src/clock.ts:1-4`); a malformed `WIKIWRIGHT_TODAY` refuses
  before anything moves (`:18-20`).
- Every content read and write is contained: shape from the kernel,
  containment through `realpath` in the shell, at every read and write
  (`packages/cli/src/paths.ts:1-7`, `:54-63`).

## Failure modes

- `unknown-command`, `role-unknown`, `role-forbidden`
  (`packages/cli/src/main.ts:123-146`, `:98-115`); `unknown-flag`,
  `invalid-arguments`, `unexpected-argument`, `missing-argument`,
  `unknown-subcommand` (`packages/cli/src/argv.ts:92-151`).
- `invalid-value` when a `--set` value is not the JSON its field's kind takes
  (`packages/cli/src/verbs/new.ts:126-147`); `draft-invalid` at exit 5 with
  `pages` and `preview` (`packages/cli/src/verbs/write.ts:563-585`);
  `directory-not-found` at exit 3 with `details.resolved` (`:849-857`).
- `unexpected-error` at exit 1 when a verb throws (`packages/cli/src/main.ts:62-69`).
- `engine-pin-mismatch` when the running engine falls outside the bundle's
  declared range (`packages/cli/src/law.ts:100-118`).
- A path that escapes the vault throws in the shell's resolvers and is refused
  by name — without saying what resolved where — in an agent-facing verb
  (`packages/cli/src/paths.ts:32-37`, `:106-111`).

## Relations

- part_of [[wikiwright-architecture]]
- mapped_in [[repository-layout]]
- verified_by [[testing-guide]]
