// v2 contracts §7: the digests — bytes, page.digest, content, law —
// byte-stable across two loads, and the law digest identical under the
// working tree and a git index holding the same bytes, for a bundle at the
// repository's top level and one in a subdirectory.
import { afterAll, describe, expect, it } from "bun:test";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildPageInterface,
  bytesDigest,
  canonicalJson,
  contentDigest,
  LAW_DEPENDENCIES,
  type LawSnapshot,
  lawDigest,
  lawLines,
  loadTypeLaw,
  pageDigest,
  parsePage,
  type TypeLaw,
} from "@wikiwright/core";
import { ENGINE_VERSION } from "../src/envelope.ts";
import { indexLawSnapshot, workingTreeLawSnapshot } from "../src/lawfiles.ts";
import {
  engineJson,
  gardenTree,
  gitStageAll,
  removeTree,
  type Tree,
  writeTree,
} from "./fixtures/garden-law.ts";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const made: string[] = [];
afterAll(() => {
  for (const dir of made) removeTree(dir);
});

function tree(overrides: Tree = {}): string {
  const dir = writeTree({ ...gardenTree(), ...overrides });
  made.push(dir);
  return dir;
}

function lawOf(snapshot: LawSnapshot): TypeLaw {
  const result = loadTypeLaw(snapshot);
  if (!result.ok) throw new Error(JSON.stringify(result.issues, null, 2));
  return result.law;
}

const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const enc = (text: string) => new TextEncoder().encode(text);

describe("bytes", () => {
  it("is sha256 over the file's bytes as they are", () => {
    for (const bytes of [
      new Uint8Array(),
      enc("---\ntype: planting\n---\n"),
      new Uint8Array(randomBytes(70_001)),
    ]) {
      expect(bytesDigest(bytes)).toBe(sha(bytes));
    }
    // Not UTF-8, digested all the same: no decoding sits between.
    const latin1 = new Uint8Array([0x63, 0x61, 0x66, 0xe9]);
    expect(bytesDigest(latin1)).toBe(sha(latin1));
  });
});

describe("content", () => {
  it("aggregates <path>\\0<bytes>\\n lines sorted by UTF-8 bytes", () => {
    const pages = [
      { path: "wiki/Ａ.md", bytes: enc("a") },
      { path: "wiki/\u{1F331}.md", bytes: enc("b") },
      { path: "wiki/basil.md", bytes: enc("c") },
    ];
    // By UTF-8 bytes the four-byte seedling sorts after the full-width A; by
    // code units it would sort before it.
    const lines = [pages[2], pages[0], pages[1]].map(
      (p) => `${p?.path}\u0000${sha(p?.bytes ?? enc(""))}\n`,
    );
    expect(contentDigest(pages)).toBe(sha(lines.join("")));
    expect(contentDigest([...pages].reverse())).toBe(contentDigest(pages));
  });
});

describe("page.digest", () => {
  const body = enc("\n# Basil\n");
  it("is canonical: key order and spelling do not move it; a meta key does not; a field does", () => {
    const a = pageDigest(
      { type: "planting", title: "Basil", count: 12n, tags: ["herbs"] },
      [],
      body,
    );
    const b = pageDigest(
      { tags: ["herbs"], count: 12n, title: "Basil", type: "planting" },
      [],
      body,
    );
    expect(a).toBe(b);
    const stamped = pageDigest(
      { type: "planting", title: "Basil", count: 12n, tags: ["herbs"], updated: "2026-09-26" },
      ["updated"],
      body,
    );
    expect(stamped).toBe(a);
    expect(
      pageDigest({ type: "planting", title: "Basil", count: 13n, tags: ["herbs"] }, [], body),
    ).not.toBe(a);
    expect(
      pageDigest(
        { type: "planting", title: "Basil", count: 12n, tags: ["herbs"] },
        [],
        enc("\n# Basil!\n"),
      ),
    ).not.toBe(a);
  });

  it("serialises YAML 1.2 core values with integers as written and keys sorted by code unit", () => {
    expect(
      canonicalJson({ b: [1n, 1.5, true, null], a: { z: "x", é: 12345678901234567890n } }),
    ).toBe('{"a":{"z":"x","é":12345678901234567890},"b":[1,1.5,true,null]}');
    const expected = sha(
      new Uint8Array([...enc('{"title":"Basil","type":"planting"}'), 0, ...body]),
    );
    expect(pageDigest({ type: "planting", title: "Basil" }, [], body)).toBe(expected);
  });

  it("takes the raw frontmatter bytes when the frontmatter does not parse", () => {
    const raw = enc("type: [planting\n");
    expect(pageDigest(raw, [], body)).toBe(sha(new Uint8Array([...raw, 0, ...body])));
  });

  it("is what the page interface binds, with the type's meta removed", async () => {
    const dir = tree();
    const law = lawOf(await workingTreeLawSnapshot(dir));
    const text = (updated: string) =>
      `---\ntype: planting\ntitle: Basil\nbed: herb\nsown: 2026-04-12\nupdated: ${updated}\n---\n\n# Basil\n`;
    const read = (t: string) => {
      const result = parsePage("wiki/basil.md", enc(t), law);
      if (!result.ok) throw new Error(result.message);
      return result.page;
    };
    const first = read(text("2026-05-01"));
    const second = read(text("2026-06-01"));
    const digest = (p: typeof first) => buildPageInterface(p, p.type as never)["digest"];
    expect(digest(first)).toBe(digest(second));
    expect(digest(first)).toBe(
      pageDigest(
        { type: "planting", title: "Basil", bed: "herb", sown: "2026-04-12" },
        [],
        enc("\n# Basil\n"),
      ),
    );
  });
});

describe("law", () => {
  it("is taken over every file the loader read, the identities, the dependencies and the engine", async () => {
    const law = lawOf(await workingTreeLawSnapshot(tree()));
    const lines = lawLines(law, ENGINE_VERSION);
    const files = lines.filter(
      (l) => !["profile", "dep", "engine"].includes(l.split("\u0000")[0] ?? ""),
    );
    expect(files.map((l) => l.slice(0, l.indexOf("\u0000")))).toEqual([
      "bundle:config/engine.json",
      "bundle:constitution/types/guide.yaml",
      "bundle:constitution/types/planting.yaml",
      "bundle:constitution/vocabularies/relations.yaml",
      "bundle:constitution/vocabularies/tags.yaml",
      "bundle:examples/planting.md",
      "bundle:rule-tests/source-host-allowed/negative.md",
      "garden:fragments/planted.yaml",
      "garden:rule-tests/known-bed/expect.json",
      "garden:rule-tests/known-bed/negative.md",
      "garden:types/bed.yaml",
      "garden:types/planting.yaml",
      "garden:vocabularies/beds.yaml",
      "garden:vocabularies/observations.yaml",
      "garden:vocabularies/relations.yaml",
    ]);
    expect(lines.slice(files.length)).toEqual([
      "profile\u0000page-interface/3\n",
      "profile\u0000cel-profile/1\n",
      "dep\u0000@bufbuild/cel@0.6.1\n",
      "dep\u0000@bufbuild/re2@0.6.1\n",
      "dep\u0000@bufbuild/cel-spec@0.6.1\n",
      "dep\u0000@bufbuild/protobuf@2.15.0\n",
      "dep\u0000ajv@8.20.0\n",
      `dep\u0000yaml@${LAW_DEPENDENCIES["yaml"]}\n`,
      `dep\u0000mdast-util-from-markdown@${LAW_DEPENDENCIES["mdast-util-from-markdown"]}\n`,
      `dep\u0000micromark@${LAW_DEPENDENCIES["micromark"]}\n`,
      `engine\u0000${ENGINE_VERSION}\n`,
    ]);
    expect(lawDigest(law, ENGINE_VERSION)).toBe(sha(lines.join("")));
    expect(lawDigest(law, "0.2.0")).not.toBe(lawDigest(law, ENGINE_VERSION));
  });

  it("names the versions the lockfile installs", () => {
    const lock = readFileSync(join(REPO, "bun.lock"), "utf8");
    for (const [name, version] of Object.entries(LAW_DEPENDENCIES)) {
      expect(lock.includes(`"${name}": ["${name}@${version}"`)).toBe(true);
    }
  });

  it("is byte-stable across two loads, and the same under the working tree and the index", async () => {
    for (const [overrides, bundle] of [
      [{}, ""],
      [
        {
          "config/engine.json": undefined,
          "handbook/config/engine.json": engineJson(),
          ...Object.fromEntries(
            Object.entries(gardenTree())
              .filter(
                ([p]) =>
                  p.startsWith("constitution/") ||
                  p.startsWith("rule-tests/") ||
                  p.startsWith("examples/"),
              )
              .flatMap(([p, t]) => [
                [p, undefined],
                [`handbook/${p}`, t],
              ]),
          ),
        },
        "handbook",
      ],
    ] as [Record<string, string | undefined>, string][]) {
      const files = { ...gardenTree(), ...overrides } as Record<string, string | undefined>;
      const kept = Object.fromEntries(
        Object.entries(files).filter(([, t]) => t !== undefined),
      ) as Tree;
      const dir = writeTree(kept);
      made.push(dir);
      gitStageAll(dir);
      const root = bundle === "" ? dir : join(dir, bundle);
      const first = lawDigest(lawOf(await workingTreeLawSnapshot(root)), ENGINE_VERSION);
      const second = lawDigest(lawOf(await workingTreeLawSnapshot(root)), ENGINE_VERSION);
      const staged = lawDigest(lawOf(await indexLawSnapshot(root)), ENGINE_VERSION);
      expect(second).toBe(first);
      expect(staged).toBe(first);
    }
  });

  it("moves with a rule test's bytes and with library.yaml; an unstaged edit moves only the tree's", async () => {
    const dir = tree();
    gitStageAll(dir);
    const base = lawDigest(lawOf(await workingTreeLawSnapshot(dir)), ENGINE_VERSION);
    writeFileSync(
      join(dir, "libraries/kit-garden/rule-tests/known-bed/negative.md"),
      "---\ntype: garden/planting\n---\n",
    );
    expect(lawDigest(lawOf(await workingTreeLawSnapshot(dir)), ENGINE_VERSION)).not.toBe(base);
    expect(lawDigest(lawOf(await indexLawSnapshot(dir)), ENGINE_VERSION)).toBe(base);
    const declared = tree({
      "libraries/kit-garden/library.yaml": "id: garden\n",
    });
    const withFile = lawDigest(lawOf(await workingTreeLawSnapshot(declared)), ENGINE_VERSION);
    expect(withFile).not.toBe(base);
  });
});
