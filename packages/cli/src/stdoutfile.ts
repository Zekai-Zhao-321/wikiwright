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
// The child is spawned asynchronously and awaited to its `close`, which comes
// after it has exited and its stderr pipe has been read to the end; the
// answer file is read only then. At most CHILD_POOL children run at once, so a
// verb that asks for many reads together does not fork them all at once. A
// timeout kills the child (SIGKILL) and is reported as an error with code
// `ETIMEDOUT`. Every descriptor this call opens is closed, and every file it
// creates removed, before it returns or throws.
//
// stderr stays a pipe, and it is read to its end, up to STDERR_MAX_BYTES; a
// child that writes more is killed and the call is an error. Two answers are
// recognised from its text — a path HEAD does not hold (git.ts `gitShowHead`)
// and a directory in no repository (`gitTopLevel`) — and each fails
// conservatively when that text is lost: the failure is thrown as a plumbing
// failure, never read as a smaller answer.
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { closeSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** stderr's bound: messages and the recognitions, never an answer's bytes. */
const STDERR_MAX_BYTES = 8 * 1024 * 1024;

/** How many children this process runs at once; a call beyond it waits its turn. */
export const CHILD_POOL = 4;

export interface ChildAnswer {
  /** The exit status, or null when the child did not exit on its own. */
  status: number | null;
  /** The signal that ended the child, or null when it exited. */
  signal: NodeJS.Signals | null;
  /** Everything the child wrote to stdout, read from its file after it closed. */
  stdout: Buffer;
  stderr: string;
  /** Set when the child could not be spawned, was stopped by the timeout, or overran stderr's bound. */
  error: Error | undefined;
}

export interface ChildOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv | undefined;
  /** Written to a file the child reads as its stdin; without it the child reads nothing. */
  input?: string | undefined;
  /** Milliseconds before the child is killed; without it the child runs to its end. */
  timeout?: number | undefined;
}

/** The pool: how many children run now, and the calls waiting for a slot, first come first served. */
let running = 0;
const waiting: Array<() => void> = [];

async function acquire(): Promise<void> {
  if (running < CHILD_POOL) {
    running += 1;
    return;
  }
  // The slot is handed over by `release`, so `running` never drops below the
  // number of children that hold one.
  await new Promise<void>((resolve) => waiting.push(resolve));
}

function release(): void {
  const next = waiting.shift();
  if (next === undefined) running -= 1;
  else next();
}

/** A fresh path under `os.tmpdir()` for one of this call's files. */
function scratchPath(role: "stdout" | "stdin"): string {
  return join(tmpdir(), `wikiwright-${role}-${process.pid}-${randomBytes(12).toString("hex")}`);
}

function codedError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

/**
 * Run `command` with its stdout on a fresh file under `os.tmpdir()`, and its
 * stdin, when there is input, on another: each created exclusively, readable
 * only by this user, and removed before the call settles. Neither is a vault
 * path. The call waits for a slot in the pool, then for the child's `close`.
 */
export async function spawnWithStdoutFile(
  command: string,
  args: readonly string[],
  options: ChildOptions,
): Promise<ChildAnswer> {
  await acquire();
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
    const ended = await new Promise<Omit<ChildAnswer, "stdout">>((resolve) => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      let error: Error | undefined;
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const settle = (status: number | null, signal: NodeJS.Signals | null): void => {
        if (settled) return;
        settled = true;
        if (timer !== undefined) clearTimeout(timer);
        resolve({ status, signal, stderr: Buffer.concat(chunks).toString("utf8"), error });
      };
      const child = spawn(command, [...args], {
        cwd: options.cwd,
        env: options.env ?? process.env,
        stdio: [stdin, out, "pipe"],
      });
      child.on("error", (e) => {
        error ??= e;
        // A child that never spawned has no `close` to wait for.
        if (child.pid === undefined) settle(null, null);
      });
      // `close` comes after the exit and after stderr has been read to its end.
      child.on("close", (code, signal) => settle(code, signal));
      let killed = false;
      // A killed child's stderr may still be held open by a process it
      // started, which would hold `close` back for as long as that process
      // lives: once the killed child itself has exited, its stderr is
      // abandoned and the call settles.
      child.on("exit", (code, signal) => {
        if (!killed) return;
        child.stderr?.destroy();
        settle(code, signal);
      });
      const kill = (): void => {
        killed = true;
        child.kill("SIGKILL");
      };
      child.stderr?.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes <= STDERR_MAX_BYTES) {
          chunks.push(chunk);
          return;
        }
        if (error === undefined) {
          error = codedError(`stderr exceeded ${STDERR_MAX_BYTES} bytes`, "ENOBUFS");
          kill();
        }
      });
      if (options.timeout !== undefined) {
        timer = setTimeout(() => {
          error ??= codedError(
            `${command} did not finish within ${String(options.timeout)} ms`,
            "ETIMEDOUT",
          );
          kill();
        }, options.timeout);
      }
    });
    // The child has closed: the file holds everything it wrote.
    const stdout = await readFile(outPath);
    return { ...ended, stdout };
  } finally {
    for (const fd of open) closeSync(fd);
    for (const path of created) unlinkSync(path);
    release();
  }
}

/**
 * The synchronous form the git reads used before the asynchronous transport:
 * kept only until every caller awaits `spawnWithStdoutFile`, and removed then.
 */
export function spawnWithStdoutFileSync(
  command: string,
  args: readonly string[],
  options: ChildOptions,
): Omit<ChildAnswer, "signal"> {
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
      maxBuffer: STDERR_MAX_BYTES,
    });
    for (const fd of open.splice(0)) closeSync(fd);
    return {
      status: result.status,
      stdout: readFileSync(outPath),
      stderr: (result.stderr as Buffer | null | undefined)?.toString("utf8") ?? "",
      error: result.error,
    };
  } finally {
    for (const fd of open) closeSync(fd);
    for (const path of created) unlinkSync(path);
  }
}
