// A small gardening bundle whose Facts are claims, for the tests of search
// over items and files; and a line search as an agent's own tool runs one, the
// recall comparison's reference. Test data, not a starter.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { documentOf } from "../../../core/test/helpers/constitution.ts";

/** Three gardening pages whose Facts are claims, over one small claims law. */
export const PAGES: Record<string, string> = {
  "Climbing rose.md": `---
type: plant
title: Climbing rose
description: A rose trained along a wall or a frame.
tags: [roses]
---

# Climbing rose

A rose trained along a wall or a frame.

## Facts

- [pest] Aphids gather on the new shoots in late spring (stated 2026-05-02)
  - Watch the undersides of the leaves after a warm week.
- [care] Tie the long canes in along the support in autumn (stated 2026-03-10)
- [bloom] Flowers once, in early summer, on last year's wood (stated 2026-06-20)
  - The hips that follow feed birds through the winter.

## Relations

- grows_near [[Apple tree]]
`,
  "Apple tree.md": `---
type: plant
title: Apple tree
description: A dwarf apple on a trained frame.
tags: [fruit]
---

# Apple tree

A dwarf apple on a trained frame.

## Facts

- [pest] Codling moth larvae tunnel into the fruit (stated 2026-07-01)
- [care] Thin the fruitlets to one per cluster in early summer (stated 2026-06-10)
  - Crowded clusters invite aphids and give small apples.
- [bloom] Blossom opens in mid spring (stated 2026-04-15)
`,
  "South bed.md": `---
type: bed
title: South bed
description: The raised bed under the south wall.
tags: []
---

# South bed

The raised bed under the south wall.

## Facts

- [pest] Aphids arrive on the beans each June (stated 2026-06-05)
`,
};

const SECTIONS = {
  depth: 2,
  ordered: false,
  additional: true,
  list: [
    {
      heading: "Facts",
      min: 1,
      grammar: "claims",
      history: "History",
      provenance: "optional",
      vocabulary: "categories",
    },
    { heading: "Relations", grammar: "relations" },
    { heading: "History", grammar: "claims", role: "history", vocabulary: "categories" },
  ],
};

export function claimsBundle(parent: string): string {
  const root = join(parent, "garden");
  mkdirSync(join(root, "config"), { recursive: true });
  mkdirSync(join(root, "wiki"), { recursive: true });
  writeFileSync(
    join(root, "config", "constitution.json"),
    `${JSON.stringify(
      documentOf({
        vocabularies: {
          tags: {
            mode: "registered",
            entries: {
              roses: { description: "Roses of every habit." },
              fruit: { description: "Plants grown for their fruit." },
            },
          },
          categories: {
            mode: "registered",
            entries: {
              pest: { class: "accumulate", description: "What eats or harms the plant." },
              care: { class: "supersede", description: "How the plant is looked after." },
              bloom: { class: "accumulate", description: "When and how it flowers." },
            },
          },
          relations: { mode: "census" },
        },
        types: {
          plant: {
            extends: "concept",
            description: "One plant in the garden.",
            sections: SECTIONS,
          },
          bed: { extends: "concept", description: "One bed in the garden.", sections: SECTIONS },
        },
      }),
    )}\n`,
  );
  writeFileSync(join(root, "config", "engine.json"), '{ "content_roots": ["wiki"] }\n');
  for (const [name, text] of Object.entries(PAGES)) writeFileSync(join(root, "wiki", name), text);
  return root;
}

/**
 * A line search as an agent's own tool runs one: every line of every page that
 * holds any of the terms, case folded, as a substring. What it finds on an item
 * line or on a rationale line under one is what `--items` must find.
 */
export function lineSearch(
  root: string,
  terms: readonly string[],
): { path: string; line: number }[] {
  const out: { path: string; line: number }[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const next = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(join(dir, entry.name), next);
      else if (entry.name.endsWith(".md")) {
        readFileSync(join(dir, entry.name), "utf8")
          .split("\n")
          .forEach((text, i) => {
            const folded = text.toLowerCase();
            if (terms.some((t) => folded.includes(t.toLowerCase())))
              out.push({ path: next, line: i + 1 });
          });
      }
    }
  };
  walk(join(root, "wiki"), "wiki");
  return out;
}

/**
 * The item lines of a page, read without the engine: under a heading this
 * fixture gives a grammar, a top-level bullet is an item and an indented bullet
 * is a rationale line of the item above it.
 */
export function itemLinesOf(root: string, path: string): Map<number, number> {
  const owner = new Map<number, number>();
  let inGrammar = false;
  let current = 0;
  readFileSync(join(root, path), "utf8")
    .split("\n")
    .forEach((text, i) => {
      const heading = /^##\s+(.*)$/u.exec(text);
      if (heading !== null) {
        inGrammar = ["Facts", "Relations", "History"].includes(heading[1] ?? "");
        current = 0;
        return;
      }
      if (!inGrammar) return;
      if (/^[-*] /u.test(text)) {
        current = i + 1;
        owner.set(i + 1, i + 1);
      } else if (/^\s+[-*] /u.test(text) && current > 0) {
        owner.set(i + 1, current);
      }
    });
  return owner;
}

/** The six queries the recall comparison runs, each a set of terms a line search would alternate over. */
export const RECALL_QUERIES: readonly string[][] = [
  ["aphids"],
  ["aphid"],
  ["summer", "spring"],
  ["moth", "larvae", "fruit"],
  ["canes", "frame", "wall"],
  ["prune", "pruning", "thin"],
];
