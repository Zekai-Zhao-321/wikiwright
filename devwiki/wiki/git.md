---
type: integration
title: "Git"
description: "The one external system: git is spawned as plumbing for the index, HEAD, revisions, the enclosing repository, a trust grant's worktree scope, remote heads and blobless origin caches; never a library, never a prompt."
tags: [cli]
pin: a38be783d7393d145ba7950daf1b0ca2c1c4fbad
origin: .
covers: [packages/cli/src/git.ts, packages/cli/src/state.ts, packages/cli/src/buildinfo.ts]
---

# Git

## Contract

Git is spawned as plumbing and never linked as a library
(`packages/cli/src/git.ts:1-3`). Every call runs with the vault root as its
working directory and stderr captured onto the thrown error rather than
printed beside an envelope: `execFileSync("git", …)` with a 64 MiB output
buffer for a call that answers in one piece (`:13-28`), `spawnSync` with the
object names on stdin for the batch reads (`:334-348`), and `spawnSync`
without the variables a git hook exports for a vault's worktree identity
(`:431-474`). What the engine asks of it:

| Call | Where | For |
| --- | --- | --- |
| `diff --cached --name-status -z -M --relative` | `git.ts:30-36` | the staged changes, vault-root-relative, renames detected; once per run, through `indexSnapshot` (`state.ts:63-68`) |
| `show :./<path>` | `git.ts:39-41` | a config file's index bytes, through the staged reader |
| `show HEAD:./<path>` | `git.ts:43-65` | a rename source's last committed bytes, only when its name holds a newline, the one name `cat-file`'s line protocol cannot carry |
| `ls-files -s -z` | `git.ts:76-87` | the paths the index holds, each with its blob and stage; once per run, in the same snapshot |
| `cat-file --batch-check`, `cat-file --batch` | `git.ts:360-394` | every page of the index or of a revision, and every base, by blob id: the sizes in one process, then the bytes in one process per 32 MiB |
| `cat-file --batch-check` over `HEAD:./<path>` | `git.ts:406-429` | the blob HEAD holds at every path a changed or deleted page is judged against, in one process; a path HEAD does not hold is `missing` |
| `rev-parse HEAD` | `git.ts:90-92` | the head of origin `.` |
| `rev-parse --show-toplevel` | `git.ts:101-114` | the repository enclosing the vault |
| `rev-parse --is-inside-work-tree --git-common-dir --show-prefix` | `git.ts:431-474` | a vault's worktree scope for a trust grant: the common directory every linked worktree of one clone shares, and the vault's path inside its own worktree; asked only when a worktree grant could apply, once per process (`packages/cli/src/trust.ts:221-242`, `:250-298`) |
| `rev-parse --verify --quiet HEAD` | `git.ts:124-137` | whether the repository has a commit |
| `ls-remote --quiet <origin> HEAD` | `git.ts:182-190` | a remote head with no clone |
| `init --bare`, `fetch --filter=blob:none --no-tags <origin> +HEAD:refs/wikiwright/head` | `git.ts:199-224` | the blobless cache per origin, retried whole when a server refuses filters |
| `rev-parse --verify --quiet <ref>`, `merge-base --is-ancestor`, `rev-list --count` | `git.ts:227-261`, `:300-302` | whether a pin is known and on the head's history, and how far behind |
| `ls-tree --name-only <rev>`, `cat-file -t <spec>`, `cat-file -p <spec>` | `git.ts:269-297` | the tree at a pin and a cited blob's type and line count, for a page's citations |
| `diff --name-only -z --no-renames <pin> <head> -- :(top)<path>…` | `git.ts:312-324` | the covering diff, repository-root-relative when the vault is embedded |
| `rev-list --first-parent --reverse`, `rev-list --parents -n 1`, `ls-tree -r -z`, `cat-file blob`, `diff --name-status -z -M <base>..<rev>` | `state.ts:198-224`, `:232-258`, `:266-307` | the replay's commit pairs, each revision's constitution, and its page set through the batch read |
| `-C <package> ls-files --error-unmatch package.json`, `rev-parse --short HEAD`, `status --porcelain` | `buildinfo.ts:13-42` | the checkout the binary sits in, demoted to `checkout_commit` |

A call that may reach the network runs with `GIT_TERMINAL_PROMPT=0` so a
private origin fails instead of hanging on a credential prompt, and under a
30-second timeout so a dead host is an answer; a non-zero exit is the origin's
refusal, never a throw (`git.ts:150`, `:155-179`). The cache keeps the
origin's head under `refs/wikiwright/head` (`:152-153`) and `--no-renames`
keeps a blobless cache blobless (`:304-311`). Origin `.` is the work tree
`rev-parse --show-toplevel` finds from the vault root, so a vault in a
directory of the repository it documents pins to that repository's commits
(`:94-100`). The empty tree is the base of a repository's first commit
(`state.ts:219-224`).

## Failure modes

- An origin that did not answer is `OriginUnreachable`, reported by
  `freshness` as `origin-unreachable` on every page naming it; a plumbing
  failure — no git on PATH, a broken repository — is thrown as itself and
  becomes `freshness-unavailable` or `git-unavailable` (`git.ts:142-148`,
  `:172-177`).
- A path HEAD does not hold, a new page or a repository with no commit, is
  answered `missing` and has no base; any other failure of git exits
  non-zero and is thrown rather than silently disarming the diff-aware arms
  (`git.ts:396-429`). The one `show HEAD:` left keeps the same rule: only
  "does not exist", "exists on disk, but not in" and "bad revision" mean no
  base (`:43-65`).
- "not a git repository" answers `undefined` for the enclosing repository;
  an unborn HEAD answers `false` for "has a commit"; every other exit is
  thrown with its stderr (`git.ts:101-114`, `:116-137`).
- The worktree identity is read with `GIT_DIR`, `GIT_WORK_TREE`,
  `GIT_COMMON_DIR` and `GIT_INDEX_FILE` removed: a hook exports `GIT_DIR`
  with no work tree, and `rev-parse` would then take the directory it runs in
  for the top of the work tree, so a vault below the top would read as the
  top (`git.ts:431-444`). Output that is not exactly three lines is thrown
  too: git prints a newline inside a path verbatim, so a newline in the
  vault's path, or in a linked worktree's common directory, would read the
  vault as a shorter path, another vault's (`:459-469`). A directory outside
  every work tree, and any failure of git, is thrown; the loader refuses `module-scope-unresolved` and
  `trust` answers `scope-unresolved`, never a quieter verdict
  (`packages/cli/src/moduleload.ts:223-267`;
  `packages/cli/src/verbs/trust.ts:66-76`).
- The 1 MiB default buffer would crash on a large page and silently disarm
  the append-only base lookup, which is why the buffer is 64 MiB
  (`git.ts:13-15`); a batch read's buffer is its chunk's measured bytes plus
  a header per blob (`:379-380`).
- A blob the index or a tree names that `cat-file` reports `missing`, and a
  batch stream that ends inside an object, are thrown as a broken repository
  rather than read as a shorter page (`git.ts:372`,
  `packages/core/src/gitplan/index.ts:52-69`, `:102-127`); so is a
  `--batch-check` that answers fewer lines than it was asked (`git.ts:422`).
- Unmerged paths in the index refuse the gate before anything is judged
  (`packages/cli/src/staged.ts:72-76`); a commit-message path arrives
  relative at a repository's top level and absolute in a linked worktree, and
  is joined accordingly (`:128-136`).

## Relations

- part_of [[writer-and-staged-gate]]
- part_of [[freshness]]
- mapped_in [[repository-layout]]
