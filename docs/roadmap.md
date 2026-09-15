# Roadmap

Where wikiwright stands, what it deliberately does not do yet, and what
comes next. `docs/architecture.md` says how the engine is built; this page
says what a user will run into and what is planned. When a mechanism is
missing or unverified it is written here, with the command or declaration
that would close the gap, rather than left for a reader to discover.

## Status

wikiwright 0.1.0 is two packages and a kit. `@wikiwright/core` is the
kernel and the standard library (claims, relations, entries), a pure
library over bytes. `wikiwright` is the binary: one module per verb, one
JSON envelope per invocation, `docs/cli.md` lists every verb and flag.
`@wikiwright/kit-code` is the shipped domain kit for the wiki of a code
repository, consumed by the `code` starter and by this repository's own
`devwiki`.

The suite is 1,357 tests across 91 files, green under Bun and under the
node runner. It judges three corpora (`devwiki`, `fixtures/memory-synth`,
`fixtures/minimal-vault`) and proves the module ladder end to end twice:
with a neutral module fixture under `fixtures/conformance` and with the
shipped kit. `devwiki` is a bundle over the kit whose pages are pinned to
this repository: `check --root devwiki` reports zero findings and
`freshness --root devwiki` holds every citation to its pin.

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
even when the kit is already installed and granted, and its envelope names
the steps to run next (`bun install`, a maintainer's approval, `check --write`).

Wanted: `wikiwright init --constitution code`, in a directory where the
install and the grant already happened, rendering `generated/` and the
brief in that one run. That needs the plan to be asynchronous — a change to
the dry-run law's machinery, not to `init`.

### `freshness` checks only the citations it can read without the page's context

A full repository path with a line (`packages/cli/src/pages.ts:75`) is held
to the pin. A bare `:166` after it, meaning "the same file", is a convention
of the paragraph rather than a rule the engine has, so it is not checked and
`checked` does not count it; nor is a citation into a file at the repository
root (`package.json:26`), because a cited path is recognised by the `/` in
it. When covered paths move, the shift of a page's `path:line` citations is
done by content, outside the engine; no verb offers it.

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

### The purity scan narrows; it does not sandbox

`trust grant` scans a module's bytes for the calls a pure module must not
make and refuses by file and line. A byte scan cannot see a name built at
runtime. The grant is a machine-local statement that a human read the
module; it is not a sandbox, and nothing here claims otherwise.

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

A verb parses each page once. `check` reads the tree into one state and
`parsedPages` keeps each page's parse on that state, so the artifacts, the
brief and the verdict share it, where `check` once walked and parsed the tree
three times; `brief-stale` compares the brief already rendered. The gate's
drift pass, rename review and verdict share one parse of the index, a staged
transition reuses an unchanged page's parse as its base and skips a base no
section or body law consumes, and every declared transition arm still runs.
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
5 ms on this machine. An earlier
version of this paragraph said 80 ms a process; that figure included the
startup of the timer used to take it.

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

### A grant is keyed by where things are

A vault grant is keyed by the vault's real path, and a worktree grant by the
real path of the repository's git common directory and the vault's path
inside its worktree. A replacement vault, or a replacement repository, at the
same path can inherit approval for the same module digest. Grants for paths
that no longer exist stay in the store until revoked, and `trust list` shows
only the ones that apply to the vault it is run in. A fresh CI clone on a new
machine still needs its own authorized setup; the worktree scope covers
linked worktrees on one machine.

`trust list --all` is the inventory: every record with its identity, the path
it is keyed by and whether that path is still on this machine. `trust revoke
--record <identity>` removes one, needing neither a vault nor a repository, so
a record whose directory is gone can be removed at all.

Wanted still: a prune that selects records itself. It needs a rule that tells
a path which is gone from one which is merely unavailable — an unmounted
volume, a disk not attached — and an exact dry-run output, since a prune that
guesses wrong removes approvals nobody meant to withdraw. Until then, removal
is one named record at a time.

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

### Not built, on purpose

The engine never calls a model, so there is no review tier that judges
prose: a judgment routes to a queue lane for a human. There is no semantic
retrieval tier (`search` is a deterministic identity ladder fused with
BM25, CJK-bigram tokenized), no `capture` verb that turns a git origin
into a source page, no connector layer, no rich-content checks (Mermaid,
images, tables), no publication or export target, no access control, and no
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
   for `code/decision`, a published kit.
3. The capture verb, the connector layer, rich-content checks, publication
   and access control are candidates, none scheduled.

## Developing against it

- **A fresh clone runs two steps before `check --root devwiki` judges
  anything:** `bun install` (links `@wikiwright/kit-code` into
  `devwiki/node_modules`), then a maintainer's `wikiwright trust grant
  module:@wikiwright/kit-code --root devwiki`, with `--scope worktrees` when
  sessions open linked worktrees of one clone. Until the first, `check` is
  `module-unresolved`; until the second, `module-untrusted`; each hint names
  the step and neither hands out a grant command. The grant is this
  machine's, per vault path or per worktree scope, and the suite never reads
  it: every test judges a copy under `os.tmpdir()` that
  installs the kit from the shipped package and grants it in its own store
  (`packages/cli/test/fixtures/kit-code.ts`). Editing any byte of the kit
  revokes the grant; re-grant after reading the diff.
- **Bun's per-test budget is five seconds.** A case that installs a kit and
  drives a dozen verbs exceeds it: build the bundle in `before` and keep one
  `it` per verb, or state `{ timeout }` on a deliberately sequential walk.
  `tools/run-suite.ts` gives a test or a hook twenty seconds, because its
  files run side by side and a hook that installs a kit takes several times
  longer under that load than alone; write against the five seconds a single
  `bun test ./<file>` keeps, and the case holds under both.
- **A test that stamps a date reads the clock.** Set `WIKIWRIGHT_TODAY` in
  any test that spawns `write`, `new` or `trust grant`, or the stamp moves
  with the day.
- **The three corpora are fixtures.** A change to `devwiki`'s pages or
  constitution is judged by `starter-fixtures` (under the `code` starter's
  types merged with devwiki's own vocabularies the error set must equal
  devwiki's own, so a concrete type devwiki adds must exist in the starter,
  while a tag or a label is devwiki's to register), `routing-xor` (its
  `lint` must be clean) and `generated-tracked` (its `generated/` must be
  what this build renders). Regenerate `devwiki/generated`, the brief
  included, with `wikiwright check --write --root devwiki` after any page
  edit or an engine change that moves the brief.
