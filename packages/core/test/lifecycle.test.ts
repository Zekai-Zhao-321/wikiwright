// docs/concepts.md (the accumulate and
// supersede laws are one `claims-transition` arm on a section with a `history`)
// docs/constitution.md §Types (the page-wide arm)
//
// The arms are scoped to the section a type declares, so the pages below carry
// the `## Facts` / `## History` sections the law names.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type ModuleManifest, standardLibrary } from "../src/index.ts";
import { lintPage } from "../src/lint/index.ts";
import { parseDoc } from "../src/parse/index.ts";
import { constitutionOf, loadOf } from "./helpers/constitution.ts";

/** A `fact` type whose Facts section reads a `categories` vocabulary of the given classes. */
function factLaw(classes: Record<string, string>) {
  const entries = Object.fromEntries(
    Object.entries(classes).map(([name, cls]) => [name, { class: cls }]),
  );
  return constitutionOf({
    vocabularies: { categories: { mode: "registered", entries } },
    types: {
      fact: {
        extends: "concept",
        description: "f.",
        sections: {
          depth: 2,
          list: [
            { heading: "Facts", grammar: "claims", history: "History", vocabulary: "categories" },
            { heading: "History", grammar: "claims", role: "history", vocabulary: "categories" },
          ],
        },
      },
    },
  });
}

function page(body: string, extraFm = ""): ReturnType<typeof parseDoc> {
  return parseDoc(`---\ntype: fact\ntitle: T\ndescription: d.\ntags: []\n${extraFm}---\n\n${body}`);
}

describe("accumulate: entries are content-immutable, structure re-organizable", () => {
  const registry = factLaw({ habit: "accumulate" });
  const base =
    "# T\n\n## Facts\n\n- [habit] prefers tea (stated 2026-08-01)\n- [habit] ordered coffee twice (stated 2026-08-15)\n\n## History\n";

  it("allows appends and pure reorganization (moved lines)", () => {
    const appended = lintPage(
      {
        path: "wiki/f.md",
        doc: page(
          base.replace(
            "\n\n## History\n",
            "\n- [habit] back to tea (stated 2026-09-01)\n\n## History\n",
          ),
        ),
        registry,
      },
      { baseText: page(base).source },
    );
    assert.equal(
      appended.some((f) => f.ruleId === "claims-transition"),
      false,
    );

    const moved = lintPage(
      {
        path: "wiki/f.md",
        doc: page(
          "# T\n\n## Facts\n\n- [habit] ordered coffee twice (stated 2026-08-15)\n- [habit] prefers tea (stated 2026-08-01)\n\n## History\n",
        ),
        registry,
      },
      { baseText: page(base).source },
    );
    assert.equal(
      moved.some((f) => f.ruleId === "claims-transition"),
      false,
    );
  });

  it("flags a removed or edited entry", () => {
    const removed = lintPage(
      {
        path: "wiki/f.md",
        doc: page("# T\n\n## Facts\n\n- [habit] prefers tea (stated 2026-08-01)\n\n## History\n"),
        registry,
      },
      { baseText: page(base).source },
    );
    assert.equal(
      removed.some((f) => f.ruleId === "claims-transition"),
      true,
    );

    const edited = lintPage(
      {
        path: "wiki/f.md",
        doc: page(
          "# T\n\n## Facts\n\n- [habit] prefers coffee (stated 2026-08-01)\n- [habit] ordered coffee twice (stated 2026-08-15)\n\n## History\n",
        ),
        registry,
      },
      { baseText: page(base).source },
    );
    assert.equal(
      edited.some((f) => f.ruleId === "claims-transition"),
      true,
    );
  });

  it("is silent without a base revision", () => {
    const findings = lintPage({ path: "wiki/f.md", doc: page(base), registry });
    assert.equal(
      findings.some((f) => f.ruleId === "claims-transition"),
      false,
    );
  });
});

describe("supersede: replacement demands a History entry", () => {
  const registry = factLaw({ address: "supersede", contact: "accumulate" });
  const base = "# T\n\n## Facts\n\n- [address] 100 Old Road (stated 2024-01-01)\n\n## History\n";

  it("flags a changed value when the History section did not grow", () => {
    const findings = lintPage(
      {
        path: "wiki/f.md",
        doc: page(
          "# T\n\n## Facts\n\n- [address] 8 New Street (stated 2026-09-01)\n\n## History\n",
        ),
        registry,
      },
      { baseText: page(base).source },
    );
    assert.equal(
      findings.some((f) => f.ruleId === "claims-transition"),
      true,
    );
  });

  it("passes when the replaced value lands in History with closed dates", () => {
    const findings = lintPage(
      {
        path: "wiki/f.md",
        doc: page(
          "# T\n\n## Facts\n\n- [address] 8 New Street (stated 2026-09-01)\n\n## History\n\n- [address] 100 Old Road (valid 2024-01-01→2026-09-01, superseded 2026-09-01)\n",
        ),
        registry,
      },
      { baseText: page(base).source },
    );
    assert.equal(
      findings.some((f) => f.ruleId === "claims-transition"),
      false,
    );
  });

  it("passes a pure append (nothing replaced) and is silent without a base", () => {
    const appended = lintPage(
      {
        path: "wiki/f.md",
        doc: page(
          "# T\n\n## Facts\n\n- [address] 100 Old Road (stated 2024-01-01)\n- [contact] 555 (stated 2026-09-01)\n\n## History\n",
        ),
        registry,
      },
      { baseText: page(base).source },
    );
    assert.equal(
      appended.some((f) => f.ruleId === "claims-transition"),
      false,
    );

    const noBase = lintPage({ path: "wiki/f.md", doc: page(base), registry });
    assert.equal(
      noBase.some((f) => f.ruleId === "claims-transition"),
      false,
    );
  });
});

describe("incompatible lifecycle laws fail at load", () => {
  it("a page-wide append-only law and a claims history on one type conflict", () => {
    const result = loadOf({
      types: {
        log: {
          extends: "reference",
          description: "l.",
          body: { lifecycle: "append-only" },
          sections: {
            depth: 2,
            list: [
              { heading: "Facts", grammar: "claims", history: "History" },
              { heading: "History", grammar: "claims", role: "history" },
            ],
          },
        },
      },
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      // The contradiction is structural: the transition arm requires the
      // rewrite the body arm forbids, and it is named for what it is.
      assert.equal(
        result.issues.some((i) => i.code === "body-lifecycle-conflict"),
        true,
        JSON.stringify(result.issues),
      );
    }
  });
});

describe("the starter constitutions carry the lifecycle law in v3", () => {
  // The four contracts are gone: v3 has no contracts and no checker names
  // (docs/constitution.md §config/constitution.json). What they carried is carried by the
  // vocabulary an entry belongs to and by the grammar a section declares, so
  // this test asks the starters for THAT, not for the retired surface.
  it("every shipped starter loads as v3 and names no checker", async () => {
    const { existsSync, readFileSync, readdirSync } = await import("node:fs");
    const { loadConstitution, loadModules, STANDARD_LIBRARY } = await import("@wikiwright/core");
    const root = new URL("../../cli/constitutions/", import.meta.url);
    // A starter that declares modules loads under the standard library plus
    // the kits it names (docs/extending.md §The code kit); the shipped kits are
    // workspace packages, named here by package so an unknown one fails by name.
    const KITS: Record<string, URL> = {
      "@wikiwright/kit-code": new URL("../../kit-code/index.js", import.meta.url),
    };
    for (const constitution of readdirSync(root)) {
      const file = new URL(`${constitution}/config/constitution.json`, root);
      const text = readFileSync(file, "utf8");
      const parsed = JSON.parse(text) as { schema_version: number };
      assert.equal(parsed.schema_version, 3, `${constitution} ships format v3`);
      for (const banned of ['"rules"', '"contracts"', '"checker"', '"fixability"']) {
        assert.equal(text.includes(banned), false, `${constitution} names ${banned}`);
      }
      const engineFile = new URL(`${constitution}/config/engine.json`, root);
      const declared = existsSync(engineFile)
        ? ((JSON.parse(readFileSync(engineFile, "utf8")) as { modules?: { package: string }[] })
            .modules ?? [])
        : [];
      const manifests = [...STANDARD_LIBRARY];
      for (const { package: name } of declared) {
        const kit = KITS[name];
        assert.notEqual(
          kit,
          undefined,
          `${constitution} declares a kit this suite cannot load: ${name}`,
        );
        const imported = (await import((kit as URL).href)) as { default: ModuleManifest };
        manifests.push(imported.default);
      }
      const composed = loadModules(manifests);
      assert.equal(composed.ok, true, `${constitution}'s modules compose`);
      if (!composed.ok) return;
      const result = loadConstitution(JSON.parse(text), composed.registry);
      assert.equal(
        result.ok,
        true,
        `${constitution} loads: ${result.ok ? "" : JSON.stringify(result.issues)}`,
      );
    }
  });

  it("a class map loads as a vocabulary whose entries carry `class`, journal-only included", async () => {
    const { readFileSync } = await import("node:fs");
    const { loadConstitution } = await import("@wikiwright/core");
    const file = new URL(
      "../../cli/test/fixtures/memory-law/config/constitution.json",
      import.meta.url,
    );
    const result = loadConstitution(JSON.parse(readFileSync(file, "utf8")), standardLibrary());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const categories = result.registry.vocabularies.get("categories");
    assert.notEqual(categories, undefined, "the memory law declares categories");
    const classes = [...(categories?.entries.values() ?? [])].map((e) => e.properties["class"]);
    assert.equal(classes.includes("supersede"), true);
    assert.equal(classes.includes("accumulate"), true);
    assert.equal(classes.includes("journal-only"), true);
  });
});
