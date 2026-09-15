---
type: ops-reference
title: "Environment variables"
description: "The four WIKIWRIGHT_ variables the engine or its hooks read, what reads each, the one git variable the engine sets and the four it removes."
tags: [cli]
pin: 293c3a7d897f28d6a9c7df717998cc29ef9dce7e
origin: .
covers: [packages/cli/src/clock.ts, packages/cli/src/main.ts, packages/cli/src/trust.ts, packages/cli/src/hooks.ts, packages/cli/src/git.ts]
---

# Environment variables

## Reference

These are every `process.env` read under
`packages/cli/src` and the one variable the installed hooks read.

| Variable | Read by | Effect |
| --- | --- | --- |
| `WIKIWRIGHT_ROLE` | `main.ts:84-90`, before `--help` and before parsing | `consumer`, `writer` or `maintainer`; unset or empty is `maintainer`. A verb above the caller's rank exits 2 with `role-forbidden` and `details.valid_commands` filtered to the rank (`main.ts:98-115`); an unrecognised value exits 2 with `role-unknown` and `details.valid_values`, never a fallback (`:131-137`). A guard rail, not a security boundary (`:78-83`) |
| `WIKIWRIGHT_TODAY` | `clock.ts:11-22`, once per process, by every verb that stamps a date | the date the verb stamps as `YYYY-MM-DD`; the wall clock otherwise (`:15`). A value that is not a date throws before anything moves (`:18-20`). The judge never reads it (`:1-4`) |
| `WIKIWRIGHT_TRUST_FILE` | `trust.ts:67-71`, by `trust` and by the module loader | the path of the machine-local grant store; default `~/.config/wikiwright/trust.json`. The suite points it at a file beside each test's bundle (`packages/cli/test/fixtures/kit-code.ts:29-37`) |
| `WIKIWRIGHT_BYPASS` | the installed `pre-commit` and `commit-msg` hooks, rendered by `hooks.ts:18-30` | when non-empty, the hook logs the UTC time, the reason with tabs and newlines collapsed, and the author into `<git-dir>/wikiwright-bypass.log`, prints one line and exits 0 — after the bundle's chained script has run (`hooks.ts:11-17`, `:120-126`) |
| `GIT_TERMINAL_PROMPT` | set to `0` by `git.ts:170` on every call that may reach the network | a private origin fails instead of hanging on a credential prompt; the call also runs under a 30-second timeout (`git.ts:150`, `:169-177`) |

The installed hooks also read `PATH`: when no `wikiwright` is found they
print one line and let the commit through (`hooks.ts:41-48`). The
repository's own development gate unsets `GIT_INDEX_FILE`, `GIT_DIR`,
`GIT_WORK_TREE`, `GIT_PREFIX` and the author and committer identity before
running the suite, because git exports them into a hook and the suite creates
repositories of its own (`scripts/hooks/pre-commit:24-33`; see
[[repository-scripts]]).

The engine removes `GIT_DIR`, `GIT_WORK_TREE`, `GIT_COMMON_DIR` and
`GIT_INDEX_FILE` from the one git call that reads a vault's worktree scope
for a trust grant, for the same reason: inside a hook, `rev-parse` would take
the directory it runs in for the top of the work tree (`git.ts:431-474`; see
[[git]]).

## Relations

- part_of [[command-runtime]]
- mapped_in [[repository-layout]]
