// docs/concepts.md §Generated artifacts (one generator, byte-reproducible) · 12
//  designs/design-registry.md invariant 6: `check
// --write` on every shipped vault whose `generated/` is tracked reproduces it
// byte-for-byte — the tag-catalog risk of folding `tags` into the
// vocabularies, and the graph risk of moving a fragment's registry path.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { grantedCopy, kitEnv } from "./fixtures/kit-code.ts";

const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));
const REPO = fileURLToPath(new URL("../../../", import.meta.url));

/** The shipped vaults that track `generated/`. */
const TRACKED = ["devwiki", "fixtures/memory-synth"];

/**
 * A copy to render into. A vault that ships a package.json is a bundle over
 * a kit (devwiki, over the code kit): its copy installs and grants the kit in
 * a store the test owns, so the shipped tree is never installed into.
 */
function copyOf(source: string): string {
  if (existsSync(join(source, "package.json"))) return grantedCopy(source, "tracked");
  const tmp = mkdtempSync(join(tmpdir(), "ww-tracked-"));
  cpSync(source, tmp, { recursive: true });
  return tmp;
}

describe("the tracked generated/ of every shipped vault is what this build renders", () => {
  for (const vault of TRACKED) {
    it(`${vault}: check --write on a copy rebuilds every tracked byte, the brief included`, () => {
      const source = join(REPO, vault);
      const tmp = copyOf(source);
      try {
        // From nothing: the copy's generated/ is removed, so a tracked file the
        // generator no longer writes is a missing file, never a stale copy
        // that happens to match. One generator: `check --write` lands the
        // artifacts and the brief.
        rmSync(join(tmp, "generated"), { recursive: true, force: true });
        const r = spawnSync(process.execPath, [CLI, "check", "--write", "--root", tmp], {
          encoding: "utf8",
          env: kitEnv(tmp),
        });
        assert.notEqual(r.status, 2, r.stdout);
        const generated = readdirSync(join(source, "generated")).filter(
          (f) => f !== ".gitignore" && !f.endsWith(".tsv") && f !== "freshness.json",
        );
        assert.notEqual(generated.length, 0);
        for (const file of generated) {
          assert.equal(
            readFileSync(join(tmp, "generated", file), "utf8"),
            readFileSync(join(source, "generated", file), "utf8"),
            `${vault}/generated/${file} moved`,
          );
        }
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });
  }
});
