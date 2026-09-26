# Concepts

WikiWright is a typed Markdown wiki engine for agents. A bundle is a Git
repository, or a directory inside one, containing Markdown pages and a
`config/engine.json`. Obsidian can open those pages unchanged. The engine
does not call a model, keep a database, or run a daemon. It reads the bundle,
judges it against its declared law, and returns one JSON envelope.

For exact keys and file formats, see [the constitution](constitution.md).
For commands and exit codes, see [the CLI](cli.md).

## Page and type

A **page** is a Markdown file below a declared `content_roots` directory.
YAML frontmatter names exactly one nominal `type`. A type is a document at
`constitution/types/<name>.yaml`, or in an imported library. Its role is
`concept`, `hub`, `procedure`, or `reference`. A child type inherits its
parent type, fragments, shapes, section declarations, and rules. A type may
be abstract: content pages cannot take it, while examples and rule tests can.

A type describes **conformance**, not truth. A conforming observation may
still be false. The owner or a maintainer decides what the observation means
and whether it is supported. A rule can make a decidable requirement, such
as a cited observation, repeatable at every write path.

A page name, alias, and title are separate ways to resolve it. Search and
`read` use the same identity rules, including Unicode NFC and full case
folding. `read` returns the selected page sections verbatim, a digest of
the page bytes, and its evidence status.

## Three layers of law

1. The **kernel** supplies the fixed grammar, reserved fields, JSON Schema
   and CEL profile, the judge, routing, and generated artifacts.
2. A **library** is data: type, fragment, and vocabulary documents with
   examples and rule tests. A bundle imports it by a path inside its own
   Git repository. It contains no executable hook.
3. The **bundle** declares its own types, fragments, vocabularies, rules,
   content roots, and policy in its documents and `config/engine.json`.

A library document is qualified by its library id, such as
`garden/planting`. A bundle document is bare, such as `planting`, and can
extend a library type. A fragment shares shape, sections, rules, and
`meta` keys among types. A vocabulary admits or inventories named values;
a bundle can add entries to a library vocabulary without changing the
library. See [extending](extending.md) for a concrete layout.

The **law digest** includes the raw engine document, every loader-read type,
fragment, vocabulary, rule-test, and example file, the interface and profile
identities, relevant dependency versions, and the engine version. The
bundle block on a law-reading envelope also names its label, real root,
Git head, dirty state, and content digest. The index adapter computes these
from staged bytes; the working-tree adapter uses disk bytes.

## Shape and section

A type's `fields` is a JSON Schema object. The effective shape combines
reserved frontmatter keys, fragments, ancestors, and the type's own fields.
With `extensions.mode: registered`, a frontmatter property outside that
combined shape is refused. With `open` it is admitted. A shape can require
fields, constrain values, use the engine definitions `page-ref`,
`page-ref-list` and `pin`, and validate `date`, `date-time`, and `uri`
formats. A page reference is also checked against the pages the bundle
actually has.

`sections` declares headings by exact text: order, depth, minimum and
maximum occurrences, and whether other headings are allowed. A heading
may attach one of the three fixed grammars:

| Grammar | One top-level list item |
|---|---|
| `claims` | `- [category] core (provenance)`, with an optional lifecycle clause |
| `relations` | `- label [[Target]]`, optionally with a heading or alias |
| `entries` | `- YYYY-MM-DD — text`, or month or year precision |

Indented lines under an item are its rationale. Prose between items is
allowed. A top-level list item starts at column one; one to three leading
spaces are still a CommonMark top-level item but are noncanonical here and
reported as `item-unparsed`. An item with another spelling that does not
parse is also reported, never silently reinterpreted.

A claim's provenance is recognized only in its final parenthetical when it
is a page link, an HTTP(S) URL, or a path below a declared source root.
A claim may be retracted or superseded. A relation can require labels and
record a removed relation in a History section. An entries section can be
append-only. The exact record spellings and parameters are in
[the constitution](constitution.md#the-fixed-grammar).

## Rules and their tests

A type or fragment declares a bounded CEL rule over the documented page
interface. A rule attaches to a page or to each occurrence of one section.
Its expression receives `page`, `section` when attached, `config`,
`facts`, and `before` when a base state exists. It cannot read another
page's body, Git history, a file, the network, or the clock. The engine
refuses expressions outside its static profile and work bound at load.

A rule returning false produces its declared error or warning. A rule that
cannot evaluate to a boolean produces `rule-error`. A transition rule
referring to `before` is `unevaluated` under a working-tree state without
a base; it is not silently counted as a pass.

A rule test set has a `negative.md`, a `repaired.md`, positive pages, and
`expect.json`. The negative must produce exactly the rule and location it
names; the repaired and positive pages must pass. `check` runs the set,
and `gate` requires it when a staged law change adds or changes the rule.
Examples must pass under the same judge. The rule-test pages do not count
as content pages or type instances.

## The judge and its states

The same `judgeTypeLaw(state, law)` judges:

| State | Used by | Base for transitions |
|---|---|---|
| Working tree | `check`, `rule try` | none |
| Drafts over disk | `write` | disk |
| Index | `gate` | HEAD; empty before the first commit |
| Revision | `rule try --base` | none |

The law comes from the same state as its pages. A staged page is judged
under staged type and library documents, not under whatever happens to be
on disk. A working-tree capture reads twice and refuses a changing tree
after one retry. Symbolic links and submodules are reported as skipped
rather than followed into content or law.

**Findings** carry a rule id, severity, path, location, message, details,
and a route. Every error or warning has exactly one `fix` command or
`queue` lane. A decidable error can stop a write or a commit. A judgment
goes to a human-review lane. An informational finding has neither route.
The verdict includes coverage and a separate `unevaluated` count; a green
summary does not claim that unevaluated checks passed.

`check` judges the working tree. `write` proves the full proposed batch
under one captured law and page state, checks destinations, stages the pages,
then rechecks that state before the first rename. `check --fix` refuses a
proposed content repair that would leave a new error and stages its pages with
the generated artifacts before either lands. `gate` judges the index, demotes eligible inherited
findings on untouched lines, and refuses a commit with an error that
remains. At commit-message time it also requires a reason for a law change
and checks the declared commit prefixes. The published hooks invoke the
gate; host editor actions are judged when their changes reach it.

## Evidence and artifacts

A `pin` records a commit, origin, and covered paths. `check` measures
local-repository pins: changed covered paths make a pin stale, and a page
linking the stale source is marked `stale-source-cited`. A remote-origin
pin is reported unmeasured; the engine does not contact the network.
`read` and `search` show `stale` as true, false, or null with a reason.
They also show unresolved queued rule ids when `generated/queue.md` still
matches the current law and content digests.

## Generated artifacts

`check --write` is the sole generator of a bundle's
`generated/BRIEF.md`, `graph.json`, `manifest.json`,
`tag-catalog.md`, and `queue.md`. The brief has guidance for consuming,
writing, and maintaining the bundle. Generated files are derived output,
not another law. Their writes are per-file atomic; a crash between files
can leave a mixed set that the next generation converges.

Search builds its index for each invocation. It resolves name, alias and
title identities before ranking lexical matches, using Unicode-aware
normalization, CJK-capable tokenization, BM25 and rank fusion. `--items`
returns parsed claim, relation and entry records; `--files` returns file
matches. The near-name suggestions are advisory candidates, never an
identity assertion or an automatic page merge. No postings index is
persisted between runs.

## Scope and losses

The engine has eight verbs: `check`, `gate`, `write`, `rule`, `read`,
`search`, `type`, and `version`. It does not install a starter, load code
from a bundle, discover bundles by skill name, export copied bundles, or
enforce a session role. Those losses and their possible triggers are
recorded in [the roadmap](roadmap.md).
