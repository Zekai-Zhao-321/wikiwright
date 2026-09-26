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

`wikiwright check` — flags: --write --fix --limit <v> --rule <v> --path <v> --all --dry-run

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

`wikiwright type <list|show> [name]` — flags: --brief

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

- `architecture-overview` (concept) — The engine's shape: the four layers and how a verdict flows through them; anchored to the entry points that define them. This bundle lives in the repository it documents, so origin is `.`.
- `charter` (hub) — Exactly one page — meta/charter.md: the bundle's intention and scope, loaded every session. Not the agent operating manual (CLAUDE.md / AGENTS.md).
- `code-concept` (concept) — A cross-cutting mechanism of the engine that lives in many places: an invariant, a law, a data shape spanning subsystems.
- `decision` (reference) — A decision record of the engine, numbered D-nnn, citing the documents and pages that carry its evidence.
- `integration` (concept) — An external system the engine talks to, and the contract with it; anchored to the code that speaks it.
- `ops-reference` (reference) — Lookup tables for the engine: the envelope and exit codes, environment variables, repository scripts; anchored to the code that defines them.
- `quickstart` (procedure) — Install, build, and verify the engine from a fresh clone; anchored to the files its commands come from.
- `source-map` (reference) — Directory-to-purpose lookup for the wikiwright repository, anchored to the paths it lists.
- `subsystem` (concept) — One owned system of the engine, read at the pin and anchored to the directory it covers.
- `testing-guide` (procedure) — How the engine's tests are organized, run, and written: the two runners, temp copies, the kit-code helper.

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
