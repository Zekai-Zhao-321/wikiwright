---
type: ops-reference
title: "Environment variables"
description: "The environment inputs the v2 CLI reads: the write date, the Git-child timeout and the page-read cache location."
tags: [cli]
pin:
  commit: 48bf96b7f5a8774a05b63e3280bf81768b227c32
  origin: .
  covers: ["packages/cli/src/clock.ts", "packages/cli/src/git.ts", "packages/cli/src/main.ts", "packages/cli/src/pagecache.ts"]
---

# Environment variables

## Reference

WIKIWRIGHT_TODAY pins the date that write stamps on a changed page; without it the verb reads the wall clock once. WIKIWRIGHT_GIT_TIMEOUT_MS bounds each Git child, defaulting to sixty seconds.

WIKIWRIGHT_CACHE_DIR names the directory that keeps earlier page reads; without it the CLI uses the platform's user cache directory. WIKIWRIGHT_NO_CACHE set to anything but empty or 0 turns that store off, so every page is parsed again.

Current source at this pin: `packages/cli/src/clock.ts`, `packages/cli/src/git.ts`, `packages/cli/src/main.ts`, `packages/cli/src/pagecache.ts`.

The shell validates the timeout before a verb runs. Git reads use LC_ALL=C and GIT_OPTIONAL_LOCKS=0, with at most four asynchronous children at a time.

A malformed timeout is a usage refusal. Tests that write dated pages set WIKIWRIGHT_TODAY so a fixture is byte-reproducible.

A child still running at its bound is killed and reported git-timeout. An invalid date or timeout is refused before a page is moved. A cache directory that cannot be created or written is not an error: the verb reads every page and answers the same.

## Relations

- part-of [[command-runtime]]
- mapped-in [[repository-layout]]
