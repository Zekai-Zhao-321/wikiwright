# kit-code

The type library for the wiki of a code repository (v2 contracts §1), id
`code`, data only: type, fragment and vocabulary documents, their rule tests
and examples. It replaces `@wikiwright/kit-code` (`packages/kit-code`), the
v1 kit this repository's `devwiki` declared as a module; a bundle imports it
with `"libraries": [{"path": "libraries/kit-code"}]`, the path resolved
against the top level of the repository that holds the bundle (§2), and
names its types `code/<name>`.

What it declares:

- `fragments/anchored.yaml`: a page bound to the repository at a commit. Its
  `pin` (the engine `$def`: `commit`, `origin`, `covers`, at least one path)
  is what `check` measures against the repository; the rule
  `covers-repository-path` holds every covered path to a repository-relative
  one; Relations read the `relations` vocabulary and land a leaving relation
  in History, an append-only entries section; the rule `relation-range`
  (warning) holds each label to the types it ranges over.
- `types/`: one abstract type per page kind — `architecture-overview`,
  `subsystem`, `source-map`, `concept`, `quickstart` (at most one page),
  `testing-guide`, `integration`, `ops-reference`, each anchored, and
  `decision`, the one kind that describes no code: dated, its sections
  ordered, and append-only as a whole (the rule `body-append-only`). A
  bundle writes its pages under its own types, which extend these.
- `vocabularies/relations.yaml`: `part-of`, `mapped-in`, `verified-by`,
  `decided-by`. A bundle adds labels with a vocabulary document that
  `contributes_to: code/relations`.

What it cannot carry: a rule test of `relation-range`. Its negative page must
point a relation at a page of the wrong type, and a test page's links resolve
against the vault that imports the library (§8), so the test set lives with
the consuming bundle (`devwiki/rule-tests/relation-range/`). For the same
reason only the three kinds a page may write without a relation —
architecture-overview, source-map and decision — ship an example.

**Every importer carries `rule-tests/relation-range/`.** The gate holds a
rule its law diff adds to a test set as an error, so the commit that adds
this library to a bundle with a HEAD is refused (`rule-untested`, error, exit
5) unless the bundle carries its own test set of `relation-range` — a
negative, a repaired twin and a positive page, with `expect.json`, whose
relations name the bundle's own pages; devwiki's is the model. Only a
bundle's first commit, which has no HEAD to diff against, imports it with a
warning, as `check` always reports it. `docs/roadmap.md` names the change
that would let the library ship the set itself.

## The discipline

What the v1 kit shipped as skill fragments of the brief, kept here as prose:
the engine does not read it.

- **Reading code.** Never describe code you did not read at the pin. A
  statement about a file cites the file and the line as read at the page's
  pin (`src/server.ts:12`); a statement with no line is a guess, and a guess
  does not go on an anchored page.
- **Anchoring.** A page that describes code carries `pin`: the commit it was
  read at, the origin (`.` when the vault lives in the repository it
  documents), and the repository-relative paths it covers (a subsystem page
  covers its directory). When `check` names a page stale, re-read every
  covered path at the new head, correct the page, and re-pin; never advance a
  pin without the read.
- **Relations.** `part-of` places a component in its subsystem or under the
  architecture overview; `mapped-in` names the source map that locates it;
  `verified-by` names the testing guide or quickstart that runs it;
  `decided-by` names the decision that shaped it. A relation that leaves an
  anchored page lands in History as a dated line.
- **Decisions.** A decision record is never edited, only appended: a
  consequence learned later is a dated line at the end of Consequences. A
  reversed decision is a new record whose frontmatter `supersedes` the old
  one.
