// docs/extending.md §Declaring a module · docs/constitution.md §config/engine.json
//
// e2e:modules — the `path` spelling. A bundle may carry a kit in its own tree
// and declare it by a bundle-relative directory instead of installing it under
// `node_modules`: `{ "package": "kit-garden", "path": "kit/garden" }`. The
// declared path is the only place the module is read from; a directory that
// is not there is unresolved, and a path that leaves the bundle is refused.
//
// The kit is `fixtures/kit-garden`, a neutral gardening kit: one type, one
// fragment, one template, one check and the lane the check routes to. Every
// bundle here is a copy under os.tmpdir().
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { PINNED_CLOCK } from "./fixtures/clock.ts";
import { CLI_RUNTIME } from "./fixtures/runtime.ts";

const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));
const KIT = fileURLToPath(new URL("./fixtures/kit-garden", import.meta.url));
const SCRATCH = mkdtempSync(join(tmpdir(), "ww-module-path-"));
after(() => rmSync(SCRATCH, { recursive: true, force: true }));

interface Envelope {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: Record<string, unknown>;
  metadata: { bundle?: { law: string } };
}

function run(root: string, argv: readonly string[]): { status: number; envelope: Envelope } {
  const r = spawnSync(CLI_RUNTIME, [CLI, ...argv, "--root", root], {
    encoding: "utf8",
    env: { ...process.env, ...PINNED_CLOCK },
  });
  assert.equal(typeof r.stdout, "string", `the CLI printed no envelope: ${r.stderr}`);
  return { status: r.status ?? -1, envelope: JSON.parse(r.stdout) as Envelope };
}

const page = (title: string, bed: string, sown: string, care: string): string =>
  `---\ntype: planting\ntitle: ${title}\ndescription: ${title} in the ${bed} bed.\ntags: []\nbed: ${bed}\nsown: ${sown}\n---\n\n# ${title}\n\n${title} in the ${bed} bed.\n\n## Care\n\n${care}\n`;

let serial = 0;

/** A garden bundle under os.tmpdir() that carries the kit at `kit/garden` and declares it there. */
function gardenBundle(modulePath = "kit/garden"): string {
  const root = join(SCRATCH, `garden-${++serial}`);
  mkdirSync(join(root, "config"), { recursive: true });
  mkdirSync(join(root, "wiki"), { recursive: true });
  writeFileSync(
    join(root, "config", "constitution.json"),
    `${JSON.stringify(
      {
        schema: "wikiwright/constitution",
        schema_version: 3,
        vocabularies: { tags: { mode: "registered", entries: {} } },
        types: {
          planting: {
            extends: "garden/planting",
            description: "A planting in this garden.",
            checks: [{ use: "garden/known-bed", config: { beds: ["north", "south"] } }],
          },
        },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(root, "config", "engine.json"),
    `${JSON.stringify(
      {
        content_roots: ["wiki"],
        modules: [{ package: "kit-garden", version: "^1.0.0", path: modulePath }],
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(root, "wiki", "leeks.md"),
    page("Leeks", "south", "2026-04-20", "Earth up the stems as they thicken."),
  );
  writeFileSync(
    join(root, "wiki", "rhubarb.md"),
    page("Rhubarb", "orchard", "2026-03-01", "Mulch the crowns with compost in autumn."),
  );
  cpSync(KIT, join(root, "kit", "garden"), { recursive: true });
  return root;
}

const sha256 = (bytes: string | Buffer): string => createHash("sha256").update(bytes).digest("hex");

/** docs/cli.md §The envelope's law digest, recomputed from the files. */
function lawFormula(root: string, moduleLines: readonly string[]): string {
  return sha256(
    [
      `config/constitution.json ${sha256(readFileSync(join(root, "config", "constitution.json")))}`,
      `config/engine.json ${sha256(readFileSync(join(root, "config", "engine.json")))}`,
      ...moduleLines,
    ].join("\n"),
  );
}

describe("a kit declared by a bundle-relative path (docs/extending.md §Declaring a module)", () => {
  it("loads from the bundle's own tree, proves its fixture and governs the bundle", () => {
    const root = gardenBundle();
    assert.equal(existsSync(join(root, "node_modules")), false, "nothing was installed");
    const listed = run(root, ["modules", "list"]);
    assert.equal(listed.status, 0, JSON.stringify(listed.envelope));
    assert.deepEqual(listed.envelope.data?.["refused"], []);
    const [row] = (listed.envelope.data?.["loaded"] ?? []) as Record<string, unknown>[];
    assert.equal(row?.["package"], "kit-garden");
    assert.equal((row?.["resolved"] as { path?: string } | undefined)?.path, "kit/garden");
    assert.deepEqual(row?.["contributes"], {
      types: ["garden/planting"],
      fragments: ["garden/planted"],
      templates: ["garden/planting.md"],
      skills: [],
      entries: [],
      vocabularies: [],
      grammars: [],
      checks: ["garden/known-bed"],
      lanes: ["garden/review"],
    });
    assert.deepEqual(row?.["fixture"], { package: "kit-garden", pages: 2, findings: 1 });

    // The kit's check fires on the bundle's own page, and routes to the kit's lane.
    const checked = run(root, ["check"]);
    const findings = (checked.envelope.data?.["findings"] ?? []) as {
      ruleId: string;
      path: string;
      queue?: string;
    }[];
    assert.deepEqual(
      findings.filter((f) => f.ruleId === "garden/known-bed").map((f) => [f.path, f.queue]),
      [["wiki/rhubarb.md", "garden/review"]],
      JSON.stringify(checked.envelope),
    );
    // …and its template is the type's skeleton.
    const shown = run(root, ["type", "show", "planting", "--brief"]);
    assert.match(String(shown.envelope.data?.["skeleton"]), /^## Care$/mu);
  });

  it("its digest is in the law every envelope and the brief name", () => {
    const root = gardenBundle();
    const listed = run(root, ["modules", "list"]);
    const [row] = (listed.envelope.data?.["loaded"] ?? []) as { digest: string }[];
    const digest = row?.digest ?? "";
    assert.match(digest, /^[0-9a-f]{64}$/u);
    const law = lawFormula(root, [`module:kit-garden ${digest}`]);
    assert.equal(listed.envelope.metadata.bundle?.law, law);
    const briefed = run(root, ["brief"]);
    assert.equal(briefed.envelope.metadata.bundle?.law, law);
    assert.ok(
      String(briefed.envelope.data?.["brief"]).includes(`\nLaw digest: \`${law}\`\n`),
      "the brief's header names the same law digest",
    );
    // A byte of the kit moves it.
    const entry = join(root, "kit", "garden", "index.js");
    writeFileSync(entry, `${readFileSync(entry, "utf8")}\n// one more line\n`);
    assert.notEqual(run(root, ["modules", "list"]).envelope.metadata.bundle?.law, law);
  });

  it("the declared path is authoritative: no directory there is unresolved, whatever node_modules holds", () => {
    const root = gardenBundle();
    cpSync(join(root, "kit", "garden"), join(root, "node_modules", "kit-garden"), {
      recursive: true,
    });
    rmSync(join(root, "kit"), { recursive: true, force: true });
    const checked = run(root, ["check"]);
    assert.equal(checked.status, 2, JSON.stringify(checked.envelope));
    assert.equal(checked.envelope.error?.["code"], "module-unresolved");
    const listed = run(root, ["modules", "list"]);
    const [refused] = (listed.envelope.data?.["refused"] ?? []) as {
      code: string;
      message: string;
      resolved: { path: string };
    }[];
    assert.equal(refused?.code, "module-unresolved");
    assert.match(refused?.message ?? "", /"kit\/garden"/u);
    assert.equal(refused?.resolved.path, "kit/garden");
    assert.deepEqual(listed.envelope.data?.["loaded"], []);
  });

  it("a path that leaves the bundle is refused: by the schema at load, and by the loader", () => {
    for (const escaping of ["../garden", "/opt/garden"]) {
      const root = gardenBundle(escaping);
      const checked = run(root, ["check"]);
      assert.equal(checked.status, 2, `${escaping}: ${JSON.stringify(checked.envelope)}`);
      assert.equal(checked.envelope.error?.["code"], "constitution-invalid", escaping);
      const issues = (checked.envelope.data?.["issues"] ?? []) as { where: string }[];
      assert.deepEqual(
        issues.map((i) => i.where),
        ["engine.modules.0.path"],
        escaping,
      );
      const listed = run(root, ["modules", "list"]);
      const refused = (listed.envelope.data?.["refused"] ?? []) as { code: string }[];
      assert.deepEqual(
        refused.map((r) => r.code),
        ["module-malformed"],
        escaping,
      );
    }
  });

  it("a declared directory that links outside the bundle is refused by the loader", () => {
    if (process.platform === "win32") return;
    const root = gardenBundle();
    const outside = join(SCRATCH, `outside-${++serial}`);
    cpSync(join(root, "kit", "garden"), outside, { recursive: true });
    rmSync(join(root, "kit", "garden"), { recursive: true, force: true });
    symlinkSync(outside, join(root, "kit", "garden"), "dir");
    const checked = run(root, ["check"]);
    assert.equal(checked.status, 2, JSON.stringify(checked.envelope));
    assert.equal(checked.envelope.error?.["code"], "module-malformed");
    const [issue] = (checked.envelope.data?.["issues"] ?? []) as { message: string }[];
    assert.match(issue?.message ?? "", /"kit\/garden", which resolves outside the bundle/u);
  });
});

describe("a kit reaches no helper outside itself behind a comment (docs/extending.md §The purity scan)", () => {
  it("a steered comment hides no import: the kit is refused, whatever the helper holds", () => {
    const root = gardenBundle();
    // A helper outside the kit, which no digest covers, and a kit whose check
    // reads it through an import the comment reader would blank: `/*` in the
    // regular expression opens a comment there, and `// */` closes it.
    const entry = join(root, "kit", "garden", "index.js");
    const text = readFileSync(entry, "utf8").replace(
      "ctx.config.beds.includes(bed)",
      "(ctx.config.beds.includes(bed) || beds.includes(bed))",
    );
    writeFileSync(
      entry,
      `if (false) /[/*]/.test("garden");\nimport { beds } from "../../garden-beds.mjs";\n// */\n${text}`,
    );
    const outcomes: Envelope[] = [];
    for (const beds of [["orchard"], []]) {
      writeFileSync(
        join(root, "garden-beds.mjs"),
        `export const beds = ${JSON.stringify(beds)};\n`,
      );
      const checked = run(root, ["check"]);
      assert.equal(checked.envelope.error?.["code"], "module-impure", JSON.stringify(checked));
      const [issue] = (checked.envelope.data?.["issues"] ?? []) as { message: string }[];
      assert.match(issue?.message ?? "", /index\.js:2 imports a module \(an import declaration\)/u);
      outcomes.push(checked.envelope);
    }
    // The helper changed and nothing judged: no verdict depends on it.
    assert.deepEqual(outcomes[1], outcomes[0]);
  });
});

describe("the staged gate judges under the staged path kit (docs/cli.md §gate)", () => {
  function git(cwd: string, ...args: string[]): void {
    execFileSync(
      "git",
      [
        "-c",
        "user.name=T",
        "-c",
        "user.email=t@example.com",
        "-c",
        "commit.gpgsign=false",
        ...args,
      ],
      { cwd, stdio: "ignore" },
    );
  }

  /** A committed garden bundle whose constitution attaches no check, and one page in an undeclared bed. */
  function committedGarden(): { root: string; kit: string } {
    const root = join(SCRATCH, `staged-${++serial}`);
    const kit = join(root, "kit", "garden");
    mkdirSync(join(root, "config"), { recursive: true });
    mkdirSync(join(root, "wiki"), { recursive: true });
    writeFileSync(
      join(root, "config", "constitution.json"),
      `${JSON.stringify({
        schema: "wikiwright/constitution",
        schema_version: 3,
        vocabularies: { tags: { mode: "registered", entries: {} } },
        types: {
          planting: { extends: "garden/planting", description: "A planting in this garden." },
        },
      })}\n`,
    );
    writeFileSync(
      join(root, "config", "engine.json"),
      `${JSON.stringify({
        content_roots: ["wiki"],
        modules: [{ package: "kit-garden", version: "^1.0.0", path: "kit/garden" }],
      })}\n`,
    );
    writeFileSync(
      join(root, "wiki", "rhubarb.md"),
      page("Rhubarb", "orchard", "2026-03-01", "Mulch the crowns with compost in autumn."),
    );
    cpSync(KIT, kit, { recursive: true });
    git(root, "init", "-q");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "baseline");
    return { root, kit };
  }

  /**
   * The kit with `garden/known-bed` attached in its own abstract type, so a
   * planting in an undeclared bed is found whatever the bundle attaches; the
   * fixture moves its attachment into the kit with it, and expects the same.
   */
  function attachInKit(kit: string): void {
    const entry = join(kit, "index.js");
    writeFileSync(
      entry,
      readFileSync(entry, "utf8").replace(
        '      fragments: ["garden/planted"],\n',
        '      fragments: ["garden/planted"],\n      checks: [{ use: "garden/known-bed", config: { beds: ["north", "south"] } }],\n',
      ),
    );
    const fixture = join(kit, "fixture.json");
    const parsed = JSON.parse(readFileSync(fixture, "utf8")) as {
      constitution: { types: { planting: { checks?: unknown } } };
    };
    delete parsed.constitution.types.planting.checks;
    writeFileSync(fixture, `${JSON.stringify(parsed, null, 2)}\n`);
  }

  const fires = (envelope: Envelope): boolean =>
    ((envelope.data?.["findings"] ?? []) as { ruleId: string }[]).some(
      (f) => f.ruleId === "garden/known-bed",
    );

  it("a check attached only in the working tree's kit does not fire; one attached only in the staged kit does", () => {
    const { root, kit } = committedGarden();
    const committed = {
      entry: readFileSync(join(kit, "index.js")),
      fixture: readFileSync(join(kit, "fixture.json")),
    };
    // The staged gate judges the pages a commit changes: the page is staged.
    writeFileSync(
      join(root, "wiki", "rhubarb.md"),
      page("Rhubarb", "orchard", "2026-03-01", "Force the crowns under a pot in late winter."),
    );
    git(root, "add", "wiki");
    // The working tree's kit attaches the check; the kit is not staged.
    attachInKit(kit);
    assert.equal(fires(run(root, ["check"]).envelope), true, "the attachment reaches the tree");
    const unstaged = run(root, ["lint", "--staged"]);
    assert.equal(fires(unstaged.envelope), false, JSON.stringify(unstaged.envelope));
    // The attachment staged, and the working tree's kit put back.
    git(root, "add", "kit");
    writeFileSync(join(kit, "index.js"), committed.entry);
    writeFileSync(join(kit, "fixture.json"), committed.fixture);
    assert.equal(fires(run(root, ["check"]).envelope), false, "the tree's kit attaches nothing");
    const staged = run(root, ["lint", "--staged"]);
    assert.equal(fires(staged.envelope), true, JSON.stringify(staged.envelope));
  });

  it("a staged kit that does not load refuses the gate with the loader's own code", () => {
    const { root, kit } = committedGarden();
    const entry = join(kit, "index.js");
    const committed = readFileSync(entry);
    writeFileSync(entry, `${committed.toString("utf8")}\nexport const sownAt = Date.now();\n`);
    git(root, "add", "kit");
    writeFileSync(entry, committed);
    const refused = run(root, ["lint", "--staged"]);
    assert.equal(
      refused.envelope.error?.["code"],
      "module-impure",
      JSON.stringify(refused.envelope),
    );
    // The working tree's kit is clean, and loads.
    assert.notEqual(run(root, ["check"]).envelope.error?.["code"], "module-impure");
  });
});
