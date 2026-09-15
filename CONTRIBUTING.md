# Contributing

wikiwright is a typed wiki engine for LLM agents; `README.md` says what it
is and `docs/architecture.md` how it is built. This page is the mechanics of
working on it: the setup, the gate, the conventions a change is held to,
and how to send one.

## Setup from a fresh clone

Bun 1.3.11 or later builds and tests the engine; Node 22.12 or later runs
the shipped binary, and the node runner proves that it does.

```sh
git clone https://github.com/Zekai-Zhao-321/wikiwright
cd wikiwright
bun install
bun run build
node packages/cli/dist/bin.js version
```

The executable is `packages/cli/dist/bin.js`, which switches on Node's
compile cache and loads `packages/cli/dist/main.js`, the engine, which the
suite runs directly; `version` reports the commit it
was built from and whether the checkout was dirty, so a stale build is never
mistaken for the checkout. The installed pre-commit hook of a bundle looks
for `wikiwright` on PATH, so put a one-line launcher there if you want it:

```sh
printf '#!/bin/sh\nexec node /path/to/wikiwright/packages/cli/dist/bin.js "$@"\n' > ~/.local/bin/wikiwright
chmod +x ~/.local/bin/wikiwright
```

`bun install` links `@wikiwright/kit-code` into `devwiki/node_modules`.
Before `check --root devwiki` judges anything, a maintainer grants the kit
once on this machine, after reading it. `--scope worktrees` covers `devwiki`
in every linked worktree of this clone, existing and future, which suits a
workflow that opens a worktree per session; without it the grant covers this
checkout's `devwiki` alone:

```sh
node packages/cli/dist/main.js trust grant module:@wikiwright/kit-code --root devwiki --scope worktrees
```

An agent must not grant trust to unblock its own work; see AGENTS.md.

Until the install, `check` refuses `module-unresolved`; until the grant,
`module-untrusted`; each hint names the step. The grant is this machine's,
per vault path, and the suite never reads it — every test judges a copy under
`os.tmpdir()` that installs the kit from the shipped package and grants it in
its own store. Editing any byte of the kit revokes the grant; re-grant after
reading the diff.

## The gate

`bun run check` is the gate: biome, `bun run build` (`tsc -b` plus the
build-info stamp), the test-project typecheck and the whole suite, which
`tools/run-suite.ts` runs as one `bun test` process per file, as many at
once as the machine has cores. Under it a test or a hook has 20 seconds
rather than Bun's 5, because the files contend for the machine; a file run
alone with `bun test ./<file>` keeps 5.
`scripts/hooks/pre-commit` runs it before every commit once you enable it,
once per clone:

```sh
git config core.hooksPath scripts/hooks
```

The hook covers the machine that commits, under Bun. The workflow under
`.github/workflows/check.yml` runs the same command, then the node runner,
on every push and pull request on Linux and macOS. Before a release, run
the node runner and the release matrix by hand:

```sh
bun run test:node
sh scripts/release-matrix.sh
```

The matrix runs the gate, the node runner, a pack of both packages, a
cross-runtime determinism check and the corpus verdicts, and prints PASS or
FAIL per arm. Windows is unverified; `docs/roadmap.md` says so and lists what
else is not covered.

## Tests, on Bun and on Node

- `bun run test` runs the suite after a build, through `tools/run-suite.ts`;
  `bun test ./packages/cli/test/write-verb.test.ts` runs one file. Keep the
  `./`: to `bun test` a bare path is a substring filter, and
  `packages/cli/test/staged-gate` also runs `staged-gate-reads`. A plain
  `bun test` still runs every file, one after another, in one process. The
  node runner is
  `node --test "packages/core/test/*.test.ts" "packages/cli/test/*.test.ts"`,
  which `bun run test:node` wraps after a build.
- Every test writes under `os.tmpdir()`, never in the repository.
- A test that spawns a verb that stamps a date (`write`, `new`,
  `trust grant`) sets `WIKIWRIGHT_TODAY`, or the stamp moves with the day.
- Bun's per-test budget is five seconds. A case that installs a kit and
  drives a dozen verbs exceeds it: build the bundle in `before` and keep one
  `it` per verb, or state `{ timeout }` on a deliberately sequential walk.
- `packages/core` is a pure library with no Node typings in its tsconfig, so
  a filesystem call does not typecheck there; the shell is `packages/cli`.
- The three corpora are fixtures. A change to `devwiki`'s pages or
  constitution is judged by `starter-fixtures` (under the `code` starter's
  types merged with devwiki's own vocabularies, the error set must equal
  devwiki's own — a concrete type devwiki adds must exist in the starter,
  while a tag or a label is devwiki's to register), `routing-xor` (its
  `lint` must be clean) and `generated-tracked` (its `generated/` must be
  what this build renders).

## Measuring command performance

After `bun run build`, run `node tools/benchmark-check.ts` for 1,000, 5,000
and 10,000 synthetic pages, three fresh processes per command (`check`,
`check --write`, `lint --staged`). The first two positional arguments
override the comma-separated page counts and the repetition count:

```sh
node tools/benchmark-check.ts 1000,5000 3
```

An optional third argument names a separately built baseline CLI. The runner
alternates the two builds and requires byte-identical envelopes and generated
files before reporting their timings. Corpus creation and initial artifact
generation are outside the measured interval. Every process starts fresh;
the operating system's filesystem cache is not flushed. All temporary vaults
are removed when the run finishes. Use Bun instead of Node to measure Bun.

## Generated files have one generator each

Never hand-edit these; regenerate them and stage the result beside the
change that moved it (the gate judges drift over the staged state, so one
logical change is one commit).

| File | Generator |
|---|---|
| `devwiki/generated/*`, the brief included | `wikiwright check --write --root devwiki`, under the grant above |
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
   moved, and run `bun run test:node` before you push.
3. Open the pull request against `main` with the why in its description:
   what was wrong or missing, what the change does about it, and what it
   does not do. A change that adds a key, a verb or a finding names its
   consumer, its test and its documentation.
4. Semantic conflicts — two changes that both pass and mean different
   things — are resolved by a maintainer, never auto-merged.
