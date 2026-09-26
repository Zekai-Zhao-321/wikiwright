---
type: subsystem
title: "The standard library"
description: "Historical v1 code standard library, replaced by kernel grammar and data libraries."
tags: [stdlib]
status: retired
pin:
  commit: 4310263abeb8b8743da8c6b9eed5bcf736b2a200
  origin: .
  covers: ["packages/core/src/records/index.ts", "libraries/kit-code/types/subsystem.yaml", "libraries/kit-garden/types/planting.yaml", "libraries/source-kit/types/observation.yaml", "libraries/source-kit/types/field-note.yaml", "CHANGELOG.md"]
updated: 2026-09-26
---

# The standard library

## Responsibilities

The v1 claims, relations and entries code modules left. Their fixed record grammar and transition checks are kernel behavior; domain page kinds and policies live in data libraries.

## Entry points

Current disposition at this pin: `packages/core/src/records/index.ts`, `libraries/kit-code/types/subsystem.yaml`, `libraries/kit-garden/types/planting.yaml`, `libraries/source-kit/types/observation.yaml`, `libraries/source-kit/types/field-note.yaml`, `CHANGELOG.md`.

## State

Kit-code is a code-wiki library, kit-garden is a neutral gardening library,
and source-kit is a synthetic gardening source-policy example. A bundle
imports a library by path and contributes its own types, vocabulary entries
and tested CEL rules. Source-kit's rule requires field-note pages for
selected claim categories; it is no engine-wide evidence taxonomy.

## Invariants

No library executes code. The kernel supplies one grammar and judge to every bundle; a library only declares policy over the documented interface.

## Failure modes

Looking for a loadable standard-library package or module registry leads to deleted files. A new grammar or fixer needs an engine change.

## Relations

- part-of [[wikiwright-architecture]]
- mapped-in [[repository-layout]]
- verified-by [[testing-guide]]
