---
type: subsystem
title: "Exports"
description: "Historical v1 export copies; the v2 binary has no export planner or copy identity."
tags: [cli]
status: retired
pin:
  commit: f1dc7deae8b129b74e9db2eb37da44b927ae22f6
  origin: .
  covers: ["CHANGELOG.md", "docs/roadmap.md"]
updated: 2026-09-26
---

# Exports

## Responsibilities

This page records a removed v1 mechanism. The v2 engine has no export declaration, export verb, selected copy, marker or bundle-readonly refusal. Sharing a bundle now means sharing its repository.

## Entry points

Current disposition at this pin: `CHANGELOG.md`, `docs/roadmap.md`.

## State

There is no live export state or generated copy in the v2 law. The roadmap states the loss and the trigger for a future identity-checked selection.

## Invariants

A copied directory is not guaranteed read-only or tied to its source by this engine. A reader must verify the repository and bundle identity by other means.

## Failure modes

Treating a hand-copied subset as an engine export can hide omitted pages and permit writes. The v2 CLI reports export as an unknown command.

## Relations

- part-of [[wikiwright-architecture]]
- mapped-in [[repository-layout]]
- verified-by [[testing-guide]]
