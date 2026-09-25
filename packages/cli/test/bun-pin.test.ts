// The v2 contracts, section 0: Bun only. `.bun-version` names the Bun this
// repository is built and tested with, and every package.json's
// `engines.bun` pins that version exactly; no package names a Node engine,
// and nothing the repository runs — a package script, a tool, the CLI
// reference's renderer, a hook, a workflow, a test — spawns `node`.
import { describe, expect, it } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { runCli } from "./fixtures/runtime.ts";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));

/**
 * Where a spawn of `node` would hide: the tools, the CLI reference's
 * renderer, the hooks (the repository's and the plugin's), the workflows,
 * and the tests. Built output and installed packages are not the
 * repository's own.
 */
const RUNNABLE = [
  "tools",
  "docs",
  "scripts",
  ".github",
  "packages/cli/hooks",
  "packages/cli/test",
  "packages/core/test",
  "test",
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

/** A TypeScript or JavaScript file names `node` as a command: a string literal of it, or a shebang. */
const SCRIPT_SPAWN = /(["'`])node\1|^#!.*\bnode\b/mu;
/** A shell script, a workflow or a hook definition runs `node` as a command word. */
const SHELL_SPAWN = /(^|[\s;&|(`"'])node(\s|$)|^#!.*\bnode\b/mu;
const PACKAGES = ["package.json", "packages/core/package.json", "packages/cli/package.json"];

describe("one pinned Bun", () => {
  const pinned = readFileSync(`${REPO}.bun-version`, "utf8").trim();

  it(".bun-version names the Bun running the suite", () => {
    expect(pinned).toMatch(/^\d+\.\d+\.\d+$/u);
    expect(process.versions["bun"]).toBe(pinned);
  });

  it("every package pins engines.bun to it exactly and names no Node engine", () => {
    for (const path of PACKAGES) {
      const pkg = JSON.parse(readFileSync(`${REPO}${path}`, "utf8")) as {
        engines?: Record<string, string>;
        scripts?: Record<string, string>;
      };
      expect(pkg.engines).toEqual({ bun: pinned });
      for (const script of Object.values(pkg.scripts ?? {})) {
        expect(script).not.toMatch(/(^|[\s;&|])node\s/u);
      }
    }
  });

  it("no tool, renderer, hook, workflow or test spawns node", () => {
    const offenders: string[] = [];
    for (const dir of RUNNABLE) {
      for (const file of walk(join(REPO, dir))) {
        const name = relative(REPO, file);
        if (name.endsWith(".md")) continue;
        const text = readFileSync(file, "utf8");
        const pattern = /\.(ts|js|mjs|cjs)$/u.test(name) ? SCRIPT_SPAWN : SHELL_SPAWN;
        if (pattern.test(text)) offenders.push(name);
      }
    }
    // This file names the patterns it refuses, and is the one exemption.
    expect(offenders.filter((f) => !f.endsWith("bun-pin.test.ts"))).toEqual([]);
  });

  it("the CLI reference renders with no node on PATH", () => {
    // docs/cli.md's verb block has one generator; it must run where only Bun
    // is installed, and the block it renders must be the committed one.
    const empty = mkdtempSync(join(tmpdir(), "ww-no-node-"));
    try {
      const r = runCli([join(REPO, "docs", "render-cli.ts"), "--check"], {
        cwd: REPO,
        env: { ...process.env, PATH: empty },
        encoding: "utf8",
      });
      expect(r.stderr).toBe("");
      expect(r.status).toBe(0);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
