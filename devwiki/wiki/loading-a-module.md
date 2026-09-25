---
type: code-concept
title: "Loading a module"
description: "Module code runs inside the judge, and installing a module is the consent to run it; what the engine adds is proof over the installed bytes at every load — the digest the law names, a purity scan that refuses by file and line, and the module's own determinism fixture — once per digest in a process; a stranger's bug is one attributed finding, never a crash."
tags: [cli, kit]
pin: bb5c81cb574ea4115c6f384967ab4878cd52a9eb
origin: .
covers: [packages/core/src/modules/purity.ts, packages/cli/src/moduleload.ts, packages/cli/src/modulefixture.ts, packages/kit-code/, packages/core/src/grammar/index.ts, packages/core/src/lint/index.ts]
aliases: ["trust-law"]
---

# Loading a module

## Mechanism

A module's code runs inside the judge whenever a vault is judged, so a
bundle's verdict would otherwise depend on code this repository's gate never
proved reproducible (`packages/core/src/modules/purity.ts:5-9`). Installing
the module is the consent to run it: a workspace link, a `file:` dependency, a
packed tarball or a copy the bundle carries in its own tree at a declared
`path` was accepted when it was installed, and no machine-local approval
stands between a bundle and the law it declares
(`packages/cli/src/moduleload.ts:4-9`; [[D-007]]). What the load adds is
proof over the installed bytes, before the module judges anything.

One resolver reads a declaration: the bundle's own `node_modules`, or the
declared directory and nothing else, held to the vault path law and to the
bundle's real path (`packages/cli/src/moduleload.ts:118-199`). The digest is
one sha256 over every lexical path of the package but its own
`node_modules`, `package.json`, the fixture and a `.git` included, a
directory reached by two paths listed under both, so repointing the entry or
editing the expectation moves it; an export carries that same inventory and
digests the bytes it carried (`packages/cli/src/moduleload.ts:208-275`,
`:752-796`; see [[exports]]); the law digest every
envelope carries names it, so the bytes that judged are named wherever a
verdict is. The purity scan reads every executable file, and the entry
whatever its suffix, before any of them runs, and refuses by file and line
the ordinary ways of reaching the clock, randomness, the locale, the
environment, the network or dynamic evaluation, computed access to those
globals, and an import of any form, over the source with every comment read
through, so a comment neither hides a construct nor is one
(`packages/core/src/modules/purity.ts:44-94`, `:101-116`, `:155-259`;
`packages/cli/src/moduleload.ts:503-516`); it narrows and does
not sandbox, and says so, and it is not the argument for running a module
(`packages/core/src/modules/purity.ts:11-20`). The entry and the fixture must
be members of the digested file set (`packages/cli/src/moduleload.ts:518-544`);
the entry is imported and must default-export a manifest whose stated version
agrees with the package (`:546-576`). Then the determinism fixture runs — the
same pages judged twice in one process under the standard library plus that
module alone, compared with the findings the module ships as its own
expectation (`packages/cli/src/modulefixture.ts:75-80`, `:136-166`) — and a
module that fails it is refused with the fixture's own code and hint, from
every verb that reads the law (`packages/cli/src/moduleload.ts:578-592`).

Both proofs are kept for the process by what they proved, never by where the
bytes lie: the scan by the digest and the scan's version, the fixture by the
digest, that version and the declared name, so two bundles installing one kit
are proved once and other bytes are proved on their own
(`packages/cli/src/moduleload.ts:344-371`, `:733-738`;
`packages/core/src/modules/purity.ts:22-28`). Nothing is kept between
processes: the fixture composes the standard library and runs the judge, so
its outcome is a function of the engine too, and a read of the vault does not
run either proof again within the process
(`packages/cli/src/vaultio.ts:240-244`). The blast radius of a stranger's bug
is one arm on one item: a module that throws while parsing or in an arm is
one `module-failure` finding naming the module, its version and the arm,
routed to the kernel's `module-review` lane, and the vault still has a verdict
(`packages/core/src/grammar/index.ts:548-580`;
`packages/core/src/passes/index.ts:120-130`); a schema or a capability that
throws is a refusal of the value or the closed default, so a module's bug
makes the engine stricter, never quieter
(`packages/core/src/modules/index.ts:340-350`, `:1427-1431`).

What this costs is stated rather than hidden: nothing on the machine asks
before a module runs, so a pull that changes a carried kit or the declared
modules changes what the next verb runs, and review of that change is the
guard; and every process that loads a module runs its fixture
(`docs/roadmap.md`, "A module runs because it is installed", "A module's
proofs are taken once per process").

## Where it lives

- The resolver, the digest, the ladder and the proof cache:
  `packages/cli/src/moduleload.ts`; the scan:
  `packages/core/src/modules/purity.ts`; the fixture runner:
  `packages/cli/src/modulefixture.ts` — all in [[modules]].
- The attributed failure: `packages/core/src/grammar/index.ts:548-580` and
  `packages/core/src/lint/index.ts:1316-1339`, in [[judge]].
- The kit this bundle loads: `packages/kit-code/` with its `fixture.json`,
  declarations only ([[D-004]]).
- The decisions: [[D-002]], the digest as the one boundary, and [[D-007]],
  installing as the consent and the proofs at every load; the tests:
  `module-conformance`, `module-path`, `purity`, `pack-install` and
  `kit-code` under `packages/cli/test/`.

## Relations

- part_of [[wikiwright-architecture]]
- decided_by [[D-002]]
- decided_by [[D-007]]
