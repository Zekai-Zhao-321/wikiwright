// docs/constitution.md §Types · docs/cli.md §init (disjoint namespaces;
// nearest-ancestor template) · docs/concepts.md ·
// docs/architecture.md §The invariants (flatten at load; nothing walks a chain
// downstream; optional→required promotion is a monotonic tightening; the
// grace field).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type Doc, loadOf } from "./helpers/constitution.ts";

/**
 * `EffectiveType.fields` is ONE map, `required` inside the shape. These
 * two read the disposition where the question is asked — the same way the engine
 * does — instead of the IR carrying a second copy of the answer.
 */
const requiredOf = (
  t: { fields: Map<string, { shape: unknown; contributedBy: string }> } | undefined,
) =>
  [...(t?.fields ?? [])]
    .filter(([, s]) => (s.shape as { required?: boolean }).required === true)
    .map(([value, s]) => ({ value, contributedBy: s.contributedBy }));

const TAGS = {
  reset: { description: "Reset behavior." },
  cycling: { description: "Repeated execution." },
  "test-execution": { description: "Running tests on rigs." },
};

const LAW: Doc = {
  tags: TAGS,
  fragments: {
    "dated-log": {
      description: "Dated entries; never silently changed.",
      sections: { depth: 2, list: [{ heading: "Log" }] },
    },
  },
  types: {
    "test-case": {
      extends: "procedure",
      description: "One executable validation case.",
      use_when: "A single runnable case.",
      avoid_when: "Aggregated results.",
      fragments: ["dated-log"],
      fields: { case_id: { kind: "any", required: true }, owner_team: { kind: "any" } },
      template: "templates/wiki/test-case.md",
      example: "templates/examples/test-case.md",
      body: { lifecycle: "append-only" },
      sections: {
        depth: 2,
        list: [
          { heading: "Purpose", min: 1 },
          { heading: "Execution", min: 1 },
          { heading: "Expected result", min: 1 },
        ],
      },
    },
    "soak-test": {
      extends: "test-case",
      description: "A long-duration stability run.",
      fields: { duration_hours: { kind: "any", required: true } },
      sections: { list: [{ heading: "Stability window", min: 1 }] },
    },
  },
};

type Types = Record<string, Record<string, unknown>>;

/** The law with one change to its types. */
function withTypes(mutate: (types: Types) => void): Doc {
  const types = structuredClone(LAW.types) as Types;
  mutate(types);
  return { ...LAW, types };
}

/** One declared type of the law, for a mutation that edits it. */
function typeOf(types: Types, name: string): Record<string, unknown> {
  const entry = types[name];
  if (entry === undefined) throw new Error(`the law declares no "${name}"`);
  return entry;
}

/** The law with one change to its tags. */
function withTags(mutate: (tags: Record<string, unknown>) => void): Doc {
  const tags = structuredClone(TAGS) as Record<string, unknown>;
  mutate(tags);
  return { ...LAW, tags };
}

function load(doc: Doc = LAW) {
  return loadOf(doc);
}

function expectErrors(result: ReturnType<typeof loadOf>, code: string): void {
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(
    result.issues.some((i) => i.code === code),
    true,
    `expected issue ${code}; got: ${result.issues.map((i) => i.code).join(", ")}`,
  );
}

describe("flatten at load", () => {
  it("builds the chain and computes the archetype without storing it", () => {
    const r = load();
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const soak = r.registry.types.get("soak-test");
    assert.deepEqual(soak?.chain, ["soak-test", "test-case", "procedure"]);
    assert.equal(soak?.archetype, "procedure");
  });

  it("carries per-element contributedBy provenance", () => {
    const r = load();
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const soak = r.registry.types.get("soak-test");
    const caseId = requiredOf(soak).find((f) => f.value === "case_id");
    assert.equal(caseId?.contributedBy, "test-case");
    const duration = requiredOf(soak).find((f) => f.value === "duration_hours");
    assert.equal(duration?.contributedBy, "soak-test");
    const title = requiredOf(soak).find((f) => f.value === "title");
    assert.equal(title?.contributedBy, "engine");
    // The page-wide law is the type's own declaration, and provenance answers
    // "who imposed this" in one lookup — which is the property under test.
    assert.equal(soak?.body?.lifecycle, "append-only");
    assert.equal(soak?.body?.contributedBy, "test-case");
  });

  it("aggregates section structure from ancestors and fragments with provenance", () => {
    const r = load();
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const soak = r.registry.types.get("soak-test");
    const byHeading = new Map(soak?.sections?.list.map((e) => [e.heading, e.contributedBy]));
    assert.equal(byHeading.get("Log"), "fragment:dated-log");
    assert.equal(byHeading.get("Purpose"), "test-case");
    assert.equal(byHeading.get("Stability window"), "soak-test");
  });

  it("resolves the template from the nearest ancestor that declares one (docs/cli.md §init)", () => {
    const r = load();
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const soak = r.registry.types.get("soak-test");
    assert.equal(soak?.template?.value, "templates/wiki/test-case.md");
    assert.equal(soak?.template?.contributedBy, "test-case");
  });

  it("exposes archetypes as flattened types with engine base fields", () => {
    const r = load();
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const concept = r.registry.types.get("concept");
    assert.equal(concept?.archetype, "concept");
    assert.equal(
      requiredOf(concept).some((f) => f.value === "type" && f.contributedBy === "engine"),
      true,
    );
  });

  it("orders flattened fields deterministically by code unit", () => {
    const r = load();
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const soak = r.registry.types.get("soak-test");
    const keys = requiredOf(soak).map((f) => f.value) ?? [];
    const sorted = [...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    assert.deepEqual(keys, sorted);
  });
});

describe("monotonic specialization law", () => {
  it("rejects redeclaring an inherited required field", () => {
    const bad = withTypes((types) => {
      typeOf(types, "soak-test")["fields"] = { case_id: { kind: "any", required: true } };
    });
    // Every declared field carries a shape, so a redeclaration is caught
    // as a shape redeclaration — one field, one shape, one place to say so.
    expectErrors(load(bad), "field-schema-redeclared");
  });

  it("accepts optional→required promotion as a tightening", () => {
    const promoted = withTypes((types) => {
      typeOf(types, "soak-test")["fields"] = { owner_team: { kind: "any", required: true } };
    });
    const result = load(promoted);
    assert.equal(result.ok, true, JSON.stringify(!result.ok ? result.issues : []));
  });
});

const optionalOf = (
  t: { fields: Map<string, { shape: unknown; contributedBy: string }> } | undefined,
) =>
  [...(t?.fields ?? [])]
    .filter(([, s]) => (s.shape as { required?: boolean }).required !== true)
    .map(([value, s]) => ({ value, contributedBy: s.contributedBy }));

describe("optional→required promotion is a legal tightening", () => {
  const promotion = () =>
    loadOf({
      types: {
        record: {
          extends: "reference",
          description: "R.",
          fields: { external_id: { kind: "any" } },
        },
        strict_record: {
          extends: "record",
          description: "S.",
          fields: { external_id: { kind: "any", required: true } },
        },
      },
    });

  it("the child loads and its effective contract requires the field", () => {
    const result = promotion();
    assert.equal(result.ok, true, JSON.stringify(!result.ok ? result.issues : []));
    if (!result.ok) return;
    const eff = result.registry.types.get("strict_record");
    assert.equal(
      requiredOf(eff).some((f) => f.value === "external_id"),
      true,
    );
    assert.equal(
      optionalOf(eff).some((f) => f.value === "external_id"),
      false,
      "the promoted field leaves the effective optional list",
    );
  });

  it("the parent still treats the field as optional", () => {
    const result = promotion();
    if (!result.ok) throw new Error("load failed");
    const eff = result.registry.types.get("record");
    assert.equal(
      optionalOf(eff).some((f) => f.value === "external_id"),
      true,
    );
  });
});

describe("chain validity", () => {
  it("rejects an unknown extends target", () => {
    const bad = withTypes((types) => {
      typeOf(types, "test-case")["extends"] = "nonexistent";
    });
    expectErrors(load(bad), "unknown-extends");
  });

  it("rejects extends cycles", () => {
    const bad = withTypes((types) => {
      typeOf(types, "test-case")["extends"] = "soak-test";
    });
    expectErrors(load(bad), "extends-cycle");
  });

  it("rejects a bundle type that shadows an archetype name", () => {
    const bad = withTypes((types) => {
      types["procedure"] = { description: "shadow", extends: "concept" };
    });
    expectErrors(load(bad), "archetype-name-collision");
  });

  it("rejects extending a retired type", () => {
    const bad = withTypes((types) => {
      typeOf(types, "test-case")["status"] = "retired";
    });
    expectErrors(load(bad), "extends-retired");
  });
});

describe("namespace independence under normalized identity (within a namespace)", () => {
  it("a tag sharing a type name loads clean — the namespaces are independent", () => {
    const result = load(
      withTags((tags) => {
        tags["Test-Case"] = { description: "shares a type name" };
      }),
    );
    assert.equal(result.ok, true, JSON.stringify(!result.ok ? result.issues : []));
  });

  it("rejects tag/alias collisions under NFC + casefold", () => {
    const r = load(
      withTags((tags) => {
        tags["café"] = { description: "composed" };
        tags["café"] = { description: "decomposed" };
      }),
    );
    // Distinct byte strings, one identity after NFC — must collide, and the
    // collision is the vocabulary's own alias law.
    expectErrors(r, "vocabulary-alias-collision");
  });

  it("rejects an alias colliding with another tag", () => {
    const r = load(
      withTags((tags) => {
        tags["cycling"] = { description: "Repeated execution.", aliases: ["RESET"] };
      }),
    );
    expectErrors(r, "vocabulary-alias-collision");
  });
});

describe("constitution validation (docs/concepts.md)", () => {
  // Duplicate rule ids and the singleton-checker conflict are
  // unrepresentable rather than checked — a v3 type declares no rules, so there
  // is no id to duplicate and no checker to configure twice. The contradiction
  // family that survives is the one about structure.
  it("a child forbidding a heading its ancestor requires is a load error", () => {
    const bad = withTypes((types) => {
      typeOf(types, "soak-test")["sections"] = { list: [{ heading: "Purpose", max: 0 }] };
    });
    // Caught by the sections law rather than by the contradiction check, because
    // `max: 0` on an inherited heading is a redeclaration before it is a
    // contradiction — and the sections law already compares identity.
    expectErrors(load(bad), "sections-redeclared");
  });

  it("the contradiction check compares heading IDENTITY, not the raw string", () => {
    // The defect: both halves built `Map<rawHeading, …>`, so `## Facts` required
    // by one entry and `## facts` forbidden by another read as two headings to
    // the ONE check whose whole job is noticing they are the same. The v2 half
    // is deleted; this is the v3 half, which had the same bug.
    const result = loadOf({
      types: {
        note: {
          extends: "concept",
          description: "A note.",
          sections: {
            depth: 2,
            list: [
              { heading: "Facts", min: 1 },
              { heading: "facts", max: 0 },
            ],
          },
        },
      },
    });
    assert.equal(result.ok, false);
    const codes = result.ok ? [] : result.issues.map((i) => i.code);
    assert.equal(codes.includes("rule-conflict-heading"), true, JSON.stringify(codes));
  });
});

describe("the tags vocabulary's laws", () => {
  it("rejects replaced_by pointing at an unregistered tag", () => {
    const r = load(
      withTags((tags) => {
        tags["validation"] = {
          description: "retired umbrella",
          status: "retired",
          replaced_by: ["reset", "no-such-tag"],
        };
      }),
    );
    expectErrors(r, "unknown-replaced-by");
  });
});

describe("schema shape (zod layer)", () => {
  it("reports a malformed type entry with a path naming it", () => {
    const r = load({ types: { x: {} } });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(
      r.issues.some((i) => i.code === "schema-invalid" && i.where.includes("x")),
      true,
      JSON.stringify(r.issues),
    );
  });
});
