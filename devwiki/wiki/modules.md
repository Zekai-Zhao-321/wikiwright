---
type: subsystem
title: "Modules, the loader and the fixture"
description: "Historical v1 registration API and code modules, replaced by data libraries."
tags: [kernel, cli]
aliases: ["modules-and-trust"]
status: retired
pin:
  commit: 1bebda0ca948b352d74c663d205f2963aea26c7f
  origin: .
  covers: ["CHANGELOG.md", "docs/roadmap.md"]
---

# Modules, the loader and the fixture

## Responsibilities

The v1 ModuleManifest, registration arms and code kit package are removed. Types, fragments, vocabularies and tested CEL rules now live in YAML documents under a bundle or imported library.

## Entry points

Current disposition at this pin: `CHANGELOG.md`, `docs/roadmap.md`.

## State

The v2 engine.json has libraries but no modules key. The loader reads library documents from the same working tree, index or revision as pages.

## Invariants

No library ships executable hooks. A type's policy is data, and the kernel supplies the fixed mechanics.

## Failure modes

A v1 module declaration is engine-invalid under schema version 4. The migration tool refuses the removed code-kit package before writing a converted bundle.

## Relations

- part-of [[wikiwright-architecture]]
- mapped-in [[repository-layout]]
- verified-by [[testing-guide]]
- decided-by [[D-002]]
- decided-by [[D-003]]
- decided-by [[D-007]]
