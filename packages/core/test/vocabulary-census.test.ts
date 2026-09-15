// docs/constitution.md §Vocabularies (the census: counted, never
// rejected) · docs/constitution.md §Sections (a `range` is matched through the
// target's extends chain) · docs/concepts.md §Findings and routing (a `declared` row's
// default)
//
// The two laws `vocabulary show` rests on, tested where they live: ONE range
// predicate (so `admits` and `relation-range` cannot disagree) and ONE default
// severity for a `declared` arm (so `bound_by` cannot report a severity the
// emit site does not apply).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { armDefault, armRows, DECLARED_ARM_DEFAULT } from "../src/grammar/index.ts";
import { observeVocabulary } from "../src/lint/index.ts";
import { KERNEL_OWNED_ARMS } from "../src/modules/index.ts";
import { parseDoc } from "../src/parse/index.ts";
import { loadConstitution } from "../src/registry/index.ts";
import { STANDARD_LIBRARY, standardLibrary } from "../src/stdlib/index.ts";
import { rangeAdmits } from "../src/stdlib/relations.ts";

describe("the range predicate is one predicate", () => {
  it("an absent range admits everything — that is what no range means", () => {
    assert.equal(rangeAdmits(undefined, ["company", "org", "concept"]), true);
    assert.equal(rangeAdmits(undefined, []), true);
  });

  it("a declared range is matched THROUGH the chain, not against the type name", () => {
    assert.equal(rangeAdmits(["org"], ["company", "org", "concept"]), true);
    assert.equal(rangeAdmits(["org"], ["person", "concept"]), false);
    // Any member of the range matching any link of the chain is a match.
    assert.equal(rangeAdmits(["org", "person"], ["person", "concept"]), true);
  });
});

describe("an arm's row has one definition (docs/concepts.md §Findings and routing)", () => {
  // What this replaced: `GRAMMAR_ARMS` carried `row` AND `default` for all
  // twenty-one arms, and this case held the two in step. `default` is derived
  // from `row` now, so that drift cannot happen and the old assertion would be a
  // tautology. What is worth asserting instead is that the composed view really
  // spans both sources — a kernel-only view would still pass every severity test
  // in the suite while a kit's arm had no row at all.
  it("the composed view is the kernel's rows plus every module's", () => {
    const rows = armRows(standardLibrary());
    for (const id of KERNEL_OWNED_ARMS) {
      assert.equal(rows.has(id), true, `the kernel's "${id}" has a row`);
    }
    let fromModules = 0;
    for (const manifest of STANDARD_LIBRARY) {
      for (const grammar of Object.values(manifest.grammars ?? {})) {
        for (const arm of grammar.arms) {
          assert.equal(
            rows.get(arm.id),
            arm.row,
            `"${arm.id}" carries the row its module declared`,
          );
          fromModules += 1;
        }
      }
    }
    assert.equal(fromModules > 0, true, "the manifests declare rows at all");
    assert.equal(
      rows.size,
      KERNEL_OWNED_ARMS.length + fromModules,
      "no row comes from anywhere but the kernel or a manifest",
    );
  });

  it("the knob moves a declared row and never a census row", () => {
    const rows = armRows(standardLibrary());
    assert.equal(rows.get("unknown-category"), "declared");
    assert.equal(armDefault("declared"), DECLARED_ARM_DEFAULT);
    assert.equal(rows.get("marker-like"), "info", "a count is not a verdict");
    assert.equal(armDefault("info"), "info");
  });
});

const CONSTITUTION = {
  schema: "wikiwright/constitution",
  schema_version: 3,
  vocabularies: {
    tags: { mode: "registered", entries: { meta: { description: "The wiki about the wiki." } } },
    categories: {
      mode: "registered",
      entries: { identity: { class: "supersede", description: "Who the entity is." } },
    },
    relations: { mode: "census" },
  },
  types: {
    person: {
      extends: "concept",
      description: "One human being.",
      sections: {
        depth: 2,
        list: [
          { heading: "Facts", grammar: "claims", vocabulary: "categories" },
          { heading: "Relations", grammar: "relations", vocabulary: "relations" },
        ],
      },
    },
  },
};

function registry() {
  const loaded = loadConstitution(CONSTITUTION, standardLibrary());
  assert.equal(loaded.ok, true, JSON.stringify(loaded.ok ? [] : loaded.issues));
  if (!loaded.ok) throw new Error("unreachable");
  return loaded.registry;
}

function page(name: string, body: string) {
  return {
    path: `wiki/${name}.md`,
    doc: parseDoc(
      `---\ntype: person\ntitle: ${name}\ndescription: d\ntags: [meta]\n---\n\n${body}`,
    ),
  };
}

describe("observeVocabulary counts what the vault writes", () => {
  it("groups two spellings of one identity into one row, deterministically", () => {
    // The vocabulary's identity relation is `normalizeIdentity`, so `Knows` and
    // `knows` are ONE entry to every consumer. A census that split them would
    // report two unregistered labels where the engine reports one.
    const observed = observeVocabulary(
      "relations",
      [
        page("Ada", "## Relations\n\n- Knows [[Bob]]\n"),
        page("Bob", "## Relations\n\n- knows [[Ada]]\n"),
      ],
      registry(),
    );
    assert.deepEqual(observed, [{ label: "Knows", count: 2, onTypes: ["person"] }]);
  });

  it("sorts by count descending, then by label", () => {
    const observed = observeVocabulary(
      "relations",
      [
        page("Ada", "## Relations\n\n- knows [[Bob]]\n- zealous_about [[Bob]]\n"),
        page("Bob", "## Relations\n\n- knows [[Ada]]\n- allied_with [[Ada]]\n"),
      ],
      registry(),
    );
    assert.deepEqual(
      observed.map((o) => [o.label, o.count]),
      [
        ["knows", 2],
        ["allied_with", 1],
        ["zealous_about", 1],
      ],
    );
  });

  it("reads categories from claims and tags from the frontmatter", () => {
    const pages = [page("Ada", "## Facts\n\n- [identity] full name: Ada (stated 2026-01-01)\n")];
    assert.deepEqual(observeVocabulary("categories", pages, registry()), [
      { label: "identity", count: 1, onTypes: ["person"] },
    ]);
    assert.deepEqual(observeVocabulary("tags", pages, registry()), [
      { label: "meta", count: 1, onTypes: ["person"] },
    ]);
  });

  it("a page whose type the registry does not declare contributes nothing", () => {
    const stray = {
      path: "wiki/Stray.md",
      doc: parseDoc("---\ntype: no-such-type\ntitle: Stray\ndescription: d\ntags: [meta]\n---\n"),
    };
    assert.deepEqual(observeVocabulary("relations", [stray], registry()), []);
    // `tags` is read outside any section, so it is still counted.
    assert.deepEqual(observeVocabulary("tags", [stray], registry()), [
      { label: "meta", count: 1, onTypes: ["no-such-type"] },
    ]);
  });
});
