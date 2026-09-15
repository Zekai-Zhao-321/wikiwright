---
type: ops-reference
title: "The envelope and exit codes"
description: "Every verb prints one JSON envelope on stdout; the exit code is one of seven, each mapped to one error type; the judging verbs share one verdict block."
tags: [cli]
pin: a38be783d7393d145ba7950daf1b0ca2c1c4fbad
origin: .
covers: [packages/cli/src/envelope.ts, packages/cli/src/main.ts, packages/cli/src/argv.ts]
---

# The envelope and exit codes

## Reference

An `ok` envelope is `{ ok: true, data, metadata: { command, engine } }`; an
error envelope is `{ ok: false, data?, error: { code, exit_code, type,
message, hint?, details? }, metadata }`
(`packages/cli/src/envelope.ts:31-49`, `:60-84`). `metadata.engine` is
`0.1.0` (`:24`). `error.code` is one kebab-case word per meaning and
`details` carries the machine recovery data; a refusal that carries a verdict
puts it in `data` beside `error` (`:72-83`). The envelope goes to stdout, the
verb's stderr text to stderr, and the process exit code is the envelope's
(`packages/cli/src/main.ts:10-15`).

| Exit | `error.type` | Meaning | Where |
| --- | --- | --- | --- |
| 0 | — | ok | `envelope.ts:9` |
| 1 | `internal` | the engine broke; `unexpected-error` carries the thrown message | `envelope.ts:10`; `main.ts:62-69` |
| 2 | `usage` | a verb, flag, positional, subcommand or environment variable the caller got wrong | `envelope.ts:11`; `argv.ts:92-151`; `main.ts:123-146` |
| 2 | `constitution` | the law did not load, a declared module did not load, or the engine pin refused; nothing was judged | `envelope.ts:12-15` |
| 3 | `not_found` | the page, type, vocabulary entry, revision, directory or grant asked for does not exist | `envelope.ts:16` |
| 4 | `conflict` | the state refuses the operation: a stale base, a foreign hook, an `--expect` mismatch, unmerged paths, a splice the Writer cannot prove | `envelope.ts:17` |
| 5 | `findings` | the tool worked and the subject failed; read `data.findings` | `envelope.ts:18` |
| 10 | `confirm_required` | an identity or blast-radius gate wants the plan pinned | `envelope.ts:19` |

The runtime's own codes: `unknown-command` with `valid_commands`
(`main.ts:123-129`), `role-unknown` with `valid_values` (`:131-137`),
`role-forbidden` with the caller's role and the verbs it may run
(`:98-115`); `unknown-flag` with `valid_flags` (`argv.ts:95-104`),
`invalid-arguments` (`:105-110`), `unexpected-argument` with
`expected_positionals` (`:112-129`), `missing-argument` and
`unknown-subcommand` with `valid_values` (`:133-151`).

The judging verbs — `lint`, `check`, `gate`, `write`, `fix`, `new` — share
one verdict block rendered by `verdictEnvelope` (`envelope.ts:87-98`):

| Key | Meaning |
| --- | --- |
| `findings` | the findings, capped at `--limit` (default 50), error-first; `--rule` and `--path` filter before the cap and `--all` lifts it (`envelope.ts:101-119`; `packages/core/src/judge/index.ts:164`, `:643-650`) |
| `summary` | `pages`, `errors`, `warnings`, `infos`, `by_rule`, `excepted`, `unevaluated`, over the uncapped set; the exit code follows `errors` (`packages/core/src/judge/index.ts:674-682`) |
| `coverage.passes` | per pass: `evaluated`, `not_applicable`, `unevaluable`, `reason` (`packages/core/src/judge/index.ts:122-135`) |
| `unevaluated` | the passes a declaration turned on that this run could not judge, keyed by pass with a count and `no-base` (`:137-145`) |
| `caps` | `limit` and `hit` (`:683`) |
| `dispositions` | per page, the counted transition outcomes where a base exists (`:148-149`) |

A writing verb under `--dry-run` answers `{ ops: [{ kind, path, from?,
summary }], wrote: false }` with `kind` one of `create`, `write`, `append`,
`copy`, `rename`, `delete` (`packages/cli/src/spec.ts:66-98`). `--help` on
any verb returns the spec's row — name, role, summary, positionals,
subcommands, flags, examples, global flags — as an `ok` envelope
(`main.ts:17-33`).

## Relations

- part_of [[command-runtime]]
- mapped_in [[repository-layout]]
