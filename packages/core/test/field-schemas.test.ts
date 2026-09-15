// Frontmatter fields carry value shapes: typed pages get typed metadata; a
// fragment adds the fields it validates; shapes inherit
// union-error-on-collision and are meta-validated at load.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildNameIndex, lintPage, loadConstitution, loadModules } from "../src/index.ts";
import { parseDoc } from "../src/parse/index.ts";
import { STANDARD_LIBRARY } from "../src/stdlib/index.ts";
import { constitutionOf, type Doc, documentOf, loadOf } from "./helpers/constitution.ts";

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

function loadOk(doc: Doc) {
  return constitutionOf(doc);
}

const RECORD_TYPES: Doc = {
  types: {
    record: {
      extends: "reference",
      description: "R.",
      fields: {
        record_id: { kind: "string", min_length: 1, pattern: "^[A-Z]+-[0-9]+$", required: true },
        capture: { kind: "page-ref", target_root: "raw" },
      },
    },
  },
};

const page = (fm: string) =>
  parseDoc(`---\ntype: record\ntitle: T\ndescription: d.\ntags: []\n${fm}\n---\n\n# T\n`);

describe("typed metadata: field values validate against declared shapes", () => {
  const registry = loadOk(RECORD_TYPES);

  it("record_id: [] fails the string shape", () => {
    const findings = lintPage({ path: "wiki/t.md", doc: page("record_id: []"), registry });
    assert.equal(
      findings.some((f) => f.ruleId === "field-shape"),
      true,
    );
  });

  it("a pattern violation is a finding; a conforming value passes", () => {
    const bad = lintPage({ path: "wiki/t.md", doc: page('record_id: "abc"'), registry });
    assert.equal(
      bad.some((f) => f.ruleId === "field-shape"),
      true,
    );
    const good = lintPage({ path: "wiki/t.md", doc: page('record_id: "REC-12"'), registry });
    assert.equal(
      good.some((f) => f.ruleId === "field-shape"),
      false,
    );
  });

  it("page-ref fields resolve through the name index and pin the root", () => {
    const pages = [
      {
        path: "raw/capture-x.md",
        doc: parseDoc(
          '---\ntype: record\ntitle: capture-x\ndescription: c.\ntags: []\nrecord_id: "REC-1"\n---\n\n# c\n',
        ),
      },
    ];
    const names = buildNameIndex(pages);
    const good = lintPage(
      { path: "wiki/t.md", doc: page('record_id: "REC-2"\ncapture: "capture-x"'), registry },
      { names },
    );
    assert.equal(
      good.some((f) => f.ruleId === "field-shape"),
      false,
    );
    const ghost = lintPage(
      { path: "wiki/t.md", doc: page('record_id: "REC-2"\ncapture: "ghost"'), registry },
      { names },
    );
    assert.equal(
      ghost.some((f) => f.ruleId === "field-shape"),
      true,
    );
  });
});

describe("a fragment adds the fields it validates", () => {
  it("a fragment's field lands on the type with its shape", () => {
    const registry = loadOk({
      fragments: {
        "verify-evidence-carrier": {
          description: "Verification events carry their field.",
          fields: {
            verified: {
              kind: "list",
              item: { kind: "string", min_length: 8 },
              min_items: 1,
              required: true,
            },
          },
        },
      },
      types: {
        claim: {
          extends: "concept",
          description: "C.",
          fragments: ["verify-evidence-carrier"],
        },
      },
    });
    const eff = registry.types.get("claim");
    assert.equal(
      requiredOf(eff).some((f) => f.value === "verified"),
      true,
      "the fragment's field is required on the type",
    );
    const doc = parseDoc(
      '---\ntype: claim\ntitle: T\ndescription: d.\ntags: []\nverified: ["short"]\n---\n\n# T\n',
    );
    const findings = lintPage({ path: "wiki/t.md", doc, registry });
    assert.equal(
      findings.some((f) => f.ruleId === "field-shape"),
      true,
      "the fragment's shape judges the value",
    );
  });
});

describe("shape discipline at load", () => {
  it("a malformed shape is a load error", () => {
    const result = loadOf({
      types: {
        record: {
          extends: "reference",
          description: "R.",
          fields: { record_id: { kind: "uuid", required: true } },
        },
      },
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(
      result.issues.some((i) => i.code === "field-shape-invalid"),
      true,
      JSON.stringify(result.issues),
    );
  });

  it("a child redeclaring an inherited shape is a collision", () => {
    const result = loadOf({
      types: {
        record: {
          extends: "reference",
          description: "R.",
          fields: { record_id: { kind: "string", required: true } },
        },
        strict_record: {
          extends: "record",
          description: "S.",
          fields: { record_id: { kind: "string", min_length: 2 } },
        },
      },
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(
      result.issues.some((i) => i.code === "field-schema-redeclared"),
      true,
      JSON.stringify(result.issues),
    );
  });

  it("a child may shape an inherited `any` field, and the disposition carries", () => {
    const result = loadOf({
      types: {
        record: {
          extends: "reference",
          description: "R.",
          fields: { record_id: { kind: "any", required: true } },
        },
        strict_record: {
          extends: "record",
          description: "S.",
          fields: { record_id: { kind: "string", min_length: 2 } },
        },
      },
    });
    assert.equal(result.ok, true, JSON.stringify(!result.ok ? result.issues : []));
    if (!result.ok) return;
    const shaped = result.registry.types.get("strict_record")?.fields.get("record_id");
    assert.deepEqual(shaped?.shape, { kind: "string", min_length: 2, required: true });
    assert.equal(shaped?.contributedBy, "strict_record");
  });
});

describe("source-reference integrity is declared, not assumed", () => {
  // A bundle in use caught the alternative: a blanket "every sources: entry is a
  // page reference" pass put 459 errors on a real vault whose provenance is
  // free-form (raw paths, captures, URLs). The engine ships the mechanism;
  // a bundle whose sources ARE page refs declares the shape.
  const registry = loadOk({
    types: {
      claim: {
        extends: "concept",
        description: "C.",
        // The bundle declares `sources` AND its shape: the kernel's base field
        // set does not carry it (the relation is the citation), so the field
        // is the bundle's own to declare and to shape.
        fields: { sources: { kind: "page-ref-list", target_root: "raw" } },
      },
    },
  });
  const evidence = {
    path: "raw/capture-x.md",
    doc: parseDoc("---\ntype: claim\ntitle: capture-x\ndescription: c.\ntags: []\n---\n\n# c\n"),
  };
  const claim = (sources: string) =>
    parseDoc(
      `---\ntype: claim\ntitle: T\ndescription: d.\ntags: []\nsources: ${sources}\n---\n\n# T\n`,
    );

  it("an unresolved declared source is an error", () => {
    const names = buildNameIndex([evidence]);
    const findings = lintPage({ path: "wiki/t.md", doc: claim('["ghost"]'), registry }, { names });
    assert.equal(
      findings.some((f) => f.ruleId === "field-shape"),
      true,
    );
  });

  it("a source resolving outside the declared root is an error", () => {
    const stray = {
      path: "wiki/stray.md",
      doc: parseDoc("---\ntype: claim\ntitle: stray\ndescription: s.\ntags: []\n---\n\n# s\n"),
    };
    const names = buildNameIndex([evidence, stray]);
    const findings = lintPage({ path: "wiki/t.md", doc: claim('["stray"]'), registry }, { names });
    assert.equal(
      findings.some((f) => f.ruleId === "field-shape"),
      true,
    );
  });

  it("a resolving in-root source passes", () => {
    const names = buildNameIndex([evidence]);
    const findings = lintPage(
      { path: "wiki/t.md", doc: claim('["capture-x"]'), registry },
      { names },
    );
    assert.equal(
      findings.some((f) => f.ruleId === "field-shape"),
      false,
    );
  });

  it("a bundle that declares no shape keeps free-form provenance", () => {
    const plain = loadOk({
      types: {
        claim: {
          extends: "concept",
          description: "C.",
          // The field, declared; no shape attached.
          fields: { sources: { kind: "any" } },
        },
      },
    });
    const names = buildNameIndex([evidence]);
    const findings = lintPage(
      {
        path: "wiki/t.md",
        doc: claim('["gmail 2026-08-15", "raw/notes/2026-08-15--export/x.md"]'),
        registry: plain,
      },
      { names },
    );
    assert.equal(
      findings.some((f) => f.ruleId === "field-shape"),
      false,
      "free-form provenance is legitimate; the engine never assumes otherwise",
    );
  });
});

describe("`requires` on a shape: the field is required exactly when its triggers are present", () => {
  const registry = loadOk({
    types: {
      claim: {
        extends: "concept",
        description: "A claim.",
        fields: { verified: { kind: "any" }, evidence: { kind: "any", requires: ["verified"] } },
      },
    },
  });
  const ids = (findings: ReturnType<typeof lintPage>): string[] => findings.map((f) => f.ruleId);

  it("fires when the trigger key is present and the required key is absent", () => {
    const doc = parseDoc(
      "---\ntype: claim\ntitle: T\ndescription: d.\ntags: []\nverified: 2026-09-01\n---\n\n# T\n",
    );
    const findings = lintPage({ path: "wiki/c.md", doc, registry });
    assert.equal(ids(findings).includes("field-shape"), true, JSON.stringify(ids(findings)));
  });

  it("passes when both are present, and when the trigger is absent", () => {
    const both = parseDoc(
      '---\ntype: claim\ntitle: T\ndescription: d.\ntags: []\nverified: 2026-09-01\nevidence: ["raw/x.md"]\n---\n\n# T\n',
    );
    assert.equal(
      ids(lintPage({ path: "wiki/c.md", doc: both, registry })).includes("field-shape"),
      false,
    );
    const neither = parseDoc("---\ntype: claim\ntitle: T\ndescription: d.\ntags: []\n---\n\n# T\n");
    assert.equal(
      ids(lintPage({ path: "wiki/c.md", doc: neither, registry })).includes("field-shape"),
      false,
    );
  });
});

describe("a non-empty list shape", () => {
  const registry = loadOk({
    types: {
      claim: {
        extends: "concept",
        description: "A claim.",
        fields: {
          evidence: { kind: "list", min_items: 1, item: { kind: "string", min_length: 1 } },
        },
      },
    },
  });
  const ids = (findings: ReturnType<typeof lintPage>): string[] => findings.map((f) => f.ruleId);
  const page = (evidence: string) =>
    parseDoc(
      `---\ntype: claim\ntitle: T\ndescription: d.\ntags: []\nevidence: ${evidence}\n---\n\n# T\n`,
    );

  it("rejects an empty list and accepts a non-empty one; ignores pages where the field is absent", () => {
    assert.equal(
      ids(lintPage({ path: "wiki/c.md", doc: page("[]"), registry })).includes("field-shape"),
      true,
    );
    assert.equal(
      ids(
        lintPage({ path: "wiki/c.md", doc: page('["raw/queries/q-113.md"]'), registry }),
      ).includes("field-shape"),
      false,
    );
    const absent = parseDoc("---\ntype: claim\ntitle: T\ndescription: d.\ntags: []\n---\n\n# T\n");
    assert.equal(
      ids(lintPage({ path: "wiki/c.md", doc: absent, registry })).includes("field-shape"),
      false,
    );
  });
});

// A bundle may TIGHTEN an inherited shaped field. `docs/constitution.md §Sections`
// let a child shape an unshaped field and promote one to required; a kit's
// `locator: {kind: string}` could not take the bundle's host pattern and a
// kit's enum could not be narrowed, so the kit's enum had to be exactly the
// bundle's values — which makes it not a kit value at all.
describe("a child tightens an inherited shaped field, and never relaxes it", () => {
  const over = (parent: Record<string, unknown>, child: Record<string, unknown>): Doc => ({
    types: {
      record: { extends: "reference", description: "R.", fields: { f: parent } },
      strict: { extends: "record", description: "S.", fields: { f: child } },
    },
  });
  const effective = (parent: Record<string, unknown>, child: Record<string, unknown>) =>
    loadOk(over(parent, child)).types.get("strict")?.fields.get("f");
  const refused = (parent: Record<string, unknown>, child: Record<string, unknown>, why = "") => {
    const result = loadOf(over(parent, child));
    assert.equal(result.ok, false, `expected a refusal: ${why} ${JSON.stringify([parent, child])}`);
    if (result.ok) return;
    assert.equal(
      result.issues.some((i) => i.code === "field-schema-redeclared"),
      true,
      JSON.stringify(result.issues),
    );
  };

  it("an enum's values may shrink to a subset, never grow", () => {
    const shaped = effective(
      { kind: "enum", values: ["verilog", "systemverilog", "vhdl"] },
      { kind: "enum", values: ["verilog", "systemverilog"] },
    );
    assert.deepEqual(shaped?.shape, { kind: "enum", values: ["verilog", "systemverilog"] });
    assert.equal(shaped?.contributedBy, "strict");
    refused({ kind: "enum", values: ["verilog"] }, { kind: "enum", values: ["verilog", "vhdl"] });
  });

  it("a list's min_items may rise and its max_items may fall", () => {
    const item = { kind: "string" };
    assert.deepEqual(
      effective({ kind: "list", item, min_items: 1 }, { kind: "list", item, min_items: 2 })?.shape,
      { kind: "list", item, min_items: 2 },
    );
    assert.deepEqual(
      effective({ kind: "list", item, max_items: 5 }, { kind: "list", item, max_items: 3 })?.shape,
      { kind: "list", item, max_items: 3 },
    );
    assert.deepEqual(
      effective({ kind: "list", item }, { kind: "list", item, min_items: 1, max_items: 3 })?.shape,
      { kind: "list", item, min_items: 1, max_items: 3 },
      "a bound added is a narrowing",
    );
    refused({ kind: "list", item, min_items: 2 }, { kind: "list", item, min_items: 1 });
    refused({ kind: "list", item, max_items: 3 }, { kind: "list", item, max_items: 5 });
    refused(
      { kind: "list", item, max_items: 3 },
      { kind: "list", item },
      "a bound dropped is a widening",
    );
  });

  it("a string's max_length may fall; min_length is not one of the five and stays a redeclaration", () => {
    assert.deepEqual(
      effective({ kind: "string", max_length: 80 }, { kind: "string", max_length: 40 })?.shape,
      { kind: "string", max_length: 40 },
    );
    refused({ kind: "string", max_length: 40 }, { kind: "string", max_length: 80 });
    refused({ kind: "string", min_length: 1 }, { kind: "string", min_length: 2 });
    refused({ kind: "string" }, { kind: "integer" });
  });

  it("a pattern is added as a further pattern — a conjunction, never a replacement", () => {
    const shaped = effective(
      { kind: "string", pattern: "^https://" },
      { kind: "string", pattern: "^https://github\\.com/" },
    );
    assert.deepEqual(shaped?.shape, {
      kind: "string",
      pattern: ["^https://", "^https://github\\.com/"],
    });
    assert.deepEqual(
      effective({ kind: "string" }, { kind: "string", pattern: "^https://" })?.shape,
      { kind: "string", pattern: "^https://" },
      "the first pattern on the chain is the one string",
    );
    assert.deepEqual(
      effective(
        { kind: "string", pattern: "^a", max_length: 80 },
        { kind: "string", pattern: "^a", max_length: 40 },
      )?.shape,
      { kind: "string", pattern: "^a", max_length: 40 },
      "restating the parent's pattern beside a tightening adds no second copy",
    );
    refused({ kind: "string", pattern: "^https://" }, { kind: "string" });
    refused(
      { kind: "string", pattern: "^https://" },
      { kind: "string", pattern: "^https://" },
      "an identical redeclaration is still a redeclaration",
    );
  });

  it("required rides along with a tightening, and a tightening never un-requires", () => {
    assert.deepEqual(
      effective(
        { kind: "enum", values: ["a", "b"] },
        { kind: "enum", values: ["a"], required: true },
      )?.shape,
      { kind: "enum", values: ["a"], required: true },
    );
    assert.deepEqual(
      effective(
        { kind: "enum", values: ["a", "b"], required: true },
        { kind: "enum", values: ["a"] },
      )?.shape,
      { kind: "enum", values: ["a"], required: true },
    );
  });

  it("a page value must satisfy every pattern on the chain", () => {
    const registry = loadOk(
      over({ kind: "string", pattern: "^https://" }, { kind: "string", pattern: "github\\.com" }),
    );
    const findings = (value: string) =>
      lintPage({
        path: "wiki/a.md",
        doc: parseDoc(
          `---\ntype: strict\ntitle: A\ndescription: a.\ntags: []\nf: ${value}\n---\n\n# A\n`,
        ),
        registry,
      }).filter((f) => f.ruleId === "field-shape");
    assert.equal(findings("https://github.com/x").length, 0);
    assert.equal(findings("https://example.org/x").length, 1, "the child's pattern binds");
    assert.equal(findings("http://github.com/x").length, 1, "the parent's pattern still binds");
  });

  it("the same law holds for a bundle's type over a kit's", () => {
    const kit = loadModules([
      ...STANDARD_LIBRARY,
      {
        id: "acme/chip",
        types: {
          "acme/chip/source": {
            abstract: true,
            extends: "reference",
            description: "A captured source.",
            fields: {
              locator: { kind: "string", required: true },
              language: { kind: "enum", values: ["verilog", "systemverilog", "vhdl"] },
            },
          },
        },
      },
    ]);
    assert.equal(kit.ok, true);
    if (!kit.ok) throw new Error("unreachable");
    const loaded = loadConstitution(
      documentOf({
        types: {
          source: {
            extends: "acme/chip/source",
            description: "This program's sources.",
            fields: {
              locator: { kind: "string", pattern: "^https://github\\.com/" },
              language: { kind: "enum", values: ["verilog", "systemverilog"] },
            },
          },
        },
      }),
      kit.registry,
    );
    assert.equal(loaded.ok, true, loaded.ok ? "" : JSON.stringify(loaded.issues));
    if (!loaded.ok) return;
    const source = loaded.registry.types.get("source");
    assert.deepEqual(source?.fields.get("locator")?.shape, {
      kind: "string",
      pattern: "^https://github\\.com/",
      required: true,
    });
    assert.deepEqual(source?.fields.get("language")?.shape, {
      kind: "enum",
      values: ["verilog", "systemverilog"],
    });
  });
});
