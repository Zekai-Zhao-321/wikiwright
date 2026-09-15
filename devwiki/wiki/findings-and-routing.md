---
type: code-concept
title: "Findings and total routing"
description: "Every error or warning finding carries exactly one of a runnable fix and a queue lane; an info finding is a census row; the property is held statically over the pass table and at runtime over every emit path."
tags: [kernel]
pin: a38be783d7393d145ba7950daf1b0ca2c1c4fbad
origin: .
covers: [packages/core/src/passes/index.ts, packages/core/src/modules/index.ts, packages/core/src/judge/index.ts, packages/core/src/fixers/index.ts, packages/cli/src/envelope.ts, packages/cli/src/brief.ts, tools/render-playbook.ts]
---

# Findings and total routing

## Mechanism

A finding is one record: `ruleId`, `severity`, `path`, an optional `line`, a
`message`, the pass that emitted it, `fix` or `queue`, `remediation`,
`contributedBy`, `layer`, `breadcrumb`, `hint`, `registryPath`,
`evidenceDigest` and machine `details`
(`packages/core/src/lint/index.ts:48-80`). The route is the instruction. In
`routeFinding` (`packages/core/src/judge/index.ts:202-235`) an info finding
gets neither; otherwise the finding's row is looked up in the composed table —
the kernel's `PASS_TABLE` plus one row per arm and check a loaded module
registered (`packages/core/src/modules/index.ts:612`) — and the finding is
fix-routed when a fixer in the closed registry executes this rule in this
vault and its derivation succeeds on this page (`:214-227`, `:249-256`), else
queued to the row's lane (`:231`), else thrown as `finding-unroutable`
(`:234`).

The two halves are held separately. Statically, `unroutableRows`
(`packages/core/src/passes/index.ts:102-113`) walks the table: an info row may
name neither a fixer nor a lane, and every other row must name a fixer the
registry carries for that rule or a lane; `loadModules` refuses a module arm
or check that is not a census and names no lane
(`packages/core/src/modules/index.ts:950-953`), and a lane a module names must
be one it or the kernel registered (`:954-957`, `:898-917`). At runtime,
`routeFindings` (`packages/core/src/judge/index.ts:269-277`) binds the verbs
that emit outside the judge — `okf check`, `move`, `new`, `freshness` — to the
same xor.

A queued finding carries an `evidenceDigest`, sha256 over the rule, the path
and the item's own evidence, never its line
(`packages/core/src/lint/index.ts:174-183`), so a page-level waiver survives
a moved line (`packages/core/src/judge/index.ts:534-561`). The fix argv names
the state the finding lives in (`packages/core/src/fixers/index.ts:15-27`).
The verdict also names what did not run: a coverage row per pass with
`evaluated`, `not_applicable`, `unevaluable` and a reason, and an
`unevaluated` block keyed by pass (`packages/core/src/judge/index.ts:122-145`,
`:476-526`). The cap fills error-first so a gate never blocks on a finding it
did not print (`:168-181`).

## Where it lives

- The table and the lanes: `packages/core/src/passes/index.ts`; the composed
  rows: `packages/core/src/modules/index.ts:599-631`.
- The route and the exceptions: `packages/core/src/judge/index.ts:183-301`,
  `:329-360`, `:753-833`.
- The fixers a route may name: [[fixers]].
- The arms' own rows and lanes, declared beside the arms:
  [[standard-library]]; a kit that declares no arm declares no lane (D-004).
- The envelope every judging verb prints: `verdictEnvelope`
  (`packages/cli/src/envelope.ts:87-98`); the brief's "Findings" paragraph
  counts the fix-routed rows (`packages/cli/src/brief.ts:182-188`); the
  maintainer skill's playbook is rendered from the same table
  (`tools/render-playbook.ts:1-7`).
- The tests: `packages/cli/test/routing-xor.test.ts` (every finding on every
  corpus) and `packages/cli/test/pass-table.test.ts` (the table's static
  laws), named in `docs/architecture.md`.

## Relations

- part_of [[wikiwright-architecture]]
