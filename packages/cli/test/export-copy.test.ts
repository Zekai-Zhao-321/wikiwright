// docs/constitution.md §exports · docs/cli.md §The envelope, §check, §export
//
// An installed copy, end to end. A bundle renders its exports; a host installs
// one by a plain copy of its directory, with no install step; the copy is a
// vault that answers every reader under the identity its marker gives it, with
// its kit, its templates and its attachments beside it. A subset is a partial
// reader: a page it left out is not there to read.
//
// Every bundle is a gardening bundle under os.tmpdir(), and the CLI runs under
// Bun.

import { afterAll, describe, it } from "bun:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PINNED_CLOCK } from "./fixtures/clock.ts";
import { installedCopy } from "./fixtures/kit-code.ts";
import { runCli } from "./fixtures/runtime.ts";

const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));
const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const ORCHARD = join(REPO, "fixtures", "handbooks", "orchard");
const CODE_STARTER = join(REPO, "packages", "cli", "constitutions", "code");
const KIT_GARDEN = fileURLToPath(new URL("./fixtures/kit-garden", import.meta.url));
const SCRATCH = mkdtempSync(join(tmpdir(), "ww-export-copy-"));
afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));

interface Finding {
  ruleId: string;
  severity: string;
  path: string;
  message: string;
  queue?: string;
}

interface Exported {
  name: string;
  source: { repository: string | null };
  select: Record<string, unknown>;
  pages: number;
  cut: { links: number; citations: number; attachments: number };
  intact?: boolean;
}

interface Envelope {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: { code?: string };
  metadata: {
    bundle?: {
      label: string;
      head: string | null;
      dirty: boolean | null;
      law: string;
      content: string;
      export?: Exported;
    };
  };
}

function run(
  root: string,
  argv: readonly string[],
  extra: NodeJS.ProcessEnv = {},
): { status: number; envelope: Envelope } {
  const r = runCli([CLI, ...argv, "--root", root], {
    encoding: "utf8",
    env: { ...process.env, ...PINNED_CLOCK, ...extra },
  });
  assert.equal(typeof r.stdout, "string", `the CLI printed no envelope: ${r.stderr}`);
  return { status: r.status ?? -1, envelope: JSON.parse(r.stdout) as Envelope };
}

function findings(envelope: Envelope): Finding[] {
  return (envelope.data?.["findings"] ?? []) as Finding[];
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.name=T", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args],
    { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

function write(root: string, files: Record<string, string | Buffer>): void {
  for (const [path, bytes] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), bytes);
  }
}

let serial = 0;

/** A fresh directory for one case. */
function scratch(): string {
  const dir = join(SCRATCH, `case-${++serial}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** A copy of the orchard handbook under its own name, its exports rendered. */
function orchard(): string {
  const root = join(scratch(), "orchard");
  cpSync(ORCHARD, root, { recursive: true });
  rmSync(join(root, "skills"), { recursive: true, force: true });
  const r = run(root, ["check", "--write"]);
  assert.equal(r.status, 0, JSON.stringify(r.envelope));
  return root;
}

/** Install `skills/<name>` of `root` into a project's `.claude/skills/`, by a plain copy. */
function install(root: string, name: string): string {
  const copy = join(scratch(), "project", ".claude", "skills", name);
  cpSync(join(root, "skills", name), copy, { recursive: true });
  return copy;
}

/** The law digest the source's own envelope names. */
function lawOf(root: string): string {
  const law = run(root, ["type", "list"]).envelope.metadata.bundle?.law;
  assert.ok(law !== undefined);
  return law;
}

const note = (title: string, tags: string[], body: string): string =>
  `---\ntype: note\ntitle: ${title}\ndescription: ${title}, briefly.\ntags: [${tags.join(", ")}]\n---\n\n# ${title}\n\n${body}\n`;

const CONSTITUTION = `${JSON.stringify({
  schema: "wikiwright/constitution",
  schema_version: 3,
  vocabularies: {
    tags: {
      mode: "registered",
      entries: {
        beds: { description: "The beds and what grows in them." },
        compost: { description: "Making and using compost." },
      },
    },
  },
  types: { note: { extends: "concept", description: "A gardening note." } },
})}\n`;

/** The eight bytes every PNG opens with, and a few more: a synthetic image. */
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 1, 2, 3]);

describe("an installed copy answers every reader (docs/constitution.md §exports)", () => {
  it("orchard, copied into .claude/skills/: the readers answer under the marker's identity", () => {
    const root = orchard();
    const law = lawOf(root);
    const copy = install(root, "orchard");
    for (const argv of [
      ["search", "pruning"],
      ["read", "wiki/start-here.md"],
      ["type", "show", "procedure-page", "--brief"],
      ["vocabulary", "show", "tags"],
      ["brief"],
    ]) {
      const r = run(copy, argv);
      assert.equal(r.status, 0, `${argv.join(" ")}: ${JSON.stringify(r.envelope)}`);
      const bundle = r.envelope.metadata.bundle;
      assert.equal(bundle?.label, "orchard", argv.join(" "));
      assert.equal(bundle?.head, null, argv.join(" "));
      assert.equal(bundle?.dirty, null, argv.join(" "));
      assert.equal(bundle?.law, law, `${argv.join(" ")}: the copy's law is not its source's`);
      assert.equal(bundle?.export?.name, "orchard", argv.join(" "));
      assert.equal(bundle?.export?.intact, undefined, argv.join(" "));
    }
    // The brief the copy carries is the consumer's brief the copy prints.
    const printed = run(copy, ["brief", "--role", "consumer"]).envelope.data?.["brief"];
    assert.equal(readFileSync(join(copy, "generated", "BRIEF.md"), "utf8"), printed);
  });

  it("a subset is a partial reader: the page it left out is not there", () => {
    const root = orchard();
    const copy = install(root, "orchard-pruning");
    const r = run(copy, ["read", "wiki/pruning-roses.md"]);
    assert.equal(r.status, 0, JSON.stringify(r.envelope));
    assert.deepEqual(r.envelope.metadata.bundle?.export?.select, {
      kind: "tag",
      tags: ["pruning"],
    });
    assert.equal(r.envelope.metadata.bundle?.export?.pages, 1);
    const missing = run(copy, ["read", "wiki/start-here.md"]);
    assert.equal(missing.status, 3, JSON.stringify(missing.envelope));
    assert.equal(missing.envelope.error?.code, "page-not-found");
  });

  it("a kit declared by path travels at its path, and the copy loads it under its source's law", () => {
    const root = join(scratch(), "garden");
    cpSync(KIT_GARDEN, join(root, "kit", "garden"), { recursive: true });
    write(root, {
      "config/constitution.json": `${JSON.stringify({
        schema: "wikiwright/constitution",
        schema_version: 3,
        vocabularies: { tags: { mode: "registered", entries: {} } },
        types: {
          planting: {
            extends: "garden/planting",
            description: "One planting in one bed.",
            checks: [{ use: "garden/known-bed", config: { beds: ["north", "south"] } }],
          },
        },
      })}\n`,
      "config/engine.json": `${JSON.stringify({
        content_roots: ["wiki"],
        modules: [{ package: "kit-garden", version: "^1.0.0", path: "kit/garden" }],
        exports: [{ select: { kind: "all" }, contribution: { mode: "none" } }],
      })}\n`,
      "wiki/garlic.md":
        "---\ntype: planting\ntitle: Garlic\ndescription: Garlic cloves set in the north bed.\ntags: []\nbed: north\nsown: 2026-10-12\n---\n\n# Garlic\n\nGarlic cloves set in the north bed.\n\n## Care\n\nWeed by hand; stop watering once the leaves yellow.\n",
    });
    assert.equal(run(root, ["check", "--write"]).status, 0);
    const copy = install(root, "garden");
    assert.equal(existsSync(join(copy, "kit", "garden", "index.js")), true);
    const r = run(copy, ["type", "show", "planting", "--brief"]);
    assert.equal(r.status, 0, JSON.stringify(r.envelope));
    assert.equal(r.envelope.metadata.bundle?.law, lawOf(root));
  });

  it("a kit under node_modules travels there, and the copy loads it under its source's law", () => {
    const root = installedCopy(CODE_STARTER, "export-copy-kit");
    try {
      const engine = JSON.parse(
        readFileSync(join(root, "config", "engine.json"), "utf8"),
      ) as Record<string, unknown>;
      write(root, {
        "config/engine.json": `${JSON.stringify({
          ...engine,
          exports: [
            { name: "code-notes", select: { kind: "all" }, contribution: { mode: "none" } },
          ],
        })}\n`,
      });
      const rendered = run(root, ["check", "--write"]);
      assert.equal(existsSync(join(root, "skills", "code-notes")), true, JSON.stringify(rendered));
      const copy = install(root, "code-notes");
      assert.equal(
        existsSync(join(copy, "node_modules", "@wikiwright", "kit-code", "package.json")),
        true,
      );
      const r = run(copy, ["type", "list"]);
      assert.equal(r.status, 0, JSON.stringify(r.envelope));
      assert.equal(r.envelope.metadata.bundle?.law, lawOf(root));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a source root the copy does not carry is not missed: the copy loads and no finding names it", () => {
    const root = join(scratch(), "garden");
    write(root, {
      "config/constitution.json": CONSTITUTION,
      "config/engine.json": `${JSON.stringify({
        content_roots: ["wiki"],
        source_roots: ["raw"],
        exports: [{ select: { kind: "all" }, contribution: { mode: "none" } }],
      })}\n`,
      "wiki/turning-compost.md": note("Turning compost", ["compost"], "Turn it weekly."),
      "raw/compost-log.txt": "Turned the heap on a dry morning.\n",
    });
    assert.equal(run(root, ["check", "--write"]).status, 0);
    const copy = install(root, "garden");
    assert.equal(existsSync(join(copy, "raw")), false);
    const r = run(copy, ["lint", "--all"]);
    assert.equal(r.status, 0, JSON.stringify(r.envelope));
    const naming = findings(r.envelope).filter(
      (f) => f.path.startsWith("raw") || f.message.includes("raw/"),
    );
    assert.deepEqual(naming, []);
  });

  it("an embedded image travels with its page; one outside the content roots is counted", () => {
    const root = join(scratch(), "garden");
    write(root, {
      "config/constitution.json": CONSTITUTION,
      "config/engine.json": `${JSON.stringify({
        content_roots: ["wiki"],
        exports: [{ select: { kind: "all" }, contribution: { mode: "none" } }],
      })}\n`,
      "wiki/raised-beds.md": note(
        "Raised beds",
        ["beds"],
        "Beds edged in timber.\n\n![[bed.png]]\n\n![[shed.png]]",
      ),
      "wiki/bed.png": PNG,
      "assets/shed.png": PNG,
    });
    assert.equal(run(root, ["check", "--write"]).status, 0);
    const copy = install(root, "garden");
    assert.deepEqual(readFileSync(join(copy, "wiki", "bed.png")), PNG);
    assert.equal(existsSync(join(copy, "assets")), false);
    const r = run(copy, ["read", "wiki/raised-beds.md"]);
    assert.equal(r.status, 0, JSON.stringify(r.envelope));
    assert.deepEqual(r.envelope.metadata.bundle?.export?.cut, {
      links: 0,
      citations: 0,
      attachments: 1,
    });
  });

  it("orchard-pruning under links: cut carries its counts; under closed it is export-not-closed", () => {
    const root = orchard();
    const page = join(root, "wiki", "pruning-roses.md");
    writeFileSync(
      page,
      `${readFileSync(page, "utf8")}\nThin the apples after the roses: [[thinning-apples]].\n`,
    );
    assert.equal(run(root, ["check", "--write"]).status, 0);
    const copy = install(root, "orchard-pruning");
    const cut = run(copy, ["search", "pruning"]).envelope.metadata.bundle?.export?.cut;
    assert.deepEqual(cut, { links: 1, citations: 0, attachments: 0 });

    const engine = join(root, "config", "engine.json");
    writeFileSync(
      engine,
      readFileSync(engine, "utf8").replace('"links": "cut",', '"links": "closed",'),
    );
    const r = run(root, ["check"]);
    const [closed] = findings(r.envelope).filter((f) => f.ruleId === "export-not-closed");
    assert.equal(closed?.severity, "warning", JSON.stringify(r.envelope));
    assert.equal(closed?.queue, "export-review");
  });
});

describe("a render is reproducible (docs/cli.md §check)", () => {
  it("two renders give identical bytes, and a committed render stays clean", () => {
    const bytes = (root: string): Record<string, string> => {
      const out: Record<string, string> = {};
      for (const entry of readdirSync(join(root, "skills"), {
        recursive: true,
        withFileTypes: true,
        encoding: "utf8",
      })) {
        if (!entry.isFile()) continue;
        const abs = join(entry.parentPath, entry.name);
        out[abs.slice(root.length + 1)] = readFileSync(abs).toString("base64");
      }
      return out;
    };
    // Two renders in two directories, each from nothing.
    const root = orchard();
    assert.deepEqual(bytes(orchard()), bytes(root));

    git(root, "init", "-q");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "the handbook and its exports");
    assert.equal(run(root, ["check"]).status, 0);
    assert.equal(run(root, ["check", "--write"]).status, 0);
    assert.equal(git(root, "status", "--porcelain"), "");
  });
});

describe("export --to over an earlier export (docs/cli.md §export)", () => {
  it("a shrunk selection removes the obsolete owned file, and leaves a foreign file and .git alone", () => {
    const base = scratch();
    const root = join(base, "garden");
    const to = join(base, "elsewhere");
    const declareSelection = (select: Record<string, unknown>): void =>
      write(root, {
        "config/engine.json": `${JSON.stringify({
          content_roots: ["wiki"],
          exports: [
            {
              name: "garden-notes",
              select,
              output: "external",
              repository: "https://example.invalid/garden",
              links: "cut",
              contribution: { mode: "none" },
            },
          ],
        })}\n`,
      });
    write(root, {
      "config/constitution.json": CONSTITUTION,
      "wiki/turning-compost.md": note("Turning compost", ["compost"], "Turn it weekly."),
      "wiki/raised-beds.md": note("Raised beds", ["beds"], "Beds edged in timber."),
    });
    declareSelection({ kind: "all" });
    write(to, {
      "README.md": "A repository of skills.\n",
      "skills/other/notes.md": "someone else's skill\n",
    });
    git(to, "init", "-q");
    git(to, "add", "-A");
    git(to, "commit", "-q", "-m", "the repository before any export");
    const head = readFileSync(join(to, ".git", "HEAD"), "utf8");
    const first = run(root, ["export", "garden-notes", "--to", to]);
    assert.equal(first.status, 0, JSON.stringify(first.envelope));
    assert.equal(existsSync(join(to, "skills", "garden-notes", "wiki", "raised-beds.md")), true);

    declareSelection({ kind: "tag", tags: ["compost"] });
    const planned = run(root, ["export", "garden-notes", "--to", to, "--dry-run"]);
    const ops = (planned.envelope.data?.["ops"] ?? []) as { kind: string; path: string }[];
    assert.deepEqual(
      ops.filter((op) => op.kind === "delete").map((op) => op.path),
      [join(to, "skills", "garden-notes", "wiki", "raised-beds.md")],
    );
    assert.equal(existsSync(join(to, "skills", "garden-notes", "wiki", "raised-beds.md")), true);

    const r = run(root, ["export", "garden-notes", "--to", to]);
    assert.equal(r.status, 0, JSON.stringify(r.envelope));
    assert.equal(r.envelope.data?.["removed"], 1);
    assert.equal(existsSync(join(to, "skills", "garden-notes", "wiki", "raised-beds.md")), false);
    assert.equal(
      existsSync(join(to, "skills", "garden-notes", "wiki", "turning-compost.md")),
      true,
    );
    assert.equal(readFileSync(join(to, "README.md"), "utf8"), "A repository of skills.\n");
    assert.equal(
      readFileSync(join(to, "skills", "other", "notes.md"), "utf8"),
      "someone else's skill\n",
    );
    assert.equal(readFileSync(join(to, ".git", "HEAD"), "utf8"), head);
    assert.equal(git(to, "status", "--porcelain", "--", "README.md", "skills/other"), "");
  });
});

const PLANTING_LAW = `${JSON.stringify({
  schema: "wikiwright/constitution",
  schema_version: 3,
  vocabularies: { tags: { mode: "registered", entries: {} } },
  types: {
    planting: {
      extends: "garden/planting",
      description: "One planting in one bed.",
      checks: [{ use: "garden/known-bed", config: { beds: ["north", "south"] } }],
    },
  },
})}\n`;
const GARLIC =
  "---\ntype: planting\ntitle: Garlic\ndescription: Garlic cloves set in the north bed.\ntags: []\nbed: north\nsown: 2026-10-12\n---\n\n# Garlic\n\nGarlic cloves set in the north bed.\n\n## Care\n\nWeed by hand; stop watering once the leaves yellow.\n";

describe("the working tree is read through its links; the index's links are refused (docs/cli.md §check, §gate)", () => {
  /** A bundle over the garden kit installed under node_modules as a package manager links it. */
  function linkedKit(layout: "files" | "directory"): string {
    const root = join(scratch(), "garden");
    write(root, {
      "config/constitution.json": PLANTING_LAW,
      "config/engine.json": `${JSON.stringify({
        content_roots: ["wiki"],
        modules: [{ package: "kit-garden", version: "^1.0.0" }],
        exports: [{ select: { kind: "all" }, contribution: { mode: "none" } }],
      })}\n`,
      "wiki/garlic.md": GARLIC,
    });
    const installed = join(root, "node_modules", "kit-garden");
    if (layout === "directory") {
      // A workspace link: the package directory is a link to one outside the bundle.
      const outside = join(dirname(root), "kit-garden-source");
      cpSync(KIT_GARDEN, outside, { recursive: true });
      mkdirSync(dirname(installed), { recursive: true });
      symlinkSync(outside, installed);
    } else {
      // A `file:` install: every file is a link back into the package's own tree.
      mkdirSync(installed, { recursive: true });
      for (const name of readdirSync(KIT_GARDEN)) {
        symlinkSync(join(KIT_GARDEN, name), join(installed, name));
      }
    }
    return root;
  }

  for (const layout of ["files", "directory"] as const) {
    it(`a kit linked under node_modules (${layout}) exports as real files, under its source's law`, () => {
      if (process.platform === "win32") return;
      const root = linkedKit(layout);
      const rendered = run(root, ["check", "--write"]);
      assert.equal(rendered.status, 0, JSON.stringify(rendered.envelope));
      const kit = join(root, "skills", "garden", "node_modules", "kit-garden");
      for (const name of readdirSync(KIT_GARDEN)) {
        assert.equal(
          lstatSync(join(kit, name)).isFile(),
          true,
          `${name} is not a file in the copy`,
        );
        assert.deepEqual(readFileSync(join(kit, name)), readFileSync(join(KIT_GARDEN, name)));
      }
      assert.equal(lstatSync(kit).isDirectory(), true);
      const copy = install(root, "garden");
      const r = run(copy, ["type", "show", "planting", "--brief"]);
      assert.equal(r.status, 0, JSON.stringify(r.envelope));
      assert.equal(r.envelope.metadata.bundle?.law, lawOf(root));
      assert.equal(r.envelope.metadata.bundle?.export?.intact, undefined);
    });
  }

  it("a link in a rendered copy is export-stale, and check --write replaces it with bytes", () => {
    if (process.platform === "win32") return;
    const root = join(scratch(), "garden");
    write(root, {
      "config/constitution.json": CONSTITUTION,
      "config/engine.json": `${JSON.stringify({
        content_roots: ["wiki"],
        exports: [{ select: { kind: "all" }, contribution: { mode: "none" } }],
      })}\n`,
      "wiki/turning-compost.md": note("Turning compost", ["compost"], "Turn it weekly."),
    });
    assert.equal(run(root, ["check", "--write"]).status, 0);
    const rendered = join(root, "skills", "garden", "wiki", "turning-compost.md");
    rmSync(rendered);
    symlinkSync(join(root, "wiki", "turning-compost.md"), rendered);
    const stale = findings(run(root, ["check"]).envelope).find((f) => f.ruleId === "export-stale");
    assert.match(stale?.message ?? "", /skills\/garden\/wiki\/turning-compost\.md \(changed\)/u);
    assert.equal(run(root, ["check", "--write"]).status, 0);
    assert.equal(lstatSync(rendered).isFile(), true);
    assert.equal(lstatSync(join(root, "wiki", "turning-compost.md")).isFile(), true);
    assert.equal(run(root, ["check"]).status, 0);
  });

  it("the staged gate refuses a link the index tracks, since the index holds no bytes for it", () => {
    if (process.platform === "win32") return;
    const root = join(scratch(), "garden");
    cpSync(KIT_GARDEN, join(root, "kit", "garden"), { recursive: true });
    write(root, {
      "config/constitution.json": PLANTING_LAW,
      "config/engine.json": `${JSON.stringify({
        content_roots: ["wiki"],
        modules: [{ package: "kit-garden", version: "^1.0.0", path: "kit/garden" }],
        exports: [{ select: { kind: "all" }, contribution: { mode: "none" } }],
      })}\n`,
      "wiki/garlic.md": GARLIC,
    });
    assert.equal(run(root, ["check", "--write"]).status, 0);
    git(root, "init", "-q");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "baseline");
    // The same bytes, reached through a link inside the bundle: the working
    // tree renders the same copy, and the index tracks the link.
    const fixture = join(root, "kit", "garden", "fixture.json");
    cpSync(fixture, join(root, "kit-fixture.json"));
    rmSync(fixture);
    symlinkSync(join(root, "kit-fixture.json"), fixture);
    assert.equal(run(root, ["check", "--write"]).status, 0);
    git(root, "add", "-A");
    const refused = run(root, ["lint", "--staged"]);
    assert.equal(refused.status, 5, JSON.stringify(refused.envelope));
    const symlink = findings(refused.envelope).find((f) => f.ruleId === "export-symlink");
    assert.match(
      symlink?.message ?? "",
      /the index tracks 1 symbolic link\(s\).*kit\/garden\/fixture\.json/u,
    );
    assert.equal(symlink?.queue, "export-review");
  });
});

describe("a copy carries the kit its law covers (docs/constitution.md §exports)", () => {
  /** A gardening bundle carrying the garden kit at kit/garden, its files arranged by `arrange`. */
  function carrying(arrange: (kit: string) => void): string {
    const root = join(scratch(), "garden");
    const kit = join(root, "kit", "garden");
    cpSync(KIT_GARDEN, kit, { recursive: true });
    arrange(kit);
    write(root, {
      "config/constitution.json": PLANTING_LAW,
      "config/engine.json": `${JSON.stringify({
        content_roots: ["wiki"],
        modules: [{ package: "kit-garden", version: "^1.0.0", path: "kit/garden" }],
        exports: [{ select: { kind: "all" }, contribution: { mode: "none" } }],
      })}\n`,
      "wiki/garlic.md": GARLIC,
    });
    return root;
  }

  /** Render, install by a plain copy, and read the copy's envelope. */
  function renderAndRead(root: string): Envelope {
    const rendered = run(root, ["check", "--write"]);
    assert.equal(rendered.status, 0, JSON.stringify(rendered.envelope));
    const copy = install(root, "garden");
    const r = run(copy, ["type", "show", "planting", "--brief"]);
    assert.equal(r.status, 0, JSON.stringify(r.envelope));
    return r.envelope;
  }

  it("a directory reached by two paths is carried under both, and the declared entry loads", () => {
    if (process.platform === "win32") return;
    const root = carrying((kit) => {
      // The entry moves into data/, and alias/ is a link to it.
      mkdirSync(join(kit, "data"));
      cpSync(join(kit, "index.js"), join(kit, "data", "index.js"));
      rmSync(join(kit, "index.js"));
      const manifest = join(kit, "package.json");
      writeFileSync(
        manifest,
        readFileSync(manifest, "utf8").replace('"./index.js"', '"./data/index.js"'),
      );
      symlinkSync("data", join(kit, "alias"));
    });
    const envelope = renderAndRead(root);
    const kit = join(root, "skills", "garden", "kit", "garden");
    assert.equal(lstatSync(join(kit, "data", "index.js")).isFile(), true);
    assert.equal(lstatSync(join(kit, "alias", "index.js")).isFile(), true);
    assert.equal(envelope.metadata.bundle?.law, lawOf(root));
    assert.equal(envelope.metadata.bundle?.export?.intact, undefined);
  });

  it("a kit that carries .git carries it in its digest, and the copy is intact", () => {
    const root = carrying((kit) => {
      mkdirSync(join(kit, ".git"));
      writeFileSync(join(kit, ".git", "HEAD"), "ref: refs/heads/main\n");
    });
    const envelope = renderAndRead(root);
    assert.equal(existsSync(join(root, "skills", "garden", "kit", "garden", ".git", "HEAD")), true);
    assert.equal(envelope.metadata.bundle?.law, lawOf(root));
    assert.equal(envelope.metadata.bundle?.export?.intact, undefined);
  });

  it("a file removed from the kit's .git leaves the copy too, and the copy stays intact", () => {
    const root = carrying((kit) => {
      mkdirSync(join(kit, ".git"));
      writeFileSync(join(kit, ".git", "HEAD"), "ref: refs/heads/main\n");
      writeFileSync(join(kit, ".git", "description"), "The garden kit.\n");
    });
    renderAndRead(root);
    const copied = join(root, "skills", "garden", "kit", "garden", ".git");
    assert.equal(existsSync(join(copied, "HEAD")), true);
    // The export's directory is owned whole: a render removes what the plan
    // no longer holds, a `.git` name included.
    rmSync(join(root, "kit", "garden", ".git", "HEAD"));
    const envelope = renderAndRead(root);
    assert.equal(existsSync(join(copied, "HEAD")), false);
    assert.equal(existsSync(join(copied, "description")), true);
    assert.equal(envelope.metadata.bundle?.law, lawOf(root));
    assert.equal(envelope.metadata.bundle?.export?.intact, undefined);
    const checked = run(root, ["check"]);
    assert.deepEqual(
      findings(checked.envelope).filter((f) => f.ruleId === "export-stale"),
      [],
    );
  });

  it("the staged plan composes a path kit from the index: a type only the working tree's kit adds is in no staged brief", () => {
    const root = carrying(() => undefined);
    assert.equal(run(root, ["check", "--write"]).status, 0);
    git(root, "init", "-q");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "baseline");
    const brief = join(root, "skills", "garden", "generated", "BRIEF.md");
    const marker = join(root, "skills", "garden", "config", "export.json");
    const committed = { brief: readFileSync(brief, "utf8"), marker: readFileSync(marker, "utf8") };
    // A concrete type in the working tree's kit only; nothing is staged.
    const entry = join(root, "kit", "garden", "index.js");
    writeFileSync(
      entry,
      readFileSync(entry, "utf8").replace(
        "  types: {\n",
        '  types: {\n    "garden/rotation": { extends: "procedure", description: "A crop rotation across the beds." },\n',
      ),
    );
    // The working tree's own render differs in its brief: the edit reaches one.
    const tree = findings(run(root, ["check"]).envelope).filter((f) => f.ruleId === "export-stale");
    assert.match(tree[0]?.message ?? "", /generated\/BRIEF\.md \(changed\)/u, JSON.stringify(tree));
    // The staged plan is the staged kit's: its brief and marker are the
    // committed copy's, so the staged copy is not stale. The kit is written
    // out under the temporary directory the CLI is given, and removed.
    const temporary = scratch();
    const staged = run(root, ["lint", "--staged"], { TMPDIR: temporary });
    assert.equal(staged.status, 0, JSON.stringify(staged.envelope));
    assert.deepEqual(readdirSync(temporary), [], "the staged kit was left behind");
    assert.deepEqual(
      findings(staged.envelope).filter((f) => f.ruleId === "export-stale"),
      [],
    );
    assert.equal(readFileSync(brief, "utf8"), committed.brief);
    assert.equal(readFileSync(marker, "utf8"), committed.marker);
    assert.equal(committed.brief.includes("garden/rotation"), false);
  });

  it("the staged gate takes a path kit's law from the index: an unstaged kit edit is no export-stale", () => {
    const root = carrying(() => undefined);
    assert.equal(run(root, ["check", "--write"]).status, 0);
    git(root, "init", "-q");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "baseline");
    // The working tree's kit moves; nothing is staged.
    const entry = join(root, "kit", "garden", "index.js");
    writeFileSync(entry, `${readFileSync(entry, "utf8")}\n// an edit not yet staged\n`);
    const staged = run(root, ["lint", "--staged"]);
    assert.equal(staged.status, 0, JSON.stringify(staged.envelope));
    assert.deepEqual(
      findings(staged.envelope).filter((f) => f.ruleId === "export-stale"),
      [],
    );
    // The committed copy still names the committed law, and says it is intact.
    const copy = install(root, "garden");
    git(root, "stash", "-q");
    const committed = lawOf(root);
    const read = run(copy, ["type", "list"]);
    assert.equal(read.envelope.metadata.bundle?.law, committed);
    assert.equal(read.envelope.metadata.bundle?.export?.intact, undefined);
  });
});
