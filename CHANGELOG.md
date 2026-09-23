# Changelog

Notable changes to wikiwright, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). `wikiwright
version` prints the engine version and the commit a binary was built from.

## Unreleased

### Added

- Every envelope of a verb that reads a vault's law names the bundle it read,
  in `metadata.bundle`, on an ok envelope and a refusal alike: `label` (the
  basename of the root's real path), `root` (that real path), `head` and
  `dirty` from the enclosing repository (`null` where git names none), `law`
  (sha256 over `config/constitution.json`, `config/engine.json` and the digest
  of each declared module installed under the bundle's `node_modules`, trusted
  on this machine or not, so a grant does not change it) and `content` (sha256
  over every page under the content roots, path and bytes, as the working tree
  holds them). An answer read from one bundle can be told from an answer read
  from another, and an uncommitted edit shows in `content` and `dirty` while
  `head` stays where it was. `version`, `schema`, `trust` and `bundles` carry
  none. The brief's header prints the law digest in place of a digest of the
  sorted type names, which did not move when a type's contract, the engine
  policy or a module changed.
- `bundles add <root> --name <n> | list | remove <name>` connects a vault by
  name in a machine-local registry (`~/.config/wikiwright/bundles.json`, or
  `WIKIWRIGHT_BUNDLES_FILE`), written under the trust store's lock. A
  connection carries its root, a `kind` — `maintained`, a checkout the caller
  may write to within its role, or `installed`, a copy that is read only — the
  place a problem with it is reported, and a page to read first. `list` shows
  every connection with the identity the envelope's bundle block carries and
  loads no law and no module, so a bundle whose modules are not approved on
  this machine still lists. The verb is a consumer's: the registry is outside
  every vault, and connecting a bundle grants nothing.
- `--bundle <name>` names the target of any verb by its connection, in place
  of `--root`, so an agent working in an unrelated directory reads two
  handbooks by name and every answer says which one it came from. It refuses
  `one-target` beside `--root`, `bundle-not-found` with the connected names,
  and `bundle-readonly` for a verb that writes the vault or its repository,
  dry run included, aimed at an installed copy, with the connection's feedback
  destination in the refusal; `bundles` and `trust`, whose writes are this
  machine's stores, are answered. That refusal is a guardrail on the CLI, not
  filesystem isolation: `--root` reaches the same directory by design.
- `read <page> [--section <heading>] [--budget <bytes>]` returns a page's
  sections verbatim, cut at its type's section depth, each with its address,
  lines and byte length, beside the page's type, chain, frontmatter and
  digest — sha256 over its raw bytes, the same one the content digest holds
  for it. A page is named by path, basename, alias or title, and
  `resolved_via` says which; a miss names no page. Its title and description
  are the manifest's, derived under `field_sources` where the frontmatter
  carries none. Under `--budget` the sections come in page order while they
  fit and the rest are listed by address. A consumer's verb: the envelope's
  bundle block says which bundle every passage came from.
- A third shipped skill, `wikiwright-consume`: the judgment for using what a
  bundle knows rather than writing it. Choose the bundle and say which one
  every answer came from; read the coherent section, qualifications with
  their claims; hand a subagent the words verbatim with the bundle, the path
  and the digest, never an alias; report a knowledge problem as a proposal to
  the connection's feedback destination, never an edit to an installed copy.
  It names no verb: the engine prints the brief for any connected bundle, from
  any directory. `init` and `skills update` install it beside the other two.
- The package is a Claude Code plugin: `.claude-plugin/plugin.json` beside
  the three skills, and `hooks/hooks.json` with two plain-Node scripts. At
  session start one names each connected bundle that is present — kind,
  label, head, dirty, the page to read first — and how a command names one,
  saying so again after a compaction or a resume. After an Edit or a Write to
  a connected bundle's page the other says what the edit means there: an
  installed copy is read only and its changes go to its feedback
  destination; a session whose role may not write is told so; otherwise the
  page's findings, each with its route. Both print nothing when there is
  nothing to say or anything goes wrong, and exit 0. They are tested against
  the documented hook input and output; host behaviour is not verified here.

- `trust list --all` prints every record in this machine's store: its
  identity, its scope, the path it is keyed by, its digest, when it was
  granted, and whether that path is still present. `trust revoke --record
  <identity>` removes exactly one record and needs neither a vault nor a
  repository, so a grant whose directory is gone can be removed at all —
  revoke resolved the vault path first and refused `root-not-found`.

- `trust grant --scope worktrees` approves a module's digest for a vault's
  path in every linked worktree of its repository, existing and future, keyed
  by the real path of the git common directory and the vault's path inside
  its worktree, spelled as the filesystem spells it. The default scope
  is the vault, unchanged: a 0.1.0 grant approves exactly what it approved,
  and only an explicit grant or revoke writes the store as version 2, whose
  worktree records carry no `vault` field so an older engine ignores them and
  keeps them. A matching digest in either scope approves; the vault grant
  needs no git, and git is read, with a hook's exported variables removed,
  only when a worktree grant could apply. A worktree scope may hold several
  approved digests. `trust list` and `modules list` name the approving scope,
  and `trust revoke --scope worktrees` removes every digest the scope approved
  and says whether a vault grant still approves. `module-scope-unresolved` is
  a new refusal for a worktree scope git could not read.

### Changed

- The brief renders one loop per role. The consumer's names no verb: select
  the bundle and pass its root explicitly, search every name form before
  saying a thing is absent, keep each answer's `metadata.bundle` beside what
  was taken from it, hand a child verbatim passages with their source, and
  report a knowledge problem as a proposal rather than an edit. The writer's
  five steps are unchanged, byte for byte, so a writer's generated brief does
  not move. The maintainer's adds two to them: a queued finding is a judgment
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
  bundle alone, a connection's kind and a session's role are guardrails on
  the command line and not isolation, and no skill grants trust.
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
  preloads a bundle's declared modules only for one that does. `schema`,
  `trust` and `version` no longer digest, purity-scan and trust-check a
  bundle's modules — nor resolve a worktree scope with git — to answer a
  question about the engine or about the one module they load themselves.
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

- Refusal hints (`module-unresolved`, `module-untrusted`, `module-modified`)
  and `init`'s next steps no longer print a `trust grant` command: the
  approval is a maintainer's decision, and an agent follows a printed command
  literally. AGENTS.md says an agent must not grant trust to unblock its work.
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

### Fixed

- `brief` is a consumer verb. It was ranked writer, so a session under
  `WIKIWRIGHT_ROLE=consumer` was refused `role-forbidden` when it asked for
  the brief `--role consumer` renders for it: the one role bounded to reading
  could not read its own manual. `--role` still takes all three roles, and
  without it the brief is the session's `WIKIWRIGHT_ROLE`, or the writer's
  when the session declares none: a consumer session that asked for its
  brief was handed the writer's.
- A trust store or a bundles registry this engine cannot read — not JSON, not
  the store's schema, a version it does not read, a record of no known shape —
  is refused by name, `trust-store-malformed` or `bundles-registry-malformed`,
  at exit 4 with the file and the failing record in `details`, from the verb
  and from the module load that checks a grant; it was an `unexpected-error`.
- Every file the shell writes outside a content page — the generated
  artifacts, the machine-local trust store, the shipped skills' files and
  stamps, the freshness report — lands through the Writer's staged replace:
  an exclusive temp beside the target, renamed into place, every file of a
  batch staged before the first rename. An interrupted write leaves the old
  bytes, and a reader never sees half a file. A replacement keeps the mode the
  file had, so a store a maintainer made private stays private; ownership is
  not preserved, which needs privilege the engine does not ask for.
- `trust grant` and `trust revoke` read, change and write the store as one
  operation under a lock beside it. Two of them at once each kept their own
  snapshot and the last write won, so a grant could vanish while both
  commands reported success. A lock is broken only when the process named in
  it is gone from this machine, never because it is old — a grant that digests
  a large module holds one for a while, and breaking it brings a revoked grant
  back. A lock that does not clear refuses `store-busy`.

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

- The parser is CommonMark plus YAML frontmatter: the GFM extensions
  (tables, task lists, strikethrough, autolink literals, footnotes) are no
  longer loaded. No checker reads those constructs, the projection every
  checker sees — headings, fences, inline code, raw HTML, wikilinks — is the
  same with and without them on every corpus this repository judges, and
  tokenizing them cost close to half of every parse. `@wikiwright/core` drops
  `mdast-util-gfm` and `micromark-extension-gfm`.

### Developing

- `fixtures/handbooks/orchard` and `fixtures/handbooks/allotment`: two small
  gardening handbooks, each a `procedure-page` type with a required climate
  and a `guide-page` for the page to read first, and a page with one title
  and different steps in both. The connection tests read them; both are
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
