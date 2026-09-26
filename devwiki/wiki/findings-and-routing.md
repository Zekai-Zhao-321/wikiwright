---
type: code-concept
title: "Findings and total routing"
description: "The verdict table, one route per finding and separate coverage and unevaluated counts."
tags: [kernel]
pin:
  commit: 5e9abce0e1f7ae60507b3ec1c6ef22663f72d245
  origin: .
  covers: ["packages/core/src/verdict/table.ts", "packages/core/src/verdict/judge.ts", "packages/cli/src/envelope.ts", "tools/render-playbook.ts"]
updated: 2026-09-26
---

# Findings and total routing

## Mechanism

The judge emits findings with rule id, severity, path, location, message and details. The verdict table gives every error or warning exactly one fix or queue lane; informational findings have neither.

The verdict includes a rule census, coverage by id and reasons for unevaluated checks. It separately counts governed, prose and unbound physical heading regions, parsed records and malformed governed items. A prose or unbound region is not a passed claim check. The CLI caps displayed findings without changing the full summary or exit decision; `check --summary --out` saves the uncapped selected detail while stdout stays compact.

A page counts as evaluated for a pass only when all its applicable obligations were measured; one unavailable sibling makes the page unevaluated, even when a known failing obligation still emits a finding. Not applicable means the pass did not govern the page. A transition without a base is unevaluated, not a green evaluation.
A source-only change can make a declared rule fail on an untouched citing
page. The gate rejudges that page against the base name index before deciding
whether a new finding is inherited.
Literal source-path findings distinguish missing, wrong-kind and unmeasured
selected-state paths. Pin coverage absent at its own commit is a queued
warning; an unbound origin is informational and never counted as current.

## Where it lives

Current source at this pin: `packages/core/src/verdict/table.ts`, `packages/core/src/verdict/judge.ts`, `packages/cli/src/envelope.ts`, `tools/render-playbook.ts`.

An unroutable finding is an engine defect. A queued judgment is not made true by changing its severity or by hiding it from an output cap.

## Relations

- part-of [[wikiwright-architecture]]
