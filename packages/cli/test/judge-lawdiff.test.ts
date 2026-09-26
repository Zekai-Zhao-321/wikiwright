// v2 contracts §8: the law diff between HEAD's law and the index's, each
// loaded from git by its adapter, over a gardening vault under os.tmpdir() —
// every listed change with its details.kind, nothing for a change that only
// tightens — and its findings: law-changed at pre-commit, law-relaxed at
// commit-msg unless the body carries `law-change: <reason>`.
import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  changedRules,
  judgeTypeLaw,
  type LawChange,
  lawChangeFindings,
  lawChangeReason,
  lawDiff,
  loadTypeLaw,
  type TypeLaw,
} from "@wikiwright/core";
import { indexLawSnapshot, revisionLawSnapshot } from "../src/lawfiles.ts";
import { indexState } from "../src/lawstate.ts";
import { git, gitCommitAll } from "./fixtures/garden-judge.ts";
import { engineJson, gardenTree, LIBRARY } from "./fixtures/garden-law.ts";
import { cleanUp, vaultDir } from "./fixtures/judge-run.ts";

afterAll(cleanUp);

function loaded(result: ReturnType<typeof loadTypeLaw>): TypeLaw {
  if (!result.ok) throw new Error(JSON.stringify(result.issues, null, 2));
  return result.law;
}

/** A vault committed with `base` over it, then `edits` staged: HEAD's law and the index's. */
async function laws(
  edits: Record<string, string | null>,
  base: Record<string, string | null> = {},
): Promise<{ head: TypeLaw; index: TypeLaw }> {
  const dir = vaultDir(base);
  gitCommitAll(dir);
  for (const [path, text] of Object.entries(edits)) {
    if (text === null) rmSync(join(dir, path));
    else {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), text);
    }
  }
  git(dir, "add", "-A");
  return {
    head: loaded(loadTypeLaw(await revisionLawSnapshot(dir, "HEAD"))),
    index: loaded(loadTypeLaw(await indexLawSnapshot(dir))),
  };
}

async function diff(
  edits: Record<string, string | null>,
  base: Record<string, string | null> = {},
): Promise<LawChange[]> {
  const { head, index } = await laws(edits, base);
  const changes = lawDiff(head, index);
  // The diff and its findings are JSON, as the envelope will write them.
  JSON.stringify(changes);
  JSON.stringify(lawChangeFindings(changes, { kind: "commit-msg", message: "fix: x\n" }));
  return changes;
}

const kinds = (changes: readonly LawChange[]) => changes.map((c) => [c.kind, c.path]);

const PLANTING_LIB = LIBRARY["libraries/kit-garden/types/planting.yaml"] ?? "";
const PLANTING = gardenTree()["constitution/types/planting.yaml"] ?? "";
const GUIDE = gardenTree()["constitution/types/guide.yaml"] ?? "";
const OBSERVATIONS = LIBRARY["libraries/kit-garden/vocabularies/observations.yaml"] ?? "";
const BED = LIBRARY["libraries/kit-garden/types/bed.yaml"] ?? "";

describe("a rule changed or removed", () => {
  it.each([
    [
      "rule-expr",
      'section.items.all(i, i.precision == "day")',
      'section.items.all(i, i.precision != "year")',
    ],
    ["rule-section", "    section: History\n", "    section: Relations\n"],
    ["rule-severity", "    severity: warning\n", "    severity: error\n"],
  ])("reports %s at the declaring document", async (kind, from, to) => {
    const changes = await diff({
      "libraries/kit-garden/types/planting.yaml": PLANTING_LIB.replace(from, to),
    });
    expect(kinds(changes)).toEqual([[kind, "garden:types/planting.yaml"]]);
    expect(changes[0]?.details).toMatchObject({ kind, rule: "history-dated" });
  });

  it("reports a config changed under a type's configure, at that type", async () => {
    const changes = await diff({
      "constitution/types/planting.yaml": PLANTING.replace(
        "beds: [north, south, herb, east]",
        "beds: [north, south, herb, east, pond]",
      ),
    });
    expect(kinds(changes)).toEqual([["rule-config", "bundle:constitution/types/planting.yaml"]]);
    expect(changes[0]?.details).toMatchObject({ rule: "known-bed", type: "planting" });
  });

  it("reports a config's integers as JSON numbers", async () => {
    const changes = await diff(
      {
        "libraries/kit-garden/types/planting.yaml": PLANTING_LIB.replace(
          "    severity: warning\n",
          "    severity: warning\n    config: { min: 0 }\n",
        ),
        "constitution/types/planting.yaml": PLANTING.replace(
          "configure:\n",
          "configure:\n  history-dated: { min: 2 }\n",
        ),
      },
      {
        "libraries/kit-garden/types/planting.yaml": PLANTING_LIB.replace(
          "    severity: warning\n",
          "    severity: warning\n    config: { min: 1 }\n",
        ),
      },
    );
    const configs = changes.filter((c) => c.kind === "rule-config");
    expect(configs.map((c) => [c.details["before"], c.details["after"]])).toContainEqual([
      { min: 1 },
      { min: 0 },
    ]);
    expect(JSON.parse(JSON.stringify(configs[0]?.details))).toEqual(configs[0]?.details);
  });

  it("reports a rule removed", async () => {
    const without = PLANTING.slice(0, PLANTING.indexOf("rules:"));
    const changes = await diff({ "constitution/types/planting.yaml": without });
    expect(kinds(changes)).toContainEqual([
      "rule-removed",
      "bundle:constitution/types/planting.yaml",
    ]);
  });
});

describe("a type, a fragment, a vocabulary entry or a library removed", () => {
  it("reports a type removed", async () => {
    expect(kinds(await diff({ "constitution/types/guide.yaml": null }))).toEqual([
      ["type-removed", "bundle:constitution/types/guide.yaml"],
    ]);
  });

  it("reports a fragment removed", async () => {
    const shade = "fragment: shade\ndescription: How much shade a bed has.\n";
    const changes = await diff(
      { "constitution/fragments/shade.yaml": null },
      { "constitution/fragments/shade.yaml": shade },
    );
    expect(kinds(changes)).toEqual([
      ["fragment-removed", "bundle:constitution/fragments/shade.yaml"],
    ]);
  });

  it("reports a vocabulary entry removed", async () => {
    const changes = await diff({
      "libraries/kit-garden/vocabularies/observations.yaml": OBSERVATIONS.replace(
        "  advice: { description: A recommendation. }\n",
        "",
      ),
    });
    expect(kinds(changes)).toEqual([
      ["vocabulary-entry-removed", "garden:vocabularies/observations.yaml"],
    ]);
    expect(changes[0]?.details).toMatchObject({
      vocabulary: "garden/observations",
      entry: "advice",
    });
  });

  it("reports a library removed, and the libraries key changed", async () => {
    const herbs = {
      "libraries/kit-herbs/vocabularies/herbs.yaml":
        "vocabulary: herbs\nmode: registered\nentries:\n  basil: {}\n",
    };
    const two = engineJson({
      libraries: [{ path: "libraries/kit-garden" }, { path: "libraries/kit-herbs" }],
    });
    const changes = await diff(
      { "config/engine.json": engineJson() },
      { ...herbs, "config/engine.json": two },
    );
    expect(kinds(changes)).toEqual([
      ["libraries", "bundle:config/engine.json"],
      ["library-removed", "bundle:config/engine.json"],
      ["vocabulary-entry-removed", "herbs:vocabularies/herbs.yaml"],
    ]);
  });
});

describe("a type's declaration changed", () => {
  it.each([
    [
      "type-fields",
      "constitution/types/guide.yaml",
      `${GUIDE}fields:\n  type: object\n  properties:\n    season: { type: string }\n`,
    ],
    ["type-sections", "constitution/types/guide.yaml", GUIDE.replace("max: 1", "max: 2")],
    ["type-meta", "constitution/types/planting.yaml", PLANTING.replace("meta: [updated]\n", "")],
    ["type-instances", "constitution/types/guide.yaml", `${GUIDE}instances: { min: 1 }\n`],
    [
      "type-abstract",
      "libraries/kit-garden/types/bed.yaml",
      BED.replace("role: reference\n", "role: reference\nabstract: true\n"),
    ],
  ])("reports %s", async (kind, path, text) => {
    const changes = await diff({ [path]: text });
    expect(changes.map((c) => c.kind)).toEqual([kind]);
  });

  it("reports the grammar parameters of an inherited heading changed", async () => {
    const changes = await diff({
      "constitution/types/planting.yaml": PLANTING.replace(
        "meta: [updated]\n",
        "meta: [updated]\nsections:\n  list:\n    - { heading: Observations, categories: [observed, measured] }\n",
      ),
    });
    expect(changes.map((c) => c.kind)).toEqual(["type-grammar-params"]);
  });

  it("reports extends and fragments changed", async () => {
    const raised = "type: raised-bed\nextends: garden/bed\ndescription: A raised bed.\n";
    const changes = await diff(
      {
        "constitution/types/raised-bed.yaml":
          "type: raised-bed\nrole: reference\ndescription: A raised bed.\nfragments: [garden/planted]\n",
      },
      { "constitution/types/raised-bed.yaml": raised },
    );
    expect(changes.map((c) => c.kind).sort()).toEqual([
      "type-extends",
      "type-fields",
      "type-fragments",
    ]);
  });
});

describe("an entry added, a test or an example changed, the engine's keys", () => {
  it("reports an entry added to a registered vocabulary, and not to a census", async () => {
    const contribution =
      "vocabulary: relations\ncontributes_to: garden/relations\nentries:\n  shades: { description: Shade. }\n  feeds: { description: Feeds. }\n";
    expect(kinds(await diff({ "constitution/vocabularies/relations.yaml": contribution }))).toEqual(
      [["vocabulary-entry-added", "garden:vocabularies/relations.yaml"]],
    );
    const census = "vocabulary: tags\nmode: census\nentries:\n  herbs: {}\n";
    expect(
      await diff(
        { "constitution/vocabularies/tags.yaml": `${census}  beds: {}\n` },
        { "constitution/vocabularies/tags.yaml": census },
      ),
    ).toEqual([]);
  });

  it("reports a rule-test and an example file changed or deleted", async () => {
    const changes = await diff({
      "rule-tests/source-host-allowed/negative.md":
        "---\ntype: planting\ntitle: Basil\nbed: herb\nsown: 2026-04-12\nsource: https://stall.example/basil\n---\n",
      "rule-tests/source-host-allowed/repaired.md": null,
      "examples/planting.md":
        "---\ntype: planting\ntitle: Mint\nbed: herb\nsown: 2026-04-12\n---\n",
    });
    expect(kinds(changes)).toEqual([
      ["example-changed", "bundle:examples/planting.md"],
      ["rule-test-changed", "bundle:rule-tests/source-host-allowed/negative.md"],
      ["rule-test-deleted", "bundle:rule-tests/source-host-allowed/repaired.md"],
    ]);
    expect(kinds(await diff({ "examples/planting.md": null }))).toEqual([
      ["example-deleted", "bundle:examples/planting.md"],
    ]);
  });

  it("reports content_roots changed", async () => {
    const changes = await diff({
      "config/engine.json": engineJson({ content_roots: ["wiki", "notes"] }),
    });
    expect(changes).toMatchObject([
      { kind: "content-roots", details: { before: ["wiki"], after: ["wiki", "notes"] } },
    ]);
  });

  it("reports nothing for a change that only tightens, and names the rules it adds", async () => {
    const { head, index } = await laws({
      "constitution/types/pond.yaml": "type: pond\nrole: reference\ndescription: A pond.\n",
      "constitution/types/guide.yaml": `${GUIDE}rules:\n  - id: guide-titled\n    expr: has(page.fields.title)\n    message: A guide has a title.\n`,
      "rule-tests/guide-titled/negative.md": "---\ntype: guide\n---\n",
    });
    expect(lawDiff(head, index)).toEqual([]);
    expect([...changedRules(head, index)]).toEqual(["guide-titled"]);
  });
});

describe("the relaxations beyond the contracts' list", () => {
  const RELATIONS = LIBRARY["libraries/kit-garden/vocabularies/relations.yaml"] ?? "";

  it("reports a vocabulary's mode changed, and a retired entry no longer retired", async () => {
    const changes = await diff({
      "libraries/kit-garden/vocabularies/observations.yaml": OBSERVATIONS.replace(
        "mode: registered",
        "mode: census",
      ),
      "libraries/kit-garden/vocabularies/relations.yaml": RELATIONS.replace(
        "retired:\n  planted-in: { since: 2026-01-01, successor: grows-in }\n",
        "",
      ),
    });
    expect(kinds(changes)).toEqual([
      ["vocabulary-mode", "garden:vocabularies/observations.yaml"],
      ["vocabulary-retired-removed", "garden:vocabularies/relations.yaml"],
    ]);
    expect(changes[0]?.details).toMatchObject({ before: "registered", after: "census" });
    expect(changes[1]?.details).toMatchObject({
      vocabulary: "garden/relations",
      entry: "planted-in",
    });
  });

  it("reports a rule a type no longer carries, its declaration moved to another type", async () => {
    const rule = PLANTING.slice(PLANTING.indexOf("rules:"));
    const changes = await diff({
      "constitution/types/planting.yaml": PLANTING.slice(0, PLANTING.indexOf("rules:")),
      "constitution/types/guide.yaml": `${GUIDE}${rule}`,
    });
    expect(changes).toMatchObject([
      {
        kind: "rule-attachment",
        path: "bundle:constitution/types/planting.yaml",
        details: { rule: "source-host-allowed", type: "planting" },
      },
    ]);
  });

  it.each([
    ["extensions", { extensions: { mode: "open" } }],
    ["source-roots", { source_roots: [] }],
    ["field-sources", { field_sources: { title: "basename" } }],
  ])("reports the engine key %s changed", async (kind, overrides) => {
    const changes = await diff({ "config/engine.json": engineJson(overrides) });
    expect(kinds(changes)).toEqual([[kind, "bundle:config/engine.json"]]);
  });
});

describe("law-changed and law-relaxed", () => {
  const change = async () =>
    diff({ "libraries/kit-garden/types/planting.yaml": PLANTING_LIB.replace("warning", "error") });

  it("is law-changed, info and unrouted, at pre-commit", async () => {
    const findings = lawChangeFindings(await change(), { kind: "pre-commit" });
    expect(findings).toMatchObject([
      { rule: "law-changed", severity: "info", details: { kind: "rule-severity" } },
    ]);
    expect(findings[0]?.queue).toBe(undefined);
  });

  it("is law-relaxed, an error, at commit-msg with no reason in the body", async () => {
    for (const message of ["fix: tighten\n", "fix: tighten law-change: in the subject\n"]) {
      expect(lawChangeFindings(await change(), { kind: "commit-msg", message })).toMatchObject([
        { rule: "law-relaxed", severity: "error", queue: "law-review" },
      ]);
    }
  });

  it("is law-changed with the reason at commit-msg when the body carries law-change:", async () => {
    const message =
      "fix: the dating rule blocks\n\nlaw-change: a month is precise enough for thinning\n# a comment\n";
    expect(lawChangeReason(message)).toBe("a month is precise enough for thinning");
    expect(lawChangeFindings(await change(), { kind: "commit-msg", message })).toMatchObject([
      {
        rule: "law-changed",
        severity: "info",
        details: { kind: "rule-severity", reason: "a month is precise enough for thinning" },
      },
    ]);
  });
});

describe("the diff and the rule tests together, as the gate composes them", () => {
  it("makes a rule the diff adds and leaves untested an error, and an old untested one a warning", async () => {
    const dir = vaultDir({ "rule-tests/source-host-allowed/repaired.md": null });
    gitCommitAll(dir);
    writeFileSync(
      join(dir, "constitution/types/guide.yaml"),
      `${GUIDE}rules:\n  - id: guide-titled\n    expr: has(page.fields.title)\n    message: A guide has a title.\n`,
    );
    git(dir, "add", "-A");
    const state = await indexState(dir);
    const index = loaded(loadTypeLaw(state.law));
    const head = loaded(loadTypeLaw(await revisionLawSnapshot(dir, "HEAD")));
    const verdict = judgeTypeLaw(state, index, {
      all: true,
      rulesChanged: changedRules(head, index),
    });
    expect(
      verdict.findings
        .filter((f) => f.rule === "rule-untested")
        .map((f) => [f.details["rule"], f.severity]),
    ).toEqual([
      ["guide-titled", "error"],
      ["source-host-allowed", "warning"],
    ]);
  });
});
