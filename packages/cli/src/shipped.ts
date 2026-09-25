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

/**
 * Whether this process runs from a binary `bun build --compile` made. Its
 * modules live in Bun's embedded file system (`/$bunfs/`, `B:/~BUN/` on
 * Windows), so `import.meta.url` names no directory on disk and a shipped
 * directory resolved from it does not exist, on the machine that built the
 * binary too. docs/roadmap.md §The compiled binary.
 */
export function insideCompiledBinary(): boolean {
  const here = import.meta.url;
  return here.includes("/$bunfs/") || here.includes("/~BUN/");
}
