// docs/roadmap.md §Each run reads its corpus again, and parses only what
// changed: the kept page reads (packages/cli/src/pagecache.ts) may never
// change a verdict, so every envelope here is compared whole with the one an
// invocation that keeps nothing returns.
import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cacheRoot } from "../src/pagecache.ts";
import { cleanBundles, cli, gardenBundle } from "./fixtures/garden-cli.ts";

const made: string[] = [];
afterAll(() => {
  cleanBundles();
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function cacheDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "ww-page-cache-"));
  made.push(dir);
  return dir;
}

/** Every pack file under a cache directory. */
function packs(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((name) => /parse-[0-9a-f]{64}\.bin$/u.test(name))
    .map((name) => join(dir, name));
}

const COMMANDS: readonly (readonly string[])[] = [
  ["read", "Basil", "--json"],
  ["check", "--all", "--json"],
];

/** The whole envelope and exit of one command, keeping nothing. */
function uncached(args: readonly string[], dir: string): string {
  const r = cli(args, dir, { env: { WIKIWRIGHT_NO_CACHE: "1" } });
  return JSON.stringify([r.status, r.envelope]);
}

function cached(args: readonly string[], dir: string, cache: string): string {
  const r = cli(args, dir, { env: { WIKIWRIGHT_CACHE_DIR: cache } });
  return JSON.stringify([r.status, r.envelope]);
}

describe("kept page reads never change a verdict", () => {
  it("a cold and a warm run return the envelope a run that keeps nothing returns", () => {
    const dir = gardenBundle();
    const cache = cacheDir();
    for (const args of COMMANDS) {
      const plain = uncached(args, dir);
      expect(cached(args, dir, cache)).toBe(plain);
      expect(packs(cache).length).toBeGreaterThan(0);
      expect(cached(args, dir, cache)).toBe(plain);
    }
  }, 240_000);

  it("a page edited to the same size is parsed again, not answered from the pack", () => {
    const dir = gardenBundle();
    const cache = cacheDir();
    const earlier = COMMANDS.map((args) => cached(args, dir, cache));
    const page = join(dir, "wiki", "Basil.md");
    const before = readFileSync(page, "utf8");
    const after = before.replace("thirty degrees", "eighty degrees");
    expect(after.length).toBe(before.length);
    expect(after).not.toBe(before);
    writeFileSync(page, after);
    COMMANDS.forEach((args, i) => {
      const warm = cached(args, dir, cache);
      expect(warm).toBe(uncached(args, dir));
      expect(warm).not.toBe(earlier[i]);
    });
    expect(cached(COMMANDS[0] ?? [], dir, cache)).toContain("eighty degrees");
  }, 240_000);

  it("a pack that does not verify reads as empty and is replaced", () => {
    const dir = gardenBundle();
    const cache = cacheDir();
    const args = COMMANDS[1] ?? [];
    const plain = uncached(args, dir);
    cached(args, dir, cache);
    const [pack] = packs(cache);
    expect(pack).toBeDefined();
    const good = readFileSync(pack as string);
    for (const bad of [
      Buffer.from("not a pack"),
      Buffer.concat([good.subarray(0, 40), Buffer.alloc(good.length - 40, 7)]),
    ]) {
      writeFileSync(pack as string, bad);
      expect(cached(args, dir, cache)).toBe(plain);
      expect(readFileSync(pack as string).equals(good)).toBe(true);
    }
  }, 240_000);

  it("WIKIWRIGHT_NO_CACHE keeps nothing, wherever WIKIWRIGHT_CACHE_DIR points", () => {
    const dir = gardenBundle();
    const cache = cacheDir();
    cli(["check", "--all", "--json"], dir, {
      env: { WIKIWRIGHT_CACHE_DIR: cache, WIKIWRIGHT_NO_CACHE: "1" },
    });
    expect(packs(cache)).toEqual([]);
    expect(cacheRoot({ WIKIWRIGHT_CACHE_DIR: cache, WIKIWRIGHT_NO_CACHE: "1" })).toBeUndefined();
    expect(cacheRoot({ WIKIWRIGHT_CACHE_DIR: cache, WIKIWRIGHT_NO_CACHE: "0" })).toBe(cache);
  }, 240_000);
});
