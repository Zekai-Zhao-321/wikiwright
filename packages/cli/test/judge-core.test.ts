// v2 contracts §3, §3.1, §6, §10: the judge's kernel checks of a page over a
// gardening vault under os.tmpdir() — the bytes and the YAML, the type, the
// effective shape, the page references, the tags vocabulary, the links, the
// names, the instances and the rename — each with its §6 shape, its route
// and its coverage row.
import { afterAll, describe, expect, it } from "bun:test";
import { unroutableVerdictRows, VERDICT_TABLE } from "@wikiwright/core";
import { indexState } from "../src/lawstate.ts";
import { BASIL, git, gitCommitAll, HERB_BED } from "./fixtures/garden-judge.ts";
import { blocking, cleanUp, judgeState, judgeVault, only, vaultDir } from "./fixtures/judge-run.ts";

afterAll(cleanUp);

const TAGS = `vocabulary: tags
mode: registered
entries:
  herbs: { description: Herbs. }
  beds: { description: Beds. }
retired:
  kitchen: { since: 2026-01-01, successor: herbs }
`;

describe("a clean vault", () => {
  it("judges clean, and every page is counted", async () => {
    const verdict = await judgeVault();
    expect(blocking(verdict)).toEqual([]);
    expect(verdict.summary.pages).toBe(3);
    expect(verdict.coverage["page-shape-invalid"]).toEqual({
      evaluated: 3,
      not_applicable: 0,
      unevaluated: 0,
    });
  });
});

describe("a page as bytes and as YAML", () => {
  it.each([
    ["page-too-large", `---\ntype: guide\ntitle: Big\n---\n${"x".repeat(1024 * 1024)}`],
    ["malformed-frontmatter", "---\ntype: [guide\ntitle: Broken\n---\n"],
    ["duplicate-key", "---\ntype: guide\ntype: guide\ntitle: Twice\n---\n"],
    ["frontmatter-not-mapping", "---\n- a\n- b\n---\n"],
  ])("reports %s, and judges the page no further", async (rule, text) => {
    const verdict = await judgeVault({ "wiki/Odd.md": text });
    expect(verdict.findings.filter((f) => f.path === "wiki/Odd.md").map((f) => f.rule)).toEqual([
      rule,
    ]);
  });

  it("reports a page that is not UTF-8 as page-not-utf8", async () => {
    const dir = vaultDir();
    const { writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    writeFileSync(join(dir, "wiki/Latin.md"), Buffer.from([0x2d, 0x2d, 0x2d, 0x0a, 0xe9, 0x0a]));
    const { fsState } = await import("../src/lawstate.ts");
    const verdict = await judgeState(await fsState(dir));
    expect(only(verdict, "page-not-utf8").map((f) => f.path)).toEqual(["wiki/Latin.md"]);
  });

  it("names the line a frontmatter error sits on", async () => {
    const verdict = await judgeVault({ "wiki/Odd.md": "---\ntype: guide\ntype: guide\n---\n" });
    expect(only(verdict, "duplicate-key")[0]?.details).toMatchObject({ line: 3 });
  });
});

describe("the type", () => {
  it("reports a page with no type, and one whose type the law does not declare", async () => {
    const verdict = await judgeVault({
      "wiki/Bare.md": "# Bare\n",
      "wiki/Untyped.md": "---\ntitle: Untyped\n---\n",
      "wiki/Pond.md": "---\ntype: pond\ntitle: Pond\n---\n",
    });
    expect(only(verdict, "type-unknown").map((f) => [f.path, f.details["kind"]])).toEqual([
      ["wiki/Bare.md", "missing"],
      ["wiki/Pond.md", "unknown"],
      ["wiki/Untyped.md", "missing"],
    ]);
  });

  it("reports a page of an abstract type under the content roots", async () => {
    const verdict = await judgeVault({
      "wiki/Sage.md": BASIL.replace("type: planting", "type: garden/planting").replace(
        "source: https://seeds.example/basil\n",
        "",
      ),
    });
    expect(only(verdict, "abstract-type")).toMatchObject([
      { path: "wiki/Sage.md", details: { type: "garden/planting" }, queue: "type-review" },
    ]);
  });
});

describe("the effective shape", () => {
  it("reports each shape error once, with Ajv's keyword and the pointer", async () => {
    const verdict = await judgeVault({
      "wiki/Basil.md": BASIL.replace("bed: herb\n", "bed: pond\ncolour: green\n").replace(
        "sown: 2026-04-12\n",
        "",
      ),
    });
    const found = only(verdict, "page-shape-invalid").map((f) => [
      f.details["keyword"],
      f.details["pointer"],
    ]);
    expect(found).toContainEqual(["required", ""]);
    expect(found).toContainEqual(["enum", "/bed"]);
    expect(found).toContainEqual(["unevaluatedProperties", ""]);
    expect(only(verdict, "page-shape-invalid").every((f) => f.queue === "syntax-review")).toBe(
      true,
    );
  });

  it("derives no title requirement under field_sources.title: basename", async () => {
    const { engineJson } = await import("./fixtures/garden-law.ts");
    const untitled = { "wiki/Herb bed.md": HERB_BED.replace("title: Herb bed\n", "") };
    expect(only(await judgeVault(untitled), "page-shape-invalid")).toHaveLength(1);
    const derived = await judgeVault({
      ...untitled,
      "config/engine.json": engineJson({ field_sources: { title: "basename" } }),
    });
    expect(only(derived, "page-shape-invalid")).toEqual([]);
  });
});

describe("page references", () => {
  it("holds a page-ref to its target_type, ancestry counted, and reports one naming nothing", async () => {
    const withOrigin = (origin: string) =>
      BASIL.replace("bed: herb\n", `bed: herb\norigin: ${origin}\n`);
    expect(
      only(await judgeVault({ "wiki/Basil.md": withOrigin("Herb bed") }), "page-ref-type"),
    ).toEqual([]);
    const wrong = await judgeVault({ "wiki/Basil.md": withOrigin("Start") });
    expect(only(wrong, "page-ref-type")).toMatchObject([
      {
        path: "wiki/Basil.md",
        details: { kind: "type", field: "origin", type: "guide", required: "garden/bed" },
      },
    ]);
    const nowhere = await judgeVault({ "wiki/Basil.md": withOrigin("Pond") });
    expect(only(nowhere, "page-ref-type")).toMatchObject([
      {
        path: "wiki/Basil.md",
        severity: "error",
        queue: "link-review",
        details: { kind: "unresolved", field: "origin", target: "Pond" },
      },
    ]);
    expect(only(nowhere, "wikilink-unresolved")).toEqual([]);
  });

  it("refuses a page reference written as a path, naming the canonical name", async () => {
    const verdict = await judgeVault({
      "wiki/Basil.md": BASIL.replace("bed: herb\n", "bed: herb\norigin: wiki/Herb bed.md\n"),
    });
    expect(only(verdict, "page-ref-type")).toMatchObject([
      {
        severity: "error",
        details: { kind: "path", target: "wiki/Herb bed.md", canonical: "Herb bed" },
      },
    ]);
  });

  it("counts ancestry: a descendant of the target type is one", async () => {
    const verdict = await judgeVault({
      "constitution/types/raised-bed.yaml":
        "type: raised-bed\nextends: garden/bed\ndescription: A raised bed.\n",
      "wiki/Herb bed.md": HERB_BED.replace("type: garden/bed", "type: raised-bed"),
      "wiki/Basil.md": BASIL.replace("bed: herb\n", "bed: herb\norigin: Herb bed\n"),
    });
    expect(blocking(verdict)).toEqual([]);
  });

  it("reads the reserved page references too", async () => {
    const verdict = await judgeVault({
      "wiki/Basil.md": BASIL.replace("bed: herb\n", "bed: herb\nsuperseded_by: Sweet basil\n"),
    });
    expect(only(verdict, "page-ref-type")).toMatchObject([
      { details: { kind: "unresolved", field: "superseded_by", target: "Sweet basil" } },
    ]);
  });
});

describe("target_root", () => {
  it("holds a page reference to the root it names: a source root, or the content roots", async () => {
    const { engineJson } = await import("./fixtures/garden-law.ts");
    const extra = {
      "config/engine.json": engineJson({ content_roots: ["wiki", "raw"] }),
      "constitution/types/packet.yaml":
        "type: packet\nrole: reference\ndescription: A seed packet.\n",
      "constitution/types/guide.yaml":
        "type: guide\nrole: hub\ndescription: A route.\nfields:\n  type: object\n  properties:\n    seed: { $ref: '#/$defs/page-ref', target_root: raw }\n    home: { $ref: '#/$defs/page-ref', target_root: content }\n",
      "raw/Seed packet.md": "---\ntype: packet\ntitle: Seed packet\n---\n",
    };
    const at = (seed: string) =>
      judgeVault({
        ...extra,
        "wiki/Start.md": `---\ntype: guide\ntitle: Start\nseed: ${seed}\nhome: ${seed}\n---\n`,
      });
    expect(only(await at("Seed packet"), "page-ref-type")).toEqual([]);
    expect(only(await at("Herb bed"), "page-ref-type")).toMatchObject([
      { details: { kind: "root", field: "seed", root: "raw", target: "wiki/Herb bed.md" } },
    ]);
  });
});

describe("coverage by id", () => {
  it("counts the vault rows on the pages that take part in them", async () => {
    const verdict = await judgeVault({
      "constitution/types/guide.yaml":
        "type: guide\nrole: hub\ndescription: A route.\ninstances: { max: 1 }\n",
    });
    expect(verdict.coverage["identity-collision"]).toEqual({
      evaluated: 3,
      not_applicable: 0,
      unevaluated: 0,
    });
    expect(verdict.coverage["instances-max"]).toMatchObject({ evaluated: 1, not_applicable: 2 });
    expect(Object.keys(verdict.coverage)).not.toContain("rule-untested");
    expect(Object.keys(verdict.coverage)).toContain("known-bed");
  });
});

describe("the tags vocabulary", () => {
  it("reports a tag outside the bundle's tags vocabulary, and a retired one with its successor", async () => {
    const verdict = await judgeVault({
      "constitution/vocabularies/tags.yaml": TAGS,
      "wiki/Basil.md": BASIL.replace("bed: herb\n", "bed: herb\ntags: [herbs, weeds, kitchen]\n"),
    });
    expect(only(verdict, "vocabulary-unknown")).toMatchObject([
      { details: { vocabulary: "tags", value: "weeds", pointer: "/tags/1" } },
    ]);
    expect(only(verdict, "vocabulary-retired")).toMatchObject([
      { details: { vocabulary: "tags", value: "kitchen", successor: "herbs" } },
    ]);
  });

  it("admits a new value to a census vocabulary", async () => {
    const verdict = await judgeVault({
      "constitution/vocabularies/tags.yaml": TAGS.replace("mode: registered", "mode: census"),
      "wiki/Basil.md": BASIL.replace("bed: herb\n", "bed: herb\ntags: [weeds]\n"),
    });
    expect(only(verdict, "vocabulary-unknown")).toEqual([]);
  });
});

describe("names and links", () => {
  it("reports a body link that names no page, and one that names a page by an alias", async () => {
    const verdict = await judgeVault({
      "wiki/Herb bed.md": HERB_BED.replace("size: 4\n", "size: 4\naliases: [Kitchen bed]\n"),
      "wiki/Start.md":
        "---\ntype: guide\ntitle: Start\n---\n\n# Start\n\n## Start here\n\nSee [[Kitchen bed]] and [[Pond]].\n",
    });
    expect(only(verdict, "wikilink-unresolved")).toMatchObject([
      {
        path: "wiki/Start.md",
        location: { kind: "section", heading: "Start here", occurrence: 0, line: 10 },
        details: { target: "Pond" },
      },
    ]);
    expect(only(verdict, "wikilink-alias-target")).toMatchObject([
      { path: "wiki/Start.md", details: { target: "Kitchen bed", canonical: "Herb bed" } },
    ]);
  });

  it("reports a title or an alias that names two pages", async () => {
    const verdict = await judgeVault({
      "wiki/Sweet basil.md": BASIL.replace("title: Basil", "title: Basil"),
    });
    expect(only(verdict, "identity-collision")).toMatchObject([
      { path: "wiki/Sweet basil.md", queue: "identity-review" },
    ]);
  });

  it("reports a staged rename that drops the old name, under the index", async () => {
    const dir = vaultDir();
    gitCommitAll(dir);
    git(dir, "mv", "wiki/Herb bed.md", "wiki/Raised bed.md");
    const verdict = await judgeState(await indexState(dir));
    expect(only(verdict, "renamed-without-alias")).toMatchObject([
      { path: "wiki/Raised bed.md", details: { from: "wiki/Herb bed.md", alias: "Herb bed" } },
    ]);
    expect(verdict.coverage["renamed-without-alias"]?.evaluated).toBe(1);
  });
});

describe("instances", () => {
  it("reports a type below its minimum and above its maximum, at the type document", async () => {
    const verdict = await judgeVault({
      "constitution/types/guide.yaml":
        "type: guide\nrole: hub\ndescription: A route.\ninstances: { min: 2 }\n",
      "libraries/kit-garden/types/bed.yaml":
        "type: bed\nrole: reference\ndescription: One bed.\ninstances: { max: 0 }\nfields:\n  type: object\n  properties:\n    size: { type: integer, minimum: 1 }\n",
    });
    expect(only(verdict, "instances-min")).toMatchObject([
      {
        path: "bundle:constitution/types/guide.yaml",
        details: { type: "guide", count: 1, min: 2 },
      },
    ]);
    expect(only(verdict, "instances-max")).toMatchObject([
      { path: "garden:types/bed.yaml", details: { type: "garden/bed", count: 1, max: 0 } },
    ]);
  });
});

describe("the finding and its route (§6)", () => {
  it("routes every row: an error or warning to exactly one lane, an info to none", () => {
    expect(unroutableVerdictRows()).toEqual([]);
    expect(VERDICT_TABLE.map((r) => r.id).length).toBe(
      new Set(VERDICT_TABLE.map((r) => r.id)).size,
    );
  });

  it("gives every finding the §6 shape, and a queue exactly when it is not info", async () => {
    const verdict = await judgeVault({
      "wiki/Odd.md": "---\ntype: pond\n---\n",
      "wiki/Start.md": "---\ntype: guide\ntitle: Start\n---\n\nSee [[Pond]].\n",
    });
    expect(verdict.findings.length).toBeGreaterThan(0);
    for (const finding of verdict.findings) {
      expect(Object.keys(finding).sort()).toEqual(
        [
          "details",
          "location",
          "message",
          "path",
          "rule",
          "severity",
          ...(finding.severity === "info" ? [] : ["queue"]),
        ].sort(),
      );
    }
  });

  it("filters by rule and by path, and caps error-first", async () => {
    const extra = {
      "wiki/Odd.md": "---\ntype: pond\n---\n",
      "wiki/Start.md":
        "---\ntype: guide\ntitle: Start\n---\n\n## Start here\n\nSee [[Pond]] and [[Lake]].\n",
    };
    const byRule = await judgeVault(extra, { rule: "wikilink-unresolved" });
    expect(new Set(byRule.findings.map((f) => f.rule))).toEqual(new Set(["wikilink-unresolved"]));
    const byPath = await judgeVault(extra, { path: "wiki/Odd.md" });
    expect(byPath.findings.map((f) => f.path)).toEqual(["wiki/Odd.md"]);
    const capped = await judgeVault(extra, { all: false, limit: 1 });
    expect(capped.findings.map((f) => f.severity)).toEqual(["error"]);
    expect(capped.caps).toEqual({ limit: 1, hit: true });
    expect(capped.summary.errors + capped.summary.warnings).toBe(3);
  });
});
