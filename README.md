# wikiwright

A typed wiki engine for LLM agents: the wiki stays Markdown in git, and one
judge holds every write to a constitution you declare.

An agent writing into a wiki drifts. Rarely inside a single page — it shows in
the shape of the hundredth one: a heading renamed, a relation labelled a new
way, a field that quietly stopped being filled. Reading the prose catches that
late, and a Markdown linter catches spelling, not structure.

wikiwright puts the structure under a type system. A bundle is a directory of
Markdown pages in git, which Obsidian opens unchanged, plus its law: one YAML
document per type under `constitution/`, saying what a page of that type must
look like — its fields as JSON Schema, the sections its body carries, the
grammar each section's items are written in, the vocabularies those items
draw from, and rules in CEL. One function judges every change against that
law at every moment a change can happen: the working tree, a batch of drafts
before it lands, the pre-commit gate over the index. A type system is only as
good as its narrowest write path, so there is one judge and nothing goes
around it.

Every verb prints one JSON envelope, and every finding carries either a
runnable fix or a queue lane, so the agent driving the CLI always knows its
next instruction. The engine checks conformance, not truth, and it never calls
a model.

The law is data: type documents in the bundle, and type libraries it imports
by path, documents too. Two teams can share how their wikis are built without
sharing a page of what is in them.

The gate is `bun run check`: biome, the build, a test-project typecheck and
the whole suite, on Bun, the one runtime the engine runs on. This repository documents itself in
`devwiki/`, a bundle over the code wiki's type library, `libraries/kit-code`,
judged by that same gate.
`docs/roadmap.md` states what is missing, deferred or unverified.

## The law

```text
kernel      the judge, the fixed section grammar (claims, relations, dated entries), JSON Schema, CEL
  library   a directory of type, fragment and vocabulary documents a bundle imports by path
    bundle  one corpus: pages, its own type documents, and the libraries it names
```

A library's names are qualified by its id (`code/subsystem`); a bundle's own
are bare, and a bundle type may extend a library's. The shipped example is
`libraries/kit-code`, the type library for the wiki of a code repository —
the page kinds, the `anchored` fragment that pins a page to a commit and the
paths it covers, the relation labels between the kinds — which this
repository's own `devwiki` imports (`docs/extending.md`).

## Install

Requires Bun, the version `.bun-version` pins (1.3.11): the engine builds,
tests and runs on Bun only.

```sh
git clone https://github.com/Zekai-Zhao-321/wikiwright.git
cd wikiwright
bun install
bun run build
bun packages/cli/dist/bin.js version
```

The executable is `packages/cli/dist/bin.js`, a Bun script that loads
`packages/cli/dist/main.js`, which runs the verbs and can be run directly. The
git hooks the gate documents look for `wikiwright` on PATH, so put a one-line
launcher there:

```sh
printf '#!/bin/sh\nexec bun /path/to/wikiwright/packages/cli/dist/bin.js "$@"\n' > ~/.local/bin/wikiwright
chmod +x ~/.local/bin/wikiwright
```

## Five minutes

Every envelope below is what the binary printed at the current build, trimmed
to the keys the text discusses.

**Lay a bundle down.** In an empty git repository, `config/engine.json`:

```json
{
  "schema": "wikiwright/engine",
  "schema_version": 4,
  "label": "garden-notes",
  "content_roots": ["wiki"]
}
```

one type, `constitution/types/planting.yaml`:

```yaml
type: planting
role: procedure
description: One crop sown in one bed, and what was seen of it.
use_when: A crop went into a bed on a date.
fields:
  type: object
  properties:
    bed: { type: string, enum: [north, south, herb] }
    sown: { type: string, format: date }
  required: [bed, sown]
sections:
  list:
    - { heading: Steps, min: 1, max: 1 }
    - { heading: Observations, grammar: claims, vocabulary: observations }
```

and the vocabulary its Observations read, `constitution/vocabularies/observations.yaml`:

```yaml
vocabulary: observations
mode: registered
entries:
  observed: { description: Seen in this garden. }
  advice: { description: A recommendation. }
```

`wikiwright check --write` renders `generated/` (the brief, the graph, the
manifest, the tag catalog and the queue), and `check` is green:

```json
{ "ok": true, "data": { "summary": { "pages": 0, "errors": 0, "warnings": 0 } } }
```

**Read the contract before writing.** `wikiwright type show planting --brief`
prints the skeleton to write from and one line per section:

```text
Steps  prose  min 1 max 1
Observations  claims  min 0  |  - [category] core (provenance)  |  observations: 2 declared (registered)
```

**Write a page** through the judged write path: a directory of drafts that
mirrors the bundle, here `../drafts/wiki/Basil.md`:

```markdown
---
type: planting
title: Basil
bed: herb
sown: 2026-04-12
---

# Basil

## Steps

Sow thinly in warm soil and water from below.

## Observations

- [observed] Basil bolts above thirty degrees.
- [advice] Pinch the tips weekly to keep it bushy.
```

`wikiwright write --from ../drafts --dry-run` answers with the plan,
`[{"kind": "create", "path": "wiki/Basil.md"}]` and `"wrote": false`;
without `--dry-run` the batch is judged together and lands whole, `created`
and `updated` stamped. `check` now names the three generated files the page
moved (`generated-drift`, each with its fix, `check --write`).

**Try a rule before declaring it.**

```sh
wikiwright rule try --type planting --expr 'page.fields.bed != "herb" || page.body.contains("Pinch")'
```

```json
{ "working": { "would_refuse": [], "would_pass": ["wiki/Basil.md"], "unevaluated": [], "errors": [] } }
```

**Commit through the gate.** With the documented one-liner in
`.git/hooks/pre-commit`, `exec wikiwright gate --root .`, a commit is judged
over the index with HEAD as its base:

```sh
wikiwright check --write && git add -A && git commit -m "planting: basil"
```

**Read what the bundle knows.** `wikiwright read Basil --section
Observations` returns the section verbatim with its address, the page's
bytes digest and its status:

```json
{ "status": { "stale": false, "unresolved": [] },
  "sections": [{ "heading": "Observations", "address": "wiki/Basil.md#Observations", "line": 16 }] }
```

## What is deliberately not built

The engine never calls a model, so there is no review tier that judges prose.
There is no semantic retrieval tier: search is a deterministic identity ladder
fused with BM25, CJK-bigram tokenized. There is no capture verb that turns a
git origin into a source page, no connector layer, no rich-content checks
(Mermaid, images, tables), no publication or export target, and no access
control. The gate runs in a pre-commit hook and in a workflow on Linux and
macOS; Windows is unverified. `docs/architecture.md` states what the gate
does not cover.

## Documentation

| Read | For |
|---|---|
| [docs/concepts.md](docs/concepts.md) | page, type, tag, vocabulary, fragment, grammar, shape, the judge, findings, the gate |
| [docs/constitution.md](docs/constitution.md) | every key of `config/constitution.json` and `config/engine.json`, and what reads it |
| [docs/cli.md](docs/cli.md) | every verb and flag, rendered from the binary; the envelope, exit codes, the dry-run law |
| [docs/extending.md](docs/extending.md) | writing a domain kit: what a module registers, declaring and loading a module, the purity scan, determinism |
| [docs/architecture.md](docs/architecture.md) | the packages, the invariants and the tests that hold them, the gate, how to develop |
| [docs/roadmap.md](docs/roadmap.md) | status, known limitations, and what is next |
| [CHANGELOG.md](CHANGELOG.md) | what each release changed |
| [CONTRIBUTING.md](CONTRIBUTING.md) | setup from a clone, the gate and the hook, the runners, generated files, sending a change |
| [AGENTS.md](AGENTS.md) | the operating rules for an agent working in this repository |

The bundle's own manual is its brief, `generated/BRIEF.md`, and the three
skill documents under `docs/skills/`: one for using a bundle, one for writing
into it and one for maintaining it.

## Contributing

`CONTRIBUTING.md` has the setup, the gate, the conventions a change is held
to and how to send a pull request. The short form: keep `bun run check`
green, regenerate what your change moved, say why in the commit body, and
put nothing private in the tree.

## License

MIT; see `LICENSE`.
