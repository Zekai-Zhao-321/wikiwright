// docs/architecture.md §The invariants · the v2 contracts, section 0: the
// engine never spawns a child synchronously. Every git read goes through the
// asynchronous transport (`stdoutfile.ts`), and the hook scripts await the
// engine the same way. This walks every file the packages ship — everything
// under packages/ but the test directories, the build output and the
// installed dependencies — and refuses a synchronous spawn by name. The test
// directories are left out: a test spawns the CLI with its stdout on a file
// (fixtures/runtime.ts), and its setup `git` calls are the test's, not the
// engine's.
import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGES = fileURLToPath(new URL("../../", import.meta.url));
const SKIPPED = new Set(["node_modules", "dist", "test"]);
const SYNC_SPAWN = /\b(?:spawnSync|execSync|execFileSync)\b/u;

function shipped(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIPPED.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...shipped(path));
    else if (entry.isFile()) out.push(path);
  }
  return out;
}

describe("no synchronous spawn under packages/", () => {
  it("every shipped file is free of spawnSync, execSync and execFileSync", () => {
    const files = shipped(PACKAGES);
    expect(files.some((f) => f.endsWith(join("cli", "src", "stdoutfile.ts")))).toBe(true);
    const offending = files
      .filter((file) => SYNC_SPAWN.test(readFileSync(file, "utf8")))
      .map((file) => relative(PACKAGES, file));
    expect(offending).toEqual([]);
  });
});
