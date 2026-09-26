---
type: subsystem
title: "The command runtime"
description: "One spec-driven registry of 24 verbs, the argv parser built from it, the envelope and exit taxonomy, the role bound, the `--bundle` scan of the skill directories, the read-only guard on a marked root, the bundle every vault envelope names, the one clock, and the place a loaded vault becomes the judge's law."
tags: [cli]
pin:
  commit: bb5c81cb574ea4115c6f384967ab4878cd52a9eb
  origin: .
  covers: [packages/cli/src/bin.ts, packages/cli/src/main.ts, packages/cli/src/argv.ts, packages/cli/src/commands.ts, packages/cli/src/envelope.ts, packages/cli/src/spec.ts, packages/cli/src/clock.ts, packages/cli/src/law.ts, packages/cli/src/pages.ts, packages/cli/src/paths.ts, packages/cli/src/buildinfo.ts, packages/cli/src/bundle.ts, packages/cli/src/discovery.ts, packages/cli/src/verbs/]
---

# The command runtime

## Responsibilities

`packages/cli/src/main.ts` is the entry point: `help` and no command print the
verb list (`:50-59`, `:345-346`); `--version` and `-v` reach the `version`
verb (`:298-300`, `:348`); an unknown command is refused with the valid set
(`:349-355`); the role is read from `WIKIWRIGHT_ROLE` and an unrecognised
value refuses rather than falling back (`:304-316`, `:357-363`); a verb above
the caller's rank is refused before `--help` and before parsing, with the
verbs the caller may run listed (`:318-341`, `:365-372`); `--help` prints the
spec's own row and is never a usage error (`:32-48`). `runCommand` parses
under the registry and resolves the target before anything else
(`:263-275`). `targetOf` resolves `--bundle` by the scan of the skill
directories, refusing `one-target` beside `--root`, a name outside the skill
grammar, a name the scan finds nowhere — with the directories searched and
the names it saw — and a name two different bundles answer, and otherwise
names the nearest copy and the copies it shadowed (`:133-204`).
`markedRootRefusal` checks the marker of every resolved root, however it was
named, for a verb that reads the vault's law or can write: a marker that is
not one is `export-marker-invalid`, before any module preloads, and a verb
that can write is `bundle-readonly`, `--dry-run` included, with a hint in the
words of the copy's contribution mode (`:207-261`; see [[exports]]). It then
preloads the modules `engine.json` declares for a verb that declares it reads
the vault's law — the shell's one asynchronous step — runs the verb, turns a
throw into `unexpected-error`, into `linked-outside-vault` when a vault read
met a path that resolves outside the vault, or into `git-short-read` or
`git-inconsistent-read` when a git answer ended before its terminator or two
git answers disagree ([[git]]) (`:97-120`, `:276-292`), and for a vault verb
attaches the bundle it read as `metadata.bundle`, with the copies `--bundle`
shadowed (`:68-84`, `:293-295`); `emit` writes one envelope to stdout, the
verb's UX text to stderr and sets the exit code (`:25-30`).
`packages/cli/src/bundle.ts` computes that block without loading anything —
label, real root, head and dirty from one `git status`, the law digest over
the config and each installed module's digest — an export passes the digest
of the kit bytes it carries instead — the content digest over every
page's bytes (`:42-59`, `:76-80`, `:156-202`); over a copy, a root that
carries a marker, the label is the bundle the marker names, `head` and
`dirty` are null, and `export` names the export, `intact: false` when the
recomputed digests differ from the marker's (`:137-140`, `:173-192`).
`packages/cli/src/discovery.ts` is the scan: the skill directories in the
order a name resolves in — the project's `.claude/skills` and
`.agents/skills` from the working directory up to the top of its repository,
the user's, the machine's (`WIKIWRIGHT_SYSTEM_SKILL_DIR`, `/etc/codex/skills`
when unset, none when empty), then `WIKIWRIGHT_SKILL_DIRS` (`:46-102`) — a
directory a candidate
when its marker parses and names it and skipped with its reason otherwise
(`:113-146`), one candidate per real path (`:149-173`), identity by the
marker's repository, bundle and name, a copy with no repository alone
(`:204-209`), and a name resolved to one identity's nearest copy or refused
as ambiguous (`:221-238`); `bundles list` walks the same directories
(`:176-201`; `packages/cli/src/verbs/bundles.ts:71-116`).

`packages/cli/src/commands.ts` is the registry, the `COMMANDS` array and
nothing else, one module per verb under `verbs/` (`:2-6`, `:33-58`).
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
and `brief` takes as its default role (`packages/cli/src/spec.ts:120-129`)
everywhere but a copy, whose brief is always the consumer's. `packages/cli/src/argv.ts` builds `parseArgs` options from the
same list and refuses an unknown flag with the valid flags, extra positionals,
a missing or unknown subcommand, each with the legal domain in `details`
(`:68-150`); `scanInvocation` finds `--help` without reading a string flag's
value as one (`:35-61`). `packages/cli/src/envelope.ts` fixes the exit table
(`:8-20`), the engine version (`:24`), the shape of `metadata.bundle`,
a copy's `export` and the copies `--bundle` shadowed included (`:26-64`), the `ok` and `fail` constructors (`:101-125`), the verdict block
every judging verb prints (`:127-139`) and the cap flags read once
(`:141-160`).

`packages/cli/src/law.ts` is where a loaded vault becomes the judge's second
argument: `lawFor` (`:63-84`) carries the registry, the module set the loader
validated under, the lint options and the policy keys; `rootsOf`,
`lintOptionsFor`, `generateOptionsFor`, `moveReasonsOf` and `checkEnginePin`
(`:20-61`, `:86-118`) are the named readers of the policy keys, and
`exportPlans` and `pluginManifests` read `exports` and `plugin` (see
[[exports]]): one reader named per `engine.json` key
(`packages/core/src/registry/engine.ts:421-449`). `packages/cli/src/clock.ts`
is the shell's one clock: `today()` reads `WIKIWRIGHT_TODAY` or the wall
clock once per process, and nothing the judge does reads it (`:1-4`,
`:11-22`). `packages/cli/src/pages.ts` holds the page-shaped helpers verbs
share — `collectPages`, `sortFindings`, `sectionLines`, `skeletonOf`,
`summarize`, `templateFindings` (`:32`, `:38`, `:76`, `:167`, `:187`,
`:215`). `packages/cli/src/paths.ts` is the containment half of the path law:
`vaultReadAbsolute` and `vaultAbsolute` resolve through every link and refuse
a path outside the vault as `LinkedOutsideVault`, resolving each vault root's
real path once per process and a page's on every read (`:12-26`, `:39-100`), and
`contentPathRefusal` is the one question an agent-facing verb asks about a
path it was handed (`:102-130`).
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
- `COMMANDS` (`packages/cli/src/commands.ts:33`) — `brief`, `bundles`,
  `check`, `export`, `freshness`, `gate`, `graph`, `hook`, `init`, `fix`, `lint`,
  `modules`, `move`, `new`, `okf`, `read`, `retire`, `schema`, `search`,
  `skills`, `type`, `version`, `vocabulary`, `write` — each exporting
  its `CommandSpec` with `run` and, when it writes, `plan`.
- `parseInvocation`, `scanInvocation` (`packages/cli/src/argv.ts:68`, `:41`);
  `ok`, `fail`, `verdictEnvelope`, `capOptions`
  (`packages/cli/src/envelope.ts`); `lawFor` (`packages/cli/src/law.ts:68`);
  `today` (`packages/cli/src/clock.ts:11`).

## State

Per process: the clock's one read (`packages/cli/src/clock.ts:8-9`), the
module preload cache (`packages/cli/src/moduleload.ts:624`) and each vault
root's real path (`packages/cli/src/paths.ts:18`). Nothing of a vault between
processes; between them Node keeps its compile cache of the engine's
JavaScript, which `bin.ts` switches on and `NODE_DISABLE_COMPILE_CACHE=1`
turns off.

## Invariants

- One envelope on stdout, UX on stderr, one writer each
  (`packages/cli/src/main.ts:25-30`); every `fail(` uses a kebab-case code
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
  `packages/cli/src/main.ts:285-288`;
  `packages/cli/test/module-loading.test.ts:1-6`).
- The role bound is a rank comparison, `consumer ⊂ writer ⊂ maintainer`, and
  a bounded caller cannot learn the shape of a verb it may not run
  (`packages/cli/src/spec.ts:109-118`; `packages/cli/src/main.ts:365-372`).
- Every envelope of a verb that reads a vault's law names the bundle it read
  when the root holds a constitution, ok or refused; an envelope answered
  before the verb runs names none (`packages/cli/src/main.ts:68-84`,
  `:293-295`); over a copy it names the export the copy is, from its marker
  (`packages/cli/src/bundle.ts:173-192`).
- A copy is read only however it is named: the marker is checked on every
  resolved root before any module preloads, and a verb that can write is
  refused over it (`packages/cli/src/main.ts:233-261`, `:274-275`).
- Discovery reads markers only: a name is resolved by one `stat` per probed
  directory and one marker read per candidate, never a page, and nothing
  registers a bundle (`packages/cli/src/discovery.ts:1-7`, `:149-173`).
- The shell has one clock and the judge never reads a date it computed
  (`packages/cli/src/clock.ts:1-4`); a malformed `WIKIWRIGHT_TODAY` refuses
  before anything moves (`:18-20`).
- Every content read and write is contained: shape from the kernel,
  containment through `realpath` in the shell, at every read and write
  (`packages/cli/src/paths.ts:1-7`, `:71-80`).

## Failure modes

- `unknown-command`, `role-unknown`, `role-forbidden`
  (`packages/cli/src/main.ts:349-372`, `:318-341`); `unknown-flag`,
  `invalid-arguments`, `unexpected-argument`, `missing-argument`,
  `unknown-subcommand` (`packages/cli/src/argv.ts:92-151`).
- `invalid-value` when a `--set` value is not the JSON its field's kind takes
  (`packages/cli/src/verbs/new.ts:127-148`); `draft-invalid` at exit 5 with
  `pages` and `preview` (`packages/cli/src/verbs/write.ts:566-588`);
  `directory-not-found` at exit 3 with `details.resolved` (`:874-882`).
- `one-target`, `bundle-name-invalid`, `bundle-ambiguous` (exit 2) and
  `bundle-not-found` (exit 3), each before anything runs
  (`packages/cli/src/main.ts:133-204`); `export-marker-invalid` at exit 4
  when a root's `config/export.json` is not a marker, and `bundle-readonly`
  at exit 2 for a verb that can write over a copy, each before any module
  preloads (`:233-261`); `git-short-read` at exit 1 with
  `details.command` when a git answer was cut short, `git-inconsistent-read`
  at exit 1 with `details.commands` when two git answers disagree, and
  `unexpected-error`
  at exit 1 when a verb throws anything else, and `linked-outside-vault` at
  exit 4 when a read met a path that resolves outside the vault, a config
  linked out of it included (`:97-120`).
- `engine-pin-mismatch` when the running engine falls outside the bundle's
  declared range (`packages/cli/src/law.ts:100-118`).
- A path that escapes the vault throws in the shell's resolvers and is refused
  by name — without saying what resolved where — in an agent-facing verb
  (`packages/cli/src/paths.ts:32-37`, `:123-128`).

## Relations

- part-of [[wikiwright-architecture]]
- mapped-in [[repository-layout]]
- verified-by [[testing-guide]]
