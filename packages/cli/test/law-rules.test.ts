// v2 contracts §5, §6: rules under the CEL profile, loaded from the gardening
// constitution under os.tmpdir() — refused at load with the limit named, and
// the six rules of the feasibility spike evaluated over the page interface of
// real parsed pages, a passing and a failing sample each.
import { afterAll, describe, expect, it } from "bun:test";
import {
  buildFacts,
  buildPageInterface,
  celOccurrence,
  loadTypeLaw,
  normalizeIdentity,
  parsePage,
  type RuleVerdict,
  type TypeLaw,
  type TypeLawResult,
} from "@wikiwright/core";
import { workingTreeLawSnapshot } from "../src/lawfiles.ts";
import { gardenTree, removeTree, type Tree, writeTree } from "./fixtures/garden-law.ts";

const made: string[] = [];
afterAll(() => {
  for (const dir of made) removeTree(dir);
});

async function load(overrides: Tree = {}): Promise<TypeLawResult> {
  const dir = writeTree({ ...gardenTree(), ...overrides });
  made.push(dir);
  return loadTypeLaw(await workingTreeLawSnapshot(dir));
}

const PLANTING = "constitution/types/planting.yaml";

/** The bundle planting with one more rule appended. */
function withRule(rule: string): Tree {
  const text = gardenTree()[PLANTING] ?? "";
  return { [PLANTING]: `${text}${rule}` };
}

function rule(id: string, expr: string, extra = ""): string {
  return `  - id: ${id}\n    expr: ${JSON.stringify(expr)}\n    message: ${id}.\n${extra}`;
}

describe("rule-invalid at load, the limit named", () => {
  it.each([
    ["bytes", `page.path == "${"a".repeat(4100)}"`],
    ["parentheses", `${"(".repeat(33)}true${")".repeat(33)}`],
    ["parse", "page.fields.bed in"],
    ["nodes", Array.from({ length: 150 }, () => "1==1").join("||")],
    ["call", 'timestamp("2026-03-08T02:30:00Z") > timestamp("2026-01-01T00:00:00Z")'],
    ["call", 'duration("1h") > duration("1m")'],
    ["call", "page.fields.sown.getFullYear() == 2026"],
    ["call", '"%s".format([page.path]) != ""'],
    ["literal", "google.protobuf.Timestamp{seconds: 1} != google.protobuf.Timestamp{seconds: 2}"],
    ["pattern", 'page.path.matches("(a)\\\\1")'],
    ["nesting", "page.sections.all(s, s.items.all(i, config.beds.all(b, true)))"],
    [
      "chaining",
      "config.beds.all(a, true) && config.beds.all(b, true) && config.beds.all(c, true) && config.beds.all(d, true) && config.beds.all(e, true)",
    ],
    ["range-not-bound", "page.body.split('\\n').all(l, size(l) < 400)"],
    ["range-not-bound", "page.sections.filter(s, s.heading == 'History').all(s, true)"],
    ["cost-bound", "page.sections.all(s, s.items.all(i, i.kind != ''))"],
  ])("refuses %s", async (limit, expr) => {
    const result = await load(withRule(rule("probe", expr)));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((i) => [i.code, i.details?.["limit"]])).toEqual([
      ["rule-invalid", limit],
    ]);
    expect(result.issues[0]).toMatchObject({
      where: "bundle:constitution/types/planting.yaml",
      details: { pointer: "/rules/1/expr", rule: "probe" },
    });
  });
});

describe("the law's own ranges, bound at load (§6)", () => {
  const list = (n: number) => `[${Array.from({ length: n }, (_, i) => `b${i}`).join(", ")}]`;
  const outcome = (result: TypeLawResult) =>
    result.ok
      ? "ok"
      : result.issues.map((i) => [i.code, i.where, i.details?.["pointer"], i.details?.["size"]]);

  it("refuses a rule's config list over 1,000 as rule-invalid, and admits one at 1,000", async () => {
    const config = (n: number) =>
      withRule(
        rule("probe", "page.fields.bed in config.beds", `    config: { beds: ${list(n)} }\n`),
      );
    expect(outcome(await load(config(1000)))).toBe("ok");
    const result = await load(config(1001));
    expect(outcome(result)).toEqual([
      ["rule-invalid", "bundle:constitution/types/planting.yaml", "/rules/1/config/beds", 1001],
    ]);
    expect(result.ok ? undefined : result.issues[0]?.details).toMatchObject({
      rule: "probe",
      limit: "config",
      bound: 1000,
    });
  });

  it("refuses a configure list over 1,000 where it is written", async () => {
    const text = gardenTree()[PLANTING] ?? "";
    const result = await load({
      [PLANTING]: text.replace(
        "known-bed: { beds: [north, south, herb, east] }",
        `known-bed: { beds: ${list(1001).replace("[", "[north, south, herb, ")} }`,
      ),
    });
    expect(outcome(result)).toEqual([
      [
        "rule-invalid",
        "bundle:constitution/types/planting.yaml",
        "/configure/known-bed/beds",
        1004,
      ],
    ]);
  });

  it("refuses a vocabulary over 10,000 entries, contributions counted", async () => {
    const entries = (n: number) =>
      Array.from({ length: n }, (_, i) => `  shade-${i}: {}\n`).join("");
    const contribution = (n: number) => ({
      "constitution/vocabularies/relations.yaml": `vocabulary: relations\ncontributes_to: garden/relations\nentries:\n${entries(n)}`,
    });
    // The library declares two; 9,998 more reach the bound.
    expect(outcome(await load(contribution(9998)))).toBe("ok");
    expect(outcome(await load(contribution(9999)))).toEqual([
      ["vocabulary-invalid", "garden:vocabularies/relations.yaml", "/entries", 10001],
    ]);
  });

  it("refuses a declared default list over 1,000: it enters page.fields", async () => {
    const text = gardenTree()[PLANTING] ?? "";
    const result = await load({
      [PLANTING]: text.replace(
        "    updated: { type: string, format: date }",
        `    updated: { type: string, format: date }\n    beds: { type: array, default: ${list(1001)} }`,
      ),
    });
    expect(outcome(result)).toEqual([
      [
        "type-invalid",
        "bundle:constitution/types/planting.yaml",
        "/fields/properties/beds/default",
        1001,
      ],
    ]);
  });
});

// ---------------------------------------------------------------------------
// the six spike rules over the page interface

/** The spike's two nested forms, which the static bound refuses. */
const SPIKE_RELATIONS_REQUIRED =
  "config.require.all(r, section.items.filter(i, i.label in r.labels).size() >= r.min)";
const SPIKE_RELATION_RANGE =
  "section.items.all(i, !(i.label in config.ranges) || (i.target.resolved && (i.target.type in config.ranges[i.label] || facts.ancestry[i.target.type].exists(t, t in config.ranges[i.label]))))";

/** Their admitted forms: one require row per rule, the range as one RE2 match over the joined ancestry. */
const RULES = [
  rule(
    "relations-required",
    "section.items.filter(i, i.label in config.labels).size() >= config.min",
    "    section: Relations\n    config: { labels: [grows-in], min: 1 }\n",
  ),
  rule(
    "relation-range",
    'section.items.all(i, !(i.label in config.ranges) || (i.target.resolved && ([i.target.type] + facts.ancestry[i.target.type]).join(" ").matches(config.ranges[i.label])))',
    "    section: Relations\n    config:\n      ranges: { grows-in: '(^| )garden/bed( |$)', companion-of: '(^| )garden/planting( |$)' }\n",
  ),
].join("");

const DIGEST_TYPE: Tree = {
  "constitution/types/logbook-digest.yaml": `type: logbook-digest
role: reference
description: A digest of logbook files.
fields:
  type: object
  properties:
    covers: { type: array, items: { type: string }, minItems: 1 }
rules:
  - id: covers-repository-path
    expr: 'page.fields.covers.all(p, p != "" && !p.startsWith("/") && !p.matches(r"(^|/)\\.\\.(/|$)"))'
    message: A covered path is a repository path.
`,
};

const HERB_BED = "---\ntype: garden/bed\ntitle: Herb bed\n---\n";
const TOMATO = "---\ntype: planting\ntitle: Tomato\nbed: south\nsown: 2026-04-20\n---\n";
function basil(frontmatter: string, history: string, relations: string): string {
  return `---
type: planting
title: Basil
bed: herb
sown: 2026-04-12
${frontmatter}---

# Basil

## History

${history}

## Relations

${relations}
`;
}
const BASIL_GOOD = basil(
  "source: https://seeds.example/basil\n",
  "- 2026-04-12 — sown\n- 2026-05-02 — thinned",
  "- grows-in [[Herb bed]]\n- companion-of [[Tomato]]",
);

let law: TypeLaw | undefined;
async function spikeLaw(): Promise<TypeLaw> {
  if (law !== undefined) return law;
  const result = await load({ ...withRule(RULES), ...DIGEST_TYPE });
  if (!result.ok) throw new Error(JSON.stringify(result.issues, null, 2));
  law = result.law;
  return law;
}

/** Every verdict of one rule on one page: once per page rule, once per matching occurrence. */
async function verdicts(
  ruleId: string,
  pagePath: string,
  pages: Record<string, string>,
): Promise<RuleVerdict[]> {
  const loaded = await spikeLaw();
  const index = new Map<string, { path: string; type: string }>();
  for (const [path, text] of Object.entries(pages)) {
    const read = parsePage(path, new TextEncoder().encode(text), loaded);
    if (!read.ok) throw new Error(read.message);
    const title = read.page.frontmatter["title"];
    if (typeof title === "string" && read.page.type !== undefined) {
      index.set(normalizeIdentity(title), { path, type: read.page.type.name });
    }
  }
  const resolve = (name: string) => index.get(normalizeIdentity(name));
  const read = parsePage(
    pagePath,
    new TextEncoder().encode(pages[pagePath] ?? ""),
    loaded,
    resolve,
  );
  if (!read.ok || read.page.type === undefined) throw new Error("no page");
  const type = read.page.type;
  const declared = type.rules.find((r) => r.id === ruleId);
  const compiled = loaded.rules.get(ruleId);
  if (declared === undefined || compiled === undefined)
    throw new Error(`${ruleId} is not on ${type.name}`);
  const bindings = {
    base: false,
    page: buildPageInterface(read.page, type),
    config: declared.config,
    facts: buildFacts(loaded, read.page, resolve),
    before: { present: false },
  };
  if (declared.section === undefined) return [compiled.evaluate(bindings)];
  return read.page.occurrences
    .filter((o) => o.heading === declared.section && o.depth === type.sections?.depth)
    .map((o) => compiled.evaluate({ ...bindings, section: celOccurrence(o) }));
}

const VAULT = { "wiki/herb-bed.md": HERB_BED, "wiki/tomato.md": TOMATO };

describe("the six spike rules over the page interface", () => {
  const cases: [string, string, string][] = [
    ["known-bed", BASIL_GOOD, BASIL_GOOD.replace("bed: herb", "bed: pond")],
    [
      "source-host-allowed",
      BASIL_GOOD,
      BASIL_GOOD.replace("https://seeds.example/basil", "https://market.example/basil"),
    ],
    ["history-dated", BASIL_GOOD, BASIL_GOOD.replace("2026-05-02 — thinned", "2026-05 — thinned")],
    ["relations-required", BASIL_GOOD, BASIL_GOOD.replace("- grows-in [[Herb bed]]\n", "")],
    [
      "relation-range",
      BASIL_GOOD,
      BASIL_GOOD.replace("grows-in [[Herb bed]]", "grows-in [[Tomato]]"),
    ],
  ];
  it.each(cases)(
    "%s passes its passing sample and finds on its failing one",
    async (id, pass, fail) => {
      expect(await verdicts(id, "wiki/basil.md", { ...VAULT, "wiki/basil.md": pass })).toEqual([
        { verdict: "pass" },
      ]);
      expect(await verdicts(id, "wiki/basil.md", { ...VAULT, "wiki/basil.md": fail })).toEqual([
        { verdict: "fail" },
      ]);
    },
  );

  it("covers-repository-path passes its passing sample and finds on its failing one", async () => {
    const digest = (covers: string) =>
      `---\ntype: logbook-digest\ntitle: Season digest\ncovers: ${covers}\n---\n`;
    const pass = { "raw/digest.md": digest("[raw/logbook/2026.md, raw/..notes/x.md]") };
    const fail = { "raw/digest.md": digest("[raw/logbook/2026.md, raw/../../etc/passwd]") };
    expect(await verdicts("covers-repository-path", "raw/digest.md", pass)).toEqual([
      { verdict: "pass" },
    ]);
    expect(await verdicts("covers-repository-path", "raw/digest.md", fail)).toEqual([
      { verdict: "fail" },
    ]);
  });

  it("admits the spike's nested forms under ruling 1: a config list as long as it is, a chain at 32", async () => {
    const forms: [string, string][] = [
      [SPIKE_RELATIONS_REQUIRED, "    config: { require: [{ labels: [grows-in], min: 1 }] }\n"],
      [
        SPIKE_RELATION_RANGE,
        "    config: { ranges: { grows-in: [garden/bed], companion-of: [garden/planting] } }\n",
      ],
    ];
    for (const [expr, config] of forms) {
      const result = await load(
        withRule(rule("nested", expr, `    section: Relations\n${config}`)),
      );
      expect(result.ok ? "ok" : result.issues).toBe("ok");
    }
  });

  it("refuses a rule whose configure grows its config past the bound, at the type that configures it", async () => {
    const text = gardenTree()[PLANTING] ?? "";
    const beds = (n: number) => `[${Array.from({ length: n }, (_, i) => `b${i}`).join(", ")}]`;
    const tree = (n: number): Tree => ({
      [PLANTING]: `${text}${rule(
        "bed-items",
        "config.beds.all(b, section.items.all(i, true))",
        "    section: Observations\n    config: { beds: [b0] }\n",
      )}`,
      "constitution/types/raised-planting.yaml": `type: raised-planting
extends: planting
description: A planting in a raised bed.
configure:
  bed-items: { beds: ${beds(n)} }
`,
    });
    // 40 beds × 5,000 items is the bound itself; 41 is over it.
    const at = await load(tree(40));
    expect(at.ok ? "ok" : at.issues).toBe("ok");
    const over = await load(tree(41));
    expect(over.ok ? [] : over.issues.map((i) => [i.code, i.where, i.details])).toEqual([
      [
        "rule-invalid",
        "bundle:constitution/types/raised-planting.yaml",
        {
          pointer: "/configure/bed-items",
          rule: "bed-items",
          limit: "cost-bound",
          type: "raised-planting",
        },
      ],
    ]);
  });

  it("evaluates a section rule once per matching occurrence and skips a page with none", async () => {
    const twice = BASIL_GOOD.replace(
      "## Relations",
      "## History\n\n- 2026 — second season\n\n## Relations",
    );
    expect(
      await verdicts("history-dated", "wiki/basil.md", { ...VAULT, "wiki/basil.md": twice }),
    ).toEqual([{ verdict: "pass" }, { verdict: "fail" }]);
    expect(await verdicts("history-dated", "wiki/tomato.md", VAULT)).toEqual([]);
  });
});
