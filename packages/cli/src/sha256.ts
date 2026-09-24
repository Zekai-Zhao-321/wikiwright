// docs/cli.md §The envelope (the law and content digests) · docs/extending.md
// §Declaring a module (a module's digest).
//
// The shell's sha256, over bytes as they lie on disk: a module's files, a page,
// a shipped skill's files. Core vendors its own over strings
// (`packages/core/src/hash`), because core may import nothing of Node; the
// shell reads files as bytes and hashes them with Node's own.
import { createHash } from "node:crypto";

export function sha256Of(bytes: string | Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
