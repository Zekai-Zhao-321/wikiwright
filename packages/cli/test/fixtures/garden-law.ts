// A synthetic gardening bundle for the v2 type-document loader (contracts §2,
// §3): a bundle `constitution/` and one library, `libraries/kit-garden`, id
// `garden`. Written under os.tmpdir() by the tests that load it, from the
// working tree and from the index; each test mutates a copy of the file map.
// Not the library the repository ships under libraries/kit-garden, which the
// allotment handbook imports: this one is the loader's test data, carries
// `history-dated` (the shipped one leaves it to the handbook) and changes
// with the tests that read it.
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

/** The library `garden`: planting and bed types, their fragment, three vocabularies. */
export const LIBRARY: Tree = {
  "libraries/kit-garden/README.md": "A library of planting types.\n",
  "libraries/kit-garden/vocabularies/beds.yaml": `vocabulary: beds
mode: registered
entries:
  north: { description: The bed along the north fence. }
  south: { description: The sunny bed by the path. }
  herb: { description: The raised herb bed. }
`,
  "libraries/kit-garden/vocabularies/relations.yaml": `vocabulary: relations
mode: registered
entries:
  grows-in: { description: The planting grows in the target bed. }
  companion-of: { description: The planting is sown beside the target. }
retired:
  planted-in: { since: 2026-01-01, successor: grows-in }
`,
  "libraries/kit-garden/vocabularies/observations.yaml": `vocabulary: observations
mode: registered
entries:
  observed: { description: Seen in this garden. }
  measured: { description: Counted or weighed. }
  advice: { description: A recommendation. }
`,
  "libraries/kit-garden/fragments/planted.yaml": `fragment: planted
description: Where and when a planting went in.
fields:
  type: object
  properties:
    bed: { type: string }
    sown: { type: string, format: date }
  required: [bed, sown]
rules:
  - id: known-bed
    expr: has(page.fields.bed) && page.fields.bed in config.beds
    config: { beds: [north, south, herb] }
    severity: error
    message: The bed is not one this garden has.
`,
  "libraries/kit-garden/types/planting.yaml": `type: planting
role: procedure
description: One sowing of one crop in one bed.
use_when: A crop went into a bed on a date.
abstract: true
fragments: [planted]
sections:
  list:
    - { heading: Observations, grammar: claims, vocabulary: observations, provenance: optional }
    - { heading: History, grammar: entries, lifecycle: append-only }
    - { heading: Relations, grammar: relations, vocabulary: relations, history: History }
rules:
  - id: history-dated
    section: History
    expr: section.items.all(i, i.precision == "day")
    severity: warning
    message: A History entry is dated to the day.
`,
  "libraries/kit-garden/types/bed.yaml": `type: bed
role: reference
description: One bed of the garden.
fields:
  type: object
  properties:
    size: { type: integer, minimum: 1 }
`,
  "libraries/kit-garden/rule-tests/known-bed/negative.md":
    "---\ntype: garden/planting\ntitle: Basil\nbed: east\nsown: 2026-04-12\n---\n",
  "libraries/kit-garden/rule-tests/known-bed/expect.json":
    '{"rule": "known-bed", "location": "page"}\n',
};

/** The bundle's own constitution: a planting over the library's, a guide, two vocabularies. */
export const CONSTITUTION: Tree = {
  "constitution/types/planting.yaml": `type: planting
extends: garden/planting
description: A planting in this kitchen garden.
fields:
  type: object
  properties:
    bed: { type: string, enum: [north, south, herb, east] }
    source: { type: string, format: uri }
    origin: { $ref: "#/$defs/page-ref", target_type: garden/bed }
    updated: { type: string, format: date }
configure:
  known-bed: { beds: [north, south, herb, east] }
meta: [updated]
rules:
  - id: source-host-allowed
    expr: '!has(page.fields.source) || page.urls["source"].host in config.hosts'
    config: { hosts: [seeds.example, nursery.example] }
    severity: warning
    message: The seed source is not a nursery this garden buys from.
`,
  "constitution/types/guide.yaml": `type: guide
role: hub
description: A route through the garden's pages.
sections:
  depth: 2
  ordered: true
  list:
    - { heading: Start here, min: 1, max: 1 }
`,
  "constitution/vocabularies/relations.yaml": `vocabulary: relations
contributes_to: garden/relations
entries:
  shades: { description: The planting shades the target. }
`,
  "constitution/vocabularies/tags.yaml": `vocabulary: tags
mode: registered
entries:
  herbs: { description: Herbs. }
  beds: { description: Beds. }
`,
  "rule-tests/source-host-allowed/negative.md":
    "---\ntype: planting\ntitle: Basil\nbed: herb\nsown: 2026-04-12\nsource: https://market.example/basil\n---\n",
  "examples/planting.md": "---\ntype: planting\ntitle: Basil\nbed: herb\nsown: 2026-04-12\n---\n",
};

/** The bundle at the repository's top level, its library beside it. */
export function gardenTree(): Tree {
  return { "config/engine.json": engineJson(), ...LIBRARY, ...CONSTITUTION };
}

/** engine.json and an empty library directory: the loader's first stage alone. */
export function bareTree(): Tree {
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
