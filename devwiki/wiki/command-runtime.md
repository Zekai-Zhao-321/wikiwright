---
type: subsystem
title: "The command runtime"
description: "One spec-driven registry of 24 verbs, the argv parser built from it, the envelope and exit taxonomy, the role bound, the `--bundle` target and the bundle every vault envelope names, the one clock, and the place a loaded vault becomes the judge's law."
tags: [cli]
pin: 57fba48133394eca1793e1374b4054d6b2b8eb1c
origin: .
covers: [packages/cli/src/bin.ts, packages/cli/src/main.ts, packages/cli/src/argv.ts, packages/cli/src/commands.ts, packages/cli/src/envelope.ts, packages/cli/src/spec.ts, packages/cli/src/clock.ts, packages/cli/src/law.ts, packages/cli/src/pages.ts, packages/cli/src/paths.ts, packages/cli/src/buildinfo.ts, packages/cli/src/bundle.ts, packages/cli/src/connections.ts, packages/cli/src/storelock.ts, packages/cli/src/verbs/]
---

# The command runtime

## Responsibilities

`packages/cli/src/main.ts` is the entry point: `help` and no command print the
verb list (`:48-57`, `:258-259`); `--version` and `-v` reach the `version`
verb (`:211-213`, `:261`); an unknown command is refused with the valid set
(`:262-268`); the role is read from `WIKIWRIGHT_ROLE` and an unrecognised
value refuses rather than falling back (`:217-229`, `:270-276`); a verb above
the caller's rank is refused before `--help` and before parsing, with the
verbs the caller may run listed (`:231-254`, `:278-285`); `--help` prints the
spec's own row and is never a usage error (`:30-46`). `runCommand` parses
under the registry and resolves `--bundle` to the connection's root before
anything else, refusing `one-target` beside `--root`, a name no connection
carries, and a writing verb aimed at an installed copy unless its write is
this machine's own registry (`:127-176`, `:178-188`); it preloads the modules
`engine.json` declares for a verb that declares it reads the vault's law —
the shell's one asynchronous step — runs the verb, turns a throw into
`unexpected-error`, into `git-short-read` or `git-inconsistent-read` when a
git answer ended before its terminator or two git answers disagree
([[git]]), or into the store's own refusal when a machine-local
store does not parse (`:80-111`, `:189-205`), and for a vault verb attaches
the bundle it read as `metadata.bundle` (`:59-76`, `:206-208`); `emit` writes
one envelope to stdout, the verb's UX text to stderr and sets the exit code
(`:23-28`). `packages/cli/src/bundle.ts` computes that block without loading
anything — label, real root, head and dirty from one `git status`, the law
digest over the config and each installed module's digest, the content digest
over every page's bytes (`:38-53`, `:70-75`, `:111-140`) — and
`packages/cli/src/connections.ts` is the registry `--bundle` reads, at the
path its override names made absolute (`:46-55`), which refuses as
malformed a record whose root is not an absolute path rather than resolving
it against the working directory, and two records with one name or one real
root rather than answering with the first (`:66-93`, `:95-149`), beside
`MACHINE_LOCAL_WRITERS`, the one verb an installed copy answers — an
exemption by verb, not by where the store lies (`:154-164`). The registry is
read, changed and written as one operation (`:172-187`) under the lock every
machine-local store takes, `packages/cli/src/storelock.ts`: the store is read
after the lock is held, so two writes at once keep each other's record; the
lock names the process and the host that hold it and is broken only when
that process is gone from this machine, never because it is old, and one that
does not clear is `StoreBusy`, which `bundles` answers as `store-busy`
(`:114-162`, `:177-198`).

`packages/cli/src/commands.ts` is the registry, the `COMMANDS` array and
nothing else, one module per verb under `verbs/` (`:2-6`, `:32-56`).
`packages/cli/src/spec.ts` is the vocabulary they share: `CommandSpec` with a
required `writes`, a required `needsVaultModules` and a `plan` for every
writing verb (`:131-175`), the global flags `--root`, `--bundle` and `--help`
(`:28-48`), the `CommandArgs` that carries the registry the invocation ran
under, so a verb renders the verb list without importing the array that
imports it (`:55-66`), `flagsOf` rendering `--dry-run` from the registry for a
writing verb (`:177-191`), `isDryRun` and `listFlag` as the one reader each
(`:68-73`, `:193-196`), the closed `PlanOp` kinds and `planOf` (`:75-107`),
`ROLE_RANK` — consumer, writer, maintainer (`:109-118`) — and `declaredRole`,
the one reader of `WIKIWRIGHT_ROLE`, which `main.ts` bounds the surface by
and `brief` takes as its default role (`packages/cli/src/spec.ts:120-129`). `packages/cli/src/argv.ts` builds `parseArgs` options from the
same list and refuses an unknown flag with the valid flags, extra positionals,
a missing or unknown subcommand, each with the legal domain in `details`
(`:68-150`); `scanInvocation` finds `--help` without reading a string flag's
value as one (`:35-61`). `packages/cli/src/envelope.ts` fixes the exit table
(`:8-20`), the engine version (`:24`), the shape of `metadata.bundle`
(`:26-50`), the `ok` and `fail` constructors (`:81-105`), the verdict block
every judging verb prints (`:107-119`) and the cap flags read once
(`:121-140`).

`packages/cli/src/law.ts` is where a loaded vault becomes the judge's second
argument: `lawFor` (`:63-84`) carries the registry, the module set the loader
validated under, the lint options and the policy keys; `rootsOf`,
`lintOptionsFor`, `generateOptionsFor`, `moveReasonsOf` and `checkEnginePin`
(`:20-61`, `:86-118`) are the named readers of every `engine.json` key
(`packages/core/src/registry/engine.ts:133-156`). `packages/cli/src/clock.ts`
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
demoted (`:1-6`, `:30-43`, `:50-61`).

Two write verbs carry the runtime's typing of a value and its refusals.
`new --set field=value` types the value by the field's shape — text for a
string-valued kind, JSON for a list, a number, a boolean or an object — and
`tags` is a list whatever the shape table says, so `--set tags='["kernel",
"cli"]'` lands the list after the folder tags seeded from the destination,
while a bare word is `invalid-value` with the JSON spelling in the hint
(`packages/cli/src/verbs/new.ts:119-149`, `:347-351`, `:375`). Where the
bundle derives the title from the basename and the title given is the
basename, `new` writes no `title:` line, since it would only repeat the
name; any other title is kept (`:355-363`). A refused
draft reads like a dry run that failed: `new`'s skeleton and a `write --from`
batch are judged in one state and refused as `draft-invalid` with `pages`
rows — each draft's findings, dispositions, digest and `preview` — beside the
flat findings, `preview` at the top level for a single draft and `failing`
for a batch (`packages/cli/src/verbs/write.ts:558-588`); an accepted dry run
carries the same rows (`:694-699`), and the real `--from` run answers with
the dry run's `ops`, built from the drafts it judged, beside `wrote: true`
(`:689-714`). `--from` is resolved against `--root`,
and `directory-not-found` names the directory it looked in as
`details.resolved` (`:870-882`).

## Entry points

- `dist/bin.js` under `packages/cli/`, the `wikiwright` executable: it
  switches on Node's compile cache for the engine's own JavaScript and then
  loads `dist/main.js`, the engine's entry, which also runs directly
  (`packages/cli/src/bin.ts:1-14`; `docs/architecture.md`, "Developing").
- `COMMANDS` (`packages/cli/src/commands.ts:32`) — `brief`, `bundles`,
  `check`, `freshness`, `gate`, `graph`, `hook`, `init`, `fix`, `lint`,
  `modules`, `move`, `new`, `okf`, `read`, `retire`, `schema`, `search`,
  `skills`, `type`, `version`, `vocabulary`, `write` — each exporting
  its `CommandSpec` with `run` and, when it writes, `plan`.
- `parseInvocation`, `scanInvocation` (`packages/cli/src/argv.ts:68`, `:41`);
  `ok`, `fail`, `verdictEnvelope`, `capOptions`
  (`packages/cli/src/envelope.ts`); `lawFor` (`packages/cli/src/law.ts:68`);
  `today` (`packages/cli/src/clock.ts:11`).

## State

Per process: the clock's one read (`packages/cli/src/clock.ts:8-9`), the
module preload cache (`packages/cli/src/moduleload.ts:593`) and each vault
root's real path (`packages/cli/src/paths.ts:18`). Nothing of a vault between
processes; between them Node keeps its compile cache of the engine's
JavaScript, which `bin.ts` switches on and `NODE_DISABLE_COMPILE_CACHE=1`
turns off.

## Invariants

- One envelope on stdout, UX on stderr, one writer each
  (`packages/cli/src/main.ts:23-28`); every `fail(` uses a kebab-case code
  mapped to exactly one exit type (`packages/cli/src/envelope.ts:1-2`,
  `:8-20`), and a usage error and a constitution error share exit 2 with
  different types (`:12-15`).
- The registry is the only surface: `--help`, `schema`, the brief and the
  parser render one table (`packages/cli/src/spec.ts:1-5`, `:177-191`), and
  the dry-run flag is rendered, never declared by a verb (`:183-191`).
- A verb declares whether it writes, and a writing verb answers `--dry-run`
  with exactly the plan it would apply, and the pair is one union, so a
  writing verb without a plan does not compile (`:166-175`); the meta-test
  scans each verb module for reachable writes (`:145-151`).
- A verb declares whether it reads the vault's law, and only one that does
  makes the entry point preload a bundle's modules; the meta-test holds each
  declaration against what that verb's imports reach, the registry's own edge
  excluded (`packages/cli/src/spec.ts:152-162`;
  `packages/cli/src/main.ts:198-201`;
  `packages/cli/test/module-loading.test.ts:1-6`).
- The role bound is a rank comparison, `consumer ⊂ writer ⊂ maintainer`, and
  a bounded caller cannot learn the shape of a verb it may not run
  (`packages/cli/src/spec.ts:109-118`; `packages/cli/src/main.ts:278-285`).
- Every envelope of a verb that reads a vault's law names the bundle it read
  when the root holds a constitution, ok or refused; an envelope answered
  before the verb runs names none (`packages/cli/src/main.ts:59-76`,
  `:206-208`).
- The shell has one clock and the judge never reads a date it computed
  (`packages/cli/src/clock.ts:1-4`); a malformed `WIKIWRIGHT_TODAY` refuses
  before anything moves (`:18-20`).
- Every content read and write is contained: shape from the kernel,
  containment through `realpath` in the shell, at every read and write
  (`packages/cli/src/paths.ts:1-7`, `:54-63`).

## Failure modes

- `unknown-command`, `role-unknown`, `role-forbidden`
  (`packages/cli/src/main.ts:262-285`, `:231-254`); `unknown-flag`,
  `invalid-arguments`, `unexpected-argument`, `missing-argument`,
  `unknown-subcommand` (`packages/cli/src/argv.ts:92-151`).
- `invalid-value` when a `--set` value is not the JSON its field's kind takes
  (`packages/cli/src/verbs/new.ts:127-148`); `draft-invalid` at exit 5 with
  `pages` and `preview` (`packages/cli/src/verbs/write.ts:566-588`);
  `directory-not-found` at exit 3 with `details.resolved` (`:874-882`).
- `one-target`, `bundle-not-found` and `bundle-readonly`, each before
  anything runs (`packages/cli/src/main.ts:127-176`);
  `bundles-registry-malformed` at exit 4 when the machine-local registry does
  not parse, `git-short-read` at exit 1 with
  `details.command` when a git answer was cut short, `git-inconsistent-read`
  at exit 1 with `details.commands` when two git answers disagree, and
  `unexpected-error`
  at exit 1 when a verb throws anything else (`:80-111`).
- `engine-pin-mismatch` when the running engine falls outside the bundle's
  declared range (`packages/cli/src/law.ts:100-118`).
- A path that escapes the vault throws in the shell's resolvers and is refused
  by name — without saying what resolved where — in an agent-facing verb
  (`packages/cli/src/paths.ts:32-37`, `:106-111`).

## Relations

- part_of [[wikiwright-architecture]]
- mapped_in [[repository-layout]]
- verified_by [[testing-guide]]
