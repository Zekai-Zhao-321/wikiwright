import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  cleanBundles,
  cli,
  commitAll,
  findingsOf,
  gardenBundle,
  git,
} from "./fixtures/garden-cli.ts";
import { engineJson } from "./fixtures/garden-law.ts";

const made: string[] = [];
afterAll(() => {
  cleanBundles();
  for (const path of made) rmSync(path, { recursive: true, force: true });
});

const SOURCE_TYPE = `type: source
role: reference
description: A local Git capture.
fields:
  type: object
  properties:
    left: { $ref: "#/$defs/pin" }
    right: { $ref: "#/$defs/pin" }
  required: [left]
`;

function put(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

function pin(commit: string, origin: string, cover: string): string {
  return `  commit: ${commit}\n  origin: ${origin}\n  covers: [${cover}]\n`;
}

function page(left: string, body: string, right?: string): string {
  return `---\ntype: source\ntitle: Mixed\nleft:\n${left}${right === undefined ? "" : `right:\n${right}`}---\n\n# Mixed\n\n${body}\n`;
}

function entries(envelope: ReturnType<typeof cli>["envelope"]): {
  field: string;
  origin: string;
  citations: { checked: number; outside_scope: number; unresolved: unknown[] };
}[] {
  return ((envelope.data?.["pins"] as { entries: unknown[] } | undefined)?.entries ??
    []) as ReturnType<typeof entries>;
}

function fixture() {
  const left = mkdtempSync(join(tmpdir(), "ww-citation-left-"));
  const right = mkdtempSync(join(tmpdir(), "ww-citation-right-"));
  made.push(left, right);
  put(left, "owned/a.cs", "one\ntwo\n");
  put(left, "common/line.cs", "one\ntwo\n");
  put(right, "foreign/b.cs", "one\ntwo\n");
  put(right, "common/line.cs", "one\n");
  commitAll(left);
  commitAll(right);
  const leftCommit = git(left, "rev-parse", "HEAD").trim();
  const rightCommit = git(right, "rev-parse", "HEAD").trim();
  const dir = gardenBundle({
    "constitution/types/source.yaml": SOURCE_TYPE,
    "config/engine.json": engineJson({
      local_origins: [
        { name: "left", path: left },
        { name: "right", path: right },
      ],
    }),
    "wiki/Mixed.md": page(pin(leftCommit, "left", "owned/a.cs"), "`owned/a.cs:1`"),
  });
  return { dir, leftCommit, rightCommit };
}

describe("citations belong to a pin's covers", () => {
  it("checks each local origin's owned path and leaves foreign spans unverified", () => {
    const { dir, leftCommit, rightCommit } = fixture();
    put(
      dir,
      "wiki/Mixed.md",
      page(
        pin(leftCommit, "left", "owned/a.cs"),
        "`owned/a.cs:1` and `foreign/b.cs:2`.",
        pin(rightCommit, "right", "foreign/b.cs"),
      ),
    );
    const checked = cli(["check", "--all"], dir);
    expect(findingsOf(checked.envelope, "citation-unresolved")).toEqual([]);
    expect(
      entries(checked.envelope).map((entry) => [
        entry.field,
        entry.citations.checked,
        entry.citations.outside_scope,
      ]),
    ).toEqual([
      ["left", 1, 1],
      ["right", 1, 1],
    ]);
    expect(
      (
        cli(["read", "Mixed"], dir).envelope.data?.["status"] as
          | { stale: boolean | null }
          | undefined
      )?.stale,
    ).toBe(false);

    put(
      dir,
      "wiki/Mixed.md",
      page(
        pin(leftCommit, "left", "owned/a.cs"),
        "`owned/a.cs:1`, then `foreign/b.cs:2`, then `:99`.",
      ),
    );
    const foreign = cli(["check", "--all"], dir);
    expect(findingsOf(foreign.envelope, "citation-unresolved")).toEqual([]);
    expect(entries(foreign.envelope)[0]?.citations).toMatchObject({
      checked: 1,
      outside_scope: 2,
      unresolved: [],
    });
    put(
      dir,
      "wiki/Mixed.md",
      page(
        pin(leftCommit, "left", "owned/a.cs"),
        "`owned/a.cs:1`, `owned/../foreign/b.cs:2`, then `:99`.",
      ),
    );
    const traversal = cli(["check", "--all"], dir);
    expect(findingsOf(traversal.envelope, "citation-unresolved")).toEqual([]);
    expect(entries(traversal.envelope)[0]?.citations).toMatchObject({
      checked: 1,
      outside_scope: 2,
      unresolved: [],
    });
    const compact = cli(["check", "--summary"], dir);
    expect(compact.envelope.data?.["pins"]).toMatchObject({
      citations: { checked: 1, outside_scope: 2 },
    });
    put(
      dir,
      "wiki/Mixed.md",
      page(pin(leftCommit, "left", "owned/a.cs"), "`:99`, then `owned/a.cs:1`."),
    );
    expect(
      findingsOf(cli(["check", "--all"], dir).envelope, "citation-unresolved").map(
        (finding) => finding.details["reason"],
      ),
    ).toEqual(["unattached"]);
    put(
      dir,
      "wiki/Mixed.md",
      page(
        pin(leftCommit, "left", "owned/a.cs"),
        "`owned/a.cs:1`, `foreign/b.cs:2`, `:99`, then `owned/a.cs:2`, `:99`.",
      ),
    );
    expect(
      findingsOf(cli(["check", "--all"], dir).envelope, "citation-unresolved").map(
        (finding) => finding.details["cited"],
      ),
    ).toEqual(["owned/a.cs"]);
  }, 15_000);

  it("keeps missing files and past-end lines inside actual tree or whole-repo coverage", () => {
    const { dir, leftCommit } = fixture();
    for (const cover of ["owned", "owned/"]) {
      put(
        dir,
        "wiki/Mixed.md",
        page(pin(leftCommit, "left", cover), "`owned/missing.cs:1` and `owned/a.cs:99`."),
      );
      const invalid = cli(["check", "--all"], dir);
      expect(
        findingsOf(invalid.envelope, "citation-unresolved")
          .map((finding) => finding.details["reason"])
          .sort(),
      ).toEqual(["missing", "past-end"]);
      put(dir, "wiki/Mixed.md", page(pin(leftCommit, "left", cover), "`owned/a.cs:1` and `:2`."));
      expect(findingsOf(cli(["check", "--all"], dir).envelope, "citation-unresolved")).toEqual([]);
    }
    put(
      dir,
      "wiki/Mixed.md",
      page(pin(leftCommit, "left", "."), "`missing/root.cs:1`, `System.Linq`, `1.6` and `a/b`."),
    );
    expect(
      findingsOf(cli(["check", "--all"], dir).envelope, "citation-unresolved").map(
        (finding) => finding.details["cited"],
      ),
    ).toEqual(["missing/root.cs"]);
    put(
      dir,
      "wiki/Mixed.md",
      page(pin(leftCommit, "left", "owned/a.cs, owned"), "`owned/a.cs:1`, `owned`, then `:2`."),
    );
    expect(findingsOf(cli(["check", "--all"], dir).envelope, "citation-unresolved")).toEqual([]);
  }, 15_000);

  it("checks explicit overlap independently and keeps known failure beside an unmeasured pin", () => {
    const { dir, leftCommit, rightCommit } = fixture();
    put(
      dir,
      "wiki/Mixed.md",
      page(
        pin(leftCommit, "left", "common/line.cs"),
        "`common/line.cs:2`.",
        pin(rightCommit, "right", "common/line.cs"),
      ),
    );
    const overlap = cli(["check", "--all"], dir);
    expect(
      entries(overlap.envelope).map((entry) => [entry.field, entry.citations.checked]),
    ).toEqual([
      ["left", 1],
      ["right", 1],
    ]);
    expect(
      findingsOf(overlap.envelope, "citation-unresolved").map((finding) => [
        finding.details["field"],
        finding.details["origin"],
      ]),
    ).toEqual([["right", "right"]]);

    put(
      dir,
      "wiki/Mixed.md",
      page(
        pin(leftCommit, "left", "owned/a.cs"),
        "`owned/a.cs:99`.",
        pin(rightCommit, "https://example.invalid/repo.git", "foreign/b.cs"),
      ),
    );
    const mixed = cli(["check", "--all"], dir);
    expect(findingsOf(mixed.envelope, "citation-unresolved")).toHaveLength(1);
    expect(findingsOf(mixed.envelope, "pin-unmeasured")).toHaveLength(1);
    const coverage = mixed.envelope.data?.["coverage"] as Record<
      string,
      {
        evaluated: number;
        unevaluated: number;
        not_applicable: number;
      }
    >;
    expect(coverage["citation-unresolved"]).toMatchObject({ evaluated: 0, unevaluated: 1 });
    expect(coverage["citation-unresolved"]?.not_applicable).toBe(
      ((mixed.envelope.data?.["summary"] as { pages: number } | undefined)?.pages ?? 0) - 1,
    );
  }, 15_000);
});
