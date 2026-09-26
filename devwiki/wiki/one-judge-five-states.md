---
type: code-concept
title: "One judge, five states"
description: "Historical name for the v1 state map; the v2 judge receives four states."
tags: [kernel, cli]
status: retired
pin:
  commit: 37eb1f1ddee7cf0a52958e883191695b2947b17b
  origin: .
  covers: ["packages/cli/src/lawstate.ts", "packages/core/src/verdict/judge.ts", "CHANGELOG.md"]
---

# One judge, five states

## Mechanism

This page's v1 title is historical. V2 uses one judge and four constructors: working tree, drafts over disk, index over HEAD and a revision. The old replay and stdin-specific state left.

A working-tree read has no base, a draft uses disk, an index uses HEAD and a revision read has no transition base. Every state carries law bytes selected from the same source as its pages.

A transition without a base is unevaluated. The judge property tests compare equivalent states rather than maintaining separate write-path semantics.

## Where it lives

Current disposition at this pin: `packages/cli/src/lawstate.ts`, `packages/core/src/verdict/judge.ts`, `CHANGELOG.md`.

Counting the old five states as live would suggest the deleted replay and stdin paths still protect a write. They do not exist in the v2 command table.

## Relations

- part-of [[wikiwright-architecture]]
