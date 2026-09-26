// docs/architecture.md §Directories (the path law). The SHELL half.
//
// `core/paths` decides shape, which is decidable from the string. This decides
// containment, which is not: a symlink spells nothing illegal, so
// `wiki/craft/x.md` under `wiki/craft -> ../../outside` passes every rule the
// kernel can state and still lands bytes outside the vault. Only `realpath`
// knows, and `docs/architecture.md §Directories` keeps `realpath` out of the kernel.
import { existsSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { PATH_REFUSALS, pathRefusal } from "@wikiwright/core";

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
 * docs/cli.md §Exit codes: a vault path that resolves outside the vault,
 * refused by name — `linked-outside-vault` — wherever it reaches the entry
 * point. The message names the path asked about and never where it resolved:
 * that would be a directory-structure oracle.
 */
export class LinkedOutsideVault extends Error {
  readonly path: string;
  readonly operation: "read" | "write";
  constructor(path: string, operation: "read" | "write") {
    super(`refusing to ${operation} "${path}": it resolves outside the vault`);
    this.name = "LinkedOutsideVault";
    this.path = path;
    this.operation = operation;
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
    throw new LinkedOutsideVault(path, "read");
  }
  return realPath;
}

/**
 * Where the write would really land, or a throw. `commitWrite` calls this and
 * nothing else does the join, so every content write in the engine is contained
 * (`docs/architecture.md §The invariants`).
 *
 * A throw rather than a result: a caller has already checked the path shape,
 * but a link can still appear before the write. The verb must refuse that
 * race rather than land bytes outside the bundle.
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
    throw new LinkedOutsideVault(path, "write");
  }
  return join(realExisting, relative(existing, abs));
}
