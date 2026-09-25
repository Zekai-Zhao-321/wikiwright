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
envelope and a refusal alike. `version` and `schema` answer about the engine
and `bundles` about the skill directories, so they carry none; a `bundles list` row carries each copy's identity from its marker instead.

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
| `label` | the basename of the root's real path, or over a copy the bundle its marker names: a name for a reader, not an identity; two bundles can share one |
| `root` | the root's real path |
| `head` | the commit HEAD names in the repository enclosing the root; `null` when git names none: no repository encloses the root, it has no commit yet, or git cannot answer there; `null` over a copy |
| `dirty` | whether `git status` lists any change under the root, untracked files included and ignored ones not; `null` when no repository answers, and over a copy |
| `law` | the law the bundle declares and has installed: `config/constitution.json`, `config/engine.json` and the digest of each declared module installed under its `node_modules` or at its declared `path`, in declaration order, whether or not it loads |
| `content` | every page under the content roots, path and bytes, as the working tree holds them: an uncommitted edit moves it, and `head` does not move |

Both digests are sha256 over newline-joined lines, and neither reads git or
parses a page. `law` is over `config/constitution.json <sha256>`,
`config/engine.json <sha256>` (of the empty text when the file is absent) and
`module:<package> <digest>` per declared module installed under the bundle's
`node_modules` or at its declared `path`, the digest the loader proves it
under; a declared module that is not installed contributes no line. The law
is what the bundle declares and has installed, whether or not its modules
load, so a refusal of a module that did not load carries the `law` it
refused. `content` is over
`<path> <sha256 of the page's bytes>`, one line per page under the content
roots `config/engine.json` declares, in code-unit path order. Two directories
holding the same bytes carry the same `law` and `content`, and `root` tells
them apart. The brief's header prints the same `law`.

The block is computed after the verb returns, so it describes the tree the verb
left. It is absent when the root holds no constitution, and when a file the
identity reads resolves outside the root, which every read of a vault refuses;
the engine states no partial identity. An envelope answered before the verb
runs names no bundle either: `--help`, a refusal of the arguments, a
`role-forbidden`, a refusal of `--bundle`, a refused marker.

A root that holds `config/export.json` is a copy (docs/constitution.md
§exports), and its block says so. `label` is the bundle the marker names,
wherever the copy was installed; `head` and `dirty` are `null`, since the
checkout the copy sits in, if any, is not the bundle's; `law` and `content`
are recomputed as for any bundle, so an intact copy of a whole bundle carries
its source's `law`. One more key names the export:

```json
"export": {
  "name": "orchard-pruning",
  "source": { "repository": null },
  "select": { "kind": "tag", "tags": ["pruning"] },
  "pages": 1,
  "cut": { "links": 0, "citations": 0, "attachments": 0 }
}
```

`source.repository` is where the bundle is installed from, `null` when it
declares none; `pages` and `cut` are the marker's counts. `intact: false` is
added when the recomputed `law` or `content` differs from the digests the
marker recorded: the copy was changed after export. It is information, not a
refusal. A marker that is not one — not JSON, a key missing, of the wrong type
or unknown, another schema or version — is refused `export-marker-invalid`
(exit 4) before any module loads or a page is read, with the first reason in
`details.reason`: the copy is not loaded. The brief's header over a copy names
the export and the bundle it was cut from.

A root named by `--bundle` whose name other, farther copies of the same
bundle also answer adds `shadowed`, a list of `{root, tier}`, one per copy
not chosen (§Notes per verb, `--bundle`).

`lint`, `check` and `gate` answer with this verdict block, whole:

| Key | Meaning |
|---|---|
| `findings` | the findings, capped at `--limit` (default 50), error-first; `--rule` and `--path` filter before the cap and `--all` lifts it |
| `summary` | `pages`, `errors`, `warnings`, `infos`, `by_rule`, `excepted` and `unevaluated`, computed over the uncapped set; the exit code follows `errors` |
| `coverage.passes` | for every pass, `evaluated`, `not_applicable`, `unevaluable` and a `reason` (`no-base`, `capability-unavailable`, `external-origin`) |
| `unevaluated` | the passes a declaration turned on that this run could not judge, keyed by pass with a count and a reason |
| `caps` | `limit` and whether it was `hit` |
| `dispositions` | per page, the counted transition outcomes where a base exists (`relation_added`, `relation_removed`, `superseded`, `corrected`, …) |

The writing verbs judge with the same judge and answer in their own shapes.
`write` and `new` report the page they wrote: its `path`, `findings`,
`dispositions`, `claims` and `digest`, beside the `unevaluated` passes, not
the vault-wide `summary`, `coverage` and `caps`. `write --from` reports one
row per draft under `pages` — `path`, `created`, `findings`, `dispositions`,
`claims` and `digest`, with `preview` in a dry run and `blob` in a real one —
and `unevaluated` once, at the top level, beside `from`, `date` and
`resolve_checked`. `fix` reports what it `changed`, the
ops it applied and whether the proof held, and a refused proof carries the
findings that refused it.

## Exit codes

| Exit | `error.type` | Meaning |
|---|---|---|
| 0 | | ok |
| 1 | `internal` | the engine broke; `unexpected-error` carries the message, `git-short-read` names a git answer that ended before its terminator, `git-inconsistent-read` two git answers about one state that disagree — the staged diff and the index listing, or a commit walk and its count — and `git-timeout` a git child killed for running past `WIKIWRIGHT_GIT_TIMEOUT_MS`, each refused rather than judged |
| 2 | `usage` | the caller got a verb, flag, positional or environment variable wrong, or ran `init` or `skills` from the compiled binary (`shipped-files-absent`) |
| 2 | `constitution` | the law did not load, or the engine pin refused; nothing was judged |
| 3 | `not_found` | the page, type, vocabulary entry, revision, directory or bundle skill asked for does not exist |
| 4 | `conflict` | the state refuses the operation: a stale `--base`, a foreign hook, an `--expect` mismatch, a splice the Writer cannot prove, a vault path that resolves outside the vault, such as a config linked out of it (`linked-outside-vault`, from any verb, never read as a parse failure), a copy's marker that is not one (`export-marker-invalid`) |
| 5 | `findings` | the tool worked and the subject failed: read `data.findings` |
| 10 | `confirm_required` | an identity or blast-radius gate wants the plan pinned: `identity-candidates`, `open-claim-of-category` |

`git-short-read` and `git-inconsistent-read` are the engine refusing git's
answer rather than judging from it. Every git read hands git a file for its
stdout, and a batch read hands git its request as a file too, so the answer
and the request are whole by construction under any runtime; the
terminators, the counts, each batch row's name against its request, and the
two cross-checks stay as a second line. stderr is still a pipe, and it is
read for two recognitions — a path HEAD does not hold, a directory in no
repository — each of which, with its text lost, fails as `git-unavailable`
rather than giving a smaller answer. Every git child is spawned
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
| `WIKIWRIGHT_TODAY` | `write`, `new`, read once per process | the date the verb stamps, `YYYY-MM-DD`; the wall clock otherwise. A malformed value refuses before anything moves |
| `WIKIWRIGHT_GIT_TIMEOUT_MS` | the shell, before parsing; every git child | how long one git child may run, a whole number of milliseconds from 1 to 2147483647; 60000 when unset or empty. A child still running then is killed and the verb refused as `git-timeout` (exit 1); any other value is `git-timeout-invalid` (exit 2) before any verb runs |
| `WIKIWRIGHT_BYPASS` | the installed hooks | skips the gate for one commit and logs the reason into the git directory |
| `WIKIWRIGHT_SYSTEM_SKILL_DIR` | `--bundle`, `bundles list` | the machine's skill directory, probed after the user's two; `/etc/codex/skills` when unset, and none when empty. The suite sets it, over any value it inherits, to a directory under the temporary directory, and runs every scan with `HOME` there and its project tier inside a temporary repository, so no test probes a real machine's skill directories |
| `WIKIWRIGHT_SKILL_DIRS` | `--bundle`, `bundles list` | more skill directories to probe after the project's, the user's and the system's, colon-separated, in order |

## The plugin and its hooks

The package root, `packages/cli`, is also a Claude Code plugin.
`.claude-plugin/plugin.json` names it `wikiwright` at the package's version;
its skills are the three under `skills/`; `hooks/hooks.json` runs two scripts
with `bun`, `SessionStart` with no matcher and `PostToolUse` on
`Edit|Write`. Each reads the hook's JSON on stdin, runs this package's own
binary with the session's environment (so `HOME`, the two skill-directory variables and
`WIKIWRIGHT_ROLE` apply), prints at most one JSON
object whose `hookSpecificOutput` carries `hookEventName` and
`additionalContext`, and exits 0 whatever happens: on stdin that is not a JSON
object, a missing binary or any error, it prints nothing.

- `hooks/session-start.mjs` runs `bundles list`, which reads markers only,
  and prints one line per row: the copy's name, the bundle it was cut from,
  its tier, and the action that fits how it was installed, read off the row
  and the provenance its installer recorded — a copy that is a link: "linked
  to a local checkout; the checkout's own gate keeps it current", and no
  remote advice; a recorded value shaped like a version tag or a commit id
  (a tree id aside): "pinned at <key> <value>", reported, not judged; a
  recorded repository: "update with `gh skill update <name>`"; nothing
  recorded: "installed by hand; `gh skill install` makes it updatable". A
  copy another shadows says by which root; a directory whose marker the scan
  cannot take is named with its reason. A last line names `--bundle <name>`
  and `--root ${CLAUDE_SKILL_DIR}`. When the hook's `source` is `compact` or
  `resume`, the first line says they are being re-established from current
  state. It checks nothing remote: what an installer records names a ref and
  a tree, not the commit a copy came from, so the installer's update is the
  comparison, and the hook names it. It prints no page content and no
  digest, and nothing when no bundle skill is installed.
- `hooks/post-edit.mjs` takes `tool_input.file_path` (a leading byte order
  mark on stdin ignored, as the engine ignores it) and finds the bundle by
  ancestry: the nearest directory above the file's real path that holds
  `config/constitution.json`. None: it prints nothing. A root that holds
  `config/export.json` is an installed copy, and it prints one line — "this is
  an installed copy of <bundle>; edits here are overwritten by the next
  update;" and the contribution hint `bundle-readonly` gives — and lints
  nothing. Otherwise the page's vault path is the path below the root as
  edited — the root is the first of the edited path's ancestors whose real
  path is the root, so a root reached through a link is followed while a
  content directory or a page that is itself a link keeps the path it was
  edited at — and a `.md` path is linted with `lint --page <path> --root
  <root>`. A path the engine does not take for a page (`invalid-path`: outside
  every content root, or linked out of the vault) gets nothing. Under a role
  that may not lint, it says the session may not write the bundle; a lint the
  engine refuses otherwise is named by its code; else it names the finding
  count and each finding's rule, line, message and route, a fix's argv quoted
  for a POSIX shell so a path with a space stays one argument and naming the
  root with `--root`; then, one line each, the passes the lint's
  `unevaluated` names — `not evaluated here: <pass> (<count> declaration(s),
  <reason>)` — which the staged gate judges against HEAD, so an edit to an
  append-only body can pass here and be refused at commit; and says that this
  judged the working-tree page against the current law and is not the staged
  gate's verdict.

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
  first, through one write loop, then judges; `brief-stale` names it. It also
  renders every `output: skills` export into `skills/<name>/` under the root
  (docs/constitution.md §exports), and the plugin manifests when `plugin` is
  declared: every planned file is replaced and every file under an export's
  own `skills/<name>/` that the plan no longer holds is removed — the
  directory is owned whole, so a name under it such as `.git` or `.obsidian`
  is listed and removed like any other — and nothing else is touched; an
  ordinary file stays in place until its replacement is
  renamed over it, so a render that fails leaves the previous bytes. `check`
  compares each rendered copy with a fresh render:
  `export-stale` (error, fixed by `check --write`) names the first ten files
  that differ, each `missing`, `extra` or `changed`. The render's own findings
  are queued to `export-review`: `export-tag-unknown`, `export-guide-outside`,
  `export-skill-invalid`, `export-symlink` (a file reached through a link
  that leaves the bundle), `export-destination-invalid` and
  `export-destination-linked` (a symbolic link on the path from the root to
  `skills/<name>`, `skills` itself included, or to the manifests' directory:
  nothing is written through it) (errors, and the export is not rendered), `export-not-closed` (a warning, since
  widening the selection or declaring `cut` is a judgment: a selected page
  links to a page left out under `links: closed`, and that export is withheld
  — not rendered, its previous bytes left as they were, and refused by
  `export`), and
  `export-orphan` (a warning: a `skills/<name>/` holds a marker no declaration
  names; the engine never removes it). A root that holds `config/export.json`
  is a copy and renders nothing. `data.generated.exports` lists the export
  directories judged.
- **`export <name> --to <dir>`** writes one `output: external` export
  (docs/constitution.md §exports) into the repository rooted at `<dir>`, as
  `<dir>/skills/<name>/`, and `<dir>/plugin.json` and
  `<dir>/.claude-plugin/plugin.json` when `plugin` is declared. It owns what
  it writes as `check --write` owns an in-repository export: every planned file
  is replaced, every file under `<dir>/skills/<name>/` the plan no longer holds
  is removed, a `.git` or `.obsidian` name under it included, and nothing
  else under `<dir>` is touched, `<dir>/.git` included. It
  refuses a name the config does not declare (`export-not-declared`, exit 2,
  the declared names in `details.valid_values`), an `output: skills` export
  (`export-output-skills`, exit 2: `check --write` renders those), a `<dir>`
  that is not a directory (`directory-not-found`, exit 3, with
  `details.resolved`), a `<dir>` that is the bundle's root or lies in one of
  its content roots (`export-destination-inside-bundle`, exit 2), a `<dir>/skills/<name>/` that
  exists and holds no `config/export.json` (`export-destination-occupied`,
  exit 4), and a symbolic link at `<dir>/skills`, at `<dir>/.claude-plugin`
  when `plugin` is declared, or anywhere under `<dir>/skills/<name>/`
  (`export-destination-linked`, exit 4), each before anything is written. An export a
  render finding refuses (`export-tag-unknown`, `export-symlink`, …) exits 5
  with the findings and writes nothing. A copy carries bytes, never a link:
  a vault file reached through a link that leaves the bundle is refused as
  `export-symlink`, so a link in `wiki/` never publishes bytes from outside
  it, while a declared kit's files are read through their links unchecked,
  since the law digest already covers them and the declaration makes them the
  bundle's. The envelope carries the absolute
  `destination`, the marker's identity (`export`: its `name`, `bundle`,
  `source.repository`, `select`, `pages` and `cut` counts) and the counts
  `written`, `removed` and `files`. `--dry-run` plans every file written and
  removed: a path under the bundle's root is named relative to it, any other
  absolute.
- **`lint --stdin --path <p>`** judges a draft in place of the page at `<p>`
  with the disk bytes as its base. **`lint --staged`** judges the git index
  against HEAD, exactly as `gate` does. **`lint --since <rev>`** replays every
  first-parent commit from `<rev>` to HEAD, each under the constitution at that
  commit, and rolls the pairs into one `summary` plus `totals.blocked`.
  **`lint --page <p> --explain`** adds the page's chain, section lines,
  vocabularies and a paste-ready `exceptions` stanza per queued finding.
- **`gate`** checks `engine.json`'s `engine` pin against the staged
  constitution, then judges the index. `generated-drift` and `export-stale`
  are judged over the staged state, never the working tree's, and each only
  when the index tracks what it compares — an artifact under `generated/`, a
  rendered export under `skills/` or a plugin manifest — so a partial staging
  passes when the staged artifacts and copies describe the staged pages, and
  a bundle whose index tracks none has the pass in the coverage block as not
  run (`capability-unavailable`). Each rendered export is rendered from the
  staged pages, config, templates, attachments and a kit declared by `path`,
  and compared with the staged bytes under `skills/`, so a page or a kit
  staged without its re-rendered export is `export-stale`. A kit declared by
  `path` is part of what the commit carries, so it is loaded from its staged
  bytes — written out under the temporary directory, a link the index tracks
  written as that link, proved there and removed — and the verdict over the
  staged pages, the rebuilt artifacts and the export plan are all reached
  under it: a check the working tree's kit attaches and the staged kit does
  not never fires here, and the copy's brief names the staged kit's types. A
  staged kit that does not load refuses the gate with the loader's own code
  (`module-impure`, `module-load-failed`, …), as a working-tree kit refuses a
  verb. A link the index tracks is refused for an export as
  `export-symlink`, since the index holds a link's target and not its bytes;
  the working tree is read through its links. A kit installed under
  `node_modules` is the one exception: it is not in the index, so it is read
  from the working tree, as the module preload reads it, and a change to it
  is judged as the tree holds it, not as a commit would. `--commit-msg <file>` is the
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
  the modules live in a `node_modules` the copy does not create: the
  envelope's `modules` block names the install, that each module loads on
  first use and is proved then (its purity scan and its determinism fixture
  run before it judges anything), and `check --write`, and `check` before the
  install refuses by name (`module-unresolved`).
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
  the two newest open claims of the category — the last two in page order,
  not the two latest by date — and a count of the rest. No arm
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
  retired page stays in the candidate set with its score halved before the
  sort, so it may move down the list, and `status:retired` among its
  reasons, as a retired page does. The identity
  ladder does not apply, a query is required, and `--near` is refused beside
  it. The coverage block counts `pages_considered` and `items_considered`.
  A multi-word query matches a page or an item that holds any one of its
  terms. `--files` lists every page with a match instead of ranking them:
  `{ path, match_reasons }` in code-unit order by path, uncapped
  (`caps.limit` is `null`), the pages the ranked search finds plus every page
  whose normalized text holds a query term only inside a longer word
  (`text:contains`). That is a tokenized substring scan — the query split
  into terms as the tokenizer splits it, each matched case-folded — plus the
  identity matches, which can find a page by its name or an alias where its
  text never spells the query; it is not a literal line search, and a
  pattern with punctuation or across terms can list other files than `rg`
  would. The suite compares it with a line search on six fixed queries over
  two handbooks and a claims bundle, which is evidence for those queries, not
  a proof for every one. With no query, every page the filters keep. Each result of the ranked page search carries a `band`, and `--band`
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
  `WIKIWRIGHT_ROLE`, or to `writer` when the session declares none. Over an
  installed copy the brief is always the consumer's, whatever role is asked
  for, since the copy refuses every write: `role` is `consumer` and
  `details.reason` is `installed copy`, beside the role `asked`, and the brief
  is the one the copy carries in `generated/BRIEF.md`. Every
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
  Three skills ship, one for each way of working with a bundle, beside the
  brief that carries the verbs: `wikiwright-consume`, the runtime skill every
  bundle skill requires — how to run the engine (the one route today: clone,
  `bun install`, `bun run build`, then `bun <clone>/packages/cli/dist/main.js`
  by its absolute path from the caller's own directory, since `--bundle`
  resolves from where a command runs), what a
  bundle skill is and how to find one, the consumer's commands, each of which
  must parse, with their discipline (which bundle answered, the section rather
  than the sentence, a child handed the words with their source), where a
  problem with a copy goes by its contribution mode, and what is left without
  the engine — a bundle skill, an export's generated `SKILL.md`, requires it
  by name and names the engine version it needs, and carries no command
  reference of its own; `wikiwright-write`, for adding to one (what deserves a page, the
  identity guard, the hedge kept verbatim, a citation as a relation);
  `wikiwright-maintain`, for answering its findings and changing its law and for deciding what a bundle exports and where (an external export is no redaction boundary), with
  the lint-response playbook the engine generates beside it. `init` installs
  every skill the package ships.
- **`modules list | plan`** is the module surface; see
  [extending.md](extending.md). A `modules list` row carries `contributes`
  (types, fragments, templates, skill fragments, contributed vocabulary
  entries, vocabularies, grammars, checks, lanes), `resolved` (the bundle's
  package.json spelling, the declared range, the path: the declared `path`,
  or `node_modules/<package>`), `digest` and `fixture`, what the module's
  determinism fixture judged when the load proved it (its pages and its
  findings); a refused module carries its refusal (`code`, `package`,
  `message`, and `hint` and `details` where it has them) and `resolved`.
  There is no approval step: installing a module is the consent to run it,
  and every load proves it (a purity scan of its bytes and its determinism
  fixture, once per digest in each process) before it judges anything.
- **`bundles list`** walks the skill directories `--bundle` probes, in the
  same order, one directory listing each, and prints one row per directory
  that holds a marker: `name`, `bundle`, `tier` (`project`, `user` or
  `extra`), `root` as found and its `realpath`, `linked` (the found path is a
  symbolic link), `source` (`repository`, and the `law` and `content`
  digests the marker recorded), `select`, `pages`, `contribution`,
  `provenance` — every key of the copy's `SKILL.md` frontmatter outside the
  generated `name`, `description`, `license` and `metadata`, each as a string,
  as an installer wrote it — and `shadowed_by`, the root `--bundle <name>`
  would choose instead, `null` for the one it chooses and for every copy of a
  name two different bundles answer. A directory whose marker does not parse,
  or names another name, is a row of its own with `code`
  `export-marker-invalid` and its `reason`. It loads no law, runs no kit and
  hashes no page: the digests are the marker's, so a copy changed since it
  was cut lists as it was cut; its envelope over `--root` says
  `intact: false`. Nothing registers a bundle: installing one is copying its
  directory.
- **`--bundle <name>`** names the target of any verb by the name of a bundle
  skill installed in a skill directory, in place of `--root`; nothing is
  registered. The shell resolves it before any module loads, probing
  `<dir>/<name>/config/export.json` in order: the project's `.claude/skills`
  and `.agents/skills` at the working directory and at each parent up to the
  top of its git repository (to the filesystem root outside one); then
  `~/.claude/skills`, `~/.agents/skills` and the system's directory,
  `WIKIWRIGHT_SYSTEM_SKILL_DIR` or `/etc/codex/skills` when it is unset (an
  empty value leaves it out); then each directory of `WIKIWRIGHT_SKILL_DIRS`,
  colon-separated, in order. Plugin
  caches are not scanned; a host names one through that variable. A
  candidate is a directory whose marker parses and names that same name; one
  that does not is skipped, with its reason. Every candidate is inspected:
  identity is the marker's `source.repository`, `bundle` and `name`, two
  paths to one real directory are one candidate, and a copy that names no
  repository is itself alone. One identity resolves to the nearest candidate,
  and `metadata.bundle.shadowed` lists the others as `{root, tier}`. It
  refuses `one-target` beside `--root`; `bundle-name-invalid` (exit 2) for a
  name outside the skill grammar, before anything is read;
  `bundle-not-found` (exit 3) with `details.searched`, the directories
  probed in order, `details.names`, every bundle skill the scan saw, and
  `details.skipped`; `bundle-ambiguous` (exit 2) when two identities answer,
  every candidate's `{root, tier, repository}` in `details.candidates`. What
  it finds is a copy, guarded as every marked root is (below). With a name
  the cost is one `stat` per probed directory and one marker read per
  candidate, never a page read.
- **A marked root is read only.** A root that holds `config/export.json` is
  an installed copy, however it was named — `--bundle`, `--root` or the
  working directory — and its marker is checked before any module preloads:
  a marker that is not one is `export-marker-invalid` (exit 4), and a verb
  that can write is refused `bundle-readonly` (exit 2), `--dry-run` included,
  with `details` `{export, contribution, root}` and a hint that says where a
  change goes instead, by the copy's contribution mode: `issues`, "report at
  <repository>/issues"; `pull-requests`, "clone <repository> and write
  there"; `local-folder`, "write a proposal under <folder>"; `none`, "this
  copy takes no reports". The repository is the contribution's, or the
  export's when it names none. The guard is a courtesy on this CLI, not a guarantee:
  a copy's files are protected by their permissions, and a process that does
  not go through the CLI is not stopped.
- **`freshness [--fast-forward]`** measures every `pin` field against the
  local repository: origin `"."` is the repository enclosing the vault — the
  vault root, or the nearest ancestor work tree when the vault is a directory
  inside the repository it documents — and its `covers` paths are
  repository-root-relative. A pin naming any other origin (a git URL) is not
  contacted and not measured: its entry is `unmeasured` with a `reason` that
  begins `remote-origin:`, and nothing is found on its page. Remote
  freshness, the `ls-remote` depth and the `--fetch` cache, was removed
  (`docs/roadmap.md`). `--fast-forward` advances only the pins whose covering
  diff is empty, through the Writer, and its dry run names exactly those.
  `entries` lists every pin with its `state`, one word naming what the writer
  must do: `current` (the pin is the head), `unchanged` (the head moved and
  the covering diff is empty: the read holds; these are the `--fast-forward`
  candidates), `stale` (the covering diff touches a covered path: re-read and
  re-pin), `unknown` (a pin the repository's history does not hold), or
  `unmeasured` with a `reason`; `behind`, `stale` and `covering_touched` stay
  as data beside it, and `pins` counts all five. A
  page with no `covers` is stale on any diff. A measured page's citations
  are held to the pin as well. A backticked token is a citation in
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
  from; `--version` and `-v` alias it. `checkout_commit` and `checkout_dirty`
  name the checkout the running code sits in, and are null from the compiled
  binary, whose code sits in none.

From the compiled binary (`bun run binary`), `init` and `skills` refuse as
`shipped-files-absent` (exit 2): they read files the package ships, and the
binary carries none of them (`docs/roadmap.md` §The compiled binary).

## Verbs

<!-- generated: begin (bun docs/render-cli.ts --write) -->

Global flags, accepted by every verb:

| Flag | Meaning |
|---|---|
| `--root <value>` | vault root directory (default: current directory) |
| `--bundle <value>` | the name of a bundle skill installed in a skill directory: the copy found is the target, in place of --root |
| `--help` | print this command's spec and exit |

| Verb | Role | Writes | Summary |
|---|---|---|---|
| [`brief`](#brief) | consumer | no | Print the role's brief: every verb it may run, the types, the vocabularies, the names. `check --write` lands the writer's under generated/. |
| [`bundles`](#bundles) | consumer | no | List every bundle skill installed in the skill directories, as --bundle finds them, with its identity and what its installer recorded. |
| [`check`](#check) | writer | yes | The aggregate pass: registry + lint + generated-drift comparison. |
| [`export`](#export) | maintainer | yes | Write one declared external export into another repository, as skills/<name>/. |
| [`fix`](#fix) | writer | yes | Apply the mechanical ops one rule licenses, all-or-nothing, and prove them gone. |
| [`freshness`](#freshness) | maintainer | yes | Measure every pin against the local repository: how far behind its head, and is the capture stale; a pin naming another origin is reported unmeasured; --fast-forward advances the clean pins. |
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
| `--role <value>` | consumer \| writer \| maintainer (default: WIKIWRIGHT_ROLE when set, else writer); an installed copy's is always the consumer's |

```text
wikiwright brief --role writer
wikiwright brief --role maintainer
wikiwright brief --role consumer
```

### bundles

`wikiwright bundles <list>`

List every bundle skill installed in the skill directories, as --bundle finds them, with its identity and what its installer recorded.

Role: `consumer`. Writes: no.

```text
wikiwright bundles list
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

### export

`wikiwright export <name>`

Write one declared external export into another repository, as skills/<name>/.

Role: `maintainer`. Writes: yes (accepts `--dry-run`).

| Flag | Meaning |
|---|---|
| `--to <value>` | the root of the repository the export is written into (required) |
| `--dry-run` | report the plan — the ops this verb would apply — and write nothing |

```text
wikiwright export roses --to ../roses-skill
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

Measure every pin against the local repository: how far behind its head, and is the capture stale; a pin naming another origin is reported unmeasured; --fast-forward advances the clean pins.

Role: `maintainer`. Writes: yes (accepts `--dry-run`).

| Flag | Meaning |
|---|---|
| `--fast-forward` | rewrite each pin whose covering diff is empty to the repository's head, through the Writer |
| `--dry-run` | report the plan — the ops this verb would apply — and write nothing |

```text
wikiwright freshness
wikiwright freshness --fast-forward
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
