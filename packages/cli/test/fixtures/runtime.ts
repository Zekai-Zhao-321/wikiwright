import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { closeSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// How a test runs the engine's CLI: under Bun, the one runtime the engine
// ships for, with the CLI's stdout on a file the test created and its stdin,
// when there is input, on another. Under load, Bun 1.3.11's synchronous spawn
// has handed back a child's piped stdout cut short with exit 0 (docs/roadmap.md);
// the CLI writes its envelope to its own file and closes it before it exits,
// so the file is the whole envelope. stderr stays a pipe: a test reads it for
// messages, never for an envelope. The files are created under os.tmpdir()
// and removed before the call returns.

/** The runtime a test runs the CLI under: the Bun running the test. */
export const BUN = process.execPath;

export interface CliOptions {
  cwd?: string | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  input?: string | Buffer | undefined;
  encoding?: BufferEncoding | undefined;
}

function scratch(role: string): string {
  return join(tmpdir(), `ww-test-${role}-${process.pid}-${randomBytes(8).toString("hex")}`);
}

/** Run `bun <args>` as `spawnSync` would, the child's stdout read from the file it wrote. */
export function runCli(
  args: readonly string[],
  options: CliOptions & { encoding: BufferEncoding },
): SpawnSyncReturns<string>;
export function runCli(args: readonly string[], options?: CliOptions): SpawnSyncReturns<Buffer>;
export function runCli(
  args: readonly string[],
  options: CliOptions = {},
): SpawnSyncReturns<string> | SpawnSyncReturns<Buffer> {
  return runCommand(BUN, args, options);
}

/** Run any executable the same way: a compiled binary, a launcher. */
export function runCommand(
  command: string,
  args: readonly string[],
  options: CliOptions & { encoding: BufferEncoding },
): SpawnSyncReturns<string>;
export function runCommand(
  command: string,
  args: readonly string[],
  options?: CliOptions,
): SpawnSyncReturns<Buffer>;
export function runCommand(
  command: string,
  args: readonly string[],
  options: CliOptions = {},
): SpawnSyncReturns<string> | SpawnSyncReturns<Buffer> {
  const outPath = scratch("stdout");
  const inPath = options.input === undefined ? undefined : scratch("stdin");
  const out = openSync(outPath, "wx", 0o600);
  let stdin: number | "ignore" = "ignore";
  try {
    if (inPath !== undefined) {
      writeFileSync(inPath, options.input ?? "", { mode: 0o600 });
      stdin = openSync(inPath, "r");
    }
    const r = spawnSync(command, [...args], {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: [stdin, out, "pipe"],
    });
    const bytes = readFileSync(outPath);
    const stdout = options.encoding === undefined ? bytes : bytes.toString(options.encoding);
    const stderr =
      options.encoding === undefined ? r.stderr : (r.stderr?.toString(options.encoding) ?? "");
    return { ...r, stdout, stderr, output: [null, stdout, stderr] } as
      | SpawnSyncReturns<string>
      | SpawnSyncReturns<Buffer>;
  } finally {
    closeSync(out);
    if (typeof stdin === "number") closeSync(stdin);
    unlinkSync(outPath);
    if (inPath !== undefined) unlinkSync(inPath);
  }
}

// No test probes a real machine's system skill directory: whatever the
// caller's environment names, the CLI a test spawns reads a directory under
// os.tmpdir() that nothing creates. Every spawn inherits it through
// process.env; a case that means another passes it in its own spawn.
process.env["WIKIWRIGHT_SYSTEM_SKILL_DIR"] = join(tmpdir(), "ww-no-system-skills");
