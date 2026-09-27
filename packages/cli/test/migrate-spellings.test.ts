// v2 contracts §12 step 5: tools/migrate-spellings.ts, the one-off rewrite of
// a v1 bundle into the v2 law and the §4 spellings. Its item rewrites, each
// lossless, and one synthetic v1 gardening bundle under os.tmpdir() migrated
// and judged clean by the v2 `check`; the corpora it was run over are held by
// fixture-verdicts.test.ts.
import { afterAll, describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  migrate,
  rewriteClaim,
  rewriteEntry,
  rewriteRelation,
} from "../../../tools/migrate-spellings.ts";
import { cli, commitAll } from "./fixtures/garden-cli.ts";
import { removeTree, writeTree } from "./fixtures/garden-law.ts";

const made: string[] = [];
afterAll(() => {
  for (const dir of made) removeTree(dir);
});

describe("the item rewrites keep every character of meaning", () => {
  it.each([
    ["- 2031-06-28: Watered the beans.", "- 2031-06-28 — Watered the beans."],
    ["- 2031-06 — Thinned the carrots.", "- 2031-06 — Thinned the carrots."],
    ["- 2014— Dug the bed.", "- 2014 — Dug the bed."],
    ["- 2012-03-03 → 2012-04-03: Frost cover on.", "- 2012-03-03 — → 2012-04-03 Frost cover on."],
    ["- ~2016-02: Planted the hedge.", "- 2016-02 — ~ Planted the hedge."],
    ["- 约2021: Moved the compost.", "- 2021 — 约 Moved the compost."],
    ["- 2016-12-25 (north bed): Pruned.", "- 2016-12-25 — (north bed) Pruned."],
  ])("entry %p", (line, expected) => {
    expect(rewriteEntry(line)).toBe(expected);
  });

  it("an undated entry is left for a person", () => {
    expect(rewriteEntry("- **Mulched.** The straw ran out.")).toBeUndefined();
  });

  it.each([
    ["- 【observed】Basil bolts in heat.", "- [observed] Basil bolts in heat."],
    ["- [observed]  Basil bolts in heat.", "- [observed] Basil bolts in heat."],
    [
      "- [measured] Yield was 2 kg (valid 2031-05-19 → 2031-06-15 superseded 2031-06-15) ([[Tomato]])",
      "- [measured] Yield was 2 kg ([[Tomato]]) (valid 2031-05-19→2031-06-15, superseded 2031-06-15)",
    ],
    [
      "- [observed] Aphids on the roses (Retracted 2031-07-01)",
      "- [observed] Aphids on the roses (retracted 2031-07-01)",
    ],
    [
      "- [observed] Slugs at dusk (stated 2031-04-11)",
      "- [observed] Slugs at dusk (stated 2031-04-11)",
    ],
  ])("claim %p", (line, expected) => {
    expect(rewriteClaim(line)).toBe(expected);
  });

  it("a relation's label takes hyphens", () => {
    expect(rewriteRelation("- grows_in [[Herb bed]]")).toBe("- grows-in [[Herb bed]]");
    expect(rewriteRelation("- grows in the herb bed")).toBeUndefined();
  });
});

const V1_CONSTITUTION = {
  schema: "wikiwright/constitution",
  schema_version: 3,
  vocabularies: {
    tags: { mode: "registered", entries: { herbs: { description: "Herbs." } } },
    observations: {
      mode: "registered",
      entries: { observed: { class: "supersede" }, measured: { class: "accumulate" } },
    },
    relations: { mode: "registered", entries: { grows_in: { description: "Grows in." } } },
  },
  types: {
    planting: {
      extends: "procedure",
      description: "One sowing of one crop.",
      template: "templates/planting.md",
      fields: {
        bed: { kind: "enum", values: ["north", "herb"], required: true },
        sown: { kind: "date", required: true },
        code: { kind: "string", pattern: "^P-[0-9]{3}$" },
        created: { kind: "any" },
      },
      sections: {
        depth: 2,
        additional: false,
        list: [
          {
            heading: "Observations",
            grammar: "claims",
            vocabulary: "observations",
            history: "History",
          },
          { heading: "Timeline", grammar: "entries", date: "optional" },
          { heading: "Relations", grammar: "relations", vocabulary: "relations" },
          { heading: "History", grammar: "claims", role: "history" },
        ],
      },
    },
    bed: { extends: "reference", description: "One bed." },
  },
};

const BASIL_V1 = `---
type: planting
title: Basil
bed: herb
sown: 2031-04-12
code: P-001
tags: [herbs]
---

# Basil

## Observations

- 【observed】Basil bolts above thirty degrees.

## Timeline

- 2031-04-12: Sown.
- 2031-05 → 2031-06: Pinched out weekly.

## Relations

- grows_in [[Herb bed]]

## History

- 2031-05-02: The first sowing failed.
`;

describe("a v1 gardening bundle, migrated, is clean under the v2 check", () => {
  // Under a directory whose name is not a label: the tool derives one.
  const scratch = writeTree(
    Object.fromEntries(
      Object.entries({
        "config/engine.json": `${JSON.stringify({
          content_roots: ["wiki"],
          field_sources: { title: "basename", description: "lede" },
        })}\n`,
        "config/constitution.json": `${JSON.stringify(V1_CONSTITUTION, null, 2)}\n`,
        "templates/planting.md": "---\ntype: planting\n---\n",
        "wiki/Basil.md": BASIL_V1,
        "wiki/Herb bed.md": "---\ntype: bed\n---\n\n# Herb bed\n",
      }).map(([path, text]) => [`Kitchen Garden/${path}`, text]),
    ),
    "ww-migrate-",
  );
  made.push(scratch);
  const dir = join(scratch, "Kitchen Garden");

  it("writes the v2 law, respells the page, and reports what it dropped", async () => {
    const report = await migrate(dir, false);
    expect(existsSync(join(dir, "config/constitution.json"))).toBe(false);
    expect(existsSync(join(dir, "templates"))).toBe(false);
    expect(report.written).toEqual([
      "config/engine.json",
      "constitution/types/bed.yaml",
      "constitution/types/planting.yaml",
      "constitution/vocabularies/observations.yaml",
      "constitution/vocabularies/relations.yaml",
      "constitution/vocabularies/tags.yaml",
      "wiki/Basil.md",
    ]);
    expect(report.unparsed).toEqual([]);
    expect(report.dropped).toContain("engine.field_sources.description");
    expect(report.dropped).toContain("vocabularies.observations.entries.observed.class");
    expect(report.dropped).toContain("types.planting.template (§3.3: the skeleton is derived)");
    const engine = JSON.parse(readFileSync(join(dir, "config/engine.json"), "utf8"));
    expect(engine).toEqual({
      schema: "wikiwright/engine",
      schema_version: 4,
      label: "kitchen-garden",
      content_roots: ["wiki"],
      field_sources: { title: "basename" },
    });
    const page = readFileSync(join(dir, "wiki/Basil.md"), "utf8");
    expect(page).toContain("- [observed] Basil bolts above thirty degrees.");
    expect(page).toContain("- 2031-05 — → 2031-06 Pinched out weekly.");
    expect(page).toContain("- grows-in [[Herb bed]]");
    expect(page).toContain("- 2031-05-02 — The first sowing failed.");
  });

  it("the migrated bundle judges clean once check --write renders generated/", () => {
    commitAll(dir, "migrated");
    const written = cli(["check", "--write"], dir);
    expect(written.status).toBe(0);
    const judged = cli(["check", "--all"], dir);
    expect(judged.envelope.data?.findings?.filter((f) => f.severity !== "info")).toEqual([]);
    expect(judged.status).toBe(0);
  });

  it("a bundle already on the v2 law is refused, and nothing changes", async () => {
    const before = readFileSync(join(dir, "config/engine.json"), "utf8");
    await expect(migrate(dir, false)).rejects.toThrow(/already declares schema_version 4/u);
    expect(readFileSync(join(dir, "config/engine.json"), "utf8")).toBe(before);
  });
});

describe("a declared v1 code kit after its package left", () => {
  it("refuses before writing any migrated file", async () => {
    const engine = `${JSON.stringify({
      content_roots: ["wiki"],
      modules: [{ package: "@wikiwright/kit-code" }],
    })}\n`;
    const constitution = `${JSON.stringify(V1_CONSTITUTION)}\n`;
    const dir = writeTree(
      {
        "config/engine.json": engine,
        "config/constitution.json": constitution,
        "wiki/Basil.md": BASIL_V1,
      },
      "ww-migrate-kit-",
    );
    made.push(dir);
    await expect(migrate(dir, false)).rejects.toThrow(
      /the module @wikiwright\/kit-code left with packages\/kit-code/u,
    );
    expect(readFileSync(join(dir, "config/engine.json"), "utf8")).toBe(engine);
    expect(readFileSync(join(dir, "config/constitution.json"), "utf8")).toBe(constitution);
    expect(readFileSync(join(dir, "wiki/Basil.md"), "utf8")).toBe(BASIL_V1);
    expect(existsSync(join(dir, "constitution"))).toBe(false);
  });
});
