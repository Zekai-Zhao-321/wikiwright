---
type: subsystem
title: "Skills and the brief"
description: "The two shipped skills copied into a vault under a stamp the engine can audit, the generated brief rendered from the verb registry and the loaded constitution, and the machine-local findings that say when either is behind the binary."
tags: [cli]
pin: a38be783d7393d145ba7950daf1b0ca2c1c4fbad
origin: .
covers: [packages/cli/src/skills.ts, packages/cli/src/brief.ts, packages/cli/src/shipped.ts, packages/cli/src/verbs/skills.ts, packages/cli/src/verbs/brief.ts, packages/cli/src/artifacts.ts, packages/cli/skills/]
---

# Skills and the brief

## Responsibilities

The binary ships two skills beside itself, `wikiwright-maintain` and
`wikiwright-write`, resolved at a fixed depth by `shippedDir`
(`packages/cli/src/shipped.ts:1-12`; `packages/cli/src/skills.ts:56-67`).
`init` copies them into a vault under `.claude/skills/`, and nothing refreshed
that copy until the stamp existed (`packages/cli/src/skills.ts:6-10`,
`:20-24`): `.wikiwright-stamp.json` beside each installed skill records the
engine version, the build commit and the sha256 of every shipped file
(`:26-35`, `:158-172`). `inspectSkills` (`:121`) classifies every shipped file
as `current`, `stale`, `modified`, `missing` or `unstamped` and lists the
stamped files the engine no longer ships (`:128-148`); `skillFindings`
(`:325`) turns that into `skills-missing` for an install with no stamp
(`:333-346`), an `info` `skills-stale` when only the stamp's engine or commit
moved (`:361-379`), and a warning `skills-stale` when files are behind or
edited locally (`:380-403`). `planSkillsUpdate` and `updateSkills` (`:248`,
`:281`) are the refresh the `skills` verb runs, refusing a file the engine
cannot prove it wrote unless `--force` (`:1-2`).

The brief is one generated file, `generated/BRIEF.md`
(`packages/cli/src/brief.ts:24`), rendered by `renderBrief` (`:148`) from the
verb registry filtered to the role's rank (`:151-153`), each verb under its
workflow slot (`:26-48`), the bundle's concrete types (`:154-156`,
`:196-200`), every declared vocabulary with its entries' properties
(`:202-204`), the census of what the vault authored (`:205-209`), the skill
fragments the loaded modules contributed in load order (`:132-141`), and the
reserved basenames (`:157`, `:211-213`). The `brief` verb's `briefOf`
(`packages/cli/src/brief.ts:230-258`) is the one renderer `init`, `skills
update` and `check` share, and `briefFor` reads the vault and its pages for it
(`packages/cli/src/verbs/brief.ts:18-29`); `briefFindings` (`:40`) compares the
brief its caller already rendered and reports `brief-stale` (`:46`), and the stamp covers the brief so a skills refresh
refreshes the file that carries the verbs
(`packages/cli/src/verbs/skills.ts:49-51`).

## Entry points

- `briefCommand` and `briefFor`, `briefOf`, `briefFindings`
  (`packages/cli/src/verbs/brief.ts:18`, `:40`; `packages/cli/src/brief.ts:230`);
  `briefPlan` and
  `writeBrief`, through the artifact write loop
  (`packages/cli/src/artifacts.ts:26`, `:35`); `renderBrief`,
  `BRIEF_PATH`, `WORKFLOW_SLOTS` (`packages/cli/src/brief.ts`).
- `skillsCommand` (`packages/cli/src/verbs/skills.ts`); `inspectSkills`,
  `skillFindings`, `planSkillsUpdate`, `updateSkills`, `stampAll`,
  `shippedSkillPaths`, `shippedSkillNames` (`packages/cli/src/skills.ts`).
- `check` adds `skillFindings` and `briefFindings` to its shell findings
  (`packages/cli/src/verbs/check.ts:99-107`).

## State

`.claude/skills/<skill>/` and its stamp in the vault; `generated/BRIEF.md`,
which this bundle tracks by [[D-001]] and the `code` starter leaves for the
first `check --write` to render.

## Invariants

- The install and the binary are machine-local state, so warning is this
  pass's ceiling: a `check` that went red because a machine was behind would
  flake on every machine but the author's
  (`packages/cli/src/skills.ts:1-4`; `packages/core/src/passes/index.ts:363-378`).
- A stamp whose metadata is old while every file's sha is the shipped one is
  `info`, because `commit` moves with every engine build and a warning there
  would have "dismiss it" as its standing answer
  (`packages/cli/src/skills.ts:361-379`).
- A stamp that does not parse is the same epistemic state as none, and the
  engine refuses to overwrite bytes it cannot account for (`:103-118`);
  orphaned stamped files are never rewritten and never deleted (`:52-53`).
- The brief is byte-reproducible: no clock, no absolute path, no count that
  changes on a content commit except the census block, which is why live
  counts live in `type show --brief` (`packages/cli/src/brief.ts:143-147`).
- Every role verb has a workflow slot and every slot names a verb; a role
  verb with no slot fails the skills test (`:26-30`).
- The registry is passed into the brief, not imported, to avoid a module
  cycle whose top-level constants read `undefined` under ESM (`:103-109`).

## Failure modes

- `skills-stale` (warning or info), `skills-missing` (info), `brief-stale`
  (info) from `check`, each naming the verb that refreshes it
  (`packages/core/src/passes/index.ts:368-378`).
- A locally edited shipped file blocks `skills update` without `--force`
  (`packages/cli/src/skills.ts:1-2`, `:203-207`).

## Relations

- part_of [[command-runtime]]
- mapped_in [[repository-layout]]
- verified_by [[testing-guide]]
