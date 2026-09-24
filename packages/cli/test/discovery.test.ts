// docs/cli.md §bundles: `--bundle <name>` finds a bundle skill by its name in
// the skill directories — the project's, from the working directory up to the
// top of its repository, then the user's, then those WIKIWRIGHT_SKILL_DIRS
// names — and nothing registers it. Every candidate is inspected: one identity
// resolves to the nearest, the rest shadowed; two identities are ambiguous; a
// directory reached twice is one candidate; a copy that names no repository is
// itself alone.
//
// Every scan here runs with HOME under os.tmpdir(), and the project tier
// inside a `git init` repository there: no test reads a real skill directory
// of the developer's.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
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
import { COMMANDS } from "../src/commands.ts";
import { MACHINE_LOCAL_WRITERS } from "../src/connections.ts";
import { PINNED_CLOCK } from "./fixtures/clock.ts";
import { CLI_RUNTIME } from "./fixtures/runtime.ts";

const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));

interface Envelope {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: { code?: string; type?: string; details?: Record<string, unknown> };
  metadata: { bundle?: Record<string, unknown> };
}

let tmp = "";
let serial = 0;

before(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), "ww-discovery-")));
});
after(() => rmSync(tmp, { recursive: true, force: true }));

function write(root: string, files: Record<string, string>): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
}

const note = (title: string, body: string): string =>
  `---\ntype: note\ntitle: ${title}\ndescription: ${title}, briefly.\ntags: [compost]\n---\n\n# ${title}\n\n${body}\n`;

/**
 * A gardening bundle with one `all` export named `garden`, rendered; its
 * `skills/garden` is what a host installs. `repository` names where it is
 * installed from, or nothing.
 */
function rendered(repository: string | undefined, body = "Turn it weekly."): string {
  const root = join(tmp, `source-${++serial}`, "garden");
  write(root, {
    "config/constitution.json": `${JSON.stringify({
      schema: "wikiwright/constitution",
      schema_version: 3,
      vocabularies: {
        tags: { mode: "registered", entries: { compost: { description: "Compost." } } },
      },
      types: { note: { extends: "concept", description: "A gardening note." } },
    })}\n`,
    "config/engine.json": `${JSON.stringify({
      content_roots: ["wiki"],
      exports: [
        {
          name: "garden",
          select: { kind: "all" },
          ...(repository === undefined ? {} : { repository }),
          contribution: { mode: "none" },
        },
      ],
    })}\n`,
    "wiki/turning-compost.md": note("Turning compost", body),
  });
  const r = spawnSync(CLI_RUNTIME, [CLI, "check", "--write", "--root", root], {
    encoding: "utf8",
    env: { ...process.env, ...PINNED_CLOCK },
  });
  assert.equal(r.status, 0, r.stdout);
  return join(root, "skills", "garden");
}

/** A fake home, and a project repository with a working directory one level down. */
function world(): { home: string; project: string; cwd: string } {
  const base = join(tmp, `world-${++serial}`);
  const home = join(base, "home");
  const project = join(base, "project");
  const cwd = join(project, "sub");
  mkdirSync(home, { recursive: true });
  mkdirSync(cwd, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: project });
  return { home, project, cwd };
}

function install(copy: string, at: string): string {
  mkdirSync(dirname(at), { recursive: true });
  cpSync(copy, at, { recursive: true });
  return at;
}

function run(
  cwd: string,
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
): { status: number; envelope: Envelope } {
  const r = spawnSync(CLI_RUNTIME, [CLI, ...argv], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...PINNED_CLOCK, WIKIWRIGHT_SKILL_DIRS: "", ...env },
  });
  assert.equal(typeof r.stdout, "string", `the CLI printed no envelope: ${r.stderr}`);
  return { status: r.status ?? -1, envelope: JSON.parse(r.stdout) as Envelope };
}

const REPOSITORY = "https://example.invalid/garden";

describe("--bundle resolves by scanning the skill directories (docs/cli.md §bundles)", () => {
  it("the nearest copy of one bundle wins, and the envelope lists the ones it shadowed", () => {
    const copy = rendered(REPOSITORY);
    const { home, project, cwd } = world();
    const extra = join(tmp, `extra-${serial}`);
    const nearest = install(copy, join(cwd, ".agents", "skills", "garden"));
    const top = install(copy, join(project, ".claude", "skills", "garden"));
    const user = install(copy, join(home, ".claude", "skills", "garden"));
    const named = install(copy, join(extra, "garden"));
    const r = run(cwd, ["search", "compost", "--bundle", "garden"], {
      HOME: home,
      WIKIWRIGHT_SKILL_DIRS: extra,
    });
    assert.equal(r.status, 0, JSON.stringify(r.envelope));
    assert.equal(r.envelope.metadata.bundle?.["root"], realpathSync(nearest));
    assert.deepEqual(r.envelope.metadata.bundle?.["shadowed"], [
      { root: top, tier: "project" },
      { root: user, tier: "user" },
      { root: named, tier: "extra" },
    ]);
  });

  it("the project tier stops at the top of the repository; the user's comes next", () => {
    const copy = rendered(REPOSITORY);
    const { home, project, cwd } = world();
    // Above the repository: never reached.
    install(copy, join(dirname(project), ".claude", "skills", "garden"));
    const user = install(copy, join(home, ".agents", "skills", "garden"));
    const r = run(cwd, ["search", "compost", "--bundle", "garden"], { HOME: home });
    assert.equal(r.status, 0, JSON.stringify(r.envelope));
    assert.equal(r.envelope.metadata.bundle?.["root"], realpathSync(user));
    assert.equal(r.envelope.metadata.bundle?.["shadowed"], undefined);
  });

  it("two different bundles under one name are bundle-ambiguous, every candidate named", () => {
    const { home, cwd } = world();
    const first = install(rendered(REPOSITORY), join(home, ".claude", "skills", "garden"));
    const second = install(
      rendered("https://example.invalid/another-garden"),
      join(home, ".agents", "skills", "garden"),
    );
    const r = run(cwd, ["search", "compost", "--bundle", "garden"], { HOME: home });
    assert.equal(r.status, 2, JSON.stringify(r.envelope));
    assert.equal(r.envelope.error?.type, "usage");
    assert.equal(r.envelope.error?.code, "bundle-ambiguous");
    assert.deepEqual(r.envelope.error?.details?.["candidates"], [
      { root: first, tier: "user", repository: REPOSITORY },
      { root: second, tier: "user", repository: "https://example.invalid/another-garden" },
    ]);
  });

  it("a copy that names no repository is itself alone: two such copies are ambiguous", () => {
    const { home, cwd } = world();
    const copy = rendered(undefined);
    install(copy, join(home, ".claude", "skills", "garden"));
    install(copy, join(home, ".agents", "skills", "garden"));
    const r = run(cwd, ["search", "compost", "--bundle", "garden"], { HOME: home });
    assert.equal(r.envelope.error?.code, "bundle-ambiguous", JSON.stringify(r.envelope));
  });

  it("one directory reached twice is one candidate, whatever it names", () => {
    const { home, cwd } = world();
    const real = install(rendered(undefined), join(home, ".claude", "skills", "garden"));
    mkdirSync(join(home, ".agents", "skills"), { recursive: true });
    symlinkSync(real, join(home, ".agents", "skills", "garden"));
    const r = run(cwd, ["search", "compost", "--bundle", "garden"], { HOME: home });
    assert.equal(r.status, 0, JSON.stringify(r.envelope));
    assert.equal(r.envelope.metadata.bundle?.["root"], realpathSync(real));
    assert.equal(r.envelope.metadata.bundle?.["shadowed"], undefined);
  });

  it("a name outside the skill grammar is refused before anything is read", () => {
    const { home, cwd } = world();
    const r = run(cwd, ["search", "compost", "--bundle", "Garden_Notes"], { HOME: home });
    assert.equal(r.status, 2, JSON.stringify(r.envelope));
    assert.equal(r.envelope.error?.code, "bundle-name-invalid");
  });

  it("a name nothing answers lists where it looked and what it saw; a marker it cannot take is skipped", () => {
    const { home, project, cwd } = world();
    install(rendered(REPOSITORY), join(home, ".claude", "skills", "garden"));
    // Installed under another name than its marker's: not a candidate for either.
    const renamed = install(rendered(REPOSITORY), join(home, ".claude", "skills", "gardens"));
    const r = run(cwd, ["search", "compost", "--bundle", "gardens"], { HOME: home });
    assert.equal(r.status, 3, JSON.stringify(r.envelope));
    assert.equal(r.envelope.error?.code, "bundle-not-found");
    const details = r.envelope.error?.details ?? {};
    assert.deepEqual((details["searched"] as string[]).slice(0, 4), [
      join(cwd, ".claude", "skills"),
      join(cwd, ".agents", "skills"),
      join(project, ".claude", "skills"),
      join(project, ".agents", "skills"),
    ]);
    assert.deepEqual((details["searched"] as string[]).slice(4, 6), [
      join(home, ".claude", "skills"),
      join(home, ".agents", "skills"),
    ]);
    assert.deepEqual(details["names"], ["garden"]);
    const [skipped] = details["skipped"] as { root: string; tier: string; reason: string }[];
    assert.equal(skipped?.root, renamed);
    assert.match(
      skipped?.reason ?? "",
      /names the export "garden", not the directory's name "gardens"/u,
    );
  });

  it("a found copy is read only: a writing verb is refused before it runs", () => {
    const { home, cwd } = world();
    const copy = install(rendered(REPOSITORY), join(home, ".claude", "skills", "garden"));
    const before = readFileSync(join(copy, "wiki", "turning-compost.md"), "utf8");
    for (const argv of [
      ["new", "note", "Mulching", "--dest", "wiki/mulching.md"],
      ["new", "note", "Mulching", "--dest", "wiki/mulching.md", "--dry-run"],
      ["check", "--write"],
    ]) {
      const r = run(cwd, [...argv, "--bundle", "garden"], { HOME: home });
      assert.equal(r.status, 2, `${argv.join(" ")}: ${JSON.stringify(r.envelope)}`);
      assert.equal(r.envelope.error?.code, "bundle-readonly");
    }
    assert.equal(readFileSync(join(copy, "wiki", "turning-compost.md"), "utf8"), before);
    // Every writing verb, but the one whose write is this machine's registry.
    for (const spec of COMMANDS.filter((c) => c.writes)) {
      const lead = spec.subcommands === undefined ? [] : [spec.subcommands[0] ?? ""];
      const r = run(cwd, [spec.name, ...lead, "--bundle", "garden"], { HOME: home });
      if (MACHINE_LOCAL_WRITERS.has(spec.name)) {
        assert.notEqual(r.envelope.error?.code, "bundle-readonly", spec.name);
      } else {
        assert.equal(
          r.envelope.error?.code,
          "bundle-readonly",
          `${spec.name}: ${JSON.stringify(r.envelope)}`,
        );
      }
    }
    const one = run(cwd, ["search", "compost", "--bundle", "garden", "--root", copy], {
      HOME: home,
    });
    assert.equal(one.envelope.error?.code, "one-target");
  });
});
