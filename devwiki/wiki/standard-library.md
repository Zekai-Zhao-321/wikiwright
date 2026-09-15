---
type: subsystem
title: "The standard library"
description: "Three first-party modules — claims, relations, entries — registered through the same API a domain kit uses, composed by standardLibrary(), and never imported by the kernel."
tags: [stdlib]
pin: 309d7803464bd22e9db7dc54beff14a1c27802c4
origin: .
covers: [packages/core/src/stdlib/]
---

# The standard library

## Responsibilities

`packages/core/src/stdlib/index.ts` is the composition point and the only file
under `stdlib/` the outside world imports (`:4-7`): `STANDARD_LIBRARY`
(`:14`) lists the three manifests in load order and `standardLibrary()`
(`:22`) composes them through `loadModules`, throwing when the shipped modules
collide with each other (`:24-27`).

**`claims`** (`packages/core/src/stdlib/claims.ts:84`) owns two vocabularies —
`categories`, whose entries carry a lifecycle `class` of `supersede`,
`accumulate` or `journal-only` and an `owned_by.not_on` negative selector over
types and tags (`:101-120`), and `sources`, a closed tag set with no properties
of its own (`:121-123`) — and the `claims` grammar (`:126`): item kind `claim`,
form `- [category] core (provenance)` (`:127-128`), parser `parseClaim`
(`packages/core/src/stdlib/claims-parse.ts:409`), identity and correction
predicates (`packages/core/src/stdlib/claims.ts:136-144`), a delegation to the `entry` kind under `role:
history` (`:149`), the `items` allow-list (`:154`), the `【】` to `[]`
canonicalization (`:159-162`), the census hook (`:167-176`), nine parameters
with their combination laws (`:177-240`) and fourteen arms from
`unknown-category` (`:244`) to `claim-landing` (`:523`). It registers the lane
`provenance-backfill` (`:96`) and one skill fragment on lifecycle classes
(`:88-93`). The transition semantics — what a supersession, a correction and a
landing mean — live in `claims-transition.ts` (`claimTransitions` at `:215`,
`transitionArm` at `:359`, `landingArm` at `:383`).

**`relations`** (`packages/core/src/stdlib/relations.ts:178`) registers the
lane `label-review` (`:181`), the `relations` vocabulary whose one property is
a label's `range` over type names (`:183-192`), and the `relations` grammar
(`:194`): item kind `relation`, form `- label [[Target]]` (`:195-196`), parser
`parseRelation` with a Unicode letter-or-digit label (`:31-51`), an identity of
label and target (`:82-89`, `:204-205`), the census hook (`:207-210`), the
`edges` hook that makes a relation a labelled edge (`:211-222`), the `require`
parameter under the keyed-bounds law (`:223-245`) and `history` (`:246-255`),
and six arms: `unknown-label` (`:261`), `relation-range` (`:287`) through
`rangeAdmits` (`:64-70`), `relation-target-unresolved` (`:315`),
`relation-removed` over the section's transition (`:338`, `:122-160`),
the `relation-retired` census (`:367`) and the per-section `relation-require`
(`:386`).

**`entries`** (`packages/core/src/stdlib/entries.ts:65`) registers the
`entries` grammar: item kind `entry`, form `- YYYY[-MM[-DD]] — text`
(`:68-70`), the EDTF-lite parser `parseEntry` (`:29-63`), the em-dash
canonicalization (`:75-80`), the `date` parameter (optional tightens to
required) and `lifecycle` (free tightens to append-only, effect
`forbids-mutation`) (`:81-96`), and two arms, `entry-date-missing` (`:98`) and
the base-comparing `entry-mutated` (`:125`).

## Entry points

- The three default exports and `STANDARD_LIBRARY` / `standardLibrary`
  (`packages/core/src/stdlib/index.ts:14`, `:22`); the CLI composes
  `[...STANDARD_LIBRARY, ...loaded]` when a bundle declares modules
  (`packages/cli/src/vaultio.ts:222`) and calls `standardLibrary()` otherwise
  (`:182`).
- The package barrel re-exports the item parsers and shapes for a bundle's
  tools — `parseClaim`, `claimHandle`, `PROVENANCE_FORMS`, `parseEntry`,
  `parseRelation`, `rangeAdmits` — while the kernel reaches none of them
  (`packages/core/src/index.ts:220-248`).

## State

None. A module reads only the `ArmContext` or `TransitionContext` the kernel
hands it and speaks only through `emit` and `count`
(`packages/core/src/stdlib/entries.ts:107-118`, `:132-148`).

## Invariants

- The kernel imports nothing from `stdlib/`, type-only imports included; the
  registry is handed to it as `Law.modules`
  (`packages/core/src/stdlib/index.ts:4-7`), and
  `packages/core/test/kernel-import-boundary.test.ts` scans every kernel
  module's import specifiers to hold it.
- One predicate per question: `rangeAdmits` is read by the `relation-range`
  arm and by `vocabulary show` so the verb and the finding cannot disagree
  (`packages/core/src/stdlib/relations.ts:53-63`); `relationIdentity` is the
  one string the kernel's diff matches on (`:76-89`).
- A relation that leaves a page leaves a record: `relation-removed` names the
  label and target of every base relation the draft dropped without quoting it
  in a new History line (`:104-160`, `:338-364`).
- Every parameter declares its own combination law and introduction depth
  (`packages/core/src/stdlib/claims.ts:177-240`,
  `packages/core/src/stdlib/entries.ts:81-96`); `forms`, `sources` and `role`
  may not be first-declared by a child on an inherited grammar
  (`packages/core/src/stdlib/claims.ts:183-186`).
- Two behaviours are preserved rather than corrected, and say so: an aliased
  category never triggers `owned-by` (`packages/core/src/stdlib/claims.ts:57-76`),
  and a registered category with no `class` reads as unregistered (`:45-55`).

## Failure modes

- A self-collision among the shipped manifests throws at `standardLibrary()`
  (`packages/core/src/stdlib/index.ts:24-27`) — an engine defect, not a
  bundle's.
- An arm that throws is one attributed `module-failure` on one item, reported
  by the judge (`packages/core/src/grammar/index.ts:548-580`); the module's
  own verdict for that pass is unknown on that page.
- `unknown-label` fires only under a `registered` vocabulary; under `census`
  the label is counted, not refused
  (`packages/core/src/stdlib/relations.ts:274-275`).

## Relations

- part_of [[wikiwright-architecture]]
- mapped_in [[repository-layout]]
- verified_by [[testing-guide]]
