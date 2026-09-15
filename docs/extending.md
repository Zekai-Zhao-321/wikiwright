# Extending wikiwright

The engine has four layers, and the last three register through one API:

```text
kernel              generic typed-wiki runtime; knows what a section is, not what a claim is
  standard library  claims, relations, entries: three modules inside @wikiwright/core
    domain kit      an npm package a bundle installs; registers through the same API
      bundle        one corpus: pages, a constitution, local entries, local subtypes
```

A kit and the standard library are the same kind of thing. The kernel imports
nothing from `packages/core/src/stdlib/` (a test scans every import), the three
first-party modules are loaded through the public `defineModule` surface and
compared with the registry the engine builds at startup, and a module that
needed a private hook would fail that test. This page is the kit author's
guide. The worked example throughout is the conformance fixture,
`fixtures/conformance/module-fixture/index.js`, which is test infrastructure:
the smallest module that touches every extension surface, with deliberately
trivial semantics. Copy its shape; copy none of its semantics.

## What a module registers

A module's default export is one manifest. Every declarative part is validated
before any of its code is called.

| Registers | What the kernel does with it |
|---|---|
| `grammars` | a section entry may declare the grammar by name; the kernel slices the section into items and calls the grammar's `parse` and arms |
| `vocabularies` | a bundle may declare the vocabulary; entries are validated by the module's own entry schema; a module may ship entries of its own |
| `entries` | entries this module contributes INTO a vocabulary another module registered (vocabulary name → entry name → the entry, in the shape a bundle's own take): merged with the owner's and the bundle's into one set and validated by the owner's schema; a name two contributors ship, or a bundle re-declares, is refused naming both. A kit's relation labels reach the standard library's `relations` this way |
| `checks` | a bundle may attach the check to a type, fragment, field or section, with a config the check's schema validates |
| `lanes` | queue lanes the module's findings route to, namespaced |
| `fragments`, `types`, `templates` | plain constitution data, merged into the bundle's document before it is parsed; a bundle may extend a module's type and may not re-declare it |
| `skills` | paragraphs rendered into the generated brief under the module's heading |

What no module may claim: the `tags` vocabulary, the `prose` grammar, the
item kind `unparsed` and the four kernel edge kinds (`wikilink`, `tagged`,
`cites`, `supersedes`), the kernel's queue lanes, and every id on the kernel's
own pass table. Each is refused at load by name.

Not registrable: fixers and generators, because they write and the splice law
is a kernel guarantee; the exit taxonomy, the finding record and the routing
law, because they are the agent's whole contract.

Every manifest key but `id` is optional: a kit that registers only
declarations is a module. A manifest the loader cannot read is refused naming
what it could not read (`module-malformed`), never as "not a manifest".

## The manifest

From `fixtures/conformance/module-fixture/index.js`, abridged; the file is plain
JavaScript with no imports, which is what an installed package looks like.

```js
export default {
  id: "@wikiwright-fixture/probe",
  lanes: ["@wikiwright-fixture/probe/review"],

  vocabularies: {
    "@wikiwright-fixture/probe/sizes": {
      entry: SizeEntry,                                   // { safeParse } over { limit: number }
      entries: { tiny: { description: "The module's own smallest size.", limit: 1 } },
    },
  },

  checks: {
    "@wikiwright-fixture/probe/has-id": {
      config: HasIdConfig,                                // { safeParse } over { prefix: string }
      surfaces: ["type", "field"],
      row: "declared",
      lane: "@wikiwright-fixture/probe/review",
      run: (ctx) => { /* ctx.config, ctx.page, ctx.field; ctx.emit(...) */ },
    },
  },

  fragments: { "@wikiwright-fixture/probe/identified": { fields: { probe_id: { kind: "string", required: true } } } },
  types: {
    "@wikiwright-fixture/probe/subject": {
      extends: "concept",
      description: "A page this module measures.",
      fragments: ["@wikiwright-fixture/probe/identified"],
      template: "@wikiwright-fixture/probe/subject.md",
      sections: { list: [{ heading: "Measures", grammar: "@wikiwright-fixture/probe/measures",
                           vocabulary: "@wikiwright-fixture/probe/sizes", min: 0 }] },
    },
  },
  templates: { "@wikiwright-fixture/probe/subject.md": "---\ntype: x\n---\n\n## Measures\n\n- size: small\n" },
  skills: [{ heading: "Measures", body: "A `Measures` item is `<key>: <value>`." }],

  grammars: {
    "@wikiwright-fixture/probe/measures": {
      kinds: ["probe:measure"],
      form: "- key: value",
      parse: (text) => { const m = ITEM.exec(text); return m ? { kind: "probe:measure", key: m[1], value: m[2].trim() } : undefined; },
      params: { allow: { introduction: "any-depth", value: AllowParam, law: "subset-only" } },
      canonicalize: (item) => { /* the engine's rendering of this item, or undefined */ },
      observes: (vocabulary, item) => vocabulary === SIZES && item.kind === "probe:measure" ? [item.value] : [],
      identityOf: (item) => item.kind === "probe:measure" ? `probe:${item.key}` : undefined,
      isCorrection: () => false,
      arms: [ /* below */ ],
    },
  },
};
```

Every module-supplied identifier is `<module-id>/<name>`. Two modules declaring
one identifier is a load error raised from the manifests alone, before any
module code runs.

## A grammar

| Member | Type | Meaning |
|---|---|---|
| `kinds` | string list | the item kinds this grammar owns; `unparsed` and the kernel edge kinds are refused |
| `vocabulary` | a registered vocabulary name | the vocabulary this grammar's items are checked against; a section declaring the grammar and binding another is `sections-vocabulary-kind` at load. Absent: the section's own `vocabulary` binds |
| `form` | string | the item's written form in one line, printed by `type show --brief` |
| `parse(text, ctx)` | returns the item's own fields with its `kind`, or `undefined` | one item at a time. The module never sees the line number: the kernel attaches `line`, `raw` and the rationale lines around what it returns, so a module cannot aim a splice at the wrong bytes. `ctx.params` carries the section's parameters and `ctx.sourceRoots` the bundle's `source_roots`; nothing else |
| `params` | record of parameter name to `{ introduction, value, law, effect?, entries?, excludes? }` | the section-entry keys this grammar owns. `value` is a schema (`safeParse`). `introduction` is `any-depth` or `with-grammar` (a child may not first-declare it on an inherited grammar). `law` is how it combines under `extends`: `identity`, `subset-only`, `{ tightenOneWay: [from, to] }` or `{ keyedBounds: { key, lower, upper } }`. `effect` declares what the parameter does to the section's lines: `forbids-mutation` or `requires-rewrite`, optionally only at one value. `entries: { vocabulary?, key? }` says the parameter's values NAME ENTRIES of a vocabulary — the section's bound one, or the fixed one named — as bare names or, with `key`, as rows carrying the name under that property; the kernel resolves every name through the vocabulary's alias and retirement laws at load (`sections-entry-unknown`, `-alias`, `-retired`) and reads nothing else (the relations module's `require` rows, the claims module's `only` and `sources`). `excludes` names the parameters of the same grammar that may not be declared beside this one (`sections-params-exclusive`: a claims section that is its own `history`) |
| `arms` | list of arms | the predicates, below |
| `delegates` | `[{ to: "<kind>", on: { param, equals? } }]` | when `parse` declines and the condition holds, the kernel calls the grammar that owns that kind; `claims` hands a History section's dated entries to `entries` this way, without importing it |
| `admits` | `{ param, on? }` | the section parameter carrying the item kinds a section's authors may write, and when it is read |
| `canonicalize(item)` | the canonical line, or `undefined` | the engine's own dialect for this item; the kernel's `canonical-form` census row compares the raw line with it |
| `observes(vocabulary, item)` | string list | the values of a registered vocabulary this item authored; what a census counts |
| `identityOf(item)` | string or `undefined` | the key a transition matches base items to draft items on; the kernel reads nothing inside it. Absent: no item has an identity |
| `isCorrection(before, after)` | boolean | whether a matched pair that differs is a correction of wording rather than a change of substance. Absent: nothing is |
| `edges(item)` | `[{ to, label }]` | the labelled edges this item contributes to the graph; the kernel resolves `to`, drops what does not resolve, keys the edge by the item's kind |

The parameter laws are data from a closed set. A module selecting one is
choosing a law the kernel implements; a module supplying a comparison function
would be authoring a predicate, and the engine refuses predicates in
configuration. The relations module's `require` is `keyedBounds` over
`labels`/`min`/`max`; the entries module's `lifecycle` is
`tightenOneWay: ["free", "append-only"]` with effect `forbids-mutation` at
`append-only`.

## An arm

```js
{
  id: "@wikiwright-fixture/probe/not-allowed",
  on: { param: "allow" },                       // only where the section declares `allow`
  row: "declared",                              // the section's severity knob moves it
  lane: "@wikiwright-fixture/probe/review",
  run: (item, ctx) => {
    const allow = ctx.params["allow"];
    if (item.kind !== "probe:measure" || !Array.isArray(allow) || allow.includes(item.value)) return;
    ctx.emit("@wikiwright-fixture/probe/not-allowed", item.line,
      `section "${ctx.section.heading}" admits only ${allow.join(", ")}`,
      { key: item.key, value: item.value }, `allow|${item.key}|${item.value}`,
      "write one of the values the section admits, or widen `allow` through review");
  },
}
```

| Member | Meaning |
|---|---|
| `id` | the finding's `ruleId`; reserved kernel ids are refused |
| `row` | `declared` (the section's `severity` knob, `warning` when none is authored), `info` (a census row the knob never moves) or `error` (a law the section cannot quiet) |
| `lane` | the queue lane for a non-info finding; required unless `row` is `info`, and it must be a registered lane |
| `on` | `{ param, equals? }`: the arm applies only where the section declares the parameter, optionally at one value. It also drives the coverage count. A parameter the grammar does not declare is refused |
| `fixer` | the name of a kernel fixer registered for this id; a module registers no fixer of its own. `claims` names `history-close` for `history-marker` |
| `severityDefault` | `"error"`: the undeclared default gates, which is what the ratchet compares an ancestor against |
| `needsBase` | the arm compares two revisions; without a base it is `not_applicable`, reason `no-base` |
| `run(item, ctx)` | the per-item predicate |
| `runSection(items, ctx)` | the per-section predicate, for an aggregate such as `relation-require` |
| `runTransition(ctx)` | the two-revision predicate, for a `needsBase` arm; declares this or the other two, never both |

An arm communicates only through `ctx.emit(id, line, message, details,
evidence, remediation?)`, under its own id. It never chooses a severity: the
kernel resolves severity from the declared row and the section's knob. The
context carries the section's parameters, heading and line, the page's type
chain and tags, `resolves(name)` and `chainOf(name)` over the vault's name
index, `concreteTypesUnder(names)` (the concrete registered types whose chain
reaches one of the names: what a page can carry where an abstract type is
named), `vocabulary(name)` (the entries as the module declared them, and every
authored spelling's resolution), and `vocabularyLaws(...)`, by which the kernel
judges the alias and retirement laws for the module. It carries no finding
array, no severity table, no other page's content and no writer.

A transition context adds `base` and `current` (the section's items in both
revisions), `sectionItems(heading)` for another declared section, and
`count(disposition, n)` into the page's disposition table. The relations
module's `relation-removed` arm is the standard library exercising exactly this
seam: a base relation absent from the draft, by `identityOf`, that no new
History line quotes is emitted by label and target.

## A vocabulary

```js
vocabularies: {
  "@wikiwright-fixture/probe/sizes": {
    entry: SizeEntry,          // a schema over the module's own properties; the kernel owns description, aliases, status, replaced_by
    mode: "registered",        // optional; a bundle may not relax a registered mode to census
    entries: { tiny: { description: "…", limit: 1 } },   // optional; shipped beside the bundle's own
    typeRefs: ["range"],       // optional; dotted paths into an entry whose value names a registered type, or a list of them
    tagRefs: ["owned_by.not_on.tags"],   // optional; the same, against the `tags` vocabulary
  },
}
```

The kernel validates the four shared properties, hands the rest to the
module's `entry` schema, refuses a property neither declares (naming the
vocabulary that does), and hands the module's own properties back to its arms
verbatim through `ctx.vocabulary(name).entries`. The alias law and the
retirement law are the kernel's and apply to every vocabulary. Each name a
`typeRefs` or `tagRefs` path holds is held to the registry at load
(`vocabulary-type-ref-unknown`, `vocabulary-tag-ref-unknown`); `vocabulary
show` prints what each path resolves to under `references`, and its
`--target` is the inbound view of every vocabulary that declares a `typeRefs`
path. What the reference means — a range, a negative selector — is the
module's, read by its own arms.

## A check

```js
checks: {
  "@wikiwright-fixture/probe/has-id": {
    config: HasIdConfig,                 // validated at load; a check with no knobs takes an empty strict object
    surfaces: ["type", "field"],         // where a bundle may attach it; elsewhere is a load error
    row: "declared",
    lane: "@wikiwright-fixture/probe/review",
    run: (ctx) => {
      const value = ctx.field === undefined ? ctx.page.frontmatter["probe_id"] : ctx.field.value;
      if (typeof value === "string" && value.startsWith(ctx.config.prefix)) return;
      ctx.emit(ctx.field?.line, `the probe id does not begin with "${ctx.config.prefix}"`, { prefix: ctx.config.prefix }, `has-id|${String(value)}`, `write a probe id beginning with "${ctx.config.prefix}"`);
    },
  },
}
```

A check's context carries the page (path, frontmatter, body, chain, tags), the
attachment's validated `config`, and, by surface, `field` (name, value, line)
or `section` (heading, line, parameters, parsed items). A bundle attaches it in
`checks` on a type, a fragment, a field's shape or a section entry, and may
tighten an inherited attachment's severity and never relax it. Bundle B in
the conformance fixture attaches `has-id` with `{ "prefix": "B-" }` at `error`.

## The schema contract

Every schema a module supplies (a parameter's `value`, a vocabulary's `entry`,
a check's `config`) is called through `safeParse` and nothing else; `.shape` is
read only to enumerate a vocabulary's entry keys. A TypeScript kit uses zod and
gets the types; a plain JavaScript kit supplies an object with a `safeParse`
returning `{ success, data }` or `{ success: false, error: { issues } }`, as the
fixture does. Two zod copies in one process are two `instanceof` families, which
is why the contract is structural. A schema that throws refuses the value and
names the module.

## Declaring a module

The entry point loads a bundle's declared modules once, before a verb that
declares it reads the vault's law, so a bundle judged without a law it
declares is refused rather than judged under a quieter one. A verb that
answers about the engine — `schema`, `version` — or about the one module it
loads itself — `trust` — declares it reads no vault law and loads none.

A bundle names the package in `config/engine.json` and installs it in its own
`node_modules`, by a workspace link, a `file:` dependency or a local tarball;
nothing is published anywhere. From `fixtures/conformance/bundle-a`:

```json
{ "content_roots": ["wiki"], "modules": [{ "package": "@wikiwright-fixture/probe", "version": "^1.0.0" }] }
```

```json
{ "dependencies": { "@wikiwright-fixture/probe": "file:../module-fixture" } }
```

The package's own contract is a `wikiwright` block in its `package.json`:

```json
{ "wikiwright": { "module": "./index.js", "fixture": "./fixture.json", "engine": ">=0.1.0 <1.0.0" } }
```

`module` is the entry whose default export is the manifest (`.js`, `.mjs` or
`.cjs`), `fixture` the determinism fixture (required), `engine` the engine
range the module is built for. Then the bundle's constitution declares the
module's vocabulary with its own entries, extends its type and tightens what it
left open:

```json
{
  "vocabularies": {
    "tags": { "mode": "registered", "entries": { "probe": { "description": "Pages this bundle measures." } } },
    "@wikiwright-fixture/probe/sizes": { "mode": "registered",
      "entries": { "small": { "description": "Bundle B's small.", "limit": 5 }, "large": { "description": "…", "limit": 1000 } } }
  },
  "types": {
    "gadget": {
      "extends": "@wikiwright-fixture/probe/subject",
      "description": "Bundle B's own subtype, which tightens the shared section.",
      "checks": [{ "use": "@wikiwright-fixture/probe/has-id", "config": { "prefix": "B-" }, "severity": "error" }],
      "sections": { "list": [{ "heading": "Measures", "allow": ["small"], "severity": "error" }] }
    }
  }
}
```

## The loader's refusals

The shell loads every declared module once, before the verb runs, and a
refused module contributes nothing: there is no partial load, because a bundle
judged under half its declared law is judged under a law nobody wrote. Each
step refuses by name, and `wikiwright modules list` reports a refused module
with its refusal rather than omitting it.

| Code | Refused when |
|---|---|
| `module-unresolved` | the package is not under the bundle's own `node_modules` (an ancestor directory or the engine's tree does not count) |
| `module-malformed` | no `package.json`, no `wikiwright` block, no semver `version`, an entry outside the package or outside the digested file set, a non-portable entry suffix, or the same package declared twice |
| `module-version-mismatch` | the installed `version` does not satisfy the bundle's declared range |
| `module-incompatible` | the running engine is outside the module's declared `engine` range |
| `module-impure` | the purity scan found the clock, randomness, locale comparison, the environment, the network, dynamic evaluation or a filesystem import, with file and line |
| `module-untrusted` | this machine holds no grant for the package in this vault |
| `module-modified` | the package's bytes differ from the granted digest |
| `module-load-failed` | the import failed, the default export is not a manifest, or the manifest states a version the package does not |
| `module-fixture-missing` | the fixture is absent or outside the digested set |
| `module-fixture-failed` | the fixture is unreadable, its constitution does not load, the module does not compose with the standard library, or its findings differ from its own expectation |
| `module-nondeterministic` | two runs over the same bytes produced different findings |
| `module-conflict` | two loaded manifests claim one identifier |

## Trust

A module runs inside the judge with the user's permissions, so it is granted
per machine, never per repository:

```text
wikiwright trust grant module:@wikiwright-fixture/probe
wikiwright trust grant module:@wikiwright-fixture/probe --scope worktrees
wikiwright trust list
wikiwright trust revoke module:@wikiwright-fixture/probe
wikiwright trust revoke module:@wikiwright-fixture/probe --scope worktrees
```

A grant approves the sha256 over every file of the package except its own
`node_modules`, `package.json` and the fixture included, and it lives in
`~/.config/wikiwright/trust.json`. `git pull` can never write a grant. A
grant or a revoke reads, changes and writes that file as one operation under
a lock beside it, so two of them at once cannot lose one another's record. A
lock is broken only when the process it names is gone from this machine: age
is no evidence, since a grant that digests a large module holds one for a
while, and a holder on another machine — a store on a shared home directory —
cannot be asked about at all. When the lock does not clear, the verb refuses
`store-busy` rather than overwriting what it cannot see. The
purity scan runs before the grant, so an impure module cannot be granted and
then run; and `trust grant` runs the module's determinism fixture before
writing the grant, so a module that does not reproduce its own findings is
never granted. A load under the granted digest is the same proof and does not
run the fixture again.

A maintainer chooses one of two scopes:

- `--scope vault`, the default, approves the digest for this vault, keyed by
  its real path. It holds one digest per module: a re-grant replaces it, and
  editing any byte or moving the vault revokes it. This is the only scope
  0.1.0 had, and its grants approve exactly what they approved.
- `--scope worktrees` approves the digest for this vault's path in every
  linked worktree of its repository, existing and future, keyed by the real
  path of the git common directory and the vault's path inside its worktree,
  spelled as the filesystem spells it: no Unicode normalization, no case
  folding, and only the platform's own separator converted. It may hold
  several digests, so approving a module's update on one branch leaves another
  branch's approved version standing. Another vault in the same repository and
  a separate clone are other scopes.

A matching digest in either scope approves the installed module. The vault
grant is read first and needs no git; git is asked for the worktree scope,
with the variables a git hook exports removed, only when the vault grant does
not approve and a worktree grant for the module exists. A grant that applies
but pins other bytes refuses as `module-modified`, none as `module-untrusted`,
and a worktree scope that was needed and could not be read as
`module-scope-unresolved`. None of these refusals names a command to run: the
approval is a maintainer's decision, and an agent must not grant trust
automatically to unblock its work. `trust list` and `modules list` name the
scope that approves the installation, and `trust revoke --scope worktrees`
removes every digest the scope approved and says whether a vault grant still
approves. A `trust` command that names `--scope worktrees` refuses as
`scope-unresolved` when git cannot read the scope. `trust list --all` prints
every record the store holds, each with an identity, the path it is keyed by
and whether that path is still on this machine; `trust revoke --record
<identity>` removes one of them without a vault or a repository, which is the
only way to remove a record whose directory is gone.

What the keys cannot tell apart is stated here rather than hidden. A
replacement repository at the same common-directory path can inherit approval
for the same module digest, as a replacement vault at the same path can
inherit a vault grant. Moving the repository's common directory ends its
worktree scope. A vault inside a submodule has a separate git directory in
each worktree, so it does not share one. A newline in the vault's path inside
its worktree, or in a linked worktree's common-directory path, leaves the
vault without a worktree scope: git prints each answer on its own line, so such
a path would read as a shorter one, and the load refuses as
`module-scope-unresolved`; a vault grant still approves it. Dependency installation is a separate
setup step: the package manager may run a package's lifecycle scripts, and the
trust gate does not govern them.

## The determinism fixture

A module ships, beside its code, a constitution that declares its own surface,
the pages that exercise it, and the findings they must produce:

```json
{
  "constitution": { "schema": "wikiwright/constitution", "schema_version": 3,
    "vocabularies": { "tags": { "mode": "registered", "entries": {} },
      "@wikiwright-fixture/probe/sizes": { "mode": "registered", "entries": { "small": { "description": "…", "limit": 1 } } } },
    "types": { "probe-page": { "extends": "@wikiwright-fixture/probe/subject", "description": "…" } } },
  "pages": { "wiki/Fixture.md": "---\ntype: probe-page\ntitle: Fixture\ndescription: …\ntags: []\nprobe_id: F-1\n---\n\n# Fixture\n\n…\n\n## Measures\n\n- size: small\n- size: enormous\n" },
  "expected": [
    "@wikiwright-fixture/probe/measured|wiki/Fixture.md|15|info",
    "@wikiwright-fixture/probe/measured|wiki/Fixture.md|16|info",
    "@wikiwright-fixture/probe/unknown-size|wiki/Fixture.md|16|warning"
  ]
}
```

It runs under the standard library plus this module alone, never the whole
bundle's module set, and it runs twice in one process. `expected` is
`ruleId|path|line|severity` per finding in the engine's own order.

## When a module throws

A module's exception never makes the engine quieter. A `parse` that throws
leaves the item `unparsed` and emits `module-failure`; an arm or check that
throws emits one attributed `module-failure` on that page, queued to
`module-review`, and the arms beside it still run; `canonicalize` and
`observes` throwing lose one count; `identityOf` and `isCorrection` throwing
fall to the closed defaults (no identity, no correction); a schema that throws
refuses the value. A count can be lost; a gate cannot.

## Adopting a new version

`wikiwright modules plan --package <name> --candidate <bundle root>` judges
this bundle twice, under the installed module and under the candidate root's
build of the same package, and prints the whole finding delta by rule, path,
line and severity. Nothing reaches the network; the candidate is a directory
that already has the version installed.

## The code kit

`@wikiwright/kit-code`, under `packages/kit-code`, is the shipped example of
a kit: the domain kit for the wiki of a code repository, consumed by the
`code` starter and by this repository's own `devwiki`. It is a workspace
package with a plain-JavaScript manifest and no dependencies, and it
registers declarations only — no grammar, no check, no lane — so the purity
scan has nothing to refuse and its determinism fixture proves the
declarations. The mechanism that makes a code wiki honest is the kernel's: a
`pin` field measured by `freshness` against the origin its page names, with
`covers` naming the paths whose diff makes the page stale. The kit packages
the types, labels, templates and discipline around it.

| Registers | What |
|---|---|
| types, abstract, under `code/` | `architecture-overview`, `subsystem`, `source-map`, `concept`, `quickstart` (`instances.max: 1`), `testing-guide`, `integration`, `ops-reference`, `decision` (`decision_id`, `decided`; `body.lifecycle: append-only`, so the record is only ever appended to) |
| fragment `code/anchored` | `pin` (kind `pin`, required) with `origin` (`.` for the repository the vault lives in, else a git URL) and `covers` (a required list of repository-relative paths: no leading `/`, no `..` segment); a `Relations` section with `history: "History"`; an append-only, dated `History`. Pasted by every type but `decision`: a page about code states what the code is, and a statement about code is only true at a commit, so it is measured by `freshness` or it is prose; the decision record alone records a moment, not a state, and is append-only instead. A bundle subtype that pastes it again is `field-schema-redeclared` |
| entries into `relations` | `part_of` → subsystem or architecture-overview; `mapped_in` → source-map; `verified_by` → testing-guide or quickstart; `decided_by` → decision. No `supersedes`: the kernel's `supersedes` field and `retire --superseded-by` carry succession |
| `require` rows | a subsystem carries a `mapped_in` and a `part_of`; a concept, quickstart, testing-guide, integration or ops-reference carries a `part_of` — a part that lives nowhere in the tree is a page about nothing; the overview (the top), the source map (the map) and the decision (the record) carry none; all at the section's default severity, warning |
| templates | one per type, rendering `# {{ title }}` and the type's headings in the order a reader meets them |
| skills | four fragments the brief renders: reading code (never describe code you did not read at the pin; cite file and line — `freshness` holds every cited path and line to the pin, `citation-unresolved`), anchoring (re-read every covered path and re-pin when `freshness` names the page stale; a subsystem covers its directory), the relation labels, and decisions (never edited, only appended) |

The kit is on no registry. A bundle consumes it the way
`fixtures/conformance/bundle-a` consumes the fixture: `config/engine.json`
declares `{ "package": "@wikiwright/kit-code", "version": "^0.1.0" }` (the
range the installed package must satisfy, checked by the loader — not a
registry lookup), `package.json` depends on it — the workspace link inside
this monorepo (`devwiki`), or `file:<path>` to `packages/kit-code` in a
checkout of this repository anywhere else — the package manager's install
lands it in the bundle's own `node_modules`, and this machine grants it
once, after reading it:

```text
bun install
wikiwright trust grant module:@wikiwright/kit-code
```

`wikiwright init --constitution code` lands the starter — concrete subtypes
of every kit type, `relations` declared registered and empty (the labels are
the kit's) and `decision_id` shaped `D-nnn` — and, because the modules
cannot load before those two steps, renders no artifact and no brief: the
envelope's `modules` block names the install, the grant and `check --write`
(which lands the brief with the artifacts), and `check` before them refuses `module-unresolved` and then
`module-untrusted` with the same steps in its hint. A bundle tightens what
the kit left open: `devwiki` adds `"origin": { "kind": "string", "pattern":
"^\\.$" }` to its anchored types because it lives in the repository it
documents. A bare `concept` cannot be a concrete type's name — it shadows the
archetype — so the starter's is `code-concept`. The suite holds `devwiki` to
the starter as a fixture: devwiki is judged under the starter's types
merged with devwiki's own vocabularies, so every concrete type name a
devwiki page carries must exist in the starter, while the tags and labels
devwiki registers are its own and need not be the starter's.

Origin `"."` is the repository enclosing the vault, found from the vault
root, and `covers` paths are repository-root-relative there, so `devwiki/`
inside this repository pins to its own commits. A page pinned inside the
repository it documents is never `current` once its pin is committed — the
commit that carries the pin is one past it — so its clean state is
`unchanged`: the head moved and the covering diff is empty. `stale` names the
page to re-read. `bun tools/uncovered.ts`
lists, for a root (default every package's `src`), the top-level directories
no page's `covers` reaches: the code the wiki has not read.

## The standard library, as a kit

`packages/core/src/stdlib/claims.ts`, `relations.ts` and `entries.ts` are three
manifests built with `defineModule`, `defineGrammar`, `defineVocabulary` and
`defineArm`, composed by `standardLibrary()` and handed to the kernel as a
registry. They differ from a kit in two ways only: their ids are bare
(`claims`, not `@acme/claims`), and they live inside `@wikiwright/core` rather
than in a package a bundle installs. Everything a kit may do, one of them does:
`claims` declares nine parameters, two vocabularies, a delegation, an
allow-list, a canonical form, a transition and a fixer name; `relations`
declares a keyed-bounds parameter, a ranged vocabulary, `edges` and a
transition; `entries` declares two one-way parameters with a lifecycle effect.
