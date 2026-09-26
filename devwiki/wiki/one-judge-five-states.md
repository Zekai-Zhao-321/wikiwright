---
type: code-concept
title: "One judge, five states"
description: "Historical name for the v1 state map; the v2 judge receives four states."
tags: [kernel, cli]
status: retired
pin:
  commit: b1cade9a4d0d0a868340dbba7c4a02775f4c7b9f
  origin: .
  covers: ["packages/cli/src/lawstate.ts", "packages/core/src/verdict/judge.ts", "CHANGELOG.md"]
updated: 2026-09-26
---

# One judge, five states

## Mechanism

This page's v1 title is historical. V2 uses one judge and four constructors: working tree, drafts over disk, index over HEAD and a revision. The old replay and stdin-specific state left.

A working-tree read has no base, a draft uses disk, an index uses HEAD and a revision read has no transition base. Every state carries law bytes and source-path existence facts selected from the same source as its pages. The judge reads no raw source bytes.

A transition without a base is unevaluated. The judge property tests compare equivalent states rather than maintaining separate write-path semantics.

## Where it lives

Current disposition at this pin: `packages/cli/src/lawstate.ts`, `packages/core/src/verdict/judge.ts`, `CHANGELOG.md`.

Counting the old five states as live would suggest the deleted replay and stdin paths still protect a write. They do not exist in the v2 command table.

## Relations

- part-of [[wikiwright-architecture]]
