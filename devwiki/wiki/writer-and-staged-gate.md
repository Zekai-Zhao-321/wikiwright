---
type: subsystem
title: "The Writer and the staged gate"
description: "The splice-only Writer in core, the shell that proves a splice with a second judge and lands it temp-then-rename, the four state constructors, and the staged gate the hooks run."
tags: [kernel, cli]
pin: a38be783d7393d145ba7950daf1b0ca2c1c4fbad
origin: .
covers: [packages/core/src/writer/, packages/core/src/gitplan/, packages/core/src/prefixes/, packages/cli/src/writer.ts, packages/cli/src/atomicwrite.ts, packages/cli/src/staged.ts, packages/cli/src/state.ts, packages/cli/src/hooks.ts, packages/cli/src/verbs/write.ts, packages/cli/src/verbs/gate.ts]
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
(`:37`) the working tree with no base; `indexState` (`:77`) over one
`indexSnapshot` — the staged diff and the index listing, read once although
the gate builds the state twice (`:52-68`) — every staged page and
every HEAD base it is judged against in one read by blob id
(`:93-123`, [[git]]), `null` for a new page, base-only entries for
deletions, and the rename list (`:134-159`); `overlayState` (`:173`)
the vault with one or more drafts in place of their pages, each based on the
disk bytes; `revisionState` (`:266`) one commit's tree against its first
parent, both trees' pages in one read, with `commitPairs` (`:198`) walking
first-parent history for `lint --since`.

`packages/cli/src/staged.ts` is the gate and `lint --staged` in one function,
`runStagedLint` (`:67`): refuse unmerged paths (`:72-76`), read the staged
constitution through the index (`:77-88`), check the engine pin first for
`gate` (`:89-92`), rebuild the artifacts from the index's pages and compare
them with the index's bytes (`:34-65`, `:109-110`), add the former-folder-tag
findings a rename raises (`:103-108`), and judge with `gate: true`,
`configChanged` and the shell passes named (`:111-117`); the drift pass, the
rename review and the verdict take one parse of the index (`parsedPages`). `runCommitMsgGate`
(`:145`) judges the opening of a commit message's first line — `word:`,
`word(scope):`, `word!:` or `word(scope)!:`, the registered set naming words
and never scopes — against `commit_prefixes` through `commitPrefixVerdict`
(`packages/core/src/prefixes/index.ts:51`), refusing with one stderr line that
names the valid set and says whether the word was unregistered or the line
had no opening (`packages/cli/src/staged.ts:161-171`). `packages/core/src/gitplan/index.ts` parses
`git diff --cached --name-status -z -M` output in pure core (`:14-39`).
`packages/cli/src/hooks.ts` renders the marker hooks from one renderer
(`:109-160`): the bundle's chained script first, then the `WIKIWRIGHT_BYPASS`
guard that logs into the git directory (`:18-30`), the fail-open when no
`wikiwright` is on PATH (`:41-48`), and `wikiwright gate` with the envelope
dropped (`:128-136`); `installedHooks` (`:183`) compares each installed marker
hook byte for byte with what this build writes (`:196-203`), and
`installHook` (`:216`) never clobbers a hook it did not write (`:100-103`).

In `packages/cli/src/verbs/write.ts`, `judgeDrafts` (`:439`) stamps the
`auto` dates into every draft and judges all of them in one overlay state,
refused together or admitted together (`:430-438`); `performWholePageWrite`
(`:601`) and `performBatchWrite` (`:649`) serve the whole-page and `--from`
forms; `identityHits` (`:111`) is the identity gate's blocking tiers;
`removedIllegally` (`:711`) reads the transition arms off the loaded modules
to refuse a write that dropped a governed item; `appendUnderSection` (`:245`)
is the `--section --append` splice.

## Entry points

- `applyWrite`, `sectionTail`, `yamlScalar`, `pageEnvelope`,
  `appendToFrontmatterList` (`packages/core/src/writer/index.ts`).
- `proveWrites`, `proveWrite`, `commitWrites`, `commitWrite`, `splicePlan`,
  `blobSha` (`packages/cli/src/writer.ts`), called by `write`, `new`, `fix`,
  `move`, `retire` and `freshness --fast-forward`
  (`packages/cli/src/verbs/freshness.ts:175-206`).
- `fsState`, `indexState`, `overlayState`, `revisionState`, `commitPairs`,
  `revisionReader` (`packages/cli/src/state.ts`), chosen by `lint`
  (`packages/cli/src/verbs/lint.ts:61`, `:83`, `:100`, `:207`), `check`, `fix`
  and the write verbs.
- `runStagedLint`, `runCommitMsgGate` (`packages/cli/src/staged.ts:67`,
  `:145`); `gateCommand` (`packages/cli/src/verbs/gate.ts:50`), which prints
  the rule census and the error findings onto stderr when it refuses
  (`:15-42`); `writeCommand` (`packages/cli/src/verbs/write.ts:752`).
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
  `packages/cli/src/verbs/write.ts:430-438`).
- The gate judges the index and only the index: the staged constitution
  (`packages/cli/src/staged.ts:77-88`), the staged pages, the staged
  artifacts (`:24-33`); an unchanged page's base is its own staged content so
  its diff-gated arms evaluate rather than count unevaluated
  (`packages/cli/src/state.ts:70-76`, `:142-145`); a deletion is a base fact so
  the gate can build the name index the base held (`:148-154`); a `config/`
  change rescopes the whole vault (`:160-162`).
- Every path a constructor stores is NFC (`packages/cli/src/state.ts:66`,
  `:184`, `:242`).
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
  (`packages/cli/src/verbs/write.ts:457-464`); `identity-candidates` at exit
  10 (`:507`); `removed-illegally` (`:531`); `draft-invalid` at exit 5
  (`:570`, `:1228`); `stale-base` under `--base` (`:896`);
  `directory-not-found` for `--from` (`:853`); `unknown-section` and
  `section-absent` (`:158`, `:203`, `:213`).
- `unmerged-paths` and `git-unavailable` at the gate
  (`packages/cli/src/staged.ts:72-85`); `message-not-found` and
  `commit-prefix` from the commit-msg arm (`:150-171`).
- A crash inside the rename loop is the one window where a batch is partly
  landed (`packages/cli/src/writer.ts:122`).

## Relations

- part_of [[wikiwright-architecture]]
- mapped_in [[repository-layout]]
- verified_by [[testing-guide]]
