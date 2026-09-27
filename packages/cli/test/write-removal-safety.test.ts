import { afterAll, describe, expect, it } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cli } from "./fixtures/garden-cli.ts";
import { notePage, writeAt, writeNoteBundle } from "./fixtures/note-bundle.ts";

const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

describe("write move removal preflight", () => {
  it("refuses a source directory that cannot release the moved page", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "ww-move-removal-")));
    made.push(dir);
    writeNoteBundle(dir, ["Basil"]);
    const from = "wiki/old/Basil.md";
    const to = "wiki/new/Basil.md";
    writeAt(dir, from, notePage("Basil"));
    rmSync(join(dir, "wiki/Basil.md"));
    writeAt(
      dir,
      "drafts/ops.json",
      JSON.stringify({ move: [{ from, to, reason: "Move the note." }] }),
    );
    const source = join(dir, from);
    const destination = join(dir, to);
    const before = readFileSync(source, "utf8");
    chmodSync(join(dir, "wiki/old"), 0o555);
    try {
      for (const args of [
        ["write", "--from", "drafts", "--dry-run"],
        ["write", "--from", "drafts"],
      ]) {
        const result = cli(args, dir);
        expect(result.status).toBe(4);
        expect(result.envelope.error?.code).toBe("replacement-target-refused");
        expect(readFileSync(source, "utf8")).toBe(before);
        expect(existsSync(destination)).toBe(false);
      }
    } finally {
      chmodSync(join(dir, "wiki/old"), 0o755);
    }
  });
});
