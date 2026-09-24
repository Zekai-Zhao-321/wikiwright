---
type: subsystem
title: "Exports"
description: "A bundle's declared exports: read-only copies of the bundle, or of part of it, that a host installs as skills, planned by one function, rendered into the bundle's own skills/ by check --write or into another repository by export, held to a fresh render by check and the staged gate, and read as a vault under the identity their marker gives."
tags: [cli]
pin: e61cee334e0a045f2b5fb6fa607ae7aff7e34411
origin: .
covers: [packages/cli/src/exports.ts, packages/cli/src/marker.ts, packages/cli/src/verbs/export.ts]
---

# Exports

## Responsibilities

`exportPlans` (`packages/cli/src/exports.ts:69`) resolves each declaration in
`config/engine.json`'s `exports` with its defaults: its name, derived from the
bundle's label when it declares none, its destination under `skills/`, its
repository, links, guide and contribution. `planExport` (`:314`) is the one
planner, and a pure function of its source: the selection, all pages or
those carrying a tag or under a directory, an unknown tag refused
(`:322-371`); the guide, which must lie in the selection, and the
maintainer's fragment, which must lie outside every content root
(`:372-404`); the links a selected page makes to a page left out, counted,
and refused as a judgment under `links: closed` (`:405-431`); the files the
copy carries beside its pages — `config/` verbatim, the templates and
examples the loader validates at their declared paths, the source roots
under `sources: include`, each embedded file, and each declared kit at its
declared location, a symbolic link anywhere refused (`:356-364`, `:432-545`);
the marker, with the content digest over the selected pages and the source's
law digest (`:547-576`); then the generated artifacts over the selection, the
consumer's brief naming the export, the marker and the `SKILL.md` a host
reads (`:582-621`). An export a finding refuses plans no files.

`repositoryExports` (`:821-886`) plans every `output: skills` export of a
bundle for `check`, refusing a destination inside a content root and naming a
`skills/<name>/` whose marker no declaration names as `export-orphan`, and
renders nothing over a root that is itself a copy (`:829`). `exportDifferences`
(`:895-929`) compares each plan with what is on disk or in the index, and
`exportStaleFindings` (`:936-966`) turns a difference into `export-stale`,
naming the first ten files that differ. The planner reads through an
`ExportSource`: the working tree (`fsExportSource`, `:164`) or the git index
for the staged gate (`indexExportSource`, `:767`), where a link is known by
its mode and never read, and a kit under `node_modules`, which the index
does not hold, is read from the working tree (`:759-770`; see [[git]]).
`pluginManifests` (`:117`) renders the two plugin manifests when `plugin` is
declared.

`packages/cli/src/marker.ts` reads a copy's marker, `config/export.json`,
through the contained reader, and checks it key by key against the shape the
planner writes (`:92`, `:176`): a marker that is not one is refused before
any module preloads (see [[command-runtime]]). The `export` verb
(`packages/cli/src/verbs/export.ts:225`) writes one `output: external` export
into another repository's tree, through the planner and the owned-directory
writer `check --write` uses, every refusal reached before the first write and
shared with its dry run (`:76-218`).

## Entry points

- `exportPlans`, `planExport`, `repositoryExports`, `exportDifferences`,
  `exportStaleFindings`, `pluginManifests`, `fsExportSource`,
  `indexExportSource` (`packages/cli/src/exports.ts`); `EXPORT_PASSES`, the
  shell passes `check` and the staged gate name (`:977`).
- `markerAt`, `markerOf` (`packages/cli/src/marker.ts:176`, `:92`).
- `exportCommand` (`packages/cli/src/verbs/export.ts:225`); `check --write`
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
  copy cannot disagree (`packages/cli/src/exports.ts:314`).
- A copy is a vault: it carries what the loader needs to judge it and every
  reader answers over a plain copy of it with nothing installed; its marker
  names the export, and the envelope over it names the bundle it was cut
  from (`packages/cli/test/export-copy.test.ts`; see [[command-runtime]]).
- A copy holds bytes, never a link: a symbolic link the copy would carry
  refuses the export (`packages/cli/src/exports.ts:534-545`), and `export`
  refuses one where it would write (`packages/cli/src/verbs/export.ts:45-59`).
- The engine owns only what it writes: the files of an export's own
  `skills/<name>/` and the two manifests; a directory there without a marker
  is not the engine's (`:167-178`), and a marker no declaration names is
  never removed (`packages/cli/src/exports.ts:862-884`).

## Failure modes

- `export-tag-unknown`, `export-guide-outside`, `export-skill-invalid`,
  `export-symlink`, `export-destination-invalid` (errors, queued to
  `export-review`; the export is not rendered), `export-not-closed` and
  `export-orphan` (warnings), and `export-stale` (error, fixer `check
  --write`) (`packages/cli/src/exports.ts:977-986`).
- `export-not-declared`, `export-output-skills`, `export-destination-invalid`
  (exit 2), `export-destination-linked`, `export-destination-occupied`
  (exit 4), and exit 5 with the render's findings, from `export`
  (`packages/cli/src/verbs/export.ts:76-200`).
- `export-marker-invalid` (exit 4) for a marker that is not one
  (`packages/cli/src/marker.ts:92-169`).

## Relations

- part_of [[wikiwright-architecture]]
- mapped_in [[repository-layout]]
- verified_by [[testing-guide]]
