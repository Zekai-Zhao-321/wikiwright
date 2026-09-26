# Extending wikiwright

A bundle extends its law with data documents. A reusable library is a
directory of type, fragment, and vocabulary YAML, with rule tests and
examples. It ships no executable code. The kernel owns the grammar, JSON
Schema support, CEL profile, judge, routes, and write mechanics.

Use [the constitution reference](constitution.md) for every key and
[the roadmap](roadmap.md) for mechanisms this delivery does not provide.

## A library in the repository

```text
libraries/kit-garden/
  library.yaml                 # optional: id: garden
  types/planting.yaml
  types/bed.yaml
  fragments/planted.yaml
  vocabularies/relations.yaml
  rule-tests/known-bed/
    expect.json
    negative.md
    repaired.md
    positive/north.md
  examples/planting.md
```

The bundle imports it from `config/engine.json`:

```json
{
  "schema": "wikiwright/engine",
  "schema_version": 4,
  "label": "allotment",
  "content_roots": ["wiki"],
  "libraries": [{"path": "libraries/kit-garden"}]
}
```

`libraries[].path` is relative to the enclosing Git repository's top
level, even when the bundle is in a subdirectory. It must stay in that
repository. The loader reads its bytes from disk, the index, or a
revision together with the bundle's law. A library in another repository
must currently be copied into this one; copies are independent law.

The default id is the directory basename without a leading `kit-`.
An optional `library.yaml` may declare `id: garden`. A library's
declarations are qualified as `garden/planting`, `garden/planted`, and
`garden/relations`. A bundle's declarations are bare. A bundle type
may extend a library type:

```yaml
type: planting
extends: garden/planting
description: A planting in this allotment.
configure:
  known-bed: { beds: [north, south, herb] }
```

The loader rejects duplicate qualified names, unknown parents,
incompatible inherited sections or shapes, and a config that narrows an
inherited list. A library's own documents can extend other documents
it imports under the same naming rules.

## Types, fragments, and vocabulary

A **type** states its role, purpose, fields, sections, rules, optional
ancestry and fragments. A **fragment** shares fields, sections, rules and
meta keys without being a page type. A **vocabulary** holds registered
or census entries and optional retired entries. A bundle may add entries
to an imported vocabulary with `contributes_to`:

```yaml
vocabulary: relations
contributes_to: garden/relations
entries:
  shades: { description: A planting shades another bed. }
```

Contribution is add-only. A second declaration of one entry is a
collision. The declaring vocabulary's mode governs all entries.

An effective frontmatter shape combines reserved keys, fragments,
ancestors and the concrete type. It can use JSON Schema 2020-12 and the
engine `page-ref`, `page-ref-list` and `pin` definitions. `pattern` uses
RE2; only `date`, `date-time` and `uri` formats are supported.
`extensions.mode: registered` closes top-level fields after composition.
The engine rejects unsupported keywords and relaxation of an inherited
constraint instead of guessing at their meaning.

## Rules are data

A rule is a CEL expression over the documented `page-interface/1`.
For example, a section rule can require evidence for a heat observation:

```yaml
rules:
  - id: observation-evidence
    section: Observations
    expr: 'section.items.all(i, !i.core.contains("degrees") || i.provenance.kind != "none")'
    severity: error
    message: A heat observation must name evidence.
```

`rule try --type planting --section Observations --expr <cel>` evaluates a
candidate against the current pages before it becomes law. Every declared
rule needs a negative page, a repaired twin, a positive page, and
`expect.json` under `rule-tests/<id>/`. `check` judges those pages, and
`gate` refuses a newly changed rule whose test set is incomplete. The
[synthetic episode](../test/episode.test.ts) exercises that sequence
through the real pre-commit hook.

The profile admits only bounded expressions. It does not expose files,
Git history, other pages' bodies, the network, or time. A rule can use
`before` for a transition: disk under `write`, HEAD under `gate`.
`check` has no base and reports that rule unevaluated. A domain rule
cannot add a fixer, new grammar, new verb, queue route, or host hook.
A need the page interface and CEL cannot express calls for an engine
change or is left unexpressed and documented.

## Loading and distribution

The loader accepts only the documented law files in each directory.
Unexpected files, links, and submodules are refused with their place in
the law. It composes all imported libraries and bundle documents before
judging pages; a failed library does not partly load. Every loader-read
byte contributes to the law digest, including `library.yaml`, rule
tests, and examples.

To share a library with another bundle in the **same repository**, add
its repository-relative path to each bundle's `libraries` list, then
run `check --root <bundle>` for each consumer and `gate` against a staged
copy. Every importing bundle must carry the test set for a library rule
that its own composition changes. To share across repositories today,
copy the library directory and review the copy as a separate law.

There is no module manifest, package resolver, purity scan, determinism
fixture, trust grant, or executable library hook in the v2 binary. The
v1 kit package was replaced by `libraries/kit-code`. The loss and
possible future distribution mechanism are named in
[the roadmap](roadmap.md#a-library-is-read-from-the-bundles-own-repository-only).
