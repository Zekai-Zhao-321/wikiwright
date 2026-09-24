---
type: integration
title: "Git"
description: "The one external system: git is spawned as plumbing for the index, HEAD, revisions, the enclosing repository, a vault's checkout state, remote heads and blobless origin caches; never a library, never a prompt, and every answer read from a file git wrote itself."
tags: [cli]
pin: 57fba48133394eca1793e1374b4054d6b2b8eb1c
origin: .
covers: [packages/cli/src/git.ts, packages/cli/src/stdoutfile.ts, packages/cli/src/state.ts, packages/cli/src/buildinfo.ts, packages/core/src/gitplan/]
---

# Git

## Contract

Git is spawned as plumbing and never linked as a library
(`packages/cli/src/git.ts:1-2`). Every call goes through one helper,
`spawnWithStdoutFile` (`packages/cli/src/stdoutfile.ts:57-109`), through
`gitRun` and `gitText` (`packages/cli/src/git.ts:76-108`): it runs with the
vault root as its working directory, stdout on a file and stderr captured
onto the thrown error rather than printed beside an envelope; the batch
reads hand git their object names or paths as a file on stdin
(`:401-415`), and the read of a vault's checkout state passes an environment
without the variables a git hook exports (`:563-564`, `:574-625`). What the
engine asks of it:

| Call | Where | For |
| --- | --- | --- |
| `diff --cached --name-status -z -M --relative` | `git.ts:110-115` | the staged changes, vault-root-relative, renames detected; once per run, through `indexSnapshot` (`state.ts:60-81`) |
| `show :./<path>` | `git.ts:117-120` | a config file's index bytes, through the staged reader |
| `show HEAD:./<path>` | `git.ts:122-144` | a rename source's last committed bytes, only when its name holds a newline, the one name `cat-file`'s line protocol cannot carry |
| `ls-files -s -z` | `git.ts:154-167` | the paths the index holds, each with its blob and stage; once per run, in the same snapshot |
| `cat-file --batch-check`, `cat-file --batch` | `git.ts:443-510` | every page of the index or of a revision, and every base, by blob id: the sizes in one process, then the bytes in one process per 32 MiB |
| `cat-file --batch-check` over `HEAD:./<path>` | `git.ts:522-561` | the blob HEAD holds at every path a changed or deleted page is judged against, in one process; a path HEAD does not hold is `missing` |
| `rev-parse HEAD` | `git.ts:169-173` | the head of origin `.` |
| `rev-parse --show-toplevel` | `git.ts:182-193` | the repository enclosing the vault |
| `--no-optional-locks status --porcelain=v2 --branch --untracked-files=all -- .` | `git.ts:574-625` | the checkout a vault root sits in, for the bundle block every vault envelope carries: the `# branch.oid` header is the head, any entry makes it dirty; one process (`packages/cli/src/bundle.ts:124`) |
| `rev-parse --verify --quiet HEAD` | `git.ts:203-215` | whether the repository has a commit |
| `ls-remote --quiet <origin> HEAD` | `git.ts:256-265` | a remote head with no clone |
| `init --bare`, `fetch --filter=blob:none --no-tags <origin> +HEAD:refs/wikiwright/head` | `git.ts:274-300` | the blobless cache per origin, retried whole when a server refuses filters |
| `rev-parse --verify --quiet <ref>`, `merge-base --is-ancestor`, `rev-list --count` | `git.ts:303-330`, `:366-369` | whether a pin is known and on the head's history, and how far behind |
| `ls-tree --name-only <rev>`, `cat-file -t <spec>`, `cat-file -p <spec>` | `git.ts:338-363` | the tree at a pin and a cited blob's type and line count, for a page's citations |
| `diff --name-only -z --no-renames <pin> <head> -- :(top)<path>…` | `git.ts:379-391` | the covering diff, repository-root-relative when the vault is embedded |
| `rev-list --first-parent --reverse`, `rev-list --parents -n 1`, `ls-tree -r -z`, `cat-file blob`, `diff --name-status -z -M <base>..<rev>` | `state.ts:214-257`, `:265-292`, `:300-340` | the replay's commit pairs, each revision's constitution, and its page set through the batch read |
| `-C <package> ls-files --error-unmatch package.json`, `rev-parse --short HEAD`, `status --porcelain` | `buildinfo.ts:14-43` | the checkout the binary sits in, demoted to `checkout_commit` |

A call that may reach the network runs with `GIT_TERMINAL_PROMPT=0` so a
private origin fails instead of hanging on a credential prompt, and under a
30-second timeout so a dead host is an answer; a non-zero exit is the origin's
refusal, never a throw (`git.ts:228`, `:233-253`). The cache keeps the
origin's head under `refs/wikiwright/head` (`:230-231`) and `--no-renames`
keeps a blobless cache blobless (`:371-378`). Origin `.` is the work tree
`rev-parse --show-toplevel` finds from the vault root, so a vault in a
directory of the repository it documents pins to that repository's commits
(`:175-181`). The empty tree is the base of a repository's first commit
(`state.ts:251-257`).

Every answer is read from a file git wrote itself, and every request handed
over in a file the engine wrote. The helper creates a fresh file under
`os.tmpdir()`, exclusively and readable only by this user, hands it to git
as its stdout, reads it once git has exited, and removes it; when there is a
request it writes it whole to a second such file first and hands git that
file as its stdin, removing it in the same place, on an error or a timeout
too (`packages/cli/src/stdoutfile.ts:1-18`, `:63-109`). No request or answer
travels through a pipe the runtime fills or drains, so exit 0 and the answer
file are the whole answer to the whole request: under load, Bun's
synchronous spawn once handed back a piped answer cut to a prefix with exit
0, and a prefix that ends between records is as well formed as the whole —
a cut index listing is fewer staged pages, and no check on the bytes could
tell (`docs/roadmap.md`) — while a request cut inside its last path had git
answer `missing` for a shorter path. The files prove no more than that: not
that git told the truth, nor that the repository held still between two
reads. stderr stays a pipe and is read: a path HEAD does not hold, a
directory in no repository and a server that refuses a filtered fetch are
recognised from its text (`packages/cli/src/git.ts:135-141`, `:189`,
`:291`), and each, with its text lost, fails as a plumbing failure or an
unreachable origin rather than a smaller answer
(`packages/cli/src/stdoutfile.ts:19-24`).

Each batch read holds its answer to its request: the number of rows
(`packages/cli/src/git.ts:452-457`, `:534-539`), and each row to the request
at its position (`:417-431`) — the object ids `gitReadBlobs` asks for come
back as themselves or echoed `missing` (`:458-463`), and of the `HEAD:./`
paths `gitHeadBlobs` asks for, a row git could not resolve echoes its path
while a row it resolved must be a blob (`:540-555`); otherwise
`GitInconsistentRead`. A batch stream that does not end in a newline, stops
inside an object or holds fewer objects than its chunk is `GitShortRead`
(`:473-497`).

Two further lines stay behind the file. Every answer that has a terminator
is still held to it: `terminated` (`:54-74`) passes an empty answer, or one
that ends in its terminator — a NUL for a `-z` listing, a newline for a line
answer — and, for a read that always prints something, refuses an empty one
as well; anything else is `GitShortRead` (`:22-37`). And two cross-checks
catch a listing cut at a record boundary, which no terminator can see
(`:39-52`): every path the staged diff names as added, modified, retyped,
renamed or copied must be in the index listing
(`packages/cli/src/state.ts:60-84`), and a commit walk must list as many
commits as `rev-list --count` counts in its range (`:218-232`); either
failing is `GitInconsistentRead`. Both share `GitAnswerRefused`
(`packages/cli/src/git.ts:14-20`), which every plumbing catch rethrows as
itself rather than turn it into `git-unavailable` or `revision-not-found`,
and which the runtime answers as `git-short-read` or
`git-inconsistent-read`, exit 1, `internal`, naming the commands (see
[[command-runtime]] and [[envelope-and-exit-codes]]).

## Failure modes

- An origin that did not answer is `OriginUnreachable`, reported by
  `freshness` as `origin-unreachable` on every page naming it; a plumbing
  failure — no git on PATH, a broken repository — is thrown as itself and
  becomes `freshness-unavailable` or `git-unavailable` (`git.ts:220-226`,
  `:246-251`).
- A path HEAD does not hold, a new page or a repository with no commit, is
  answered `missing` and has no base; any other failure of git exits
  non-zero and is thrown rather than silently disarming the diff-aware arms
  (`git.ts:512-561`). The one `show HEAD:` left keeps the same rule: only
  "does not exist", "exists on disk, but not in" and "bad revision" mean no
  base (`:122-144`).
- "not a git repository" answers `undefined` for the enclosing repository;
  an unborn HEAD answers `false` for "has a commit"; every other exit is
  thrown with its stderr (`git.ts:182-193`, `:195-215`).
- The checkout state is read with `GIT_DIR`, `GIT_WORK_TREE`,
  `GIT_COMMON_DIR` and `GIT_INDEX_FILE` removed: a hook exports `GIT_DIR`
  with no work tree, and git would then take the directory it runs in for
  the top of the work tree (`git.ts:563-564`, `:588-590`). It runs with
  `--no-optional-locks`, so it never refreshes the index a dry run must
  leave alone; any exit but 0, and a git that does not run, answers
  `undefined`, which the bundle block reports as a `null` head and dirt
  (`git.ts:574-625`; `packages/cli/src/bundle.ts:124-129`). An answer that
  ends without its newline is thrown instead, and the envelope goes out
  without the bundle block rather than state a clean checkout
  (`git.ts:605-612`; see [[command-runtime]]).
- An answer has no buffer to overflow: git writes it to a file of any size,
  and only stderr's pipe is bounded, at 8 MiB
  (`packages/cli/src/stdoutfile.ts:31-32`); a batch read is still chunked at
  32 MiB of content per process (`packages/cli/src/git.ts:398-399`).
- A blob the index or a tree names that `cat-file` reports `missing` is
  thrown as a broken repository rather than read as a shorter page
  (`git.ts:465`), and so is a batch object that runs on past the size its
  header gave (`packages/core/src/gitplan/index.ts:148-150`). A
  `--batch-check` that answers fewer lines than it was asked, a batch stream
  that stops between objects, and one cut inside an object are all
  `git-short-read` (`packages/cli/src/git.ts:452-457`, `:473-497`). Git
  writes every byte a header announces, so the core parser throws a stream
  that ends inside a header or an object as `BatchStreamTruncated`
  (`packages/core/src/gitplan/index.ts:99-116`, `:134`, `:147`), and the
  shell refuses it by that name (`packages/cli/src/git.ts:479-490`).
- A read that returns a file's bytes has no terminator or count to hold it
  to — `show` for a config file through the staged reader and for a
  newline-named rename source, `cat-file blob` for a revision's constitution,
  and `cat-file -p` for a cited blob's line count
  (`git.ts:117-144`, `:357-363`; `packages/cli/src/state.ts:282-292`) — so
  it rests on the file transport alone, which leaves no runtime cut to
  catch. Were git itself to stop short, a cut constitution would fail to
  parse: the gate refuses as the constitution's error, and `lint --since`
  reports that pair `skipped: constitution-did-not-load`
  (`packages/cli/src/verbs/lint.ts:205-208`); a cut blob would count fewer
  lines and report a citation past its end rather than pass one.
- Unmerged paths in the index refuse the gate before anything is judged
  (`packages/cli/src/staged.ts:73-77`); a commit-message path arrives
  relative at a repository's top level and absolute in a linked worktree, and
  is joined accordingly (`:131-139`).

## Relations

- part_of [[writer-and-staged-gate]]
- part_of [[freshness]]
- mapped_in [[repository-layout]]
