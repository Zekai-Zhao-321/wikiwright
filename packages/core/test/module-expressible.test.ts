// docs/architecture.md §The invariants (the three first-party modules are
// expressed entirely through the public registration API; a module needing a
// private hook means the API is not real) · docs/extending.md §A grammar,
// docs/extending.md §An arm, docs/extending.md (`admits` is the
// section author's allow-list over the kinds a grammar can produce) · 07
//  (`canonicalize` is the module's rendering under the
// kernel's `canonical-form` arm) · docs/constitution.md §Vocabularies (`observes` is
// what a census counts).
//
// This is the acceptance test for the API's DECLARATIVE half: every arm the
// engine can emit, every parameter a section may carry, and every lifecycle
// effect the kernel refuses a combination over, checked against what the three
// standard-library manifests declare. A disagreement is the API failing to
// express something the engine does — which is the signal to redesign it, never
// to special-case the first-party module.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import { graphOf } from "../src/generate/index.ts";
import { checkGrammar, parseSections, sectionBinding } from "../src/grammar/index.ts";
import { judge } from "../src/judge/index.ts";
import { observeVocabulary } from "../src/lint/index.ts";
import {
  admittedKinds,
  armApplies,
  canonicalizeOf,
  edgesOf,
  effectOf,
  loadModules,
  type ModuleManifest,
  type ModuleRegistry,
  observedValues,
  resolveParsers,
} from "../src/modules/index.ts";
import { parseDoc } from "../src/parse/index.ts";
import { loadConstitution } from "../src/registry/index.ts";
import claims from "../src/stdlib/claims.ts";
import entries from "../src/stdlib/entries.ts";
import relations from "../src/stdlib/relations.ts";

/** These cases are about the API's DECLARATIVE half: a fixture grammar parses
 * nothing, so it declares no kind and declines every item. */
const declarative = { kinds: [] as readonly string[], parse: () => undefined };

/** A fixture parameter's shape is not what these cases are about; the value
 * schema is required, so they share the widest one. */
const anyValue = z.unknown();

const MODULES: readonly ModuleManifest[] = [claims, relations, entries];

function registry() {
  const loaded = loadModules(MODULES);
  assert.equal(loaded.ok, true, "the three first-party manifests load with no id collision");
  if (!loaded.ok) throw new Error("unreachable");
  return loaded.registry;
}

function registryOf(manifest: ModuleManifest) {
  const loaded = loadModules([manifest]);
  assert.equal(loaded.ok, true, `fixture module ${manifest.id} loads`);
  if (!loaded.ok) throw new Error("unreachable");
  return loaded.registry;
}

function constitution(section: Record<string, unknown>, childSection?: Record<string, unknown>) {
  const types: Record<string, unknown> = {
    base: {
      extends: "concept",
      description: "Base type.",
      body: { lifecycle: "append-only" },
      sections: { list: [section] },
    },
  };
  if (childSection !== undefined) {
    types["child"] = {
      extends: "base",
      description: "Child type.",
      sections: { list: [childSection] },
    };
  }
  return {
    schema: "wikiwright/constitution",
    schema_version: 3,
    vocabularies: { tags: { mode: "registered", entries: {} } },
    types,
  };
}

describe("the standard library is expressible through the public API (docs/architecture.md §The invariants)", () => {
  it("registers the three grammars, each owned by exactly one module", () => {
    const r = registry();
    assert.deepEqual([...r.grammarOwner.entries()].sort(), [
      ["claims", "claims"],
      ["entries", "entries"],
      ["relations", "relations"],
    ]);
  });

  // The loader reads the MANIFEST, not a kernel table beside it. A
  // table held equal to the manifests by an assertion would make this case a
  // tautology, so it is proved with a parameter no shipped grammar has.
  it("the loader admits exactly the parameters the manifest declares", () => {
    const modules = registryOf({
      id: "test/params",
      grammars: {
        claims: {
          ...declarative,
          params: { torque: { introduction: "any-depth", value: anyValue, law: "identity" } },
          arms: [],
        },
      },
    });
    const admitted = loadConstitution(
      constitution({ heading: "Facts", grammar: "claims", torque: "nominal" }),
      modules,
    );
    assert.equal(
      admitted.ok,
      true,
      `a manifest-declared parameter loads: ${JSON.stringify(admitted.ok ? [] : admitted.issues)}`,
    );

    // And the converse, on the same manifest: `history` is a shipped parameter
    // this module does not declare, so the loader must refuse it.
    const refused = loadConstitution(
      constitution({ heading: "Facts", grammar: "claims", history: "History" }),
      modules,
    );
    assert.equal(refused.ok, false, "a parameter the manifest does not declare is refused");
    if (refused.ok) throw new Error("unreachable");
    assert.equal(
      refused.issues.some((i) => i.code === "sections-grammar-params"),
      true,
      `refused as sections-grammar-params: ${JSON.stringify(refused.issues)}`,
    );
  });

  // docs/extending.md: the effect vocabulary has to express what
  // `claims` and `entries` already do, or the kernel's two `body.lifecycle`
  // contradiction families cannot be computed from it.
  it("the lifecycle effects reproduce the two contradiction families", () => {
    const r = registry();
    const claimsGrammar = r.grammars.get("claims");
    const entriesGrammar = r.grammars.get("entries");
    assert.notEqual(claimsGrammar, undefined);
    assert.notEqual(entriesGrammar, undefined);
    if (claimsGrammar === undefined || entriesGrammar === undefined) throw new Error("unreachable");

    // `body-lifecycle-doubled`: a page-wide append-only beside a section that
    // also forbids mutation.
    assert.equal(effectOf(entriesGrammar, { lifecycle: "append-only" }), "forbids-mutation");
    assert.equal(effectOf(entriesGrammar, { lifecycle: "free" }), "none");
    assert.equal(effectOf(entriesGrammar, { date: "required" }), "none");

    // `body-lifecycle-conflict`: a page-wide append-only beside a section whose
    // legal transition rewrites the lines it governs.
    assert.equal(effectOf(claimsGrammar, { history: "History" }), "requires-rewrite");
    assert.equal(effectOf(claimsGrammar, { provenance: "required" }), "none");
  });

  it("an arm's declaration says what turns it on", () => {
    const r = registry();
    const on = (id: string, params: Record<string, unknown>): boolean => {
      const arm = r.arms.get(id);
      assert.notEqual(arm, undefined, `"${id}" is declared`);
      return arm === undefined ? false : armApplies(arm, params);
    };
    // The transition arms are turned on by one parameter each.
    assert.equal(on("claims-transition", { history: "History" }), true);
    assert.equal(on("claims-transition", { provenance: "required" }), false);
    assert.equal(on("entry-mutated", { lifecycle: "append-only" }), true);
    assert.equal(on("entry-mutated", { lifecycle: "free" }), false);
    assert.equal(on("entry-mutated", {}), false);
    // A state arm with no `on` is turned on by the grammar itself.
    assert.equal(on("entry-date-missing", {}), true);
    assert.equal(on("unknown-category", {}), true);
    assert.equal(on("relation-range", {}), true);
  });

  it("the severity ratchet reads an arm's declared default, not its grammar name", () => {
    const modules = registryOf({
      id: "test/claims",
      grammars: {
        claims: {
          ...declarative,
          params: { history: { introduction: "any-depth", value: anyValue, law: "identity" } },
          arms: [
            {
              id: "test-transition",
              row: "declared",
              lane: "grammar-review",
              on: { param: "history" },
              needsBase: true,
            },
          ],
        },
      },
    });
    const loaded = loadConstitution(
      constitution(
        { heading: "Facts", grammar: "claims", history: "History" },
        { heading: "Facts", severity: "warning" },
      ),
      modules,
    );
    assert.equal(loaded.ok, true, JSON.stringify(loaded.ok ? [] : loaded.issues));
  });

  it("the contradiction families read declared effects, not grammar names", () => {
    const modules = registryOf({
      id: "test/effects",
      grammars: {
        claims: {
          ...declarative,
          params: {
            history: {
              introduction: "any-depth",
              value: anyValue,
              law: "identity",
              effect: { effect: "forbids-mutation" },
            },
          },
          arms: [],
        },
        entries: {
          ...declarative,
          params: {
            lifecycle: {
              introduction: "any-depth",
              value: anyValue,
              law: "identity",
              effect: { equals: "append-only", effect: "requires-rewrite" },
            },
          },
          arms: [],
        },
      },
    });
    const doubled = loadConstitution(
      constitution({ heading: "Facts", grammar: "claims", history: "History" }),
      modules,
    );
    assert.equal(doubled.ok, false);
    assert.deepEqual(doubled.ok ? [] : doubled.issues.map((issue) => issue.code), [
      "body-lifecycle-doubled",
    ]);

    const conflict = loadConstitution(
      constitution({ heading: "Timeline", grammar: "entries", lifecycle: "append-only" }),
      modules,
    );
    assert.equal(conflict.ok, false);
    assert.deepEqual(conflict.ok ? [] : conflict.issues.map((issue) => issue.code), [
      "body-lifecycle-conflict",
    ]);
  });

  // docs/extending.md §A grammar: introduction and combination are separate
  // manifest data. These mutations must change the loader's verdict; agreement
  // with a parallel switch over first-party parameter names is not enough.
  it("the loader reads a parameter's introduction policy from its manifest", () => {
    const manifest = (introduction: "any-depth" | "with-grammar") =>
      registryOf({
        id: `test/introduction-${introduction}`,
        grammars: {
          claims: {
            ...declarative,
            params: { forms: { introduction, value: anyValue, law: "subset-only" } },
            arms: [],
          },
        },
      } as unknown as ModuleManifest);
    const document = constitution(
      { heading: "Facts", grammar: "claims" },
      { heading: "Facts", forms: ["stated"] },
    );

    assert.equal(loadConstitution(document, manifest("any-depth")).ok, true);
    const restricted = loadConstitution(document, manifest("with-grammar"));
    assert.deepEqual(restricted.ok ? [] : restricted.issues.map((issue) => issue.code), [
      "sections-grammar-relaxed",
    ]);
  });

  it("the loader reads identity and subset combination from the manifest", () => {
    const manifest = (law: "identity" | "subset-only") =>
      registryOf({
        id: `test/combination-${law}`,
        grammars: {
          claims: {
            ...declarative,
            params: { forms: { introduction: "with-grammar", value: anyValue, law } },
            arms: [],
          },
        },
      } as unknown as ModuleManifest);
    const document = constitution(
      { heading: "Facts", grammar: "claims", forms: ["stated", "inferred"] },
      { heading: "Facts", forms: ["stated"] },
    );

    assert.equal(loadConstitution(document, manifest("subset-only")).ok, true);
    const identity = loadConstitution(document, manifest("identity"));
    assert.deepEqual(identity.ok ? [] : identity.issues.map((issue) => issue.code), [
      "sections-grammar-relaxed",
    ]);
  });

  it("keyed-bounds reads its declared field names", () => {
    const manifest = (fields: { key: string; lower: string; upper: string }) =>
      registryOf({
        id: `test/keyed-${fields.key}`,
        grammars: {
          relations: {
            ...declarative,
            params: {
              require: {
                introduction: "any-depth",
                value: anyValue,
                law: { keyedBounds: fields },
              },
            },
            arms: [],
          },
        },
      } as unknown as ModuleManifest);
    const document = constitution(
      {
        heading: "Relations",
        grammar: "relations",
        require: [{ label: "part_of", min: 1, max: 3 }],
      },
      {
        heading: "Relations",
        require: [
          { label: "part_of", min: 2, max: 2 },
          { label: "owned_by", min: 1 },
        ],
      },
    );

    const named = loadConstitution(
      document,
      manifest({ key: "label", lower: "min", upper: "max" }),
    );
    assert.equal(named.ok, true, JSON.stringify(named.ok ? [] : named.issues));
    if (!named.ok) throw new Error("unreachable");
    assert.deepEqual(named.registry.types.get("child")?.sections?.list[0]?.params["require"], [
      { label: "part_of", min: 2, max: 2 },
      { label: "owned_by", min: 1 },
    ]);
    const wrongNames = loadConstitution(
      document,
      manifest({ key: "name", lower: "floor", upper: "ceiling" }),
    );
    assert.deepEqual(wrongNames.ok ? [] : wrongNames.issues.map((issue) => issue.code), [
      "sections-grammar-relaxed",
    ]);

    const fields = manifest({ key: "label", lower: "min", upper: "max" });
    for (const require of [
      [{ label: "part_of", min: 0, max: 2 }],
      [{ label: "part_of", min: 2 }],
      [{ label: "part_of", min: 2, max: 4 }],
    ]) {
      const relaxed = loadConstitution(
        constitution(
          {
            heading: "Relations",
            grammar: "relations",
            require: [{ label: "part_of", min: 1, max: 3 }],
          },
          { heading: "Relations", require },
        ),
        fields,
      );
      assert.deepEqual(relaxed.ok ? [] : relaxed.issues.map((issue) => issue.code), [
        "sections-grammar-relaxed",
      ]);
    }
  });

  // A keyed-bounds row may be keyed by a name SET. Order-free, so
  // `[a, b]` and `[b, a]` are one row; a wider set is a different row that
  // adds a conjunct rather than replacing one — a child can only tighten.
  it("keyed-bounds keys a row by its name set, order-free", () => {
    const fields = registryOf({
      id: "test/keyed-set",
      grammars: {
        relations: {
          ...declarative,
          params: {
            require: {
              introduction: "any-depth",
              value: anyValue,
              law: { keyedBounds: { key: "labels", lower: "min", upper: "max" } },
            },
          },
          arms: [],
        },
      },
    } as unknown as ModuleManifest);
    const under = (parent: unknown[], child: unknown[]) =>
      loadConstitution(
        constitution(
          { heading: "Relations", grammar: "relations", require: parent },
          { heading: "Relations", require: child },
        ),
        fields,
      );
    const tightened = under(
      [{ labels: ["implements", "diverges-from"], min: 1 }],
      [
        { labels: ["diverges-from", "implements"], min: 2, max: 3 },
        { labels: ["covers"], min: 1 },
      ],
    );
    assert.equal(tightened.ok, true, JSON.stringify(tightened.ok ? [] : tightened.issues));
    if (!tightened.ok) throw new Error("unreachable");
    assert.deepEqual(tightened.registry.types.get("child")?.sections?.list[0]?.params["require"], [
      { labels: ["diverges-from", "implements"], min: 2, max: 3 },
      { labels: ["covers"], min: 1 },
    ]);
    // The same set under a different order is the same row: lowering it is refused.
    const relaxed = under(
      [{ labels: ["implements", "diverges-from"], min: 2 }],
      [{ labels: ["diverges-from", "implements"], min: 1 }],
    );
    assert.deepEqual(relaxed.ok ? [] : relaxed.issues.map((issue) => issue.code), [
      "sections-grammar-relaxed",
    ]);
    // A wider set is a different key: it appends a conjunct and lowers nothing.
    const widened = under(
      [{ labels: ["implements"], min: 1 }],
      [{ labels: ["implements", "diverges-from"], min: 1 }],
    );
    assert.equal(widened.ok, true);
    if (!widened.ok) throw new Error("unreachable");
    const rows = widened.registry.types.get("child")?.sections?.list[0]?.params["require"];
    assert.equal(Array.isArray(rows) ? rows.length : 0, 2);
  });

  it("the shipped relations manifest admits `labels` rows only — `label` is not a spelling", () => {
    const relationsRequire = relations.grammars?.["relations"]?.params["require"];
    assert.notEqual(relationsRequire, undefined);
    assert.equal(relationsRequire?.value.safeParse([{ labels: ["a"], min: 1 }]).success, true);
    assert.equal(relationsRequire?.value.safeParse([{ label: "a", min: 1 }]).success, false);
    assert.equal(relationsRequire?.value.safeParse([{ labels: [], min: 1 }]).success, false);
  });

  // The two identifiers a module could still take, found by probing rather than
  // by reading: 47 engine pass ids, and the kernel's own `prose` grammar.
  it("a module may not claim an engine pass id — the routing table would hand it a fixer", () => {
    for (const id of [
      "missing-required-field",
      "stale-capture",
      "tag-requires-link",
      "instances",
    ]) {
      const loaded = loadModules([
        ...MODULES,
        {
          id: "acme/greedy",
          grammars: {
            greedy: {
              kinds: ["acme:i"],
              parse: () => undefined,
              params: {},
              arms: [{ id, row: "info", run: () => undefined }],
            },
          },
        },
      ]);
      assert.equal(loaded.ok, false, `"${id}" is the engine's`);
      if (loaded.ok) throw new Error("unreachable");
      assert.equal(loaded.conflicts[0]?.kind, "arm-reserved", id);
    }
  });

  it("…and a check may not claim one either, for the same reason", () => {
    const loaded = loadModules([
      ...MODULES,
      {
        id: "acme/greedy",
        grammars: {},
        lanes: ["acme/greedy/lane"],
        checks: {
          "stale-capture": {
            config: z.strictObject({}),
            surfaces: ["type"],
            row: "declared",
            lane: "acme/greedy/lane",
            run: () => undefined,
          },
        },
      },
    ]);
    assert.equal(loaded.ok, false);
    if (loaded.ok) throw new Error("unreachable");
    assert.equal(loaded.conflicts[0]?.kind, "check-reserved");
  });

  it("`prose` is the kernel's grammar and no module may register it", () => {
    const loaded = loadModules([
      ...MODULES,
      {
        id: "acme/prose",
        grammars: { prose: { kinds: ["acme:p"], parse: () => undefined, params: {}, arms: [] } },
      },
    ]);
    assert.equal(loaded.ok, false, "a module taking `prose` would take every prose section");
    if (loaded.ok) throw new Error("unreachable");
    assert.equal(loaded.conflicts[0]?.kind, "grammar-reserved");
    assert.equal(loaded.conflicts[0]?.id, "prose");
  });

  it("two modules claiming one grammar is a load error, before any code runs", () => {
    const clash: ModuleManifest = {
      id: "acme/other",
      grammars: { claims: { ...declarative, params: {}, arms: [] } },
    };
    const loaded = loadModules([...MODULES, clash]);
    assert.equal(loaded.ok, false, "a duplicate grammar id is refused");
    if (loaded.ok) throw new Error("unreachable");
    assert.equal(loaded.conflicts[0]?.kind, "grammar");
    assert.equal(loaded.conflicts[0]?.id, "claims");
    assert.deepEqual(loaded.conflicts[0]?.claimants, ["claims", "acme/other"]);
  });

  it("two grammars claiming one arm id is a load error too", () => {
    const clash: ModuleManifest = {
      id: "acme/other",
      grammars: {
        measurements: {
          ...declarative,
          params: {},
          arms: [{ id: "unknown-category", row: "declared", lane: "category-review" }],
        },
      },
    };
    const loaded = loadModules([...MODULES, clash]);
    assert.equal(loaded.ok, false, "a duplicate arm id is refused");
    if (loaded.ok) throw new Error("unreachable");
    assert.equal(loaded.conflicts[0]?.kind, "arm");
    assert.equal(loaded.conflicts[0]?.id, "unknown-category");
  });
});

// docs/extending.md — the API's EXECUTABLE half. The
// cases above check what a manifest DECLARES; these check that the kernel
// actually calls it, which is the difference between a registration API and a
// table of names the kernel happens to agree with.
describe("the executable seam (docs/extending.md)", () => {
  it("every shipped grammar owns at least one item kind and supplies a parse", () => {
    for (const [name, grammar] of registry().grammars) {
      assert.equal(grammar.kinds.length > 0, true, `${name} declares the kinds it owns`);
      assert.equal(typeof grammar.parse, "function", `${name} supplies a parse`);
    }
  });

  it("`unparsed` is the kernel's kind and no module may claim it", () => {
    const loaded = loadModules([
      {
        id: "acme/greedy",
        grammars: { greedy: { ...declarative, kinds: ["unparsed"], params: {}, arms: [] } },
      },
    ]);
    assert.equal(loaded.ok, false, "a module claiming `unparsed` is refused");
    if (loaded.ok) throw new Error("unreachable");
    assert.equal(loaded.conflicts[0]?.kind, "kind-reserved");
    assert.equal(loaded.conflicts[0]?.id, "unparsed");
  });

  it("two grammars claiming one item kind is a load error", () => {
    const clash: ModuleManifest = {
      id: "acme/other",
      grammars: { measurements: { ...declarative, kinds: ["entry"], params: {}, arms: [] } },
    };
    const loaded = loadModules([...MODULES, clash]);
    assert.equal(loaded.ok, false, "a duplicate item kind is refused");
    if (loaded.ok) throw new Error("unreachable");
    assert.equal(loaded.conflicts[0]?.kind, "kind");
    assert.equal(loaded.conflicts[0]?.id, "entry");
    assert.deepEqual(loaded.conflicts[0]?.claimants, ["entries", "measurements"]);
  });

  it("a delegation to a kind nothing registered is a load error", () => {
    const loaded = loadModules([
      {
        id: "acme/dangling",
        grammars: {
          dangling: {
            ...declarative,
            kinds: ["measurement"],
            delegates: [{ to: "no-such-kind", on: { param: "mode" } }],
            // refuses a condition naming a parameter the grammar does
            // not declare, and would refuse this fixture first. Declaring `mode`
            // isolates the defect under test to the unknown KIND.
            params: { mode: { introduction: "any-depth", value: anyValue, law: "identity" } },
            arms: [],
          },
        },
      },
    ]);
    assert.equal(loaded.ok, false, "a delegation naming an unregistered kind is refused");
    if (loaded.ok) throw new Error("unreachable");
    assert.equal(loaded.conflicts[0]?.kind, "delegate-unknown");
    assert.equal(loaded.conflicts[0]?.id, "no-such-kind");
  });

  // The delegation is CONDITIONAL, and the condition is the section's
  // parameters. A Facts section must not silently gain the entry kind.
  it("a delegate joins the chain only where its condition holds", () => {
    const modules = registry();
    assert.equal(resolveParsers("claims", { role: "history" }, modules).length, 2);
    assert.equal(resolveParsers("claims", {}, modules).length, 1);
    assert.equal(resolveParsers("entries", {}, modules).length, 1);
    assert.equal(resolveParsers("prose", {}, modules).length, 0, "prose registers no grammar");
  });

  // The load-bearing case: if the kernel still fell through to a hard-coded
  // entries parser, replacing the entries manifest would change nothing.
  it("the kernel parses through the manifest, not through a grammar name", () => {
    const declining = loadModules([
      {
        id: "entries",
        grammars: {
          entries: { kinds: ["entry"], parse: () => undefined, params: {}, arms: [] },
        },
      },
    ]);
    assert.equal(declining.ok, true);
    if (!declining.ok) throw new Error("unreachable");
    const binding = sectionBinding(
      { heading: "Timeline", depth: 2, grammar: "entries" },
      {},
      declining.registry,
    );
    const page = [
      "---",
      "type: person",
      "tags: []",
      "---",
      "",
      "## Timeline",
      "",
      "- 2024-01-02 — x",
      "",
    ];
    const items = parseSections(parseDoc(page.join("\n")), [binding]).sections[0]?.items ?? [];
    assert.equal(items.length, 1);
    assert.equal(items[0]?.kind, "unparsed", "a declining manifest makes the item unparsed");

    // …and the shipped manifest parses the same line as a dated entry.
    const shipped = sectionBinding(
      { heading: "Timeline", depth: 2, grammar: "entries" },
      {},
      registry(),
    );
    const parsed = parseSections(parseDoc(page.join("\n")), [shipped]).sections[0]?.items ?? [];
    assert.equal(parsed[0]?.kind, "entry", "the shipped manifest parses it");
  });

  // The envelope is the kernel's. A module returns fields only.
  it("the kernel attaches the envelope a module never sees", () => {
    const binding = sectionBinding(
      { heading: "Timeline", depth: 2, grammar: "entries" },
      {},
      registry(),
    );
    const page = [
      "---",
      "type: person",
      "tags: []",
      "---",
      "",
      "## Timeline",
      "",
      "- 2024-01-02 — x",
      "",
    ];
    const item = parseSections(parseDoc(page.join("\n")), [binding]).sections[0]?.items[0];
    assert.equal(item?.line, 8, "the kernel numbered the line, from the source");
    assert.equal(item?.raw, "2024-01-02 — x", "the kernel kept the raw span verbatim");
    assert.deepEqual(item?.rationale, []);
  });
});

// docs/extending.md §An arm — the whole point, end to end. A kit's arm
// used to load with `ok: true` and then do nothing: no PASS_TABLE row, so the
// coverage loop never reached it; no row on its arm, so it had no severity; and
// a closed `GrammarRuleId`, so its id could not be written into a finding. Three
// silences, one test.
describe("a registered arm fires, and is counted (docs/extending.md §An arm)", () => {
  const KIT: ModuleManifest = {
    id: "acme/validation",
    grammars: {
      measurements: {
        kinds: ["acme/validation:measurement"],
        parse: (text) => ({ kind: "acme/validation:measurement", text }),
        params: {},
        arms: [
          {
            id: "acme/validation/out-of-range",
            row: "declared",
            lane: "grammar-review",
            run: (item, ctx) => {
              ctx.emit(
                "acme/validation/out-of-range",
                item.line,
                "the measurement is out of range",
                { section: ctx.section.heading },
                item.raw,
              );
            },
          },
        ],
      },
    },
  };

  function findings(severity?: "warning" | "error") {
    const loaded = loadModules([...MODULES, KIT]);
    assert.equal(loaded.ok, true, "the kit loads beside the standard library");
    if (!loaded.ok) throw new Error("unreachable");
    const kernel: Parameters<typeof sectionBinding>[0] = {
      heading: "Measurements",
      depth: 2,
      grammar: "measurements" as never,
    };
    if (severity !== undefined) kernel.severity = severity;
    const binding = sectionBinding(kernel, {}, loaded.registry);
    const page = ["---", "type: part", "tags: []", "---", "", "## Measurements", "", "- 42 mm", ""];
    const ast = parseSections(parseDoc(page.join("\n")), [binding]);
    return checkGrammar(ast, { modules: loaded.registry });
  }

  it("the kit's arm emits a finding under its own namespaced id", () => {
    const found = findings();
    const mine = found.filter((f) => f.ruleId === "acme/validation/out-of-range");
    assert.equal(mine.length, 1, JSON.stringify(found));
    assert.equal(mine[0]?.line, 8, "the kernel's envelope numbered the line");
  });

  it("the kernel resolves its severity from the row the KIT declared", () => {
    // `declared` with no knob is the report-mode default…
    assert.equal(
      findings().find((f) => f.ruleId === "acme/validation/out-of-range")?.severity,
      "warning",
    );
    // …and the section's knob moves it, exactly as it moves a shipped arm's.
    assert.equal(
      findings("error").find((f) => f.ruleId === "acme/validation/out-of-range")?.severity,
      "error",
    );
  });

  it("a census row the kit declared is `info`, and the knob does not reach it", () => {
    const census: ModuleManifest = {
      ...KIT,
      grammars: {
        measurements: {
          ...KIT.grammars?.["measurements"],
          arms: [{ ...KIT.grammars?.["measurements"]?.arms[0], row: "info" } as never],
        } as never,
      },
    };
    const loaded = loadModules([...MODULES, census]);
    assert.equal(loaded.ok, true);
    if (!loaded.ok) throw new Error("unreachable");
    const binding = sectionBinding(
      { heading: "Measurements", depth: 2, grammar: "measurements" as never, severity: "error" },
      {},
      loaded.registry,
    );
    const page = ["---", "type: part", "tags: []", "---", "", "## Measurements", "", "- 42 mm", ""];
    const ast = parseSections(parseDoc(page.join("\n")), [binding]);
    const found = checkGrammar(ast, { modules: loaded.registry });
    assert.equal(
      found.find((f) => f.ruleId === "acme/validation/out-of-range")?.severity,
      "info",
      "a count is not a verdict, and `severity: error` on the section does not make it one",
    );
  });
});

// docs/concepts.md §Findings and routing · docs/extending.md §A check — the third
// silence, now closed end to end. The coverage loop iterates the kernel's table
// PLUS the arms a module registered, and a section may declare any REGISTERED
// grammar, so a kit's arm is counted against the pages it actually governs.
describe("a registered arm is counted on the pages it governs", () => {
  const KIT_ARM = "acme/validation/out-of-range";
  const KIT_DRIFT = "acme/validation/drift";
  const KIT: ModuleManifest = {
    id: "acme/validation",
    grammars: {
      "acme/validation/measurements": {
        kinds: ["acme/validation:measurement"],
        parse: (text) => ({ kind: "acme/validation:measurement", text }),
        params: {},
        arms: [
          { id: KIT_ARM, row: "declared", lane: "grammar-review", run: () => undefined },
          // A kit's transition arm: the row says it needs a base, and nothing
          // in the kernel knows its name.
          { id: KIT_DRIFT, row: "declared", lane: "grammar-review", needsBase: true },
        ],
      },
    },
  };

  function kitRegistry() {
    const loaded = loadModules([...MODULES, KIT]);
    assert.equal(loaded.ok, true);
    if (!loaded.ok) throw new Error("unreachable");
    return loaded.registry;
  }

  function verdict(grammar: string) {
    const modules = kitRegistry();
    const built = loadConstitution(constitution({ heading: "Measurements", grammar }), modules);
    assert.equal(built.ok, true, JSON.stringify(built.ok ? [] : built.issues));
    if (!built.ok) throw new Error("unreachable");
    const page = ["---", "type: base", "tags: []", "---", "", "Lede.", "", "## Measurements", ""];
    return judge(
      { pages: new Map([["wiki/A.md", page.join("\n")]]) },
      { registry: built.registry, modules } as never,
      { all: true },
    );
  }

  it("a section may declare a kit's grammar, and the arm reports `evaluated`", () => {
    const cell = verdict("acme/validation/measurements").coverage.passes[KIT_ARM];
    assert.notEqual(cell, undefined, "a registered arm is a row of the coverage block");
    assert.equal(cell?.evaluated, 1, "one declaration of it governs this page");
    assert.equal(cell?.not_applicable, 0);
  });

  it("and reads `not_applicable` on a page whose sections declare another grammar", () => {
    const cell = verdict("claims").coverage.passes[KIT_ARM];
    assert.equal(cell?.evaluated, 0);
    assert.equal(
      (cell?.not_applicable ?? 0) >= 1,
      true,
      "declared, governing nothing, and said so",
    );
  });

  // Read off the manifest: a kit's base-carrying arm that a section
  // turned on and this run could not judge is a blind spot the scalar reports.
  it("a kit's base-carrying arm with no base is `no-base`, and counts as unevaluated", () => {
    const v = verdict("acme/validation/measurements");
    const cell = v.coverage.passes[KIT_DRIFT];
    assert.equal(cell?.reason, "no-base", JSON.stringify(cell));
    assert.equal(cell?.evaluated, 0);
    assert.equal(cell?.not_applicable, 1);
    // Two: the kit's arm, and the `body: append-only` law the fixture type
    // declares — both turned on by a declaration, neither judged without a base.
    assert.equal(v.summary.unevaluated, 2, JSON.stringify(v.coverage.passes));
  });

  it("a grammar no loaded module registers fails load, naming the section", () => {
    const built = loadConstitution(
      constitution({ heading: "Measurements", grammar: "acme/typo/measurments" }),
      kitRegistry(),
    );
    assert.equal(built.ok, false, "an unregistered grammar is a load error");
    if (built.ok) throw new Error("unreachable");
    const issue = built.issues.find((i) => i.code === "constitution-unknown-extension");
    assert.notEqual(issue, undefined, JSON.stringify(built.issues));
    assert.equal(issue?.message.includes("acme/typo/measurments"), true);
    assert.equal(issue?.message.includes("Measurements"), true);
  });

  it("`prose` is the kernel's own grammar and needs no module", () => {
    const built = loadConstitution(
      constitution({ heading: "Notes", grammar: "prose" }),
      kitRegistry(),
    );
    assert.equal(built.ok, true, JSON.stringify(built.ok ? [] : built.issues));
  });
});

// 7: `admits`, `canonicalize` and `observes` are the manifest fields
// three kernel loops used to spell for one module: `role === "history"` with
// `kind === "claim" || kind === "entry"`; a 【】 regex and an em-dash separator;
// and a branch on `"relations"` / `"categories"` / `"sources"` reading
// `item.label`, `item.category` and `item.provenance.source`. Each case below
// swaps the manifest and requires the kernel's output to follow it — which is
// what a hard-coded loop cannot do.

/** The standard library with one grammar's spec overridden field by field. */
function libraryWith(grammar: "claims" | "relations" | "entries", patch: Record<string, unknown>) {
  const manifests = MODULES.map((manifest) => {
    const spec = manifest.grammars?.[grammar];
    if (spec === undefined) return manifest;
    return { ...manifest, grammars: { ...manifest.grammars, [grammar]: { ...spec, ...patch } } };
  }) as readonly ModuleManifest[];
  const loaded = loadModules(manifests);
  assert.equal(loaded.ok, true);
  if (!loaded.ok) throw new Error("unreachable");
  return loaded.registry;
}

const page = (body: readonly string[]): string =>
  ["---", "type: person", "tags: []", "---", "", "Lede.", "", ...body, ""].join("\n");

function findingsIn(
  modules: ModuleRegistry,
  params: Record<string, unknown>,
  body: readonly string[],
) {
  const binding = sectionBinding(
    { heading: "History", depth: 2, grammar: "claims" },
    params,
    modules,
  );
  const ast = parseSections(parseDoc(page(["## History", "", ...body])), [binding]);
  return checkGrammar(ast, { modules });
}

describe("`admits` is the section's allow-list, declared (docs/extending.md §A grammar)", () => {
  const HISTORY = { role: "history", history: "History", vocabulary: "categories" };
  const BODY = ["- 2024-01-02 — something happened"];

  it("the shipped manifest reads `items` only on a history section", () => {
    assert.deepEqual(admittedKinds("claims", { ...HISTORY, items: ["claim"] }, registry()), [
      "claim",
    ]);
    // Without `role: history` the allow-list is not read at all — which is the
    // shipped behaviour, and it is a DECLARATION now rather than a branch.
    assert.equal(admittedKinds("claims", { items: ["claim"] }, registry()), undefined);
    assert.equal(admittedKinds("claims", HISTORY, registry()), undefined);
  });

  it("an entry in a claim-only history section is `grammar-unparsed`", () => {
    const found = findingsIn(registry(), { ...HISTORY, items: ["claim"] }, BODY);
    const unparsed = found.filter((f) => f.ruleId === "grammar-unparsed");
    assert.equal(unparsed.length, 1, JSON.stringify(found));
    assert.equal(unparsed[0]?.message.includes("admits claim items only"), true);
  });

  it("…and is admitted where the section admits it", () => {
    const found = findingsIn(registry(), { ...HISTORY, items: ["claim", "entry"] }, BODY);
    assert.equal(
      found.some((f) => f.ruleId === "grammar-unparsed"),
      false,
    );
  });

  // Non-vacuous: a manifest that points `admits` at a DIFFERENT parameter must
  // change the verdict. A kernel branch on `role`/`items` cannot follow it.
  it("the kernel reads the parameter the manifest names, not `items`", () => {
    const patched = libraryWith("claims", { admits: { param: "only" } });
    // `only` now carries the allow-list, and it is read at any depth: a history
    // section declaring `items` restricts nothing.
    assert.equal(
      findingsIn(patched, { ...HISTORY, items: ["claim"] }, BODY).some(
        (f) => f.ruleId === "grammar-unparsed",
      ),
      false,
      "`items` is no longer the allow-list",
    );
    assert.equal(
      findingsIn(patched, { ...HISTORY, only: ["claim"] }, BODY).some(
        (f) => f.ruleId === "grammar-unparsed",
      ),
      true,
      "`only` is",
    );
  });

  it("a grammar that declares no `admits` restricts nothing", () => {
    const patched = libraryWith("claims", { admits: undefined });
    assert.equal(admittedKinds("claims", { ...HISTORY, items: ["claim"] }, patched), undefined);
    assert.equal(
      findingsIn(patched, { ...HISTORY, items: ["claim"] }, BODY).some(
        (f) => f.ruleId === "grammar-unparsed",
      ),
      false,
    );
  });
});

describe("`canonicalize` is the module's rendering (docs/concepts.md §The judge and its states)", () => {
  const FACTS = { vocabulary: "categories", history: "History" };
  function canonicalFindings(modules: ModuleRegistry, body: readonly string[]) {
    const binding = sectionBinding(
      { heading: "Facts", depth: 2, grammar: "claims" },
      FACTS,
      modules,
    );
    const ast = parseSections(parseDoc(page(["## Facts", "", ...body])), [binding]);
    return checkGrammar(ast, { modules }).filter((f) => f.ruleId === "canonical-form");
  }

  it("a 【】 claim is counted, and the count names the ASCII form", () => {
    const found = canonicalFindings(registry(), ["- 【identity】 name is X"]);
    assert.equal(found.length, 1, JSON.stringify(found));
    assert.equal(found[0]?.severity, "info", "the kernel owns the row; a count is not a verdict");
    assert.equal(found[0]?.details["canonical_line"], "- [identity] name is X");
  });

  it("the kernel resolves it from the grammar that owns the item's KIND", () => {
    // A History section declares `claims` and holds `entry` items by delegation.
    // The dated entry's canonical form is `entries`' to state, not claims'.
    const binding = sectionBinding(
      { heading: "History", depth: 2, grammar: "claims" },
      { role: "history", vocabulary: "categories" },
      registry(),
    );
    const ast = parseSections(
      parseDoc(page(["## History", "", "- 2024-01-02: something happened"])),
      [binding],
    );
    const found = checkGrammar(ast, { modules: registry() }).filter(
      (f) => f.ruleId === "canonical-form",
    );
    assert.equal(found.length, 1, JSON.stringify(found));
    assert.equal(found[0]?.details["canonical_line"], "- 2024-01-02 — something happened");
    assert.notEqual(canonicalizeOf("entry", registry()), undefined);
    assert.notEqual(canonicalizeOf("claim", registry()), undefined);
    assert.equal(canonicalizeOf("relation", registry()), undefined, "relations declare no dialect");
    assert.equal(canonicalizeOf("acme/nobody:item", registry()), undefined);
  });

  // Non-vacuous: a manifest with no `canonicalize` must silence the arm.
  it("a grammar that declares no rendering has no dialect to count", () => {
    const patched = libraryWith("claims", { canonicalize: undefined });
    assert.deepEqual(canonicalFindings(patched, ["- 【identity】 name is X"]), []);
  });
});

describe("`observes` is what a census counts (docs/constitution.md §Vocabularies)", () => {
  const claim = { kind: "claim", raw: "x", category: "Identity", handle: "#1" };

  it("a claim reports its category, and its `sourced` tag", () => {
    const modules = registry();
    assert.deepEqual(observedValues("categories", claim as never, modules), ["Identity"]);
    assert.deepEqual(observedValues("relations", claim as never, modules), []);
    assert.deepEqual(
      observedValues(
        "sources",
        {
          ...claim,
          provenance: { form: "sourced", raw: "(wechat 2026-01-01)", source: "wechat" },
        } as never,
        modules,
      ),
      ["wechat"],
    );
    // A `sourced` clause recognized by its date tail alone carries no tag, and
    // `sourced-inferred` is what counts it instead.
    assert.deepEqual(
      observedValues(
        "sources",
        { ...claim, provenance: { form: "sourced", raw: "(2026-01-01)" } } as never,
        modules,
      ),
      [],
    );
  });

  it("a relation reports its label", () => {
    assert.deepEqual(
      observedValues(
        "relations",
        { kind: "relation", raw: "x", label: "part_of" } as never,
        registry(),
      ),
      ["part_of"],
    );
  });

  it("an item whose grammar registers no observer counts nothing", () => {
    assert.deepEqual(
      observedValues("categories", { kind: "entry", raw: "x" } as never, registry()),
      [],
    );
    assert.deepEqual(
      observedValues("categories", { kind: "unparsed", raw: "x" } as never, registry()),
      [],
    );
  });

  // The load-bearing case: the census loop reads the manifest.
  it("the vault census follows the manifest, not the vocabulary's name", () => {
    const document = {
      schema: "wikiwright/constitution",
      schema_version: 3,
      vocabularies: {
        tags: { mode: "registered", entries: {} },
        categories: { mode: "registered", entries: { identity: { class: "supersede" } } },
      },
      types: {
        person: {
          extends: "concept",
          description: "A person page.",
          sections: {
            list: [{ heading: "Facts", grammar: "claims", vocabulary: "categories" }],
          },
        },
      },
    };
    const pages = [
      {
        path: "wiki/A.md",
        doc: parseDoc(
          [
            "---",
            "type: person",
            "tags: []",
            "---",
            "",
            "Lede.",
            "",
            "## Facts",
            "",
            "- [identity] name is X (recorded 2026-01-01)",
            "",
          ].join("\n"),
        ),
      },
    ];
    const censusUnder = (modules: ModuleRegistry) => {
      const built = loadConstitution(document, modules);
      assert.equal(built.ok, true, JSON.stringify(built.ok ? [] : built.issues));
      if (!built.ok) throw new Error("unreachable");
      return observeVocabulary("categories", pages, built.registry);
    };
    assert.deepEqual(
      censusUnder(registry()).map((row) => row.label),
      ["identity"],
    );
    // A manifest that observes nothing counts nothing — which a kernel loop
    // reading `item.category` could not be made to do.
    assert.deepEqual(censusUnder(libraryWith("claims", { observes: () => [] })), []);
  });
});

// docs/concepts.md §Generated artifacts: `edges` is the manifest field the graph reads. The
// relations module registers it, a kit's grammar may, and the generator's loop
// learns no label and no grammar name — it asks the grammar that owns the
// item's kind and resolves what comes back.
describe("`edges` is what the graph carries (docs/concepts.md §Generated artifacts)", () => {
  it("a relation declares one edge — its target under its label", () => {
    assert.deepEqual(
      edgesOf(
        { kind: "relation", raw: "x", label: "part_of", target: "Acme" } as never,
        registry(),
      ),
      [{ to: "Acme", label: "part_of" }],
    );
  });

  it("an item whose grammar registers no `edges`, and a throwing hook, contribute nothing", () => {
    assert.deepEqual(edgesOf({ kind: "claim", raw: "x" } as never, registry()), []);
    assert.deepEqual(edgesOf({ kind: "entry", raw: "x" } as never, registry()), []);
    const throwing = libraryWith("relations", {
      edges: () => {
        throw new Error("a stranger's bug");
      },
    });
    assert.deepEqual(
      edgesOf({ kind: "relation", raw: "x", label: "part_of", target: "Acme" } as never, throwing),
      [],
    );
  });

  // The load-bearing case: the graph follows the manifest.
  it("the graph's labelled edges follow the manifest, not the grammar's name", () => {
    const document = {
      schema: "wikiwright/constitution",
      schema_version: 3,
      vocabularies: {
        tags: { mode: "registered", entries: {} },
        relations: { mode: "registered", entries: { part_of: { description: "part of" } } },
      },
      types: {
        thing: {
          extends: "concept",
          description: "A thing.",
          sections: {
            list: [{ heading: "Relations", grammar: "relations", vocabulary: "relations" }],
          },
        },
      },
    };
    const pages = [
      { path: "wiki/A.md", doc: parseDoc(page(["## Relations", "", "- part_of [[B]]"])) },
      { path: "wiki/B.md", doc: parseDoc(page([])) },
    ].map((p) => ({ ...p, doc: parseDoc(p.doc.source.replace("type: person", "type: thing")) }));
    const labelledUnder = (modules: ModuleRegistry) => {
      const built = loadConstitution(document, modules);
      assert.equal(built.ok, true, JSON.stringify(built.ok ? [] : built.issues));
      if (!built.ok) throw new Error("unreachable");
      return graphOf(built.registry, pages).edges.filter((e) => e.label !== undefined);
    };
    assert.deepEqual(labelledUnder(registry()), [
      { from: "wiki/A.md", to: "wiki/B.md", kind: "relation", label: "part_of" },
    ]);
    // A manifest that declares no edges contributes none — which a kernel loop
    // reading `item.label` and `item.target` could not be made to do.
    assert.deepEqual(labelledUnder(libraryWith("relations", { edges: () => [] })), []);
    // …and one that relabels every edge is believed: the label is the module's.
    assert.deepEqual(
      labelledUnder(
        libraryWith("relations", {
          edges: (item: { target: string }) => [{ to: item.target, label: "acme:link" }],
        }),
      ).map((e) => e.label),
      ["acme:link"],
    );
  });
});
