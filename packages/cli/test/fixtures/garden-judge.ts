// A synthetic gardening vault for the v2 judge (contracts §10, §12 step 3):
// the gardening constitution of garden-law.ts with pages under wiki/, written
// under os.tmpdir(), and the git steps the index and revision states read.
// Test data, not a starter.
import { execFileSync } from "node:child_process";
import { gardenTree, type Tree } from "./garden-law.ts";

export const HERB_BED = `---
type: garden/bed
title: Herb bed
size: 4
---

# Herb bed

The raised bed by the kitchen door.
`;

export const BASIL = `---
type: planting
title: Basil
bed: herb
sown: 2026-04-12
source: https://seeds.example/basil
---

# Basil

## Observations

- [observed] Basil bolts above thirty degrees. ([[Herb bed]])

## History

- 2026-04-12 — sown

## Relations

- grows-in [[Herb bed]]
`;

export const START = `---
type: guide
title: Start
---

# Start

## Start here

Read [[Basil]] first.
`;

/**
 * The gardening constitution and three pages that judge clean under it. A
 * page's name is its file's basename, as Obsidian names it: `[[Herb bed]]`
 * is `wiki/Herb bed.md`.
 */
export function gardenVault(extra: Tree = {}): Tree {
  return {
    ...gardenTree(),
    "wiki/Herb bed.md": HERB_BED,
    "wiki/Basil.md": BASIL,
    "wiki/Start.md": START,
    ...extra,
  };
}

export function git(dir: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd: dir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
  });
}

/** `git init`, stage everything, and commit it: HEAD, the index and the tree agree. */
export function gitCommitAll(dir: string, message = "initial"): void {
  git(dir, "init", "-q");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", message);
}
