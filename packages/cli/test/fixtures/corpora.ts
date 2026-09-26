// The corpora of this repository on the v2 law (contracts §12 step 5): each
// judged where it stands, and copied under os.tmpdir() into a repository of
// its own — the corpus at its repository-relative path, beside the
// libraries it imports (§2: a library path resolves against the top level)
// — for a verb that writes, or that reads an index. The corpora still on
// the v1 law are judged by the old table's tests until they move.
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { git } from "./garden-cli.ts";

export const REPO = fileURLToPath(new URL("../../../../", import.meta.url));

/** Every corpus on the v2 law, repository-relative. */
export const V2_CORPORA: readonly string[] = [
  "fixtures/minimal-vault",
  "fixtures/memory-synth",
  "fixtures/handbooks/orchard",
];

const copies: string[] = [];

/** Remove every copy this file made. */
export function removeCopies(): void {
  for (const dir of copies.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/** The files git tracks under `dir` (repository-relative) in this checkout: what a clone holds. */
function tracked(dir: string): string[] {
  return git(REPO, "-c", "core.quotepath=off", "ls-files", "-z", "--", dir)
    .split("\0")
    .filter((path) => path !== "");
}

/**
 * A copy of `corpus` in a fresh repository under os.tmpdir(), at the same
 * repository-relative path, with `libraries/` beside it — the files a clone
 * holds, nothing untracked; nothing staged or committed. Returns the corpus
 * root and the top level.
 */
export function corpusCopy(corpus: string): { root: string; top: string } {
  const top = mkdtempSync(join(tmpdir(), "ww-corpus-"));
  copies.push(top);
  for (const path of [...tracked(corpus), ...tracked("libraries")]) {
    mkdirSync(dirname(join(top, path)), { recursive: true });
    copyFileSync(join(REPO, path), join(top, path));
  }
  git(top, "init", "-q");
  return { root: join(top, corpus), top };
}
