# Roadmap

Where wikiwright stands, what it deliberately does not do yet, and what
comes next. `docs/architecture.md` says how the engine is built; this page
says what a user will run into and what is planned. When a mechanism is
missing or unverified it is written here, with the command or declaration
that would close the gap, rather than left for a reader to discover.

## Status

wikiwright 0.1.0 is two packages and a kit. `@wikiwright/core` is the
kernel and the standard library (claims, relations, entries), a pure
library over bytes. `wikiwright` is the binary: 24 verbs, one module each,
one JSON envelope per invocation; `docs/cli.md` lists every verb and flag.
Every envelope of a verb that reads a vault's law names the bundle it read —
its label, real root, head, whether it is dirty, and digests of its law and
its content. `bundles list` lists the bundle skills installed in the skill
directories, `--bundle` names one as the target of any verb, and `read` returns a page's sections
verbatim with the page's digest, under a byte budget. A bundle declares its
exports in `config/engine.json`, read-only copies of itself or of part of it
that a host installs as skills: `check --write` renders them into its own
`skills/`, `check` and the staged gate hold them to a fresh render, `export`
writes one into another repository, and a plain copy of one answers every
reader under the identity its marker gives it. Three skills ship
beside the binary, for using, writing and maintaining a bundle, and each role
prints its own brief; the package root is also a Claude Code plugin with two
hook scripts. `@wikiwright/kit-code` is the shipped domain kit for the wiki of
a code repository, consumed by the `code` starter and by this repository's
own `devwiki`.

The suite is 1,646 tests across 114 files. At `29dbfb9`, when it held 1,590,
the full gate, `bun run check`, passed them all with the test files under
Bun and the CLI under Node (`tools/run-suite.ts`), and the full node runner,
`bun run test:node`, passed 1,590 of 1,590 with every file under Node. It
judges five corpora (`devwiki`, `fixtures/memory-synth`,
`fixtures/minimal-vault`, and the two gardening handbooks under
`fixtures/handbooks`, which the two-bundle tests read end to end) and proves
the module ladder end to end twice: with a neutral module fixture under
`fixtures/conformance` and with the shipped kit. `devwiki` is a bundle over the kit whose pages are pinned to
this repository: `check --root devwiki` reports zero findings and
`freshness --root devwiki` holds every citation to its pin. Measured on
2026-09-25 on the development machine at `5af44d8`, where `check --root
devwiki` needs the install and nothing else, `freshness` read all 27 pinned
pages `unchanged` and none `stale`, with no `stale-capture`,
`stale-source-cited` or `citation-unresolved` finding. A later change to
code a page covers makes that page `stale` until it is re-read and
re-pinned, and `freshness` names it: the pages covering `exports.ts`,
`artifacts.ts` and `verbs/export.ts` are `stale` after the commit that reads
exports through links, until they are.
A citation into a file its page does not cover is held to the pin but not
to the file's later changes, so such a reference either is covered or goes
through the page that covers the file.

The gate is `bun run check` (biome, the build, the test-project typecheck,
the whole suite). `scripts/hooks/pre-commit` runs it on the machine that
commits, and `.github/workflows/check.yml` runs it, then the node runner
(`bun run test:node`), on every push and pull request on Linux and macOS.
`sh scripts/release-matrix.sh` is run by hand before a release; Windows is
unverified.

## Known limitations

Each entry names what is missing and the command or declaration a user
would want.

### `init` does not load a starter's declared modules

The module preload is the one asynchronous step in `main.ts`, keyed on the
target root's existing `engine.json`, and a verb's `plan` is synchronous.
So `init --constitution code` always lands without artifacts and brief,
even when the kit is already installed, and its envelope names the steps to
run next (`bun install`, the first load that proves the kit, `check --write`).

Wanted: `wikiwright init --constitution code`, in a directory where the
install already happened, rendering `generated/` and the brief in that one
run. That needs the plan to be asynchronous — a change to
the dry-run law's machinery, not to `init`.

### `freshness` holds a citation to its pin, not to what the lines say

A code span is a citation when it is a repository path whose first segment
is an entry at the root of the tree at the pin (`packages/cli/src/pages.ts:75`,
and a root file such as `package.json:26`), the bare name of exactly one
file the page covers (`git.ts:31`), or a line alone (`:166`), which names
the nearest file cited before it on the page; each is held to the pin, its
path to exist and its line to be inside the blob, and `checked` counts it.
What is not checked is whether the cited lines still say what the sentence
says they do, and when covered paths move, the shift of a page's citations
is done by content, outside the engine; no verb offers it.

Wanted: `freshness --shift`, a writer over pages that relocates each
citation by content and re-pins. It belongs to a verb that writes.

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
A byte scan cannot see a name bound or built at runtime: `const D = Date;
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

`check --write` lands each generated file temp-then-rename. A crash in the
middle of the loop leaves a mix of old and new files; the next
`check --write` converges them. There is no transactional write of the set.

### Every run parses the whole corpus

A verb starts, reads the pages its state names, judges them and exits; the
only state of the vault between two runs is the bytes in git. There is no
cache of parsed pages and no long-lived process, on purpose: a cache is a
second state that can disagree with the first, and a daemon is the process
the thesis excludes (`docs/architecture.md`). The one thing kept between runs
is Node's compile cache of the engine's own JavaScript, which
`packages/cli/dist/bin.js` switches on: V8 bytecode keyed by the source it was
compiled from, under the operating system's temporary directory. It holds
nothing of a vault and cannot change a verdict, only how long the engine
takes to load; `NODE_DISABLE_COMPILE_CACHE=1` turns it off. The cost grows with the corpus. Parsing and reading
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

The hook runs where the commit happens; the workflow declares the gate and the
node runner on Linux and macOS, and has not yet been observed to run: on this
private repository, on every push and pull request through 2026-09-11, GitHub
created both jobs and ended them within seconds with no step run, and the
job's annotation names the account's billing and spending limit rather than
anything in the tree. Until the account allows a hosted runner, or the
repository is public, the gate's evidence is the hook and the by-hand runs on
one machine. `sh scripts/release-matrix.sh` runs the
gate, the node runner, a pack and the corpus verdicts in one command, by
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

### A problem is reported to a destination the engine only names

An export declares where a problem with a copy is reported (its
`contribution`); a `bundle-readonly` refusal, the post-edit hook and
`bundles list` say it. The engine sends nothing, and no bundle declares the shape a proposal must take.

Wanted: a report type a bundle declares in its constitution, and a verb that
writes a proposal in it where the export's contribution says.

### No editor protocol, no transaction across writes, no model of time

There is no language-server adapter; no transaction spans more than one
`write --from` batch, which lands all its drafts or none; and a bundle's
history is git's and its dated entries, so no verb answers what a bundle said
on a given date.

Wanted, each when a bundle asks for it: an adapter that serves findings and
names over the language-server protocol, a transaction across verbs, and a
verb that reads a page as it stood at a revision.

### The plugin runs from a built checkout

The package root, `packages/cli`, is the plugin, and each hook runs this
package's own binary, which imports `@wikiwright/core` as a workspace
dependency. The supported layout is a checkout with its workspace
dependencies installed and built (`bun install`, `bun run build`), with the
plugin loaded from it in place, for example with `--plugin-dir
packages/cli`. A copy of the plugin directory alone carries no
`@wikiwright/core`: its binary fails to load, and its hooks print nothing, as
they do on any failure, so the missing dependency looks like a session with
nothing to say. Neither layout has been run inside a host here (below).

Wanted: a plugin that carries its dependencies, or a supported install that
provides them, and a hook smoke test from that layout.

### What installed bundles have not been evaluated for

The scenario test drives two handbooks end to end, mechanically. No
evaluation has measured whether an agent that writes a bundle and an agent
that reads one do better with it than without: whether the right passage is
found, attributed and kept. No synthetic scenario checks that nothing travels
where it should not, such as a passage read from one bundle reaching another
bundle's pages, a proposal or a hook's context unasked.

Wanted: an author-and-reader evaluation over synthetic bundles, and synthetic
privacy-regression scenarios beside the suite.

### The hook scripts are tested against a document, not a host

`hooks-scripts.test.ts` drives both scripts with synthetic stdin and holds
their output to the input and output shapes the Claude Code hooks reference
documents, read on 2026-09-24. No host has run them in this repository:
whether and when a session shows their context is unverified.

Wanted: a recorded run inside a host, kept beside the test.

### The session-start hook does not say how to update a copy

The session-start hook names each installed bundle skill and where it was
found, and nothing about how the copy was installed or how it is updated.

Wanted: the action that fits how each copy was installed. It is the next
commit's work.

### The shipped skills do not yet speak of copies

A copy's `SKILL.md` names the `wikiwright-consume` skill and says it ships in
the engine's repository, not where an installed engine keeps it, and no
command installs the engine or that skill beside a copy. The maintainer's
skill says nothing about choosing what to export or about what an export
discloses: every selected page, `config/` verbatim and each declared kit
travel, so a page a maintainer would not publish must be left out of the
selection.

Wanted: a runtime skill a copy's `SKILL.md` can locate exactly, and the
export practices, with that warning, in the maintainer's skill.

### The staged gate reads a `node_modules` kit from the working tree

A kit under `node_modules` is not in the index, so the staged gate renders an
export's copy of it from the working tree, as the preload loads it: a commit
is judged against the kit installed on the machine that commits, not one the
commit carries. A kit declared by `path` is in the index and read from it.

Wanted: nothing while `node_modules` stays untracked; a bundle that must pin
its kit exactly declares it by `path`.

### Exports not built yet

No thin pointer: an export always copies, and none names the bundle's
repository in place of its pages. No `propose`: a reader of a copy reports a
problem where its `SKILL.md` says, by hand; no verb files it.

### What a host does with a copy is unverified

No host has installed a rendered export here. Unverified: how a skill
installer that fetches from a repository handles symbolic links, size limits,
pinning to a branch and updating a pinned copy; where each host caches a
plugin; whether every host sets the skill-directory variable a `SKILL.md`
names; how a skill store lists a generated plugin; and whether a host follows
a skill directory that is a symbolic link. That the loader accepts a copy
whose declared source roots are absent is verified (`export-copy`).

### `bundle-readonly` is a guardrail on the CLI

A root that holds a marker refuses a verb that can write, however it was
named. A process that does not go through the engine is not stopped at all,
and a copy whose marker is removed is a bundle like any other.

Wanted: nothing in the engine. Isolation is the filesystem's: a read-only
mount or permissions.

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

The suite also runs the CLI under Node: `tools/run-suite.ts` sets
`WIKIWRIGHT_CLI_RUNTIME` to the `node` on PATH, resolved to an absolute path
so a test that runs from another directory finds it, and refuses to run when
it finds none rather than fall back to Bun; every test that runs the CLI runs
it under that (`packages/cli/test/fixtures/runtime.ts`). That seam
reaches only the CLI a test spawns. The engine functions a test calls in its
own process still run under Bun, and their git reads are covered by the
transport above, not by the seam; `judge-property.test.ts`, which judges
states it builds that way, asserts each state's pages before any verdict
read from it, since an empty or short state judges clean. The shipped engine
does not use Bun's synchronous spawn: `dist/bin.js` is a Node script.

Left: three readers are not converted, and none chooses a page the engine
judges. `tools/write-build-info.ts` reads git through a pipe when it stamps a
build, where a cut could misstate the build's commit, never a verdict; the
plugin's
hook scripts read the CLI's envelope through a pipe, best-effort feedback
that judges nothing; and the test files still run under Bun, so the envelope
a test reads back from the CLI, and the test's own setup `git` calls, still
come through Bun's piped spawn. A cut envelope does not parse and fails its test loudly; a cut
setup read is not checked. The tests that run Bun on purpose are
`run-suite.test.ts`, which drives the runner, and the one `vocabulary show`
case that compares Bun's output with Node's.

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
images, tables), no publication target beyond the exports a bundle declares,
no access control, and no
parse cache or long-lived process (§Every run parses the whole corpus).
Each stays unbuilt until a bundle needs it.

## Behaviour that reads as a defect and is not

- **A finding's argv names its state.** `gate` and `lint --staged` hand out
  `fix … --staged`; `check` and `lint` do not. Running one in the other
  state is `expect-mismatch` with the switch named in the hint, never a
  silent no-op.
- **`hook-stale` fires on every bundle whose hook an older build wrote.**
  Its argv reinstalls the hook, chain kept; a foreign hook is not listed.
- **A devwiki pin's clean state is `unchanged`, never `current`.** A page
  pinned inside the repository it documents is one commit past its pin as
  soon as the pin is committed. `freshness --root devwiki` holds it to the
  covering diff: `unchanged` (head moved, covering diff empty) is the clean
  word; `stale` names a page to re-read and re-pin, and only after
  re-reading it.
- **A devwiki page cites the repository, never the build.** `freshness
  --root devwiki` holds every backticked repository path to the pin;
  `packages/cli/dist/main.js` and `devwiki/node_modules` exist on a machine
  and at no commit, so a page names them as `dist/main.js` under
  `packages/cli/` or they are `citation-unresolved`. Zero unresolved is the
  state to keep.

## Copying the tree without its history

Every devwiki page is pinned to a commit of this repository (`pin`, with
`origin: .`), and `freshness --root devwiki` measures each pin against the
enclosing repository's history. A copy of the tree with fresh history —
one squashed commit, or a new repository seeded from the files — has no
such commits: `freshness` reports every pin `unknown`, with
`pin-unknown-to-origin` on each page, because the commit a pin names does
not exist there.

The honest repair is to re-read each page's covered paths at the copy's
first commit and re-pin it there. The bytes are the same, so the read is
quick, but it is a read: the engine cannot see that the bytes match, so
there is no verb that re-pins blindly and there will not be one. The
alternative is to carry the history with the tree.

## Next work

1. Run the release matrix by hand before calling a build a release, and
   carry the gate to Windows, which nothing reaches.
2. Close the limitations above in the order a bundle asks for them: the
   asynchronous plan for `init`, `freshness --shift`, the ledger layout
   for `code/decision`, a published kit; for installed bundles, a declared
   dependency between bundles, `references` and `outline`, a report type a
   proposal is written in, and a filter by applicability.
3. Run the two hook scripts inside a host and record what a session sees.
4. Find a copy by name over the skill directories and guard every marked
   root against a write; then the runtime skill, and the export practices in
   the maintainer's skill.
5. The capture verb, the connector layer, rich-content checks, publication
   and access control are candidates, none scheduled.

## Developing against it

- **A fresh clone runs one step before `check --root devwiki` judges
  anything:** `bun install`, which links `@wikiwright/kit-code` into
  `devwiki/node_modules`. Until it, `check` is `module-unresolved`, and the
  hint names the install; after it, every load proves the kit before it
  judges anything. Every test judges a copy under `os.tmpdir()` that installs
  the kit from the shipped package (`packages/cli/test/fixtures/kit-code.ts`),
  never the shipped tree.
- **Bun's per-test budget is five seconds.** A case that installs a kit and
  drives a dozen verbs exceeds it: build the bundle in `before` and keep one
  `it` per verb, or state `{ timeout }` on a deliberately sequential walk.
  `tools/run-suite.ts` gives a test or a hook twenty seconds, because its
  files run side by side and a hook that installs a kit takes several times
  longer under that load than alone; write against the five seconds a single
  `bun test ./<file>` keeps, and the case holds under both.
- **A test that stamps a date reads the clock.** Set `WIKIWRIGHT_TODAY` in
  any test that spawns `write` or `new`, or the stamp moves with the day.
- **The corpora are fixtures.** A change to `devwiki`'s pages or
  constitution is judged by `starter-fixtures` (under the `code` starter's
  types merged with devwiki's own vocabularies the error set must equal
  devwiki's own, so a concrete type devwiki adds must exist in the starter,
  while a tag or a label is devwiki's to register), `routing-xor` (its
  `lint` must be clean) and `generated-tracked` (its `generated/` must be
  what this build renders). Regenerate `devwiki/generated`, the brief
  included, with `wikiwright check --write --root devwiki` after any page
  edit or an engine change that moves the brief. The two handbooks under
  `fixtures/handbooks` are held at zero findings under `check` by
  `fixture-verdicts` and their tracked `generated/` and rendered exports
  under `skills/` by `generated-tracked`; an engine change that moves the
  writer's brief, or what an export carries, moves theirs too, and
  `wikiwright check --write --root fixtures/handbooks/<name>` regenerates each;
  they declare no module.
