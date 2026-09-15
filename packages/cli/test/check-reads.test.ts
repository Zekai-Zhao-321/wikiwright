// docs/roadmap.md: check reads each content page once per invocation; the
// artifacts, brief and judge use that snapshot. Count reads, not wall time.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { documentOf } from "../../core/test/helpers/constitution.ts";

const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));

describe("check shares its content snapshot (docs/roadmap.md)", () => {
  it("reads each page once for check and check --write, preserving the original bytes", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "ww-check-reads-")));
    try {
      mkdirSync(join(root, "config"));
      mkdirSync(join(root, "wiki"));
      writeFileSync(
        join(root, "config/constitution.json"),
        JSON.stringify(
          documentOf({ types: { note: { extends: "concept", description: "A note." } } }),
        ),
      );
      writeFileSync(join(root, "config/engine.json"), JSON.stringify({ content_roots: ["wiki"] }));
      const page = (title: string, target: string): string =>
        `---\ntype: note\ntitle: ${title}\ndescription: A note.\ntags: []\n---\n\n# ${title}\n\nSee [[${target}]].\n`;
      const source = new Map([
        [join(root, "wiki/Alpha.md"), page("Alpha", "热重启")],
        [join(root, "wiki/热重启.md"), `\uFEFF${page("热重启", "Alpha").replaceAll("\n", "\r\n")}`],
      ]);
      for (const [path, text] of source) writeFileSync(path, text);
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
        const result = spawnSync(
          process.execPath,
          ["--require", preload, CLI, "check", ...flags, "--root", root, "--all"],
          { encoding: "utf8" },
        );
        assert.equal(result.status, 0, result.stdout + result.stderr);
        const counts: unknown = JSON.parse(readFileSync(log, "utf8"));
        assert.deepEqual(counts, Object.fromEntries([...source.keys()].map((path) => [path, 1])));
        for (const [path, text] of source) assert.equal(readFileSync(path, "utf8"), text);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
