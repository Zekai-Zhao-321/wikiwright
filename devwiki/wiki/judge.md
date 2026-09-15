---
type: subsystem
title: "The judge and its passes"
description: "One pure function turns a vault state and a law into a verdict: the per-page passes, the vault passes, the grammar arms, routing, exceptions, the gate rule, the coverage block and the cap."
tags: [kernel]
pin: a38be783d7393d145ba7950daf1b0ca2c1c4fbad
origin: .
covers: [packages/core/src/judge/, packages/core/src/passes/, packages/core/src/lint/, packages/core/src/grammar/]
---

# The judge and its passes

## Responsibilities

`judge(state, law, options)` (`packages/core/src/judge/index.ts:439`) takes a
`VaultState` — pages as bytes, an optional base map with `null` for a page that
did not exist there, a rename list, and the parses a caller already made
(`:48-60`) — and a `Law` — the flattened registry, the composed module
registry, the vault-level lint options and the policy keys `engine.json`
declared (`:78-91`) — and returns a `Verdict` (`:147-162`): the findings, the
per-page dispositions, a coverage row per pass, the `unevaluated` block, the
summary and the cap flags.

It reads the pages through `parsedPages` (`:63-75`), which parses each
page once per text and keeps the parse on the state, so a verb that parsed
the state for its artifacts, as `check` and the gate do, hands the judge
that parse; an entry whose text has changed since is parsed again.

Per page it calls `lintPage` (`packages/core/src/lint/index.ts:189`), which
runs the frontmatter parse laws first (`:195-217`), then type resolution
(`:220-236`), frontmatter closure and shapes (`:239-353`), tags and folder
alignment (`:356-506`), wikilink resolution (`:509-538`), the abstract and
tombstone laws (`:541-573`), the sections matcher `checkSections` (`:647`), the
`max_chars` budget (`:802`), the section grammars (`:1105`), the transition
arms where a base exists (`:1205`) and the registered checks (`:984`).

The grammar module is the one item parser. `parseSections`
(`packages/core/src/grammar/index.ts:228`) binds headings to their declared
sections by identity and depth and parses each non-prose section's top-level
list items through the section's dispatch chain (`:194-221`); `checkGrammar`
(`:407`) runs the state arms the loaded modules registered for the section's
grammar. `packages/core/src/passes/index.ts` holds the kernel's own
`PASS_TABLE` (`:115`) — every id the kernel emits, with its kind, severity,
fixer and lane — and the closed `KERNEL_LANES` (`:20-36`).

## Entry points

- `judge` (`packages/core/src/judge/index.ts:439`), called by every verb that
  judges: `check` (`packages/cli/src/verbs/check.ts:146`), the staged gate
  (`packages/cli/src/staged.ts:111`) and the Writer's proof
  (`packages/cli/src/writer.ts:82-85`).
- `routeFindings` (`packages/core/src/judge/index.ts:269`), for verbs that
  build findings outside the judge —
  `okf check`, `move`, `new`, `freshness` — so the routing law holds on every
  envelope (`:264-268`); `parsedPages` (`:63`), for a verb that parses a
  state before it judges it.
- `lintPage` (`packages/core/src/lint/index.ts:189`), `checkVaultInstances`
  (`:1350`), `checkOkfCore` (`:1392`), `grammarBindings` (`:856`),
  `evidenceDigestFor` (`:181`), `linkVerdict` (`:101`).
- `parseSections` and `checkGrammar` (`packages/core/src/grammar/index.ts:228`,
  `:407`); `routeOf` and `unroutableRows`
  (`packages/core/src/passes/index.ts:90`, `:102`); `inheritedLines`
  (`packages/core/src/judge/index.ts:312`).

## State

None. Core takes no Node typings, so the judge reads bytes handed to it and
never touches a filesystem, a process or git
(`packages/core/src/judge/index.ts:6-8`). Within one call it holds a name index
built once over the pages or handed in by the caller (`:112-113`, `:441`), the
pass rows composed from the kernel's table and every loaded module's arms and
checks (`:450-451`), and one line-alignment set per page for the gate's
demotion rule (`:583-592`). The parses it reads are the state's, filled by
`parsedPages` and kept on the state for the verb that handed it over.

## Invariants

- Routing is total. Every non-info finding leaves `routeFinding` with a `fix`
  or a `queue` (`:202-235`); a fixer counts only when the closed registry
  executes it for this rule and its derivation succeeds on this page
  (`:214-227`, `:249-256`); a row with no lane throws `finding-unroutable`
  rather than routing by guess (`:228-234`). A finding from a commit's state
  carries `--staged` in its argv (`:218-224`).
- The order is one order. `sortFindings` sorts by path, line, rule id and
  message through code-unit comparison (`:883-894`); the cap fills error-first
  and changes membership only (`:168-181`); `summary` and the exit code are
  computed over the uncapped filtered set, and `caps.hit` says when the cap
  cut (`:652-683`).
- Coverage names what did not run. A shell pass this run did not perform is
  `not_applicable`, reason `capability-unavailable` (`:482-489`); a pass whose
  input is an external origin is `external-origin` on every judging verb
  (`:490-498`); a `needsBase` pass with no base is `no-base`, and a
  type-declared, non-info one counts toward `unevaluated` (`:506-524`).
- The gate demotes what the commit inherited. Under `gate: true`, a queued
  error on a line the base already held becomes a warning carrying
  `demoted_from` (`:603-614`), never for the parse laws, identity collisions,
  `instances` or `exception-illegal` (`:731-738`), never when `config/`
  changed (`:605`); a finding a rename caused on an untouched page is re-asked
  against the name index the base held and stays visible (`:568-580`,
  `:629-640`, `:692-696`).
- A waiver is keyed by evidence, not by line: `exceptions` entries match a
  queued finding's `evidenceDigest` (`:534-561`), a stale one is a warning and
  one naming a fix-routed row, a census row or a law is an error (`:754-833`).
- A parse law refuses before the shape arms run: a frontmatter block the
  parser could not read is judged on its parse findings alone, while a
  duplicate key still judges the page as it reads
  (`packages/core/src/lint/index.ts:209-217`).
- The title line is not a section: when a type's sections live at depth 2 or
  deeper, the page's first depth-1 heading takes no part in the sections pass
  (`packages/core/src/lint/index.ts:694-701`); the matcher is ordered, greedy
  and never backtracks (`:646`).
- An arm may emit only the id it declared (`packages/core/src/grammar/index.ts:527-547`,
  `packages/core/src/lint/index.ts:1295-1300`), and a `needsBase` arm never runs
  in the state-arm loop (`packages/core/src/grammar/index.ts:512-520`).

## Failure modes

- `finding-unroutable` and `no pass-table row` are thrown, not routed: an
  engine defect, surfaced as `unexpected-error` at exit 1
  (`packages/core/src/judge/index.ts:234`,
  `packages/core/src/grammar/index.ts:452-453`).
- A module's arm or parser that throws becomes one attributed
  `module-failure` finding naming the module, its version and the arm, and the
  vault still has a verdict (`packages/core/src/grammar/index.ts:548-580`,
  `:613-633`; `packages/core/src/lint/index.ts:1316-1339`).
- `exception-illegal` (error) and `exception-stale` (warning) on the
  `exceptions` key's line (`packages/core/src/judge/index.ts:768-831`).
- `renamed-without-alias` when a rename in the state drops the old basename
  without an alias, unless the rename only moved the page between directories
  or changed the case of its basename (`:843-873`).

## Relations

- part_of [[wikiwright-architecture]]
- mapped_in [[repository-layout]]
- verified_by [[testing-guide]]
