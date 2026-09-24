---
type: integration
title: "Git"
description: "The one external system: git is spawned as plumbing for the index, HEAD, revisions, the enclosing repository, a trust grant's worktree scope, a vault's checkout state, remote heads and blobless origin caches; never a library, never a prompt, and every answer with a terminator held to it."
tags: [cli]
pin: 1d76c5a43adb92e0aff1e5a40941f7c0469ef062
origin: .
covers: [packages/cli/src/git.ts, packages/cli/src/state.ts, packages/cli/src/buildinfo.ts]
---

# Git

## Contract

Git is spawned as plumbing and never linked as a library
(`packages/cli/src/git.ts:1-3`). Every call runs with the vault root as its
working directory and stderr captured onto the thrown error rather than
printed beside an envelope: `execFileSync("git", …)` with a 64 MiB output
buffer for a call that answers in one piece (`:13-15`, `:56-67`),
`spawnSync` with the object names on stdin for the batch reads
(`:386-400`), and `spawnSync` without the variables a git hook exports for a
vault's worktree identity and for its checkout state (`:510-559`,
`:569-621`). What the engine asks of
it:

| Call | Where | For |
| --- | --- | --- |
| `diff --cached --name-status -z -M --relative` | `git.ts:69-74` | the staged changes, vault-root-relative, renames detected; once per run, through `indexSnapshot` (`state.ts:65-70`) |
| `show :./<path>` | `git.ts:76-79` | a config file's index bytes, through the staged reader |
| `show HEAD:./<path>` | `git.ts:81-103` | a rename source's last committed bytes, only when its name holds a newline, the one name `cat-file`'s line protocol cannot carry |
| `ls-files -s -z` | `git.ts:113-126` | the paths the index holds, each with its blob and stage; once per run, in the same snapshot |
| `cat-file --batch-check`, `cat-file --batch` | `git.ts:412-468` | every page of the index or of a revision, and every base, by blob id: the sizes in one process, then the bytes in one process per 32 MiB |
| `cat-file --batch-check` over `HEAD:./<path>` | `git.ts:480-508` | the blob HEAD holds at every path a changed or deleted page is judged against, in one process; a path HEAD does not hold is `missing` |
| `rev-parse HEAD` | `git.ts:128-132` | the head of origin `.` |
| `rev-parse --show-toplevel` | `git.ts:141-156` | the repository enclosing the vault |
| `rev-parse --is-inside-work-tree --git-common-dir --show-prefix` | `git.ts:510-559` | a vault's worktree scope for a trust grant: the common directory every linked worktree of one clone shares, and the vault's path inside its own worktree; asked only when a worktree grant could apply, once per process (`packages/cli/src/trust.ts:286-307`, `:315-363`) |
| `--no-optional-locks status --porcelain=v2 --branch --untracked-files=all -- .` | `git.ts:561-621` | the checkout a vault root sits in, for the bundle block every vault envelope carries: the `# branch.oid` header is the head, any entry makes it dirty; one process (`packages/cli/src/bundle.ts:124`) |
| `rev-parse --verify --quiet HEAD` | `git.ts:166-182` | whether the repository has a commit |
| `ls-remote --quiet <origin> HEAD` | `git.ts:227-236` | a remote head with no clone |
| `init --bare`, `fetch --filter=blob:none --no-tags <origin> +HEAD:refs/wikiwright/head` | `git.ts:245-271` | the blobless cache per origin, retried whole when a server refuses filters |
| `rev-parse --verify --quiet <ref>`, `merge-base --is-ancestor`, `rev-list --count` | `git.ts:274-310`, `:351-354` | whether a pin is known and on the head's history, and how far behind |
| `ls-tree --name-only <rev>`, `cat-file -t <spec>`, `cat-file -p <spec>` | `git.ts:318-348` | the tree at a pin and a cited blob's type and line count, for a page's citations |
| `diff --name-only -z --no-renames <pin> <head> -- :(top)<path>…` | `git.ts:364-376` | the covering diff, repository-root-relative when the vault is embedded |
| `rev-list --first-parent --reverse`, `rev-list --parents -n 1`, `ls-tree -r -z`, `cat-file blob`, `diff --name-status -z -M <base>..<rev>` | `state.ts:200-232`, `:240-267`, `:275-315` | the replay's commit pairs, each revision's constitution, and its page set through the batch read |
| `-C <package> ls-files --error-unmatch package.json`, `rev-parse --short HEAD`, `status --porcelain` | `buildinfo.ts:13-42` | the checkout the binary sits in, demoted to `checkout_commit` |

A call that may reach the network runs with `GIT_TERMINAL_PROMPT=0` so a
private origin fails instead of hanging on a credential prompt, and under a
30-second timeout so a dead host is an answer; a non-zero exit is the origin's
refusal, never a throw (`git.ts:195`, `:200-224`). The cache keeps the
origin's head under `refs/wikiwright/head` (`:197-198`) and `--no-renames`
keeps a blobless cache blobless (`:356-363`). Origin `.` is the work tree
`rev-parse --show-toplevel` finds from the vault root, so a vault in a
directory of the repository it documents pins to that repository's commits
(`:134-140`). The empty tree is the base of a repository's first commit
(`state.ts:226-232`).

Every answer that has a terminator is held to it where its bytes are read.
`terminated` (`git.ts:34-54`) passes an empty answer, or one that ends in its
terminator — a NUL for a `-z` listing, a newline for a line answer — and,
for a read that always prints something, refuses an empty one as well;
anything else is `GitShortRead` (`:17-32`). The staged diff, the index
listing, the tree and covering-diff listings and every `rev-parse`,
`rev-list`, `ls-remote`, `cat-file -t` and `status` answer go through it
(`:73`, `:118`, `:131`, `:150`, `:175`, `:232`, `:270`, `:283`, `:320`,
`:339`, `:353`, `:373`, `:544-549`, `:603-608`; `state.ts:204`, `:218`,
`:230`, `:243`, `:309`), and the batch reads are held to their counts too: a
check that answered fewer objects or paths than it was asked
(`git.ts:423-431`, `:494-502`), and a batch stream that does not end in a
newline or holds fewer objects than its chunk (`:443-455`). `main` answers
`GitShortRead` as `git-short-read`, exit 1, `internal`, the git command in
`details.command` (`packages/cli/src/main.ts:87-95`), and every catch that
turns a plumbing failure into `git-unavailable` or `revision-not-found`
rethrows it first (`packages/cli/src/staged.ts:85`,
`packages/cli/src/verbs/fix.ts:247`, `packages/cli/src/verbs/freshness.ts:173`,
`packages/cli/src/verbs/lint.ts:187`, `packages/cli/src/state.ts:212`). A
cut listing is well formed as far as it goes: read as a shorter one, a cut
index listing is fewer staged pages, and under load a runtime's synchronous
spawn has handed back exactly that with exit 0 (`docs/roadmap.md`).

## Failure modes

- An origin that did not answer is `OriginUnreachable`, reported by
  `freshness` as `origin-unreachable` on every page naming it; a plumbing
  failure — no git on PATH, a broken repository — is thrown as itself and
  becomes `freshness-unavailable` or `git-unavailable` (`git.ts:187-193`,
  `:217-222`).
- A path HEAD does not hold, a new page or a repository with no commit, is
  answered `missing` and has no base; any other failure of git exits
  non-zero and is thrown rather than silently disarming the diff-aware arms
  (`git.ts:470-508`). The one `show HEAD:` left keeps the same rule: only
  "does not exist", "exists on disk, but not in" and "bad revision" mean no
  base (`:81-103`).
- "not a git repository" answers `undefined` for the enclosing repository;
  an unborn HEAD answers `false` for "has a commit"; every other exit is
  thrown with its stderr (`git.ts:141-156`, `:158-182`).
- The worktree identity is read with `GIT_DIR`, `GIT_WORK_TREE`,
  `GIT_COMMON_DIR` and `GIT_INDEX_FILE` removed: a hook exports `GIT_DIR`
  with no work tree, and `rev-parse` would then take the directory it runs in
  for the top of the work tree, so a vault below the top would read as the
  top (`git.ts:510-523`). Output that is not exactly three lines is thrown
  too: git prints a newline inside a path verbatim, so a newline in the
  vault's path, or in a linked worktree's common directory, would read the
  vault as a shorter path, another vault's (`:538-554`). A directory outside
  every work tree, any failure of git and an answer cut short are thrown; the
  loader refuses `module-scope-unresolved` and
  `trust` answers `scope-unresolved`, never a quieter verdict
  (`packages/cli/src/moduleload.ts:224-268`;
  `packages/cli/src/verbs/trust.ts:102-112`).
- The checkout state is read the same way, the hook's variables removed, and
  with `--no-optional-locks`, so it never refreshes the index a dry run must
  leave alone; any exit but 0, and a git that does not run, answers
  `undefined`, which the bundle block reports as a `null` head and dirt
  (`git.ts:569-621`; `packages/cli/src/bundle.ts:124-129`). An answer cut
  short is thrown instead, and the envelope goes out without the bundle block
  rather than state a clean checkout (`git.ts:601-608`;
  `packages/cli/src/main.ts:66-76`).
- The 1 MiB default buffer would crash on a large page and silently disarm
  the append-only base lookup, which is why the buffer is 64 MiB
  (`git.ts:13-15`); a batch read's buffer is its chunk's measured bytes plus
  a header per blob (`:440-441`).
- A blob the index or a tree names that `cat-file` reports `missing` is
  thrown as a broken repository rather than read as a shorter page
  (`git.ts:434`), and so is a batch object that runs on past the size its
  header gave (`packages/core/src/gitplan/index.ts:142-144`). A
  `--batch-check` that answers fewer lines than it was asked, a batch stream
  that stops between objects, and one cut inside an object are all
  `git-short-read` (`packages/cli/src/git.ts:427-432`, `:444-468`). Git
  writes every byte a header announces, so the core parser throws a stream
  that ends inside a header or an object as `BatchStreamTruncated`
  (`packages/core/src/gitplan/index.ts:93-110`, `:128`, `:141`), and the
  shell refuses it by that name (`packages/cli/src/git.ts:450-461`).
- A read that returns a file's bytes has no terminator to hold it to: `show`
  for a config file through the staged reader and for a newline-named rename
  source, `cat-file blob` for a revision's constitution, and `cat-file -p` for
  a cited blob's line count (`git.ts:76-103`, `:343-348`;
  `packages/cli/src/state.ts:257-267`). A cut constitution fails to parse:
  the gate refuses as the constitution's error, and `lint --since` reports
  that pair `skipped: constitution-did-not-load`
  (`packages/cli/src/verbs/lint.ts:205-208`). A cut blob counts fewer lines,
  which reports a citation past its end rather than passing one.
- Unmerged paths in the index refuse the gate before anything is judged
  (`packages/cli/src/staged.ts:73-77`); a commit-message path arrives
  relative at a repository's top level and absolute in a linked worktree, and
  is joined accordingly (`:131-139`).

## Relations

- part_of [[writer-and-staged-gate]]
- part_of [[freshness]]
- mapped_in [[repository-layout]]
