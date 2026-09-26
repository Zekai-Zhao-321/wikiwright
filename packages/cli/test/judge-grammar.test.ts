// v2 contracts §3.2, §4, §5 and the navigator's rulings 2, 3 and 4: the
// sections of a page and the records of its grammar sections, judged over a
// gardening vault under os.tmpdir(); and the three kernel transitions, judged
// against the disk under the overlay and unevaluated under the working tree.
import { afterAll, describe, expect, it } from "bun:test";
import { loadTypeLaw } from "@wikiwright/core";
import { workingTreeLawSnapshot } from "../src/lawfiles.ts";
import { fsState, indexState, overlayState } from "../src/lawstate.ts";
import { BASIL, gardenVault, git, gitCommitAll, START } from "./fixtures/garden-judge.ts";
import { removeTree, writeTree } from "./fixtures/garden-law.ts";
import { blocking, cleanUp, judgeState, judgeVault, only, vaultDir } from "./fixtures/judge-run.ts";

afterAll(cleanUp);

/** A type whose sections carry every claims and relations parameter. */
const TRIAL = `type: trial
role: reference
description: A trial of one method in one bed.
sections:
  ordered: true
  additional: refused
  list:
    - { heading: Findings, grammar: claims, vocabulary: garden/observations, provenance: required, categories: [observed, measured], closed: refused }
    - { heading: Closed, grammar: claims, vocabulary: garden/observations, provenance: none, closed: required }
    - { heading: Beds, grammar: relations, vocabulary: garden/relations, require: [{ labels: [grows-in], min: 1 }] }
    - { heading: Notes, max: 1 }
`;

const TRIAL_PAGE = `---
type: trial
title: Mulch trial
---

# Mulch trial

## Findings

- [observed] Straw mulch kept the soil damp. ([[Herb bed]])

## Closed

- [measured] The bed dried in two days. (retracted 2026-05-01)

## Beds

- grows-in [[Herb bed]]

## Notes

A dry spring.
`;

const trial = (page: string) =>
  judgeVault({ "constitution/types/trial.yaml": TRIAL, "wiki/Mulch trial.md": page });

describe("sections (§3.2)", () => {
  it("judges a page that keeps every declaration clean", async () => {
    expect(blocking(await trial(TRIAL_PAGE))).toEqual([]);
  });

  it("counts a declared heading against its min and its max", async () => {
    const missing = await judgeVault({
      "wiki/Start.md": START.replace("## Start here", "## Begin"),
    });
    expect(only(missing, "section-count")).toMatchObject([
      {
        path: "wiki/Start.md",
        location: { kind: "page" },
        details: { kind: "min", heading: "Start here", count: 0, min: 1 },
      },
    ]);
    const twice = await trial(
      TRIAL_PAGE.replace("A dry spring.", "A dry spring.\n\n## Notes\n\nAgain."),
    );
    expect(only(twice, "section-count")).toMatchObject([
      {
        location: { kind: "section", heading: "Notes", occurrence: 1 },
        details: { kind: "max", count: 2, max: 1 },
      },
    ]);
  });

  it("reports an order, an undeclared heading and a depth that conflict with the declaration", async () => {
    const page = TRIAL_PAGE.replace("## Findings", "## Aside\n\nPlain.\n\n## Findings")
      .replace("## Beds\n\n- grows-in [[Herb bed]]\n\n", "")
      .replace(
        "## Notes\n\nA dry spring.\n",
        "## Notes\n\nA dry spring.\n\n## Beds\n\n- grows-in [[Herb bed]]\n\n### Closed\n\nNested.\n",
      );
    const kinds = only(await trial(page), "sections-conflict").map((f) => [
      f.details["kind"],
      f.details["heading"],
    ]);
    expect(kinds).toEqual([
      ["additional", "Aside"],
      ["order", "Beds"],
      ["depth", "Closed"],
    ]);
    const swapped = TRIAL_PAGE.replace(
      "## Findings\n\n- [observed] Straw mulch kept the soil damp. ([[Herb bed]])\n\n## Closed\n\n- [measured] The bed dried in two days. (retracted 2026-05-01)",
      "## Closed\n\n- [measured] The bed dried in two days. (retracted 2026-05-01)\n\n## Findings\n\n- [observed] Straw mulch kept the soil damp. ([[Herb bed]])",
    );
    expect(only(await trial(swapped), "sections-conflict")).toMatchObject([
      { details: { kind: "order", heading: "Findings", after: "Closed" } },
    ]);
  });

  it("refuses at load a child that changes the closed parameter an ancestor fixed", async () => {
    const dir = writeTree({
      ...gardenVault(),
      "constitution/types/trial.yaml": TRIAL,
      "constitution/types/long-trial.yaml":
        "type: long-trial\nextends: trial\ndescription: A trial over seasons.\nsections:\n  list:\n    - { heading: Findings, closed: allowed }\n",
    });
    try {
      const loaded = loadTypeLaw(await workingTreeLawSnapshot(dir));
      expect(loaded.ok ? [] : loaded.issues.map((i) => i.code)).toEqual(["sections-conflict"]);
    } finally {
      removeTree(dir);
    }
  });
});

describe("the grammar's records (§4)", () => {
  it("reports each top-level item that does not parse, at its line", async () => {
    const verdict = await trial(
      TRIAL_PAGE.replace("## Notes", "- observed: not a claim\n\n## Notes"),
    );
    expect(only(verdict, "item-unparsed")).toMatchObject([
      {
        location: { kind: "section", heading: "Beds", occurrence: 0, line: 20 },
        details: { raw: "- observed: not a claim" },
      },
    ]);
  });

  it("holds a claim's category and a relation's label to the section's vocabulary", async () => {
    const verdict = await trial(
      TRIAL_PAGE.replace("[observed] Straw", "[guess] Straw").replace(
        "- grows-in [[Herb bed]]",
        "- grows-in [[Herb bed]]\n- planted-in [[Herb bed]]\n- likes [[Herb bed]]",
      ),
    );
    expect(only(verdict, "vocabulary-unknown").map((f) => f.details["value"])).toEqual([
      "guess",
      "likes",
    ]);
    expect(only(verdict, "vocabulary-retired")).toMatchObject([
      { details: { vocabulary: "garden/relations", value: "planted-in", successor: "grows-in" } },
    ]);
  });

  it("holds a claim to the categories subset, the provenance and the closed parameters", async () => {
    const verdict = await trial(
      TRIAL_PAGE.replace(
        "- [observed] Straw mulch kept the soil damp. ([[Herb bed]])",
        "- [advice] Mulch after rain. ([[Herb bed]])\n- [observed] Worms came up.\n- [observed] Slugs hid under it. ([[Herb bed]]) (retracted 2026-05-02)",
      ).replace(
        "- [measured] The bed dried in two days. (retracted 2026-05-01)",
        "- [measured] The bed dried in two days. (retracted 2026-05-01)\n- [measured] It rained twice. ([[Herb bed]])",
      ),
    );
    expect(
      blocking(verdict)
        .map(([, rule]) => rule)
        .sort(),
    ).toEqual([
      "category-not-allowed",
      "claim-closed",
      "claim-open",
      "claim-provenance",
      "claim-provenance",
    ]);
    expect(
      only(verdict, "claim-provenance").map((f) => [f.location, f.details["kind"]]),
    ).toMatchObject([
      [{ heading: "Findings", line: 11 }, "missing"],
      [{ heading: "Closed", line: 17 }, "forbidden"],
    ]);
    expect(only(verdict, "claim-closed")[0]?.details).toMatchObject({ closed: "retracted" });
  });

  it("reports a relation whose target names no page, and a require row unmet", async () => {
    const verdict = await trial(
      TRIAL_PAGE.replace("- grows-in [[Herb bed]]", "- companion-of [[Pond]]"),
    );
    expect(only(verdict, "relation-target-unresolved")).toMatchObject([
      { severity: "warning", details: { label: "companion-of", target: "Pond" } },
    ]);
    expect(only(verdict, "require-unmet")).toMatchObject([
      {
        location: { kind: "section", heading: "Beds" },
        details: { labels: ["grows-in"], min: 1, count: 0 },
      },
    ]);
  });
});

const draft = (path: string, text: string) => ({ path, bytes: new TextEncoder().encode(text) });

async function overlay(text: string) {
  const dir = vaultDir();
  return judgeState(await overlayState(dir, [draft("wiki/Basil.md", text)]));
}

describe("the kernel transitions, against the disk (ruling 3)", () => {
  it("holds an append-only entries section: an edited or a removed entry, never an appended one", async () => {
    const edited = await overlay(BASIL.replace("- 2026-04-12 — sown", "- 2026-04-13 — sown"));
    expect(only(edited, "entry-edited")).toMatchObject([
      {
        location: { kind: "section", heading: "History", line: 17 },
        details: { entry: 1, was: "- 2026-04-12 — sown", is: "- 2026-04-13 — sown" },
      },
    ]);
    const removed = await overlay(BASIL.replace("- 2026-04-12 — sown\n", ""));
    expect(only(removed, "entry-edited")[0]?.details).toMatchObject({ is: null });
    const appended = await overlay(
      BASIL.replace("- 2026-04-12 — sown", "- 2026-04-12 — sown\n- 2026-05-01 — thinned"),
    );
    expect(blocking(appended)).toEqual([]);
  });

  it("holds an open claim that leaves: closed in place, corrected or recorded, it passes", async () => {
    const claim = "- [observed] Basil bolts above thirty degrees. ([[Herb bed]])";
    const gone = await overlay(BASIL.replace(`${claim}\n`, ""));
    expect(only(gone, "claims-transition")).toMatchObject([
      {
        location: { kind: "section", heading: "Observations", occurrence: 0 },
        details: { category: "observed", core: "Basil bolts above thirty degrees." },
      },
    ]);
    for (const passing of [
      BASIL.replace(claim, `${claim} (retracted 2026-05-01)`),
      BASIL.replace(claim, claim.replace("degrees", "degres")),
      BASIL.replace(`${claim}\n`, "").replace(
        "- 2026-04-12 — sown",
        "- 2026-04-12 — sown\n- 2026-05-01 — dropped: Basil bolts above thirty degrees.",
      ),
    ]) {
      expect(only(await overlay(passing), "claims-transition")).toEqual([]);
    }
    // A number changed is not a typo: it is a new claim, and the old one left.
    expect(
      only(
        await overlay(BASIL.replace(claim, claim.replace("thirty", "thirty-five"))),
        "claims-transition",
      ),
    ).toHaveLength(1);
  });

  it("holds a relation that leaves to a dated line of its history heading", async () => {
    const gone = await overlay(BASIL.replace("- grows-in [[Herb bed]]", ""));
    expect(only(gone, "relation-removed")).toMatchObject([
      { details: { label: "grows-in", target: "Herb bed", history: "History" } },
    ]);
    const recorded = await overlay(
      BASIL.replace("- grows-in [[Herb bed]]", "").replace(
        "- 2026-04-12 — sown",
        "- 2026-04-12 — sown\n- 2026-05-01 — retired grows-in [[Herb bed]]: moved to a pot",
      ),
    );
    expect(blocking(recorded)).toEqual([]);
  });

  it("reports every transition unevaluated under the working tree, never passed", async () => {
    const verdict = await judgeState(await fsState(vaultDir()));
    expect(
      only(verdict, "unevaluated")
        .filter((f) => f.path === "wiki/Basil.md")
        .map((f) => [f.details["rule"], f.details["reason"], f.queue]),
    ).toEqual([
      ["claims-transition", "no-base", undefined],
      ["entry-edited", "no-base", undefined],
      ["relation-removed", "no-base", undefined],
    ]);
    expect(verdict.unevaluated["entry-edited"]).toEqual({ count: 1, reasons: ["no-base"] });
    expect(verdict.coverage["entry-edited"]).toEqual({
      evaluated: 0,
      not_applicable: 2,
      unevaluated: 1,
    });
    expect(verdict.summary.unevaluated).toBe(3);
  });

  it("judges a page new to the index's base as holding every transition", async () => {
    const dir = vaultDir();
    gitCommitAll(dir);
    const { writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    writeFileSync(join(dir, "wiki/Mint.md"), BASIL.replace("title: Basil", "title: Mint"));
    git(dir, "add", "-A");
    const verdict = await judgeState(await indexState(dir));
    expect(only(verdict, "unevaluated")).toEqual([]);
    expect(verdict.coverage["claims-transition"]?.evaluated).toBe(2);
  });
});
