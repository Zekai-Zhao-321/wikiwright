// docs/constitution.md §Sections (a strict block; min defaults to 0, aliases
// share the heading's identity space; sections are union-append-only; a child
// may tighten an inherited heading and never relax it; the block's flags are
// set once on a chain; `additional` may only close) · tombstones.
//
// The load-side sections law. What the matcher does with an effective list is
// sections.test.ts; this file is about what list a type ends up with.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { codesOf, constitutionOf, type Json, loadOf } from "./helpers/constitution.ts";

const concept = (extra: Json): Json => ({ extends: "concept", description: "x.", ...extra });

describe("sections declarations (docs/constitution.md §Sections)", () => {
  it("loads a sections block onto the effective type with declared defaults", () => {
    const registry = constitutionOf({
      types: {
        "test-case": {
          extends: "procedure",
          description: "One case.",
          sections: {
            ordered: true,
            list: [{ heading: "Purpose" }, { heading: "Execution", min: 1 }],
          },
        },
      },
    });
    const eff = registry.types.get("test-case");
    assert.notEqual(eff?.sections, undefined);
    assert.equal(eff?.sections?.ordered, true);
    assert.equal(eff?.sections?.depth, 2);
    assert.equal(eff?.sections?.additional, true);
    // An entry with no min is OPTIONAL — declaring structure is not
    // declaring an obligation.
    assert.deepEqual(
      eff?.sections?.list.map((s) => [s.heading, s.min, s.contributedBy]),
      [
        ["Purpose", 0, "test-case"],
        ["Execution", 1, "test-case"],
      ],
    );
  });

  it("rejects an unknown keyword inside a sections block at load (a typo cannot validate nothing)", () => {
    const codes = codesOf({
      types: { t: concept({ sections: { list: [{ heading: "A" }], additonal: false } }) },
    });
    assert.equal(codes.includes("schema-invalid"), true, JSON.stringify(codes));
  });

  it("rejects a duplicate heading in one list as unreachable", () => {
    const codes = codesOf({
      types: { t: concept({ sections: { list: [{ heading: "Log" }, { heading: "log" }] } }) },
    });
    assert.equal(codes.includes("sections-unreachable"), true, JSON.stringify(codes));
  });

  it("rejects max below min", () => {
    const result = loadOf({
      types: { t: concept({ sections: { list: [{ heading: "A", min: 2, max: 1 }] } }) },
    });
    assert.equal(result.ok, false);
  });
});

describe("sections aliases (docs/constitution.md §Sections)", () => {
  it("loads aliases onto the effective entry", () => {
    const registry = constitutionOf({
      types: {
        note: concept({
          sections: { list: [{ heading: "Notes", min: 1, aliases: ["备注", "Anmerkungen"] }] },
        }),
      },
    });
    assert.deepEqual(registry.types.get("note")?.sections?.list[0]?.aliases, [
      "备注",
      "Anmerkungen",
    ]);
  });

  it("an alias colliding with another entry in the same list is unreachable", () => {
    const codes = codesOf({
      types: {
        note: concept({
          sections: { list: [{ heading: "Notes", aliases: ["Log"] }, { heading: "Log" }] },
        }),
      },
    });
    assert.equal(codes.includes("sections-unreachable"), true, JSON.stringify(codes));
  });

  it("a child may add an alias, and may not drop an inherited one", () => {
    const parent = concept({
      sections: { list: [{ heading: "Notes", min: 1, aliases: ["备注"] }] },
    });
    const adds = loadOf({
      types: {
        parent,
        child: {
          extends: "parent",
          description: "c.",
          sections: { list: [{ heading: "Notes", aliases: ["备注", "Notas"] }] },
        },
      },
    });
    assert.equal(adds.ok, true, JSON.stringify(adds.ok ? [] : adds.issues));
    if (adds.ok) {
      assert.deepEqual(adds.registry.types.get("child")?.sections?.list[0]?.aliases, [
        "备注",
        "Notas",
      ]);
    }
    const drops = codesOf({
      types: {
        parent,
        child: {
          extends: "parent",
          description: "c.",
          sections: { list: [{ heading: "Notes", aliases: ["Notas"] }] },
        },
      },
    });
    assert.equal(drops.includes("sections-alias-removed"), true, JSON.stringify(drops));
  });
});

describe("sections combine union-append-only (docs/constitution.md §Sections)", () => {
  const parent: Json = {
    extends: "procedure",
    description: "parent.",
    sections: {
      ordered: true,
      list: [
        { heading: "Purpose", min: 1 },
        { heading: "Execution", min: 1 },
      ],
    },
  };
  const child = (sections: Json): Json => ({ extends: "parent", description: "child.", sections });

  it("a child appends entries after the inherited list, with per-entry provenance", () => {
    const registry = constitutionOf({
      types: { parent, child: child({ list: [{ heading: "Runs", min: 0 }] }) },
    });
    const eff = registry.types.get("child");
    assert.deepEqual(
      eff?.sections?.list.map((s) => [s.heading, s.contributedBy]),
      [
        ["Purpose", "parent"],
        ["Execution", "parent"],
        ["Runs", "child"],
      ],
    );
    assert.equal(eff?.sections?.ordered, true);
  });

  it("a child redeclaring an inherited heading fails unless it only tightens", () => {
    const codes = codesOf({
      types: { parent, child: child({ list: [{ heading: "Purpose", min: 0 }] }) },
    });
    assert.equal(codes.includes("sections-redeclared"), true, JSON.stringify(codes));
  });

  it("a child changing an ancestor's ordered/depth flags fails; additional may only close", () => {
    const flip = codesOf({
      types: { parent, child: child({ ordered: false, list: [{ heading: "Runs" }] }) },
    });
    assert.equal(flip.includes("sections-flag-conflict"), true, JSON.stringify(flip));

    const tighten = loadOf({
      types: { parent, child: child({ additional: false, list: [{ heading: "Runs" }] }) },
    });
    assert.equal(tighten.ok, true, "true→false is constraint addition — legal");

    const relax = codesOf({
      types: {
        strict: {
          extends: "procedure",
          description: "strict.",
          sections: { additional: false, list: [{ heading: "Only" }] },
        },
        child: {
          extends: "strict",
          description: "child.",
          sections: { additional: true, list: [{ heading: "More" }] },
        },
      },
    });
    assert.equal(relax.includes("sections-flag-conflict"), true, "false→true is relaxation");
  });
});

describe("tombstones", () => {
  it("a retired type stays loadable and carries replaced_by on the effective type", () => {
    const registry = constitutionOf({
      types: {
        successor: concept({ description: "new." }),
        "old-model": concept({
          description: "old.",
          status: "retired",
          replaced_by: ["successor"],
        }),
      },
    });
    const eff = registry.types.get("old-model");
    assert.equal(eff?.status, "retired");
    assert.deepEqual(eff?.replaced_by, ["successor"]);
  });
});

describe("sections child-may-tighten on inherited headings", () => {
  const parent: Json = {
    extends: "procedure",
    description: "p.",
    sections: {
      ordered: true,
      list: [
        { heading: "Facts", min: 1 },
        { heading: "Relations", min: 0 },
      ],
    },
  };

  it("a child may raise min or add max on an inherited heading", () => {
    const registry = constitutionOf({
      types: {
        parent,
        child: {
          extends: "parent",
          description: "c.",
          sections: { list: [{ heading: "Relations", min: 1, max: 1 }] },
        },
      },
    });
    const eff = registry.types.get("child");
    const relations = eff?.sections?.list.find((e) => e.heading === "Relations");
    assert.equal(relations?.min, 1);
    assert.equal(relations?.max, 1);
    assert.equal(relations?.contributedBy, "child", "tightening re-attributes the entry");
    assert.equal(eff?.sections?.list.length, 2, "no duplicate entries");
  });

  it("relaxing min or raising max stays refused", () => {
    const strict = (list: Json[]): Json => ({
      extends: "procedure",
      description: "s.",
      sections: { list },
    });
    const relaxMin = loadOf({
      types: {
        strict: strict([{ heading: "Facts", min: 2 }]),
        child: {
          extends: "strict",
          description: "c.",
          sections: { list: [{ heading: "Facts", min: 1 }] },
        },
      },
    });
    assert.equal(relaxMin.ok, false);

    const raiseMax = loadOf({
      types: {
        strict: strict([{ heading: "Facts", max: 1 }]),
        child: {
          extends: "strict",
          description: "c.",
          sections: { list: [{ heading: "Facts", max: 3 }] },
        },
      },
    });
    assert.equal(raiseMax.ok, false);
  });
});
