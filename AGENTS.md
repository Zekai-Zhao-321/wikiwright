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

- **Typed.** One nominal type per page; shapes, sections and rules are data
  in the type documents under `constitution/` and the libraries a bundle
  imports. Conformance, not truth: a conformant claim can still be false,
  and nothing here claims otherwise.
- **OKF-compatible.** `check` reports no `okf-missing-type` on any corpus.
- **Three layers, all law is data.** Kernel, library, bundle. The kernel
  holds the fixed grammar (claims, relations, dated entries), JSON Schema and
  the CEL profile; a library is a directory of type, fragment and vocabulary
  documents a bundle imports by path; a bundle's own documents may extend a
  library's. No layer ships code: a need the kernel does not meet is a CEL
  rule over the page interface, or a change to the kernel.
- **One judge at every write path.** The working tree, drafts over the disk,
  the index over HEAD and a revision: the same `judgeTypeLaw(state, law)`.
- **Deterministic, byte-reproducible artifacts.** One generator per artifact;
  never hand-edited; no locale, no clock, and no Bun-only API in
  `packages/` outside the git transport (`packages/cli/src/stdoutfile.ts`).
- **Every declared key has a consumer and an end-to-end test.** A key nothing
  reads is a lie the config tells its author.
- **Routing is total.** Every error or warning finding carries exactly one of
  `fix` and `queue`; a decidable check may gate, a judgment is a queue lane.
- **The bundle declares policy; the engine supplies mechanism.** A bundle
  writes its rules in the bounded CEL profile over the documented page
  interface, each with its test set; it never ships an executable hook.
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

The engine runs on Bun only, the version `.bun-version` pins (and every
`engines.bun` with it). Before a release run `sh scripts/release-matrix.sh`
by hand; Windows is unverified, and `docs/roadmap.md` says so.

## Discipline

- **Literal names only.** `lint` means lint. No metaphor in a verb, a config
  key, a rule id or an error code.
- **One logical change per commit**, with a typed prefix: `feat:`, `fix:`,
  `refactor:`, `test:`, `docs:`, `chore:`. The why lives in the message body.
- **Every test writes under `os.tmpdir()`.** A test that spawns a verb that
  stamps a date sets `WIKIWRIGHT_TODAY`.
- **Generated files have one generator.** `devwiki/generated`, the brief
  included, from `wikiwright check --write --root devwiki`; the two
  handbooks' `generated/`, their briefs included, from
  `wikiwright check --write --root fixtures/handbooks/<name>`; the playbook,
  `docs/skills/wikiwright-maintain/finding-response.md`, from
  `bun tools/render-playbook.ts`; `docs/cli.md`'s verb block from
  `bun docs/render-cli.ts --write`; `docs/v2-dispositions.md` from
  `bun tools/dispositions.ts`.
- **Describe what exists.** A document, a help string or a skill line names
  behaviour the binary has. When unsure, run the binary and quote the
  envelope.
- **Semantic conflicts go to a maintainer**, never auto-resolved.

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
| a module, a kit, the loader, the purity scan | `docs/extending.md` |
| a package, an invariant, a test, the gate | `docs/architecture.md` |
| what is missing, deferred or unverified | `docs/roadmap.md` |
| what a release changed | `CHANGELOG.md` |
| setup, the hook, the runners, sending a change | `CONTRIBUTING.md` |

## Where things live

- `packages/core`: the kernel: the type-document loader, the page interface,
  the fixed grammar's records, the CEL rules, the judge and its artifacts.
- `packages/cli`: the binary, one module per verb under `src/verbs/`, the
  eight verbs of the v2 contracts.
- `devwiki`, `fixtures/memory-synth`, `fixtures/minimal-vault`,
  `fixtures/handbooks/{orchard,allotment}`: the corpora every change is
  judged against, all on the v2 law. `devwiki` imports `libraries/kit-code`
  by path; the tests judge each corpus where it stands and in copies under
  `os.tmpdir()`.
- `libraries/`: the type libraries of the v2 law, data only — type,
  fragment and vocabulary documents with their rule tests and examples.
  `kit-code` (id `code`) is a code wiki's page kinds, the `anchored`
  fragment and the relation labels, the v2 form of the v1 kit
  `@wikiwright/kit-code`, which left in step 6; nothing code-specific enters
  the kernel or the CLI;
  `kit-garden` (id `garden`) is the neutral test library, which the
  allotment handbook imports.
- `tools/`: the build-info writer, the binary builder (`bun run binary`), the
  playbook renderer, the v2 disposition-table generator, the case-fold table
  generator, the uncovered-directory lister, the suite runner the gate uses,
  and the benchmark of `check` and `gate`.
- `test/`: the tests of the built CLI as a whole — the pipe probes and the
  compiled binary.
- `docs/`: the documentation, the CLI reference renderer, and under
  `docs/skills/` the three skill documents — for using, writing and
  maintaining a bundle — with the generated playbook.
