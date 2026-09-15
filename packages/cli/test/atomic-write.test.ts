// docs/architecture.md §Directories: the shell's one staged replace. Bytes land
// in an exclusive temp file beside the target and are renamed into place, every
// file of a batch staged before the first rename — so an interrupted write
// leaves the old bytes and no debris beside them.
import assert from "node:assert/strict";
import {
  chmodSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { replaceFile, replaceFiles } from "../src/atomicwrite.ts";

function scratch(): string {
  return mkdtempSync(join(tmpdir(), "ww-atomic-"));
}

describe("the staged replace lands bytes or leaves the old ones", () => {
  it("replaces a file's bytes and leaves no temp beside them", () => {
    const dir = scratch();
    try {
      const target = join(dir, "note.md");
      writeFileSync(target, "old\n");
      replaceFile(target, "new\n");
      assert.equal(readFileSync(target, "utf8"), "new\n");
      assert.deepEqual(readdirSync(dir), ["note.md"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes a file whose directory does not exist yet", () => {
    const dir = scratch();
    try {
      const target = join(dir, "generated", "manifest.json");
      replaceFile(target, "{}\n");
      assert.equal(readFileSync(target, "utf8"), "{}\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("stages every file of a batch before the first rename, so a failure lands none", () => {
    const dir = scratch();
    try {
      const first = join(dir, "first.md");
      writeFileSync(first, "old\n");
      // The second entry's directory is a FILE, so staging it throws — after the
      // first is staged and before anything is renamed.
      assert.throws(() =>
        replaceFiles([
          { path: first, contents: "new\n" },
          { path: join(first, "inside.md"), contents: "never\n" },
        ]),
      );
      assert.equal(
        readFileSync(first, "utf8"),
        "old\n",
        "a staged batch that failed landed a file",
      );
      assert.deepEqual(readdirSync(dir), ["first.md"], "a failed batch left debris");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("lands a whole batch together", () => {
    const dir = scratch();
    try {
      const entries = ["a.md", "b.md", "c.md"].map((name) => ({
        path: join(dir, name),
        contents: `${name}\n`,
      }));
      replaceFiles(entries);
      assert.deepEqual(readdirSync(dir).sort(), ["a.md", "b.md", "c.md"]);
      for (const entry of entries) assert.equal(readFileSync(entry.path, "utf8"), entry.contents);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps the mode the file had, so a file made private stays private", () => {
    if (process.platform === "win32") return;
    const dir = scratch();
    try {
      // The temp file is created under this process's umask; renaming it over a
      // private file would publish that file's contents.
      for (const mode of [0o600, 0o640]) {
        const target = join(dir, `store-${mode.toString(8)}.json`);
        writeFileSync(target, "{}\n");
        chmodSync(target, mode);
        replaceFile(target, '{"granted":1}\n');
        assert.equal(statSync(target).mode & 0o777, mode, `mode ${mode.toString(8)} was not kept`);
        assert.equal(readFileSync(target, "utf8"), '{"granted":1}\n');
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a reader never sees a partly written file: the target is renamed, never appended", () => {
    const dir = scratch();
    try {
      const target = join(dir, "big.md");
      writeFileSync(target, "old\n");
      const big = `${"x".repeat(1024 * 512)}\n`;
      replaceFile(target, big);
      assert.equal(readFileSync(target, "utf8").length, big.length);
      assert.deepEqual(readdirSync(dir), ["big.md"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
