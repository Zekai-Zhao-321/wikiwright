// v2 contracts §4, §5: the page interface, built from parsed pages under the
// gardening constitution loaded from a directory under os.tmpdir(): the
// frontmatter as YAML 1.2 core with integers as int, fields with defaults,
// urls, every section occurrence with its path, raw text and UTF-8 byte span,
// the records of §4 with their rationale, facts and before.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  buildBefore,
  buildFacts,
  buildPageInterface,
  type LawType,
  loadTypeLaw,
  type ParsedPage,
  parsePage,
  type TypeLaw,
} from "@wikiwright/core";
import { workingTreeLawSnapshot } from "../src/lawfiles.ts";
import { gardenTree, removeTree, writeTree } from "./fixtures/garden-law.ts";

let law: TypeLaw;
let dir: string;
beforeAll(async () => {
  dir = writeTree({
    ...gardenTree(),
    "constitution/types/bed-note.yaml": `type: bed-note
role: reference
description: A note on one bed.
fields:
  type: object
  properties:
    rows: { type: integer, default: 4 }
    ratio: { type: number, default: 0.5 }
    shop: { type: string, format: uri }
sections:
  list:
    - { heading: Relations, grammar: relations, vocabulary: garden/relations }
`,
  });
  const loaded = loadTypeLaw(await workingTreeLawSnapshot(dir));
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.issues));
  law = loaded.law;
});
afterAll(() => removeTree(dir));

const enc = (text: string) => new TextEncoder().encode(text);
const dec = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

const resolve = (name: string) =>
  name === "Herb bed" ? { path: "wiki/herb-bed.md", type: "garden/bed" } : undefined;

const BASIL = `---
type: planting
title: Basil in the herb bed
tags: [herbs]
bed: herb
sown: 2026-04-12
count: 12
weight: 1.0
source: HTTPS://Seeds.Example/Basil
updated: 2026-05-02
---

# Basil in the herb bed

Grown from seed on the sill, then moved out.

## Observations

- [observed] Basil bolts above 30 degrees. ([[Growing basil]])
  - Seen twice in July.
  - Both times after a dry week.
- [measured] Forty leaves a week. (raw/logbook/2026.md)
Some prose between the items, ignored.
- [advice] Pinch the tips.é
* [advice] A star bullet.
- observed: not a claim

### Aside

- [observed] Under a subheading, not an item of Observations.

## History

- 2026-04-12 — sown
- 2026-05 — thinned

\`\`\`
- 2026-06-01 — inside a fence, not an item
\`\`\`

## Relations

- grows-in [[Herb bed]]
- companion-of [[Tomato|tomatoes]]
`;

function read(path: string, text: string): ParsedPage {
  const result = parsePage(path, enc(text), law, resolve);
  if (!result.ok) throw new Error(result.message);
  return result.page;
}

describe("a parsed page", () => {
  it("reads the frontmatter as YAML 1.2 core, integers as bigint", () => {
    const page = read("wiki/basil.md", BASIL);
    expect(page.frontmatter["count"]).toBe(12n);
    expect(page.frontmatter["weight"]).toBe(1);
    expect(page.frontmatter["sown"]).toBe("2026-04-12");
    expect(page.type?.name).toBe("planting");
    expect(page.body.startsWith("\n# Basil in the herb bed")).toBe(true);
  });

  it("gives every heading an occurrence: path, raw text, a UTF-8 byte span", () => {
    const bytes = enc(BASIL);
    const page = read("wiki/basil.md", BASIL);
    expect(page.occurrences.map((o) => o.path.join(" > "))).toEqual([
      "Basil in the herb bed",
      "Basil in the herb bed > Observations",
      "Basil in the herb bed > Observations > Aside",
      "Basil in the herb bed > History",
      "Basil in the herb bed > Relations",
    ]);
    for (const occurrence of page.occurrences) {
      const [start, end] = occurrence.location.span;
      expect(dec(bytes.slice(start, end))).toBe(occurrence.raw);
      expect(occurrence.raw.split("\n")[0]?.endsWith(occurrence.heading)).toBe(true);
    }
    const observations = page.occurrences[1];
    expect(observations?.raw.includes("### Aside")).toBe(true);
    expect(observations?.location.line).toBe(17);
  });

  it("parses a declared section's items into records; items span their rationale", () => {
    const bytes = enc(BASIL);
    const page = read("wiki/basil.md", BASIL);
    const [first, second, third] = page.occurrences[1]?.items ?? [];
    expect(first).toMatchObject({
      kind: "claim",
      category: "observed",
      rationale: ["  - Seen twice in July.", "  - Both times after a dry week."],
      raw: "- [observed] Basil bolts above 30 degrees. ([[Growing basil]])",
      location: { line: 19 },
    });
    const span = first?.location.span ?? [0, 0];
    expect(dec(bytes.slice(span[0], span[1]))).toBe(
      "- [observed] Basil bolts above 30 degrees. ([[Growing basil]])\n  - Seen twice in July.\n  - Both times after a dry week.",
    );
    expect(second).toMatchObject({ provenance: { kind: "path", value: "raw/logbook/2026.md" } });
    // A multi-byte character moves every later byte offset by its width.
    const thirdSpan = third?.location.span ?? [0, 0];
    expect(dec(bytes.slice(thirdSpan[0], thirdSpan[1]))).toBe("- [advice] Pinch the tips.é");
    expect(thirdSpan[1] - thirdSpan[0]).toBe("- [advice] Pinch the tips.".length + 2);
    expect(page.occurrences[1]?.items).toHaveLength(3);
    expect(page.occurrences[2]?.items).toEqual([]);
    expect(page.occurrences[3]?.items.map((i) => (i.kind === "entry" ? i.precision : ""))).toEqual([
      "day",
      "month",
    ]);
    expect(
      page.occurrences[4]?.items.map((i) => (i.kind === "relation" ? i.target : undefined)),
    ).toEqual([
      {
        name: "Herb bed",
        heading: null,
        alias: null,
        path: "wiki/herb-bed.md",
        resolved: true,
        type: "garden/bed",
      },
      { name: "Tomato", heading: null, alias: "tomatoes", path: null, resolved: false, type: null },
    ]);
  });

  it("reports each top-level item that does not parse as item-unparsed", () => {
    expect(read("wiki/basil.md", BASIL).unparsed.map((u) => [u.heading, u.line, u.raw])).toEqual([
      ["Observations", 25, "* [advice] A star bullet."],
      ["Observations", 26, "- observed: not a claim"],
    ]);
  });

  it("keeps byte spans exact under CRLF and a byte-order mark", () => {
    const text = `﻿${BASIL.replaceAll("\n", "\r\n")}`;
    const bytes = enc(text);
    const page = read("wiki/basil.md", text);
    const item = page.occurrences[1]?.items[0];
    const [start, end] = item?.location.span ?? [0, 0];
    expect(dec(bytes.slice(start, end))).toBe(
      "- [observed] Basil bolts above 30 degrees. ([[Growing basil]])\r\n  - Seen twice in July.\r\n  - Both times after a dry week.",
    );
    expect(item?.rationale).toEqual([
      "  - Seen twice in July.",
      "  - Both times after a dry week.",
    ]);
  });

  it("refuses a __proto__ key: no inherited member satisfies the shape, and the digest moves", () => {
    const validate = law.validators.get("bed-note");
    const digest = (text: string) => {
      const page = read("wiki/note.md", text);
      return buildPageInterface(page, law.types.get("bed-note") as LawType)["digest"];
    };
    const plain = "---\ntype: bed-note\n---\n";
    const hidden = (title: string) => `---\ntype: bed-note\n__proto__:\n  title: ${title}\n---\n`;
    const page = read("wiki/note.md", hidden("A"));
    expect(page.frontmatterError).toBe('the key "__proto__" is refused');
    expect(Object.getPrototypeOf(page.frontmatter)).toBe(Object.prototype);
    expect("title" in page.frontmatter).toBe(false);
    expect(validate?.(page.frontmatter)).toBe(false);
    const digests = new Set([digest(plain), digest(hidden("A")), digest(hidden("B"))]);
    expect(digests.size).toBe(3);
  });

  it("refuses a page over 1 MiB as page-too-large", () => {
    const result = parsePage("wiki/big.md", new Uint8Array(1024 * 1024 + 1).fill(0x61), law);
    expect(result.ok ? undefined : result.code).toBe("page-too-large");
  });
});

describe("the page interface", () => {
  it("binds page with its identity, fields with the shape's defaults, and urls", () => {
    const note = read(
      "wiki/herb-bed-note.md",
      "---\ntype: bed-note\ntitle: Herb bed\nshop: HTTPS://Nursery.Example/Herbs?x=1\n---\n",
    );
    const page = buildPageInterface(note, note.type as LawType);
    expect(page).toMatchObject({
      path: "wiki/herb-bed-note.md",
      type: "bed-note",
      ancestry: [],
      role: "reference",
      frontmatter: { type: "bed-note", title: "Herb bed" },
      fields: { rows: 4n, ratio: 0.5 },
      urls: { shop: { scheme: "https", host: "nursery.example", path: "/Herbs" } },
    });
    expect("rows" in (page["frontmatter"] as object)).toBe(false);
    expect(page["digest"]).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("carries the planting's ancestry, role, and every section occurrence with int locations", () => {
    const basil = read("wiki/basil.md", BASIL);
    const page = buildPageInterface(basil, basil.type as LawType);
    expect([page["ancestry"], page["role"]]).toEqual([["garden/planting"], "procedure"]);
    const sections = page["sections"] as {
      location: { line: bigint; span: bigint[] };
      items: { location: { line: bigint } }[];
    }[];
    expect(sections).toHaveLength(5);
    expect(typeof sections[1]?.location.line).toBe("bigint");
    expect(typeof sections[1]?.items[0]?.location.line).toBe("bigint");
    expect((page["urls"] as Record<string, unknown>)["source"]).toEqual({
      scheme: "https",
      host: "seeds.example",
      path: "/Basil",
    });
  });

  it("builds facts: vocabularies, the page's links by normalised name, every type's ancestry", () => {
    const basil = read("wiki/basil.md", BASIL);
    const facts = buildFacts(law, basil, resolve) as {
      vocabularies: Record<string, string[]>;
      links: Record<string, unknown>;
      ancestry: Record<string, string[]>;
    };
    expect(facts.vocabularies["garden/relations"]).toEqual(["grows-in", "companion-of", "shades"]);
    expect(facts.links["herb bed"]).toEqual({
      resolved: true,
      path: "wiki/herb-bed.md",
      type: "garden/bed",
    });
    expect(facts.links["tomato"]).toEqual({ resolved: false, path: null, type: null });
    expect(facts.ancestry["planting"]).toEqual(["garden/planting"]);
    expect(facts.ancestry["garden/planting"]).toEqual([]);
  });

  it("keys facts.links by own property: a link to [[Constructor]] or [[__proto__]] is a link", () => {
    const page = read(
      "wiki/links.md",
      "---\ntype: bed-note\n---\n[[Constructor]] [[__proto__]] [[Basil]]\n",
    );
    const links = buildFacts(law, page)["links"] as Record<string, unknown>;
    expect(Object.keys(links)).toEqual(["constructor", "__proto__", "basil"]);
    expect(Object.getPrototypeOf(links)).toBe(Object.prototype);
  });

  it("binds before as absent with no base, and as the base's page and sections with one", () => {
    expect(buildBefore(undefined)).toEqual({ present: false });
    const base = read("wiki/basil.md", BASIL.replace("- 2026-05 — thinned\n", ""));
    const before = buildBefore({ parsed: base, type: base.type as LawType });
    expect(before["present"]).toBe(true);
    expect((before["sections"] as { items: unknown[] }[])[3]?.items).toHaveLength(1);
  });
});
