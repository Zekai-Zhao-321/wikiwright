---
type: subsystem
title: "Generated artifacts"
description: "One generator per artifact: the graph, the manifest, the tag catalog and the writer's brief under generated/, byte-reproducible, landed by check --write, compared against a fresh rebuild by check and by the staged gate, and queried by graph edges."
tags: [kernel, cli]
pin: a38be783d7393d145ba7950daf1b0ca2c1c4fbad
origin: .
covers: [packages/core/src/generate/, packages/core/src/hash/, packages/cli/src/artifacts.ts, packages/cli/src/atomicwrite.ts, packages/cli/src/verbs/check.ts, packages/cli/src/verbs/graph.ts]
---

# Generated artifacts

## Responsibilities

`graphOf` (`packages/core/src/generate/index.ts:83`) builds the typed graph:
a node per page and per registered tag (`:90-100`); `tagged` edges (`:108-112`),
`wikilink` edges — or `cites` when the target sits under a declared source root
(`:113-121`) — `supersedes` in both directions (`:122-129`), and one labelled
edge per relation item, obtained by walking every non-prose section through
the same `grammarBindings` and `parseSections` the arms use and asking the
grammar that owns the item's kind through its `edges` hook (`:130-144`). Label
spelling is grouped by identity and printed in the code-unit-minimal form seen
(`:146-152`); edges are deduplicated and sorted (`:153-171`).
`generateArtifacts` (`:214`) derives from those edges the manifest — totals,
`by_kind`, `by_label`, the extension census, and per page the type, chain,
archetype, title, description, tags and depth-1 `outbound` and `inbound`
adjacency nested by label under a labelled kind (`:224-301`) — and renders the
tag catalog (`:303-321`), returning three `ArtifactFile`s (`:325-329`) through
one serializer (`:24-30`). `packages/core/src/hash/index.ts` is the kernel's
vendored SHA-256 (`:45`), read by the claim handle, the evidence digest and
the trust digest, with `node:crypto` as its oracle in a test (`:1-9`).

In the shell, `regenerate` (`packages/cli/src/artifacts.ts:58-71`) is the
one generation path `check --write` and `init` share: the kernel's three
plans plus the writer's brief, which `briefPlan` (`:26-32`) renders through
the brief's one renderer as a fourth `ArtifactPlan`; `writeArtifacts`
(`:42-50`) lands every file write-then-rename; `writeBrief` (`:35-40`) is
the brief alone through the same loop, for `skills update`; `artifactOps`
(`:80-99`) answers the dry run from the generator itself, the brief named
last. The `check` verb
(`packages/cli/src/verbs/check.ts`) reads the tree into one state and parses
it once, through `parsedPages`, for everything that follows (`:67-71`),
writes the three plans and the brief under `--write` (`:75-80`), compares
every kernel plan with the file on disk and reports `generated-drift`
(`:81-98`), adds the machine-local findings about skills, the brief and the
installed hooks (`:103-126`) — a brief that differs from the one already
rendered from those pages is `brief-stale`, `info`, whose advisory is
`check --write` (`packages/cli/src/verbs/brief.ts:40-58`;
`packages/core/src/passes/index.ts:378`) — names the shell passes it ran
(`:133-142`), hands the same state to one judge (`:146-150`) and lists the
four files it generates (`:154`). The `graph edges` verb queries
the graph built from the working tree through `graphOf`, never the artifact on
disk (`packages/cli/src/verbs/graph.ts:1-5`); `--missing` enumerates one
side and names it — `side: "target"` under `--inbound`, the pages of that
type no selected edge reaches; `side: "source"` under `--outbound`, the pages
of that type that carry none (`:68-73`, `:226-240`) — so "which subsystems
carry no `mapped_in`" is `--label mapped_in --outbound subsystem --missing`
(`:79`), and naming neither side or both is `missing-side` (`:91-98`).

## Entry points

- `graphOf`, `generateArtifacts`, `serializeArtifact`
  (`packages/core/src/generate/index.ts:83`, `:214`, `:28`); `sha256Hex`
  (`packages/core/src/hash/index.ts:45`).
- `regenerate`, `artifactOps`, `writeArtifacts`
  (`packages/cli/src/artifacts.ts`); `checkCommand`
  (`packages/cli/src/verbs/check.ts:44`); `graphCommand`
  (`packages/cli/src/verbs/graph.ts:38`).
- The staged gate rebuilds the artifacts from the index's own pages and
  compares them with the index's bytes (`packages/cli/src/staged.ts:34-65`);
  `freshness` reads the graph's edges for its one-hop propagation
  (`packages/cli/src/verbs/freshness.ts:48-57`).

## State

The files under `generated/`: `graph.json`, `manifest.json` and
`tag-catalog.md` from the kernel (`packages/core/src/generate/index.ts:326-328`)
and `BRIEF.md` from the brief's renderer (`packages/cli/src/artifacts.ts:26-32`;
see [[skills-and-brief]]), all four landed by `check --write` and tracked in
this bundle by [[D-001]]; `generated/freshness.json` is never committed
(`packages/cli/src/verbs/freshness.ts:38`). Nothing is held at runtime.

## Invariants

- Same inputs, same bytes, on every machine: nodes and edges are sorted with
  `codeUnitCompare`, the manifest's counts and adjacency are derived from the
  same edge list, and the tag rows are sorted by name
  (`packages/core/src/generate/index.ts:62`, `:100`, `:165-171`, `:236-258`,
  `:306-307`).
- An edge carries no line: an edge is identity, not location, and a line
  would make every edit above a section change the artifact (`:36-41`). The
  graph is a set; two identical relation lines are one edge (`:78-80`,
  `:153-163`). Adjacency is page-to-page only; a tag node is not a page
  (`:253-255`).
- The kernel learns no label and no grammar name here: it resolves the
  target, drops what does not resolve and what points at the page itself, and
  keys the edge by the item's kind (`:74-80`, `:137-141`).
- The plan's paths come from the generator itself, so a dry run can never
  name a file the writer would not produce
  (`packages/cli/src/artifacts.ts:73-79`); drift is compared against a fresh
  rebuild, never a remembered set (`packages/cli/src/verbs/check.ts:81-98`),
  and at the gate against the index, never the working tree
  (`packages/cli/src/staged.ts:25-33`).
- `check` contacts no origin: the origin rows read `not_applicable`, reason
  `external-origin`, on every page (`packages/cli/src/verbs/check.ts:129-133`).

## Failure modes

- `generated-drift` (error, fixer `check --write`) when a file differs or is
  missing (`packages/cli/src/verbs/check.ts:84-97`;
  `packages/core/src/passes/index.ts:187-193`); at the gate, when the staged
  artifact does not describe the staged pages
  (`packages/cli/src/staged.ts:46-64`).
- The rename loop is per-file atomic, not batch-atomic: a crash mid-loop
  leaves a mix the next `check --write` converges
  (`packages/cli/src/artifacts.ts:42-50`; `packages/cli/src/atomicwrite.ts:84-98`).
- An unknown type, kind or label in `graph edges` is exit 3 with the nearest
  names within three edits (`packages/cli/src/verbs/graph.ts:24-33`).
- `brief-stale` (info, advisory `check --write`) when the installed brief is
  absent or differs from the render (`packages/cli/src/verbs/brief.ts:40-58`);
  `missing-side` (usage) when `--missing` names no side or both
  (`packages/cli/src/verbs/graph.ts:94-98`).

## Relations

- part_of [[wikiwright-architecture]]
- mapped_in [[repository-layout]]
- verified_by [[testing-guide]]
- decided_by [[D-001]]
- decided_by [[D-005]]
