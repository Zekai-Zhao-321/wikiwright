---
type: subsystem
title: "Modules, trust and the fixture"
description: "The registration API every module goes through, the loader's ladder from the bundle's own node_modules to the judge, the machine-local content-hashed grant for one vault or for its path across a clone's linked worktrees, the purity scan and the determinism fixture proved at the grant."
tags: [kernel, cli]
pin: 29dbfb9c8b6bf1679bca419d1f3a7479c3f00532
origin: .
covers: [packages/core/src/modules/, packages/core/src/version/, packages/cli/src/main.ts, packages/cli/src/moduleload.ts, packages/cli/src/trust.ts, packages/cli/src/storelock.ts, packages/cli/src/modulefixture.ts, packages/cli/src/verbs/trust.ts, packages/cli/src/verbs/modules.ts]
---

# Modules, trust and the fixture

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
randomness, the locale, the environment, the network, dynamic evaluation and
`globalThis`, and for filesystem, network, process and OS imports, naming the
line that reached (`:30-77`, `:106`); it narrows and does not sandbox
(`:11-14`). `packages/core/src/version/index.ts` parses the closed engine-range
subset (`:55-75`) and `satisfiesEngineRange` (`:77`) answers a bundle's
declared module range and its engine pin.

`packages/cli/src/moduleload.ts` is the ladder, every step a named refusal
with no partial load (`:4-8`, `:270-274`): resolve from the bundle's own
`node_modules` and nowhere else (`:101-111`), read the package's `wikiwright`
block naming its entry, its fixture and its engine range (`:83-95`,
`:199-210`), check the installed version against the bundle's declared range
(`:336-354`) and the engine against the module's (`:355-363`), resolve the
entry and the fixture lexically inside the package (`:171-197`, `:365-387`),
digest every file but `node_modules` while scanning the executable ones,
once per package per process (`:120-156`, `:607-663`), refuse an impure module before the trust gate
(`:403-416`, `:446-449`), refuse a module no grant scope approves — ungranted,
modified, or needing a worktree scope git could not read — with a hint that
names a maintainer's decision and no command (`:224-268`, `:450-459`),
import the entry and require a manifest whose stated version agrees with the
package (`:461-491`). The outcome is cached per root by the entry point's one
asynchronous step (`:511-554`), and the declarations it loads are read from
`config/engine.json` as the vault loader parses it, so a byte order mark
declares the same modules to the preload and to the law digest
(`:556-587`). `packages/cli/src/trust.ts` is the store:
`~/.config/wikiwright/trust.json` or `WIKIWRIGHT_TRUST_FILE`, made absolute (`:58-68`),
holding vault grants keyed by the vault's real path and `module:<package>`,
pinned to a sha256 and dated, one per module (`:14-21`, `:70-73`,
`:184-191`), and worktree grants keyed by the real path of the git common
directory and the vault's path inside its worktree, several digests each
(`:23-36`, `:217-234`, `:268-284`). It reads either store version and writes
version 2 only on a grant or a revoke (`:103-143`), under the lock every
machine-local store is updated under, `packages/cli/src/storelock.ts`, which
the bundles registry shares; the lock is taken before the read, so two writes
at once cannot lose one another's record; it names the process and the host
that hold it and is broken only when that process is gone from this machine,
never because it is old, and one that does not clear refuses `store-busy`
(`packages/cli/src/storelock.ts:114-163`, `:178-199`;
`packages/cli/src/trust.ts:157-175`; `packages/cli/src/verbs/trust.ts:80-89`).
A store that is not JSON, not a trust store, of a version it does not read,
or holding a record of neither shape or of both (`packages/cli/src/trust.ts:79-101`)
is thrown as `StoreMalformed` under the store's own code and never rewritten
(`:107-138`; `packages/cli/src/storelock.ts:34-65`); the runtime answers it
as the refusal `trust-store-malformed`, naming the file and the failing
record, from whichever verb or preload reached it
(`packages/cli/src/main.ts:80-111`). Its verdict reads the vault grant first
and asks git, once per process, only when a worktree grant for the module
exists (`packages/cli/src/trust.ts:286-307`, `:315-363`).
`packages/cli/src/modulefixture.ts`
runs a module's determinism fixture under the standard library plus that
module alone (`:51-55`, `:81`), judges the fixture's pages twice in one
process (`:114-131`) and compares the findings with the module's own
expectation (`:133-144`). The `trust` verb grants only after the digest, the
purity scan, the load with the gate skipped and the fixture all pass
(`packages/cli/src/verbs/trust.ts:440-509`) and writes the grant in the scope
`--scope` names (`:123-142`, `:352-359`); `list` reports each grant that applies
to the vault, with its scope, as `current`, `modified` or `missing` against
the loader's digest (`:198-306`), refuses `scope-unresolved` when it names
`--scope worktrees` and git cannot read that scope, and adds no scope lookup
under `--scope vault` (`:258-273`); `list --all` is the whole store
instead of this vault's share of it, every record with its identity, the path
it is keyed by and whether that path is still here (`:200-228`); `revoke
--record` removes exactly one record and needs neither a vault nor a
repository, which is the only way to remove one whose directory is gone
(`:307-337`; `packages/cli/src/trust.ts:236-252`); the preload before the verb runs asks
nothing either, since `trust` declares that it reads no vault law
(`packages/cli/src/main.ts:198-201`; `packages/cli/src/verbs/trust.ts:152`),
and `--bundle` naming an installed copy does not refuse it, an exemption by
verb, since what it writes is this machine's store
(`packages/cli/src/main.ts:157`; see [[command-runtime]]).
`revoke --scope worktrees` removes every digest
the scope approved and says whether a vault grant still approves
(`packages/cli/src/verbs/trust.ts:382-438`). The `modules` verb lists what
resolved, which scope approved it
and what each contributed, and `plan` reports the finding delta of adopting
another version (`packages/cli/src/verbs/modules.ts:3-7`, `:69-74`, `:128`).

## Entry points

- `loadModules`, `passRows`, `armRows`, `resolveParsers`, `admittedKinds`,
  `canonicalizeOf`, `edgesOf`, `observedValues`, `transitionSeam`,
  `effectOf`, `combineParam`, `declaredParams`, `armApplies`
  (the package barrel, `packages/core/src/index.ts`); `scanPurity`
  (`packages/core/src/modules/purity.ts:106`).
- `loadDeclaredModules`, `preloadModules`, `preloadedModules`,
  `declaredModulesOf`, `declaredModulesIn`, `declaredModulesInText`, `moduleDigest`
  (`packages/cli/src/moduleload.ts`); `main.ts` preloads once before dispatch
  (`packages/cli/src/main.ts:198-201`) and `loadVaultVia` reads the outcome,
  refusing `module-not-loaded` when it is absent and composing
  `[...STANDARD_LIBRARY, ...loaded]` when it is not
  (`packages/cli/src/vaultio.ts:177-241`).
- `readTrustStore`, `writeTrustStore`, `updateTrustStore`, `putGrant`,
  `dropGrant`, `dropRecord`, `recordId`, `grantFor`,
  `putWorktreeGrant`, `dropWorktreeGrants`, `worktreeGrantsFor`,
  `trustVerdict`, `worktreeScopeOf`, `scopeKeyFrom`, `vaultKey`,
  `trustFilePath` (`packages/cli/src/trust.ts`); `updateStore`,
  `parseStoreFile`, `StoreBusy`, `StoreMalformed`
  (`packages/cli/src/storelock.ts:185`, `:54`, `:32`, `:41`); `gitWorktreeIdentity`
  (`packages/cli/src/git.ts`, in [[git]]); `runModuleFixture`
  (`packages/cli/src/modulefixture.ts:56`); `trustCommand`
  (`packages/cli/src/verbs/trust.ts:114`); `modulesCommand`
  (`packages/cli/src/verbs/modules.ts:69`).
- `parseEngineRange`, `satisfiesEngineRange`
  (`packages/core/src/version/index.ts:62`, `:77`), read by the loader and by
  the engine pin (`packages/cli/src/law.ts:100-118`).

## State

The machine-local trust store (`packages/cli/src/trust.ts:64-68`) and the
lock file beside it while a write holds it
(`packages/cli/src/storelock.ts:127-139`); the per-process worktree-scope
cache keyed by vault root, which remembers a failure too
(`packages/cli/src/trust.ts:286-307`); the per-process preload cache keyed by vault root
(`packages/cli/src/moduleload.ts:523`); the per-process digest of each
package, keyed by its resolved root and the entry scanned with it, which the
preload, the brief's law digest and the envelope's share (`:613-621`); the
bundle's own `node_modules`, which the loader reads and never writes.

## Invariants

- A bundle judged without a law it declares is judged under a different law
  than it believes: a declared module that did not load is a refusal, never a
  quieter law (`packages/cli/src/moduleload.ts:4-8`;
  `packages/cli/src/vaultio.ts:169-176`).
- The digest covers every file of the package, `package.json` and the fixture
  included, so repointing the entry or editing the expectation moves the
  digest (`packages/cli/src/moduleload.ts:158-167`); the entry and the
  fixture must be members of that file set (`:418-436`); the grant's digest
  and the loader's are one definition (`:389-392`).
- The purity scan runs before the trust gate, and again at the grant, so a
  grant is never a way to admit impure code (`:446-449`;
  `packages/cli/src/verbs/trust.ts:450-464`).
- The fixture runs once, at the grant that pins the bytes; a load under the
  granted digest is the same proof (`packages/cli/src/verbs/trust.ts:465-467`;
  `packages/cli/src/vaultio.ts:217-220`).
- A module names only a fixer the kernel already ships, and only for the rule
  the registry carries it for (`packages/core/src/modules/index.ts:106-112`);
  every non-info arm or check names a lane (`:123-128`, `:950-953`); no module
  claims `prose`, `tags`, a kernel id or the `unparsed` kind (`:752-777`,
  `:780-784`).
- Editing any file of a granted module revokes the grant, and moving the vault
  revokes a vault grant; a worktree grant follows the vault's path into every
  linked worktree and ends when the repository's common directory moves
  (`packages/cli/src/trust.ts:70`; `packages/cli/src/verbs/trust.ts:517-520`);
  `git pull` can never write one (`packages/cli/src/trust.ts:1-2`).
- A matching digest in either scope approves, and nothing else does: a
  worktree scope that was needed and could not be read is a refusal, never a
  quieter verdict (`packages/cli/src/trust.ts:315-363`).
- A worktree key is never read from ambiguous output: a newline in the
  vault's path, or in a linked worktree's common directory, and an answer
  cut short before its final newline each leave no worktree identity rather
  than a shorter path's (`packages/cli/src/git.ts`; see [[git]]).
- A revocation reads everything it reports before it writes the store, so a
  revocation that wrote the store never then fails; a module whose bytes
  cannot be read is approved by nothing
  (`packages/cli/src/verbs/trust.ts:391-415`).
- A module's schema is called only through `safeParse`, and a schema that
  throws refuses the value rather than ending the load
  (`packages/core/src/modules/index.ts:333-350`).

## Failure modes

- The twelve `ModuleIssue` codes: `module-unresolved`, `module-malformed`,
  `module-version-mismatch`, `module-incompatible`, `module-untrusted`,
  `module-modified`, `module-scope-unresolved`, `module-impure`,
  `module-load-failed`, `module-fixture-missing`, `module-fixture-failed`,
  `module-nondeterministic` (`packages/cli/src/moduleload.ts:43-62`), each
  naming the package and most a hint; `module-not-loaded` and
  `module-conflict` at the vault load (`packages/cli/src/vaultio.ts:183-238`).
- `RegistryConflict` kinds from `loadModules`
  (`packages/core/src/modules/index.ts:785-812`), raised before any module
  code runs (`:821-825`).
- `invalid-arguments` when `--record` is named beside a scope, a module or
  another subcommand: the identity already carries all three
  (`packages/cli/src/verbs/trust.ts:169-188`).
- `invalid-scope`, `root-not-found`, `missing-argument`, `scope-unresolved`,
  `grant-not-found` and `module-not-found` from the `trust` verb
  (`packages/cli/src/verbs/trust.ts:102-112`, `:156-196`, `:342-350`,
  `:360-389`, `:440-449`).
- `store-busy` from the `trust` verb when another process's lock does not
  clear (`packages/cli/src/verbs/trust.ts:80-89`), and `trust-store-malformed`
  (exit 4) from any verb or preload that reads a store it cannot parse, with
  the file and the failing record (`packages/cli/src/main.ts:80-111`).
- At judge time, a module that throws is one attributed `module-failure` per
  item or section (see [[judge]]).

## Relations

- part_of [[wikiwright-architecture]]
- mapped_in [[repository-layout]]
- verified_by [[testing-guide]]
- decided_by [[D-002]]
- decided_by [[D-003]]
- decided_by [[D-006]]
