// v2 contracts §10: the four state constructors over one gardening vault
// under os.tmpdir() — which bytes each reads, under which law, against which
// base — and §11: the working tree read by digest before and after, one
// retry, then state-changed-during-read.
import { afterAll, describe, expect, it } from "bun:test";
import { rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { contentRootsOf, type JudgeState } from "@wikiwright/core";
import {
  fsState,
  indexState,
  overlayState,
  revisionState,
  StateChangedDuringRead,
} from "../src/lawstate.ts";
import { BASIL, gardenVault, git, gitCommitAll, START } from "./fixtures/garden-judge.ts";
import { removeTree, type Tree, writeTree } from "./fixtures/garden-law.ts";

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
  writeFileSync(at("wiki/basil.md"), BASIL_EDITED);
  git(dir, "mv", `${prefix}wiki/start.md`, `${prefix}wiki/begin.md`);
  writeFileSync(at("wiki/mint.md"), MINT);
  git(dir, "add", "-A");
  writeFileSync(at("wiki/basil.md"), `${BASIL_EDITED}\nA working-tree line.\n`);
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
      "wiki/basil.md",
      "wiki/begin.md",
      "wiki/herb-bed.md",
      "wiki/mint.md",
    ]);
    expect(pagesOf(state)["wiki/basil.md"]).toContain("A working-tree line.");
    expect(lawText(state, "constitution/types/guide.yaml")).toContain("Edited on disk.");
    expect(contentRootsOf(state.law)).toEqual(["wiki"]);
  });

  it("indexState reads the index and its law, with HEAD as the base", async () => {
    const dir = layered();
    const state = await indexState(dir);
    expect(state.kind).toBe("index");
    expect(pagesOf(state)["wiki/basil.md"]).toBe(BASIL_EDITED);
    expect(lawText(state, "constitution/types/guide.yaml")).not.toContain("Edited on disk.");
    expect(baseOf(state)).toEqual({
      // Changed: HEAD's bytes at its path.
      "wiki/basil.md": BASIL,
      // Renamed: HEAD's bytes at the path it was renamed from.
      "wiki/begin.md": START,
      // Unchanged: its own bytes.
      "wiki/herb-bed.md": pagesOf(state)["wiki/herb-bed.md"],
      // New: none.
      "wiki/mint.md": null,
    });
    expect(state.renames).toEqual([{ from: "wiki/start.md", to: "wiki/begin.md" }]);
  });

  it("overlayState lays drafts over the disk, with the disk as the base", async () => {
    const dir = layered();
    const draft = (path: string, body: string) => ({
      path,
      bytes: new TextEncoder().encode(body),
    });
    const state = await overlayState(dir, [
      draft("wiki/basil.md", BASIL),
      draft("wiki/thyme.md", MINT.replace("Mint", "Thyme")),
    ]);
    expect(state.kind).toBe("overlay");
    expect(pagesOf(state)["wiki/basil.md"]).toBe(BASIL);
    expect(pagesOf(state)["wiki/thyme.md"]).toContain("Thyme");
    const base = baseOf(state) ?? {};
    expect(base["wiki/basil.md"]).toContain("A working-tree line.");
    expect(base["wiki/thyme.md"]).toBe(null);
    expect(base["wiki/herb-bed.md"]).toBe(pagesOf(state)["wiki/herb-bed.md"]);
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
    expect(pagesOf(state)).toMatchObject({ "wiki/basil.md": BASIL, "wiki/start.md": START });
    expect(Object.keys(pagesOf(state))).not.toContain("wiki/mint.md");
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
      expect(Object.keys(pagesOf(state))).toContain("wiki/herb-bed.md");
      expect(contentRootsOf(state.law)).toEqual(["wiki"]);
      expect([...state.law.files.keys()]).toContain("libraries/kit-garden/types/planting.yaml");
    }
    expect((await indexState(root)).renames).toEqual([
      { from: "wiki/start.md", to: "wiki/begin.md" },
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

  it("reads no page that is a symbolic link, in any constructor", async () => {
    const dir = vault();
    symlinkSync("herb-bed.md", join(dir, "wiki/alias.md"));
    gitCommitAll(dir);
    for (const state of [
      await fsState(dir),
      await indexState(dir),
      await revisionState(dir, "HEAD"),
    ]) {
      expect([state.kind, Object.keys(pagesOf(state))]).toEqual([
        state.kind,
        ["wiki/basil.md", "wiki/herb-bed.md", "wiki/start.md"],
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
        writeFileSync(join(dir, "wiki/basil.md"), BASIL_EDITED);
        writeFileSync(
          join(dir, "constitution/types/guide.yaml"),
          "type: guide\nrole: hub\ndescription: Changed mid-read.\n",
        );
      },
    });
    expect(pagesOf(state)["wiki/basil.md"]).toBe(BASIL_EDITED);
    expect(lawText(state, "constitution/types/guide.yaml")).toContain("Changed mid-read.");
  });

  it("refuses with state-changed-during-read when the tree changes on the retry too", async () => {
    const dir = vault();
    let n = 0;
    const read = fsState(dir, {
      betweenReads: () => {
        n += 1;
        writeFileSync(join(dir, "wiki/basil.md"), `${BASIL}\nEdit ${n}.\n`);
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
        if (attempt === 1) rmSync(join(dir, "wiki/start.md"));
      },
    });
    expect(Object.keys(pagesOf(state))).toEqual(["wiki/basil.md", "wiki/herb-bed.md"]);
  });
});
