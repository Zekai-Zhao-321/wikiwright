// docs/concepts.md §Findings and routing (the arms the v3
// section parameters turn on — `only`, `owned_by`, `items`, `inferred_ref`,
// `require`, `range`, the severity ratchet, and the two base-carrying arms that
// replace the v2 lifecycle checkers; the alias and retirement laws bite
// on authored values; the mode axis governs the unknown-entry arm only;
// The transition arm reads the one parser-options site) · docs/constitution.md
//
// Every row below is a pass with a PASS_TABLE entry and a documented row; this file
// is the "red fixture per row" the routing law asks for.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildNameIndex,
  type Finding,
  type FlattenedRegistry,
  type LintOptions,
  lintPage,
  loadConstitution,
  parseDoc,
  standardLibrary,
} from "@wikiwright/core";

type Json = Record<string, unknown>;

function constitution(overrides: Json = {}): Json {
  return {
    schema: "wikiwright/constitution",
    schema_version: 3,
    vocabularies: {
      tags: { mode: "registered", entries: { hubs: { description: "A routing page." } } },
      categories: {
        mode: "registered",
        entries: {
          identity: { class: "supersede", description: "Who the entity is." },
          contact: { class: "supersede", description: "How it is reached." },
          preference: {
            class: "accumulate",
            owned_by: { not_on: { types: ["self"], tags: ["hubs"] } },
            description: "Taste.",
          },
        },
      },
      relations: {
        mode: "registered",
        entries: {
          works_at: { range: ["org"], description: "Employment." },
          knows: { description: "Acquaintance." },
        },
      },
    },
    types: {
      org: { extends: "concept", description: "An organisation." },
      person: {
        extends: "concept",
        description: "One human being.",
        sections: {
          depth: 2,
          list: [
            {
              heading: "Facts",
              grammar: "claims",
              vocabulary: "categories",
              history: "History",
              inferred_ref: "required",
            },
            {
              heading: "Relations",
              grammar: "relations",
              vocabulary: "relations",
              require: [{ labels: ["knows"], min: 1 }],
            },
            {
              heading: "Timeline",
              grammar: "entries",
              date: "optional",
              lifecycle: "append-only",
            },
            {
              heading: "History",
              grammar: "claims",
              role: "history",
              vocabulary: "categories",
              items: ["entry"],
            },
          ],
        },
      },
      self: {
        extends: "concept",
        description: "The owner's hub.",
        sections: {
          depth: 2,
          list: [
            {
              heading: "Facts",
              grammar: "claims",
              vocabulary: "categories",
              history: "History",
              only: ["identity", "contact"],
              severity: "error",
            },
          ],
        },
      },
    },
    ...overrides,
  };
}

function registryOf(json: Json = constitution()): FlattenedRegistry {
  const loaded = loadConstitution(json, standardLibrary());
  assert.equal(loaded.ok, true, loaded.ok ? "" : JSON.stringify(loaded.issues));
  if (!loaded.ok) throw new Error("unreachable");
  return loaded.registry;
}

const ORG_PAGE = "---\ntype: org\ntitle: Acme\ndescription: An org.\ntags: []\n---\n\nbody\n";

function lint(
  text: string,
  options: {
    registry?: FlattenedRegistry;
    base?: string;
    path?: string;
    sourceRoots?: readonly string[];
  } = {},
): Finding[] {
  const registry = options.registry ?? registryOf();
  const path = options.path ?? "wiki/Ada.md";
  const doc = parseDoc(text);
  const lintOptions: LintOptions = {
    folderTags: "off",
    names: buildNameIndex([
      { path, doc },
      { path: "wiki/Acme.md", doc: parseDoc(ORG_PAGE) },
    ]),
  };
  if (options.base !== undefined) lintOptions.baseText = options.base;
  if (options.sourceRoots !== undefined) lintOptions.sourceRoots = options.sourceRoots;
  return lintPage({ path, doc, registry }, lintOptions);
}

const ids = (findings: Finding[]): string[] => findings.map((f) => f.ruleId);

const person = (body: string, tags = "[]"): string =>
  `---\ntype: person\ntitle: Ada\ndescription: One human being.\ntags: ${tags}\n---\n\n${body}`;

describe("`only` narrows a section's vocabulary (category-not-allowed)", () => {
  it("a registered category outside the section's `only` is reported, at the section's severity", () => {
    const text =
      "---\ntype: self\ntitle: Mara Quill\ndescription: The hub.\ntags: []\n---\n\n## Facts\n\n- [identity] full name: Mara Quill (stated 2026-01-01)\n- [preference] likes hotpot (stated 2026-01-02)\n";
    const findings = lint(text, { path: "wiki/Mara Quill.md" });
    const row = findings.find((f) => f.ruleId === "category-not-allowed");
    assert.notEqual(row, undefined, JSON.stringify(ids(findings)));
    // The section declares `severity: "error"`; the ratchet moves the whole row.
    assert.equal(row?.severity, "error");
    assert.equal(row?.line, 11);
  });

  it("a category inside `only` says nothing", () => {
    const text =
      "---\ntype: self\ntitle: Mara Quill\ndescription: The hub.\ntags: []\n---\n\n## Facts\n\n- [contact] phone: 000 (stated 2026-01-01)\n";
    assert.equal(
      ids(lint(text, { path: "wiki/Mara Quill.md" })).includes("category-not-allowed"),
      false,
    );
  });
});

describe("`owned_by.not_on` keeps a category off a page (owned-by)", () => {
  it("fires on a page carrying the excluded tag", () => {
    const findings = lint(
      person("## Facts\n\n- [preference] likes hotpot (stated 2026-01-02)\n", "[hubs]"),
    );
    assert.equal(ids(findings).includes("owned-by"), true, JSON.stringify(ids(findings)));
  });

  it("says nothing on a page the selector does not name", () => {
    const findings = lint(person("## Facts\n\n- [preference] likes hotpot (stated 2026-01-02)\n"));
    assert.equal(ids(findings).includes("owned-by"), false);
  });
});

describe("a registered relations vocabulary (unknown-label, relation-range, relation-require)", () => {
  it("an unregistered label is reported", () => {
    const findings = lint(person("## Relations\n\n- knows [[Acme]]\n- schemes_with [[Acme]]\n"));
    assert.equal(ids(findings).includes("unknown-label"), true, JSON.stringify(ids(findings)));
  });

  it("a label's range is matched through the target's extends chain", () => {
    const outside = lint(person("## Relations\n\n- knows [[Acme]]\n- works_at [[Ada]]\n"));
    assert.equal(ids(outside).includes("relation-range"), true, JSON.stringify(ids(outside)));
    const inside = lint(person("## Relations\n\n- knows [[Acme]]\n- works_at [[Acme]]\n"));
    assert.equal(ids(inside).includes("relation-range"), false);
  });

  it("`require` states the labels a section must carry", () => {
    const missing = lint(person("## Relations\n\n- works_at [[Acme]]\n"));
    assert.equal(ids(missing).includes("relation-require"), true, JSON.stringify(ids(missing)));
    const row = missing.find((f) => f.ruleId === "relation-require");
    assert.equal(
      row?.message,
      'section "Relations" carries 0 relation(s) labelled knows; at least 1 required',
    );
    assert.deepEqual(row?.details, { section: "Relations", labels: "knows", count: 0 });
    assert.equal(
      row?.remediation,
      "write a relation labelled knows, or relax the section's `require` through review",
    );
    const present = lint(person("## Relations\n\n- knows [[Acme]]\n"));
    assert.equal(ids(present).includes("relation-require"), false);
  });
});

describe("`items` is a history section's allow-list", () => {
  it("a claim-kind item in a section declaring items: [entry] is grammar-unparsed", () => {
    const findings = lint(
      person(
        "## History\n\n- 2026-01-01: created\n- [identity] old name: Ad (stated 2026-01-01) (valid 2026-01-01→2026-01-02, superseded 2026-01-02)\n",
      ),
    );
    assert.equal(ids(findings).includes("grammar-unparsed"), true, JSON.stringify(ids(findings)));
    assert.equal(
      ids(findings).includes("history-marker"),
      false,
      "the kind is refused, not judged",
    );
  });
});

describe("`inferred_ref: required` promotes a shorthand ref from census to finding", () => {
  it("a path-shaped ref is fine; a shorthand one is claim-provenance", () => {
    const shorthand = lint(person("## Facts\n\n- [identity] full name: Ada (inferred, wechat)\n"));
    assert.equal(ids(shorthand).includes("claim-provenance"), true, JSON.stringify(shorthand));
    const pathShaped = lint(
      person("## Facts\n\n- [identity] full name: Ada (inferred, raw/chat/2026-01-01--x/)\n"),
    );
    assert.equal(ids(pathShaped).includes("claim-provenance"), false);
  });
});

describe("the base-carrying arms the v2 lifecycle checkers become", () => {
  const base = person(
    "## Facts\n\n- [identity] full name: Ada (stated 2026-01-01)\n- [preference] likes hotpot (stated 2026-01-02)\n\n## Timeline\n\n- 2026-01-01 — arrived\n- 2026-01-02 — settled\n",
  );

  it("claims-transition: a removed open claim with nothing landing in History", () => {
    const draft = person(
      "## Facts\n\n- [preference] likes hotpot (stated 2026-01-02)\n\n## Timeline\n\n- 2026-01-01 — arrived\n- 2026-01-02 — settled\n",
    );
    const findings = lint(draft, { base });
    const row = findings.find((f) => f.ruleId === "claims-transition");
    assert.notEqual(row, undefined, JSON.stringify(ids(findings)));
    assert.equal(row?.severity, "error", "the transition arm's default is error, not warning");
    assert.equal(row?.details?.["class"], "supersede");
  });

  it("claims-transition says nothing when the claim lands in History", () => {
    const draft = person(
      "## Facts\n\n- [preference] likes hotpot (stated 2026-01-02)\n\n## Timeline\n\n- 2026-01-01 — arrived\n- 2026-01-02 — settled\n\n## History\n\n- 2026-01-03: retired the [identity] claim — full name: Ada\n",
    );
    assert.equal(ids(lint(draft, { base })).includes("claims-transition"), false);
  });

  it("entry-mutated: an append-only entries section whose base entry changed", () => {
    const draft = person(
      "## Facts\n\n- [identity] full name: Ada (stated 2026-01-01)\n- [preference] likes hotpot (stated 2026-01-02)\n\n## Timeline\n\n- 2026-01-01 — arrived (reworded)\n- 2026-01-02 — settled\n",
    );
    const findings = lint(draft, { base });
    const row = findings.find((f) => f.ruleId === "entry-mutated");
    assert.notEqual(row, undefined, JSON.stringify(ids(findings)));
    assert.equal(row?.severity, "error");
    assert.equal(typeof row?.line, "number", "the finding points at the line that moved");
  });

  it("appending to an append-only section is legal", () => {
    const draft = person(
      "## Facts\n\n- [identity] full name: Ada (stated 2026-01-01)\n- [preference] likes hotpot (stated 2026-01-02)\n\n## Timeline\n\n- 2026-01-01 — arrived\n- 2026-01-02 — settled\n- 2026-01-03 — moved on\n",
    );
    assert.equal(ids(lint(draft, { base })).includes("entry-mutated"), false);
  });

  it("neither arm fires without a base — a diff-gated arm has no verdict to give", () => {
    const draft = person("## Facts\n\n- [preference] likes hotpot (stated 2026-01-02)\n");
    const findings = ids(lint(draft));
    assert.equal(findings.includes("claims-transition"), false);
    assert.equal(findings.includes("entry-mutated"), false);
  });
});

describe("`requires` on a shape absorbs conditional-required (field-shape)", () => {
  const withFields = (): Json =>
    constitution({
      types: {
        org: { extends: "concept", description: "An organisation." },
        // `owned_by.not_on.types` names a real type, so the replacement type set
        // keeps `self` — the selector is resolved at load, not at lint.
        self: { extends: "concept", description: "The owner's hub." },
        pinned: {
          extends: "reference",
          description: "Carries a pin and its capture date.",
          fields: {
            pin: { kind: "string" },
            captured_at: { kind: "date", requires: ["pin"] },
          },
        },
      },
    });

  it("the field is required exactly when the field it names is present", () => {
    const registry = registryOf(withFields());
    const withPin =
      "---\ntype: pinned\ntitle: P\ndescription: d\ntags: []\npin: abc123\n---\n\nbody\n";
    const findings = lint(withPin, { registry, path: "wiki/P.md" });
    assert.equal(
      findings.some((f) => f.ruleId === "field-shape" && f.message.includes("captured_at")),
      true,
      JSON.stringify(ids(findings)),
    );
    const withoutPin = "---\ntype: pinned\ntitle: P\ndescription: d\ntags: []\n---\n\nbody\n";
    assert.equal(
      ids(lint(withoutPin, { registry, path: "wiki/P.md" })).includes("field-shape"),
      false,
    );
  });
});

const TAGS = {
  mode: "registered",
  entries: { hubs: { description: "A routing page." } },
};

const VOCAB_CONSTITUTION: Json = {
  schema: "wikiwright/constitution",
  schema_version: 3,
  vocabularies: {
    tags: TAGS,
    categories: {
      mode: "registered",
      entries: {
        identity: { class: "supersede", aliases: ["ident"], description: "Who it is." },
        gone: {
          class: "supersede",
          status: "retired",
          replaced_by: ["identity"],
          description: "Retired.",
        },
      },
    },
    relations: {
      mode: "registered",
      entries: {
        knows: { aliases: ["acquainted_with"], description: "Acquaintance." },
        formerly_knew: {
          status: "retired",
          replaced_by: ["knows"],
          description: "Retired.",
        },
      },
    },
  },
  types: {
    org: { extends: "concept", description: "An organisation." },
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

describe("the alias and retirement laws bite on authored values", () => {
  const registry = (): FlattenedRegistry => registryOf(VOCAB_CONSTITUTION);

  it("an authored category alias is an error naming the canonical entry", () => {
    const findings = lint(person("## Facts\n\n- [ident] full name: Ada\n"), {
      registry: registry(),
    });
    const row = findings.find((f) => f.ruleId === "vocabulary-alias-target");
    assert.notEqual(row, undefined, JSON.stringify(ids(findings)));
    assert.equal(row?.severity, "error");
    assert.match(row?.message ?? "", /identity/, "the message names the canonical entry");
  });

  it("an authored retired category is an error naming its replacement", () => {
    const findings = lint(person("## Facts\n\n- [gone] full name: Ada\n"), {
      registry: registry(),
    });
    const row = findings.find((f) => f.ruleId === "vocabulary-retired");
    assert.notEqual(row, undefined, JSON.stringify(ids(findings)));
    assert.equal(row?.severity, "error");
    assert.match(row?.message ?? "", /identity/, "the message names replaced_by");
  });

  it("the canonical, active category says nothing", () => {
    const findings = lint(person("## Facts\n\n- [identity] full name: Ada\n"), {
      registry: registry(),
    });
    assert.equal(ids(findings).includes("vocabulary-alias-target"), false);
    assert.equal(ids(findings).includes("vocabulary-retired"), false);
  });

  it("an authored relation-label alias is an error", () => {
    const findings = lint(person("## Relations\n\n- acquainted_with [[Acme]]\n"), {
      registry: registry(),
    });
    assert.equal(
      ids(findings).includes("vocabulary-alias-target"),
      true,
      JSON.stringify(ids(findings)),
    );
    // Resolving the alias is what made this silent: the range check saw `knows`.
    assert.equal(ids(findings).includes("unknown-label"), false, "the alias still resolves");
  });

  it("an authored retired relation label is an error", () => {
    const findings = lint(person("## Relations\n\n- formerly_knew [[Acme]]\n"), {
      registry: registry(),
    });
    assert.equal(ids(findings).includes("vocabulary-retired"), true, JSON.stringify(ids(findings)));
  });

  it("a section's `severity` does not move either law", () => {
    // Both are fixed errors: an alias that resolves silently is a vocabulary
    // with two names for one thing, whatever the section says.
    const quiet = structuredClone(VOCAB_CONSTITUTION) as Json;
    const types = quiet["types"] as Record<string, Record<string, Json>>;
    const sections = types["person"]?.["sections"] as { list: Json[] };
    sections.list[0] = { ...(sections.list[0] as Json), severity: "warning" };
    const findings = lint(person("## Facts\n\n- [ident] full name: Ada\n"), {
      registry: registryOf(quiet),
    });
    const row = findings.find((f) => f.ruleId === "vocabulary-alias-target");
    assert.equal(row?.severity, "error");
  });
});

describe("the mode axis governs the unknown-entry arm only", () => {
  const census: Json = {
    schema: "wikiwright/constitution",
    schema_version: 3,
    vocabularies: {
      tags: TAGS,
      relations: { mode: "census", entries: { knows: { range: ["person"] } } },
    },
    types: {
      org: { extends: "concept", description: "An organisation." },
      person: {
        extends: "concept",
        description: "One human being.",
        sections: {
          depth: 2,
          list: [{ heading: "Relations", grammar: "relations", vocabulary: "relations" }],
        },
      },
    },
  };

  it("an unknown label under `census` is counted, never rejected", () => {
    const findings = lint(person("## Relations\n\n- schemes_with [[Acme]]\n"), {
      registry: registryOf(census),
    });
    assert.equal(ids(findings).includes("unknown-label"), false, JSON.stringify(ids(findings)));
  });

  it("a `range` declared ON a known entry is checked in census mode too", () => {
    // The mode table's column is headed "Unknown entry in use"; `knows` is
    // known and someone declared its range deliberately.
    const findings = lint(person("## Relations\n\n- knows [[Acme]]\n"), {
      registry: registryOf(census),
    });
    assert.equal(ids(findings).includes("relation-range"), true, JSON.stringify(ids(findings)));
  });
});

describe("the v3 transition arm reads the parser options", () => {
  const bundle: Json = {
    schema: "wikiwright/constitution",
    schema_version: 3,
    vocabularies: {
      tags: TAGS,
      categories: {
        mode: "registered",
        entries: { identity: { class: "supersede", description: "Who it is." } },
      },
    },
    types: {
      person: {
        extends: "concept",
        description: "One human being.",
        sections: {
          depth: 2,
          list: [
            {
              heading: "Facts",
              grammar: "claims",
              vocabulary: "categories",
              history: "History",
            },
            { heading: "History", grammar: "claims", role: "history" },
          ],
        },
      },
    },
  };

  const base = person("## Facts\n\n- [identity] full name: Ada\n\n## History\n");
  const annotated = person("## Facts\n\n- [identity] full name: Ada (raw/web/x)\n\n## History\n");

  it("a bare-path marker added under a declared root is not a changed claim", () => {
    // The marker leaves the claim's CORE, so the fact did not move. Parsing the
    // transition arm without the bundle's options gives the page two identities
    // and fires `claims-transition` on a claim nobody edited.
    const findings = lint(annotated, {
      registry: registryOf(bundle),
      base,
      sourceRoots: ["raw"],
    });
    assert.equal(
      ids(findings).includes("claims-transition"),
      false,
      `the claim survived; got ${JSON.stringify(ids(findings))}`,
    );
  });

  it("with no declared root the same token is core text, and the claim did change", () => {
    // The control: without `source_roots` the path IS part of the value, so the
    // arm is right to fire. This is what makes the case above a real difference.
    const findings = lint(annotated, { registry: registryOf(bundle), base });
    assert.equal(ids(findings).includes("claims-transition"), true, JSON.stringify(ids(findings)));
  });

  it("a genuinely deleted claim still fires with the options in hand", () => {
    const emptied = person("## Facts\n\n## History\n");
    const findings = lint(emptied, {
      registry: registryOf(bundle),
      base,
      sourceRoots: ["raw"],
    });
    assert.equal(ids(findings).includes("claims-transition"), true, JSON.stringify(ids(findings)));
  });
});

// An rtl-module must carry `implements [[REQ]]` OR `diverges-from [[REQ]]`
// — a module that does neither is the untraced artifact a program wiki exists
// to catch. One row over a label SET; one label is the one-element case.
describe("`require` over a label set (relation-require)", () => {
  const registry = registryOf(
    constitution({
      vocabularies: {
        tags: { mode: "registered", entries: {} },
        relations: {
          mode: "registered",
          entries: {
            implements: { description: "implements" },
            "diverges-from": { description: "diverges from" },
            "traces-to": { description: "traces to" },
          },
        },
      },
      types: {
        module: {
          extends: "reference",
          description: "One module.",
          sections: {
            depth: 2,
            list: [
              {
                heading: "Relations",
                grammar: "relations",
                vocabulary: "relations",
                require: [
                  { labels: ["traces-to"], min: 1 },
                  { labels: ["implements", "diverges-from"], min: 1, max: 2 },
                ],
              },
            ],
          },
        },
      },
    }),
  );
  const module = (relations: readonly string[]): string =>
    `---\ntype: module\ntitle: Core\ndescription: m.\ntags: []\n---\n\n## Relations\n\n${relations
      .map((r) => `- ${r} [[Acme]]`)
      .join("\n")}\n`;
  const requires = (relations: readonly string[]) =>
    lint(module(relations), { registry, path: "wiki/Core.md" }).filter(
      (f) => f.ruleId === "relation-require",
    );

  it("either label satisfies the set; neither fires once, naming both", () => {
    assert.deepEqual(requires(["traces-to", "implements"]), []);
    assert.deepEqual(requires(["traces-to", "diverges-from"]), []);
    const neither = requires(["traces-to"]);
    assert.equal(neither.length, 1);
    assert.equal(
      neither[0]?.message,
      'section "Relations" carries 0 relation(s) labelled implements or diverges-from; at least 1 required',
    );
    assert.deepEqual(neither[0]?.details, {
      section: "Relations",
      labels: "implements, diverges-from",
      count: 0,
    });
    assert.equal(
      neither[0]?.remediation,
      "write a relation labelled implements or diverges-from, or relax the section's `require` through review",
    );
  });

  it("the count is over the whole set, and `max` bounds it", () => {
    const over = requires(["traces-to", "implements", "implements", "diverges-from"]);
    assert.equal(over.length, 1);
    assert.equal(
      over[0]?.message,
      'section "Relations" carries 3 relation(s) labelled implements or diverges-from; at most 2 required',
    );
  });

  it("each row is its own finding, keyed by its own label set", () => {
    const both = requires([]);
    assert.equal(both.length, 2);
    const digests = new Set(both.map((f) => f.evidenceDigest));
    assert.equal(digests.size, 2, "two rows, two waivable evidence keys");
  });
});
