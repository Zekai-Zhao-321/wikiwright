// docs/constitution.md §Sections (min defaults to 0; max 0 is the forbidden
// form; header identity binds before depth — `section-depth`; entries carry
// `aliases` compared by normalizeIdentity; sections are union-append-only; an
// inherited alias may not be dropped).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { EffectiveType } from "../src/index.ts";
import { grammarBindings, lintPage } from "../src/lint/index.ts";
import { parseDoc } from "../src/parse/index.ts";
import type { FlattenedRegistry } from "../src/registry/index.ts";
import { constitutionOf, loadOf } from "./helpers/constitution.ts";

function registryWith(types: Record<string, unknown>): FlattenedRegistry {
  return constitutionOf({ types });
}

function lint(registry: FlattenedRegistry, body: string, type = "note") {
  const doc = parseDoc(`---\ntype: ${type}\ntitle: T\ndescription: d.\ntags: []\n---\n\n${body}`);
  return lintPage({ path: "wiki/t.md", doc, registry });
}

function noteWith(sections: unknown): FlattenedRegistry {
  return registryWith({ note: { extends: "concept", description: "A note.", sections } });
}

describe("min defaults to 0 — declaring a bound is not declaring an obligation", () => {
  it("an entry with only a max never reports a missing section (the SE3 case)", () => {
    const registry = noteWith({ list: [{ heading: "Changelog", max: 1 }] });
    const findings = lint(registry, "# T\n\nBody with no Changelog.\n");
    assert.deepEqual(
      findings.filter((f) => f.ruleId === "sections"),
      [],
    );
  });

  it("min: 1 still reports the section as missing, by name and with its declarer", () => {
    const registry = noteWith({ list: [{ heading: "Changelog", min: 1 }] });
    const f = lint(registry, "# T\n\nBody.\n").find((x) => x.ruleId === "sections");
    assert.notEqual(f, undefined);
    assert.equal(f?.severity, "error");
    assert.match(f?.message ?? "", /Changelog/);
    assert.equal(f?.contributedBy, "note");
  });
});

describe("max: 0 is the forbidden form", () => {
  const registry = noteWith({ list: [{ heading: "Timeline", max: 0 }] });

  it("an occurrence is a sections error naming the declaring type", () => {
    const f = lint(registry, "# T\n\n## Timeline\n2026-09-02: x\n").find(
      (x) => x.ruleId === "sections",
    );
    assert.notEqual(f, undefined);
    assert.equal(f?.severity, "error");
    assert.match(f?.message ?? "", /Timeline/);
    assert.match(f?.message ?? "", /not allowed|forbid/i);
    assert.equal(f?.contributedBy, "note", "the finding names the type that declared it");
    assert.equal(typeof f?.line, "number", "and the line the heading sits on");
  });

  it("its absence is clean — max: 0 forbids, it never requires", () => {
    assert.deepEqual(
      lint(registry, "# T\n\nBody.\n").filter((f) => f.ruleId === "sections"),
      [],
    );
  });

  // docs/constitution.md §Sections — forbidden-ness is a property of the declared
  // identity, so the depth rule does not preempt it. Reporting `### Timeline` as
  // section-depth tells the author to re-level a heading the type forbids at any
  // level, and the forbidden finding never speaks.
  it("forbids at any depth, not only at the declared one", () => {
    const findings = lint(registry, "# T\n\n## Notes\n\n### Timeline\n2026-09-02: x\n");
    const forbidden = findings.find((f) => f.ruleId === "sections");
    assert.notEqual(forbidden, undefined, JSON.stringify(findings));
    assert.match(forbidden?.message ?? "", /not allowed|forbid/i);
    assert.deepEqual(
      findings.filter((f) => f.ruleId === "section-depth"),
      [],
      "no instruction to re-level a heading this type does not allow",
    );
  });

  it("a child may not declare max: 0 under an inherited min: 1", () => {
    const result = loadOf({
      types: {
        parent: {
          extends: "concept",
          description: "p.",
          sections: { list: [{ heading: "Facts", min: 1 }] },
        },
        child: {
          extends: "parent",
          description: "c.",
          sections: { list: [{ heading: "Facts", max: 0 }] },
        },
      },
    });
    assert.equal(result.ok, false);
  });
});

describe("header identity binds before depth (section-depth)", () => {
  const registry = noteWith({ list: [{ heading: "Facts", min: 1 }], additional: false });

  it("a declared heading at the wrong depth is section-depth, with its line", () => {
    const body = "# T\n\n### Facts\n- a fact\n";
    const findings = lint(registry, body);
    const depth = findings.find((f) => f.ruleId === "section-depth");
    assert.notEqual(depth, undefined, JSON.stringify(findings));
    assert.equal(depth?.severity, "error");
    // Six frontmatter lines, a blank, then the body: the finding points at the
    // offending heading, not at the page.
    const expected = `---\ntype: note\ntitle: T\ndescription: d.\ntags: []\n---\n\n${body}`
      .split("\n")
      .indexOf("### Facts");
    assert.equal(depth?.line, expected + 1, "the heading's own line");
    assert.match(depth?.message ?? "", /Facts/);
  });

  it("it counts as the occurrence: no missing-section finding beside it", () => {
    const findings = lint(registry, "# T\n\n### Facts\n- a fact\n");
    assert.deepEqual(
      findings.filter((f) => f.ruleId === "sections"),
      [],
      "present-but-malformed reports its defect, never falls through to missing",
    );
  });

  it("an undeclared deeper heading stays exempt — it belongs to its enclosing section", () => {
    const findings = lint(registry, "# T\n\n## Facts\n\n### Detail\nd\n");
    assert.deepEqual(
      findings.filter((f) => f.ruleId === "section-depth" || f.ruleId === "sections"),
      [],
    );
  });
});

// docs/constitution.md §Sections — unreachability is judged over the EFFECTIVE
// list. A child heading claiming an identity the parent already claimed as an
// alias loaded clean, and the first-wins matcher then reported a page carrying
// the required heading as missing it.
describe("an inherited alias may not be re-claimed by a child heading", () => {
  const types = {
    parent: {
      extends: "concept",
      description: "p.",
      sections: { list: [{ heading: "Notes", min: 0, aliases: ["备注"] }] },
    },
    child: {
      extends: "parent",
      description: "c.",
      sections: { list: [{ heading: "备注", min: 1 }] },
    },
  };

  it("is a load error, not a page that can never satisfy its own type", () => {
    const result = loadOf({ types });
    assert.equal(result.ok, false, "the collision is unreachable in the effective list");
    if (!result.ok) {
      assert.equal(
        result.issues.some((i) => i.code === "sections-unreachable"),
        true,
        JSON.stringify(result.issues),
      );
    }
  });

  it("a collision reported once is reported once", () => {
    const result = loadOf({
      types: {
        note: {
          extends: "concept",
          description: "n.",
          sections: { list: [{ heading: "Notes", aliases: ["Log"] }, { heading: "Log" }] },
        },
      },
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      const unreachable = result.issues.filter((i) => i.code === "sections-unreachable");
      assert.equal(unreachable.length, 1, JSON.stringify(unreachable));
    }
  });
});

describe("section entries carry aliases (normalizeIdentity, both scripts)", () => {
  const registry = noteWith({
    list: [{ heading: "Notes", min: 1, aliases: ["备注"] }],
  });

  it("an aliased heading satisfies the entry", () => {
    assert.deepEqual(
      lint(registry, "# T\n\n## 备注\nn\n").filter((f) => f.ruleId === "sections"),
      [],
    );
  });

  it("the canonical heading still satisfies it", () => {
    assert.deepEqual(
      lint(registry, "# T\n\n## Notes\nn\n").filter((f) => f.ruleId === "sections"),
      [],
    );
  });

  it("an aliased heading at the wrong depth is section-depth, named by the canonical heading", () => {
    const f = lint(registry, "# T\n\n### 备注\nn\n").find((x) => x.ruleId === "section-depth");
    assert.notEqual(f, undefined);
    assert.match(f?.message ?? "", /Notes/);
  });

  it("an alias is not additional when additional is false", () => {
    const closed = noteWith({
      additional: false,
      list: [{ heading: "Notes", min: 1, aliases: ["备注"] }],
    });
    assert.deepEqual(
      lint(closed, "# T\n\n## 备注\nn\n").filter((f) => f.ruleId === "sections"),
      [],
    );
  });
});

// ---------------------------------------------------------------------------
// docs/constitution.md §Sections (the effective section list, as parser bindings)
// — `grammarBindings` is the ONE compiler from an effective
// type to `SectionBinding[]`, exported so that every reader of a page's grammar
// sees the same one and a grammar parameter cannot be honoured by one copy and
// missed by another.

describe("grammarBindings — one compiler from an effective type to parser bindings", () => {
  it("core exports it, and it carries every declared grammar parameter through", () => {
    assert.equal(typeof grammarBindings, "function");
    const registry = constitutionOf({
      vocabularies: { categories: { mode: "census" }, relations: { mode: "census" } },
      types: {
        note: {
          extends: "concept",
          description: "A note.",
          sections: {
            depth: 2,
            list: [
              {
                heading: "Facts",
                grammar: "claims",
                aliases: ["事实"],
                history: "History",
                provenance: "required",
                forms: ["stated"],
                vocabulary: "categories",
              },
              { heading: "History", grammar: "claims", role: "history" },
              { heading: "Timeline", grammar: "entries", date: "required" },
              { heading: "Relations", grammar: "relations", vocabulary: "relations" },
              { heading: "Notes" },
            ],
          },
        },
      },
    });
    const effective = registry.types.get("note");
    assert.notEqual(effective, undefined);
    const bindings = grammarBindings(effective as EffectiveType, registry.modules);
    assert.deepEqual(
      bindings.map((b) => [b.heading, b.depth, b.grammar]),
      [
        ["Facts", 2, "claims"],
        ["History", 2, "claims"],
        ["Timeline", 2, "entries"],
        ["Relations", 2, "relations"],
        ["Notes", 2, "prose"],
      ],
    );
    const facts = bindings[0];
    assert.deepEqual(facts?.aliases, ["事实"]);
    assert.equal(facts?.params["history"], "History");
    assert.equal(facts?.params["provenance"], "required");
    assert.deepEqual(facts?.params["forms"], ["stated"]);
    assert.equal(facts?.params["vocabulary"], "categories");
    assert.equal(bindings[1]?.params["role"], "history");
    assert.equal(bindings[2]?.params["date"], "required");
    assert.equal(bindings[3]?.params["vocabulary"], "relations");
    assert.equal(typeof facts?.contributedBy, "string");
  });

  it("a type that declares no sections compiles to no bindings", () => {
    const registry = registryWith({ note: { extends: "concept", description: "A note." } });
    assert.deepEqual(
      grammarBindings(registry.types.get("note") as EffectiveType, registry.modules),
      [],
    );
  });
});

// ---------------------------------------------------------------------------
// docs/constitution.md §Sections (matcher: order, occurrence counts, header-identity
// binding, depth alphabet) · docs/constitution.md §Types budget (max_chars
// over NFC, warning severity).

const RUNBOOK = {
  runbook: {
    extends: "procedure",
    description: "A runbook.",
    sections: {
      ordered: true,
      // Min defaults to 0, so a required section says so; "Rollback"
      // declares a max WITHOUT a min and is therefore optional-but-capped —
      // the SE3 shape that used to mean "required" by accident.
      list: [
        { heading: "Purpose", min: 1 },
        { heading: "Steps", min: 1 },
        { heading: "Rollback", max: 1 },
      ],
    },
  },
};

const ids = (findings: ReturnType<typeof lintPage>): string[] => findings.map((f) => f.ruleId);

describe("the sections matcher", () => {
  const registry = registryWith(RUNBOOK);
  const closed = registryWith({
    runbook: {
      ...RUNBOOK.runbook,
      sections: { ...RUNBOOK.runbook.sections, additional: false },
    },
  });

  it("passes a page whose sections appear complete and in order", () => {
    const findings = lint(
      registry,
      "# T\n\n## Purpose\np\n\n## Steps\ns\n\n## Rollback\nr\n",
      "runbook",
    );
    assert.deepEqual(
      ids(findings).filter((i) => i === "sections"),
      [],
    );
  });

  it("reports a missing required section by name", () => {
    const findings = lint(registry, "# T\n\n## Purpose\np\n\n## Rollback\nr\n", "runbook");
    const f = findings.find((x) => x.ruleId === "sections" && x.message.includes("Steps"));
    assert.notEqual(f, undefined);
    assert.equal(f?.severity, "error");
  });

  it("reports an order violation when ordered is true — as an order defect, not a missing section", () => {
    const findings = lint(
      registry,
      "# T\n\n## Steps\ns\n\n## Purpose\np\n\n## Rollback\nr\n",
      "runbook",
    );
    const f = findings.find((x) => x.ruleId === "sections");
    assert.notEqual(f, undefined);
    assert.match(f?.message ?? "", /order/i);
  });

  it("counts total occurrences against max", () => {
    const findings = lint(
      registry,
      "# T\n\n## Purpose\np\n\n## Steps\ns\n\n## Rollback\nr1\n\n## Rollback\nr2\n",
      "runbook",
    );
    const f = findings.find((x) => x.ruleId === "sections" && x.message.includes("Rollback"));
    assert.notEqual(f, undefined);
  });

  it("deeper headings belong to their enclosing section — exempt from ordering and additional", () => {
    const findings = lint(
      closed,
      "# T\n\n## Purpose\np\n\n### Detail\nd\n\n## Steps\ns\n\n## Rollback\nr\n",
      "runbook",
    );
    assert.deepEqual(
      ids(findings).filter((i) => i === "sections"),
      [],
    );
  });

  it("flags an undeclared section when additional is false", () => {
    const findings = lint(
      closed,
      "# T\n\n## Purpose\np\n\n## Steps\ns\n\n## Rollback\nr\n\n## Stray\nx\n",
      "runbook",
    );
    const f = findings.find((x) => x.ruleId === "sections" && x.message.includes("Stray"));
    assert.notEqual(f, undefined);
  });

  it("min: 0 sections are optional", () => {
    const optional = registryWith({
      runbook: {
        ...RUNBOOK.runbook,
        sections: {
          ordered: true,
          list: [
            { heading: "Purpose", min: 1 },
            { heading: "Runs", min: 0 },
          ],
        },
      },
    });
    const findings = lint(optional, "# T\n\n## Purpose\np\n", "runbook");
    assert.deepEqual(
      ids(findings).filter((i) => i === "sections"),
      [],
    );
  });
});

describe("budgets: max-chars over NFC", () => {
  it("emits a warning when a section exceeds its max_chars, counting code points over NFC", () => {
    const registry = noteWith({ depth: 2, list: [{ heading: "Body", min: 1, max_chars: 120 }] });
    const under = lint(registry, "# T\n\n## Body\n\n短.\n");
    assert.deepEqual(
      ids(under).filter((i) => i === "max-chars"),
      [],
    );
    const over = lint(registry, `# T\n\n## Body\n\n${"很长的内容".repeat(30)}\n`);
    const f = over.find((x) => x.ruleId === "max-chars");
    assert.notEqual(f, undefined, JSON.stringify(ids(over)));
    assert.equal(f?.severity, "warning");
  });
});

describe("the title line is not a section (docs/constitution.md §Sections)", () => {
  const layout = noteWith({ depth: 2, list: [{ heading: "Layout", min: 1, max: 1 }] });
  const rules = (findings: readonly { ruleId: string }[]) =>
    findings
      .filter((f) => f.ruleId === "sections" || f.ruleId === "section-depth")
      .map((f) => f.ruleId);

  it("a page titled like its own section is clean: `# Layout` over `## Layout`", () => {
    assert.deepEqual(rules(lint(layout, "# Layout\n\n## Layout\n\nThe tree.\n")), []);
  });

  it("a later depth-1 heading participates, and is the wrong depth", () => {
    const findings = lint(layout, "# Page\n\nBody.\n\n# Layout\n\nAt the wrong depth.\n");
    assert.deepEqual(rules(findings), ["section-depth"]);
  });

  it("the title takes no part in the forbidden rule either", () => {
    const forbidden = noteWith({ depth: 2, list: [{ heading: "Vibes", max: 0 }] });
    assert.deepEqual(rules(lint(forbidden, "# Vibes\n\nA page named Vibes.\n")), []);
    assert.deepEqual(rules(lint(forbidden, "# Vibes\n\n## Vibes\n\nStill forbidden.\n")), [
      "sections",
    ]);
  });

  it("at depth 1 the first heading is a section like any other", () => {
    const flat = noteWith({ depth: 1, list: [{ heading: "Layout", min: 1, max: 1 }] });
    assert.deepEqual(rules(lint(flat, "# Layout\n\nThe tree.\n")), []);
    assert.deepEqual(rules(lint(flat, "# Elsewhere\n\nNo layout.\n")), ["sections"]);
  });
});
