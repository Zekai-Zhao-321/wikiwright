// docs/cli.md §bundles: `bundles list` is the scan `--bundle` resolves
// through, printed: one row per bundle skill in the skill directories, in the
// order a name is resolved in, with the identity its marker gives it and what
// its installer wrote into its SKILL.md, and one row per directory whose
// marker the scan could not take. It reads markers only: it loads no law,
// runs no kit and hashes no page. Nothing registers a bundle.
//
// Every scan here runs with HOME under os.tmpdir(): no test reads a skill
// directory of the developer's.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { PINNED_CLOCK } from "./fixtures/clock.ts";
import { runCli } from "./fixtures/runtime.ts";

const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));
const TEST_DIR = fileURLToPath(new URL(".", import.meta.url));
const HANDBOOKS = fileURLToPath(new URL("../../../fixtures/handbooks/", import.meta.url));

interface Envelope {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: { code?: string; details?: Record<string, unknown> };
}

interface Row {
  name: string;
  bundle?: string;
  tier: string;
  root: string;
  realpath: string;
  linked: boolean;
  source?: { repository: string | null; law: string; content: string };
  select?: Record<string, unknown>;
  pages?: number;
  contribution?: Record<string, unknown>;
  provenance?: Record<string, string>;
  shadowed_by?: string | null;
  code?: string;
  reason?: string;
}

let tmp = "";
let serial = 0;
before(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), "ww-bundles-")));
});
after(() => rmSync(tmp, { recursive: true, force: true }));

/** A fresh home and an unrelated working directory: every case scans only what it installs. */
function world(): { home: string; cwd: string } {
  const base = join(tmp, `world-${++serial}`);
  const home = join(base, "home");
  const cwd = join(base, "elsewhere");
  mkdirSync(home, { recursive: true });
  mkdirSync(cwd, { recursive: true });
  // The project tier stops at the top of this repository, under the
  // temporary directory: no scan walks up into the machine's.
  execFileSync("git", ["init", "-q"], { cwd });
  return { home, cwd };
}

function list(cwd: string, home: string, extra: NodeJS.ProcessEnv = {}): Row[] {
  const r = runCli([CLI, "bundles", "list"], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...PINNED_CLOCK, HOME: home, WIKIWRIGHT_SKILL_DIRS: "", ...extra },
  });
  assert.equal(r.status, 0, r.stdout);
  const envelope = JSON.parse(r.stdout) as Envelope;
  return (envelope.data?.["bundles"] ?? []) as Row[];
}

/** A handbook's rendered export installed by a plain copy at `at`. */
function install(handbook: "orchard" | "allotment", at: string, name: string = handbook): string {
  mkdirSync(dirname(at), { recursive: true });
  cpSync(join(HANDBOOKS, handbook, "skills", name), at, { recursive: true });
  return at;
}

describe("bundles list is the scan (docs/cli.md §bundles)", () => {
  it("lists every bundle skill with its identity from the marker, in the order --bundle resolves", () => {
    const { home, cwd } = world();
    const orchard = install("orchard", join(home, ".claude", "skills", "orchard"));
    const pruning = install(
      "orchard",
      join(home, ".agents", "skills", "orchard-pruning"),
      "orchard-pruning",
    );
    const extra = join(tmp, `extra-${serial}`);
    const allotment = install("allotment", join(extra, "allotment"));
    // A directory with no marker is no bundle skill: the engine's own skills sit beside them.
    mkdirSync(join(home, ".claude", "skills", "wikiwright-consume"), { recursive: true });
    const rows = list(cwd, home, { WIKIWRIGHT_SKILL_DIRS: extra });
    assert.deepEqual(
      rows.map((r) => [r.name, r.tier, r.root]),
      [
        ["orchard", "user", orchard],
        ["orchard-pruning", "user", pruning],
        ["allotment", "extra", allotment],
      ],
    );
    const marker = JSON.parse(readFileSync(join(orchard, "config", "export.json"), "utf8")) as {
      source: Row["source"];
    };
    const [first] = rows;
    assert.deepEqual(first, {
      name: "orchard",
      bundle: "orchard",
      tier: "user",
      root: orchard,
      realpath: orchard,
      linked: false,
      source: marker.source,
      select: { kind: "all" },
      pages: 3,
      contribution: { mode: "none" },
      provenance: {},
      shadowed_by: null,
    });
    assert.deepEqual(rows[1]?.select, { kind: "tag", tags: ["pruning"] });
  });

  it("reads markers only: an edited page and a kit that cannot load change nothing it prints", () => {
    const { home, cwd } = world();
    const copy = install("orchard", join(home, ".claude", "skills", "orchard"));
    const before = list(cwd, home);
    appendFileSync(join(copy, "wiki", "pruning-roses.md"), "\nA line added in the copy.\n");
    const engine = join(copy, "config", "engine.json");
    const config = JSON.parse(readFileSync(engine, "utf8")) as Record<string, unknown>;
    writeFileSync(
      engine,
      `${JSON.stringify({ ...config, modules: [{ package: "kit-absent", version: "^1.0.0" }] })}\n`,
    );
    assert.deepEqual(list(cwd, home), before);
  });

  it("what an installer wrote into SKILL.md's frontmatter is the row's provenance, verbatim", () => {
    const { home, cwd } = world();
    const copy = install("orchard", join(home, ".claude", "skills", "orchard"));
    const skill = join(copy, "SKILL.md");
    writeFileSync(
      skill,
      readFileSync(skill, "utf8").replace(
        "---\nname: orchard\n",
        "---\nname: orchard\nsource-repository: https://example.invalid/orchard\nref: v1.4.0\ntree: 0123456789abcdef0123456789abcdef01234567\n",
      ),
    );
    const [row] = list(cwd, home);
    assert.deepEqual(row?.provenance, {
      "source-repository": "https://example.invalid/orchard",
      ref: "v1.4.0",
      tree: "0123456789abcdef0123456789abcdef01234567",
    });
  });

  it("a farther copy of one bundle names the root that shadows it; a link is marked linked", () => {
    const { home, cwd } = world();
    const near = install("orchard", join(home, ".claude", "skills", "orchard"));
    mkdirSync(join(home, ".agents", "skills"), { recursive: true });
    const link = join(home, ".agents", "skills", "orchard");
    symlinkSync(near, link);
    const rows = list(cwd, home);
    assert.deepEqual(
      rows.map((r) => [r.root, r.realpath, r.linked, r.shadowed_by]),
      [
        [near, near, false, null],
        [link, near, true, near],
      ],
    );
  });

  it("two different bundles under one name shadow neither: --bundle refuses them as ambiguous", () => {
    const { home, cwd } = world();
    install("orchard", join(home, ".claude", "skills", "orchard"));
    install("orchard", join(home, ".agents", "skills", "orchard"));
    // Two copies naming no repository, at two real paths: two identities.
    const rows = list(cwd, home);
    assert.deepEqual(
      rows.map((r) => r.shadowed_by),
      [null, null],
    );
  });

  it("a directory whose marker the scan cannot take is a row of its own, with the reason", () => {
    const { home, cwd } = world();
    const renamed = install("orchard", join(home, ".claude", "skills", "orchards"), "orchard");
    const broken = install("allotment", join(home, ".claude", "skills", "allotment"));
    writeFileSync(join(broken, "config", "export.json"), "{ not a marker\n");
    const rows = list(cwd, home);
    assert.deepEqual(
      rows.map((r) => [r.name, r.root, r.code]),
      [
        ["allotment", broken, "export-marker-invalid"],
        ["orchards", renamed, "export-marker-invalid"],
      ],
    );
    assert.match(rows[1]?.reason ?? "", /names the export "orchard", not the directory's name/u);
    assert.match(rows[0]?.reason ?? "", /not JSON/u);
  });

  it("a consumer session lists, and nothing in the list is a page's words", () => {
    const { home, cwd } = world();
    install("orchard", join(home, ".claude", "skills", "orchard"));
    const r = runCli([CLI, "bundles", "list"], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, HOME: home, WIKIWRIGHT_SKILL_DIRS: "", WIKIWRIGHT_ROLE: "consumer" },
    });
    assert.equal(r.status, 0, r.stdout);
    assert.doesNotMatch(r.stdout, /outward-facing bud|How to use this handbook/u);
  });
});

describe("the suite reads no system skill directory of the machine's (docs/cli.md §Environment)", () => {
  it("an inherited WIKIWRIGHT_SYSTEM_SKILL_DIR holding a copy does not reach bundles list under the suite", () => {
    const { home, cwd } = world();
    const system = join(tmp, `system-${serial}`);
    install("orchard", join(system, "orchard"));
    // A process that inherits the variable, then imports the suite's runtime
    // seam as every test file does, and lists what the scan finds.
    const probe = join(tmp, `probe-${serial}.ts`);
    writeFileSync(
      probe,
      [
        `import { runCli } from ${JSON.stringify(join(TEST_DIR, "fixtures", "runtime.ts"))};`,
        `const r = runCli([${JSON.stringify(CLI)}, "bundles", "list"], { encoding: "utf8", env: process.env });`,
        "process.stdout.write(r.stdout);",
        "",
      ].join("\n"),
    );
    const r = runCli([probe], {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        WIKIWRIGHT_SKILL_DIRS: "",
        WIKIWRIGHT_SYSTEM_SKILL_DIR: system,
      },
    });
    assert.equal(r.status, 0, r.stderr);
    const rows = ((JSON.parse(r.stdout) as Envelope).data?.["bundles"] ?? []) as Row[];
    assert.deepEqual(rows, [], "a copy in the inherited system directory was listed");
  });
});

describe("a verb that loads a vault names its target or refuses (docs/cli.md §bundles)", () => {
  it("from a directory that is no vault, with neither --root nor --bundle: registry-not-found", () => {
    const { home, cwd } = world();
    for (const argv of [["search", "pruning"], ["lint"], ["read", "pruning-roses"]]) {
      const r = runCli([CLI, ...argv], {
        cwd,
        encoding: "utf8",
        env: { ...process.env, ...PINNED_CLOCK, HOME: home },
      });
      const envelope = JSON.parse(r.stdout) as Envelope;
      assert.equal(r.status, 3, `${argv[0]}: ${r.stdout}`);
      assert.equal(envelope.error?.code, "registry-not-found");
    }
  });
});
