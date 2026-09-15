// docs/concepts.md §Generated artifacts (derived relation counts as the
// baseline on the relation axis; depth-1 inbound/outbound adjacency so jq
// covers the common graph asks)
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateArtifacts } from "../src/generate/index.ts";
import { standardLibrary } from "../src/index.ts";
import { buildNameIndex } from "../src/names/index.ts";
import { parseDoc } from "../src/parse/index.ts";
import { loadConstitution } from "../src/registry/index.ts";
import { searchPages } from "../src/search/index.ts";
import { constitutionOf } from "./helpers/constitution.ts";

const REGISTRY = constitutionOf({ tags: { reset: { description: "Reset topics." } } });

const PAGES = [
  {
    path: "wiki/alpha.md",
    doc: parseDoc(
      "---\ntype: concept\ntitle: Alpha\ndescription: a.\ntags: [reset]\n---\n\n# Alpha\n\nSee [[Beta]] and [[Cap]].\n",
    ),
  },
  {
    path: "wiki/Beta.md",
    doc: parseDoc("---\ntype: concept\ntitle: Beta\ndescription: b.\ntags: []\n---\n\n# Beta\n"),
  },
  {
    path: "raw/cap.md",
    doc: parseDoc("---\ntype: reference\ntitle: Cap\ndescription: c.\ntags: []\n---\n\n# Cap\n"),
  },
];

/** `raw/` is a declared source root: a body link into it is a `cites` edge. */
const SOURCE_ROOTS = { sourceRoots: ["raw"] };

function manifestOf(): Record<string, unknown> {
  const plans = generateArtifacts(REGISTRY, PAGES, undefined, SOURCE_ROOTS);
  const manifest = plans.find((p) => p.path === "generated/manifest.json");
  if (manifest === undefined) throw new Error("no manifest plan");
  return JSON.parse(manifest.content) as Record<string, unknown>;
}

describe("manifest additions (docs/concepts.md §Generated artifacts)", () => {
  it("carries edge counts by kind that reconcile exactly with the graph's edges", () => {
    const manifest = manifestOf();
    const byKind = manifest["by_kind"] as Record<string, number>;
    assert.equal(byKind["wikilink"], 1);
    assert.equal(byKind["tagged"], 1);
    assert.equal(byKind["cites"], 1);
    assert.equal(manifest["relations"], undefined, "the misnamed block is gone");
    assert.deepEqual(manifest["by_label"], {}, "no labelled kind: no labels to count");

    const totals = manifest["totals"] as Record<string, number>;
    assert.equal(totals["pages"], 3);
    const sum = Object.values(byKind).reduce((a, b) => a + b, 0);
    assert.equal(totals["edges"], sum, "fail-closed reconciliation: counts sum to totals");

    const plans = generateArtifacts(REGISTRY, PAGES, undefined, SOURCE_ROOTS);
    const graph = JSON.parse(
      plans.find((p) => p.path === "generated/graph.json")?.content ?? "{}",
    ) as { edges: Array<{ kind: string }> };
    assert.equal(graph.edges.length, totals["edges"], "manifest totals match the graph");
  });

  it("gives each page deviation-only inbound/outbound adjacency keyed by edge kind", () => {
    const manifest = manifestOf();
    const pages = manifest["pages"] as Array<Record<string, unknown>>;
    const alpha = pages.find((p) => p["path"] === "wiki/alpha.md");
    const beta = pages.find((p) => p["path"] === "wiki/Beta.md");
    const cap = pages.find((p) => p["path"] === "raw/cap.md");

    const alphaOut = alpha?.["outbound"] as Record<string, string[]>;
    assert.deepEqual(alphaOut["wikilink"], ["wiki/Beta.md"]);
    assert.deepEqual(alphaOut["cites"], ["raw/cap.md"]);

    const betaIn = beta?.["inbound"] as Record<string, string[]>;
    assert.deepEqual(betaIn["wikilink"], ["wiki/alpha.md"]);
    assert.equal(beta?.["outbound"], undefined, "no outbound edges → no outbound key");
    assert.equal(beta?.["out"], undefined, "the documented key names, not `out`/`in`");
    assert.equal(alpha?.["in"], undefined);

    const capIn = cap?.["inbound"] as Record<string, string[]>;
    assert.deepEqual(capIn["cites"], ["wiki/alpha.md"]);
  });

  it("tag edges count in by_kind but never enter page adjacency (tags are not pages)", () => {
    const manifest = manifestOf();
    const pages = manifest["pages"] as Array<Record<string, unknown>>;
    const alpha = pages.find((p) => p["path"] === "wiki/alpha.md");
    const alphaOut = (alpha?.["outbound"] ?? {}) as Record<string, string[]>;
    assert.equal(alphaOut["tagged"], undefined);
  });
});

const FIELD_SOURCES = { title: "basename", description: "lede" } as const;

describe("derived fields reach manifest, graph, and search (docs/cli.md §lint: one resolved page model)", () => {
  const registry = REGISTRY;
  const pages = [
    {
      path: "wiki/张伟.md",
      doc: parseDoc("---\ntype: concept\ntags: []\n---\n\n# 张伟\n\nMom's friend from 昆明.\n"),
    },
  ];

  it("manifest and graph carry the derived title and description", () => {
    const plans = generateArtifacts(registry, pages, buildNameIndex(pages), {
      fieldSources: FIELD_SOURCES,
    });
    const manifest = JSON.parse(
      plans.find((p) => p.path === "generated/manifest.json")?.content ?? "{}",
    ) as { pages: Array<Record<string, unknown>> };
    const entry = manifest.pages[0];
    assert.equal(entry?.["title"], "张伟");
    assert.equal(entry?.["description"], "Mom's friend from 昆明.");

    const graph = JSON.parse(
      plans.find((p) => p.path === "generated/graph.json")?.content ?? "{}",
    ) as { nodes: Array<Record<string, unknown>> };
    const node = graph.nodes.find((n) => n["id"] === "wiki/张伟.md");
    assert.equal(node?.["title"], "张伟");
  });

  it("search title tiers see the derived title", () => {
    const outcome = searchPages(pages, "张伟", {}, 10, { fieldSources: FIELD_SOURCES });
    assert.equal(outcome.results.length > 0, true);
    assert.equal(outcome.results[0]?.path, "wiki/张伟.md");
  });
});

describe("manifest entries carry archetype and chain", () => {
  it("a derived type reports its archetype and its whole chain", () => {
    const registry = constitutionOf({
      types: { record: { extends: "reference", description: "R." } },
    });
    const pages = [
      {
        path: "wiki/r.md",
        doc: parseDoc("---\ntype: record\ntitle: R\ndescription: d.\ntags: []\n---\n\n# R\n"),
      },
    ];
    const plans = generateArtifacts(registry, pages, buildNameIndex(pages));
    const manifest = JSON.parse(
      plans.find((p) => p.path === "generated/manifest.json")?.content ?? "{}",
    ) as { pages: Array<Record<string, unknown>> };
    assert.equal(manifest.pages[0]?.["archetype"], "reference");
    assert.deepEqual(manifest.pages[0]?.["chain"], ["record", "reference"]);
  });
});

// docs/concepts.md §Generated artifacts: a relation item is a labelled edge. The graph carries it
// through the `edges` hook of the grammar that owns the item's kind, and the
// manifest counts it under `by_label` and nests the adjacency by label — which
// is what lets `jq` answer "which requirement has no `implements` inbound"
// without a second parser over the pages.
const LABELLED = (() => {
  const loaded = loadConstitution(
    {
      schema: "wikiwright/constitution",
      schema_version: 3,
      vocabularies: {
        tags: { mode: "registered", entries: {} },
        relations: {
          mode: "registered",
          entries: {
            implements: { description: "implements the target", range: ["requirement"] },
            knows: { description: "knows the target" },
          },
        },
      },
      types: {
        requirement: { extends: "reference", description: "One requirement." },
        module: {
          extends: "reference",
          description: "One module.",
          sections: {
            list: [{ heading: "Relations", grammar: "relations", vocabulary: "relations" }],
          },
        },
      },
    },
    standardLibrary(),
  );
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.issues));
  return loaded.registry;
})();

const req = (name: string) => ({
  path: `wiki/${name}.md`,
  doc: parseDoc(
    `---\ntype: requirement\ntitle: ${name}\ndescription: r.\ntags: []\n---\n\n# ${name}\n`,
  ),
});

function moduleWith(relations: readonly string[], name = "Core") {
  return {
    path: `wiki/${name}.md`,
    doc: parseDoc(
      `---\ntype: module\ntitle: ${name}\ndescription: m.\ntags: []\n---\n\n# ${name}\n\n## Relations\n\n${relations.map((r) => `- ${r}`).join("\n")}\n`,
    ),
  };
}

function artifactsOf(pages: ReturnType<typeof req>[]) {
  const plans = generateArtifacts(LABELLED, pages);
  const graph = JSON.parse(
    plans.find((p) => p.path === "generated/graph.json")?.content ?? "{}",
  ) as { edges: Array<{ from: string; to: string; kind: string; label?: string }> };
  const manifest = JSON.parse(
    plans.find((p) => p.path === "generated/manifest.json")?.content ?? "{}",
  ) as Record<string, unknown>;
  return { graph, manifest };
}

describe("labelled edges through the `edges` hook (docs/concepts.md §Generated artifacts)", () => {
  it("a relation line is an edge of the item's kind, carrying its label", () => {
    const { graph, manifest } = artifactsOf([
      req("REQ-1"),
      moduleWith(["implements [[REQ-1]]", "knows [[REQ-1]]"]),
    ]);
    assert.deepEqual(
      graph.edges.filter((e) => e.kind === "relation"),
      [
        { from: "wiki/Core.md", to: "wiki/REQ-1.md", kind: "relation", label: "implements" },
        { from: "wiki/Core.md", to: "wiki/REQ-1.md", kind: "relation", label: "knows" },
      ],
    );
    // The body's wikilink to the same page is a second, unlabelled edge: both
    // are true, and `--kind` tells them apart.
    assert.equal(
      graph.edges.some((e) => e.kind === "wikilink" && e.to === "wiki/REQ-1.md"),
      true,
    );
    assert.deepEqual(manifest["by_kind"], { relation: 2, wikilink: 1 });
    assert.deepEqual(manifest["by_label"], { relation: { implements: 1, knows: 1 } });
    const pages = manifest["pages"] as Array<Record<string, unknown>>;
    const core = pages.find((p) => p["path"] === "wiki/Core.md");
    const target = pages.find((p) => p["path"] === "wiki/REQ-1.md");
    assert.deepEqual(core?.["outbound"], {
      relation: { implements: ["wiki/REQ-1.md"], knows: ["wiki/REQ-1.md"] },
      wikilink: ["wiki/REQ-1.md"],
    });
    assert.deepEqual(target?.["inbound"], {
      relation: { implements: ["wiki/Core.md"], knows: ["wiki/Core.md"] },
      wikilink: ["wiki/Core.md"],
    });
  });

  it("the graph is a set: two identical lines are one edge, and a self-edge or a dangling target is none", () => {
    const { graph, manifest } = artifactsOf([
      req("REQ-1"),
      moduleWith([
        "implements [[REQ-1]]",
        "implements [[REQ-1]]",
        "knows [[Core]]",
        "knows [[Nope]]",
      ]),
    ]);
    assert.deepEqual(
      graph.edges.filter((e) => e.kind === "relation").map((e) => e.label),
      ["implements"],
    );
    assert.deepEqual(manifest["by_label"], { relation: { implements: 1 } });
  });

  it("label spelling is grouped by identity and printed once", () => {
    const { graph, manifest } = artifactsOf([
      req("REQ-1"),
      req("REQ-2"),
      moduleWith(["Implements [[REQ-1]]", "implements [[REQ-2]]"]),
    ]);
    assert.deepEqual(
      graph.edges.filter((e) => e.kind === "relation").map((e) => e.label),
      ["Implements", "Implements"],
    );
    assert.deepEqual(manifest["by_label"], { relation: { Implements: 2 } });
  });

  it("an edge carries no line: editing above the section leaves the artifact unchanged", () => {
    const before = artifactsOf([req("REQ-1"), moduleWith(["implements [[REQ-1]]"])]);
    const padded = {
      path: "wiki/Core.md",
      doc: parseDoc(
        "---\ntype: module\ntitle: Core\ndescription: m.\ntags: []\n---\n\n# Core\n\nA new paragraph.\n\nAnother.\n\n## Relations\n\n- implements [[REQ-1]]\n",
      ),
    };
    const after = artifactsOf([req("REQ-1"), padded]);
    assert.deepEqual(after.graph.edges, before.graph.edges);
  });
});
