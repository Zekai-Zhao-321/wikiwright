// A mechanical folder-tag fix must pass the type law before the first write.
// An invalid proposed fix refuses both the dry run and the real invocation.
import { afterAll, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cli, findingsOf } from "./fixtures/garden-cli.ts";
import { NOTE_TYPE, notePage, writeAt, writeNoteBundle } from "./fixtures/note-bundle.ts";

const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

describe("check --fix validates its proposed page bytes", () => {
  it("does not land a folder tag that exceeds the effective tags shape", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "ww-fix-shape-")));
    made.push(dir);
    writeNoteBundle(dir, ["Basil"], { folder_tags: { mode: "materialize-add-only" } });
    writeAt(
      dir,
      "constitution/vocabularies/tags.yaml",
      "vocabulary: tags\nmode: registered\nentries:\n  bed: {}\n  herb: {}\n",
    );
    writeAt(
      dir,
      "constitution/types/note.yaml",
      `${NOTE_TYPE}fields:\n  type: object\n  properties:\n    tags:\n      type: array\n      items: { type: string }\n      maxItems: 1\n`,
    );
    const path = join(dir, "wiki/bed/Basil.md");
    const before = notePage("Basil").replace("title: Basil", "title: Basil\ntags: [herb]");
    writeAt(dir, "wiki/bed/Basil.md", before);
    rmSync(join(dir, "wiki/Basil.md"));
    for (const args of [
      ["check", "--fix", "--dry-run"],
      ["check", "--fix"],
    ]) {
      const result = cli(args, dir);
      expect(result.status).toBe(5);
      expect(result.envelope.error?.code).toBe("fix-invalid");
      expect(result.envelope.metadata.bundle?.["label"]).toBe("notes");
      expect(findingsOf(result.envelope, "page-shape-invalid").map((f) => f.path)).toEqual([
        "wiki/bed/Basil.md",
      ]);
      expect(readFileSync(path, "utf8")).toBe(before);
      expect(existsSync(join(dir, "generated"))).toBe(false);
    }
  });
});
