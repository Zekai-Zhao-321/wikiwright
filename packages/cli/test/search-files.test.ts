// docs/cli.md §search (`--files`: every page with a match, unranked and
// uncapped; `--band`: one band of the ranked results). Run on the two gardening
// handbooks and on a temporary bundle of gardening claims.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { PINNED_CLOCK } from "./fixtures/clock.ts";
import { claimsBundle, lineSearch, RECALL_QUERIES } from "./fixtures/garden-claims.ts";

const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));
const HANDBOOKS = fileURLToPath(new URL("../../../fixtures/handbooks/", import.meta.url));
const ORCHARD = join(HANDBOOKS, "orchard");
const ALLOTMENT = join(HANDBOOKS, "allotment");

interface Envelope {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: { code: string; details?: Record<string, unknown> };
}

interface FilesData {
  files: { path: string; match_reasons: string[] }[];
  coverage: { tiers_executed: string[]; caps: { limit: null; found: number; hit: boolean } };
}

interface PagesData {
  results: { path: string; band: string; match_reasons: string[] }[];
  coverage: { caps: { limit: number; found: number; hit: boolean } };
}

function run(root: string, argv: readonly string[]): { status: number; envelope: Envelope } {
  const r = spawnSync(process.execPath, [CLI, "search", ...argv, "--root", root], {
    encoding: "utf8",
    env: { ...process.env, ...PINNED_CLOCK },
  });
  return { status: r.status ?? -1, envelope: JSON.parse(r.stdout) as Envelope };
}

function data<T>(root: string, argv: readonly string[]): T {
  const r = run(root, argv);
  assert.equal(r.status, 0, JSON.stringify(r.envelope));
  return r.envelope.data as T;
}

let tmp = "";
let garden = "";
before(() => {
  tmp = mkdtempSync(join(tmpdir(), "ww-files-"));
  garden = claimsBundle(tmp);
});
after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("search --files lists every page with a match (docs/cli.md §search)", () => {
  it("path and reasons only, in code-unit order, uncapped, covering every page the ranked search finds", () => {
    const files = data<FilesData>(ORCHARD, ["roses", "--files", "--limit", "1"]);
    const paths = files.files.map((f) => f.path);
    assert.deepEqual(paths, [...paths].sort());
    for (const row of files.files) assert.deepEqual(Object.keys(row), ["path", "match_reasons"]);
    assert.deepEqual(files.coverage.caps, { limit: null, found: paths.length, hit: false });
    assert.equal(files.coverage.tiers_executed.includes("text:contains"), true);
    const ranked = data<PagesData>(ORCHARD, ["roses", "--all"]);
    for (const result of ranked.results)
      assert.equal(paths.includes(result.path), true, result.path);
    assert.ok(paths.length > 1, "the cap asked for does not apply");
  });

  it("a multi-word query lists a page that holds any one of its terms", () => {
    const files = data<FilesData>(garden, ["codling beans", "--files"]);
    assert.deepEqual(
      files.files.map((f) => f.path),
      ["wiki/Apple tree.md", "wiki/South bed.md"],
    );
  });

  it("with no query, it lists the pages the filters keep", () => {
    const files = data<FilesData>(garden, ["--type", "plant", "--files"]);
    assert.deepEqual(
      files.files.map((f) => [f.path, f.match_reasons]),
      [
        ["wiki/Apple tree.md", ["filter:match"]],
        ["wiki/Climbing rose.md", ["filter:match"]],
      ],
    );
  });

  it("refuses --items and --near beside it", () => {
    for (const argv of [
      ["aphids", "--files", "--items"],
      ["aphids", "--files", "--near"],
    ]) {
      const r = run(garden, argv);
      assert.equal(r.status, 2, JSON.stringify(r.envelope));
      assert.equal(r.envelope.error?.code, "invalid-arguments");
    }
  });
});

describe("--files lists what a line search lists (the recall comparison)", () => {
  for (const terms of RECALL_QUERIES) {
    it(`"${terms.join(" ")}" over the claims bundle and both handbooks`, () => {
      for (const [name, root] of [
        ["garden", () => garden],
        ["orchard", () => ORCHARD],
        ["allotment", () => ALLOTMENT],
      ] as const) {
        const listed = data<FilesData>(root(), [terms.join(" "), "--files"]).files.map(
          (f) => f.path,
        );
        const found = [...new Set(lineSearch(root(), terms).map((hit) => hit.path))].sort();
        assert.deepEqual(listed, found, name);
      }
    });
  }
});

describe("search --band keeps one band (docs/cli.md §search)", () => {
  it("identity keeps the pages the query names, relevance the rest, in their ranked order", () => {
    const every = data<PagesData>(ORCHARD, ["pruning-roses", "--all"]);
    const identity = data<PagesData>(ORCHARD, ["pruning-roses", "--band", "identity", "--all"]);
    const relevance = data<PagesData>(ORCHARD, ["pruning-roses", "--band", "relevance", "--all"]);
    assert.deepEqual(
      identity.results.map((r) => r.path),
      ["wiki/pruning-roses.md"],
    );
    assert.ok(identity.results.every((r) => r.band === "identity"));
    assert.ok(relevance.results.length > 0);
    assert.ok(relevance.results.every((r) => r.band === "relevance"));
    assert.deepEqual(
      [...identity.results, ...relevance.results].map((r) => r.path),
      every.results.map((r) => r.path),
    );
    // The cap counts the kept band.
    assert.equal(identity.coverage.caps.found, 1);
  });

  it("an unknown band is refused with the bands there are", () => {
    const r = run(ORCHARD, ["roses", "--band", "exact"]);
    assert.equal(r.status, 2, JSON.stringify(r.envelope));
    assert.equal(r.envelope.error?.code, "invalid-value");
    assert.deepEqual(r.envelope.error?.details?.["valid_values"], ["identity", "relevance"]);
  });

  it("refuses --items beside it: an item has no band", () => {
    const r = run(garden, ["aphids", "--band", "relevance", "--items"]);
    assert.equal(r.status, 2, JSON.stringify(r.envelope));
    assert.equal(r.envelope.error?.code, "invalid-arguments");
  });
});
