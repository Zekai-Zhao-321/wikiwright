# The constitution reference

A bundle declares its law with `config/engine.json` and YAML documents under
`constitution/`. Imported libraries contain the same document kinds. The
loader reads one snapshot: disk for `check` and `write`, the index for
`gate`, or a revision for `rule try --base`. A malformed law is
`constitution-invalid` (exit 2) with named issues; no page is judged from it.

The smallest shape is [the minimal vault](../fixtures/minimal-vault).
[Concepts](concepts.md) explains the terms, and [extending](extending.md)
shows how to write a reusable library.

## Bundle layout

```text
config/engine.json
constitution/types/<name>.yaml
constitution/fragments/<name>.yaml
constitution/vocabularies/<name>.yaml
rule-tests/<rule-id>/{expect.json,negative.md,repaired.md,positive/*.md}
examples/*.md
wiki/*.md                         # or other declared content roots
generated/{BRIEF.md,manifest.json,graph.json,tag-catalog.md,queue.md}
```

Only type, fragment, and vocabulary YAML documents belong directly in
their law directories. Rule-test and example pages are Markdown; a rule
test also has `expect.json`. A foreign file, symbolic link, or submodule in
a law directory is a load-time issue. The generated directory is output,
written by `check --write`, and is not hand-edited.

## Engine document

`config/engine.json` is strict JSON with no unknown keys. For example:

```json
{
  "schema": "wikiwright/engine",
  "schema_version": 4,
  "label": "kitchen-garden",
  "content_roots": ["wiki"],
  "source_roots": ["raw"],
  "libraries": [{"path": "libraries/kit-garden"}],
  "commit_prefixes": ["feat", "fix", "docs"],
  "folder_tags": {"mode": "validate"}
}
```

| Key | Value and default | Consumer |
|---|---|---|
| `schema` | required, `wikiwright/engine` | document loader |
| `schema_version` | required, `4` | document loader |
| `label` | required, lowercase hyphenated name | `metadata.bundle.label` |
| `engine` | optional parsed engine range | mismatch refusal in bundle verbs |
| `content_roots` | required nonempty array of bundle-relative directories | page discovery |
| `source_roots` | array, default `[]` | claim path provenance and page-reference roots |
| `libraries` | array of `{path}`, default `[]` | library loader |
| `commit_prefixes` | array of strings, default `[]` | `gate --commit-msg` |
| `field_sources` | `{title: "basename"}` or `{}` | title derivation and effective shape |
| `folder_tags` | `mode` is `off`, `validate`, or `materialize-add-only`; default off | folder checks and `check --fix` |
| `folder_tag_aliases` | mapping from folder segment to tag, default `{}` | folder checks |
| `extensions` | `mode` is `registered` or `open`; default registered | effective shape |

Every key has a named consumer and an end-to-end CLI fixture. Paths obey
the vault path law; `..` and absolute paths are refused. `libraries[].path`
resolves against the enclosing Git repository's top level, stays inside
that repository, and is read from the selected state. Its id is the
directory basename less `kit-`, or the explicit `id` in
`library.yaml`. A bundle in a subdirectory can therefore import a library
beside it with the same repository-relative path a root bundle uses.

The v1 `modules`, `exports`, `plugin`, and `move_reasons` keys are gone.
[The disposition table](v2-dispositions.md) and [changelog](../CHANGELOG.md)
name removed keys and findings.

## Type documents

One type lives at `types/<name>.yaml`. Its `type` equals that stem.
A bundle's names are bare; a library's names are qualified by id, such
as `garden/planting`. A bundle type may extend a qualified library type.
The effective type is composed from its ancestry and fragments. A collision,
unknown parent, incompatible role, or incompatible section is refused at
load.

| Key | Meaning |
|---|---|
| `type` | required nominal name |
| `role` | `concept`, `hub`, `procedure`, or `reference`; required at the root, inherited by a child |
| `description` | required description of what the type is for |
| `use_when`, `avoid_when` | optional writing guidance |
| `extends` | optional bare or qualified parent type |
| `fragments` | optional list of fragment names |
| `abstract` | optional boolean, default false; no content page may use an abstract type |
| `instances` | optional `min` and `max` over content pages of this type or a descendant |
| `fields` | JSON Schema object for frontmatter |
| `sections` | headings, order, depth, multiplicity, grammar and parameters |
| `rules` | bounded CEL rules |
| `configure` | config values for inherited rules; a list may only grow |
| `meta` | frontmatter keys omitted from `page.digest`; each must be in the effective shape |
| `examples` | paths to Markdown pages that must pass the judge |

A fragment has `fragment`, `description`, and optional `fields`,
`sections`, `rules`, and `meta`. A vocabulary has `vocabulary`,
`mode: registered | census`, `entries`, optional `retired`, and optional
`contributes_to`. An entry is a lowercase hyphenated name with an optional
description. A bundle vocabulary with `contributes_to: garden/relations`
adds entries to that library vocabulary; replacing an entry is a collision.
A retired entry records `since` and an optional `successor`.

A rule has a globally unique `id`, `expr`, optional `section` and
`config`, `severity: error | warning`, and `message`. A section rule
names an exact heading in the effective sections. A false result produces
its declared finding. A nonboolean result or evaluation error produces
`rule-error`. Every CEL finding routes to a queue lane; a rule document
cannot install a fixer or executable hook.

### Effective shape

`fields` is a draft 2020-12 JSON Schema object compiled by the engine in
strict mode. `pattern` uses RE2, so lookaround and backreferences are
refused. Only `date`, `date-time`, and `uri` formats are registered. A
`$ref` may resolve within the document or to an engine `$defs`:

| Definition | Value |
|---|---|
| `page-ref` | nonempty page name as written inside a wikilink |
| `page-ref-list` | array of page references |
| `pin` | object with `commit`, `origin`, and nonempty `covers` paths |

`target_type` and `target_root` are engine keywords on a page reference
or list; the target must resolve to the required type or root. The engine
assigns a document id so local references work after composition.
Authored top-level `additionalProperties` or `unevaluatedProperties`
inside `fields` is refused; a nested object may close its own properties.

Every effective shape includes the reserved keys `type`, `title`,
`description`, `tags`, `aliases`, `status`, `supersedes`,
`superseded_by`, `exceptions`, `created`, and `updated`.
`type` and, unless `field_sources.title: basename` derives it, `title`
are required. `status` is `active` or `retired`. An exception is
`{rule, reason}` and can close only an eligible queued finding on its page.
`created` and `updated` are dates stamped by `write` when their declared
shape calls for them.

The effective shape combines reserved keys, fragments in declaration
order, ancestors from root to child, and the type's own fields. Under
`extensions.mode: registered` the engine closes the union of declared
top-level properties; under `open` it leaves it open. A child may tighten
an ancestor's constraints, never relax them. The loader checks the
supported keyword directions and reports `shape-relaxed` or
`default-conflict` rather than claiming a general implication proof.

### Sections

`sections.depth` defaults to heading level 2. `ordered` defaults false.
`additional` is `allowed` by default or `refused`. Each entry in
`sections.list` has an exact `heading`, optional `min` and `max`, an
optional `grammar` and that grammar's parameters. Inheritance merges
headings by exact text: the higher minimum and lower maximum win;
conflicting grammar, vocabulary, depth, or parameter values are refused.
A child can add a heading or tighten its bounds.

`type show <name> --brief` renders a skeleton from the effective shape
and headings. There is no template declaration or `new` verb.

## The fixed grammar

A grammar applies to top-level list items under its section heading.
Other prose is allowed. An indented line below an item is rationale.
A top-level item outside the grammar is `item-unparsed`.

| Grammar | Canonical item | Section parameters |
|---|---|---|
| `claims` | `- [category] core (provenance)` | `vocabulary`, `provenance` (required, optional, none), `categories`, `closed` (allowed, refused, required) |
| `relations` | `- label [[Target]]` | `vocabulary`, `require: [{labels, min}]`, `history: <heading>` |
| `entries` | `- YYYY-MM-DD — text`, `- YYYY-MM — text`, or `- YYYY — text` | `lifecycle: append-only` |

A claim's final parenthetical is provenance only when it is a wikilink,
an HTTP(S) URL, or a path under `source_roots`. Otherwise it remains
part of the core. The category is checked against the named vocabulary.
A claim may end with `(retracted YYYY-MM-DD)` or
`(valid YYYY-MM-DD→YYYY-MM-DD, superseded YYYY-MM-DD by #xxxxxxxx)`.
The first date and the `by` handle are optional in the superseded form.
The handle is a `#` and eight hex digits computed from the claim core.
`closed` controls whether such a claim is admitted in the section.
The kernel judges a removal or change against a base as
`claims-transition`.

A relation accepts a target heading or alias in the wikilink.
`require` enforces a label count; `history` names the section where a
removed relation must be recorded. An append-only entries section
reports an edited or removed entry as `entry-edited` when a base exists.
Each parsed record has the engine's `item-claim`, `item-relation`, or
`item-entry` JSON Schema. Its location has a line and UTF-8 byte span.

## The rule interface and bounds

CEL rules bind `page`, `config`, `facts`, and `before`. A section rule
also binds `section`. The interface identity is `page-interface/1`.

| Variable | Relevant values |
|---|---|
| `page` | path, type, ancestry, role, frontmatter, effective fields, body, digest, parsed URLs, section occurrences |
| `section` | attached heading, path, location, raw text, parsed items |
| `config` | this rule's config after `configure` |
| `facts` | vocabulary entries, resolved links, type ancestry |
| `before` | `present` and the base page and sections when available |

The working tree has no base; a rule referencing `before` is
`unevaluated` with reason `no-base` there. Drafts use disk as base,
and the index uses HEAD. A new page has `before.present: false`.
A rule cannot read another page body, history, files, time, or network.

The engine rejects an expression over 4,096 bytes, over 512 AST nodes,
over 32 parentheses of nesting, over two nested comprehensions, over
four chained comprehensions, or with a static worst case above 200,000
comprehension iterations. A comprehension must range directly over a
bounded interface path. Page bytes are limited to 1 MiB; a page has at
most 200 sections, 5,000 items in one section, 1,000 members in a
frontmatter or config list or map, and 10,000 entries in a facts list.
An ancestry chain is limited to 32. The work of built-ins within one
iteration is not included in the static product; [the roadmap](roadmap.md)
states this limitation. The profile refuses time functions, formatting,
and struct literals.

## Digests

`read` returns `bytes`: SHA-256 of the page file bytes. `write` uses
that digest for `ops.json` bases. `page.digest`, available to a rule,
hashes canonical frontmatter with the type's `meta` keys removed, a NUL,
and the body bytes. A malformed frontmatter uses its raw bytes.

The law digest hashes each loader-read law file by owner and path, plus
the page interface and CEL profile identities, pinned dependency versions,
and engine version. It is computed from the selected state, so `gate`
names staged law. `metadata.bundle` gives `label`, real `root`, Git
`head`, `dirty`, `law`, and `content` digests. The content digest covers
the selected page paths and bytes.

## Rule tests and law changes

Each rule test set contains `negative.md`, `repaired.md`, at least one
`positive/*.md`, and `expect.json`:

```json
{"rule":"observation-evidence","location":{"section":"Observations","occurrence":0}}
```

The negative page must produce exactly one finding, this rule at this
location. The repaired and positive pages must produce none. Optional
`before/negative.md` and `before/repaired.md` supply a base for transition
rules. Examples pass as pages of their types. Test and example pages may
use abstract types; they do not count as content pages, identity matches,
or instances.

A missing test component is `rule-untested`: a warning at `check`, an
error at `gate` for a rule the staged law adds or changes. `gate` also
compares the index law with HEAD. Changes to rules, types, vocabulary,
libraries, content roots, rule tests, or examples are `law-changed` info
at pre-commit. At commit-message time they are `law-relaxed` errors
unless a body line `law-change: <reason>` is present; then the reason
appears on an informational `law-changed` finding. The published hooks
cover both stages.
