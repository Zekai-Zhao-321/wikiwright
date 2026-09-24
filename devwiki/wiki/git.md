---
type: integration
title: "Git"
description: "The one external system: git is spawned as plumbing for the index, HEAD, revisions, the enclosing repository, a trust grant's worktree scope, a vault's checkout state, remote heads and blobless origin caches; never a library, never a prompt, and every answer read from a file git wrote itself."
tags: [cli]
pin: 29dbfb9c8b6bf1679bca419d1f3a7479c3f00532
origin: .
covers: [packages/cli/src/git.ts, packages/cli/src/stdoutfile.ts, packages/cli/src/state.ts, packages/cli/src/buildinfo.ts]
---

# Git

## Contract

Git is spawned as plumbing and never linked as a library
(`packages/cli/src/git.ts:1-2`). Every call goes through one helper,
`spawnWithStdoutFile` (`packages/cli/src/stdoutfile.ts:41-79`), through
`gitRun` and `gitText` (`packages/cli/src/git.ts:75-103`): it runs with the
vault root as its working directory, stdout on a file and stderr captured
onto the thrown error rather than printed beside an envelope; the batch
reads pass the object names on stdin (`:396-408`), and the reads of a
vault's worktree identity and of its checkout state pass an environment
without the variables a git hook exports (`:518-567`, `:569-629`). What
the engine asks of it:

| Call | Where | For |
| --- | --- | --- |
| `diff --cached --name-status -z -M --relative` | `git.ts:105-110` | the staged changes, vault-root-relative, renames detected; once per run, through `indexSnapshot` (`state.ts:60-81`) |
| `show :./<path>` | `git.ts:112-115` | a config file's index bytes, through the staged reader |
| `show HEAD:./<path>` | `git.ts:117-139` | a rename source's last committed bytes, only when its name holds a newline, the one name `cat-file`'s line protocol cannot carry |
| `ls-files -s -z` | `git.ts:149-162` | the paths the index holds, each with its blob and stage; once per run, in the same snapshot |
| `cat-file --batch-check`, `cat-file --batch` | `git.ts:420-481` | every page of the index or of a revision, and every base, by blob id: the sizes in one process, then the bytes in one process per 32 MiB |
| `cat-file --batch-check` over `HEAD:./<path>` | `git.ts:493-516` | the blob HEAD holds at every path a changed or deleted page is judged against, in one process; a path HEAD does not hold is `missing` |
| `rev-parse HEAD` | `git.ts:164-168` | the head of origin `.` |
| `rev-parse --show-toplevel` | `git.ts:177-188` | the repository enclosing the vault |
| `rev-parse --is-inside-work-tree --git-common-dir --show-prefix` | `git.ts:518-567` | a vault's worktree scope for a trust grant: the common directory every linked worktree of one clone shares, and the vault's path inside its own worktree; asked only when a worktree grant could apply, once per process (`packages/cli/src/trust.ts:286-307`, `:315-363`) |
| `--no-optional-locks status --porcelain=v2 --branch --untracked-files=all -- .` | `git.ts:569-629` | the checkout a vault root sits in, for the bundle block every vault envelope carries: the `# branch.oid` header is the head, any entry makes it dirty; one process (`packages/cli/src/bundle.ts:124`) |
| `rev-parse --verify --quiet HEAD` | `git.ts:198-210` | whether the repository has a commit |
| `ls-remote --quiet <origin> HEAD` | `git.ts:251-260` | a remote head with no clone |
| `init --bare`, `fetch --filter=blob:none --no-tags <origin> +HEAD:refs/wikiwright/head` | `git.ts:269-295` | the blobless cache per origin, retried whole when a server refuses filters |
| `rev-parse --verify --quiet <ref>`, `merge-base --is-ancestor`, `rev-list --count` | `git.ts:298-325`, `:361-364` | whether a pin is known and on the head's history, and how far behind |
| `ls-tree --name-only <rev>`, `cat-file -t <spec>`, `cat-file -p <spec>` | `git.ts:333-358` | the tree at a pin and a cited blob's type and line count, for a page's citations |
| `diff --name-only -z --no-renames <pin> <head> -- :(top)<path>…` | `git.ts:374-386` | the covering diff, repository-root-relative when the vault is embedded |
| `rev-list --first-parent --reverse`, `rev-list --parents -n 1`, `ls-tree -r -z`, `cat-file blob`, `diff --name-status -z -M <base>..<rev>` | `state.ts:214-257`, `:265-292`, `:300-340` | the replay's commit pairs, each revision's constitution, and its page set through the batch read |
| `-C <package> ls-files --error-unmatch package.json`, `rev-parse --short HEAD`, `status --porcelain` | `buildinfo.ts:14-43` | the checkout the binary sits in, demoted to `checkout_commit` |

A call that may reach the network runs with `GIT_TERMINAL_PROMPT=0` so a
private origin fails instead of hanging on a credential prompt, and under a
30-second timeout so a dead host is an answer; a non-zero exit is the origin's
refusal, never a throw (`git.ts:223`, `:228-248`). The cache keeps the
origin's head under `refs/wikiwright/head` (`:225-226`) and `--no-renames`
keeps a blobless cache blobless (`:366-373`). Origin `.` is the work tree
`rev-parse --show-toplevel` finds from the vault root, so a vault in a
directory of the repository it documents pins to that repository's commits
(`:170-176`). The empty tree is the base of a repository's first commit
(`state.ts:251-257`).

Every answer is read from a file git wrote itself. The helper creates a
fresh file under `os.tmpdir()`, exclusively and readable only by this user,
hands it to git as its stdout, reads it once git has exited, and removes it
(`packages/cli/src/stdoutfile.ts:1-12`, `:46-79`). The runtime reads no
pipe for an answer, so exit 0 and the file are everything git wrote: under
load, Bun's synchronous spawn once handed back a piped answer cut to a
prefix with exit 0, and a prefix that ends between records is as well
formed as the whole — a cut index listing is fewer staged pages, and no
check on the bytes could tell (`docs/roadmap.md`). stderr stays a pipe; it
only feeds a message. A batch read's object names still go in on stdin, a
pipe the runtime writes, and each batch read holds its answer to the number
of names it sent: a check that answered fewer objects or paths than it was
asked (`packages/cli/src/git.ts:426-434`, `:502-510`), and a batch stream
that does not end in a newline, stops inside an object or holds fewer
objects than its chunk (`:444-468`).

Two further lines stay behind the file. Every answer that has a terminator
is still held to it: `terminated` (`:53-73`) passes an empty answer, or one
that ends in its terminator — a NUL for a `-z` listing, a newline for a line
answer — and, for a read that always prints something, refuses an empty one
as well; anything else is `GitShortRead` (`:22-36`). And two cross-checks
catch a listing cut at a record boundary, which no terminator can see
(`:38-51`): every path the staged diff names as added, modified, retyped,
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
  becomes `freshness-unavailable` or `git-unavailable` (`git.ts:215-221`,
  `:241-246`).
- A path HEAD does not hold, a new page or a repository with no commit, is
  answered `missing` and has no base; any other failure of git exits
  non-zero and is thrown rather than silently disarming the diff-aware arms
  (`git.ts:483-516`). The one `show HEAD:` left keeps the same rule: only
  "does not exist", "exists on disk, but not in" and "bad revision" mean no
  base (`:117-139`).
- "not a git repository" answers `undefined` for the enclosing repository;
  an unborn HEAD answers `false` for "has a commit"; every other exit is
  thrown with its stderr (`git.ts:177-188`, `:190-210`).
- The worktree identity is read with `GIT_DIR`, `GIT_WORK_TREE`,
  `GIT_COMMON_DIR` and `GIT_INDEX_FILE` removed: a hook exports `GIT_DIR`
  with no work tree, and `rev-parse` would then take the directory it runs in
  for the top of the work tree, so a vault below the top would read as the
  top (`git.ts:518-531`). Output that is not exactly three lines is thrown
  too: git prints a newline inside a path verbatim, so a newline in the
  vault's path, or in a linked worktree's common directory, would read the
  vault as a shorter path, another vault's (`:546-562`). A directory outside
  every work tree, any failure of git and an answer cut short are thrown; the
  loader refuses `module-scope-unresolved` and
  `trust` answers `scope-unresolved`, never a quieter verdict
  (`packages/cli/src/moduleload.ts:224-268`;
  `packages/cli/src/verbs/trust.ts:102-112`).
- The checkout state is read the same way, the hook's variables removed, and
  with `--no-optional-locks`, so it never refreshes the index a dry run must
  leave alone; any exit but 0, and a git that does not run, answers
  `undefined`, which the bundle block reports as a `null` head and dirt
  (`git.ts:569-629`; `packages/cli/src/bundle.ts:124-129`). An answer that
  ends without its newline is thrown instead, and the envelope goes out
  without the bundle block rather than state a clean checkout
  (`git.ts:609-616`; see [[command-runtime]]).
- An answer has no buffer to overflow: git writes it to a file of any size,
  and only stderr's pipe is bounded, at 8 MiB
  (`packages/cli/src/stdoutfile.ts:20-21`); a batch read is still chunked at
  32 MiB of content per process (`packages/cli/src/git.ts:393-394`).
- A blob the index or a tree names that `cat-file` reports `missing` is
  thrown as a broken repository rather than read as a shorter page
  (`git.ts:436`), and so is a batch object that runs on past the size its
  header gave (`packages/core/src/gitplan/index.ts:142-144`). A
  `--batch-check` that answers fewer lines than it was asked, a batch stream
  that stops between objects, and one cut inside an object are all
  `git-short-read` (`packages/cli/src/git.ts:429-434`, `:444-468`). Git
  writes every byte a header announces, so the core parser throws a stream
  that ends inside a header or an object as `BatchStreamTruncated`
  (`packages/core/src/gitplan/index.ts:93-110`, `:128`, `:141`), and the
  shell refuses it by that name (`packages/cli/src/git.ts:450-461`).
- A read that returns a file's bytes has no terminator or count to hold it
  to — `show` for a config file through the staged reader and for a
  newline-named rename source, `cat-file blob` for a revision's constitution,
  and `cat-file -p` for a cited blob's line count
  (`git.ts:112-139`, `:352-358`; `packages/cli/src/state.ts:282-292`) — so
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
