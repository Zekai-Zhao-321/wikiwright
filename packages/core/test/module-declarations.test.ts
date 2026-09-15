// docs/extending.md §What a module registers (the four data declarations that let the
// kernel forget every standard-library name: `GrammarSpec.vocabulary`,
// `ParamSpec.entries`, `ParamSpec.excludes`, `VocabularySpec.typeRefs` /
// `tagRefs`) · docs/constitution.md §Vocabularies (every name a section or an entry
// points at resolves; a constitution's names go through the alias
// and retirement laws) · docs/concepts.md §Section grammar · docs/architecture.md §The invariants
//
// Before these, validate.ts named five standard-library parameters and two
// entry properties to check them, and the 8086 kit's typed relation ranges
// were checked only because the kit reused the stdlib vocabulary's spelling.
// Each case here is a kit — not the standard library — getting the check by
// declaring it, and the last block is the standard library declaring the same
// things through the same fields.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import { loadModules, type ModuleManifest } from "../src/modules/index.ts";
import { loadConstitution } from "../src/registry/index.ts";
import claims from "../src/stdlib/claims.ts";
import { STANDARD_LIBRARY } from "../src/stdlib/index.ts";
import relations from "../src/stdlib/relations.ts";
import { type Doc, documentOf } from "./helpers/constitution.ts";

const SIZES = "acme/probe/sizes";
const GRAMMAR = "acme/probe/measures";

/** A kit with one vocabulary and one grammar, both shaped by the caller. */
function kit(overrides: {
  grammar?: Record<string, unknown>;
  params?: Record<string, unknown>;
  vocabulary?: Record<string, unknown>;
}): ModuleManifest {
  return {
    id: "acme/probe",
    vocabularies: {
      [SIZES]: {
        entry: z.strictObject({
          limit: z.number().optional(),
          targets: z.array(z.string()).optional(),
          on: z.strictObject({ tags: z.array(z.string()).optional() }).optional(),
        }),
        ...(overrides.vocabulary ?? {}),
      },
    },
    grammars: {
      [GRAMMAR]: {
        kinds: ["acme/probe:measure"],
        parse: (text: string) => ({ kind: "acme/probe:measure", text }),
        params: overrides.params ?? {},
        arms: [],
        ...(overrides.grammar ?? {}),
      } as never,
    },
  };
}

function modulesOf(manifest: ModuleManifest) {
  const loaded = loadModules([...STANDARD_LIBRARY, manifest]);
  assert.equal(loaded.ok, true, loaded.ok ? "" : JSON.stringify(loaded.conflicts));
  if (!loaded.ok) throw new Error("unreachable");
  return loaded.registry;
}

function conflictsOf(manifest: ModuleManifest) {
  const loaded = loadModules([...STANDARD_LIBRARY, manifest]);
  assert.equal(loaded.ok, false, "the fixture manifest is refused");
  if (loaded.ok) throw new Error("unreachable");
  return loaded.conflicts.map((c) => `${c.kind}:${c.id}@${c.claimants.join("+")}`);
}

/** Every issue as `code@where` for a document loaded under the kit. */
function issuesOf(manifest: ModuleManifest, doc: Doc): string[] {
  const loaded = loadConstitution(documentOf(doc), modulesOf(manifest));
  return loaded.ok ? [] : loaded.issues.map((i) => `${i.code}@${i.where}`);
}

const sizes = (entries: Record<string, unknown>) => ({
  [SIZES]: { mode: "registered", entries },
});

/** One type with one section of the kit's grammar, carrying `entry`'s keys. */
const measuring = (entry: Record<string, unknown>, vocabularies: Record<string, unknown>): Doc => ({
  vocabularies,
  types: {
    subject: {
      extends: "concept",
      description: "A measured page.",
      sections: { depth: 2, list: [{ heading: "Measures", grammar: GRAMMAR, ...entry }] },
    },
  },
});

describe("a grammar declares the vocabulary its items are checked against", () => {
  it("a section binding the grammar to another vocabulary is refused at load", () => {
    const found = issuesOf(
      kit({ grammar: { vocabulary: SIZES } }),
      measuring({ vocabulary: "tags" }, sizes({})),
    );
    assert.deepEqual(found, ["sections-vocabulary-kind@type:subject"]);
  });

  it("binding it to the declared one loads, and a grammar declaring none binds whatever the section names", () => {
    assert.deepEqual(
      issuesOf(
        kit({ grammar: { vocabulary: SIZES } }),
        measuring({ vocabulary: SIZES }, sizes({})),
      ),
      [],
    );
    assert.deepEqual(issuesOf(kit({}), measuring({ vocabulary: "tags" }, sizes({}))), []);
  });

  it("a grammar naming a vocabulary no module registers is refused at module load", () => {
    const found = conflictsOf(kit({ grammar: { vocabulary: "acme/probe/no-such" } }));
    assert.deepEqual(found, [`vocabulary-unknown:acme/probe/no-such@${GRAMMAR}`]);
  });
});

describe("a parameter declares that its values name entries", () => {
  const only = {
    only: {
      introduction: "any-depth",
      value: z.array(z.string()),
      law: "subset-only",
      entries: {},
    },
  };
  const rows = {
    require: {
      introduction: "any-depth",
      value: z.array(z.strictObject({ names: z.array(z.string()), min: z.number() })),
      law: "identity",
      entries: { key: "names" },
    },
  };
  const fixed = {
    pick: {
      introduction: "any-depth",
      value: z.string(),
      law: "identity",
      entries: { vocabulary: SIZES },
    },
  };

  it("a name the bound vocabulary does not declare is refused, naming the parameter", () => {
    const found = issuesOf(
      kit({ params: only }),
      measuring({ vocabulary: SIZES, only: ["tiny", "huge"] }, sizes({ tiny: {} })),
    );
    assert.deepEqual(found, ["sections-entry-unknown@type:subject"]);
  });

  it("rows are read at the declared key, and every name of a row counts", () => {
    const found = issuesOf(
      kit({ params: rows }),
      measuring(
        { vocabulary: SIZES, require: [{ names: ["tiny", "huge"], min: 1 }] },
        sizes({ tiny: {} }),
      ),
    );
    assert.deepEqual(found, ["sections-entry-unknown@type:subject"]);
  });

  it("a fixed vocabulary is read whether or not the section bound one", () => {
    const found = issuesOf(
      kit({ params: fixed }),
      measuring({ pick: "huge" }, sizes({ tiny: {} })),
    );
    assert.deepEqual(found, ["sections-entry-unknown@type:subject"]);
    assert.deepEqual(
      issuesOf(kit({ params: fixed }), measuring({ pick: "tiny" }, sizes({ tiny: {} }))),
      [],
    );
  });

  it("a fixed vocabulary the bundle does not declare governs nothing", () => {
    assert.deepEqual(issuesOf(kit({ params: fixed }), measuring({ pick: "huge" }, {})), []);
  });

  it("an alias and a retired entry are refused through the vocabulary's own laws", () => {
    const alias = issuesOf(
      kit({ params: only }),
      measuring({ vocabulary: SIZES, only: ["small"] }, sizes({ tiny: { aliases: ["small"] } })),
    );
    assert.deepEqual(alias, ["sections-entry-alias@type:subject"]);
    const retired = issuesOf(
      kit({ params: only }),
      measuring(
        { vocabulary: SIZES, only: ["tiny"] },
        sizes({ tiny: { status: "retired", replaced_by: ["small"] }, small: {} }),
      ),
    );
    assert.deepEqual(retired, ["sections-entry-retired@type:subject"]);
  });

  it("under a census vocabulary an unknown name is not a refusal", () => {
    const found = issuesOf(
      kit({ params: only }),
      measuring({ vocabulary: SIZES, only: ["huge"] }, { [SIZES]: { mode: "census" } }),
    );
    assert.deepEqual(found, []);
  });

  it("a parameter naming a vocabulary no module registers is refused at module load", () => {
    const found = conflictsOf(
      kit({ params: { pick: { ...fixed.pick, entries: { vocabulary: "acme/probe/no-such" } } } }),
    );
    assert.deepEqual(found, [`vocabulary-unknown:acme/probe/no-such@${GRAMMAR}`]);
  });
});

describe("a parameter declares the parameters it excludes", () => {
  const params = {
    role: {
      introduction: "any-depth",
      value: z.literal("closing"),
      law: "identity",
      excludes: ["closes"],
    },
    closes: { introduction: "any-depth", value: z.string(), law: "identity" },
  };

  it("a section declaring both is refused at the entry", () => {
    const found = issuesOf(
      kit({ params }),
      measuring({ role: "closing", closes: "Other" }, sizes({})),
    );
    assert.deepEqual(found, ["sections-params-exclusive@type:subject/sections/list/0"]);
  });

  it("either alone loads", () => {
    assert.deepEqual(issuesOf(kit({ params }), measuring({ role: "closing" }, sizes({}))), []);
    assert.deepEqual(issuesOf(kit({ params }), measuring({ closes: "Other" }, sizes({}))), []);
  });

  it("an exclusion naming a parameter the grammar does not declare is refused at module load", () => {
    const found = conflictsOf(kit({ params: { role: { ...params.role, excludes: ["no-such"] } } }));
    assert.deepEqual(found, [`excludes-unknown-param:no-such@${GRAMMAR}`]);
  });
});

describe("a vocabulary declares which entry properties name types and tags", () => {
  const refs = { typeRefs: ["targets"], tagRefs: ["on.tags"] };

  it("a type-valued property naming no registered type is refused at the entry", () => {
    const found = issuesOf(
      kit({ vocabulary: refs }),
      measuring({}, sizes({ tiny: { targets: ["subject", "nowhere"] } })),
    );
    assert.deepEqual(found, [`vocabulary-type-ref-unknown@vocabulary:${SIZES}/tiny`]);
  });

  it("a tag-valued property naming no registered tag is refused at the entry", () => {
    const doc = measuring({}, sizes({ tiny: { on: { tags: ["known", "unknown"] } } }));
    doc.tags = { known: {} };
    const found = issuesOf(kit({ vocabulary: refs }), doc);
    assert.deepEqual(found, [`vocabulary-tag-ref-unknown@vocabulary:${SIZES}/tiny`]);
  });

  it("names that resolve load clean, and an archetype is a type", () => {
    const doc = measuring(
      {},
      sizes({ tiny: { targets: ["subject", "concept"], on: { tags: ["known"] } } }),
    );
    doc.tags = { known: {} };
    assert.deepEqual(issuesOf(kit({ vocabulary: refs }), doc), []);
  });

  it("without the declaration the same property is opaque to the kernel", () => {
    assert.deepEqual(
      issuesOf(kit({}), measuring({}, sizes({ tiny: { targets: ["nowhere"] } }))),
      [],
    );
  });
});

describe("the standard library declares the same things through the same fields (docs/architecture.md §The invariants)", () => {
  it("claims: its vocabulary, `only` in the bound one, `sources` in a fixed one, `role` excluding `history`", () => {
    const grammar = claims.grammars?.["claims"];
    assert.equal(grammar?.vocabulary, "categories");
    assert.deepEqual(grammar?.params["only"]?.entries, {});
    assert.deepEqual(grammar?.params["sources"]?.entries, { vocabulary: "sources" });
    assert.deepEqual(grammar?.params["role"]?.excludes, ["history"]);
    assert.deepEqual(claims.vocabularies?.["categories"]?.typeRefs, ["owned_by.not_on.types"]);
    assert.deepEqual(claims.vocabularies?.["categories"]?.tagRefs, ["owned_by.not_on.tags"]);
  });

  it("relations: its vocabulary, `require` rows keyed at `labels`, a label's `range` naming types", () => {
    const grammar = relations.grammars?.["relations"];
    assert.equal(grammar?.vocabulary, "relations");
    assert.deepEqual(grammar?.params["require"]?.entries, { key: "labels" });
    assert.deepEqual(relations.vocabularies?.["relations"]?.typeRefs, ["range"]);
  });
});

describe("every manifest key but `id` is optional, and a refused manifest names the key", () => {
  it("a declarations-only kit — types, a fragment, templates, skills, no grammar — loads", () => {
    const loaded = loadModules([
      ...STANDARD_LIBRARY,
      {
        id: "acme/decl",
        fragments: { "acme/decl/traced": { description: "A paste." } },
        types: { "acme/decl/record": { extends: "concept", description: "A record." } },
        templates: { "acme/decl/record.md": "---\ntype: x\n---\n" },
        skills: [{ heading: "Records", body: "One record per thing." }],
      },
    ]);
    assert.equal(loaded.ok, true, loaded.ok ? "" : JSON.stringify(loaded.conflicts));
    if (!loaded.ok) throw new Error("unreachable");
    assert.equal(loaded.registry.types.has("acme/decl/record"), true);
    assert.equal(loaded.registry.owners.get("type:acme/decl/record")?.module, "acme/decl");
  });

  it("a key of the wrong shape is refused by name, before anything reads it", () => {
    const loaded = loadModules([{ id: "acme/bad", grammars: 5 } as unknown as ModuleManifest]);
    assert.equal(loaded.ok, false);
    if (loaded.ok) throw new Error("unreachable");
    assert.deepEqual(loaded.conflicts, [
      { kind: "manifest-key", id: "grammars", claimants: ["acme/bad"] },
    ]);
  });

  it("a key the manifest format does not know is refused by name", () => {
    const loaded = loadModules([{ id: "acme/bad", grammar: {} } as unknown as ModuleManifest]);
    assert.equal(loaded.ok, false);
    if (loaded.ok) throw new Error("unreachable");
    assert.deepEqual(loaded.conflicts, [
      { kind: "manifest-key-unknown", id: "grammar", claimants: ["acme/bad"] },
    ]);
  });

  it("a manifest with no id is refused as such", () => {
    const loaded = loadModules([{ types: {} } as unknown as ModuleManifest]);
    assert.equal(loaded.ok, false);
    if (loaded.ok) throw new Error("unreachable");
    assert.deepEqual(loaded.conflicts, [{ kind: "manifest-key", id: "id", claimants: ["?"] }]);
  });
});

describe("a module contributes entries to a vocabulary another module registered", () => {
  /** A kit whose domain model is its relation labels, shipped into the stdlib vocabulary. */
  const labels = (
    shipped: Record<string, Record<string, unknown>>,
    id = "acme/chip",
  ): ModuleManifest => ({
    id,
    entries: { relations: shipped },
    types: {
      [`${id}/module`]: {
        extends: "reference",
        description: "An RTL module.",
        sections: {
          depth: 2,
          list: [
            {
              heading: "Relations",
              grammar: "relations",
              vocabulary: "relations",
              require: [{ labels: ["implements", "diverges-from"], min: 1 }],
            },
          ],
        },
      },
    },
  });
  const consumer = (own: Record<string, unknown> = {}): Doc => ({
    vocabularies: { relations: { mode: "registered", entries: own } },
    types: { requirement: { extends: "reference", description: "One requirement." } },
  });

  it("the kit's labels and the bundle's meet in one merged vocabulary, and the kit's own `require` resolves against it", () => {
    const kit = labels({
      implements: { description: "Realizes a requirement.", range: ["requirement"] },
      "diverges-from": { range: ["requirement"] },
    });
    const loaded = loadConstitution(documentOf(consumer({ affects: {} })), modulesOf(kit));
    assert.equal(loaded.ok, true, loaded.ok ? "" : JSON.stringify(loaded.issues));
    if (!loaded.ok) throw new Error("unreachable");
    const relations = loaded.registry.vocabularies.get("relations");
    assert.deepEqual([...(relations?.entries.values() ?? [])].map((e) => e.name).sort(), [
      "affects",
      "diverges-from",
      "implements",
    ]);
    assert.deepEqual(relations?.entries.get("implements")?.properties, { range: ["requirement"] });
    assert.equal(
      loaded.registry.modules.owners.get("entry:relations/implements")?.module,
      "acme/chip",
    );
  });

  it("a bundle that forgets a kit's label no longer breaks the kit's own type", () => {
    const kit = labels({ implements: {}, "diverges-from": {} });
    assert.deepEqual(issuesOf(kit, consumer()), []);
  });

  it("a contributed entry meets the owner's schema and its type references, at the entry", () => {
    const found = issuesOf(
      labels({ implements: { range: ["nowhere"] }, "diverges-from": {} }),
      consumer(),
    );
    assert.deepEqual(found, ["vocabulary-type-ref-unknown@vocabulary:relations/implements"]);
    const invalid = issuesOf(
      labels({ implements: { colour: "red" }, "diverges-from": {} }),
      consumer(),
    );
    assert.deepEqual(invalid, ["vocabulary-entry-key@vocabulary:relations/implements"]);
  });

  it("a bundle re-declaring a contributed name is refused naming the contributor", () => {
    const loaded = loadConstitution(
      documentOf(consumer({ implements: {} })),
      modulesOf(labels({ implements: {} })),
    );
    assert.equal(loaded.ok, false);
    if (loaded.ok) throw new Error("unreachable");
    const collision = loaded.issues.find((i) => i.code === "vocabulary-entry-collision");
    assert.equal(collision?.where, "vocabulary:relations/implements");
    assert.match(collision?.message ?? "", /acme\/chip/u);
  });

  it("two modules shipping one name is a load refusal naming both", () => {
    const loaded = loadModules([
      ...STANDARD_LIBRARY,
      labels({ implements: {} }, "acme/chip"),
      labels({ implements: {} }, "acme/board"),
    ]);
    assert.equal(loaded.ok, false);
    if (loaded.ok) throw new Error("unreachable");
    assert.deepEqual(loaded.conflicts, [
      { kind: "entry", id: "relations/implements", claimants: ["acme/chip", "acme/board"] },
    ]);
  });

  it("a contribution into a vocabulary no module registers is refused at module load", () => {
    const loaded = loadModules([
      ...STANDARD_LIBRARY,
      { id: "acme/chip", entries: { "acme/nope": { x: {} } } },
    ]);
    assert.equal(loaded.ok, false);
    if (loaded.ok) throw new Error("unreachable");
    assert.deepEqual(loaded.conflicts, [
      { kind: "vocabulary-unknown", id: "acme/nope", claimants: ["acme/chip"] },
    ]);
  });

  it("the owner's own `entries` and another module's contributions are one map", () => {
    const both = loadModules([
      ...STANDARD_LIBRARY,
      kit({ vocabulary: { entries: { tiny: { limit: 1 } } } }),
      { id: "acme/more", entries: { [SIZES]: { huge: { limit: 1000 } } } },
    ]);
    assert.equal(both.ok, true, both.ok ? "" : JSON.stringify(both.conflicts));
    if (!both.ok) throw new Error("unreachable");
    assert.deepEqual(
      [...(both.registry.entries.get(SIZES)?.entries() ?? [])].map(([n, e]) => `${n}@${e.module}`),
      ["tiny@acme/probe", "huge@acme/more"],
    );
  });
});
