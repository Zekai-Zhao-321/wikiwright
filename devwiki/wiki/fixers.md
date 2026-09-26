---
type: subsystem
title: "Fixers and routing"
description: "The surviving mechanical fixes: folder-tag materialization and generated-artifact refresh."
tags: [kernel, cli]
pin:
  commit: 179fb9f6edc0eec03b113c33bd5c2c0648231ff2
  origin: .
  covers: ["packages/cli/src/verbs/check.ts", "packages/core/src/verdict/folders.ts", "packages/cli/src/generated.ts"]
---

# Fixers and routing

## Responsibilities

Check --fix can add missing folder tags under materialize-add-only policy and implies check --write for generated artifacts. Generated drift names check --write as its fix.

## Entry points

Current source at this pin: `packages/cli/src/verbs/check.ts`, `packages/core/src/verdict/folders.ts`, `packages/cli/src/generated.ts`.

## State

The fixer plans changes from the same judged working-tree state and supports --dry-run. Other v1 per-page fixers left with the old fix verb.

## Invariants

A fix is offered only where the engine has a mechanical operation it can prove. Judgment findings route to a queue instead.

## Failure modes

Under validate mode, a missing folder tag queues review instead of editing. A direct edit or a crash between artifact replacements can leave drift for the next check.

## Relations

- part-of [[judge]]
- mapped-in [[repository-layout]]
- verified-by [[testing-guide]]
