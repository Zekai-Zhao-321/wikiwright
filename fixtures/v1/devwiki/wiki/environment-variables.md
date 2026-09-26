---
type: ops-reference
title: "Environment variables"
description: "The five WIKIWRIGHT_ variables the engine or its hooks read, what reads each, the one git variable the engine sets and the four it removes."
tags: [cli]
pin: 3d81407b9af92945288e7c9ab27ed671aa49e0a4
origin: .
covers: [packages/cli/src/clock.ts, packages/cli/src/main.ts, packages/cli/src/spec.ts, packages/cli/src/discovery.ts, packages/cli/src/hooks.ts, packages/cli/src/git.ts]
---

# Environment variables

## Reference

These are every `process.env` read under
`packages/cli/src` and the one variable the installed hooks read.

| Variable | Read by | Effect |
| --- | --- | --- |
| `WIKIWRIGHT_ROLE` | `spec.ts:120-129`, the one reader: `main.ts:310-316` bounds the surface by it before `--help` and before parsing, and `brief` takes it as its default `--role` (`packages/cli/src/verbs/brief.ts:85-86`) | `consumer`, `writer` or `maintainer`; unset or empty is `maintainer`. A verb above the caller's rank exits 2 with `role-forbidden` and `details.valid_commands` filtered to the rank (`main.ts:318-341`); an unrecognised value exits 2 with `role-unknown` and `details.valid_values`, never a fallback (`:357-363`). A guard rail, not a security boundary (`:304-309`) |
| `WIKIWRIGHT_TODAY` | `clock.ts:11-22`, once per process, by every verb that stamps a date | the date the verb stamps as `YYYY-MM-DD`; the wall clock otherwise (`:15`). A value that is not a date throws before anything moves (`:18-20`). The judge never reads it (`:1-4`) |
| `WIKIWRIGHT_SYSTEM_SKILL_DIR` | `discovery.ts:88-102`, by the `--bundle` resolution and `bundles list` | the machine's skill directory, scanned after the user's two; `/etc/codex/skills` when unset (`:46`), and none when empty. The suite sets it to a directory under the temporary directory that nothing creates, so no test probes a real machine's (`packages/cli/test/fixtures/runtime.ts:16-19`) |
| `WIKIWRIGHT_SKILL_DIRS` | `discovery.ts:88-102`, by the `--bundle` resolution and `bundles list` | more skill directories to scan after the project's, the user's and the machine's, colon-separated, in order, each resolved against the working directory. The user tier is read under `HOME`, which the suite points at a directory under each test's temporary directory, so no test reads a skill directory of the developer's (`packages/cli/test/bundles.test.ts:1-9`) |
| `WIKIWRIGHT_BYPASS` | the installed `pre-commit` and `commit-msg` hooks, rendered by `hooks.ts:18-30` | when non-empty, the hook logs the UTC time, the reason with tabs and newlines collapsed, and the author into `<git-dir>/wikiwright-bypass.log`, prints one line and exits 0 — after the bundle's chained script has run (`hooks.ts:11-17`, `:116-122`) |
| `GIT_TERMINAL_PROMPT` | set to `0` by `git.ts:246` on every call that may reach the network | a private origin fails instead of hanging on a credential prompt; the call also runs under a 30-second timeout (`git.ts:230`, `:245-253`) |

The installed hooks also read `PATH`: when no `wikiwright` is found they
print one line and let the commit through (`hooks.ts:41-48`). The
repository's own development gate unsets `GIT_INDEX_FILE`, `GIT_DIR`,
`GIT_WORK_TREE`, `GIT_PREFIX` and the author and committer identity before
running the suite, because git exports them into a hook and the suite creates
repositories of its own (`scripts/hooks/pre-commit:24-33`; see
[[repository-scripts]]). The suite reads one variable the engine never does:
`WIKIWRIGHT_CLI_RUNTIME`, the runtime a test runs the CLI under, which
`tools/run-suite.ts` sets to the `node` on PATH
(`packages/cli/test/fixtures/runtime.ts:14`; see [[testing-guide]]).

The engine removes `GIT_DIR`, `GIT_WORK_TREE`, `GIT_COMMON_DIR` and
`GIT_INDEX_FILE` from the git call that reads where a vault sits — the
`status` behind the head and dirt an envelope's bundle block reports — for
the same reason: inside a hook, `git` would take the directory it runs in for
the top of the work tree (`git.ts:584-585`, `:595-646`; see [[git]]). Every git answer is written to
a file under the directory `os.tmpdir()` names — `TMPDIR` on a POSIX
system — and removed once read, so that variable decides where those files
briefly live (`packages/cli/src/stdoutfile.ts`; see [[git]]).

## Relations

- part_of [[command-runtime]]
- mapped_in [[repository-layout]]
