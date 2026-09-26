---
type: subsystem
title: "Freshness and pins"
description: "Local Git pin measurement and evidence status shown by read and search."
tags: [cli]
pin:
  commit: 4310263abeb8b8743da8c6b9eed5bcf736b2a200
  origin: .
  covers: ["packages/cli/src/pins.ts", "packages/cli/src/verbs/check.ts", "packages/cli/src/verbs/read.ts", "packages/cli/src/verbs/search.ts"]
updated: 2026-09-26
---

# Freshness and pins

## Responsibilities

A pin records a commit, origin and covered paths. Check measures local origins against the enclosing repository; changed covered paths mark the pin stale and linked pages stale-source-cited.

## Entry points

Current source at this pin: `packages/cli/src/pins.ts`, `packages/cli/src/verbs/check.ts`, `packages/cli/src/verbs/read.ts`, `packages/cli/src/verbs/search.ts`.

## State

Read and search compute stale true, false or null with a reason. A remote-origin pin is unmeasured; the engine does not reach the network. The queue's unresolved ids are shown only while its law and content digests match.

## Invariants

A path and cited line are held to the pinned tree. The engine does not infer whether the cited sentence remains semantically true.

## Failure modes

Missing history makes a pin unknown or unmeasured, not fresh. A remote capture can change without this engine noticing; re-read and re-pin before claiming freshness.

## Relations

- part-of [[wikiwright-architecture]]
- mapped-in [[repository-layout]]
- verified-by [[testing-guide]]
