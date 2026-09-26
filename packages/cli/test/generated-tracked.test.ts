// docs/concepts.md §Generated artifacts (one generator, byte-reproducible) · 12
//  designs/design-registry.md invariant 6: `check
// --write` on every shipped vault whose `generated/` is tracked reproduces it
// byte-for-byte — the tag-catalog risk of folding `tags` into the
// vocabularies, and the graph risk of moving a fragment's registry path. A
// vault that renders exports into its own `skills/` tracks them too
// (docs/constitution.md §exports), and they are rebuilt from nothing the same way.

import { afterAll, describe, it } from "bun:test";
import assert from "node:assert/strict";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { corpusCopy, removeCopies, REPO as TOP, V2_CORPORA } from "./fixtures/corpora.ts";
import { cli } from "./fixtures/garden-cli.ts";
import { installedCopy, kitEnv } from "./fixtures/kit-code.ts";
import { runCli } from "./fixtures/runtime.ts";

const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));
const REPO = fileURLToPath(new URL("../../../", import.meta.url));

/** The shipped vaults that track `generated/`. */
const TRACKED = ["devwiki", "fixtures/handbooks/allotment"];

/**
 * A copy to render into. A vault that ships a package.json is a bundle over
 * a kit (devwiki, over the code kit): its copy installs the kit, so the
 * shipped tree is never installed into.
 */
function copyOf(source: string): { root: string; scratch: string } {
  if (existsSync(join(source, "package.json"))) {
    const root = installedCopy(source, "tracked");
    return { root, scratch: root };
  }
  // Under the source's own name: an export's marker names the bundle it was
  // cut from by its label, the basename of its root.
  const scratch = mkdtempSync(join(tmpdir(), "ww-tracked-"));
  const root = join(scratch, basename(source));
  mkdirSync(root);
  cpSync(source, root, { recursive: true });
  return { root, scratch };
}

/** Every file under `dir`, relative to it, recursively. */
function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true, encoding: "utf8" })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(dir.length + 1))
    .sort();
}

describe("the tracked generated/ of every shipped vault is what this build renders", () => {
  for (const vault of TRACKED) {
    it(`${vault}: check --write on a copy rebuilds every tracked byte, the brief included`, () => {
      const source = join(REPO, vault);
      const { root: tmp, scratch } = copyOf(source);
      try {
        // From nothing: the copy's generated/ is removed, so a tracked file the
        // generator no longer writes is a missing file, never a stale copy
        // that happens to match. One generator: `check --write` lands the
        // artifacts and the brief.
        rmSync(join(tmp, "generated"), { recursive: true, force: true });
        const exported = filesUnder(join(source, "skills"));
        rmSync(join(tmp, "skills"), { recursive: true, force: true });
        const r = runCli([CLI, "check", "--write", "--root", tmp], {
          encoding: "utf8",
          env: kitEnv(),
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
        assert.deepEqual(filesUnder(join(tmp, "skills")), exported, `${vault}/skills/ moved`);
        for (const file of exported) {
          assert.equal(
            readFileSync(join(tmp, "skills", file), "utf8"),
            readFileSync(join(source, "skills", file), "utf8"),
            `${vault}/skills/${file} moved`,
          );
        }
      } finally {
        rmSync(scratch, { recursive: true, force: true });
      }
    });
  }
});

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
      const source = join(TOP, corpus, "generated");
      assert.deepEqual(filesUnder(join(root, "generated")), filesUnder(source));
      for (const file of filesUnder(source)) {
        assert.equal(
          readFileSync(join(root, "generated", file), "utf8"),
          readFileSync(join(source, file), "utf8"),
          `${corpus}/generated/${file} moved`,
        );
      }
    });
  }
});
