// docs/cli.md §gate (a kit declared by path, loaded from the bytes the index
// stages) · docs/architecture.md §Directories.
//
// The staged gate renders an export from the index, and a kit declared by
// `path` is part of what the commit carries. Its bytes are in the index, but
// the loader imports a module from a directory, so the staged files are
// written out under os.tmpdir() — never under the bundle — loaded and proved
// there, and removed once the caller is done with them.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ExportSource } from "./exports.ts";

/**
 * Write each vault-relative `path` the source holds into a fresh directory
 * under os.tmpdir(), at the same relative path, run `use` over that
 * directory, and remove it, whether `use` returns or throws.
 */
export async function withStagedKits<T>(
  source: ExportSource,
  paths: readonly string[],
  use: (dir: string) => Promise<T>,
): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "wikiwright-staged-kits-"));
  try {
    for (const path of paths) {
      const target = join(dir, ...path.split("/"));
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, source.readKit(path));
    }
    return await use(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
