// v2 contracts §9.5, §9.6: `read` and `search` over a synthetic gardening
// bundle under os.tmpdir() — a page named by path, name, alias or title, its
// sections under a budget and its bytes digest; and on `read` and on every
// `search` result the page's status: `stale` from its pins and the pins of
// the pages it links, measured live against the local repository, and
// `unresolved` from queue.md while queue.md's digests are the current ones.
import { afterAll, describe, expect, it } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { bytesDigest } from "@wikiwright/core";
import { cleanBundles, cli, commitAll, gardenBundle, git } from "./fixtures/garden-cli.ts";

afterAll(cleanBundles);

interface Status {
  stale: boolean | null;
  reason: string | null;
  unresolved: string[] | null;
  unresolved_reason: string | null;
}

function statusOf(dir: string, page: string): Status {
  return cli(["read", page], dir).envelope.data?.["status"] as Status;
}

const SOURCE_TYPE = `type: source
role: reference
description: A capture of a file in this repository.
fields:
  type: object
  properties:
    capture: { $ref: "#/$defs/pin" }
  required: [capture]
`;

function source(commit: string, origin = "."): string {
  return `---\ntype: source\ntitle: Seed list\ncapture:\n  commit: ${commit}\n  origin: "${origin}"\n  covers: [notes/seeds.txt]\n---\n\n# Seed list\n`;
}

describe("read (v2 contracts §9.5)", () => {
  it("names a page by path, name, alias or title, with its bytes digest", () => {
    const dir = gardenBundle({
      "wiki/Start.md": readFileSync(join(gardenBundle(), "wiki/Start.md"), "utf8").replace(
        "title: Start",
        "title: The way in\naliases: [Entrance]",
      ),
    });
    for (const [asked, via] of [
      ["wiki/Start.md", "path"],
      ["start", "name"],
      ["Entrance", "alias"],
      ["the way in", "title"],
    ]) {
      const r = cli(["read", asked ?? ""], dir);
      expect([
        asked,
        r.status,
        ((r.envelope.data?.["page"] ?? {}) as Record<string, unknown>)["resolved_via"],
      ]).toEqual([asked, 0, via]);
    }
    const r = cli(["read", "Basil"], dir);
    expect(r.envelope.data?.["bytes"]).toBe(
      bytesDigest(new Uint8Array(readFileSync(join(dir, "wiki/Basil.md")))),
    );
    expect(r.envelope.metadata.bundle?.["label"]).toBe("kitchen-garden");
    expect(cli(["read", "Rosemary"], dir).envelope.error?.code).toBe("page-not-found");
  });

  it("cuts the page at its type's sections and holds them to a budget", () => {
    const dir = gardenBundle();
    const history = cli(["read", "Basil", "--section", "history"], dir).envelope.data;
    const sections = (history?.["sections"] ?? []) as { heading: string; text: string }[];
    expect(sections.map((s) => [s.heading, s.text])).toEqual([
      ["History", "## History\n\n- 2026-04-12 — sown\n\n"],
    ]);
    const budgeted = cli(["read", "Basil", "--budget", "20"], dir).envelope.data;
    expect(((budgeted?.["omitted"] ?? []) as { heading: string }[]).map((s) => s.heading)).toEqual([
      "Observations",
      "History",
      "Relations",
    ]);
    expect(cli(["read", "Basil", "--section", "Harvest"], dir).envelope.error?.code).toBe(
      "section-not-found",
    );
  });

  it("names the queue's unresolved rules while queue.md is current, and queue-stale once it is not", () => {
    const dir = gardenBundle();
    expect(statusOf(dir, "Basil")).toMatchObject({
      unresolved: null,
      unresolved_reason: "queue-missing",
    });
    const basil = join(dir, "wiki/Basil.md");
    writeFileSync(
      basil,
      readFileSync(basil, "utf8").replace("title: Basil", "title: Basil\ntags: [weeds]"),
    );
    cli(["check", "--write"], dir);
    expect(statusOf(dir, "Basil")).toEqual({
      stale: false,
      reason: null,
      unresolved: ["vocabulary-unknown"],
      unresolved_reason: null,
    });
    expect(statusOf(dir, "Start").unresolved).toEqual([]);
    writeFileSync(
      join(dir, "wiki/Start.md"),
      `${readFileSync(join(dir, "wiki/Start.md"), "utf8")}\nMore.\n`,
    );
    expect(statusOf(dir, "Basil")).toMatchObject({
      unresolved: null,
      unresolved_reason: "queue-stale",
    });
  });

  it("is stale when a pin is, or a page it links carries a stale pin, and null when nothing measures it", () => {
    const dir = gardenBundle({
      "constitution/types/source.yaml": SOURCE_TYPE,
      "notes/seeds.txt": "basil\n",
      "wiki/Start.md": readFileSync(join(gardenBundle(), "wiki/Start.md"), "utf8").replace(
        "Read [[Basil]] first.",
        "Read [[Basil]] and [[Seed list]] first.",
      ),
    });
    commitAll(dir, "the garden");
    writeFileSync(join(dir, "wiki/Seed list.md"), source(git(dir, "rev-parse", "HEAD").trim()));
    commitAll(dir, "the capture");
    expect(statusOf(dir, "Seed list")).toMatchObject({ stale: false, reason: null });
    writeFileSync(join(dir, "notes/seeds.txt"), "basil\nmint\n");
    commitAll(dir, "mint");
    expect(statusOf(dir, "Seed list")).toMatchObject({ stale: true, reason: "pin-stale" });
    expect(statusOf(dir, "Start")).toMatchObject({ stale: true, reason: "stale-source-cited" });
    expect(statusOf(dir, "Basil")).toMatchObject({ stale: false, reason: null });
    writeFileSync(
      join(dir, "wiki/Seed list.md"),
      source("0123456789abcdef", "https://seeds.example/x.git"),
    );
    expect(statusOf(dir, "Seed list")).toMatchObject({ stale: null, reason: "remote-origin" });
  });
});

describe("search (v2 contracts §9.6)", () => {
  it("carries each result's status, for pages, records and files alike", () => {
    const dir = gardenBundle();
    cli(["check", "--write"], dir);
    const pages = cli(["search", "basil"], dir).envelope.data;
    const results = (pages?.["results"] ?? []) as { path: string; status: Status }[];
    expect(results[0]?.path).toBe("wiki/Basil.md");
    expect(results[0]?.status).toEqual({
      stale: false,
      reason: null,
      unresolved: [],
      unresolved_reason: null,
    });
    const items = cli(["search", "thirty degrees", "--items"], dir).envelope.data;
    const records = (items?.["results"] ?? []) as { path: string; kind: string; status: Status }[];
    expect(records.map((r) => [r.path, r.kind, r.status.stale])).toEqual([
      ["wiki/Basil.md", "claim", false],
    ]);
    const files = cli(["search", "herb bed", "--files"], dir).envelope.data;
    for (const file of (files?.["files"] ?? []) as { status?: Status }[])
      expect(file.status?.unresolved).toEqual([]);
  });

  it("matches a type and every type below it", () => {
    const dir = gardenBundle();
    const r = cli(["search", "--type", "garden/planting"], dir);
    expect(((r.envelope.data?.["results"] ?? []) as { path: string }[]).map((x) => x.path)).toEqual(
      ["wiki/Basil.md"],
    );
  });
});
