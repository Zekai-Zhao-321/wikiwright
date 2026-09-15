---
type: code-concept
title: "The trust law"
description: "Module code runs inside the judge, so a module is admitted by a machine-local grant pinned to the sha256 over every file of the installed package, for one vault or for its path in every linked worktree of one clone, taken only after a purity scan and a determinism fixture, and revoked by any edit; a stranger's bug is one attributed finding, never a crash."
tags: [cli, kit]
pin: 293c3a7d897f28d6a9c7df717998cc29ef9dce7e
origin: .
covers: [packages/core/src/modules/purity.ts, packages/cli/src/moduleload.ts, packages/cli/src/trust.ts, packages/cli/src/modulefixture.ts, packages/cli/src/verbs/trust.ts, packages/kit-code/, packages/core/src/grammar/index.ts, packages/core/src/lint/index.ts]
---

# The trust law

## Mechanism

A module's code runs inside the judge whenever a vault is judged, so a
bundle's verdict would otherwise depend on code this repository's gate never
proved reproducible (`packages/core/src/modules/purity.ts:5-9`). Three
guards stand in order. The purity scan reads the module's bytes before any of
them run and refuses, by file and line, the ordinary ways of reaching the
clock, randomness, the locale, the environment, the network or dynamic
evaluation, and imports of the filesystem, the network, a child process, the
process or the OS (`:11-14`, `:30-77`); it narrows and does not sandbox, and
says so (`:11-14`). The grant is a maintainer's act on one machine: `trust grant
module:<package>` digests every file of the installed package except its
`node_modules`, scanning the executable ones (`packages/cli/src/moduleload.ts:119-155`,
`:595-626`), refuses an impure module before writing anything
(`packages/cli/src/verbs/trust.ts:450-464`), loads the module with the trust
gate skipped through an option named for its one caller
(`packages/cli/src/moduleload.ts:211-221`;
`packages/cli/src/verbs/trust.ts:471`), runs the determinism fixture — the
same bytes judged twice in one process under the standard library plus that
module alone, compared with the findings the module ships as its own
expectation (`packages/cli/src/modulefixture.ts:51-55`, `:114-144`) — and
only then records the grant, pinned to the digest, in the scope the
maintainer chose, under the store's lock so a grant made while another lands
keeps both (`packages/cli/src/verbs/trust.ts:493-507`;
`packages/cli/src/trust.ts:212-261`): this vault,
keyed by its real path and holding one digest per module, or, with `--scope
worktrees`, the vault's path in every linked worktree of one clone, keyed by
the real path of the git common directory and holding every digest approved
there (`packages/cli/src/trust.ts:23-45`, `:73-76`, `:317-334`). Every later
load asks whether either scope approves the installed digest — the vault
grant first, with no git, and git only when a worktree grant for the module
exists (`:415-463`) — and refuses `module-untrusted`, `module-modified` or
`module-scope-unresolved` with a hint that names a maintainer's decision and
no command to run (`packages/cli/src/moduleload.ts:223-267`, `:449-458`); the
store lives
outside every repository, so `git pull` can never grant
(`packages/cli/src/trust.ts:1-2`).

The digest is the boundary and the only one: no lockfile is read, because
the grant already pins every byte, `package.json` included, and repointing
the entry or editing the fixture moves the digest
(`packages/cli/src/moduleload.ts:10-13`, `:157-166`). The fixture runs at the
grant and not on every vault read; a load under the granted digest is the
same proof (`packages/cli/src/vaultio.ts:218-221`). And the blast radius of a
stranger's bug is one arm on one item: a module that throws while parsing or
in an arm is one `module-failure` finding naming the module, its version and
the arm, routed to the kernel's `module-review` lane, and the vault still has
a verdict (`packages/core/src/grammar/index.ts:548-580`;
`packages/core/src/passes/index.ts:117-127`); a schema or a capability that
throws is a refusal of the value or the closed default, so a module's bug
makes the engine stricter, never quieter
(`packages/core/src/modules/index.ts:340-350`, `:1427-1431`).

What a grant approves is stated in its envelope: granted module code runs
inside the judge whenever this vault is judged, and changing any of its
files, or moving the vault, revokes; a worktree grant says the same of the
vault's path in any linked worktree of the clone, and that changed bytes need
their own approval (`packages/cli/src/verbs/trust.ts:517-520`). A maintainer
grants this bundle's own kit on every machine that judges it, with `--scope
worktrees` where sessions open linked worktrees of one clone ([[D-006]]); an
agent must not grant trust to unblock its work (`AGENTS.md`, "Discipline").
The suite grants each test's copy in a store the test owns, never the
developer's
(`packages/cli/test/fixtures/kit-code.ts:1-9`, `:29-37`).

## Where it lives

- The scan: `packages/core/src/modules/purity.ts`; the ladder and the digest:
  `packages/cli/src/moduleload.ts`; the store: `packages/cli/src/trust.ts`;
  the worktree identity: `packages/cli/src/git.ts:431-474`; the fixture
  runner: `packages/cli/src/modulefixture.ts`; the verb:
  `packages/cli/src/verbs/trust.ts` — all in [[modules-and-trust]].
- The attributed failure: `packages/core/src/grammar/index.ts:548-580` and
  `packages/core/src/lint/index.ts:1316-1339`, in [[judge]].
- The kit this bundle grants: `packages/kit-code/` with its
  `fixture.json`, declarations only ([[D-004]]).
- The decision that made it one law: [[D-002]], and the one that added the
  worktree scope: [[D-006]]; the tests: `module-conformance`,
  `pack-install`, `kit-code` and `trust-scope` under `packages/cli/test/`.

## Relations

- part_of [[wikiwright-architecture]]
- decided_by [[D-002]]
- decided_by [[D-006]]
