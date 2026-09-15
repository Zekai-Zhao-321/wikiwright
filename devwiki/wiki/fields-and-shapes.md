---
type: subsystem
title: "Fields and shapes"
description: "The closed shape vocabulary a frontmatter field is declared in, the value check every field runs, the one pin shape, and the derivation of a title or description from the page."
tags: [kernel]
pin: fbfce1e0c2829ba0bb4bde092946d056ba494ef9
origin: .
covers: [packages/core/src/fields/, packages/core/src/shapes/]
---

# Fields and shapes

## Responsibilities

`packages/core/src/shapes/index.ts` is the closed shape vocabulary. `KIND_KEYS`
(`:30-51`) names every kind — `any`, `string`, `dated-string`, `integer`,
`number`, `boolean`, `enum`, `date`, `datetime`, `list`, `object`, `page-ref`,
`page-ref-list`, `pin` — and the keys each admits; three keys are universal:
`required`, `requires` and `checks` (`:28`). `validateShape` (`:132`)
meta-validates a declared shape at load and returns human-readable problems;
`checkValue` (`:339`) judges a value against a meta-valid shape. `pinFieldOf`
(`:75`) finds the one `pin` field on a type's effective fields with the
sibling `origin` and `covers` names its shape carries (`:61-68`); `COMMIT_ID`
(`:59`) is the pin's value law. `shapeKind`, `shapeRequired`, `shapeRequires`,
`shapeAuto` and `shapeTargetType` (`:102-129`) are the one definition site of
each reading.

`packages/core/src/fields/index.ts` derives the two engine-required fields a
bundle may declare derived: `resolveTitle` (`:23`) falls back to the basename
under `field_sources.title: basename`, `resolveDescription` (`:34`) to the lede
— the first non-empty, non-heading body line (`:13-21`) — under
`field_sources.description: lede`.

## Entry points

- `validateShape` at constitution load
  (`packages/core/src/registry/combine.ts:19`); `checkValue` in the lint pass
  (`packages/core/src/lint/index.ts:287`), which also reads `shapeRequired`
  and `shapeAuto` to decide what is missing (`:247`) and `shapeRequires` for
  the conditional form (`:269-278`).
- `shapeKind` decides whether `new --set` takes text or JSON
  (`packages/cli/src/verbs/new.ts:39-54`).
- `pinFieldOf` is read by the judge's coverage count
  (`packages/core/src/judge/index.ts:375`) and by `freshness`
  (`packages/cli/src/freshness.ts:74-81`).
- `resolveTitle` and `resolveDescription` are read by generation
  (`packages/core/src/generate/index.ts:95`, `:291-292`), search
  (`packages/core/src/search/index.ts:169-170`) and the identity pass
  (`packages/core/src/names/index.ts:112`).

## State

None; every function is pure over the shape and the value it is handed.

## Invariants

- The kind set is closed: an unknown kind or a key a kind does not admit is a
  load error, never a silent pass (`packages/core/src/shapes/index.ts:138-149`).
- `required` is the literal `true`, except on `object`, where it may also be a
  key list (`:151-161`); `requires` is a non-empty list of field names
  (`:162-171`).
- A tightened inherited `string` shape carries every pattern on the chain, and
  a value matches all of them (`:360-366`).
- A `pin` is the full 40- or 64-digit lowercase commit id (`:59`,
  `:444-447`); its shape must name an `origin` sibling (`:250-262`), and lint
  refuses a pin whose origin field is absent
  (`packages/core/src/lint/index.ts:300-315`).
- A `page-ref` is a canonical name: a path is refused and the name it would
  be is named (`:310-316`); `target_type` is matched through the referent's
  chain only when a chain resolver is present, so an absent resolver is
  inapplicable rather than a silent pass (`:322-331`).
- A `date` is a real calendar date, not just a matching string (`:287-292`,
  `:389-392`); `dated-string` wants a date inside the text (`:282-283`).
- `auto` on a `date` is the only frontmatter the engine authors: `on-create`
  or `on-write` (`:87-90`, `:243-248`).

## Failure modes

- Problems from `validateShape` become constitution issues at load; problems
  from `checkValue` become `field-shape` findings, or `malformed-pin` for a
  pin field, each with the field's line
  (`packages/core/src/lint/index.ts:286-299`).
- `frontmatter-set` can fix a `field-shape` or `missing-required-field` only
  where the shape admits exactly one legal value; otherwise the finding queues
  (`packages/core/src/lint/index.ts:256-258`,
  `packages/core/src/fixers/ops.ts:188-196`).

## Relations

- part_of [[judge]]
- mapped_in [[repository-layout]]
- verified_by [[testing-guide]]
