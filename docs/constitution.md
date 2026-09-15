# The constitution reference

A bundle's law is two JSON files under `config/`. `constitution.json` declares
what a page must look like; `engine.json` is the bootstrap the loader reads
first: which directories hold pages, which policies are on, which module
packages load. Every key in both has a named consumer, and a test holds the
`engine.json` schema to that list. An unknown key in either file is a load
error. A constitution that does not load is exit 2 with the issues in
`data.issues`, each with a `code`, a `where` naming the entry an author edits,
and a `message`; an issue one edit would clear that several types raised — a
fragment's bad row, once per type that pastes it — is reported once, with
`sites` naming those types. No page is judged under a law that did not load.

Every example on this page is from the constitution of a wiki for a chip
program — the example domain used throughout this documentation — or from the
conformance fixture under `fixtures/conformance/`.

## config/constitution.json

```json
{
  "schema": "wikiwright/constitution",
  "schema_version": 3,
  "vocabularies": { "tags": { "mode": "registered", "entries": { "meta": { "description": "…" } } } },
  "fragments": { "traced": { "…": "…" } },
  "types": { "requirement": { "extends": "reference", "description": "…" } }
}
```

| Key | Type | Required | Read by |
|---|---|---|---|
| `schema` | the literal `"wikiwright/constitution"` | yes | the loader |
| `schema_version` | the literal `3` | yes | the loader; no other version loads |
| `vocabularies` | record of vocabulary name to [vocabulary](#vocabularies) | yes, and it must contain `tags` | the loader, the vocabulary laws, every grammar that binds one |
| `fragments` | record of fragment name to [fragment](#fragments) | no | the loader, which lowers each onto the chains of the types that paste it |
| `types` | record of type name to [type](#types) | yes | every pass |

Keys from the retired format are refused anywhere in the document, with the
reason: `rules`, `contracts`, `budget`, `checker`, `fixability`
(`constitution-v2-key`).

### Vocabularies

A vocabulary may be declared only when a loaded module registers its name. The
kernel registers `tags`. The standard library registers `categories` and
`sources` (the `claims` module) and `relations` (the `relations` module). A
domain kit registers its own under `<module-id>/<name>`. Declaring any other
name is `vocabulary-unknown`.

| Key | Type | Read by |
|---|---|---|
| `mode` | `"registered"` or `"census"` | the unknown-entry arm of the vocabulary's consumer: `unknown-tag`, `unknown-label`, `unknown-category`. Under `census` an unknown value is counted, never reported. `tags` must be `registered` (`vocabulary-mode`), and a bundle may not relax a mode the registering module fixed |
| `form` | a regular expression, optional | `tag-form`: every entry name and every authored tag must match it. Declared on any vocabulary; enforced on `tags` |
| `entries` | record of entry name to entry, optional | the vocabulary's consumer; the alias and retirement laws |

Every entry carries four shared properties, owned by the kernel, plus the
properties the registering module's schema declares. A property neither side
declares is `vocabulary-entry-key`, and the message names the vocabulary that
does own it; a value the module's schema refuses is `vocabulary-entry-invalid`.

| Property | Type | Vocabulary | Read by |
|---|---|---|---|
| `description` | string | every | `vocabulary show`, the brief, the tag catalog |
| `aliases` | string list | every | the alias law: an authored alias is `vocabulary-alias-target` (`tag-alias-target` for tags, fix-routed to `tag-rename`); an alias repeating another entry's name is `vocabulary-alias-collision` at load |
| `status` | `"active"` or `"retired"` | every | the retirement law: an authored retired entry is `vocabulary-retired` (`tag-retired` for tags) |
| `replaced_by` | string list | every | the retirement law's remediation; a name the vocabulary does not declare is `unknown-replaced-by` |
| `requires_link` | string, a canonical page name | `tags` | `tag-requires-link`: a page carrying the tag must link the named page |
| `range` | non-empty string list of type names | `relations` | `relation-range`: the target's `extends` chain must reach one of them; the finding names the concrete types beside an abstract range (`its range is code/decision (here: decision)`), and `vocabulary show relations` prints them under `references.range.concrete`. Absent means any type |
| `class` | `"supersede"`, `"accumulate"` or `"journal-only"` | `categories` | the claims transition arm (a supersede category holds one open truth; an accumulate category collects dated observations) and `journal-only-category` |
| `owned_by` | `{ "not_on": { "types": [...], "tags": [...] } }` | `categories` | `owned-by`: the category may not appear on a page of those types or tags |

A module may ship entries of its own vocabulary, and may contribute entries
into a vocabulary another module registered (`entries` on its manifest: a
kit's relation labels are its domain model, and the vocabulary they belong to
is the standard library's). The bundle's entries meet the merged set: it adds
beside them and may not re-declare one (`vocabulary-entry-collision`, naming
the module that shipped it). The conformance fixture ships `tiny` in its
`sizes` vocabulary and bundle A adds `small` and `medium`.

Which properties name a type or a tag is the registering module's declaration
(`typeRefs`, `tagRefs`: dotted paths into an entry). The loader holds each
name to the registry (`vocabulary-type-ref-unknown`,
`vocabulary-tag-ref-unknown`), `vocabulary show` prints what each path
resolves to under `references`, and its `--target` is the inbound view of
every vocabulary that declares one. What a reference means — a range, a
negative selector — is the module's, read by its own arms.

From the chip-program wiki:

```json
"relations": {
  "mode": "registered",
  "entries": {
    "traces-to": { "description": "The captured source page under raw/ that establishes this page's facts.", "range": ["source"] },
    "supersedes": { "description": "This page replaces the target, which is retired with status: retired.",
                    "range": ["requirement", "design-note", "rtl-module", "erratum", "decision"] }
  }
}
```

### Fragments

A fragment is a reusable slice of a type. It holds nothing a type does not.

| Key | Type | Read by |
|---|---|---|
| `description` | string | `type show` |
| `fields` | record of field name to [shape](#shapes) | the shape arms, through the types that paste it |
| `sections` | a [sections block](#sections) | the section matcher and the grammar arms, through the types that paste it |
| `checks` | list of [check attachments](#check-attachments) | the attached checks, composed onto the pasting type's chain |

Fragments compose before `extends`, under the same laws. Two fragments on one
type contributing one field or one heading is `fragment-collision`, judged over
the set, so the order they are listed in does not matter. The engine names a
fragment's contributions `fragment:<name>`; a type referring to an undeclared
fragment is `unknown-fragment`.

### Types

```json
"requirement": {
  "extends": "reference",
  "description": "One numbered requirement: a single statement of required behaviour, cited to the captured source that establishes it.",
  "use_when": "One testable statement with one id (REQ-8086-nnn), one Statement, one Source citation with the locating detail (file, section or line).",
  "avoid_when": "An explanation of how the behaviour is achieved (design-note); a deviation from documented behaviour (erratum); two statements (two pages).",
  "fragments": ["traced"],
  "fields": { "req_id": { "kind": "string", "required": true, "pattern": "^REQ-8086-[0-9]{3}$" } },
  "sections": { "depth": 2, "additional": true, "list": [
    { "heading": "Statement", "min": 1, "max": 1 },
    { "heading": "Source", "min": 1, "max": 1 },
    { "heading": "Notes", "max": 1 }
  ] }
}
```

| Key | Type | Required | Read by |
|---|---|---|---|
| `extends` | a type name or one of `concept`, `hub`, `procedure`, `reference` | yes | chain resolution. A missing parent is `unknown-extends`; a cycle `extends-cycle`; a retired parent `extends-retired`; a type shadowing an archetype `archetype-name-collision` |
| `description` | string | yes | `type show`, `type list`, the brief; the `hint` on a finding |
| `use_when`, `avoid_when` | string | no | the brief and the `hint` on a finding |
| `abstract` | boolean | no | `abstract-type`: a page may not carry an abstract type. A concrete type's child may not become abstract (`abstract-widened`) |
| `instances` | `{ "min", "max", "severity" }` | no | `instances`, a vault-level cardinality ("exactly one charter"); `severity` defaults to `warning` and a child may only tighten (`instances-relaxed`) |
| `fragments` | list of fragment names | no | the loader |
| `fields` | record of field name to [shape](#shapes) | no | `missing-required-field`, `field-shape`, `unknown-frontmatter-key`; the `new --set` typing; `type show`. A child may add a field, give an inherited `any` a shape, promote one to required, or tighten an inherited shaped field of the same kind: `values` to a subset, `min_items` up, `max_items` and `max_length` down, a `pattern` added beside the inherited one (both must match). A redeclared field restates every key it does not tighten — `kind`, `min_length`, `target_type` and the rest exactly as inherited — and an omitted key is a loosening, refused. Anything else is `field-schema-redeclared` |
| `sections` | a [sections block](#sections) | no | the section matcher (`sections`, `section-depth`, `max-chars`) and every grammar arm |
| `body` | `{ "lifecycle": "append-only", "severity"? }` | no | `body-append-only`: the base page's lines must be a prefix of the draft's. For a type with no sections. A child may not relax it (`body-relaxed`); beside an `entries` section with `lifecycle: append-only` it is `body-lifecycle-doubled`, beside a section whose grammar requires a rewrite `body-lifecycle-conflict` |
| `checks` | list of [check attachments](#check-attachments) | no | the attached checks |
| `template` | a vault-relative path (a bundle's) or a registered template id (a module's); its body may carry `{{ title }}` where the page title goes; a non-empty frontmatter value under a declared, non-engine key is the field's seed | no | `new` and `type show --brief`, which render the skeleton from the template merged with the required headings and take the seeds from its frontmatter (`--set` overrides one; an empty value seeds nothing); `template-missing`, `template-invalid`, `template-path-invalid`, `template-orphan`, `template-placeholder-unknown`, `template-field-unknown` (a frontmatter key the type does not declare) |
| `example` | a vault-relative path; it may be a real page under `content_roots` | no | the template checks: the example is linted as a page of the type; sibling content pages are not `template-orphan` candidates |
| `status` | `"active"` or `"retired"` | no | `tombstone`: a page of a retired type is an error, fix-routed to `retype` when `replaced_by` names one successor |
| `replaced_by` | list of type names | no | `tombstone`'s remediation |

A module's `types` and `fragments` are merged into the document before it is
parsed; a bundle may extend a module's type and may not re-declare its name
(`constitution-module-collision`). The conformance fixture contributes
`@wikiwright-fixture/probe/subject`, and bundle A declares
`"widget": { "extends": "@wikiwright-fixture/probe/subject", … }`.

### Shapes

A field is one shape: an object with a `kind` and the keys that kind admits.
An unknown kind, or a key the kind does not admit, is `field-shape-invalid` at
load.

| Kind | Keys beyond `kind` | A value satisfies it when |
|---|---|---|
| `any` | none | always; a declared, unshaped field |
| `string` | `min_length`, `max_length`, `pattern` | it is a string within the bounds and matching the pattern (a `u`-flag regular expression) |
| `dated-string` | none | it is a string carrying an ISO date somewhere |
| `integer`, `number` | `min`, `max` | it is a number (an integer for `integer`) within the bounds |
| `boolean` | none | it is `true` or `false` |
| `enum` | `values` | it is one of the listed strings |
| `date` | `auto` | it is a real `YYYY-MM-DD` date. With `auto: "on-create"` the engine stamps it once when the page is created; with `"on-write"` on every write; an `auto` field is never stubbed by `new` and is exempt from `required` at authoring time |
| `datetime` | none | it is an ISO 8601 datetime |
| `list` | `item`, `min_items`, `max_items` | it is a list whose every element satisfies `item` |
| `object` | `keys`, `required` (here a list of key names) | it is an object with only the declared keys, carrying the required ones |
| `page-ref` | `target_root`, `target_type` | it is the canonical name of a page, under `target_root` when declared, whose `extends` chain reaches `target_type` when declared. A path is refused with the name it would be |
| `page-ref-list` | `target_root`, `target_type` | it is a list of such names |
| `pin` | `origin`, `covers` | it is a full lowercase SHA-1 or SHA-256 commit id (`malformed-pin` otherwise). `origin` names the sibling field carrying the git origin (a URL, or `"."` for the repository enclosing the vault: the vault root when it is one, else the nearest ancestor work tree, which is how a code wiki lives in a directory of the repository it documents); `covers` names the sibling list of paths the capture covers, relative to the origin's root. `freshness` measures the pin against that origin and names each pin's state: `current`, `unchanged` (the covering diff is empty), `stale` (it touches a covered path), `behind` (not read at this depth), `unknown`, `unmeasured`; at object depth it also holds every backticked repository path the page cites to the pin (`citation-unresolved`). One pin per chain (`pin-duplicate`); the sibling must be declared (`pin-origin-unknown-field`) |

Two keys are universal: `required: true`, and `requires: ["<field>", …]`, which
makes the field required exactly when the named fields are present
(`field-requires-unknown` when one is undeclared). `target_type` must name a
declared type or an archetype (`field-target-type-unknown`). A field may also
carry `checks`, a list of [check attachments](#check-attachments).

The engine contributes nine base fields to every type as `any`: `type`,
`title`, `description` and `tags` required; `aliases`, `status`,
`superseded_by`, `supersedes` and `exceptions` optional. A type may give them a
shape.

### Sections

```json
"sections": {
  "depth": 2,
  "ordered": false,
  "additional": true,
  "list": [
    { "heading": "What it is", "min": 1, "max": 1 },
    { "heading": "Capture", "min": 1, "max": 1, "grammar": "entries", "date": "required", "lifecycle": "append-only" },
    { "heading": "Excerpts", "max": 1 }
  ]
}
```

The block:

| Key | Type | Default | Read by |
|---|---|---|---|
| `depth` | integer 1 to 6 | 2 | the matcher: headings at this depth are section headings; deeper ones belong to their enclosing section unless the type declares them (`section-depth`, fix-routed to `heading-depth`). When the depth is 2 or deeper, the page's first depth-1 heading is its title and not a section — `# Layout` over `## Layout` is clean — and any later depth-1 heading is judged like every other |
| `ordered` | boolean | `false` | the matcher: declared sections must appear in declaration order |
| `additional` | boolean | `true` | the matcher: may the page carry headings the type does not declare |
| `list` | non-empty list of entries | | the matcher and the grammar arms |

Under `extends` a child may append entries after the inherited list and may
redeclare an inherited heading only to tighten it. `ordered` and `depth` are
fixed on a chain (`sections-flag-conflict`); `additional` may go `true` to
`false`. Dropping an inherited alias is `sections-alias-removed`; a heading or
alias claimed twice on one effective list is `sections-unreachable`;
`max: 0` under an inherited `min: 1` is `sections-redeclared`. A fragment
name may carry `/`: a module's are `<module-id>/<name>`.

An entry's kernel keys, legal under any grammar:

| Key | Type | Default | Read by |
|---|---|---|---|
| `heading` | string | required | the matcher, compared through NFC and case folding |
| `aliases` | string list | | the matcher: a bilingual bundle heads one section in either script |
| `min` | integer | 0 | `sections`: the section is required when `min` is at least 1; the `section-stub` fixer inserts a missing required heading |
| `max` | integer | unbounded | `sections`: total occurrences; `max: 0` forbids the heading at any depth |
| `grammar` | a registered grammar name | prose | the item parser and the grammar's arms; `constitution-unknown-extension` when no loaded module registers it. Fixed once on a chain (`sections-grammar-conflict`) |
| `vocabulary` | a declared vocabulary name | | handed to the grammar's arms under that name; must be a vocabulary the grammar reads (`sections-vocabulary-unknown`, `sections-vocabulary-kind`). Identity-bearing: equal, or declared for the first time |
| `max_chars` | integer | | `max-chars`, a warning; a child may only lower it |
| `severity` | `"warning"` or `"error"` | `warning` | every `declared` row of the section's grammar, together. One-way: a child may raise it and never lower it (`sections-grammar-relaxed`) |
| `checks` | list of [check attachments](#check-attachments) | | the attached checks, with the section's heading, parameters and parsed items |

Every other key on an entry is a parameter of the declared grammar. A parameter
the grammar does not own, or any parameter on an entry with no grammar, is
`sections-grammar-params`. The parameters the standard library declares, as
each module declares them:

| Grammar | Parameter | Value | Combination under `extends` | Read by |
|---|---|---|---|---|
| `relations` | `require` | list of `{ "labels": [...], "min", "max"? }` | keyed by the normalized label set: a child may add a row, raise a `min`, add or lower a `max` | `relation-require`: at least `min` and at most `max` relations carrying any of `labels`. One label is the one-element case; `["implements", "diverges-from"]` is one row. A label the vocabulary does not declare is `sections-entry-unknown` |
| `relations` | `history` | a heading | identity | `relation-removed`: a relation that left the section must be quoted by a new dated line under this heading (`- <date> — retired <label> [[Target]]: <why>`); declaring it marks the section as one a transition rewrites |
| `entries` | `date` | `"required"` or `"optional"` | `optional` to `required` only | `entry-date-missing` |
| `entries` | `lifecycle` | `"append-only"` or `"free"` | `free` to `append-only` only | `entry-mutated`: the base's items are a prefix of the draft's; defaults to `error` |
| `claims` | `provenance` | `"required"` or `"optional"` | `optional` to `required` only | `claim-provenance` |
| `claims` | `forms` | subset of `stated`, `stated-by`, `inferred`, `sourced`, `recorded`, `legacy` | declared with the grammar, then subset-only | the parser: which trailing parentheticals are provenance markers |
| `claims` | `sources` | list of source tags | declared with the grammar, then subset-only | the parser: the tags the `sourced` form opens with; each must be an entry of the `sources` vocabulary (`sections-entry-unknown`, `-alias`, `-retired`) |
| `claims` | `history` | a heading | identity | `claims-transition` (defaults to `error`) and `claim-landing`: a retired claim lands under this heading |
| `claims` | `role` | the literal `"history"` | declared with the grammar, identity | this section is a History section: it admits closed claims and dated entries (`history-marker`, `closed-claim-in-facts`). A section may not be its own history (`sections-params-exclusive`) |
| `claims` | `only` | non-empty list of category names | subset-only | `category-not-allowed`; each must be an entry of the bound vocabulary (`sections-entry-unknown`, `-alias`, `-retired`) |
| `claims` | `items` | subset of `claim`, `entry` | subset-only | which item kinds a `role: history` section admits |
| `claims` | `inferred_ref` | `"required"` or `"optional"` | `optional` to `required` only | `claim-provenance`: an `inferred` clause must name a resolvable reference |
| `claims` | `categories` | the literal `"claim-classes"` | identity | the legacy spelling of `vocabulary: "categories"` |

The `vocabulary` key names the vocabulary a grammar's arms read: `relations`
for the `relations` grammar (`unknown-label`, `relation-range`); `categories`
for `claims` (`unknown-category`, `journal-only-category`, `owned-by`). A
kit's grammar reads its own under the same key. The conformance fixture's
`measures` grammar declares one parameter, `allow`, a subset-only list of
admitted values, and its `not-allowed` arm turns on where the parameter is
declared.

Every `declared` row of a grammar emits at the section's `severity`; a census
row (`info`) ignores the knob; the two vocabulary laws are errors the knob does
not reach. `type show <type> --brief` prints each section's grammar, bounds,
item form and parameters; `vocabulary show <name>` prints which sections bind a
vocabulary and at what effective severity.

### Check attachments

A check is a predicate a module registers and a bundle attaches, on a type, a
fragment, a field's shape or a section entry:

```json
"checks": [{ "use": "@wikiwright-fixture/probe/has-id", "config": { "prefix": "B-" }, "severity": "error" }]
```

| Key | Type | Read by |
|---|---|---|
| `use` | a registered check id, `<module-id>/<name>` | the loader: an unregistered id is `constitution-unknown-extension`; a surface the check does not admit is `check-attachment-invalid` |
| `config` | an object the check's own schema validates | the check's `run`; a key the schema refuses is `check-config-invalid` |
| `severity` | `"warning"` or `"error"` | the check's `declared` row |

Attachments union-append down the chain, keyed by `use`, surface, target and
config. A child may add one and may never remove one; repeating an inherited
attachment may only tighten its severity (`check-relaxed`).

### Load-time refusals

The loader reports every issue it finds, then refuses. Beyond the codes named
above: `schema-invalid` (a key or value the schema does not admit, with the
path; a type with no `extends` is one), `identity-collision` (two types, or
two tags or aliases, folding to one identity), `vocabulary-missing` (no `tags`
vocabulary), `vocabulary-type-ref-unknown` and `vocabulary-tag-ref-unknown`
(an entry property the module declared as naming a type or a tag names an
undeclared one), `sections-entry-unknown`, `-alias` and `-retired` (a
parameter the grammar declared as naming vocabulary entries — `require`'s
labels, `only`'s categories, `sources`' tags — names one the vocabulary does
not carry, or by an alias, or a retired one), `sections-params-exclusive`
(two parameters the grammar says contradict), `pin-origin-shape` and
`pin-covers-shape` (a pin whose sibling fields are not strings), and
`rule-conflict-heading` (a heading both required and forbidden on one chain).

## config/engine.json

```json
{
  "content_roots": ["wiki", "raw", "meta"],
  "source_roots": ["raw"],
  "folder_tags": { "mode": "validate" },
  "commit_prefixes": { "prefixes": ["schema", "ingest", "create", "update", "lint", "journal"] }
}
```

The file is a closed set: an unknown key is `schema-invalid`.

| Key | Type | Required | Read by |
|---|---|---|---|
| `content_roots` | non-empty list of vault-relative directories | yes (`content-roots-required`) | `rootsOf`: the directories walked for pages. A page outside them is not judged and not in the identity namespace. Each root is held to the path law: `".."`, an absolute path or a backslash is refused at load |
| `source_roots` | list of vault-relative directories | no | `generateOptionsFor` and `lintOptionsFor`: a body wikilink into a source root is a `cites` edge in the graph, and the `claims` grammar reads a bare path under one as `inferred` provenance. Undeclared means neither |
| `engine` | a semver range: space-separated comparators, `^`, `~`, or an exact version | no | `checkEnginePin`: `gate` refuses (`engine-pin-mismatch`, exit 2) when the running engine is outside the range, before it judges anything. An unparseable range is refused at load |
| `folder_tags` | `{ "mode": "off" \| "validate" \| "materialize-add-only" }` | no; undeclared is `off` | `lintOptionsFor` and `judge`: turns on `folder-tags-present`, `folder-segment-registered` and `former-folder-tags-review`. Only sub-folder segments under a root count, never the root's own name. Under `materialize-add-only` the `folder-tags` fixer executes `folder-tags-present`; under `validate` it queues |
| `folder_tag_aliases` | record of folder segment to tag name | no | `lintOptionsFor`: resolves a segment whose natural name is taken to its governing tag before the folder arms compare it |
| `field_sources` | `{ "title": "basename", "description": "lede" }` | no | `generateOptionsFor`: the two required fields are satisfied by derivation from the basename and the first body line, in identity checks, generation and search |
| `extensions` | `{ "mode": "open" \| "registered", "namespaces": [...], "fields": [...] }` | no; undeclared is `open` | `lintOptionsFor`: under `registered`, an `x-` frontmatter key outside the declared namespaces and fields is `unregistered-extension` |
| `commit_prefixes` | `{ "prefixes": [non-empty list] }` | no | `commitPrefixVerdict`: `gate --commit-msg` refuses a commit whose first line does not open with a registered prefix as `<prefix>:`, `<prefix>(<scope>):`, `<prefix>!:` or `<prefix>(<scope>)!:` — the list names prefixes, never scopes; `hook install` adds the `commit-msg` hook when the key is declared |
| `move_reasons` | non-empty list of strings | no | `moveReasonsOf`: `move --reason` must be one of them (`invalid-reason`); undeclared, any non-empty reason is accepted and the envelope says `reasons: "undeclared"` |
| `modules` | list of `{ "package": "<npm name>", "version"?: "<range>" }` | no | `loadDeclaredModules`: each package is resolved from the bundle's own `node_modules`, checked against `version`, purity-scanned, matched to its machine-local trust grant and loaded before any verb runs. See [extending.md](extending.md#declaring-a-module) |

Two files the engine reads beside these, which are not configuration: a page's
`exceptions` field, and the machine-local trust store at
`~/.config/wikiwright/trust.json` (`WIKIWRIGHT_TRUST_FILE` overrides), which
never enters the repository.
