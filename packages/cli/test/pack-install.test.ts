// docs/architecture.md §The gate (the pack job died with CI and its claims went
// unenforced) · docs/architecture.md §The invariants · docs/extending.md §Declaring a module · docs/architecture.md §Directories
// (the shipped artifact is node-builtins-only).
//
// The engine, as a consumer installs it. Everything else in this suite runs the
// CLI from source in the monorepo, where `@wikiwright/core` resolves by
// workspace link and `dist/` may be stale in ways nobody notices. This one packs
// both packages, installs the tarballs into a throwaway consumer, and drives the
// installed binary — under NODE, because the shipped artifact is node's.
//
// It also packs the conformance module and installs it as a TARBALL, which is
// the third of the three local shapes `docs/extending.md §Declaring a module` names (workspace link,
// `file:` dependency, packed tarball) and the one with a real installation
// boundary: the bytes are copied, not linked, so nothing resolves back into this
// repository by accident.
//
// Nothing here publishes and nothing reaches a registry for a wikiwright-owned
// package. The tarballs are built locally and installed by path.

import { afterAll, describe, it } from "bun:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PINNED_CLOCK } from "./fixtures/clock.ts";
import { runCli } from "./fixtures/runtime.ts";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const CONFORMANCE = join(REPO, "fixtures", "conformance");

/** Packing is slow; one workspace serves every case in this file. */
let WORKSPACE: string | undefined;
let CONSUMER: string | undefined;
let CLI: string | undefined;

function sh(
  command: string,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return execFileSync(command, [...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env,
  });
}

/**
 * `bun install` under a package cache of this file's own, under its temporary
 * workspace: the packed core's dependencies come from the registry, and they
 * land in this cache rather than the caller's.
 */
function install(cwd: string): void {
  sh("bun", ["install"], cwd, {
    ...process.env,
    BUN_INSTALL_CACHE_DIR: join(WORKSPACE ?? cwd, ".bun-install-cache"),
  });
}

function tarballIn(dir: string, prefix: string): string {
  const found = readdirSync(dir).find((f) => f.startsWith(prefix) && f.endsWith(".tgz"));
  assert.notEqual(found, undefined, `no ${prefix}*.tgz in ${dir}`);
  return join(dir, found ?? "");
}

/**
 * Pack the engine and the conformance module and install the engine into a
 * throwaway consumer, once for the file, on the first case that needs it. A
 * case rather than a hook does it, because a case can be given the time the
 * install takes: the install fetches the packed core's dependencies into an
 * empty cache, and a hook runs under the runner's default limit.
 */
function packAndInstall(): void {
  if (CLI !== undefined) return;
  const workspace = mkdtempSync(join(tmpdir(), "ww-pack-"));
  WORKSPACE = workspace;
  // `bun run build` has already run in the gate; pack what it produced.
  sh("bun", ["pm", "pack", "--destination", workspace], join(REPO, "packages", "core"));
  sh("bun", ["pm", "pack", "--destination", workspace], join(REPO, "packages", "cli"));
  sh("bun", ["pm", "pack", "--destination", workspace], join(CONFORMANCE, "module-fixture"));

  const consumer = join(workspace, "consumer");
  mkdirSync(consumer, { recursive: true });
  // `wikiwright` depends on `@wikiwright/core` as `workspace:*`, which cannot
  // resolve outside this monorepo. A consumer installing the tarballs overrides
  // it with the packed core — the same thing a registry publish would do by
  // rewriting the range, expressed locally so nothing has to be published.
  writeFileSync(
    join(consumer, "package.json"),
    `${JSON.stringify(
      {
        name: "wikiwright-pack-consumer",
        private: true,
        version: "0.0.0",
        dependencies: { wikiwright: `file:${tarballIn(workspace, "wikiwright-0")}` },
        overrides: { "@wikiwright/core": `file:${tarballIn(workspace, "wikiwright-core-")}` },
      },
      null,
      2,
    )}\n`,
  );
  install(consumer);
  CONSUMER = consumer;
  CLI = join(consumer, "node_modules", "wikiwright", "dist", "main.js");
}

/** Each case may be the one that packs and installs: its timeout, in milliseconds. */
const INSTALLS = 60_000;

afterAll(() => {
  if (WORKSPACE !== undefined) rmSync(WORKSPACE, { recursive: true, force: true });
});

interface Envelope {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: Record<string, unknown>;
}

/** Drive the INSTALLED binary with node, tolerating the engine's own exit codes. */
function run(argv: readonly string[], cwd: string, env: Record<string, string> = {}): Envelope {
  assert.notEqual(CLI, undefined, "the packed CLI was installed");
  try {
    const out = runCli([CLI ?? "", ...argv], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, ...PINNED_CLOCK, ...env },
    });
    if (out.status !== 0) throw Object.assign(new Error(out.stderr), { stdout: out.stdout });
    return JSON.parse(out.stdout) as Envelope;
  } catch (error) {
    const e = error as { stdout?: string };
    assert.equal(typeof e.stdout, "string", `the packed CLI printed no envelope: ${String(error)}`);
    return JSON.parse(e.stdout ?? "{}") as Envelope;
  }
}

describe("the packed engine runs as a consumer installs it (docs/architecture.md §The gate)", () => {
  it(
    "the installed binary answers, and names the build it was cut from",
    () => {
      packAndInstall();
      const envelope = run(["version"], CONSUMER ?? REPO);
      assert.equal(envelope.ok, true, JSON.stringify(envelope));
      assert.equal(typeof envelope.data?.["engine"], "string");
    },
    INSTALLS,
  );

  it(
    "the tarball carries dist/, the skills, the starters and the plugin, and no source",
    () => {
      packAndInstall();
      const installed = join(CONSUMER ?? "", "node_modules", "wikiwright");
      assert.equal(existsSync(join(installed, "dist", "main.js")), true, "the binary");
      assert.equal(existsSync(join(installed, "dist", "bin.js")), true, "the executable");
      assert.equal(existsSync(join(installed, "skills")), true, "the shipped skills");
      assert.equal(existsSync(join(installed, "constitutions")), true, "the starters");
      // docs/cli.md §The plugin and its hooks: the package root is the plugin root.
      assert.equal(
        existsSync(join(installed, ".claude-plugin", "plugin.json")),
        true,
        "the plugin manifest",
      );
      for (const file of ["hooks.json", "session-start.mjs", "post-edit.mjs"]) {
        assert.equal(existsSync(join(installed, "hooks", file)), true, `hooks/${file}`);
      }
      // `files` is a closed list; a package that shipped `src/` would double the
      // artifact and give a consumer two answers to "what is running".
      assert.equal(existsSync(join(installed, "src")), false, "no source in the artifact");
    },
    INSTALLS,
  );

  it(
    "the tarball holds no output of a deleted source: the build removes dist/ first",
    () => {
      packAndInstall();
      const dist = join(CONSUMER ?? "", "node_modules", "wikiwright", "dist");
      for (const gone of ["trust.js", "connections.js", "storelock.js", "verbs/trust.js"]) {
        assert.equal(existsSync(join(dist, gone)), false, `dist/${gone} was packed`);
      }
      // Every emitted module has its source: nothing in the artifact outlived it.
      const src = join(REPO, "packages", "cli", "src");
      for (const entry of readdirSync(dist, { recursive: true, encoding: "utf8" })) {
        if (!entry.endsWith(".js")) continue;
        assert.equal(
          existsSync(join(src, entry.replace(/\.js$/u, ".ts"))),
          true,
          `dist/${entry} has no source`,
        );
      }
    },
    INSTALLS,
  );

  it(
    "the installed `wikiwright` is bin.js, a Bun script: it answers as main.js does",
    () => {
      packAndInstall();
      // POSIX-only: the .bin entry is a link here and a shim on Windows.
      if (process.platform === "win32") return;
      const consumer = CONSUMER ?? "";
      const link = realpathSync(join(consumer, "node_modules", ".bin", "wikiwright"));
      assert.equal(link.endsWith(join("dist", "bin.js")), true, link);
      assert.equal(
        readFileSync(link, "utf8").split("\n")[0],
        "#!/usr/bin/env bun",
        "the executable names its runtime",
      );
      const env = { ...process.env, ...PINNED_CLOCK };
      const fromBin = runCli([link, "version"], { cwd: consumer, encoding: "utf8", env });
      const fromMain = runCli([CLI ?? "", "version"], { cwd: consumer, encoding: "utf8", env });
      assert.equal(fromBin.status, 0, fromBin.stderr);
      assert.equal(fromBin.stdout, fromMain.stdout, "the executable answers as the engine does");
    },
    INSTALLS,
  );

  it(
    "the packed engine judges a bundle, from a directory outside this repository",
    () => {
      packAndInstall();
      const bundle = join(WORKSPACE ?? "", "minimal");
      cpSync(join(REPO, "fixtures", "minimal-vault"), bundle, { recursive: true });
      const envelope = run(["lint", "--all", "--root", bundle], CONSUMER ?? REPO);
      // The minimal vault ships with a known verdict (`docs/architecture.md §The invariants`); what
      // matters here is that the PACKED engine produces one at all.
      assert.equal(typeof envelope.data?.["summary"], "object", JSON.stringify(envelope));
    },
    INSTALLS,
  );
});

describe("a module installs as a tarball, and governs (docs/extending.md §Declaring a module)", () => {
  it(
    "the packed module resolves, pins, and is judged with — with no link home",
    () => {
      packAndInstall();
      const workspace = WORKSPACE ?? "";
      const bundle = join(workspace, "tarball-bundle");
      // Copy the PAGES and the CONFIG only. A `file:` install links each of the
      // module's files back into this repository at an absolute path, and a copy
      // that carried those links would let this case write through to the shipped
      // fixture — which is exactly what happened the first time.
      cpSync(join(CONFORMANCE, "bundle-a", "wiki"), join(bundle, "wiki"), { recursive: true });
      cpSync(join(CONFORMANCE, "bundle-a", "config"), join(bundle, "config"), { recursive: true });
      // The third local shape: a packed tarball, whose bytes are COPIED. A
      // workspace link or a `file:` directory could resolve back into this
      // repository; this cannot.
      writeFileSync(
        join(bundle, "package.json"),
        `${JSON.stringify(
          {
            name: "wikiwright-tarball-bundle",
            private: true,
            version: "0.0.0",
            dependencies: {
              "@wikiwright-fixture/probe": `file:${tarballIn(workspace, "wikiwright-fixture-probe-")}`,
            },
          },
          null,
          2,
        )}\n`,
      );
      install(bundle);

      // Installed is loaded: the module is proved by its load, with no other step.
      const listed = run(["modules", "list", "--root", bundle], CONSUMER ?? REPO);
      const loaded = (listed.data?.["loaded"] ?? []) as Record<string, unknown>[];
      assert.equal(loaded.length, 1, JSON.stringify(listed));
      assert.equal(loaded[0]?.["version"], "1.0.0");

      const linted = run(["lint", "--all", "--root", bundle], CONSUMER ?? REPO);
      assert.equal(linted.ok, true, JSON.stringify(linted));
      const found = (linted.data?.["findings"] ?? []) as { ruleId: string }[];
      assert.equal(
        found.some((f) => f.ruleId === "@wikiwright-fixture/probe/measured"),
        true,
        "the tarball-installed module governed the vault",
      );
    },
    INSTALLS,
  );

  it(
    "the generated brief carries the module's own skill fragment",
    () => {
      packAndInstall();
      const bundle = join(WORKSPACE ?? "", "tarball-bundle");
      const envelope = run(["brief", "--root", bundle], CONSUMER ?? REPO);
      assert.equal(envelope.ok, true, JSON.stringify(envelope));
      const text = String(envelope.data?.["brief"] ?? "");
      assert.match(text, /## What the loaded modules add/u);
      assert.match(text, /### Measures \(`@wikiwright-fixture\/probe`\)/u);
      assert.match(text, /A `Measures` item is/u);
    },
    INSTALLS,
  );
});
