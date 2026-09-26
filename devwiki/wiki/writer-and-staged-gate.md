---
type: subsystem
title: "The Writer and the staged gate"
description: "The judged draft writer and staged Git acceptance boundary."
tags: [kernel, cli]
pin:
  commit: 34a9fe67279c277a390b728ac1b8bdeb15ab1a96
  origin: .
  covers: ["packages/cli/src/verbs/write.ts", "packages/cli/src/verbs/gate.ts", "packages/cli/src/lawstate.ts", "packages/cli/src/writer.ts", "packages/cli/src/ops.ts"]
---

# The Writer and the staged gate

## Responsibilities

Write --from reads a directory of drafts and optional ops.json, applies moves and claim lifecycle operations, then judges the full proposed state against disk before landing it. Gate judges the index under staged law with HEAD as base.

## Entry points

Current source at this pin: `packages/cli/src/verbs/write.ts`, `packages/cli/src/verbs/gate.ts`, `packages/cli/src/lawstate.ts`, `packages/cli/src/writer.ts`, `packages/cli/src/ops.ts`.

## State

The writer stages complete file replacements, then renames them into place. Gate uses object-id reads, cross-checks the staged diff against index and HEAD listings, demotes eligible inherited findings and requires a reason for a law change at commit-message time.

## Invariants

A dry run and a real write agree on refusal and plan paths. One judge decides at both write and commit boundaries; new rules carry discriminating test sets.

## Failure modes

A crash between replacements is not batch-atomic. A truncated or contradictory Git answer, unmerged index or stale bytes base is refused before a commit can be accepted.

## Relations

- part-of [[wikiwright-architecture]]
- mapped-in [[repository-layout]]
- verified-by [[testing-guide]]
