---
type: ops-reference
title: "The envelope and exit codes"
description: "Every verb prints one JSON envelope on stdout, and a vault verb's names the bundle it read; the exit code is one of seven, each mapped to one error type; lint, check and gate share one verdict block, and the writing verbs report the pages they wrote."
tags: [cli]
pin:
  commit: 3d81407b9af92945288e7c9ab27ed671aa49e0a4
  origin: .
  covers: [packages/cli/src/envelope.ts, packages/cli/src/main.ts, packages/cli/src/argv.ts]
---

# The envelope and exit codes

## Reference

An `ok` envelope is `{ ok: true, data, metadata: { command, engine, bundle? } }`;
an error envelope is `{ ok: false, data?, error: { code, exit_code, type,
message, hint?, details? }, metadata }`
(`packages/cli/src/envelope.ts:66-90`, `:101-125`). `metadata.engine` is
`0.1.0` (`:24`). `metadata.bundle` — `label`, `root`, `head`, `dirty`, `law`,
`content`, over a copy `export`, the export its marker names, and under
`--bundle` `shadowed`, the farther copies of the same bundle (`:26-64`) —
is on the envelope of every verb that reads a vault's law whose root holds a
constitution, ok or refused, and on no envelope answered before the verb runs
(`packages/cli/src/main.ts:68-84`, `:293-295`; see [[exports]]).
`error.code` is one kebab-case word per meaning and `details` carries the
machine recovery data; a refusal that carries a verdict puts it in `data`
beside `error` (`packages/cli/src/envelope.ts:118-124`). The envelope goes to
stdout, the verb's stderr text to stderr, and the process exit code is the
envelope's (`packages/cli/src/main.ts:25-30`).

| Exit | `error.type` | Meaning | Where |
| --- | --- | --- | --- |
| 0 | — | ok | `envelope.ts:9` |
| 1 | `internal` | the engine broke; `unexpected-error` carries the thrown message, `git-short-read` a git answer that ended before its terminator, and `git-inconsistent-read` two git answers about one state that disagree | `envelope.ts:10`; `main.ts:97-120` |
| 2 | `usage` | a verb, flag, positional, subcommand or environment variable the caller got wrong; `--bundle` beside `--root`, a name outside the skill grammar, or one two bundles answer; a writing verb aimed at an installed copy | `envelope.ts:11`; `argv.ts:92-151`; `main.ts:133-204`, `:233-261`, `:349-372` |
| 2 | `constitution` | the law did not load, a declared module did not load, or the engine pin refused; nothing was judged | `envelope.ts:12-15` |
| 3 | `not_found` | the page, section, type, vocabulary entry, revision, directory or bundle skill asked for does not exist | `envelope.ts:16` |
| 4 | `conflict` | the state refuses the operation: a stale base, a foreign hook, an `--expect` mismatch, unmerged paths, a splice the Writer cannot prove, a vault path that resolves outside the vault, a copy's marker that is not one | `envelope.ts:17`; `main.ts:97-120`, `:233-261` |
| 5 | `findings` | the tool worked and the subject failed; read `data.findings` | `envelope.ts:18` |
| 10 | `confirm_required` | an identity or blast-radius gate wants the plan pinned | `envelope.ts:19` |

The runtime's own codes: `unknown-command` with `valid_commands`
(`packages/cli/src/main.ts:349-355`), `role-unknown` with `valid_values`
(`:357-363`), `role-forbidden` with the caller's role and the verbs it may run
(`:318-341`); for `--bundle`, `one-target` beside `--root`,
`bundle-name-invalid` with the grammar, `bundle-not-found` with `searched`,
`names` and `skipped`, and `bundle-ambiguous` with every `candidate`, each
before the verb runs (`:133-204`); over a marked root, `export-marker-invalid`
with the marker's `path` and the first `reason` it is not one, and
`bundle-readonly` with `export`, `contribution` and `root`, before any module
preloads (`:233-261`); `git-short-read` with the
git command as `command`, from any verb whose git answer was cut short, and
`git-inconsistent-read` with both commands as `commands`, from any verb two
of whose git answers disagree, and `linked-outside-vault` with the vault
`path` a read met that resolves outside the vault (`:97-120`, [[git]]);
`unknown-flag` with `valid_flags`
(`packages/cli/src/argv.ts:95-104`), `invalid-arguments` (`:105-110`),
`unexpected-argument` with `expected_positionals` (`:112-129`),
`missing-argument` and `unknown-subcommand` with `valid_values`
(`:133-151`).

`lint`, `check` and `gate` answer with one verdict block rendered by
`verdictEnvelope` (`envelope.ts:127-139`), whole:

| Key | Meaning |
| --- | --- |
| `findings` | the findings, capped at `--limit` (default 50), error-first; `--rule` and `--path` filter before the cap and `--all` lifts it (`envelope.ts:141-160`; `packages/core/src/judge/index.ts:164`, `:643-650`) |
| `summary` | `pages`, `errors`, `warnings`, `infos`, `by_rule`, `excepted`, `unevaluated`, over the uncapped set; the exit code follows `errors` (`packages/core/src/judge/index.ts:674-682`) |
| `coverage.passes` | per pass: `evaluated`, `not_applicable`, `unevaluable`, `reason` (`packages/core/src/judge/index.ts:122-135`) |
| `unevaluated` | the passes a declaration turned on that this run could not judge, keyed by pass with a count and `no-base` (`:137-145`) |
| `caps` | `limit` and `hit` (`:683`) |
| `dispositions` | per page, the counted transition outcomes where a base exists (`:148-149`) |

The writing verbs judge with the same judge and answer in their own shapes.
`write` and `new` report the page they wrote — its `path`, `findings`,
`dispositions`, `claims` and `digest`, beside the `unevaluated` passes —
not the vault-wide `summary`, `coverage` and `caps`; `write --from` reports
one row per draft under `pages` — `path`, `created`, `findings`,
`dispositions`, `claims` and `digest` — with `unevaluated` once at the top
level (see [[writer-and-staged-gate]]). `fix` reports what it changed, the
ops it applied and whether the proof held (see [[fixers]]).

A writing verb under `--dry-run` answers `{ ops: [{ kind, path, from?,
summary }], wrote: false }` with `kind` one of `create`, `write`, `append`,
`copy`, `rename`, `delete` (`packages/cli/src/spec.ts:75-107`). `--help` on
any verb returns the spec's row — name, role, summary, positionals,
subcommands, flags, examples, global flags — as an `ok` envelope
(`packages/cli/src/main.ts:32-48`).

## Relations

- part-of [[command-runtime]]
- mapped-in [[repository-layout]]
