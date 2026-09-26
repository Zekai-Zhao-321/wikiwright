// A write may not validate one disk/law capture and land over another. The
// preload changes a page and its type between the first capture and the
// final before-write capture; both real and dry runs must refuse it.
import { afterAll, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { notePage, writeAt, writeNoteBundle } from "./fixtures/note-bundle.ts";
import { runCli } from "./fixtures/runtime.ts";

const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));
const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

describe("write holds the accepted disk and law until landing", () => {
  it("refuses an edit made while its temporary page is staged", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "ww-write-late-snapshot-")));
    made.push(dir);
    writeNoteBundle(dir, ["Basil"]);
    const page = join(dir, "wiki/Basil.md");
    const type = join(dir, "constitution/types/note.yaml");
    const original = readFileSync(page);
    const drafts = join(dir, "drafts");
    writeAt(drafts, "wiki/Basil.md", notePage("Basil", "Draft change.\n"));
    writeAt(
      drafts,
      "ops.json",
      JSON.stringify({
        bases: { "wiki/Basil.md": createHash("sha256").update(original).digest("hex") },
      }),
    );
    const concurrent = notePage("Basil", "Concurrent change while staging.\n");
    const newType =
      "type: note\nrole: concept\ndescription: A note.\nfields:\n  type: object\n  properties:\n    moisture: { type: string }\n  required: [moisture]\n";
    const marker = join(dir, "injected");
    const preload = join(dir, "late-stage.cjs");
    writeFileSync(
      preload,
      `const fs = require("node:fs");
const { syncBuiltinESMExports } = require("node:module");
const open = fs.openSync;
let injected = false;
fs.openSync = function(path, ...args) {
  const fd = Reflect.apply(open, this, [path, ...args]);
  if (!injected && String(path).startsWith(${JSON.stringify(`${page}.wikiwright-tmp-`)})) {
    injected = true;
    fs.writeFileSync(${JSON.stringify(marker)}, "injected");
    fs.writeFileSync(${JSON.stringify(page)}, ${JSON.stringify(concurrent)});
    fs.writeFileSync(${JSON.stringify(type)}, ${JSON.stringify(newType)});
  }
  return fd;
};
syncBuiltinESMExports();
`,
    );
    const result = runCli(["--require", preload, CLI, "write", "--from", drafts, "--root", dir], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, WIKIWRIGHT_TODAY: "2026-09-26" },
    });
    const envelope = JSON.parse(result.stdout) as { error?: { code: string } };
    expect(readFileSync(marker, "utf8")).toBe("injected");
    expect(result.status).toBe(4);
    expect(envelope.error?.code).toBe("state-changed-before-write");
    expect(readFileSync(page, "utf8")).toBe(concurrent);
    expect(readFileSync(type, "utf8")).toBe(newType);
  });

  it.each([false, true])("refuses a concurrent page and type edit (dry run: %s)", (dry) => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "ww-write-snapshot-")));
    made.push(dir);
    writeNoteBundle(dir, ["Basil"]);
    const original = readFileSync(join(dir, "wiki/Basil.md"));
    const drafts = join(dir, "drafts");
    writeAt(drafts, "wiki/Basil.md", notePage("Basil", "Draft change.\n"));
    writeAt(
      drafts,
      "ops.json",
      JSON.stringify({
        bases: { "wiki/Basil.md": createHash("sha256").update(original).digest("hex") },
      }),
    );
    const marker = join(dir, "injected");
    const concurrent = notePage("Basil", "Concurrent editor change.\n");
    const newType =
      "type: note\nrole: concept\ndescription: A note.\nfields:\n  type: object\n  properties:\n    moisture: { type: string }\n  required: [moisture]\n";
    const preload = join(dir, "change-during-write.cjs");
    writeFileSync(
      preload,
      `const fs = require("node:fs");
const { syncBuiltinESMExports } = require("node:module");
const original = fs.readFileSync;
let reads = 0;
fs.readFileSync = function(path, ...args) {
  if (String(path) === ${JSON.stringify(join(dir, "config/engine.json"))} && ++reads === 3) {
    fs.writeFileSync(${JSON.stringify(marker)}, "injected");
    fs.writeFileSync(${JSON.stringify(join(dir, "wiki/Basil.md"))}, ${JSON.stringify(concurrent)});
    fs.writeFileSync(${JSON.stringify(join(dir, "constitution/types/note.yaml"))}, ${JSON.stringify(newType)});
  }
  return Reflect.apply(original, this, [path, ...args]);
};
syncBuiltinESMExports();
`,
    );
    const argv = ["--require", preload, CLI, "write", "--from", drafts, "--root", dir];
    if (dry) argv.push("--dry-run");
    const result = runCli(argv, {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, WIKIWRIGHT_TODAY: "2026-09-26" },
    });
    const envelope = JSON.parse(result.stdout) as { error?: { code: string } };
    expect(readFileSync(marker, "utf8")).toBe("injected");
    expect(result.status).toBe(4);
    expect(envelope.error?.code).toBe("state-changed-before-write");
    expect(readFileSync(join(dir, "wiki/Basil.md"), "utf8")).toBe(concurrent);
    expect(readFileSync(join(dir, "constitution/types/note.yaml"), "utf8")).toBe(newType);
  });
});
