// docs/cli.md §brief (the engine ships its starter constitutions and its skills beside
// the binary) · docs/architecture.md §Directories: resolving them relative to the IMPORTING
// module made a verb's directory depth load-bearing — `../constitutions/` from
// `dist/commands.js` and from `dist/verbs/init.js` are two different
// directories, and the second does not exist. One definition site, at a fixed
// depth, so moving a verb can never move its assets.
import { fileURLToPath } from "node:url";

/** An absolute path to a directory the CLI package ships (`constitutions`, `skills`). */
export function shippedDir(name: string): string {
  return fileURLToPath(new URL(`../${name}/`, import.meta.url));
}
