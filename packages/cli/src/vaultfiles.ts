// docs/architecture.md §Directories (the shell owns fs; core stays pure) · the
// vault's files as the engine reads them: the two config paths, the reader the
// loader takes them through, the page walk and the containment-checked page
// reads. Nothing here loads the law, so a module that reads a vault's files
// without judging under its law — the bundle identity — reads them from here.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { codeUnitCompare, isContentPath, PATH_REFUSALS, pathRefusal } from "@wikiwright/core";
import { vaultReadAbsolute } from "./paths.ts";

/** docs/constitution.md §config/constitution.json: the one law a bundle is written in. */
export const CONSTITUTION_PATH = "config/constitution.json";

/** docs/constitution.md §config/engine.json: the bundle's policy beside its law. */
export const ENGINE_PATH = "config/engine.json";

/**
 * How the loader reads config bytes: the working tree, or the git index or a
 * revision (docs/cli.md §lint --staged). `exists` answers from a listing the
 * reader already holds; `read` may go to git, so its caller awaits it.
 */
export interface VaultReader {
  exists(rel: string): boolean;
  read(rel: string): string | Promise<string>;
}

/** The working tree's reader, whose reads answer at once. */
export interface DiskReader extends VaultReader {
  read(rel: string): string;
}

export function fsReader(root: string): DiskReader {
  return {
    exists: (rel) => {
      const refusal = pathRefusal(rel);
      if (refusal !== undefined) {
        throw new Error(`refusing to read "${rel}": it ${PATH_REFUSALS[refusal]}`);
      }
      if (!existsSync(join(root, rel))) return false;
      vaultReadAbsolute(root, rel);
      return true;
    },
    read: (rel) => readFileSync(vaultReadAbsolute(root, rel), "utf8"),
  };
}

/** All markdown pages under the content roots, repo-relative POSIX paths, code-unit sorted. */
export function walkPages(root: string, roots: readonly string[]): string[] {
  const pages: string[] = [];
  for (const contentRoot of roots) {
    const base = join(root, contentRoot);
    if (!existsSync(base)) continue;
    const containedRoot = vaultReadAbsolute(root, contentRoot);
    for (const entry of readdirSync(containedRoot, { recursive: true, encoding: "utf8" })) {
      // Backslash is a directory separator only on Windows; on POSIX it is a
      // legal filename character.
      const sepFixed = process.platform === "win32" ? entry.replaceAll("\\", "/") : entry;
      // Paths are stored NFC so artifacts are byte-stable across filesystems
      //; readPage falls back to the NFD form for on-disk lookup.
      const rel = sepFixed.normalize("NFC");
      if (!rel.endsWith(".md")) continue;
      const path = `${contentRoot}/${rel}`;
      // The walk may not produce a path the law refuses, or the two
      // state constructors disagree — the working tree would judge a page the
      // git index filters out, and `docs/architecture.md §How a verdict is produced`'s whole point is that they cannot.
      // On POSIX the only names this reaches are the ones carrying a backslash
      // or a control character, which are exactly the names that would have two
      // identities on two filesystems.
      if (!isContentPath(path, roots)) continue;
      // The walk decides shape; containment is decided where the bytes are
      // read (`readPage`), once per page, so a page symlinked out of the vault
      // is refused by the read every consumer of this list performs.
      pages.push(path);
    }
  }
  pages.sort(codeUnitCompare);
  return pages;
}

export function readPage(root: string, relPath: string): string {
  return readPageBytes(root, relPath).toString("utf8");
}

/** A page's bytes, undecoded: what the content digest reads (docs/cli.md §The envelope). */
export function readPageBytes(root: string, relPath: string): Buffer {
  try {
    return readFileSync(vaultReadAbsolute(root, relPath));
  } catch (e) {
    // Walk stores NFC paths; on NFD-preserving filesystems the on-disk name may
    // be the decomposed form (normalization seam).
    const nfd = relPath.normalize("NFD");
    if (nfd !== relPath) return readFileSync(vaultReadAbsolute(root, nfd));
    throw e;
  }
}
