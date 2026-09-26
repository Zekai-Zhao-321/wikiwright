---
type: ops-reference
title: "The envelope and exit codes"
description: "The CLI JSON envelope, output bound and closed exit-code taxonomy."
tags: [cli]
pin:
  commit: 1a1a90c11329d82c9b2c6e92c6fa8e16160c0613
  origin: .
  covers: ["packages/cli/src/envelope.ts", "packages/cli/src/main.ts", "packages/cli/src/commands.ts"]
---

# The envelope and exit codes

## Reference

Every invocation prints one JSON envelope. A refusal has a machine-readable code, type, exit code and details; a verdict stays in data. A law-reading verb includes the bundle label, real root, Git state and law and content digests.

Current source at this pin: `packages/cli/src/envelope.ts`, `packages/cli/src/main.ts`, `packages/cli/src/commands.ts`.

The output writer emits JSON on stdout and human gate text on stderr. An envelope over one MiB is refused unless --out names a file outside the bundle and its selected imported law. The output path resolves parent aliases, refuses a leaf symbolic link, and is conservative inside the enclosing repository before law selection. Check --summary keeps verdict totals and exit; with --out the file receives uncapped detail and stdout a compact view or bounded pointer.

Exit 0 is success; 1 internal, 2 usage or constitution, 3 not found, 4 conflict and 5 findings. A code keeps one meaning and exit type across verbs.

A short or contradictory Git answer is refused by name. Git-child failures are git-unavailable, while an engine fault remains unexpected-error; neither is silently judged as an empty state.

## Relations

- part-of [[command-runtime]]
- mapped-in [[repository-layout]]
