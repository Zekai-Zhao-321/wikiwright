---
type: subsystem
title: "Exports"
description: "A bundle's declared exports: read-only copies of the bundle, or of part of it, that a host installs as skills, planned by one function, rendered into the bundle's own skills/ by check --write or into another repository by export, held to a fresh render by check and the staged gate, and read as a vault under the identity their marker gives."
tags: [cli]
pin: bb5c81cb574ea4115c6f384967ab4878cd52a9eb
origin: .
covers: [packages/cli/src/exports.ts, packages/cli/src/marker.ts, packages/cli/src/verbs/export.ts]
---

# Exports

## Responsibilities

`exportPlans` (`packages/cli/src/exports.ts:77`) resolves each declaration in
`config/engine.json`'s `exports` with its defaults: its name, derived from the
bundle's label when it declares none, its destination under `skills/`, its
repository, links, guide and contribution. `planExport` (`:380`) is the one
planner, and a pure function of its source: the selection, all pages or
those carrying a tag or under a directory, an unknown tag refused
(`:388-437`); the guide, which must lie in the selection, and the
maintainer's fragment, which must lie outside every content root
(`:438-470`); the links a selected page makes to a page left out, counted,
and under `links: closed` a judgment that withholds the render until the
selection widens or the declaration says `cut` (`:471-502`); the files the
copy carries beside its pages — `config/` verbatim, the templates and
examples the loader validates at their declared paths, the source roots
under `sources: include`, each embedded file, and each declared kit at its
declared location — every link read through and its bytes carried, a kit's
files the one inventory its module digest covers (see [[modules]]), and
refused only where a link leaves the bundle or the index tracks one
(`:422-432`, `:503-635`); the marker, with the content digest over the
selected pages and a law digest whose kit lines are the digests of the kit
bytes the copy carries, so a staged render names the staged kit's law
(`:636-669`); then the generated artifacts over the selection, the
consumer's brief naming the export and the marker's law, the marker and the
`SKILL.md` a host reads (`:674-717`). An export a finding refuses, and a
closed export with a cut link, plans no files (`:670-672`).

`repositoryExports` (`:930-1020`) plans every `output: skills` export of a
bundle for `check`, refusing as `export-destination-linked` a destination
with a symbolic link anywhere on its path from the bundle root, `skills/`
included, and the manifests' directory the same way (`:944-963`,
`:1015-1018`, `:1027-1034`), refusing a destination inside a content root
and naming a `skills/<name>/` whose marker no declaration names as
`export-orphan` — never under a linked `skills/` — and renders nothing over a
root that is itself a copy (`:938`). `exportDifferences`
(`:1043-1077`) compares each plan with what is on disk or in the index, a
link where a file belongs a difference, and
`exportStaleFindings` (`:1084-1114`) turns a difference into `export-stale`,
naming the first ten files that differ. The planner reads through an
`ExportSource`: the working tree (`fsExportSource`, `:197-276`), read
through its links, each kit by the module digest's own inventory, or the git
index for the staged gate (`indexExportSource`, `:865`), where a link is known by its mode, holds no
bytes and is refused, and a kit under `node_modules`, which the index does
not hold, is read from the working tree (`:856-864`; see [[git]]).
`pluginManifests` (`:125`) renders the two plugin manifests when `plugin` is
declared.

`packages/cli/src/marker.ts` reads a copy's marker, `config/export.json`,
through the contained reader, and checks it key by key against the shape the
planner writes (`:92`, `:176`): a marker that is not one is refused before
any module preloads (see [[command-runtime]]). The `export` verb
(`packages/cli/src/verbs/export.ts:241`) writes one `output: external` export
into another repository's tree, through the planner and the owned-directory
writer `check --write` uses, every refusal reached before the first write and
shared with its dry run — a link on `<dir>/skills`, on the manifests'
directory or anywhere under the destination included (`:77-234`).

## Entry points

- `exportPlans`, `planExport`, `repositoryExports`, `exportDifferences`,
  `exportStaleFindings`, `pluginManifests`, `fsExportSource`,
  `indexExportSource` (`packages/cli/src/exports.ts`); `EXPORT_PASSES`, the
  shell passes `check` and the staged gate name (`:1125`).
- `markerAt`, `markerOf` (`packages/cli/src/marker.ts:176`, `:92`).
- `exportCommand` (`packages/cli/src/verbs/export.ts:241`); `check --write`
  through `writeExports` (see [[generated-artifacts]]); the staged gate (see
  [[writer-and-staged-gate]]).

## State

A rendered export is a directory, `skills/<name>/` under the bundle root or
under an `export --to` destination, holding the selected pages at their own
paths, `config/` with the marker beside the verbatim config, `generated/`,
`SKILL.md`, and the templates, kits and embedded files the pages need. The
two gardening handbooks under `fixtures/handbooks` track theirs. Nothing is
held at runtime.

## Invariants

- One planner: `check --write`, `check`, the staged gate and `export` render
  through `planExport`, so a rendered copy, a staleness verdict and an external
  copy cannot disagree (`packages/cli/src/exports.ts:380`).
- A copy is a vault: it carries what the loader needs to judge it and every
  reader answers over a plain copy of it with nothing installed; its marker
  names the export, and the envelope over it names the bundle it was cut
  from (`packages/cli/test/export-copy.test.ts`; see [[command-runtime]]).
- A copy holds bytes, never a link: a vault file reached through a link that
  leaves the bundle refuses the export as `export-symlink`, so a link in
  `wiki/` never publishes foreign bytes, while a declared kit's files are read
  through their links unchecked, since the law digest already covers them and
  the declaration makes them the bundle's; a link the index tracks refuses it
  too (`packages/cli/src/exports.ts:503-529`, `:609-634`); a link found in
  a rendered copy is replaced by bytes, never written through
  (`packages/cli/src/artifacts.ts`); and `export` refuses one where it would
  write (`packages/cli/src/verbs/export.ts:46-60`, `:158-175`), nor does
  `check --write` render under a linked `skills/` or any link on the way
  to its destination (`packages/cli/src/exports.ts:944-963`).
- The engine owns only what it writes: the files of an export's own
  `skills/<name>/` and the two manifests; a directory there without a marker
  is not the engine's (`:183-194`), and a marker no declaration names is
  never removed (`packages/cli/src/exports.ts:988-1014`).

## Failure modes

- `export-tag-unknown`, `export-guide-outside`, `export-skill-invalid`,
  `export-symlink`, `export-destination-invalid`,
  `export-destination-linked` (errors, queued to `export-review`; the export
  is not rendered), `export-not-closed` (a warning; under `links: closed`
  the export is not rendered), `export-orphan` (a warning), and
  `export-stale` (error, fixer `check --write`)
  (`packages/cli/src/exports.ts:1125-1135`).
- `export-not-declared`, `export-output-skills`,
  `export-destination-inside-bundle` (exit 2), `directory-not-found` (exit 3),
  `export-destination-linked`, `export-destination-occupied` (exit 4), and
  exit 5 with the render's findings, a closed export with a cut link
  among them, from `export` (`packages/cli/src/verbs/export.ts:77-216`).
- `export-marker-invalid` (exit 4) for a marker that is not one
  (`packages/cli/src/marker.ts:92-169`).

## Relations

- part_of [[wikiwright-architecture]]
- mapped_in [[repository-layout]]
- verified_by [[testing-guide]]
