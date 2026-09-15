// docs/architecture.md §Directories: the one way the shell replaces a file's
// bytes. A content page (`writer.ts`), a generated artifact, the machine-local
// trust store, a skill's files and its stamp and the freshness report all land
// the same way: staged in an exclusively created temp file beside the target,
// renamed into place only once every file of the batch is complete. So a write
// interrupted while staging leaves every old file as it was and no debris, and
// a reader of the target never sees half of one. The rename loop itself is not
// batch-atomic — a crash inside it can land some files and not others — and
// that window is named here rather than hidden.
import { randomBytes } from "node:crypto";
import {
  closeSync,
  fchmodSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  statSync,
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
    return statSync(target).mode & 0o7777;
  } catch {
    return undefined;
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
