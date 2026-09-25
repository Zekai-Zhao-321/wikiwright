---
type: subsystem
title: "Modules, the loader and the fixture"
description: "The registration API every module goes through, the loader's ladder from the bundle's own node_modules or a declared bundle-relative path to the judge, the purity scan and the determinism fixture run at every load and kept once per digest in a process, and the modules verb."
tags: [kernel, cli]
pin: 11409794f5ab7f6a8fde671a8b7fb9c568bb8dd0
origin: .
covers: [packages/core/src/modules/, packages/core/src/version/, packages/cli/src/main.ts, packages/cli/src/moduleload.ts, packages/cli/src/modulefixture.ts, packages/cli/src/sha256.ts, packages/cli/src/verbs/modules.ts]
aliases: ["modules-and-trust"]
---

# Modules, the loader and the fixture

## Responsibilities

`packages/core/src/modules/index.ts` is the API and the registry (`:1-7`). A
manifest carries an `id` and, optionally, grammars, vocabularies, checks,
lanes, fragments, types, templates, skill fragments and entries contributed
into another module's vocabulary (`:491-521`); `defineModule`,
`defineVocabulary`, `defineCheck`, `defineGrammar` and `defineArm` are the
constructors (`:524-542`). A grammar declares its kinds, its parser, its
parameters with their combination laws (`:21-79`), its arms (`:86-152`), an
optional vocabulary, delegations, identity and correction predicates, a
canonical rendering, an `admits` rule and the `observes` and `edges` hooks
(`:274-331`). `loadModules` (`:871`) composes manifests into one
`ModuleRegistry` (`:649-677`), refusing a malformed manifest by key
(`:826-869`) and every collision by kind (`:779-815`): a kernel lane
(`:898-917`), the kernel's `tags` vocabulary (`:762-777`, `:923-926`), a
kernel-emitted id (`:744-752`), a check with no surface or no lane
(`:946-957`). `passRows` (`:612`) composes the kernel table with one row per
registered arm and check; `transitionSeam` (`:1420-1450`) and `effectOf`
(`:1452-1468`) are the closed-default readers of a grammar's capabilities.
`packages/core/src/modules/purity.ts` scans a module's bytes for the clock,
randomness, the locale, the environment, the network, dynamic evaluation,
`globalThis`, computed access to the banned globals and an import of any
form, naming each capability an import of a Node module reaches for and the
line that reached, in the source as written or with its comments blanked,
either reading refusing (`:44-94`, `:101-116`, `:155-263`, `:286-326`); it
narrows and does not
sandbox (`:11-20`), and its version keys every cached scan (`:22-28`).
`packages/core/src/version/index.ts` parses the closed engine-range
subset (`:55-75`) and `satisfiesEngineRange` (`:77`) answers a bundle's
declared module range and its engine pin.

`packages/cli/src/moduleload.ts` is the ladder, every step a named refusal
with no partial load (`:4-9`, `:380-385`). One resolver reads a declaration:
the bundle's own `node_modules` and nowhere else, or a declared
bundle-relative `path`, authoritative with no fallback, held to the vault
path law and to the bundle's real path (`:106-199`), resolved from the
bundle root or, for the staged gate's export plan, from a directory its
caller names per declaration (`:331-341`, `:409-410`). It reads the package's
`wikiwright` block naming its entry, its fixture and its engine range
(`:88-100`, `:318-329`), checks the installed version against the bundle's
declared range (`:443-461`) and the engine against the module's
(`:462-470`), resolves the entry and the fixture lexically inside the package
(`:290-316`, `:472-495`), digests every lexical path but `node_modules` —
the one inventory an export carries too — with the shell's sha256
(`packages/cli/src/sha256.ts:10-12`) and scans the executable ones
(`packages/cli/src/moduleload.ts:208-275`, `:722-804`), refuses an
impure module (`:511-524`), imports the entry and requires a manifest whose
stated version agrees with the package (`:554-584`), and runs the module's
determinism fixture, refusing with the fixture's own code and hint
(`:586-600`). The scan is kept by the digest and the scan's version, the
fixture by the digest, the scan's version and the declared name, for the
process only (`:351-378`, `:741-746`); the reading of a package's bytes is
kept by where they lie (`:730-739`). The outcome is kept per root by the
entry point's one asynchronous step (`:615-663`), and the declarations it
loads are read from `config/engine.json` as the vault loader parses it, so a
byte order mark declares the same modules to the preload and to the law
digest (`:665-714`). `packages/cli/src/modulefixture.ts` runs a module's
determinism fixture under the standard library plus that module alone
(`:75-80`, `:103-104`), judges the fixture's pages twice in one process
(`:136-154`) and compares the findings with the module's own expectation
(`:155-166`); its issue is declared there, so it imports nothing of the
loader that calls it (`:50-73`). The `modules` verb lists what each module
contributed, where it resolved, its digest and what its fixture judged, with
a refused module's refusal beside the others, and `plan` reports the finding
delta of adopting another version, reading a path-declared candidate from the
same path (`packages/cli/src/verbs/modules.ts:1-7`, `:100-151`, `:189-210`).

## Entry points

- `loadModules`, `passRows`, `armRows`, `resolveParsers`, `admittedKinds`,
  `canonicalizeOf`, `edgesOf`, `observedValues`, `transitionSeam`,
  `effectOf`, `combineParam`, `declaredParams`, `armApplies`
  (the package barrel, `packages/core/src/index.ts`); `scanPurity`,
  `PURITY_SCAN_VERSION` and `PURITY_REASONS`
  (`packages/core/src/modules/purity.ts:286`, `:28`, `:123`).
- `loadDeclaredModules`, `preloadModules`, `preloadedModules`,
  `declaredModulesOf`, `declaredModulesIn`, `declaredModulesInText`,
  `moduleDigest`, `moduleLocation`, `moduleInventory`, `moduleDigestOf`
  (`packages/cli/src/moduleload.ts:386`, `:639`, `:634`, `:671`, `:699`,
  `:688`, `:766`, `:111`, `:216`, `:268`); `main.ts` preloads
  once before dispatch (`packages/cli/src/main.ts:285-288`) and `loadVaultVia`
  reads the outcome, or the module set its caller passes instead — the
  staged gate's export plan passes the one loaded from the staged kit —
  refusing `module-not-loaded` when it is absent and composing
  `[...STANDARD_LIBRARY, ...loaded]` when it is not
  (`packages/cli/src/vaultio.ts:207-273`).
- `runModuleFixture` (`packages/cli/src/modulefixture.ts:80`); `sha256Of`
  (`packages/cli/src/sha256.ts:10`); `modulesCommand`
  (`packages/cli/src/verbs/modules.ts:70`).
- `parseEngineRange`, `satisfiesEngineRange`
  (`packages/core/src/version/index.ts:62`, `:77`), read by the loader and by
  the engine pin (`packages/cli/src/law.ts:100-118`).

## State

The per-process preload cache keyed by vault root
(`packages/cli/src/moduleload.ts:632`); the per-process reading of each
package, keyed by its resolved root, which the preload, the brief's law
digest and the envelope's share (`:730-739`); the per-process scans and
fixture verdicts, keyed by the digest and the scan's version (`:741-746`,
`:351-363`); the bundle's own `node_modules` or declared directory, which the
loader reads and never writes. Nothing of a module is kept between processes.

## Invariants

- A bundle judged without a law it declares is judged under a different law
  than it believes: a declared module that did not load is a refusal, never a
  quieter law (`packages/cli/src/moduleload.ts:4-9`;
  `packages/cli/src/vaultio.ts:199-206`).
- The digest covers every file of the package, `package.json` and the fixture
  included, so repointing the entry or editing the expectation moves the
  digest (`packages/cli/src/moduleload.ts:277-286`); the entry and the
  fixture must be members of that file set (`:526-544`); the law digest, the
  scan, the fixture's cache, `modules list` and an export's kit read one
  definition of it (`:497-500`, `:216`; see [[exports]]).
- Every load proves the module before it judges anything, and a proof is
  kept only for the bytes it proved, in one process
  (`:586-600`, `:351-378`).
- A declared `path` is the only place its module is read from
  (`:127-131`, `:165-183`).
- A module names only a fixer the kernel already ships, and only for the rule
  the registry carries it for (`packages/core/src/modules/index.ts:106-112`);
  every non-info arm or check names a lane (`:123-128`, `:950-953`); no module
  claims `prose`, `tags`, a kernel id or the `unparsed` kind (`:752-777`,
  `:780-784`).
- A module's schema is called only through `safeParse`, and a schema that
  throws refuses the value rather than ending the load
  (`packages/core/src/modules/index.ts:333-350`).

## Failure modes

- The nine `ModuleIssue` codes: `module-unresolved`, `module-malformed`,
  `module-version-mismatch`, `module-incompatible`, `module-impure`,
  `module-load-failed`, `module-fixture-missing`, `module-fixture-failed`,
  `module-nondeterministic` (`packages/cli/src/moduleload.ts:50-67`), each
  naming the package and most a hint; `module-not-loaded` and
  `module-conflict` at the vault load (`packages/cli/src/vaultio.ts:216-270`).
- `RegistryConflict` kinds from `loadModules`
  (`packages/core/src/modules/index.ts:785-812`), raised before any module
  code runs (`:821-825`).
- `candidate-unresolved`, with the candidate's issues, when a candidate does
  not load — its own fixture failing included
  (`packages/cli/src/verbs/modules.ts:189-210`).
- At judge time, a module that throws is one attributed `module-failure` per
  item or section (see [[judge]]).

## Relations

- part_of [[wikiwright-architecture]]
- mapped_in [[repository-layout]]
- verified_by [[testing-guide]]
- decided_by [[D-002]]
- decided_by [[D-003]]
- decided_by [[D-007]]
