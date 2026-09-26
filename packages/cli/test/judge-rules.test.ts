// v2 contracts §5, §6: the CEL rules a page's type carries, evaluated by the
// judge over a gardening vault under os.tmpdir() — a page rule once per
// page, a section rule once per matching occurrence, false as a finding
// under the rule's severity and message, anything else as rule-error with
// its kind, a transition rule unevaluated with no base — and §3.1's
// exceptions: applied, stale and illegal.
import { afterAll, describe, expect, it } from "bun:test";
import { overlayState } from "../src/lawstate.ts";
import { BASIL } from "./fixtures/garden-judge.ts";
import { blocking, cleanUp, judgeState, judgeVault, only, vaultDir } from "./fixtures/judge-run.ts";

afterAll(cleanUp);

/** A type whose rules the tests below need: one fails, two cannot be bools, one reads before. */
const LOG = `type: log
role: reference
description: A garden log.
sections:
  list:
    - { heading: Days, grammar: entries }
rules:
  - id: log-titled
    expr: 'has(page.fields.title) && page.fields.title.startsWith("Log")'
    message: A log's title starts with "Log".
  - id: log-size
    expr: size(page.sections)
    message: Not a bool.
  - id: log-missing
    expr: page.fields.nothing == 1
    message: No such field.
  - id: log-grows
    expr: '!before.present || size(page.sections) >= size(before.sections)'
    message: A log only grows.
`;

const LOG_PAGE = `---
type: log
title: Log of the spring
---

# Log of the spring

## Days

- 2026-04-01 — first sowing
`;

/** A crop over the library's planting, which takes known-bed with its declared beds. */
const CROP = `type: crop
extends: garden/planting
description: A crop in a bed the library knows.
`;

describe("a rule's verdict as a finding (§6)", () => {
  it("reports false under the rule's severity and message, at the page", async () => {
    const verdict = await judgeVault({
      "constitution/types/crop.yaml": CROP,
      "wiki/Leek.md": BASIL.replace("type: planting", "type: crop")
        .replace("title: Basil", "title: Leek")
        .replace("bed: herb", "bed: east")
        .replace("source: https://seeds.example/basil\n", ""),
    });
    expect(only(verdict, "known-bed")).toEqual([
      {
        rule: "known-bed",
        severity: "error",
        path: "wiki/Leek.md",
        location: { kind: "page" },
        message: "The bed is not one this garden has.",
        details: { declared_by: "garden/planted" },
        queue: "rule-review",
      },
    ]);
  });

  it("evaluates a section rule once per matching occurrence, at that occurrence", async () => {
    const verdict = await judgeVault({
      "wiki/Basil.md": BASIL.replace(
        "## Relations",
        "## History\n\n- 2026-05 — thinned\n\n## Relations",
      ),
    });
    expect(only(verdict, "history-dated")).toMatchObject([
      {
        severity: "warning",
        location: { kind: "section", heading: "History", occurrence: 1, line: 19 },
      },
    ]);
    expect(verdict.coverage["history-dated"]).toMatchObject({ evaluated: 1 });
  });

  it("reads config after configure, and the urls the shape declares", async () => {
    const verdict = await judgeVault({
      "wiki/Basil.md": BASIL.replace("https://seeds.example/basil", "https://market.example/basil"),
    });
    expect(blocking(verdict)).toEqual([["wiki/Basil.md", "source-host-allowed"]]);
  });

  it("reports a result that is not a bool, and an error, as rule-error with its kind", async () => {
    const verdict = await judgeVault({
      "constitution/types/log.yaml": LOG,
      "wiki/Log of the spring.md": LOG_PAGE,
    });
    expect(
      only(verdict, "rule-error").map((f) => [f.details["rule"], f.details["kind"], f.queue]),
    ).toEqual([
      ["log-missing", "error", "rule-review"],
      ["log-size", "non-bool", "rule-review"],
    ]);
    expect(only(verdict, "rule-error")[0]?.details["error"]).toContain("nothing");
    expect(only(verdict, "log-titled")).toEqual([]);
  });
});

describe("a transition rule (§5)", () => {
  const log = { "constitution/types/log.yaml": LOG, "wiki/Log of the spring.md": LOG_PAGE };

  it("is unevaluated under the working tree, never passed and never a rule-error", async () => {
    const verdict = await judgeVault(log);
    expect(
      only(verdict, "unevaluated")
        .filter((f) => f.details["rule"] === "log-grows")
        .map((f) => [f.path, f.details["reason"], f.severity]),
    ).toEqual([["wiki/Log of the spring.md", "no-base", "info"]]);
    expect(verdict.coverage["log-grows"]).toEqual({
      evaluated: 0,
      not_applicable: 3,
      unevaluated: 1,
    });
    expect(verdict.unevaluated["log-grows"]).toEqual({ count: 1, reasons: ["no-base"] });
  });

  it("is evaluated under the overlay: against the disk, and on a new page with before.present false", async () => {
    const dir = vaultDir(log);
    const draft = (path: string, text: string) => ({
      path,
      bytes: new TextEncoder().encode(text),
    });
    const shrunk = await judgeState(
      await overlayState(dir, [
        draft(
          "wiki/Log of the spring.md",
          LOG_PAGE.replace("## Days\n\n- 2026-04-01 — first sowing\n", ""),
        ),
      ]),
    );
    expect(only(shrunk, "log-grows")).toMatchObject([{ severity: "error" }]);
    const fresh = await judgeState(
      await overlayState(dir, [
        draft("wiki/Log of the summer.md", LOG_PAGE.replace("spring", "summer")),
      ]),
    );
    expect(only(fresh, "log-grows")).toEqual([]);
    expect(only(fresh, "unevaluated").filter((f) => f.details["rule"] === "log-grows")).toEqual([]);
  });
});

describe("exceptions (§3.1)", () => {
  const market = BASIL.replace("https://seeds.example/basil", "https://market.example/basil");
  const excepting = (entries: string) =>
    market.replace("bed: herb\n", `bed: herb\nexceptions:\n${entries}`);

  it("closes a finding the entry names, as exception-applied info with the reason", async () => {
    const verdict = await judgeVault({
      "wiki/Basil.md": excepting(
        "  - { rule: source-host-allowed, reason: The market sells this seed alone. }\n",
      ),
    });
    expect(blocking(verdict)).toEqual([]);
    expect(only(verdict, "exception-applied")).toMatchObject([
      {
        severity: "info",
        path: "wiki/Basil.md",
        details: {
          rule: "source-host-allowed",
          reason: "The market sells this seed alone.",
          severity: "warning",
        },
      },
    ]);
    expect(only(verdict, "exception-applied")[0]?.queue).toBe(undefined);
    expect(verdict.summary.excepted).toEqual({ "source-host-allowed": 1 });
  });

  it("reports an entry that closes nothing as stale, and one naming what may not be waived as illegal", async () => {
    const verdict = await judgeVault({
      "wiki/Basil.md": excepting(
        [
          "  - { rule: known-bed, reason: Nothing fails it. }",
          "  - { rule: no-such-rule, reason: A typo. }",
          "  - { rule: identity-collision, reason: Two names. }",
          "  - { rule: unevaluated, reason: A census. }",
          "",
        ].join("\n"),
      ),
    });
    expect(only(verdict, "exception-stale").map((f) => f.details["rule"])).toEqual(["known-bed"]);
    expect(
      only(verdict, "exception-illegal").map((f) => [f.details["rule"], f.details["pointer"]]),
    ).toEqual([
      ["identity-collision", "/exceptions/2"],
      ["no-such-rule", "/exceptions/1"],
      ["unevaluated", "/exceptions/3"],
    ]);
    expect(only(verdict, "source-host-allowed")).toHaveLength(1);
  });
});
