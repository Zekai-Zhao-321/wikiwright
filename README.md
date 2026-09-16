# wikiwright

A typed wiki engine for LLM agents: the wiki stays Markdown in git, and one
judge holds every write to a constitution you declare.

An agent writing into a wiki drifts. Rarely inside a single page — it shows in
the shape of the hundredth one: a heading renamed, a relation labelled a new
way, a field that quietly stopped being filled. Reading the prose catches that
late, and a Markdown linter catches spelling, not structure.

wikiwright puts the structure under a type system. A bundle is a directory of
Markdown pages in git, which Obsidian opens unchanged, plus one JSON
constitution that says what a page of each type must look like: its fields and
their shapes, the sections its body carries, the grammar each section's items
are written in, the vocabularies those items draw from. One function judges
every change against that constitution at every moment a change can happen: a
draft on stdin, a write, the pre-commit gate, a replay of history. A type
system is only as good as its narrowest write path, so there is one judge and
nothing goes around it.

Every verb prints one JSON envelope, and every finding carries either a
runnable fix or a queue lane, so the agent driving the CLI always knows its
next instruction. The engine checks conformance, not truth, and it never calls
a model.

The law is data: one JSON file, and a domain kit installed like any other
package. Two teams can share how their wikis are built without sharing a page
of what is in them.

The gate is `bun run check`: biome, the build, a test-project typecheck and
the whole suite, on Bun and on Node. This repository documents itself in
`devwiki/`, a bundle over the shipped code kit, judged by that same gate.
`docs/roadmap.md` states what is missing, deferred or unverified.

## The four layers

```text
kernel              generic typed-wiki runtime; knows what a section is, not what a claim is
  standard library  claims, relations, entries: three modules, registered, not hard-coded
    domain kit      an npm package a bundle installs; registers through the same API
      bundle        one corpus: pages, a constitution, local entries and subtypes
```

The standard library and a kit are the same kind of thing. If the three
first-party modules could not be expressed through the public registration
API, the API would be a pretence, and a test holds the kernel to importing
nothing from them. The shipped example of a kit is `@wikiwright/kit-code`
under `packages/kit-code`: the domain kit for the wiki of a code repository —
the page kinds, the `anchored` fragment that pins a page to a commit and the
paths it covers, the relation labels between the kinds, their templates and
the reading discipline — consumed by the `code` starter and by this
repository's own `devwiki` (`docs/extending.md`, "The code kit").

## Install

Requires Bun 1.3 or later, or Node 22.12 or later, to run the built binary.

```sh
git clone https://github.com/Zekai-Zhao-321/wikiwright.git
cd wikiwright
bun install
bun run build
node packages/cli/dist/bin.js version
```

The executable is `packages/cli/dist/bin.js`: it switches on Node's compile
cache for the engine's own JavaScript and loads `packages/cli/dist/main.js`,
which runs the verbs and can be run directly. The pre-commit hook `init`
installs in a bundle looks for `wikiwright` on PATH, so put a one-line
launcher there:

```sh
printf '#!/bin/sh\nexec node /path/to/wikiwright/packages/cli/dist/bin.js "$@"\n' > ~/.local/bin/wikiwright
chmod +x ~/.local/bin/wikiwright
```

## Five minutes

Every envelope below is what the binary printed at the current build, trimmed
to the keys the text discusses.

**Init a bundle.** In an empty git repository:

```sh
git init chip-wiki && cd chip-wiki
wikiwright init
```

`init` lands the `base` starter: `config/constitution.json` with one type,
`config/engine.json`, `meta/charter.md`, the two skills under
`.claude/skills/`, the generated artifacts, the writer's brief and the
pre-commit hook. `check` is green on the first run.

**Declare a type with a section grammar, and a relation with a range.**
Replace `config/constitution.json`:

```json
{
  "schema": "wikiwright/constitution",
  "schema_version": 3,
  "vocabularies": {
    "tags": { "mode": "registered", "entries": {
      "meta": { "description": "The wiki about the wiki." },
      "spec": { "description": "Requirements with ids." },
      "source": { "description": "A captured source under raw/." } } },
    "relations": { "mode": "registered", "entries": {
      "traces-to": { "description": "The captured source that establishes this page's facts.", "range": ["source"] } } }
  },
  "types": {
    "charter": { "extends": "hub", "description": "The bundle's charter: pure intention and scope." },
    "source": {
      "extends": "reference",
      "description": "A captured source under raw/: origin and license.",
      "fields": { "origin": { "kind": "string", "required": true }, "license": { "kind": "string", "required": true } },
      "sections": { "depth": 2, "list": [{ "heading": "What it is", "min": 1, "max": 1 }] }
    },
    "requirement": {
      "extends": "reference",
      "description": "One numbered requirement, cited to the source that establishes it.",
      "use_when": "One testable statement with one id.",
      "avoid_when": "An explanation of how the behaviour is achieved.",
      "fields": { "req_id": { "kind": "string", "required": true, "pattern": "^REQ-[0-9]{3}$" } },
      "sections": { "depth": 2, "list": [
        { "heading": "Statement", "min": 1, "max": 1 },
        { "heading": "Relations", "min": 1, "max": 1, "grammar": "relations", "vocabulary": "relations",
          "require": [{ "labels": ["traces-to"], "min": 1 }], "severity": "error" } ] }
    }
  }
}
```

and `config/engine.json`:

```json
{ "content_roots": ["wiki", "raw", "meta"], "source_roots": ["raw"] }
```

`init` rendered `generated/` under the starter's one type; `wikiwright check
--write` regenerates it under the new law, and `check` is green again.
`wikiwright type show requirement --brief` now prints the contract as a writing
instruction:

```text
Statement  prose  min 1 max 1
Relations  relations  min 1 max 1  |  - label [[Target]]   (an indented bullet under an item is rationale)  |  require=[{"labels":["traces-to"],"min":1}]  |  relations: 1 declared (registered)
```

**Write a source page** through the typed write path. Markdown on stdin, one
judged page out:

```sh
printf '%s\n' '---' 'type: source' 'title: Datasheet' 'description: The Intel 8086 datasheet, 1979 edition.' \
  'tags: [source]' 'origin: bitsavers.org' 'license: copyright Intel; facts extracted with citation' '---' \
  '' '# Datasheet' '' '## What it is' '' 'The processor datasheet: pinout, timing and bus cycles.' \
  | wikiwright write raw/Datasheet.md
```

```json
{ "ok": true, "data": { "path": "raw/Datasheet.md", "findings": [], "digest": { "before": null, "after": "19faacff…" }, "blob": "77de3f35…" } }
```

**Hand-write a requirement**, the way a human in Obsidian would, and leave out
the section the type requires. Save this as `wiki/REQ-001.md`:

```markdown
---
type: requirement
title: REQ-001
description: The physical address space is 1 MB.
tags: [spec]
req_id: REQ-001
---

# REQ-001

## Statement

The physical address space is 1 MB (20 address bits).
```

**Run `check`** and read the finding (beside `generated-drift` on the
artifacts the new pages moved, which `check --write` settles at the end). It
carries the rule, the type that declared the obligation, and a fix the engine
can run:

```json
{
  "ruleId": "sections", "severity": "error", "path": "wiki/REQ-001.md",
  "message": "missing required section \"Relations\"",
  "remediation": "add a \"## Relations\" section (declared by requirement)",
  "contributedBy": "requirement", "registryPath": "/types/requirement/sections/list/1",
  "fix": { "argv": ["fix", "--rule", "sections", "--path", "wiki/REQ-001.md", "--expect", "1"], "applicability": "MachineApplicable" }
}
```

**Run the fix.** The argv names the state the finding came from — `check`
judged the working tree, so `fix` does too; a finding from `gate` would carry
`--staged` and `fix` would judge the index the gate judged:

```sh
wikiwright fix --rule sections --path wiki/REQ-001.md --expect 1
```

```json
{
  "ok": false,
  "error": { "code": "new-errors", "exit_code": 4, "type": "conflict", "message": "the write would introduce 1 error finding(s) on wiki/REQ-001.md" },
  "data": {
    "ops": [{ "path": "wiki/REQ-001.md", "fixer": "section-stub", "ops": [{ "kind": "insert", "after": 13, "lines": ["", "## Relations", ""] }] }],
    "findings": [{ "ruleId": "relation-require", "severity": "error", "line": 15, "message": "section \"Relations\" carries 0 relation(s) labelled traces-to; at least 1 required", "remediation": "write a relation labelled traces-to, or relax the section's `require` through review", "queue": "label-review" }]
  }
}
```

The fixer derived its three lines, spliced them in memory, judged the result
and refused to land it: an empty Relations section trades the `sections`
error for a `relation-require` error, and a fix that introduces an error is
not a fix. The finding it would have caused is a judgment the engine cannot
make — which source does this requirement trace to? — so it carries a queue
lane, never a fix.

**Answer it** with the item itself. `write --section --append` adds a declared
heading the page lacks and splices one item under it, judged as one write:

```sh
printf -- '- traces-to [[Datasheet]]\n' | wikiwright write wiki/REQ-001.md --section Relations --append
```

```json
{ "ok": true, "data": { "section": "Relations", "findings": [], "dispositions": { "relation_added": 1 }, "rendered": ["- traces-to [[Datasheet]]"], "spliced": { "inserted": [14] } } }
```

The page gained the heading and the item from line 14 and nothing else moved.

A relation to the wrong kind of page is refused before a byte lands. Try it
with `--dry-run`:

```sh
printf -- '- traces-to [[Charter]]\n' | wikiwright write wiki/REQ-001.md --section Relations --append --dry-run
```

```json
{ "ruleId": "relation-range", "severity": "error", "line": 18, "message": "\"traces-to\" points at a charter; its range is source", "queue": "label-review" }
```

**Regenerate and commit.** `check --write` rebuilds `generated/`, and
`graph edges` answers coverage from the graph rather than from a grep:

```sh
wikiwright check --write
wikiwright graph edges --label traces-to --outbound requirement --missing
```

```json
{ "ok": true, "data": { "missing": [], "totals": { "edges": 1, "pages": 1, "missing": 0 } } }
```

```sh
git add -A && git commit -m "create: the first requirement"
```

The hook runs `wikiwright gate` over the staged vault and the commit lands.

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
| [docs/extending.md](docs/extending.md) | writing a domain kit: what a module registers, the loader, trust, determinism |
| [docs/architecture.md](docs/architecture.md) | the packages, the invariants and the tests that hold them, the gate, how to develop |
| [docs/roadmap.md](docs/roadmap.md) | status, known limitations, and what is next |
| [CHANGELOG.md](CHANGELOG.md) | what each release changed |
| [CONTRIBUTING.md](CONTRIBUTING.md) | setup from a clone, the gate and the hook, the runners, generated files, sending a change |
| [AGENTS.md](AGENTS.md) | the operating rules for an agent working in this repository |

The bundle's own manual is the writer's brief, `generated/BRIEF.md`, and the
two skills `init` installs under `.claude/skills/`.

## Contributing

`CONTRIBUTING.md` has the setup, the gate, the conventions a change is held
to and how to send a pull request. The short form: keep `bun run check`
green, regenerate what your change moved, say why in the commit body, and
put nothing private in the tree.

## License

MIT; see `LICENSE`.
