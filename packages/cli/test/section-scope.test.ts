import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadTypeLaw, parsePage, skeletonOf } from "@wikiwright/core";
import { workingTreeLawSnapshot } from "../src/lawfiles.ts";
import {
  cleanBundles,
  cli,
  commitAll,
  findingsOf,
  gardenBundle,
  git,
} from "./fixtures/garden-cli.ts";

afterAll(cleanBundles);

const SURVEY = `type: survey
role: reference
description: A synthetic garden survey with nested facts.
sections:
  depth: 2
  list:
    - { heading: Facts, grammar: claims, provenance: required, scope: descendants }
    - { heading: Notes, under: [Facts], grammar: prose, scope: descendants }
    - { heading: Timeline, under: [Facts], grammar: entries, lifecycle: append-only, scope: descendants }
`;

const PAGE = `---
type: survey
title: Garden survey
---

# Garden survey

## Facts

- [observed] The north plot is damp. (https://garden.example/north)

### Bed observations

- [observed] The south plot is warm. (https://garden.example/south)
  - measured beside the path

#### Soil detail

- [observed] The lower soil is dark. (https://garden.example/soil)

### Notes

- [observed] This is an example in prose, not a governed claim.

#### Ordinary list

- [observed] This remains prose by explicit exclusion.

### Timeline

- 2026-04-12 — surveyed the plots
`;

function bundle(page = PAGE, law = SURVEY): string {
  return gardenBundle({ "constitution/types/survey.yaml": law, "wiki/Garden survey.md": page });
}

function lineOf(page: string, fragment: string): number {
  return page.slice(0, page.indexOf(fragment)).split("\n").length;
}

describe("nested section ownership", () => {
  it("governs H2/H3/H4 direct items once, with explicit prose and mixed grammar children", async () => {
    const dir = bundle();
    const loaded = loadTypeLaw(await workingTreeLawSnapshot(dir));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const read = parsePage("wiki/Garden survey.md", new TextEncoder().encode(PAGE), loaded.law);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    const byHeading = new Map(read.page.occurrences.map((o) => [o.heading, o]));
    expect(["Facts", "Bed observations", "Soil detail"].map((h) => byHeading.get(h)?.mode)).toEqual(
      ["claims", "claims", "claims"],
    );
    expect(["Notes", "Ordinary list"].map((h) => byHeading.get(h)?.mode)).toEqual([
      "prose",
      "prose",
    ]);
    expect(byHeading.get("Timeline")?.mode).toBe("entries");
    expect(
      ["Facts", "Bed observations", "Soil detail"].map((h) => byHeading.get(h)?.items.length),
    ).toEqual([1, 1, 1]);
    expect(byHeading.get("Facts")?.raw).toContain("#### Soil detail");
    expect(byHeading.get("Facts")?.direct).not.toContain("### Bed observations");
    expect(byHeading.get("Bed observations")?.items[0]?.rationale).toContain(
      "  - measured beside the path",
    );
    expect(cli(["check", "--write", "--all"], dir).envelope.data?.summary?.errors).toBe(0);

    const invalid = PAGE.replace(" (https://garden.example/north)", "")
      .replace(" (https://garden.example/south)", "")
      .replace(" (https://garden.example/soil)", "");
    writeFileSync(join(dir, "wiki/Garden survey.md"), invalid);
    const check = cli(["check", "--all"], dir);
    expect(check.status).not.toBe(0);
    expect(
      findingsOf(check.envelope, "claim-provenance").map((f) => [
        f.location["heading"],
        f.location["line"],
      ]),
    ).toEqual([
      ["Facts", lineOf(invalid, "The north plot")],
      ["Bed observations", lineOf(invalid, "The south plot")],
      ["Soil detail", lineOf(invalid, "The lower soil")],
    ]);
    const scope = check.envelope.data?.["scope"] as Record<string, number>;
    expect(scope.governed).toBeGreaterThanOrEqual(4);
    expect(scope.prose).toBeGreaterThanOrEqual(2);
  });

  it("refuses governed H4 omissions through write and staged gate using the staged law", () => {
    const dir = bundle();
    expect(cli(["check", "--write"], dir).status).toBe(0);
    commitAll(dir, "initial");
    const invalid = PAGE.replace(" (https://garden.example/soil)", "");
    const drafts = join(dir, "drafts");
    mkdirSync(join(drafts, "wiki"), { recursive: true });
    writeFileSync(join(drafts, "wiki/Garden survey.md"), invalid);
    const write = cli(["write", "--from", drafts, "--dry-run"], dir);
    expect(write.status).not.toBe(0);
    expect(JSON.stringify(write.envelope)).toContain("claim-provenance");
    expect(readFileSync(join(dir, "wiki/Garden survey.md"), "utf8")).toBe(PAGE);

    writeFileSync(join(dir, "wiki/Garden survey.md"), invalid);
    git(dir, "add", "wiki/Garden survey.md");
    const gate = cli(["gate", "--all"], dir);
    expect(gate.status).not.toBe(0);
    expect(findingsOf(gate.envelope, "claim-provenance")[0]?.location).toMatchObject({
      heading: "Soil detail",
      line: lineOf(invalid, "The lower soil"),
    });

    // The index governs the page even when the working-tree law is loosened.
    writeFileSync(
      join(dir, "constitution/types/survey.yaml"),
      SURVEY.replace("scope: descendants", "scope: direct"),
    );
    expect(findingsOf(cli(["gate", "--all"], dir).envelope, "claim-provenance")).toHaveLength(1);
  });

  it("a quoted heading cannot end a governed direct region or hide a later claim", () => {
    const page = PAGE.replace(
      "### Bed observations",
      "> ### Quoted heading\n\n- [observed] This claim needs a source.\n\n### Bed observations",
    );
    const dir = bundle(page);
    const check = cli(["check", "--all"], dir);
    expect(findingsOf(check.envelope, "claim-provenance")).toMatchObject([
      { location: { heading: "Facts", line: lineOf(page, "This claim needs a source") } },
    ]);
    const read = cli(["read", "Garden survey"], dir);
    const regions = read.envelope.data?.["regions"] as { heading: string }[];
    expect(regions.some((region) => region.heading === "Quoted heading")).toBe(false);
  });

  it("addresses repeated nested declarations per parent and derives a usable depth-first skeleton", async () => {
    const law = `type: survey
role: reference
description: A survey with repeated child names.
sections:
  list:
    - { heading: Facts, min: 1, grammar: claims, provenance: required, scope: descendants }
    - { heading: History, grammar: entries }
    - { heading: Notes, under: [Facts], min: 1, grammar: prose }
    - { heading: Notes, under: [History], grammar: prose }
`;
    const page = `---\ntype: survey\ntitle: Survey\n---\n\n# Survey\n\n## Facts\n\n### Notes\n\nText.\n\n## Facts\n\nText.\n\n## History\n\n### Notes\n\nText.\n`;
    const dir = bundle(page, law);
    const loaded = loadTypeLaw(await workingTreeLawSnapshot(dir));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const survey = loaded.law.types.get("survey");
    expect(survey).toBeDefined();
    if (survey === undefined) return;
    const skeleton = skeletonOf(survey);
    expect(skeleton.indexOf("## Facts")).toBeLessThan(skeleton.indexOf("### Notes"));
    expect(skeleton.indexOf("### Notes")).toBeLessThan(skeleton.indexOf("## History"));
    const parsed = parsePage("wiki/template.md", new TextEncoder().encode(skeleton), loaded.law);
    expect(parsed.ok).toBe(true);
    if (parsed.ok)
      expect(
        parsed.page.occurrences.filter((o) => o.heading === "Notes").map((o) => o.sectionPath),
      ).toEqual([
        ["Facts", "Notes"],
        ["History", "Notes"],
      ]);
    const missing = findingsOf(cli(["check", "--all"], dir).envelope, "section-count").filter(
      (f) => f.details["kind"] === "min" && f.details["heading"] === "Notes",
    );
    expect(missing).toMatchObject([
      {
        location: { kind: "section", heading: "Facts", occurrence: 1 },
        details: { parent_address: [{ heading: "Facts", index: 1 }] },
      },
    ]);
  });

  it("keeps transition identity through title edits and distinguishes mixed-depth repeated children", () => {
    const law = `type: survey
role: reference
description: A dated survey.
sections:
  list:
    - { heading: Facts, grammar: claims, provenance: required, scope: descendants }
    - { heading: Timeline, under: [Facts], grammar: entries, lifecycle: append-only }
`;
    const page = `---\ntype: survey\ntitle: Survey\n---\n\n# Survey\n\n## Facts\n\n#### Timeline\n\n- 2026-04-12 — first\n\n### Timeline\n\n- 2026-04-13 — second\n`;
    const dir = bundle(page, law);
    expect(cli(["check", "--write"], dir).status).toBe(0);
    commitAll(dir, "initial");
    writeFileSync(
      join(dir, "wiki/Garden survey.md"),
      page.replace("# Survey\n", "# Survey notes\n"),
    );
    git(dir, "add", "wiki/Garden survey.md");
    expect(findingsOf(cli(["gate", "--all"], dir).envelope, "entry-edited")).toHaveLength(0);
    const changed = page
      .replace("# Survey\n", "# Survey notes\n")
      .replace("2026-04-13 — second", "2026-04-13 — changed");
    writeFileSync(join(dir, "wiki/Garden survey.md"), changed);
    git(dir, "add", "wiki/Garden survey.md");
    const edited = findingsOf(cli(["gate", "--all"], dir).envelope, "entry-edited");
    expect(edited).toHaveLength(1);
    expect(edited[0]?.location).toMatchObject({
      heading: "Timeline",
      occurrence: 1,
      line: lineOf(changed, "2026-04-13 — changed"),
    });
  });

  it("holds descendant relations to a root History landing", async () => {
    const law = `type: survey
role: reference
description: A linked survey.
sections:
  list:
    - { heading: Relations, grammar: relations, scope: descendants, history: History }
    - { heading: History, grammar: entries }
`;
    const page = `---\ntype: survey\ntitle: Survey\n---\n\n# Survey\n\n## Relations\n\n### Bed links\n\n- grows-in [[Herb bed]]\n\n## History\n\n- 2026-04-12 — started\n`;
    const dir = bundle(page, law);
    expect(cli(["check", "--write"], dir).status).toBe(0);
    commitAll(dir, "initial");
    const removed = page.replace("- grows-in [[Herb bed]]\n\n", "");
    writeFileSync(join(dir, "wiki/Garden survey.md"), removed);
    git(dir, "add", "wiki/Garden survey.md");
    expect(findingsOf(cli(["gate", "--all"], dir).envelope, "relation-removed")).toMatchObject([
      { location: { heading: "Bed links", line: lineOf(removed, "### Bed links") } },
    ]);
    const landed = removed.replace(
      "- 2026-04-12 — started",
      "- 2026-04-12 — started\n- 2026-04-13 — removed grows-in [[Herb bed]] after review",
    );
    writeFileSync(join(dir, "wiki/Garden survey.md"), landed);
    git(dir, "add", "wiki/Garden survey.md");
    expect(findingsOf(cli(["gate", "--all"], dir).envelope, "relation-removed")).toHaveLength(0);

    const nestedOnly = law.replace(
      "- { heading: History, grammar: entries }",
      "- { heading: History, under: [Relations], grammar: entries }",
    );
    const invalid = bundle(page, nestedOnly);
    const loaded = loadTypeLaw(await workingTreeLawSnapshot(invalid));
    expect(loaded.ok ? [] : loaded.issues.map((issue) => issue.code)).toContain("type-invalid");
  });

  it("refuses inherited weakening, admits prose tightening, and makes nested rule trials available", async () => {
    const parent = `type: survey
role: reference
description: A parent survey.
sections:
  list:
    - { heading: Facts, grammar: claims, provenance: required, scope: descendants }
    - { heading: Notes, under: [Facts], grammar: prose, scope: descendants }
`;
    const child = `type: local-survey
extends: survey
description: A local survey.
sections:
  list:
    - { heading: Timeline, under: [Facts, Notes], grammar: entries }
    - { heading: Notes, under: [Facts], min: 1 }
`;
    const dir = gardenBundle({
      "constitution/types/survey.yaml": parent,
      "constitution/types/local-survey.yaml": child,
    });
    let loaded = loadTypeLaw(await workingTreeLawSnapshot(dir));
    expect(loaded.ok).toBe(true);
    writeFileSync(
      join(dir, "constitution/types/local-survey.yaml"),
      child
        .replace("[Facts, Notes]", "[Facts]")
        .replace("Timeline", "Exception")
        .replace("grammar: entries", "grammar: prose"),
    );
    loaded = loadTypeLaw(await workingTreeLawSnapshot(dir));
    expect(loaded.ok ? [] : loaded.issues.map((i) => i.code)).toContain("sections-conflict");

    const trial = bundle();
    const result = cli(
      [
        "rule",
        "try",
        "--type",
        "survey",
        "--section-path",
        '["Facts","Timeline"]',
        "--expr",
        'section.mode == "entries" && section.items.all(i, i.precision == "day")',
      ],
      trial,
    );
    expect(result.status).toBe(0);
    const working = result.envelope.data?.["working"] as { would_pass: string[] };
    expect(working.would_pass).toContain("wiki/Garden survey.md");
  });

  it("inherits parameters only through descendants, not a direct parent", () => {
    const law = (scope: string) => `type: survey
role: reference
description: A survey with an explicit child.
sections:
  list:
    - { heading: Facts, grammar: claims, provenance: required, scope: ${scope} }
    - { heading: Extra, under: [Facts], grammar: claims }
`;
    const page = `---\ntype: survey\ntitle: Survey\n---\n\n# Survey\n\n## Facts\n\n- [observed] Root fact. (https://garden.example/root)\n\n### Extra\n\n- [observed] Child fact.\n\n#### Deep\n\n- [observed] A deeper ordinary bullet.\n`;
    const direct = bundle(page, law("direct"));
    expect(findingsOf(cli(["check", "--all"], direct).envelope, "claim-provenance")).toHaveLength(
      0,
    );
    const descendants = bundle(page, law("descendants"));
    expect(
      findingsOf(cli(["check", "--all"], descendants).envelope, "claim-provenance"),
    ).toMatchObject([{ location: { heading: "Extra", line: lineOf(page, "Child fact") } }]);
    const regions = cli(["read", "Survey"], descendants).envelope.data?.["regions"] as {
      heading: string;
      mode: string;
    }[];
    expect(regions.find((region) => region.heading === "Deep")?.mode).toBe("unbound");
    const parentRule = cli(
      [
        "rule",
        "try",
        "--type",
        "survey",
        "--section",
        "Facts",
        "--expr",
        'section.items.all(i, i.provenance.kind != "none")',
      ],
      descendants,
    );
    expect(
      (parentRule.envelope.data?.["working"] as { would_pass: string[] } | undefined)?.would_pass,
    ).toContain("wiki/Garden survey.md");
  });

  it("staged section law governs staged bytes despite a looser working tree", () => {
    const direct = SURVEY.replace("scope: descendants", "scope: direct");
    const unsourced = PAGE.replace(" (https://garden.example/soil)", "");
    const dir = bundle(unsourced, direct);
    expect(cli(["check", "--write"], dir).status).toBe(0);
    commitAll(dir, "initial");
    writeFileSync(join(dir, "constitution/types/survey.yaml"), SURVEY);
    git(dir, "add", "constitution/types/survey.yaml");
    writeFileSync(join(dir, "constitution/types/survey.yaml"), direct);
    const gate = cli(["gate", "--all"], dir);
    expect(findingsOf(gate.envelope, "claim-provenance")).toMatchObject([
      { location: { heading: "Soil detail", line: lineOf(unsourced, "The lower soil") } },
    ]);
    expect(findingsOf(cli(["check", "--all"], dir).envelope, "claim-provenance")).toHaveLength(0);
  });
});
