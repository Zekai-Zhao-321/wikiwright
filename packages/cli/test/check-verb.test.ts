// v2 contracts §9.1: `check [--write] [--fix] [--dry-run]` over a synthetic
// gardening bundle under os.tmpdir() — the working tree judged whole, the
// generated files compared and written, queue.md a function of the law and
// the content only, the pins measured against the local repository, the
// `okf-missing-type` row, `engine-mismatch`, a law that does not load, the
// folder-tag fixer.
import { afterAll, describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseTypeLawQueue } from "@wikiwright/core";
import { fsState } from "../src/lawstate.ts";
import { stateContentDigest } from "../src/typelaw.ts";
import {
  cleanBundles,
  cli,
  commitAll,
  findingsOf,
  gardenBundle,
  git,
} from "./fixtures/garden-cli.ts";
import { engineJson } from "./fixtures/garden-law.ts";

const clones: string[] = [];
afterAll(() => {
  cleanBundles();
  for (const dir of clones) rmSync(dir, { recursive: true, force: true });
});

const GENERATED = [
  "generated/BRIEF.md",
  "generated/graph.json",
  "generated/manifest.json",
  "generated/queue.md",
  "generated/tag-catalog.md",
];

/** Every file under `dir` but `.git`, with its bytes. */
function snapshot(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const entry of readdirSync(dir, { recursive: true, encoding: "utf8" })) {
    const rel = entry.replaceAll("\\", "/");
    if (rel === ".git" || rel.startsWith(".git/")) continue;
    const abs = join(dir, rel);
    try {
      out.set(rel, readFileSync(abs, "utf8"));
    } catch {
      // A directory.
    }
  }
  return out;
}

/** The paths whose bytes differ between two snapshots. */
function delta(before: Map<string, string>, after: Map<string, string>): string[] {
  const paths = new Set([...before.keys(), ...after.keys()]);
  return [...paths].filter((p) => before.get(p) !== after.get(p)).sort();
}

function generatedBytes(dir: string): Record<string, string> {
  return Object.fromEntries(GENERATED.map((p) => [p, readFileSync(join(dir, p), "utf8")]));
}

describe("check over the working tree (v2 contracts §9.1)", () => {
  it("names each missing generated file with its fix, and --write renders them", () => {
    const dir = gardenBundle();
    const first = cli(["check"], dir);
    expect(first.status).toBe(5);
    const drift = findingsOf(first.envelope, "generated-drift");
    expect(drift.map((f) => f.path)).toEqual(GENERATED);
    expect(drift[0]?.fix).toEqual({ argv: ["wikiwright", "check", "--write"] });
    expect(drift[0]?.queue).toBeUndefined();

    const dry = cli(["check", "--write", "--dry-run"], dir);
    expect(dry.status).toBe(0);
    expect(dry.envelope.data?.["wrote"]).toBe(false);
    expect(
      ((dry.envelope.data?.["ops"] ?? []) as { kind: string; path: string }[]).map((o) => [
        o.kind,
        o.path,
      ]),
    ).toEqual(GENERATED.map((p) => ["create", p]));
    expect(existsSync(join(dir, "generated"))).toBe(false);

    const written = cli(["check", "--write"], dir);
    expect(written.status).toBe(0);
    expect(written.envelope.data?.["generated"]).toEqual({ files: GENERATED, written: GENERATED });
    const again = cli(["check"], dir);
    expect(again.status).toBe(0);
    expect(again.envelope.data?.summary?.errors).toBe(0);
    expect((again.envelope.data?.["generated"] ?? {}) as { written?: string[] }).toMatchObject({
      written: [],
    });
    // Nothing differs, so a second --write plans nothing.
    expect(cli(["check", "--write", "--dry-run"], dir).envelope.data?.["ops"]).toEqual([]);
  });

  it("renders the same bytes from the same law and pages, wherever the bundle sits", () => {
    const a = gardenBundle();
    const b = gardenBundle();
    cli(["check", "--write"], a);
    cli(["check", "--write"], b);
    expect(generatedBytes(a)).toEqual(generatedBytes(b));
  });

  it("names the bundle it read: engine.json's label and the digests of what it judged", async () => {
    const dir = gardenBundle();
    const bundle = cli(["check"], dir).envelope.metadata.bundle ?? {};
    expect(bundle["label"]).toBe("kitchen-garden");
    expect(bundle["head"]).toBe(null);
    expect(bundle["dirty"]).toBe(null);
    expect(bundle["content"]).toBe(stateContentDigest(await fsState(dir)));
    expect(String(bundle["law"])).toMatch(/^[0-9a-f]{64}$/u);
  });
});

describe("queue.md (v2 contracts §9.1)", () => {
  it("holds the queued findings and the digests they were cut from, and nothing read from git", () => {
    const dir = gardenBundle({
      "wiki/Basil.md": readFileSync(join(gardenBundle(), "wiki/Basil.md"), "utf8").replace(
        "title: Basil",
        "title: Basil\ntags: [weeds]",
      ),
    });
    const run = cli(["check", "--write"], dir);
    expect(run.status).toBe(5);
    const queue = parseTypeLawQueue(readFileSync(join(dir, "generated/queue.md"), "utf8"));
    expect(queue?.rows).toEqual([{ path: "wiki/Basil.md", rule: "vocabulary-unknown" }]);
    const bundle = run.envelope.metadata.bundle ?? {};
    expect(queue?.digests).toEqual({
      law: String(bundle["law"]),
      content: String(bundle["content"]),
    });
  });
});

describe("the law and the engine (v2 contracts §2)", () => {
  it("refuses a running engine outside the declared range as engine-mismatch", () => {
    const dir = gardenBundle({ "config/engine.json": engineJson({ engine: ">=9.0.0" }) });
    const r = cli(["check"], dir);
    expect(r.status).toBe(2);
    expect(r.envelope.error?.code).toBe("engine-mismatch");
    expect(r.envelope.error?.details).toEqual({ required: ">=9.0.0", running: "0.1.0" });
  });

  it("refuses a law that does not load, with its issues, and judges nothing", () => {
    const dir = gardenBundle({
      "constitution/types/guide.yaml": "type: guide\nrole: hub\ndescription: x\nbogus: 1\n",
    });
    const r = cli(["check"], dir);
    expect(r.status).toBe(2);
    expect(r.envelope.error?.code).toBe("constitution-invalid");
    const issues = (r.envelope as { data?: { issues?: { code: string }[] } }).data?.issues ?? [];
    expect(issues.map((i) => i.code)).toContain("type-key-unknown");
  });
});

describe("okf-missing-type (v2 contracts §1)", () => {
  it("is an error on a page with no non-empty type, beside the judge's type-unknown", () => {
    const dir = gardenBundle({ "wiki/Loose.md": "---\ntitle: Loose\n---\n\n# Loose\n" });
    const r = cli(["check", "--all"], dir);
    const okf = findingsOf(r.envelope, "okf-missing-type");
    expect(okf.map((f) => [f.path, f.queue])).toEqual([["wiki/Loose.md", "type-review"]]);
    expect(findingsOf(r.envelope, "type-unknown").map((f) => f.path)).toEqual(["wiki/Loose.md"]);
  });
});

const SOURCE_TYPE = `type: source
role: reference
description: A capture of a file in this repository.
fields:
  type: object
  properties:
    capture: { $ref: "#/$defs/pin" }
  required: [capture]
`;

function sourcePage(commit: string, origin: string, cited: string): string {
  return `---
type: source
title: Seed list
capture:
  commit: ${commit}
  origin: "${origin}"
  covers: [notes/seeds.txt]
---

# Seed list

The list is in \`${cited}\`.
`;
}

describe("pins, measured against the local repository (v2 contracts §9.1)", () => {
  function pinned(origin = "."): { dir: string; head: string } {
    const dir = gardenBundle({
      "constitution/types/source.yaml": SOURCE_TYPE,
      "notes/seeds.txt": "basil\nmint\n",
      "wiki/Basil.md": readFileSync(join(gardenBundle(), "wiki/Basil.md"), "utf8").replace(
        "Basil bolts above thirty degrees.",
        "Basil bolts above thirty degrees; see [[Seed list]].",
      ),
    });
    commitAll(dir, "the seeds");
    const head = git(dir, "rev-parse", "HEAD").trim();
    writeFileSync(join(dir, "wiki/Seed list.md"), sourcePage(head, origin, "notes/seeds.txt:2"));
    commitAll(dir, "the capture");
    return { dir, head };
  }

  it("reports a pin whose covered paths moved as pin-stale, and a page linking it as stale-source-cited", () => {
    const { dir, head } = pinned();
    const fresh = cli(["check", "--all"], dir);
    const pins = fresh.envelope.data?.["pins"] as { counts: Record<string, number> };
    expect(pins.counts["unchanged"]).toBe(1);
    expect(findingsOf(fresh.envelope, "pin-stale")).toEqual([]);

    writeFileSync(join(dir, "notes/seeds.txt"), "basil\nmint\nthyme\n");
    commitAll(dir, "thyme");
    const r = cli(["check", "--all"], dir);
    const stale = findingsOf(r.envelope, "pin-stale");
    expect(stale.map((f) => [f.path, f.severity, f.queue])).toEqual([
      ["wiki/Seed list.md", "warning", "source-review"],
    ]);
    expect(stale[0]?.details["touched"]).toEqual(["notes/seeds.txt"]);
    expect(stale[0]?.details["commit"]).toBe(head);
    expect(
      findingsOf(r.envelope, "stale-source-cited").map((f) => [f.path, f.details["target"]]),
    ).toEqual([["wiki/Basil.md", "wiki/Seed list.md"]]);
    // Read from git, so never in queue.md.
    cli(["check", "--write"], dir);
    const queue = readFileSync(join(dir, "generated/queue.md"), "utf8");
    expect(queue).not.toContain("pin-stale");
    expect(queue).not.toContain("stale-source-cited");
  });

  it("holds each citation to the pin: a path the pin does not hold is citation-unresolved", () => {
    const { dir, head } = pinned();
    writeFileSync(join(dir, "wiki/Seed list.md"), sourcePage(head, ".", "notes/weeds.txt"));
    const r = cli(["check", "--all"], dir);
    expect(findingsOf(r.envelope, "citation-unresolved").map((f) => f.details["cited"])).toEqual([
      "notes/weeds.txt",
    ]);
  });

  it("reports a pin the history does not hold as pin-unknown", () => {
    const { dir } = pinned();
    writeFileSync(join(dir, "wiki/Seed list.md"), sourcePage("0123456789abcdef", ".", "x"));
    const r = cli(["check", "--all"], dir);
    expect(findingsOf(r.envelope, "pin-unknown").map((f) => f.path)).toEqual(["wiki/Seed list.md"]);
  });

  it("measures no pin a shallow clone's history does not reach: pin-unmeasured, reason shallow", () => {
    const { dir } = pinned();
    writeFileSync(join(dir, "notes/other.txt"), "chives\n");
    commitAll(dir, "a later commit");
    const clone = (depth: number): string => {
      const into = mkdtempSync(join(tmpdir(), "ww-shallow-"));
      clones.push(into);
      git(into, "clone", "-q", "--depth", String(depth), `file://${dir}`, ".");
      return into;
    };
    const shallow = cli(["check", "--all"], clone(1));
    expect(findingsOf(shallow.envelope, "pin-unknown")).toEqual([]);
    expect(
      findingsOf(shallow.envelope, "pin-unmeasured").map((f) => [f.severity, f.details["reason"]]),
    ).toEqual([["info", "shallow"]]);
    // A shallow clone whose history reaches the pin measures it.
    const deep = cli(["check", "--all"], clone(3));
    expect(findingsOf(deep.envelope, "pin-unmeasured")).toEqual([]);
    const pins = deep.envelope.data?.["pins"] as { counts: Record<string, number> } | undefined;
    expect(pins?.counts).toMatchObject({ unchanged: 1, unknown: 0, unmeasured: 0 });
  });

  it("measures no other origin, and no pin outside a repository: pin-unmeasured, info", () => {
    const { dir } = pinned("https://seeds.example/list.git");
    const r = cli(["check", "--all"], dir);
    const unmeasured = findingsOf(r.envelope, "pin-unmeasured");
    expect(unmeasured.map((f) => [f.severity, f.details["reason"], f.queue])).toEqual([
      ["info", "remote-origin", undefined],
    ]);
    const loose = gardenBundle({
      "constitution/types/source.yaml": SOURCE_TYPE,
      "wiki/Seed list.md": sourcePage("0123456789abcdef", ".", "x"),
    });
    const outside = cli(["check", "--all"], loose);
    expect(findingsOf(outside.envelope, "pin-unmeasured").map((f) => f.details["reason"])).toEqual([
      "no-repository",
    ]);
  });
});

describe("check --fix: the folder tags (v2 contracts §2, §9.1)", () => {
  const BED = "---\ntype: garden/bed\ntitle: North bed\n---\n\n# North bed\n";
  function foldered(mode: string): string {
    return gardenBundle({
      "config/engine.json": engineJson({ folder_tags: { mode } }),
      "wiki/beds/North bed.md": BED,
    });
  }

  it("queues a missing folder tag under validate, and names check --fix under materialize-add-only", () => {
    const validate = findingsOf(
      cli(["check", "--all"], foldered("validate")).envelope,
      "folder-tags-present",
    );
    expect(validate.map((f) => [f.path, f.queue, f.fix])).toEqual([
      ["wiki/beds/North bed.md", "tag-review", undefined],
    ]);
    const materialize = findingsOf(
      cli(["check", "--all"], foldered("materialize-add-only")).envelope,
      "folder-tags-present",
    );
    expect(materialize[0]?.fix).toEqual({ argv: ["wikiwright", "check", "--fix"] });
  });

  it("adds the tag and renders generated/, planned alike by --dry-run", () => {
    const dir = foldered("materialize-add-only");
    const dry = cli(["check", "--fix", "--dry-run"], dir);
    expect(dry.status).toBe(0);
    const ops = dry.envelope.data?.["ops"] as { kind: string; path: string }[];
    expect(ops.map((o) => o.path)).toEqual(["wiki/beds/North bed.md", ...GENERATED]);
    expect(readFileSync(join(dir, "wiki/beds/North bed.md"), "utf8")).toBe(BED);
    const r = cli(["check", "--fix"], dir);
    expect(r.status).toBe(0);
    expect(r.envelope.data?.["fixed"]).toEqual([
      { path: "wiki/beds/North bed.md", added: ["beds"] },
    ]);
    expect(readFileSync(join(dir, "wiki/beds/North bed.md"), "utf8")).toContain('tags: ["beds"]');
    expect(cli(["check"], dir).status).toBe(0);
  });

  it("refuses a folder that names no tag as folder-segment-registered", () => {
    const dir = gardenBundle({
      "config/engine.json": engineJson({ folder_tags: { mode: "validate" } }),
      "wiki/sheds/Shed.md": BED.replace("North bed", "Shed"),
    });
    const r = cli(["check", "--all"], dir);
    expect(
      findingsOf(r.envelope, "folder-segment-registered").map((f) => f.details["segment"]),
    ).toEqual(["sheds"]);
  });

  it.each(["constructor", "__proto__"])(
    "treats the folder name %s as a literal segment, not an inherited alias",
    (segment) => {
      const dir = gardenBundle({
        "config/engine.json": engineJson({ folder_tags: { mode: "validate" } }),
        [`wiki/${segment}/North bed.md`]: BED,
      });
      const result = cli(["check", "--all"], dir);
      expect(result.envelope.error?.code).toBe("findings");
      expect(
        findingsOf(result.envelope, "folder-segment-registered").map((f) => f.details["segment"]),
      ).toEqual([segment]);
    },
  );
});

describe("generated output stays inside its bundle", () => {
  it("refuses a linked generated directory in dry and real runs", () => {
    const dir = gardenBundle();
    const outside = mkdtempSync(join(tmpdir(), "ww-generated-outside-"));
    clones.push(outside);
    writeFileSync(join(outside, "BRIEF.md"), "external sentinel\n");
    symlinkSync(outside, join(dir, "generated"), "dir");
    for (const argv of [
      ["check", "--write", "--dry-run"],
      ["check", "--write"],
    ]) {
      const result = cli(argv, dir);
      expect(result.status).toBe(4);
      expect(result.envelope.error?.code).toBe("replacement-target-refused");
      expect(readFileSync(join(outside, "BRIEF.md"), "utf8")).toBe("external sentinel\n");
      expect(existsSync(join(outside, "manifest.json"))).toBe(false);
    }
  });
});

describe("the dry-run law (docs/cli.md §The dry-run law)", () => {
  it.each([
    [["check", "--write"], "validate"],
    [["check", "--fix"], "materialize-add-only"],
  ])("%p: the plan's paths are the real run's delta", (argv, mode) => {
    const dir = gardenBundle({
      "config/engine.json": engineJson({ folder_tags: { mode } }),
      "wiki/beds/North bed.md": "---\ntype: garden/bed\ntitle: North bed\n---\n\n# North bed\n",
    });
    const before = snapshot(dir);
    const dry = cli([...argv, "--dry-run"], dir);
    expect(delta(before, snapshot(dir))).toEqual([]);
    const planned = ((dry.envelope.data?.["ops"] ?? []) as { path: string }[]).map((o) => o.path);
    cli(argv, dir);
    expect(delta(before, snapshot(dir))).toEqual([...planned].sort());
  });
});
