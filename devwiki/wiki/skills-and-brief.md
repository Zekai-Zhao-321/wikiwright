---
type: subsystem
title: "Skills and the brief"
description: "The three shipped skills copied into a vault under a stamp the engine can audit, the per-role brief rendered from the verb registry and the loaded constitution under its law digest, and the machine-local findings that say when either is behind the binary."
tags: [cli]
pin: 3d81407b9af92945288e7c9ab27ed671aa49e0a4
origin: .
covers: [packages/cli/src/skills.ts, packages/cli/src/brief.ts, packages/cli/src/shipped.ts, packages/cli/src/verbs/skills.ts, packages/cli/src/verbs/brief.ts, packages/cli/src/artifacts.ts, packages/cli/skills/]
---

# Skills and the brief

## Responsibilities

The binary ships three skills beside itself — `wikiwright-consume` for using
what a bundle knows, which is also the runtime skill every bundle skill
requires and so names the consumer's commands and the one setup route
(`packages/cli/skills/wikiwright-consume/SKILL.md:19`), `wikiwright-write` for
writing into one, and `wikiwright-maintain` for maintaining one, its export
practices included (`packages/cli/skills/wikiwright-maintain/SKILL.md:93`) —
resolved at a fixed depth by
`shippedDir` (`packages/cli/src/shipped.ts:1-12`;
`packages/cli/src/skills.ts:56-67`). `init` copies every skill the package
ships into a vault under `.claude/skills/`, and nothing refreshed
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
cannot prove it wrote unless `--force` (`:1-2`). Each of the three opens on
the same principle the brief's loops do — use the engine to decide, to write
and to attribute; use your own tools to look
(`packages/cli/skills/wikiwright-consume/SKILL.md:15`,
`packages/cli/skills/wikiwright-write/SKILL.md:15`,
`packages/cli/skills/wikiwright-maintain/SKILL.md:13`).

The brief is one generated file, `generated/BRIEF.md`
(`packages/cli/src/brief.ts:25`), rendered by `renderBrief` (`:229`) under a
header naming the law digest (`:253`) and, over a copy, the export it is
and the bundle it was cut from (`:255-260`), with the role's own loop and findings
paragraph — every loop opens on that principle (`:118-125`), the consumer's
names no verb and runs nothing, the maintainer's is the writer's five steps
and two more (`:106-170`) — then the verb registry
filtered to the role's rank (`:231-234`), each verb under its workflow slot
(`:27-53`), the bundle's concrete types (`:235-237`, `:277-281`), every
declared vocabulary with its entries' properties (`:283-285`), the census of
what the vault authored (`:286-290`), the skill fragments the loaded modules
contributed in load order (`:207-222`), and the reserved basenames (`:238`,
`:292-298`). `briefOf` (`:303-347`) is the one renderer `init`, `skills
update`, `check` and an export's consumer brief share, the export named by
its caller or read off the root's marker (`:349-359`), and its law digest is
the one every vault envelope's `metadata.bundle.law` carries (`:336-344`). `brief` is a consumer's
verb: without `--role` it prints the session's `WIKIWRIGHT_ROLE`, the writer's
when none is set (`packages/cli/src/verbs/brief.ts:85-86`); `briefFor` reads
the vault and its pages for the renderer (`:18-30`); `briefFindings` (`:41`)
compares the brief its caller already rendered and reports `brief-stale`
(`:47`), and the stamp covers the brief so a skills refresh refreshes the file
that carries the verbs (`packages/cli/src/verbs/skills.ts:49-51`).

## Entry points

- `briefCommand` and `briefFor`, `briefOf`, `briefFindings`
  (`packages/cli/src/verbs/brief.ts:18`, `:41`; `packages/cli/src/brief.ts:310`);
  `briefPlan` and
  `writeBrief`, through the artifact write loop
  (`packages/cli/src/artifacts.ts:33`, `:43`); `renderBrief`,
  `BRIEF_PATH`, `WORKFLOW_SLOTS` (`packages/cli/src/brief.ts`).
- `skillsCommand` (`packages/cli/src/verbs/skills.ts`); `inspectSkills`,
  `skillFindings`, `planSkillsUpdate`, `updateSkills`, `stampAll`,
  `shippedSkillPaths`, `shippedSkillNames` (`packages/cli/src/skills.ts`).
- `check` adds `skillFindings` and `briefFindings` to its shell findings
  (`packages/cli/src/verbs/check.ts:122-130`).

## State

`.claude/skills/<skill>/` and its stamp in the vault; `generated/BRIEF.md`,
which this bundle tracks by [[D-001]] and the `code` starter leaves for the
first `check --write` to render.

## Invariants

- The install and the binary are machine-local state, so warning is this
  pass's ceiling: a `check` that went red because a machine was behind would
  flake on every machine but the author's
  (`packages/cli/src/skills.ts:1-4`; `packages/core/src/passes/index.ts:366-381`).
- A stamp whose metadata is old while every file's sha is the shipped one is
  `info`, because `commit` moves with every engine build and a warning there
  would have "dismiss it" as its standing answer
  (`packages/cli/src/skills.ts:361-379`).
- A stamp that does not parse is the same epistemic state as none, and the
  engine refuses to overwrite bytes it cannot account for (`:103-118`);
  orphaned stamped files are never rewritten and never deleted (`:52-53`).
- The brief is byte-reproducible: no clock, no absolute path, no count that
  changes on a content commit except the census block, which is why live
  counts live in `type show --brief` (`packages/cli/src/brief.ts:224-228`).
- Every role verb has a workflow slot and every slot names a verb; a role
  verb with no slot fails the skills test (`:27-31`).
- The registry is passed into the brief, not imported, to avoid a module
  cycle whose top-level constants read `undefined` under ESM (`:174-180`).

## Failure modes

- `skills-stale` (warning or info), `skills-missing` (info), `brief-stale`
  (info) from `check`, each naming the verb that refreshes it
  (`packages/core/src/passes/index.ts:371-381`).
- A locally edited shipped file blocks `skills update` without `--force`
  (`packages/cli/src/skills.ts:1-2`, `:203-207`).

## Relations

- part_of [[command-runtime]]
- mapped_in [[repository-layout]]
- verified_by [[testing-guide]]
