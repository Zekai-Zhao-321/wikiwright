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

const planting = (type: string, rest: string) =>
  `---\ntype: ${type}\ntitle: Basil\nbed: herb\nsown: 2026-04-12\n${rest}`;

/**
 * The test sets garden-law.ts leaves incomplete, completed (contracts §8): a
 * negative page and its expect.json, a repaired twin and a positive page for
 * each of the law's three rules, so the gardening vault judges clean.
 */
export const RULE_TESTS: Tree = {
  "libraries/kit-garden/rule-tests/known-bed/repaired.md": planting("garden/planting", "---\n"),
  "libraries/kit-garden/rule-tests/known-bed/positive/north.md": planting(
    "garden/planting",
    "---\n",
  ).replace("bed: herb", "bed: north"),
  "libraries/kit-garden/rule-tests/history-dated/negative.md": planting(
    "garden/planting",
    "---\n\n## History\n\n- 2026-05 — thinned\n",
  ),
  "libraries/kit-garden/rule-tests/history-dated/repaired.md": planting(
    "garden/planting",
    "---\n\n## History\n\n- 2026-05-02 — thinned\n",
  ),
  "libraries/kit-garden/rule-tests/history-dated/positive/two-entries.md": planting(
    "garden/planting",
    "---\n\n## History\n\n- 2026-04-12 — sown\n- 2026-05-02 — thinned\n",
  ),
  "libraries/kit-garden/rule-tests/history-dated/expect.json":
    '{"rule": "history-dated", "location": {"section": "History", "occurrence": 0}}\n',
  "rule-tests/source-host-allowed/expect.json":
    '{"rule": "source-host-allowed", "location": "page"}\n',
  "rule-tests/source-host-allowed/repaired.md": planting(
    "planting",
    "source: https://seeds.example/basil\n---\n",
  ),
  "rule-tests/source-host-allowed/positive/no-source.md": planting("planting", "---\n"),
};

/**
 * The gardening constitution, its rule tests completed, and three pages that
 * judge clean under it. A page's name is its file's basename, as Obsidian
 * names it: `[[Herb bed]]` is `wiki/Herb bed.md`.
 */
export function gardenVault(extra: Tree = {}): Tree {
  return {
    ...gardenTree(),
    ...RULE_TESTS,
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
