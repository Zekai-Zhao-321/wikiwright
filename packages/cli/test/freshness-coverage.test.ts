// docs/cli.md §check (the coverage block), docs/cli.md §freshness and docs/constitution.md §Shapes: the three
// states a freshness row can be in stay distinguishable — "no type declares a
// pin" (`no-pin-field`), "this verb does not contact an origin"
// (`external-origin`), and "the measurement broke" (`freshness-unavailable`,
// exit 4 from the verb) — and none of them is a silent zero
// docs/cli.md §init (a fresh init passes check with zero findings).
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));

interface Outcome {
  status: number;
  stderr: string;
  envelope: { data?: Record<string, unknown>; error?: Record<string, unknown> };
}

function run(cwd: string, args: string[]): Outcome {
  const r = spawnSync(process.execPath, [CLI, ...args, "--root", "."], { cwd, encoding: "utf8" });
  return {
    status: r.status ?? -1,
    stderr: r.stderr,
    envelope: JSON.parse(r.stdout) as Outcome["envelope"],
  };
}

function dataOf(o: Outcome): Record<string, unknown> {
  return o.envelope.data ?? {};
}

function findings(o: Outcome): Array<{ ruleId: string; severity: string }> {
  return (dataOf(o)["findings"] ?? []) as Array<{ ruleId: string; severity: string }>;
}

function coverageRow(o: Outcome, id: string): Record<string, unknown> {
  const coverage = dataOf(o)["coverage"] as { passes?: Record<string, unknown> } | undefined;
  assert.notEqual(coverage, undefined, "the envelope carries a coverage block");
  return (coverage?.passes?.[id] ?? {}) as Record<string, unknown>;
}

function vault(): string {
  const tmp = mkdtempSync(join(tmpdir(), "ww-fresh-cov-"));
  assert.equal(run(tmp, ["init"]).status, 0);
  return tmp;
}

function gitInit(cwd: string): void {
  execFileSync("git", ["init", "-q"], { cwd });
  execFileSync("git", ["config", "user.email", "t@e.com"], { cwd });
  execFileSync("git", ["config", "user.name", "T"], { cwd });
}

const ORIGIN_ROWS = [
  "stale-capture",
  "stale-source-cited",
  "pin-unknown-to-origin",
  "origin-unreachable",
];

describe("check never contacts an origin, and says so on every envelope (docs/constitution.md §Shapes)", () => {
  for (const [name, arrange] of [
    ["a vault in no repository", (): string => vault()],
    [
      "a headless repository",
      (): string => {
        const tmp = mkdtempSync(join(tmpdir(), "ww-fresh-cov-"));
        gitInit(tmp);
        assert.equal(run(tmp, ["init"]).status, 0);
        return tmp;
      },
    ],
    [
      "a repository with a head",
      (): string => {
        const tmp = mkdtempSync(join(tmpdir(), "ww-fresh-cov-"));
        gitInit(tmp);
        assert.equal(run(tmp, ["init"]).status, 0);
        execFileSync("git", ["add", "-A"], { cwd: tmp });
        // `--no-verify`: `init` installed the pre-commit hook, which shells out
        // to whatever `wikiwright` is on PATH — not necessarily this build.
        execFileSync("git", ["commit", "--no-verify", "-qm", "the vault"], { cwd: tmp });
        return tmp;
      },
    ],
  ] as const) {
    it(`${name}: the origin rows read external-origin, the cold start is green, nothing leaks to stderr`, () => {
      const tmp = arrange();
      try {
        const check = run(tmp, ["check"]);
        assert.equal(check.status, 0, JSON.stringify(check.envelope));
        assert.deepEqual(findings(check), [], "the cold start is green, with no exception");
        for (const id of ORIGIN_ROWS) {
          assert.equal(coverageRow(check, id)["reason"], "external-origin", id);
          assert.equal(coverageRow(check, id)["evaluated"], 0, id);
        }
        assert.equal(
          coverageRow(check, "freshness-unavailable")["reason"],
          "capability-unavailable",
        );
        assert.equal(check.stderr, "", "no git diagnostic leaks to stderr");
        assert.equal(existsSync(join(tmp, "generated", "freshness.json")), false);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });
  }
});

describe("the freshness verb's own row (docs/cli.md §freshness)", () => {
  it("a constitution declaring no pin field has nothing to measure: no-pin-field, no finding, no repository needed", () => {
    const tmp = vault();
    try {
      const fresh = run(tmp, ["freshness"]);
      assert.equal(fresh.status, 0, JSON.stringify(fresh.envelope));
      assert.deepEqual(dataOf(fresh)["origins"], []);
      assert.deepEqual(dataOf(fresh)["entries"], []);
      assert.deepEqual(dataOf(fresh)["findings"], []);
      assert.deepEqual(coverageRow(fresh, "freshness"), { not_applicable: "no-pin-field" });
      assert.equal(existsSync(join(tmp, "generated", "freshness.json")), true, "the report lands");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("--fetch --fast-forward with nothing pinned advances nothing and creates no cache", () => {
    const tmp = vault();
    try {
      const ff = run(tmp, ["freshness", "--fetch", "--fast-forward"]);
      assert.equal(ff.status, 0, JSON.stringify(ff.envelope));
      assert.deepEqual(dataOf(ff)["advanced"], []);
      assert.equal(existsSync(join(tmp, ".wikiwright")), false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("git present but broken is the measurement breaking: exit 4, never a silent skip", () => {
    // "there is nothing to measure" and "the measurement broke" are different
    // claims. A `.git` that is not a repository, under a page pinned to ".",
    // is the second one.
    const tmp = mkdtempSync(join(tmpdir(), "ww-fresh-cov-"));
    try {
      mkdirSync(join(tmp, "config"), { recursive: true });
      mkdirSync(join(tmp, "raw"), { recursive: true });
      const constitution = {
        schema: "wikiwright/constitution",
        schema_version: 3,
        vocabularies: { tags: { mode: "registered", entries: {} } },
        types: {
          source: {
            extends: "reference",
            description: "A capture.",
            fields: {
              locator: { kind: "string", required: true },
              commit: { kind: "pin", origin: "locator", required: true },
            },
          },
        },
      };
      execFileSync(
        "sh",
        [
          "-c",
          `cat > config/constitution.json <<'EOF'\n${JSON.stringify(constitution)}\nEOF\necho '{"content_roots":["raw"]}' > config/engine.json\nprintf -- '---\\ntype: source\\ntitle: Self\\ndescription: d.\\ntags: []\\nlocator: "."\\ncommit: ${"a".repeat(40)}\\n---\\n\\n# Self\\n' > raw/Self.md\nmkdir .git`,
        ],
        { cwd: tmp },
      );
      assert.equal(existsSync(join(tmp, ".git")), true);
      const fresh = run(tmp, ["freshness"]);
      assert.equal(fresh.status, 4, JSON.stringify(fresh.envelope));
      assert.equal(fresh.envelope.error?.["code"], "git-unavailable");
      // …and `check` on the same vault is untouched by it: it never asked.
      assert.equal(run(tmp, ["check", "--write"]).status, 0, "the artifacts land first");
      const check = run(tmp, ["check"]);
      assert.equal(check.status, 0, JSON.stringify(check.envelope));
      assert.deepEqual(
        findings(check).filter((f) => f.severity !== "info"),
        [],
        "a scratch vault carries no brief; nothing else fires",
      );
      assert.equal(check.stderr, "");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
