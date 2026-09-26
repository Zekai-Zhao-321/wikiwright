# Architecture

Two packages, TypeScript, built, tested and run with Bun only, the version
`.bun-version` pins. `@wikiwright/core` is a pure library: functions over bytes, with no Node
typings in its tsconfig, so a filesystem call does not typecheck there. The
`wikiwright` package is the shell: argv, envelopes, exit codes, the filesystem,
git, and one module per verb. The type libraries under `libraries/` are
data — type, fragment and vocabulary documents — that a bundle imports by
path; no package of code serves a domain.

## Directories

```text
packages/core/src/
  identity/    normalizeIdentity (NFC + full case fold, vendored table), codeUnitCompare
  parse/       ParsedDoc: frontmatter, headings, wikilinks, the line map
  names/       NamedPage and basenameOf, what search reads a page as
  writer/      applyWrite: five splice ops, byte-level
  search/      the tokenizer, BM25, the identity ladder, RRF fusion, name:near
  fields/      title and description derivation
  gitplan/     pure parsers for git plumbing output
  hash/        sha256
  paths/       the path law: pathRefusal, isContentPath
  prefixes/    the commit-prefix verdict
  version/     the engine range grammar
  law/         v2: engine.json v4, libraries, the type, fragment and vocabulary documents, their composition, the skeleton
  schema/      v2: the one Ajv 2020 factory (strict, RE2 patterns, three formats, the engine keywords), the reserved keys, the effective shapes
  records/     v2: the fixed grammar's three records and their JSON Schemas
  interface/   v2: a page read from its bytes, and the page interface a rule is bound to
  rules/       v2: the CEL profile, its static bound, rule evaluation
  digest/      v2: the bytes, content, page and law digests
  verdict/     v2: judgeTypeLaw(state, law), its table of codes and routes, the grammar checks, the kernel transitions, the folder tags, CEL evaluation, exceptions, rule tests and examples, the law diff
  artifacts/   v2: graph.json, manifest.json, tag-catalog.md and queue.md of a state under its law
packages/cli/src/
  main.ts      dispatch to the command table, --help and --help --json, the envelope's bound and --out, one stderr writer
  commands.ts  the command table, COMMANDS, and nothing else
  spec.ts      CommandSpec, FlagSpec, Plan, DRY_RUN_FLAG
  argv.ts      the parser built from the registry
  envelope.ts  ok, fail, EXIT, capOptions and the JSON output bound
  clock.ts     today(): WIKIWRIGHT_TODAY or the wall clock, read once
  git.ts, stdoutfile.ts   the git plumbing: every git child spawned asynchronously (Bun.spawn), at most four at a time, awaited to its exit, its answer read from a file it writes itself
  vaultfiles.ts   the page-byte reader; lawfiles.ts owns law snapshots and lawstate.ts walks content
  lawfiles.ts  v2: the working-tree, index and revision adapters that snapshot a bundle's law and its libraries for law/
  lawstate.ts  v2: the four states judgeTypeLaw is handed (working tree, drafts over the disk, the index over HEAD, a revision)
  writer.ts    landBatch: stage every page, then rename and remove moved-from paths
  atomicwrite.ts   the one staged replace every non-page write lands through
  verbs/<name>.ts   one CommandSpec per verb of the command table, over the type-document law
  typelaw.ts   v2: the law a state carries loaded or refused, the engine range, the bundle block
  generated.ts v2: generated/ — the brief and the kernel's four files, rendered, compared and written
  pins.ts      v2: every pin measured against the local repository, and the stale sources a page links
docs/skills/                  the three skill documents (consume, write, maintain) and the generated playbook
libraries/kit-code/           the code wiki's type library of the v2 law, id code: the page kinds, anchored, the relation labels, their rule tests and examples
libraries/kit-garden/         the neutral test library of the v2 law, id garden: documents, rule tests, examples; the allotment handbook imports it
devwiki/                      this repository's own bundle, on the v2 law, importing libraries/kit-code, judged by the suite
fixtures/handbooks/           two small gardening handbooks on the v2 law, one page title in both, each with a rule of its own
fixtures/memory-synth/        a synthesized personal-memory vault (41 pages, claims and categories), on the v2 law
fixtures/minimal-vault/       the smallest bundle that loads, on the v2 law
fixtures/okf-upstream/        the OKF pin: repository, commit, grounding line
tools/                        write-build-info, build-binary, migrate-spellings, render-playbook, dispositions, generate-casefold, uncovered, run-suite, benchmark-check
test/                         built-CLI probes, the binary and the synthetic v2 episode
scripts/hooks/pre-commit      the development gate
docs/                         this documentation; render-cli.ts renders docs/cli.md's verb block
```

## The invariants, and the tests that hold them

Each invariant is a property of the engine, named with the test that fails
by name when it breaks. Test files live under `packages/core/test`,
`packages/cli/test` and `test/`.

| Invariant | What it means | Held by |
|---|---|---|
| Typed | one nominal type per page; shapes, sections and rules are data in type documents; the engine never calls a model | `law-types`, `law-shapes`, `law-rules`, `law-libraries`, `records`, `rules-profile` |
| OKF-compatible | the vault is a valid OKF bundle without an export step: `check` reports a page with no non-empty `type` as `okf-missing-type` on every corpus | `check-verb`, `routing-xor` |
| Three layers, all law is data | a library is type, fragment and vocabulary documents with rule tests and examples, loaded by path and qualified by its id; a bundle's documents may extend a library's; no layer ships code | `law-libraries`, `libraries` |
| Packages import in one direction | no package's `src/` holds a runtime import cycle, however many steps around; a type-only import is erased and is not an edge | `import-graph` |
| One judge at every write path | the same `judgeTypeLaw` is called by the working tree, the drafts over the disk, the index over HEAD and a revision; a property test judges one fixture through every constructor and asserts agreement, `unevaluated` counted as its own verdict | `judge-law-property`, `judge-states`, `judge-core`, `gate-verb` (the gate refuses what `write` refuses), `write-batch` |
| Routing is total | every error or warning finding carries exactly one of `fix` and `queue`; every `info` carries neither; over every corpus and every emit path | `routing-xor`, `verdict-table` (no unroutable row) |
| Coverage is coherent | a pass reporting `evaluated: 0` never sits beside its own findings | `coverage-coherence` |
| The splice law | a write differs from its input only inside the lines its ops name; BOM, line ending and trailing newline survive; fuzzed on a fixed seed | `writer-fuzz`, `writer` |
| The Writer is the only writer | the set of modules that reach the filesystem, through `node:fs` or the staged replace, is closed, and no module but `writer.ts` writes a computed destination | `dry-run` |
| The dry-run law | `CommandSpec` is a union, so `writes: true` without a `plan` does not compile; `--dry-run` leaves the tree byte-identical and its path set equals the real delta; a dry run and a real run agree on every refusal | `dry-run` |
| Deterministic artifacts | build twice is byte-identical; sorts are code-unit over NFC; no locale, no clock, no Bun-only API in `packages/` outside the git transport (`stdoutfile.ts`) | `generated-tracked`, `check-verb` (the same bytes wherever the bundle sits), `gates` |
| The path law | a bundle path names a file inside the bundle: shape in core, containment in the shell, at every read and write | `path-law` (core and cli) |
| Every declared key has a consumer | every `engine.json` key of schema version 4 names a reader and has an end-to-end fixture marked `e2e:<key>` | `law-libraries`, `engine-v4-e2e`, `commit-prefixes` |
| The engine spawns no child synchronously | every git read goes through the asynchronous transport, file-backed, at most four children at once, each under a timeout (`WIKIWRIGHT_GIT_TIMEOUT_MS`) that kills a child still running and refuses the verb as `git-timeout`, and none held past its exit by a process holding its stderr; no file the packages ship names a synchronous spawn; a test runs the CLI with its stdout on a file, and the pipe probes read the CLI's envelope and the binary's through a shell's pipe on purpose, a reader starting late, and hold it to the filed one, the probe itself proven to fail a CLI that exits with its envelope half written | `git-transport`, `git-timeout`, `git-short-read`, `no-sync-spawn`, `pipe-boundary` |
| The v2 law is one function of its bytes | the working tree and the index snapshot a bundle and its libraries into the same bytes, and `loadTypeLaw` reads nothing else; the law digest is byte-stable across loads and equal under both adapters, for a bundle at the top level and one in a subdirectory; every load-time code the contracts name is raised by a gardening fixture under `os.tmpdir()` | `law-libraries`, `law-types`, `law-shapes`, `law-digests` |
| A rule's iterations are bounded before it runs | a CEL rule is admitted by an AST walk or refused with the limit named; every comprehension ranges over a direct interface path under a declared bound, and a worst case over 200,000 comprehension iterations is refused at load; the data holds the bounds the worst case multiplies — a page over 200 sections, a section over 5,000 items, a frontmatter list or map over 1,000 members or over 10,000 distinct link targets is `page-too-large`, and a config list over 1,000, a vocabulary over 10,000 entries or a law over 10,000 types is refused at load; the work a built-in does inside one iteration (`in` over a list, `join`, `contains`) is not counted (`docs/roadmap.md`); `Intl` sits in the bundle only behind calls the profile refuses | `rules-profile`, `law-rules`, `law-interface` |
| One pinned runtime | `.bun-version` is the running Bun and every `engines.bun` pins it exactly; no tool, hook, workflow or test spawns `node`, and `docs/cli.md`'s verb block renders, and matches, with nothing on PATH; the compiled binary (`bun run binary`) answers `--help` and `check` byte for byte as `bun dist/main.js` does | `bun-pin`, `binary` |
| The shell has one clock | the verbs that stamp a date read `today()`; a test pins `WIKIWRIGHT_TODAY` and proves the pin reaches the page | `write-batch` |
| One code per meaning | every `fail(` in the CLI uses a kebab-case code mapped to exactly one exit type | `exit-taxonomy` |
| The command registry is the only surface | `--help`, `--help --json`, the brief and the parser render one table; every example a verb documents parses; the playbook is byte-identical to its generator's output | `command-table`, `per-command-help`, `envelope-bounds`, `verbs`, `skills` |
| The corpora are fixtures | every corpus judges to the verdict recorded for it under `check` and under the gate, its tracked `generated/` is what this build renders, and every library holds on its own | `fixture-verdicts`, `generated-tracked`, `libraries` |
| Identity is Unicode-aware | NFC and full case folding through one seam, with CJK cases; unique basenames, aliases and titles | `identity`, `judge-core` |
| Every bundle envelope names its bundle | a verb that reads a bundle's law adds `metadata.bundle` — engine.json's label, the real root, head, dirty, the law digest, the content digest over the pages it read — on an ok envelope and a refusal alike, and none to an envelope answered before the verb runs or to `version`; the generated brief's header prints the same law digest | `bundle-identity`, `check-verb`, `law-digests` |

### Disposition of the v1 invariants

The old invariant table named mechanisms that left with the old registry.
Each row below records what now holds it, or where its loss is stated.

| V1 invariant | V2 disposition |
|---|---|
| Typed; OKF-compatible | Retained over type documents; `law-types`, `check-verb`, `routing-xor` |
| Four layers | Replaced by kernel, data library, bundle; `law-libraries`, `libraries` |
| Modules import in one direction | The acyclic package boundary remains; `import-graph` |
| One registration API | Removed with executable modules; see `docs/roadmap.md` §A bundle runs no code of its own |
| Every surface of the module API is consumed | Removed with that API; the v4 engine key invariant replaces its config guarantee; `law-libraries`, `engine-v4-e2e` |
| A module loads through the whole ladder | Removed with resolution, purity scan and fixture; see `CHANGELOG.md` §Removed and `docs/roadmap.md` §A bundle runs no code of its own |
| One judge at every write path | Retained as `judgeTypeLaw` over four states; `judge-law-property`, `judge-states`, `gate-verb`, `write-batch` |
| Routing is total; coverage is coherent | Retained; `routing-xor`, `verdict-table`, `coverage-coherence` |
| The splice law; the Writer is the only writer; the dry-run law | Retained; `writer-fuzz`, `writer`, `dry-run`, `write-batch` |
| Deterministic artifacts; the path law | Retained for the v2 generators and four states; `generated-tracked`, `gates`, `path-law` |
| Every declared key has a consumer | Retained for engine.json v4, with one CLI fixture per key; `law-libraries`, `engine-v4-e2e`, `commit-prefixes` |
| The shell has one clock; one code per meaning | Retained; `write-batch`, `exit-taxonomy` |
| The command registry is the only surface | Retained over eight verbs; `command-table`, `per-command-help`, `skills` |
| The starters are fixtures | Starter and `init` removed; `minimal-vault` is the smallest loading example, and `fixture-verdicts` holds the corpora |
| Identity is Unicode-aware | Retained; `identity`, `judge-core` |
| Every vault envelope names its bundle | Retained with label, real root and digests; the export block left; `bundle-identity` |
| A copy is a vault | Removed with exports and the copy marker; see `docs/roadmap.md` §No exports |
| Discovery reads markers only | Removed with bundle-skill discovery; see `docs/roadmap.md` §No bundle is found by name |
| Two bundles are told apart | Bundle identity remains in envelopes; discovery, copy write refusal and role gating left; `bundle-identity`, `read-search-status` and the roadmap name the loss |

One more property is stated rather than tested, so a reader meets it: the
artifact write loop is per-file atomic but not batch-atomic (a crash mid-loop
leaves a mix the next `check --write` converges).

## How a verdict is produced

1. `main.ts` finds the verb in `COMMANDS`, intercepts `--help` and
   `--help --json`, and parses argv under the registry.
2. The verb builds a state with one of the four constructors in
   `lawstate.ts` — the working tree, drafts over the disk, the index over
   HEAD, a revision — each reading the law's files from the same place as
   its pages (`lawfiles.ts`). A root that is no directory, or a state with no
   `config/engine.json`, is `bundle-not-found`.
3. `lawOf` loads the law the state carries (`loadTypeLaw`: engine.json, the
   libraries, the type, fragment and vocabulary documents, the shapes, the
   rules) or refuses it as `constitution-invalid` with its issues, and
   nothing is judged.
4. `judgeTypeLaw(state, law)` reads every page into the page interface,
   checks shapes, sections and the grammar's records, evaluates the CEL
   rules, runs the kernel transitions where the state has a base, runs the
   rule tests and examples, then routes every finding through the verdict
   table and builds the coverage block.
5. The verb prints its envelope and exits by `summary.errors`, with
   `metadata.bundle` computed from the state it read (`typelaw.ts`).

A writing verb (`write`, `check --write`, `check --fix`) judges the state it
would leave before it lands anything: `write` lands the batch through
`landBatch`, and `check` renders `generated/` through the staged replace.

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
  `generated/`, the brief and the queue included; the same `check` holds
  every page's citations to its pin. `bun tools/uncovered.ts` lists the
  source directories no page covers.
- `bun run check` is the gate. `bun test ./packages/cli/test/write-batch.test.ts`
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
  `docs/skills/wikiwright-maintain/finding-response.md`
  (`bun tools/render-playbook.ts`), `docs/cli.md`'s verb block
  (`bun docs/render-cli.ts --write`; the gate runs its `--check`), `packages/core/src/identity/casefold-data.ts`
  (`bun tools/generate-casefold.ts`).
- No private or personal data enters this repository; the fixtures are
  synthetic.
