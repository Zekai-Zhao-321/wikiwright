// docs/extending.md §What a module registers (vocabularies with module-owned entry
// schemas, checks attachable to four surfaces, queue lanes, and plain
// constitution data) · docs/extending.md §The manifest (collisions fail before code runs)
// docs/concepts.md §Findings and routing (a registered finding routes to a registered lane).
//
// The theme, again: every declaration has a live consumer, and one that cannot
// be consumed is refused rather than accepted-and-inert.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import { judge } from "../src/judge/index.ts";
import { lintPage } from "../src/lint/index.ts";
import {
  type CheckContext,
  defineCheck,
  defineModule,
  defineVocabulary,
  loadModules,
  type ModuleManifest,
  type ModuleRegistry,
} from "../src/modules/index.ts";
import { parseDoc } from "../src/parse/index.ts";
import { KERNEL_LANES } from "../src/passes/index.ts";
import { loadConstitution } from "../src/registry/index.ts";
import { STANDARD_LIBRARY } from "../src/stdlib/index.ts";

/** A fixture module, shaped by the caller. Everything else is the library's. */
function withKit(kit: Partial<ModuleManifest> & { id?: string } = {}) {
  const manifest = defineModule({ id: "acme/probe", grammars: {}, ...kit });
  return loadModules([...STANDARD_LIBRARY, manifest]);
}

function registryOf(kit: Partial<ModuleManifest> = {}): ModuleRegistry {
  const loaded = withKit(kit);
  assert.equal(loaded.ok, true, loaded.ok ? "" : JSON.stringify(loaded.conflicts));
  if (!loaded.ok) throw new Error("unreachable");
  return loaded.registry;
}

const conflictsOf = (kit: Partial<ModuleManifest>) => {
  const loaded = withKit(kit);
  assert.equal(loaded.ok, false, "the fixture is refused");
  if (loaded.ok) throw new Error("unreachable");
  return loaded.conflicts;
};

// ---------------------------------------------------------------------------

describe("a module registers its own vocabularies (docs/extending.md §What a module registers)", () => {
  const STATUS = defineVocabulary({
    entry: z.strictObject({ severity_hint: z.enum(["low", "high"]).optional() }),
  });

  it("the standard library's own vocabularies are registrations, not a kernel constant", () => {
    const r = registryOf();
    assert.deepEqual([...r.vocabularies.keys()].sort(), [
      "categories",
      "relations",
      "sources",
      "tags",
    ]);
    // `tags` is the KERNEL's: it is read by folder alignment and the catalog,
    // outside every section and under every grammar.
    assert.equal(r.owners.get("vocabulary:tags"), undefined);
    assert.equal(r.owners.get("vocabulary:categories")?.module, "claims");
    assert.equal(r.owners.get("vocabulary:relations")?.module, "relations");
  });

  it("a kit's vocabulary joins the set, and a bundle may declare it", () => {
    const modules = registryOf({ vocabularies: { "acme/probe/status": STATUS } });
    const built = loadConstitution(
      constitution({
        vocabularies: {
          tags: { mode: "registered", entries: {} },
          "acme/probe/status": {
            mode: "registered",
            entries: { blocked: { description: "b.", severity_hint: "high" } },
          },
        },
      }),
      modules,
    );
    assert.equal(built.ok, true, JSON.stringify(built.ok ? [] : built.issues));
    if (!built.ok) throw new Error("unreachable");
    const entry = built.registry.vocabularies.get("acme/probe/status")?.entries.get("blocked");
    assert.deepEqual(entry?.properties, { severity_hint: "high" });
  });

  // docs/extending.md §What a module registers: a kit may ship the entries its own grammar
  // needs; the bundle declares the vocabulary and adds beside them.
  it("a module ships entries of its vocabulary; a bundle adds beside them, never over one", () => {
    const modules = registryOf({
      vocabularies: {
        "acme/probe/status": defineVocabulary({
          entry: z.strictObject({ severity_hint: z.enum(["low", "high"]).optional() }),
          entries: { shipped: { description: "From the module.", severity_hint: "low" } },
        }),
      },
    });
    const declare = (entries: Record<string, unknown>) =>
      constitution({
        vocabularies: {
          tags: { mode: "registered", entries: {} },
          "acme/probe/status": { mode: "registered", entries },
        },
      });
    const built = loadConstitution(declare({ blocked: { severity_hint: "high" } }), modules);
    assert.equal(built.ok, true, JSON.stringify(built.ok ? [] : built.issues));
    if (!built.ok) throw new Error("unreachable");
    const status = built.registry.vocabularies.get("acme/probe/status");
    assert.deepEqual(
      [...(status?.entries.keys() ?? [])].sort(),
      ["blocked", "shipped"],
      "the module's entry and the bundle's, side by side",
    );
    assert.deepEqual(status?.entries.get("shipped")?.properties, { severity_hint: "low" });
    assert.equal(status?.entries.get("shipped")?.description, "From the module.");

    const clash = loadConstitution(declare({ shipped: { description: "Again." } }), modules);
    assert.equal(clash.ok, false, "a bundle may not re-declare a shipped entry");
    if (clash.ok) throw new Error("unreachable");
    assert.equal(
      clash.issues.some((i) => i.code === "vocabulary-entry-collision"),
      true,
      JSON.stringify(clash.issues),
    );
  });

  it("a vocabulary no loaded module registers is a load error", () => {
    const built = loadConstitution(
      constitution({
        vocabularies: { tags: { mode: "registered", entries: {} }, invented: { mode: "census" } },
      }),
      registryOf(),
    );
    assert.equal(built.ok, false);
    if (built.ok) throw new Error("unreachable");
    assert.equal(
      built.issues.some((i) => i.code === "vocabulary-unknown"),
      true,
      JSON.stringify(built.issues),
    );
  });

  it("an entry property the vocabulary does not declare is refused, naming the owner", () => {
    const built = loadConstitution(
      constitution({
        vocabularies: {
          tags: { mode: "registered", entries: {} },
          // `range` is the relations vocabulary's property.
          sources: { mode: "registered", entries: { wechat: { range: ["person"] } } },
        },
      }),
      registryOf(),
    );
    assert.equal(built.ok, false);
    if (built.ok) throw new Error("unreachable");
    const issue = built.issues.find((i) => i.code === "vocabulary-entry-key");
    assert.notEqual(issue, undefined, JSON.stringify(built.issues));
    assert.equal(issue?.message.includes("relations"), true, issue?.message);
  });

  it("a bundle may not relax a mode the module registered", () => {
    const modules = registryOf({
      vocabularies: { "acme/probe/status": defineVocabulary({ mode: "registered" }) },
    });
    const built = loadConstitution(
      constitution({
        vocabularies: {
          tags: { mode: "registered", entries: {} },
          "acme/probe/status": { mode: "census" },
        },
      }),
      modules,
    );
    assert.equal(built.ok, false);
    if (built.ok) throw new Error("unreachable");
    assert.equal(
      built.issues.some((i) => i.code === "vocabulary-mode"),
      true,
      JSON.stringify(built.issues),
    );
  });

  it("two modules claiming one vocabulary is a load error, and `tags` is reserved", () => {
    assert.equal(conflictsOf({ vocabularies: { categories: STATUS } })[0]?.kind, "vocabulary");
    assert.equal(conflictsOf({ vocabularies: { tags: STATUS } })[0]?.kind, "vocabulary-reserved");
  });

  // docs/concepts.md §Generated artifacts: a module's edge is keyed by its item's kind, so an item
  // kind spelled like a kernel edge kind would file a kit's edges under the
  // kernel's. Refused at load, like `unparsed`.
  it("an item kind spelled like a kernel edge kind is reserved", () => {
    for (const kind of ["unparsed", "wikilink", "tagged", "cites", "supersedes"]) {
      const conflicts = conflictsOf({
        grammars: { probe: { kinds: [kind], parse: () => undefined, params: {}, arms: [] } },
      });
      assert.equal(conflicts[0]?.kind, "kind-reserved", kind);
      assert.equal(conflicts[0]?.id, kind);
    }
  });
});

// ---------------------------------------------------------------------------

const STABLE_ID = defineCheck({
  config: z.strictObject({ prefix: z.string().min(1) }),
  surfaces: ["type", "field"],
  row: "declared",
  lane: "acme/probe/review",
  run: (ctx: CheckContext) => {
    const prefix = ctx.config["prefix"] as string;
    const value = ctx.field === undefined ? ctx.page.frontmatter["id"] : ctx.field.value;
    if (typeof value === "string" && value.startsWith(prefix)) return;
    ctx.emit(
      ctx.field?.line,
      `the identifier does not begin with "${prefix}"`,
      { prefix },
      `stable-id|${String(value)}`,
      `rename the identifier to begin with "${prefix}"`,
    );
  },
});

const CHECK_KIT: Partial<ModuleManifest> = {
  lanes: ["acme/probe/review"],
  checks: { "acme/probe/stable-id": STABLE_ID },
};

function constitution(overrides: Record<string, unknown> = {}) {
  return {
    schema: "wikiwright/constitution",
    schema_version: 3,
    vocabularies: { tags: { mode: "registered", entries: {} } },
    types: {
      record: {
        extends: "concept",
        description: "A record page.",
        fields: { id: { kind: "string" } },
      },
    },
    ...overrides,
  };
}

function withCheckOn(where: "type" | "field" | "section", config: unknown = { prefix: "ACME-" }) {
  const attachment = { use: "acme/probe/stable-id", config };
  const type: Record<string, unknown> = {
    extends: "concept",
    description: "A record page.",
    fields: {
      id: where === "field" ? { kind: "string", checks: [attachment] } : { kind: "string" },
    },
  };
  if (where === "type") type["checks"] = [attachment];
  if (where === "section") {
    type["sections"] = { list: [{ heading: "Notes", grammar: "prose", checks: [attachment] }] };
  }
  return constitution({ types: { record: type } });
}

const PAGE = (id: string): string =>
  ["---", "type: record", "tags: []", `id: ${id}`, "---", "", "Lede.", ""].join("\n");

describe("a module registers checks a bundle attaches", () => {
  function findings(where: "type" | "field", id: string) {
    const modules = registryOf(CHECK_KIT);
    const built = loadConstitution(withCheckOn(where), modules);
    assert.equal(built.ok, true, JSON.stringify(built.ok ? [] : built.issues));
    if (!built.ok) throw new Error("unreachable");
    return lintPage({ path: "wiki/A.md", doc: parseDoc(PAGE(id)), registry: built.registry });
  }

  it("a type attachment runs, emits under the check's own id, and takes its row", () => {
    const found = findings("type", "X-1").filter((f) => f.ruleId === "acme/probe/stable-id");
    assert.equal(found.length, 1, JSON.stringify(found));
    assert.equal(found[0]?.severity, "warning", "a `declared` row with no knob is a warning");
    assert.equal(found[0]?.contributedBy, "record");
  });

  it("…and says nothing where the page satisfies it", () => {
    assert.deepEqual(
      findings("type", "ACME-1").filter((f) => f.ruleId === "acme/probe/stable-id"),
      [],
    );
  });

  it("a field attachment sees the field's value and its line", () => {
    const found = findings("field", "X-1").filter((f) => f.ruleId === "acme/probe/stable-id");
    assert.equal(found.length, 1, JSON.stringify(found));
    assert.equal(found[0]?.line, 4, "the frontmatter key's own line");
  });

  it("an attachment on a surface the check does not admit is a load error", () => {
    const built = loadConstitution(withCheckOn("section"), registryOf(CHECK_KIT));
    assert.equal(built.ok, false, "the check declares type and field, not section");
    if (built.ok) throw new Error("unreachable");
    const issue = built.issues.find((i) => i.code === "check-attachment-invalid");
    assert.notEqual(issue, undefined, JSON.stringify(built.issues));
    assert.equal(issue?.message.includes("section"), true);
  });

  it("a config the check's own schema refuses is a load error, naming the key", () => {
    const built = loadConstitution(withCheckOn("type", { prefix: 7 }), registryOf(CHECK_KIT));
    assert.equal(built.ok, false);
    if (built.ok) throw new Error("unreachable");
    const issue = built.issues.find((i) => i.code === "check-config-invalid");
    assert.notEqual(issue, undefined, JSON.stringify(built.issues));
    assert.equal(issue?.message.includes("prefix"), true, issue?.message);
  });

  it("an attachment naming a check nothing registered is a load error", () => {
    const document = constitution({
      types: {
        record: {
          extends: "concept",
          description: "A record page.",
          checks: [{ use: "acme/typo/stabel-id", config: {} }],
        },
      },
    });
    const built = loadConstitution(document, registryOf(CHECK_KIT));
    assert.equal(built.ok, false);
    if (built.ok) throw new Error("unreachable");
    assert.equal(
      built.issues.some((i) => i.code === "constitution-unknown-extension"),
      true,
      JSON.stringify(built.issues),
    );
  });

  // docs/extending.md §The manifest: composition is additive and monotone.
  it("a child may add an attachment and tighten it, and may not quiet an inherited one", () => {
    const document = (childSeverity: "warning" | "error") =>
      constitution({
        types: {
          record: {
            extends: "concept",
            description: "A record page.",
            fields: { id: { kind: "string" } },
            checks: [
              { use: "acme/probe/stable-id", config: { prefix: "ACME-" }, severity: "error" },
            ],
          },
          strict: {
            extends: "record",
            description: "A stricter record.",
            checks: [
              { use: "acme/probe/stable-id", config: { prefix: "ACME-" }, severity: childSeverity },
            ],
          },
        },
      });
    const tightened = loadConstitution(document("error"), registryOf(CHECK_KIT));
    assert.equal(tightened.ok, true, JSON.stringify(tightened.ok ? [] : tightened.issues));
    if (!tightened.ok) throw new Error("unreachable");
    assert.equal(
      tightened.registry.types.get("strict")?.checks.length,
      1,
      "one attachment, merged",
    );

    const quieted = loadConstitution(document("warning"), registryOf(CHECK_KIT));
    assert.equal(quieted.ok, false, "a child may not quiet an inherited attachment");
    if (quieted.ok) throw new Error("unreachable");
    assert.equal(
      quieted.issues.some((i) => i.code === "check-relaxed"),
      true,
      JSON.stringify(quieted.issues),
    );
  });

  it("an inherited attachment survives a child that adds another", () => {
    const document = constitution({
      types: {
        record: {
          extends: "concept",
          description: "A record page.",
          fields: { id: { kind: "string" } },
          checks: [{ use: "acme/probe/stable-id", config: { prefix: "ACME-" } }],
        },
        strict: {
          extends: "record",
          description: "A stricter record.",
          checks: [{ use: "acme/probe/stable-id", config: { prefix: "ACME-2024-" } }],
        },
      },
    });
    const built = loadConstitution(document, registryOf(CHECK_KIT));
    assert.equal(built.ok, true, JSON.stringify(built.ok ? [] : built.issues));
    if (!built.ok) throw new Error("unreachable");
    assert.equal(built.registry.types.get("strict")?.checks.length, 2, "added, never replaced");
  });

  it("a check with no declared surface, or a non-census row and no lane, is refused", () => {
    assert.equal(
      conflictsOf({
        checks: { "acme/probe/x": { ...STABLE_ID, surfaces: [] } },
        lanes: ["acme/probe/review"],
      })[0]?.kind,
      "check-surfaces-missing",
    );
    const { lane: _lane, ...laneless } = STABLE_ID;
    assert.equal(
      conflictsOf({ checks: { "acme/probe/x": laneless } })[0]?.kind,
      "check-lane-missing",
    );
  });
});

// ---------------------------------------------------------------------------

describe("a module registers its own queue lanes (docs/concepts.md §Findings and routing)", () => {
  it("a kernel lane may not be re-registered, and two modules may not share one", () => {
    assert.equal(conflictsOf({ lanes: ["grammar-review"] })[0]?.kind, "lane");
    const twice = loadModules([
      defineModule({ id: "a", grammars: {}, lanes: ["shared/lane"] }),
      defineModule({ id: "b", grammars: {}, lanes: ["shared/lane"] }),
    ]);
    assert.equal(twice.ok, false);
    if (twice.ok) throw new Error("unreachable");
    assert.equal(twice.conflicts[0]?.kind, "lane");
  });

  it("an arm or check naming a lane nothing registered is refused at load", () => {
    const loaded = loadModules([
      defineModule({
        id: "acme/probe",
        grammars: {
          "acme/probe/g": {
            kinds: ["acme/probe:item"],
            parse: (text) => ({ kind: "acme/probe:item", text }),
            params: {},
            arms: [
              { id: "acme/probe/x", row: "declared", lane: "no-such-lane", run: () => undefined },
            ],
          },
        },
      }),
    ]);
    assert.equal(loaded.ok, false);
    if (loaded.ok) throw new Error("unreachable");
    assert.equal(loaded.conflicts[0]?.kind, "lane-unknown");
    assert.equal(loaded.conflicts[0]?.id, "no-such-lane");
  });

  it("the kernel's own lane set is the one every pass row already uses", () => {
    assert.equal(KERNEL_LANES.includes("grammar-review"), true);
    assert.equal(registryOf().lanes.has("grammar-review"), true);
  });

  // The load-bearing case: before modules had lanes, a kit's arm that emitted a
  // warning reached `finding-unroutable` and THREW — a stranger's finding
  // crashing the judge for a whole vault, on the one path the arm seam opened.
  it("a registered finding routes to its module's lane instead of throwing", () => {
    const modules = registryOf(CHECK_KIT);
    const built = loadConstitution(withCheckOn("type"), modules);
    assert.equal(built.ok, true, JSON.stringify(built.ok ? [] : built.issues));
    if (!built.ok) throw new Error("unreachable");
    const verdict = judge(
      { pages: new Map([["wiki/A.md", PAGE("X-1")]]) },
      { registry: built.registry, modules },
      { all: true },
    );
    const finding = verdict.findings.find((f) => f.ruleId === "acme/probe/stable-id");
    assert.notEqual(finding, undefined, JSON.stringify(verdict.findings));
    assert.equal(finding?.queue, "acme/probe/review");
    assert.equal(finding?.fix, undefined, "docs/concepts.md §Findings and routing: fix XOR queue");
    // …and the check is a coverage row, counted against the pages it governs.
    const cell = verdict.coverage.passes["acme/probe/stable-id"];
    assert.equal(cell?.evaluated, 1, JSON.stringify(cell));
  });
});

// ---------------------------------------------------------------------------

describe("a module contributes plain constitution data", () => {
  const KIT: Partial<ModuleManifest> = {
    fragments: {
      "acme/probe/identified": {
        description: "Everything this kit identifies.",
        fields: { id: { kind: "string", required: true } },
      },
    },
    types: {
      "acme/probe/record": {
        extends: "concept",
        description: "A kit-contributed record type.",
        fragments: ["acme/probe/identified"],
        template: "acme/probe/record.md",
      },
    },
    templates: { "acme/probe/record.md": "---\ntype: x\n---\n\n## Notes\n" },
    skills: [{ heading: "Records", body: "A record carries a stable id." }],
  };

  it("a contributed fragment and type load, and a bundle may extend the type", () => {
    const modules = registryOf(KIT);
    const built = loadConstitution(
      constitution({
        types: {
          local: {
            extends: "acme/probe/record",
            description: "The bundle's own subtype.",
          },
        },
      }),
      modules,
    );
    assert.equal(built.ok, true, JSON.stringify(built.ok ? [] : built.issues));
    if (!built.ok) throw new Error("unreachable");
    const local = built.registry.types.get("local");
    assert.equal(local?.chain.includes("acme/probe/record"), true);
    assert.equal(local?.fields.has("id"), true, "the fragment's field arrived through the type");
    assert.equal(local?.template?.value, "acme/probe/record.md", "and its template");
  });

  it("a bundle re-declaring a contributed name is a load error, not a silent overwrite", () => {
    const built = loadConstitution(
      constitution({
        types: {
          "acme/probe/record": { extends: "concept", description: "Mine now." },
        },
      }),
      registryOf(KIT),
    );
    assert.equal(built.ok, false);
    if (built.ok) throw new Error("unreachable");
    assert.equal(
      built.issues.some((i) => i.code === "constitution-module-collision"),
      true,
      JSON.stringify(built.issues),
    );
  });

  it("two modules contributing one fragment, type or template is a load error", () => {
    for (const [key, kind] of [
      ["fragments", "fragment"],
      ["types", "type"],
      ["templates", "template"],
    ] as const) {
      const value = key === "templates" ? "x" : { extends: "concept", description: "d." };
      const loaded = loadModules([
        defineModule({ id: "a", grammars: {}, [key]: { shared: value } } as ModuleManifest),
        defineModule({ id: "b", grammars: {}, [key]: { shared: value } } as ModuleManifest),
      ]);
      assert.equal(loaded.ok, false, `${key} collide`);
      if (loaded.ok) throw new Error("unreachable");
      assert.equal(loaded.conflicts[0]?.kind, kind);
    }
  });

  it("a skill fragment carries the module that contributed it", () => {
    // The standard library's claims module contributes a fragment of its own,
    // so the kit's is found by the module it names, in registration order.
    const skills = registryOf(KIT).skills;
    assert.deepEqual(
      skills.filter((s) => s.module === "acme/probe"),
      [{ module: "acme/probe", heading: "Records", body: "A record carries a stable id." }],
    );
    assert.equal(
      skills.findIndex((s) => s.module === "claims") <
        skills.findIndex((s) => s.module === "acme/probe"),
      true,
      "the standard library's fragments render before a kit's",
    );
  });
});

// spec:  (the adversarial probe's fifth finding: what it CONFIRMED).
// A review that only reports what it broke is not a review, and a law nobody
// tried is a law nobody knows holds.
describe("the tightening laws hold from the other side", () => {
  const PARAM_KIT = (law: "subset-only" | "identity"): Partial<ModuleManifest> => ({
    grammars: {
      "acme/probe/g": {
        kinds: ["acme/probe:item"],
        parse: (text) => ({ kind: "acme/probe:item", text }),
        params: { allow: { introduction: "any-depth", value: z.array(z.string()), law } },
        arms: [],
      },
    },
  });

  function inherited(law: "subset-only" | "identity", parent: string[], child: string[]) {
    const modules = registryOf(PARAM_KIT(law));
    return loadConstitution(
      {
        schema: "wikiwright/constitution",
        schema_version: 3,
        vocabularies: { tags: { mode: "registered", entries: {} } },
        types: {
          base: {
            extends: "concept",
            description: "Base.",
            sections: { list: [{ heading: "S", grammar: "acme/probe/g", allow: parent }] },
          },
          kid: {
            extends: "base",
            description: "Child.",
            sections: { list: [{ heading: "S", allow: child }] },
          },
        },
      },
      modules,
    );
  }

  it("a child may narrow a module's `subset-only` parameter", () => {
    const built = inherited("subset-only", ["a", "b"], ["a"]);
    assert.equal(built.ok, true, JSON.stringify(built.ok ? [] : built.issues));
  });

  it("…and may not widen it", () => {
    const built = inherited("subset-only", ["a"], ["a", "b"]);
    assert.equal(built.ok, false);
    if (built.ok) throw new Error("unreachable");
    assert.equal(
      built.issues.some((i) => i.code === "sections-grammar-relaxed"),
      true,
      JSON.stringify(built.issues),
    );
  });

  it("a module's `identity` parameter may not be changed by a child at all", () => {
    const built = inherited("identity", ["a"], ["b"]);
    assert.equal(built.ok, false);
    if (built.ok) throw new Error("unreachable");
    assert.equal(
      built.issues.some((i) => i.code === "sections-grammar-relaxed"),
      true,
      JSON.stringify(built.issues),
    );
  });
});
