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
answers about the engine — `schema`, `version` — or about the skill
directories — `bundles`, which reads a copy's marker and no law — declares it
reads no vault law and loads none. How a load proves a module is [§Loading a module](#loading-a-module).

A bundle names the package in `config/engine.json` and either installs it in
its own `node_modules`, by a workspace link, a `file:` dependency or a local
tarball, or carries it in its own tree and names the directory; nothing is
published anywhere. The first spelling, from `fixtures/conformance/bundle-a`:

```json
{ "content_roots": ["wiki"], "modules": [{ "package": "@wikiwright-fixture/probe", "version": "^1.0.0" }] }
```

```json
{ "dependencies": { "@wikiwright-fixture/probe": "file:../module-fixture" } }
```

The second spelling adds `path`, a directory relative to the bundle root,
which the package lies in whole. The gardening kit the suite declares this way
(`packages/cli/test/fixtures/kit-garden`, copied to `kit/garden` in a bundle
under the temporary directory):

```json
{ "content_roots": ["wiki"], "modules": [{ "package": "kit-garden", "version": "^1.0.0", "path": "kit/garden" }] }
```

A declared `path` is where the module is read from and the only place: when
the directory is not there the load is `module-unresolved`, naming the path,
even if `node_modules` holds a package of that name. The path is held to the
path law, as a content root is: `"../kit"` or an absolute path is refused when
`config/engine.json` loads (`schema-invalid` at `engine.modules.<n>.path`),
and `modules list`, which reads the declarations without loading the rest of
the config, reports it `module-malformed`. The loader also refuses, as
`module-malformed`, a directory whose real path lies outside the bundle's: a
link out of the bundle. One resolver reads both spellings for the loader, the law
digest and `modules list`, whose `resolved.path` prints the declared path or
`node_modules/<package>`.

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
| `module-unresolved` | the package is not under the bundle's own `node_modules` (an ancestor directory or the engine's tree does not count), or no directory is at its declared `path` |
| `module-malformed` | no `package.json`, no `wikiwright` block, no semver `version`, an entry outside the package or outside the digested file set, a non-portable entry suffix, the same package declared twice, or a declared `path` that is not a directory inside the bundle |
| `module-version-mismatch` | the installed `version` does not satisfy the bundle's declared range |
| `module-incompatible` | the running engine is outside the module's declared `engine` range |
| `module-impure` | the [purity scan](#the-purity-scan) found the clock, randomness, locale comparison, the environment, the network, dynamic evaluation, computed access to one of those globals, or an import of any form, with file and line |
| `module-load-failed` | the import failed, the default export is not a manifest, or the manifest states a version the package does not |
| `module-fixture-missing` | the fixture is absent or outside the digested set |
| `module-fixture-failed` | the [determinism fixture](#the-determinism-fixture) is unreadable, its constitution does not load, the module does not compose with the standard library, or its findings differ from its own expectation |
| `module-nondeterministic` | two runs of the fixture over the same bytes produced different findings |
| `module-conflict` | two loaded manifests claim one identifier |

## The purity scan

Before any of a module's code runs, the loader reads every executable file of
the package (`.js`, `.mjs`, `.cjs`, `.ts`, `.mts`, `.cts`, and the entry
whatever its suffix) and refuses the module, `module-impure`, when a file
holds a construct a verdict may not depend on, naming the file, the line and
the reason. A module imports nothing, in any form: a kit carries its own
directory, every file it needs is in its digest, and an import is how code
the scan never read would reach the judge — a package, a file outside the
kit, or Node's own modules.

| The scan refuses | The reason it reports |
|---|---|
| `Date.now(` | reads the clock (Date.now) |
| `new Date()`, with no argument | reads the clock (new Date with no argument) |
| `performance.now(` | reads the clock (performance.now) |
| `Math.random(` | is not deterministic (Math.random) |
| `.localeCompare(` | compares under the machine's locale (localeCompare) |
| `Intl.` | reads the machine's locale (Intl) |
| `process.env` | reads the environment (process.env) |
| `fetch(` | reaches the network (fetch) |
| `eval(` | evaluates code built at runtime (eval) |
| `new Function(` | evaluates code built at runtime (the Function constructor) |
| `globalThis`, in any form, `globalThis[…]` included | reaches a global by name (globalThis) |
| `Date[…]`, `Math[…]`, `performance[…]`, `Intl[…]`, `process[…]` | reaches a banned global by computed access (Date, Math, performance, Intl or process) |
| a statement that opens with `import`: a binding, a namespace, a side effect or a type | imports a module (an import declaration) |
| `export * from`, `export * as … from`, `export { … } from` | re-exports a module (export … from) |
| `import(` | imports a module at runtime (import()) |
| `require(` | requires a module (require) |

An import is also named by what it reaches when its specifier, with or
without `node:`, is one of these; the specifier follows the reason:

| The specifier | The reason it reports |
|---|---|
| `fs`, `path`, or a subpath of either | imports the filesystem |
| `http`, `https`, `net`, `tls`, `dgram`, `dns`, or a subpath of one | imports the network |
| `child_process` | imports a child process |
| `process` | imports the process |
| `os` | imports the operating system |

A line is reported once per rule it matches.

The rules read lines, not JavaScript, and that has a cost the scan accepts
rather than parse the language. The declaration and re-export rules match a
line that opens with `import`, or with `export … from`, or does so after a
`;`, whatever surrounds it: a line inside a template string or a block
comment that opens with `import`, and a string holding `; import`, are
refused as imports though nothing is imported. The `import(` and `require(`
rules match those words anywhere, in a comment or a string too. A module
that says either in its text rewords it; the refusal names the file and the
line, so the false positive is found where it stands.

The scan's result is kept for the process by the digest of the package's
bytes and the scan's version, a number in `packages/core/src/modules/purity.ts`
raised whenever a rule changes, so two bundles that install the same bytes
are scanned once, and no result outlives the process.

What the scan does not do is stated here rather than implied. It narrows; it
is not a sandbox. It reads bytes, so a name bound or built at runtime is
outside it: `const D = Date; D.now()`, a banned method taken by reference
and called later, a constructor reached through a prototype chain, and the
members of `process` other than `env` all pass it. A module that means to
reach the clock can. Neither the scan nor the determinism fixture is the
argument for running a module's code with the engine's permissions:
installing the module is, the decision every package manager asks of its
user.

## Loading a module

Installing a module is the consent to run it. A module that arrived by a
workspace link, a `file:` dependency, a packed tarball or a copy carried in
the bundle's own tree was accepted when it was installed, as every package
manager takes it; this engine asks no second time, and no machine-local
approval stands between a bundle and the law it declares. What the engine
adds is proof over the installed bytes, taken at every load, before the
module judges anything:

1. **The digest.** The loader resolves the declaration (under `node_modules`,
   or at its declared `path`) and takes one sha256 over every file of the
   package, its own `node_modules` excepted, `package.json` and the fixture
   included. The law digest every envelope carries names it
   (`module:<package> <digest>`), and `modules list` reports it, so the bytes
   that judged are named wherever a verdict is.
2. **The purity scan.** Every executable file is read and refused by file
   and line when it holds a construct a verdict may not depend on or an
   import of any form (§[The purity scan](#the-purity-scan)).
3. **The entry and the fixture.** Both must resolve inside the package and
   be in the digested set; the entry is imported, and its default export must
   be a manifest.
4. **The determinism fixture.** The module's own fixture runs under the
   standard library and this module alone, twice, and must reproduce the
   findings it expects (§[The determinism fixture](#the-determinism-fixture)).
   `modules list` reports what it judged as `fixture`: its pages and its
   findings.

A step that fails refuses the module by name (§[The loader's
refusals](#the-loaders-refusals)): `module-impure` for the scan,
`module-fixture-missing`, `module-fixture-failed` or `module-nondeterministic`
for the fixture, each with the hint it carries, and every verb that reads the
law — `check`, `search`, `type show` and the rest — refuses with it.

The two proofs are kept for the process by what they proved: the scan by the
digest and the scan's version, the fixture by the digest, the scan's version
and the declared package name. Two bundles that install the same bytes are
proved once, and other bytes are proved on their own. Neither result is
written anywhere or outlives the process: the fixture composes the standard
library and runs the judge, so its outcome is a function of the engine as
well as of the module's bytes, and a cache kept between runs would have to be
keyed by the engine too. That cache is deferred (`docs/roadmap.md`), so every
process that loads a module runs its fixture once.

Consent at install is the argument for running a module's code with the
engine's permissions; the proofs are not. A module whose bytes change —
an update, an edit, a different copy — is proved again under its new digest,
and a change to the modules a bundle declares or carries is a change to its
`config/engine.json` or its tree, reviewed as any other change to its law.
What that costs is stated rather than hidden: nothing on this machine asks
before a module runs. A `git pull` that changes a kit a bundle carries in its
tree, or the modules it declares, changes the code the next verb over that
bundle runs, and importing a module runs its top-level code, `modules list`
included; the purity scan reads it first, and it narrows what the code can
reach, but it is not a sandbox. Dependency installation is a separate step
the engine does not govern: the package manager may run a package's lifecycle
scripts.

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
bundle's module set, and it runs twice in one process, at every load
(§[Loading a module](#loading-a-module)), before the module judges anything of
the bundle's. `expected` is `ruleId|path|line|severity` per finding in the
engine's own order.

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
checkout of this repository anywhere else — and the package manager's install
lands it in the bundle's own `node_modules`. The first verb that reads the
law loads it and proves it:

```text
bun install
wikiwright check --write
```

`wikiwright init --constitution code` lands the starter — concrete subtypes
of every kit type, `relations` declared registered and empty (the labels are
the kit's) and `decision_id` shaped `D-nnn` — and, because the modules
cannot load before the install, renders no artifact and no brief: the
envelope's `modules` block names the install, says the kit loads on first use
and is proved then, and names `check --write` (which lands the brief with the
artifacts), and `check` before the install refuses `module-unresolved` with
the install in its hint. A bundle tightens what
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
