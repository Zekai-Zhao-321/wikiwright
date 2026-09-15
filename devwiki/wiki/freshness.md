---
type: subsystem
title: "Freshness and pins"
description: "Every pin is measured against the origin its page names — the enclosing repository for origin dot, ls-remote or a blobless cache for a URL — into one of six states, with a covering diff deciding stale from unchanged, every repository path the page cites held to the pin, and a fast-forward that advances only clean pins through the Writer."
tags: [cli]
pin: 9baddb474faae0ffe8d74495ce18c0411045e193
origin: .
covers: [packages/cli/src/freshness.ts, packages/cli/src/verbs/freshness.ts]
---

# Freshness and pins

## Responsibilities

`pinnedPages` (`packages/cli/src/freshness.ts:70`) reads every pin off the
one `pin` shape each type declares, with the origin, the `covers` list the
shape's sibling names carry and the page's own bytes for the citations it
makes (`:48-56`), skipping a malformed pin or an absent origin — those are
lint's, snapshot-internal (`:63-69`, `:74-95`). `measureOrigin` (`:416`)
answers one origin: `.` is the repository enclosing the vault, found by
`git rev-parse --show-toplevel` from the vault root, its head `HEAD`, with
`covers` read as `:(top)` paths (`:406-414`, `:426-447`); any other origin
is a URL answered by `ls-remote` at the default depth (`:449-457`) or, under
`--fetch`, by a blobless bare cache under `.wikiwright/origins/<digest>`
(`:38-45`, `:458-488`). `computeFreshness` (`:498`) then gives every pin a
state: `current` when the pin is the head, `unmeasured` with a reason when
no head was learned, `behind` otherwise (`:524-551`); with objects in hand,
`unknown` when the pin is not on the head's history (`:564-579`), and after
the covering diff, `stale` when a covered path moved or `unchanged` when the
read holds (`:580-584`, `:614-616`). It emits `origin-unreachable`
(`:552-563`), `pin-unknown-to-origin` (`:570-577`), `stale-capture`
(`:618-626`) and, one hop over the graph's edges of every kind but `tagged`,
`stale-source-cited` on the pages that cite a stale capture (`:632-652`),
and lists the pins whose covering diff is empty as fast-forward candidates
(`:627-629`). `freshnessReportJson` (`:674`) is the uncommitted report body.

With the objects at hand, a page's citations are held to its pin
(`packages/cli/src/freshness.ts:585-613`). `citationsIn` (`:274-343`) reads
every code span of the page's source and keeps the four spellings that are
citations: a repository path whose first segment is an entry at the root of
the tree at the pin, a root file included (`:310-311`); that path with a
`:<line>` or `:<from>-<to>` suffix (`:245`); a bare file name, suffix
included, that is the basename of exactly one FILE the page covers, two
covered paths of that name being ambiguous rather than guessed at
(`:312-325`); and a line or a range alone, which names the nearest file cited
before it and is reported when nothing is cited before it (`:302-309`,
`:326-328`). A directory is a citation of its own and is not that file: a line
does not live in a directory, and a page that names one in passing is still
writing about the file it was reading (`:328`). A name with no suffix is prose,
as is a span carrying whitespace or any of `*`, `://`, `{`, `<` or `$`
(`:246`), and a range must count up from a first line, so a zero line and a
range whose end precedes its start are refused rather than read as a line
(`:331-334`). This page spells those two in words: a code span here would be
read as a citation of this vault, which is what the rule is about. A code span
is a backtick run closed by a run of the same length, as CommonMark pairs
them, so a span that wraps over a line break, and a fenced block, each pair as
one token and neither shifts the pairing of the spans after it (`:237-243`,
`:244`). `unresolvedCitations` (`:346-375`) asks the object type of each
distinct path once and the line count of each cited blob once, and names a
path the tree does not hold, a line cited on a tree, or a line past the blob's
end (`:352-369`); the plumbing is `gitTreeEntries`, `gitObjectType` and
`gitBlobLineCount` (`packages/cli/src/git.ts:263-297`). Each miss is one
`citation-unresolved` warning carrying the reason a writer acts on — `missing`,
`past-end`, `unattached`, `ambiguous` or `malformed` — and the words for it
(`packages/cli/src/freshness.ts:378-392`, `:601-613`); the entry carries
`citations: { checked, unresolved }`, or `null` where the objects were not
read (`:131-144`, `:162`, `:540`, `:600`).

The verb (`packages/cli/src/verbs/freshness.ts`) plans the report, the cache
and the pins it would advance (`:59-110`), refuses `--fast-forward` without
`--fetch` (`:143-151`), makes the cache directory ignore itself (`:157-164`),
measures (`:165-172`), advances each eligible pin by one `frontmatter-set`
op through the Writer with the proof every write gets (`:173-210`), writes
`generated/freshness.json` (`:38`, `:210-211`) and routes the findings
through the same xor as every verb (`:213-215`).

## Entry points

- `freshnessCommand` (`packages/cli/src/verbs/freshness.ts:112`);
  `computeFreshness`, `pinnedPages`, `citationsIn`, `freshnessReportJson`,
  `cacheDirOf`, `CACHE_ROOT` (`packages/cli/src/freshness.ts`).
- The git plumbing it reads — `gitTopLevel`, `gitHasHead`, `gitHead`,
  `gitLsRemoteHead`, `gitOriginFetch`, `gitRefHead`, `gitCommitKnown`,
  `gitIsAncestor`, `gitRevListCount`, `gitDiffNames`, `gitTreeEntries`,
  `gitObjectType`, `gitBlobLineCount` — is described in [[git]]
  (`packages/cli/src/freshness.ts:20-36`).
- The one pin predicate `pinFieldOf` is the kernel's, shared with the judge's
  `malformed-pin` count (`packages/core/src/shapes/index.ts:70-85`).

## State

`generated/freshness.json`, written by every run and never committed
(`packages/cli/src/verbs/freshness.ts:38`;
`packages/cli/src/freshness.ts:673`); the blobless caches under
`.wikiwright/origins/`, each keeping the origin's head under
`refs/wikiwright/head`, machine-local and deletable by hand (`:38-45`;
`packages/cli/src/verbs/freshness.ts:157-164`).

## Invariants

- Six states, each one word naming what the writer must do — `current`
  (the pin is the head: nothing), `unchanged` (the head moved and the
  covering diff is empty: the read holds, a fast-forward candidate), `stale`
  (a covered path moved: re-read and re-pin), `behind` (the head moved and
  this run could not read the diff: run `--fetch`), `unknown` (the pin is not
  on the head's history: re-read at the head), `unmeasured` (no head was
  learned, and `reason` says why); `behind`, `stale` and `covering_touched`
  stay as data beside the word, and `pins` counts all six even at zero
  (`packages/cli/src/freshness.ts:107-128`, `:491-496`).
- A page with no `covers` is stale on any diff: the covering diff is
  restricted only when paths are named (`packages/cli/src/git.ts:319-320`).
- A citation is checked wherever the objects are — origin `.`, or a URL
  under `--fetch` — and is a run-external measurement that lives beside
  `stale-capture`, never in the judge (`packages/cli/src/freshness.ts:212-213`,
  `:564`, `:585-600`); one row per distinct path and line, so a path cited
  absent three times is named once (`:337`, `:373-375`); a name that is
  neither rooted in the tree at the pin nor the basename of exactly one
  covered path is not a citation at all (`:304-319`).
- A stale pin is never fast-forwarded — only a pin whose covering diff is
  empty is eligible (`packages/cli/src/freshness.ts:627-629`;
  `packages/core/src/passes/index.ts:282-286`) — and a pin advance is a page
  write, so it goes through the Writer and is proved
  (`packages/cli/src/verbs/freshness.ts:176-198`).
- The report derives from origin state and carries no clock
  (`packages/cli/src/freshness.ts:673`); a dry run measures against the cache
  as it stands and touches nothing, so the plan is exact for the machine
  state it was read from (`packages/cli/src/verbs/freshness.ts:59-67`, `:95`).
- Snapshot-external findings are warnings (`packages/cli/src/freshness.ts:394-404`;
  `packages/core/src/passes/index.ts:287-328`), and the judging verbs never
  contact an origin — only this verb does
  (`packages/core/src/judge/index.ts:471-479`).
- A vault inside the repository it documents is one commit past its pin as
  soon as the pin is committed, so its clean state is `unchanged`, never
  `current` (`docs/extending.md`, "The code kit").

## Failure modes

- `citation-unresolved` (warning, `source-review`, never a gate): the page
  cites a path the tree at the pin does not hold, a line past the end of the
  blob, a line with nothing cited before it, a name two covered paths share,
  or a range that counts down; the row carries which
  (`packages/cli/src/freshness.ts:131-144`, `:378-392`, `:601-613`;
  `packages/core/src/passes/index.ts:305-311`). The remedy is to re-read at
  the pin and correct the citation or the pin, or to spell the path the line
  belongs to. A build product the repository never holds is named by this:
  write what it is, not a path.
- `fast-forward-needs-fetch` (`packages/cli/src/verbs/freshness.ts:143-151`).
- `git-unavailable` for a plumbing failure — including a `.git` that git
  does not recognise, thrown deliberately rather than read as "no repository"
  (`packages/cli/src/freshness.ts:427-432`;
  `packages/cli/src/verbs/freshness.ts:168-172`).
- An origin that did not answer is a finding on the pages naming it, never a
  refusal; with a cache it is measured against the cache's head and the
  message says so (`packages/cli/src/freshness.ts:552-563`).
- A candidate whose splice or proof fails lands in `refused` with its reason
  and the run continues (`packages/cli/src/verbs/freshness.ts:187-197`).
- A repository with no commit has nothing to be fresh against and reports
  `unmeasured` with `head: null` (`packages/cli/src/freshness.ts:438`,
  `:542-550`).

## Relations

- part_of [[wikiwright-architecture]]
- mapped_in [[repository-layout]]
- verified_by [[testing-guide]]
