// docs/roadmap.md, v2 contracts §11: check reads the working tree as one
// state, each content page read twice — the capture and the capture that
// confirms nothing moved between — and the judge, the generated artifacts
// and the envelope's bundle block all take that one state's bytes. A third
// read is the verb reading the tree again. Count reads, not wall time.

import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { notePage, writeAt, writeNoteBundle } from "./fixtures/note-bundle.ts";
import { runCli } from "./fixtures/runtime.ts";

const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));

describe("check reads the tree as one state (docs/roadmap.md)", () => {
  it("reads each page twice, once to capture and once to confirm, preserving the original bytes", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "ww-check-reads-")));
    try {
      writeNoteBundle(root);
      const page = (title: string, target: string): string =>
        notePage(title, `\nSee [[${target}]].\n`);
      const source = new Map([
        [join(root, "wiki/Alpha.md"), page("Alpha", "热重启")],
        [join(root, "wiki/热重启.md"), `﻿${page("热重启", "Alpha").replaceAll("\n", "\r\n")}`],
      ]);
      for (const [path, text] of source) writeAt(root, path.slice(root.length + 1), text);
      const log = join(root, "reads.json");
      const preload = join(root, "count-reads.cjs");
      writeFileSync(
        preload,
        `const fs = require("node:fs");
const { syncBuiltinESMExports } = require("node:module");
const original = fs.readFileSync;
const pages = new Set(${JSON.stringify([...source.keys()])});
const counts = {};
fs.readFileSync = function(path, ...args) {
  if (pages.has(String(path))) counts[path] = (counts[path] ?? 0) + 1;
  return Reflect.apply(original, this, [path, ...args]);
};
syncBuiltinESMExports();
process.on("exit", () => fs.writeFileSync(${JSON.stringify(log)}, JSON.stringify(counts)));
`,
      );
      for (const flags of [["--write"], []]) {
        const result = runCli(
          ["--require", preload, CLI, "check", ...flags, "--root", root, "--all"],
          { encoding: "utf8" },
        );
        assert.equal(result.status, 0, result.stdout + result.stderr);
        const counts: unknown = JSON.parse(readFileSync(log, "utf8"));
        assert.deepEqual(counts, Object.fromEntries([...source.keys()].map((path) => [path, 2])));
        for (const [path, text] of source) assert.equal(readFileSync(path, "utf8"), text);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
