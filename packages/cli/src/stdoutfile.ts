// docs/roadmap.md (a child's output, read from a file the child wrote) ·
// docs/architecture.md §Directories.
//
// Every git read the shell makes runs through here, and neither its request
// nor its answer travels through a pipe the runtime drains or fills. The child
// gets an open file for its stdout and writes its answer there itself; a batch
// read's request is written to a file first and handed to the child as its
// stdin. Under CPU load, Bun 1.3.11's synchronous spawn returned a child's
// piped stdout cut to a prefix with exit 0 and nothing on stderr, and a prefix
// that ends between records is a well-formed, shorter listing that no
// terminator can tell from a whole one; a request cut the same way is a
// shorter request. A file the child wrote and closed before it exited is its
// whole output, and a file the engine wrote and closed before the child began
// is its whole request: exit 0 and the answer file are the complete answer to
// the complete request under any runtime. That is all the files prove: not
// that git told the truth, nor that the repository held still between two
// reads.
//
// stderr stays a pipe, and it is read. Three answers are recognised from its
// text — a path HEAD does not hold (git.ts `gitShowHead`), a directory in no
// repository (`gitTopLevel`), and a server that refuses a filtered fetch
// (`gitOriginFetch`) — and each fails conservatively when that text is lost:
// the failure is thrown as a plumbing failure, or the origin is reported
// unreachable, never read as a smaller answer.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { closeSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** stderr's pipe buffer: messages and the three recognitions, never an answer's bytes. */
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
  /** Written to a file the child reads as its stdin; without it the child reads nothing. */
  input?: string | undefined;
  timeout?: number | undefined;
}

/** A fresh path under `os.tmpdir()` for one of this call's files. */
function scratchPath(role: "stdout" | "stdin"): string {
  return join(tmpdir(), `wikiwright-${role}-${process.pid}-${randomBytes(12).toString("hex")}`);
}

/**
 * Run `command` with its stdout on a fresh file under `os.tmpdir()`, and its
 * stdin, when there is input, on another: each created exclusively, readable
 * only by this user, and removed before the call returns or throws. Neither is
 * a vault path.
 */
export function spawnWithStdoutFile(
  command: string,
  args: readonly string[],
  options: ChildOptions,
): ChildAnswer {
  const outPath = scratchPath("stdout");
  const inPath = options.input === undefined ? undefined : scratchPath("stdin");
  const open: number[] = [];
  const created: string[] = [];
  try {
    const out = openSync(outPath, "wx", 0o600);
    open.push(out);
    created.push(outPath);
    let stdin: "ignore" | number = "ignore";
    if (inPath !== undefined) {
      // Written whole and closed before the child exists, then opened again
      // for reading from its first byte.
      const writing = openSync(inPath, "wx", 0o600);
      created.push(inPath);
      try {
        writeFileSync(writing, options.input ?? "");
      } finally {
        closeSync(writing);
      }
      stdin = openSync(inPath, "r");
      open.push(stdin);
    }
    const result = spawnSync(command, [...args], {
      cwd: options.cwd,
      env: options.env ?? process.env,
      ...(options.timeout === undefined ? {} : { timeout: options.timeout }),
      stdio: [stdin, out, "pipe"],
      maxBuffer: STDERR_MAX_BUFFER,
    });
    for (const fd of open.splice(0)) closeSync(fd);
    return {
      status: result.status,
      stdout: readFileSync(outPath),
      // A child that never spawned has no stderr at all under Node.
      stderr: (result.stderr as Buffer | null | undefined)?.toString("utf8") ?? "",
      error: result.error,
    };
  } finally {
    for (const fd of open) closeSync(fd);
    for (const path of created) unlinkSync(path);
  }
}
