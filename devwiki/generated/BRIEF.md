# wikiwright — the brief of `devwiki`

Generated file — do not edit; regenerate with `wikiwright check --write`.

Law digest: `5ca450f785b525dd59dfc765173a7444bf2be8aad5024b52258a4ceefec45e86`

## The loop

Use the engine to decide, to write and to attribute; use your own tools to look.

### Reading (the consumer)

1. `search` every name form, in both scripts, before you say a thing is absent; never claim absence while `caps.hit` is true.
2. `read` the sections the task needs. Keep the envelope's `metadata.bundle` and the page's `bytes` digest beside what you took.
3. Read `status` on every page you use: `stale: true` or an `unresolved` rule is material due for reconsideration, not settled knowledge.
4. Report a knowledge problem as a proposal to the bundle's maintainer; never edit a bundle you were given to read.

### Writing (the writer)

1. `search` every name form before you create anything.
2. `type show <type> --brief`: the contract, the skeleton to write from, the vocabularies with live counts.
3. Draft the pages in a directory that mirrors the vault's paths, with an `ops.json` for a move, a retirement, a retraction or a supersession; `write --from <dir> --dry-run` and read the findings.
4. `write --from <dir>`: the batch is judged together and lands only whole; the engine stamps `created` and `updated` where the type declares them.
5. Commit. The gate runs the same judge over what the commit would contain.

### Maintaining (the maintainer)

1. `check` the whole bundle. A finding with `queue` is a judgment: adjudicate it or change the law, and never lower a severity to quiet it.
2. A rule learned from a defect: `rule try` it first, then add it with its rule tests (a negative page, its repaired twin, a positive page).
3. A commit that relaxes the law carries a body line `law-change: <reason>`; a decision page records why.
4. `check --write` and commit `generated/` with the pages it describes.

## Findings

A finding with `fix` names the argv that repairs it. A finding with `queue` is a
judgment for the maintainer; at the gate, a queued error on a line the commit did
not touch is a warning, not a block. An `unevaluated` finding is a check this
state could not make, never a pass.

## Verbs

### `check` — the whole bundle, its pins and its generated files

`wikiwright check` — flags: --write --fix --limit <v> --rule <v> --path <v> --all --summary --dry-run

```text
wikiwright check
```

### `gate` — what a commit would contain, run by the hooks

`wikiwright gate` — flags: --commit-msg <v> --limit <v> --rule <v> --path <v> --all

```text
wikiwright gate
```

### `read` — a page's sections, its digest and its status

`wikiwright read <page>` — flags: --section <v> --budget <v>

```text
wikiwright read wiki/Basil.md
```

### `rule` — a candidate rule over the pages it would govern, before it is law

`wikiwright rule <try>` — flags: --type <v> --section <v> --section-path <v> --expr <v> --config <v> --base <v>

```text
wikiwright rule try --type planting --expr "has(page.fields.source)"
```

### `search` — before creating anything, and before claiming absence; each result carries its status

`wikiwright search [query]` — flags: --type <v> --tag <v> --title-contains <v> --limit <v> --all --near --items --files --band <v>

```text
wikiwright search basil
```

### `type` — the contract you are about to satisfy, with its skeleton

`wikiwright type <list|show> [name]` — flags: --brief --concrete

```text
wikiwright type show planting
```

### `version` — which engine build is answering

`wikiwright version`

```text
wikiwright version
```

### `write` — the one write: a directory of drafts and an optional ops.json, judged together

`wikiwright write` — flags: --from <v> --dry-run

```text
wikiwright write --from drafts --dry-run
```

## Types

- `architecture-overview` (concept) — The whole-system view organized around owned systems, not the source tree.
  - Avoid when: One subsystem's internals (subsystem) or directory listings (source-map). (declared by `code/architecture-overview`)
- `charter` (hub) — Exactly one page — meta/charter.md: the bundle's intention and scope, loaded every session. Not the agent operating manual (CLAUDE.md / AGENTS.md).
  - Avoid when: Anything that is a setting, a decision record, or content. (declared by `charter`)
- `code-concept` (concept) — A mechanism (an invariant, a pattern, a data shape) spanning subsystems.
  - Avoid when: Anything with a single home (subsystem). (declared by `code/concept`)
- `decision` (reference) — A choice a later reader must be able to revisit: a dependency taken, a boundary drawn, a mechanism rejected.
  - Avoid when: Content; a setting; the current shape of a component (subsystem). (declared by `code/decision`)
- `integration` (concept) — Third-party services, protocols, or consumed APIs.
  - Avoid when: Internal components (subsystem). (declared by `code/integration`)
- `ops-reference` (reference) — Facts contributors look up, never read linearly.
  - Avoid when: Anything needing narrative. (declared by `code/ops-reference`)
- `quickstart` (procedure) — The single from-zero on-ramp; one page per bundle.
  - Avoid when: The testing story (testing-guide) or command references (ops-reference). (declared by `code/quickstart`)
- `source-map` (reference) — Answering "where does X live" mechanically.
  - Avoid when: Explaining how anything works (subsystem, concept). (declared by `code/source-map`)
- `subsystem` (concept) — A coherent component with its own boundaries and behaviour, described from its code at one commit.
  - Avoid when: Whole-system views (architecture-overview), cross-cutting mechanisms (concept), or a directory listing (source-map). (declared by `code/subsystem`)
- `testing-guide` (procedure) — The testing story: runners, fixtures, conventions; the target of verified-by.
  - Avoid when: Individual command lookups (ops-reference) or the on-ramp (quickstart). (declared by `code/testing-guide`)

## Vocabularies

### `code/relations` (registered)

- `decided-by` — The decision record that shaped this subject.
- `mapped-in` — The source map that locates this subject's code in the repository tree.
- `part-of` — The subsystem this page's subject is one part of, or the architecture overview at the top of the tree.
- `verified-by` — The testing guide, or the quickstart, whose procedure runs or verifies this subject.

### `tags` (registered)

- `cli` — The wikiwright binary under packages/cli: verbs, envelopes, the shell half of the Writer, modules and their loading, freshness.
- `kernel` — The kernel of @wikiwright/core: parse, identity, types, shapes, the judge, routing, the Writer, generation, search.
- `kit` — The shipped domain kit @wikiwright/kit-code, and this bundle as its consumer.
- `meta` — The wiki about the wiki: charter, decisions, reviews.
- `repo` — The repository around the packages: the scripts, the tools, the gate, the tests.
- `stdlib` — The standard library under packages/core/src/stdlib: claims, relations, entries.

## Names

A page's name is its file's basename. A wikilink names a page by that name, never
by an alias: write `[[Canonical|what you meant]]`. A page whose title is not Latin
carries a Latin alias, so both scripts find it.
