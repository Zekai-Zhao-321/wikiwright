# Concepts

wikiwright is a typed wiki engine for LLM agents. A **bundle** is a directory
of Markdown pages in git, which Obsidian opens unchanged, plus a JSON
constitution that says what a page of each type must look like. One function
judges every change against that constitution at every moment a change can
happen. The engine checks conformance: a page obeys its declared shape, or the
engine says which rule it broke and what to do about it. It never checks truth,
and it never calls a model.

This page defines the words the rest of the documentation uses. Each concept is
shown with an example, drawn from a wiki for a chip program — requirements,
design notes, RTL modules and errata; the example domain used throughout this
documentation — from the engine's own `devwiki`, or from the conformance
fixture under `fixtures/conformance`.

## Page

A page is one Markdown file under a declared content root, with a YAML
frontmatter block. Its filename is its identity: `[[REQ-8086-001]]` resolves to
the file whose basename is `REQ-8086-001`, never to a title. Basenames, aliases
and titles must be unique across the vault after Unicode NFC and full case
folding, so `Li Wei` and `li wei` are one name.

Every page carries four required fields and may carry five optional ones. The
engine contributes them to every type:

| Field | Required | Meaning |
|---|---|---|
| `type` | yes | the one registered type this page is written as |
| `title` | yes | the display title, unique in the vault |
| `description` | yes | one sentence for retrieval and routing |
| `tags` | yes | a flat list of registered tags |
| `aliases` | no | other names that resolve to this page |
| `status` | no | `retired` marks a page kept for its history |
| `superseded_by`, `supersedes` | no | the successor and predecessor pages |
| `exceptions` | no | per-page waivers of queued findings (see below) |

A page's own type adds fields on top of these. The effective field set is
closed: a frontmatter key the type does not declare is `unknown-frontmatter-key`,
an error, unless it starts with `x-`.

```yaml
---
type: requirement
title: REQ-8086-001 — Physical address space is 1 MB and wraps at FFFFF
description: The processor addresses 1 MB of physical memory; a physical address past FFFFF wraps to 00000.
tags: [spec, bus]
req_id: REQ-8086-001
---
```

Two things to know about that block. A YAML value containing `: ` must be
quoted, or the block does not parse; the engine then reports exactly one
finding, `malformed-frontmatter`, with the parser's line and column. And `tags`
are authored, never inferred from the folder: when a bundle declares
`folder_tags`, every folder segment under a content root must be a registered
tag present on the page, and `wiki/spec/REQ-8086-001.md` carries `spec`.

## Type

A page declares exactly one nominal type. A type extends another type or one of
four built-in archetypes, and a chain always ends at an archetype:

| Archetype | What it is for |
|---|---|
| `concept` | what something is, why it works, its current model |
| `hub` | an overview and curated routes |
| `procedure` | how to perform or verify an action |
| `reference` | lookup facts, tables, commands, records |

The archetype is computed from the chain, never stored on the page. A type
carries prose that tells an agent when to use it and when not to
(`description`, `use_when`, `avoid_when`), the fields it adds (each with a
shape), the sections its body must carry, the fragments it pastes in, and
optionally a template, an `instances` bound and an `abstract` flag.

Specialisation is monotone: a child may add a field, add a section, promote a
field to required, or tighten a bound. It may never remove, relax or override
anything it inherits. Every page of a child type is therefore a valid page of
every ancestor type, which is what makes retiring a type safe. The loader
refuses a constitution that tries to relax at load time (`sections-grammar-relaxed`,
`field-schema-redeclared`, `check-relaxed`), before any page is judged.

`wikiwright type show <name>` prints the effective contract with every element
attributed to the type or fragment that contributed it; `--brief` prints the
contract as a writing instruction and the skeleton `new` would render. From the
chip-program wiki's `requirement` type:

```text
Relations  relations  min 1 max 1  |  - label [[Target]]   (an indented bullet under an item is rationale)  |  require=[{"labels":["traces-to"],"min":1}]  |  relations: 7 declared (registered)
Statement  prose  min 1 max 1
Source  prose  min 1 max 1
Notes  prose  min 0 max 1
```

The `Relations` line comes first because a fragment contributed it, and a
fragment is lowered onto the chain above the type's own declaration.

## Tag

A tag is a flat facet string from the `tags` vocabulary: a subject, a tool, a
folder segment, a cross-cutting membership. Tags select no template and carry no
structural contract; the type does that. The one obligation a tag can carry is
`requires_link`: a page tagged `pinned` must link `[[Roadmap]]`, declared on the
tag's entry.

The `tags` vocabulary is always `registered`, because folder alignment, the
generated catalog and the frontmatter check all read a closed set. An
unregistered tag on a page is `unknown-tag`, an error; an alias written where the
canonical name belongs is `tag-alias-target`, which the `tag-rename` fixer
repairs.

## Vocabulary

A vocabulary is a registered, named set of entries with one treatment for all of
them. The kernel registers `tags`. The standard library's `claims` module
registers `categories` and `sources`; its `relations` module registers
`relations`. A domain kit registers its own under a namespaced id
(`@wikiwright-fixture/probe/sizes` in the conformance fixture). A bundle may
declare only vocabularies some loaded module registers; declaring another is
`vocabulary-unknown` at load, because a vocabulary nothing reads is metadata.

Every entry carries four shared properties, `description`, `aliases`, `status`
and `replaced_by`, which the kernel owns because the alias and retirement laws
are judged outside any section. Everything else on an entry belongs to the
module that registered the vocabulary and is validated by that module's schema:
`range` on a relation label, `class` and `owned_by` on a category,
`requires_link` on a tag, `limit` on a fixture size. The chip-program wiki's
relations vocabulary:

```json
"relations": {
  "mode": "registered",
  "entries": {
    "traces-to":   { "description": "The captured source page under raw/ that establishes this page's facts.", "range": ["source"] },
    "implements":  { "description": "This RTL module implements the target requirement at the source's pinned commit.", "range": ["requirement"] },
    "affects":     { "description": "This erratum bears on the target requirement or RTL module.", "range": ["requirement", "rtl-module"] }
  }
}
```

Three laws hold for every vocabulary. **Alias**: an authored alias where the
canonical name belongs is `vocabulary-alias-target`. **Retirement**: an authored
retired entry is `vocabulary-retired`, naming its `replaced_by`. **Mode**: under
`registered` an unknown value is reported (`unknown-tag`, `unknown-label`,
`unknown-category`); under `census` it is counted and never rejected, which is
the evidence a later flip to `registered` is argued from. A constraint declared
on an entry, such as a `range`, is checked in both modes.

`wikiwright vocabulary show <name>` prints the entries with the properties their
module declared and what each type-valued property resolves to in this vault,
the sections that bind the vocabulary with their effective severity, and the
vault's own census of the values it writes.

## Fragment

A fragment is a name for a paste: the fields, sections and check attachments a
family of types would otherwise repeat. It carries nothing else. Fragments
compose before `extends`, under the same laws, and `type show` attributes what a
fragment contributed as `fragment:<name>`.

The chip-program wiki declares one fragment and pastes it into four types:

```json
"fragments": {
  "traced": {
    "description": "What every program artifact carries: a frontmatter citation into raw/ and a Relations section with at least one traces-to line.",
    "fields": {
      "sources": { "kind": "page-ref-list", "target_root": "raw", "target_type": "source", "required": true }
    },
    "sections": {
      "depth": 2,
      "list": [
        { "heading": "Relations", "min": 1, "max": 1,
          "grammar": "relations", "vocabulary": "relations",
          "require": [{ "labels": ["traces-to"], "min": 1 }],
          "severity": "error" }
      ]
    }
  }
}
```

Two fragments on one type contributing the same field or the same heading is
`fragment-collision` at load. A type may tighten a section its fragment
contributed and never relax it: the bundle's `design-note` adds
`{ "labels": ["covers"], "min": 1 }` to the fragment's `require` list.

## Section grammar

A type's `sections` block declares the headings a page body must carry, at what
depth, in what order, how many times, and, for each section, the **grammar** its
top-level list items are written in. Without a grammar a section is prose. With
one, every `- ` item under the heading is parsed by that grammar's parser and
judged by its arms.

The standard library ships three grammars:

| Grammar | Item form | Vocabulary it reads |
|---|---|---|
| `claims` | `- [category] core (provenance)` | `categories`, `sources` |
| `relations` | `- label [[Target]]` | `relations` |
| `entries` | `- YYYY[-MM[-DD]] — text` | none |

A grammar's parameters are keys on the same section entry, and which keys are
legal is decided by the grammar: `require`, `history` on `relations`; `date`,
`lifecycle` on `entries`; `provenance`, `forms`, `sources`, `history`, `role`,
`only`, `items`, `inferred_ref`, `categories` on `claims`. A parameter that the
declared grammar does not own is `sections-grammar-params` at load. A section
declaring a grammar no loaded module registers is `constitution-unknown-extension`.

A page under the chip-program wiki's `rtl-module` type:

```markdown
## Relations

- traces-to [[s80x86]]
- implements [[REQ-8086-003]]
- implements [[REQ-8086-002]]
```

Each line is one relation item. The `relations` grammar's arms judge it:
`unknown-label` for a label outside the vocabulary, `relation-range` for a
target whose type chain is outside the label's `range`,
`relation-target-unresolved` for a target that is no page, `relation-require`
for a section that does not satisfy its `require` rows, and, where a base
revision exists, `relation-removed` for a relation that left the section without
landing in a History line.

Every grammar row ships at `warning` when the section declares no `severity`,
and the section's `severity: "error"` raises all of its declared rows together.
That knob is the ratchet: a bundle attaches a grammar to an existing corpus,
reads the queue it produces, and flips the section to `error` when the queue is
empty. The knob never moves a census (`info`) row and never reaches the
vocabulary laws, which are errors whatever the section says.

## Shape

A field is one shape. The kind set is closed, and an unknown kind or a key a
kind does not admit is a load error. Two keys are universal: `required: true`,
and `requires: [fields]`, which makes the field required only when the named
fields are present.

| Kind | Keys | Example from the chip-program wiki |
|---|---|---|
| `string` | `min_length`, `max_length`, `pattern` | `req_id: { "kind": "string", "required": true, "pattern": "^REQ-8086-[0-9]{3}$" }` |
| `enum` | `values` | `capture: { "kind": "enum", "values": ["reference", "mirror", "ledger"], "required": true }` |
| `date` | `auto` | `captured: { "kind": "date", "auto": "on-create" }` |
| `list` | `item`, `min_items`, `max_items` | `external_ids: { "kind": "list", "item": { "kind": "string" }, "min_items": 1, "required": true }` |
| `page-ref`, `page-ref-list` | `target_root`, `target_type` | a reference to another page by canonical name |
| `pin` | `origin`, `covers` | a full commit id of an external git origin named by a sibling field |

`auto` on a `date` field is the only frontmatter the engine authors: `on-create`
is stamped once when the page is created, `on-write` on every write. A
`page-ref` value is a canonical name, never a path; the engine refuses a path and
names the canonical form it would be. The complete kind table is in
[constitution.md](constitution.md#shapes).

## The constitution

A bundle's law is two files under `config/`:

- `constitution.json`: `vocabularies`, `fragments` and `types`. Three surfaces,
  no fourth. There are no rules, checkers or fixability flags in it: the law a
  page is held to is carried by the vocabulary an entry belongs to, the grammar
  a section declares, the shape on a field and the checks a module registers.
- `engine.json`: the bootstrap the loader reads before the law, with the
  content roots, the source roots, the folder-tag policy, the engine pin, the
  commit-prefix set, the move reasons and the module packages.

Every key in both files has a consumer the engine names, and a test holds the
schema to that list. The loader validates the whole document, refuses with a
named issue and a `where` path, and judges no page under a law that did not
load: a broken constitution is exit 2, never a page finding.

## The judge and its states

`judge(state, law)` is one pure function in `@wikiwright/core`. A state is a map
from page path to bytes, optionally with a base map (the bytes each page had
before, or `null` for a new page) and a rename list. The law is the loaded
constitution, the loaded modules and the engine options. The shell constructs a
state, and there are four constructors serving five write paths:

| Constructor | Bytes | Base | Verbs |
|---|---|---|---|
| `fsState` | the working tree | none | `lint`, `check`, `graph`, `search` |
| `indexState` | the git index, what the commit would contain | HEAD, per page | `lint --staged`, `gate` |
| `overlayState` | the vault with one or more drafts in place of pages | the disk bytes at each path | `lint --stdin`, `write`, `write --from`, `new`, `fix` |
| `revisionState` | the tree at a commit | the tree at its first parent | `lint --since` |

A property test judges one fixture through every constructor and asserts the
per-page findings agree. This is why the agent cannot be told one thing at
`write --dry-run` and another at the pre-commit gate: the same judge, the same
law.

Inside `judge`: the per-page passes, the vault passes (identity collisions,
`instances`, `renamed-without-alias`), the transition arms where a base exists,
routing, exceptions, the gate rule, the coverage block and the cap. No verb
implements any of these differently.

## Findings and routing

A finding is one record:

```json
{
  "ruleId": "relation-range",
  "severity": "error",
  "path": "wiki/REQ-001.md",
  "line": 18,
  "message": "\"traces-to\" points at a charter; its range is source",
  "remediation": "point the relation at a page of a type in the label's range, or widen the range through review",
  "contributedBy": "requirement",
  "registryPath": "/types/requirement/sections/list/1",
  "evidenceDigest": "sha256:85295a45…",
  "details": { "label": "traces-to", "target": "Charter" },
  "breadcrumb": "Relations",
  "queue": "label-review"
}
```

Severity is `error`, `warning` or `info`. Every error or warning finding carries
exactly one of two routes, and the route is the instruction:

- **`fix`**: an argv the engine can run and prove. `wikiwright fix --rule
  sections --path wiki/REQ-001.md --expect 1` stubs a missing required heading;
  `check --write` regenerates a drifted artifact; `hook install` rewrites a
  marker hook another build wrote. The argv names the state the finding lives
  in: a finding from `gate` or `lint --staged` carries `--staged`, so `fix`
  judges the index the gate judged; one from `check` or `lint` carries none,
  and `fix` judges the working tree. Fixability is derived from a closed
  registry of fixers, never authored on a rule. The fixer's `applicability`
  says how far to trust it: `MachineApplicable` ops apply under `--expect N`;
  `MaybeIncorrect` (only `canonical-form`) applies only when the rule is
  named; `HasPlaceholders` (only `history-close`) renders under `--propose`
  and never applies. The verb proves with one more judge of the whole vault:
  the rule gone from every fixed page, no new error anywhere.
- **`queue`**: a lane, one of a closed set (`label-review`, `tag-review`,
  `syntax-review`, …). A queued finding is a judgment nobody has made yet. The
  engine counts it; a human or the maintaining agent decides.

An `info` finding is a census row and carries neither. A pass that could emit a
finding routing nowhere fails the engine's own build.

A queued finding can be waived on its page, with a reason, through the
`exceptions` field, keyed by the finding's `evidenceDigest` rather than its
line so a moved line keeps its waiver. A stale waiver is `exception-stale`; a
waiver naming a fix-routed row or a parse law is `exception-illegal`. There is
no other waiver mechanism, and lowering a severity to silence a queue is a
change of law, not a waiver.

Two more properties of the verdict. The findings array is capped (default 50,
error-first, `--all` lifts it) while `summary` and the exit code are computed
over the uncapped set, so a capped envelope never turns red into green. And
`coverage.passes` names, for every pass, how many pages it evaluated and how
many it could not, with a reason (`no-base`, `capability-unavailable`,
`external-origin`); `unevaluated` names the passes a declaration turned on that
this run could not judge. "Did not run here" and "found nothing" are two
different claims.

## The gate

`wikiwright hook install` writes a marker `pre-commit` hook (and a `commit-msg`
hook when `engine.json` declares `commit_prefixes`). The hook runs
`wikiwright gate`, which checks the bundle's `engine` pin and then judges the
staged vault: the index's bytes, page by page against HEAD, including the
generated artifacts as staged. It writes nothing.

At the gate, a queued `error` on a line the commit did not touch is demoted to a
`warning` (`details.demoted_from: "error"`), so a one-bullet edit never inherits
a legacy page's backlog. Fix-routed errors, parse errors, identity collisions and
`instances` are never demoted, and a commit that changes `config/` is judged
whole. A finding the commit caused on a page it did not touch, such as a rename
that leaves `[[Ana]]` dangling elsewhere, is visible and never demoted, because
it is judged against the name index the base held.

A refused commit prints the rule census and the error findings to stderr, then
one line saying `wikiwright gate --all` prints the whole envelope; the hook
drops the envelope on stdout. A marker hook another build wrote runs that
build's contract — the one that echoed the envelope after the summary — until
it is reinstalled, and `check` reports it as `hook-stale` with the reinstall
as its fix. When the `wikiwright` binary is not on PATH the hook prints one
line and lets the commit through: fail-open, loudly. `WIKIWRIGHT_BYPASS=<reason>` skips the gate and
logs the reason into the git directory, where a bypassed commit cannot contain
its own record.

## Generated artifacts

`wikiwright check --write` rebuilds three files under `generated/` and
`check` without `--write` compares the tree against a fresh rebuild
(`generated-drift`, error, fix `check --write`):

| File | Content |
|---|---|
| `generated/graph.json` | every page and tag as a node; every edge: `wikilink`, `tagged`, `cites` (a body link into a source root), `supersedes`, and one labelled edge per relation item under its grammar's item kind |
| `generated/manifest.json` | per-page type, chain, title, description, tags and depth-1 adjacency (`inbound`, `outbound`, nested by label for labelled kinds); edge counts `by_kind` and `by_label` |
| `generated/tag-catalog.md` | the tag vocabulary as a Markdown table |

`wikiwright check --write` renders `generated/BRIEF.md` beside them: the
writer's verb list and the bundle's own types and vocabularies, from the
command registry and the loaded constitution (`wikiwright brief --role <r>`
prints any role's without writing). `wikiwright freshness` writes
`generated/freshness.json`, which is never committed because it derives from an
origin outside the vault. Every artifact has one generator and is byte-reproducible;
a hand edit is overwritten by the next run.

## The four layers

```text
kernel              knows what a section is, not what a claim is
  standard library  claims, relations, entries: three modules, registered, not hard-coded
    domain kit      an npm package that registers through the same API
      bundle        one corpus: pages, a constitution, local entries and subtypes
```

The kernel owns the parse seam, identity, the type system, shapes, the judge,
routing, the Writer, generation and search. A module registers grammars,
vocabularies, checks, queue lanes, fragments, types, templates and skill
fragments through one API. The standard library's three modules and a kit are
the same kind of thing: if the three cannot be expressed through the public
API, the API is a pretence, and a test holds the kernel to importing nothing
from `stdlib/`. A bundle declares a kit in `engine.json`, extends its types,
adds entries beside its vocabulary's, and may tighten but never loosen its law.
[extending.md](extending.md) is the kit author's guide.
