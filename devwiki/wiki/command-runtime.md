---
type: subsystem
title: "The command runtime"
description: "The eight-verb command table, argument parser, JSON envelope and bundle identity of the v2 CLI."
tags: [cli]
pin:
  commit: 1a1a90c11329d82c9b2c6e92c6fa8e16160c0613
  origin: .
  covers: ["packages/cli/src/main.ts", "packages/cli/src/commands.ts", "packages/cli/src/argv.ts", "packages/cli/src/envelope.ts", "packages/cli/src/spec.ts", "packages/cli/src/typelaw.ts"]
updated: 2026-09-27
---

# The command runtime

## Responsibilities

The CLI dispatches exactly eight verbs from one command table. Help, JSON help, argument parsing and the generated CLI reference read that table. Each law-reading answer names the selected bundle and carries one JSON envelope.

## Entry points

Current source at this pin: `packages/cli/src/main.ts`, `packages/cli/src/commands.ts`, `packages/cli/src/argv.ts`, `packages/cli/src/envelope.ts`, `packages/cli/src/spec.ts`, `packages/cli/src/typelaw.ts`.

## State

An invocation reads its root and flags, then builds a working-tree, draft, index or revision state as the verb requires. It keeps no daemon or persistent parse cache; version answers about the build without loading a bundle.

## Invariants

Argument refusals happen before judgment. A successful law load and its selected page and source-path state determine the bundle block, while the envelope writer bounds stdout and preserves one code per refusal meaning. `check --summary` presents totals and per-pin citation counts from the same full verdict; with `--out`, its uncapped selected report is saved. Output paths cannot replace the selected bundle or its imported law, including staged imports.

## Failure modes

Unknown commands, flags and missing arguments are usage errors. An invalid law is a constitution error; unsafe replacement targets and a changed pre-write state are conflicts. Git plumbing and page findings remain distinct refusal types.

## Relations

- part-of [[wikiwright-architecture]]
- mapped-in [[repository-layout]]
- verified-by [[testing-guide]]
