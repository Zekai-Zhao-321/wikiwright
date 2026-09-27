// v2 contracts §2 (a library is imported by `libraries[].path`, its id the
// directory's basename with `kit-` stripped) · §8 (a library ships rule
// tests and examples, judged wherever it is imported). Each library under
// libraries/ imported alone by an empty bundle in a fresh repository under
// os.tmpdir(): its law loads, its names are qualified by its id, and every
// rule test and example it ships holds — so a library is proved on its own,
// not only through the corpus that imports it.
import { afterAll, describe, expect, it } from "bun:test";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { corpusCopy, REPO, removeCopies } from "./fixtures/corpora.ts";
import { cli, git } from "./fixtures/garden-cli.ts";

const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
  removeCopies();
});

interface Expected {
  id: string;
  types: string[];
  /**
   * The rules whose test set the library cannot carry, each `rule-untested`
   * when the library is imported alone — a warning under `check`, an error
   * at the gate once the bundle has a HEAD — and why.
   */
  untested: Record<string, string>;
}

const LIBRARIES: Record<string, Expected> = {
  "kit-code": {
    id: "code",
    types: [
      "code/architecture-overview",
      "code/concept",
      "code/decision",
      "code/integration",
      "code/ops-reference",
      "code/quickstart",
      "code/source-map",
      "code/subsystem",
      "code/testing-guide",
    ],
    untested: {
      // A negative page points a relation at a page of the wrong type, and a
      // test page's links resolve against the importing vault (§8): the set
      // lives with the consuming bundle, devwiki.
      "relation-range": "its negative names a page of the vault that imports it",
    },
  },
  "kit-garden": {
    id: "garden",
    types: ["garden/bed", "garden/planting"],
    untested: {},
  },
  "source-kit": {
    id: "source-kit",
    types: ["source-kit/field-note", "source-kit/observation", "source-kit/seed-catalog"],
    untested: {
      // Its rule-test pages resolve their cited sources from the importing bundle.
      "observation-source-type": "its tests live in fixtures/source-policy",
    },
  },
};

/** An empty bundle importing `libraries/<dir>`, the library's tracked files beside it. */
function importing(dir: string): string {
  const top = mkdtempSync(join(tmpdir(), "ww-library-"));
  made.push(top);
  const files = git(REPO, "-c", "core.quotepath=off", "ls-files", "-z", "--", `libraries/${dir}`)
    .split("\0")
    .filter((p) => p !== "");
  for (const path of files) {
    mkdirSync(dirname(join(top, path)), { recursive: true });
    copyFileSync(join(REPO, path), join(top, path));
  }
  mkdirSync(join(top, "bundle", "config"), { recursive: true });
  mkdirSync(join(top, "bundle", "wiki"), { recursive: true });
  engine(join(top, "bundle"), dir);
  git(top, "init", "-q");
  return join(top, "bundle");
}

/** The importing bundle's engine.json, naming `libraries/<dir>`, or no library. */
function engine(root: string, dir: string | null): void {
  writeFileSync(
    join(root, "config", "engine.json"),
    `${JSON.stringify({
      schema: "wikiwright/engine",
      schema_version: 4,
      label: "importer",
      content_roots: ["wiki"],
      ...(dir === null ? {} : { libraries: [{ path: `libraries/${dir}` }] }),
    })}\n`,
  );
}

describe("every library under libraries/ holds on its own", () => {
  it("names every directory under libraries/", () => {
    expect(readdirSync(join(REPO, "libraries")).sort()).toEqual(Object.keys(LIBRARIES).sort());
  });

  for (const [dir, expected] of Object.entries(LIBRARIES)) {
    it(`${dir}: loads as ${expected.id}, and its rule tests and examples hold`, () => {
      const root = importing(dir);
      const types = cli(["type", "list"], root);
      expect(types.status).toBe(0);
      const names = ((types.envelope.data?.["types"] ?? []) as { name: string }[]).map(
        (t) => t.name,
      );
      expect(names).toEqual(expected.types);
      expect(cli(["check", "--write"], root).status).toBe(0);
      const judged = cli(["check", "--all"], root);
      const blocking = (judged.envelope.data?.findings ?? []).filter((f) => f.severity !== "info");
      expect(blocking.map((f) => [f.rule, f.details["rule"]])).toEqual(
        Object.keys(expected.untested).map((rule) => ["rule-untested", rule]),
      );
    });
  }
});

describe("the gate over the commit that imports a library (§8)", () => {
  // A rule the law diff adds is held to its test set at the gate: untested,
  // it is an error, not the warning check gives. A library that cannot
  // carry a rule's test set therefore cannot be imported into a bundle with
  // a HEAD until the bundle carries that set under its own rule-tests/.
  for (const [dir, expected] of Object.entries(LIBRARIES)) {
    it(`${dir}: refused for each rule it ships no test set of, and only after a first commit`, () => {
      const root = importing(dir);
      const top = dirname(root);
      engine(root, null);
      git(top, "add", "-A", "--", "bundle");
      git(top, "commit", "-q", "--no-verify", "-m", "an empty bundle");
      engine(root, dir);
      expect(cli(["check", "--write"], root).status).toBe(0);
      git(top, "add", "-A");
      const gate = cli(["gate"], root);
      const errors = (gate.envelope.data?.findings ?? []).filter((f) => f.severity === "error");
      expect(errors.map((f) => [f.rule, f.details["rule"]])).toEqual(
        Object.keys(expected.untested).map((rule) => ["rule-untested", rule]),
      );
      expect(gate.status).toBe(Object.keys(expected.untested).length > 0 ? 5 : 0);

      // With no HEAD there is no law diff: the same import is a warning.
      const first = importing(dir);
      expect(cli(["check", "--write"], first).status).toBe(0);
      git(dirname(first), "add", "-A");
      expect(cli(["gate"], first).status).toBe(0);
    });
  }
});

describe("library code's bounds hold over the bundle that imports it", () => {
  it("a second quickstart page in devwiki breaks code/quickstart's one-page bound", () => {
    const { root } = corpusCopy("devwiki");
    const page = readFileSync(join(root, "wiki", "wikiwright-quickstart.md"), "utf8");
    writeFileSync(
      join(root, "wiki", "second-quickstart.md"),
      page.replaceAll("wikiwright quickstart", "second quickstart"),
    );
    const judged = cli(["check", "--all"], root);
    expect(
      (judged.envelope.data?.findings ?? [])
        .filter((f) => f.rule.startsWith("instances-"))
        .map((f) => [f.rule, f.path, f.details["count"]]),
    ).toEqual([["instances-max", "code:types/quickstart.yaml", 2]]);
  });
});
