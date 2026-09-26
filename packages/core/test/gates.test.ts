// Mechanical gates over the shipped sources: no locale-dependent comparison,
// no Bun-specific API outside the git transport, no node: import inside core, and no
// literal NUL byte — enforcement over convention, never prose.

import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../../..", import.meta.url));

function files(dir: string, suffix: string): string[] {
  return readdirSync(join(REPO, dir), { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(suffix))
    .map((f) => join(REPO, dir, f));
}

const SRC_FILES = [...files("packages/core/src", ".ts"), ...files("packages/cli/src", ".ts")];

/** The git transport: the one shipped file that calls the runtime's own API. */
const RUNTIME_SEAM = "packages/cli/src/stdoutfile.ts";

describe("shipped-code gates", () => {
  it("bans locale-dependent comparison in packages/ source", () => {
    for (const file of SRC_FILES) {
      const text = readFileSync(file, "utf8");
      assert.equal(text.includes("localeCompare"), false, `${file} uses localeCompare`);
      assert.equal(text.includes("Intl.Collator"), false, `${file} uses Intl.Collator`);
    }
  });

  it("bans Bun-specific APIs in packages/ source outside the one transport file", () => {
    // The engine runs on Bun only, and the git transport spawns through
    // `Bun.spawn` (its header says why): that one file is the runtime seam.
    // Every other file, the kernel entire, stays on the language and node:
    // builtins, so a runtime call cannot hide in a verdict.
    for (const file of SRC_FILES) {
      if (file.endsWith(RUNTIME_SEAM)) continue;
      const text = readFileSync(file, "utf8");
      assert.equal(/\bBun\./.test(text), false, `${file} uses Bun.*`);
      assert.equal(text.includes('from "bun'), false, `${file} imports bun:*`);
    }
  });

  it("…and that exemption covers exactly one file, which exists", () => {
    assert.equal(SRC_FILES.filter((f) => f.endsWith(RUNTIME_SEAM)).length, 1);
  });

  it("keeps core free of node: imports outside the type wall", () => {
    for (const file of files("packages/core/src", ".ts")) {
      const text = readFileSync(file, "utf8");
      assert.equal(
        text.includes('from "node:'),
        false,
        `${file} imports node builtins inside core`,
      );
    }
  });
});

describe("the engine's sources are text, so their diffs are reviewable", () => {
  // A raw NUL in a source file makes git classify it as BINARY, so the file
  // ships with no reviewable diff and no `git blame`. `judge/index.ts` used NUL
  // as a string delimiter and was `Bin 0 -> 29124 bytes` in the diffstat. The
  // escape is the same runtime string; only the source is different.
  it("no source file carries a literal NUL byte", () => {
    const offenders: string[] = [];
    for (const file of SRC_FILES) {
      if (readFileSync(file, "utf8").includes(String.fromCharCode(0))) offenders.push(file);
    }
    assert.deepEqual(offenders, [], "write \\u0000, not the byte");
  });
});
