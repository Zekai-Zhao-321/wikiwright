# wikiwright: operating rules

You are working in the engine repository, not in a wiki. `docs/` describes
the system; `docs/roadmap.md` says where it stands; `CONTRIBUTING.md` says
how to set up, test and send a change. This file is the rules.

## What this is

A typed wiki engine for LLM agents. A bundle is a Markdown vault in git that
Obsidian opens unchanged, plus a JSON constitution. One function judges every
change against that constitution at every write path. No database, no daemon,
no query language, and the engine never calls a model. The thesis: a type
system is only as good as its narrowest write path.

## The invariants

Keep these, and keep the test that holds each (`docs/architecture.md` names
them):

- **Typed.** One nominal type per page; shapes and section grammars are data
  in `config/constitution.json`. Conformance, not truth: a conformant claim
  can still be false, and nothing here claims otherwise.
- **OKF-compatible.** `okf check` stays green on every corpus.
- **Four layers behind one registration API.** Kernel, standard library
  (claims, relations, entries), domain kit, bundle. The kernel imports nothing
  from `stdlib/`. If a first-party module needs a private hook, the API is
  wrong, not the module.
- **One judge at every write path.** Working tree, staged gate, stdin, write
  draft, replay: the same `judge(state, law)`.
- **Deterministic, byte-reproducible artifacts.** One generator per artifact;
  never hand-edited; no locale, no clock, no Bun-only API in `packages/`.
- **Every declared key has a consumer and an end-to-end test.** A key nothing
  reads is a lie the config tells its author.
- **Routing is total.** Every error or warning finding carries exactly one of
  `fix` and `queue`; a decidable check may gate, a judgment is a queue lane.
- **The bundle declares policy; the engine supplies mechanism.** A bundle
  selects from a closed set; it never authors a predicate.
- **State the loss.** When a mechanism is removed, deferred or unverified,
  write it where a reader will meet it. Green that hides a gap is worse than
  red.

## The gate

The gate is `bun run check`: biome, `bun run build`, the test-project
typecheck and the whole suite. The hook runs it locally, the workflow runs
it on every push and pull request on Linux and macOS. Enable the hook once
per clone:

```sh
git config core.hooksPath scripts/hooks
```

Before a release run `bun run test:node` (the node runner) and
`sh scripts/release-matrix.sh` by hand; Windows is unverified, and
`docs/roadmap.md` says so.

## Discipline

- **Literal names only.** `lint` means lint. No metaphor in a verb, a config
  key, a rule id or an error code.
- **One logical change per commit**, with a typed prefix: `feat:`, `fix:`,
  `refactor:`, `test:`, `docs:`, `chore:`. The why lives in the message body.
- **Every test writes under `os.tmpdir()`.** A test that spawns a verb that
  stamps a date sets `WIKIWRIGHT_TODAY`.
- **Generated files have one generator.** `devwiki/generated`, the brief
  included, from `wikiwright check --write --root devwiki`; the playbook from
  `bun tools/render-playbook.ts`; `docs/cli.md`'s verb block from
  `bun docs/render-cli.ts --write`.
- **Describe what exists.** A document, a help string or a skill line names
  behaviour the binary has. When unsure, run the binary and quote the
  envelope.
- **Semantic conflicts go to a maintainer**, never auto-resolved.
- **Trust is a maintainer's decision.** An agent must not grant trust
  automatically to unblock work: `module-untrusted`, `module-modified` and
  `module-scope-unresolved` mean stop and ask, and an explicit maintainer
  authorization is required. A test grants only in a store it owns under
  `os.tmpdir()`.

## Two hard rules

- **No private or personal data enters this repository**: not as a fixture,
  not as an example, not in a commit message. The fixtures are synthetic.
- **Never push anywhere but `origin`.**

## Before you start

1. Read `docs/roadmap.md`.
2. `git log --oneline -10` and `git status`.
3. `bun run check`, so you know whether you inherited a green tree.

## Where to look

| Working on | Read |
|---|---|
| the words: page, type, vocabulary, grammar, the judge, findings, the gate | `docs/concepts.md` |
| a key in `config/constitution.json` or `config/engine.json` | `docs/constitution.md` |
| a verb, a flag, the envelope, an exit code | `docs/cli.md`, or `wikiwright <verb> --help` |
| a module, a kit, the loader, trust | `docs/extending.md` |
| a package, an invariant, a test, the gate | `docs/architecture.md` |
| what is missing, deferred or unverified | `docs/roadmap.md` |
| what a release changed | `CHANGELOG.md` |
| setup, the hook, the runners, sending a change | `CONTRIBUTING.md` |

## Where things live

- `packages/core`: the kernel and the standard library.
- `packages/cli`: the binary, one module per verb under `src/verbs/`; the
  starters under `constitutions/`; the skills under `skills/`.
- `packages/kit-code`: `@wikiwright/kit-code`, the shipped domain kit — a
  code wiki's types, `anchored` fragment, relation labels, templates and
  discipline — consumed by the `code` starter and by `devwiki`. Nothing
  code-specific enters the kernel or the CLI.
- `devwiki`, `fixtures/memory-synth`, `fixtures/minimal-vault`: the corpora
  every change is judged against. `devwiki` is a bundle over the kit: after
  `bun install`, a maintainer grants it once on this machine
  (`wikiwright trust grant module:@wikiwright/kit-code --root devwiki`, with
  `--scope worktrees` to cover every linked worktree of this clone) before
  `check --root devwiki` judges anything; the suite never reads that grant —
  every test judges a copy under `os.tmpdir()`.
- `fixtures/conformance`: the neutral module fixture and the two bundles that
  consume it. Test infrastructure, not a domain model.
- `tools/`: the build-info writer, the playbook renderer, the case-fold table
  generator, the uncovered-directory lister, the suite runner the gate uses,
  and the benchmark of `check` and `lint --staged`.
- `docs/`: the documentation, and the CLI reference renderer.
