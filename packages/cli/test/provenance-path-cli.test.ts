// docs/concepts.md §Section grammar (the bare-path provenance form) · docs/constitution.md §config/engine.json
// (source_roots is the declaration; undeclared means off) · docs/cli.md §lint
// (summary.by_rule is the census surface).
//
// e2e:source_roots — a declared root in config/engine.json changes what the
// binary calls provenance, from bytes on disk to a command's answer.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { documentOf } from "../../core/test/helpers/constitution.ts";

const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));
const FIELD_SOURCES = { title: "basename", description: "lede" };

function run(cwd: string, args: string[]): { status: number; data: Record<string, unknown> } {
  const r = spawnSync(process.execPath, [CLI, ...args, "--root", "."], { cwd, encoding: "utf8" });
  const envelope = JSON.parse(r.stdout) as { data?: Record<string, unknown> };
  return { status: r.status ?? -1, data: envelope.data ?? {} };
}

const PAGE = [
  "---",
  "type: person",
  "tags: []",
  "---",
  "",
  "A lede line.",
  "",
  "## Facts",
  "- [event] moved apartments (raw/web/2026-08-15--lease)",
  "- [event] changed phone (notes/2026/phone)",
  "",
].join("\n");

/** `declared` decides whether config/engine.json carries source_roots at all. */
function vault(declared: boolean): string {
  const tmp = mkdtempSync(join(tmpdir(), "ww-prov-"));
  mkdirSync(join(tmp, "config"));
  mkdirSync(join(tmp, "wiki"));
  writeFileSync(
    join(tmp, "config", "constitution.json"),
    JSON.stringify(
      documentOf({
        types: {
          person: {
            extends: "concept",
            description: "A person page.",
            sections: {
              depth: 2,
              ordered: false,
              additional: true,
              list: [{ heading: "Facts", min: 1, grammar: "claims", provenance: "required" }],
            },
          },
        },
      }),
    ),
  );
  writeFileSync(
    join(tmp, "config", "engine.json"),
    JSON.stringify(
      declared
        ? { content_roots: ["wiki"], field_sources: FIELD_SOURCES, source_roots: ["raw"] }
        : { content_roots: ["wiki"], field_sources: FIELD_SOURCES },
    ),
  );
  writeFileSync(join(tmp, "wiki", "Some Page.md"), PAGE);
  return tmp;
}

describe("a declared source root changes what the binary calls provenance", () => {
  it("the bare path counts, the undeclared-root path does not, and both are censused", () => {
    const tmp = vault(true);
    try {
      const { status, data } = run(tmp, ["lint"]);
      const summary = data["summary"] as Record<string, unknown>;
      assert.deepEqual(
        summary["by_rule"],
        {
          // The `raw/…` claim is provenance (counted once, because the form was
          // inferred from the token's shape); the `notes/…` claim is not, so it
          // trips the section's `provenance: required`.
          "claim-provenance": 1,
          "provenance-path-only": 1,
        },
        "one recognized, one refused",
      );
      assert.equal(summary["errors"], 0, "report mode: no grammar row is an error");
      assert.equal(status, 0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("with no source_roots declared, neither path is provenance", () => {
    const tmp = vault(false);
    try {
      const { data } = run(tmp, ["lint"]);
      const summary = data["summary"] as Record<string, unknown>;
      assert.deepEqual(summary["by_rule"], { "claim-provenance": 2 });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
