// The v2 contracts, section 0: Bun only. `.bun-version` names the Bun this
// repository is built and tested with, and every package.json's
// `engines.bun` pins that version exactly; no package names a Node engine,
// and no script runs `node`.
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
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
});
