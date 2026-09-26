# The constitution reference

A bundle declares its law with `config/engine.json` and YAML documents under
`constitution/`. Imported libraries contain the same document kinds. The
loader reads one snapshot: disk for `check` and `write`, the index for
`gate`, or a revision for `rule try --base`. A malformed law is
`constitution-invalid` (exit 2) with named issues; no page is judged from it.
Cyclic YAML aliases and excessive nesting are malformed input: a page gets
`malformed-frontmatter`, and a law document is refused during loading.

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
| `local_origins` | array of unique `{name, path}` local Git repository bindings, default `[]` | pin measurement in `check`, `read` and `search` |
| `libraries` | array of `{path}`, default `[]` | library loader |
| `commit_prefixes` | array of strings, default `[]` | `gate --commit-msg` |
| `field_sources` | `{title: "basename"}` or `{}` | title derivation and effective shape |
| `folder_tags` | `mode` is `off`, `validate`, or `materialize-add-only`; default off | folder checks and `check --fix` |
| `folder_tag_aliases` | mapping from folder segment to tag, default `{}` | folder checks |
| `extensions` | `mode` is `registered` or `open`; default registered | effective shape |

Every key has a named consumer and an end-to-end CLI fixture. Bundle paths obey
the vault path law; `..` and absolute paths are refused. `libraries[].path`
resolves against the enclosing Git repository's top level, stays inside
that repository, and is read from the selected state. Its id is the
directory basename less `kit-`, or the explicit `id` in
`library.yaml`. A bundle in a subdirectory can therefore import a library
beside it with the same repository-relative path a root bundle uses.
`local_origins[].path` is instead an explicit local observation binding:
an absolute directory or a directory relative to the physical bundle root,
which may name a sibling repository. It is canonicalized to a real path and
must be that repository's top level. Duplicate names are law errors;
duplicate canonical roots are unmeasured. Its name is not a URL and cannot be `.`; `.`
always means the repository enclosing the bundle. Source roots cannot
overlap `generated/`, whose files the engine owns.

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
`sections.list` has an exact `heading`, optional `min` and `max`, a
`scope: direct | descendants` (default `direct`), an optional grammar,
and that grammar's parameters. A nested entry uses `under: [Facts, Details]`:
the complete actual heading ancestry below `sections.depth`, excluding the
page title. It must name a grammar or `grammar: prose` when first declared.
An explicit prose child excludes that region from its parent's grammar.
Selectors follow heading ancestry even when Markdown skips a heading level.

Each physical heading owns only the list items in its direct body. Under
`scope: descendants`, undeclared child headings inherit the nearest policy;
an explicit child declaration replaces that policy. Under `scope: direct`,
the child body is unbound until a declaration matches it; the direct child
is a barrier, so its grandchildren cannot inherit a more distant policy.
The heading's `raw` span still includes its whole subtree, while `direct`
and `directLocation` identify its heading line and direct content through
the next document heading; its `items` belong to that content. A CEL
section rule and a relation `require` row run on each governed physical
heading separately; neither aggregates descendant items into an ancestor.
An explicit child is a new policy owner, including when it uses the same
grammar and inherits that grammar's parameters: a parent section CEL rule
does not attach to that child. Attach a separate rule to the child path
when it needs the same custom check. Same-layer replacement is deliberate;
cross-layer weakening is refused.
`relations.history` names a root entries heading at `sections.depth`.

Declarations merge by complete path. A root's `min` and `max` count its
occurrences; a nested declaration's bounds count matches under each
physical parent. Inherited bounds can tighten, while conflicting grammar,
vocabulary, depth or parameters are refused. A later type or fragment cannot
add a child exception under an inherited descendants grammar or narrow that
scope to `direct`; deliberate exceptions belong in the same declaration
layer as the policy they qualify. A later type may add a typed child below
an inherited prose barrier. Repeated headings at different paths have
distinct policies and transition identities.

`check` and `gate` summarize governed, explicit prose and unbound heading
regions, parsed records, malformed governed items and nonempty unbound
preambles. `read` lists each physical region's path, policy, mode and direct
span. Prose and unbound bullets are not inferred claims. Text before the
first document heading is an unbound preamble; a heading nested in a quote
or list does not start a document section. A green check says only that the
governed regions satisfy their declared grammar and rules.

`type show <name> --brief` renders a skeleton from the effective shape
and headings. There is no template declaration or `new` verb.

## The fixed grammar

A grammar applies to top-level list items in each governed heading's direct
body, including inherited descendants when declared.
Other prose is allowed. A nested indented item below a record is rationale.
One to three leading spaces can still make a CommonMark top-level bullet,
but the canonical grammar requires column one; such an item is
`item-unparsed`, not silently ignored. Any other top-level item outside
the grammar is `item-unparsed` too.

| Grammar | Canonical item | Section parameters |
|---|---|---|
| `claims` | `- [category] core (provenance)` | `vocabulary`, `provenance` (required, optional, none), `categories`, `closed` (allowed, refused, required) |
| `relations` | `- label [[Target]]` | `vocabulary`, `require: [{labels, min}]`, `history: <heading>` |
| `entries` | `- YYYY-MM-DD — text`, `- YYYY-MM — text`, or `- YYYY — text` | `lifecycle: append-only` |

A claim's final parenthetical is provenance only when it is a wikilink,
an HTTP(S) URL, or a path under `source_roots`. Otherwise it remains
part of the core. The category is checked against the named vocabulary.
A source-root path is literal: a regular file or directory must exist in the
selected state. A trailing slash requires a directory. The working-tree
adapter captures path existence with its double read; drafts update that
capture, and the index and revision use their own Git tree entries. None reads
raw source bytes or follows a symbolic link or submodule. Missing and wrong-kind
paths are errors; a skipped boundary or absent source facts in a pure-core
caller is unmeasured, never a pass. Source existence does not prove what the
claim says.
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
also binds `section`. `section: Facts` attaches to that root declaration's
governed physical headings; `section: [Facts, Timeline]` names a nested
declaration. The interface identity is `page-interface/3`.
For a claim record, `provenance` has `kind`, `value`, and `page`.
`value` retains the written page-name component for a page citation; the
record's `raw` retains any `#heading` and `|display` spelling. `page` is
`{resolved: true, path: <bundle-relative page path>, type: <nominal type or null>}`
when the cited name resolves, or `{resolved: false, path: null, type: null}`
when it does not. For a URL, source-root path, or absent provenance, `page`
is `null`. The name index applies Unicode NFC and full case folding; CEL
rules can read `i.provenance.page.type` without reconstructing a
`facts.links` key. In `before`, the source resolves against the base's page
names; current records resolve against the accepted state's page names.
The low-level claim parser returns a lexical record with an unresolved page
slot. `resolvedClaim`, `celOccurrence`, `buildPageInterface`, and
`buildBefore` need a supplied `ResolveTarget` to project resolved sources
outside `judgeTypeLaw`; their default resolver leaves page citations
unresolved. `readPages` builds the accepted and base name indexes for the
judge, so consumers of its states use coherent snapshots.
An alias still triggers `wikilink-alias-target`, and an identity collision
still triggers `identity-collision`. Page resolution does not check a heading,
verify URL or path bytes, or establish the source's truth.

| Variable | Relevant values |
|---|---|
| `page` | path, type, ancestry, role, frontmatter, effective fields, body, digest, parsed URLs, section occurrences |
| `section` | physical heading, path, location, raw subtree, direct body and location, effective mode, explicit-declaration flag, direct parsed items |
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
the selected page paths and bytes, and the kind and membership of paths under
source roots. It does not hash raw source bytes. External origin HEADs are
observations in pin results and page status; they do not enter generated
artifacts or the bundle digests.

## Rule tests and law changes

Each rule test set contains `negative.md`, `repaired.md`, at least one
`positive/*.md`, and `expect.json`:

```json
{"rule":"observation-evidence","location":{"section":"Observations","occurrence":0}}
```

The negative page must produce exactly one finding, this rule at this
location. The repaired and positive pages must produce none. Optional
`before/negative.md` and `before/repaired.md` supply a base for transition
rules. Both sides of a test twin resolve page citations against the selected
test corpus's names; a staged gate does not substitute its Git HEAD source
metadata into the twin. Examples pass as pages of their types. Test and example pages may
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
