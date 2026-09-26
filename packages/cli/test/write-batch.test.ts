// v2 contracts §9.3: `write --from <dir> [--dry-run]` over a synthetic
// gardening bundle under os.tmpdir() — ops.json's bases and its four
// operations applied in order, then the drafts; `created` and `updated`
// stamped through the clock seam (the navigator's ruling 7); the batch judged
// together with the disk as its base, landing whole or not at all; a move
// rewriting the links that name the page; the dry run's plan the real run's
// delta.
import { afterAll, describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { bytesDigest, claimHandle } from "@wikiwright/core";
import { landBatch } from "../src/writer.ts";
import { TODAY } from "./fixtures/clock.ts";
import { cleanBundles, cli, findingsOf, gardenBundle } from "./fixtures/garden-cli.ts";
import { removeTree } from "./fixtures/garden-law.ts";

const scratch: string[] = [];
afterAll(() => {
  cleanBundles();
  for (const dir of scratch) removeTree(dir);
});

/** A drafts directory: vault-mirroring pages, and ops.json when given. */
function drafts(pages: Record<string, string>, ops?: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "ww-drafts-"));
  scratch.push(dir);
  for (const [path, text] of Object.entries(pages)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  if (ops !== undefined) writeFileSync(join(dir, "ops.json"), JSON.stringify(ops));
  return dir;
}

function page(dir: string, path: string): string {
  return readFileSync(join(dir, path), "utf8");
}

function snapshot(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const entry of readdirSync(dir, { recursive: true, encoding: "utf8" })) {
    const rel = entry.replaceAll("\\", "/");
    try {
      out.set(rel, readFileSync(join(dir, rel), "utf8"));
    } catch {
      // A directory.
    }
  }
  return out;
}

function delta(before: Map<string, string>, after: Map<string, string>): string[] {
  const paths = new Set([...before.keys(), ...after.keys()]);
  return [...paths].filter((p) => before.get(p) !== after.get(p)).sort();
}

/** Basil with one more History entry: a change the append-only ledger admits. */
function thinned(dir: string): string {
  return page(dir, "wiki/Basil.md").replace(
    "- 2026-04-12 — sown",
    "- 2026-04-12 — sown\n- 2026-05-01 — thinned",
  );
}

const TOUR = "---\ntype: guide\ntitle: Tour\n---\n\n# Tour\n\n## Start here\n\nSee [[Basil]].\n";
const CLAIM = "Basil bolts above thirty degrees.";
const HANDLE = claimHandle(CLAIM);

describe("drafts (v2 contracts §9.3)", () => {
  it("creates a page, stamping created and updated, and plans exactly what it lands", () => {
    const dir = gardenBundle();
    const from = drafts({ "wiki/Tour.md": TOUR });
    const before = snapshot(dir);
    const dry = cli(["write", "--from", from, "--dry-run"], dir);
    expect(dry.status).toBe(0);
    expect(dry.envelope.data?.["wrote"]).toBe(false);
    expect(delta(before, snapshot(dir))).toEqual([]);
    const planned = (dry.envelope.data?.["ops"] ?? []) as { kind: string; path: string }[];
    expect(planned.map((o) => [o.kind, o.path])).toEqual([["create", "wiki/Tour.md"]]);
    const r = cli(["write", "--from", from], dir);
    expect(r.status).toBe(0);
    expect(r.envelope.data?.["wrote"]).toBe(true);
    expect(delta(before, snapshot(dir))).toEqual(["wiki/Tour.md"]);
    const tour = page(dir, "wiki/Tour.md");
    expect(tour).toContain(`created: ${TODAY}`);
    expect(tour).toContain(`updated: ${TODAY}`);
    const row = ((r.envelope.data?.["pages"] ?? []) as Record<string, unknown>[])[0] ?? {};
    expect(row["created"]).toBe(true);
    expect(row["digest"]).toEqual({
      before: null,
      after: bytesDigest(new Uint8Array(readFileSync(join(dir, "wiki/Tour.md")))),
    });
  });

  it("stamps updated, and never created, on a page that changes", () => {
    const dir = gardenBundle();
    expect(cli(["write", "--from", drafts({ "wiki/Basil.md": thinned(dir) })], dir).status).toBe(0);
    expect(page(dir, "wiki/Basil.md")).toContain(`updated: ${TODAY}`);
    expect(page(dir, "wiki/Basil.md")).not.toContain("created:");
  });

  it("refuses the whole batch on an error on any page it touches, and lands none of it", () => {
    const dir = gardenBundle();
    const before = snapshot(dir);
    const from = drafts({
      "wiki/Tour.md": TOUR,
      "wiki/Bad.md": "---\ntype: guide\ntitle: Bad\ntags: [weeds]\n---\n\n# Bad\n\n## Start here\n",
    });
    const r = cli(["write", "--from", from], dir);
    expect(r.status).toBe(5);
    expect(r.envelope.error?.code).toBe("draft-invalid");
    expect(findingsOf(r.envelope, "vocabulary-unknown").map((f) => f.path)).toEqual([
      "wiki/Bad.md",
    ]);
    expect(delta(before, snapshot(dir))).toEqual([]);
  });

  it("judges against the disk as the base: a relation that leaves unrecorded is refused", () => {
    const dir = gardenBundle();
    const basil = page(dir, "wiki/Basil.md").replace("- grows-in [[Herb bed]]\n", "");
    const r = cli(["write", "--from", drafts({ "wiki/Basil.md": basil })], dir);
    expect(r.status).toBe(5);
    expect(findingsOf(r.envelope, "relation-removed").map((f) => f.path)).toEqual([
      "wiki/Basil.md",
    ]);
  });

  it("refuses an identity collision the batch causes, on the page it collides with", () => {
    const dir = gardenBundle();
    const before = snapshot(dir);
    // "wiki/Annuals/Basil.md" sorts before "wiki/Basil.md": the collision is
    // reported on the page already on disk, which the batch does not touch.
    const r = cli(
      ["write", "--from", drafts({ "wiki/Annuals/Basil.md": page(dir, "wiki/Basil.md") })],
      dir,
    );
    expect(r.status).toBe(5);
    expect(r.envelope.error?.code).toBe("draft-invalid");
    expect([...new Set(findingsOf(r.envelope, "identity-collision").map((f) => f.path))]).toEqual([
      "wiki/Basil.md",
    ]);
    expect(r.envelope.data?.["failing"]).toEqual(["wiki/Basil.md"]);
    expect(delta(before, snapshot(dir))).toEqual([]);
  });

  it("refuses a page the batch makes invalid elsewhere, and a type pushed past its instances", () => {
    const dir = gardenBundle({
      "wiki/Basil.md": page(gardenBundle(), "wiki/Basil.md").replace(
        "bed: herb",
        "bed: herb\norigin: Herb bed",
      ),
    });
    const retyped =
      "---\ntype: guide\ntitle: Herb bed\n---\n\n# Herb bed\n\n## Start here\n\nThe raised bed.\n";
    const r = cli(["write", "--from", drafts({ "wiki/Herb bed.md": retyped })], dir);
    expect(r.status).toBe(5);
    expect(findingsOf(r.envelope, "page-ref-type").map((f) => [f.path, f.details["kind"]])).toEqual(
      [["wiki/Basil.md", "type"]],
    );
    const bounded = gardenBundle({
      "constitution/types/guide.yaml": `${page(gardenBundle(), "constitution/types/guide.yaml")}instances: { min: 0, max: 1 }\n`,
    });
    const over = cli(["write", "--from", drafts({ "wiki/Tour.md": TOUR })], bounded);
    expect(over.status).toBe(5);
    expect(findingsOf(over.envelope, "instances-max").map((f) => f.details["count"])).toEqual([2]);
  });

  it("refuses a draft outside the content roots, and a directory that is not there", () => {
    const dir = gardenBundle();
    const outside = cli(["write", "--from", drafts({ "notes/x.md": TOUR })], dir);
    expect(outside.envelope.error?.code).toBe("draft-outside-content");
    expect(cli(["write", "--from", join(dir, "no-such")], dir).envelope.error?.code).toBe(
      "drafts-not-found",
    );
    expect(cli(["write"], dir).envelope.error?.code).toBe("missing-argument");
  });
});

describe("ops.json (v2 contracts §9.3)", () => {
  it("checks each recorded base against the disk's bytes", () => {
    const dir = gardenBundle();
    const digest = bytesDigest(new Uint8Array(readFileSync(join(dir, "wiki/Basil.md"))));
    const edited = thinned(dir);
    const stale = cli(
      [
        "write",
        "--from",
        drafts({ "wiki/Basil.md": edited }, { bases: { "wiki/Basil.md": "0".repeat(64) } }),
      ],
      dir,
    );
    expect(stale.status).toBe(4);
    expect(stale.envelope.error?.code).toBe("base-mismatch");
    expect(stale.envelope.error?.details).toEqual({
      path: "wiki/Basil.md",
      expected: "0".repeat(64),
      actual: digest,
    });
    const fresh = cli(
      [
        "write",
        "--from",
        drafts({ "wiki/Basil.md": edited }, { bases: { "wiki/Basil.md": digest } }),
      ],
      dir,
    );
    expect(fresh.status).toBe(0);
  });

  it("refuses an ops.json that is not one, with the pointer", () => {
    const dir = gardenBundle();
    const r = cli(["write", "--from", drafts({}, { rename: [] })], dir);
    expect(r.status).toBe(2);
    expect(r.envelope.error?.code).toBe("ops-invalid");
    expect(r.envelope.error?.details?.["pointer"]).toBe("/rename");
    const handle = cli(
      ["write", "--from", drafts({}, { retract: [{ path: "wiki/Basil.md", handle: "abc" }] })],
      dir,
    );
    expect(handle.envelope.error?.details?.["pointer"]).toBe("/retract/0/handle");
  });

  it("moves a page, keeps its old name as an alias, and rewrites every link that names it", () => {
    const dir = gardenBundle();
    const before = snapshot(dir);
    const from = drafts(
      {},
      {
        move: [
          { from: "wiki/Herb bed.md", to: "wiki/Raised bed.md", reason: "the bed was raised" },
        ],
      },
    );
    const dry = cli(["write", "--from", from, "--dry-run"], dir);
    expect(dry.status).toBe(0);
    const ops = (dry.envelope.data?.["ops"] ?? []) as {
      kind: string;
      path: string;
      from?: string;
    }[];
    expect(ops.map((o) => [o.kind, o.path, o.from])).toEqual([
      ["write", "wiki/Basil.md", undefined],
      ["rename", "wiki/Raised bed.md", "wiki/Herb bed.md"],
    ]);
    const r = cli(["write", "--from", from], dir);
    expect(r.status).toBe(0);
    expect(delta(before, snapshot(dir))).toEqual([
      "wiki/Basil.md",
      "wiki/Herb bed.md",
      "wiki/Raised bed.md",
    ]);
    expect(existsSync(join(dir, "wiki/Herb bed.md"))).toBe(false);
    expect(page(dir, "wiki/Raised bed.md")).toContain('aliases: ["Herb bed"]');
    const basil = page(dir, "wiki/Basil.md");
    expect(basil).toContain("([[Raised bed]])");
    expect(basil).toContain("- grows-in [[Raised bed]]");
    const [applied] = (r.envelope.data?.["operations"] ?? []) as {
      details: Record<string, unknown>;
    }[];
    expect(applied?.details).toEqual({
      from: "wiki/Herb bed.md",
      reason: "the bed was raised",
      aliased: true,
      rewritten_links: ["wiki/Basil.md"],
    });
  });

  it("refuses a move that changes only case, and one onto another page's case variant", () => {
    const dir = gardenBundle();
    const before = snapshot(dir);
    const only = drafts(
      {},
      { move: [{ from: "wiki/Basil.md", to: "wiki/basil.md", reason: "lower case" }] },
    );
    for (const args of [["--dry-run"], []]) {
      const r = cli(["write", "--from", only, ...args], dir);
      expect(r.status).toBe(4);
      expect(r.envelope.error?.code).toBe("move-case-only");
    }
    const onto = drafts(
      {},
      { move: [{ from: "wiki/Basil.md", to: "wiki/start.md", reason: "merge" }] },
    );
    const r = cli(["write", "--from", onto], dir);
    expect(r.envelope.error?.code).toBe("destination-exists");
    expect(r.envelope.error?.details?.["existing"]).toBe("wiki/Start.md");
    expect(delta(before, snapshot(dir))).toEqual([]);
    expect(page(dir, "wiki/Basil.md")).toContain("title: Basil");
  });

  it("refuses a draft on a path a move leaves, and a draft of a page an operation changes", () => {
    const dir = gardenBundle();
    const move = { move: [{ from: "wiki/Start.md", to: "wiki/Begin.md", reason: "clearer" }] };
    expect(
      cli(["write", "--from", drafts({ "wiki/Start.md": TOUR }, move)], dir).envelope.error?.code,
    ).toBe("draft-on-moved-path");
    const retire = { retire: [{ path: "wiki/Start.md", successor: null }] };
    expect(
      cli(["write", "--from", drafts({ "wiki/Start.md": TOUR }, retire)], dir).envelope.error?.code,
    ).toBe("draft-overlaps-op");
  });

  it("retires a page with its successor, and refuses a successor nothing names", () => {
    const dir = gardenBundle({ "wiki/Tour.md": TOUR });
    const r = cli(
      ["write", "--from", drafts({}, { retire: [{ path: "wiki/Start.md", successor: "tour" }] })],
      dir,
    );
    expect(r.status).toBe(0);
    const start = page(dir, "wiki/Start.md");
    expect(start).toContain("status: retired");
    expect(start).toContain("superseded_by: Tour");
    const missing = cli(
      ["write", "--from", drafts({}, { retire: [{ path: "wiki/Tour.md", successor: "Nowhere" }] })],
      dir,
    );
    expect(missing.status).toBe(3);
    expect(missing.envelope.error?.code).toBe("unknown-successor");
  });

  it("retracts a claim by its handle, dated by the clock seam or by the operation", () => {
    const dir = gardenBundle();
    const r = cli(
      ["write", "--from", drafts({}, { retract: [{ path: "wiki/Basil.md", handle: HANDLE }] })],
      dir,
    );
    expect(r.status).toBe(0);
    expect(page(dir, "wiki/Basil.md")).toContain(`${CLAIM} ([[Herb bed]]) (retracted ${TODAY})`);
    const again = cli(
      ["write", "--from", drafts({}, { retract: [{ path: "wiki/Basil.md", handle: HANDLE }] })],
      dir,
    );
    expect(again.status).toBe(4);
    expect(again.envelope.error?.code).toBe("claim-not-open");
    const none = cli(
      [
        "write",
        "--from",
        drafts({}, { retract: [{ path: "wiki/Basil.md", handle: "#00000000" }] }),
      ],
      dir,
    );
    expect(none.status).toBe(3);
    expect(none.envelope.error?.code).toBe("claim-not-found");
  });

  it("supersedes a claim by another, writing `by #handle` (the navigator's ruling 5)", () => {
    const replacement = "Basil bolts above thirty-two degrees.";
    const dir = gardenBundle();
    writeFileSync(
      join(dir, "wiki/Basil.md"),
      page(dir, "wiki/Basil.md").replace(
        `- [observed] ${CLAIM} ([[Herb bed]])`,
        `- [observed] ${CLAIM} ([[Herb bed]])\n- [measured] ${replacement} ([[Herb bed]])`,
      ),
    );
    const by = claimHandle(replacement);
    const r = cli(
      [
        "write",
        "--from",
        drafts(
          {},
          {
            supersede: [{ path: "wiki/Basil.md", handle: HANDLE, by, date: "2026-09-01" }],
          },
        ),
      ],
      dir,
    );
    expect(r.status).toBe(0);
    expect(page(dir, "wiki/Basil.md")).toContain(
      `${CLAIM} ([[Herb bed]]) (valid →2026-08-31, superseded 2026-09-01 by ${by})`,
    );
    // The clause parses under the grammar.
    expect(findingsOf(cli(["check", "--all"], dir).envelope, "item-unparsed")).toEqual([]);
  });
});

describe("the batch writer (v2 contracts §9.3)", () => {
  it("never removes the path a page just landed at, whatever the filesystem folds", () => {
    const root = mkdtempSync(join(tmpdir(), "ww-land-"));
    scratch.push(root);
    mkdirSync(join(root, "wiki"));
    writeFileSync(join(root, "wiki/Basil.md"), "old\n");
    landBatch(
      root,
      [{ path: "wiki/basil.md", bytes: new TextEncoder().encode("new\n") }],
      ["wiki/Basil.md"],
    );
    // Case-insensitive: one file, its new bytes kept. Case-sensitive: the new
    // path holds them and the old one is gone.
    expect(readFileSync(join(root, "wiki/basil.md"), "utf8")).toBe("new\n");
    expect(readdirSync(join(root, "wiki")).length).toBe(1);
  });
});
