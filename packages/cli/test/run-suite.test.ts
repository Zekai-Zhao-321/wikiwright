// tools/run-suite.ts: the suite runs as one `bun test` process per file, and a
// run passes only when every file does. A runner that lost a failure would turn
// the gate green over a red file, so the failure paths are what this asserts.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const RUNNER = fileURLToPath(new URL("../../../tools/run-suite.ts", import.meta.url));
// The runner is a Bun script; under the node runner the `bun` on PATH runs it.
const BUN = process.versions["bun"] === undefined ? "bun" : process.execPath;

const HEADER = 'import assert from "node:assert/strict";\nimport { it } from "node:test";\n';
const PASSING = `${HEADER}it("one", () => assert.equal(1, 1));\nit("two", () => assert.equal(2, 2));\n`;
const FAILING = `${HEADER}it("broken", () => assert.equal(1, 2));\n`;
const EMPTY = "export {};\n";
// A `before` hook over Bun's five-second default, as a hook that installs a
// kit is under load.
const SLOW_HOOK =
  'import assert from "node:assert/strict";\nimport { execFileSync } from "node:child_process";\n' +
  'import { before, it } from "node:test";\nbefore(() => { execFileSync("sleep", ["6"]); });\n' +
  'it("after a slow hook", () => assert.equal(1, 1));\n';

/** POSIX-only, like hook.test.ts: the slow hook is a `sleep` process. */
const POSIX_ONLY = process.platform === "win32";

// The runtime each file is handed in WIKIWRIGHT_CLI_RUNTIME runs a script
// with no `process.versions.bun`: the runner found a Node, not itself.
const RUNTIME_IS_NODE =
  `${HEADER}import { spawnSync } from "node:child_process";\n` +
  'it("the CLI runtime is not Bun", () => {\n' +
  '  const runtime = process.env["WIKIWRIGHT_CLI_RUNTIME"];\n' +
  '  assert.equal(typeof runtime, "string");\n' +
  '  const r = spawnSync(runtime, ["-e", "process.exit(process.versions.bun === undefined ? 0 : 7)"]);\n' +
  "  assert.equal(r.status, 0);\n" +
  "});\n";

function run(
  files: string[],
  env: NodeJS.ProcessEnv = process.env,
): { status: number | null; stdout: string } {
  const r = spawnSync(BUN, [RUNNER, ...files], { encoding: "utf8", env });
  return { status: r.status, stdout: r.stdout };
}

describe("tools/run-suite.ts passes a run only when every file passes", () => {
  let dir = "";
  const at = (name: string): string => join(dir, name);
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "ww-run-suite-"));
    writeFileSync(at("passing.test.ts"), PASSING);
    writeFileSync(at("failing.test.ts"), FAILING);
    writeFileSync(at("empty.test.ts"), EMPTY);
    writeFileSync(at("slow-hook.test.ts"), SLOW_HOOK);
    writeFileSync(at("runtime.test.ts"), RUNTIME_IS_NODE);
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  it("exits 0 and totals the counts when every file passes", () => {
    const r = run([at("passing.test.ts")]);
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /^ok\s+2\s.*passing\.test\.ts$/mu);
    assert.match(r.stdout, /^ 2 pass$/mu);
    assert.match(r.stdout, /^ 0 fail$/mu);
    assert.match(r.stdout, /^Ran 2 tests across 1 file, 1 at a time\./mu);
  });

  it("exits 1 when one file fails, prints its output, and still runs the others", () => {
    const r = run([at("passing.test.ts"), at("failing.test.ts")]);
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stdout, /^FAIL {2}.*failing\.test\.ts \(failed\)$/mu);
    assert.match(r.stdout, /broken/u, "the failing file's own output is printed");
    assert.match(r.stdout, /^ok\s+2\s.*passing\.test\.ts$/mu);
    assert.match(r.stdout, /^ 2 pass$/mu);
    assert.match(r.stdout, /^ 1 fail$/mu);
    assert.match(r.stdout, /^1 file\(s\) failed: .*failing\.test\.ts$/mu);
  });

  it("a hook over Bun's five-second default passes under the runner's budget", {
    timeout: 30_000,
  }, () => {
    if (POSIX_ONLY) return;
    const r = run([at("slow-hook.test.ts")]);
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /^ok\s+1\s.*slow-hook\.test\.ts$/mu);
  });

  it("hands every file a Node to run the CLI under, and names it (docs/roadmap.md)", () => {
    const env = { ...process.env };
    delete env["WIKIWRIGHT_CLI_RUNTIME"];
    const r = run([at("runtime.test.ts")], env);
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /^The CLI ran under .*node(\.exe)?\.$/mu);
  });

  it("a file that runs no test fails the run rather than passing it", () => {
    const r = run([at("empty.test.ts")]);
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stdout, /^FAIL {2}.*empty\.test\.ts \(ran no test\)$/mu);
  });
});
