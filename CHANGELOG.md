# Changelog

Notable changes to wikiwright, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). `wikiwright
version` prints the engine version and the commit a binary was built from.

## Unreleased

### Added

- **`libraries/kit-code`, the code wiki's type library** (v2 contracts §1,
  §12 step 5), id `code`, data only: the v1 kit `@wikiwright/kit-code`
  re-expressed as documents. The nine page kinds are abstract types with
  their v1 archetypes as roles, sections and `require` rows (relation labels
  now `part-of`, `mapped-in`, `verified-by`, `decided-by`), `quickstart` at
  most one page; the `anchored` fragment carries the engine `$def` `pin`
  (at least one covered path) where v1 had three sibling fields, Relations
  and an append-only History, and two rules: `covers-repository-path`
  (error), v1's lookahead pattern on `covers` re-expressed with
  `startsWith` and an RE2 match, and `relation-range` (warning), v1's
  `range` entry property as the rule's `ranges` config, read through the
  target's ancestry. `decision` carries `body-append-only`, v1's page-wide
  `body.lifecycle`, as a transition rule. Rule tests for
  `covers-repository-path` and `body-append-only` and examples of the three
  kinds a page may write without a relation ship with it; `relation-range`'s
  test set lives with its consumer, whose pages its negative names, so
  every bundle importing the library must carry `rule-tests/relation-range/`
  of its own: the gate refuses an import commit after a bundle's first
  (`rule-untested`, error), and `check` warns. Not
  carried: the v1 kit's templates (the skeleton is derived) and its skill
  fragments, which the brief no longer prints; the library's README keeps
  them as prose. `packages/kit-code` stays until the old verbs leave.
- **`libraries/kit-garden`, the neutral test library** (v2 contracts §1,
  §12 step 5), id `garden`, data only: the abstract `planting` type (role
  `procedure`: Observations as claims, an append-only History, Relations
  whose leaving relation lands in History) and the `bed` type, each with an
  example page; the `planted` fragment (a bed and a sowing date) with the
  rule `known-bed` (error: the bed is one of the `beds` its config lists,
  which a bundle extends with `configure`) and its test set; the
  `relations` and `observations` vocabularies. The allotment handbook
  imports it through `libraries[].path`, so its rule tests and examples are
  judged with that handbook; `libraries.test.ts` also imports it alone into
  an empty bundle and holds every test of it there.
- **`check` over the v2 law** (v2 contracts §9.1, step 4). Over a bundle on
  schema version 4, `check [--write] [--fix] [--dry-run]` reads the working
  tree through the v2 state, refuses a law that does not load
  (`constitution-invalid`, exit 2, its issues in `data.issues`) and a
  running engine outside the declared range (`engine-mismatch`, exit 2),
  judges every page, rule test and example with `judgeTypeLaw`, and adds
  beside the judge: `generated-drift` for each file under `generated/`
  (`BRIEF.md`, `graph.json`, `manifest.json`, `queue.md`, `tag-catalog.md`)
  that differs from a fresh render, fix `check --write`; `okf-missing-type`
  (error, `type-review`); every pin — a top-level property whose schema is
  the engine `$def` `pin` — measured against the repository the bundle sits
  in: `pin-stale` (warning, `source-review`) when its covered paths changed
  since its commit, `pin-unknown` (warning) when HEAD's history does not
  hold its commit, `citation-unresolved` (warning) for a cited path or line
  the commit does not hold, `pin-unmeasured` (info) with reason
  `remote-origin`, `no-repository` or `no-head`, and `stale-source-cited`
  (warning) on every page with an edge, of any kind but `tagged`, into a
  stale page. `--write` renders `generated/` through the staged replace;
  `--fix` implies it and first runs the folder-tag materializer under
  `folder_tags.mode: materialize-add-only`. The envelope carries the
  verdict, `pins` (`counts` and `entries`), `generated` (`files`,
  `written`) and, under `--fix`, `fixed`; `metadata.bundle` is the v2 block:
  engine.json's `label`, the law and content digests of what was judged.
  `generated/queue.md` holds every queued finding of a judge run with no
  base over the pages, and the law and content digests it was cut from. The
  judge gains the folder-tag rows (`folder-segment-registered`,
  `folder-tags-present`, whose route is `check --fix` under
  `materialize-add-only` and `tag-review` otherwise, and
  `former-folder-tags-review` over the index's renames), and a finding may
  carry `fix: {argv}` in place of `queue`.
- **`gate` over the v2 law, and the published hook definition** (v2
  contracts §8, §9.2). Over a bundle on schema version 4, `gate` reads the
  index with HEAD as its base, the law and libraries from the index, and
  HEAD's law for the law diff (no HEAD: an empty base and no diff). At
  `pre-commit` it judges every staged page with `judgeTypeLaw`, holds a
  rule the diff adds or changes to its test set (`rule-untested`, error),
  judges `generated/*` as staged once the index tracks it
  (`generated-drift`, `details.state: index`), reports the law diff as
  `law-changed` (info), demotes a queued error on a line the commit did not
  touch to a warning (`details.demoted_from: "error"`) — never a finding
  with no line, never a transition, and a finding at a section's heading
  only when the section's raw text is unchanged — leaves out the
  findings of an untouched page but those the base's names, a deleted
  page's among them, would not have given (a link, a relation target, a
  page reference, a CEL rule), and
  judges the whole vault, demoting nothing, when the commit stages `config/`, `constitution/`, `rule-tests/`,
  `examples/` or a library (`data.config_changed`); it exits 5 on any error
  left. `gate --commit-msg <file>` holds the message to `commit_prefixes`
  (`commit-prefix`, exit 5, one line on stderr) and every law change to a
  body line `law-change: <reason>`: without one it is `law-relaxed` (error,
  `law-review`), with one `law-changed` carrying the reason. The envelope
  names the index's law and content. `.pre-commit-hooks.yaml` at the
  repository root publishes `wikiwright-gate` (`pre-commit`) and
  `wikiwright-commit-msg` (`commit-msg`).
- **`write --from <dir>` over the v2 law, with `ops.json`** (v2 contracts
  §9.3 and the navigator's rulings 5 and 7). Over a bundle on schema version
  4, `write` reads `<dir>/ops.json` when present — `bases` (a page's
  expected `bytes` digest; a difference is `base-mismatch`, exit 4),
  `move` (`from`, `to`, `reason`), `retire` (`path`, `successor`),
  `retract` (`path`, `handle`, `date`) and `supersede` (`path`, `handle`,
  `by`, `date`), any other shape `ops-invalid` with its JSON pointer — and
  applies the operations in that order, then lays every `.md` draft under
  `<dir>` at the vault path it mirrors. A move adds the page's old name to
  its `aliases` and rewrites every wikilink naming it; a retirement sets
  `status: retired` and `superseded_by`; a retraction appends `(retracted
  D)` to the claim's line and a supersession `(valid →D-1, superseded D by
  #xxxxxxxx)`, `D` the operation's date or today. `created` is stamped on a
  new page and `updated` on every changed one, through `WIKIWRIGHT_TODAY`.
  The batch is judged together, with the disk as its base and each move as
  a rename, and lands whole (`draft-invalid`, exit 5, on an error on any
  page it touches or any other error the disk alone does not give —
  a page it makes invalid, a collision, an instance count — nothing
  landed); `--dry-run` answers with the same
  refusals and the plan the real run lands. Refused besides: a draft
  outside the content roots, at a path a move leaves, or of a page an
  operation changes; a missing page, successor or claim (exit 3); a
  destination that exists, compared case-folded, a move that changes only
  case (`move-case-only`), a claim already closed (exit 4). The batch
  writer never removes a path that is the same file as a page it just
  landed.
  `relation-removed` matches a relation by its label and the page its
  target resolves to, so a move's rewritten relation is the same relation.
- **`rule try`** (v2 contracts §9.4). `rule try --type <t> [--section <h>]
  --expr <cel> [--config <json>] [--base <ref>]` admits a candidate rule
  under the profile (`rule-invalid`, exit 2, with its limit), attaches it as
  `candidate`, severity error, to `<t>` and every type below it, and judges
  the working tree and, with `--base`, the revision (`revision-not-found`,
  exit 3): `working` and `base` each list `would_refuse` (path and
  location), `would_pass`, `unevaluated` (path and reason) and `errors`
  (path, kind, message). Exit 0 whatever the counts; nothing is written.
  The id `candidate` is reserved: a declared rule taking it is
  `rule-collision`, `details.kind: reserved`.
- **`read` and `search` over the v2 law, with each page's status** (v2
  contracts §9.5, §9.6). Over a bundle on schema version 4, `read` answers
  as before — a page by path, name, alias or title, its sections cut at its
  type's depth under `--budget`, `--section` — with the type's `role` and
  `ancestry`, `data.bytes` (the page's bytes digest, where the old verb had
  `page.digest`) and `data.status`: `stale` (true when a pin of the page is
  stale, reason `pin-stale`, or a page it links carries one, reason
  `stale-source-cited`; null when a pin of its own is unmeasured, reason
  `remote-origin`, `no-repository` or `no-head`, or not on HEAD's history,
  reason `pin-unknown`; false otherwise), and `unresolved`, the rule ids
  `generated/queue.md` holds for the page while its recorded law and
  content digests are the current ones, else null with `unresolved_reason`
  `queue-stale` or `queue-missing`. `search` answers as before and every
  result — a page, a record under `--items`, a file under `--files` — carries
  its page's `status`; its pins and its linked pages' pins are measured per
  result returned. `--items` ranks the §4 records; `--type` matches a type
  and every type below it.
- **`type show` and `type list` over the v2 law** (v2 contracts §3.3,
  §9.7). Over a bundle on schema version 4, `type show <name>` prints the
  effective contract with attribution: the role, ancestry and fragments,
  every top-level property of the effective shape with the documents that
  declare it (`reserved`, `fragment:<name>`, `type:<name>`) and the shape
  as compiled, the sections with the types and fragments that declare each
  heading, every rule with its declaring document and its config after
  `configure`, `meta` and `examples`. `--brief` adds the skeleton (§3.3),
  the writing instruction (a line per section: grammar, bounds, the item's
  spelling, the parameters, the vocabulary and its size) and every
  vocabulary the type reads with each entry's live count, its retired
  entries and the values the vault uses that it does not declare. `type
  list` lists every type with its role, whether it is abstract, its parent
  and its case.
- **The envelope's bound, `--out` and `--help --json`** (v2 contracts §9).
  An envelope over 1 MiB is refused as `envelope-too-large` (exit 2) with a
  hint naming `--out <file>`; `--out`, a global flag, writes the whole
  envelope to the file and prints a two-line pointer (`ok`, `command`,
  `exit_code`, `bytes`, `out`) on stdout, exit code the envelope's own, or
  `out-unwritable` (exit 2); a file inside the bundle the invocation reads
  (its root, or the nearest ancestor carrying `config/engine.json` or
  `config/constitution.json`, links resolved) is `out-inside-bundle`
  (exit 2), so no role writes a page, a law file or a generated file
  through it. `<verb> --help --json` prints the verb's
  schema, the registry row `schema` prints, and `wikiwright --help --json`
  every verb's; `<verb> --help` gains a `usage` line. No automatic spill, no
  preview and no report directory: deferred until `--out` is a burden.
- **The v2 type-document loader, beside the old one** (v2 contracts §2–§7,
  step 2). Nothing reads through it yet: every verb and corpus still loads
  `config/constitution.json`. What it loads:
  - `config/engine.json` schema version 4 (`schema: wikiwright/engine`,
    `schema_version: 4`, `label`, `engine`, `content_roots`, `source_roots`,
    `libraries`, `commit_prefixes` as a plain list, `field_sources` with
    `title` only, `folder_tags`, `folder_tag_aliases`, `extensions` with
    `mode` only), a strict JSON Schema. Unknown or ill-typed keys are
    `engine-invalid`.
  - `libraries: [{path}]`, resolved against the git top level of the
    repository holding the bundle, so a bundle at the root and one in a
    subdirectory name a library the same way; a path that leaves the
    repository by its spelling is `library-outside-repository`, one that
    names nothing is `library-missing`. A library's id is its directory's basename less a
    leading `kit-`, or `library.yaml`'s `id` (`library-invalid` when it is
    not a name); two libraries with one id are `constitution-collision`.
    Every file under `constitution/`, a library's `types/`, `fragments/`,
    `vocabularies/`, `rule-tests/` and `examples/`, and a bundle's own
    `rule-tests/` and `examples/`, that the loader does not read, and every
    symbolic link or submodule there, is `law-foreign-file`; so is a law
    directory or a library root that is a link or a submodule, or lies
    under one, from the working tree and from the index alike.
  - One YAML document per type, fragment and vocabulary, each held to its
    key table (`type-key-unknown`, `fragment-key-unknown`,
    `vocabulary-key-unknown`; `type-invalid`, `fragment-invalid`,
    `vocabulary-invalid`); names qualified as `<library id>/<name>`;
    `role-conflict`, `sections-conflict`, `sections-grammar-params`,
    `rule-collision`, `rule-section-unknown`, `configure-narrows`,
    `meta-unknown`, `vocabulary-collision`, `constitution-collision`. A
    rule whose id is a code the judge or the loader reports (`unevaluated`,
    `claim-provenance`, `law-changed`, `type-invalid`, …) is
    `rule-collision` too, `details.kind: kernel-code`: a finding, a coverage
    cell, an exception and `--rule` name a rule and a code alike.
  - `fields` as JSON Schema 2020-12, compiled by Ajv in strict mode with
    `pattern` on RE2 (no lookaround, no backreferences), `format` asserted
    for `date`, `date-time` and `uri` only by the engine's own validators,
    the engine `$defs` `page-ref`, `page-ref-list` and `pin`, the keywords
    `target_type` and `target_root` (on a top-level property only: the
    judge reads them nowhere else; a `target_root` naming a source root
    that no content root covers is refused, as no page there has a name), a
    `$id` per document, and one
    `unevaluatedProperties: false` at the type under `extensions.mode:
    registered`: `shape-invalid`, `shape-relaxed`, `default-conflict`, and
    `constitution-collision` for a document `$def` under a reserved name.
    An authored `additionalProperties` or `unevaluatedProperties` is
    `shape-invalid` where it would close the frontmatter itself (the top of
    `fields`, the subschemas applied in place there, `allOf` among them, and
    every document `$def` a `$ref` applies in place there); a nested object
    may be closed by its author (the navigator's ruling 8). A `$ref` at the
    top of `fields`, one to an engine `$def` applied in place there, and a
    `$ref` that comes back to its own `$def` without describing a value are
    `shape-invalid` too.
  - The fixed grammar: claims, relations and dated entries, one spelling
    each, parsed into records validated by the engine's `item-claim`,
    `item-relation` and `item-entry` schemas, each with its raw line, its
    rationale and its location as a line and a UTF-8 byte span; a top-level
    item that does not parse is `item-unparsed`. Items are read as CommonMark
    reads the section: a list line inside a fence, an HTML block (a comment
    among them) or a thematic break (`* * *`) is no item. The claim lifecycle clause
    is today's, kept as the one canonical form, spelled exactly as `write`
    renders it: a trailing `(retracted YYYY-MM-DD)`, or `(valid
    YYYY-MM-DD→YYYY-MM-DD, superseded YYYY-MM-DD)` with the first date
    optional (`(valid →YYYY-MM-DD, superseded YYYY-MM-DD)`) and, after the
    supersession date, an optional ` by #xxxxxxxx` naming the claim that
    replaced it by its handle (the navigator's ruling 5), after the
    provenance; `->` for `→`, a bare `(superseded D)`, a clause split in two
    parentheticals, another letter case, and a clause before the
    provenance do not parse. A parenthetical is taken for the clause only
    when one of its words is followed by a date or an arrow; `(valid for
    zone 7)` or `(superseded by hybrids)` is core text. The handle is today's, `#` and eight hex
    digits of sha256 over the core's normalised identity, computed and
    never written.
  - The page interface a rule is bound to (`page`, `section`, `config`,
    `facts`, `before`; identity `page-interface/1`); a page over 1 MiB,
    over 200 sections, with a grammar section over 5,000 items, a
    frontmatter list or map over 1,000 members or links to over 10,000
    distinct pages is `page-too-large`, the bound in `details.limit`
    (`bytes`, `sections`, `items`, `list`, `links`).
  - Rules in CEL under the profile `cel-profile/1`: refused at load as
    `rule-invalid` with the limit in `details.limit` — `bytes` (over 4,096),
    `parentheses` (nesting over 32), `parse`, `nodes` (over 512), `call`
    (`timestamp`, `duration`, a `get*` time method, `format`), `literal` (a
    message literal), `pattern` (a literal `matches` pattern RE2 refuses),
    `nesting` (comprehensions over 2 deep), `chaining` (over 4 side by
    side), `range-not-bound` (a comprehension over anything but a direct
    interface path) and `cost-bound` (a static worst case over 200,000
    iterations, a config list counted at its length after `configure` and
    an ancestry chain at 32, the navigator's ruling 1; a `configure` that
    grows a rule past the bound is refused at its type), and `config` (a
    rule's config list or map, or one a `configure` writes, over 1,000
    members). An ancestry chain over 32 types is `law-too-large`. The law's own ranges are held
    at load: a vocabulary over 10,000 entries is `vocabulary-invalid`, a
    declared `default` list over 1,000 is `type-invalid`, and over 10,000
    types or vocabularies is `law-too-large`. A result that is not a bool
    is `rule-error`; a transition rule under a state with no base is
    `unevaluated` (`no-base`), and a page new to a state with a base is
    evaluated with `before.present` false.
  - The digests: `bytes`, `content`, `page.digest` (canonical frontmatter,
    `meta` keys removed) and `law` (every loader-read file, the interface
    and profile identities, eight dependency versions, the engine version),
    one value from the working tree and from a git index of the same bytes.
- **The v2 judge, beside the old one** (v2 contracts §4–§6, §8, §10, step
  3, and the navigator's rulings 2 to 5). `judgeTypeLaw(state, law)` in
  `@wikiwright/core`, and four states in `packages/cli/src/lawstate.ts`: the
  working tree (no base), drafts over the disk (the disk as base), the index
  (HEAD as base) and a revision (no base), each carrying the law it read
  from the same place as its pages; the working tree is read twice and
  compared by digest, once more on a difference, then refused as
  `state-changed-during-read`. No verb calls either yet; the tests import
  them.
  - Findings take the §6 shape — `rule`, `severity`, `path`, `location`
    (the page, or a section occurrence and a line), `message`, `details` —
    and every error and warning names one queue lane; a CEL rule's findings
    queue to `rule-review`. Each v1 id the kernel keeps is carried by a
    code of the new table (`docs/v2-dispositions.md` names which).
  - Per page: `page-too-large`, `page-not-utf8`, `malformed-frontmatter`,
    `duplicate-key`, `frontmatter-not-mapping` (with the line),
    `type-unknown`, `abstract-type`, `page-shape-invalid` (one per Ajv
    error), `page-ref-type` (a reference that names no page or
    is written as a path, `target_type`, ancestry counted, and
    `target_root`; an error, as v1's `field-shape` was), `vocabulary-unknown` and `vocabulary-retired` (the
    bundle's `tags` vocabulary, a claim's category, a relation's label),
    `wikilink-unresolved`, `wikilink-alias-target`, `renamed-without-alias`,
    `section-count`, `section-order`, `section-undeclared` (a heading
    under `additional: refused`), `section-depth`, `item-unparsed`, `category-not-allowed`,
    `claim-provenance`, `claim-closed` and `claim-open` (the claims grammar
    gains `closed: allowed | refused | required`, ruling 4),
    `relation-target-unresolved`, `require-unmet` (ruling 2); a finding
    about a frontmatter key carries the key's line in `details.line`, as
    v1's did; for the vault,
    `identity-collision`, `instances-min` and `instances-max`.
  - The kernel transitions (ruling 3), against the base: `entry-edited`
    (`lifecycle: append-only`), `claims-transition` (an open claim, by
    category and handle, closed, corrected or recorded by a dated entry
    quoting it) and
    `relation-removed` (recorded by a dated entry in the `history` heading,
    which the loader holds to an `entries` section, `type-invalid`
    otherwise). CEL rules
    evaluate per page or per matching occurrence; a result that is not a
    bool is `rule-error` (`details.kind` `non-bool` or `error`). A
    transition, the kernel's or a rule reading `before`, is `unevaluated`
    (info, reason `no-base`) where the state has no base, counted in the
    verdict's `unevaluated` block, never passed.
  - The reserved `exceptions` key closes every queued finding of its rule
    on its page as `exception-applied` info; `exception-stale` and
    `exception-illegal` as before. An entry naming a transition the state
    cannot judge on the page (no base) is neither stale nor applied there.
  - Rule tests and examples (§8): `rule-tests/<rule id>/` with
    `negative.md`, `repaired.md`, `positive/`, `before/` twins and
    `expect.json`, overlaid from outside the content roots and excluded from
    instances and identity, their own `exceptions` applying to nothing (a
    repaired twin cannot pass by waiving the rule it tests); `rule-untested` (a warning, an error for a rule
    the gate's diff adds or changes), `rule-test-fails`, `example-fails`.
  - The law diff between HEAD's law and the index's (`lawDiff`, the revision
    adapter beside the index one), each change with `details.kind` —
    beyond the contracts' list, a vocabulary's `mode`
    (`vocabulary-mode`), an entry no longer retired
    (`vocabulary-retired-removed`), a rule a type no longer carries while it
    stands (`rule-attachment`), and the engine keys `extensions`,
    `source_roots` and `field_sources` — and, where HEAD's law does not
    load, one `head-law-unloadable` change with every rule counted as
    added (`headLawDiff`), as
    `law-changed` (info) at pre-commit and `law-relaxed` (an error) at
    commit-msg unless the body carries `law-change: <reason>`.
  - What changed from v1 on the way: a finding's code, as the table maps
    it; the grammar parameters' severities, fixed per code (a section's
    `severity` is gone); no page finding is fix-routed (the page fixers
    leave with `fix`); `claims-transition` holds every open claim now that
    the category classes are gone; an exception carries no digest and
    closes every finding of its rule on its page. Not yet in the new judge:
    the gate's line-scoped demotion and change-scoping, which come with the
    `gate` verb. A symbolic link or a submodule at, under or above a
    content root is read through by no v2 state, and each reports it as
    `path-skipped`. `docs/roadmap.md` states each.
- `docs/v2-dispositions.md`, generated by `bun tools/dispositions.ts`:
  every rule id, constitution key and engine key of the v1 tree as
  `kernel`, `rule` or `dropped`, enumerated from the tree so none can be
  missed.
- Core's dependencies gain `ajv` 8.20.0, `@bufbuild/re2` 0.6.1,
  `@bufbuild/cel` 0.6.1, `@bufbuild/cel-spec` 0.6.1 and `@bufbuild/protobuf`
  2.15.0, each pinned exactly.

- `bun run binary` compiles the CLI into one executable, `dist/wikiwright`
  (`bun build --compile --bytecode --format=esm
  --no-compile-autoload-dotenv --no-compile-autoload-bunfig`, the build
  stamp compiled in through `--define`), which answers `--help` and `check`
  byte for byte as `bun packages/cli/dist/main.js` does. It carries none of
  the files the package ships: `init` and `skills` refuse there as
  `shipped-files-absent` (exit 2), `check` compares no installed skill, and
  `version` reports no checkout (`docs/roadmap.md` §The compiled binary).
- The pipe probes (`test/pipe-boundary.test.ts`): the built CLI's envelope,
  read through an operating-system pipe (a shell's) on purpose by a reader
  that starts late, arrives whole — a default envelope, a 70,000-byte one
  and an error envelope, through `bun dist/main.js` and through a binary
  built for the run. The probe is proven able to fail: a writer that calls
  `process.exit()` after a 70,000-byte write comes out of it short. Bun's
  own spawned "pipe", which the first probes read, is a socket on macOS
  that buffered more than 500 KB, so a CLI that cut its envelope passed
  them.

- A bundle declares its **exports** in `config/engine.json`: read-only
  copies of the bundle, or of part of it, that an agent host installs as
  skills. Each selects every page, the pages carrying a tag or the pages under
  a directory; says whether a link to a page left out withholds the export
  until the selection is widened (`links: closed`) or is cut and counted
  (`cut`); names a guide page, where a problem
  with the copy is reported, a license and a fragment of its own for the
  skill text; and is rendered into the bundle's own `skills/<name>/`
  (`output: skills`) or written into another repository (`output:
  external`, with a `repository`). A name, when undeclared, derives from the
  bundle's label and the selection. `plugin` declares the two plugin
  manifests written beside them. A declaration that cannot be rendered is
  refused when the config loads, by name.
- A rendered export is a vault: its pages, `config/` verbatim, the templates
  and examples the loader validates, each declared kit at its declared
  location — exactly the files its digest covers, and the marker's law taken
  from the bytes the copy carries, the index's under the staged gate — the
  files its pages embed, `generated/` over the selection with a
  consumer's brief that names the export, a `SKILL.md`, and the marker,
  `config/export.json`, which names the export and the bundle and records the
  digests it was cut with. A copy holds bytes, never a link: the working tree
  is read through its links, so a kit a package manager installed as links
  travels as files under the same law digest, and a link in a rendered copy is
  replaced by bytes. A file reached through a link that leaves the bundle, or
  a link the index tracks at the staged gate, refuses the export,
  `export-symlink`.
- `check --write` renders every `output: skills` export and the plugin
  manifests, replacing what differs — an ordinary file stays until its
  replacement is renamed over it — and removing what the plan no longer
  holds, a `.git` or `.obsidian` name under the export's directory included,
  and nothing else; a symbolic link on the path from the root to where
  an export writes, `skills/` itself included, is `export-destination-linked`
  and nothing is written through it; `check` holds each rendered copy to a fresh render,
  `export-stale` (fixed by `check --write`), and queues the render's own
  refusals to `export-review`. The staged gate makes the same comparison over
  the index, so a page or a kit declared by `path` staged without its
  re-rendered export is refused. It loads that kit from its staged bytes and
  reaches its verdict over the staged pages, its artifacts and its export
  plan under them, and a staged kit that does not load refuses it with the
  loader's own code; a kit under `node_modules` is read from the working
  tree. The two gardening handbooks track theirs.
- `export <name> --to <dir>` writes one `output: external` export into the
  repository at `<dir>`, as `<dir>/skills/<name>/` with the manifests beside
  it, and refuses an undeclared name, an `output: skills` export, a
  destination that is the bundle's root or in a content root, a
  `skills/<name>/` without a marker, a symbolic link where it writes, and an
  export a render finding refuses or withholds.
- An installed copy identifies itself: over a root that carries a marker,
  `metadata.bundle` takes its label from the marker, reports no `head` and no
  `dirty`, and names the export in `export`, with `intact: false` when the
  copy's law or pages changed after it was cut. A marker that is not one is
  refused, `export-marker-invalid` (exit 4), before any module loads. The
  brief over a copy is always the consumer's, whatever role is asked for, and
  its header names the export.
- A module declaration may name a bundle-relative directory, `path`, instead
  of an installation under `node_modules`: `{ "package": "kit-garden",
  "path": "kit/garden" }`, for a kit a bundle carries in its own tree. The
  declared path is authoritative, with no fallback to `node_modules`: no
  directory there is `module-unresolved`, naming the path. It is held to the
  vault path law, as a content root is, so `"../kit"` or an absolute path is
  refused when `config/engine.json` loads, and a declared directory whose real
  path lies outside the bundle is `module-malformed`. One resolver reads both
  spellings for the loader, the law digest and `modules list`, whose
  `resolved.path` prints the declared path.
- Every envelope of a verb that reads a vault's law names the bundle it read,
  in `metadata.bundle`, on an ok envelope and a refusal alike: `label` (the
  basename of the root's real path), `root` (that real path), `head` and
  `dirty` from the enclosing repository (`null` where git names none), `law`
  (sha256 over `config/constitution.json`, `config/engine.json` and the digest
  of each declared module installed under the bundle's `node_modules` or
  carried at its declared `path`, whether or not it loads) and `content` (sha256
  over every page under the content roots, path and bytes, as the working tree
  holds them). An answer read from one bundle can be told from an answer read
  from another, and an uncommitted edit shows in `content` and `dirty` while
  `head` stays where it was. `version`, `schema` and `bundles` carry
  none. The brief's header prints the law digest in place of a digest of the
  sorted type names, which did not move when a type's contract, the engine
  policy or a module changed.
- `--bundle <name>` names the target of any verb by the name of a bundle
  skill installed in a skill directory, in place of `--root`, so an agent
  working in an unrelated directory reads two handbooks by name and every
  answer says which one it came from. Nothing registers a bundle: the name is
  held to the skill grammar (`bundle-name-invalid`), then probed in the
  project's `.claude/skills` and `.agents/skills` from the working directory
  up to the top of its repository, the user's `~/.claude/skills`,
  `~/.agents/skills` and `/etc/codex/skills`, and each directory of
  `WIKIWRIGHT_SKILL_DIRS`; plugin caches are not scanned. A candidate's marker
  must parse and name its directory, or it is skipped with its reason. One
  identity — the marker's repository, bundle and name, a copy with no
  repository only ever itself — resolves to the nearest copy, and
  `metadata.bundle.shadowed` lists the rest; two identities are
  `bundle-ambiguous`; none is `bundle-not-found` with the directories
  searched and the names seen. `one-target` refuses `--bundle` beside
  `--root`.
- `bundles list` prints the same scan, one row per copy — its name, bundle,
  tier, root and real path, whether it is a link, the marker's repository and
  digests, selection, page count and contribution, what its installer wrote
  into its `SKILL.md` frontmatter, and the root that shadows it — and one row
  per directory whose marker it cannot take. It reads markers only: no law, no
  kit, no page.
- The maintain skill gains the export practices: which
  output fits, the distribution repository as the copy's identity, a pull
  request against a generated tree ported by hand, and that an external
  export is not a redaction boundary.
- `WIKIWRIGHT_SYSTEM_SKILL_DIR` names the machine's skill directory the scan
  reads after the user's; `/etc/codex/skills` when unset, none when empty.
- A vault path that resolves outside the vault — a config linked out of it,
  say — is refused `linked-outside-vault` (exit 4) from any verb, where it
  was `unexpected-error` or, from the loader, a parse failure.
- A root that holds a marker is read only however it is named: a verb that
  can write is refused `bundle-readonly`, `--dry-run` included, with a hint in
  the words of the copy's contribution mode, and a marker that is not one is
  `export-marker-invalid` before any module loads. A courtesy on the CLI, not
  isolation.
- `read <page> [--section <heading>] [--budget <bytes>]` returns a page's
  sections verbatim, cut at its type's section depth, each with its address,
  lines and byte length, beside the page's type, chain, frontmatter and
  digest — sha256 over its raw bytes, the same one the content digest holds
  for it. A page is named by path, basename, alias or title, and
  `resolved_via` says which; a miss names no page, and a page linked out of
  the vault is `invalid-path`. Its title and description
  are the manifest's, derived under `field_sources` where the frontmatter
  carries none. Under `--budget` the sections come in page order while they
  fit and the rest are listed by address. A heading a type admits more than
  once keeps its one address, each of its sections carries `occurrence`, and
  `--section` returns every one of them in page order. A consumer's verb: the
  envelope's bundle block says which bundle every passage came from.
- `search <query> --items` ranks the grammar items themselves instead of
  pages: every claim, relation or entry the judge would parse on the pages the
  filter flags keep, each with its path, line, section, kind, grammar, raw
  line, rationale lines, whether the match was on the item's line or under it,
  and the grammar's own fields verbatim — for a claim its handle, category,
  core and provenance. BM25 ranks over the item's line and its rationale;
  an item holding a term only inside a longer word follows unranked, as a line
  search would find it. An item on a retired page has its score halved and
  says so, as the page does. The coverage block counts the pages and the
  items considered. `--all` lifts the result cap of either form.
- `write --from`'s real run answers in its dry run's shape: `ops`, the plan
  for the drafts the run read and judged, built before anything landed, and
  `wrote: true`, beside the same `pages`. The directory is read once, so a
  draft added while the run works is neither landed nor reported.
  A caller keying on `wrote` read `false` from the dry run and nothing from
  the real one.
- `search <query> --files` lists every page with a match, path and reasons
  only, in code-unit order and uncapped: the pages the ranked search finds,
  identity matches included, plus every page whose normalized text holds a
  query term inside a longer word — a tokenized, case-folded substring scan
  plus the identity matches, not a literal line search. `search --band identity|relevance` keeps one band of the ranked
  results, and of `--files`, where it is applied after every match is
  classified, so no identity match is listed as a substring match.
- A third shipped skill, `wikiwright-consume`, the runtime skill every bundle
  skill requires: how to run the engine (the one route today, since no
  published package exists yet: clone the repository, `bun install`,
  `bun run build`, and run `node <clone>/packages/cli/dist/main.js` by its
  absolute path from the directory you work in), what a bundle
  skill is and how to find one, the consumer's commands with their
  discipline — say which bundle answered, read the coherent section, hand a
  subagent the words verbatim with the bundle, the path and the digest —
  where a proposal goes by a copy's contribution mode, never into an
  installed copy, and what is left without the engine. It is the one
  hand-written skill that names verbs, and each of its invocations is held to
  the parser. `init` and `skills update` install it beside the other two.
- The package is a Claude Code plugin: `.claude-plugin/plugin.json` beside
  the three skills, and `hooks/hooks.json` with two plain-Node scripts. At
  session start one runs `bundles list`, which reads markers only, and names
  each installed bundle skill with the action that fits how it was installed
  — linked to a checkout, pinned, an installer's update, or installed by
  hand — and how a command names one, saying so again after a compaction or
  a resume; it checks nothing remote. After an Edit or a Write the other finds
  the bundle the file belongs to by its ancestry: in an installed copy it
  says the next update overwrites the edit and where a change goes, and lints
  nothing; elsewhere it lints the page with `--root` and names its findings,
  each with its route, a fix's argv quoted for a POSIX shell, and each pass
  the page could not be judged by without a base, which the staged gate
  judges against HEAD. A page or a content directory that is a link inside
  the vault keeps the path it was edited at. Both print nothing when there is
  nothing to say or anything goes wrong, and exit 0. They are tested against
  the documented hook input and output; host behaviour is not verified here.

### Changed

- The three skill documents move from `packages/cli/skills/` to
  `docs/skills/` (v2 contracts §1, §12 step 6), and the package ships none of
  them. They are rewritten against the eight verbs: `wikiwright-consume` is
  the reader's skill — the setup, `search`, `read` with its sections, digest
  and `status`, `type show --brief`, the proposal a knowledge problem becomes
  — and no longer the runtime skill of installed bundle copies, which left
  with the exports; `wikiwright-write` starts a page from `type show
  --brief`'s skeleton and lands a cluster as one `write --from` batch;
  `wikiwright-maintain` adds a rule's test set and the `law-change:` line,
  names the gate's refusal text, and loses the hook reinstall and the export
  practices. The playbook is `finding-response.md` (it was
  `lint-response.md`, named for a verb that left), rendered by
  `tools/render-playbook.ts` from the verdict table — every code the judge
  and the verbs beside it emit, with its severity, its route and the v1 ids
  it carries — where it rendered the old pass table and the fixer registry.
  The renderer writes only when run as a script; imported by the test that
  holds the file to it, it had rewritten the file in the checkout.
- **`fixtures/minimal-vault` is on the v2 law** (v2 contracts §12 step 5),
  migrated by `tools/migrate-spellings.ts`: `config/engine.json` at schema
  version 4, `constitution/` with the `test-case` type (role `procedure`),
  the `tags` vocabulary and the `append-only` fragment, whose rule
  `body-append-only` re-expresses the type's v1 `body.lifecycle:
  append-only` in CEL with its test set under `rule-tests/`; the type's
  `template` is dropped (the skeleton is derived), and `generated/` is
  rendered and tracked. Its one broken case keeps its three defects under
  the v2 names: `page-shape-invalid` (the undeclared `rogue_key`),
  `section-count` (no Execution) and `vocabulary-unknown` (the tag
  `mystery`). The old table's tests read a frozen v1 copy,
  `fixtures/v1/minimal-vault`, until they leave with the old verbs.
- **`fixtures/memory-synth` is on the v2 law** (v2 contracts §12 step 5),
  migrated by `tools/migrate-spellings.ts`: 16 types (v1's `concept` and
  `reference` bases are roles), the `claim-classes`, `dated-log` and
  `append-only` fragments, the `tags` and `categories` vocabularies. Facts
  is a claims section with `closed: refused`, where v1 named a History
  heading for a closed claim; History and Timeline are entries sections.
  98 relation labels are respelled with hyphens and 52 entries with ` — `.
  Dropped with their mechanisms: the categories' `class` (supersede,
  accumulate, journal-only), `field_sources.description`, and the dialect
  census the v1 verdict was (`canonical-form`, `hearsay`, `marker-like`,
  `provenance-weak`, `sourced-inferred`, `journal-only-category`): under §4
  a marker such as `(stated 2031-04-11)` is core text. Its verdict is the
  planted `section-depth`, nine `item-unparsed` — six undated Timeline
  lines of one day, one History line with no date, and the two lines
  planted for the v1 census, a relation with no link and a fact with no
  category — and one `page-shape-invalid`, a `status: draft` the reserved
  `status` does not admit.
- **`fixtures/handbooks/orchard` is on the v2 law** (v2 contracts §12 step
  5), migrated by `tools/migrate-spellings.ts`: `procedure-page` (role
  `procedure`) and `guide-page` (role `hub`) as type documents, the `tags`
  vocabulary. Its two `exports` leave with the v4 engine.json, which has no
  such key, and their renders under `skills/` with them; the export
  mechanism itself leaves in step 6. `procedure-page` gains an optional
  `source` (`format: uri`) and the rule `source-host-allowed` (warning:
  a source's host is one of the handbook's `hosts`), one of the spike's
  rules kept as the example of a bundle's own rule, with its test set;
  `thinning-apples` names its source. The handbook is clean under `check`
  and `gate`. The old table's two-bundle tests read frozen v1 copies of
  both handbooks under `fixtures/v1/handbooks/`.
- **`fixtures/handbooks/allotment` is on the v2 law** (v2 contracts §12
  step 5), migrated as the orchard was, its one export and its render under
  `skills/` leaving with the v4 engine.json. `procedure-page` gains an
  optional History section (an entries section, append-only) and the rule
  `history-dated` (warning: every History entry is dated to the day), the
  spike's other example of a bundle's own rule, with its test set;
  `watering-beans` carries a History. The handbook is clean under `check`
  and `gate`.
- **`devwiki` is on the v2 law, importing `libraries/kit-code`** (v2
  contracts §2, §12 step 5), migrated by `tools/migrate-spellings.ts`:
  engine.json names `libraries: [{"path": "libraries/kit-code"}]`, resolved
  against the repository's top level, where it declared the module
  `@wikiwright/kit-code`; its ten types extend the library's (`charter`
  takes the role `hub`), their `origin` pattern now a constraint on the
  pin's own `origin`; its empty `relations` vocabulary is the library's
  `code/relations`. The 27 anchored pages fold `pin`, `origin` and `covers`
  into one pin object, and 72 relation labels take hyphens. The library's
  `relation-range` gets its test set here, since its negative names a page
  of this vault. `devwiki/package.json` and the `devwiki` workspace leave:
  nothing is installed for it. `check --root devwiki` reports no error; its
  warnings are its pins, stale since the v2 work changed the code they
  cover, until the documentation step re-reads and re-pins them.
  `tools/uncovered.ts` reads the covered paths inside the pin. The old
  verbs' tests read a frozen v1 copy, `fixtures/v1/devwiki`; the old
  `lint`'s routing and coverage over the corpora are no longer measured,
  their v2 forms are.
- Every git read is an asynchronous spawn (`Bun.spawn`) awaited to the
  child's exit, at most four children at a time, keeping the file-backed
  protocol: the answer read from a file git wrote, a batch request handed
  over as a file, stderr read to its end under an 8 MiB bound, the
  terminators and cross-checks. Every git child runs under a timeout,
  `WIKIWRIGHT_GIT_TIMEOUT_MS` (60,000 ms when unset): one still running then
  is killed and the verb refused as `git-timeout` (exit 1), and a value that
  is not a whole number of milliseconds is `git-timeout-invalid` (exit 2).
  A child that has exited is answered when it exits, its stderr given up one
  second after if a process it started still holds it. Every git child
  carries `LC_ALL=C` and `GIT_OPTIONAL_LOCKS=0`, and the two `status` reads
  use `-z`. Every verb path awaits it, the loader included; envelopes are
  byte-identical to the synchronous build's. `move`'s `git mv` and the
  plugin's hook scripts no longer spawn synchronously, and no shipped file
  does.
- Bun only. `.bun-version` pins the Bun the engine is built, tested and run
  with (1.3.11), and every `engines.bun` pins it exactly; no package names a
  Node engine. `bin.js` and `main.js` are Bun scripts, and the plugin's
  hooks run under `bun`. The suite runs the CLI under Bun with its stdout on
  a file (`runCli`); the `WIKIWRIGHT_CLI_RUNTIME` seam, which ran it under
  Node, is gone.

- `bun run build` removes each package's `dist/` before it compiles, so the
  output of a deleted source can no longer be packed.
- Every load proves a module: after the purity scan and the entry and
  fixture checks, and after the entry is imported, the loader runs the
  module's determinism fixture, and a failure refuses the module with the
  fixture's own code (`module-fixture-failed`, `module-nondeterministic`) and
  hint, from every verb that reads the law. Both proofs are kept for the
  process by the digest of the module's bytes and the purity scan's version,
  so two bundles that install the same bytes are proved once; nothing is
  kept between processes. `modules list` reports each module's fixture
  result from its load and no longer reports a grant; `modules plan` refuses
  a candidate that fails its own fixture as `candidate-unresolved`, with the
  fixture's issue.
- The purity scan refuses an import of any form — an `import` declaration,
  `export … from`, a dynamic `import(` and `require(` — and computed access to
  `Date`, `Math`, `performance`, `Intl` or `process` (`Date["now"]()`), each by
  file, line and reason, reading each file as written and with its comments
  blanked and refusing on either, so a comment between a banned word and its
  token hides nothing and a comment that holds a construct is refused as
  one. `docs/extending.md` §The purity scan lists every rule, and
  says what it is not: it narrows, it does not sandbox.
- `type show --brief` leads its data with `brief`, `skeleton` and
  `section_lines`, before `fields`; key order only. `new` writes no `title:`
  where `field_sources.title` is `basename` and the title given is the
  destination's name, which the line would only repeat; the H1 keeps it, and
  a title that differs from the name is still written. `vocabulary show` carries `names`, every
  entry name sorted.
- `write --replace-core` supersedes a claim on its own date: the History
  line closes it `valid D→D, superseded D`, a zero-length interval, where the
  verb refused because `D→D-1` would run backwards, and an author bent the
  one-open-truth rule instead. A date before the claim's own is still
  refused, now as `date-before-claim`; the code was `date-not-after`, which
  the same date no longer is.
- `write --section --append --coexist <reason>` renders its rationale line
  reason first, `coexists: <reason> (beside <handle>, <handle> and <n> more)`,
  naming the two newest open claims of the category and counting the rest.
  It named every open handle before the reason; on one page that was nine.
- The brief renders one loop per role. The consumer's names no verb: select
  the bundle and pass its root explicitly, search every name form before
  saying a thing is absent, keep each answer's `metadata.bundle` beside what
  was taken from it, hand a child verbatim passages with their source, and
  report a knowledge problem as a proposal rather than an edit. Every role's
  loop opens on one line, "Use the engine to decide, to write and to
  attribute; use your own tools to look."; after it the writer's five steps
  are unchanged, byte for byte, and the generated brief around them moves,
  since its header now names the law digest, its verb list holds `bundles`
  and `read`, and its `read`, `search` and `write` slots say how a page is
  named, what `search` returns, and that a page arrives on stdin. The three
  skills state the same line once each, and the write skill is called for a
  session that began writing pages part-way through another task. The
  maintainer's adds two to them: a queued finding is a judgment
  to adjudicate or a law to change, never a severity to lower, and
  `generated/` is committed with the pages it describes. Every role had been
  handed the writer's loop, which walks a consumer into `write`. The
  "Findings" paragraph is the role's too: the consumer's runs nothing, since a
  `fix` argv is a writer's to run and a `queue` a maintainer's to judge; the
  writer's and the maintainer's paragraph is unchanged.
- `wikiwright-write` no longer carries the two-week test with promotion on
  repetition, nor the rule that an inference describes behaviour rather than
  taste. Both are retention conventions of one kind of wiki, a personal
  memory, and belong to a kit that serves it, not to the engine's skill for
  every bundle; the evidence discipline stays (the hedge kept verbatim, the
  context envelope, a contrary observation added rather than overwritten).
  `wikiwright-maintain` gains one section: a bundle's guidance governs that
  bundle alone, a copy's read-only guard and a session's role are guardrails
  on the command line and not isolation, and which modules run is the
  bundle's reviewed declaration, never a skill's.
- The shell's modules import in one direction, and a test holds them to it.
  The registry imported every verb while `schema` and the brief imported the
  registry back, and the artifact writer imported the brief *verb*: eight
  cycles in all, benign until a binding is read at module scope. The registry
  now travels with the invocation as `CommandArgs.commands`, the brief's
  renderer sits below every verb that renders one, and the kernel's page-name
  helper moved into a module that imports nothing, which was the whole
  content of the `fields`/`names` cycle.
- `CommandSpec` is a union on `writes`, so a writing verb without a `plan` no
  longer compiles. The meta-test that scans each verb module for reachable
  writes stays: the type holds the declaration together, the test holds the
  declaration to the code.

- A verb declares whether it reads the vault's law, and the entry point
  preloads a bundle's declared modules only for one that does. `schema` and
  `version` no longer digest and purity-scan a bundle's modules to answer a
  question about the engine.
  The declaration is held against what each verb's imports reach, so a verb
  that starts reading a vault cannot keep saying it does not.

- A directory is a citation of its own and is not the file a later bare line
  names, and a bare name resolves only to a covered file, suffix included: a
  page that mentioned `packages/` or the `skills` verb in passing had the
  next `:31-44` read as a line inside a directory.
- `freshness` reads three more citation spellings and validates ranges: a
  root file (`AGENTS.md:12`), a bare file name that is the basename of
  exactly one covered path (`git.ts:31`), and a line or a range alone
  (`:31-44`), which names the nearest path cited before it on the page.
  Only a token holding a `/` was checked before, which left most of a page's
  line citations verified by nothing — 386 of 1233 across devwiki — and
  `:999-1` was read as line 1 rather than refused. A span that resolves to no
  path is now reported as itself, `unattached`, `ambiguous` or `malformed`,
  rather than attached to an earlier file, and every unresolved row carries
  its `reason`.

- `gate` and `lint --staged` read the index once: the staged diff and the
  index listing were each spawned again for the second pass, the one over the
  roots the staged constitution names, and the diff a third time before both.
  A one-page commit now spawns 8 git processes, one of them the `git status`
  of the envelope's bundle block. Interleaved against the previous build,
  the gate over a small repository fell from 172 ms to 154 ms and over the
  embedded devwiki from 270 ms to 252 ms; the envelopes are identical.
- The gate reads the HEAD bytes of every changed and deleted page with one
  `cat-file --batch-check` and the batch read the staged pages already use,
  where it spawned one `git show` per page. A commit of 100 changed pages in
  a 1,000-page repository spawned 106 git processes and spawns 8, and gates
  in 0.52 s instead of 1.13 s; a one-page commit is unchanged, and the
  envelopes are identical. The batch parser now reads a `missing` line
  whose name holds a space.
- The `wikiwright` executable is `dist/bin.js`, which switches on Node's
  compile cache for the engine's own JavaScript before loading
  `dist/main.js`: ES module imports load before a module's body runs, so the
  cache has to be switched on one module ahead of the engine. It holds V8
  bytecode keyed by source under the temporary directory, nothing of a
  vault, and cannot change a verdict; `NODE_DISABLE_COMPILE_CACHE=1` turns
  it off. A small vault's `lint` took 87.9 ms and takes 77.0 ms, the
  devwiki's 178.5 ms and 167.3 ms, interleaved on one build; every agent call
  and git hook that runs `wikiwright` pays the lower figure. `main.js` still
  runs directly, without the cache.

### Removed

- The exports (v2 contracts §1, §12 step 6): `exports.ts`, the planner of a
  bundle's read-only copies and their in-repository renders; `marker.ts`,
  the copy's marker `config/export.json`, and main.ts's check of it, with the
  refusals `export-marker-invalid` and `bundle-readonly`; the `export` block
  of `metadata.bundle`; and `brief.ts`, the old brief renderer, which only
  the exports still called. No verb has reached any of it since the old
  table left. The handbooks' `exports` keys and rendered `skills/`
  directories left with their migration to the v2 law (step 5); their frozen
  v1 copies keep theirs until `fixtures/v1` leaves. The loss and the trigger
  for a return are in `docs/roadmap.md` §No exports.
- The old command table (v2 contracts §1, §12 step 6): the 24 verbs of the
  old tree under `packages/cli/src/legacy/`, which answered every root not
  on schema version 4, and their tests. One table answers every root now:
  a verb of the old tree is `unknown-command`; a directory that is not
  there, or that holds no `config/engine.json`, is `bundle-not-found`
  (exit 3), where the old verbs answered `vault-not-found` and
  `registry-not-found`; a bundle still on `config/constitution.json` is
  `constitution-invalid` (its engine.json is not schema version 4), and
  `tools/migrate-spellings.ts` rewrites it. Gone with the verbs: the
  starters under `packages/cli/constitutions/` (`base` and `code`, both on
  the v1 law) that `init` copied, and the package's `constitutions` entry;
  the shipped skills' installer and its stamps (`skills.ts`);
  `shipped-files-absent`, which only `init` and `skills` raised from the
  compiled binary; exit code 10, `confirm_required`, which only the old
  `write`'s identity gate raised (`identity-candidates`,
  `open-claim-of-category`); and the old verbs' shared modules
  (`artifacts.ts`, `pages.ts`, `staged.ts`, `state.ts`). The loss beyond
  what the entries below already state: no command lays a bundle down
  (`docs/roadmap.md` §No starter). The tests of what survives — the git
  transport, the envelope, the exit taxonomy, the bundle block, commit
  prefixes, the path law, the dry-run law, the pipe probes, the binary and
  the packed install — run through the eight verbs.
- The discovery of installed bundle skills (v2 contracts §1, §12 step 6):
  the global flag `--bundle <name>`, which named any verb's target by the
  name of a bundle skill in the skill directories, the `bundles` verb
  (`bundles list`), `discovery.ts`, the variables `WIKIWRIGHT_SKILL_DIRS` and
  `WIKIWRIGHT_SYSTEM_SKILL_DIR`, the refusals `one-target`,
  `bundle-name-invalid` and `bundle-ambiguous`, and `metadata.bundle.shadowed`.
  `bundle-not-found` stays, for a root that holds no `config/engine.json`. A
  target is named by `--root`. The loss and the trigger for a scan's return
  are in `docs/roadmap.md` §No bundle is found by name.
- The Claude Code plugin (v2 contracts §1, §12 step 6): the package root's
  `.claude-plugin/plugin.json` and `hooks/` — `hooks.json`, the
  session-start hook that listed the installed bundle skills through
  `bundles list`, and the post-edit hook that ran `lint --page` over an
  edited page — and `hooks-scripts.test.ts`. The package no longer ships
  either directory. The loss: an edit a host makes through its own tools is
  judged at the commit, not as it lands, and a session is not told which
  bundles it can reach; `docs/roadmap.md` §No host plugin names the trigger
  for bringing host hooks back.
- `bundles`, `export`, `graph`, `init`, `modules`, `skills` and `schema`
  from the command table, which is now the eight verbs of the v2 contracts
  (§9): the discovery of installed bundle skills, the exports, the graph
  query, the starters, the modules and the installed skills leave with
  their mechanisms (§1), and `<verb> --help --json` replaces `schema`.
- `vocabulary` and `brief` from the command table: `type show --brief`
  lists a vocabulary's entries with their live counts, and the three roles'
  briefs are the sections of `generated/BRIEF.md`, which `check --write`
  renders. Not carried: `vocabulary show --label` and `--target` (one entry,
  and the labels a target type admits), and a brief printed on demand per
  role.
- `move`, `retire` and `new` from the command table, absorbed by `write
  --from` over a schema-version-4 bundle (a move and a retirement are
  operations in `ops.json`; a new page is a draft written from `type show
  --brief`'s skeleton); `write`'s stdin form, `--section --append`,
  `--retract`, `--replace-core`, `--correct` and `--not-any-of` go with the
  old `write`, and so do the identity gate's stem tier and `near` list, the
  retirement banner, and `new`'s templates, `--item` and `--set`.
- `hook`, from the command table: the published hook definition and the
  documented one-liners invoke `gate` instead, and nothing installs a hook
  or logs a `WIKIWRIGHT_BYPASS`; `hook-stale` goes with it.
- `lint`, `fix`, `freshness` and `okf`, absorbed by `check` (and `lint
  --staged` by `gate`). Not carried:
  `lint --since` (the replay, deferred), `lint --stdin` and `--explain`,
  `freshness --fast-forward` and `generated/freshness.json`, every fixer
  but the folder tags and the generated files (`frontmatter-set`,
  `frontmatter-delete`, `tag-rename`, `section-stub`, `heading-depth`,
  `link-rewrite`, `retype`, `history-close`), and base OKF's checks other
  than `okf-missing-type`. Renamed on the way: `stale-capture` is
  `pin-stale`, `pin-unknown-to-origin` is `pin-unknown`, and the
  unmeasured states are `pin-unmeasured`.

- A machine-local registry of connected bundles, added and removed on the way
  to this release, so none shipped: registering a bundle by name, its kinds,
  feedback destination and guide, and the file and lock it lived in. The scan
  of the skill directories replaced it: installing a bundle skill is copying
  its directory, `--bundle` and `bundles list` find it there, and a
  maintained checkout is named with `--root`.
- The `trust` verb and the machine-local trust store it wrote: `trust grant`,
  `list` and `revoke`, the store at `~/.config/wikiwright/trust.json`, and the
  refusals of a module no grant approved. Two things replace it: consent at
  install — installing a module, or carrying it in the bundle's tree, is the
  consent to run it — and proof at load: every load purity-scans the module's
  bytes and runs its determinism fixture before it judges anything. The loss
  is stated in `docs/roadmap.md`: a `git pull` that changes a module changes
  what runs without this machine asking first.
- The node runner: the `test:node` script, the workflow step that ran it and
  the release matrix's Node arms. `bin.js` no longer switches on Node's
  compile cache.
- Remote freshness. `freshness` measures a pin only against the repository
  the vault sits in (origin `"."`); a pin naming any other origin is
  reported `unmeasured`, with a `reason` that begins `remote-origin:`, and is
  never contacted. Gone with it: the `ls-remote` depth, the `--fetch` flag
  and the blobless bare caches it kept under `.wikiwright/origins/`, the
  `fast-forward-needs-fetch` refusal (`--fast-forward` now works alone: the
  local objects are always at hand), the `behind` pin state (which named a
  pin measured without its objects; `pins` counts five states), the `depth`
  field of the envelope and of `generated/freshness.json`, the `cache` field
  of each `origins` row, and in the engine `gitLsRemoteHead`,
  `gitOriginFetch`, `OriginUnreachable`, `CACHE_HEAD`, `CACHE_ROOT` and
  `cacheDirOf`. `origin-unreachable` stays, for a vault pinned to `"."` that
  no repository encloses. The loss: a capture of another repository is no
  longer held to that repository's history, and nothing tells its reader
  that the source moved (`docs/roadmap.md`).

### Fixed

- A v2 verb over a state that holds no `config/engine.json` at all answers
  `bundle-not-found` (exit 3, `not_found`): absent is not malformed, as the
  old verbs answered a root with no constitution (`registry-not-found`). It
  was `constitution-invalid` (exit 2) with an `engine-invalid` issue, the
  answer for a bundle whose law is wrong. An `engine.json` that is there
  and does not load is still `constitution-invalid`.
- The v2 gate reads the index once: the law diff, the change-scoping and
  the staged generated files read the listing, the staged diff and HEAD's
  existence the state was made from, where each asked git again. A
  one-page commit spawned 21 git processes, the listing and the diff twice
  each and the repository's top level four times, and spawns 13, as the
  old gate held its two index reads to one snapshot.
- The v2 gate refuses a git read that fails while it reads the index as
  `git-unavailable` (exit 4, `conflict`), with git's own message, as the old
  gate did. It answered `unexpected-error` (exit 1), the code for the engine
  breaking, for any failure but a root in no repository.
- The v2 gate holds the index listing to the staged diff, as the old
  gate's index read did: a path the diff names as added, modified, retyped,
  renamed or copied that the listing does not hold is
  `git-inconsistent-read` (exit 1), naming both commands. `indexState` read
  the listing alone for its pages, so a listing cut at a record boundary —
  well formed, one page short, or empty — judged as a smaller index and
  passed; the page the listing lost was never judged.
- `rule-untested` counts a rule's negative, repaired and positive pages
  across every owner's test set of the rule (a library's and the bundle's),
  as §8 words it, each page still judged within its own set. A set split
  across owners was reported untested with an empty `details.missing` and
  the message "has no  page"; a rule is now untested exactly when
  `missing` names a page.
- `body-append-only` admits an append to a page written with CRLF line
  endings and to a page whose body was empty or whitespace only; both were
  refused as edits. The rule's expression reads both bodies with `\r\n` as
  `\n` and holds any body over an empty one. It is one expression in
  library `code`'s `decision`, in the `append-only` fragments of
  `fixtures/minimal-vault` and `fixtures/memory-synth`, and in the
  constant `tools/migrate-spellings.ts` writes; memory-synth's test set
  now appends to an empty body, minimal-vault's to a CRLF page, and
  `body-append-only.test.ts` holds all three documents at the gate.
- `instances` counts a page against its type and every type it descends
  from. It counted pages of exactly the declaring type, so a bound on an
  abstract type, which has no pages of its own, never fired: library
  `code`'s `quickstart` (at most one page) let devwiki hold two. The bound
  is the declaring type's own, not inherited as a declaration as v1
  inherited it; `docs/roadmap.md` states where the two readings differ.
- `check` over a shallow clone reports a pin whose commit the clone's
  history does not reach as `pin-unmeasured` (info, reason `shallow`), and
  `read` and `search` give its page `stale: null` with that reason. It was
  `pin-unknown`, a warning diagnosing "a rewritten history, or a mistyped
  commit", so a clone at depth 1, as CI checks out, read every pin of
  devwiki as unknown. A pin the shallow history does reach is measured.
- The covering diff `freshness` reads no longer depends on the caller's git
  configuration: under `diff.relative=true` a vault in a directory of its
  repository got an empty diff for a covered path outside that directory,
  so a stale pin read `unchanged` and `--fast-forward` would advance it
  without a re-read. It passes `--no-relative`. `lint --since` reads a
  revision's renames with `--relative`, as it lists the revision's tree, so
  a vault in a directory of its repository now sees its renames, which it
  saw only under `diff.relative=true` before.
- Reads the engine asks git for together (the staged diff beside the index
  listing, a commit walk beside its count, two trees, a walk's parents)
  report a failure in argument order. Under `Promise.all` whichever child
  failed first reached the envelope, so the gate over a bundle in no
  repository answered with one of two messages from run to run.
- A `config/engine.json` that starts with a byte order mark, which the vault
  loader reads, declared no module to the preload and none to the law
  digest: its modules were refused `module-not-loaded`, and the bundle block
  left out every installed module, so a module-only edit did not move `law`.
  The declarations are read as the loader reads them. A package's digest is
  taken once per process, where the preload, the brief and the envelope each
  read, hashed and purity-scanned its bytes.
- `brief` is a consumer verb. It was ranked writer, so a session under
  `WIKIWRIGHT_ROLE=consumer` was refused `role-forbidden` when it asked for
  the brief `--role consumer` renders for it: the one role bounded to reading
  could not read its own manual. `--role` still takes all three roles, and
  without it the brief is the session's `WIKIWRIGHT_ROLE`, or the writer's
  when the session declares none: a consumer session that asked for its
  brief was handed the writer's.
- Every file the shell writes outside a content page — the generated
  artifacts, the rendered exports, the shipped skills' files and stamps, the
  freshness report — lands through the Writer's staged replace:
  an exclusive temp beside the target, renamed into place, every file of a
  batch staged before the first rename. An interrupted write leaves the old
  bytes, and a reader never sees half a file. A replacement keeps the mode the
  file had, so a file a maintainer made private stays private; ownership is
  not preserved, which needs privilege the engine does not ask for.

- `check` reads and parses the tree once: the artifacts, the brief and the
  verdict take one state's pages through `parsedPages`, and the brief already
  rendered is what `brief-stale` compares, where each pass once walked and
  parsed the tree itself. `gate` and `lint --staged` likewise parse the index
  once for the drift pass, the rename review and the verdict, reuse an
  unchanged page's parse as its base, and skip parsing a base no section or
  body law consumes; every declared transition arm still runs. The vault
  root's real path is resolved once per run and a page's once per read, where
  the walk and the read each resolved both. No state persists between
  invocations, and the envelopes are byte-identical.

- `renamed-without-alias` no longer fires on a staged rename that only moves
  a page between directories or normalises the case of its basename: the
  identity the alias ritual protects is the basename, and it did not change.
- `template-orphan` no longer flags a content page that sits beside a type's
  declared `example` under a content root.
- The commit-msg gate reads a Conventional Commits scope and breaking marker:
  `docs(wiki):`, `fix!:` and `fix(cli)!:` carry the prefixes `docs` and `fix`.
  Before, the scope made the whole line parse as prefix `none`, and the
  refusal named a prefix that was registered. A first line with no opening is
  now refused as having none, and the passing envelope carries `scope` and
  `breaking`.
- The staged gate reads every staged page in a number of git processes
  bounded by the bytes (`ls-files -s`, then `cat-file --batch-check` and one
  `cat-file --batch` per 32 MiB of content) instead of one `git show` per
  page, and `lint --since` reads each revision's pages the same way. On one
  machine a 5,000-page index gated in 33 s and now gates in about 4 s, with a
  byte-identical envelope. `docs/roadmap.md` states the measured cost of a
  run and why no parse cache and no daemon are built.
- Every git answer is read from a file git writes itself. The engine hands
  git an open file under `os.tmpdir()` for its stdout and reads it once git
  has exited, so the runtime reads no pipe and exit 0 with the file is the
  whole answer: under load a runtime's synchronous spawn had handed back
  piped answers cut to a prefix with exit 0, and a prefix that ends between
  records is as well formed as the whole, so a cut index listing judged as
  fewer staged pages, or none, and passed, and `fix --staged` answered ok
  with nothing changed (`docs/roadmap.md`). The checks on the bytes stay as
  a second line, and none of them alone could close that gap: every answer
  with a terminator is held to it — a `-z` listing to its final NUL, a line
  answer to its final newline — and one that ends short is `git-short-read`
  (exit 1, `internal`), naming the git command; a batch read, whose request
  is handed to git as a file the engine wrote, is held to the count it asked
  for and each row to the request it answers, and a batch stream that ends
  inside an object, which the core parser throws as `BatchStreamTruncated`,
  is the same refusal. Two cross-checks catch a
  listing cut at a record boundary: every path the staged diff names as
  added, modified, retyped, renamed or copied must be in the index listing,
  and `lint --since`'s commit walk must list as many commits as
  `rev-list --count` counts; either failing is `git-inconsistent-read`
  (exit 1, `internal`), naming both commands.
- `freshness --fetch --fast-forward --dry-run` answers a measurement that
  fails with the refusal the run gives — `git-unavailable`, or
  `git-short-read` or `git-inconsistent-read` for a refused answer — as the
  dry-run law says. It caught
  every failure and returned the plan without the pin advances, which read
  as a vault with no pin to advance.

- The parser is CommonMark plus YAML frontmatter: the GFM extensions
  (tables, task lists, strikethrough, autolink literals, footnotes) are no
  longer loaded. No checker reads those constructs, the projection every
  checker sees — headings, fences, inline code, raw HTML, wikilinks — is the
  same with and without them on every corpus this repository judges, and
  tokenizing them cost close to half of every parse. `@wikiwright/core` drops
  `mdast-util-gfm` and `micromark-extension-gfm`.

### Developing

- `tools/migrate-spellings.ts` (v2 contracts §12 step 5): the one-off
  rewrite of a bundle on the v1 law into the v2 law and the §4 spellings.
  It writes `config/engine.json` at schema version 4 (`label` from the
  directory's name, `modules` as `libraries[].path`), one type, fragment
  and vocabulary document per v1 declaration under `constitution/`, and
  respells every page: a pin's `origin` and `covers` fold into the pin
  object, a relation label's `_` becomes `-`, an entry's `DATE:` becomes
  `DATE — ` with an approximation mark, a range's end or a qualifier moved
  into its text, a claim's `【category】` and its lifecycle clause take the
  one spelling. It removes `config/constitution.json` and `templates/`,
  leaves `generated/` to `check --write`, refuses a bundle already on
  schema version 4, and prints a report of what it wrote, dropped and left
  unparsed. It reads the v1 code kit to migrate a bundle over it, so it
  migrates such a bundle only while `packages/kit-code` exists.
- Every test file is written to `bun:test` (the v2 contracts, section 0):
  114 files moved off `node:test`, `before` and `after` becoming
  `beforeAll` and `afterAll` and a timeout moving to `it`'s last argument;
  `node:assert` stays. The suite runs the same 1,699 tests, and
  `bun-pin.test.ts` refuses a `node:test` import.
- `docs/render-cli.ts`, the one generator of `docs/cli.md`'s verb block, ran
  the CLI under `node`, so on a machine with only Bun the block could not be
  rendered. It runs the CLI under the Bun running it and reads the schema
  from a file the CLI writes. `bun-pin.test.ts` runs its `--check` with
  nothing on PATH, so the gate now holds the block to the binary, and
  refuses a spawn of `node` in the tools, the renderer, the hooks, the
  workflows and the tests, where it had read only the package scripts.
- The suite reads no skill directory of the machine's, writes no build stamp
  into the checkout and installs nothing into the caller's package cache:
  every scan runs with `HOME` under the temporary directory and its project
  tier inside a temporary repository, the system skill directory is
  overridden whatever the caller's environment says, the build-info writer is tested against a temporary scaffold, and
  every install it makes, a kit's and the packed engine's, uses a package
  cache of its own under the temporary directory; the packed-install test
  therefore fetches from the registry on every run.
- `fixtures/handbooks/orchard` and `fixtures/handbooks/allotment`: two small
  gardening handbooks, each a `procedure-page` type with a required climate
  and a `guide-page` for the page to read first, and a page with one title
  and different steps in both. The two-bundle tests read them; both are
  clean under `check`, their `generated/` included.
- `bun run check` and `bun run test` run the suite through
  `tools/run-suite.ts`: one `bun test` process per file, as many at once as
  the machine has cores, where `bun test` ran every file one after another
  in one process. A run passes only when every file's process exits 0 and
  reports a test. On one 12-core machine the whole suite took 101.9 s and
  takes 22.4 s; every commit's pre-commit hook pays that time. `bun test
  ./<file>` still runs one file; the `./` keeps the argument a file rather
  than a substring filter. Under the runner a test or a hook has 20 seconds
  rather than Bun's 5: the first release of the runner kept 5, and a `before`
  hook that packs three tarballs and runs `bun install` timed out under load
  and failed a gate.
- The suite runs the engine's CLI under Node. `tools/run-suite.ts` sets
  `WIKIWRIGHT_CLI_RUNTIME` to the `node` on PATH when it runs under Bun, and
  every test that spawns the CLI spawns it under that
  (`packages/cli/test/fixtures/runtime.ts`); the summary names the runtime.
  The `node` is resolved to an absolute path, a relative PATH entry against
  the runner's directory, and with none to find the runner refuses to run.
  Under load, Bun 1.3.11's synchronous spawn cut 7 of 900 piped child
  outputs short with exit 0, where Node cut none of 3,600, and that was the
  gate's intermittent `lint --staged` failure. The seam reaches the CLI a
  test spawns; an engine function a test calls in its own process reads git
  through the file transport above. `judge-property` asserts each state's
  pages before any verdict read from it.

## 0.1.0 — 2026-09-07

The initial public release: two packages, a domain kit, and the corpora the
suite judges them against.

### The engine

- A typed wiki engine for LLM agents. A bundle is a directory of Markdown
  pages in git, which Obsidian opens unchanged, plus one JSON constitution
  (`config/constitution.json`, format version 3) that declares the page
  types: their fields and the shapes those fields take, the sections a body
  carries, the grammar each section's items are written in, and the
  vocabularies those items draw from. `config/engine.json` declares the
  bundle's roots, policies and modules; every key it admits has a consumer.
- One function, `judge(state, law)`, judges every change at every write
  path: the working tree, the staged index at the pre-commit gate, a draft
  on stdin, a page being written, and a replay of history. The engine
  checks conformance, not truth, and it never calls a model.
- Every verb prints one JSON envelope on stdout and exits by a closed code
  taxonomy. Every error or warning finding carries exactly one of a runnable
  `fix` argv and a `queue` lane, so the agent driving the CLI always knows
  the next instruction; a decidable check may gate a commit, a judgment
  never does.
- Writes are splices: a write differs from its input only inside the lines
  its ops name, and every writing verb declares a plan that `--dry-run`
  prints while leaving the tree byte-identical.
- Identity is Unicode-aware (NFC and full case folding, one seam); a
  wikilink resolves by basename, never by title; basenames, aliases and
  titles are unique vault-wide.

### The verbs

- Reading: `type` (the effective contract of a type, with provenance),
  `vocabulary` (a vocabulary's entries and what admits them), `graph` (edges
  by kind, label and type, and the pages that carry none), `search`
  (deterministic lexical search: an identity ladder fused with BM25,
  CJK-bigram tokenized, with match reasons), `okf` (base-OKF conformance as
  its own verdict), `schema` and `version`.
- Writing: `new` (a page of a registered type from its template, fields
  filled with `--set`, section items with `--item`), `write` (a page from
  stdin, a directory of drafts as one judged state with `--from`, or one
  item spliced into a section with `--section --append`), `fix` (the
  mechanical ops one rule licenses, all or nothing, proved gone), `check`
  (registry, lint and generated-artifact drift; `--write` regenerates
  `generated/`, the writer's brief included), `lint` (`--stdin`, `--staged`,
  `--since <rev>`, `--explain`) and `brief`.
- Maintaining: `init` (scaffold a vault from the `base` or `code` starter),
  `hook` (the marker pre-commit gate and the commit-msg prefix hook), `gate`
  (what the hook runs), `move` (with a stated reason), `retire`, `skills`
  (reinstall or compare the shipped skills), `trust` (this machine's
  content-hashed module grants), `modules` (what the bundle declares and
  what resolved) and `freshness` (every pin measured against its origin,
  every cited `path:line` held to the pin).

### Modules and trust

- Four layers behind one registration API: the kernel, the standard
  library (claims, relations, entries), a domain kit, and the bundle. The
  three standard-library modules register through the same `defineModule`
  a third-party kit uses, and a test holds the kernel to importing nothing
  from them.
- A kit is an npm package the bundle installs and declares in
  `config/engine.json`. It loads only after a purity scan of its bytes, a
  machine-local content-hashed `trust grant`, and its own determinism
  fixture. A grant is revoked by any edit to the package.
- The bundle declares policy and the engine supplies mechanism: a bundle
  selects grammars, checks, vocabularies, fragments and templates from a
  closed set and tightens what it inherits; it never authors a predicate.

### The code kit

- `@wikiwright/kit-code`, under `packages/kit-code`: the domain kit for the
  wiki of a code repository. Nine abstract types (an architecture overview,
  subsystems, a source map, concepts, a quickstart, a testing guide,
  integrations, an ops reference, and the decision record), the
  `code/anchored` fragment that pins a page to a commit with the paths it
  covers, four ranged relation labels contributed into the standard
  library's `relations`, a template per type and four skill fragments.
  Declarations only: no code runs at judge time.
- Consumed by the `code` starter and by this repository's own `devwiki`.
  The kit is not published to a registry; a bundle installs it by workspace
  link or by `file:` path to a checkout.

### The corpora and the gate

- Three corpora are judged by the suite: `devwiki` (this repository's own
  bundle over the code kit, its pages pinned to this repository),
  `fixtures/memory-synth` (a synthetic personal-memory vault: claims with
  categories, lifecycles and provenance) and `fixtures/minimal-vault`. The
  module ladder is proved end to end with a neutral module under
  `fixtures/conformance` and again with the shipped kit.
- Two starters (`base`, `code`) and two shipped skills
  (`wikiwright-write`, `wikiwright-maintain`) with a generated
  lint-response playbook. `init` installs the skills and the hook.
- Generated artifacts (`graph.json`, `manifest.json`, `tag-catalog.md`,
  `BRIEF.md`) are byte-reproducible: no locale, no clock, no runtime-specific
  API in `packages/`.
- The gate is `bun run check`: biome, the build, the test-project typecheck
  and the whole suite, green under Bun and under the node runner.
