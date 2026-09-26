# The CLI

`wikiwright` is one binary. Every verb prints exactly one JSON envelope on
stdout and reserves stderr for text a human at a terminal needs.

It answers with one table, the **command table** of the v2 contracts (§9),
eight verbs over a bundle of type documents (docs/v2-dispositions.md):
`check`, `gate`, `write`, `rule`, `read`, `search`, `type` and `version`
(§The command table). The 24 verbs of the old tree left in step 6 of the
delivery, and a root that holds no schema-version-4 bundle is refused, not
answered by them: `check` absorbed `lint`, `fix`, `freshness` and `okf`;
`gate` absorbed `lint --staged`, and the published hook definition replaced
`hook`; `write --from` absorbed `move`, `retire` and `new`; `type show
--brief` absorbed `vocabulary` and `brief`; `<verb> --help --json` replaced
`schema`; `bundles`, `export`, `graph`, `init`, `modules` and `skills` left
with their mechanisms (contracts §1). Each is `unknown-command` now.

The verb reference at the end is rendered from the command table by
`bun docs/render-cli.ts --write`, and `bun docs/render-cli.ts --check` fails
when the document is behind the binary. `wikiwright --help --json` prints every
verb's schema as JSON, `wikiwright <verb> --help --json` one verb's (the
registry row the old `schema` printed, `writes` included), and `wikiwright
<verb> --help` its usage line, flags and examples.

## The envelope

```json
{ "ok": true,  "data": { … }, "metadata": { "command": "check", "engine": "0.1.0", "bundle": { … } } }
{ "ok": false, "data": { … }, "error": { "code": "findings", "exit_code": 5, "type": "findings", "message": "2 error finding(s)", "hint": "…", "details": { … } }, "metadata": { … } }
```

`error.code` is one kebab-case word per meaning and the same word across
verbs (`page-not-found` from `read` and `write` alike).
`error.details` carries the machine recovery data: the valid values
(`details.valid_values`, `details.valid_flags`, `details.valid_commands`), the
conflicting paths, the digests that disagreed. Prose is never load-bearing. A
refusal that carries a verdict, such as a `write` refused by its findings, puts
the verdict in `data` beside `error`.

Every verb that reads a bundle's law names the bundle it read in
`metadata.bundle`, on an ok envelope and a refusal alike. `version` and
`--help --json` answer about the engine, so they carry none.

```json
"bundle": {
  "label": "orchard",
  "root": "/srv/handbooks/orchard",
  "head": "3f2a9c…",
  "dirty": false,
  "law": "4439120…",
  "content": "62bcc6d…"
}
```

| Key | Meaning |
|---|---|
| `label` | `config/engine.json`'s `label`: a name for a reader, not an identity; two bundles can share one |
| `root` | the root's real path |
| `head` | the commit HEAD names in the repository enclosing the root; `null` when git names none: no repository encloses the root, it has no commit yet, or git cannot answer there |
| `dirty` | whether `git status` lists any change under the root, untracked files included and ignored ones not; `null` when no repository answers |
| `law` | the §7 law digest: every file the loader read, the page-interface and CEL-profile identities, eight dependency versions and the engine's |
| `content` | the §7 content digest of the pages the verb read: an uncommitted edit moves it, and `head` does not move |

The block is computed by the verb from the state it judged; the gate's names
the index's law and content. An envelope answered before the verb runs names
no bundle: `--help`, a refusal of the arguments, a root with no bundle.

`check` and `gate` answer with the verdict: `findings` (each `rule`,
`severity`, `path`, `location` — `{kind: "page"}` or `{kind: "section",
heading, occurrence, line}` — `message`, `details`, and either `queue`, its
lane, or `fix: {argv}`, on every error and warning), `summary` (`pages`,
`errors`, `warnings`, `infos`, `by_rule`, `excepted`, `unevaluated`, over the
uncapped set; the exit code follows `errors`), `coverage` (every row and rule
by id: `evaluated`, `not_applicable`, `unevaluated`), `unevaluated` (each row a
state could not judge, with its count and reasons, `no-base` or
`base-unreadable`) and `caps` (`limit`, and whether it was `hit`). `--limit`
caps the findings (default 50), `--rule` and `--path` filter before the cap
and `--all` lifts it.

### The bound and `--out`

An envelope is at most 1 MiB (1,048,576 bytes, the closing newline counted)
on stdout. There is no automatic spill: a larger one is refused as
`envelope-too-large` (exit 2, type `usage`), its `details` naming `bytes`,
`limit` and the `exit_code` the whole envelope carried, its `metadata` the
verb and the bundle the whole one named, and its hint `--out <file>`.

`--out <file>`, accepted by every verb, writes the whole envelope to the file,
whatever its size, through the same staged replace every generated file
lands by, and prints a two-line pointer on stdout: the two lines are one JSON
object, `{"ok", "command", "exit_code", "bytes"` on the first and `"out"}`,
the file's absolute path, on the second. The exit code is the envelope's own.
A file that cannot be written is `out-unwritable` (exit 2) on stdout, with the
exit code the envelope would have carried in `details.exit_code`. A file
inside the bundle the invocation reads — `--root`'s directory or the working
directory, or the nearest ancestor of it carrying `config/engine.json` or
`config/constitution.json`, every link resolved — is `out-inside-bundle`
(exit 2) on stdout, the same `details.exit_code` beside `out` and `bundle`:
the envelope never overwrites a page, a law file or a generated file, which
no writing verb's checks would see.

The writing verbs judge with the same judge. `write --from` answers with the
plan it landed or would land (`ops`, `wrote`), the operations of `ops.json`
it applied, and the findings of the batch; `check --write` and `check --fix`
add the generated files they wrote and, under `--fix`, what the materializer
`fixed`.

## Exit codes

| Exit | `error.type` | Meaning |
|---|---|---|
| 0 | | ok |
| 1 | `internal` | the engine broke; `unexpected-error` carries the message, `git-short-read` names a git answer that ended before its terminator, `git-inconsistent-read` contradictory staged diff, index and HEAD listings or a batch row that names another request, and `git-timeout` a git child killed for running past `WIKIWRIGHT_GIT_TIMEOUT_MS`, each refused rather than judged |
| 2 | `usage` | the caller got a verb, flag, positional or environment variable wrong |
| 2 | `constitution` | the law did not load, or the engine pin refused; nothing was judged |
| 3 | `not_found` | the page, type, revision, directory or bundle asked for does not exist: a root that is no directory, or a state with no `config/engine.json`, is `bundle-not-found` |
| 4 | `conflict` | the state refuses the operation: a stale recorded base (`base-mismatch`), a changed accepted write state (`state-changed-before-write`), an obstructed or linked replacement target (`replacement-target-refused`), a tree changing during capture (`state-changed-during-read`), unmerged paths, or failed Git plumbing (`git-unavailable`) |
| 5 | `findings` | the tool worked and the subject failed: read `data.findings`; `fix-invalid` means `check --fix` refused a proposed page repair before writing |

`git-short-read` and `git-inconsistent-read` are the engine refusing git's
answer rather than judging from it. Every git read hands git a file for its
stdout, and a batch read hands git its request as a file too, so the answer
and the request are whole by construction under any runtime; the
terminators, the counts, and each batch row's name against its request
remain as a second line. The gate also compares the index and HEAD object
listings in both directions with the staged diff, so a diff cut after a
complete change cannot silently omit that page. stderr is still a pipe;
its "not a git repository" recognition is used only for that explicit
answer, and an unrecognised failure is `git-unavailable`. Every git child is spawned
asynchronously, awaited to its exit, at most four at a time, with `LC_ALL=C`
and `GIT_OPTIONAL_LOCKS=0` in its environment. Each may run for
`WIKIWRIGHT_GIT_TIMEOUT_MS` (60,000 ms when unset); one still running then is
killed and the verb refused as `git-timeout`, with the command and the bound
in `details`. A child that has exited is answered when it exits: stderr that a
process it started still holds open is read for one second more and then
given up. Two pipes are not converted,
and neither chooses a judged page: the build stamp
`tools/write-build-info.ts` records at build time, and the suite's own reads
(`docs/roadmap.md`).

A usage error and a constitution error share exit 2 so a hook that tests only
the code sees one answer, and carry different types so an agent that reads
`type` knows whether to retry with other arguments (`usage`) or fix the bundle
(`constitution`). Exit 5 is the gate's branchable signal.

## The dry-run law

A verb that can write declares it in the registry (`writes: true` in `--help --json`),
and every such verb accepts `--dry-run`. A dry run returns exactly the plan the
real run would apply:

```json
{ "ops": [{ "kind": "write", "path": "wiki/REQ-001.md", "summary": "…" }], "wrote": false }
```

`kind` is one of `create`, `write`, `append`, `copy`, `rename` (with `from`),
`delete`. A test drives every writing verb twice, dry and real, and asserts
the plan's path set equals the real filesystem delta, and that a dry run leaves
every byte of the tree unchanged. A dry run is answered at the verb's first
write, so every refusal the real run would reach before writing (an unknown
type, an invalid draft, a stale base) is returned by the dry run with the same
exit code. `check` plans nothing without `--write` or `--fix`.

## Environment

| Variable | Read by | Effect |
|---|---|---|
| `WIKIWRIGHT_TODAY` | `write`, read once per process | the date the verb stamps, `YYYY-MM-DD`; the wall clock otherwise. A malformed value refuses before anything moves |
| `WIKIWRIGHT_GIT_TIMEOUT_MS` | the shell, before parsing; every git child | how long one git child may run, a whole number of milliseconds from 1 to 2147483647; 60000 when unset or empty. A child still running then is killed and the verb refused as `git-timeout` (exit 1); any other value is `git-timeout-invalid` (exit 2) before any verb runs |

## The command table

What the rendered rows at the end do not say, per verb of the command table.
Each reads the bundle through the v2 states (`packages/cli/src/lawstate.ts`),
refuses a law that does not load as `constitution-invalid` (exit 2, the
loader's issues in `data.issues`, nothing judged), and names the bundle it
read.

- **`check [--write] [--fix] [--dry-run]`** judges the working tree whole:
  every page under its type, every rule test and example (§8 of the
  contracts), and beside the judge every pin, `okf-missing-type` and the
  generated files. A running engine outside `config/engine.json`'s `engine`
  range is `engine-mismatch` (exit 2). A pin is a top-level property whose
  schema is the engine `$def` `pin`, `{commit, origin, covers}`; one whose
  origin is `.` is measured against the repository the bundle sits in:
  `pin-stale` (warning) when the covered paths changed between its commit
  and HEAD, `pin-unknown` (warning) when HEAD's history does not hold the
  commit, `citation-unresolved` (warning) for a cited path or line the
  commit does not hold — citations are read as the old `freshness` read
  them — and `stale-source-cited` (warning) on every page with an edge of
  any kind but `tagged` into a stale page; any other origin, no repository
  or no commit is `pin-unmeasured` (info, `details.reason` `remote-origin`,
  `no-repository`, `no-head`), and so is a commit a shallow clone's
  history does not reach (`shallow`), which is absent there, not unknown. `data.pins` carries `counts` by state
  (`current`, `unchanged`, `stale`, `unknown`, `unmeasured`) and one entry
  per pin. `generated/` holds `BRIEF.md` (the bundle's brief: the loop in
  three sections, one per role, the verbs, the types, the vocabularies, the
  names), `graph.json`, `manifest.json`, `tag-catalog.md` and `queue.md`
  (every queued finding of a judge run with no base, and the law and
  content digests it was cut from); a file that differs from a fresh render
  is `generated-drift` (error, fix `check --write`). `--write` renders them;
  `--fix` implies `--write` and proposes folder-tag materialization under
  `folder_tags.mode: materialize-add-only`; a proposed repair that violates
  the effective type law is `fix-invalid` and lands nothing. Generated
  destinations are checked for links and obstructions before any page or
  artifact write, in dry and real runs. A valid fix reports `fixed`. `--dry-run`
  plans exactly what the invocation lands, nothing without `--write` or
  `--fix`. Exit 5 on any error.
- **`gate [--commit-msg <file>]`** judges the index with HEAD as its base
  (§8 and §9.2 of the contracts). At `pre-commit`: every page, rule test and
  example the index holds; a rule the law diff adds or changes held to its
  test set (`rule-untested`, error); `generated/*` judged as staged once the
  index tracks any of it (`generated-drift`, `details.state: index`); the
  law diff between HEAD's law and the index's as `law-changed` (info); a
  queued error on a line the commit did not touch demoted to a warning
  (`details.demoted_from: "error"`) — a finding at a section's heading only
  when the section's raw text is unchanged, and never a finding with no
  line or a transition — and the findings of an untouched page
  left out — both suspended when the commit stages `config/`,
  `constitution/`, `rule-tests/`, `examples/` or a library
  (`data.config_changed: true`). With no HEAD the base is empty and there is
  no diff. `--commit-msg <file>` holds the message to `commit_prefixes`
  (`commit-prefix`, exit 5, one line on stderr naming the registered set)
  and the law diff to a body line `law-change: <reason>`: without one each
  change is `law-relaxed` (error, lane `law-review`), with one `law-changed`
  carrying `details.reason`. A refusal prints the census and the blocking
  findings on stderr. `unmerged-paths` and `git-unavailable` are exit 4.
  The hooks: `.pre-commit-hooks.yaml` at this repository's root publishes
  `wikiwright-gate` (`pre-commit`) and `wikiwright-commit-msg`
  (`commit-msg`, `--commit-msg` the last argument so the framework's file
  path is its value); without the framework, `.git/hooks/pre-commit` holds
  `exec wikiwright gate --root <bundle>` and `.git/hooks/commit-msg`
  `exec wikiwright gate --root <bundle> --commit-msg "$1"`. The message file
  is read where git hands it: a relative path against the directory the
  hook runs in, then against the bundle root.
- **`write --from <dir> [--dry-run]`** lands a batch: `<dir>/ops.json`
  (optional), then every `.md` under `<dir>` at the vault path it mirrors.
  `ops.json` is `{"bases": {"<path>": "<bytes digest>"}, "move": [{"from",
  "to", "reason"}], "retire": [{"path", "successor"}], "retract": [{"path",
  "handle", "date"}], "supersede": [{"path", "handle", "by", "date"}]}`,
  every key optional, `successor` nullable, `date` defaulting to the clock;
  any other shape is `ops-invalid` (exit 2) with its JSON pointer. A base
  that is not the page's current bytes digest is `base-mismatch` (exit 4).
  The operations apply in that order: a move renames the page, adds its old
  name to `aliases` and rewrites every wikilink naming it (a destination
  that exists, compared case-folded, is `destination-exists`; one that
  differs from the page's path only in case or normalization is
  `move-case-only`, both exit 4); a retirement sets
  `status: retired` and `superseded_by`; a retraction appends `(retracted
  D)` to the claim's line, a supersession `(valid →D-1, superseded D by
  #xxxxxxxx)`, the claim named by its handle (`claim-not-found`, exit 3;
  `claim-not-open`, exit 4). Then the drafts; a draft at a path a move
  leaves (`draft-on-moved-path`) or of a page an operation changes
  (`draft-overlaps-op`) is refused, exit 4, and one outside the content
  roots is `draft-outside-content` (exit 2). `created` is stamped on a page
  new to the vault and `updated` on every changed one, through
  `WIKIWRIGHT_TODAY`. The batch is judged together with the disk as its base
  and each move as its rename; an error on any page it touches, or an error
  elsewhere that judging the disk alone does not give (a page the batch
  makes invalid, an identity collision reported on the page already there,
  an instance count), refuses the whole batch (`draft-invalid`, exit 5, the
  findings and the `failing` paths in `data`). The recorded bases, proposed
  overlay and law come from one capture; a changed page or law before landing
  is `state-changed-before-write` (exit 4). Every destination is checked in
  dry and real runs; an obstructing directory or link is
  `replacement-target-refused` (exit 4) before the first replacement. Otherwise
  every page is staged beside its path, then renamed into place, then each
  path a move left is removed: each file is its old or its new complete
  bytes, and the batch is not transactional. The envelope carries the plan's
  `ops`, `wrote`, `operations` (what each did) and one row per page
  (`path`, `created`, `moved_from`, `findings`, `digest` before and after).
- **`rule try --type <t> [--section <h>] --expr <cel> [--config <json>]
  [--base <ref>]`** admits the candidate under the CEL profile
  (`rule-invalid`, exit 2), attaches it as `candidate`, severity error, to
  `<t>` and every type below it, and judges the working tree and, with
  `--base`, the revision (`revision-not-found`, exit 3). `working` and
  `base` each list `would_refuse` (path and location), `would_pass`,
  `unevaluated` (path and reason: a candidate reading `before` has no base
  in either) and `errors` (path, kind, message). Exit 0 whatever the
  counts; nothing is written.
- **`read <page> [--section <heading>] [--budget <bytes>]`** names a page by
  its path, its name, an alias or its title, in that order, and returns its
  sections cut at its type's section depth, verbatim, in page order while
  the budget holds, the rest listed by address; `data.bytes` is the page's
  bytes digest. `data.status` is the page's standing: `stale` true when a
  pin of the page is stale (`reason: pin-stale`) or a page it links carries
  one (`stale-source-cited`), null when a pin of its own is unmeasured or
  unknown (the reason), false otherwise; `unresolved` the rule ids
  `generated/queue.md` holds for the page while its digests are the current
  law's and content's, else null with `unresolved_reason` `queue-stale` or
  `queue-missing`.
- **`search <query> [--items] [--files]`** ranks as the old verb did
  (below), over the pages of the working tree, and every result — a page, a
  record under `--items` (a claim, a relation or an entry, its fields the
  record's), a file under `--files` — carries its page's `status`, computed
  as `read` computes it. The pins measured are the returned pages' and the
  pages they link: the git work grows with the results. `--type` matches a
  type and every type below it.
- **`type show <name> [--brief]`** prints the effective contract with
  attribution: role, ancestry, fragments, each top-level property of the
  effective shape and the documents declaring it (`reserved`,
  `fragment:<name>`, `type:<name>`), the compiled shape, the sections and the
  documents declaring each heading, every rule with its declaring document
  and its config after `configure`, `meta`, `examples`. `--brief` adds
  `skeleton` (every key of the effective shape in linearisation order,
  `type` filled, `# <title>` and one heading per section), `instruction` (a
  line per section) and `vocabularies`, each with its entries and their
  live counts, its retired entries and the values the pages use that it
  does not declare. `type list` lists every type.
- **`version`** prints the engine version and the commit the binary was
  built from; `--version` and `-v` alias it.

## Verbs

<!-- generated: begin (bun docs/render-cli.ts --write) -->

Global flags, accepted by every verb:

| Flag | Meaning |
|---|---|
| `--root <value>` | vault root directory (default: current directory) |
| `--help` | print this command's spec and exit |
| `--json` | with --help: print the verb's schema, the registry row an agent reads |
| `--out <value>` | write the whole envelope to this file and print a two-line pointer to it on stdout |

| Verb | Writes | Summary |
|---|---|---|
| [`check`](#check) | yes | Judge the whole bundle: every page, the rule tests and examples, the pins against the local repository, and the generated files; --write renders generated/, --fix repairs what a fixer may first. |
| [`gate`](#gate) | no | Judge what the commit would contain: the index with HEAD as its base, the law diff, and under --commit-msg the message's prefix and its law-change line. |
| [`read`](#read) | no | Return a page's sections verbatim under a byte budget, with its bytes digest and its status: stale pins, and the queue's unresolved rules. |
| [`rule`](#rule) | no | Try a candidate CEL rule over the pages of a type before it is law: what it would refuse and pass, under the working tree and at a base revision. |
| [`search`](#search) | no | Deterministic lexical search with match reasons and a coverage block; each result carries its page's status. |
| [`type`](#type) | no | Show one type's effective contract with the documents each part comes from — with --brief its skeleton and the writing instruction with live vocabulary counts — or list every type. |
| [`version`](#version) | no | Report the engine version and the commit this binary was BUILT from (--version / -v alias it). |
| [`write`](#write) | yes | Land a directory of drafts and its ops.json (bases, move, retire, retract, supersede) as one batch, judged together with the disk as its base. |

### check

`wikiwright check`

Judge the whole bundle: every page, the rule tests and examples, the pins against the local repository, and the generated files; --write renders generated/, --fix repairs what a fixer may first.

Writes: yes (accepts `--dry-run`).

| Flag | Meaning |
|---|---|
| `--write` | render generated/ (BRIEF.md, graph.json, manifest.json, queue.md, tag-catalog.md) |
| `--fix` | run the fixers that survive — the folder-tag materializer, then the generated files — then judge; implies --write |
| `--limit <value>` | cap the findings array (default 50) |
| `--rule <value>` | only findings with this rule id |
| `--path <value>` | only findings on this page |
| `--all` | lift the findings cap |
| `--dry-run` | report the plan — the ops this verb would apply — and write nothing |

```text
wikiwright check
wikiwright check --write
wikiwright check --fix --dry-run
wikiwright check --path wiki/Basil.md --all
```

### gate

`wikiwright gate`

Judge what the commit would contain: the index with HEAD as its base, the law diff, and under --commit-msg the message's prefix and its law-change line.

Writes: no.

| Flag | Meaning |
|---|---|
| `--commit-msg <value>` | the commit-msg stage: hold this message file to commit_prefixes, and a law change to a `law-change: <reason>` line |
| `--limit <value>` | cap the findings array (default 50) |
| `--rule <value>` | only findings with this rule id |
| `--path <value>` | only findings on this page |
| `--all` | lift the findings cap |

```text
wikiwright gate
wikiwright gate --commit-msg .git/COMMIT_EDITMSG
```

### read

`wikiwright read <page>`

Return a page's sections verbatim under a byte budget, with its bytes digest and its status: stale pins, and the queue's unresolved rules.

Writes: no.

| Flag | Meaning |
|---|---|
| `--section <value>` | return only the section under this heading, every one where it repeats |
| `--budget <value>` | the most bytes of section text to return; the rest are listed by address |

```text
wikiwright read wiki/Basil.md
wikiwright read Basil --section History
wikiwright read "Herb bed" --budget 800
```

### rule

`wikiwright rule <try>`

Try a candidate CEL rule over the pages of a type before it is law: what it would refuse and pass, under the working tree and at a base revision.

Writes: no.

| Flag | Meaning |
|---|---|
| `--type <value>` | the type the candidate attaches to, and every type below it |
| `--section <value>` | a section rule: the heading it is evaluated at |
| `--expr <value>` | the candidate's CEL expression, under the profile |
| `--config <value>` | the candidate's config, a JSON object |
| `--base <value>` | a revision to try it at too, under the revision adapter |

```text
wikiwright rule try --type planting --expr "has(page.fields.source)"
wikiwright rule try --type planting --section History --expr "section.items.all(i, i.precision == \"day\")" --base HEAD
```

### search

`wikiwright search [query]`

Deterministic lexical search with match reasons and a coverage block; each result carries its page's status.

Writes: no.

| Flag | Meaning |
|---|---|
| `--type <value>` | restrict to one type and every type below it |
| `--tag <value>` | restrict to pages carrying a tag |
| `--title-contains <value>` | restrict by title substring |
| `--limit <value>` | result cap (default 20) |
| `--all` | lift the result cap |
| `--near` | add the advisory name:near candidate list (never changes ranks) |
| `--items` | rank the grammar records themselves — claims, relations, entries — with their line, section and fields |
| `--files` | every page with a match, by path with its reasons: unranked, uncapped |
| `--band <value>` | keep only the results of one band: identity \| relevance |

```text
wikiwright search basil
wikiwright search --tag herbs
wikiwright search bolts --type garden/planting
wikiwright search "sweet basil" --near
wikiwright search "thirty degrees" --items
wikiwright search "herb bed" --files
wikiwright search basil --band identity
```

### type

`wikiwright type <list|show> [name]`

Show one type's effective contract with the documents each part comes from — with --brief its skeleton and the writing instruction with live vocabulary counts — or list every type.

Writes: no.

| Flag | Meaning |
|---|---|
| `--brief` | add the skeleton to write from and the writing instruction, with the vocabularies' live counts |

```text
wikiwright type show planting
wikiwright type show planting --brief
wikiwright type list
```

### version

`wikiwright version`

Report the engine version and the commit this binary was BUILT from (--version / -v alias it).

Writes: no.

```text
wikiwright version
wikiwright --version
```

### write

`wikiwright write`

Land a directory of drafts and its ops.json (bases, move, retire, retract, supersede) as one batch, judged together with the disk as its base.

Writes: yes (accepts `--dry-run`).

| Flag | Meaning |
|---|---|
| `--from <value>` | the directory of drafts, mirroring the vault's paths, with an optional ops.json |
| `--dry-run` | report the plan — the ops this verb would apply — and write nothing |

```text
wikiwright write --from drafts --dry-run
wikiwright write --from drafts
```

<!-- generated: end -->
