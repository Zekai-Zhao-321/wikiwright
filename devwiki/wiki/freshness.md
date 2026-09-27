---
type: subsystem
title: "Freshness and pins"
description: "Local Git pin measurement and evidence status shown by read and search."
tags: [cli]
pin:
  commit: 1a1a90c11329d82c9b2c6e92c6fa8e16160c0613
  origin: .
  covers: ["packages/cli/src/pins.ts", "packages/cli/src/verbs/check.ts", "packages/cli/src/verbs/read.ts", "packages/cli/src/verbs/search.ts"]
updated: 2026-09-27
---

# Freshness and pins

## Responsibilities

A pin records a commit, origin and covered paths. Check, read and search observe the enclosing repository (`.`) or a named local Git repository explicitly bound by `local_origins`. Each measurement captures a full HEAD id and uses immutable commit ids for history, coverage and citation comparisons; discovery, capture and final recheck still observe local metadata. Changed covered paths mark the pin stale and linked pages stale-source-cited.

## Entry points

Current source at this pin: `packages/cli/src/pins.ts`, `packages/cli/src/verbs/check.ts`, `packages/cli/src/verbs/read.ts`, `packages/cli/src/verbs/search.ts`.

## State

Read and search compute stale true, false or null with a reason. An unbound or URL origin is unmeasured; the engine does not reach the network. A missing source path, invalid cover or unmeasured directly linked source also leaves status unverified. The queue's unresolved ids are shown only while its law and content digests match, including source-path membership.

## Invariants

A cover must exist at the pinned commit; deletion after it makes the pin stale. A blob cover owns its exact file, a tree cover owns descendants and `.` owns the whole repository. Only inline paths inside this pin's covers are checked at its tree; outside path-shaped spans and their bare-line follow-ups are counted as unverified for that pin. Overlapping pins measure their own paths independently. The engine does not infer whether a cited sentence remains semantically true.

## Failure modes

Missing history makes a pin unknown or unmeasured, not fresh. A missing pinned cover is invalid; a moving local HEAD is retried once, then refused. A URL origin can change without this engine noticing; re-read and re-pin before claiming freshness.

## Relations

- part-of [[wikiwright-architecture]]
- mapped-in [[repository-layout]]
- verified-by [[testing-guide]]
