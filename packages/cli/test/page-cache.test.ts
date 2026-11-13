// docs/roadmap.md §Each run reads its corpus again, and parses only what
// changed: the kept page reads (packages/cli/src/pagecache.ts) and the second
// read of a capture that takes a settled page's bytes from the first
// (lawstate.ts). Neither may change a verdict: every envelope here is compared
// whole with the one an invocation that keeps nothing returns.
import { afterAll, describe, expect, it } from "bun:test";
import {
  lstatSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fsState } from "../src/lawstate.ts";
import { cacheRoot } from "../src/pagecache.ts";
import { stampOf } from "../src/vaultfiles.ts";
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

describe("the second read of a capture", () => {
  const HOUR_AGO = new Date(Date.now() - 3_600_000);

  it("a file changed within the settle window has no stamp, so it is always read again", () => {
    const dir = gardenBundle();
    const page = join(dir, "wiki", "Basil.md");
    const now = BigInt(Date.now()) * 1_000_000n;
    expect(stampOf(lstatSync(page, { bigint: true }), now)).toBeUndefined();
    utimesSync(page, HOUR_AGO, HOUR_AGO);
    expect(stampOf(lstatSync(page, { bigint: true }), now + 3_000_000_000n)).toMatch(/^\d+:/u);
  });

  it("a settled page rewritten to the same size and time between the reads is read again", async () => {
    const dir = gardenBundle();
    const page = join(dir, "wiki", "Basil.md");
    const before = readFileSync(page, "utf8");
    const after = before.replace("thirty degrees", "eighty degrees");
    utimesSync(page, HOUR_AGO, HOUR_AGO);
    // Let the change time the backdating set fall outside the settle window.
    await new Promise((done) => setTimeout(done, 2_100));
    let rewrites = 0;
    const state = await fsState(dir, {
      betweenReads: (attempt) => {
        if (attempt !== 1) return;
        writeFileSync(page, after);
        utimesSync(page, HOUR_AGO, HOUR_AGO);
        rewrites += 1;
      },
    });
    expect(rewrites).toBe(1);
    expect(new TextDecoder().decode(state.pages.get("wiki/Basil.md"))).toBe(after);
  }, 240_000);
});
