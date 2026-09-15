# The CLI

`wikiwright` is one binary with 22 verbs. Every verb prints exactly one JSON
envelope on stdout and reserves stderr for text a human at a terminal needs.
The verb reference below is rendered from the binary's own command registry by
`bun docs/render-cli.ts --write`, and `bun docs/render-cli.ts --check` fails
when the document is behind the binary. `wikiwright schema` prints the same
registry as JSON, and `wikiwright <verb> --help` prints one verb's row.

## The envelope

```json
{ "ok": true,  "data": { … }, "metadata": { "command": "check", "engine": "0.1.0" } }
{ "ok": false, "data": { … }, "error": { "code": "findings", "exit_code": 5, "type": "findings", "message": "2 error finding(s)", "hint": "…", "details": { … } }, "metadata": { … } }
```

`error.code` is one kebab-case word per meaning and the same word across
verbs (`unknown-type` from `new`, `type` and `vocabulary` alike).
`error.details` carries the machine recovery data: the valid values
(`details.valid_values`, `details.valid_flags`, `details.valid_commands`), the
conflicting paths, the digests that disagreed. Prose is never load-bearing. A
refusal that carries a verdict, such as a `write` refused by its findings, puts
the verdict in `data` beside `error`.

The judging verbs (`lint`, `check`, `gate`, `write`, `fix`, `new`) share one
verdict block:

| Key | Meaning |
|---|---|
| `findings` | the findings, capped at `--limit` (default 50), error-first; `--rule` and `--path` filter before the cap and `--all` lifts it |
| `summary` | `pages`, `errors`, `warnings`, `infos`, `by_rule`, `excepted` and `unevaluated`, computed over the uncapped set; the exit code follows `errors` |
| `coverage.passes` | for every pass, `evaluated`, `not_applicable`, `unevaluable` and a `reason` (`no-base`, `capability-unavailable`, `external-origin`) |
| `unevaluated` | the passes a declaration turned on that this run could not judge, keyed by pass with a count and a reason |
| `caps` | `limit` and whether it was `hit` |
| `dispositions` | per page, the counted transition outcomes where a base exists (`relation_added`, `relation_removed`, `superseded`, `corrected`, …) |

## Exit codes

| Exit | `error.type` | Meaning |
|---|---|---|
| 0 | | ok |
| 1 | `internal` | the engine broke; `unexpected-error` carries the message |
| 2 | `usage` | the caller got a verb, flag, positional or environment variable wrong |
| 2 | `constitution` | the law did not load, or the engine pin refused; nothing was judged |
| 3 | `not_found` | the page, type, vocabulary entry, revision or grant asked for does not exist |
| 4 | `conflict` | the state refuses the operation: a stale `--base`, a foreign hook, an `--expect` mismatch, a splice the Writer cannot prove |
| 5 | `findings` | the tool worked and the subject failed: read `data.findings` |
| 10 | `confirm_required` | an identity or blast-radius gate wants the plan pinned: `identity-candidates`, `open-claim-of-category` |

A usage error and a constitution error share exit 2 so a hook that tests only
the code sees one answer, and carry different types so an agent that reads
`type` knows whether to retry with other arguments (`usage`) or fix the bundle
(`constitution`). Exit 5 is the gate's branchable signal.

## The dry-run law

A verb that can write declares it in the registry (`writes: true` in `schema`),
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
type, a foreign hook, a stale base) is returned by the dry run with the same
exit code. `check` plans nothing without `--write`; `freshness --dry-run` plans
the report it always writes.

## Environment

| Variable | Read by | Effect |
|---|---|---|
| `WIKIWRIGHT_ROLE` | the shell, before parsing | `consumer`, `writer` or `maintainer` (the default when unset). A verb above the caller's rank exits 2 with `role-forbidden` and `details.valid_commands` filtered to the caller's rank; an unrecognised value is `role-unknown`, never a fallback. A guard rail for an agent session, not a security boundary |
| `WIKIWRIGHT_TODAY` | `write`, `new`, `trust grant`, read once per process | the date the verb stamps, `YYYY-MM-DD`; the wall clock otherwise. A malformed value refuses before anything moves |
| `WIKIWRIGHT_BYPASS` | the installed hooks | skips the gate for one commit and logs the reason into the git directory |
| `WIKIWRIGHT_TRUST_FILE` | `trust`, the module loader | the path of the machine-local grant store (default `~/.config/wikiwright/trust.json`) |

## Notes per verb

What the registry rows below do not say.

- **`check`** judges the working tree and, beside the page passes, the artifact
  tree (`generated-drift`), the installed skills (`skills-stale`,
  `skills-missing`), the brief (`brief-stale`) and the installed marker hooks
  (`hook-stale`: a hook another build wrote runs that build's contract; the
  fixer is `hook install`, chain kept). It contacts no origin: the five origin
  rows read `not_applicable`, reason `external-origin`, on every page;
  `freshness` measures them. `--write` regenerates `generated/graph.json`,
  `manifest.json`, `tag-catalog.md` and the writer's `generated/BRIEF.md`
  first, through one write loop, then judges; `brief-stale` names it.
- **`lint --stdin --path <p>`** judges a draft in place of the page at `<p>`
  with the disk bytes as its base. **`lint --staged`** judges the git index
  against HEAD, exactly as `gate` does. **`lint --since <rev>`** replays every
  first-parent commit from `<rev>` to HEAD, each under the constitution at that
  commit, and rolls the pairs into one `summary` plus `totals.blocked`.
  **`lint --page <p> --explain`** adds the page's chain, section lines,
  vocabularies and a paste-ready `exceptions` stanza per queued finding.
- **`gate`** checks `engine.json`'s `engine` pin against the staged
  constitution, then judges the index. `generated-drift` is judged over the
  staged artifacts, never the working tree's, so a partial staging passes when
  the staged artifacts describe the staged pages. `--commit-msg <file>` is the
  commit-msg arm: with `commit_prefixes` declared, the message's first line
  must open with a registered prefix in one of the four Conventional Commits
  shapes — `fix:`, `fix(scope):`, `fix!:`, `fix(scope)!:`, a scope being any
  non-empty text without parentheses, nothing between the parts and no space
  before the colon. The registered set names prefixes, never scopes. An
  unregistered prefix is refused with one line on stderr naming the valid set;
  a first line opening with none of the four shapes is prefix `none`, and the
  line says so. The passing envelope carries `prefix`, `scope` when one is
  written, and `breaking`. A refused commit prints the rule census and the
  error findings to stderr; the envelope stays on stdout.
- **`hook install`** writes the marker hooks into the directory
  `git rev-parse --git-path hooks` names, so a linked worktree works. It never
  overwrites a hook it did not write (`hook-exists`). `--chain <script>` runs
  the bundle's own script first, before the bypass, and propagates its exit.
- **`init`** plans every file it would land against the directory as it
  stands and refuses once with every conflict in `details.conflicts`
  (`file-exists`, exit 4). A file already carrying the bytes is not a conflict;
  a skill file the engine's stamp accounts for is refreshed; `--force`
  overwrites exactly the listed conflicts. Starters: `base` and `code`. A
  starter that declares modules (`code`, a bundle over `@wikiwright/kit-code`)
  lands its files and the hook and renders no artifact and no brief, because
  the modules live in a `node_modules` the copy does not create and a grant is
  a maintainer's act: the envelope's `modules` block names the install, the
  maintainer's approval and `check --write`, and `check` before those refuses
  by name (`module-unresolved`, `module-untrusted`). Neither the block nor a
  hint hands out a grant command, because an agent runs a listed command
  literally and the approval is not an agent's to give.
- **`new <type> <title> --dest <p>`** renders the type's skeleton and hands it
  to the whole-page write path. `--set field=value` fills a frontmatter field
  before the draft is judged; a string-valued kind takes the text and a list,
  number, boolean or object kind takes JSON. `tags` is the engine's own key
  and a list whatever the type declares for it: `--set tags='["a", "b"]'`,
  merged after the folder tags the destination seeds. A refused skeleton
  carries `preview`, the draft that was judged, as the accepted dry run does.
  The template's frontmatter seeds
  what `--set` does not name: a non-empty value under a key the type declares
  is written into that field (`origin: .` on the code kit's anchored
  templates); an empty value (`""`, `[]`, `null`) is a stub left standing;
  `type`, `title`, `description` and `tags` are the engine's and never seed.
  `type show --brief` prints each seed beside its field, and the `--set` hint
  on a refused skeleton lists only what is still stubbed. `--item "<Section heading>: <item
  line>"` (repeatable) places the line under that declared section of the
  skeleton — the heading is added when the skeleton lacks it — and the
  section's grammar judges it in the same write; a bare line under a grammar
  section gets its list marker. A heading the type does not declare is
  `unknown-section` with the declared sections in `details.valid_values`. A
  required patterned field left unset is refused with the fields and their
  forms in `details.set`.
- **`write <path>`** reads the whole page from stdin. The engine stamps `auto`
  dates and nothing else; the identity gate refuses a new page whose name forms
  collide (`identity-candidates`, exit 10) until `--not-any-of` names every
  candidate; then the judge refuses any error finding (`draft-invalid`, exit
  5). A whole-page write that drops a governed item is `removed-illegally`,
  and its hint is the remediation of each arm that fired — the History landing
  line for a relation, the closing clause for a claim. `--base <digest>` is
  compare-and-swap against the page on disk (`stale-base`, exit 4). **`--from
  <dir>`** lands every `.md` under a directory as one judged state, all or
  none, so mutually linked pages can be created together; the directory is
  resolved against `--root` like every path a verb takes, a refusal names the
  absolute directory it looked in (`details.resolved`), and a refused set
  carries the same `pages` rows as an accepted dry run — each draft with its
  findings and its `preview` — beside `failing`. **`--section
  <heading> --append`** splices the stdin lines at the section's tail: one
  parsed item under a grammar, verbatim under prose. The section must be
  declared by the type (`unknown-section`, with the declared sections in
  `details.valid_values`); when the page does not carry it the heading is
  added, after the nearest section the page carries that precedes it in
  declared order. A claims form (`--replace-core`, `--retract`, `--correct
  --core`, `--line`, `--coexist`) acts on one claim the page carries and
  renders the History line itself; on a declared, absent section it is
  `section-absent`.
- **`fix --rule <id> --expect <n|any>`** applies the `MachineApplicable` ops
  one rule licenses, refuses when the count is not `--expect`, and proves
  the result with one more judge of the whole vault with every fixed page in
  place: `not-proved` when the rule still fires on a fixed page, `new-errors`
  when any page gained an error. It judges the state the finding came from —
  the working tree, which `check` and `lint` judge, unless `--staged`, the
  index that `gate` and `lint --staged` judge; a finding from the index hands
  out `--staged` in its argv. `--path` narrows either to one page; `--staged`
  alone is every page the index changed; neither is every page. Only
  `--staged` can disagree with the tree it writes, so only it refuses
  `working-tree-drift`, naming every drifted page; `expect-mismatch` names the
  state it judged and the flag that switches. Two judges however many pages:
  142 pages in 1.7 s where each page used to cost two judges of the vault.
  `--propose` prints `HasPlaceholders` renderings and applies nothing.
- **`move <from> <to> --reason <r>`** moves with `git mv`, reports the
  folder-tag findings rather than editing tags, and keeps the basename unless
  `--rename`, which lands the old name in `aliases` through the Writer.
  `--rewrite-links` rewrites inbound wikilinks. `--reason` is one of
  `move_reasons` when the bundle declares them.
- **`retire <page> --superseded-by <name>`** sets `status: retired` and the
  successor pointer through the Writer and inserts the banner line.
- **`graph edges`** queries the graph built from the working tree, the same
  construction `check` compares against. `--label` is repeatable and reads as
  "any of"; `--missing` lists the pages on the one named side (`--inbound` or
  `--outbound`) that carry none of the selected edges, which is derived
  coverage, and the answer names the side: `"side": "target"` for
  `--inbound` (the targets no selected edge reaches) and `"source"` for
  `--outbound` (the sources that carry none). "Which subsystems carry no
  `mapped_in`" is `--label mapped_in --outbound subsystem --missing`; the
  inbound form answers "which source maps does no subsystem point at". An unknown type, kind or label is exit 3 with `nearest`; a
  registered-but-unused label is an empty answer.
- **`search <query>`** is deterministic lexical retrieval: an identity ladder
  (name, alias, stem, title) fused with BM25 by reciprocal rank fusion, CJK
  bigram-tokenized. Every answer carries a `coverage` block; `caps.hit` says the
  cap cut the list, and a not-found is only as good as that block. `--near`
  adds an advisory near-name list that never changes ranks.
- **`type show <name> [--brief]`**, **`type list`** are the introspection
  surface for types; see [concepts.md](concepts.md). Under `--brief` the
  `section_lines` follow the template's order where the type has one, as
  the `skeleton` beside them does; without it they follow the declaration.
- **`vocabulary show <name> [--label] [--target]`** prints each entry's four
  shared properties, its module's own `properties` verbatim, and
  `references`: for each dotted path the registering module declared in
  `typeRefs` or `tagRefs`, the names it holds and the concrete types they
  resolve to in this vault. `--target <type>` is the inbound view of any
  vocabulary whose module declares a type-valued property: the entries whose
  declared property names the type or an ancestor, with the path it did so
  through; on a vocabulary that declares none it is `target-not-applicable`.
- **`brief --role <r>`** prints the role's verb list, the bundle's types,
  every declared vocabulary's entries with their properties, its
  vocabularies' census, the loaded modules' skill fragments and the naming
  rules. The writer's brief is a generated artifact: `check --write` lands
  it at `generated/BRIEF.md` beside the other three, `init` lands it the same
  way, and `skills update` re-renders it; the verb itself writes nothing.
- **`skills status | update [--force]`** compares the installed skill files
  under `.claude/skills/` with the shipped ones by the stamp the engine wrote
  and reinstalls them; a file the bundle edited is refused unless `--force`.
- **`modules list | plan`**, **`trust grant | list | revoke module:<pkg>`**
  are the module surface; see [extending.md](extending.md). A `modules list`
  row carries `contributes` (types, fragments, templates, skill fragments,
  contributed vocabulary entries, vocabularies, grammars, checks, lanes),
  `resolved` (the bundle's package.json spelling, the declared range, the
  path), `grant` and `grant_scope`, the scope that approves the installation
  (`vault` or `worktrees`); a refused module carries its code and grant
  state. `trust grant`, `list` and `revoke` take `--scope vault`, the default,
  or `--scope worktrees`, which covers this vault's path in every linked
  worktree of its repository. Named with `--scope worktrees`, each refuses
  `scope-unresolved` when git cannot read that scope; `trust list` without
  `--scope` reports the failure as `worktree_scope.error` beside the vault
  grants it read. With `--scope vault`, the listing adds no scope lookup, and
  `trust` reads no vault law, so nothing preloads a bundle's modules to answer
  it either.
  A grant or a revoke reads and writes the machine-local store as one
  operation under a lock beside it, and refuses `store-busy` when another
  process holds it. `trust list --all` is the whole store rather than this
  vault's share of it: every record with its identity, its scope, the path it
  is keyed by, its digest, when it was granted, and whether that path is still
  on this machine. `trust revoke --record <identity>` removes exactly that
  record and needs neither a vault nor a repository, which is how a record
  whose directory is gone is removed at all.
  [extending.md](extending.md#trust) says how a load is
  approved and what each scope's key can and cannot tell apart.
- **`freshness [--fetch] [--fast-forward]`** measures every `pin` field
  against the origin its page names: `ls-remote` per origin by default;
  `--fetch` keeps a blobless bare cache under `.wikiwright/origins/` and
  measures distance and the covering diff; `--fast-forward` advances only the
  pins whose covering diff is empty, through the Writer. Origin `"."` is the
  repository enclosing the vault — the vault root, or the nearest ancestor
  work tree when the vault is a directory inside the repository it documents
  — and its `covers` paths are repository-root-relative. `entries` lists every
  pin with its `state`, one word naming what the writer must do: `current`
  (the pin is the head), `unchanged` (the head moved and the covering diff is
  empty: the read holds; these are the `--fast-forward` candidates), `stale`
  (the covering diff touches a covered path: re-read and re-pin), `behind`
  (the head moved and this run could not read the diff, at ls-remote depth:
  run `--fetch`), `unknown` (under `--fetch`, a pin the origin's history does
  not hold), or `unmeasured` with a `reason`; `behind`, `stale` and
  `covering_touched` stay as data beside it, and `pins` counts all six. A
  page with no `covers` is stale on any diff. At object depth the page's
  citations are held to the pin as well. A backticked token is a citation in
  one of four spellings: a repository path whose first segment is an entry at
  the root of the tree at the pin, a root file included; that path with
  `:<line>` or `:<from>-<to>`; a bare file name, suffix included, that is the
  basename of exactly one file the page covers; or a line or a range alone,
  which
  names the nearest file cited before it on the page — a directory is a
  citation of its own and is not that file, since a line does not live in a
  directory. A token carrying
  whitespace or any of `*`, `://`, `{`, `<`, `$` is prose, not a path. Every
  distinct path must exist at the pin, a cited line must not exceed the blob's
  line count, and a range must count up from a first line. Each miss is one
  `citation-unresolved` warning, and the entry's `citations` block carries
  `checked` and `unresolved`, each row with a `reason`: `missing`, `past-end`,
  `unattached` (a line with nothing cited before it), `ambiguous` (a file name
  two covered paths share) or `malformed` (`:0`, or a range that counts down).
  What this does not check is whether those lines say what the prose says they
  say. The report is
  `generated/freshness.json`, never committed.
- **`okf check`** is base-OKF conformance alone, pinned to the upstream commit
  in `fixtures/okf-upstream/reference.json`: the frontmatter parses and every
  page carries a non-empty `type`.
- **`version`** prints the engine version and the commit the binary was built
  from; `--version` and `-v` alias it.

## Verbs

<!-- generated: begin (bun docs/render-cli.ts --write) -->

Global flags, accepted by every verb:

| Flag | Meaning |
|---|---|
| `--root <value>` | vault root directory (default: current directory) |
| `--help` | print this command's spec and exit |

| Verb | Role | Writes | Summary |
|---|---|---|---|
| [`brief`](#brief) | writer | no | Print the role's brief: every verb it may run, the types, the vocabularies, the names. `check --write` lands the writer's under generated/. |
| [`check`](#check) | writer | yes | The aggregate pass: registry + lint + generated-drift comparison. |
| [`fix`](#fix) | writer | yes | Apply the mechanical ops one rule licenses, all-or-nothing, and prove them gone. |
| [`freshness`](#freshness) | maintainer | yes | Measure every pin against the origin its page names: is it still the head (default), or how far behind and is the capture stale (--fetch); --fast-forward advances the clean pins. |
| [`gate`](#gate) | maintainer | no | The hooks' entry point: check the engine pin, then judge the staged vault. |
| [`graph`](#graph) | consumer | no | Query the graph's edges by kind, label and the type on either side — or list the pages on one side that carry none (coverage, derived). |
| [`hook`](#hook) | maintainer | yes | Install the marker pre-commit gate (and the commit-msg prefix hook when declared). |
| [`init`](#init) | maintainer | yes | Scaffold a vault from a starter constitution — only what is missing, unless --force; installs the hook when git exists. |
| [`lint`](#lint) | writer | no | Lint pages against their effective type contracts; error findings exit 5. |
| [`modules`](#modules) | maintainer | no | List the modules this bundle declares, or plan the delta of adopting another version. |
| [`move`](#move) | maintainer | yes | Move a page with a stated reason; surfaces tag findings, never edits tags. |
| [`new`](#new) | writer | yes | Create a page of a registered type from its template; the typed write-path gate. |
| [`okf`](#okf) | consumer | no | Base-OKF conformance as its own verdict, independent of the constitution. |
| [`retire`](#retire) | maintainer | yes | Standard end-of-life: status retired + banner + optional successor pointer. |
| [`schema`](#schema) | consumer | no | Print the generated command registry: names, roles, flags, examples. |
| [`search`](#search) | consumer | no | Deterministic lexical search with match reasons and a coverage block. |
| [`skills`](#skills) | maintainer | yes | Reinstall the shipped skills into .claude/skills/, or compare installed vs shipped. |
| [`trust`](#trust) | maintainer | yes | Grant, list, or revoke this machine's content-hashed module grants. |
| [`type`](#type) | consumer | no | Introspect the type registry: show one effective contract, or list all types. |
| [`version`](#version) | consumer | no | Report the engine version and the commit this binary was BUILT from (--version / -v alias it). |
| [`vocabulary`](#vocabulary) | consumer | no | Show one vocabulary: its entries and what they admit, the sections that bind it, and the vault's own census. |
| [`write`](#write) | writer | yes | Write a page from stdin, a directory of drafts together (--from), or splice one item into a section (--section --append, any grammar); the claims forms retire, replace and correct a claim. |

### brief

`wikiwright brief`

Print the role's brief: every verb it may run, the types, the vocabularies, the names. `check --write` lands the writer's under generated/.

Role: `writer`. Writes: no.

| Flag | Meaning |
|---|---|
| `--role <value>` | consumer \| writer \| maintainer (default: writer) |

```text
wikiwright brief --role writer
wikiwright brief --role maintainer
```

### check

`wikiwright check`

The aggregate pass: registry + lint + generated-drift comparison.

Role: `writer`. Writes: yes (accepts `--dry-run`).

| Flag | Meaning |
|---|---|
| `--write` | refresh derived artifacts before comparing |
| `--limit <value>` | cap the findings array (default 50) |
| `--rule <value>` | only findings with this rule id |
| `--path <value>` | only findings on this page |
| `--all` | lift the findings cap |
| `--dry-run` | report the plan — the ops this verb would apply — and write nothing |

```text
wikiwright check --root .
wikiwright check --write
```

### fix

`wikiwright fix`

Apply the mechanical ops one rule licenses, all-or-nothing, and prove them gone.

Role: `writer`. Writes: yes (accepts `--dry-run`).

| Flag | Meaning |
|---|---|
| `--rule <value>` | the rule id whose ops to apply |
| `--path <value>` | the page (repo-relative); with neither --path nor --staged, every page |
| `--staged` | judge the index, the state `gate` and `lint --staged` judge; alone, every page the index changed. Without it the working tree, the state `check` and `lint` judge |
| `--line <value>` | restrict to the finding on this line |
| `--propose` | print the HasPlaceholders renderings without applying anything |
| `--expect <value>` | the op count this call may apply, or `any` |
| `--dry-run` | report the plan — the ops this verb would apply — and write nothing |

```text
wikiwright fix --rule sections --path wiki/parser.md --expect 1
wikiwright fix --rule folder-tags-present --staged --expect any
wikiwright fix --rule unknown-frontmatter-key --expect any
wikiwright fix --rule renamed-without-alias --path wiki/lexer.md --staged --expect 1
```

### freshness

`wikiwright freshness`

Measure every pin against the origin its page names: is it still the head (default), or how far behind and is the capture stale (--fetch); --fast-forward advances the clean pins.

Role: `maintainer`. Writes: yes (accepts `--dry-run`).

| Flag | Meaning |
|---|---|
| `--fetch` | keep a blobless bare cache per origin under .wikiwright/origins/ and measure pin distance and the covering diff against it |
| `--fast-forward` | with --fetch: rewrite each pin whose covering diff is empty to the origin's head, through the Writer |
| `--dry-run` | report the plan — the ops this verb would apply — and write nothing |

```text
wikiwright freshness
wikiwright freshness --fetch
wikiwright freshness --fetch --fast-forward
```

### gate

`wikiwright gate`

The hooks' entry point: check the engine pin, then judge the staged vault.

Role: `maintainer`. Writes: no.

| Flag | Meaning |
|---|---|
| `--commit-msg <value>` | judge a commit message file against commit_prefixes |
| `--limit <value>` | cap the findings array (default 50) |
| `--rule <value>` | only findings with this rule id |
| `--path <value>` | only findings on this page |
| `--all` | lift the findings cap |

```text
wikiwright gate
wikiwright gate --commit-msg .git/COMMIT_EDITMSG
```

### graph

`wikiwright graph <edges>`

Query the graph's edges by kind, label and the type on either side — or list the pages on one side that carry none (coverage, derived).

Role: `consumer`. Writes: no.

| Flag | Meaning |
|---|---|
| `--kind <value>` | edge kind: wikilink, tagged, cites, supersedes, or a grammar's item kind; with --label it defaults to the one kind that carries labels |
| `--label <value>` (repeatable) | keep edges carrying any of these labels (repeatable) |
| `--inbound <value>` | keep edges whose target page's type chain includes this type |
| `--outbound <value>` | keep edges whose source page's type chain includes this type |
| `--missing` | instead of the edges, list the pages on the named side (exactly one of --inbound / --outbound) that carry none of them: an inbound side lists the targets no selected edge reaches, an outbound side the sources that carry none |
| `--limit <value>` | cap the edges or missing array (default 100) |
| `--all` | lift the cap |

```text
wikiwright graph edges --label implements --label diverges-from --inbound requirement --missing
wikiwright graph edges --label mapped_in --outbound subsystem --missing
wikiwright graph edges --kind relation --inbound source --missing
wikiwright graph edges --label covers --outbound design-note
```

### hook

`wikiwright hook <install>`

Install the marker pre-commit gate (and the commit-msg prefix hook when declared).

Role: `maintainer`. Writes: yes (accepts `--dry-run`).

| Flag | Meaning |
|---|---|
| `--chain <value>` | repo-relative script the hook runs first, propagating its exit |
| `--dry-run` | report the plan — the ops this verb would apply — and write nothing |

```text
wikiwright hook install
wikiwright hook install --chain scripts/hooks/pre-commit
```

### init

`wikiwright init`

Scaffold a vault from a starter constitution — only what is missing, unless --force; installs the hook when git exists.

Role: `maintainer`. Writes: yes (accepts `--dry-run`).

| Flag | Meaning |
|---|---|
| `--constitution <value>` | starter constitution (default "base") |
| `--force` | overwrite the existing files init lists as conflicts |
| `--dry-run` | report the plan — the ops this verb would apply — and write nothing |

```text
wikiwright init
wikiwright init --constitution base --dry-run
wikiwright init --force
```

### lint

`wikiwright lint`

Lint pages against their effective type contracts; error findings exit 5.

Role: `writer`. Writes: no.

| Flag | Meaning |
|---|---|
| `--page <value>` | lint one page (repo-relative path) |
| `--staged` | lint staged content against the base revision |
| `--stdin` | lint a draft read from stdin (with --path) |
| `--since <value>` | replay every commit from <rev> to HEAD, each against its first parent |
| `--limit <value>` | cap the findings array (default 50) |
| `--rule <value>` | only findings with this rule id |
| `--all` | lift the findings cap |
| `--explain` | with --page: chain, sections, vocabularies, and a paste-ready exceptions stanza per queued finding |
| `--path <value>` | with --stdin, the draft's would-be path; otherwise, only findings on this page |

```text
wikiwright lint --root .
wikiwright lint --staged
wikiwright lint --page wiki/example.md
wikiwright lint --since HEAD~5
```

### modules

`wikiwright modules <list|plan>`

List the modules this bundle declares, or plan the delta of adopting another version.

Role: `maintainer`. Writes: no.

| Flag | Meaning |
|---|---|
| `--package <value>` | with `plan`: the declared module whose version would change |
| `--candidate <value>` | with `plan`: a bundle root that already has the candidate version installed |

```text
wikiwright modules list
wikiwright modules plan --package @acme/kit --candidate ../bundle-with-the-new-version
```

### move

`wikiwright move <from> <to>`

Move a page with a stated reason; surfaces tag findings, never edits tags.

Role: `maintainer`. Writes: yes (accepts `--dry-run`).

| Flag | Meaning |
|---|---|
| `--reason <value>` | the stated justification for the move |
| `--rename` | admit a basename change: the rename ritual, performed rather than reported |
| `--rewrite-links` | rewrite inbound wikilinks through link-rewrite (default: report only) |
| `--dry-run` | report the plan — the ops this verb would apply — and write nothing |

```text
wikiwright move wiki/a/x.md wiki/b/x.md --reason activity-boundary
wikiwright move wiki/a/Ana.md wiki/a/Anna.md --reason browse-misleading --rename --rewrite-links
```

### new

`wikiwright new <type> <title>`

Create a page of a registered type from its template; the typed write-path gate.

Role: `writer`. Writes: yes (accepts `--dry-run`).

| Flag | Meaning |
|---|---|
| `--dest <value>` | destination path (repo-relative) |
| `--set <value>` (repeatable) | field=value into the skeleton's frontmatter (repeatable); a string-valued shape takes the text, a list, number, boolean or object shape takes JSON |
| `--item <value>` (repeatable) | "<Section heading>: <item line>" placed under that declared section of the skeleton (repeatable); the section's grammar judges the line, and a heading the type does not declare is refused with the declared ones listed |
| `--date <value>` | the write's date (default: today) |
| `--not-any-of <value>` (repeatable) | an identity candidate this create ruled out (repeatable) |
| `--dry-run` | report the plan — the ops this verb would apply — and write nothing |

```text
wikiwright new architecture-overview "Architecture" --dest wiki/architecture.md
wikiwright new subsystem "Parser" --dest wiki/parser.md --item "Relations: part_of [[Architecture]]"
wikiwright new code-concept "Lexing" --dest wiki/lexing.md --set description="How the lexer tokenizes."
```

### okf

`wikiwright okf <check>`

Base-OKF conformance as its own verdict, independent of the constitution.

Role: `consumer`. Writes: no.

```text
wikiwright okf check
```

### retire

`wikiwright retire <page>`

Standard end-of-life: status retired + banner + optional successor pointer.

Role: `maintainer`. Writes: yes (accepts `--dry-run`).

| Flag | Meaning |
|---|---|
| `--superseded-by <value>` | canonical name of the successor page |
| `--dry-run` | report the plan — the ops this verb would apply — and write nothing |

```text
wikiwright retire wiki/old-model.md --superseded-by new-model
```

### schema

`wikiwright schema`

Print the generated command registry: names, roles, flags, examples.

Role: `consumer`. Writes: no.

```text
wikiwright schema
```

### search

`wikiwright search [query]`

Deterministic lexical search with match reasons and a coverage block.

Role: `consumer`. Writes: no.

| Flag | Meaning |
|---|---|
| `--type <value>` | restrict to one type |
| `--tag <value>` | restrict to pages carrying a tag |
| `--title-contains <value>` | restrict by title substring |
| `--limit <value>` | result cap (default 20) |
| `--near` | add the advisory name:near candidate list (never changes ranks) |

```text
wikiwright search 张伟
wikiwright search --tag reset
wikiwright search parser --type subsystem
wikiwright search "Zhang Wei" --near
```

### skills

`wikiwright skills <status|update>`

Reinstall the shipped skills into .claude/skills/, or compare installed vs shipped.

Role: `maintainer`. Writes: yes (accepts `--dry-run`).

| Flag | Meaning |
|---|---|
| `--force` | overwrite a file whose bytes the engine cannot account for |
| `--dry-run` | report the plan — the ops this verb would apply — and write nothing |

```text
wikiwright skills status
wikiwright skills update
```

### trust

`wikiwright trust <grant|list|revoke> [module]`

Grant, list, or revoke this machine's content-hashed module grants.

Role: `maintainer`. Writes: yes (accepts `--dry-run`).

| Flag | Meaning |
|---|---|
| `--scope <value>` | vault (the default): this vault alone; worktrees: this vault's path in every linked worktree of its repository |
| `--all` | list every record in this machine's store, not only the ones that apply to this vault |
| `--record <value>` | revoke exactly the record of this identity, as `list --all` prints it; it needs neither a vault nor a repository |
| `--dry-run` | report the plan — the ops this verb would apply — and write nothing |

```text
wikiwright trust grant module:@acme/kit
wikiwright trust grant module:@acme/kit --scope worktrees
wikiwright trust list
wikiwright trust list --all
wikiwright trust revoke module:@acme/kit
wikiwright trust revoke --record 4f9c1a2b3d5e
```

### type

`wikiwright type <list|show> [name]`

Introspect the type registry: show one effective contract, or list all types.

Role: `consumer`. Writes: no.

| Flag | Meaning |
|---|---|
| `--brief` | print the contract as the writing instruction, with live counts |

```text
wikiwright type show subsystem
wikiwright type show code-concept --brief
wikiwright type list
```

### version

`wikiwright version`

Report the engine version and the commit this binary was BUILT from (--version / -v alias it).

Role: `consumer`. Writes: no.

```text
wikiwright version
wikiwright --version
```

### vocabulary

`wikiwright vocabulary <show> [name]`

Show one vocabulary: its entries and what they admit, the sections that bind it, and the vault's own census.

Role: `consumer`. Writes: no.

| Flag | Meaning |
|---|---|
| `--label <value>` | narrow the entries block to one entry |
| `--target <value>` | the inbound view: every entry whose declared type-valued property names this type or an ancestor of it (a vocabulary whose module declares no such property has no inbound view) |

```text
wikiwright vocabulary show relations
wikiwright vocabulary show relations --label part_of
wikiwright vocabulary show relations --target source-map
wikiwright vocabulary show tags
```

### write

`wikiwright write [path]`

Write a page from stdin, a directory of drafts together (--from), or splice one item into a section (--section --append, any grammar); the claims forms retire, replace and correct a claim.

Role: `writer`. Writes: yes (accepts `--dry-run`).

| Flag | Meaning |
|---|---|
| `--from <value>` | a directory of drafts: every .md under it is a draft at the same vault-relative path, judged in one state and landed together or not at all |
| `--section <value>` | the declared heading this op edits |
| `--append` | splice the stdin lines at the section's tail: one item under a grammar, verbatim under prose |
| `--date <value>` | the write's date (default: today) |
| `--replace-core <value>` | claims: retire this claim handle and replace it with the stdin claim |
| `--retract <value>` | claims: retire this claim handle with no replacement |
| `--correct <value>` | claims: the claim handle whose core carries a typo |
| `--core <value>` | claims: with --correct, the corrected core |
| `--line <value>` | claims: name the claim by line instead of by handle |
| `--coexist <value>` | claims: with --append, why a second open claim of the same category is deliberate |
| `--base <value>` | compare-and-swap against this page digest |
| `--not-any-of <value>` (repeatable) | an identity candidate this write ruled out (repeatable) |
| `--dry-run` | report the plan — the ops this verb would apply — and write nothing |

```text
wikiwright write wiki/parser.md --dry-run
wikiwright write --from temp/drafts
wikiwright write wiki/parser.md --section Relations --append
wikiwright write wiki/parser.md --section Invariants --append --date 2026-09-03
```

<!-- generated: end -->
