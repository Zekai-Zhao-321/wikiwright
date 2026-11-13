// docs/architecture.md §Directories (the shell owns fs; core stays pure) · a
// page's bytes as the working-tree state reads them, containment checked
// (lawstate.ts). The old loader's reader, config paths and page walk left
// with it in step 6.
import { type BigIntStats, lstatSync, readFileSync } from "node:fs";
import { vaultReadAbsolute } from "./paths.ts";

/**
 * How long after its last change a file counts as settled: two seconds, the
 * coarsest timestamp a common filesystem keeps. A file changed later than that
 * before the stamp was taken could change again within one tick and keep its
 * stamp, so it has none.
 */
const SETTLE_NS = 2_000_000_000n;

/**
 * What the filesystem says about a file without reading it: size, change
 * times and identity. Two equal stamps on a settled file name the same bytes,
 * as git's index trusts them. `undefined` for anything not a regular file and
 * for a file changed within `SETTLE_NS` of `nowNs`, or later.
 */
export function stampOf(stat: BigIntStats, nowNs: bigint): string | undefined {
  if (!stat.isFile()) return undefined;
  if (stat.mtimeNs > nowNs - SETTLE_NS || stat.ctimeNs > nowNs - SETTLE_NS) return undefined;
  return `${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}:${stat.ino}:${stat.dev}`;
}

/** The stamp of the file at `abs` as it stands, or `undefined` (gone, not a file, unsettled). */
export function stampAt(abs: string, nowNs: bigint): string | undefined {
  try {
    return stampOf(lstatSync(abs, { bigint: true }), nowNs);
  } catch {
    return undefined;
  }
}

/**
 * A page's bytes, undecoded: what the content digest reads (docs/cli.md §The
 * envelope), with the stamp of the file taken just before them: a change
 * during the read moves the stamp past what was read, so a later equal stamp
 * still names these bytes.
 */
export function readStampedPage(
  root: string,
  relPath: string,
  nowNs: bigint,
): { bytes: Buffer; stamp: string | undefined } {
  let abs: string;
  try {
    abs = vaultReadAbsolute(root, relPath);
  } catch (e) {
    // Walk stores NFC paths; on NFD-preserving filesystems the on-disk name may
    // be the decomposed form (normalization seam).
    const nfd = relPath.normalize("NFD");
    if (nfd === relPath) throw e;
    abs = vaultReadAbsolute(root, nfd);
  }
  const stamp = stampAt(abs, nowNs);
  return { bytes: readFileSync(abs), stamp };
}
