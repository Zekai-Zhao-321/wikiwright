// v2 contracts §8: rule tests and examples, run by the judge over a gardening
// vault under os.tmpdir() — the expect.json contract, the negative page's one
// finding at its location, the repaired twin and the positives drawing none,
// the before/ pairs as the base of an overlay from outside the content
// roots, exclusion from instances and identity, rule-untested as a warning
// and, for a rule the gate's diff changes, an error, and example-fails.
import { afterAll, describe, expect, it } from "bun:test";
import { BASIL } from "./fixtures/garden-judge.ts";
import { cleanUp, judgeVault, only } from "./fixtures/judge-run.ts";

afterAll(cleanUp);

const LAW_CODES = ["rule-untested", "rule-test-fails", "example-fails"];
const lawFindings = (v: Awaited<ReturnType<typeof judgeVault>>) =>
  v.findings.filter((f) => LAW_CODES.includes(f.rule));

const KNOWN_BED = "libraries/kit-garden/rule-tests/known-bed";
const HOST = "rule-tests/source-host-allowed";

const planting = (rest: string, type = "planting") =>
  `---\ntype: ${type}\ntitle: Basil\nbed: herb\nsown: 2026-04-12\n${rest}`;

describe("a complete test set", () => {
  it("holds for every rule of the gardening law: nothing untested, nothing failing", async () => {
    expect(lawFindings(await judgeVault())).toEqual([]);
  });

  it("is not run when the caller asks for none", async () => {
    const verdict = await judgeVault({ [`${KNOWN_BED}/repaired.md`]: null }, { lawTests: false });
    expect(lawFindings(verdict)).toEqual([]);
  });
});

describe("rule-untested", () => {
  it("is a warning for a rule with no negative, no repaired or no positive page", async () => {
    const verdict = await judgeVault({
      [`${KNOWN_BED}/repaired.md`]: null,
      [`${KNOWN_BED}/positive/north.md`]: null,
    });
    expect(only(verdict, "rule-untested")).toMatchObject([
      {
        severity: "warning",
        path: "garden:fragments/planted.yaml",
        details: { rule: "known-bed", missing: ["repaired", "positive"], changed: false },
        queue: "rule-review",
      },
    ]);
  });

  it("is an error for a rule the gate's law diff adds or changes", async () => {
    const verdict = await judgeVault(
      { [`${KNOWN_BED}/repaired.md`]: null },
      { rulesChanged: new Set(["known-bed"]) },
    );
    expect(only(verdict, "rule-untested")).toMatchObject([
      { severity: "error", details: { rule: "known-bed", changed: true } },
    ]);
  });

  it("names a rule with no test set at all", async () => {
    const verdict = await judgeVault({
      "constitution/types/guide.yaml":
        "type: guide\nrole: hub\ndescription: A route.\nrules:\n  - id: guide-titled\n    expr: has(page.fields.title)\n    message: A guide has a title.\n",
    });
    expect(only(verdict, "rule-untested")).toMatchObject([
      {
        path: "bundle:constitution/types/guide.yaml",
        details: { rule: "guide-titled", missing: ["negative", "repaired", "positive"] },
      },
    ]);
    expect(only(verdict, "rule-untested")[0]?.message).toContain("it has no test set");
  });
});

describe("rule-test-fails", () => {
  it("reports a negative page that draws no finding, or not the named one where expect.json says", async () => {
    const none = await judgeVault({
      [`${KNOWN_BED}/negative.md`]: planting("---\n", "garden/planting"),
    });
    expect(only(none, "rule-test-fails")).toMatchObject([
      {
        path: "garden:rule-tests/known-bed/negative.md",
        details: { kind: "negative", rule: "known-bed", found: [] },
      },
    ]);
    const elsewhere = await judgeVault({
      [`${KNOWN_BED}/expect.json`]:
        '{"rule": "known-bed", "location": {"section": "History", "occurrence": 0}}',
    });
    expect(only(elsewhere, "rule-test-fails")).toMatchObject([
      { details: { kind: "negative", found: [{ rule: "known-bed", location: { kind: "page" } }] } },
    ]);
  });

  it("reports a negative page that draws a second finding beside the named one", async () => {
    const verdict = await judgeVault({
      [`${KNOWN_BED}/negative.md`]:
        "---\ntype: garden/planting\ntitle: Basil\nbed: east\nsown: 2026-04-12\ncolour: green\n---\n",
    });
    expect(only(verdict, "rule-test-fails")[0]?.details["found"]).toHaveLength(2);
  });

  it("reports a repaired or a positive page that draws a finding", async () => {
    const verdict = await judgeVault({
      [`${KNOWN_BED}/repaired.md`]: planting("---\n", "garden/planting").replace("herb", "east"),
      [`${HOST}/positive/no-source.md`]: planting("---\n\nSee [[Nowhere]].\n"),
    });
    expect(only(verdict, "rule-test-fails").map((f) => [f.path, f.details["kind"]])).toEqual([
      ["bundle:rule-tests/source-host-allowed/positive/no-source.md", "positive"],
      ["garden:rule-tests/known-bed/repaired.md", "repaired"],
    ]);
  });

  it("applies no exception on a test page or an example: a rule is not repaired by waiving it", async () => {
    const waiver = "exceptions: [{ rule: known-bed, reason: a pond bed }]\n";
    const waived = planting(`${waiver}---\n`, "garden/planting").replace("herb", "east");
    const verdict = await judgeVault({
      [`${KNOWN_BED}/repaired.md`]: waived,
      [`${KNOWN_BED}/positive/east.md`]: waived,
      "examples/east.md": planting(`${waiver}---\n`).replace("herb", "pond"),
    });
    expect(only(verdict, "rule-test-fails").map((f) => [f.path, f.details["kind"]])).toEqual([
      ["garden:rule-tests/known-bed/positive/east.md", "positive"],
      ["garden:rule-tests/known-bed/repaired.md", "repaired"],
    ]);
    expect(only(verdict, "rule-test-fails")[0]?.details["found"]).toMatchObject([
      { rule: "known-bed" },
    ]);
    expect(only(verdict, "example-fails")).toMatchObject([
      { path: "bundle:examples/east.md", details: { kind: "findings" } },
    ]);
    expect(only(verdict, "exception-applied")).toEqual([]);
  });

  it.each([
    ["no expect.json", null],
    ["expect.json that is not JSON", "{ rule: known-bed"],
    ["expect.json naming another rule", '{"rule": "history-dated", "location": "page"}'],
    ["expect.json with an unknown key", '{"rule": "known-bed", "location": "page", "x": 1}'],
    ["a location of no known form", '{"rule": "known-bed", "location": {"section": "History"}}'],
  ])("reports %s as expect-invalid", async (_what, text) => {
    const verdict = await judgeVault({ [`${KNOWN_BED}/expect.json`]: text });
    expect(only(verdict, "rule-test-fails").map((f) => f.details["kind"])).toEqual([
      "expect-invalid",
    ]);
  });

  it("reports a test set for no rule, and a file that is no part of a test", async () => {
    const verdict = await judgeVault({
      "rule-tests/no-such-rule/negative.md": planting("---\n"),
      [`${KNOWN_BED}/notes.md`]: "Notes on the test.\n",
    });
    expect(only(verdict, "rule-test-fails").map((f) => [f.path, f.details["kind"]])).toEqual([
      ["bundle:rule-tests/no-such-rule", "rule-unknown"],
      ["garden:rule-tests/known-bed/notes.md", "file-unknown"],
    ]);
  });
});

describe("the overlay a test page is judged in", () => {
  /** A transition rule on the bundle's guide, with before/ pairs. */
  const GUIDE = `type: guide
role: hub
description: A route through the garden.
sections:
  list:
    - { heading: Start here, min: 1, max: 1 }
rules:
  - id: guide-grows
    expr: '!before.present || size(page.sections) >= size(before.sections)'
    message: A guide only grows.
`;
  const guide = (sections: string) =>
    `---\ntype: guide\ntitle: Route\n---\n\n## Start here\n${sections}`;
  const tests = {
    "constitution/types/guide.yaml": GUIDE,
    "rule-tests/guide-grows/expect.json": '{"rule": "guide-grows", "location": "page"}',
    "rule-tests/guide-grows/before/negative.md": guide("\n## Paths\n\n## Beds\n"),
    "rule-tests/guide-grows/negative.md": guide("\n## Paths\n"),
    "rule-tests/guide-grows/before/repaired.md": guide("\n## Paths\n"),
    "rule-tests/guide-grows/repaired.md": guide("\n## Paths\n\n## Beds\n"),
    "rule-tests/guide-grows/positive/new.md": guide(""),
  };

  it("takes a before/ twin as the base, and judges a test page without one as new", async () => {
    expect(lawFindings(await judgeVault(tests))).toEqual([]);
    // Without its before/ twin the negative is new to its base: it passes, and the test fails.
    const unpaired = await judgeVault({
      ...tests,
      "rule-tests/guide-grows/before/negative.md": null,
    });
    expect(only(unpaired, "rule-test-fails")).toMatchObject([
      { details: { kind: "negative", found: [] } },
    ]);
  });

  it("excludes a test page from instances and identity, and resolves its links in the vault", async () => {
    const verdict = await judgeVault({
      ...tests,
      "constitution/types/guide.yaml": GUIDE.replace(
        "sections:",
        "instances: { max: 1 }\nsections:",
      ),
      // Titled like a vault page and linking to one: neither a collision nor a dangling link.
      "rule-tests/guide-grows/positive/basil.md":
        "---\ntype: guide\ntitle: Basil\n---\n\n## Start here\n\nSee [[Herb bed]].\n",
    });
    expect(lawFindings(verdict)).toEqual([]);
    expect(only(verdict, "instances-max")).toEqual([]);
    expect(only(verdict, "identity-collision")).toEqual([]);
  });
});

describe("example-fails", () => {
  it("judges every page under examples/ as a page of its type", async () => {
    const verdict = await judgeVault({
      "examples/pond.md": "---\ntype: planting\ntitle: Pond\nbed: pond\nsown: 2026-04-12\n---\n",
    });
    expect(only(verdict, "example-fails")).toMatchObject([
      {
        path: "bundle:examples/pond.md",
        details: {
          kind: "findings",
          found: [{ rule: "page-shape-invalid" }, { rule: "known-bed" }],
        },
      },
    ]);
  });

  it("holds a type's examples key: a path that names no example, and an example of another type", async () => {
    const verdict = await judgeVault({
      "constitution/types/guide.yaml":
        "type: guide\nrole: hub\ndescription: A route.\nexamples: [examples/planting.md, examples/route.md]\n",
      "libraries/kit-garden/types/bed.yaml":
        "type: bed\nrole: reference\ndescription: One bed.\nabstract: true\nexamples: [examples/bed.md]\n",
      "libraries/kit-garden/examples/bed.md": "---\ntype: garden/bed\ntitle: A bed\n---\n",
    });
    expect(only(verdict, "example-fails").map((f) => [f.path, f.details["kind"]])).toEqual([
      ["bundle:constitution/types/guide.yaml", "missing"],
      ["bundle:examples/planting.md", "type-mismatch"],
    ]);
    // An abstract type's example is a page of that abstract type, and passes.
    expect(only(verdict, "example-fails").filter((f) => f.path.startsWith("garden:"))).toEqual([]);
  });

  it("passes the page the gardening bundle ships as its example", async () => {
    const verdict = await judgeVault({ "examples/basil.md": BASIL });
    expect(only(verdict, "example-fails")).toEqual([]);
  });
});
