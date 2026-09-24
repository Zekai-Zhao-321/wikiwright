# The CLI

`wikiwright` is one binary with 24 verbs. Every verb prints exactly one JSON
envelope on stdout and reserves stderr for text a human at a terminal needs.
The verb reference below is rendered from the binary's own command registry by
`bun docs/render-cli.ts --write`, and `bun docs/render-cli.ts --check` fails
when the document is behind the binary. `wikiwright schema` prints the same
registry as JSON, and `wikiwright <verb> --help` prints one verb's row.

## The envelope

```json
{ "ok": true,  "data": { … }, "metadata": { "command": "check", "engine": "0.1.0", "bundle": { … } } }
{ "ok": false, "data": { … }, "error": { "code": "findings", "exit_code": 5, "type": "findings", "message": "2 error finding(s)", "hint": "…", "details": { … } }, "metadata": { … } }
```

`error.code` is one kebab-case word per meaning and the same word across
verbs (`unknown-type` from `new`, `type` and `vocabulary` alike).
`error.details` carries the machine recovery data: the valid values
(`details.valid_values`, `details.valid_flags`, `details.valid_commands`), the
conflicting paths, the digests that disagreed. Prose is never load-bearing. A
refusal that carries a verdict, such as a `write` refused by its findings, puts
the verdict in `data` beside `error`.

Every verb that reads a vault's law names the bundle it read in
`metadata.bundle`, when its root holds `config/constitution.json`, on an ok
envelope and a refusal alike. `version` and `schema` answer about the engine,
`trust` about this machine's grants and `bundles` about its registry, so they
carry none; a `bundles list` row carries each connection's identity instead.

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
| `label` | the basename of the root's real path: a name for a reader, not an identity; two bundles can share one |
| `root` | the root's real path |
| `head` | the commit HEAD names in the repository enclosing the root; `null` when git names none: no repository encloses the root, it has no commit yet, or git cannot answer there |
| `dirty` | whether `git status` lists any change under the root, untracked files included and ignored ones not; `null` when no repository answers |
| `law` | the law the bundle declares and has installed: `config/constitution.json`, `config/engine.json` and the digest of each declared module installed under its `node_modules`, in declaration order, whether or not this machine trusts it |
| `content` | every page under the content roots, path and bytes, as the working tree holds them: an uncommitted edit moves it, and `head` does not move |

Both digests are sha256 over newline-joined lines, and neither reads git or
parses a page. `law` is over `config/constitution.json <sha256>`,
`config/engine.json <sha256>` (of the empty text when the file is absent) and
`module:<package> <digest>` per declared module installed under the bundle's
`node_modules`, the digest a trust grant pins; a declared module that is not
installed contributes no line. Trust does not enter: the law is what the
bundle declares and has installed, and a grant decides whether this machine
will judge under it without changing what it is, so a `module-untrusted`
refusal carries the `law` the run after the grant carries. `content` is over
`<path> <sha256 of the page's bytes>`, one line per page under the content
roots `config/engine.json` declares, in code-unit path order. Two directories
holding the same bytes carry the same `law` and `content`, and `root` tells
them apart. The brief's header prints the same `law`.

The block is computed after the verb returns, so it describes the tree the verb
left. It is absent when the root holds no constitution, and when a file the
identity reads resolves outside the root, which every read of a vault refuses;
the engine states no partial identity. An envelope answered before the verb
runs names no bundle either: `--help`, a refusal of the arguments, a
`role-forbidden`, a refusal of `--bundle`.

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
| 1 | `internal` | the engine broke; `unexpected-error` carries the message, `git-short-read` names a git answer that ended before its terminator, and `git-inconsistent-read` two git answers about one state that disagree — the staged diff and the index listing, or a commit walk and its count — each refused rather than judged |
| 2 | `usage` | the caller got a verb, flag, positional or environment variable wrong |
| 2 | `constitution` | the law did not load, or the engine pin refused; nothing was judged |
| 3 | `not_found` | the page, type, vocabulary entry, revision or grant asked for does not exist |
| 4 | `conflict` | the state refuses the operation: a stale `--base`, a foreign hook, an `--expect` mismatch, a splice the Writer cannot prove, a machine-local store this engine cannot read (`trust-store-malformed`, `bundles-registry-malformed`) |
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
| `WIKIWRIGHT_ROLE` | the shell, before parsing; `brief`, as its default `--role` | `consumer`, `writer` or `maintainer` (the default when unset). A verb above the caller's rank exits 2 with `role-forbidden` and `details.valid_commands` filtered to the caller's rank; an unrecognised value is `role-unknown`, never a fallback. A guard rail for an agent session, not a security boundary |
| `WIKIWRIGHT_TODAY` | `write`, `new`, `trust grant`, read once per process | the date the verb stamps, `YYYY-MM-DD`; the wall clock otherwise. A malformed value refuses before anything moves |
| `WIKIWRIGHT_BYPASS` | the installed hooks | skips the gate for one commit and logs the reason into the git directory |
| `WIKIWRIGHT_TRUST_FILE` | `trust`, the module loader | the path of the machine-local grant store (default `~/.config/wikiwright/trust.json`); a relative path is resolved against the working directory |
| `WIKIWRIGHT_BUNDLES_FILE` | `bundles`, `--bundle` | the path of the machine-local bundles registry (default `~/.config/wikiwright/bundles.json`); a relative path is resolved against the working directory |

## The plugin and its hooks

The package root, `packages/cli`, is also a Claude Code plugin.
`.claude-plugin/plugin.json` names it `wikiwright` at the package's version;
its skills are the three under `skills/`; `hooks/hooks.json` runs two scripts
with `node`, `SessionStart` with no matcher and `PostToolUse` on
`Edit|Write`. Each reads the hook's JSON on stdin, runs this package's own
binary with the session's environment (so `WIKIWRIGHT_BUNDLES_FILE`,
`WIKIWRIGHT_TRUST_FILE` and `WIKIWRIGHT_ROLE` apply), prints at most one JSON
object whose `hookSpecificOutput` carries `hookEventName` and
`additionalContext`, and exits 0 whatever happens: on stdin that is not a JSON
object, a missing binary or any error, it prints nothing.

- `hooks/session-start.mjs` runs `bundles list` and, when a connected bundle
  is present, names each one: its name, kind, label, head (or `no commit`),
  whether it is dirty, and the page to read first where the connection sets
  one; then that every command takes `--bundle <name>` or `--root <dir>` and
  that the brief prints for the session's role. When the hook's `source` is
  `compact` or `resume`, the first line says the connections are being
  re-established from current state. It prints no page content, and nothing
  when no bundle is connected.
- `hooks/post-edit.mjs` takes `tool_input.file_path` (a leading byte order
  mark on stdin ignored, as the engine ignores it) and routes it by `bundles
  list --records`: the root is the first of the edited path's ancestors,
  walking up from the file, whose real path is the connection's, and the
  page's vault path is the path below it as edited, so a root reached through
  a link is followed while a content directory or a page that is itself a
  link keeps the path it was edited at; the file's real path
  must lie inside the connection's, and the vault path must be a `.md` file
  under one of the `content_roots` the engine read. A file outside every
  connection, or in one whose config cannot be read inside it, gets nothing. For an `installed` connection it says the page is
  in a read-only copy and where a change goes. Otherwise it runs
  `lint --page` on the page: under a role that may not lint, it says the
  session may not write the bundle; else it names the finding count and each
  finding's rule, line, message and route, a fix's argv quoted for a POSIX
  shell so a path with a space stays one argument; then, one line each, the
  passes the lint's `unevaluated` names — `not evaluated here: <pass> (<count>
  declaration(s), <reason>)` — which the staged gate judges against HEAD, so
  an edit to an append-only body can pass here and be refused at commit; and
  says that this judged the working-tree page against the current law and is
  not the staged gate's verdict.

`hooks-scripts.test.ts` holds the scripts to the input and output shapes the
Claude Code hooks reference documents. Host behaviour — whether and how a host
runs these hooks and uses their output — has not been verified in this
repository.

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
  Where `config/engine.json` derives the title from the basename
  (`field_sources.title: "basename"`) and `<title>` is the destination's
  basename, the skeleton writes no `title:`, which would only repeat the
  name; the H1 still carries it. A `<title>` that differs from the name is
  written, since dropping it would change the page's title. The template's frontmatter seeds
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
  findings and its `preview` — beside `failing`. Its real run answers in its
  dry run's shape: `ops` (the plan for the drafts it read and judged, built
  before anything landed, so a page the batch created is a `create`),
  `wrote: true`, and each page with its `blob` where the dry run has its
  `preview`. The directory is read once: a draft added while the run works
  is neither landed nor reported. **`--section
  <heading> --append`** splices the stdin lines at the section's tail: one
  parsed item under a grammar, verbatim under prose. The section must be
  declared by the type (`unknown-section`, with the declared sections in
  `details.valid_values`); when the page does not carry it the heading is
  added, after the nearest section the page carries that precedes it in
  declared order. A claims form (`--replace-core`, `--retract`, `--correct
  --core`, `--line`, `--coexist`) acts on one claim the page carries and
  renders the History line itself; on a declared, absent section it is
  `section-absent`. `--replace-core` closes the retired claim `valid <its
  date>→<the day before --date>, superseded <--date>`. On the claim's own
  date the interval is `valid D→D, superseded D`: the claim stood for part of
  that one day and was replaced the same day, and the interval is closed and
  zero-length, never `D→D-1`. A `--date` before the claim's own date is
  `date-before-claim` (exit 4): that interval would run backwards. `--coexist <reason>` admits a second open claim of a
  supersede category and records a rationale line under it, `coexists:
  <reason> (beside <handle>, <handle> and <n> more)`: the reason first, then
  the two newest open claims of the category and a count of the rest. No arm
  reads the line; the reason given is what admits the claim.
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
  adds an advisory near-name list that never changes ranks. `--limit` caps the
  results (20 by default) and `--all` lifts the cap. `--items` ranks grammar
  items instead of pages: every item the judge would parse — a claim, a
  relation, an entry — on the pages `--type`, `--tag` and `--title-contains`
  keep, each with `path`, `line`, `section`, `kind`, `grammar`, `raw`, its
  `rationale` lines, `matched_in` (`core` when a query term is on the item's
  own line, `rationale` when it is only under it), `fields` (the grammar's own
  parse of the item, verbatim: for a claim its `handle`, `category`, `core` and
  `provenance`, the handle `write --replace-core` takes), `score` and
  `match_reasons`. The ranking is BM25 over the item's line and its rationale
  lines (`lexical:bm25`), with statistics from every walked page's items; an
  item whose text holds a query term only inside a longer word follows,
  unranked, as a line search would find it (`text:contains`). An item on a
  retired page keeps its place in the list with its score halved and
  `status:retired` among its reasons, as a retired page does. The identity
  ladder does not apply, a query is required, and `--near` is refused beside
  it. The coverage block counts `pages_considered` and `items_considered`.
  A multi-word query matches a page or an item that holds any one of its
  terms. `--files` lists every page with a match instead of ranking them:
  `{ path, match_reasons }` in code-unit order by path, uncapped
  (`caps.limit` is `null`), the pages the ranked search finds plus every page
  whose text holds a query term only inside a longer word (`text:contains`),
  which is the set a line search lists; with no query, every page the filters
  keep. Each result of the ranked page search carries a `band`, and `--band`
  keeps one: `identity` for a page the query names — by its name, an alias,
  the name without a trailing `(…)` qualifier, or its whole title
  (`name:exact`, `alias:exact`, `name:stem`, `title:exact`) — and `relevance`
  for every other match; the cap then counts the kept band, and an unknown
  band is `invalid-value` with `details.valid_values`. Under `--files` the
  band is applied after every match is classified, a page only a substring
  found being `relevance`, so the two bands split the unbanded list. `--items` stands alone:
  `--files` and `--band` beside it are `invalid-arguments`, as is `--near`
  beside `--files`.
- **`read <page> [--section <heading>] [--budget <bytes>]`** returns one page's
  sections, verbatim. `<page>` is tried, in order, as a vault path under a
  content root, a basename or an alias through the name index, and a title
  with the same identity, the title as the manifest spells it (derived under
  `field_sources` where the frontmatter carries none, as `page.title` and
  `page.description` are); `page.resolved_via` says which (`path`, `name`,
  `alias`, `title`). A miss is `page-not-found` with `details.tried` and names
  no page. A page that resolves outside the vault, a link out of it, is
  `invalid-path` (exit 2) with `details.path`, as `lint --page` refuses it,
  and does not stop a name from resolving to any other page. `data` is `{ page, sections, omitted, coverage }`. `page` carries
  `path`, `name`, `resolved_via`, `type`, `chain`, `title`, `description`,
  `status` (`active` or `retired`), `digest` and the parsed `frontmatter`;
  `digest` is sha256 over the page's raw bytes, the same sha256 the content
  digest's line for that page holds. Sections are cut at the type's section
  depth (2 when it declares none): the lead, from the line after the
  frontmatter to the line before the first heading at that depth, comes first
  with `heading: null`, and each heading at that depth runs to the line before
  the next. Each carries `address` (`<path>` for the lead, `<path>#<heading>`
  otherwise), `line`, `end_line`, `bytes` (the UTF-8 length of `text`) and
  `text`, the page's own lines with their line endings as the page has them,
  CR, LF or CRLF, counted as the parser counts them. A heading that appears
  more than once at that depth, as a type may admit, keeps the one address,
  and each of its sections carries `occurrence`, 1-based in page order; a
  heading that appears once carries none. `--budget` returns sections in page
  order while their running total fits; the first that would not, and every
  one after it, goes to `omitted` with its address (and its
  `occurrence`, where it has one) and `reason: "budget"`, to be asked for by
  `--section`. `--section` returns every section under that heading, in page
  order, the budget still applied, or refuses `section-not-found` with
  the page's headings at that depth in `details.valid_values`; a `--budget`
  that is not a whole number is `invalid-value`. `coverage` counts the page's
  sections, the returned ones and their bytes, beside the budget. The
  envelope's `metadata.bundle` is the attribution; nothing of it is repeated
  in `data`.
- **`type show <name> [--brief]`**, **`type list`** are the introspection
  surface for types; see [concepts.md](concepts.md). Under `--brief` the
  data leads with `brief`, `skeleton` and `section_lines`, before `fields`, so
  the first screen of it is what a writer reads before writing; the
  `section_lines` follow the template's order where the type has one, as
  the `skeleton` beside them does; without it they follow the declaration.
- **`vocabulary show <name> [--label] [--target]`** prints `names`, every
  entry name sorted, then each entry's four shared properties, its module's own `properties` verbatim, and
  `references`: for each dotted path the registering module declared in
  `typeRefs` or `tagRefs`, the names it holds and the concrete types they
  resolve to in this vault. `--target <type>` is the inbound view of any
  vocabulary whose module declares a type-valued property: the entries whose
  declared property names the type or an ancestor, with the path it did so
  through; on a vocabulary that declares none it is `target-not-applicable`.
- **`brief --role <r>`** prints, under a header naming the law digest the
  envelope's `metadata.bundle.law` carries, the role's loop and verb list, the
  bundle's types, every declared vocabulary's entries with their properties,
  its vocabularies' census, the loaded modules' skill fragments and the naming
  rules. The verb is a consumer verb, so every role may print its own brief;
  `--role` takes any of the three and defaults to the session's
  `WIKIWRIGHT_ROLE`, or to `writer` when the session declares none. Every
  role's loop opens on one line, "Use the engine to decide, to write and to
  attribute; use your own tools to look.", which each shipped skill states
  once too. The consumer's loop names no verb: select the bundle and pass its root
  explicitly, search every name form before saying a thing is absent, keep
  each answer's `metadata.bundle` beside what was taken from it, hand a child
  verbatim passages with their source, and report a knowledge problem as a
  proposal rather than an edit. The writer's loop is the five steps from a
  search to a commit through `write`. The maintainer's is the writer's five,
  then two: a queued finding is a judgment to adjudicate or a law to change,
  never a severity to lower, and `generated/` is committed with the pages it
  describes. The "Findings" paragraph is the role's too: the writer and the
  maintainer run a finding's `fix` argv and leave a `queue` alone; the
  consumer runs nothing, reports a `fix` finding for a writer and leaves a
  `queue` to a maintainer. The writer's brief is a generated artifact:
  `check --write` lands it at `generated/BRIEF.md` beside the other three,
  `init` lands it the same way, and `skills update` re-renders it; the verb
  itself writes nothing.
- **`skills status | update [--force]`** compares the installed skill files
  under `.claude/skills/` with the shipped ones by the stamp the engine wrote
  and reinstalls them; a file the bundle edited is refused unless `--force`.
  Three skills ship, each the judgment half of one way of working with a
  bundle, beside the brief that carries its verbs: `wikiwright-consume`, for
  using what a bundle knows (which bundle answered, the section rather than the
  sentence, a child handed the words with their source, a problem reported as
  a proposal); `wikiwright-write`, for adding to one (what deserves a page, the
  identity guard, the hedge kept verbatim, a citation as a relation);
  `wikiwright-maintain`, for answering its findings and changing its law, with
  the lint-response playbook the engine generates beside it. `init` installs
  every skill the package ships.
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
  process holds it. A store this engine cannot read — not JSON, not the
  store's schema, a version it does not read, a record of no known shape — is
  `trust-store-malformed` (exit 4) with `details.file` and, for a record,
  `details.record`, from `trust` and from any verb whose module load checks a
  grant; the file is never rewritten. `trust list --all` is the whole store rather than this
  vault's share of it: every record with its identity, its scope, the path it
  is keyed by, its digest, when it was granted, and whether that path is still
  on this machine. `trust revoke --record <identity>` removes exactly that
  record and needs neither a vault nor a repository, which is how a record
  whose directory is gone is removed at all.
  [extending.md](extending.md#trust) says how a load is
  approved and what each scope's key can and cannot tell apart.
- **`bundles add <root> --name <n> | list | remove <name>`** keeps this
  machine's registry of connected bundles, `~/.config/wikiwright/bundles.json`
  unless `WIKIWRIGHT_BUNDLES_FILE` names another file: a JSON document,
  `schema` `wikiwright/bundles`, `schema_version` 1, whose `bundles` each
  carry `name`, `root`, `kind`, `feedback` and `guide`. By default it is
  outside every vault and every repository; an override is resolved to an
  absolute path, and where it points is the caller's choice, not something
  the engine checks. It is written under the same lock as the trust store
  (`store-busy` when another process holds it), and the verb is a
  consumer's: connecting a bundle changes no bundle and grants nothing. `add` records the root as given, made absolute, and compares real
  paths: it refuses `bundle-name-invalid` for a name outside
  `^[a-z0-9][a-z0-9-]{0,63}$`, `invalid-kind`, `vault-not-found` for a root
  with no `config/constitution.json`, `guide-not-found` when `--guide` names
  no file under the root, `guide-not-a-page` (exit 2, with
  `details.content_roots`) when it names a file that is not a Markdown page
  under a content root `config/engine.json` declares, which is all `read`
  returns, `bundle-name-taken` when the name is connected, and
  `bundle-root-registered` when the root is connected under another name,
  named in `details.name`. `--kind` is `maintained`, the default, for a
  checkout the caller may write to within its role, or `installed`, for a copy
  that is read only; `--feedback` says where a problem with the bundle is
  reported, and `--guide` which page to read first, a page under a content
  root. `list` prints every
  connection sorted by name with `root` as registered, `realpath`, `present`
  (the root exists and holds a constitution), `kind`, `feedback`, `guide`,
  `content_roots` (as `config/engine.json` declares them, read inside the
  vault as every verb reads it, or `null` when the bundle is not present or
  that file cannot be read inside it) and `identity`: the envelope's bundle
  block without `root` (`label`, `head`, `dirty`, `law`, `content`), or `null`
  when the root is not present or its identity cannot be read. `list
  --records` prints the same rows without `identity`, reading no page and
  running no git, for a caller that only routes by them. Listing loads no law
  and no module, so a bundle whose modules this machine has not approved
  still lists. `remove` refuses a
  name that is not connected with `bundle-not-found` and `details.valid_values`.
  A plan's one path is the registry, absolute. A registry this engine cannot
  read is `bundles-registry-malformed` (exit 4), with `details.file` and, for a
  record, `details.record`, from `bundles` and from `--bundle`; the file is
  never rewritten. A record whose `root` is not an absolute path is one of
  these, never resolved against the working directory, where one name would
  answer for a different bundle from each directory; so are two records with
  one name or one real root, as a registry restored by hand can hold, where
  `--bundle` would answer with whichever came first.
- **`--bundle <name>`** names the target of any verb by its connection, in
  place of `--root`: the shell resolves it before any module loads, and the
  envelope's `metadata.bundle.label` says which bundle answered. It refuses
  `one-target` beside `--root`, `bundle-not-found` with
  `details.valid_values` for a name no connection carries, and
  `bundle-readonly` for a verb that can write the vault or its repository
  aimed at an `installed` connection, `--dry-run` included, with
  `details.kind` and `details.feedback`, where a change to that copy goes
  instead. `bundles` and `trust` are exempt by verb: their writes are this
  machine's registry and trust store, which change nothing of the copy while
  those stores lie outside it, as they do by default. The exemption does not
  look at where the environment put them: a store path set inside the copy is
  written there. The refusal is a guardrail on this CLI, not
  filesystem isolation: `--root` names the same directory and is not refused,
  by design, and nothing stops a process that does not go through the CLI.
  `bundles` itself takes `--bundle` and reads nothing of it beyond those
  refusals.
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
| `--bundle <value>` | a connected bundle's name (see `bundles`): its root is the target, in place of --root |
| `--help` | print this command's spec and exit |

| Verb | Role | Writes | Summary |
|---|---|---|---|
| [`brief`](#brief) | consumer | no | Print the role's brief: every verb it may run, the types, the vocabularies, the names. `check --write` lands the writer's under generated/. |
| [`bundles`](#bundles) | consumer | yes | Connect a vault by name in this machine's registry, list the connections with their identity, or remove one. |
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
| [`read`](#read) | consumer | no | Return a page's sections verbatim, with its digest and the bundle it came from, under a byte budget. |
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

Role: `consumer`. Writes: no.

| Flag | Meaning |
|---|---|
| `--role <value>` | consumer \| writer \| maintainer (default: WIKIWRIGHT_ROLE when set, else writer) |

```text
wikiwright brief --role writer
wikiwright brief --role maintainer
wikiwright brief --role consumer
```

### bundles

`wikiwright bundles <add|list|remove> [target]`

Connect a vault by name in this machine's registry, list the connections with their identity, or remove one.

Role: `consumer`. Writes: yes (accepts `--dry-run`).

| Flag | Meaning |
|---|---|
| `--name <value>` | with `add`: the name the bundle is connected as |
| `--kind <value>` | with `add`: maintained (the default) \| installed, a copy that is read only |
| `--feedback <value>` | with `add`: where a problem with this bundle is reported |
| `--guide <value>` | with `add`: the page to read first, a page under a content root, relative to the bundle's root |
| `--records` | with `list`: each connection's record and content roots, reading no bundle's identity |
| `--dry-run` | report the plan — the ops this verb would apply — and write nothing |

```text
wikiwright bundles list
wikiwright bundles add ../handbooks/orchard --name orchard --guide wiki/start-here.md
wikiwright bundles add /srv/handbooks/allotment --name allotment --kind installed --feedback "send a proposal to the handbook's maintainers"
wikiwright bundles remove allotment
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

### read

`wikiwright read <page>`

Return a page's sections verbatim, with its digest and the bundle it came from, under a byte budget.

Role: `consumer`. Writes: no.

| Flag | Meaning |
|---|---|
| `--section <value>` | return only the section under this heading, every one where it repeats |
| `--budget <value>` | the most bytes of section text to return; the rest are listed by address |

```text
wikiwright read wiki/pruning-roses.md
wikiwright read pruning-roses --section Steps
wikiwright read "Pruning roses" --budget 800
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
| `--all` | lift the result cap |
| `--near` | add the advisory name:near candidate list (never changes ranks) |
| `--items` | rank the grammar items themselves — claims, relations, entries — with their line, section and fields |
| `--files` | every page with a match, by path with its reasons: unranked, uncapped |
| `--band <value>` | keep only the results of one band: identity \| relevance |

```text
wikiwright search 张伟
wikiwright search --tag reset
wikiwright search parser --type subsystem
wikiwright search "Zhang Wei" --near
wikiwright search "aphids roses" --items
wikiwright search "aphids codling" --files
wikiwright search pruning-roses --band identity
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
