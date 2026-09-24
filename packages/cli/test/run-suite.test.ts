// tools/run-suite.ts: the suite runs as one `bun test` process per file, and a
// run passes only when every file does. A runner that lost a failure would turn
// the gate green over a red file, so the failure paths are what this asserts.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const RUNNER = fileURLToPath(new URL("../../../tools/run-suite.ts", import.meta.url));
// The runner is a Bun script; under the node runner the `bun` on PATH runs it,
// found once as an absolute path so a run whose PATH does not hold it still can.
const BUN_PATH =
  process.versions["bun"] === undefined
    ? execFileSync("sh", ["-c", "command -v bun"], { encoding: "utf8" }).trim()
    : process.execPath;
const NODE_PATH = execFileSync("sh", ["-c", "command -v node"], { encoding: "utf8" }).trim();

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
  cwd?: string,
): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(BUN_PATH, [RUNNER, ...files], {
    encoding: "utf8",
    env,
    ...(cwd === undefined ? {} : { cwd }),
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
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

  it("a relative PATH entry is resolved against the runner's directory, so a test in another finds node", () => {
    if (POSIX_ONLY) return;
    // node-bin/node beside the runner's working directory, and PATH naming it
    // relatively: the file's test spawns the runtime from the repository root.
    const cwd = at("relative");
    mkdirSync(join(cwd, "node-bin"), { recursive: true });
    symlinkSync(NODE_PATH, join(cwd, "node-bin", "node"));
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: "node-bin" };
    delete env["WIKIWRIGHT_CLI_RUNTIME"];
    const r = run([at("runtime.test.ts")], env, cwd);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(
      r.stdout.includes(`The CLI ran under ${join(realpathSync(cwd), "node-bin", "node")}.`),
      r.stdout,
    );
  });

  it("with no node on PATH and no override it refuses to run, rather than run the CLI under Bun", () => {
    if (POSIX_ONLY) return;
    const empty = at("no-node");
    mkdirSync(empty, { recursive: true });
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: empty };
    delete env["WIKIWRIGHT_CLI_RUNTIME"];
    const r = run([at("passing.test.ts")], env);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /^run-suite: no `node` on PATH/mu);
    assert.doesNotMatch(r.stdout, /passing\.test\.ts/u, "no file ran");
  });

  it("a file that runs no test fails the run rather than passing it", () => {
    const r = run([at("empty.test.ts")]);
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stdout, /^FAIL {2}.*empty\.test\.ts \(ran no test\)$/mu);
  });
});
