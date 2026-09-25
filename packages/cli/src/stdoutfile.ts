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
// The child is spawned asynchronously (`Bun.spawn`) and awaited to its exit
// and to the end of its stderr pipe; the answer file is read only then. At
// most CHILD_POOL children run at once, so a verb that asks for many reads
// together does not fork them all at once. A timeout, when the caller passes
// one (git.ts passes one on every git read), bounds the child itself: a child
// still running when it fires is killed (SIGKILL) and the call is an error
// with code `ETIMEDOUT`; a child that has exited is never called timed out.
// Every descriptor this call opens is closed, and every file it creates
// removed, before it returns or throws.
//
// stderr stays a pipe, and it is read to its end, up to STDERR_MAX_BYTES; a
// child that writes more is killed and the call is an error. A child that has
// exited can leave its stderr held open by a process it started (a daemon
// git spawns, a background job of a script): its stderr is then read for
// STDERR_GRACE_MS more and abandoned, so the call ends with the child, and
// what was read by then is its stderr. Two answers are
// recognised from its text — a path HEAD does not hold (git.ts `gitShowHead`)
// and a directory in no repository (`gitTopLevel`) — and each fails
// conservatively when that text is lost: the failure is thrown as a plumbing
// failure, never read as a smaller answer.
import { randomBytes } from "node:crypto";
import { closeSync, openSync, unlinkSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** stderr's bound: messages and the recognitions, never an answer's bytes. */
const STDERR_MAX_BYTES = 8 * 1024 * 1024;

/**
 * How long stderr is still read after the child has exited: what the child
 * wrote before it exited is already in the pipe, and a process the child
 * started may hold the pipe open for as long as it lives.
 */
const STDERR_GRACE_MS = 1_000;

/** How many children this process runs at once; a call beyond it waits its turn. */
export const CHILD_POOL = 4;

export interface ChildAnswer {
  /** The exit status, or null when the child did not exit on its own. */
  status: number | null;
  /** The signal that ended the child, or null when it exited. */
  signal: NodeJS.Signals | null;
  /** Everything the child wrote to stdout, read from its file after it exited. */
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
  /** Milliseconds the child may run before it is killed; without it the child runs to its end. */
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
 * One child through `Bun.spawn`, awaited to its exit and, unless it was
 * killed, to the end of its stderr. Under load, a child spawned through the
 * `node:child_process` layer of Bun 1.3.11 could exit and be reaped with no
 * `exit` and no end of stderr ever delivered, and the call waited forever
 * (seen in about one test process in a hundred that spawned two children at
 * once); the same calls through `Bun.spawn` lost none.
 */
async function run(
  command: string,
  args: readonly string[],
  options: ChildOptions,
  stdin: "ignore" | number,
  out: number,
): Promise<Omit<ChildAnswer, "stdout">> {
  let child: ReturnType<typeof spawnPiped>;
  try {
    child = spawnPiped(command, args, options, stdin, out);
  } catch (e) {
    // A command that cannot be spawned throws here, before any child exists.
    return {
      status: null,
      signal: null,
      stderr: "",
      error: e instanceof Error ? e : new Error(String(e)),
    };
  }
  let error: Error | undefined;
  let killed = false;
  /** Set when stderr is given up on, by a kill or after the grace: its end is not awaited. */
  let abandoned = false;
  const kill = (): void => {
    killed = true;
    child.kill("SIGKILL");
  };
  const timer =
    options.timeout === undefined
      ? undefined
      : setTimeout(() => {
          // A child that has exited is not timed out, whatever holds its stderr.
          if (child.exitCode !== null || child.signalCode !== null) return;
          error ??= codedError(
            `${command} did not finish within ${String(options.timeout)} ms`,
            "ETIMEDOUT",
          );
          kill();
        }, options.timeout);
  const reader = child.stderr.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  const drained = (async (): Promise<void> => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        bytes += value.byteLength;
        if (bytes <= STDERR_MAX_BYTES) {
          chunks.push(value);
        } else if (error === undefined) {
          error = codedError(`stderr exceeded ${STDERR_MAX_BYTES} bytes`, "ENOBUFS");
          kill();
        }
      }
    } catch (e) {
      // stderr that could not be read to its end is not a whole answer.
      if (!killed && !abandoned) error ??= e instanceof Error ? e : new Error(String(e));
    }
  })();
  let code: number | null;
  try {
    code = await child.exited.catch((e: unknown) => {
      error ??= e instanceof Error ? e : new Error(String(e));
      return null;
    });
  } finally {
    // The timeout bounds the child, not what it left behind.
    if (timer !== undefined) clearTimeout(timer);
  }
  // A child's stderr may still be held open by a process it started, which
  // would hold the call for as long as that process lives: a killed child's
  // is abandoned at once, an exited child's after the grace.
  if (!killed) {
    let grace: ReturnType<typeof setTimeout> | undefined;
    const held = await Promise.race([
      drained.then(() => false),
      new Promise<boolean>((resolve) => {
        grace = setTimeout(() => resolve(true), STDERR_GRACE_MS);
      }),
    ]);
    if (grace !== undefined) clearTimeout(grace);
    if (held) abandoned = true;
  }
  if (killed || abandoned) {
    abandoned = true;
    await reader.cancel().catch(() => undefined);
  }
  const signal = (child.signalCode ?? null) as NodeJS.Signals | null;
  return {
    status: signal === null ? code : null,
    signal,
    stderr: Buffer.concat(chunks).toString("utf8"),
    error,
  };
}

function spawnPiped(
  command: string,
  args: readonly string[],
  options: ChildOptions,
  stdin: "ignore" | number,
  out: number,
) {
  return Bun.spawn({
    cmd: [command, ...args],
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdin,
    stdout: out,
    stderr: "pipe",
  });
}

/**
 * Run `command` with its stdout on a fresh file under `os.tmpdir()`, and its
 * stdin, when there is input, on another: each created exclusively, readable
 * only by this user, and removed before the call settles. Neither is a vault
 * path. The call waits for a slot in the pool, then for the child's exit.
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
    const ended = await run(command, args, options, stdin, out);
    // The child has exited: the file holds everything it wrote.
    const stdout = await readFile(outPath);
    return { ...ended, stdout };
  } finally {
    for (const fd of open) closeSync(fd);
    for (const path of created) unlinkSync(path);
    release();
  }
}
