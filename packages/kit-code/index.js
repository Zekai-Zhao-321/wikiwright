// @wikiwright/kit-code — the domain kit for the wiki of a code repository
// (docs/extending.md §The code kit).
//
// What a code wiki carries, as constitution data: one abstract type per page
// kind, the `anchored` fragment that binds a page to the repository at a commit,
// the relation labels between the kinds, a template per type and the reading
// discipline as skill fragments. Plain JavaScript, no imports, no code that runs
// at judge time: the kit registers declarations only, so the purity scan has
// nothing to refuse and the determinism fixture proves the declarations.
//
// The mechanism that makes a code wiki honest is the kernel's, not this kit's:
// a `pin` field measured by `wikiwright freshness` against the origin its page
// names, with `covers` naming the paths whose diff makes the page stale. The
// kit packages the types, labels, templates and discipline around it.
//
// What stays in the consuming bundle, deliberately: the concrete types (a page
// carries a bundle's type, never one of these), the tag vocabulary, and the
// tightenings — an `origin` pattern for a wiki that lives inside the repository
// it documents, an id pattern for decision records.
//
// No check and no lane: every obligation this kit states is a shape or a section
// law the kernel already holds (a required pin, a `covers` path pattern, a
// `require` row, an append-only body). A check sees the page and the registry
// and never the filesystem, so "the covered path exists" is not a predicate a
// kit may write; it is what `freshness` measures. A lane nothing routes to would
// be a declared key without a consumer.

const ID = "code";
const T = (name) => `${ID}/${name}`;

/** A page's Relations section: labelled links into the rest of the wiki. */
const relations = (extra = {}) => ({
  heading: "Relations",
  max: 1,
  grammar: "relations",
  vocabulary: "relations",
  ...extra,
});

const frontmatter = (extra = "") =>
  `---\ntype: x\ntitle: \ndescription: \ntags: []\n${extra}---\n\n`;

/** A template body: the title line, then the type's required headings, each left empty. */
const body = (headings) =>
  `# {{ title }}\n\n${headings.map((heading) => `## ${heading}\n\n`).join("\n")}`;

const ANCHORED_FRONTMATTER = "pin: \norigin: .\ncovers: []\n";

/**
 * A repository-relative path: no leading `/`, no `..` segment. What `covers`
 * carries and what a git pathspec accepts unchanged.
 */
const REPOSITORY_PATH = "^(?!/)(?!(?:.*/)?\\.\\.(?:/|$)).+$";

export default {
  id: ID,

  // The kit's relation labels are its domain model, and the vocabulary they
  // belong to is the standard library's `relations`. They are contributed into
  // it here with ranges over the kit's own abstract types: a range is matched
  // through the target's extends chain, so a bundle's concrete subtypes satisfy
  // it. A bundle may add labels beside these and may not re-declare one.
  //
  // No `supersedes`: the kernel carries succession as the `supersedes` and
  // `superseded_by` frontmatter fields, a graph edge of its own kind, and
  // `wikiwright retire --superseded-by`. A label of the same name would be a
  // second carrier for one fact.
  entries: {
    relations: {
      part_of: {
        description:
          "The subsystem this page's subject is one part of, or the architecture overview at the top of the tree.",
        range: [T("subsystem"), T("architecture-overview")],
      },
      mapped_in: {
        description: "The source map that locates this subject's code in the repository tree.",
        range: [T("source-map")],
      },
      verified_by: {
        description:
          "The testing guide, or the quickstart, whose procedure runs or verifies this subject.",
        range: [T("testing-guide"), T("quickstart")],
      },
      decided_by: {
        description: "The decision record that shaped this subject.",
        range: [T("decision")],
      },
    },
  },

  // Every kit type but `decision` pastes `anchored`: a page that
  // cites code by file and line is bound to the commit it read, whatever its
  // archetype — an overview names the entry points, a quickstart the files its
  // commands come from, a testing guide the fixtures and helpers — and only an
  // anchored page has a pin for `freshness` to hold those citations to. A
  // decision record is the one kind that describes no code: it is dated by
  // `decided`, append-only, and never re-read against a tree.
  fragments: {
    [T("anchored")]: {
      description:
        "The page is bound to the repository at a commit: `pin` is the commit its statements were read at, `origin` the repository (`.` for the one the vault lives in, else a git URL), `covers` the repository-relative paths it describes — a subsystem covers its directory. `wikiwright freshness` names the page stale when a covered path moved past the pin. Relations carry the page's labelled links and a relation that leaves the page lands in History as a dated line quoting it.",
      fields: {
        pin: { kind: "pin", origin: "origin", covers: "covers", required: true },
        // A field has no default value the engine could stamp, so `.` is the
        // template's seed and the skill's instruction, not a shape.
        origin: { kind: "string", required: true },
        covers: {
          kind: "list",
          item: { kind: "string", pattern: REPOSITORY_PATH },
          min_items: 1,
          required: true,
        },
      },
      sections: {
        depth: 2,
        list: [
          relations({ history: "History" }),
          {
            heading: "History",
            max: 1,
            grammar: "entries",
            date: "required",
            lifecycle: "append-only",
          },
        ],
      },
    },
  },

  types: {
    // The obligations: every page that describes a part of the system
    // carries `part_of` — a concept, a procedure or a reference that lives
    // nowhere in the tree is a page about nothing, by the same argument that
    // makes a subsystem carry `mapped_in`. Three kinds carry no requirement,
    // each for its place in the graph: the architecture overview is the top
    // of the `part_of` tree and has nothing above it; the source map is what
    // `mapped_in` points at, the map and not a part; the decision record is
    // what `decided_by` points at, the record and not a part.
    [T("architecture-overview")]: {
      abstract: true,
      extends: "concept",
      description:
        "The system's shape: layers, boundaries, and how data flows; anchored to the entry points that define them.",
      use_when: "The whole-system view organized around owned systems, not the source tree.",
      avoid_when: "One subsystem's internals (subsystem) or directory listings (source-map).",
      fragments: [T("anchored")],
      template: T("architecture-overview.md"),
      sections: {
        depth: 2,
        list: [
          { heading: "System shape", min: 1, max: 1 },
          { heading: "Layers", min: 1, max: 1 },
        ],
      },
    },

    [T("subsystem")]: {
      abstract: true,
      extends: "concept",
      description:
        "One owned system, read at the pin: responsibilities, entry points, state, invariants, failure modes; anchored to the directory it covers.",
      use_when:
        "A coherent component with its own boundaries and behaviour, described from its code at one commit.",
      avoid_when:
        "Whole-system views (architecture-overview), cross-cutting mechanisms (concept), or a directory listing (source-map).",
      fragments: [T("anchored")],
      template: T("subsystem.md"),
      sections: {
        depth: 2,
        list: [
          { heading: "Responsibilities", min: 1, max: 1 },
          { heading: "Entry points", min: 1, max: 1 },
          { heading: "State", min: 1, max: 1 },
          { heading: "Invariants", min: 1, max: 1 },
          { heading: "Failure modes", min: 1, max: 1 },
          // A subsystem is locatable (`mapped_in`) and belongs somewhere
          // (`part_of`): a component nobody can find in the tree, or that sits
          // in no larger system, is a page about nothing.
          relations({
            min: 1,
            require: [
              { labels: ["mapped_in"], min: 1 },
              { labels: ["part_of"], min: 1 },
            ],
          }),
        ],
      },
    },

    [T("source-map")]: {
      abstract: true,
      extends: "reference",
      description:
        "Directory-to-purpose lookup for the repository layout, anchored to the paths it lists.",
      use_when: 'Answering "where does X live" mechanically.',
      avoid_when: "Explaining how anything works (subsystem, concept).",
      fragments: [T("anchored")],
      template: T("source-map.md"),
      sections: { depth: 2, list: [{ heading: "Layout", min: 1, max: 1 }] },
    },

    [T("concept")]: {
      abstract: true,
      extends: "concept",
      description:
        "A cross-cutting mechanism or idea that lives in many places, anchored to the places it names.",
      use_when: "A mechanism (an invariant, a pattern, a data shape) spanning subsystems.",
      avoid_when: "Anything with a single home (subsystem).",
      fragments: [T("anchored")],
      template: T("concept.md"),
      sections: {
        depth: 2,
        list: [
          { heading: "Mechanism", min: 1, max: 1 },
          { heading: "Where it lives", min: 1, max: 1 },
          relations({ min: 1, require: [{ labels: ["part_of"], min: 1 }] }),
        ],
      },
    },

    [T("quickstart")]: {
      abstract: true,
      extends: "procedure",
      description: "Install, run, and verify the project in minutes: the one from-zero on-ramp.",
      use_when: "The single from-zero on-ramp; one page per bundle.",
      avoid_when: "The testing story (testing-guide) or command references (ops-reference).",
      // Two on-ramps are a fork in the road; the kernel counts pages of the type.
      instances: { max: 1 },
      fragments: [T("anchored")],
      template: T("quickstart.md"),
      sections: {
        depth: 2,
        list: [
          { heading: "Setup", min: 1, max: 1 },
          { heading: "Run", min: 1, max: 1 },
          { heading: "Verify", min: 1, max: 1 },
          relations({ min: 1, require: [{ labels: ["part_of"], min: 1 }] }),
        ],
      },
    },

    [T("testing-guide")]: {
      abstract: true,
      extends: "procedure",
      description: "How tests are organized, run, and written here.",
      use_when: "The testing story: runners, fixtures, conventions; the target of verified_by.",
      avoid_when: "Individual command lookups (ops-reference) or the on-ramp (quickstart).",
      fragments: [T("anchored")],
      template: T("testing-guide.md"),
      sections: {
        depth: 2,
        list: [
          { heading: "Running tests", min: 1, max: 1 },
          { heading: "Writing tests", min: 1, max: 1 },
          relations({ min: 1, require: [{ labels: ["part_of"], min: 1 }] }),
        ],
      },
    },

    [T("integration")]: {
      abstract: true,
      extends: "concept",
      description:
        "An external system this project talks to, and the contract with it, anchored to the code that speaks it.",
      use_when: "Third-party services, protocols, or consumed APIs.",
      avoid_when: "Internal components (subsystem).",
      fragments: [T("anchored")],
      template: T("integration.md"),
      sections: {
        depth: 2,
        list: [
          { heading: "Contract", min: 1, max: 1 },
          { heading: "Failure modes", min: 1, max: 1 },
          // The obligation: an integration belongs to the component that owns it.
          relations({ min: 1, require: [{ labels: ["part_of"], min: 1 }] }),
        ],
      },
    },

    [T("ops-reference")]: {
      abstract: true,
      extends: "reference",
      description:
        "Lookup tables — commands, configuration keys, environment, exit codes — anchored to the code that defines them.",
      use_when: "Facts contributors look up, never read linearly.",
      avoid_when: "Anything needing narrative.",
      fragments: [T("anchored")],
      template: T("ops-reference.md"),
      sections: {
        depth: 2,
        list: [
          { heading: "Reference", min: 1, max: 1 },
          relations({ min: 1, require: [{ labels: ["part_of"], min: 1 }] }),
        ],
      },
    },

    [T("decision")]: {
      abstract: true,
      extends: "reference",
      description:
        "A decision record: the context, the decision, and its consequences; dated, and never edited — only appended.",
      use_when:
        "A choice a later reader must be able to revisit: a dependency taken, a boundary drawn, a mechanism rejected.",
      avoid_when: "Content; a setting; the current shape of a component (subsystem).",
      template: T("decision.md"),
      fields: {
        // The bundle shapes the id: `D-nnn` is one wiki's convention.
        decision_id: { kind: "any", required: true },
        decided: { kind: "date", required: true },
      },
      // The record is append-only as a whole: a consequence learned later is a
      // dated line at the end of Consequences, and the decision above it never
      // moves. A reversed decision is a new record that `supersedes` this one.
      body: { lifecycle: "append-only", severity: "error" },
      sections: {
        depth: 2,
        ordered: true,
        list: [
          { heading: "Context", min: 1, max: 1 },
          { heading: "Decision", min: 1, max: 1 },
          { heading: "Consequences", max: 1 },
        ],
      },
    },
  },

  templates: {
    [T("architecture-overview.md")]:
      frontmatter(ANCHORED_FRONTMATTER) + body(["System shape", "Layers"]),
    [T("subsystem.md")]:
      frontmatter(ANCHORED_FRONTMATTER) +
      body([
        "Responsibilities",
        "Entry points",
        "State",
        "Invariants",
        "Failure modes",
        "Relations",
      ]),
    [T("source-map.md")]: frontmatter(ANCHORED_FRONTMATTER) + body(["Layout"]),
    [T("concept.md")]:
      frontmatter(ANCHORED_FRONTMATTER) + body(["Mechanism", "Where it lives", "Relations"]),
    [T("quickstart.md")]:
      frontmatter(ANCHORED_FRONTMATTER) + body(["Setup", "Run", "Verify", "Relations"]),
    [T("testing-guide.md")]:
      frontmatter(ANCHORED_FRONTMATTER) + body(["Running tests", "Writing tests", "Relations"]),
    [T("integration.md")]:
      frontmatter(ANCHORED_FRONTMATTER) + body(["Contract", "Failure modes", "Relations"]),
    [T("ops-reference.md")]: frontmatter(ANCHORED_FRONTMATTER) + body(["Reference", "Relations"]),
    [T("decision.md")]:
      frontmatter("decision_id: \ndecided: \n") + body(["Context", "Decision", "Consequences"]),
  },

  skills: [
    {
      heading: "Reading code",
      body: "Never describe code you did not read at the pin. A statement about a file cites the file and the line as read at the page's `pin` (`packages/core/src/judge/index.ts:120`); a statement with no line is a guess, and a guess does not go on an anchored page.",
    },
    {
      heading: "Anchoring",
      body: "A page that describes code carries `pin` (the commit it was read at), `origin` (`.` when the vault lives in the repository it documents, else the git URL) and `covers` (the repository-relative paths it describes; a subsystem page covers its directory). When `wikiwright freshness` names a page stale, re-read every covered path at the new head, correct the page, and re-pin; never advance a pin without the read.",
    },
    {
      heading: "Relations",
      body: "`part_of` places a component in its subsystem or under the architecture overview; `mapped_in` names the source map that locates it; `verified_by` names the testing guide or quickstart that runs it; `decided_by` names the decision that shaped it. A relation that leaves an anchored page lands in History as a dated line quoting `label [[Target]]`.",
    },
    {
      heading: "Decisions",
      body: "A decision record is never edited, only appended: the page is append-only, and a consequence learned later is a dated line at the end of Consequences. A reversed decision is a new record whose frontmatter `supersedes` the old one; `wikiwright retire` sets the successor. What a decision shaped is asked of the graph, not of the record: `wikiwright graph edges --label decided_by --inbound decision` lists the pages that name it.",
    },
  ],
};
