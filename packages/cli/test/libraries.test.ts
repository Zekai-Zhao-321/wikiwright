// v2 contracts §2 (a library is imported by `libraries[].path`, its id the
// directory's basename with `kit-` stripped) · §8 (a library ships rule
// tests and examples, judged wherever it is imported). Each library under
// libraries/ imported alone by an empty bundle in a fresh repository under
// os.tmpdir(): its law loads, its names are qualified by its id, and every
// rule test and example it ships holds — so a library is proved on its own,
// not only through the corpus that imports it.
import { afterAll, describe, expect, it } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { REPO } from "./fixtures/corpora.ts";
import { cli, git } from "./fixtures/garden-cli.ts";

const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

interface Expected {
  id: string;
  types: string[];
  /**
   * The rules whose test set the library cannot carry, each `rule-untested`
   * when the library is imported alone, and why.
   */
  untested: Record<string, string>;
}

const LIBRARIES: Record<string, Expected> = {
  "kit-garden": {
    id: "garden",
    types: ["garden/bed", "garden/planting"],
    untested: {},
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
  writeFileSync(
    join(top, "bundle", "config", "engine.json"),
    `${JSON.stringify({
      schema: "wikiwright/engine",
      schema_version: 4,
      label: "importer",
      content_roots: ["wiki"],
      libraries: [{ path: `libraries/${dir}` }],
    })}\n`,
  );
  git(top, "init", "-q");
  return join(top, "bundle");
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
