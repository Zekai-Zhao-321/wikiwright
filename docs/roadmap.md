# Roadmap

Where wikiwright stands, what it deliberately does not do yet, and what
comes next. `docs/architecture.md` says how the engine is built; this page
says what a user will run into and what is planned. When a mechanism is
missing or unverified it is written here, with the command or declaration
that would close the gap, rather than left for a reader to discover.

## Status

wikiwright 0.1.0 is two packages and a kit. `@wikiwright/core` is the
kernel, a pure library over bytes. `wikiwright` is the binary, one JSON
envelope per invocation, answered by one table, the command table of the v2
contracts: eight verbs over the type-document law (`check`, `gate`, `write`,
`rule`, `read`, `search`, `type`, `version`), one module each under
`packages/cli/src/verbs/`. The 24 verbs of the old tree left in step 6 of the
v2 delivery (§The old verbs left in step 6). Every envelope of a verb that
reads a bundle's law names the bundle it read — its label, real root, head,
whether it is dirty, and digests of its law and its content — and `read`
returns a page's sections verbatim with the page's bytes digest and its
status, under a byte budget. Step 6 is removing the old tree's mechanisms one
commit each; until each has left, its code is in the tree and reached by no
verb: the old registry and its standard library, the module loader and the
v1 kit
`@wikiwright/kit-code`, which `devwiki` no longer imports.

The engine runs on Bun only, the version `.bun-version` pins; the test
files and the CLI they spawn run under it (`tools/run-suite.ts`), and every
test file is written to `bun:test`. The suite is 1,506 tests across 103
files, and the gate, `bun run check`, passed all of them three times in a
row on 2026-09-26, after the old verbs left. It judges five corpora
(`devwiki`, `fixtures/memory-synth`, `fixtures/minimal-vault`, and the two
gardening handbooks under `fixtures/handbooks`), every one on the v2 law.
`devwiki` is a bundle whose pages are pinned to this repository, over
`libraries/kit-code`, and `check --root devwiki` reports no error, its
warnings the pins below. The runtime and transport slice of the v2 delivery
(the asynchronous git transport, Bun only, remote freshness removed, the
binary) and its review fixes changed code 21 of the 27 pinned pages cover:
measured by `check` at the last of them, 21 pins read `stale` and 6
`unchanged`, with `pin-stale` and `stale-source-cited` findings and no
`citation-unresolved`. Those pages still describe the engine before the v2
delivery; they are re-read and re-pinned in its documentation step, and until
then `check` names each.
A citation into a file its page does not cover is held to the pin but not
to the file's later changes, so such a reference either is covered or goes
through the page that covers the file.

The gate is `bun run check` (biome, the build, the test-project typecheck,
the whole suite). `scripts/hooks/pre-commit` runs it on the machine that
commits, and `.github/workflows/check.yml` runs it on every push and pull
request on Linux and macOS.
`sh scripts/release-matrix.sh` is run by hand before a release; Windows is
unverified.

## Known limitations

Each entry names what is missing and the command or declaration a user
would want.

### No starter

`init`, which copied a starter constitution (`base`, or `code` over the v1
kit) into a directory and installed the hooks and the shipped skills, left
with the old verbs in step 6, and the starters under
`packages/cli/constitutions/` with it: both were on the v1 law. A new bundle
is written by hand: a `config/engine.json` at schema version 4 and one type
document under `constitution/types/`, the shape `fixtures/minimal-vault`
has; `check --write` renders its `generated/`. The loss: no command lays a
bundle down, and nothing checks that a hand-made one is complete until its
first `check`.

Wanted: a documented starter directory, copied by hand (the v2 contracts, §1),
which the documentation step of the delivery writes.

### A capture of another repository is not measured

`check` measures a pin only against the repository the bundle sits in. A
pin whose origin is a git URL is reported `pin-unmeasured` (info), reason
`remote-origin`, and the origin is never contacted: remote freshness — the `ls-remote` depth, the
`--fetch` cache under `.wikiwright/origins/` — was removed with the
network-reaching git calls, so the engine's git transport reads local
repositories only. The loss: a source page that captures another
repository is not held to that repository's history; when the source
moves, nothing marks the page stale or its citations unresolved, and its
reader is told only that the pin is unmeasured.

Wanted: a way to measure a remote capture without the engine reaching the
network, for example a local clone the bundle names as the origin, measured
as the enclosing repository is.

### `check` holds a citation to its pin, not to what the lines say

A code span is a citation when it is a repository path whose first segment
is an entry at the root of the tree at the pin (`packages/cli/src/pages.ts:75`,
and a root file such as `package.json:26`), the bare name of exactly one
file the page covers (`git.ts:31`), or a line alone (`:166`), which names
the nearest file cited before it on the page; each is held to the pin, its
path to exist and its line to be inside the blob, and `checked` counts it.
What is not checked is whether the cited lines still say what the sentence
says they do, and when covered paths move, the shift of a page's citations
is done by content, outside the engine; no verb offers it.

Wanted: a `write` operation that relocates each citation by content and
re-pins. It belongs to the verb that writes.

### A page-wide append-only law and a dated append-only ledger cannot coexist

Declaring `body.lifecycle: "append-only"` on a type and
`lifecycle: "append-only"` on one of its dated `entries` sections loads
`body-lifecycle-doubled`: the two laws would report the same mutation
twice. `code/decision` takes the page-wide law and keeps Consequences as
prose; "one dated line per change" is a skill fragment, not a grammar.

Wanted: `"body": { "lifecycle": "append-only" }` beside
`{ "heading": "Consequences", "grammar": "entries", "date": "required",
"lifecycle": "append-only" }`, admitted when the ledger is the page's last
section — the one layout where the two laws see one mutation.

### The kit is on no registry

`@wikiwright/kit-code` is a workspace package of this repository. A bundle
outside it depends on the kit by `file:<path>` to `packages/kit-code` in a
checkout, and `init --constitution code` says so in its envelope.

Wanted: a published package, so a bundle's `package.json` can name a
version range and `bun install` resolves it.

### A module runs because it is installed

There is no approval step between a bundle and the law it declares: a module
a bundle declares and has installed, or carries in its own tree by `path`,
runs when a verb reads the bundle's law. Installing it is the consent, the
decision every package manager asks of its user. So nothing on this machine
asks before a module's code runs: a `git pull` that changes a kit the bundle
carries, or the modules its `config/engine.json` declares, changes the code
the next verb over that bundle runs, and `modules list`, which imports each
module to report it, runs its top-level code too. What guards it is review of
the change that brings it, as for any dependency. The `trust` verb and its
machine-local store, which once stood there, are removed.

Wanted: a `modules list` that reports a declared module — its resolution,
its digest, its scan — without importing it, so a reader can see what a
pulled change would run before anything runs it. Not a machine-local
approval: that was removed on purpose.

### The purity scan narrows; it does not sandbox

Every load scans a module's bytes for the constructs a pure module must not
reach — the clock, randomness, the locale, the environment, the network,
dynamic evaluation, computed access to those globals, and an import of any
form — and refuses by file and line (`docs/extending.md` §The purity scan).
It reads each file as written and with its comments blanked, and refuses on
either, so a comment between a banned word and its token hides nothing, a
regular expression that steers the comment reader into blanking code hides
nothing either, and a comment that holds a construct is refused as one. A
byte scan cannot see a name bound or built at runtime: `const D = Date;
D.now()` passes it. It narrows what a module can reach; it is not a sandbox,
and it is not the argument for running the module, which is the install.

### A module's proofs are taken once per process

Every load proves a module on its installed bytes: the purity scan and the
determinism fixture, which composes the standard library with the module and
judges the fixture's pages twice. Both are kept for the process by the digest
of the module's bytes and the scan's version, so two bundles installing one
kit are proved once, and nothing is kept between processes. So every process
that loads a module runs its fixture: measured on 2026-09-24 on one
Apple-silicon machine under Node 22.22.0, the code kit's fixture (seven pages,
judged twice) took a median of 32.7 ms over eleven fresh processes, measured
alone, which every verb that reads `devwiki`'s law now pays once.

Wanted: a cache kept between runs, keyed by the module's digest, the scan's
version and the engine's version and build, since the fixture's outcome is a
function of the engine as well as of the module. It is a second state that
can disagree with the first (§Every run parses the whole corpus), and it is
deferred until the fixture's cost is measured to matter.

### Artifact writes are per-file atomic, not batch-atomic

`check --write` lands each generated file temp-then-rename: an existing file stays in place until its replacement is renamed
over it, so a render that fails leaves the previous bytes. A crash in the
middle of the loop leaves a mix of old and new files; the next
`check --write` converges them. There is no transactional write of the set.

### Every run parses the whole corpus

A verb starts, reads the pages its state names, judges them and exits; the
only state of the vault between two runs is the bytes in git. There is no
cache of parsed pages and no long-lived process, on purpose: a cache is a
second state that can disagree with the first, and a daemon is the process
the thesis excludes (`docs/architecture.md`). Nothing is kept between runs:
Node's compile cache, which `packages/cli/dist/bin.js` switched on while the
engine shipped for Node, left with the move to Bun only, and the timings
below measured under Node include it. The cost grows with the corpus. Parsing and reading
pages dominate the synthetic benchmark; applying the rules is much cheaper.

`check`, the gate and `read` parse each page they read once; that is not
a property every verb is held to. `check` reads the tree into one state and
`parsedPages` keeps each page's parse on that state, so the artifacts, the
brief and the verdict share it, where `check` once walked and parsed the tree
three times; `brief-stale` compares the brief already rendered. The gate's
drift pass, rename review and verdict share one parse of the index, a staged
transition reuses an unchanged page's parse as its base and skips a base no
section or body law consumes, and every declared transition arm still runs.
`read` by a path parses that page alone; by a name, an alias or a title it
parses every page to resolve the name and keeps the chosen page's parse, so
the whole corpus is parsed for one page.
The vault root's real path is resolved once per run and a page's once per
read. Nothing is retained between invocations.

Measured on 2026-09-11 on one Apple-silicon machine under Node 22.22.0 with
`node tools/benchmark-check.ts`: median seconds over three fresh processes,
one synthetic type, three wikilinks per page, one staged edit. Before is the
preceding build; after is this tree. The operating system's filesystem cache
is warm; these are not timings for arbitrary page sizes or grammars.

| Pages | `check` before | `check` after | `lint --staged` before | `lint --staged` after |
|---|---:|---:|---:|---:|
| 1,000 | 0.683 | 0.326 | 0.642 | 0.439 |
| 5,000 | 2.615 | 0.936 | 2.244 | 1.202 |
| 10,000 | 4.986 | 1.587 | 3.510 | 1.547 |

`check --write` over 10,000 pages fell from 4.987 s to 1.600 s. Complete
envelopes and generated bytes matched across both builds in every measured
run. `CONTRIBUTING.md` describes the benchmark and its optional baseline
comparison.

The parser is CommonMark plus YAML frontmatter. The GFM extensions were
loaded until this change and tokenized tables, task lists, strikethrough,
autolink literals and footnotes that no checker reads; the projection every
checker sees was the same with them and without on every corpus this
repository judges, and their tokenizers were close to half of every parse.
Measured the same way against the tree above, 10,000 pages: `check` 1.619 s
to 1.264 s, `lint --staged` 1.573 s to 1.198 s, envelopes and generated bytes
identical. A check that reads a table would load the extension beside the
check. What remains is the parse itself, still the largest share of every
whole-vault verb, and for the gate its git processes: 7 for a commit of any size, each about
5 ms on this machine, and since the bundle block below an eighth, its `git status`. An earlier
version of this paragraph said 80 ms a process; that figure included the
startup of the timer used to take it.

The bundle block every vault verb's envelope carries (`docs/cli.md` §The
envelope) costs a second read of each page, unparsed, for the content digest,
and one `git status` for `head` and `dirty`; it parses nothing. Measured on 2026-09-23 on one Apple-silicon machine under Node 22.22.0
with `node tools/benchmark-check.ts 1000 5`, the build before the block and the
build with it run one after the other (not through the baseline argument: the
block is a difference in every envelope), median of five fresh processes over
1,000 pages: `check` 273 ms to 298 ms, `lint --staged` 351 ms to 383 ms.

The law digest in that block reads the bytes of every declared module
installed under the bundle or carried at its declared path, and so does the
brief's law digest, beside the preload's own reading: each reading hashes every file of the package and
purity-scans its executable ones. A package's digest is now
taken once per process and reused by the preload, the brief and the
envelope; nothing of it outlives the process. Measured on 2026-09-24 on one
Apple-silicon machine under Node 22.22.0 over a temporary copy of
`devwiki` (the kit installed and, at the time, granted), whose one module is
the kit (three files, 28 KB), median of eleven
fresh processes alternating the build before the change and the build with
it: `check --all` 190.2 ms before and 190.2 ms after, `read` 114.2 ms and
113.8 ms. One digest of the kit takes about 0.9 ms, so the two readings a
`check` no longer repeats are below the noise; the saving grows with a
module's size.

The gate the hooks run reads the index. In 0.1.0 it read one `git show` per
page, a process spawn each: 33 s to read the 5,000-page index, four to judge
it. It now reads every staged page through one `ls-files -s` and one
`cat-file --batch` per 32 MiB of content, and `lint --since` reads each
revision the same way; that batching alone brought the 5,000-page index to
about four seconds, and the one parse above to about one. A consumer whose
commit hook runs several tools runs them concurrently and lets `gate` judge
the index; `check` over a whole vault belongs to push and CI.

Wanted: nothing in the binary. A caller that needs a warm parse, an editor
or a service, holds `@wikiwright/core` in its own long-lived process; the
kernel is a pure library over strings and keeps whatever its caller keeps.

Two levers were measured on 2026-09-11 and not built, so the next reader
need not measure them again. Parsing in worker threads took the parse of
5,000 pages from 645 ms to 395 ms, before the parser dropped the GFM
extensions and halved that parse, and was slower below about 2,000 pages,
because a worker costs about 95 ms to start; the vaults this engine serves are smaller than that, and a
page-count threshold would be a second path to keep identical to the first.
Bundling the binary, core and its dependencies into one file took a small
vault's `lint` from 86 ms to 48 ms, against 77 ms now with the compile
cache, and would hand a kit that imports
`@wikiwright/core` a second zod instance: a kit declares its parameter
shapes with the `z` core re-exports, and a schema from one zod instance is
not a schema to another. It would also ship third-party code without its
notices. Bundling only the CLI's own files saved 7%, not enough to put a
bundler in the path of what ships.

### Two operating systems

The hook runs where the commit happens; the workflow declares the gate on
Linux and macOS, and has not yet been observed to run: on this private
repository, on every push and pull request through 2026-09-11, GitHub
created both jobs and ended them within seconds with no step run, and the
job's annotation names the account's billing and spending limit rather than
anything in the tree. Until the account allows a hosted runner, or the
repository is public, the gate's evidence is the hook and the by-hand runs on
one machine. `sh scripts/release-matrix.sh` runs the
gate, the Bun pin, a pack and the corpus verdicts in one command, by
hand, and nothing reaches Windows. A known Windows shape: `bun install
<tarball>` records an absolute path in the lockfile, starting with `C:\`;
the engine no longer reads lockfiles, but anything that classifies a
package spelling needs both forms tested.

### A bundle cannot declare the bundles it relies on

Nothing in a bundle says which other bundles it depends on, at which law and content
digest a maintainer reviewed them, or which of its pages rest on which of
theirs. No record ties a page to a page of another bundle it rests on, with
the digests both had when a person last reviewed the pair, so a change on
one side marks nothing on the other for review.

Wanted: a declaration in `config/engine.json` naming another bundle and the
digests it was reviewed at, which `check` holds against the installed copy,
and a review record per dependent pair of pages.

### The graph knows which pages link, not where

`generated/graph.json` and the name index are identity-level: a page's links
by target, with no record of the line each occurrence sits on. No verb lists
every place a page is referenced, prints a page's headings without its text,
resolves a name to its page without reading the page, or offers completion
candidates for a partial name; `read` resolves a name only as part of reading,
and `search` ranks candidates for a query.

Wanted: `references <page>`, `outline <page>`, `resolve <name>` and a
completion listing over the one name index, with occurrences recorded by the
parser.

### No filter by the conditions a page applies to

A bundle can give its pages a field such as the climate a procedure is
written for, and `read` returns it in `page.frontmatter`, but no verb selects
pages by the conditions a caller states: telling which of two handbooks'
pages applies to one situation is the caller's reading.

Wanted: a declaration naming which fields state applicability, and a flag on
`search` and `read` that filters by them.

### A problem with the knowledge is reported by hand

A reader who finds a page wrong writes a proposal and gives it to the
bundle's maintainer (the reader's skill, `docs/skills/wikiwright-consume`).
The engine sends nothing, and no bundle declares where a proposal goes or the
shape it must take.

Wanted: a report type a bundle declares in its law, and a verb that writes a
proposal in it.

### No editor protocol, no transaction across writes, no model of time

There is no language-server adapter; no transaction spans more than one
`write --from` batch, which lands all its drafts or none; and a bundle's
history is git's and its dated entries, so no verb answers what a bundle said
on a given date.

Wanted, each when a bundle asks for it: an adapter that serves findings and
names over the language-server protocol, a transaction across verbs, and a
verb that reads a page as it stood at a revision.

### No host plugin

The package root is no longer a Claude Code plugin: its manifest
(`.claude-plugin/plugin.json`) and its two hook scripts, the session-start
hook that listed the installed bundle skills and the post-edit hook that
linted an edited page, left in step 6 of the v2 delivery. The first delivery
defers host integration; the git hook is the one boundary the engine
publishes (`.pre-commit-hooks.yaml`, `gate`). The loss: an edit a host makes
through its own tools is judged at the commit, not as it lands, and a
session is told nothing about the bundles it can reach.

Wanted, when host writes bypass the workflow repeatedly or several bundles
cause targeting mistakes (the first delivery's trigger for host
guardrails): a hook that runs `check` over an edited page, and one that
names the bundles a session can reach, each run inside a host and recorded.

### Nothing installs the git hooks

The gate runs from the published hook definition, `.pre-commit-hooks.yaml`
(`wikiwright-gate` at `pre-commit`, `wikiwright-commit-msg` at `commit-msg`),
or from two one-liners a maintainer writes into `.git/hooks` by hand
(`docs/cli.md`, `gate`). The installer the old `hook` verb and `init` ran
left in step 6 of the v2 delivery, and with it the comparison of an
installed hook with the one a build would write (`hook-stale`) and the
`WIKIWRIGHT_BYPASS` log. The loss: a repository whose hook was never
written, or was removed, commits unjudged, and nothing reports it.

Wanted, once a real installation settles on one hook manager (the first
delivery's trigger for more hook managers): that manager's route, verified
on the owner's repository.

### No bundle is found by name

The discovery of installed bundle skills left in step 6 of the v2 delivery:
the `--bundle <name>` flag, which named a verb's target by the name of a
bundle skill found in the project's, the user's and the machine's skill
directories and those `WIKIWRIGHT_SKILL_DIRS` named, and the `bundles list`
verb that listed them. A verb's target is named by `--root`, or is the
working directory. The loss: an agent that has several bundles installed
finds each by its directory, and nothing tells it that two copies of one
bundle shadow each other.

Wanted, when several installed bundles cause targeting mistakes (the first
delivery's trigger for the discovery scan): a scan of the host's skill
directories, verified against each host's layout first.

### The skill documents are read from the repository

The three skill documents — for using, writing and maintaining a bundle —
and the generated playbook live under `docs/skills/` since step 6 of the v2
delivery: the package ships none of them, and nothing installs them into a
bundle or a host, since `skills` and `init` left with the old verbs. An agent
reads them from a checkout of this repository, and each bundle's own brief,
`generated/BRIEF.md`, carries the verbs, the types and the vocabularies.

Wanted, when repeated tasks lose time finding the right type or verb despite
the brief (the first delivery's trigger for generated bundle skills): a way
to hand the documents to a host with a bundle, run inside a host and
recorded.

### No exports

A bundle no longer declares exports, and nothing renders or installs a copy
of it: the `export` verb left with the old table, and the export planner, the
in-repository renders under a bundle's `skills/`, their marker
(`config/export.json`), the `bundle-readonly` refusal of a write over a
copy, `export-marker-invalid` and the `export` block of `metadata.bundle` left
in step 6 of the v2 delivery. The v4 `config/engine.json` has no `exports`
key. The loss: a bundle is shared by sharing its repository, whole; a subset
cannot be handed to a reader without the rest, and nothing stops a write into
a directory someone copied.

Wanted, when a second consumer needs a subset or an independently installed
copy (the first delivery's trigger for exports and selections): an export
of a selection, read only, whose identity a reader can check against its
source.

### What bundles have not been evaluated for

The scenario test drives two handbooks end to end, mechanically. No
evaluation has measured whether an agent that writes a bundle and an agent
that reads one do better with it than without: whether the right passage is
found, attributed and kept. No synthetic scenario checks that nothing travels
where it should not, such as a passage read from one bundle reaching another
bundle's pages, a proposal or a hook's context unasked.

Wanted: an author-and-reader evaluation over synthetic bundles, and synthetic
privacy-regression scenarios beside the suite.

### The staged gate reads a `node_modules` kit from the working tree

A kit under `node_modules` is not in the index, so the staged gate loads it
from the working tree, as the preload loads it, and renders an export's copy
of it from there: a commit is judged against the kit installed on the
machine that commits, not one the commit carries. It is the one exception.
A kit declared by `path` is in the index, and the staged gate takes it from
there whole: the verdict over the staged pages, the copy's kit files, the
law its marker names and its brief are all reached under the staged bytes,
written out under the temporary directory and loaded there. So an unstaged
edit to such a kit changes no staged verdict and makes no copy stale.

Wanted: nothing while `node_modules` stays untracked; a bundle that must pin
its kit exactly declares it by `path`.

### The suite is sensitive to machine load

The runner runs twelve files at a time and gives a test or a hook twenty
seconds. Under load from outside the suite — observed on one machine as
Spotlight indexing the test runs' temporary directories, a malware scan and a
location daemon together, at a load average above forty on twelve cores —
spawned processes slow down, single tests time out, and a `before` hook's
`bun install` can exceed its budget. On 2026-09-23 the gate ran five times
at this slice's head and five times at the commit before the slice,
unsandboxed: no failure on either side, so the sensitivity predates the
slice rather than being caused by it.

Wanted: nothing in the engine. Run the gate on a quiet machine, or keep the
temporary directory out of indexing.

### The packed-install test needs the network

No test writes outside the temporary directory, so the packed-install test
installs under a package cache of its own there, and that cache starts
empty: every run fetches the packed core's dependencies from the registry.
The gate needs the network for that one test, as a fresh clone's
`bun install` does. Measured on 2026-09-25 on the development machine, the
file took 5.6 to 8.4 seconds alone with its own cache over ten runs, and
2.0 to 4.5 with the shared one.

Wanted: nothing while the cost stays under a minute; past that, a local
package mirror, not the caller's cache.

### Under load, the suite's runtime cut a child's output short

`lint --staged` and `fix --staged` failed under load, in the pre-commit gate
and never alone: the index named a blob `cat-file --batch` did not return, a
batch output ended inside an object, a batch check answered 1 of 2 paths.
The cause was the runtime the suite ran the CLI under. Under CPU load,
Bun 1.3.11's synchronous spawn returned a child's piped stdout cut to a
prefix, with exit status 0 and nothing on stderr. On 2026-09-24 a
twelve-minute loop of the suite failed 10 of 899 file runs, each on a
spawned process's output that came back short. A stress run beside it,
synchronous spawns of `cat` and of git's two batch reads, cut 7 of 900 calls
under Bun and none of 3,600 under Node 22. A cut listing is well formed as
far as it goes, and a prefix that ends between records is exactly as well
formed as the whole: no terminator tells them apart. Read that way, a cut
index listing is fewer staged pages, and `lint --staged` passed an index
whose failing page the cut had dropped.

The fix changes the transport. Every git read the engine makes — in
`git.ts`, `state.ts`, `hooks.ts` and the freshness pass that reads through
them, and the build identity — goes through one helper,
`packages/cli/src/stdoutfile.ts`, that gives git an open file under
`os.tmpdir()` for its stdout, created exclusively and removed once read. Git
writes its answer there itself and closes it before it exits; the runtime
reads no pipe. What that proves: the file is everything git wrote, so exit 0
and the file are the whole answer under any runtime, and no runtime can hand
back a prefix of it. The in-process engine reads a test makes under Bun —
`judge-property.test.ts` builds states with `indexState` and `revisionState`
in the test process — go through the same helper. A batch read's request, the
object names or paths it asks for, is written to a second file first and
handed to git as its stdin, so no request travels through a pipe the runtime
fills either: a request cut inside its last path had made git answer
`missing` for a shorter path, which a count of rows accepts. Each batch
read now also holds every row to the request it answers, in order: a row
git could not resolve must echo its request, and a row it resolved must name
the requested object, or be a blob where the request was a path; otherwise
`git-inconsistent-read`. Answer and request are therefore whole by
construction; the file proves nothing more — not that git told the truth,
nor that the repository held still between two reads. stderr is still a
pipe and is read: a path HEAD does not hold, a directory in no repository
and a server that refuses a filtered fetch are recognised from its text, and
each, with its text lost, fails as `git-unavailable` or an unreachable
origin rather than a smaller answer. The checks
from before stay as a second line — every answer with a terminator is held to
it, and one that ends short is `git-short-read` — and two cross-checks catch
a listing cut at a record boundary wherever it came from: every path the
staged diff names as added, modified, retyped, renamed or copied must be in
the index listing, and `lint --since`'s commit walk must list as many
commits as `rev-list --count` counts in its range. Either failing is
`git-inconsistent-read` (exit 1, `internal`), naming both commands.
`git-short-read.test.ts` cuts each answer, at a byte and at a record
boundary, with a `git` on PATH.

The stress run was repeated on 2026-09-24 against the helper, under Bun
1.3.11 on twelve cores, with a piped `spawnSync` of the same calls as the
control: 900 spawns of `cat` and both batch reads per run. Eight CPU burners
alone, one run: the file lost none of 900 and the pipe none of 900. Eight
burners with the suite looping, three runs: the file none of 2,700, the pipe
none of 2,700. Thirty-six burners with the suite looping, load average about
32, three runs: the file none of 2,700, the pipe 2 of 2,700 (`cat` returned 0
of 38,500 bytes with exit 0, and a batch read 8,428 of 80,468). The cut is
rare and depends on the load; the file transport is not a lower rate of it
but a channel with no prefix to return.

The engine no longer calls a synchronous spawn at all: the transport spawns
asynchronously (`Bun.spawn`), awaited to the child's exit, at most four
children at a time, each killed if it runs past `WIKIWRIGHT_GIT_TIMEOUT_MS`
(`git-timeout`), and no file the packages ship spawns synchronously
(`no-sync-spawn.test.ts`). The CLI a test spawns runs under Bun with its
stdout on a file the test reads back (`runCli`,
`packages/cli/test/fixtures/runtime.ts`). `judge-property.test.ts`, which judges states it
builds in its own process, asserts each state's pages before any verdict read
from it, since an empty or short state judges clean.

The asynchronous spawn goes through `Bun.spawn`, not Bun's
`node:child_process` layer: through that layer, on 2026-09-25 under Bun
1.3.11 with the suite's load on twelve cores, a test process that spawned two
children at once saw one of them exit and be reaped with no `exit` event and
no end of its stderr delivered, and the call waited forever — 2 of 128
parallel runs of `judge-property.test.ts`, 7 of 640 of a replica — where the
same runs through `Bun.spawn` lost none of 928. It is a runtime defect
observed, not understood; the transport's tests would hang, not pass, if it
came back.

Left: two readers are not converted, and none chooses a page the engine
judges. `tools/write-build-info.ts` reads git through a pipe when it stamps a
build, where a cut could misstate the build's commit, never a verdict; and
the test files' own setup `git` calls still come through Bun's piped
synchronous spawn, where a cut setup read is not checked. The v2 contracts'
ban on `spawnSync` is the engine's (a navigator's ruling on the slice): a
test may spawn synchronously, a test that runs the CLI reads its envelope
from a file the CLI wrote (`runCli`), and the setup calls are not converted.

Wanted: a Bun whose synchronous spawn returns a child's whole output.

### `read` resolves a title the way the manifest renders it

`read`'s title form matches the title the manifest renders, derived under
`field_sources` where the frontmatter carries none. The one derivation is the
basename, so a derived title is the page's name and resolves through the name
form first; the title form reaches only a title the frontmatter states.

Wanted: nothing until a second derivation exists.

### Not built, on purpose

The engine never calls a model, so there is no review tier that judges
prose: a judgment routes to a queue lane for a human. There is no semantic
retrieval tier (`search` is a deterministic identity ladder fused with
BM25, CJK-bigram tokenized), no `capture` verb that turns a git origin
into a source page, no connector layer, no rich-content checks (Mermaid,
images, tables), no publication target,
no access control, and no
parse cache or long-lived process (§Every run parses the whole corpus).
Each stays unbuilt until a bundle needs it.

## Behaviour that reads as a defect and is not

- **A devwiki pin's clean state is `unchanged`, never `current`.** A page
  pinned inside the repository it documents is one commit past its pin as
  soon as the pin is committed. `check --root devwiki` holds it to the
  covering diff: `unchanged` (head moved, covering diff empty) is the clean
  word; `stale` names a page to re-read and re-pin, and only after
  re-reading it.
- **A devwiki page cites the repository, never the build.** `check
  --root devwiki` holds every backticked repository path to the pin;
  `packages/cli/dist/main.js` and `devwiki/node_modules` exist on a machine
  and at no commit, so a page names them as `dist/main.js` under
  `packages/cli/` or they are `citation-unresolved`. Zero unresolved is the
  state to keep.

## Copying the tree without its history

Every devwiki page is pinned to a commit of this repository (`pin`, with
`origin: .`), and `check --root devwiki` measures each pin against the
enclosing repository's history. A copy of the tree with fresh history —
one squashed commit, or a new repository seeded from the files — has no
such commits: `check` reports every pin `unknown`, with `pin-unknown` on
each page, because the commit a pin names does not exist there.

The honest repair is to re-read each page's covered paths at the copy's
first commit and re-pin it there. The bytes are the same, so the read is
quick, but it is a read: the engine cannot see that the bytes match, so
there is no verb that re-pins blindly and there will not be one. The
alternative is to carry the history with the tree.

### The compiled binary

`bun run binary` compiles the CLI into `dist/wikiwright`, with the build
stamp compiled in, and `binary.test.ts` holds its `--help`, a verb's
`--help`, a `check` envelope and `version`'s build to `bun dist/main.js`,
byte for byte. Nothing else the package ships is compiled in: inside the
binary, `import.meta.url` names Bun's embedded file system (`/$bunfs/`), so
no shipped file resolves, and no verb reads one since `init` and `skills`
left with the old verbs. What follows, held by `binary.test.ts`:

- `version`'s `checkout_commit` and `checkout_dirty` are null: the
  binary's code sits in no checkout. `commit` and `dirty` name the build.

The binary is not published; the pipe probes build one under the temporary
directory and read its envelopes through a pipe.

Wanted: nothing while no verb reads a shipped file.

### An envelope over 1 MiB is refused, not spilled

An envelope over 1 MiB is `envelope-too-large` (exit 2) and names `--out
<file>`, which takes the whole envelope and leaves a two-line pointer on
stdout (`docs/cli.md` §The bound and `--out`). There is no automatic spill, no
preview of the refused envelope and no report directory the engine manages:
the first delivery defers them until host limits reject ordinary results
often enough that `--out` is a burden. The pipe probes cover the refusal
beside a default, a 70,000-byte and an error envelope. `--out` refuses a
file inside the bundle the invocation reads (`out-inside-bundle`).

### The old verbs left in step 6

The second step of the v2 delivery built the type-document loader:
`config/engine.json` schema version 4 and its libraries, the type, fragment
and vocabulary documents under `constitution/` and each library, shapes
compiled by Ajv with RE2, the fixed grammar's records, the page interface,
rules in CEL under the profile and its static bound, and the digests
(`packages/core/src/law/`, `schema/`, `records/`, `interface/`, `rules/`,
`digest/`; the adapters in `packages/cli/src/lawfiles.ts`). The third step
built the judge over it (`packages/core/src/verdict/`, `judgeTypeLaw`), its
four states (`packages/cli/src/lawstate.ts`: the working tree, drafts over
the disk, the index over HEAD, a revision), the rule tests and examples, and
the law diff. The fourth step rewrote the verbs over them, one commit each,
under `packages/cli/src/verbs/`, and step 5 migrated every corpus of this
repository onto the v2 law with `tools/migrate-spellings.ts`: `minimal-vault`,
`memory-synth`, the two handbooks, and `devwiki`, which imports
`libraries/kit-code`, the code wiki's type library, in place of the v1 kit.

Step 6 deleted the old table and its 24 verbs under `packages/cli/src/legacy/`,
with their tests. Every root is answered by the command table: a verb of the
old tree is `unknown-command`, a directory with no `config/engine.json` is
`bundle-not-found` (exit 3), and a bundle on the old
`config/constitution.json` is `constitution-invalid`, its engine.json not
schema version 4; `tools/migrate-spellings.ts` rewrites one. The old tree's
mechanisms leave one commit each after the verbs (contracts §12 step 6); the
old registry's core tests read frozen v1 copies of the corpora under
`fixtures/v1/` until the registry leaves. What the rewritten verbs leave:

- `check` absorbs `lint`, `fix`, `freshness` and `okf` (contracts §1). Not
  carried: `lint --since`, the replay of each commit against its parent
  (deferred with replay); `lint --stdin` and `lint --page`'s `--explain`
  (a draft is judged by `write --from --dry-run`); `freshness
  --fast-forward` (a pin is advanced by a write, after re-reading) and its
  uncommitted `generated/freshness.json` report (the pins are in `check`'s
  envelope under `pins`); every fixer but the folder-tag materializer and the
  generated files; base OKF's other checks, duplicates of the judge's
  frontmatter codes. `check` judges no template, export, installed skill or
  installed hook: each left with its mechanism (contracts §1).
- The queue (`generated/queue.md`) is cut from a judge run with no base, so
  a transition (`claims-transition`, `entry-edited`, `relation-removed`) is
  never in it: without a base each is `unevaluated`, which routes nowhere.
  A finding `check` reads from git (the pins) or computes beside the judge
  (`generated-drift`, `okf-missing-type`) is reported live and never
  written there.
- `write --from` absorbs `move`, `retire` and `new` (contracts §1). A batch
  lands through the batch writer: every page staged beside its path, then
  each renamed into place, then the paths a move left removed. Each page is
  its old or its new complete bytes; the batch is not transactional, so a
  crash between two renames leaves some pages new and some old, and one
  before the removals leaves a moved page at both paths. A move renames the
  file only: the index is the committer's to stage, where the old `move` ran
  `git mv`. A move that changes a page's name adds the old name to its
  `aliases` and rewrites every wikilink that names it — a body link, a
  claim's provenance, a relation's target — and no frontmatter page
  reference, which the alias keeps resolving; `relation-removed` now
  matches a relation by its label and the page its target resolves to, so
  the rewritten relation is the same relation. An operation and a draft may
  not name one page (`draft-overlaps-op`): a supersession by a claim the
  same batch adds is written in the draft, whose clause the grammar reads.
  Not carried: the stdin form and `--section --append` (a draft is a
  page), `--retract`, `--replace-core` and `--correct` (operations, or a
  draft: a typo-sized correction passes `claims-transition`), the new-page
  identity gate's stem tier, `--not-any-of` and the advisory `near` list
  (an existing page a draft collides with is the judge's
  `identity-collision`, which refuses the batch on whichever page it is
  reported), the retirement banner, and `new`'s templates,
  `--item` and `--set`.
  A move that changes only the case or the normalization of a page's path
  is refused (`move-case-only`): on a case-insensitive filesystem the two
  spellings are one file, and a page's name is compared case-folded, so the
  rename changes no link; `git mv` renames the file.
- A page's status (`read`, and each `search` result) keeps its two reasons
  apart: `reason` says why `stale` is true or null, and `unresolved_reason`
  why `unresolved` is null (`queue-stale`, or `queue-missing` when there is
  no queue.md to read), where the contracts' §9.5 names one `reason` for
  both. `search` measures the pins of every page it returns and of the pages
  each one links, per invocation: the git work grows with the results, and
  `--limit` bounds it. A tag alias no longer resolves under `--tag`.
- `bundles`, `export`, `graph`, `init`, `modules`, `skills` and `schema`
  have no place in the command table (contracts §1): the skill discovery,
  the exports, the graph query, the starters, the modules and the installed
  skills leave with their mechanisms, and `<verb> --help --json` replaces
  `schema`. Nothing scaffolds a bundle (§No starter).
- `WIKIWRIGHT_ROLE` still bounds every verb by its declared role (`check`
  and `write` a writer's, `gate` and `rule` a maintainer's, the others a
  consumer's); the bound leaves in its own commit of step 6 (contracts §1).
- Every v4 key names the function that reads it, of core or of the shell
  (`ENGINE_V4_CONSUMERS`), and a test holds the function to exist and to
  read the key.
- `gate` absorbs `lint --staged`, and the published hook definition
  (`.pre-commit-hooks.yaml` at the repository root, `wikiwright-gate` at
  `pre-commit` and `wikiwright-commit-msg` at `commit-msg`) and two
  documented one-liners replace the `hook` verb's installed scripts.
  Nothing installs a hook: a repository adds the definition to its
  pre-commit config, or writes the one-liners into `.git/hooks`. Not carried
  from the old gate: the kits a bundle declared by path, read from the index
  (modules leave), the exports, and `WIKIWRIGHT_BYPASS` with its log, which
  was the installed scripts' (`git commit --no-verify` skips a hook). The
  demotion is today's: a queued error on a line the base holds unchanged is
  a warning (`details.demoted_from: "error"`), except a frontmatter that
  does not read, an identity collision, an instance count or an illegal
  exception; a finding with no line — a missing key or section, a CEL page
  rule, the page as a whole — is never demoted, as the old gate never
  demoted one, so such a finding a page already carried blocks the next
  commit that touches the page until it is repaired or excepted; a
  transition (`entry-edited`, `claims-transition`, `relation-removed`, a
  CEL rule that reads `before`) is never demoted. A finding at a section
  occurrence's heading — its count, order or depth, a `require` row, a CEL
  section rule — is inherited only when the occurrence's raw text is its
  base occurrence's byte for byte, so an item added under an unchanged
  heading touches it. Not covered: a CEL section rule that reads `page`
  outside its own section is demoted when the commit changes only what it
  reads there. A verdict that reads the vault's names — a wikilink, a
  relation's target, a page reference and its `target_type` or
  `target_root`, a CEL rule, which may read `facts.links` — is asked again
  of the page against the names the base held, a page the commit deletes
  among them; one those names would not
  have given is the commit's and is never demoted or scoped away.
- No finding of the new judge is fix-routed but the two whose fixers
  survive: `folder-tags-present` under `materialize-add-only` and
  `generated-drift`, whose `fix` names `check --fix` and `check --write`.
  The fixers the kernel ran on a page (`frontmatter-set`,
  `frontmatter-delete`, `tag-rename`, `section-stub`, `heading-depth`,
  `link-rewrite`, `retype`, `history-close`) leave with `fix` (contracts
  §1), so each code they served queues to the lane it fell through to.
- The contracts name few page-level codes; the judge's are this step's, and
  `docs/v2-dispositions.md` maps every v1 id to the one that carries it:
  `type-unknown` (v1 `unknown-type`), `page-shape-invalid` (the shape's
  six v1 codes, Ajv's keyword in `details`), `page-ref-type`,
  `vocabulary-unknown` and `vocabulary-retired` (the tag, category and label
  codes), `section-count`, `section-order` and `section-undeclared` (v1
  `sections`), `section-depth` (v1's id, kept; the loader's
  `sections-conflict` is a contradiction in the law, never a page's
  finding), `item-unparsed`, `require-unmet`, `claim-closed` and
  `claim-open` (v1 `closed-claim-in-facts` and `history-marker`, now the
  claims `closed` parameter of the navigator's ruling 4), `entry-edited`,
  `instances-min` and `instances-max`, `rule-error`, `unevaluated`,
  `exception-applied`, `rule-untested`, `rule-test-fails`, `example-fails`,
  `law-changed` and `law-relaxed`. A section's own `severity` is gone, so
  each code carries its row's: the grammar parameters an author declares
  are errors, where v1 defaulted them to warnings, and a dangling link or
  relation target stays a warning.
- `claims-transition` holds every open claim of a claims section: v1 held
  only the categories of class `supersede` or `accumulate`, and the classes
  left with the v1 vocabularies. A claim is matched by its category and its
  handle, as v1 matched category and core, so one retracted or superseded
  in place, moved to another claims section, or given another source keeps
  both and passes, and one given another category is a new claim that
  leaves the old one unclosed; a typo-sized correction
  passes; and one that left is recorded only by a new dated entry quoting
  its core, where v1 read the section the claims `history` parameter
  named. `relation-removed` holds every relations section, as v1 did, as an
  error. The removal of a closed claim is not a finding, as in v1.
- An exception names a rule and a reason, no evidence digest, so it closes
  every finding of its rule on its page; each closed finding stays visible
  as `exception-applied`.
- A transition the state cannot judge is `unevaluated`, an info finding on
  the page and a count in the verdict's `unevaluated` block; beside the
  contracts' `no-base`, its reason can be `base-unreadable`, a base whose
  bytes do not read as a page.
- A symbolic link or a submodule at, under or above a content root is read
  through by none of the four states: the index and a revision hold a link
  as the text of its target's path and a submodule as a commit id, the
  working tree would read through either, and the one rule all four can
  keep is to read through none. What is behind one is not judged; each is
  reported, alike from all four, as `path-skipped` (a warning, queued to
  `identity-review`, `details.kind` `symbolic-link` or `submodule`), and a
  draft at or under one is refused. The working tree walks with lstat, so a
  link that loops is never entered, and a path that vanishes mid-read is
  read again as a tree that changed.
- A page reference in frontmatter is a bare page name (`origin: Herb
  bed`); `[[Herb bed]]` there names no page, and a reference that names no
  page is `page-ref-type` (`details.kind: unresolved`), an error as v1's
  `field-shape` was; one written as a path is `page-ref-type`
  (`details.kind: path`) with the canonical name.
  A reference resolves against the vault's names, which hold the content
  roots' pages only, so a `target_root` naming a source root that no
  content root covers (the contracts' §2 layout, `raw/` beside `wiki/`)
  could never be met and is refused at load (`shape-invalid`) until the
  navigator decides whether the names index the source roots' pages too.
  Only a top-level property's `target_type` and `target_root` are read, so
  the loader refuses either one anywhere else (`shape-invalid`): a nested
  page reference, one applied in place, one in a `$def`.
- A type's `instances` bound counts the pages of that type and of every
  type that descends from it, ancestry counted as `target_type` counts it,
  so a bound on an abstract type holds (library `code`'s `quickstart`, at
  most one page, is met by the pages of devwiki's `quickstart`, which
  extends it). The bound is the declaring type's own and is not inherited
  as a declaration; v1 inherited it into each child, which counted its own
  pages only, and refused a child that relaxed it (`instances-relaxed`).
  The two differ for two sibling types under one bounded type: v1 held each
  sibling to the bound, v2 holds their pages together. A child cannot
  relax an ancestor's bound, since the ancestor's is still counted; the
  navigator has not ruled on this reading of §3.
- A rule test's or an example's page resolves its links and relation
  targets against the vault that judges it, and §8 counts every warning on
  a negative, repaired or positive page. A library's test that names a
  target would fail as `rule-test-fails` in every bundle that holds no page
  of that name, so library `code` ships no test set for `relation-range`,
  whose negative must point a relation at a page of the wrong type, and
  ships examples of only the three kinds a page may write without a
  relation; devwiki carries the set under its own `rule-tests/`. The cost
  falls on every importer: the gate holds a rule its law diff adds to its
  test set as an error, so a bundle that imports `libraries/kit-code` in
  any commit after its first is refused (`rule-untested`, error, exit 5)
  unless it carries `rule-tests/relation-range/` of its own, naming its own
  pages; a first commit has no HEAD and no law diff, and `check` only
  warns. `libraries.test.ts` holds both. Open for the navigator: whether a
  test page and an example resolve first against their own test set and
  their owner's `examples/`, then the vault, which would let a library ship
  the set and an example of every type.
- A type's `examples` names paths relative to the root of the bundle or
  library that declares it, under its `examples/`; every page under an
  `examples/` directory is judged as a page of its type whether a type
  names it or not.
- The law diff reports six kinds the contracts' §8 list does not name,
  each a relaxation a passing page would otherwise conceal:
  `vocabulary-mode`, `vocabulary-retired-removed`, `rule-attachment`,
  `extensions`, `source-roots` and `field-sources`. They await the
  navigator's word to join §8.
- The law diff needs HEAD's law to load. `headLawDiff` gives the gate its
  answer when HEAD's law does not (a bundle's first v4 commit, or a law
  broken at HEAD): one change, `head-law-unloadable`, with HEAD's issues in
  its details, so the commit message must carry `law-change: <reason>`,
  and every rule of the index's law counted as added, so each untested one
  is an error; with no HEAD at all there is no law diff (§9.2). The `gate`
  verb calls it in step 4; the navigator has not ruled on it.
- A path is keyed in NFC by every adapter; on a filesystem that keeps the
  two normalisations apart, two files whose names differ only by them are
  one page to the engine and two to the filesystem (the navigator's
  ruling 9). Nothing reports it.
- The static bound counts a config list at its actual length, after
  `configure` (the navigator's ruling 1): a rule's config is known at load,
  so `config.require.all(r, section.items…)` costs its rows times 5,000, and
  the loader asks the bound again at every type whose `configure` extends a
  rule's config, refusing it there (`rule-invalid`, limit `cost-bound`,
  `pointer: /configure/<rule id>`). One type's ancestry chain,
  `facts.ancestry[t]`, is a range of at most 32, and a chain longer than 32
  is `law-too-large` at the type (`details.limit: ancestry`). Under that
  bound the feasibility spike's nested forms of `relations-required` and
  `relation-range` are admitted as the spike wrote them.
- The static bound counts comprehension iterations, not the work inside
  one. The data holds every bound the count multiplies: `parsePage`
  refuses a page over 200 sections, a grammar section over 5,000 items, a
  frontmatter list or map over 1,000 members and a page linking over
  10,000 distinct targets as `page-too-large` (`details.limit`); the
  loader refuses a rule's config list over 1,000 (`rule-invalid`, limit
  `config`), a vocabulary over 10,000 entries (`vocabulary-invalid`), a
  declared `default` list over 1,000 (`type-invalid`) and a law over
  10,000 types or vocabularies (`law-too-large`). What stays uncounted, by
  the same ruling, is the linear work a built-in does in one iteration:
  `x in` a list, `join`, `contains`, `matches` over a string. The worst
  case that leaves: `section.items.all(i, i.label in
  facts.vocabularies['v'])` is admitted at 5,000 iterations and does up to
  5,000 × 10,000 comparisons, and a string operation inside an iteration
  walks up to the page's 1 MiB, so an admitted rule at the bounds can take
  seconds on one page. There is no runtime budget, as §6 decides.
- `Intl` is in the bundle: `@bufbuild/cel` calls `Intl.DateTimeFormat` for
  a `get*` time method given a time zone, and `Intl.NumberFormat` for
  `format`'s fixed-point clause. Neither is reachable from an admitted rule
  (the profile refuses every such call, and `format` is not registered);
  `rules-profile.test.ts` greps the CLI's bundle for exactly those two
  sites and proves the calls refused. It builds that bundle with `bun build`
  in a child process, because `Bun.build` inside a `bun test` process fails
  to read its inputs on Bun 1.3.11.
- The loader reads the repository's own regular files only: a symbolic
  link or a submodule under a law directory, a law directory or a library
  root that is one, and a library root under a linked directory are
  `law-foreign-file` from the tree and from the index alike, wherever the
  link points; the index holds each as one entry (mode 120000 or 160000),
  and the tree does not read through what the index cannot. A library
  vendored as a submodule is therefore refused, not read. A bundle in no
  repository is its own top level: its library paths are read from the
  bundle root.
- `write` stamps `created` on a page new to the vault, where the draft
  carries none, and `updated` on every page a batch changes (the navigator's
  ruling 7), through the clock seam (`WIKIWRIGHT_TODAY`). Both keys are
  reserved, so every effective shape declares them and every such page is
  stamped; a page whose frontmatter does not read, or whose type the law
  does not declare, is not, and the judge reports it.
- A rule id may not be a code the judge or the loader reports, nor
  `candidate`, the id `rule try` gives its candidate (contracts §9.4):
  either is `rule-collision`, `details.kind` `kernel-code` or `reserved`.
  `rule try` judges its candidate with the whole judge over every page, and
  reports only the candidate's outcomes; it runs no rule test, so a
  candidate carries no test set until it is declared.
- A library's `library.yaml` has its own line in the law digest, beside
  the five law directories the contracts list, because it can change the
  library's id and with it every qualified name.

## Next work

1. Run the release matrix by hand before calling a build a release, and
   carry the gate to Windows, which nothing reaches.
2. Close the limitations above in the order a bundle asks for them: a
   documented starter, a `write` operation that shifts citations, the ledger layout
   for `code/decision`, a published kit; for installed bundles, a declared
   dependency between bundles, `references` and `outline`, a report type a
   proposal is written in, and a filter by applicability.
3. For modules: a proof cache that outlives the process, keyed on the
   engine version too (§A module's proofs are taken once per process), and
   a `modules list` that reports a declared module without importing it
   (§A module runs because it is installed).
4. The capture verb, the connector layer, rich-content checks, publication
   and access control are candidates, none scheduled.

## Developing against it

- **`check --root devwiki` needs nothing installed.** devwiki imports
  `libraries/kit-code` by its path from the repository's top level, and the
  library is data read from the tree. Nothing installs the v1 kit any more:
  the verbs that loaded it left in step 6.
- **Bun's per-test budget is five seconds.** A case that installs a kit and
  drives a dozen verbs exceeds it: build the bundle in `before` and keep one
  `it` per verb, or state `{ timeout }` on a deliberately sequential walk.
  `tools/run-suite.ts` gives a test or a hook twenty seconds, because its
  files run side by side and a hook that installs a kit takes several times
  longer under that load than alone; write against the five seconds a single
  `bun test ./<file>` keeps, and the case holds under both.
- **A test that stamps a date reads the clock.** Set `WIKIWRIGHT_TODAY` in
  any test that spawns `write`, or the stamp moves with the day.
- **The corpora are fixtures, all on the v2 law.** A change to `devwiki`'s
  pages or constitution is judged by `fixture-verdicts` (no error under
  `check` and `gate`, its warnings only its pins), `routing-xor`,
  `coverage-coherence` and `generated-tracked` (its `generated/` must be
  what this build renders). Regenerate `devwiki/generated`, the brief and
  the queue included, with `wikiwright check --write --root devwiki` after
  any page edit or an engine change that moves the brief. The two handbooks
  under `fixtures/handbooks` are held at zero findings under `check` and
  `gate` by `fixture-verdicts` and their tracked `generated/` by
  `generated-tracked`; an engine change that moves the brief moves theirs
  too, and `wikiwright check --write --root fixtures/handbooks/<name>`
  regenerates each.
