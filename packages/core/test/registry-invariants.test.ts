// docs/constitution.md §Fragments (a type's fragments are a SET)
// docs/constitution.md §Sections (a fragment tightens a field; a child tightens a
// fragment's section) · docs/extending.md §A grammar (a kit's parameter
// rides `params` under the kit's own law) · docs/concepts.md (one
// `where` spelling) · docs/cli.md §init · docs/architecture.md §The invariants
// meta-tests (every field of the effective model has a reader)
//  (determinism).
//
// The invariants designs/design-registry.md asked of the v3-native loader,
// each as one case. They are not about any one refusal: they are the
// properties a rewrite of the registry can silently lose while every
// per-code test stays green.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadModules, type ModuleManifest } from "../src/modules/index.ts";
import { loadConstitution } from "../src/registry/index.ts";
import type { EffectiveType, FlattenedRegistry } from "../src/registry/model.ts";
import { STANDARD_LIBRARY } from "../src/stdlib/index.ts";
import { constitutionOf, type Doc, documentOf, loadOf } from "./helpers/constitution.ts";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const CORE_SRC = fileURLToPath(new URL("../src/", import.meta.url));
const CLI_SRC = fileURLToPath(new URL("../../cli/src/", import.meta.url));

/** A registry as one deterministic string: Maps become sorted entry lists. */
function serialize(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v instanceof Map) return [...v.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    if (v instanceof Set) return [...v].sort();
    if (typeof v === "function") return undefined;
    return v;
  });
}

const typesOf = (registry: FlattenedRegistry): string =>
  serialize({
    types: registry.types,
    vocabularies: registry.vocabularies,
    fragments: registry.fragments,
  });

// ---------------------------------------------------------------------------

describe("1. fragment order independence (docs/constitution.md §Fragments)", () => {
  const fragments = {
    identified: {
      description: "An id.",
      fields: { record_id: { kind: "string", required: true } },
      sections: { depth: 2, list: [{ heading: "Identity", min: 1 }] },
    },
    dated: {
      description: "A date.",
      fields: { seen: { kind: "date" } },
      sections: { depth: 2, list: [{ heading: "Timeline", grammar: "entries", date: "required" }] },
    },
  };
  const withOrder = (order: string[]): Doc => ({
    fragments,
    types: { record: { extends: "reference", description: "R.", fragments: order } },
  });

  it("[A, B] and [B, A] yield the same registry — fields, sections, checks, attribution", () => {
    const ab = constitutionOf(withOrder(["identified", "dated"]));
    const ba = constitutionOf(withOrder(["dated", "identified"]));
    // Everything the layer computes is order-free; only the type's own paste
    // line — `fragments`, what the author wrote — keeps the author's order.
    const layered = (r: FlattenedRegistry) =>
      serialize({
        types: new Map([...r.types].map(([n, t]) => [n, { ...t, fragments: undefined }])),
        vocabularies: r.vocabularies,
        fragments: r.fragments,
      });
    assert.equal(layered(ab), layered(ba));
    const record = ab.types.get("record");
    assert.deepEqual(
      record?.sections?.list.map((e) => `${e.heading}@${e.contributedBy}`),
      ["Timeline@fragment:dated", "Identity@fragment:identified"],
      "the layer lists the set by name, not by paste order",
    );
    assert.deepEqual(
      record?.fragments.map((f) => f.value),
      ["identified", "dated"],
      "what the type PASTED keeps the author's order — it is the type's own line",
    );
  });
});

describe("2. a fragment tightens an inherited field — the 8086 `traced` case", () => {
  it("the effective shape carries `required` and is attributed to the fragment", () => {
    const registry = constitutionOf({
      vocabularies: { relations: { mode: "registered", entries: { "traces-to": {} } } },
      fragments: {
        traced: {
          description: "What every program artifact carries.",
          fields: {
            sources: {
              kind: "page-ref-list",
              target_root: "raw",
              target_type: "source",
              required: true,
            },
          },
          sections: {
            depth: 2,
            list: [
              {
                heading: "Relations",
                min: 1,
                max: 1,
                grammar: "relations",
                vocabulary: "relations",
                require: [{ labels: ["traces-to"], min: 1 }],
                severity: "error",
              },
            ],
          },
        },
      },
      types: {
        source: { extends: "reference", description: "A capture." },
        requirement: {
          extends: "reference",
          description: "One requirement.",
          fragments: ["traced"],
        },
      },
    });
    const sources = registry.types.get("requirement")?.fields.get("sources");
    assert.deepEqual(sources, {
      shape: { kind: "page-ref-list", target_root: "raw", target_type: "source", required: true },
      contributedBy: "fragment:traced",
    });
  });
});

describe("3. a child tightens a fragment's section — the 8086 `design-note` case", () => {
  it("adds a keyed-bounds row, keeps the fragment's, and the entry is the type's own line", () => {
    const registry = constitutionOf({
      vocabularies: {
        relations: { mode: "registered", entries: { "traces-to": {}, covers: {} } },
      },
      fragments: {
        traced: {
          description: "Traced.",
          sections: {
            depth: 2,
            list: [
              {
                heading: "Relations",
                min: 1,
                max: 1,
                grammar: "relations",
                vocabulary: "relations",
                require: [{ labels: ["traces-to"], min: 1 }],
                severity: "error",
              },
            ],
          },
        },
      },
      types: {
        "design-note": {
          extends: "concept",
          description: "A mechanism.",
          fragments: ["traced"],
          sections: {
            depth: 2,
            additional: true,
            list: [
              { heading: "Summary", min: 1, max: 1 },
              { heading: "Mechanism", min: 1, max: 1 },
              {
                heading: "Relations",
                require: [
                  { labels: ["traces-to"], min: 1 },
                  { labels: ["covers"], min: 1 },
                ],
                severity: "error",
              },
              { heading: "Open questions", max: 1 },
            ],
          },
        },
      },
    });
    const relations = registry.types
      .get("design-note")
      ?.sections?.list.find((e) => e.heading === "Relations");
    assert.deepEqual(relations?.params["require"], [
      { labels: ["traces-to"], min: 1 },
      { labels: ["covers"], min: 1 },
    ]);
    assert.equal(relations?.min, 1);
    assert.equal(relations?.max, 1);
    assert.equal(relations?.severity, "error");
    assert.equal(relations?.contributedBy, "design-note");
    assert.equal(relations?.registryPath, "/types/design-note/sections/list/2");
  });
});

describe("4. a kit parameter rides `params` under the kit's own law (docs/extending.md §A grammar)", () => {
  const FIXTURE = join(REPO, "fixtures", "conformance", "module-fixture", "index.js");
  const SIZES = "@wikiwright-fixture/probe/sizes";
  const GRAMMAR = "@wikiwright-fixture/probe/measures";

  async function probe(): Promise<ModuleManifest> {
    const imported = (await import(pathToFileURL(FIXTURE).href)) as { default: ModuleManifest };
    return imported.default;
  }
  const measuring = (parentAllow: string[], childAllow: string[]): Doc => ({
    vocabularies: { [SIZES]: { mode: "registered", entries: { small: { limit: 1 } } } },
    types: {
      base: {
        extends: "concept",
        description: "B.",
        sections: {
          depth: 2,
          list: [{ heading: "Measures", grammar: GRAMMAR, vocabulary: SIZES, allow: parentAllow }],
        },
      },
      child: {
        extends: "base",
        description: "C.",
        sections: { depth: 2, list: [{ heading: "Measures", allow: childAllow }] },
      },
    },
  });

  it("`allow` narrows on a child and refuses widening, through the same path as a stdlib parameter", async () => {
    const loaded = loadModules([...STANDARD_LIBRARY, await probe()]);
    assert.equal(loaded.ok, true, loaded.ok ? "" : JSON.stringify(loaded.conflicts));
    if (!loaded.ok) throw new Error("unreachable");
    const narrowed = loadConstitution(documentOf(measuring(["a", "b"], ["a"])), loaded.registry);
    assert.equal(narrowed.ok, true, narrowed.ok ? "" : JSON.stringify(narrowed.issues));
    if (!narrowed.ok) throw new Error("unreachable");
    const entry = narrowed.registry.types.get("child")?.sections?.list[0];
    assert.deepEqual(entry?.params, { allow: ["a"] });
    assert.equal(entry?.contributedBy, "child");
    const widened = loadConstitution(documentOf(measuring(["a"], ["a", "b"])), loaded.registry);
    assert.equal(widened.ok, false);
    if (widened.ok) throw new Error("unreachable");
    assert.deepEqual(
      widened.issues.map((i) => `${i.code}@${i.where}`),
      ["sections-grammar-relaxed@type:child"],
    );
  });
});

describe("5. one `where` spelling, over every code a document can make the load emit", () => {
  /** `constitution`, or an anchor and a name (which may carry `/`), then an optional path. */
  const SPELLING = /^(constitution(\/\S+)?|(type|fragment|vocabulary):\S+)$/u;
  const DOTTED = /^(constitution|types|fragments|vocabularies|type-registry)\./u;

  const TAGS = { mode: "registered", entries: { hubs: {} } };
  const person = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    extends: "concept",
    description: "One human being.",
    ...extra,
  });
  const facts = (extra: Record<string, unknown>) => ({
    depth: 2,
    list: [{ heading: "Facts", grammar: "claims", vocabulary: "categories", ...extra }],
  });
  const CATEGORIES = { mode: "registered", entries: { role: { class: "supersede" } } };

  /** One document per family; together they reach every code a document can trigger. */
  const TABLE: Record<string, Doc | Record<string, unknown>> = {
    "schema-invalid": { vocabularies: { tags: TAGS }, types: { person: { description: 1 } } },
    "constitution-unknown-key": {
      vocabularies: { tags: TAGS },
      types: { person: person({ rules: [] }) },
    },
    "vocabulary-missing": { vocabularies: {}, types: {} },
    "vocabulary-mode": { vocabularies: { tags: { mode: "census" } }, types: {} },
    "vocabulary-unknown": { vocabularies: { tags: TAGS, colours: { mode: "census" } }, types: {} },
    "vocabulary-entry-key": {
      vocabularies: {
        tags: TAGS,
        relations: { mode: "registered", entries: { x: { class: "supersede" } } },
      },
      types: {},
    },
    "vocabulary-entry-invalid": {
      vocabularies: {
        tags: TAGS,
        categories: { mode: "registered", entries: { x: { class: "nope" } } },
      },
      types: {},
    },
    "vocabulary-alias-collision": {
      vocabularies: { tags: { mode: "registered", entries: { a: { aliases: ["b"] }, b: {} } } },
      types: {},
    },
    "unknown-replaced-by": {
      vocabularies: {
        tags: { mode: "registered", entries: { a: { status: "retired", replaced_by: ["zz"] } } },
      },
      types: {},
    },
    "vocabulary-type-ref-unknown": {
      vocabularies: {
        tags: TAGS,
        relations: { mode: "registered", entries: { r: { range: ["nowhere"] } } },
      },
      types: {},
    },
    "vocabulary-tag-ref-unknown": {
      vocabularies: {
        tags: TAGS,
        categories: {
          mode: "registered",
          entries: { c: { class: "supersede", owned_by: { not_on: { tags: ["zz"] } } } },
        },
      },
      types: {},
    },
    "unknown-extends": {
      vocabularies: { tags: TAGS },
      types: { person: person({ extends: "nope" }) },
    },
    "extends-cycle": {
      vocabularies: { tags: TAGS },
      types: { a: person({ extends: "b" }), b: person({ extends: "a" }) },
    },
    "extends-retired": {
      vocabularies: { tags: TAGS },
      types: { a: person({ status: "retired" }), b: person({ extends: "a" }) },
    },
    "archetype-name-collision": { vocabularies: { tags: TAGS }, types: { concept: person() } },
    "identity-collision": {
      vocabularies: { tags: TAGS },
      types: { Person: person(), person: person() },
    },
    "unknown-fragment": {
      vocabularies: { tags: TAGS },
      types: { person: person({ fragments: ["nope"] }) },
    },
    "fragment-collision": {
      vocabularies: { tags: TAGS },
      fragments: {
        a: { description: "a", fields: { f: { kind: "string" } } },
        b: { description: "b", fields: { f: { kind: "string" } } },
      },
      types: { person: person({ fragments: ["a", "b"] }) },
    },
    "field-shape-invalid": {
      vocabularies: { tags: TAGS },
      types: { person: person({ fields: { f: { kind: "nope" } } }) },
    },
    "field-schema-redeclared": {
      vocabularies: { tags: TAGS },
      types: {
        a: person({ fields: { f: { kind: "string" } } }),
        b: person({ extends: "a", fields: { f: { kind: "integer" } } }),
      },
    },
    "field-requires-unknown": {
      vocabularies: { tags: TAGS },
      types: { person: person({ fields: { f: { kind: "string", requires: ["zz"] } } }) },
    },
    "field-target-type-unknown": {
      vocabularies: { tags: TAGS },
      types: { person: person({ fields: { f: { kind: "page-ref", target_type: "zz" } } }) },
    },
    "abstract-widened": {
      vocabularies: { tags: TAGS },
      types: { a: person(), b: person({ extends: "a", abstract: true }) },
    },
    "sections-vocabulary-unknown": {
      vocabularies: { tags: TAGS },
      types: { person: person({ sections: facts({ vocabulary: "zz" }) }) },
    },
    "sections-vocabulary-kind": {
      vocabularies: { tags: TAGS },
      types: { person: person({ sections: facts({ vocabulary: "tags" }) }) },
    },
    "sections-entry-unknown": {
      vocabularies: { tags: TAGS, categories: CATEGORIES },
      types: { person: person({ sections: facts({ only: ["zz"] }) }) },
    },
    "sections-grammar-params": {
      vocabularies: { tags: TAGS, categories: CATEGORIES },
      types: { person: person({ sections: facts({ nope: 1 }) }) },
    },
    "sections-params-exclusive": {
      vocabularies: { tags: TAGS, categories: CATEGORIES },
      types: {
        person: person({
          sections: {
            depth: 2,
            list: [
              { heading: "Facts", grammar: "claims", vocabulary: "categories", history: "History" },
              {
                heading: "History",
                grammar: "claims",
                vocabulary: "categories",
                role: "history",
                history: "Facts",
              },
            ],
          },
        }),
      },
    },
    "constitution-unknown-extension": {
      vocabularies: { tags: TAGS },
      types: {
        person: person({ sections: { depth: 2, list: [{ heading: "X", grammar: "zz" }] } }),
      },
    },
    "sections-grammar-relaxed": {
      vocabularies: { tags: TAGS, categories: CATEGORIES },
      types: {
        a: person({ sections: facts({ severity: "error" }) }),
        b: person({
          extends: "a",
          sections: { depth: 2, list: [{ heading: "Facts", severity: "warning" }] },
        }),
      },
    },
    "sections-flag-conflict": {
      vocabularies: { tags: TAGS },
      types: {
        a: person({ sections: { depth: 2, list: [{ heading: "X" }] } }),
        b: person({ extends: "a", sections: { depth: 3, list: [{ heading: "Y" }] } }),
      },
    },
    "rule-conflict-heading": {
      vocabularies: { tags: TAGS },
      types: {
        person: person({
          sections: {
            depth: 2,
            list: [
              { heading: "Notes", min: 1 },
              { heading: "notes", max: 0 },
            ],
          },
        }),
      },
    },
    "body-relaxed": {
      vocabularies: { tags: TAGS },
      types: {
        a: person({ body: { lifecycle: "append-only", severity: "error" } }),
        b: person({ extends: "a", body: { lifecycle: "append-only", severity: "warning" } }),
      },
    },
    "instances-relaxed": {
      vocabularies: { tags: TAGS },
      types: {
        a: person({ instances: { max: 1 } }),
        b: person({ extends: "a", instances: { max: 2 } }),
      },
    },
    "pin-origin-unknown-field": {
      vocabularies: { tags: TAGS },
      types: { person: person({ fields: { pin: { kind: "pin", origin: "zz" } } }) },
    },
  };

  it("every issue of every family is anchored at constitution, a type, a fragment or a vocabulary — never a dotted path", () => {
    const seen = new Set<string>();
    for (const [family, doc] of Object.entries(TABLE)) {
      const json =
        "schema" in doc ? doc : { schema: "wikiwright/constitution", schema_version: 3, ...doc };
      const loaded = loadConstitution(
        json,
        loadOf({}).ok ? constitutionOf({}).modules : (undefined as never),
      );
      assert.equal(loaded.ok, false, `${family}: the document must be refused`);
      if (loaded.ok) continue;
      for (const issue of loaded.issues) {
        seen.add(issue.code);
        assert.match(issue.where, SPELLING, `${family}/${issue.code}: ${issue.where}`);
        assert.doesNotMatch(issue.where, DOTTED, `${family}/${issue.code}: ${issue.where}`);
      }
      assert.equal(
        loaded.issues.some((i) => i.code === family),
        true,
        `${family}: reached — got ${loaded.issues.map((i) => i.code).join(", ")}`,
      );
    }
    // The families a document alone cannot reach under the standard library
    // are the module-load conflicts and the ones a registered check or a
    // module's contribution makes (constitution-module-collision,
    // check-attachment-invalid, check-config-invalid, check-relaxed); their
    // own suites hold the spelling.
    assert.equal(seen.size >= Object.keys(TABLE).length, true);
  });
});

describe("6. every shipped constitution loads clean (docs/cli.md §init)", () => {
  // devwiki and the `code` starter are bundles over the code kit
  // (docs/extending.md §The code kit); the rest load under the standard
  // library alone.
  const OVER_KIT = [join(REPO, "devwiki"), join(REPO, "packages", "cli", "constitutions", "code")];
  const STDLIB = [
    join(REPO, "fixtures", "memory-synth"),
    join(REPO, "fixtures", "minimal-vault"),
    ...readdirSync(join(REPO, "packages", "cli", "constitutions"))
      .filter((s) => s !== "code")
      .map((s) => join(REPO, "packages", "cli", "constitutions", s)),
  ];
  const stdlib = () => {
    const loaded = loadModules(STANDARD_LIBRARY);
    if (!loaded.ok) throw new Error("the standard library loads");
    return loaded.registry;
  };
  const withKit = async () => {
    const kit = join(REPO, "packages", "kit-code", "index.js");
    const imported = (await import(pathToFileURL(kit).href)) as { default: ModuleManifest };
    const loaded = loadModules([...STANDARD_LIBRARY, imported.default]);
    if (!loaded.ok) throw new Error("the code kit composes with the standard library");
    return loaded.registry;
  };
  const read = (vault: string) =>
    JSON.parse(readFileSync(join(vault, "config", "constitution.json"), "utf8")) as unknown;

  for (const vault of STDLIB) {
    it(`${vault.slice(REPO.length)} loads under the standard library`, () => {
      assert.equal(existsSync(join(vault, "config", "constitution.json")), true);
      const loaded = loadConstitution(read(vault), stdlib());
      assert.equal(loaded.ok, true, loaded.ok ? "" : JSON.stringify(loaded.issues));
    });
  }

  for (const vault of OVER_KIT) {
    it(`${vault.slice(REPO.length)} loads under the standard library plus the code kit`, async () => {
      assert.equal(existsSync(join(vault, "config", "constitution.json")), true);
      const loaded = loadConstitution(read(vault), await withKit());
      assert.equal(loaded.ok, true, loaded.ok ? "" : JSON.stringify(loaded.issues));
    });
  }

  for (const bundle of ["bundle-a", "bundle-b"]) {
    it(`fixtures/conformance/${bundle} loads under the fixture module`, async () => {
      const fixture = join(REPO, "fixtures", "conformance", "module-fixture", "index.js");
      const imported = (await import(pathToFileURL(fixture).href)) as { default: ModuleManifest };
      const modules = loadModules([...STANDARD_LIBRARY, imported.default]);
      assert.equal(modules.ok, true);
      if (!modules.ok) throw new Error("unreachable");
      const loaded = loadConstitution(
        read(join(REPO, "fixtures", "conformance", bundle)),
        modules.registry,
      );
      assert.equal(loaded.ok, true, loaded.ok ? "" : JSON.stringify(loaded.issues));
    });
  }
  // A bundle outside this repository is not judged here; the two conformance
  // bundles above are the ones the suite holds.
});

describe("7. effective-model closure: every field of the effective model has a reader (docs/architecture.md §The invariants)", () => {
  const MODEL = join(CORE_SRC, "registry", "model.ts");
  const INTERFACES = [
    "EffectiveType",
    "EffectiveSectionEntry",
    "EffectiveSections",
    "EffectiveBody",
    "EffectiveInstances",
    "EffectiveCheck",
    "EffectiveVocabulary",
    "VocabularyEntry",
    "EffectiveFragment",
    "FlattenedRegistry",
    "Attributed",
  ];

  function fieldsOf(name: string): string[] {
    const text = readFileSync(MODEL, "utf8");
    const at = text.search(new RegExp(`^export interface ${name}(<[^>]*>)? \\{$`, "mu"));
    assert.notEqual(at, -1, `model.ts declares ${name}`);
    const end = text.indexOf("\n}", at);
    const block = text.slice(at, end);
    return [...block.matchAll(/^ {2}(?:readonly )?([a-zA-Z_]+)\??:/gmu)].map((m) => m[1] ?? "");
  }

  function readers(): string {
    const out: string[] = [];
    const walk = (dir: string, skip: (p: string) => boolean): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true, encoding: "utf8" })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!skip(path)) walk(path, skip);
          continue;
        }
        if (entry.name.endsWith(".ts")) out.push(readFileSync(path, "utf8"));
      }
    };
    walk(CORE_SRC, (p) => p === join(CORE_SRC, "registry"));
    walk(CLI_SRC, () => false);
    return out.join("\n");
  }

  it("is read by name outside registry/ — the test that would have caught `rules: []`", () => {
    const text = readers();
    const unread: string[] = [];
    for (const name of INTERFACES) {
      for (const field of fieldsOf(name)) {
        const byDot = new RegExp(`\\.${field}\\b`, "u");
        const byKey = new RegExp(`\\["${field}"\\]`, "u");
        const byDestructure = new RegExp(`[{,]\\s*${field}\\s*[,}:]`, "u");
        if (!byDot.test(text) && !byKey.test(text) && !byDestructure.test(text)) {
          unread.push(`${name}.${field}`);
        }
      }
    }
    assert.deepEqual(unread, [], "a field nothing reads is a lie the model tells its author");
  });
});

describe("9. determinism: two loads of one document are one registry", () => {
  it("devwiki, loaded twice, serializes identically", async () => {
    const json = JSON.parse(
      readFileSync(join(REPO, "devwiki", "config", "constitution.json"), "utf8"),
    ) as unknown;
    const kit = (await import(
      pathToFileURL(join(REPO, "packages", "kit-code", "index.js")).href
    )) as { default: ModuleManifest };
    const modules = loadModules([...STANDARD_LIBRARY, kit.default]);
    if (!modules.ok) throw new Error("unreachable");
    const a = loadConstitution(json, modules.registry);
    const b = loadConstitution(json, modules.registry);
    assert.equal(a.ok && b.ok, true);
    if (!a.ok || !b.ok) return;
    assert.equal(typesOf(a.registry), typesOf(b.registry));
    const shown = (t: EffectiveType) => serialize({ ...t, fields: t.fields });
    for (const [name, type] of a.registry.types) {
      assert.equal(shown(type), shown(b.registry.types.get(name) as EffectiveType), name);
    }
  });
});
