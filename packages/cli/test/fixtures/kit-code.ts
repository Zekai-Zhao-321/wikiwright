// docs/extending.md §The code kit · docs/extending.md §Trust
//
// The code kit, installed and granted into a bundle under os.tmpdir(): what
// every test that judges a bundle over `@wikiwright/kit-code` shares. The
// shipped tree is never installed into and never granted from a test — a grant
// is machine-local, and a test that wrote one into the developer's store would
// leave state the suite did not create.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PINNED_CLOCK } from "./clock.ts";

export const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
export const DIST_CLI = join(REPO, "packages", "cli", "dist", "main.js");
export const KIT_CODE = join(REPO, "packages", "kit-code");
export const KIT_PACKAGE = "@wikiwright/kit-code";

/** The trust store a bundle's tests own: beside the bundle, never the developer's. */
export function trustFileOf(root: string): string {
  return join(root, ".wikiwright-trust.json");
}

/** The environment a spawned verb over a kit bundle runs under: the pinned clock and the bundle's own trust store. */
export function kitEnv(root: string): NodeJS.ProcessEnv {
  return { ...process.env, ...PINNED_CLOCK, WIKIWRIGHT_TRUST_FILE: trustFileOf(root) };
}

/** Replace every symlink under `dir` with the bytes it points at, so an edit in the copy never writes through. */
function materialize(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true, encoding: "utf8" })) {
    const path = join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      const bytes = readFileSync(path);
      rmSync(path, { force: true });
      writeFileSync(path, bytes);
      continue;
    }
    if (entry.isDirectory()) materialize(path);
  }
}

/**
 * Install the kit into a bundle as a `file:` dependency on the shipped
 * package, offline. The bundle's package.json is written or rewritten to name
 * the kit by absolute path — the kit is on no registry, and the spelling a
 * starter ships is a placeholder path for the user to edit.
 */
export function installKit(root: string): void {
  const manifest = join(root, "package.json");
  const pkg = existsSync(manifest)
    ? (JSON.parse(readFileSync(manifest, "utf8")) as {
        dependencies?: Record<string, string>;
        [key: string]: unknown;
      })
    : { name: basename(root), private: true, version: "0.0.0" };
  pkg.dependencies = { ...(pkg.dependencies ?? {}), [KIT_PACKAGE]: `file:${KIT_CODE}` };
  writeFileSync(manifest, `${JSON.stringify(pkg, null, 2)}\n`);
  const installed = join(root, "node_modules", ...KIT_PACKAGE.split("/"));
  rmSync(installed, { recursive: true, force: true });
  execFileSync("bun", ["install", "--no-summary"], { cwd: root, stdio: "ignore" });
  materialize(installed);
}

interface Envelope {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: Record<string, unknown>;
}

/** Run one verb over a kit bundle and parse its envelope; a non-zero exit is a verdict, not a failure. */
export function runKit(
  root: string,
  argv: readonly string[],
): { status: number; envelope: Envelope } {
  const r = spawnSync(process.execPath, [DIST_CLI, ...argv, "--root", root], {
    encoding: "utf8",
    env: kitEnv(root),
  });
  assert.equal(typeof r.stdout, "string", `the CLI printed no envelope: ${r.stderr}`);
  return { status: r.status ?? -1, envelope: JSON.parse(r.stdout) as Envelope };
}

/** Grant the installed kit for this bundle in the bundle's own trust store, proving its fixture. */
export function grantKit(root: string): Envelope {
  const r = runKit(root, ["trust", "grant", `module:${KIT_PACKAGE}`]);
  assert.equal(r.envelope.ok, true, JSON.stringify(r.envelope));
  return r.envelope;
}

/**
 * A throwaway copy of a bundle under os.tmpdir(), with the kit installed and
 * granted there. `node_modules` is never copied: the copy installs its own, so
 * a workspace link in the source tree is not carried into a directory where
 * its relative target does not exist.
 */
export function grantedCopy(source: string, prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `ww-${prefix}-`));
  cpSync(source, dir, {
    recursive: true,
    filter: (path) => basename(path) !== "node_modules",
  });
  installKit(dir);
  grantKit(dir);
  return dir;
}
