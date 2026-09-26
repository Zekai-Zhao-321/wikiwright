// The shell half of the Writer: it puts judged bytes on disk (docs/concepts.md
// §The judge and its states). Every writing verb that touches a CONTENT page
// goes through `commitWrites` or `landBatch`, and the dry-run law's write scan
// (docs/cli.md §The dry-run law) fails the build by name on a page write
// anywhere else. The old verbs' proof (splice, then judge again before
// landing) left with them: the v2 verbs judge the state they would leave
// before they call this.
import { createHash } from "node:crypto";
import { lstatSync, rmSync, statSync } from "node:fs";
import {
  preflightReplacements,
  ReplacementTargetRefused,
  replaceFiles,
  stageReplacements,
} from "./atomicwrite.ts";
import { vaultAbsolute } from "./paths.ts";

/** git's own blob identity: `sha1("blob <len>\0" + bytes)` — what a write envelope reports. */
export function blobSha(text: string): string {
  const bytes = Buffer.from(text, "utf8");
  return createHash("sha1").update(`blob ${bytes.length}\u0000`).update(bytes).digest("hex");
}

/**
 * The one filesystem write of content pages in the engine (docs/concepts.md §The judge and its states).
 * Every page's bytes land in an exclusively created temp file beside it
 * first, and only when every temp file is complete are they renamed into
 * place — so a failure while writing leaves every old page as it was and no
 * debris, and a set of pages written together lands together. The
 * rename loop itself is not batch-atomic; a crash inside it is the one window.
 * Returns the blob sha of each page landed, in the caller's order.
 */
export function commitWrites(
  root: string,
  pages: readonly { path: string; text: string }[],
): string[] {
  replaceFiles(
    pages.map((page) => ({ path: vaultAbsolute(root, page.path), contents: page.text })),
  );
  return pages.map((page) => blobSha(page.text));
}

/** Stage page fixes and generated artifacts as one batch before any rename. */
export function commitWritesWithArtifacts(
  root: string,
  pages: readonly { path: string; text: string }[],
  artifacts: readonly { path: string; content: string }[],
): void {
  replaceFiles([
    ...pages.map((page) => ({ path: vaultAbsolute(root, page.path), contents: page.text })),
    ...artifacts.map((artifact) => ({
      path: vaultAbsolute(root, artifact.path),
      contents: artifact.content,
    })),
  ]);
}

/** One page, through the same path. */
export function commitWrite(root: string, path: string, text: string): string {
  return commitWrites(root, [{ path, text }])[0] ?? blobSha(text);
}

/** Validate every page destination and moved-from path before a batch lands. */
export function preflightBatch(
  root: string,
  pages: readonly string[],
  removed: readonly string[],
): void {
  preflightReplacements(pages.map((path) => ({ path: vaultAbsolute(root, path) })));
  preflightReplacements(removed.map((path) => ({ path: vaultAbsolute(root, path) })));
  for (const path of removed) {
    const absolute = vaultAbsolute(root, path);
    try {
      if (!lstatSync(absolute).isFile()) {
        throw new ReplacementTargetRefused(absolute, "a moved-from path is not a regular file");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

/**
 * v2 contracts §9.3: `write`'s batch writer. Every page's bytes are staged in
 * an exclusive temp beside it before the first rename, then each is renamed
 * into place, then the paths a move left are removed. The crash guarantee is
 * per file: each page is its old or its new complete bytes, never a mix. The
 * batch is not transactional: a crash between two renames leaves some pages
 * new and some old, and one after the renames and before the removals leaves
 * a moved page at both paths.
 */
export function landBatch(
  root: string,
  pages: readonly { path: string; bytes: Uint8Array }[],
  removed: readonly string[],
): void {
  stageBatch(root, pages, removed).commit();
}

/** Stage all pages, then permit one last state validation before landing. */
export function stageBatch(
  root: string,
  pages: readonly { path: string; bytes: Uint8Array }[],
  removed: readonly string[],
): { commit: () => void; discard: () => void; tempPaths: readonly string[] } {
  preflightBatch(
    root,
    pages.map((page) => page.path),
    removed,
  );
  const staged = stageReplacements(
    pages.map((page) => ({
      path: vaultAbsolute(root, page.path),
      contents: Buffer.from(page.bytes),
    })),
  );
  return {
    discard: staged.discard,
    tempPaths: staged.tempPaths,
    commit: () => {
      preflightBatch(
        root,
        pages.map((page) => page.path),
        removed,
      );
      staged.commit();
      removeMovedPaths(root, pages, removed);
    },
  };
}

function removeMovedPaths(
  root: string,
  pages: readonly { path: string; bytes: Uint8Array }[],
  removed: readonly string[],
): void {
  const landed = new Set(
    pages.map((page) => {
      const stat = statSync(vaultAbsolute(root, page.path));
      return `${stat.dev}:${stat.ino}`;
    }),
  );
  for (const path of removed) {
    const absolute = vaultAbsolute(root, path);
    let stat: ReturnType<typeof lstatSync> | undefined;
    try {
      stat = lstatSync(absolute);
    } catch {
      continue;
    }
    if (landed.has(`${stat.dev}:${stat.ino}`)) continue;
    rmSync(absolute, { force: true });
  }
}
