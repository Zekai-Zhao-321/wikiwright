---
type: subsystem
title: "The Writer and the staged gate"
description: "The splice-only Writer in core, the shell that proves a splice with a second judge and lands it temp-then-rename, the four state constructors, and the staged gate the hooks run."
tags: [kernel, cli]
pin: ee2b6fbbab3479b768b67601d3ccb86a041f25c4
origin: .
covers: [packages/core/src/writer/, packages/core/src/gitplan/, packages/core/src/prefixes/, packages/cli/src/writer.ts, packages/cli/src/atomicwrite.ts, packages/cli/src/staged.ts, packages/cli/src/stagedkits.ts, packages/cli/src/state.ts, packages/cli/src/hooks.ts, packages/cli/src/verbs/write.ts, packages/cli/src/verbs/gate.ts]
---

# The Writer and the staged gate

## Responsibilities

The core Writer (`packages/core/src/writer/index.ts`) applies a closed set of
five ops — `insert`, `replace`, `append-section`, `frontmatter-list`,
`frontmatter-set` (`:13-32`) — to a page's bytes in one pass and reports the
output ranges it touched and the input ranges it consumed (`:407-454`).
`sectionTail` (`:111`) finds the one line an `append-section` inserts after,
by a heading scan that needs no registry (`:77-82`); `yamlScalar` (`:161`) is
the one rendering of a string into YAML, shared with `new --set`; and the
page's envelope — BOM, line ending, trailing newline — is read once and
restored (`:50-62`, `:452-453`).

The shell half (`packages/cli/src/writer.ts`) proves and lands. `proveWrites`
(`:58`) puts every replaced page back into the same state, judges the whole
vault once more under the same law, and requires that the finding an op
addressed is gone and no page gained an error (`:48-57`, `:73-96`).
`commitWrites` (`:125`) writes each page into an exclusively created temp file
beside it and renames all of them only when every temp file is complete
(`:116-123`, `packages/cli/src/atomicwrite.ts:67-98`); every content write in the engine
goes through it (`packages/cli/src/writer.ts:1-5`). `packages/cli/src/state.ts` holds the four constructors: `fsState`
(`:34`) the working tree with no base; `indexState` (`:93`) over one
`indexSnapshot` — the staged diff and the index listing, read once although
the gate builds the state twice (`:49-81`) — every staged page and
every HEAD base it is judged against in one read by blob id
(`:109-139`, [[git]]), `null` for a new page, base-only entries for
deletions, and the rename list (`:150-175`); `overlayState` (`:189`)
the vault with one or more drafts in place of their pages, each based on the
disk bytes; `revisionState` (`:300`) one commit's tree against its first
parent, both trees' pages in one read, with `commitPairs` (`:214`) walking
first-parent history for `lint --since`. Every git answer those
constructors read comes from a file git wrote itself ([[git]]) and is held
to its terminator — the commit walk and the parent line to a newline, the
tree listing and the rename diff to a NUL (`:220`, `:243`, `:255`, `:268`,
`:334`). Two cross-checks catch a listing cut at a record boundary: every
path the staged diff names as added, modified, retyped, renamed or copied
must be in the index listing (`:60-84`), and the commit walk must list as
many commits as `rev-list --count` counts (`:217-232`); a refused answer is
rethrown as itself past the catch that would read it as a missing parent
(`:235-237`).

`packages/cli/src/staged.ts` is the gate and `lint --staged` in one function,
`runStagedLint` (`:117`): refuse unmerged paths (`:122-126`), read the staged
constitution through the index and load the law it declares (`:127-140`,
`:84-115`) — a git answer cut short or contradicted passes the
`git-unavailable` catch as itself (`:133-134`) — check the engine pin first
for `gate` (`:141-144`), rebuild the artifacts from the index's pages and compare
them with the index's bytes (`:51-82`, `:161-162`), add the former-folder-tag
findings a rename raises (`:155-160`), render the exports from the index's
pages, config, templates, attachments and a kit declared by `path`, and, when the
index tracks a rendered export, compare it with the index's bytes as
`export-stale` (`:163-180`; see [[exports]]). The verdict, the artifacts
and the exports are all reached under that one staged law: a kit declared
by `path` is loaded from its staged bytes, written out under the temporary
directory by `packages/cli/src/stagedkits.ts` — a link the index tracks
written as that link — proved there and removed; a kit under
`node_modules` is read from the working tree, the one exception; and a
staged kit that does not load refuses the gate with the loader's own code.
It judges with
`gate: true`, `configChanged` and the shell passes named
(`packages/cli/src/staged.ts:182-194`); the
drift pass, the rename review, the exports and the verdict take one parse of
the index (`parsedPages`). `runCommitMsgGate`
(`:222`) judges the opening of a commit message's first line — `word:`,
`word(scope):`, `word!:` or `word(scope)!:`, the registered set naming words
and never scopes — against `commit_prefixes` through `commitPrefixVerdict`
(`packages/core/src/prefixes/index.ts:51`), refusing with one stderr line that
names the valid set and says whether the word was unregistered or the line
had no opening (`packages/cli/src/staged.ts:238-248`). `packages/core/src/gitplan/index.ts` parses
`git diff --cached --name-status -z -M` output in pure core (`:14-39`).
`packages/cli/src/hooks.ts` renders the marker hooks from one renderer
(`:105-156`): the bundle's chained script first, then the `WIKIWRIGHT_BYPASS`
guard that logs into the git directory (`:18-30`), the fail-open when no
`wikiwright` is on PATH (`:41-48`), and `wikiwright gate` with the envelope
dropped (`:124-132`); `installedHooks` (`:179`) compares each installed marker
hook byte for byte with what this build writes (`:192-199`), and
`installHook` (`:212`) never clobbers a hook it did not write (`:96-99`)
and installs only into a hooks directory whose git answer ended in its
newline (`:80-81`).

In `packages/cli/src/verbs/write.ts`, `judgeDrafts` (`:442`) stamps the
`auto` dates into every draft and judges all of them in one overlay state,
refused together or admitted together (`:433-441`); `performWholePageWrite`
(`:604`) and `performBatchWrite` (`:664`) serve the whole-page and `--from`
forms, and a real `--from` run answers with the dry run's `ops`, built from
the drafts the run read and judged rather than a second reading of the
directory, and `wrote: true` (`:689-714`); `identityHits` (`:111`) is the identity gate's blocking tiers;
`removedIllegally` (`:736`) reads the transition arms off the loaded modules
to refuse a write that dropped a governed item; `appendUnderSection` (`:245`)
is the `--section --append` splice. A superseded claim's closing clause is
`valid <from>→<day before>, superseded <date>`, and on the claim's own date
`valid D→D, superseded D`, a closed interval of one day (`:346-354`); a date
before the claim's own is `date-before-claim` (`:1117-1126`). A `--coexist`
reason lands under the new claim as `coexists: <reason>`, followed by the two
newest open claims of the category it stands beside and a count of the rest
(`:647-657`, `:1074-1081`); no arm reads that line.

## Entry points

- `applyWrite`, `sectionTail`, `yamlScalar`, `pageEnvelope`,
  `appendToFrontmatterList` (`packages/core/src/writer/index.ts`).
- `proveWrites`, `proveWrite`, `commitWrites`, `commitWrite`, `splicePlan`,
  `blobSha` (`packages/cli/src/writer.ts`), called by `write`, `new`, `fix`,
  `move`, `retire` and `freshness --fast-forward`
  (`packages/cli/src/verbs/freshness.ts:188-219`).
- `fsState`, `indexState`, `overlayState`, `revisionState`, `commitPairs`,
  `revisionReader` (`packages/cli/src/state.ts`), chosen by `lint`
  (`packages/cli/src/verbs/lint.ts:62`, `:84`, `:101`, `:210`), `check`, `fix`
  and the write verbs.
- `runStagedLint`, `runCommitMsgGate` (`packages/cli/src/staged.ts:117`,
  `:222`); `gateCommand` (`packages/cli/src/verbs/gate.ts:50`), which prints
  the rule census and the error findings onto stderr when it refuses
  (`:15-42`); `writeCommand` (`packages/cli/src/verbs/write.ts:777`).
- `renderHooks`, `installedHooks`, `installHook`, `inspectHook`
  (`packages/cli/src/hooks.ts`).

## State

None in core. The shell reads the working tree, the git index and HEAD
through the git plumbing described in [[git]]; during a write it holds one
exclusively created temp file per page beside the page until every rename
lands, and a replacement keeps the mode the file had, so a file a maintainer
made private stays private while ownership, which needs privilege the engine
does not ask for, does not follow (`packages/cli/src/atomicwrite.ts:29-40`,
`:49-55`, `:67-98`). The marker hooks live
in the directory `git rev-parse --git-path hooks` names.

## Invariants

- A write differs from its input only inside the lines its ops name, and the
  BOM, line ending and trailing-newline state are the input's
  (`packages/core/src/writer/index.ts:1-4`, `:407-411`).
- Ambiguity is a refusal, never a choice: a heading that occurs twice or at
  another depth (`:104-109`, `:122`), a frontmatter key written twice
  (`:197-203`), a block the YAML parser rejected (`:386-399`), a scalar set
  over a collection or a block value (`:328-340`), two overlapping ops
  (`:424-436`).
- Every writing verb proves before it lands, and the proof judges the whole
  vault once for however many pages (`packages/cli/src/writer.ts:48-57`,
  `:68-71`); a batch lands together or not at all (`:116-123`;
  `packages/cli/src/verbs/write.ts:433-441`).
- The gate judges the index and only the index: the staged constitution
  and the kit it declares by `path`
  (`packages/cli/src/staged.ts:127-140`), the staged pages, the staged
  artifacts (`:41-50`); an unchanged page's base is its own staged content so
  its diff-gated arms evaluate rather than count unevaluated
  (`packages/cli/src/state.ts:86-92`, `:158-161`); a deletion is a base fact so
  the gate can build the name index the base held (`:164-170`); a `config/`
  change rescopes the whole vault (`:176-178`).
- Every path a constructor stores is NFC (`packages/cli/src/state.ts:63`,
  `:200`, `:276`).
- The hook fails open, loudly, when the engine is absent (`packages/cli/src/hooks.ts:41-48`);
  a bypass is logged where the bypassed commit cannot contain its own record
  (`:11-17`); a path becomes shell source through one quoting function
  (`:32-39`).

## Failure modes

- The proof's `not-proved` and `new-errors`
  (`packages/cli/src/writer.ts:38-40`, `:73-96`); a splice reason such as
  "two ops overlap" or "does not occur exactly once"
  (`packages/core/src/writer/index.ts:434`, `:369`).
- `stamp-refused` when the `auto` stamps cannot be spliced
  (`packages/cli/src/verbs/write.ts:460-467`); `identity-candidates` at exit
  10 (`:510`); `removed-illegally` (`:534`); `draft-invalid` at exit 5
  (`:573`, `:1258`); `stale-base` under `--base` (`:921`);
  `date-before-claim` (`:1123`);
  `directory-not-found` for `--from` (`:878`); `unknown-section` and
  `section-absent` (`:158`, `:203`, `:213`).
- `unmerged-paths` and `git-unavailable` at the gate
  (`packages/cli/src/staged.ts:122-137`), and `git-short-read` or
  `git-inconsistent-read` (exit 1) when a git answer ended before its
  terminator or two disagree ([[git]]); `message-not-found` and
  `commit-prefix` from the commit-msg arm (`:227-248`).
- A crash inside the rename loop is the one window where a batch is partly
  landed (`packages/cli/src/writer.ts:122`).

## Relations

- part_of [[wikiwright-architecture]]
- mapped_in [[repository-layout]]
- verified_by [[testing-guide]]
