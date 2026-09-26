---
type: code-concept
title: "Loading a module"
description: "Historical v1 executable module loading, removed from the v2 engine."
tags: [cli, kit]
aliases: ["trust-law"]
status: retired
pin:
  commit: 29cf0dbf5608db22b6ee5d8136125eeea2c0ce45
  origin: .
  covers: ["CHANGELOG.md", "docs/roadmap.md"]
---

# Loading a module

## Mechanism

The v1 loader resolved executable modules, scanned them and ran a determinism fixture. All of that left in the v2 rewrite. A v2 bundle imports data-only library documents by path.

There is no module install, grant, preload or fixture execution during a v2 bundle read. Rule behavior is bounded CEL over the page interface.

A bundle cannot make the engine execute code from its tree. A requirement the fixed interface cannot express needs a kernel change or an explicit stated gap.

## Where it lives

Current disposition at this pin: `CHANGELOG.md`, `docs/roadmap.md`.

The old loading procedure no longer works; modules is an unknown command. Treating an installed package as active law would omit its bytes from the v2 law digest.

## Relations

- part-of [[wikiwright-architecture]]
- decided-by [[D-002]]
- decided-by [[D-007]]
