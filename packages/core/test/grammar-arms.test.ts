// docs/concepts.md §Section grammar (the state arms, report mode: every type-declared row
// ships at warning, the census rows at info) · docs/concepts.md §Findings and routing (every row
// names a queue lane, none names a fixer in this slice)
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type Finding, lintPage } from "../src/lint/index.ts";
import { parseDoc } from "../src/parse/index.ts";
import { constitutionOf } from "./helpers/constitution.ts";

/** The `categories` vocabulary: every entry carries its lifecycle class. */
const CATEGORIES = {
  mode: "registered",
  entries: {
    identity: { class: "supersede" },
    role: { class: "supersede" },
    housing: { class: "supersede" },
    preference: { class: "accumulate" },
    mood: { class: "journal-only" },
  },
};

interface SectionEntry {
  heading: string;
  [key: string]: unknown;
}

function registryWith(list: SectionEntry[], withClasses = true) {
  return constitutionOf({
    // "No vocabulary is declared" means no `categories` vocabulary at all, and
    // no section may then bind one.
    vocabularies: withClasses ? { categories: CATEGORIES } : {},
    types: {
      person: {
        extends: "concept",
        description: "A person page.",
        sections: { depth: 2, ordered: false, additional: true, list },
      },
    },
  });
}

const MEMORY_SECTIONS: SectionEntry[] = [
  {
    heading: "Facts",
    grammar: "claims",
    history: "History",
    provenance: "optional",
    vocabulary: "categories",
  },
  { heading: "Relations", grammar: "relations" },
  { heading: "Timeline", grammar: "entries" },
  { heading: "Notes" },
  { heading: "History", grammar: "claims", role: "history", vocabulary: "categories" },
];

function page(body: readonly string[]): string {
  return ["---", "type: person", "tags: []", "---", "", "Lede.", "", ...body, ""].join("\n");
}

function lint(
  body: readonly string[],
  list: SectionEntry[] = MEMORY_SECTIONS,
  names?: { resolve(name: string): { path: string; viaAlias: boolean } | undefined },
  withClasses = true,
): Finding[] {
  const registry = registryWith(list, withClasses);
  const options = names === undefined ? undefined : { names };
  return lintPage({ path: "wiki/Some Page.md", doc: parseDoc(page(body)), registry }, options);
}

const idsOf = (findings: Finding[], ruleId: string): Finding[] =>
  findings.filter((f) => f.ruleId === ruleId);

describe("grammar-unparsed: a top-level item that does not parse is never silent", () => {
  it("fires at warning on a non-claim bullet inside a claims section", () => {
    const findings = lint(["## Facts", "- a bullet with no category marker"]);
    const hit = idsOf(findings, "grammar-unparsed");
    assert.equal(hit.length, 1);
    assert.equal(hit[0]?.severity, "warning", "report mode: type-declared rows ship at warning");
    assert.equal(hit[0]?.line, 9);
    assert.equal(hit[0]?.contributedBy, "person", "the declaring type carries the row");
    assert.equal(hit[0]?.registryPath, "/types/person/sections/list/0");
    assert.equal(hit[0]?.breadcrumb, "Facts");
  });

  it("does not fire on rationale, on prose, or in a prose section", () => {
    const findings = lint([
      "## Facts",
      "- [role] engineer (stated 2026-08-14)",
      "  - a rationale line that parses under no grammar",
      "Framing prose.",
      "",
      "## Notes",
      "- an ordinary bullet in a prose section",
    ]);
    assert.deepEqual(idsOf(findings, "grammar-unparsed"), []);
  });
});

describe("the claims state arms (docs/concepts.md §Section grammar)", () => {
  it("unknown-category and journal-only-category read the claim-classes vocabulary", () => {
    const findings = lint([
      "## Facts",
      "- [fav-food] hotpot (stated 2026-08-14)",
      "- [mood] said something in anger (stated 2026-08-14)",
    ]);
    assert.equal(idsOf(findings, "unknown-category").length, 1);
    assert.equal(idsOf(findings, "unknown-category")[0]?.severity, "warning");
    assert.equal(idsOf(findings, "journal-only-category").length, 1);
    assert.equal(idsOf(findings, "journal-only-category")[0]?.severity, "warning");
  });

  it("no category vocabulary is declared ⇒ neither arm can fire", () => {
    const noVocab = MEMORY_SECTIONS.map(({ vocabulary: _unbound, ...s }) => s);
    const findings = lint(
      ["## Facts", "- [fav-food] hotpot (stated 2026-08-14)"],
      noVocab,
      undefined,
      false,
    );
    assert.deepEqual(idsOf(findings, "unknown-category"), []);
  });

  it("claim-provenance fires only where the section requires provenance", () => {
    const optional = lint(["## Facts", "- [role] engineer"]);
    assert.deepEqual(idsOf(optional, "claim-provenance"), []);
    const required = MEMORY_SECTIONS.map((s) =>
      s.heading === "Facts" ? { ...s, provenance: "required" } : s,
    );
    const findings = lint(["## Facts", "- [role] engineer"], required);
    assert.equal(idsOf(findings, "claim-provenance").length, 1);
    assert.equal(idsOf(findings, "claim-provenance")[0]?.severity, "warning");
  });

  it("closed-claim-in-facts fires on a closing clause outside a history section", () => {
    const findings = lint([
      "## Facts",
      "- [housing] Riverside (stated 2026-08-20) (valid 2026-08-20→2026-09-08, superseded 2026-09-09)",
    ]);
    assert.equal(idsOf(findings, "closed-claim-in-facts").length, 1);
  });

  it("history-marker fires on a claim-kind History item with no closing clause", () => {
    const findings = lint([
      "## History",
      "- [housing] Riverside (stated 2026-08-20)",
      "- 2026-09-09: an ordinary changelog entry",
    ]);
    const hit = idsOf(findings, "history-marker");
    assert.equal(hit.length, 1, "the entry-kind item is not a claim and never fires this");
    assert.equal(hit[0]?.severity, "warning");
  });
});

describe("the census rows are info and carry the item handle (docs/concepts.md §Section grammar)", () => {
  it("marker-like, provenance-weak and hearsay count the dialect", () => {
    const findings = lint([
      "## Facts",
      "- [doc] study permit (valid to 2034-04-09)",
      "- [role] engineer (inferred, same)",
      "- [role] engineer once more (legacy)",
      "- [identity] born 1999 (stated by Ada Byron)",
    ]);
    assert.equal(idsOf(findings, "marker-like").length, 1);
    assert.equal(idsOf(findings, "provenance-weak").length, 2, "shorthand inferred + legacy");
    assert.equal(idsOf(findings, "hearsay").length, 1);
    for (const id of ["marker-like", "provenance-weak", "hearsay"]) {
      for (const finding of idsOf(findings, id)) {
        assert.equal(finding.severity, "info");
        assert.equal(
          typeof finding.details?.["handle"],
          "string",
          `${id} names the item by handle`,
        );
      }
    }
  });
});

describe("relations and entries arms (docs/concepts.md §Section grammar)", () => {
  it("relation-target-unresolved fires at warning inside a relations section", () => {
    const names = {
      resolve: (name: string) =>
        name === "Known Page" ? { path: "wiki/Known Page.md", viaAlias: false } : undefined,
    };
    const findings = lint(
      ["## Relations", "- peer_of [[Known Page]]", "- peer_of [[Missing Page]]"],
      MEMORY_SECTIONS,
      names,
    );
    const hit = idsOf(findings, "relation-target-unresolved");
    assert.equal(hit.length, 1);
    assert.equal(hit[0]?.severity, "warning", "report mode, not a's projected error");
  });

  it("entry-date-missing fires only where the section requires a date", () => {
    const optional = lint(["## Timeline", "- an undated line"]);
    assert.deepEqual(idsOf(optional, "entry-date-missing"), []);
    const required = MEMORY_SECTIONS.map((s) =>
      s.heading === "Timeline" ? { ...s, date: "required" } : s,
    );
    const findings = lint(["## Timeline", "- an undated line"], required);
    assert.equal(idsOf(findings, "entry-date-missing").length, 1);
    assert.equal(idsOf(findings, "entry-date-missing")[0]?.severity, "warning");
  });
});

describe("a type that declares no grammar produces no grammar finding", () => {
  it("the arms are type-declared: nothing fires without a declaration", () => {
    const plain: SectionEntry[] = [{ heading: "Facts" }, { heading: "Relations" }];
    const findings = lint(
      ["## Facts", "- a bullet with no category marker", "## Relations", "- not a relation"],
      plain,
      undefined,
      false,
    );
    for (const id of [
      "grammar-unparsed",
      "unknown-category",
      "journal-only-category",
      "claim-provenance",
      "marker-like",
    ]) {
      assert.deepEqual(idsOf(findings, id), [], `${id} needs a declaration`);
    }
  });
});

describe("sourced-inferred: the date arm is an inference, so it is counted", () => {
  it("fires at info when the ISO tail alone recognized the marker", () => {
    const findings = lint(["## Facts", "- [housing] moved apartments (lease signed 2026-08-15)"]);
    const hit = idsOf(findings, "sourced-inferred");
    assert.equal(hit.length, 1, "a domain fact left the core on a punctuation habit; count it");
    assert.equal(hit[0]?.severity, "info");
    assert.equal(typeof hit[0]?.details?.["handle"], "string");
  });

  it("does not fire when a declared source tag matched — that is a declaration", () => {
    const declared = MEMORY_SECTIONS.map((s) =>
      s.heading === "Facts" ? { ...s, sources: ["chatlog"] } : s,
    );
    const findings = lint(["## Facts", "- [housing] moved (chatlog thread 2026-08-15)"], declared);
    assert.deepEqual(idsOf(findings, "sourced-inferred"), []);
  });

  it("does not fire where the section does not admit the sourced form", () => {
    const narrow = MEMORY_SECTIONS.map((s) =>
      s.heading === "Facts" ? { ...s, forms: ["stated"] } : s,
    );
    const findings = lint(
      ["## Facts", "- [housing] moved apartments (lease signed 2026-08-15)"],
      narrow,
    );
    assert.deepEqual(idsOf(findings, "sourced-inferred"), []);
  });
});

describe("every grammar row carries an exception key (docs/concepts.md §Section grammar, docs/concepts.md §Findings and routing)", () => {
  it("carries an evidenceDigest, keyed per item and not per message", () => {
    const findings = lint([
      "## Facts",
      "- [fav-food] hotpot (stated 2026-08-14)",
      "- [fav-food] noodles (stated 2026-08-14)",
    ]);
    const hits = idsOf(findings, "unknown-category");
    assert.equal(hits.length, 2);
    for (const hit of hits) assert.equal(typeof hit.evidenceDigest, "string");
    assert.notEqual(
      hits[0]?.evidenceDigest,
      hits[1]?.evidenceDigest,
      "excepting one claim may not retire another of the same category",
    );
  });

  it("an orphan indented item is reported, never dropped", () => {
    const findings = lint(["## Facts", "  - an orphan indented bullet"]);
    assert.equal(idsOf(findings, "grammar-unparsed").length, 1);
  });
});
