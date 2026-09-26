// docs/cli.md §gate (a kit declared by path, loaded from the bytes the index
// stages) · docs/architecture.md §Directories.
//
// The staged gate judges what the commit carries, and a kit declared by
// `path` is part of it. Its bytes are in the index, but the loader imports a
// module from a directory, so the staged files are written out under
// os.tmpdir() — never under the bundle — loaded and proved there, and removed
// once the caller is done with them.

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { gitReadBlobBytes, type IndexEntry } from "./git.ts";

/** The index mode of a symbolic link. */
const LINK_MODE = "120000";

/**
 * Write every staged file under each vault-relative kit location — its own
 * `node_modules` left out, as the module digest leaves it out — into a fresh
 * directory under os.tmpdir(), at the same relative path, run `use` over that
 * directory, and remove it, whether `use` returns or throws. A link the index
 * tracks is written as the link it stages, its target as the index holds it,
 * which is what a checkout of the commit would hold.
 */
export async function withStagedKits<T>(
  root: string,
  entries: readonly IndexEntry[],
  locations: readonly string[],
  use: (dir: string) => Promise<T>,
): Promise<T> {
  const staged = entries.filter((entry) => {
    if (entry.stage !== 0) return false;
    const location = locations.find((at) => entry.path.startsWith(`${at}/`));
    if (location === undefined) return false;
    return !entry.path
      .slice(location.length + 1)
      .split("/")
      .includes("node_modules");
  });
  const blobs = await gitReadBlobBytes(
    root,
    staged.map((entry) => entry.blob),
  );
  const dir = mkdtempSync(join(tmpdir(), "wikiwright-staged-kits-"));
  try {
    for (const entry of staged) {
      const bytes = blobs.get(entry.blob);
      if (bytes === undefined) {
        throw new Error(
          `the index names blob ${entry.blob} for "${entry.path}" and git did not return it`,
        );
      }
      const target = join(dir, ...entry.path.split("/"));
      mkdirSync(dirname(target), { recursive: true });
      if (entry.mode === LINK_MODE) symlinkSync(bytes.toString("utf8"), target);
      else writeFileSync(target, bytes);
    }
    return await use(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
