// v2 contracts §9.4: `rule try` over a synthetic gardening bundle under
// os.tmpdir() — the candidate, id `candidate`, severity error, evaluated over
// every page of the type or below it, under the working tree and with
// `--base` under the revision; refusals with their locations, passes, the
// transitions no base can judge, the evaluations that are not a bool; exit
// 0 whatever the counts, and nothing written.
import { afterAll, describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanBundles, cli, commitAll, gardenBundle } from "./fixtures/garden-cli.ts";

afterAll(cleanBundles);

const MINT = `---
type: planting
title: Mint
bed: north
sown: 2026-04-20
---

# Mint

## History

- 2026-04 — sown
`;

interface Outcome {
  would_refuse: { path: string; location: Record<string, unknown> }[];
  would_pass: string[];
  unevaluated: { path: string; reason: string }[];
  errors: { path: string; kind: string; message: string }[];
}

function tried(
  args: string[],
  dir: string,
): { status: number; working: Outcome; base?: Outcome & { ref: string }; code?: string } {
  const r = cli(["rule", "try", ...args], dir);
  return {
    status: r.status,
    working: r.envelope.data?.["working"] as Outcome,
    ...(r.envelope.data?.["base"] === undefined
      ? {}
      : { base: r.envelope.data["base"] as Outcome & { ref: string } }),
    ...(r.envelope.error === undefined ? {} : { code: r.envelope.error.code }),
  };
}

function files(dir: string): string {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((p) => !p.startsWith(".git"))
    .sort()
    .map((p) => {
      try {
        return `${p}\n${readFileSync(join(dir, p), "utf8")}`;
      } catch {
        return p;
      }
    })
    .join("\n");
}

describe("rule try (v2 contracts §9.4)", () => {
  it("reports what the candidate would refuse and pass over the type and below it, exit 0, nothing written", () => {
    const dir = gardenBundle({ "wiki/Mint.md": MINT });
    const before = files(dir);
    const r = tried(["--type", "garden/planting", "--expr", "has(page.fields.source)"], dir);
    expect(r.status).toBe(0);
    expect(r.working).toEqual({
      would_refuse: [{ path: "wiki/Mint.md", location: { kind: "page" } }],
      would_pass: ["wiki/Basil.md"],
      unevaluated: [],
      errors: [],
    });
    expect(files(dir)).toBe(before);
  });

  it("evaluates a section candidate at each occurrence, located", () => {
    const dir = gardenBundle({ "wiki/Mint.md": MINT });
    const r = tried(
      [
        "--type",
        "planting",
        "--section",
        "History",
        "--expr",
        "section.items.all(i, i.precision == config.precision)",
        "--config",
        '{"precision": "day"}',
      ],
      dir,
    );
    expect(r.working.would_refuse).toEqual([
      {
        path: "wiki/Mint.md",
        location: { kind: "section", heading: "History", occurrence: 0, line: 10 },
      },
    ]);
    expect(r.working.would_pass).toEqual(["wiki/Basil.md"]);
  });

  it("names a transition the working tree cannot judge, and an evaluation that is not a bool", () => {
    const dir = gardenBundle();
    expect(
      tried(["--type", "planting", "--expr", "!before.present"], dir).working.unevaluated,
    ).toEqual([{ path: "wiki/Basil.md", reason: "no-base" }]);
    const errors = tried(["--type", "planting", "--expr", "page.fields.bed"], dir).working.errors;
    expect(errors.map((e) => [e.path, e.kind])).toEqual([["wiki/Basil.md", "non-bool"]]);
  });

  it("tries the candidate at a base revision too, under that revision's law and pages", () => {
    const dir = gardenBundle();
    commitAll(dir, "the garden");
    writeFileSync(join(dir, "wiki/Mint.md"), MINT);
    const r = tried(
      ["--type", "planting", "--expr", "has(page.fields.source)", "--base", "HEAD"],
      dir,
    );
    expect(r.working.would_refuse.map((x) => x.path)).toEqual(["wiki/Mint.md"]);
    expect(r.base?.ref).toBe("HEAD");
    expect(r.base?.would_refuse).toEqual([]);
    expect(r.base?.would_pass).toEqual(["wiki/Basil.md"]);
    expect(tried(["--type", "planting", "--expr", "true", "--base", "no-such-ref"], dir).code).toBe(
      "revision-not-found",
    );
  });

  it("reports git-unavailable when a base is requested outside a repository", () => {
    const dir = gardenBundle();
    const result = tried(["--type", "planting", "--expr", "true", "--base", "HEAD"], dir);
    expect(result.status).toBe(4);
    expect(result.code).toBe("git-unavailable");
  });

  it("refuses a candidate the profile refuses, an unknown type and an undeclared section", () => {
    const dir = gardenBundle();
    expect(
      tried(
        [
          "--type",
          "planting",
          "--expr",
          'timestamp("2026-01-01T00:00:00Z") > timestamp("2025-01-01T00:00:00Z")',
        ],
        dir,
      ).code,
    ).toBe("rule-invalid");
    expect(tried(["--type", "orchard", "--expr", "true"], dir).code).toBe("unknown-type");
    expect(tried(["--type", "planting", "--section", "Harvest", "--expr", "true"], dir).code).toBe(
      "rule-section-unknown",
    );
  });

  it("reserves the candidate's id: a declared rule may not take it", () => {
    const dir = gardenBundle();
    const guide = join(dir, "constitution/types/guide.yaml");
    writeFileSync(
      guide,
      `${readFileSync(guide, "utf8")}rules:\n  - id: candidate\n    expr: "true"\n    severity: error\n    message: x\n`,
    );
    const r = cli(["check"], dir);
    expect(r.envelope.error?.code).toBe("constitution-invalid");
    const issues =
      (r.envelope as { data?: { issues?: { code: string; details?: { kind?: string } }[] } }).data
        ?.issues ?? [];
    expect(issues.map((i) => [i.code, i.details?.kind])).toContainEqual([
      "rule-collision",
      "reserved",
    ]);
  });
});
