# Contributing

wikiwright is a typed wiki engine for LLM agents; `README.md` says what it
is and `docs/architecture.md` how it is built. This page is the mechanics of
working on it: the setup, the gate, the conventions a change is held to,
and how to send one.

## Setup from a fresh clone

The engine runs on Bun only: the version in `.bun-version` (1.3.11), which
every `engines.bun` pins exactly, builds it, tests it and runs it.

```sh
git clone https://github.com/Zekai-Zhao-321/wikiwright
cd wikiwright
bun install
bun run build
bun packages/cli/dist/bin.js version
```

The executable is `packages/cli/dist/bin.js`, a Bun script that loads
`packages/cli/dist/main.js`, the engine, which the suite runs directly; `version` reports the commit it
was built from and whether the checkout was dirty, so a stale build is never
mistaken for the checkout. The installed pre-commit hook of a bundle looks
for `wikiwright` on PATH, so put a one-line launcher there if you want it:

```sh
printf '#!/bin/sh\nexec bun /path/to/wikiwright/packages/cli/dist/bin.js "$@"\n' > ~/.local/bin/wikiwright
chmod +x ~/.local/bin/wikiwright
```

`bun install` links `@wikiwright/kit-code` into `devwiki/node_modules`, and
that is all `check --root devwiki` needs: the kit loads from there, and every
load proves it — its purity scan and its determinism fixture run before it
judges anything (`docs/extending.md` §Loading a module). Until the install,
`check` refuses `module-unresolved`, and the hint names the install. Every
test judges a copy under `os.tmpdir()` that installs the kit from the shipped
package; the shipped tree is never installed into from a test.

## The gate

`bun run check` is the gate: biome, `bun run build` (each package's `dist/`
removed, then `tsc -b` and the build-info stamp), the test-project typecheck and the whole suite, which
`tools/run-suite.ts` runs as one `bun test` process per file, as many at
once as the machine has cores. Under it a test or a hook has 20 seconds
rather than Bun's 5, because the files contend for the machine; a file run
alone with `bun test ./<file>` keeps 5.
`scripts/hooks/pre-commit` runs it before every commit once you enable it,
once per clone:

```sh
git config core.hooksPath scripts/hooks
```

The hook covers the machine that commits. The workflow under
`.github/workflows/check.yml` runs the same command, under the Bun
`.bun-version` names, on every push and pull request on Linux and macOS.
Before a release, run the release matrix by hand:

```sh
sh scripts/release-matrix.sh
```

The matrix runs the gate, checks that the running Bun is the pinned one,
packs both packages, compares the source's and the build's verdict over one
corpus, builds from nothing and checks the corpus verdicts, and prints PASS
or FAIL per arm. Windows is unverified; `docs/roadmap.md` says so and lists what
else is not covered.

## Tests

- `bun run test` runs the suite after a build, through `tools/run-suite.ts`;
  `bun test ./packages/cli/test/write-verb.test.ts` runs one file. Keep the
  `./`: to `bun test` a bare path is a substring filter, and
  `packages/cli/test/staged-gate` also runs `staged-gate-reads`. A plain
  `bun test` still runs every file, one after another, in one process.
  `tools/run-suite.ts` is a bridge, deleted the day `bun test --parallel`
  is proven on this suite.
- A test runs the CLI with `runCli` from
  `packages/cli/test/fixtures/runtime.ts`: under the Bun running the test,
  with the CLI's stdout on a file the test created and read back from it,
  never through a pipe. Under load Bun's synchronous spawn has cut a child's
  piped output short (`docs/roadmap.md`). A new test file uses `bun:test`.
- Every test writes under `os.tmpdir()`, never in the repository. The
  packed-install test installs under a package cache of its own there, so
  every run fetches the packed core's dependencies from the registry: the
  gate needs the network for that one test, as a fresh clone's
  `bun install` does.
- A test that spawns a verb that stamps a date (`write`, `new`) sets
  `WIKIWRIGHT_TODAY`, or the stamp moves with the day.
- Bun's per-test budget is five seconds. A case that installs a kit and
  drives a dozen verbs exceeds it: build the bundle in `before` and keep one
  `it` per verb, or state `{ timeout }` on a deliberately sequential walk.
- `packages/core` is a pure library with no Node typings in its tsconfig, so
  a filesystem call does not typecheck there; the shell is `packages/cli`.
- The corpora are fixtures. A change to `devwiki`'s pages or
  constitution is judged by `starter-fixtures` (under the `code` starter's
  types merged with devwiki's own vocabularies, the error set must equal
  devwiki's own — a concrete type devwiki adds must exist in the starter,
  while a tag or a label is devwiki's to register), `routing-xor` (its
  `lint` must be clean) and `generated-tracked` (its `generated/` must be
  what this build renders). The two handbooks under `fixtures/handbooks`
  are held at zero findings of any severity under `check` by
  `fixture-verdicts`, their tracked `generated/` and their rendered exports
  under `skills/` by `generated-tracked`, the two-bundle scenario over
  them by `multi-bundle`, and a copy of their exports, installed as a host
  installs it, by `export-copy`.

## Measuring command performance

After `bun run build`, run `bun tools/benchmark-check.ts` for 1,000, 5,000
and 10,000 synthetic pages, three fresh processes per command (`check`,
`check --write`, `lint --staged`). The first two positional arguments
override the comma-separated page counts and the repetition count:

```sh
bun tools/benchmark-check.ts 1000,5000 3
```

An optional third argument names a separately built baseline CLI. The runner
alternates the two builds and requires byte-identical envelopes and generated
files before reporting their timings. Corpus creation and initial artifact
generation are outside the measured interval. Every process starts fresh;
the operating system's filesystem cache is not flushed. All temporary vaults
are removed when the run finishes.

## Generated files have one generator each

Never hand-edit these; regenerate them and stage the result beside the
change that moved it (the gate judges drift over the staged state, so one
logical change is one commit).

| File | Generator |
|---|---|
| `devwiki/generated/*`, the brief included | `wikiwright check --write --root devwiki`, after the install above |
| `fixtures/handbooks/*/generated/*`, the briefs included, and `fixtures/handbooks/*/skills/*`, the rendered exports | `wikiwright check --write --root fixtures/handbooks/orchard`, and the same for `allotment` |
| `packages/cli/skills/wikiwright-maintain/lint-response.md` | `bun tools/render-playbook.ts` (`--check` verifies) |
| the verb block of `docs/cli.md` | `bun docs/render-cli.ts --write` (`--check` verifies) |
| `packages/core/src/identity/casefold-data.ts` | `bun tools/generate-casefold.ts` |

`freshness --root devwiki` measures every devwiki page against this
repository and holds its citations to the pin; `bun tools/uncovered.ts`
lists the source directories no page covers. devwiki's pins name this
repository's commits, so a copy of the tree with fresh history makes
`freshness --root devwiki` report every pin `unknown`; the repair is to
re-read the covered paths at the copy's first commit and re-pin
(`docs/roadmap.md`, "Copying the tree without its history").

## Commits

- One logical change per commit, with a typed prefix: `feat:`, `fix:`,
  `refactor:`, `test:`, `docs:`, `chore:`. The message body says why.
- Literal names only: `lint` means lint. No metaphor in a verb, a config
  key, a rule id or an error code.
- Describe what exists. A document, a help string or a skill line names
  behaviour the binary has; when unsure, run the binary and quote the
  envelope.
- State the loss. When a mechanism is removed, deferred or unverified,
  write it where a reader will meet it. Green that hides a gap is worse
  than red.
- Keep the invariants in `AGENTS.md`, and the test that holds each
  (`docs/architecture.md` names them).

## No private data

Nothing private or personal enters this repository: not as a fixture, not
as an example, not in a commit message. The fixtures are synthetic
(`fixtures/memory-synth/README.md` says how), and an example in the
documentation is invented or drawn from this repository's own `devwiki`.

## Sending a pull request

1. Branch from `main`; work in a worktree per change if you like
   (`git worktree add ../wt-<name> -b <branch>`).
2. Keep the gate green after every commit, regenerate what your change
   moved.
3. Open the pull request against `main` with the why in its description:
   what was wrong or missing, what the change does about it, and what it
   does not do. A change that adds a key, a verb or a finding names its
   consumer, its test and its documentation.
4. Semantic conflicts — two changes that both pass and mean different
   things — are resolved by a maintainer, never auto-merged.
