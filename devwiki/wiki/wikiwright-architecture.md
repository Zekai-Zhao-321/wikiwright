---
type: architecture-overview
title: wikiwright architecture
description: The four-layer shape of the engine and how a page's obligations flow through it.
tags: [kernel, stdlib, cli, kit]
pin: bb5c81cb574ea4115c6f384967ab4878cd52a9eb
origin: .
covers: [packages/core/src/index.ts, packages/core/src/judge/, packages/core/src/modules/, packages/core/src/stdlib/, packages/cli/src/main.ts, packages/cli/src/vaultio.ts, packages/cli/src/vaultfiles.ts, packages/cli/src/discovery.ts, packages/cli/src/law.ts, packages/kit-code/]
---

# wikiwright architecture

## System shape

wikiwright is a typed wiki engine with a pure computational core and an
imperative shell. Canonical state is Markdown plus git; everything under
`generated/` is derived, byte-reproducible and deletable. A page declares
exactly one nominal type; the registry resolves inheritance chains once at
load into flattened effective contracts, and every consumer (the judge,
templates, search, the graph) reads only the flattened form.

One function, `judge(state, law)`, produces every verdict. The shell builds
the state (the working tree, the git index, a draft overlay or a historical
revision) and the core judges it, so `write --dry-run`, `lint --staged` and
the pre-commit gate cannot disagree. Every finding carries either a runnable
fix or a queue lane. See [[registry-pipeline]] for the load path and
[[wikiwright-quickstart]] to run it.

The shell reads a vault's files through `vaultfiles.ts`, below the loader in
`vaultio.ts`, so the bundle identity can read them without loading the law.
Before a verb runs, `main.ts` resolves `--bundle <name>` by a scan of the
skill directories (`discovery.ts`, which reads markers only; nothing
registers a bundle) to the root `--root` would have named, refuses a verb
that can write over a root that holds a marker, and every verb that reads a
vault's law names the bundle it read on its envelope, with a digest of its
law and of its pages. Two verbs serve an agent reading a bundle it does not
maintain: `bundles list` prints the scan, and `read` returns a page's
sections verbatim with the page's digest. A bundle may declare exports, read-only
copies of itself or of part of it that a host installs as skills: `check
--write` renders them into the bundle's own `skills/`, `export` writes one
into another repository, and a copy is a vault every reader answers over,
under the identity its marker gives it (see [[exports]]).

## Layers

1. The kernel, in `@wikiwright/core`: the parse seam, identity, the type
   system and shapes, the judge with routing and the gate rule, the
   splice-only Writer, generation and search. It knows what a section is and
   not what a claim is.
2. The standard library, under `packages/core/src/stdlib/`: the `claims`,
   `relations` and `entries` modules, registered through the same API a kit
   uses. The kernel imports nothing from them.
3. A domain kit: an npm package a bundle installs, or a directory it carries
   and declares by a bundle-relative path, registering grammars,
   vocabularies, checks, lanes and constitution data through that API.
   Installing it is the consent to run it, and every load proves it first by
   a purity scan and its own determinism fixture (see [[loading-a-module]]). `@wikiwright/kit-code`, under `packages/kit-code/`, is the shipped
   one: the page kinds, relation labels, templates and reading discipline of
   a code wiki, registered as declarations only; this bundle consumes it.
4. The bundle: one corpus with its pages, its constitution, its local
   vocabulary entries and subtypes, judged by the `wikiwright` CLI, whose one
   spec-driven command registry generates `--help`, `schema` and the writer's
   brief.

The repository layout behind these layers is mapped in [[repository-layout]].

## Relations

- mapped_in [[repository-layout]]
- verified_by [[wikiwright-quickstart]]
- decided_by [[D-004]]
- verified_by [[testing-guide]]
