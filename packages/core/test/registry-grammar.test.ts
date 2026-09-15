// docs/constitution.md §Sections (grammar declaration, its parameters, and the combination
// law: add a grammar where there is none, tighten a parameter, never change or
// relax)
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type Json, loadOf } from "./helpers/constitution.ts";

/** Every vocabulary a section below may bind, counted rather than refused. */
const VOCABULARIES: Json = {
  categories: { mode: "census" },
  relations: { mode: "census" },
};

function load(types: Json) {
  return loadOf({ vocabularies: VOCABULARIES, types });
}

const base = (sections: Json): Json => ({
  extends: "concept",
  description: "A base.",
  sections,
});

function issueCodes(types: Json): string[] {
  const result = load(types);
  return result.ok ? [] : result.issues.map((i) => i.code);
}

describe("a section entry declares its grammar and that grammar's parameters (docs/constitution.md §Sections)", () => {
  it("loads and carries the parameters onto the effective entry", () => {
    const result = load({
      person: base({
        depth: 2,
        list: [
          {
            heading: "Facts",
            min: 1,
            grammar: "claims",
            history: "History",
            provenance: "required",
            forms: ["stated", "inferred"],
            sources: ["mail"],
            vocabulary: "categories",
          },
          { heading: "Relations", grammar: "relations", vocabulary: "relations" },
          { heading: "Timeline", grammar: "entries", date: "optional", lifecycle: "append-only" },
          { heading: "History", grammar: "claims", role: "history" },
          { heading: "Notes" },
        ],
      }),
    });
    assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
    if (!result.ok) return;
    const facts = result.registry.types.get("person")?.sections?.list[0];
    assert.equal(facts?.grammar, "claims");
    assert.equal(facts?.params["provenance"], "required");
    assert.deepEqual(facts?.params["forms"], ["stated", "inferred"]);
    assert.deepEqual(facts?.params["sources"], ["mail"]);
    assert.equal(facts?.vocabulary, "categories");
    assert.equal(facts?.registryPath, "/types/person/sections/list/0");
    const notes = result.registry.types.get("person")?.sections?.list[4];
    assert.equal(notes?.grammar, undefined, "prose is the default and is not materialized");
  });

  it("an unknown grammar, or a parameter of another grammar, is a load error", () => {
    assert.equal(
      issueCodes({ person: base({ list: [{ heading: "Facts", grammar: "elephants" }] }) }).length >
        0,
      true,
      "the grammar enum is closed",
    );
    assert.deepEqual(
      issueCodes({
        person: base({ list: [{ heading: "Facts", grammar: "claims", date: "required" }] }),
      }),
      ["sections-grammar-params"],
      "an entries parameter on a claims section is refused by name",
    );
    assert.deepEqual(
      issueCodes({ person: base({ list: [{ heading: "Facts", provenance: "required" }] }) }),
      ["sections-grammar-params"],
      "a parameter with no grammar to belong to",
    );
  });
});

describe("the combination law under extends (docs/constitution.md §Sections)", () => {
  const child = (parentFacts: Json, childFacts: Json): Json => ({
    entity: base({ depth: 2, list: [{ heading: "Facts", min: 1, ...parentFacts }] }),
    person: {
      extends: "entity",
      description: "A person.",
      sections: { list: [{ heading: "Facts", ...childFacts }] },
    },
  });

  it("a child may add a grammar to an inherited entry that has none", () => {
    const result = load(child({}, { grammar: "claims", provenance: "required" }));
    assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
    if (!result.ok) return;
    const facts = result.registry.types.get("person")?.sections?.list[0];
    assert.equal(facts?.grammar, "claims");
    assert.equal(facts?.contributedBy, "person");
  });

  it("a child may not change an inherited grammar", () => {
    assert.deepEqual(issueCodes(child({ grammar: "claims" }, { grammar: "entries" })), [
      "sections-grammar-conflict",
    ]);
  });

  it("parameters tighten in one direction only", () => {
    assert.equal(
      load(child({ grammar: "claims", provenance: "optional" }, { provenance: "required" })).ok,
      true,
      "optional → required tightens",
    );
    assert.deepEqual(
      issueCodes(child({ grammar: "claims", provenance: "required" }, { provenance: "optional" })),
      ["sections-grammar-relaxed"],
    );
    assert.equal(
      load(
        child(
          { grammar: "claims", forms: ["stated", "inferred", "legacy"] },
          { forms: ["stated"] },
        ),
      ).ok,
      true,
      "a subset of forms tightens",
    );
    assert.deepEqual(
      issueCodes(child({ grammar: "claims", forms: ["stated"] }, { forms: ["stated", "legacy"] })),
      ["sections-grammar-relaxed"],
    );
    assert.deepEqual(
      issueCodes(child({ grammar: "entries", lifecycle: "append-only" }, { lifecycle: "free" })),
      ["sections-grammar-relaxed"],
    );
    assert.deepEqual(
      issueCodes(child({ grammar: "claims", history: "History" }, { history: "Changelog" })),
      ["sections-grammar-relaxed"],
      "an identity-bearing parameter may not move",
    );
  });

  it("the parent's grammar survives a child that only tightens min", () => {
    const result = load(child({ grammar: "claims", history: "History" }, { min: 2 }));
    assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
    if (!result.ok) return;
    const facts = result.registry.types.get("person")?.sections?.list[0];
    assert.equal(facts?.grammar, "claims");
    assert.equal(facts?.params["history"], "History");
    assert.equal(facts?.min, 2);
  });
});

describe("forms, sources and role are declared where the grammar is (docs/constitution.md §Sections)", () => {
  const child = (parentFacts: Json, childFacts: Json): Json => ({
    entity: base({ depth: 2, list: [{ heading: "Facts", min: 1, ...parentFacts }] }),
    person: {
      extends: "entity",
      description: "A person.",
      sections: { list: [{ heading: "Facts", ...childFacts }] },
    },
  });

  it("a child may not first-declare forms or sources on an inherited grammar", () => {
    assert.deepEqual(
      issueCodes(child({ grammar: "claims" }, { forms: ["stated"] })),
      ["sections-grammar-relaxed"],
      "forms decides which parentheticals are markers, so it re-keys every claim",
    );
    assert.deepEqual(
      issueCodes(child({ grammar: "claims" }, { sources: ["mail"] })),
      ["sections-grammar-relaxed"],
      "and first-declaring sources widened against the `[]` default",
    );
  });

  it("a child may not first-declare role on an inherited grammar", () => {
    assert.deepEqual(
      issueCodes(child({ grammar: "claims" }, { role: "history" })),
      ["sections-grammar-relaxed"],
      "no rule silently disables another: role: history turns the lifecycle arm off",
    );
  });

  it("the strictness ladders are unaffected — a child still declares those first", () => {
    for (const own of [
      { provenance: "required" },
      { history: "History" },
      { vocabulary: "categories" },
    ]) {
      assert.equal(
        load(child({ grammar: "claims" }, own)).ok,
        true,
        `${JSON.stringify(own)} adds a check; it does not move identity`,
      );
    }
  });

  it("a child that declares the grammar itself declares its vocabulary with it", () => {
    const result = load(child({}, { grammar: "claims", forms: ["stated"], sources: ["mail"] }));
    assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
    const roled = load(child({}, { grammar: "claims", role: "history" }));
    assert.equal(roled.ok, true, JSON.stringify(roled.ok ? [] : roled.issues));
  });
});
