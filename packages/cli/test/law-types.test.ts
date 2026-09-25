// v2 contracts §2, §3, §3.2, §3.3: the gardening constitution and its library
// under os.tmpdir(), loaded from the working tree: qualified names, the
// linearisation, roles, sections and rules under inheritance, vocabulary
// contribution, the skeleton, and every load-time code the type documents
// raise.
import { afterAll, describe, expect, it } from "bun:test";
import { loadTypeLaw, skeletonOf, type TypeLaw, type TypeLawResult } from "@wikiwright/core";
import { workingTreeLawSnapshot } from "../src/lawfiles.ts";
import { gardenTree, removeTree, type Tree, writeTree } from "./fixtures/garden-law.ts";

const made: string[] = [];
afterAll(() => {
  for (const dir of made) removeTree(dir);
});

async function load(overrides: Tree = {}, drop: string[] = []): Promise<TypeLawResult> {
  const files = { ...gardenTree(), ...overrides };
  for (const path of drop) delete files[path];
  const dir = writeTree(files);
  made.push(dir);
  return loadTypeLaw(await workingTreeLawSnapshot(dir));
}

async function law(overrides: Tree = {}): Promise<TypeLaw> {
  const result = await load(overrides);
  if (!result.ok) throw new Error(JSON.stringify(result.issues, null, 2));
  return result.law;
}

function codes(result: TypeLawResult): string[] {
  return result.ok ? [] : result.issues.map((i) => i.code);
}

/** One file of the fixture with a text substitution, which must apply. */
function edit(path: string, from: string, to: string): Tree {
  const text = gardenTree()[path];
  if (text === undefined || !text.includes(from)) throw new Error(`${path} has no "${from}"`);
  return { [path]: text.replace(from, to) };
}

const PLANTING = "constitution/types/planting.yaml";
const LIB_PLANTING = "libraries/kit-garden/types/planting.yaml";

describe("the gardening constitution", () => {
  it("loads, with library names qualified and the bundle's bare", async () => {
    const loaded = await law();
    expect([...loaded.types.keys()].sort()).toEqual([
      "garden/bed",
      "garden/planting",
      "guide",
      "planting",
    ]);
    expect([...loaded.fragments.keys()]).toEqual(["garden/planted"]);
    expect([...loaded.vocabularies.keys()].sort()).toEqual([
      "garden/beds",
      "garden/observations",
      "garden/relations",
      "tags",
    ]);
  });

  it("inherits the role and reports the ancestry from the parent up", async () => {
    const planting = (await law()).types.get("planting");
    expect(planting?.role).toBe("procedure");
    expect(planting?.ancestry).toEqual(["garden/planting"]);
    expect(planting?.extends).toBe("garden/planting");
    expect(planting?.abstract).toBe(false);
    expect((await law()).types.get("garden/planting")?.abstract).toBe(true);
  });

  it("linearises the shape: the type's fragments, the ancestors root down, the type's own", async () => {
    const planting = (await law()).types.get("planting");
    expect(planting?.parts.map((p) => p.origin)).toEqual([
      "fragment:garden/planted",
      "type:planting",
    ]);
    expect(planting?.properties).toEqual([
      "type",
      "title",
      "description",
      "tags",
      "aliases",
      "status",
      "supersedes",
      "superseded_by",
      "exceptions",
      "created",
      "updated",
      "bed",
      "sown",
      "source",
      "origin",
    ]);
  });

  it("inherits sections and rules, and configure extends an inherited rule's config", async () => {
    const planting = (await law()).types.get("planting");
    expect(planting?.sections?.list.map((s) => [s.heading, s.grammar, s.vocabulary])).toEqual([
      ["Observations", "claims", "garden/observations"],
      ["History", "entries", undefined],
      ["Relations", "relations", "garden/relations"],
    ]);
    expect(planting?.rules.map((r) => [r.id, r.declaredBy])).toEqual([
      ["known-bed", "garden/planted"],
      ["history-dated", "garden/planting"],
      ["source-host-allowed", "planting"],
    ]);
    expect(planting?.rules[0]?.config).toEqual({ beds: ["north", "south", "herb", "east"] });
    // The library's own type keeps the config it declares.
    expect((await law()).types.get("garden/planting")?.rules[0]?.config).toEqual({
      beds: ["north", "south", "herb"],
    });
    expect(planting?.meta).toEqual(["updated"]);
  });

  it("merges a heading by exact text: min the maximum, max the minimum, a require row added", async () => {
    const planting = (
      await law(
        edit(
          PLANTING,
          "meta: [updated]",
          `meta: [updated]
sections:
  list:
    - { heading: History, min: 1, max: 40 }
    - { heading: Relations, require: [{ labels: [grows-in], min: 1 }] }
    - { heading: Harvest }`,
        ),
      )
    ).types.get("planting");
    const history = planting?.sections?.list.find((s) => s.heading === "History");
    expect([history?.min, history?.max, history?.grammar]).toEqual([1, 40, "entries"]);
    expect(history?.declaredBy).toEqual(["garden/planting", "planting"]);
    const relations = planting?.sections?.list.find((s) => s.heading === "Relations");
    expect(relations?.params.require).toEqual([{ labels: ["grows-in"], min: 1 }]);
    expect(planting?.sections?.list.map((s) => s.heading)).toEqual([
      "Observations",
      "History",
      "Relations",
      "Harvest",
    ]);
  });

  it("adds a contribution's entries to the library vocabulary", async () => {
    const relations = (await law()).vocabularies.get("garden/relations");
    expect([...(relations?.entries.keys() ?? [])]).toEqual(["grows-in", "companion-of", "shades"]);
    expect(relations?.entries.get("shades")?.contributedBy).toBe("relations");
    expect(relations?.mode).toBe("registered");
  });

  it("allows a bundle type named as the library type it extends", async () => {
    const loaded = await law();
    expect(loaded.types.get("planting")?.where).toBe("bundle:constitution/types/planting.yaml");
    expect(loaded.types.get("garden/planting")?.where).toBe("garden:types/planting.yaml");
  });

  it("derives the skeleton", async () => {
    expect(skeletonOf((await law()).types.get("planting") as never)).toBe(
      [
        "---",
        "type: planting",
        'title: ""',
        'description: ""',
        "tags: []",
        "aliases: []",
        "status: null",
        "supersedes: []",
        'superseded_by: ""',
        "exceptions: []",
        'created: ""',
        'updated: ""',
        'bed: ""',
        'sown: ""',
        'source: ""',
        'origin: ""',
        "---",
        "",
        "# <title>",
        "",
        "## Observations",
        "",
        "## History",
        "",
        "## Relations",
        "",
        "",
      ].join("\n"),
    );
  });
});

describe("load-time codes of the type documents", () => {
  it.each([
    [
      "an unknown top-level key",
      edit(PLANTING, "meta: [updated]", "meta: [updated]\ntemplate: x"),
      "type-key-unknown",
    ],
    [
      "an unknown rule key",
      edit(PLANTING, "severity: warning", "severity: warning\n    route: queue"),
      "type-key-unknown",
    ],
    [
      "an unknown key in a fragment",
      edit("libraries/kit-garden/fragments/planted.yaml", "rules:", "checks: []\nrules:"),
      "fragment-key-unknown",
    ],
    [
      "an unknown key in a vocabulary",
      edit("constitution/vocabularies/tags.yaml", "mode:", "form: x\nmode:"),
      "vocabulary-key-unknown",
    ],
    [
      "a differing role below the root",
      edit(PLANTING, "extends:", "role: concept\nextends:"),
      "role-conflict",
    ],
    [
      "a root with no role",
      edit("constitution/types/guide.yaml", "role: hub\n", ""),
      "type-invalid",
    ],
    [
      "a type name that is not the file stem",
      edit("constitution/types/guide.yaml", "type: guide", "type: guides"),
      "type-invalid",
    ],
    [
      "a missing description",
      edit(
        "constitution/types/guide.yaml",
        "description: A route through the garden's pages.\n",
        "",
      ),
      "type-invalid",
    ],
    [
      "an unknown parent",
      edit(PLANTING, "extends: garden/planting", "extends: garden/sowing"),
      "type-invalid",
    ],
    [
      "a parent that is a fragment",
      edit(PLANTING, "extends: garden/planting", "extends: garden/planted"),
      "type-invalid",
    ],
    [
      "an extends cycle",
      {
        ...edit(LIB_PLANTING, "abstract: true", "abstract: true\nextends: bed"),
        ...edit("libraries/kit-garden/types/bed.yaml", "role: reference", "extends: planting"),
      },
      "type-invalid",
    ],
    [
      "an unknown fragment",
      edit(LIB_PLANTING, "fragments: [planted]", "fragments: [planted, watered]"),
      "type-invalid",
    ],
    [
      "a document that is not YAML",
      { "constitution/types/guide.yaml": "type: guide\n  role: [hub\n" },
      "type-invalid",
    ],
    [
      "a __proto__ key in a rule's config",
      edit(PLANTING, "  known-bed: { beds:", "  known-bed: { __proto__: { beds: [x] }, beds:"),
      "type-invalid",
    ],
    [
      "configure on a rule the type does not inherit",
      edit(PLANTING, "configure:", "configure:\n  frost-dates: { months: [5] }"),
      "type-invalid",
    ],
  ])("refuses %s", async (_label, overrides, code) => {
    expect(codes(await load(overrides))).toContain(code);
  });

  it("refuses a name declared as a type and as a fragment (constitution-collision)", async () => {
    expect(
      codes(
        await load({
          "libraries/kit-garden/fragments/bed.yaml": "fragment: bed\ndescription: a clash\n",
        }),
      ),
    ).toEqual(["constitution-collision"]);
  });

  it("refuses a contributed entry the library vocabulary already holds (vocabulary-collision)", async () => {
    const result = await load(
      edit("constitution/vocabularies/relations.yaml", "shades:", "grows-in:"),
    );
    expect(codes(result)).toEqual(["vocabulary-collision"]);
    // …and one the library retired.
    expect(
      codes(await load(edit("constitution/vocabularies/relations.yaml", "shades:", "planted-in:"))),
    ).toEqual(["vocabulary-collision"]);
  });

  it("refuses a contribution to a vocabulary that is not a library's, and one that sets a mode", async () => {
    expect(
      codes(
        await load(
          edit("constitution/vocabularies/relations.yaml", "garden/relations", "garden/soils"),
        ),
      ),
    ).toEqual(["vocabulary-invalid"]);
    expect(
      codes(
        await load(
          edit("constitution/vocabularies/relations.yaml", "entries:", "mode: census\nentries:"),
        ),
      ),
    ).toEqual(["vocabulary-invalid"]);
  });

  it("refuses a differing grammar, vocabulary, depth or parameter as sections-conflict", async () => {
    const child = (entry: string) =>
      edit(PLANTING, "meta: [updated]", `meta: [updated]\nsections:\n  list:\n    - ${entry}`);
    for (const overrides of [
      child("{ heading: History, grammar: claims }"),
      child("{ heading: Relations, vocabulary: garden/beds }"),
      child("{ heading: History, lifecycle: append-only }\n  depth: 3"),
      child("{ heading: Observations, provenance: required }"),
      child("{ heading: History, min: 3, max: 2 }"),
    ]) {
      expect(codes(await load(overrides))).toEqual(["sections-conflict"]);
    }
  });

  it("refuses a parameter the section's grammar does not own as sections-grammar-params", async () => {
    expect(
      codes(
        await load(
          edit(LIB_PLANTING, "lifecycle: append-only", "lifecycle: append-only, require: []"),
        ),
      ),
    ).toEqual(["sections-grammar-params"]);
    expect(
      codes(
        await load(
          edit(
            "constitution/types/guide.yaml",
            "min: 1, max: 1",
            "min: 1, max: 1, provenance: required",
          ),
        ),
      ),
    ).toEqual(["sections-grammar-params"]);
  });

  it("refuses a rule id declared twice across the bundle and a library (rule-collision)", async () => {
    expect(codes(await load(edit(PLANTING, "id: source-host-allowed", "id: known-bed")))).toEqual([
      "rule-collision",
    ]);
  });

  it("refuses a section rule on a heading the effective sections do not declare", async () => {
    const result = await load(
      edit(
        PLANTING,
        "  - id: source-host-allowed\n",
        "  - id: source-host-allowed\n    section: Harvest\n",
      ),
    );
    expect(codes(result)).toEqual(["rule-section-unknown"]);
  });

  it("refuses a configure that drops a member of an inherited list (configure-narrows)", async () => {
    expect(
      codes(
        await load(
          edit(
            PLANTING,
            "known-bed: { beds: [north, south, herb, east] }",
            "known-bed: { beds: [north, east] }",
          ),
        ),
      ),
    ).toEqual(["configure-narrows"]);
  });

  it("refuses a meta key the effective shape does not declare (meta-unknown)", async () => {
    expect(
      codes(await load(edit(PLANTING, "meta: [updated]", "meta: [updated, harvested]"))),
    ).toEqual(["meta-unknown"]);
  });

  it("names the file and the pointer of an issue", async () => {
    const result = await load(edit(PLANTING, "meta: [updated]", "meta: [updated, harvested]"));
    expect(result.ok ? undefined : result.issues[0]).toMatchObject({
      where: "bundle:constitution/types/planting.yaml",
      details: { pointer: "/meta/1", key: "harvested" },
    });
  });
});
