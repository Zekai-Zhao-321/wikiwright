// Mechanical gates over the shipped sources: no locale-dependent comparison
//, no Bun-specific API and no node: import inside core, and no
// literal NUL byte — enforcement over convention, never prose.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../../..", import.meta.url));

function files(dir: string, suffix: string): string[] {
  return readdirSync(join(REPO, dir), { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(suffix))
    .map((f) => join(REPO, dir, f));
}

const SRC_FILES = [...files("packages/core/src", ".ts"), ...files("packages/cli/src", ".ts")];

/**
 * docs/extending.md §The determinism fixture: the purity scan is the one file whose JOB is to
 * name these constructs, so a substring rule would force it to spell the thing
 * it refuses in fragments — unreadable, in the file where readability is the
 * point. It is held to a STRICTER rule instead: no call form anywhere in it.
 * Every other file keeps the substring rule.
 */
const NAMES_THE_BANNED = "packages/core/src/modules/purity.ts";

describe("shipped-code gates", () => {
  it("bans locale-dependent comparison in packages/ source", () => {
    for (const file of SRC_FILES) {
      const text = readFileSync(file, "utf8");
      if (file.endsWith(NAMES_THE_BANNED)) {
        // The call form, not the name: `x.localeCompare(y)` and `new Intl.Collator(`.
        assert.equal(
          /\w\s*\.\s*localeCompare\s*\(/u.test(text.replace(/\\s\*/gu, "")),
          false,
          `${file} calls localeCompare`,
        );
        assert.equal(/new\s+Intl\.Collator\s*\(/u.test(text), false, `${file} uses a collator`);
        continue;
      }
      assert.equal(text.includes("localeCompare"), false, `${file} uses localeCompare`);
      assert.equal(text.includes("Intl.Collator"), false, `${file} uses Intl.Collator`);
    }
  });

  it("…and the exemption covers exactly one file, which exists", () => {
    // An exemption nobody can see the size of is how a gate stops being one.
    const exempt = SRC_FILES.filter((f) => f.endsWith(NAMES_THE_BANNED));
    assert.equal(exempt.length, 1, `the purity scan is at ${NAMES_THE_BANNED}`);
  });

  it("bans Bun-specific APIs in packages/ source (node-builtins-only artifact)", () => {
    for (const file of SRC_FILES) {
      const text = readFileSync(file, "utf8");
      assert.equal(/\bBun\./.test(text), false, `${file} uses Bun.*`);
      assert.equal(text.includes('from "bun'), false, `${file} imports bun:*`);
    }
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
