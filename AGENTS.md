# wikiwright: operating rules

This is the engine repository, not a wiki. `docs/concepts.md` names its
terms, `docs/constitution.md` specifies its data law, `docs/architecture.md`
maps packages to invariants, `docs/roadmap.md` states losses and unverified
work, and `CONTRIBUTING.md` gives setup and change mechanics.

## What the engine is

A bundle is Markdown in Git, openable by Obsidian unchanged, plus a strict
`config/engine.json` and YAML type documents. The kernel, data libraries,
and bundle documents form its three layers. One `judgeTypeLaw(state, law)`
judges every write path. The engine does not call a model, keep a database,
run a daemon, or execute code supplied by a bundle. Conformance is not truth.

## Keep these invariants and their tests

- One nominal type per page. Types, fragments, vocabularies, sections and
  rules are data. `check` reports `okf-missing-type` on a content page with
  no type.
- A library is data only, imported by path from the bundle's repository.
  The kernel owns the fixed claims, relations and entries grammar, JSON
  Schema, the bounded CEL profile, and the page interface.
- Working tree, drafts over disk, index over HEAD, and revision reach the
  same judge under the law from that same state.
- Every error or warning finding has exactly one `fix` or `queue` route;
  informational findings have neither. Unevaluated checks are counted
  separately, never silently passed.
- Every declared engine key has a consumer and an end-to-end CLI fixture.
  A law change carries rule tests and a visible staged diff.
- Artifacts are byte-reproducible. Each generated file has one generator.
  Sort without locale, avoid the clock in artifacts, and keep Bun APIs out
  of `packages/` outside the Git transport.
- The writer proves the whole proposed batch before the first page write.
  A dry run and real run have the same refusal and path plan. A Git gate
  judges staged bytes and law together.
- The development gate covers every corpus and the built CLI. The
  invariant-to-test table is in `docs/architecture.md`.

## Commands

- Read `docs/roadmap.md`, then inspect `git log --oneline -10` and
  `git status` before changing anything. Run `bun run check` to establish
  the inherited baseline.
- `bun run check` runs Biome, the build, test-project typecheck and whole
  suite. The local `scripts/hooks/pre-commit` runs it. Enable the hook
  once per clone with `git config core.hooksPath scripts/hooks`.
- `bun test ./<path>.test.ts` runs one file. Tests write under
  `os.tmpdir()`; a test that spawns `write` sets `WIKIWRIGHT_TODAY`.
- `bun packages/cli/dist/bin.js <verb> --help` and `docs/cli.md` describe
  the eight verbs: `check`, `gate`, `write`, `rule`, `read`, `search`,
  `type` and `version`. Run the binary when prose and behavior disagree.
- `sh scripts/release-matrix.sh` is the manual pre-release matrix.
  Linux and macOS have workflow runners; Windows remains unverified.

## Generated output

- `devwiki/generated/*`, including the brief, from
  `wikiwright check --write --root devwiki`.
- A handbook's `generated/*` from `wikiwright check --write --root
  fixtures/handbooks/<name>`.
- `fixtures/memory-synth/generated/*` and
  `fixtures/minimal-vault/generated/*` from their own `check --write`.
- `docs/skills/wikiwright-maintain/finding-response.md` from
  `bun tools/render-playbook.ts`.
- The verb block in `docs/cli.md` from
  `bun docs/render-cli.ts --write`.
- `docs/v2-dispositions.md` from `bun tools/dispositions.ts`.
- `packages/core/src/identity/casefold-data.ts` from
  `bun tools/generate-casefold.ts`.

Regenerate, inspect, and stage generated output with the source change.
Do not hand-edit it.

## NEVER

- Put private or personal data in this repository, its fixtures, examples,
  docs, or commit messages. The corpora here are synthetic.
- Push anywhere but `origin`.
- Auto-resolve a semantic conflict. Send it to a maintainer.
- Add an executable library hook or imply that a bundle policy can run code.
- Call a structural pass proof of a claim's truth, a pin's semantic
  accuracy, or host hook delivery.
- Describe a removed verb, key, module loader, or role gate as available.

## Change discipline and verification

Use one logical change per commit with `feat:`, `fix:`, `refactor:`,
`test:`, `docs:`, or `chore:`. Put the why in the body. No co-author
trailers. Use literal names for verbs, keys, rule ids and errors.

Verify the affected CLI seam and corpus, then run `bun run check`.
Before a release, run the release matrix. If a mechanism is removed,
deferred or unverified, state the loss where its reader will meet it,
including `docs/roadmap.md`. Green that hides a gap is worse than red.
