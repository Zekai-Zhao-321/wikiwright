# Architecture

Two packages, TypeScript, built with Bun, running on Node 22.12 or later and on
Bun. `@wikiwright/core` is a pure library: functions over bytes, with no Node
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
packages/cli/src/
  main.ts      dispatch, the role bound, --help, the module preload, one stderr writer
  commands.ts  the COMMANDS array and nothing else
  spec.ts      CommandSpec, FlagSpec, Plan, ROLE_RANK, DRY_RUN_FLAG
  brief.ts     the brief's renderer, below every verb that renders one
  argv.ts      the parser built from the registry
  envelope.ts  ok, fail, EXIT, verdictEnvelope, capOptions
  clock.ts     today(): WIKIWRIGHT_TODAY or the wall clock, read once
  state.ts     fsState, indexState, overlayState, revisionState
  vaultio.ts   the page walk, the loader, its refusals
  law.ts       the loaded vault to a Law; the engine.json consumers
  writer.ts    the shell half of the Writer: prove, then temp-and-rename
  atomicwrite.ts   the one staged replace every non-page write lands through
  moduleload.ts, modulefixture.ts, trust.ts   the module ladder
  hooks.ts, staged.ts   the installed hooks and the staged gate
  verbs/<name>.ts   one CommandSpec per verb
packages/cli/constitutions/   the base and code starters init scaffolds; code is a bundle over the kit
packages/cli/skills/          the two shipped skills and the generated playbook
packages/kit-code/            @wikiwright/kit-code: the code wiki's types, anchored fragment, labels, templates, skills
devwiki/                      this repository's own bundle, over the kit, judged by the suite
fixtures/conformance/         the neutral module fixture and two bundles consuming it
fixtures/memory-synth/        a synthesized personal-memory vault (41 pages, claims and categories)
fixtures/minimal-vault/       the smallest bundle that loads
fixtures/okf-upstream/        the OKF pin: repository, commit, grounding line
tools/                        write-build-info, render-playbook, generate-casefold, uncovered
scripts/hooks/pre-commit      the development gate
docs/                         this documentation; render-cli.ts renders docs/cli.md's verb block
```

## The invariants, and the tests that hold them

Each invariant is a property of the engine, named with the test that fails
by name when it breaks. Test files live under `packages/core/test` and
`packages/cli/test`.

| Invariant | What it means | Held by |
|---|---|---|
| Typed | one nominal type per page; shapes and section grammars are data in the constitution; the engine never calls a model | `registry-v3`, `registry`, `field-schemas`, `shapes`, `sections`, `grammar-arms`, `grammar-v3-arms`, `grammar-parser` |
| OKF-compatible | the vault is a valid OKF bundle without an export step; `okf check` stays green on every corpus | `okf` |
| Four layers | the kernel imports nothing from `stdlib/`, type-only imports included; no first-party module imports another's implementation | `kernel-import-boundary` |
| The modules import in one direction | no package's `src/` holds a runtime import cycle, however many steps around; a type-only import is erased and is not an edge | `import-graph` |
| One registration API | the three standard-library modules load through `defineModule` and equal the registry the engine builds; every surface a module registers earns a refusal | `module-expressible`, `module-registration`, `module-boundary` |
| Every surface of the API is consumed | every field of `ModuleManifest`, `GrammarSpec`, `ArmSpec`, `ParamSpec`, `VocabularySpec` and `CheckSpec` is read somewhere, and every exported resolver is called outside `modules/` | `module-surface-consumed` |
| A module loads through the whole ladder | resolution from the bundle's `node_modules`, the version range, purity, the grant, the fixture, and then governance: its grammar parses, its arms fire, its severity ratchets, its findings route to its lane | `module-conformance` (which also carries the determinism cases: an impure module refused by file and line, an edited fixture refused as `module-fixture-failed`), `pack-install` (a locally packed tarball), `kit-code` (the shipped kit, from install to a subtype's tightening) |
| One judge at every write path | the same `judge` is called by the working tree, the staged gate, the stdin overlay, the write draft and the replay; a property test judges one fixture through every constructor and asserts agreement | `judge-property`, `judge`, `staged-gate`, `lint-verb`, `write-verb`, `relation-lifecycle` |
| Routing is total | every error or warning finding carries exactly one of `fix` and `queue`; every `info` carries neither; over every corpus and every emit path | `routing-xor`, `pass-table` (no unroutable row; every emitted `ruleId` has a row; every POLICY row names a real `engine.json` key; the lane set is closed) |
| Coverage is coherent | a pass reporting `evaluated: 0` never sits beside its own findings | `coverage-coherence` |
| The splice law | a write differs from its input only inside the lines its ops name; BOM, line ending and trailing newline survive; fuzzed on a fixed seed | `writer-fuzz`, `writer` |
| The Writer is the only writer | the set of modules that reach the filesystem, through `node:fs` or the staged replace, is closed, and no module but `writer.ts` writes a computed destination | `dry-run` |
| The dry-run law | `CommandSpec` is a union, so `writes: true` without a `plan` does not compile; `--dry-run` leaves the tree byte-identical and its path set equals the real delta; a dry run and a real run agree on every refusal | `dry-run` |
| Deterministic artifacts | build twice is byte-identical; sorts are code-unit over NFC; no locale, no clock, no Bun-only API in `packages/` | `generate`, `manifest-additions`, `names-graph`, `gates` |
| The path law | a vault path names a file inside the vault: shape in core, containment in the shell, at every read and write | `path-law` (core and cli), `provenance-path` |
| Every declared key has a consumer | every top-level `engine.json` key names a reader that exists and has an end-to-end fixture marked `e2e:<key>`; every consumer entry names a declared key | `schema-walk`, `engine-config` |
| The shell has one clock | the verbs that stamp a date read `today()`; a test pins `WIKIWRIGHT_TODAY` and proves the pin reaches the page | `write-verb` |
| One code per meaning | every `fail(` in the CLI uses a kebab-case code mapped to exactly one exit type | `exit-taxonomy` |
| The command registry is the only surface | `--help`, `schema`, the brief and the parser render one table; every documented invocation in a shipped skill parses; every writer verb has a brief workflow slot and every slot names a verb; the playbook is byte-identical to its generator's output | `per-command-help`, `schema-walk`, `skills`, `skills-update`, `verbs`, `role-enforcement` |
| The starters are fixtures | the `code` starter's types over `devwiki`'s own vocabularies yield the error set devwiki's constitution yields; `init` on an empty directory is green on its first `check`, and a starter that declares modules is green once the envelope's named steps are run; every copy a test judges installs the kit from the shipped package and grants it in a store the test owns, never the developer's | `starter-fixtures`, `fixture-verdicts`, `init`, `kit-code` |
| Identity is Unicode-aware | NFC and full case folding through one seam, with CJK cases; unique basenames, aliases and titles | `identity`, `names-graph` |

Two more properties are stated rather than tested, so a reader meets them:
the purity scan on a module narrows and does not sandbox (a byte scan cannot
see a name built at runtime), and the artifact write loop is per-file atomic but
not batch-atomic (a crash mid-loop leaves a mix the next `check --write`
converges).

## How a verdict is produced

1. `main.ts` finds the verb in `COMMANDS`, applies `WIKIWRIGHT_ROLE`,
   intercepts `--help`, preloads any modules `engine.json` declares for a verb
   that declares it reads the vault's law, and parses argv under the registry.
2. `vaultio.ts` loads `engine.json`, composes the module registry (the standard
   library plus the loaded packages), loads `constitution.json` through it, and
   refuses by name if anything did not load.
3. The verb builds a state with one of the four constructors in `state.ts`.
4. `judge(state, lawFor(vault))` parses every page, runs the per-page passes,
   the grammar arms through the loaded registry, the vault passes and the
   transition arms where a base exists, then routes, applies exceptions, the
   gate rule and the cap, and builds the coverage block.
5. The verb prints `verdictEnvelope(verdict)` and exits by `summary.errors`.

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

The gate is `bun run check`: biome, `bun run build` (which is `tsc -b` plus
the build-info stamp), the test-project typecheck and the whole suite.
`tools/run-suite.ts` runs the suite as one `bun test` process per file, as
many at once as the machine has cores, because `bun test` runs its files one
after another and most of the suite's time is spent waiting on the CLI
processes the tests spawn; a run passes only when every file does. It gives
a test or a hook 20 seconds rather than Bun's 5, because a file's time under
that contention was measured at about 2.4 times its time alone.
`scripts/hooks/pre-commit` runs it locally; enable the hook once per clone:

```sh
git config core.hooksPath scripts/hooks
```

`.github/workflows/check.yml` runs the same command, and then the node
runner, on every push and pull request, on Linux and on macOS. What neither
covers, so nobody assumes it does: Windows, and any Linux distribution but
the one the workflow provisions. The node runner by hand is:

```sh
bun run test:node
```

which is `node --test "packages/core/test/*.test.ts" "packages/cli/test/*.test.ts"`.
`sh scripts/release-matrix.sh` runs the gate, the node runner, a pack and the
corpus verdicts in one command and prints PASS or FAIL per arm; nothing
invokes it. Windows has no carrier in this repository and is unverified.

## Developing

- `bun install`, then `bun run build`. The executable is
  `packages/cli/dist/bin.js`, which switches on Node's compile cache and loads
  the engine, `packages/cli/dist/main.js`; `wikiwright version` reports the commit it was
  built from and whether the checkout was dirty, so a stale build is never
  mistaken for the checkout.
- `devwiki` is a bundle over `@wikiwright/kit-code`, which `bun install` links
  into `devwiki/node_modules`. Before `check --root devwiki` judges anything
  on a fresh clone, a maintainer grants the kit once on this machine:
  `wikiwright trust grant module:@wikiwright/kit-code --root devwiki`, with
  `--scope worktrees` to cover every linked worktree of this clone. The
  suite never reads that grant. After it, `check --root devwiki` has zero
  findings of any severity: the brief is tracked with the artifacts, and
  `check --write --root devwiki` regenerates all four. `freshness --root devwiki` measures every
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
  devwiki`, under the grant above),
  `packages/cli/skills/wikiwright-maintain/lint-response.md`
  (`bun tools/render-playbook.ts`), `docs/cli.md`'s verb block
  (`bun docs/render-cli.ts --write`), `packages/core/src/identity/casefold-data.ts`
  (`bun tools/generate-casefold.ts`).
- No private or personal data enters this repository; the fixtures are
  synthetic.
