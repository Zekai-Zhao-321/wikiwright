// The whole suite, one `bun test` process per file, as many at once as the
// machine has cores. `bun test` runs its files one after another in a single
// process, and most of this suite's time is spent waiting on the CLI processes
// its tests spawn, so the files run side by side instead. They are independent:
// every test writes under os.tmpdir(), and the node runner already runs the
// same files in parallel. `bun run check` and `bun run test` run the suite
// through this; `bun test ./<file>` still runs one file.
//
//   bun tools/run-suite.ts [file ...]
//
// With no file, the files are `packages/core/test/*.test.ts` and
// `packages/cli/test/*.test.ts`, the set `bun run test:node` runs. The largest
// start first, so the long files are not the last to begin. A file passes when
// its process exits 0 and reports at least one test; the run exits 1 when any
// file does not, and prints that file's whole output.
import { spawn } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { availableParallelism } from "node:os";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TEST_DIRS = ["packages/core/test", "packages/cli/test"];

interface Outcome {
  file: string;
  ok: boolean;
  output: string;
  ms: number;
  pass: number;
  fail: number;
  tests: number;
}

function suiteFiles(): string[] {
  const files: string[] = [];
  for (const dir of TEST_DIRS) {
    for (const name of readdirSync(join(ROOT, dir))) {
      if (name.endsWith(".test.ts")) files.push(`${dir}/${name}`);
    }
  }
  return files;
}

function bytesOf(file: string): number {
  return statSync(isAbsolute(file) ? file : join(ROOT, file)).size;
}

/** The count before a word on its own summary line, as `bun test` prints it: ` 12 pass`. */
function countOf(output: string, word: string): number {
  const m = new RegExp(`^\\s*(\\d+) ${word}$`, "mu").exec(output);
  return m === null ? 0 : Number(m[1]);
}

function testsOf(output: string): number {
  const m = /^Ran (\d+) tests? across/mu.exec(output);
  return m === null ? 0 : Number(m[1]);
}

// Bun gives a test or a hook five seconds by default. Run side by side, the
// files contend for the machine, and a file's time under this runner was
// measured at about 2.4 times its time alone; a `before` hook that packs three
// tarballs and runs `bun install` fits in five seconds alone and not under
// load. The runner widens the budget to four times the default, above that
// factor with room; `bun test ./<file>` run alone keeps five seconds, so a
// case written against the documented budget holds under both.
const TIMEOUT_MS = 20_000;

// Under Bun the runner's own binary runs each file; under anything else, the
// `bun` on PATH does, so the runner's test can drive it from the node runner.
const BUN = process.versions["bun"] === undefined ? "bun" : process.execPath;

function runFile(file: string): Promise<Outcome> {
  return new Promise((resolve) => {
    const start = performance.now();
    // `./` (or an absolute path) makes the argument a file; a bare path is a
    // substring filter to `bun test`, and would also run every file it prefixes.
    const target = isAbsolute(file) ? file : `./${file}`;
    const child = spawn(BUN, ["test", "--timeout", String(TIMEOUT_MS), target], {
      cwd: ROOT,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk));
    const finish = (code: number | null, extra = ""): void => {
      const output = Buffer.concat(chunks).toString("utf8") + extra;
      const tests = testsOf(output);
      resolve({
        file,
        ok: code === 0 && tests > 0,
        output,
        ms: performance.now() - start,
        pass: countOf(output, "pass"),
        fail: countOf(output, "fail"),
        tests,
      });
    };
    child.on("error", (error) => finish(null, `\n${error.message}\n`));
    child.on("close", (code) => finish(code));
  });
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(2)}s`;
}

async function main(): Promise<number> {
  const started = performance.now();
  const given = process.argv.slice(2);
  const files = (given.length > 0 ? given : suiteFiles()).sort(
    (a, b) => bytesOf(b) - bytesOf(a) || (a < b ? -1 : a > b ? 1 : 0),
  );
  const queue = [...files];
  const outcomes: Outcome[] = [];
  const worker = async (): Promise<void> => {
    for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
      const outcome = await runFile(file);
      outcomes.push(outcome);
      if (outcome.ok) {
        process.stdout.write(
          `ok    ${String(outcome.tests).padStart(4)}  ${seconds(outcome.ms)}  ${file}\n`,
        );
      } else {
        const why = outcome.tests === 0 && outcome.fail === 0 ? "ran no test" : "failed";
        process.stdout.write(`\nFAIL  ${file} (${why})\n${outcome.output}\n`);
      }
    }
  };
  const jobs = Math.max(1, Math.min(availableParallelism(), files.length));
  await Promise.all(Array.from({ length: jobs }, worker));
  const failed = outcomes.filter((o) => !o.ok);
  const pass = outcomes.reduce((n, o) => n + o.pass, 0);
  const fail = outcomes.reduce((n, o) => n + o.fail, 0);
  const tests = outcomes.reduce((n, o) => n + o.tests, 0);
  const across = `${files.length} file${files.length === 1 ? "" : "s"}`;
  process.stdout.write(
    `\n ${pass} pass\n ${fail} fail\nRan ${tests} test${tests === 1 ? "" : "s"} across ${across}, ${jobs} at a time. [${seconds(performance.now() - started)}]\n`,
  );
  if (failed.length > 0) {
    process.stdout.write(
      `${failed.length} file(s) failed: ${failed.map((o) => o.file).join(", ")}\n`,
    );
    return 1;
  }
  return 0;
}

process.exitCode = await main();
