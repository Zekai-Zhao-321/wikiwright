// docs/concepts.md §Findings and routing (`write` reported `unevaluated: 1` on every
// source page and never said what — a count with no key is a number nobody can
// act on. The envelope names the pass and the reason, in `write` and in every
// judging verb, and `summary.unevaluated` stays the scalar every reader sums).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));

function run(cwd: string, args: string[], stdin?: string): Record<string, unknown> {
  const r = spawnSync(process.execPath, [CLI, ...args, "--root", "."], {
    cwd,
    encoding: "utf8",
    input: stdin ?? "",
    env: { ...process.env, WIKIWRIGHT_TODAY: "2026-09-05" },
  });
  const envelope = JSON.parse(r.stdout) as { data?: Record<string, unknown> };
  return envelope.data ?? {};
}

function write(root: string, rel: string, text: string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
}

const CONSTITUTION = {
  schema: "wikiwright/constitution",
  schema_version: 3,
  vocabularies: { tags: { mode: "registered", entries: {} } },
  types: {
    source: {
      extends: "reference",
      description: "A capture.",
      sections: {
        depth: 2,
        list: [
          { heading: "What it is", min: 1, max: 1 },
          {
            heading: "Capture",
            min: 1,
            max: 1,
            grammar: "entries",
            date: "required",
            lifecycle: "append-only",
          },
        ],
      },
    },
  },
};

const PAGE =
  "---\ntype: source\ntitle: Origin\ndescription: The core.\ntags: []\n---\n\n# Origin\n\n## What it is\n\nA core.\n\n## Capture\n\n- 2026-09-05 — captured from the origin\n";

function vault(): string {
  const tmp = mkdtempSync(join(tmpdir(), "ww-uneval-"));
  write(tmp, "config/constitution.json", `${JSON.stringify(CONSTITUTION, null, 2)}\n`);
  write(tmp, "config/engine.json", `${JSON.stringify({ content_roots: ["raw"] })}\n`);
  return tmp;
}

describe("`unevaluated` names the pass and the reason (docs/concepts.md §Findings and routing)", () => {
  it("a new source page's append-only arm has no base: write says which pass, and why", () => {
    const tmp = vault();
    try {
      const w = run(tmp, ["write", "raw/Origin.md"], PAGE);
      assert.deepEqual(w["unevaluated"], { "entry-mutated": { count: 1, reason: "no-base" } });
      // Written once, the page has a base, and the arm judges the next write.
      const again = run(tmp, ["write", "raw/Origin.md", "--dry-run"], PAGE);
      assert.deepEqual(again["unevaluated"], {});
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("check carries the block beside the scalar, and the two agree", () => {
    const tmp = vault();
    try {
      write(tmp, "raw/Origin.md", PAGE);
      write(tmp, "raw/Other.md", PAGE.replace("Origin", "Other"));
      const check = run(tmp, ["check", "--write"]);
      const block = check["unevaluated"] as Record<string, { count: number; reason: string }>;
      assert.deepEqual(block, { "entry-mutated": { count: 2, reason: "no-base" } });
      const summary = check["summary"] as { unevaluated: number };
      assert.equal(
        Object.values(block).reduce((a, row) => a + row.count, 0),
        summary.unevaluated,
      );
      const coverage = (check["coverage"] as { passes: Record<string, { reason?: string }> })
        .passes;
      assert.equal(coverage["entry-mutated"]?.reason, "no-base", "the row says the same");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
