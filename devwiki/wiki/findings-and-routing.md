---
type: code-concept
title: "Findings and total routing"
description: "The verdict table, one route per finding and separate coverage and unevaluated counts."
tags: [kernel]
pin:
  commit: 179fb9f6edc0eec03b113c33bd5c2c0648231ff2
  origin: .
  covers: ["packages/core/src/verdict/table.ts", "packages/core/src/verdict/judge.ts", "packages/cli/src/envelope.ts", "tools/render-playbook.ts"]
---

# Findings and total routing

## Mechanism

The judge emits findings with rule id, severity, path, location, message and details. The verdict table gives every error or warning exactly one fix or queue lane; informational findings have neither.

The verdict includes a rule census, coverage by id and reasons for unevaluated checks. The CLI caps displayed findings without changing the full summary or exit decision.

A pass with evaluated zero cannot sit beside its own finding. A transition without a base is unevaluated, not a green evaluation.

## Where it lives

Current source at this pin: `packages/core/src/verdict/table.ts`, `packages/core/src/verdict/judge.ts`, `packages/cli/src/envelope.ts`, `tools/render-playbook.ts`.

An unroutable finding is an engine defect. A queued judgment is not made true by changing its severity or by hiding it from an output cap.

## Relations

- part-of [[wikiwright-architecture]]
