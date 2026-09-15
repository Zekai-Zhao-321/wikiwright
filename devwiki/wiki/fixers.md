---
type: subsystem
title: "Fixers and routing"
description: "The closed registry of fixers a finding's fix argv can name, the pure derivations from a finding's details to write ops, and the fix verb that applies, proves and lands them."
tags: [kernel, cli]
pin: a38be783d7393d145ba7950daf1b0ca2c1c4fbad
origin: .
covers: [packages/core/src/fixers/, packages/cli/src/verbs/fix.ts]
---

# Fixers and routing

## Responsibilities

`FIXER_REGISTRY` (`packages/core/src/fixers/index.ts:68-159`) is the closed
set of fixers, each with an `applicability`, the rule ids it can execute today,
an optional `enabled(context)` mode condition and the argv it hands out.
`fixerRegistered` (`:169`) is the static half — does the registry carry this
fixer for this rule — and `fixerExecutes` (`:179`) the vault-aware half; the
folder-tag materializer executes only under `folder_tags.mode:
materialize-add-only` (`:91-97`). `buildFix` (`:190`) renders the `fix`
object a finding carries.

`packages/core/src/fixers/ops.ts` holds the pure derivations from a finding's
own `details` and the page's lines to `WriteOp`s: `headingDepth` (`:46`),
`sectionStub` (`:72`), `folderTags` (`:91`), `linkRewrite` (`:107`),
`tagRename` (`:131`), `retype` (`:162`), `frontmatterSet` (`:175`),
`frontmatterDelete` (`:205`), `historyClose` (`:239`) and `canonicalForm`
(`:264`); `DERIVATIONS` (`:278-289`) and `PURE_FIXERS` (`:292`) list them and
`fixOpsFor` (`:299`) dispatches. The verb `packages/cli/src/verbs/fix.ts`
judges once, derives the ops the named rule licenses, honours `--expect`,
splices every page in memory, judges once more with every fixed page in place,
and writes only when the rule is gone and no new error appeared (`:1-11`).

## Entry points

- `fixCommand` (`packages/cli/src/verbs/fix.ts:318`); `fixerFor` (`:66`)
  reads the composed pass rows and, where a row names no fixer, the registry's
  own rule lists — the opt-in path that exists for `canonical-form` alone
  (`:57-70`).
- `buildFix`, `fixerExecutes`, `fixerRegistered`, `FIXER_REGISTRY`,
  `REGISTERED_FIXERS` (`packages/core/src/fixers/index.ts`); `fixOpsFor`,
  `PURE_FIXERS` (`packages/core/src/fixers/ops.ts`).
- The judge routes through `buildFix` and asks `fixOpsFor` whether the
  derivation succeeds on this page before advertising a fix
  (`packages/core/src/judge/index.ts:212-227`, `:249-256`).
- The proof and the write are the Writer's: `proveWrites` and `commitWrites`
  (`packages/cli/src/writer.ts:58`, `:125`).

## State

None. The registry is a constant; a derivation reads the finding's details
and the page's current bytes and nothing else
(`packages/core/src/fixers/ops.ts:4-8`, `:13-19`).

## Invariants

- Fixability is derived from a registry of operations that exist, never
  authored on a pass-table row (`packages/core/src/fixers/index.ts:1-2`,
  `:63-67`); `unroutableRows` holds a row naming a fixer the registry does not
  carry for that rule (`packages/core/src/passes/index.ts:97-113`).
- A derivation refuses rather than returning an empty op list, which would
  read as "already fixed" to `--expect`
  (`packages/core/src/fixers/ops.ts:294-303`).
- A mechanical write reads values the pass already computed, never syntax it
  re-derives from the message (`:4-8`): `sectionStub` needs `missing_heading`
  (`:73-76`), `linkRewrite` needs `target` and `canonical` and the link on the
  named line (`:108-119`), `frontmatterDelete` needs the key on the named line
  inside the frontmatter (`:206-217`).
- Three applicabilities (`packages/core/src/fixers/index.ts:5`):
  `MachineApplicable` ops apply under `--expect`; `MaybeIncorrect` is only
  `canonical-form`, the one dialect rewrite, applied only when the rule is
  named (`:123-133`); `HasPlaceholders` is only `history-close`, rendered
  under `--propose` and never applied (`:134-139`).
- `frontmatter-set` executes `missing-required-field` and `field-shape` only
  where the shape admits exactly one legal value (`:151-158`,
  `packages/core/src/fixers/ops.ts:188-196`); `retype` and `tag-rename` only
  where one replacement is declared (`:162-172`, `:131-142`).
- The argv names the state the finding lives in: `--staged` when it came from
  the index, none when it came from the working tree
  (`packages/core/src/fixers/index.ts:15-27`, `:54-61`), and only the staged
  mode can disagree with the tree it writes
  (`packages/cli/src/verbs/fix.ts:7-11`).

## Failure modes

- `fixer-refused` when a derivation returns its reason
  (`packages/cli/src/verbs/fix.ts:462`); `expect-mismatch` when the count is
  not `--expect` (`:440`); `working-tree-drift` under `--staged` when the
  working tree differs from the index on a page the fix would write (`:282`).
- The Writer's proof refuses with `not-proved` when the rule still fires on a
  fixed page, or `new-errors` when any page gained an error
  (`packages/cli/src/writer.ts:38-40`, `:73-96`).

## Relations

- part_of [[judge]]
- mapped_in [[repository-layout]]
- verified_by [[testing-guide]]
