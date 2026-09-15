# Changelog

Notable changes to wikiwright, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). `wikiwright
version` prints the engine version and the commit a binary was built from.

## Unreleased

### Added

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

### Fixed

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

### Changed

- `gate` and `lint --staged` read the index once: the staged diff and the
  index listing were each spawned again for the second pass, the one over the
  roots the staged constitution names, and the diff a third time before both.
  A one-page commit now spawns 7 git processes. Interleaved against the
  previous build, the gate over a small repository fell from 172 ms to
  154 ms and over the embedded devwiki from 270 ms to 252 ms; the
  envelopes are identical.
- The gate reads the HEAD bytes of every changed and deleted page with one
  `cat-file --batch-check` and the batch read the staged pages already use,
  where it spawned one `git show` per page. A commit of 100 changed pages in
  a 1,000-page repository spawned 106 git processes and spawns 7, and gates
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
