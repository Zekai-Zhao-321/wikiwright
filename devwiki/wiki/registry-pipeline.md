---
type: subsystem
title: Registry pipeline
description: Loads, validates and flattens config/constitution.json and config/engine.json into the effective contracts every pass reads.
tags: [kernel, cli]
pin: 11409794f5ab7f6a8fde671a8b7fb9c568bb8dd0
origin: .
covers: [packages/core/src/registry/, packages/cli/src/vaultio.ts, packages/cli/src/vaultfiles.ts, packages/cli/src/verbs/read.ts, packages/cli/src/verbs/bundles.ts]
---

# Registry pipeline

## Responsibilities

Turn `config/constitution.json` (vocabularies, fragments, types) and
`config/engine.json` (roots, policies, modules) into a validated, flattened
registry: every type resolved to an `EffectiveType` carrying its complete field
shapes, sections with their grammar parameters, check attachments and
attribution (`contributedBy` names the type or `fragment:<name>` that
contributed each element; `packages/core/src/registry/model.ts:29-60`,
`:89-138`). Refuse every constitution that violates the model before any page
is judged. The loader runs in stages, total within a stage and fail-fast
between them (`packages/core/src/registry/index.ts:6-10`): merge the module
contributions into the document (`:73-74`), parse it under one zod family
(`:75-77`; `packages/core/src/registry/document.ts:459`), resolve the
vocabularies (`:61-62`), combine the types (`:65`;
`packages/core/src/registry/combine.ts:1017`), validate the effective set
(`:66`; `packages/core/src/registry/validate.ts:122`), and collapse issues so
one cause is reported once with its sites (`:93-116`).

## Entry points

`loadConstitution(json, modules)` in `packages/core/src/registry/index.ts:72`:
the document and the composed module registry in, `{ok, registry}` or
`{ok: false, issues}` out (`packages/core/src/registry/model.ts:249`).
`loadEngineConfig(json)` in `packages/core/src/registry/engine.ts:456` reads
the bootstrap through a closed zod schema (`:419`) and returns the config or
`schema-invalid` issues (`:457-467`); `ENGINE_CONFIG_CONSUMERS` (`:421-449`)
names the reader of every key so the meta-test can resolve each. The
`exports` and `plugin` keys are closed shapes of their own (`:199`, `:231`),
and each export is refused by name for what its shape cannot say — a reserved
or taken name, a selected directory outside the content roots, an external
export with no repository, a contribution with nowhere to report
(`:256`; see [[exports]]). A module
declaration's optional `path`, a bundle-relative directory, is held to the
vault path law as a content root is, so a path that leaves the bundle is
`schema-invalid` at load (`:341-353`, `:383-403`). The CLI's
`loadVault` in `packages/cli/src/vaultio.ts:79` wraps both with file reading
through `loadVaultVia` (`:109`), which reads the config through a
`VaultReader`, the working tree's or the git index's; the two config paths,
the reader, the page walk and the page reads live below the loader, in
`packages/cli/src/vaultfiles.ts` (`:1-5`, `:11-36`). The constitution must
exist (`packages/cli/src/vaultio.ts:114-125`), `engine.json` loads first
because the modules it declares compose the registry the constitution is
validated under (`:144-179`) — a config that resolves outside the vault is
rethrown to be refused as `linked-outside-vault`, never read as unparseable
(`:133`, `:155`) — and a name an export derives from the
bundle's label is held to the name law there, where the root is known
(`:180-197`), the module set is the preloaded one, or the one its caller
passes, or a refusal, each module proved by the load that loaded it
(`:207-273`; see
[[modules]]), `content_roots` is required (`:275-289`), and every
declared template or example must exist and, for an example, pass its own
type (`:296-393`); a loaded vault keeps the two config texts as they were
read, the inputs of the law digest (`:51-57`, `:401`). Every verb that needs
types goes through it, `read` among them
(`packages/cli/src/verbs/read.ts:237`), and a root `--bundle` names is
resolved to a directory before any verb runs, so the loader reads it as it
reads `--root` (see [[command-runtime]]); the `bundles` verb loads
no law: it lists the skill directories' copies from their markers and their
SKILL.md frontmatter, and reads nothing the loader reads
(`packages/cli/src/verbs/bundles.ts:1-7`, `:71-116`).

## State

None at runtime: the pipeline is pure. The flattened registry is recomputed
per process, chain resolution happens once at load, and every downstream
consumer reads effective types; nothing walks a chain per page
(`packages/core/src/registry/model.ts:1-7`).

## Invariants

Specialisation is monotone: one `combine` function is applied twice per type,
once for the set-union of the fragments it pastes and once for its own
declaration, and "adds or tightens" is stated per key beside the finding it
emits (`packages/core/src/registry/combine.ts:5-9`). A child may shape an
inherited unshaped field or tighten a shaped one, and never relax it
(`:601-603`, `:383`); a re-declared section may only tighten each key
(`:641`); a grammar owns both halves of every parameter's monotone law
(`:659`); a check attachment may tighten its severity, never quiet it
(`:468-491`). Chains end at one of the four archetypes (`:39-40`); cycles and
unknown parents fail (`:1069`, `:1078`). A page-wide append-only body and an
append-only section on one type are refused as `body-lifecycle-doubled`
(`packages/core/src/registry/validate.ts:134-147`). Vocabulary entries are
keyed by normalized identity and resolved through the alias space at one site
(`packages/core/src/registry/model.ts:168-175`, `:187-200`).

## Failure modes

Every rejection is a structured issue with a stable code and a `where` naming
the entry an author edits — an anchor such as `type:<name>` and a `/`-joined
path below it (`packages/core/src/registry/model.ts:12-27`): `schema-invalid`
(`packages/core/src/registry/document.ts:467`), `unknown-extends` and
`extends-cycle` (`packages/core/src/registry/combine.ts:1078`, `:1069`),
`field-schema-redeclared` (`:607`), `sections-grammar-relaxed` (`:639`),
`constitution-unknown-extension` (`:719`;
`packages/core/src/registry/validate.ts:264`), `vocabulary-unknown`
(`packages/core/src/registry/vocabularies.ts:81`). The CLI reports a
constitution that does not load as `constitution-invalid` at exit 2 with the
issues in `data.issues` (`packages/cli/src/vaultio.ts:405-413`), and judges no
page under it; a declared module that did not load is refused by its own code
before the constitution is read (`:231-248`).

## Relations

- part_of [[wikiwright-architecture]]
- mapped_in [[repository-layout]]
- verified_by [[testing-guide]]

## History

- 2026-09-07 — re-read and re-pinned: the page cited packages/core/src/registry/v3.ts, a file that did not exist at its pin; the loader is packages/core/src/registry/index.ts.
