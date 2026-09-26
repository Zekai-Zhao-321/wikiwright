# Architecture

Two packages, TypeScript, built, tested and run with Bun only, the version
`.bun-version` pins. `@wikiwright/core` is a pure library: functions over bytes, with no Node
typings in its tsconfig, so a filesystem call does not typecheck there. The
`wikiwright` package is the shell: argv, envelopes, exit codes, the filesystem,
git, and one module per verb. A third workspace package, `@wikiwright/kit-code`,
is a domain kit: plain JavaScript, no dependencies, declarations only, built by
nothing and loaded by a bundle through the same API a third-party kit uses.

## Directories

```text
packages/core/src/
  identity/    normalizeIdentity (NFC + full case fold, vendored table), codeUnitCompare
  parse/       ParsedDoc: frontmatter, headings, wikilinks, the line map
  names/       the vault name index, resolution, checkVaultIdentity
  registry/    load, validate, flatten: constitution.json and engine.json to EffectiveType
  shapes/      the closed shape kind set, checkValue, the pin field
  grammar/     section slicing, the item envelope, the state and transition arms
  modules/     the registration API: defineModule, loadModules, the parameter laws, purity
  stdlib/      claims, relations, entries: the standard library, behind the same API
  lint/        the per-page passes
  judge/       judge(state, law): routing, the gate rule, exceptions, coverage, caps
  passes/      PASS_TABLE, KERNEL_LANES, routeOf, unroutableRows
  fixers/      the closed fixer registry and the ops each derives
  writer/      applyWrite: five splice ops, byte-level
  generate/    graph.json, manifest.json, tag-catalog.md
  search/      the tokenizer, BM25, the identity ladder, RRF fusion, name:near
  fields/      title and description derivation
  gitplan/     pure parsers for git plumbing output
  hash/        sha256
  paths/       the path law: pathRefusal, isContentPath
  prefixes/    the commit-prefix verdict
  version/     the engine range grammar
  law/         v2, beside registry/: engine.json v4, libraries, the type, fragment and vocabulary documents, their composition, the skeleton
  schema/      v2: the one Ajv 2020 factory (strict, RE2 patterns, three formats, the engine keywords), the reserved keys, the effective shapes
  records/     v2: the fixed grammar's three records and their JSON Schemas
  interface/   v2: a page read from its bytes, and the page interface a rule is bound to
  rules/       v2: the CEL profile, its static bound, rule evaluation
  digest/      v2: the bytes, content, page and law digests
  verdict/     v2, beside judge/: judgeTypeLaw(state, law), its table of codes and routes, the grammar checks, the kernel transitions, the folder tags, CEL evaluation, exceptions, rule tests and examples, the law diff
  artifacts/   v2, beside generate/: graph.json, manifest.json, tag-catalog.md and queue.md of a state under its law
packages/cli/src/
  main.ts      dispatch to the table that answers the root, the role bound, --help and --help --json, the module preload, the bundle block, the envelope's bound and --out, one stderr writer
  commands.ts  the two tables, COMMANDS and LEGACY_COMMANDS, and nothing else
  spec.ts      CommandSpec, FlagSpec, Plan, ROLE_RANK, declaredRole, DRY_RUN_FLAG
  brief.ts     the brief's renderer, below every verb that renders one
  argv.ts      the parser built from the registry
  envelope.ts  ok, fail, EXIT, verdictEnvelope, capOptions
  clock.ts     today(): WIKIWRIGHT_TODAY or the wall clock, read once
  state.ts     fsState, indexState, overlayState, revisionState
  git.ts, stdoutfile.ts   the git plumbing: every git child spawned asynchronously (Bun.spawn), at most four at a time, awaited to its exit, its answer read from a file it writes itself
  vaultfiles.ts   the config paths, the reader, the page walk and the page reads, below the loader
  vaultio.ts   the loader, its refusals
  bundle.ts    the bundle an envelope names: label, root, head, dirty, the law and content digests, and over a copy the export it is
  marker.ts    a copy's marker, config/export.json: read and checked before any module loads
  exports.ts   the export planner, the plugin manifests, the in-repository renders and their comparison
  artifacts.ts the one generation path: the artifacts, the writer's brief and the rendered exports, written and planned
  law.ts       the loaded vault to a Law; the engine.json consumers
  lawfiles.ts  v2: the working-tree, index and revision adapters that snapshot a bundle's law and its libraries for law/
  lawstate.ts  v2, beside state.ts: the four states judgeTypeLaw is handed (working tree, drafts over the disk, the index over HEAD, a revision)
  writer.ts    the shell half of the Writer: prove, then temp-and-rename
  atomicwrite.ts   the one staged replace every non-page write lands through
  moduleload.ts, modulefixture.ts   the module ladder: resolve, digest, scan, load, prove
  sha256.ts    the shell's sha256 over bytes: a module's files, a page, a shipped skill
  discovery.ts the skill directories `--bundle` and `bundles list` scan: a name to the nearest copy of one bundle, reading markers only
  hooks.ts, staged.ts, stagedkits.ts   the installed hooks, the staged gate, and a path kit it loads from the index
  verbs/<name>.ts   one CommandSpec per verb of the v2 command table, over the type-document law (the v2 delivery, step 4)
  typelaw.ts   v2: which table answers a root, the law a state carries loaded or refused, the engine range, the bundle block
  generated.ts v2: generated/ — the brief and the kernel's four files, rendered, compared and written
  pins.ts      v2: every pin measured against the local repository, and the stale sources a page links
  legacy/<name>.ts  one CommandSpec per old verb, waiting for its replacement under verbs/ (the v2 delivery, step 4); legacy/bundles.ts lists the scan, legacy/read.ts is the consumer's read
packages/cli/constitutions/   the base and code starters init scaffolds; code is a bundle over the kit
packages/cli/skills/          the three shipped skills (consume, write, maintain) and the generated playbook
packages/cli/.claude-plugin/  the plugin manifest: the package root is a Claude Code plugin
packages/cli/hooks/           hooks.json and its two scripts, session-start.mjs and post-edit.mjs
packages/kit-code/            @wikiwright/kit-code: the code wiki's types, anchored fragment, labels, templates, skills
libraries/kit-code/           the code wiki's type library of the v2 law, id code: the page kinds, anchored, the relation labels, their rule tests and examples
libraries/kit-garden/         the neutral test library of the v2 law, id garden: documents, rule tests, examples; the allotment handbook imports it
devwiki/                      this repository's own bundle, on the v2 law, importing libraries/kit-code, judged by the suite
fixtures/conformance/         the neutral module fixture and two bundles consuming it
fixtures/handbooks/           two small gardening handbooks on the v2 law, one page title in both, each with a rule of its own
fixtures/memory-synth/        a synthesized personal-memory vault (41 pages, claims and categories), on the v2 law
fixtures/minimal-vault/       the smallest bundle that loads, on the v2 law
fixtures/v1/                  frozen v1 copies of the migrated corpora, read by the old table's tests until step 6
fixtures/okf-upstream/        the OKF pin: repository, commit, grounding line
tools/                        write-build-info, build-binary, render-playbook, dispositions, generate-casefold, uncovered, run-suite, benchmark-check
test/                         the tests of the built CLI as a whole: the pipe probes and the compiled binary
scripts/hooks/pre-commit      the development gate
docs/                         this documentation; render-cli.ts renders docs/cli.md's verb block
```

## The invariants, and the tests that hold them

Each invariant is a property of the engine, named with the test that fails
by name when it breaks. Test files live under `packages/core/test`,
`packages/cli/test` and `test/`.

| Invariant | What it means | Held by |
|---|---|---|
| Typed | one nominal type per page; shapes and section grammars are data in the constitution; the engine never calls a model | `registry-v3`, `registry`, `field-schemas`, `shapes`, `sections`, `grammar-arms`, `grammar-v3-arms`, `grammar-parser` |
| OKF-compatible | the vault is a valid OKF bundle without an export step; `okf check` stays green on every corpus | `okf` |
| Four layers | the kernel imports nothing from `stdlib/`, type-only imports included; no first-party module imports another's implementation | `kernel-import-boundary` |
| The modules import in one direction | no package's `src/` holds a runtime import cycle, however many steps around; a type-only import is erased and is not an edge | `import-graph` |
| One registration API | the three standard-library modules load through `defineModule` and equal the registry the engine builds; every surface a module registers earns a refusal | `module-expressible`, `module-registration`, `module-boundary` |
| Every surface of the API is consumed | every field of `ModuleManifest`, `GrammarSpec`, `ArmSpec`, `ParamSpec`, `VocabularySpec` and `CheckSpec` is read somewhere, and every exported resolver is called outside `modules/` | `module-surface-consumed` |
| A module loads through the whole ladder | resolution from the bundle's `node_modules` or its declared `path`, the version range, the digest, the purity scan, the determinism fixture at every load, and then governance: its grammar parses, its arms fire, its severity ratchets, its findings route to its lane | `module-conformance` (which also carries the determinism cases: an impure module refused by file and line, a fixture that disagrees refused as `module-fixture-failed` and one that differs between its two runs as `module-nondeterministic` by `check`, `search` and `type show`, and the fixture run once per process for one digest), `module-path` (a kit declared by a bundle-relative path), `purity` (one probe per rule of the scan), `pack-install` (a locally packed tarball), `kit-code` (the shipped kit, from install to a subtype's tightening) |
| One judge at every write path | the same `judge` is called by the working tree, the staged gate, the stdin overlay, the write draft and the replay; a property test judges one fixture through every constructor and asserts agreement | `judge-property`, `judge`, `staged-gate`, `lint-verb`, `write-verb`, `relation-lifecycle` |
| Routing is total | every error or warning finding carries exactly one of `fix` and `queue`; every `info` carries neither; over every corpus and every emit path | `routing-xor`, `pass-table` (no unroutable row; every emitted `ruleId` has a row; every POLICY row names a real `engine.json` key; the lane set is closed) |
| Coverage is coherent | a pass reporting `evaluated: 0` never sits beside its own findings | `coverage-coherence` |
| The splice law | a write differs from its input only inside the lines its ops name; BOM, line ending and trailing newline survive; fuzzed on a fixed seed | `writer-fuzz`, `writer` |
| The Writer is the only writer | the set of modules that reach the filesystem, through `node:fs` or the staged replace, is closed, and no module but `writer.ts` writes a computed destination | `dry-run` |
| The dry-run law | `CommandSpec` is a union, so `writes: true` without a `plan` does not compile; `--dry-run` leaves the tree byte-identical and its path set equals the real delta; a dry run and a real run agree on every refusal | `dry-run` |
| Deterministic artifacts | build twice is byte-identical; sorts are code-unit over NFC; no locale, no clock, no Bun-only API in `packages/` outside the git transport (`stdoutfile.ts`) | `generate`, `manifest-additions`, `names-graph`, `gates` |
| The path law | a vault path names a file inside the vault: shape in core, containment in the shell, at every read and write | `path-law` (core and cli), `provenance-path` |
| Every declared key has a consumer | every top-level `engine.json` key names a reader that exists and has an end-to-end fixture marked `e2e:<key>`; every consumer entry names a declared key | `schema-walk`, `engine-config` |
| The engine spawns no child synchronously | every git read goes through the asynchronous transport, file-backed, at most four children at once, each under a timeout (`WIKIWRIGHT_GIT_TIMEOUT_MS`) that kills a child still running and refuses the verb as `git-timeout`, and none held past its exit by a process holding its stderr; no file the packages ship names a synchronous spawn; a test runs the CLI with its stdout on a file, and the pipe probes read the CLI's envelope and the binary's through a shell's pipe on purpose, a reader starting late, and hold it to the filed one, the probe itself proven to fail a CLI that exits with its envelope half written | `git-transport`, `git-timeout`, `git-short-read`, `no-sync-spawn`, `pipe-boundary` |
| The v2 law is one function of its bytes | the working tree and the index snapshot a bundle and its libraries into the same bytes, and `loadTypeLaw` reads nothing else; the law digest is byte-stable across loads and equal under both adapters, for a bundle at the top level and one in a subdirectory; every load-time code the contracts name is raised by a gardening fixture under `os.tmpdir()` | `law-libraries`, `law-types`, `law-shapes`, `law-digests` |
| A rule's iterations are bounded before it runs | a CEL rule is admitted by an AST walk or refused with the limit named; every comprehension ranges over a direct interface path under a declared bound, and a worst case over 200,000 comprehension iterations is refused at load; the data holds the bounds the worst case multiplies — a page over 200 sections, a section over 5,000 items, a frontmatter list or map over 1,000 members or over 10,000 distinct link targets is `page-too-large`, and a config list over 1,000, a vocabulary over 10,000 entries or a law over 10,000 types is refused at load; the work a built-in does inside one iteration (`in` over a list, `join`, `contains`) is not counted (`docs/roadmap.md`); `Intl` sits in the bundle only behind calls the profile refuses | `rules-profile`, `law-rules`, `law-interface` |
| One pinned runtime | `.bun-version` is the running Bun and every `engines.bun` pins it exactly; no tool, hook, workflow or test spawns `node`, and `docs/cli.md`'s verb block renders, and matches, with nothing on PATH; the compiled binary (`bun run binary`) answers `--help` and `check` byte for byte as `bun dist/main.js` does | `bun-pin`, `binary` |
| The shell has one clock | the verbs that stamp a date read `today()`; a test pins `WIKIWRIGHT_TODAY` and proves the pin reaches the page | `write-verb` |
| One code per meaning | every `fail(` in the CLI uses a kebab-case code mapped to exactly one exit type | `exit-taxonomy` |
| The command registry is the only surface | `--help`, `schema`, the brief and the parser render one table; every documented invocation in a shipped skill parses; every writer verb has a brief workflow slot and every slot names a verb; the playbook is byte-identical to its generator's output | `per-command-help`, `schema-walk`, `skills`, `skills-update`, `verbs`, `role-enforcement` |
| The starters are fixtures | the `code` starter's types over `devwiki`'s own vocabularies yield the error set devwiki's constitution yields; `init` on an empty directory is green on its first `check`, and a starter that declares modules is green once the envelope's named steps are run; every copy a test judges installs the kit from the shipped package under `os.tmpdir()`, never into the shipped tree | `starter-fixtures`, `fixture-verdicts`, `init`, `kit-code` |
| Identity is Unicode-aware | NFC and full case folding through one seam, with CJK cases; unique basenames, aliases and titles | `identity`, `names-graph` |
| Every vault envelope names its bundle | a verb that reads a vault's law adds `metadata.bundle` — label, real root, head, dirty, the law digest over the constitution, `engine.json` and each installed module, the content digest over every page's bytes — on an ok envelope and a refusal alike, and none to an envelope answered before the verb runs; over a copy, the export its marker names, with no head; the brief's header prints the same law digest | `bundle-identity` |
| A copy is a vault | an export is planned by one function behind `check --write`, `check`, the staged gate and `export`, and carries its resource closure — its pages, `config/` verbatim, the templates and examples the loader validates, each declared kit at its declared location, the files its pages embed — so every reader answers over a plain copy of it with nothing installed, under the identity its marker gives it; two renders are byte-identical, a rendered copy is held to a fresh render, and a copy never carries a symbolic link: the working tree is read through its links, so a kit installed as links travels as files under its source's law digest, and a link the index tracks is refused | `export-copy` (end to end), `export-plan`, `export-check`, `export-verb`, `generated-tracked`, `bundle-identity` |
| Discovery reads markers only | `--bundle` resolves a name by one `stat` per probed skill directory and one marker read per candidate, never a page and never a kit; identity is the marker's repository, bundle and name, one real path is one candidate and a copy with no repository is itself alone; `bundles list` prints the same scan with the marker's digests; nothing registers a bundle, and every marked root, however named, refuses a verb that can write | `discovery`, `bundles`, `copy-readonly` |
| Two bundles are told apart | from a directory that is no vault, two bundle skills found by name hold one page path with different guidance, and every answer carries the bundle that gave it and the page's digest; an installed copy refuses every write to it, a consumer session reads and is refused a write, and a child handed a section's address, while the page is unchanged, reads the same bytes under the same digest — an address names the current tree, not a revision, so a child compares the digest it reads with the one it was handed | `multi-bundle` (the scenario, end to end), `bundles`, `read-verb`, `bundle-identity` |

Two more properties are stated rather than tested, so a reader meets them:
the purity scan on a module narrows and does not sandbox (a byte scan cannot
see a name bound or built at runtime, and installing a module, not the scan,
is the consent to run it), and the artifact write loop is per-file atomic but
not batch-atomic (a crash mid-loop leaves a mix the next `check --write`
converges).

## How a verdict is produced

1. `main.ts` finds the verb in `COMMANDS`, applies `WIKIWRIGHT_ROLE`,
   intercepts `--help`, parses argv under the registry, resolves `--bundle` to
   an installed copy by scanning the skill directories, and preloads any modules `engine.json` declares for a
   verb that declares it reads the vault's law.
2. `vaultio.ts` loads `engine.json`, composes the module registry (the standard
   library plus the loaded packages), loads `constitution.json` through it, and
   refuses by name if anything did not load.
3. The verb builds a state with one of the four constructors in `state.ts`.
4. `judge(state, lawFor(vault))` parses every page, runs the per-page passes,
   the grammar arms through the loaded registry, the vault passes and the
   transition arms where a base exists, then routes, applies exceptions, the
   gate rule and the cap, and builds the coverage block.
5. The verb prints `verdictEnvelope(verdict)` and exits by `summary.errors`;
   `main.ts` adds `metadata.bundle`, the bundle it read, to the envelope of
   every verb that reads a vault's law.

`check` reads the content into one state and uses it for generation and
judging alike: `parsedPages` keeps each page's parse on the state beside the
text it came from, so the artifacts, the brief and the judge share one parse,
and the gate's drift pass, rename review and verdict share one parse of the
index. A staged transition reuses the current page's projection when the
normalized base bytes match, while still running the declared arms. Nothing
is retained between invocations.

A writing verb adds two steps between 3 and 5: it splices through `applyWrite`
and proves the result with a second `judge` over the spliced bytes before
`commitWrite` lands them temp-then-rename.

## The gate

The gate is `bun run check`: biome, `bun run build` (which removes each
package's `dist/`, then runs `tsc -b` and the build-info stamp, so no output
outlives its source), the test-project typecheck and the whole suite.
`tools/run-suite.ts` runs the suite as one `bun test` process per file, as
many at once as the machine has cores, because `bun test` runs its files one
after another and most of the suite's time is spent waiting on the CLI
processes the tests spawn; a run passes only when every file does. It gives
a test or a hook 20 seconds rather than Bun's 5, because a file's time under
that contention was measured at about 2.4 times its time alone. Every file
and the CLI the tests spawn run under Bun; a test reads the CLI's stdout from
a file (`packages/cli/test/fixtures/runtime.ts`).
`scripts/hooks/pre-commit` runs it locally; enable the hook once per clone:

```sh
git config core.hooksPath scripts/hooks
```

`.github/workflows/check.yml` runs the same command, under the Bun
`.bun-version` names, on every push and pull request, on Linux and on macOS.
What neither covers, so nobody assumes it does: Windows, and any Linux
distribution but the one the workflow provisions.
`sh scripts/release-matrix.sh` runs the gate, the Bun pin, a pack, a source
and build comparison and the corpus verdicts in one command and prints PASS or FAIL per arm; nothing
invokes it. Windows has no carrier in this repository and is unverified.

## Developing

- `bun install`, then `bun run build`. The executable is
  `packages/cli/dist/bin.js`, a Bun script that loads the engine,
  `packages/cli/dist/main.js`; `wikiwright version` reports the commit it was
  built from and whether the checkout was dirty, so a stale build is never
  mistaken for the checkout.
- `devwiki` is on the v2 law and imports `libraries/kit-code` by path (v2
  contracts §2), read from the tree with nothing installed.
  `check --root devwiki` has no error: its warnings are its pins, measured
  against this repository, and `check --write --root devwiki` regenerates
  `generated/`, the brief and the queue included. `freshness --root devwiki` measures every
  wiki page against this repository and holds its citations to the pin; `bun tools/uncovered.ts` lists the
  source directories no page covers.
- `bun run check` is the gate. `bun test ./packages/cli/test/write-verb.test.ts`
  runs one file; without the `./` the path is a substring filter.
- Work in a worktree per change (`git worktree add ../wt-<name> -b <branch>`).
  `.claude/` is ignored: an agent's local configuration, and any worktree it
  keeps there, must not nest a second `biome.json` under the root.
- Every test writes under `os.tmpdir()`, never in the repository. A test that
  spawns a verb that stamps a date sets `WIKIWRIGHT_TODAY`.
- Commits are one logical change with a typed prefix: `feat:`, `fix:`,
  `refactor:`, `test:`, `docs:`, `chore:`. The message body says why. Push only
  to `origin`.
- Generated files have one generator and are never hand-edited:
  `devwiki/generated/*`, the brief included (`wikiwright check --write --root
  devwiki`),
  `packages/cli/skills/wikiwright-maintain/lint-response.md`
  (`bun tools/render-playbook.ts`), `docs/cli.md`'s verb block
  (`bun docs/render-cli.ts --write`; the gate runs its `--check`), `packages/core/src/identity/casefold-data.ts`
  (`bun tools/generate-casefold.ts`).
- No private or personal data enters this repository; the fixtures are
  synthetic.
