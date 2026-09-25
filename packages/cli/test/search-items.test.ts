// docs/cli.md §search (`--items`: the grammar items themselves) — the items the
// judge would see, ranked by the one lexical machinery, each with its line,
// section, kind, grammar and the grammar's own fields. Run on the two gardening
// handbooks, whose sections declare no grammar, and on a temporary bundle of
// gardening claims.
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { PINNED_CLOCK } from "./fixtures/clock.ts";
import { claimsBundle, itemLinesOf, lineSearch, RECALL_QUERIES } from "./fixtures/garden-claims.ts";
import { runCli } from "./fixtures/runtime.ts";

const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));
const HANDBOOKS = fileURLToPath(new URL("../../../fixtures/handbooks/", import.meta.url));

interface Item {
  path: string;
  line: number;
  section: string;
  kind: string;
  grammar: string;
  raw: string;
  rationale: { line: number; text: string }[];
  matched_in: string;
  fields: Record<string, unknown>;
  score: number;
  match_reasons: string[];
}

interface ItemData {
  results: Item[];
  coverage: {
    tiers_executed: string[];
    corpus_size: number;
    pages_considered: number;
    items_considered: number;
    caps: { limit: number; found: number; hit: boolean };
  };
}

function run(
  root: string,
  argv: readonly string[],
): { status: number; envelope: Record<string, unknown> } {
  const r = runCli([CLI, ...argv, "--root", root], {
    encoding: "utf8",
    env: { ...process.env, ...PINNED_CLOCK },
  });
  return { status: r.status ?? -1, envelope: JSON.parse(r.stdout) as Record<string, unknown> };
}

function items(root: string, argv: readonly string[]): ItemData {
  const r = run(root, ["search", ...argv, "--items"]);
  assert.equal(r.status, 0, JSON.stringify(r.envelope));
  return r.envelope["data"] as ItemData;
}

let tmp = "";
let garden = "";
let orchard = "";
before(() => {
  tmp = mkdtempSync(join(tmpdir(), "ww-items-"));
  garden = claimsBundle(tmp);
  orchard = join(tmp, "orchard");
  cpSync(join(HANDBOOKS, "orchard"), orchard, { recursive: true });
});
after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("search --items ranks the grammar items themselves (docs/cli.md §search)", () => {
  it("the temporary claims bundle lints clean, so every item below is one the judge accepts", () => {
    const r = run(garden, ["lint"]);
    assert.equal(r.status, 0, JSON.stringify(r.envelope));
  });

  it("an entity in two claims on two pages returns both, each with its handle and fields", () => {
    const data = items(garden, ["aphids", "--type", "plant"]);
    // Ranked by BM25 over each item's line and rationale; the order is the
    // score's, so the two are read by where they are.
    assert.deepEqual(
      data.results.map((i) => [i.path, i.line, i.section, i.kind, i.grammar]).sort(),
      [
        ["wiki/Apple tree.md", 15, "Facts", "claim", "claims"],
        ["wiki/Climbing rose.md", 14, "Facts", "claim", "claims"],
      ],
    );
    const rose = data.results.find((i) => i.path === "wiki/Climbing rose.md");
    const apple = data.results.find((i) => i.path === "wiki/Apple tree.md");
    assert.ok(rose !== undefined && apple !== undefined);
    assert.equal(
      rose.raw,
      "[pest] Aphids gather on the new shoots in late spring (stated 2026-05-02)",
    );
    assert.match(String(rose.fields["handle"]), /^#[0-9a-f]{8}$/u);
    assert.equal(rose.fields["category"], "pest");
    assert.equal(rose.fields["kind"], "claim");
    // The envelope is the kernel's and is not repeated inside the grammar's fields.
    for (const key of ["line", "raw", "rationale"]) assert.equal(key in rose.fields, false, key);
    assert.deepEqual(rose.match_reasons, ["lexical:bm25"]);
    assert.equal(rose.matched_in, "core");
    // The apple's claim names aphids only in the rationale line under it.
    assert.equal(apple.matched_in, "rationale");
    assert.deepEqual(apple.rationale, [
      { line: 16, text: "Crowded clusters invite aphids and give small apples." },
    ]);
    assert.match(String(apple.fields["handle"]), /^#[0-9a-f]{8}$/u);
    assert.ok(rose.score > 0 && apple.score > 0);
  });

  it("--type narrows the pages the items come from, and the coverage block counts both", () => {
    const every = items(garden, ["aphids"]);
    assert.deepEqual(every.results.map((i) => i.path).sort(), [
      "wiki/Apple tree.md",
      "wiki/Climbing rose.md",
      "wiki/South bed.md",
    ]);
    assert.deepEqual(every.coverage.tiers_executed, ["lexical:bm25", "text:contains"]);
    assert.equal(every.coverage.corpus_size, 3);
    assert.equal(every.coverage.pages_considered, 3);
    // Three claims and a relation on the rose, three claims on the apple, one on the bed.
    assert.equal(every.coverage.items_considered, 8);
    const plants = items(garden, ["aphids", "--type", "plant"]);
    assert.equal(plants.coverage.pages_considered, 2);
    assert.equal(plants.coverage.items_considered, 7);
    const beds = items(garden, ["aphids", "--type", "bed"]);
    assert.deepEqual(
      beds.results.map((i) => i.path),
      ["wiki/South bed.md"],
    );
  });

  it("a relation is an item too, with the relations grammar's own fields", () => {
    const data = items(garden, ["apple", "--type", "plant"]);
    const relation = data.results.find((i) => i.kind === "relation");
    assert.ok(relation !== undefined, JSON.stringify(data.results));
    assert.equal(relation.section, "Relations");
    assert.equal(relation.grammar, "relations");
    assert.equal(relation.raw, "grows_near [[Apple tree]]");
    assert.equal(relation.fields["label"], "grows_near");
  });

  it("a term inside a longer word is found as a line search finds it, after the ranked items", () => {
    const data = items(garden, ["aphid"]);
    assert.deepEqual(
      data.results.map((i) => [i.path, i.line, i.match_reasons]),
      [
        ["wiki/Apple tree.md", 15, ["text:contains"]],
        ["wiki/Climbing rose.md", 14, ["text:contains"]],
        ["wiki/South bed.md", 14, ["text:contains"]],
      ],
    );
    assert.ok(data.results.every((i) => i.score === 0));
  });

  it("a page with no grammar section contributes no item", () => {
    const data = items(orchard, ["roses"]);
    assert.deepEqual(data.results, []);
    assert.equal(data.coverage.pages_considered, 3);
    assert.equal(data.coverage.items_considered, 0);
  });

  it("the cap applies, and --all lifts it", () => {
    const capped = items(garden, ["summer spring", "--limit", "1"]);
    assert.equal(capped.results.length, 1);
    // Late spring and early summer on the rose; early summer and mid spring on the apple.
    assert.deepEqual(capped.coverage.caps, { limit: 1, found: 4, hit: true });
    const all = items(garden, ["summer spring", "--limit", "1", "--all"]);
    assert.equal(all.results.length, 4);
    assert.equal(all.coverage.caps.hit, false);
  });

  it("--items needs a query, and refuses --near", () => {
    const bare = run(garden, ["search", "--items", "--type", "plant"]);
    assert.equal(bare.status, 2, JSON.stringify(bare.envelope));
    assert.equal((bare.envelope["error"] as { code: string }).code, "missing-argument");
    const near = run(garden, ["search", "aphids", "--items", "--near"]);
    assert.equal(near.status, 2, JSON.stringify(near.envelope));
    assert.equal((near.envelope["error"] as { code: string }).code, "invalid-arguments");
  });
});

describe("--items finds every item line a line search finds (the recall comparison)", () => {
  for (const terms of RECALL_QUERIES) {
    it(`"${terms.join(" ")}" over the claims bundle and both handbooks`, () => {
      const roots: [string, string][] = [
        ["garden", garden],
        ["orchard", orchard],
        ["allotment", join(HANDBOOKS, "allotment")],
      ];
      for (const [name, root] of roots) {
        const found = new Set(
          items(root, [terms.join(" "), "--all"]).results.map((i) => `${i.path}:${i.line}`),
        );
        const missing: string[] = [];
        for (const hit of lineSearch(root, terms)) {
          const item = itemLinesOf(root, hit.path).get(hit.line);
          if (item === undefined) continue;
          if (!found.has(`${hit.path}:${item}`)) missing.push(`${hit.path}:${hit.line}`);
        }
        assert.deepEqual(
          missing,
          [],
          `${name}: lines the line search finds on items that --items missed`,
        );
      }
    });
  }
});

describe("search --items demotes a retired page's items (docs/cli.md §search)", () => {
  it("halves the item's score and names the demotion, as a retired page's own", () => {
    const parent = join(tmp, "retired");
    mkdirSync(parent);
    const retired = claimsBundle(parent);
    const bed = join(retired, "wiki", "South bed.md");
    writeFileSync(
      bed,
      readFileSync(bed, "utf8").replace("tags: []\n", "tags: []\nstatus: retired\n"),
    );
    const scoreOf = (data: ItemData): Item | undefined =>
      data.results.find((r) => r.path === "wiki/South bed.md");
    const active = scoreOf(items(garden, ["aphids"]));
    const demoted = scoreOf(items(retired, ["aphids"]));
    assert.ok(active !== undefined && demoted !== undefined);
    // The pages' items are the same, so the statistics are too: only the
    // demotion moves the score.
    assert.ok(
      Math.abs(demoted.score - active.score / 2) <= 1e-6,
      `${demoted.score} ${active.score}`,
    );
    assert.deepEqual(active.match_reasons, ["lexical:bm25"]);
    assert.deepEqual(demoted.match_reasons, ["lexical:bm25", "status:retired"]);
  });
});
