// v2 contracts §6: the CEL profile — admission by AST walk, each limit named,
// the static evaluation bound, evaluation to pass, fail, rule-error or
// unevaluated — and `Intl` proven unreachable: by a grep of the built bundle
// and by call.
import { describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@bufbuild/cel";
import { strings } from "@bufbuild/cel/ext";
import {
  admitRule,
  CEL_PROFILE,
  COST_MAX,
  compileRule,
  lawBoundIssues,
  overBound,
  RANGE_BOUNDS,
} from "../src/index.ts";

function limit(expr: string): string | undefined {
  const admission = admitRule(expr);
  return admission.ok ? undefined : admission.limit;
}

function run(expr: string, bindings: Record<string, unknown> = {}) {
  const admission = admitRule(expr);
  if (!admission.ok) throw new Error(admission.message);
  return compileRule(admission).evaluate({
    page: {},
    config: {},
    facts: {},
    before: { present: false },
    ...bindings,
  } as never);
}

describe("admission", () => {
  it("names the profile", () => {
    expect(CEL_PROFILE).toBe("cel-profile/1");
  });

  it.each([
    ["bytes", `page.path == "${"a".repeat(4100)}"`],
    ["parentheses", `${"(".repeat(33)}true${")".repeat(33)}`],
    ["parse", "page.fields.bed in"],
    ["nodes", Array.from({ length: 150 }, () => "1==1").join("||")],
    ["call", `timestamp("2026-03-08T02:30:00Z") > timestamp("2026-03-07T02:30:00Z")`],
    ["call", `duration("1h") > duration("1m")`],
    ["call", `page.fields.planted.getHours() == 2`],
    ["call", `"%d".format([1]) == "1"`],
    ["literal", "google.protobuf.Timestamp{seconds: 1} != google.protobuf.Timestamp{seconds: 2}"],
    ["pattern", `page.path.matches("a(?=b)")`],
    ["nesting", "page.sections.all(s, s.items.all(i, config.x.all(c, true)))"],
    [
      "chaining",
      "section.items.all(a, true) && section.items.all(b, true) && section.items.all(c, true) && section.items.all(d, true) && section.items.all(e, true)",
    ],
    ["range-not-bound", "section.items.map(i, i.label).all(l, l != '')"],
    ["range-not-bound", "section.items.filter(i, i.kind == 'relation').all(r, r.target.resolved)"],
    ["range-not-bound", "page.body.split('\\n').all(l, size(l) < 200)"],
    ["range-not-bound", "[1, 2, 3].all(n, n > 0)"],
    ["range-not-bound", "section.path.all(h, h != '')"],
    ["range-not-bound", "config.all(k, k != '')"],
    ["range-not-bound", "section.items.all(i, i.rationale.all(r, r != ''))"],
    ["cost-bound", "section.items.all(i, section.items.exists(j, j.date == i.date))"],
    [
      "cost-bound",
      "config.require.all(r, section.items.filter(i, i.label in r.labels).size() >= r.min)",
    ],
  ])("refuses %s", (expected, expr) => {
    expect(limit(expr)).toBe(expected);
  });

  it("admits ranges that are direct interface paths, each under its bound", () => {
    const cost = (expr: string) => {
      const admission = admitRule(expr);
      return admission.ok ? admission.cost : admission.limit;
    };
    expect(cost("section.items.all(i, i.precision == 'day')")).toBe(RANGE_BOUNDS.items);
    expect(cost("page.sections.exists(s, s.heading == 'History')")).toBe(RANGE_BOUNDS.sections);
    expect(cost("page.fields.covers.all(p, p != '')")).toBe(RANGE_BOUNDS.list);
    expect(cost("page.frontmatter['tags'].all(t, t != '')")).toBe(RANGE_BOUNDS.list);
    expect(cost("facts.vocabularies['garden/beds'].exists(b, b == 'herb')")).toBe(
      RANGE_BOUNDS.facts,
    );
    expect(cost("config.ranges['grows-in'].exists(t, t == 'garden/bed')")).toBe(RANGE_BOUNDS.list);
    // A section's items inside page.sections: 200 × 5,000 exceeds the bound.
    expect(cost("page.sections.all(s, s.items.all(i, i.kind != ''))")).toBe("cost-bound");
    // Nested within the bound: 200 × a 1,000 list would not fit; 200 × 1 does.
    expect(cost("page.sections.all(s, s.path.size() > 0)")).toBe(RANGE_BOUNDS.sections);
    // Side by side, the worst cases add.
    expect(cost("section.items.all(i, true) && page.fields.covers.all(p, true)")).toBe(
      RANGE_BOUNDS.items + RANGE_BOUNDS.list,
    );
    expect(cost("config.labels.all(l, config.more.exists(m, m == l))")).toBe(
      RANGE_BOUNDS.list * RANGE_BOUNDS.list > COST_MAX
        ? "cost-bound"
        : RANGE_BOUNDS.list * RANGE_BOUNDS.list,
    );
  });

  it("reads a raw string's parentheses as text", () => {
    expect(limit(`page.path.matches(r"${"(".repeat(40)}")`)).toBe("pattern");
    expect(limit(`page.path == "${")(".repeat(40)}"`)).toBe(undefined);
  });

  it("marks an expression that reads before as a transition rule", () => {
    const transition = admitRule("size(page.sections) >= size(before.sections)");
    expect(transition.ok && transition.transition).toBe(true);
    const shadowed = admitRule("page.sections.all(before, before.heading != '')");
    expect(shadowed.ok && shadowed.transition).toBe(false);
  });
});

describe("the declared bounds, held on the data", () => {
  it("finds the first list or map below the top over its bound, as a pointer", () => {
    const big = Array.from({ length: 1001 }, (_, i) => i);
    expect(overBound({ tags: big.slice(0, 1000) }, 1000)).toBe(undefined);
    expect(overBound({ tags: big }, 1000)).toEqual({ pointer: "/tags", size: 1001 });
    expect(overBound({ a: [{ b: big }] }, 1000)).toEqual({ pointer: "/a/0/b", size: 1001 });
    const wide = Object.fromEntries(big.map((i) => [`k${i}`, i]));
    expect(overBound({ m: wide }, 1000)).toEqual({ pointer: "/m", size: 1001 });
    // The top-level map is not itself a range.
    expect(overBound(wide, 1000)).toBe(undefined);
  });

  it("refuses a law of more than 10,000 types or vocabularies as law-too-large", () => {
    const many = (n: number) =>
      new Map(Array.from({ length: n }, (_, i) => [`t${i}`, { parts: [] } as never]));
    expect(lawBoundIssues(many(RANGE_BOUNDS.facts), new Map())).toEqual([]);
    expect(lawBoundIssues(many(RANGE_BOUNDS.facts + 1), new Map())).toMatchObject([
      { code: "law-too-large", details: { limit: "facts", size: RANGE_BOUNDS.facts + 1 } },
    ]);
    const vocabularies = new Map(
      Array.from({ length: RANGE_BOUNDS.facts + 1 }, (_, i) => [
        `v${i}`,
        { name: `v${i}`, where: "bundle:x", entries: new Map() } as never,
      ]),
    );
    expect(lawBoundIssues(new Map(), vocabularies).map((i) => i.code)).toEqual(["law-too-large"]);
  });
});

describe("evaluation", () => {
  it("passes on true and finds on false", () => {
    expect(
      run("page.fields.bed in config.beds", {
        page: { fields: { bed: "herb" } },
        config: { beds: ["herb"] },
      }),
    ).toEqual({
      verdict: "pass",
    });
    expect(
      run("page.fields.bed in config.beds", {
        page: { fields: { bed: "east" } },
        config: { beds: ["herb"] },
      }),
    ).toEqual({
      verdict: "fail",
    });
  });

  it("reports a non-bool and an error value as rule-error kinds", () => {
    const nonBool = run("size(page.fields.tags) + 1", { page: { fields: { tags: [] } } });
    expect(nonBool).toMatchObject({ verdict: "error", kind: "non-bool" });
    const error = run("page.fields.nothing == 1", { page: { fields: {} } });
    expect(error).toMatchObject({ verdict: "error", kind: "error" });
    expect(error.verdict === "error" && error.message).toContain("nothing");
  });

  it("holds a transition rule unevaluated with no base, and evaluates it with one", () => {
    const expr = "size(page.sections) >= size(before.sections)";
    expect(run(expr, { page: { sections: [] } })).toEqual({
      verdict: "unevaluated",
      reason: "no-base",
    });
    expect(
      run(expr, { page: { sections: [] }, before: { present: true, sections: [{}] } }),
    ).toEqual({
      verdict: "fail",
    });
  });

  it("binds YAML integers as int and other numbers as double", () => {
    expect(
      run("page.fields.rows == 4 && page.fields.ratio == 0.5", {
        page: { fields: { rows: 4n, ratio: 0.5 } },
      }),
    ).toEqual({ verdict: "pass" });
  });

  it("offers the strings extension, RE2 matches, and no format", () => {
    expect(run("'Basil'.lowerAscii() == 'basil' && ['a', 'b'].join('-') == 'a-b'")).toEqual({
      verdict: "pass",
    });
    expect(run("'herb bed north'.matches('bed')")).toEqual({ verdict: "pass" });
    expect(run("'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!'.matches('^(a+)+$')")).toEqual({
      verdict: "fail",
    });
  });
});

describe("Intl is unreachable", () => {
  const INTL_SITES = ["new Intl.DateTimeFormat(", "new Intl.NumberFormat("];

  /**
   * `bun build` in a child, into a file under os.tmpdir(): Bun.build called
   * inside a `bun test` process fails to read its inputs on Bun 1.3.11.
   */
  function bundle(entry: string): string {
    const dir = mkdtempSync(join(tmpdir(), "ww-intl-"));
    try {
      const out = join(dir, "bundle.js");
      execFileSync(
        process.execPath,
        ["build", entry, "--target=bun", "--format=esm", "--outfile", out],
        {
          stdio: "ignore",
        },
      );
      return readFileSync(out, "utf8");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  function sites(text: string): string[] {
    const out: string[] = [];
    for (const match of text.matchAll(/Intl\./gu)) {
      out.push(text.slice(Math.max(0, match.index - 4), match.index + 40));
    }
    return out;
  }

  it("by grep: the CLI's bundle holds exactly two Intl sites, the ones the profile refuses", () => {
    // The bundle the binary is compiled from: the CLI and everything it
    // imports, the engine library with its CEL, Ajv and RE2 included.
    const text = bundle(fileURLToPath(new URL("../../cli/dist/main.js", import.meta.url)));
    const found = sites(text);
    // std/time.js: a get* time method given a time zone; ext/strings.js:
    // format's fixed-point clause. Nothing else in the bundle names Intl.
    expect(found).toHaveLength(2);
    for (const site of INTL_SITES) expect(found.filter((s) => s.includes(site))).toHaveLength(1);
  });

  it("by call: every call that reaches either site is refused at load, and format is unbound", () => {
    for (const expr of [
      `timestamp("2026-03-08T02:30:00Z").getHours("Europe/Berlin") == 2`,
      `page.fields.at.getDayOfWeek("Asia/Tokyo") == 1`,
      `"%.2f".format([1.5]) == "1.50"`,
    ]) {
      expect(limit(expr)).toBe("call");
    }
    // Planned past admission, format is still no function of the profile:
    // the strings extension is registered with it removed.
    expect(strings.some((f) => f.name === "format")).toBe(true);
    const unadmitted = compileRule({
      ok: true,
      ast: parse('"%.2f".format([1.5]) == "1.50"'),
      transition: false,
      cost: 0,
    });
    const verdict = unadmitted.evaluate({
      page: {},
      config: {},
      facts: {},
      before: { present: false },
    });
    expect(verdict).toMatchObject({ verdict: "error", kind: "error" });
    expect(verdict.verdict === "error" && verdict.message).toContain("format");
  });
});
