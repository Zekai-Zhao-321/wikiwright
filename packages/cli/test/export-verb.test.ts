// docs/cli.md §export · docs/constitution.md §exports
//
// `export <name> --to <dir>` writes one declared `output: external` export
// into another repository's tree, as `<dir>/skills/<name>/`, and the plugin
// manifests beside it when `plugin` is declared. It refuses a name the config
// does not declare, an `output: skills` export, a destination that is the
// bundle's root, lies in a content root or is not a directory, a
// `skills/<name>/` that holds no marker, and a symbolic link where it writes.
//
// Every bundle is a gardening bundle under os.tmpdir().
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { PINNED_CLOCK } from "./fixtures/clock.ts";
import { runCli } from "./fixtures/runtime.ts";

const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));
const SCRATCH = mkdtempSync(join(tmpdir(), "ww-export-verb-"));
after(() => rmSync(SCRATCH, { recursive: true, force: true }));

interface Envelope {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: { code?: string; type?: string; details?: Record<string, unknown> };
}

function run(root: string, argv: readonly string[]): { status: number; envelope: Envelope } {
  const r = runCli([CLI, ...argv, "--root", root], {
    encoding: "utf8",
    env: { ...process.env, ...PINNED_CLOCK },
  });
  assert.equal(typeof r.stdout, "string", `the CLI printed no envelope: ${r.stderr}`);
  return { status: r.status ?? -1, envelope: JSON.parse(r.stdout) as Envelope };
}

function write(root: string, files: Record<string, string>): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
}

const note = (title: string, tags: string[], body: string): string =>
  `---\ntype: note\ntitle: ${title}\ndescription: ${title}, briefly.\ntags: [${tags.join(", ")}]\n---\n\n# ${title}\n\n${body}\n`;

const ROSES = {
  name: "garden-roses",
  select: { kind: "tag", tags: ["roses"] },
  output: "external",
  repository: "https://example.invalid/garden",
  links: "cut",
  contribution: { mode: "none" },
};

let serial = 0;

/** A gardening bundle named `garden`, and an empty destination beside it. */
function garden(engine: Record<string, unknown> = {}): { root: string; to: string } {
  const base = join(SCRATCH, `case-${++serial}`);
  const root = join(base, "garden");
  const to = join(base, "elsewhere");
  mkdirSync(to, { recursive: true });
  write(root, {
    "config/constitution.json": `${JSON.stringify({
      schema: "wikiwright/constitution",
      schema_version: 3,
      vocabularies: {
        tags: {
          mode: "registered",
          entries: {
            roses: { description: "Growing and pruning roses." },
            beds: { description: "The beds and what grows in them." },
          },
        },
      },
      types: { note: { extends: "concept", description: "A gardening note." } },
    })}\n`,
    "config/engine.json": `${JSON.stringify(
      {
        content_roots: ["wiki"],
        exports: [
          ROSES,
          { name: "garden", select: { kind: "all" }, contribution: { mode: "none" } },
        ],
        ...engine,
      },
      null,
      2,
    )}\n`,
    "wiki/pruning-roses.md": note("Pruning roses", ["roses"], "Cut above an outward bud."),
    "wiki/raised-beds.md": note("Raised beds", ["beds"], "Beds edged in timber."),
  });
  return { root, to };
}

/** Every file under a directory, relative to it. */
function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true, encoding: "utf8" })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(dir.length + 1))
    .sort();
}

describe("export <name> --to <dir> (docs/cli.md §export)", () => {
  it("writes skills/<name>/ and the manifests, and the envelope names the export", () => {
    const { root, to } = garden({
      plugin: { name: "garden-handbook", version: "1.0.0", description: "A gardening handbook." },
    });
    const r = run(root, ["export", "garden-roses", "--to", to]);
    assert.equal(r.status, 0, JSON.stringify(r.envelope));
    const skill = join(to, "skills", "garden-roses");
    assert.deepEqual(
      filesUnder(skill).filter((f) => f.startsWith("wiki/")),
      ["wiki/pruning-roses.md"],
    );
    for (const file of ["SKILL.md", "config/export.json", "config/constitution.json"]) {
      assert.equal(existsSync(join(skill, file)), true, `${file} was not written`);
    }
    assert.equal(existsSync(join(to, "plugin.json")), true);
    assert.equal(existsSync(join(to, ".claude-plugin", "plugin.json")), true);
    const marker = JSON.parse(readFileSync(join(skill, "config", "export.json"), "utf8")) as {
      name: string;
      bundle: string;
      output: string;
      source: { repository: string | null };
    };
    assert.equal(marker.name, "garden-roses");
    assert.equal(marker.bundle, "garden");
    assert.equal(marker.output, "external");
    assert.equal(marker.source.repository, "https://example.invalid/garden");
    const data = r.envelope.data ?? {};
    assert.equal(typeof data["destination"], "string");
    assert.deepEqual(data["export"], {
      name: "garden-roses",
      bundle: "garden",
      source: { repository: "https://example.invalid/garden" },
      select: { kind: "tag", tags: ["roses"] },
      pages: 1,
      cut: { links: 0, citations: 0, attachments: 0 },
    });
    assert.equal(data["files"], filesUnder(skill).length);
    assert.equal(data["removed"], 0);
    // The copy is a vault: a reader over it answers.
    assert.equal(run(skill, ["search", "pruning"]).status, 0);
  });

  it("--dry-run writes nothing and plans every file by absolute path outside the bundle", () => {
    const { root, to } = garden();
    const r = run(root, ["export", "garden-roses", "--to", to, "--dry-run"]);
    assert.equal(r.status, 0, JSON.stringify(r.envelope));
    const ops = (r.envelope.data?.["ops"] ?? []) as { kind: string; path: string }[];
    assert.equal(ops.length > 0, true);
    assert.equal(
      ops.every((op) => isAbsolute(op.path) && op.kind === "create"),
      true,
      JSON.stringify(ops),
    );
    assert.equal(
      ops.some((op) => op.path.endsWith("/skills/garden-roses/config/export.json")),
      true,
    );
    assert.deepEqual(readdirSync(to), []);
    // A second run over an unchanged bundle plans nothing.
    assert.equal(run(root, ["export", "garden-roses", "--to", to]).status, 0);
    const again = run(root, ["export", "garden-roses", "--to", to, "--dry-run"]);
    assert.deepEqual(again.envelope.data?.["ops"], []);
  });

  it("refuses a closed export with a cut link, with the finding, and writes nothing", () => {
    const { root, to } = garden();
    // A roses page links to a beds page the roses export leaves out.
    write(root, {
      "wiki/pruning-roses.md": note(
        "Pruning roses",
        ["roses"],
        "Mulch after, as [[raised-beds]] say.",
      ),
      "config/engine.json": `${JSON.stringify({
        content_roots: ["wiki"],
        exports: [{ ...ROSES, links: "closed" }],
      })}\n`,
    });
    const r = run(root, ["export", "garden-roses", "--to", to]);
    assert.equal(r.status, 5, JSON.stringify(r.envelope));
    const found = (r.envelope.data?.["findings"] ?? []) as { ruleId: string }[];
    assert.deepEqual(
      found.map((f) => f.ruleId),
      ["export-not-closed"],
    );
    assert.deepEqual(readdirSync(to), []);
  });

  it("refuses a name the config does not declare, naming the ones it does", () => {
    const { root, to } = garden();
    const r = run(root, ["export", "no-such-export", "--to", to]);
    assert.equal(r.status, 2, JSON.stringify(r.envelope));
    assert.equal(r.envelope.error?.code, "export-not-declared");
    assert.deepEqual(r.envelope.error?.details?.["valid_values"], ["garden-roses", "garden"]);
  });

  it("refuses an output: skills export, which check --write renders", () => {
    const { root, to } = garden();
    const r = run(root, ["export", "garden", "--to", to]);
    assert.equal(r.status, 2, JSON.stringify(r.envelope));
    assert.equal(r.envelope.error?.code, "export-output-skills");
  });

  it("refuses the bundle's root, a content root, and a directory that is not there", () => {
    const { root } = garden();
    for (const to of [root, join(root, "wiki")]) {
      const r = run(root, ["export", "garden-roses", "--to", to]);
      assert.equal(r.status, 2, `${to}: ${JSON.stringify(r.envelope)}`);
      assert.equal(r.envelope.error?.code, "export-destination-inside-bundle");
    }
    const absent = run(root, ["export", "garden-roses", "--to", join(root, "no-such-dir")]);
    assert.equal(absent.status, 3, JSON.stringify(absent.envelope));
    assert.equal(absent.envelope.error?.code, "directory-not-found");
    assert.equal(existsSync(join(root, "skills")), false);
    assert.equal(existsSync(join(root, "wiki", "skills")), false);
  });

  it("refuses a skills/<name>/ that holds no marker, and writes nothing", () => {
    const { root, to } = garden();
    write(to, { "skills/garden-roses/notes.md": "a file of someone else's\n" });
    const r = run(root, ["export", "garden-roses", "--to", to]);
    assert.equal(r.status, 4, JSON.stringify(r.envelope));
    assert.equal(r.envelope.error?.code, "export-destination-occupied");
    assert.deepEqual(filesUnder(join(to, "skills", "garden-roses")), ["notes.md"]);
  });

  it("refuses a linked directory the manifests would land in", () => {
    const { root, to } = garden({
      plugin: { name: "garden-handbook", version: "1.0.0", description: "A gardening handbook." },
    });
    const elsewhere = join(dirname(to), "manifests-elsewhere");
    mkdirSync(elsewhere);
    symlinkSync(elsewhere, join(to, ".claude-plugin"));
    const r = run(root, ["export", "garden-roses", "--to", to]);
    assert.equal(r.status, 4, JSON.stringify(r.envelope));
    assert.equal(r.envelope.error?.code, "export-destination-linked");
    assert.deepEqual(readdirSync(elsewhere), []);
    assert.equal(existsSync(join(to, "skills")), false);
  });

  it("refuses a symbolic link where it writes", () => {
    const { root, to } = garden();
    assert.equal(run(root, ["export", "garden-roses", "--to", to]).status, 0);
    const elsewhere = join(dirname(to), "linked-target");
    mkdirSync(elsewhere);
    symlinkSync(elsewhere, join(to, "skills", "garden-roses", "wiki", "linked"));
    const r = run(root, ["export", "garden-roses", "--to", to]);
    assert.equal(r.status, 4, JSON.stringify(r.envelope));
    assert.equal(r.envelope.error?.code, "export-destination-linked");
  });
});
