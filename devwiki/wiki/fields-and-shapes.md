---
type: subsystem
title: "Fields and shapes"
description: "Effective JSON Schema shapes, reserved fields, RE2 patterns and page-reference checks."
tags: [kernel]
pin:
  commit: b1cade9a4d0d0a868340dbba7c4a02775f4c7b9f
  origin: .
  covers: ["packages/core/src/schema/shapes.ts", "packages/core/src/schema/reserved.ts", "packages/core/src/schema/ajv.ts", "packages/core/src/law/engine.ts"]
---

# Fields and shapes

## Responsibilities

A type's fields are a JSON Schema object. The engine composes reserved frontmatter keys, fragments, ancestors and the concrete type into one effective shape. Registered extensions close its top-level property set.

## Entry points

Current source at this pin: `packages/core/src/schema/shapes.ts`, `packages/core/src/schema/reserved.ts`, `packages/core/src/schema/ajv.ts`, `packages/core/src/law/engine.ts`.

## State

The loader compiles shapes with strict Ajv and RE2, then the judge validates each page. The engine supplies page-ref, page-ref-list and pin definitions, three formats and target-type and target-root checks. A pin origin cannot be blank; `local_origins` declares explicit local Git bindings, while source roots cannot overlap generated output.

## Invariants

A child can tighten but not relax an ancestor's supported constraints. Authored closure at the top of fields is refused so the engine can close the union once after composition.

## Failure modes

Unsupported formats or keywords, incompatible inheritance and invalid defaults stop law loading. A page outside its effective shape receives page-shape-invalid or page-ref-type.

## Relations

- part-of [[judge]]
- mapped-in [[repository-layout]]
- verified-by [[testing-guide]]
