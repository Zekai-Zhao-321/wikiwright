---
type: code-concept
title: "One judge, five states"
description: "Every write path — the working tree, the staged gate, a draft on stdin, a write, a replay of history — constructs a state and calls the one judge under the one law, so no verb can be told one thing at write time and another at the gate."
tags: [kernel, cli]
pin: 11409794f5ab7f6a8fde671a8b7fb9c568bb8dd0
origin: .
covers: [packages/core/src/judge/index.ts, packages/cli/src/state.ts, packages/cli/src/writer.ts, packages/cli/src/staged.ts, packages/cli/src/law.ts, packages/cli/src/verbs/lint.ts, packages/cli/src/verbs/check.ts, packages/cli/src/verbs/fix.ts, packages/cli/src/verbs/write.ts]
---

# One judge, five states

## Mechanism

`judge(state, law, options)` is one pure function
(`packages/core/src/judge/index.ts:439`). A state is a map from page path to
bytes, optionally with a base map — the bytes each page had before, or `null`
for a page that did not exist — and a rename list (`:43-60`); the judge
parses each page once per text and keeps the parse on the state
(`:63-75`). The shell constructs a state and hands it over; the judge never
reads a filesystem, a process or git (`:6-8`). Four constructors in `packages/cli/src/state.ts`
answer "which bytes, against which base" (`:3-4`): `fsState` (`:33-40`) for
`lint` and `check`, no base; `indexState` (`:86-180`) for `lint --staged` and
`gate`, the index's bytes against HEAD over one `indexSnapshot` of the
index (`:60-81`), every staged page and every base read in one batch
(`:132-139`), with an unchanged page based on its own staged content and
a deletion kept as a base fact; `overlayState`
(`:182-211`) for `lint --stdin`, `write`, `write --from`, `new` and `fix`, the
vault with every draft in place of its page and the disk bytes as each base;
`revisionState` (`:294-340`) for `lint --since`, one commit's tree against its
first parent, walked by `commitPairs` (`:213-249`). The fifth path is the
proof: every writing verb calls the judge a second time over the spliced bytes
before a byte lands (`packages/cli/src/writer.ts:48-71`), which is why the
count of paths exceeds the count of constructors.

The law is built in one place: `lawFor`
(`packages/cli/src/law.ts:63-84`) turns a loaded vault into the registry,
the composed module set the loader validated the constitution under, the lint
options `engine.json` declares and the policy keys, so `lint`, `check`, `gate`
and `write` cannot drift apart. The commit constructors run under `gate:
true`, which turns on line-scoped severity and the change scoping and makes
every fix argv say `--staged` (`packages/core/src/judge/index.ts:93-99`,
`:537-540`); `configChanged` suspends the demotion (`:432-434`, `:605`).
A verb that reports findings without judging — `okf check`, `move`, `new`,
`freshness`, `export` — routes them through the same xor with `routeFindings`
(`:264-277`). The exports' findings ride into the judge as shell findings,
planned from the same state's pages: the working tree's under `check`
(`packages/cli/src/verbs/check.ts:83-90`, `:116-121`), the index's under the
staged gate, a kit declared by `path` loaded from its staged bytes for
the plan (`packages/cli/src/staged.ts:79-117`, `:165-189`; see [[exports]]).

Whichever state a verb builds, its envelope names the bundle it was built
over: `metadata.bundle` carries the root, the checkout, a digest of the
pages and the law digest over the config and module bytes the law is built
from (`packages/cli/src/bundle.ts:42-59`, `:156-202`;
see [[command-runtime]]). A bundle named by `--bundle`
is resolved to the root `--root` would name before any module loads, so it is
judged by the same constructors under the same law; the runtime's refusals —
`one-target`, `bundle-name-invalid`, `bundle-not-found`, `bundle-ambiguous`,
and over a marked root `export-marker-invalid` and `bundle-readonly` — are
answered before a verb builds a state, and
are envelope errors, not findings (see [[command-runtime]] and
[[envelope-and-exit-codes]]). A constructor reads git through a file git
writes itself, and holds the answers to their terminators, their counts
and each other, so a cut or contradictory index listing, tree or commit walk
is refused as `git-short-read` or `git-inconsistent-read` rather than judged
as a smaller state (see [[git]]).

The property is held by a test that judges one fixture through every
constructor and asserts the per-page findings agree, under Bun and under
Node (`packages/cli/test/judge-property.test.ts:1-11`). That test's header
counts the four constructors and the Writer's proof, the fifth path, as
this page does.

## Where it lives

- The judge: [[judge]] (`packages/core/src/judge/index.ts`).
- The constructors and the proof: [[writer-and-staged-gate]]
  (`packages/cli/src/state.ts`, `packages/cli/src/writer.ts`,
  `packages/cli/src/staged.ts`).
- The law: `packages/cli/src/law.ts` (see [[command-runtime]]).
- The verbs that choose a constructor: `packages/cli/src/verbs/lint.ts:62`,
  `:84`, `:101`, `:210`; `packages/cli/src/verbs/check.ts:171`;
  `packages/cli/src/verbs/fix.ts:42`; `packages/cli/src/verbs/write.ts:53`.
- The test: `packages/cli/test/judge-property.test.ts`, with `staged-gate`,
  `lint-verb`, `write-verb` and `relation-lifecycle` beside it
  (`docs/architecture.md`, the invariant table).

## Relations

- part_of [[wikiwright-architecture]]
