---
type: subsystem
title: "The judge and its passes"
description: "The one v2 judge over page shape, grammar, rules, transitions and law tests."
tags: [kernel]
pin:
  commit: 1a1a90c11329d82c9b2c6e92c6fa8e16160c0613
  origin: .
  covers: ["packages/core/src/verdict/judge.ts", "packages/core/src/verdict/grammar.ts", "packages/core/src/verdict/rules.ts", "packages/core/src/verdict/lawtests.ts"]
updated: 2026-09-27
---

# The judge and its passes

## Responsibilities

JudgeTypeLaw reads pages under the type-document law, checks frontmatter shape, declared section scope, fixed records, vocabularies, references and CEL rules, and reports coverage and routes. A governed H3 or H4 body is judged under its effective policy, with its items owned by that physical heading once.

## Entry points

Current source at this pin: `packages/core/src/verdict/judge.ts`, `packages/core/src/verdict/grammar.ts`, `packages/core/src/verdict/rules.ts`, `packages/core/src/verdict/lawtests.ts`.

## State

Working-tree, draft, index and revision constructors hand it page bytes, source-path existence facts and the matching law. A base exists for drafts and the index, so transition checks can compare the prior page. A recognized source path can be present, missing, wrong-kind or unmeasured; pure-core callers without source facts do not receive a false pass.
Current claim page citations resolve against the accepted state's names;
`before` citations resolve against the base's names. This lets a source-only
retype make a declared rule fail on an unchanged citing page. Rule-test twins use
the selected test corpus's names for both sides.

## Invariants

The same state and law yield the same verdict. Tests and examples run through the same judge but do not count as content instances. Coverage marks a page unevaluated when one applicable pin obligation is unavailable, even if another known obligation produces a finding; it does not label that page not applicable.

## Failure modes

An invalid law stops before page judgment. A rule that errors or returns a nonboolean result reports rule-error; a missing base is unevaluated rather than passed.

## Relations

- part-of [[wikiwright-architecture]]
- mapped-in [[repository-layout]]
- verified-by [[testing-guide]]
