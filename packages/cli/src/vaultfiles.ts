// docs/architecture.md §Directories (the shell owns fs; core stays pure) · a
// page's bytes as the working-tree state reads them, containment checked
// (lawstate.ts). The old loader's reader, config paths and page walk left
// with it in step 6.
import { readFileSync } from "node:fs";
import { vaultReadAbsolute } from "./paths.ts";

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
