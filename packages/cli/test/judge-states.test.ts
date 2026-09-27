// v2 contracts §10: the four state constructors over one gardening vault
// under os.tmpdir() — which bytes each reads, under which law, against which
// base — and §11: the working tree read by digest before and after, one
// retry, then state-changed-during-read.
import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { contentRootsOf, type JudgeState, type SkippedPath } from "@wikiwright/core";
import {
  fsState,
  indexState,
  overlayState,
  revisionState,
  StateChangedDuringRead,
} from "../src/lawstate.ts";
import { BASIL, gardenVault, git, gitCommitAll, START } from "./fixtures/garden-judge.ts";
import { engineJson, removeTree, type Tree, writeTree } from "./fixtures/garden-law.ts";
import { judgeState } from "./fixtures/judge-run.ts";

const made: string[] = [];
afterAll(() => {
  for (const dir of made) removeTree(dir);
});

function vault(extra: Tree = {}, prefix = ""): string {
  const tree: Tree = {};
  for (const [path, text] of Object.entries(gardenVault(extra))) {
    // A bundle in a subdirectory keeps its libraries at the top level.
    const top = path.startsWith("libraries/") ? path : `${prefix}${path}`;
    tree[top] = text;
  }
  const dir = writeTree(tree, "ww-states-");
  made.push(dir);
  return dir;
}

const text = (bytes: Uint8Array | null | undefined) =>
  bytes === null || bytes === undefined ? bytes : new TextDecoder().decode(bytes);

function pagesOf(state: JudgeState): Record<string, string | null | undefined> {
  return Object.fromEntries([...state.pages].map(([p, b]) => [p, text(b)]));
}

function baseOf(state: JudgeState): Record<string, string | null | undefined> | undefined {
  if (state.base === undefined) return undefined;
  return Object.fromEntries([...state.base].map(([p, b]) => [p, text(b)]));
}

const lawText = (state: JudgeState, path: string) => text(state.law.files.get(path)?.bytes);

const BASIL_EDITED = BASIL.replace(
  "- 2026-04-12 — sown",
  "- 2026-04-12 — sown\n- 2026-05-01 — thinned",
);
const MINT = BASIL.replace("title: Basil", "title: Mint");

/**
 * One repository, three disagreeing layers: HEAD holds the vault; the index
 * holds an edit, a rename and a new page; the working tree holds one more
 * edit on top, and a type document changed on disk only.
 */
function layered(prefix = ""): string {
  const dir = vault({}, prefix);
  gitCommitAll(dir);
  const at = (path: string) => join(dir, prefix, path);
  writeFileSync(at("wiki/Basil.md"), BASIL_EDITED);
  git(dir, "mv", `${prefix}wiki/Start.md`, `${prefix}wiki/Begin.md`);
  writeFileSync(at("wiki/Mint.md"), MINT);
  git(dir, "add", "-A");
  writeFileSync(at("wiki/Basil.md"), `${BASIL_EDITED}\nA working-tree line.\n`);
  writeFileSync(
    at("constitution/types/guide.yaml"),
    "type: guide\nrole: hub\ndescription: Edited on disk.\n",
  );
  return dir;
}

describe("the four constructors over one repository", () => {
  it("fsState reads the working tree and its law, with no base", async () => {
    const dir = layered();
    const state = await fsState(dir);
    expect(state.kind).toBe("working-tree");
    expect(state.base).toBe(undefined);
    expect(Object.keys(pagesOf(state))).toEqual([
      "wiki/Basil.md",
      "wiki/Begin.md",
      "wiki/Herb bed.md",
      "wiki/Mint.md",
    ]);
    expect(pagesOf(state)["wiki/Basil.md"]).toContain("A working-tree line.");
    expect(lawText(state, "constitution/types/guide.yaml")).toContain("Edited on disk.");
    expect(contentRootsOf(state.law)).toEqual(["wiki"]);
  });

  it("indexState reads the index and its law, with HEAD as the base", async () => {
    const dir = layered();
    const state = await indexState(dir);
    expect(state.kind).toBe("index");
    expect(pagesOf(state)["wiki/Basil.md"]).toBe(BASIL_EDITED);
    expect(lawText(state, "constitution/types/guide.yaml")).not.toContain("Edited on disk.");
    expect(baseOf(state)).toEqual({
      // Changed: HEAD's bytes at its path.
      "wiki/Basil.md": BASIL,
      // Renamed: HEAD's bytes at the path it was renamed from.
      "wiki/Begin.md": START,
      // Unchanged: its own bytes.
      "wiki/Herb bed.md": pagesOf(state)["wiki/Herb bed.md"],
      // New: none.
      "wiki/Mint.md": null,
    });
    expect(state.renames).toEqual([{ from: "wiki/Start.md", to: "wiki/Begin.md" }]);
  });

  it("overlayState lays drafts over the disk, with the disk as the base", async () => {
    const dir = layered();
    const draft = (path: string, body: string) => ({
      path,
      bytes: new TextEncoder().encode(body),
    });
    const state = await overlayState(dir, [
      draft("wiki/Basil.md", BASIL),
      draft("wiki/Thyme.md", MINT.replace("Mint", "Thyme")),
    ]);
    expect(state.kind).toBe("overlay");
    expect(pagesOf(state)["wiki/Basil.md"]).toBe(BASIL);
    expect(pagesOf(state)["wiki/Thyme.md"]).toContain("Thyme");
    const base = baseOf(state) ?? {};
    expect(base["wiki/Basil.md"]).toContain("A working-tree line.");
    expect(base["wiki/Thyme.md"]).toBe(null);
    expect(base["wiki/Herb bed.md"]).toBe(pagesOf(state)["wiki/Herb bed.md"]);
    expect(lawText(state, "constitution/types/guide.yaml")).toContain("Edited on disk.");
    await expect(overlayState(dir, [draft("notes/x.md", "---\n---\n")])).rejects.toThrow(
      "not a page under the content roots",
    );
  });

  it("revisionState reads a revision's tree and its law, with no base", async () => {
    const dir = layered();
    const state = await revisionState(dir, "HEAD");
    expect(state.kind).toBe("revision");
    expect(state.base).toBe(undefined);
    expect(pagesOf(state)).toMatchObject({ "wiki/Basil.md": BASIL, "wiki/Start.md": START });
    expect(Object.keys(pagesOf(state))).not.toContain("wiki/Mint.md");
    expect(lawText(state, "constitution/types/guide.yaml")).not.toContain("Edited on disk.");
  });

  it("reads a bundle in a subdirectory by bundle-relative paths, its library from the top", async () => {
    const dir = layered("garden/");
    const root = join(dir, "garden");
    for (const state of [
      await fsState(root),
      await indexState(root),
      await revisionState(root, "HEAD"),
    ]) {
      expect(state.law.bundle).toBe("garden");
      expect(Object.keys(pagesOf(state))).toContain("wiki/Herb bed.md");
      expect(contentRootsOf(state.law)).toEqual(["wiki"]);
      expect([...state.law.files.keys()]).toContain("libraries/kit-garden/types/planting.yaml");
    }
    expect((await indexState(root)).renames).toEqual([
      { from: "wiki/Start.md", to: "wiki/Begin.md" },
    ]);
  });

  it("gives an index with no HEAD an empty base: every page is new", async () => {
    const dir = vault();
    git(dir, "init", "-q");
    git(dir, "add", "-A");
    const state = await indexState(dir);
    expect(Object.values(baseOf(state) ?? { none: "x" }).every((b) => b === null)).toBe(true);
    expect(state.pages.size).toBe(3);
  });

  it("reads through no symbolic link and no submodule, and names each alike, in every constructor", async () => {
    const dir = vault({
      "wiki/beds/Cold frame.md": "---\ntype: garden/bed\ntitle: Cold frame\n---\n",
    });
    // A page that is a link, a directory that is one, and one that loops.
    symlinkSync("Herb bed.md", join(dir, "wiki/Alias.md"));
    symlinkSync("beds", join(dir, "wiki/alias"));
    symlinkSync(".", join(dir, "wiki/loop"));
    // A repository of its own inside a content root: a submodule to git.
    const nested = join(dir, "wiki/nested");
    mkdirSync(nested);
    writeFileSync(join(nested, "Pond.md"), "---\ntype: garden/bed\ntitle: Pond\n---\n");
    gitCommitAll(nested);
    gitCommitAll(dir);
    const skipped: SkippedPath[] = [
      { path: "wiki/Alias.md", kind: "symbolic-link" },
      { path: "wiki/alias", kind: "symbolic-link" },
      { path: "wiki/loop", kind: "symbolic-link" },
      { path: "wiki/nested", kind: "submodule" },
    ];
    for (const state of [
      await fsState(dir),
      await indexState(dir),
      await revisionState(dir, "HEAD"),
      await overlayState(dir, []),
    ]) {
      expect([state.kind, Object.keys(pagesOf(state))]).toEqual([
        state.kind,
        ["wiki/Basil.md", "wiki/Herb bed.md", "wiki/Start.md", "wiki/beds/Cold frame.md"],
      ]);
      expect([state.kind, state.skipped]).toEqual([state.kind, skipped]);
      const verdict = await judgeState(state);
      expect(
        verdict.findings
          .filter((f) => f.rule === "path-skipped")
          .map((f) => [f.path, f.details["kind"], f.severity, f.queue]),
      ).toEqual(skipped.map((s) => [s.path, s.kind, "warning", "identity-review"]));
      expect(verdict.findings.filter((f) => f.rule === "identity-collision")).toEqual([]);
    }
    const draft = { path: "wiki/Alias.md", bytes: new TextEncoder().encode("---\n---\n") };
    await expect(overlayState(dir, [draft])).rejects.toThrow("no state reads through");
    await expect(overlayState(dir, [{ ...draft, path: "wiki/alias/New.md" }])).rejects.toThrow(
      "no state reads through",
    );
  });

  it("names a link above a content root, and reads nothing through it", async () => {
    const dir = vault();
    const { renameSync } = await import("node:fs");
    renameSync(join(dir, "wiki"), join(dir, "pages"));
    mkdirSync(join(dir, "docs"));
    symlinkSync("../pages", join(dir, "docs/wiki"));
    writeFileSync(
      join(dir, "config/engine.json"),
      engineJson({ content_roots: ["docs/wiki/garden", "pages"] }),
    );
    gitCommitAll(dir);
    for (const state of [
      await fsState(dir),
      await indexState(dir),
      await revisionState(dir, "HEAD"),
    ]) {
      expect([state.kind, state.skipped]).toEqual([
        state.kind,
        [{ path: "docs/wiki", kind: "symbolic-link" }],
      ]);
      expect(Object.keys(pagesOf(state))).toEqual([
        "pages/Basil.md",
        "pages/Herb bed.md",
        "pages/Start.md",
      ]);
    }
  });
});

describe("the working tree, read by digest before and after (§11)", () => {
  it("reads again when a page and a type document change during the read", async () => {
    const dir = vault();
    const state = await fsState(dir, {
      betweenReads: (attempt) => {
        if (attempt !== 1) return;
        writeFileSync(join(dir, "wiki/Basil.md"), BASIL_EDITED);
        writeFileSync(
          join(dir, "constitution/types/guide.yaml"),
          "type: guide\nrole: hub\ndescription: Changed mid-read.\n",
        );
      },
    });
    expect(pagesOf(state)["wiki/Basil.md"]).toBe(BASIL_EDITED);
    expect(lawText(state, "constitution/types/guide.yaml")).toContain("Changed mid-read.");
  });

  it("refuses with state-changed-during-read when the tree changes on the retry too", async () => {
    const dir = vault();
    let n = 0;
    const read = fsState(dir, {
      betweenReads: () => {
        n += 1;
        writeFileSync(join(dir, "wiki/Basil.md"), `${BASIL}\nEdit ${n}.\n`);
      },
    });
    await expect(read).rejects.toBeInstanceOf(StateChangedDuringRead);
    await expect(read).rejects.toMatchObject({ code: "state-changed-during-read" });
    expect(n).toBe(2);
  });

  it("reads again when a page appears or leaves during the read", async () => {
    const dir = vault();
    const state = await fsState(dir, {
      betweenReads: (attempt) => {
        if (attempt === 1) rmSync(join(dir, "wiki/Start.md"));
      },
    });
    expect(Object.keys(pagesOf(state))).toEqual(["wiki/Basil.md", "wiki/Herb bed.md"]);
  });
});
