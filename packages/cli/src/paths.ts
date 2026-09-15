// docs/architecture.md §Directories (the path law). The SHELL half.
//
// `core/paths` decides shape, which is decidable from the string. This decides
// containment, which is not: a symlink spells nothing illegal, so
// `wiki/craft/x.md` under `wiki/craft -> ../../outside` passes every rule the
// kernel can state and still lands bytes outside the vault. Only `realpath`
// knows, and `docs/architecture.md §Directories` keeps `realpath` out of the kernel.
import { existsSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { isContentPath, PATH_REFUSALS, pathRefusal } from "@wikiwright/core";

/**
 * The vault root's real path, once per root per process. The root is the one
 * path a run resolves for every page and never expects to move; a page's own
 * path is still resolved on every read, since a link planted under the root is
 * what this boundary exists to catch.
 */
const realRoots = new Map<string, string>();

function realRootOf(root: string): string {
  const known = realRoots.get(root);
  if (known !== undefined) return known;
  const real = realpathSync(root);
  realRoots.set(root, real);
  return real;
}

function isInside(realRoot: string, candidate: string): boolean {
  return candidate === realRoot || candidate.startsWith(realRoot + sep);
}

function assertShape(path: string, operation: "read" | "write"): void {
  const refusal = pathRefusal(path);
  if (refusal !== undefined) {
    throw new Error(`refusing to ${operation} "${path}": it ${PATH_REFUSALS[refusal]}`);
  }
}

/**
 * Resolve an existing vault path through every link. Filesystem readers use
 * this boundary so a lexically-valid path cannot read through a junction or
 * symlink outside the vault.
 */
export function vaultReadAbsolute(root: string, path: string): string {
  assertShape(path, "read");
  const realRoot = realRootOf(root);
  const realPath = realpathSync(resolve(realRoot, path));
  if (!isInside(realRoot, realPath)) {
    throw new Error(`refusing to read "${path}": it resolves outside the vault`);
  }
  return realPath;
}

/**
 * Where the write would really land, or a throw. `commitWrite` calls this and
 * nothing else does the join, so every content write in the engine is contained
 * (`docs/architecture.md §The invariants`).
 *
 * A throw rather than a result, because every agent-facing verb has already
 * refused the path by name through `contentPathRefusal` below: reaching this is
 * a defect in a verb, a race against a symlink planted mid-run, or a caller
 * whose path came from the vault walk and therefore cannot be wrong. None of
 * the three is something to describe politely and continue from.
 */
export function vaultAbsolute(root: string, path: string): string {
  assertShape(path, "write");
  const realRoot = realRootOf(root);
  const abs = resolve(realRoot, path);
  // The file need not exist yet, nor its directories. Walk up to the deepest
  // ancestor that does and resolve THAT: a link anywhere along the chain the
  // write would create is a link the write would follow.
  let existing = dirname(abs);
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) break;
    existing = parent;
  }
  const realExisting = realpathSync(existing);
  if (!isInside(realRoot, realExisting)) {
    throw new Error(`refusing to write "${path}": it resolves outside the vault`);
  }
  return join(realExisting, relative(existing, abs));
}

/**
 * The one question an agent-facing verb asks about a path it was handed:
 * `undefined` when the path is a content page of THIS vault, and the message
 * for a named usage refusal otherwise.
 *
 * Shape and roots come from `isContentPath`, which is the kernel's and is also
 * what the state constructors and the page walk use. Containment is asked
 * second and only for a path that already passed, so the common refusal never
 * touches the filesystem.
 */
export function contentPathRefusal(
  root: string,
  path: string,
  roots: readonly string[],
): string | undefined {
  if (!isContentPath(path, roots)) {
    return `must be a .md path under a content root (${roots.join(", ")})`;
  }
  try {
    if (existsSync(resolve(root, path))) vaultReadAbsolute(root, path);
    else vaultAbsolute(root, path);
  } catch {
    // The reason is deliberately not the throw's text: a message naming what
    // resolved where is a directory-structure oracle, and the caller already
    // knows which path it asked about.
    return "resolves outside the vault; a link out of the vault is not a page of it";
  }
  return undefined;
}
