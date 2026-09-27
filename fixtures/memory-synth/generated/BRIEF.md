# wikiwright — the brief of `memory-synth`

Generated file — do not edit; regenerate with `wikiwright check --write`.

Law digest: `f89afb978f49300149175ff9b4795f0ab3e29344867e9a682ca0b980405c5522`

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

- `account` (reference) — Never directly; author a concrete descendant.
  - Avoid when: Anything with its own relationships and narrative (entity). (declared by `record`)
- `asset` (reference) — Never directly; author a concrete descendant.
  - Avoid when: Anything with its own relationships and narrative (entity). (declared by `record`)
- `charter` (reference) — Exactly one page.
  - Avoid when: Settings, ruling records, content. (declared by `charter`)
- `daily` (reference) — One day of diary capture.
- `doc` (reference) — Never directly; author a concrete descendant.
  - Avoid when: Anything with its own relationships and narrative (entity). (declared by `record`)
- `entity` (concept) — Never directly; author a concrete descendant.
  - Avoid when: Diary entries and pointer records. (declared by `entity`)
- `event` (concept) — Never directly; author a concrete descendant.
  - Avoid when: Diary entries and pointer records. (declared by `entity`)
- `org` (concept) — Never directly; author a concrete descendant.
  - Avoid when: Diary entries and pointer records. (declared by `entity`)
- `person` (concept) — Independent identity, own relationships, substantial content about one named person.
  - Avoid when: Mentioned in passing; a group (topic); an animal (pet). (declared by `person`)
- `pet` (concept) — Never directly; author a concrete descendant.
  - Avoid when: Diary entries and pointer records. (declared by `entity`)
- `place` (concept) — Never directly; author a concrete descendant.
  - Avoid when: Diary entries and pointer records. (declared by `entity`)
- `project` (concept) — Never directly; author a concrete descendant.
  - Avoid when: Diary entries and pointer records. (declared by `entity`)
- `record` (reference) — Never directly; author a concrete descendant.
  - Avoid when: Anything with its own relationships and narrative (entity). (declared by `record`)
- `review` (reference) — One ISO week built from daily notes and the git log.
- `self` (concept) — Never directly; author a concrete descendant.
  - Avoid when: Diary entries and pointer records. (declared by `entity`)
- `topic` (concept) — Never directly; author a concrete descendant.
  - Avoid when: Diary entries and pointer records. (declared by `entity`)

## Vocabularies

### `categories` (registered)

- `category-01`
- `category-02`
- `category-03`
- `category-04`
- `category-05`
- `category-06`
- `category-07`
- `category-08`
- `category-09`
- `category-10`
- `category-11`
- `category-12`
- `category-13`
- `category-14`
- `category-15`
- `category-16`
- `category-17`
- `category-18`
- `category-19`
- `category-20`
- `category-21`
- `category-22`
- `category-23`
- `category-24`
- `category-25`
- `category-26`
- `category-27`
- `category-28`
- `category-29`

### `tags` (registered)

- `admin` — The wiki about the wiki.
- `craft` — Standing subjects about making things.
- `diary` — Dated diary capture.
- `diary-days` — One-day diary notes.
- `dossier` — A pointer page for a paper.
- `fauna` — Household animals.
- `folk` — Pages standing for persons and household animals.
- `gear` — A durable owned object.
- `guild` — Organisations, and the persons met through them.
- `happening` — A happening page.
- `haunt` — A location page.
- `kin` — The kin sub-group inside the persons workspace.
- `ledger` — Holdings and owned gear.
- `persona` — Any page standing for a named person.
- `roaming` — Locations and dated happenings away from home.
- `routing` — A page whose job is routing: concise overview plus curated links onward.
- `schooling` — Standing subjects about study.
- `strand` — A standing topic.
- `vault` — A financial holding.
- `venture` — A venture page.
- `wellbeing` — Standing subjects about the body and its upkeep.
- `workshop` — Ventures and the organisations that host them.

## Names

A page's name is its file's basename. A wikilink names a page by that name, never
by an alias: write `[[Canonical|what you meant]]`. A page whose title is not Latin
carries a Latin alias, so both scripts find it.
