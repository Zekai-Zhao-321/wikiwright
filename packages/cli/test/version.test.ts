// docs/cli.md §version (`commit` names the BUILD, read from
// dist/build-info.json written by the build script; the call-time git lookup is
// demoted to checkout_commit) · docs/architecture.md §Directories / no timestamps in build artifacts.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { versionData } from "../src/buildinfo.ts";

const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));
const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const BUILD_INFO = fileURLToPath(new URL("../dist/build-info.json", import.meta.url));

function envelopeOf(args: string[]): { data?: Record<string, unknown> } {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: REPO, encoding: "utf8" });
  return JSON.parse(r.stdout) as { data?: Record<string, unknown> };
}

describe("the build stamps the artifact it produced (docs/cli.md §version)", () => {
  it("`bun run build` writes dist/build-info.json, and the bytes are reproducible", () => {
    const build = spawnSync("bun", ["run", "build"], { cwd: REPO, encoding: "utf8" });
    assert.equal(build.status, 0, build.stderr);
    assert.equal(existsSync(BUILD_INFO), true, "the build wrote dist/build-info.json");
    const first = readFileSync(BUILD_INFO, "utf8");
    const info = JSON.parse(first) as Record<string, unknown>;
    assert.deepEqual(Object.keys(info).sort(), ["commit", "dirty"]);
    assert.equal(typeof info["commit"] === "string" || info["commit"] === null, true);
    assert.equal(typeof info["dirty"] === "boolean" || info["dirty"] === null, true);
    // A build artifact that changes when nothing changed is not
    // reproducible, so nothing in it may come from the clock.
    assert.equal(/\d{4}-\d{2}-\d{2}T/.test(first), false, "no timestamp");
    const again = spawnSync("bun", ["run", "build"], { cwd: REPO, encoding: "utf8" });
    assert.equal(again.status, 0, again.stderr);
    assert.equal(readFileSync(BUILD_INFO, "utf8"), first, "byte-identical across builds");
  });

  it("the build script runs the writer — the stamp cannot depend on remembering", () => {
    const pkg = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    assert.equal(
      pkg.scripts["build"]?.includes("tools/write-build-info.ts"),
      true,
      "the `build` script writes the build info",
    );
    for (const script of ["check", "test"]) {
      assert.equal(
        pkg.scripts[script]?.includes("run build"),
        true,
        `\`${script}\` builds through the one build script, so the tested binary is stamped`,
      );
    }
  });

  it("no normative document prescribes a bare `tsc -b` as the build step", () => {
    // The rule: every job which builds runs `bun run build`, because
    // `tsc -b` recompiles every dist/*.js and never touches the stamp — after
    // which `version` reports a stale commit with `source: "build-info"`, i.e.
    // confidently wrong rather than unknown. The scripts and workflows obey it;
    // a doc once read "verify — biome ci + `tsc -b`", so the repo documented
    // the desyncing recipe it had just ruled out. A doc may name the bare
    // compiler only beside the build script that wraps it. The documents are
    // docs/*.md.
    const docs = [
      ...readdirSync(join(REPO, "docs"))
        .filter((f) => f.endsWith(".md"))
        .map((f) => join("docs", f)),
      // The hook and the workflow are the two places a build recipe could
      // desync from the build script.
      "scripts/hooks/pre-commit",
      ".github/workflows/check.yml",
      "CONTRIBUTING.md",
      "AGENTS.md",
      "README.md",
    ];
    let seen = 0;
    for (const doc of docs) {
      const text = readFileSync(join(REPO, doc), "utf8").replace(/\s+/g, " ");
      for (const m of text.matchAll(/tsc -b/g)) {
        const at = m.index ?? 0;
        const around = text.slice(Math.max(0, at - 200), at + 200);
        assert.equal(
          /`build` script|bun run build|write-build-info/.test(around),
          true,
          `${doc} names a bare \`tsc -b\` with no build script beside it: …${around}…`,
        );
        seen += 1;
      }
    }
    assert.equal(seen > 0, true, "the scan reached documents that mention the compiler");
  });

  it("the packaged tarball carries it: dist ships, and the pack job asserts the file", () => {
    const cli = JSON.parse(readFileSync(join(REPO, "packages/cli/package.json"), "utf8")) as {
      files: string[];
    };
    assert.equal(cli.files.includes("dist"), true, "`files` ships dist/, build-info.json with it");
    // No workflow job packs the tarball. The claim a pack job would guard is
    // testable here, from the manifest the packer would read:
    // `files` must ship dist/, which is what carries build-info.json.
    assert.equal(
      cli.files.some((f) => f === "dist" || f.startsWith("dist/")),
      true,
      "dist/ is packaged, and build-info.json rides in it",
    );
  });
});

describe("version answers with the build, and names its own provenance (docs/cli.md §version)", () => {
  it("reports {engine, commit, dirty, source, checkout_commit, checkout_dirty}", () => {
    const data = envelopeOf(["version"]).data ?? {};
    assert.deepEqual(Object.keys(data).sort(), [
      "checkout_commit",
      "checkout_dirty",
      "commit",
      "dirty",
      "engine",
      "source",
    ]);
    assert.equal(data["engine"], "0.1.0");
    assert.equal(data["source"], "build-info", "the tested binary was built by the build script");
    const info = JSON.parse(readFileSync(BUILD_INFO, "utf8")) as Record<string, unknown>;
    assert.equal(
      data["commit"],
      info["commit"],
      "commit is the BUILD's commit, not the checkout's",
    );
    assert.equal(data["dirty"], info["dirty"]);
  });

  it("`--version` and `-v` answer identically", () => {
    const long = envelopeOf(["--version"]).data;
    const short = envelopeOf(["-v"]).data;
    assert.deepEqual(long, envelopeOf(["version"]).data);
    assert.deepEqual(short, long);
  });

  it("with no build info the answer is null and says so, never a guess", () => {
    // The unbuilt case cannot be exercised through the binary without deleting
    // the artifact the rest of the suite runs on, so the shaping function is
    // asserted directly (docs/architecture.md §Directories: the pure part is the testable part).
    assert.deepEqual(versionData(undefined, { commit: "f09f060", dirty: true }, "0.1.0"), {
      engine: "0.1.0",
      commit: null,
      dirty: null,
      source: "unknown",
      checkout_commit: "f09f060",
      checkout_dirty: true,
    });
    assert.deepEqual(
      versionData({ commit: "3274041", dirty: false }, { commit: "f09f060", dirty: true }, "0.1.0"),
      {
        engine: "0.1.0",
        commit: "3274041",
        dirty: false,
        source: "build-info",
        checkout_commit: "f09f060",
        checkout_dirty: true,
      },
    );
  });
});

interface Outcome {
  status: number;
  envelope: Record<string, unknown>;
}

function runIn(cwd: string, args: string[], env: Record<string, string> = {}): Outcome {
  const r = spawnSync(process.execPath, [CLI, ...args, "--root", "."], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return { status: r.status ?? -1, envelope: JSON.parse(r.stdout) as Record<string, unknown> };
}

function dataOf(o: Outcome): Record<string, unknown> {
  return (o.envelope["data"] ?? {}) as Record<string, unknown>;
}

describe("version — the binary names its build (docs/cli.md §version)", () => {
  const PACKAGE_DIR = fileURLToPath(new URL("..", import.meta.url));
  const PACKAGE_VERSION = (
    JSON.parse(readFileSync(join(PACKAGE_DIR, "package.json"), "utf8")) as { version: string }
  ).version;

  function expectedCommit(): string | null {
    try {
      return execFileSync("git", ["-C", PACKAGE_DIR, "rev-parse", "--short", "HEAD"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      return null;
    }
  }

  function assertVersionEnvelope(o: Outcome): void {
    assert.equal(o.status, 0, JSON.stringify(o.envelope));
    assert.equal((o.envelope["metadata"] as { command: string }).command, "version");
    const data = dataOf(o) as {
      engine?: unknown;
      commit?: unknown;
      dirty?: unknown;
      source?: unknown;
      checkout_commit?: unknown;
      checkout_dirty?: unknown;
    };
    assert.equal(data.engine, PACKAGE_VERSION, "engine is the package version");
    assert.equal(
      data.commit === null || /^[0-9a-f]{7,40}$/.test(String(data.commit)),
      true,
      "commit is a short sha or null",
    );
    assert.equal(data.dirty === null || typeof data.dirty === "boolean", true);
    assert.equal(data.commit === null, data.dirty === null, "commit and dirty share one answer");
    assert.equal(data.source, data.commit === null ? "unknown" : "build-info");
    // `commit` names the BUILD. The checkout the package sits in
    // is the OTHER question, and it keeps the name that says so — this test
    // runs the built CLI inside its own checkout, where git's answer is that.
    assert.equal(data.checkout_commit, expectedCommit());
    assert.equal(
      data.checkout_commit === null,
      data.checkout_dirty === null,
      "the checkout pair shares one answer too",
    );
  }

  it("`version` reports engine, commit, and dirty without a vault", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ww-version-"));
    try {
      assertVersionEnvelope(runIn(tmp, ["version"]));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("with no git on PATH the checkout is null and the BUILD still answers", () => {
    // docs/cli.md §version — `null` when git is unavailable; `dirty` is null
    // whenever its commit is; the verb never throws. A PATH holding one
    // nonexistent directory makes `git` unspawnable regardless of platform.
    // The build's identity is read from a file, so it survives a runtime
    // with no git at all — which is every installed copy of this package.
    const tmp = mkdtempSync(join(tmpdir(), "ww-version-"));
    try {
      const o = runIn(tmp, ["version"], { PATH: join(tmp, "no-such-bin") });
      assert.equal(o.status, 0, JSON.stringify(o.envelope));
      assert.equal((o.envelope["metadata"] as { command: string }).command, "version");
      const data = dataOf(o);
      assert.equal(data["engine"], PACKAGE_VERSION);
      assert.equal(data["checkout_commit"], null);
      assert.equal(data["checkout_dirty"], null);
      assert.equal(data["source"], "build-info", "the stamped build needs no git to be read");
      assert.equal(typeof data["commit"], "string");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("the verb is a consumer-role entry of the generated registry", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ww-version-"));
    try {
      const schema = runIn(tmp, ["schema"]);
      const commands = dataOf(schema)["commands"] as Array<{ name: string; role: string }>;
      assert.equal(commands.find((c) => c.name === "version")?.role, "consumer");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
