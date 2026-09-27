// YAML aliases that point back to themselves are malformed input, not an
// unhandled stack overflow in page or law normalization.
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

describe("cyclic YAML aliases", () => {
  it("reports a page frontmatter finding instead of an internal error", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "ww-yaml-cycle-")));
    made.push(dir);
    writeNoteBundle(dir, ["Basil"], { extensions: { mode: "open" } });
    writeAt(
      dir,
      "wiki/Basil.md",
      notePage("Basil").replace("title: Basil", "title: Basil\nloop: &loop [*loop]"),
    );
    const result = cli(["check", "--all"], dir);
    expect(result.status).toBe(5);
    expect(findingsOf(result.envelope, "malformed-frontmatter").map((f) => f.path)).toEqual([
      "wiki/Basil.md",
    ]);
  });

  it("refuses a cyclic type document as constitution-invalid", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "ww-yaml-law-cycle-")));
    made.push(dir);
    writeNoteBundle(dir, ["Basil"]);
    writeAt(dir, "constitution/types/note.yaml", `${NOTE_TYPE}loop: &loop [*loop]\n`);
    const result = cli(["check"], dir);
    expect(result.status).toBe(2);
    expect(result.envelope.error?.code).toBe("constitution-invalid");
    expect(result.envelope.data?.["issues"]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ where: "bundle:constitution/types/note.yaml" }),
      ]),
    );
  });
});
