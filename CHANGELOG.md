# Changelog

Notable changes to wikiwright, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). `wikiwright
version` prints the engine version and the commit a binary was built from.

## Unreleased

### Added

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

### Fixed

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
