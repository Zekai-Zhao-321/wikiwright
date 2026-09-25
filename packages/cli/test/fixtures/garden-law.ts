// A synthetic gardening bundle for the v2 type-document loader (contracts §2,
// §3): a bundle `constitution/` and one library, `libraries/kit-garden`, id
// `garden`. Written under os.tmpdir() by the tests that load it, from the
// working tree and from the index; each test mutates a copy of the file map.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export type Tree = Record<string, string>;

export const ENGINE = {
  schema: "wikiwright/engine",
  schema_version: 4,
  label: "kitchen-garden",
  content_roots: ["wiki"],
  source_roots: ["raw"],
  libraries: [{ path: "libraries/kit-garden" }],
};

export function engineJson(overrides: Record<string, unknown> = {}): string {
  return `${JSON.stringify({ ...ENGINE, ...overrides }, null, 2)}\n`;
}

/** The bundle at the repository's top level, its library beside it. */
export function gardenTree(): Tree {
  return {
    "config/engine.json": engineJson(),
    "libraries/kit-garden/README.md": "A library of planting types.\n",
  };
}

/** Write a tree under a fresh directory in os.tmpdir(); returns the directory. */
export function writeTree(tree: Tree, prefix = "ww-law-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  for (const [path, text] of Object.entries(tree)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

export function link(dir: string, path: string, target: string): void {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  symlinkSync(target, join(dir, path));
}

/** `git init` and stage everything: the index holds the tree's bytes. */
export function gitStageAll(dir: string): void {
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["add", "-A"], { cwd: dir });
}

export function removeTree(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}
