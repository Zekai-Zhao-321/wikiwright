// docs/cli.md §check, §gate · docs/constitution.md §exports
//
// `check --write` renders every `output: skills` export into the bundle's own
// `skills/<name>/`, replacing what the plan holds and removing what it no
// longer holds, and `check` compares each rendered copy with a fresh plan:
// `export-stale`, fixed by `check --write`. The staged gate makes the same
// comparison over the index, so a page or a path-declared kit staged without
// its re-rendered export is refused.
//
// Every bundle is a gardening bundle under os.tmpdir().
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { PINNED_CLOCK } from "./fixtures/clock.ts";
import { CLI_RUNTIME } from "./fixtures/runtime.ts";

const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));
const KIT_GARDEN = fileURLToPath(new URL("./fixtures/kit-garden", import.meta.url));
const SCRATCH = mkdtempSync(join(tmpdir(), "ww-export-check-"));
after(() => rmSync(SCRATCH, { recursive: true, force: true }));

interface Finding {
  ruleId: string;
  severity: string;
  path: string;
  message: string;
  queue?: string;
  fix?: { argv: string[] };
}

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

function findings(envelope: Envelope): Finding[] {
  return (envelope.data?.["findings"] ?? []) as Finding[];
}

function git(cwd: string, ...args: string[]): void {
  execFileSync(
    "git",
    ["-c", "user.name=T", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args],
    { cwd, stdio: "ignore" },
  );
}

function write(root: string, files: Record<string, string>): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
}

const note = (title: string, tags: string[], body: string): string =>
  `---\ntype: note\ntitle: ${title}\ndescription: ${title}, briefly.\ntags: [${tags.join(", ")}]\n---\n\n# ${title}\n\n${body}\n`;

let serial = 0;

/** A gardening bundle, named `garden`, under its own scratch directory. */
function garden(engine: Record<string, unknown>, extra: Record<string, string> = {}): string {
  const root = join(SCRATCH, `case-${++serial}`, "garden");
  write(root, {
    "config/constitution.json": `${JSON.stringify({
      schema: "wikiwright/constitution",
      schema_version: 3,
      vocabularies: {
        tags: {
          mode: "registered",
          entries: {
            compost: { description: "Making and using compost." },
            beds: { description: "The beds and what grows in them." },
          },
        },
      },
      types: { note: { extends: "concept", description: "A gardening note." } },
    })}\n`,
    "config/engine.json": `${JSON.stringify(engine, null, 2)}\n`,
    "wiki/turning-compost.md": note("Turning compost", ["compost"], "Turn it weekly."),
    "wiki/raised-beds.md": note("Raised beds", ["beds"], "Beds edged in timber."),
    ...extra,
  });
  return root;
}

const ALL = { name: "garden", select: { kind: "all" }, contribution: { mode: "none" } };

/** Every file under a directory, relative to it. */
function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true, encoding: "utf8" })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(dir.length + 1))
    .sort();
}

describe("check --write renders the in-repository exports, and check holds them (docs/cli.md §check)", () => {
  it("renders skills/<name>/, and a page edited since is export-stale, fixed by check --write", () => {
    const root = garden({ content_roots: ["wiki"], exports: [ALL] });
    const written = run(root, ["check", "--write"]);
    assert.equal(written.status, 0, JSON.stringify(written.envelope));
    const generated = written.envelope.data?.["generated"] as { exports?: string[] } | undefined;
    assert.deepEqual(generated?.exports, ["skills/garden"]);
    assert.equal(existsSync(join(root, "skills", "garden", "config", "export.json")), true);
    assert.equal(run(root, ["check"]).status, 0);

    write(root, { "wiki/raised-beds.md": note("Raised beds", ["beds"], "Beds edged in oak.") });
    const stale = run(root, ["check"]);
    assert.equal(stale.status, 5, JSON.stringify(stale.envelope));
    const [finding] = findings(stale.envelope).filter((f) => f.ruleId === "export-stale");
    assert.equal(finding?.severity, "error");
    assert.equal(finding?.path, "skills/garden");
    assert.deepEqual(finding?.fix?.argv, ["check", "--write"]);
    assert.match(finding?.message ?? "", /skills\/garden\/wiki\/raised-beds\.md \(changed\)/u);
    assert.match(finding?.message ?? "", /skills\/garden\/config\/export\.json \(changed\)/u);
    assert.equal(run(root, ["check", "--write"]).status, 0);
    assert.equal(run(root, ["check"]).status, 0);
  });

  it("a shrunk selection removes what the plan no longer holds, and nothing outside the export", () => {
    const root = garden({
      content_roots: ["wiki"],
      exports: [{ ...ALL, select: { kind: "all" } }],
    });
    run(root, ["check", "--write"]);
    write(root, { "skills/notes/mine.md": "a file of the maintainer's own, beside the exports\n" });
    write(root, {
      "config/engine.json": `${JSON.stringify(
        {
          content_roots: ["wiki"],
          exports: [{ ...ALL, select: { kind: "tag", tags: ["compost"] }, links: "cut" }],
        },
        null,
        2,
      )}\n`,
    });
    const planned = run(root, ["check", "--write", "--dry-run"]);
    const ops = (planned.envelope.data?.["ops"] ?? []) as { kind: string; path: string }[];
    assert.deepEqual(
      ops.filter((op) => op.kind === "delete").map((op) => op.path),
      ["skills/garden/wiki/raised-beds.md"],
    );
    assert.equal(existsSync(join(root, "skills", "garden", "wiki", "raised-beds.md")), true);
    assert.equal(run(root, ["check", "--write"]).status, 0);
    assert.deepEqual(filesUnder(join(root, "skills", "garden", "wiki")), ["turning-compost.md"]);
    assert.equal(readFileSync(join(root, "skills", "notes", "mine.md"), "utf8").length > 0, true);
    assert.equal(run(root, ["check"]).status, 0);
  });

  it("a marker no declaration names is export-orphan, a judgment, and never removed", () => {
    const root = garden({ content_roots: ["wiki"], exports: [ALL] });
    run(root, ["check", "--write"]);
    cpSync(join(root, "skills", "garden"), join(root, "skills", "old-garden"), { recursive: true });
    const r = run(root, ["check", "--write"]);
    const orphan = findings(r.envelope).find((f) => f.ruleId === "export-orphan");
    assert.equal(orphan?.severity, "warning");
    assert.equal(orphan?.queue, "export-review");
    assert.equal(orphan?.path, "skills/old-garden");
    assert.equal(existsSync(join(root, "skills", "old-garden", "config", "export.json")), true);
  });

  it("a destination in a content root is export-destination-invalid, and not rendered", () => {
    const root = garden({ content_roots: ["wiki", "skills"], exports: [ALL] });
    const r = run(root, ["check", "--write"]);
    const invalid = findings(r.envelope).find((f) => f.ruleId === "export-destination-invalid");
    assert.equal(invalid?.severity, "error");
    assert.equal(invalid?.queue, "export-review");
    assert.equal(existsSync(join(root, "skills", "garden")), false);
  });

  it("the plugin manifests are written at the root when declared, and held like an export", () => {
    const root = garden({
      content_roots: ["wiki"],
      exports: [ALL],
      plugin: { name: "garden-handbook", version: "1.0.0", description: "A gardening handbook." },
    });
    assert.equal(run(root, ["check", "--write"]).status, 0);
    const manifest = JSON.parse(readFileSync(join(root, "plugin.json"), "utf8")) as Record<
      string,
      unknown
    >;
    assert.equal(manifest["name"], "garden-handbook");
    assert.equal(existsSync(join(root, ".claude-plugin", "plugin.json")), true);
    writeFileSync(join(root, "plugin.json"), "{}\n");
    const stale = findings(run(root, ["check"]).envelope).find((f) => f.ruleId === "export-stale");
    assert.equal(stale?.path, "plugin.json");
  });

  it("a root that carries a marker is a copy, and renders nothing", () => {
    const root = garden({ content_roots: ["wiki"], exports: [ALL] });
    run(root, ["check", "--write"]);
    const copy = join(root, "skills", "garden");
    const r = run(copy, ["check", "--write"]);
    assert.equal(r.status, 0, JSON.stringify(r.envelope));
    assert.equal(existsSync(join(copy, "skills")), false, "a copy rendered exports of its own");
  });
});

describe("the staged gate compares the staged exports (docs/cli.md §gate)", () => {
  it("a page staged without its re-rendered export is refused", () => {
    const root = garden({ content_roots: ["wiki"], exports: [ALL] });
    run(root, ["check", "--write"]);
    git(root, "init", "-q");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "baseline");
    assert.equal(run(root, ["lint", "--staged"]).status, 0);
    write(root, { "wiki/raised-beds.md": note("Raised beds", ["beds"], "Beds edged in oak.") });
    // The artifacts are rendered too, and only the page and them are staged.
    run(root, ["check", "--write"]);
    git(root, "add", "wiki", "generated");
    const refused = run(root, ["gate"]);
    assert.equal(refused.status, 5, JSON.stringify(refused.envelope));
    const stale = findings(refused.envelope).filter((f) => f.ruleId === "export-stale");
    assert.deepEqual(
      stale.map((f) => f.path),
      ["skills/garden"],
    );
    assert.match(stale[0]?.message ?? "", /the staged copy differs/u);
    git(root, "add", "-A");
    assert.equal(run(root, ["gate"]).status, 0);
  });

  it("a kit declared by path, staged without its re-rendered export, is refused", () => {
    const root = garden({
      content_roots: ["wiki"],
      modules: [{ package: "kit-garden", version: "^1.0.0", path: "kit/garden" }],
      exports: [ALL],
    });
    cpSync(KIT_GARDEN, join(root, "kit", "garden"), { recursive: true });
    assert.equal(run(root, ["check", "--write"]).status, 0);
    git(root, "init", "-q");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "baseline");
    const entry = join(root, "kit", "garden", "index.js");
    writeFileSync(entry, `${readFileSync(entry, "utf8")}\n// a comment added to the kit\n`);
    git(root, "add", "kit");
    const refused = run(root, ["lint", "--staged"]);
    assert.equal(refused.status, 5, JSON.stringify(refused.envelope));
    const stale = findings(refused.envelope).find((f) => f.ruleId === "export-stale");
    assert.match(stale?.message ?? "", /skills\/garden\/kit\/garden\/index\.js \(changed\)/u);
    run(root, ["check", "--write"]);
    git(root, "add", "-A");
    assert.equal(run(root, ["lint", "--staged"]).status, 0);
  });
});
