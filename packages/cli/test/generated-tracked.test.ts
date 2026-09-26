// docs/concepts.md §Generated artifacts (one generator, byte-reproducible) ·
// designs/design-registry.md invariant 6: `check --write` on every shipped
// vault whose `generated/` is tracked reproduces it byte-for-byte — the
// tag-catalog risk of folding `tags` into the vocabularies, and the graph
// risk of moving a type's document. Every corpus is on the v2 law (contracts
// §12 step 5); exports, and the renders under `skills/` they tracked, left
// with the v4 engine.json.

import { afterAll, describe, it } from "bun:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { corpusCopy, REPO, removeCopies, tracked, V2_CORPORA } from "./fixtures/corpora.ts";
import { cli } from "./fixtures/garden-cli.ts";

/** Every file under `dir`, relative to it, recursively. */
function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true, encoding: "utf8" })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(dir.length + 1))
    .sort();
}

// v2 contracts §12 step 5: a corpus on the v2 law renders generated/ with
// the v2 `check --write` — the brief, the graph, the manifest, the queue
// and the tag catalog — and tracks every file of it, rebuilt from nothing
// on a copy the same byte for byte.
afterAll(removeCopies);

describe("the tracked generated/ of every corpus on the v2 law is what this build renders", () => {
  for (const corpus of V2_CORPORA) {
    it(`${corpus}: check --write on a copy rebuilds generated/ from nothing`, () => {
      const { root } = corpusCopy(corpus);
      rmSync(join(root, "generated"), { recursive: true, force: true });
      const r = cli(["check", "--write"], root);
      assert.notEqual(r.status, 2, JSON.stringify(r.envelope.error));
      // What the repository tracks, not what a checkout holds beside it.
      const source = join(REPO, corpus, "generated");
      const files = tracked(`${corpus}/generated`)
        .map((path) => path.slice(`${corpus}/generated/`.length))
        .sort();
      assert.deepEqual(filesUnder(join(root, "generated")), files);
      for (const file of files) {
        assert.equal(
          readFileSync(join(root, "generated", file), "utf8"),
          readFileSync(join(source, file), "utf8"),
          `${corpus}/generated/${file} moved`,
        );
      }
    });
  }
});
