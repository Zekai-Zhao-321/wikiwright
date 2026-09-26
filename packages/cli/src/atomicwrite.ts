// docs/architecture.md §Directories: the one way the shell replaces a file's
// bytes. Content pages, generated artifacts and envelope --out files land
// through a complete temp file beside each target. Every known destination
// obstruction is refused before staging and checked again before the first
// rename. A reader never sees half of one file; a crash during the rename
// loop can still leave a mix across files, so that window is stated.
import { randomBytes } from "node:crypto";
import {
  closeSync,
  fchmodSync,
  lstatSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

/**
 * A temp file beside `target`, created exclusively so two processes staging the
 * same target never write one another's bytes. Beside it, and not under the
 * system temp directory, so the rename stays on one filesystem: a rename across
 * devices is a copy, and a copy is not atomic.
 */
export function exclusiveTemp(target: string): { path: string; fd: number } {
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const path = `${target}.wikiwright-tmp-${process.pid}-${randomBytes(12).toString("hex")}`;
    try {
      return { path, fd: openSync(path, "wx") };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw error;
    }
  }
  throw new Error(`could not create an exclusive temporary file beside "${target}"`);
}

export interface Replacement {
  /** The absolute path whose bytes this replaces; its directory is created. */
  path: string;
  contents: string | Buffer;
}

/** The permission bits of a file that is already there, or none for a new one. */
function modeOf(target: string): number | undefined {
  try {
    return lstatSync(target).mode & 0o7777;
  } catch {
    return undefined;
  }
}

/** A known target or ancestor cannot hold the planned regular-file replacement. */
export class ReplacementTargetRefused extends Error {
  readonly path: string;
  readonly kind: string;
  constructor(path: string, kind: string) {
    super(`cannot replace "${path}": ${kind}`);
    this.name = "ReplacementTargetRefused";
    this.path = path;
    this.kind = kind;
  }
}

/** Every target is checked before the first write, including on a dry run. */
export function preflightReplacements(entries: readonly { path: string }[]): void {
  const seen = new Set<string>();
  for (const { path } of entries) {
    if (seen.has(path)) throw new ReplacementTargetRefused(path, "the batch names it twice");
    seen.add(path);
    let parent = dirname(path);
    for (;;) {
      try {
        const stat = lstatSync(parent);
        if (!stat.isDirectory()) {
          throw new ReplacementTargetRefused(parent, "an existing parent is not a directory");
        }
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        const above = dirname(parent);
        if (above === parent) throw error;
        parent = above;
      }
    }
    try {
      const stat = lstatSync(path);
      if (!stat.isFile()) {
        throw new ReplacementTargetRefused(path, "the destination is not a regular file");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

/**
 * Replace every file's bytes, every one staged before the first rename, so a
 * set of files written together lands together.
 *
 * A replacement keeps the mode the file had: the temp file is created under
 * this process's umask, and renaming it over a file a maintainer had made
 * private would publish that file's contents. Ownership is not preserved —
 * that needs privilege this process does not ask for — so a file replaced by
 * another user changes hands, and the umask sets the mode of a new file.
 */
export function replaceFiles(entries: readonly Replacement[]): void {
  preflightReplacements(entries);
  const staged: { temp: string; target: string }[] = [];
  try {
    for (const entry of entries) {
      mkdirSync(dirname(entry.path), { recursive: true });
      const mode = modeOf(entry.path);
      const { path: temp, fd } = exclusiveTemp(entry.path);
      staged.push({ temp, target: entry.path });
      try {
        writeFileSync(fd, entry.contents);
        if (mode !== undefined) fchmodSync(fd, mode);
      } finally {
        closeSync(fd);
      }
    }
  } catch (error) {
    for (const { temp } of staged) rmSync(temp, { force: true });
    throw error;
  }
  let renamed = 0;
  try {
    // A target may have changed while temp files were staged. Do not land
    // the first replacement if another target is now known to be unsafe.
    preflightReplacements(entries);
    for (const { temp, target } of staged) {
      renameSync(temp, target);
      renamed += 1;
    }
  } catch (error) {
    // What landed stays; the temp files not yet renamed go, so a refused rename
    // leaves the old bytes and no debris beside them.
    for (const { temp } of staged.slice(renamed)) rmSync(temp, { force: true });
    throw error;
  }
}

/** One file, through the same staging. */
export function replaceFile(path: string, contents: string | Buffer): void {
  replaceFiles([{ path, contents }]);
}
