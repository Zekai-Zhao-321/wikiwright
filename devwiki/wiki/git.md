---
type: integration
title: "Git"
description: "Asynchronous file-backed Git transport for staged, revision and local-pin reads."
tags: [cli]
pin:
  commit: 179fb9f6edc0eec03b113c33bd5c2c0648231ff2
  origin: .
  covers: ["packages/cli/src/git.ts", "packages/cli/src/stdoutfile.ts", "packages/cli/src/lawstate.ts", "packages/cli/src/lawfiles.ts"]
---

# Git

## Contract

The shell reads Git index entries, staged differences and blobs, revision trees, and local pin history. Each child writes stdout to a file; batch requests are files too. No child is spawned synchronously by the engine.

Current source at this pin: `packages/cli/src/git.ts`, `packages/cli/src/stdoutfile.ts`, `packages/cli/src/lawstate.ts`, `packages/cli/src/lawfiles.ts`.

At most four children run at once. The index state uses object ids and HEAD as its base; the law adapter reads constitution and library blobs from the same selected state.

A short answer, a contradictory index listing and diff, or a mismatched batch row is refused before judgment. The first commit is cross-checked as well.

## Failure modes

Unmerged paths, absent repositories, Git-child failures and timeouts have separate refusals. The transport never fetches a remote origin.

## Relations

- part-of [[writer-and-staged-gate]]
- part-of [[freshness]]
- mapped-in [[repository-layout]]
