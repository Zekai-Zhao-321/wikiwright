// tools/run-suite.ts: the suite runs as one `bun test` process per file, and a
// run passes only when every file does. A runner that lost a failure would turn
// the gate green over a red file, so the failure paths are what this asserts.
// Every file runs under Bun, the runner's own, and so does the CLI the tests
// spawn: there is no second runtime to hand them.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runCli } from "./fixtures/runtime.ts";

const RUNNER = fileURLToPath(new URL("../../../tools/run-suite.ts", import.meta.url));

const HEADER = 'import { expect, it } from "bun:test";\n';
const PASSING = `${HEADER}it("one", () => expect(1).toBe(1));\nit("two", () => expect(2).toBe(2));\n`;
const FAILING = `${HEADER}it("broken", () => expect(1).toBe(2));\n`;
const EMPTY = "export {};\n";
// A `beforeAll` hook over Bun's five-second default, as a hook that installs a
// kit is under load.
const SLOW_HOOK =
  'import { beforeAll, expect, it } from "bun:test";\nimport { execFileSync } from "node:child_process";\n' +
  'beforeAll(() => { execFileSync("sleep", ["6"]); });\n' +
  'it("after a slow hook", () => expect(1).toBe(1));\n';
// Each file runs under Bun, and the environment names no other runtime.
const RUNTIME_IS_BUN =
  `${HEADER}it("the file runs under Bun, and no CLI runtime is named", () => {\n` +
  '  expect(typeof process.versions["bun"]).toBe("string");\n' +
  '  expect(process.env["WIKIWRIGHT_CLI_RUNTIME"]).toBeUndefined();\n' +
  "});\n";

/** POSIX-only, like hook.test.ts: the slow hook is a `sleep` process. */
const POSIX_ONLY = process.platform === "win32";

function run(files: string[]): { status: number | null; stdout: string; stderr: string } {
  const env = { ...process.env };
  delete env["WIKIWRIGHT_CLI_RUNTIME"];
  const r = runCli([RUNNER, ...files], { encoding: "utf8", env });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe("tools/run-suite.ts passes a run only when every file passes", () => {
  let dir = "";
  const at = (name: string): string => join(dir, name);
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "ww-run-suite-"));
    writeFileSync(at("passing.test.ts"), PASSING);
    writeFileSync(at("failing.test.ts"), FAILING);
    writeFileSync(at("empty.test.ts"), EMPTY);
    writeFileSync(at("slow-hook.test.ts"), SLOW_HOOK);
    writeFileSync(at("runtime.test.ts"), RUNTIME_IS_BUN);
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("exits 0 and totals the counts when every file passes", () => {
    const r = run([at("passing.test.ts")]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^ok\s+2\s.*passing\.test\.ts$/mu);
    expect(r.stdout).toMatch(/^ 2 pass$/mu);
    expect(r.stdout).toMatch(/^ 0 fail$/mu);
    expect(r.stdout).toMatch(/^Ran 2 tests across 1 file, 1 at a time\./mu);
  });

  it("exits 1 when one file fails, prints its output, and still runs the others", () => {
    const r = run([at("passing.test.ts"), at("failing.test.ts")]);
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/^FAIL {2}.*failing\.test\.ts \(failed\)$/mu);
    expect(r.stdout).toMatch(/broken/u);
    expect(r.stdout).toMatch(/^ok\s+2\s.*passing\.test\.ts$/mu);
    expect(r.stdout).toMatch(/^ 2 pass$/mu);
    expect(r.stdout).toMatch(/^ 1 fail$/mu);
    expect(r.stdout).toMatch(/^1 file\(s\) failed: .*failing\.test\.ts$/mu);
  });

  it("a hook over Bun's five-second default passes under the runner's budget", () => {
    if (POSIX_ONLY) return;
    const r = run([at("slow-hook.test.ts")]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^ok\s+1\s.*slow-hook\.test\.ts$/mu);
  }, 30_000);

  it("runs every file under Bun, naming no other runtime", () => {
    const r = run([at("runtime.test.ts")]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^ok\s+1\s.*runtime\.test\.ts$/mu);
    expect(r.stdout).not.toMatch(/The CLI ran under/u);
  });

  it("a file that runs no test fails the run rather than passing it", () => {
    const r = run([at("empty.test.ts")]);
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/^FAIL {2}.*empty\.test\.ts \(ran no test\)$/mu);
  });
});
