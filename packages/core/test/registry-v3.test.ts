// docs/constitution.md §config/constitution.json (one document; vocabularies;
// fragments; shapes-only fields; the v3 combination rows; the ratchet compares
// effective severities; a section's `sources` list is validated at load;
// fragment-collision over a set; the unknown-key scan recurses) ·
// docs/constitution.md §Fragments.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type FlattenedRegistry,
  loadConstitution,
  standardLibrary,
  tagsOf,
  validateShape,
} from "@wikiwright/core";

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
const optionalOf = (
  t: { fields: Map<string, { shape: unknown; contributedBy: string }> } | undefined,
) =>
  [...(t?.fields ?? [])]
    .filter(([, s]) => (s.shape as { required?: boolean }).required !== true)
    .map(([value, s]) => ({ value, contributedBy: s.contributedBy }));

type Json = Record<string, unknown>;

const TAGS = {
  mode: "registered",
  form: "^[a-z0-9][a-z0-9-]*$",
  entries: {
    people: { description: "Any page standing for a named person." },
    hubs: { description: "A routing page." },
  },
};

function doc(overrides: Json = {}): Json {
  return {
    schema: "wikiwright/constitution",
    schema_version: 3,
    vocabularies: { tags: TAGS },
    types: {
      person: { extends: "concept", description: "One human being." },
    },
    ...overrides,
  };
}

function issues(json: unknown): string[] {
  const r = loadConstitution(json, standardLibrary());
  return r.ok ? [] : r.issues.map((i) => `${i.code}@${i.where}`);
}

function codes(json: unknown): string[] {
  const r = loadConstitution(json, standardLibrary());
  return r.ok ? [] : r.issues.map((i) => i.code);
}

function messages(json: unknown): string[] {
  const r = loadConstitution(json, standardLibrary());
  return r.ok ? [] : r.issues.map((i) => i.message);
}

function registryOf(json: Json): FlattenedRegistry {
  const loaded = loadConstitution(json, standardLibrary());
  assert.equal(loaded.ok, true, loaded.ok ? "" : JSON.stringify(loaded.issues));
  if (!loaded.ok) throw new Error("unreachable");
  return loaded.registry;
}

describe("the v3 constitution loads (docs/constitution.md §config/constitution.json)", () => {
  it("a minimal document flattens to types, tags and vocabularies", () => {
    const r = loadConstitution(doc(), standardLibrary());
    assert.equal(r.ok, true, JSON.stringify(issues(doc())));
    if (!r.ok) return;
    assert.equal(r.registry.types.get("person")?.archetype, "concept");
    assert.deepEqual([...tagsOf(r.registry).entries.values()].map((t) => t.name).sort(), [
      "hubs",
      "people",
    ]);
    assert.equal(r.registry.vocabularies.get("tags")?.mode, "registered");
    assert.equal(r.registry.vocabularies.get("tags")?.form, "^[a-z0-9][a-z0-9-]*$");
  });

  it("`tags` is required, and its mode is fixed at registered", () => {
    assert.equal(codes(doc({ vocabularies: {} })).includes("vocabulary-missing"), true);
    assert.equal(
      codes(doc({ vocabularies: { tags: { mode: "census" } } })).includes("vocabulary-mode"),
      true,
    );
  });

  it("the vocabulary name set is closed — an unconsumed vocabulary is refused", () => {
    const bad = doc({ vocabularies: { tags: TAGS, moods: { mode: "census" } } });
    assert.equal(codes(bad).includes("vocabulary-unknown"), true);
  });

  it("a property outside its vocabulary is a load error", () => {
    const bad = doc({
      vocabularies: {
        tags: { mode: "registered", entries: { people: { class: "supersede" } } },
      },
    });
    assert.equal(codes(bad).includes("vocabulary-entry-key"), true);
  });

  it("namespaces are independent: one name in two vocabularies is legal", () => {
    const ok = doc({
      vocabularies: {
        tags: { mode: "registered", entries: { identity: { description: "t" } } },
        categories: {
          mode: "registered",
          entries: { identity: { class: "supersede", description: "c" } },
        },
      },
    });
    assert.deepEqual(issues(ok), []);
  });

  it("an alias colliding inside one vocabulary is a load error", () => {
    const bad = doc({
      vocabularies: {
        tags: { mode: "registered", entries: { people: {}, hubs: { aliases: ["people"] } } },
      },
    });
    assert.equal(codes(bad).includes("vocabulary-alias-collision"), true);
  });

  it("a categories entry must carry a class; relations carry a range of real types", () => {
    assert.equal(
      codes(
        doc({
          vocabularies: { tags: TAGS, categories: { mode: "registered", entries: { role: {} } } },
        }),
        // "every category carries a class" is the CLAIMS module's entry
        // schema now, so the refusal is the schema's — a required property
        // missing, reported under the entry's own anchor.
      ).includes("vocabulary-entry-invalid"),
      true,
    );
    assert.equal(
      codes(
        doc({
          vocabularies: {
            tags: TAGS,
            relations: { mode: "registered", entries: { works_at: { range: ["nowhere"] } } },
          },
        }),
      ).includes("vocabulary-type-ref-unknown"),
      true,
    );
  });
});

describe("a constitution may not name rules, contracts or checkers", () => {
  for (const [key, value] of [
    ["rules", []],
    ["contracts", {}],
  ] as const) {
    it(`a top-level "${key}" fails load naming what carries that law instead`, () => {
      const r = loadConstitution(doc({ [key]: value }), standardLibrary());
      assert.equal(r.ok, false);
      if (r.ok) return;
      assert.equal(
        r.issues.some((i) => i.code === "constitution-unknown-key" && i.message.includes(key)),
        true,
        JSON.stringify(r.issues),
      );
    });
  }

  it("a type carrying `rules` or `contracts` or `budget` fails the same way", () => {
    for (const extra of [
      { rules: [] },
      { contracts: ["dated-log"] },
      { budget: { page_max_chars: 10 } },
    ]) {
      const bad = doc({
        types: { person: { extends: "concept", description: "d", ...extra } },
      });
      assert.equal(codes(bad).includes("constitution-unknown-key"), true, JSON.stringify(extra));
    }
  });
});

describe("fragments compose before extends", () => {
  const withFragment = (types: Json): Json =>
    doc({
      fragments: {
        "entity-shape": {
          description: "The five-section body.",
          fields: { created: { kind: "date", auto: "on-create" } },
          sections: {
            depth: 2,
            list: [
              { heading: "Facts", grammar: "claims", min: 0 },
              { heading: "Relations", grammar: "relations", min: 0 },
            ],
          },
        },
        "second-shape": {
          fields: { created: { kind: "date" } },
        },
      },
      types,
    });

  it("a fragment's fields and sections land on the type, attributed to the fragment", () => {
    const r = loadConstitution(
      withFragment({
        entity: {
          extends: "concept",
          description: "base",
          abstract: true,
          fragments: ["entity-shape"],
        },
        person: {
          extends: "entity",
          description: "p",
          sections: { list: [{ heading: "Facts", min: 1 }] },
        },
      }),
      standardLibrary(),
    );
    assert.equal(r.ok, true, JSON.stringify(issues(withFragment({}))));
    if (!r.ok) return;
    const person = r.registry.types.get("person");
    assert.equal(person?.sections?.list.find((e) => e.heading === "Facts")?.min, 1);
    assert.equal(person?.sections?.list.find((e) => e.heading === "Facts")?.grammar, "claims");
    const entity = r.registry.types.get("entity");
    assert.equal(
      entity?.sections?.list.find((e) => e.heading === "Facts")?.contributedBy,
      "fragment:entity-shape",
    );
    assert.equal(entity?.fields.get("created")?.contributedBy, "fragment:entity-shape");
    // The attribution rewrite runs over objects the flatten SHARES between a
    // parent and its children, so it must be idempotent: an inherited entry on
    // a child reports the fragment once, not once per inheriting type.
    assert.equal(
      person?.sections?.list.find((e) => e.heading === "Relations")?.contributedBy,
      "fragment:entity-shape",
    );
    assert.equal(person?.fields.get("created")?.contributedBy, "fragment:entity-shape");
  });

  it("two fragments contributing one field is a load error", () => {
    const bad = withFragment({
      entity: {
        extends: "concept",
        description: "base",
        fragments: ["entity-shape", "second-shape"],
      },
    });
    assert.equal(codes(bad).includes("fragment-collision"), true);
  });

  it("a fragment naming nothing declared is refused", () => {
    const bad = doc({
      types: { person: { extends: "concept", description: "d", fragments: ["nope"] } },
    });
    assert.equal(codes(bad).includes("unknown-fragment"), true);
  });
});

describe("abstract and instances", () => {
  it("abstract is one-way: a concrete type's child may not become abstract", () => {
    const bad = doc({
      types: {
        person: { extends: "concept", description: "p" },
        ghost: { extends: "person", description: "g", abstract: true },
      },
    });
    assert.equal(codes(bad).includes("abstract-widened"), true);
  });

  it("an abstract type's child may be concrete", () => {
    const ok = doc({
      types: {
        entity: { extends: "concept", description: "e", abstract: true },
        person: { extends: "entity", description: "p" },
      },
    });
    assert.deepEqual(issues(ok), []);
  });

  it("instances tightens: a child may raise min and lower max, never the reverse", () => {
    const bad = doc({
      types: {
        base: { extends: "reference", description: "b", instances: { min: 1, max: 1 } },
        child: { extends: "base", description: "c", instances: { min: 0, max: 5 } },
      },
    });
    assert.equal(codes(bad).includes("instances-relaxed"), true);
  });
});

describe("the v3 section parameters and their tightening laws", () => {
  const sectioned = (child: Json): Json =>
    doc({
      vocabularies: {
        tags: TAGS,
        categories: {
          mode: "registered",
          entries: {
            identity: { class: "supersede" },
            preference: { class: "accumulate" },
            volatile: { class: "journal-only" },
          },
        },
        relations: { mode: "census" },
      },
      types: {
        entity: {
          extends: "concept",
          description: "e",
          abstract: true,
          sections: {
            depth: 2,
            list: [
              {
                heading: "Facts",
                grammar: "claims",
                vocabulary: "categories",
                history: "History",
                only: ["identity", "preference"],
                severity: "warning",
              },
              { heading: "Timeline", grammar: "entries", date: "optional" },
            ],
          },
        },
        person: { extends: "entity", description: "p", ...child },
      },
    });

  it("only narrows a vocabulary, and a child may narrow it further", () => {
    const r = loadConstitution(
      sectioned({ sections: { list: [{ heading: "Facts", only: ["identity"] }] } }),
      standardLibrary(),
    );
    assert.equal(r.ok, true, JSON.stringify(issues(sectioned({}))));
    if (!r.ok) return;
    assert.deepEqual(
      r.registry.types.get("person")?.sections?.list.find((e) => e.heading === "Facts")?.params[
        "only"
      ],
      ["identity"],
    );
  });

  it("only may not widen", () => {
    const bad = sectioned({
      sections: { list: [{ heading: "Facts", only: ["identity", "preference", "volatile"] }] },
    });
    assert.equal(codes(bad).includes("sections-grammar-relaxed"), true);
  });

  it("only must name declared entries of the section's vocabulary", () => {
    const bad = doc({
      vocabularies: {
        tags: TAGS,
        categories: { mode: "registered", entries: { identity: { class: "supersede" } } },
      },
      types: {
        person: {
          extends: "concept",
          description: "p",
          sections: {
            depth: 2,
            list: [
              {
                heading: "Facts",
                grammar: "claims",
                vocabulary: "categories",
                only: ["nope"],
              },
            ],
          },
        },
      },
    });
    assert.equal(codes(bad).includes("sections-entry-unknown"), true, JSON.stringify(codes(bad)));
  });

  it("severity ratchets warning → error and never back", () => {
    assert.deepEqual(
      issues(sectioned({ sections: { list: [{ heading: "Facts", severity: "error" }] } })),
      [],
    );
    const bad = doc({
      vocabularies: { tags: TAGS },
      types: {
        base: {
          extends: "concept",
          description: "b",
          sections: { depth: 2, list: [{ heading: "Notes", grammar: "prose", severity: "error" }] },
        },
        child: {
          extends: "base",
          description: "c",
          sections: { list: [{ heading: "Notes", severity: "warning" }] },
        },
      },
    });
    assert.equal(codes(bad).includes("sections-grammar-relaxed"), true);
  });

  it("a section naming an undeclared vocabulary is refused", () => {
    const bad = doc({
      types: {
        person: {
          extends: "concept",
          description: "p",
          sections: {
            depth: 2,
            list: [{ heading: "Facts", grammar: "claims", vocabulary: "categories" }],
          },
        },
      },
    });
    assert.equal(codes(bad).includes("sections-vocabulary-unknown"), true);
  });

  it("a child redeclaring max: 0 under an inherited min: 1 is refused (the J1 defect)", () => {
    const bad = doc({
      types: {
        base: {
          extends: "concept",
          description: "b",
          sections: { depth: 2, list: [{ heading: "Facts", min: 1 }] },
        },
        child: {
          extends: "base",
          description: "c",
          sections: { list: [{ heading: "Facts", max: 0 }] },
        },
      },
    });
    assert.equal(codes(bad).includes("sections-redeclared"), true);
  });

  it("`hub` stays a reserved archetype name — the v1 starter's defect as a fixture", () => {
    const bad = doc({ types: { hub: { extends: "concept", description: "h" } } });
    assert.equal(codes(bad).includes("archetype-name-collision"), true);
  });
});

describe("fields are shapes", () => {
  it("required: true replaces fields.required; a shape may attach to an inherited field", () => {
    const r = loadConstitution(
      doc({
        types: {
          base: {
            extends: "reference",
            description: "b",
            fields: { created: { kind: "date" }, case_id: { kind: "string", required: true } },
          },
          child: {
            extends: "base",
            description: "c",
            fields: { status: { kind: "enum", values: ["active", "draft"] } },
          },
        },
      }),
      standardLibrary(),
    );
    assert.equal(r.ok, true, JSON.stringify(issues(doc())));
    if (!r.ok) return;
    const base = r.registry.types.get("base");
    assert.equal(
      requiredOf(base).some((f) => f.value === "case_id"),
      true,
    );
    assert.equal(
      optionalOf(base).some((f) => f.value === "created"),
      true,
    );
    // `status` is an engine base-optional field: declaring a shape on it is an
    // attachment, never a redeclaration.
    const child = r.registry.types.get("child");
    assert.notEqual(child?.fields.get("status"), undefined);
    assert.equal(optionalOf(child).filter((f) => f.value === "status").length, 1);
  });

  it("the new shape members are legal shapes", () => {
    assert.deepEqual(validateShape({ kind: "dated-string" }), []);
    assert.deepEqual(validateShape({ kind: "date", auto: "on-write", required: true }), []);
    assert.deepEqual(validateShape({ kind: "page-ref", target_type: "person" }), []);
    assert.deepEqual(validateShape({ kind: "string", requires: ["pin"] }), []);
  });

  it("`auto` belongs to date, and its values are closed", () => {
    assert.notDeepEqual(validateShape({ kind: "string", auto: "on-write" }), []);
    assert.notDeepEqual(validateShape({ kind: "date", auto: "sometimes" }), []);
  });

  it("target_type must name a declared type", () => {
    const bad = doc({
      types: {
        person: {
          extends: "concept",
          description: "p",
          fields: { spouse: { kind: "page-ref", target_type: "nobody" } },
        },
      },
    });
    assert.equal(codes(bad).includes("field-target-type-unknown"), true);
  });

  it("`requires` must name a field the type declares", () => {
    const bad = doc({
      types: {
        person: {
          extends: "concept",
          description: "p",
          fields: { pin: { kind: "string", requires: ["nothing_here"] } },
        },
      },
    });
    assert.equal(codes(bad).includes("field-requires-unknown"), true);
  });
});

// docs/constitution.md §Shapes: a pin names a revision OF an origin. The sibling it points at
// must exist and be a string, `covers` a list of strings, and a chain carries
// one pin. Constitution failures, exit 2.
describe("the pin shape's load refusals (docs/constitution.md §Shapes)", () => {
  const withSource = (fields: Record<string, unknown>) =>
    doc({ types: { source: { extends: "reference", description: "s", fields } } });

  it("loads when the siblings are declared with the right shapes, on the type or above it", () => {
    const ok = withSource({
      locator: { kind: "string", required: true },
      commit: { kind: "pin", origin: "locator", covers: "covers" },
      covers: { kind: "list", item: { kind: "string" } },
    });
    assert.deepEqual(codes(ok), []);
    const inherited = doc({
      types: {
        capture: {
          extends: "reference",
          description: "c",
          fields: { locator: { kind: "string" } },
        },
        source: {
          extends: "capture",
          description: "s",
          fields: { commit: { kind: "pin", origin: "locator" } },
        },
      },
    });
    assert.deepEqual(codes(inherited), []);
  });

  it("refuses an origin the chain does not declare, or declares as something other than a string", () => {
    assert.equal(
      codes(withSource({ commit: { kind: "pin", origin: "locator" } })).includes(
        "pin-origin-unknown-field",
      ),
      true,
    );
    assert.equal(
      codes(
        withSource({ locator: { kind: "integer" }, commit: { kind: "pin", origin: "locator" } }),
      ).includes("pin-origin-shape"),
      true,
    );
  });

  it("refuses a covers that is absent or not a list of strings", () => {
    const base = {
      locator: { kind: "string" },
      commit: { kind: "pin", origin: "locator", covers: "covers" },
    };
    assert.equal(codes(withSource(base)).includes("pin-covers-shape"), true);
    assert.equal(
      codes(withSource({ ...base, covers: { kind: "string" } })).includes("pin-covers-shape"),
      true,
    );
    assert.equal(
      codes(withSource({ ...base, covers: { kind: "list", item: { kind: "integer" } } })).includes(
        "pin-covers-shape",
      ),
      true,
    );
  });

  it("refuses two pins on one chain", () => {
    const two = withSource({
      locator: { kind: "string" },
      commit: { kind: "pin", origin: "locator" },
      revision: { kind: "pin", origin: "locator" },
    });
    assert.equal(codes(two).includes("pin-duplicate"), true);
  });
});

describe("the severity ratchet compares effective severities", () => {
  /** A parent whose Facts section gates by the DOCUMENTED DEFAULT: `history`, no severity. */
  const withChildSeverity = (childSeverity?: string): Json =>
    doc({
      types: {
        entity: {
          extends: "concept",
          abstract: true,
          description: "Anything with an identity.",
          sections: {
            depth: 2,
            list: [
              { heading: "Facts", grammar: "claims", history: "History" },
              { heading: "History", grammar: "claims", role: "history" },
            ],
          },
        },
        person: {
          extends: "entity",
          description: "One human being.",
          sections: {
            depth: 2,
            list: [
              childSeverity === undefined
                ? { heading: "Facts" }
                : { heading: "Facts", severity: childSeverity },
            ],
          },
        },
      },
    });

  it("a child may not quiet an inherited section that gates by default", () => {
    // `claims-transition` defaults to `error` where a section declares
    // `history` and authors no severity. Comparing the AUTHORED inherited value
    // reads `undefined` as "nothing to relax" and lets the child through —
    // which turns a blocked commit (gate exit 5) into a passing one.
    const found = codes(withChildSeverity("warning"));
    assert.equal(
      found.includes("sections-grammar-relaxed"),
      true,
      `expected the ratchet to refuse; got ${JSON.stringify(found)}`,
    );
    const why = messages(withChildSeverity("warning")).join(" | ");
    assert.match(why, /severity/, "the refusal names the parameter it refused");
  });

  it("a child may still ratchet the same section up to error", () => {
    assert.deepEqual(codes(withChildSeverity("error")), []);
  });

  it("declaring `history` for the first time at warning is a declaration, not a relaxation", () => {
    // Nothing gated before this entry existed, so there is nothing to relax.
    const first = doc({
      types: {
        person: {
          extends: "concept",
          description: "One human being.",
          sections: {
            depth: 2,
            list: [
              { heading: "Facts", grammar: "claims", history: "History", severity: "warning" },
              { heading: "History", grammar: "claims", role: "history" },
            ],
          },
        },
      },
    });
    assert.deepEqual(codes(first), []);
  });

  it("the same law holds for an append-only `entries` section", () => {
    const bad = doc({
      types: {
        entity: {
          extends: "concept",
          abstract: true,
          description: "Anything.",
          sections: {
            depth: 2,
            list: [{ heading: "Timeline", grammar: "entries", lifecycle: "append-only" }],
          },
        },
        person: {
          extends: "entity",
          description: "One human being.",
          sections: { depth: 2, list: [{ heading: "Timeline", severity: "warning" }] },
        },
      },
    });
    assert.equal(codes(bad).includes("sections-grammar-relaxed"), true, JSON.stringify(codes(bad)));
  });
});

describe("a section's `sources` list is validated against the vocabulary", () => {
  const withSources = (list: string[], entries: Json): Json => ({
    schema: "wikiwright/constitution",
    schema_version: 3,
    vocabularies: {
      tags: TAGS,
      sources: { mode: "registered", entries },
    },
    types: {
      person: {
        extends: "concept",
        description: "One human being.",
        sections: {
          depth: 2,
          list: [{ heading: "Facts", grammar: "claims", sources: list }],
        },
      },
    },
  });

  it("a source the vocabulary does not declare is a load error", () => {
    const found = codes(withSources(["mail", "chat"], { mail: {} }));
    assert.equal(found.includes("sections-entry-unknown"), true, JSON.stringify(found));
  });

  it("a source written as an alias is a load error naming the canonical entry", () => {
    const found = codes(withSources(["email"], { mail: { aliases: ["email"] } }));
    assert.equal(found.includes("sections-entry-alias"), true, JSON.stringify(found));
  });

  it("a retired source is a load error", () => {
    const found = codes(
      withSources(["mail"], { mail: { status: "retired", replaced_by: ["chat"] }, chat: {} }),
    );
    assert.equal(found.includes("sections-entry-retired"), true, JSON.stringify(found));
  });

  it("a declared, active source loads", () => {
    assert.deepEqual(codes(withSources(["mail"], { mail: {} })), []);
  });

  it("with no `sources` vocabulary declared, a section's list is unconstrained", () => {
    // The vocabulary is optional; only a declared one governs.
    const noVocabulary = doc({
      types: {
        person: {
          extends: "concept",
          description: "One human being.",
          sections: {
            depth: 2,
            list: [{ heading: "Facts", grammar: "claims", sources: ["anything"] }],
          },
        },
      },
    });
    assert.deepEqual(codes(noVocabulary), []);
  });
});

describe("fragment-collision is judged over a set", () => {
  const twoFragments = (order: string[], secondMin: number): Json =>
    doc({
      fragments: {
        strict: {
          description: "Notes, tightly.",
          sections: { depth: 2, list: [{ heading: "Notes", min: secondMin }] },
        },
        loose: {
          description: "Notes, loosely.",
          sections: { depth: 2, list: [{ heading: "Notes" }] },
        },
      },
      types: {
        person: { extends: "concept", description: "One human being.", fragments: order },
      },
    });

  it("two fragments contributing one heading collide, whatever the order", () => {
    for (const order of [
      ["strict", "loose"],
      ["loose", "strict"],
    ]) {
      const found = codes(twoFragments(order, 1));
      assert.equal(
        found.includes("fragment-collision"),
        true,
        `${order.join(",")}: ${JSON.stringify(found)}`,
      );
    }
  });

  it("identical entries collide too — a set has no duplicates", () => {
    const found = codes(twoFragments(["strict", "loose"], 0));
    assert.equal(found.includes("fragment-collision"), true, JSON.stringify(found));
  });

  it("one fragment contributing the heading is fine", () => {
    const one = doc({
      fragments: {
        strict: {
          description: "Notes.",
          sections: { depth: 2, list: [{ heading: "Notes" }] },
        },
      },
      types: {
        person: { extends: "concept", description: "One human being.", fragments: ["strict"] },
      },
    });
    assert.deepEqual(codes(one), []);
  });
});

describe("a fragment attributes what it pastes to itself", () => {
  it("an ordinary fragment name still loads, and attributes to itself", () => {
    const ok = doc({
      fragments: {
        body: {
          description: "A paste.",
          sections: { depth: 2, list: [{ heading: "Notes" }] },
        },
      },
      types: {
        base: { extends: "concept", description: "Base.", fragments: ["body"] },
        child: { extends: "base", description: "Child." },
      },
    });
    const registry = registryOf(ok);
    for (const name of ["base", "child"]) {
      const entry = registry.types.get(name)?.sections?.list.find((e) => e.heading === "Notes");
      assert.equal(entry?.contributedBy, "fragment:body", `${name} attribution`);
    }
  });
});

describe("the unknown-key scan reaches nested keys", () => {
  it("a checker inside a section entry is refused by name, not as a grammar parameter", () => {
    const bad = doc({
      types: {
        person: {
          extends: "concept",
          description: "One human being.",
          sections: {
            depth: 2,
            list: [{ heading: "Facts", grammar: "claims", checker: "claim-classes" }],
          },
        },
      },
    });
    assert.equal(codes(bad).includes("constitution-unknown-key"), true, JSON.stringify(codes(bad)));
    assert.match(messages(bad).join(" | "), /checker/);
  });

  it("a rules block inside a vocabulary is refused by name", () => {
    const bad = doc({
      vocabularies: { tags: { ...TAGS, rules: [] } },
    });
    assert.equal(codes(bad).includes("constitution-unknown-key"), true, JSON.stringify(codes(bad)));
    assert.match(messages(bad).join(" | "), /grammar and a field's shape/);
  });

  it("the top-level and per-type cases still name it", () => {
    assert.equal(codes(doc({ rules: [] })).includes("constitution-unknown-key"), true);
    const perType = doc({
      types: { person: { extends: "concept", description: "x", contracts: [] } },
    });
    assert.equal(codes(perType).includes("constitution-unknown-key"), true);
  });
});

describe("one cause, one issue: a fragment's bad row is reported once with its sites", () => {
  it("four types pasting one fragment with a bad parameter yield one issue naming the four", () => {
    const document = {
      schema: "wikiwright/constitution",
      schema_version: 3,
      vocabularies: {
        tags: { mode: "registered", entries: {} },
        relations: { mode: "registered", entries: { "traces-to": { description: "x" } } },
      },
      fragments: {
        traced: {
          sections: {
            list: [
              {
                heading: "Relations",
                grammar: "relations",
                vocabulary: "relations",
                // The old spelling: one edit, wherever it is pasted.
                require: [{ label: "traces-to", min: 1 }],
              },
            ],
          },
        },
      },
      types: Object.fromEntries(
        ["alpha", "beta", "gamma", "delta"].map((name) => [
          name,
          { extends: "concept", description: `The ${name} type.`, fragments: ["traced"] },
        ]),
      ),
    };
    const result = loadConstitution(document, standardLibrary());
    assert.equal(result.ok, false);
    if (result.ok) return;
    const params = result.issues.filter((i) => i.code === "sections-grammar-params");
    assert.equal(params.length, 1, JSON.stringify(result.issues));
    assert.equal(params[0]?.where, "fragment:traced/sections/list/0");
    assert.deepEqual(params[0]?.sites, ["type:alpha", "type:beta", "type:delta", "type:gamma"]);
    // An issue raised where it sits carries no sites.
    for (const issue of result.issues) {
      if (issue.where.startsWith("type:")) assert.equal(issue.sites, undefined);
    }
  });
});
