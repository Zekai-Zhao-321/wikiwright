// v2 contracts §2: engine.json v4 and its libraries, loaded from a gardening
// bundle under os.tmpdir() through both adapters — the working tree and the
// git index — which must build the same snapshot from the same bytes.
import { afterAll, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@wikiwright/core";
import {
  ENGINE_V4_CONSUMERS,
  ENGINE_V4_SCHEMA,
  type LawSnapshot,
  loadEngineV4,
  loadTypeLaw,
  type TypeLawResult,
} from "@wikiwright/core";
import { indexLawSnapshot, workingTreeLawSnapshot } from "../src/lawfiles.ts";
import {
  bareTree,
  engineJson,
  gitStageAll,
  link,
  removeTree,
  type Tree,
  writeTree,
} from "./fixtures/garden-law.ts";

const made: string[] = [];
afterAll(() => {
  for (const dir of made) removeTree(dir);
});

function tree(overrides: Tree = {}, drop: string[] = []): string {
  const files = { ...bareTree(), ...overrides };
  for (const path of drop) delete files[path];
  const dir = writeTree(files);
  made.push(dir);
  return dir;
}

async function load(dir: string, bundle = dir): Promise<TypeLawResult> {
  return loadTypeLaw(await workingTreeLawSnapshot(bundle));
}

function codes(result: TypeLawResult): string[] {
  return result.ok ? [] : result.issues.map((i) => i.code);
}

/** Each adapter's issues as `code:where`, the working tree's first. */
async function both(dir: string): Promise<string[][]> {
  const issues = (result: TypeLawResult) =>
    result.ok ? [] : result.issues.map((i) => `${i.code}:${i.where}`);
  return [
    issues(loadTypeLaw(await workingTreeLawSnapshot(dir))),
    issues(loadTypeLaw(await indexLawSnapshot(dir))),
  ];
}

const bytes = (text: string) => new TextEncoder().encode(text);

describe("engine.json v4", () => {
  it("loads the key table with every default applied", () => {
    const loaded = loadEngineV4(
      bytes(engineJson({ libraries: undefined, source_roots: undefined })),
    );
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.engine).toEqual({
      schema: "wikiwright/engine",
      schema_version: 4,
      label: "kitchen-garden",
      content_roots: ["wiki"],
      source_roots: [],
      local_origins: [],
      libraries: [],
      commit_prefixes: [],
      field_sources: {},
      folder_tags: { mode: "off" },
      folder_tag_aliases: {},
      extensions: { mode: "registered" },
    });
  });

  it("carries every declared key", () => {
    const loaded = loadEngineV4(
      bytes(
        engineJson({
          engine: ">=0.1.0 <0.2.0",
          commit_prefixes: ["feat", "fix"],
          field_sources: { title: "basename" },
          folder_tags: { mode: "validate" },
          folder_tag_aliases: { beds: "bed" },
          extensions: { mode: "open" },
        }),
      ),
    );
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.engine.engine).toBe(">=0.1.0 <0.2.0");
    expect(loaded.engine.commit_prefixes).toEqual(["feat", "fix"]);
    expect(loaded.engine.field_sources).toEqual({ title: "basename" });
    expect(loaded.engine.folder_tags).toEqual({ mode: "validate" });
    expect(loaded.engine.folder_tag_aliases).toEqual({ beds: "bed" });
    expect(loaded.engine.extensions).toEqual({ mode: "open" });
  });

  it.each([
    ["an unknown key (a dropped v3 key)", { modules: [] }, 'unknown key "modules"'],
    ["schema version 3", { schema_version: 3 }, "/schema_version"],
    ["a label outside the name grammar", { label: "Kitchen Garden" }, "/label"],
    ["a range the engine cannot parse", { engine: "latest" }, "/engine"],
    ["a root that leaves the bundle", { content_roots: ["../wiki"] }, "/content_roots/0"],
    ["a library entry with a stray key", { libraries: [{ path: "x", id: "y" }] }, "unknown key"],
  ])("refuses %s as engine-invalid", (_label, overrides, fragment) => {
    const loaded = loadEngineV4(bytes(engineJson(overrides)));
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.issues.every((i) => i.code === "engine-invalid")).toBe(true);
    expect(loaded.issues.map((i) => i.message).join("\n")).toContain(fragment);
  });

  it("names what reads every key of the schema, and no other key", () => {
    // A null consumer is a key with no reader yet (contracts §12 steps 3 and
    // 4); docs/roadmap.md names each one.
    expect(Object.keys(ENGINE_V4_CONSUMERS).sort()).toEqual(
      Object.keys(ENGINE_V4_SCHEMA.properties).sort(),
    );
  });

  it("holds every declared key to one end-to-end CLI fixture", () => {
    const testDir = fileURLToPath(new URL("./", import.meta.url));
    const counts = new Map<string, number>();
    for (const name of readdirSync(testDir).filter((file) => file.endsWith(".test.ts"))) {
      const source = readFileSync(join(testDir, name), "utf8");
      for (const match of source.matchAll(/\be2e:([a-z_]+)\b/gu)) {
        const key = match[1] ?? "";
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    expect([...counts.keys()].sort()).toEqual(Object.keys(ENGINE_V4_SCHEMA.properties).sort());
    expect([...counts.values()].every((count) => count === 1)).toBe(true);
  });

  it("names, for every key it says is read, an exported function of core or the shell that reads it", async () => {
    for (const [key, reader] of Object.entries(ENGINE_V4_CONSUMERS)) {
      if (reader === null) continue;
      let exported = core as Record<string, unknown>;
      let name = reader;
      if (reader.startsWith("cli/")) {
        const [module = "", fn = ""] = reader.slice("cli/".length).split(":");
        exported = (await import(`../src/${module}`)) as Record<string, unknown>;
        name = fn;
      }
      const fn = exported[name];
      expect([key, typeof fn]).toEqual([key, "function"]);
      expect([key, String(fn).includes(key)]).toEqual([key, true]);
    }
    expect(Object.values(ENGINE_V4_CONSUMERS).filter((reader) => reader === null)).toEqual([]);
  });

  it("refuses an absent file and a file that is not JSON", () => {
    for (const loaded of [loadEngineV4(undefined), loadEngineV4(bytes("{ label: x"))]) {
      expect(loaded.ok).toBe(false);
      if (!loaded.ok) expect(loaded.issues.map((i) => i.code)).toEqual(["engine-invalid"]);
    }
  });
});

describe("libraries", () => {
  it("resolves a library path against the top level; its id is the basename less kit-", async () => {
    const result = await load(tree());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.law.libraries).toEqual([
      { declared: "libraries/kit-garden", root: "libraries/kit-garden", id: "garden" },
    ]);
  });

  it("names the library the same way from a bundle in a subdirectory", async () => {
    const dir = tree({}, ["config/engine.json"]);
    mkdirSync(join(dir, "handbook/config"), { recursive: true });
    writeFileSync(join(dir, "handbook/config/engine.json"), engineJson());
    gitStageAll(dir);
    for (const snapshot of [
      await workingTreeLawSnapshot(join(dir, "handbook")),
      await indexLawSnapshot(join(dir, "handbook")),
    ]) {
      expect(snapshot.bundle).toBe("handbook");
      const result = loadTypeLaw(snapshot);
      expect(result.ok).toBe(true);
      if (result.ok)
        expect(result.law.libraries.map((l) => l.root)).toEqual(["libraries/kit-garden"]);
    }
  });

  it("places a bundle whose directory is spelled in NFD by its NFC name, from both adapters", async () => {
    const nfd = "potage\u0300re";
    const dir = tree({}, ["config/engine.json"]);
    mkdirSync(join(dir, nfd, "config"), { recursive: true });
    mkdirSync(join(dir, nfd, "constitution/types"), { recursive: true });
    writeFileSync(join(dir, nfd, "config/engine.json"), engineJson());
    writeFileSync(
      join(dir, nfd, "constitution/types/bed.yaml"),
      "type: bed\nrole: reference\ndescription: One bed.\n",
    );
    gitStageAll(dir);
    for (const snapshot of [
      await workingTreeLawSnapshot(join(dir, nfd)),
      await indexLawSnapshot(join(dir, nfd)),
    ]) {
      expect(snapshot.bundle).toBe(nfd.normalize("NFC"));
      const result = loadTypeLaw(snapshot);
      expect(result.ok ? [...result.law.types.keys()] : result.issues).toEqual(["bed"]);
    }
  });

  it("takes an explicit id from library.yaml", async () => {
    const result = await load(tree({ "libraries/kit-garden/library.yaml": "id: vegetables\n" }));
    expect(result.ok && result.law.libraries[0]?.id).toBe("vegetables");
  });

  it.each([
    ["a key other than id", "id: veg\nversion: 2\n"],
    ["an id outside the name grammar", "id: Veg_Beds\n"],
    ["a file that is not YAML", "id: [veg\n"],
  ])("refuses a library.yaml with %s as library-invalid", async (_label, text) => {
    const result = await load(tree({ "libraries/kit-garden/library.yaml": text }));
    expect(codes(result)).toEqual(["library-invalid"]);
  });

  it.each([
    ["a parent path", "../elsewhere"],
    ["an absolute path", "/etc"],
    ["the repository itself", "."],
  ])("refuses %s as library-outside-repository", async (_label, path) => {
    const result = await load(
      tree({ "config/engine.json": engineJson({ libraries: [{ path }] }) }),
    );
    expect(codes(result)).toEqual(["library-outside-repository"]);
  });

  it("refuses a library directory that is a link out of the repository, from both adapters", async () => {
    const outside = tree({}, ["config/engine.json"]);
    const dir = tree({
      "config/engine.json": engineJson({ libraries: [{ path: "libraries/kit-far" }] }),
    });
    link(dir, "libraries/kit-far", join(outside, "libraries/kit-garden"));
    gitStageAll(dir);
    expect(await both(dir)).toEqual([["law-foreign-file:far:."], ["law-foreign-file:far:."]]);
  });

  it("refuses a library path that names no directory", async () => {
    const dir = tree({
      "config/engine.json": engineJson({ libraries: [{ path: "libraries/kit-herbs" }] }),
    });
    expect(codes(await load(dir))).toEqual(["library-missing"]);
    gitStageAll(dir);
    expect(codes(loadTypeLaw(await indexLawSnapshot(dir)))).toEqual(["library-missing"]);
  });

  it("refuses two libraries that take one id as constitution-collision", async () => {
    const dir = tree({
      "config/engine.json": engineJson({
        libraries: [{ path: "libraries/kit-garden" }, { path: "vendor/garden" }],
      }),
      "vendor/garden/README.md": "the same id by its basename\n",
    });
    expect(codes(await load(dir))).toEqual(["constitution-collision"]);
  });
});

describe("law-foreign-file", () => {
  it.each([
    ["a file beside the three directories of constitution/", "constitution/README.md"],
    ["a .yml document", "constitution/types/planting.yml"],
    ["a document in a nested directory", "constitution/types/beds/raised.yaml"],
    ["a non-page file under rule-tests/", "rule-tests/known-bed/notes.txt"],
    [
      "a JSON file other than expect.json under a library's examples/",
      "libraries/kit-garden/examples/page.json",
    ],
    ["a text file under a library's types/", "libraries/kit-garden/types/notes.txt"],
  ])("refuses %s", async (_label, path) => {
    const result = await load(tree({ [path]: "x\n" }));
    expect(codes(result)).toEqual(["law-foreign-file"]);
    if (!result.ok) expect(result.issues[0]?.where).toMatch(/^(bundle|garden):/u);
  });

  it("refuses a link under a law directory, from the tree and from the index", async () => {
    const dir = tree({ "constitution/vocabularies/beds.yaml": "vocabulary: beds\n" });
    link(dir, "constitution/types/planting.yaml", join(dir, "constitution/vocabularies/beds.yaml"));
    expect(codes(await load(dir))).toEqual(["law-foreign-file"]);
    gitStageAll(dir);
    expect(codes(loadTypeLaw(await indexLawSnapshot(dir)))).toEqual(["law-foreign-file"]);
  });

  it("refuses a constitution/ that is a link out of the repository, from both adapters", async () => {
    const outside = tree({
      "constitution/types/bed.yaml": "type: bed\nrole: reference\ndescription: x\n",
    });
    const dir = tree();
    link(dir, "constitution", join(outside, "constitution"));
    gitStageAll(dir);
    expect(await both(dir)).toEqual([
      ["law-foreign-file:bundle:constitution"],
      ["law-foreign-file:bundle:constitution"],
    ]);
  });

  it("refuses a library's types/ that is a link out of the repository, from both adapters", async () => {
    const outside = tree({
      "libraries/kit-garden/types/bed.yaml": "type: bed\nrole: reference\ndescription: x\n",
    });
    const dir = tree();
    link(dir, "libraries/kit-garden/types", join(outside, "libraries/kit-garden/types"));
    gitStageAll(dir);
    expect(await both(dir)).toEqual([
      ["law-foreign-file:garden:types"],
      ["law-foreign-file:garden:types"],
    ]);
  });

  it("refuses a library root that is a link inside the repository, from both adapters", async () => {
    const dir = tree(
      { "vendor/garden/types/bed.yaml": "type: bed\nrole: reference\ndescription: x\n" },
      ["libraries/kit-garden/README.md"],
    );
    link(dir, "libraries/kit-garden", "../vendor/garden");
    gitStageAll(dir);
    expect(await both(dir)).toEqual([["law-foreign-file:garden:."], ["law-foreign-file:garden:."]]);
  });

  it("refuses a library under a linked directory, from both adapters", async () => {
    const dir = tree(
      { "vendor/kit-garden/types/bed.yaml": "type: bed\nrole: reference\ndescription: x\n" },
      ["libraries/kit-garden/README.md"],
    );
    link(dir, "libraries", "vendor");
    gitStageAll(dir);
    expect(await both(dir)).toEqual([["law-foreign-file:garden:."], ["law-foreign-file:garden:."]]);
  });

  it("refuses a library that is a submodule, from both adapters", async () => {
    const dir = tree({}, ["libraries/kit-garden/README.md"]);
    execFileSync("git", ["init", "-q"], { cwd: dir });
    const library = join(dir, "libraries/kit-garden");
    mkdirSync(join(library, "types"), { recursive: true });
    writeFileSync(join(library, "types/bed.yaml"), "type: bed\nrole: reference\ndescription: x\n");
    const git = (cwd: string, args: string[]) =>
      execFileSync(
        "git",
        ["-c", "user.name=Gardener", "-c", "user.email=gardener@example.invalid", ...args],
        { cwd, stdio: "ignore" },
      );
    git(library, ["init", "-q"]);
    git(library, ["add", "-A"]);
    git(library, ["commit", "-q", "-m", "beds"]);
    git(dir, ["-c", "advice.addEmbeddedRepo=false", "add", "-A"]);
    expect(await both(dir)).toEqual([["law-foreign-file:garden:."], ["law-foreign-file:garden:."]]);
  });

  it("does not read a library's files beside its law directories", async () => {
    const result = await load(tree({ "libraries/kit-garden/LICENSE": "synthetic\n" }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect([...result.law.files.values()].map((f) => `${f.owner}:${f.path}`)).toEqual([
        "bundle:config/engine.json",
      ]);
    }
  });
});

describe("the two adapters", () => {
  it("build one snapshot from the same bytes", async () => {
    const dir = tree({
      "constitution/types/planting.yaml": "type: planting\n",
      "rule-tests/known-bed/negative.md": "---\ntype: planting\n---\n",
      "libraries/kit-garden/library.yaml": "id: garden\n",
      "libraries/kit-garden/fragments/planted.yaml": "fragment: planted\n",
      "wiki/basil.md": "not law\n",
    });
    gitStageAll(dir);
    const fromTree = await workingTreeLawSnapshot(dir);
    const fromIndex = await indexLawSnapshot(dir);
    const flat = (s: LawSnapshot) =>
      [...s.files].map(([path, f]) => [path, new TextDecoder().decode(f.bytes)] as const);
    expect(flat(fromIndex)).toEqual(flat(fromTree));
    expect([...fromIndex.directories]).toEqual([...fromTree.directories]);
    expect(fromTree.files.has("wiki/basil.md")).toBe(false);
  });

  it("reads the index, not the tree, under the index adapter", async () => {
    const dir = tree({ "constitution/types/planting.yaml": "type: planting\n" });
    gitStageAll(dir);
    writeFileSync(join(dir, "constitution/types/planting.yaml"), "type: changed\n");
    rmSync(join(dir, "libraries/kit-garden/README.md"));
    const staged = await indexLawSnapshot(dir);
    expect(
      new TextDecoder().decode(staged.files.get("constitution/types/planting.yaml")?.bytes),
    ).toBe("type: planting\n");
    expect(staged.directories.has("libraries/kit-garden")).toBe(true);
  });
});
