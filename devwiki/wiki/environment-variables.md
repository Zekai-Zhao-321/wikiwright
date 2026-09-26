---
type: ops-reference
title: "Environment variables"
description: "The two environment inputs the v2 CLI reads: the write date and Git-child timeout."
tags: [cli]
pin:
  commit: b1cade9a4d0d0a868340dbba7c4a02775f4c7b9f
  origin: .
  covers: ["packages/cli/src/clock.ts", "packages/cli/src/git.ts", "packages/cli/src/main.ts"]
---

# Environment variables

## Reference

WIKIWRIGHT_TODAY pins the date that write stamps on a changed page; without it the verb reads the wall clock once. WIKIWRIGHT_GIT_TIMEOUT_MS bounds each Git child, defaulting to sixty seconds.

Current source at this pin: `packages/cli/src/clock.ts`, `packages/cli/src/git.ts`, `packages/cli/src/main.ts`.

The shell validates the timeout before a verb runs. Git reads use LC_ALL=C and GIT_OPTIONAL_LOCKS=0, with at most four asynchronous children at a time.

A malformed timeout is a usage refusal. Tests that write dated pages set WIKIWRIGHT_TODAY so a fixture is byte-reproducible.

A child still running at its bound is killed and reported git-timeout. An invalid date or timeout is refused before a page is moved.

## Relations

- part-of [[command-runtime]]
- mapped-in [[repository-layout]]
