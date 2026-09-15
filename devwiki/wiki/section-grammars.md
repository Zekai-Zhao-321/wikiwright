---
type: code-concept
title: "Section grammars"
description: "A section binds a heading at a depth to a grammar and its parameters; the kernel parses the section's top-level items through the grammar's dispatch chain and runs the arms the grammar's module declared, never knowing what a claim or a relation is."
tags: [kernel, stdlib]
pin: a38be783d7393d145ba7950daf1b0ca2c1c4fbad
origin: .
covers: [packages/core/src/grammar/, packages/core/src/modules/index.ts, packages/core/src/lint/index.ts, packages/kit-code/index.js]
---

# Section grammars

## Mechanism

A type's `sections` block declares headings at a depth, each with a `grammar`
and that grammar's parameters. `grammarBindings`
(`packages/core/src/lint/index.ts:856-884`) turns each declared entry into a
`SectionBinding` — heading, aliases, depth, grammar, the parameter record,
the severity knob, the contributor and registry path
(`packages/core/src/grammar/index.ts:41-66`) — and resolves the dispatch chain
there, where the module registry is (`packages/core/src/lint/index.ts:874-877`,
`packages/core/src/modules/index.ts:1305`). A grammar that declines an item
may delegate to another grammar's kind under a declared condition
(`packages/core/src/modules/index.ts:212-224`): the claims grammar hands a
History section's dated line to `entry` (`packages/core/src/stdlib/claims.ts:145-149`),
and the kernel resolves the delegate's owner itself so no module imports
another.

`parseSections` (`packages/core/src/grammar/index.ts:228-321`) walks the body
outside fenced code, opens a section when a heading matches a binding by
identity and depth (`:252-279`), counts non-list lines as prose (`:282-285`),
parses each top-level list item through the chain (`:194-221`, `:316-318`),
attaches an indented bullet to the item above it as rationale — identity-free,
verbatim, never a finding, in every grammar (`:293-299`) — and reports an
indented item with no owner as `unparsed` once, owning the block under it
(`:300-314`). What nothing parsed becomes `unparsed`, which only the kernel
may make (`:184-189`, `:220`). The kernel attaches `line`, `raw` and
`rationale` around the module's own fields, so a module cannot aim a splice
at the wrong bytes (`:126-146`).

`checkGrammar` (`:407-663`) then runs the arms the section's grammar
registered, in declaration order, per item (`:647-651`) and per section
(`:655-660`); an arm speaks only through `emit`, and only under its own id
(`:527-547`). The severity is the row's: a `declared` row takes the section's
`severity` knob, else the arm's declared default, else `warning`; an `info`
row is a census whatever the section says; an `error` row is a law the
section cannot quiet (`:416-424`; `packages/core/src/modules/index.ts:93-105`).
The two vocabulary laws — an alias authored where the canonical entry belongs,
a retired entry authored at all — are the kernel's fixed errors at the site
that authored the value (`:456-491`). An `admits` declaration lets a section
author restrict the kinds its writers may use (`:492-496`, `:581-597`;
`packages/core/src/modules/index.ts:256-272`), and `canonical-form` counts a
line whose dialect differs from the engine's rendering of the same item
(`:598-612`). Where a base exists, `checkSectionTransitions`
(`packages/core/src/lint/index.ts:1205-1343`) parses the base under the one
parser — or takes the page's own parse when the base's normalized bytes are
the page's, and reads no base at all when no arm and no body law would
consume it (`:1216`, `:1226`) — and hands a transition arm both item lists,
another declared section's items by heading, and `emit` and `count`
(`:1284-1315`).

Every parameter a grammar declares carries its own combination law under
`extends` — identity, subset-only, tighten-one-way, keyed-bounds
(`packages/core/src/modules/index.ts:21-79`) — and the registry applies the
grammar's law when a child re-declares an inherited section
(`packages/core/src/registry/combine.ts:659`). A grammar's `edges` hook makes
its items graph edges, and `observes` makes them census rows
(`packages/core/src/modules/index.ts:305-330`).

## Where it lives

- The binding, the parser and the state arms: `packages/core/src/grammar/`
  (part of [[judge]]).
- The registration API, the parameter laws and the resolvers `resolveParsers`,
  `admittedKinds`, `canonicalizeOf`, `edgesOf`, `observedValues`,
  `transitionSeam`: `packages/core/src/modules/index.ts` (see
  [[modules-and-trust]]).
- The bindings' construction and the two lint passes that use them:
  `packages/core/src/lint/index.ts:856`, `:1105`, `:1205`.
- The three shipped grammars: [[standard-library]]. The code kit declares
  sections with the `relations` and `entries` grammars and no grammar of its
  own (`packages/kit-code/index.js:33-40`, `:102-115`).
- The tests: `grammar-parser`, `grammar-arms`, `grammar-v3-arms`,
  `registry-grammar`, `registry-sections` under `packages/core/test/`.

## Relations

- part_of [[wikiwright-architecture]]
