---
type: subsystem
title: "Fixers and routing"
description: "The surviving mechanical fixes: folder-tag materialization and generated-artifact refresh."
tags: [kernel, cli]
pin:
  commit: 5e9abce0e1f7ae60507b3ec1c6ef22663f72d245
  origin: .
  covers: ["packages/cli/src/verbs/check.ts", "packages/core/src/verdict/folders.ts", "packages/cli/src/generated.ts"]
updated: 2026-09-26
---

# Fixers and routing

## Responsibilities

Check --fix can add missing folder tags under materialize-add-only policy and implies check --write for generated artifacts. Generated drift names check --write as its fix.

## Entry points

Current source at this pin: `packages/cli/src/verbs/check.ts`, `packages/core/src/verdict/folders.ts`, `packages/cli/src/generated.ts`.

## State

The fixer plans changes from the same judged working-tree state and supports --dry-run. Check --summary reports the fixed-page count and generated files written without hiding the detailed dry-run path plan. Other v1 per-page fixers left with the old fix verb.

## Invariants

A fix is offered only where the engine has a mechanical operation it can prove. Judgment findings route to a queue instead.

## Failure modes

Under validate mode, a missing folder tag queues review instead of editing. Under materialize-add-only, a proposed tag that violates the effective shape is refused before any fix lands. Page fixes and generated artifacts are staged together; an unwritable generated directory is refused before pages change. A direct edit or a crash between artifact replacements can leave drift.

## Relations

- part-of [[judge]]
- mapped-in [[repository-layout]]
- verified-by [[testing-guide]]
