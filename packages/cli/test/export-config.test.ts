// docs/constitution.md §exports, §plugin
//
// e2e:exports — `config/engine.json` declares the read-only copies a bundle
// renders as skills; e2e:plugin — and the plugin manifests beside them. Every
// refusal a declaration earns from its own bytes is made when the config
// loads, by name, like any other `engine.json` refusal: a name outside the
// skill grammar or under the engine's prefix, two exports under one name, a
// selected directory outside the content roots, an external export with no
// repository, and a contribution that lacks what its mode needs.
//
// Every bundle here is a small gardening bundle under os.tmpdir().
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { exportNameOf, loadEngineConfig } from "@wikiwright/core";
import { PINNED_CLOCK } from "./fixtures/clock.ts";
import { CLI_RUNTIME } from "./fixtures/runtime.ts";

const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));
const SCRATCH = mkdtempSync(join(tmpdir(), "ww-export-config-"));
after(() => rmSync(SCRATCH, { recursive: true, force: true }));

interface Envelope {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: Record<string, unknown>;
}

function run(root: string, argv: readonly string[]): { status: number; envelope: Envelope } {
  const r = spawnSync(CLI_RUNTIME, [CLI, ...argv, "--root", root], {
    encoding: "utf8",
    env: { ...process.env, ...PINNED_CLOCK },
  });
  assert.equal(typeof r.stdout, "string", `the CLI printed no envelope: ${r.stderr}`);
  return { status: r.status ?? -1, envelope: JSON.parse(r.stdout) as Envelope };
}

let serial = 0;

/** A gardening bundle at `<scratch>/<label>` whose engine.json is `engine`. */
function bundle(engine: Record<string, unknown>, label = `garden-${++serial}`): string {
  const root = join(SCRATCH, label);
  mkdirSync(join(root, "config"), { recursive: true });
  mkdirSync(join(root, "wiki", "beds"), { recursive: true });
  writeFileSync(
    join(root, "config", "constitution.json"),
    `${JSON.stringify({
      schema: "wikiwright/constitution",
      schema_version: 3,
      vocabularies: {
        tags: {
          mode: "registered",
          entries: { compost: { description: "Making and using compost." } },
        },
      },
      types: { note: { extends: "concept", description: "A gardening note." } },
    })}\n`,
  );
  writeFileSync(join(root, "config", "engine.json"), `${JSON.stringify(engine, null, 2)}\n`);
  writeFileSync(
    join(root, "wiki", "beds", "turning-compost.md"),
    "---\ntype: note\ntitle: Turning compost\ndescription: Turn the heap every few weeks so it heats evenly.\ntags: [compost]\n---\n\n# Turning compost\n\nTurn the heap every few weeks so it heats evenly.\n",
  );
  return root;
}

const NONE = { mode: "none" };

/** The issues a refused load carries, as `code@where`. */
function issuesOf(envelope: Envelope): string[] {
  const issues = (envelope.data?.["issues"] ?? []) as { code: string; where: string }[];
  return issues.map((i) => `${i.code}@${i.where}`).sort();
}

describe("exports are declared in config/engine.json (docs/constitution.md §exports)", () => {
  it("a bundle that declares exports and a plugin loads", () => {
    const root = bundle({
      content_roots: ["wiki"],
      exports: [
        { name: "garden", select: { kind: "all" }, contribution: NONE },
        {
          select: { kind: "tag", tags: ["compost"] },
          output: "external",
          repository: "https://example.invalid/garden-compost",
          contribution: { mode: "issues" },
          license: "CC-BY-4.0",
        },
        {
          select: { kind: "directory", directories: ["wiki/beds"] },
          contribution: { mode: "local-folder", folder: "reports" },
        },
      ],
      plugin: { name: "garden-handbook", version: "1.0.0", description: "A gardening handbook." },
    });
    const r = run(root, ["type", "list"]);
    assert.equal(r.status, 0, JSON.stringify(r.envelope));
  });

  it("each shape a declaration may not take is refused at load, by name", () => {
    const cases: [string, Record<string, unknown>[], string[]][] = [
      [
        "a name under the engine's prefix, and one name twice",
        [
          { name: "wikiwright-garden", select: { kind: "all" }, contribution: NONE },
          { name: "garden", select: { kind: "all" }, contribution: NONE },
          { name: "garden", select: { kind: "all" }, contribution: NONE },
        ],
        ["export-name-reserved@engine.exports.0.name", "export-name-taken@engine.exports.2.name"],
      ],
      [
        "a selected directory outside every content root, and one that is no vault path",
        [
          {
            name: "garden",
            select: { kind: "directory", directories: ["notes", "../wiki"] },
            contribution: NONE,
          },
        ],
        [
          "export-select-invalid@engine.exports.0.select.directories.0",
          "export-select-invalid@engine.exports.0.select.directories.1",
        ],
      ],
      [
        "an external export with no repository",
        [{ name: "garden", select: { kind: "all" }, output: "external", contribution: NONE }],
        ["export-repository-required@engine.exports.0.repository"],
      ],
      [
        "a contribution that lacks what its mode needs, or carries what it may not",
        [
          { name: "a", select: { kind: "all" }, contribution: { mode: "issues" } },
          {
            name: "b",
            select: { kind: "all" },
            contribution: { mode: "local-folder", repository: "https://example.invalid/b" },
          },
          { name: "c", select: { kind: "all" }, contribution: { mode: "none", folder: "reports" } },
          {
            name: "d",
            select: { kind: "all" },
            contribution: { mode: "local-folder", folder: "../reports" },
          },
        ],
        [
          "export-contribution-invalid@engine.exports.0.contribution",
          "export-contribution-invalid@engine.exports.1.contribution",
          "export-contribution-invalid@engine.exports.1.contribution",
          "export-contribution-invalid@engine.exports.2.contribution",
          "export-contribution-invalid@engine.exports.3.contribution",
        ],
      ],
      [
        "a name, a repository and a plugin outside their grammars",
        [
          {
            name: "Garden Notes",
            select: { kind: "all" },
            repository: "http://example.invalid/garden",
            contribution: NONE,
          },
        ],
        ["schema-invalid@engine.exports.0.name", "schema-invalid@engine.exports.0.repository"],
      ],
    ];
    for (const [label, exports, expected] of cases) {
      const r = run(bundle({ content_roots: ["wiki"], exports }), ["check"]);
      assert.equal(r.status, 2, `${label}: ${JSON.stringify(r.envelope)}`);
      assert.equal(r.envelope.error?.["code"], "constitution-invalid", label);
      assert.deepEqual(issuesOf(r.envelope), [...expected].sort(), label);
    }
    const plugin = run(
      bundle({
        content_roots: ["wiki"],
        plugin: { name: "Garden", version: "", description: "x" },
      }),
      ["check"],
    );
    assert.equal(plugin.status, 2, JSON.stringify(plugin.envelope));
    assert.deepEqual(issuesOf(plugin.envelope), [
      "schema-invalid@engine.plugin.name",
      "schema-invalid@engine.plugin.version",
    ]);
  });

  it("a name derived from the bundle's label is held to the same law, once the label is known", () => {
    // `Garden_Notes` is a directory name and no skill name, so the `all`
    // export it names is refused; a label under the engine's prefix is too.
    const derived = run(
      bundle(
        { content_roots: ["wiki"], exports: [{ select: { kind: "all" }, contribution: NONE }] },
        "Garden_Notes",
      ),
      ["check"],
    );
    assert.deepEqual(issuesOf(derived.envelope), [
      "export-name-derived-invalid@engine.exports.0.name",
    ]);
    const reserved = run(
      bundle(
        { content_roots: ["wiki"], exports: [{ select: { kind: "all" }, contribution: NONE }] },
        "wikiwright-garden",
      ),
      ["check"],
    );
    assert.deepEqual(issuesOf(reserved.envelope), ["export-name-reserved@engine.exports.0.name"]);
    const taken = run(
      bundle(
        {
          content_roots: ["wiki"],
          exports: [
            { select: { kind: "tag", tags: ["compost"] }, contribution: NONE },
            { name: "kitchen-compost", select: { kind: "all" }, contribution: NONE },
          ],
        },
        "kitchen",
      ),
      ["check"],
    );
    assert.deepEqual(issuesOf(taken.envelope), ["export-name-taken@engine.exports.1.name"]);
  });

  it("the derived name is the label, or the label and the selection", () => {
    const config = loadEngineConfig({
      content_roots: ["wiki"],
      exports: [
        { select: { kind: "all" }, contribution: NONE },
        { select: { kind: "tag", tags: ["compost", "mulch"] }, contribution: NONE },
        { select: { kind: "directory", directories: ["wiki/beds/raised"] }, contribution: NONE },
        { name: "chosen", select: { kind: "all" }, contribution: NONE },
      ],
    });
    assert.equal(config.ok, true, JSON.stringify(config));
    if (!config.ok) return;
    assert.deepEqual(
      (config.config.exports ?? []).map((d) => exportNameOf(d, "kitchen")),
      ["kitchen", "kitchen-compost-mulch", "kitchen-raised", "chosen"],
    );
  });
});
