import { afterAll, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, relative } from "node:path";
import { judgeTypeLaw, loadTypeLaw, readPages, sourcePathStatus } from "@wikiwright/core";
import { fsState, overlayFromState, readIndex, revisionState } from "../src/lawstate.ts";
import {
  cleanBundles,
  cli,
  commitAll,
  findingsOf,
  gardenBundle,
  git,
} from "./fixtures/garden-cli.ts";
import { BASIL } from "./fixtures/garden-judge.ts";
import { engineJson } from "./fixtures/garden-law.ts";

const made: string[] = [];
afterAll(() => {
  cleanBundles();
  for (const path of made) rmSync(path, { recursive: true, force: true });
});

const cited = (source: string) => BASIL.replace("([[Herb bed]])", `(${source})`);

function put(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

describe("selected-state source paths", () => {
  it("shows missing, directory, wrong kind, and unavailable path facts distinctly", async () => {
    const dir = gardenBundle({ "wiki/Basil.md": cited("raw/bed.txt") });
    const missing = cli(["check", "--all"], dir);
    expect(missing.status).toBe(5);
    expect(findingsOf(missing.envelope, "source-path-missing")[0]?.details["source"]).toBe(
      "raw/bed.txt",
    );
    expect(status(dir, "Basil").reason).toBe("source-path-missing");
    const draft = mkdtempSync(join(tmpdir(), "ww-source-draft-"));
    made.push(draft);
    put(draft, "wiki/Basil.md", `${cited("raw/bed.txt")}\n`);
    const before = readFileSync(join(dir, "wiki/Basil.md"), "utf8");
    for (const args of [
      ["write", "--from", draft, "--dry-run"],
      ["write", "--from", draft],
    ]) {
      const result = cli(args, dir);
      expect(result.status).toBe(5);
      expect(findingsOf(result.envelope, "source-path-missing")).toHaveLength(1);
      expect(readFileSync(join(dir, "wiki/Basil.md"), "utf8")).toBe(before);
    }
    put(dir, "raw/bed.txt", "raw data\n");
    expect(findingsOf(cli(["check", "--all"], dir).envelope, "source-path-missing")).toEqual([]);
    put(dir, "wiki/Basil.md", cited("raw/nested/"));
    mkdirSync(join(dir, "raw/nested"));
    expect(findingsOf(cli(["check", "--all"], dir).envelope, "source-path-missing")).toEqual([]);
    put(dir, "wiki/Basil.md", cited("raw/bed.txt/"));
    expect(findingsOf(cli(["check", "--all"], dir).envelope, "source-path-kind")).toHaveLength(1);
    const state = await fsState(dir);
    const law = loadTypeLaw(state.law);
    if (!law.ok) throw new Error(JSON.stringify(law.issues));
    const { sources: _sources, ...bare } = state;
    const judged = judgeTypeLaw(bare, law.law, { all: true });
    expect(judged.findings.some((f) => f.rule === "source-path-unmeasured")).toBe(true);
    expect(judged.findings.some((f) => f.rule === "source-path-missing")).toBe(false);
  });

  it("uses staged paths instead of disk and invalidates an old queue when raw existence changes", async () => {
    const dir = gardenBundle({
      "wiki/Basil.md": cited("raw/bed.txt"),
      "raw/bed.txt": "raw data\n",
    });
    const written = cli(["check", "--write"], dir);
    expect(written.status).toBe(0);
    expect(status(dir, "Basil").unresolved_reason).toBeNull();
    commitAll(dir);
    const before = git(dir, "rev-parse", "HEAD").trim();
    rmSync(join(dir, "raw/bed.txt"));
    git(dir, "add", "raw/bed.txt");
    put(dir, "raw/bed.txt", "working tree repair\n");
    expect(sourcePathStatus("raw/bed.txt", (await readIndex(dir)).state.sources)).toBe("missing");
    expect(sourcePathStatus("raw/bed.txt", (await fsState(dir)).sources)).toBe("present");
    const gate = cli(["gate", "--all"], dir);
    expect(gate.status).toBe(5);
    expect(findingsOf(gate.envelope, "source-path-missing").map((f) => f.path)).toEqual([
      "wiki/Basil.md",
    ]);
    expect(sourcePathStatus("raw/bed.txt", (await revisionState(dir, before)).sources)).toBe(
      "present",
    );
    rmSync(join(dir, "raw/bed.txt"));
    expect(status(dir, "Basil").unresolved_reason).toBe("queue-stale");
  });

  it("updates source facts for draft pages and refuses nested Git or link boundaries", async () => {
    const dir = gardenBundle({
      "config/engine.json": engineJson({ source_roots: ["wiki"] }),
      "wiki/Basil.md": cited("wiki/New-bed.md"),
    });
    const disk = await fsState(dir);
    expect(sourcePathStatus("wiki/New-bed.md", disk.sources)).toBe("missing");
    const overlay = overlayFromState(disk, [
      {
        path: "wiki/New-bed.md",
        bytes: new TextEncoder().encode(
          "---\ntype: garden/bed\ntitle: New-bed\nsize: 4\n---\n\n# New-bed\n",
        ),
      },
    ]);
    expect(sourcePathStatus("wiki/New-bed.md", overlay.sources)).toBe("present");
    const law = loadTypeLaw(overlay.law);
    if (!law.ok) throw new Error(JSON.stringify(law.issues));
    const basil = readPages(overlay, law.law).pages.find((page) => page.path === "wiki/Basil.md");
    if (basil?.read.ok !== true) throw new Error("Basil must parse");
    const claim = basil.read.page.occurrences.find((section) => section.heading === "Observations")
      ?.items[0];
    expect(claim?.kind === "claim" ? claim.provenance.kind : null).toBe("path");
    expect(
      judgeTypeLaw(overlay, law.law, { all: true }).findings.some(
        (f) => f.rule === "source-path-missing",
      ),
    ).toBe(false);
    const moved = overlayFromState(
      disk,
      [{ path: "wiki/New-bed.md", bytes: disk.pages.get("wiki/Herb bed.md") as Uint8Array }],
      [{ from: "wiki/Herb bed.md", to: "wiki/New-bed.md" }],
    );
    expect(sourcePathStatus("wiki/Herb bed.md", moved.sources)).toBe("missing");
    expect(sourcePathStatus("wiki/New-bed.md", moved.sources)).toBe("present");
    const draft = mkdtempSync(join(tmpdir(), "ww-overlap-draft-"));
    made.push(draft);
    put(draft, "wiki/Basil.md", `${cited("wiki/new/nested/New-bed.md")}\n`);
    put(
      draft,
      "wiki/new/nested/New-bed.md",
      "---\ntype: garden/bed\ntitle: New-bed\nsize: 4\n---\n\n# New-bed\n",
    );
    const written = cli(["write", "--from", draft], dir);
    if (written.status !== 0) throw new Error(JSON.stringify(written.envelope));
    expect(readFileSync(join(dir, "wiki/new/nested/New-bed.md"), "utf8")).toContain(
      "title: New-bed",
    );

    const nested = gardenBundle({
      "config/engine.json": engineJson({ source_roots: ["raw/vendor/docs"] }),
      "wiki/Basil.md": cited("raw/vendor/docs/notes.txt"),
      "raw/vendor/.git": "gitdir: elsewhere\n",
      "raw/vendor/docs/notes.txt": "hidden\n",
    });
    expect(sourcePathStatus("raw/vendor/docs/notes.txt", (await fsState(nested)).sources)).toBe(
      "unmeasured",
    );
    expect(
      findingsOf(cli(["check", "--all"], nested).envelope, "source-path-unmeasured"),
    ).toHaveLength(1);

    const linked = gardenBundle({
      "config/engine.json": engineJson({ source_roots: ["raw"] }),
      "wiki/Basil.md": cited("raw/only/"),
    });
    mkdirSync(join(linked, "raw/only"), { recursive: true });
    symlinkSync("missing-target", join(linked, "raw/only/link"));
    commitAll(linked);
    const index = (await readIndex(linked)).state;
    expect(sourcePathStatus("raw/only/", index.sources)).toBe("present");
    expect(sourcePathStatus("raw/only/link", index.sources)).toBe("unmeasured");
    expect(sourcePathStatus("raw/only/", (await revisionState(linked, "HEAD")).sources)).toBe(
      "present",
    );
  });
});

const SOURCE_TYPE = `type: source
role: reference
description: A cited Git capture.
fields:
  type: object
  properties:
    capture: { $ref: "#/$defs/pin" }
    followup: { $ref: "#/$defs/pin" }
  required: [capture]
`;

function capture(
  commit: string,
  origin: string,
  cover = "notes/seeds.txt",
  citation = "notes/seeds.txt:1",
) {
  return `---\ntype: source\ntitle: Seed list\ncapture:\n  commit: ${commit}\n  origin: "${origin}"\n  covers: [${cover}]\n---\n\n# Seed list\n\nThe source is in \`${citation}\`.\n`;
}

function status(
  dir: string,
  page: string,
): {
  stale: boolean | null;
  reason: string | null;
  unresolved_reason: string | null;
  observations?: { head: string | null }[];
} {
  return cli(["read", page], dir).envelope.data?.["status"] as {
    stale: boolean | null;
    reason: string | null;
    unresolved_reason: string | null;
    observations?: { head: string | null }[];
  };
}

describe("declared local Git origins", () => {
  it("measures immutable captured heads and exposes stale or unverified evidence to citing consumers", () => {
    const origin = mkdtempSync(join(tmpdir(), "ww-local-origin-"));
    made.push(origin);
    put(origin, "notes/seeds.txt", "basil\n");
    commitAll(origin);
    const pinned = git(origin, "rev-parse", "HEAD").trim();
    const dir = gardenBundle({
      "constitution/types/source.yaml": SOURCE_TYPE,
      "wiki/Start.md":
        "---\ntype: guide\ntitle: Start\n---\n\n# Start\n\n## Start here\n\nRead [[Seed list]].\n",
      "wiki/Seed list.md": capture(pinned, "local-code"),
    });
    put(
      dir,
      "config/engine.json",
      engineJson({ local_origins: [{ name: "local-code", path: relative(dir, origin) }] }),
    );
    const initial = cli(["check", "--all"], dir);
    expect(initial.status).toBe(5); // generated artifacts still need rendering
    expect(
      (
        initial.envelope.data?.["pins"] as
          | { entries: { state: string; commit: string }[] }
          | undefined
      )?.entries[0],
    ).toMatchObject({ state: "current", commit: pinned });
    expect(status(dir, "Seed list")).toMatchObject({ stale: false, reason: null });
    expect(status(dir, "Seed list").observations?.[0]?.head).toBe(pinned);
    const single = readFileSync(join(dir, "wiki/Seed list.md"), "utf8");
    put(
      dir,
      "wiki/Seed list.md",
      single.replace(
        "---\n\n# Seed list",
        "followup:\n  commit: 0123456789abcdef\n  origin: local-code\n  covers: [notes/seeds.txt]\n---\n\n# Seed list",
      ),
    );
    const mixed = cli(["check", "--all"], dir);
    const coverage = mixed.envelope.data?.["coverage"] as Record<
      string,
      { evaluated: number; unevaluated: number }
    >;
    expect(coverage["citation-unresolved"]).toMatchObject({ evaluated: 0, unevaluated: 1 });
    expect(coverage["pin-coverage-invalid"]).toMatchObject({ evaluated: 0, unevaluated: 1 });
    expect(status(dir, "Seed list")).toMatchObject({ stale: null, reason: "pin-unknown" });
    put(dir, "wiki/Seed list.md", single);
    put(origin, "notes/other.txt", "unrelated\n");
    commitAll(origin, "unrelated source change");
    expect(status(dir, "Seed list")).toMatchObject({ stale: false, reason: null });
    put(origin, "notes/seeds.txt", "basil\nmint\n");
    commitAll(origin, "covered source change");
    expect(status(dir, "Seed list")).toMatchObject({ stale: true, reason: "pin-stale" });
    expect(status(dir, "Start")).toMatchObject({ stale: true, reason: "stale-source-cited" });
    const searched = cli(["search", "Read", "--all"], dir);
    const results = (searched.envelope.data?.["results"] ?? []) as {
      path: string;
      status: { stale: boolean | null };
    }[];
    expect(results.find((row) => row.path === "wiki/Start.md")?.status.stale).toBe(true);
    put(dir, "wiki/Seed list.md", capture(pinned, "local-code", "notes/missing.txt"));
    const invalid = cli(["check", "--all"], dir);
    expect(findingsOf(invalid.envelope, "pin-coverage-invalid")).toHaveLength(1);
    expect(status(dir, "Seed list")).toMatchObject({ stale: null, reason: "coverage-invalid" });
    expect(status(dir, "Start")).toMatchObject({ stale: null, reason: "source-unverified-cited" });
    put(dir, "wiki/Seed list.md", capture(pinned, "local-code", "notes/", "notes/missing.txt:1"));
    expect(findingsOf(cli(["check", "--all"], dir).envelope, "citation-unresolved")).toHaveLength(
      1,
    );
    expect(status(dir, "Seed list")).toMatchObject({ stale: true, reason: "pin-stale" });
    put(dir, "wiki/Seed list.md", capture(pinned, "local-code", "notes/", "notes/gone/"));
    expect(findingsOf(cli(["check", "--all"], dir).envelope, "citation-unresolved")).toHaveLength(
      1,
    );
    put(dir, "wiki/Seed list.md", capture(pinned, "https://example.invalid/repo.git"));
    expect(status(dir, "Seed list")).toMatchObject({ stale: null, reason: "remote-origin" });
    expect(status(dir, "Start")).toMatchObject({ stale: null, reason: "source-unverified-cited" });
    put(dir, "wiki/Seed list.md", capture(pinned, " "));
    expect(findingsOf(cli(["check", "--all"], dir).envelope, "page-shape-invalid")).toHaveLength(1);
    expect(status(dir, "Seed list")).toMatchObject({ stale: null, reason: "pin-invalid" });
    put(dir, "wiki/Seed list.md", capture(pinned, "local-code"));
    put(
      dir,
      "config/engine.json",
      engineJson({
        local_origins: [
          { name: "local-code", path: relative(dir, origin) },
          { name: "other-code", path: origin },
        ],
      }),
    );
    expect(
      findingsOf(cli(["check", "--all"], dir).envelope, "pin-unmeasured")[0]?.details["reason"],
    ).toBe("duplicate-root");
    expect(status(dir, "Seed list")).toMatchObject({ stale: null, reason: "duplicate-root" });
  }, 15_000);

  it("retries a moved HEAD once and refuses a repeatedly moving HEAD", () => {
    if (process.platform === "win32") return;
    const origin = mkdtempSync(join(tmpdir(), "ww-moving-origin-"));
    made.push(origin);
    put(origin, "notes/seeds.txt", "basil\n");
    commitAll(origin);
    const first = git(origin, "rev-parse", "HEAD").trim();
    put(origin, "notes/seeds.txt", "basil\nmint\n");
    commitAll(origin, "second source");
    const second = git(origin, "rev-parse", "HEAD").trim();
    git(origin, "update-ref", "HEAD", first);
    const dir = gardenBundle({
      "constitution/types/source.yaml": SOURCE_TYPE,
      "wiki/Seed list.md": capture(first, "local-code"),
      "config/engine.json": engineJson({ local_origins: [{ name: "local-code", path: origin }] }),
    });
    const bin = mkdtempSync(join(tmpdir(), "ww-origin-git-"));
    made.push(bin);
    const real = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
    const count = join(bin, "count");
    const log = join(bin, "calls");
    const wrapper = join(bin, "git");
    writeFileSync(
      wrapper,
      `#!/bin/sh
if [ "$(pwd -P)" = "$WW_ORIGIN_DIR" ]; then
  printf '%s\\n' "$*" >> "$WW_ORIGIN_LOG"
  if [ "$1" = rev-parse ] && [ "$2" = HEAD ]; then
    "${real}" "$@"
    n=0
    if [ -f "$WW_ORIGIN_COUNT" ]; then n=$(cat "$WW_ORIGIN_COUNT"); fi
    n=$((n + 1))
    printf '%s' "$n" > "$WW_ORIGIN_COUNT"
    if [ "$WW_RACE_MODE" = every ] || [ "$n" = 1 ]; then
      current=$("${real}" rev-parse HEAD)
      if [ "$current" = "$WW_FIRST" ]; then "${real}" update-ref HEAD "$WW_SECOND";
      else "${real}" update-ref HEAD "$WW_FIRST"; fi
    fi
    exit 0
  fi
fi
exec "${real}" "$@"
`,
    );
    chmodSync(wrapper, 0o755);
    const env = {
      PATH: `${bin}${delimiter}${process.env["PATH"] ?? ""}`,
      WW_ORIGIN_DIR: realpathSync(origin),
      WW_ORIGIN_COUNT: count,
      WW_ORIGIN_LOG: log,
      WW_FIRST: first,
      WW_SECOND: second,
      WW_RACE_MODE: "once",
    };
    const coherent = cli(["check", "--all"], dir, { env });
    const entries = (
      coherent.envelope.data?.["pins"] as { entries: { head: string; state: string }[] } | undefined
    )?.entries;
    expect(entries?.[0]).toMatchObject({ head: second, state: "stale" });
    const calls = readFileSync(log, "utf8").split("\n");
    expect(
      calls
        .filter((line) => /^(merge-base|diff|rev-list|cat-file|ls-tree) /u.test(line))
        .every((line) => !/(^| )HEAD($| )/u.test(line)),
    ).toBe(true);
    git(origin, "update-ref", "HEAD", first);
    writeFileSync(count, "0");
    const moving = cli(["check", "--all"], dir, { env: { ...env, WW_RACE_MODE: "every" } });
    expect(moving.status).toBe(1);
    expect(moving.envelope.error?.code).toBe("git-inconsistent-read");
  });
});
