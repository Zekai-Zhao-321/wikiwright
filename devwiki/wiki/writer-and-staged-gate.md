---
type: subsystem
title: "The Writer and the staged gate"
description: "The judged draft writer and staged Git acceptance boundary."
tags: [kernel, cli]
pin:
  commit: b1cade9a4d0d0a868340dbba7c4a02775f4c7b9f
  origin: .
  covers: ["packages/cli/src/verbs/write.ts", "packages/cli/src/verbs/gate.ts", "packages/cli/src/lawstate.ts", "packages/cli/src/writer.ts", "packages/cli/src/ops.ts"]
updated: 2026-09-26
---

# The Writer and the staged gate

## Responsibilities

Write --from reads a directory of drafts and optional ops.json, applies moves and claim lifecycle operations, then judges the full proposed state against disk before landing it. Gate judges the index under staged law with HEAD as base.

## Entry points

Current source at this pin: `packages/cli/src/verbs/write.ts`, `packages/cli/src/verbs/gate.ts`, `packages/cli/src/lawstate.ts`, `packages/cli/src/writer.ts`, `packages/cli/src/ops.ts`.

## State

The writer stages complete file replacements, then renames them into place. Gate uses object-id reads, so staged law, pages and source-path existence are judged together even when the working tree differs. A staged raw-source deletion cannot borrow the working-tree file's existence. Gate cross-checks the staged diff against index and HEAD listings, demotes eligible inherited findings and requires a reason for a law change at commit-message time.

## Invariants

A dry run and a real write agree on refusal and plan paths. Draft bases, pages, source-path membership and law come from one accepted capture, which is checked again after all temporary files are staged and before the first rename. That final check excludes the exact staged temporary paths and newly observed directories containing only those paths; unrelated source entries still change the digest. Every replacement target is preflighted before the first write. One judge decides at both write and commit boundaries.

## Failure modes

A crash between replacements is not batch-atomic. A changed accepted state, blocked destination, source directory that cannot release a moved page, truncated Git answer, unmerged index or stale bytes base is refused before landing or commit.

## Relations

- part-of [[wikiwright-architecture]]
- mapped-in [[repository-layout]]
- verified-by [[testing-guide]]
