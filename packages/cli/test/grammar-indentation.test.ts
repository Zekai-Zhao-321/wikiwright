// One to three leading spaces are still a top-level CommonMark list item.
// The fixed grammar must reject their noncanonical spelling, not ignore it.
import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cli, findingsOf } from "./fixtures/garden-cli.ts";
import { NOTE_TYPE, notePage, writeAt, writeNoteBundle } from "./fixtures/note-bundle.ts";

const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

describe("top-level list indentation under a grammar", () => {
  it("does not carry a list item across a separate opaque block", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "ww-grammar-separator-")));
    made.push(dir);
    writeNoteBundle(dir, ["Basil"]);
    writeAt(
      dir,
      "constitution/types/note.yaml",
      `${NOTE_TYPE}sections:\n  list:\n    - heading: Facts\n      grammar: claims\n      provenance: required\n`,
    );
    for (const separator of ["```text\nblock\n```", "<!-- separated -->", "---"]) {
      writeAt(
        dir,
        "wiki/Basil.md",
        notePage(
          "Basil",
          `\n## Facts\n\n- [observation] Basil is growing. ([[Basil]])\n\n${separator}\n\n  - [observation] An unsupported claim.\n`,
        ),
      );
      const result = cli(["check", "--all"], dir);
      expect(result.status).toBe(5);
      expect(findingsOf(result.envelope, "item-unparsed").map((f) => f.path)).toEqual([
        "wiki/Basil.md",
      ]);
    }
  });

  it("judges every CommonMark top-level bullet and retains nested rationale", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "ww-grammar-indent-")));
    made.push(dir);
    writeNoteBundle(dir, ["Basil"]);
    writeAt(
      dir,
      "constitution/types/note.yaml",
      `${NOTE_TYPE}sections:\n  list:\n    - heading: Facts\n      grammar: claims\n      provenance: required\n`,
    );
    for (const indent of [0, 1, 2, 3]) {
      writeAt(
        dir,
        "wiki/Basil.md",
        notePage("Basil", `\n## Facts\n\n${" ".repeat(indent)}- [observation] Basil is growing.\n`),
      );
      const result = cli(["check", "--write", "--all"], dir);
      expect(result.status).toBe(5);
      const rule = indent === 0 ? "claim-provenance" : "item-unparsed";
      expect(findingsOf(result.envelope, rule).map((f) => f.path)).toEqual(["wiki/Basil.md"]);
    }
    writeAt(
      dir,
      "wiki/Basil.md",
      notePage(
        "Basil",
        "\n## Facts\n\n- [observation] Basil is growing. ([[Basil]])\n  - supporting detail\n",
      ),
    );
    const nested = cli(["check", "--write", "--all"], dir);
    expect(nested.status).toBe(0);
    expect(findingsOf(nested.envelope, "item-unparsed")).toEqual([]);
    writeAt(
      dir,
      "wiki/Basil.md",
      notePage(
        "Basil",
        "\n## Facts\n\n- [observation] Basil is growing. ([[Basil]])\n\n  ```text\n  code sample\n  ```\n\n  - supporting detail\n",
      ),
    );
    const fenced = cli(["check", "--write", "--all"], dir);
    expect(fenced.status).toBe(0);
    expect(findingsOf(fenced.envelope, "item-unparsed")).toEqual([]);
  });
});
