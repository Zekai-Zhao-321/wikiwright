// docs/roadmap.md (a child's output, read from a file the child wrote) ·
// docs/architecture.md §Directories.
//
// Every git read the shell makes runs through here. The child gets an open
// file for its stdout and writes its answer there itself; the runtime reads no
// pipe. Under CPU load, Bun 1.3.11's synchronous spawn returned a child's piped
// stdout cut to a prefix with exit 0 and nothing on stderr, and a prefix that
// ends between records is a well-formed, shorter listing that no terminator can
// tell from a whole one. A file the child wrote and closed before it exited is
// its whole output: exit 0 and the file is the complete answer under any
// runtime. stderr stays a pipe — it feeds messages, never a verdict — and a
// batch read's stdin stays a pipe the runtime writes, which the batch reads
// hold to their counts.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { closeSync, openSync, readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** stderr's pipe buffer: a message, never an answer. */
const STDERR_MAX_BUFFER = 8 * 1024 * 1024;

export interface ChildAnswer {
  /** The exit status, or null when the child did not exit on its own. */
  status: number | null;
  /** Everything the child wrote to stdout, read from its file after it exited. */
  stdout: Buffer;
  stderr: string;
  /** Set when the child could not be spawned, or was stopped by the timeout. */
  error: Error | undefined;
}

export interface ChildOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv | undefined;
  /** Written to the child's stdin through a pipe; without it stdin is closed. */
  input?: string | undefined;
  timeout?: number | undefined;
}

/**
 * Run `command` with its stdout on a fresh file under `os.tmpdir()`, created
 * exclusively, readable only by this user, and removed once read. The file is
 * never a vault path and never outlives the call.
 */
export function spawnWithStdoutFile(
  command: string,
  args: readonly string[],
  options: ChildOptions,
): ChildAnswer {
  const path = join(
    tmpdir(),
    `wikiwright-stdout-${process.pid}-${randomBytes(12).toString("hex")}`,
  );
  const fd = openSync(path, "wx", 0o600);
  let open = true;
  try {
    const result = spawnSync(command, [...args], {
      cwd: options.cwd,
      env: options.env ?? process.env,
      ...(options.input === undefined ? {} : { input: options.input }),
      ...(options.timeout === undefined ? {} : { timeout: options.timeout }),
      stdio: [options.input === undefined ? "ignore" : "pipe", fd, "pipe"],
      maxBuffer: STDERR_MAX_BUFFER,
    });
    closeSync(fd);
    open = false;
    return {
      status: result.status,
      stdout: readFileSync(path),
      // A child that never spawned has no stderr at all under Node.
      stderr: (result.stderr as Buffer | null | undefined)?.toString("utf8") ?? "",
      error: result.error,
    };
  } finally {
    if (open) closeSync(fd);
    unlinkSync(path);
  }
}
