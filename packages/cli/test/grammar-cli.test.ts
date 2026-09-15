// docs/constitution.md §Sections (a grammar declaration travels from bytes in config/ to a
// command's answer; `type show` renders one line per section) · docs/concepts.md §Section grammar
// (report mode: warnings and infos, never errors) · docs/cli.md §lint (summary.by_rule).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { documentOf } from "../../core/test/helpers/constitution.ts";

const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));

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
  "- [role] engineer (stated 2026-08-14)",
  "- [fav-food] hotpot (stated 2026-08-14)",
  "- [mood] venting (stated 2026-08-14)",
  "- [doc] permit (valid to 2034-04-09)",
  "- [role] engineer elsewhere (inferred, same)",
  "- a bullet with no marker at all",
  "  - a rationale line under nothing that parses",
  "",
  "## Relations",
  "- peer_of [[Missing Page]]",
  "",
  "## Timeline",
  "- 2026-08-14: something happened",
  "",
].join("\n");

function vault(): string {
  const tmp = mkdtempSync(join(tmpdir(), "ww-grammar-"));
  mkdirSync(join(tmp, "config"));
  mkdirSync(join(tmp, "wiki"));
  writeFileSync(
    join(tmp, "config", "constitution.json"),
    JSON.stringify(
      documentOf({
        vocabularies: {
          categories: {
            mode: "registered",
            entries: {
              role: { class: "supersede" },
              doc: { class: "supersede" },
              preference: { class: "accumulate" },
              mood: { class: "journal-only" },
            },
          },
        },
        types: {
          person: {
            extends: "concept",
            description: "A person page.",
            sections: {
              depth: 2,
              ordered: false,
              additional: true,
              list: [
                {
                  heading: "Facts",
                  min: 1,
                  grammar: "claims",
                  history: "History",
                  provenance: "optional",
                  vocabulary: "categories",
                },
                { heading: "Relations", grammar: "relations" },
                { heading: "Timeline", grammar: "entries", date: "optional" },
                {
                  heading: "History",
                  grammar: "claims",
                  role: "history",
                  vocabulary: "categories",
                },
              ],
            },
          },
        },
      }),
    ),
  );
  writeFileSync(
    join(tmp, "config", "engine.json"),
    JSON.stringify({
      content_roots: ["wiki"],
      field_sources: { title: "basename", description: "lede" },
    }),
  );
  writeFileSync(join(tmp, "wiki", "Some Page.md"), PAGE);
  return tmp;
}

describe("a grammar declaration travels from config/ to a lint answer (docs/constitution.md §Sections)", () => {
  it("summary.by_rule carries the census, and report mode never exits 5", () => {
    const tmp = vault();
    try {
      const { status, data } = run(tmp, ["lint"]);
      const summary = data["summary"] as Record<string, unknown>;
      const byRule = summary["by_rule"] as Record<string, number>;
      assert.deepEqual(
        byRule,
        {
          "canonical-form": 1,
          "grammar-unparsed": 1,
          "journal-only-category": 1,
          "marker-like": 1,
          "provenance-weak": 1,
          "relation-target-unresolved": 1,
          "unknown-category": 1,
          "wikilink-unresolved": 1,
        },
        "by_rule counts every rule that fired, once per finding",
      );
      assert.equal(summary["errors"], 0, "report mode: no grammar row is an error");
      assert.equal(status, 0, "a vault whose only findings are warnings exits 0");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("`type show` prints one line per section: heading, grammar, parameters, contributedBy", () => {
    const tmp = vault();
    try {
      const { data } = run(tmp, ["type", "show", "person"]);
      const lines = data["section_lines"] as string[];
      // One line per declared section, in declaration order: the grammar's
      // parameters sorted by key, then the kernel's knobs, then the declarer.
      assert.deepEqual(lines, [
        "Facts | claims | history=History provenance=optional vocabulary=categories | person",
        "Relations | relations | — | person",
        "Timeline | entries | date=optional | person",
        "History | claims | role=history vocabulary=categories | person",
      ]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
