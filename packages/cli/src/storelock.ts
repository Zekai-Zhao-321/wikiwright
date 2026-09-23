// docs/extending.md §Trust (a store is read, changed and written as one
// operation under a lock beside it; a lock is broken only when the process it
// names is gone from this machine) · docs/architecture.md §Directories.
//
// The lock every machine-local store is updated under. A store is a JSON file
// outside every vault that more than one process may write at once; what the
// store holds is its own module's business, and how two writers are kept from
// losing each other's change is this one's.
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { hostname } from "node:os";
import { dirname } from "node:path";

/** The lock is a write held for a moment; these bound the wait for it. */
const LOCK_WAIT_MS = 15_000;
const LOCK_POLL_MS = 20;
/**
 * How long a lock with no readable holder is given before it is treated as
 * abandoned. It covers only the instant between creating the lock file and
 * writing who holds it; age is not evidence about a holder that named itself.
 */
const LOCK_UNCLAIMED_MS = 2_000;

/** Another process holds the store; the caller is told so by name, never overwritten. */
export class StoreBusy extends Error {}

/** A sleep with no runtime-specific API and no busy loop. */
function pause(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Who holds a lock: this machine's name for itself, and the process on it. */
interface LockHolder {
  pid: number;
  host: string;
}

function holderOf(lock: string): LockHolder | undefined {
  let text: string;
  try {
    text = readFileSync(lock, "utf8").trim();
  } catch {
    return undefined;
  }
  try {
    const parsed = JSON.parse(text) as { pid?: unknown; host?: unknown };
    if (typeof parsed.pid === "number" && typeof parsed.host === "string") {
      return { pid: parsed.pid, host: parsed.host };
    }
  } catch {
    // A 0.1.0 lock is the pid alone, and named no host.
  }
  const pid = Number.parseInt(text, 10);
  return Number.isSafeInteger(pid) && pid > 0 ? { pid, host: hostname() } : undefined;
}

/**
 * Whether the process named by a lock is still running here. Signal 0 asks
 * without sending anything: it succeeds while the process exists, and EPERM
 * means it exists and belongs to someone else. A holder on another machine —
 * a store on a shared home directory — cannot be asked, and is treated as
 * alive: a pid means nothing there, and guessing would take a live lock.
 */
function holderIsRunning(holder: LockHolder): boolean {
  if (holder.host !== hostname()) return true;
  try {
    process.kill(holder.pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Hold the store against other processes. The lock is a file created
 * exclusively beside it: whoever creates it owns the store until it is removed.
 *
 * A lock is broken only when the process that wrote it is gone from this
 * machine. Age is not evidence: a grant digests a package, scans it and runs
 * its determinism fixture, and a slow disk, a large module or a stopped
 * process can hold the lock past any interval worth waiting. Breaking a live
 * holder's lock is how two writers both write, and how a grant a maintainer
 * revoked comes back. A lock nobody has claimed yet — the instant between
 * creating the file and naming its holder — is given `LOCK_UNCLAIMED_MS` and
 * then treated as abandoned, since nothing else can ever say who holds it.
 */
function acquire(file: string, waitMs = LOCK_WAIT_MS): string {
  const lock = `${file}.lock`;
  mkdirSync(dirname(lock), { recursive: true });
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      const fd = openSync(lock, "wx");
      try {
        writeFileSync(fd, `${JSON.stringify({ pid: process.pid, host: hostname() })}\n`);
      } finally {
        closeSync(fd);
      }
      return lock;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const holder = holderOf(lock);
    try {
      const unclaimed =
        holder === undefined && Date.now() - statSync(lock).mtimeMs > LOCK_UNCLAIMED_MS;
      if (unclaimed || (holder !== undefined && !holderIsRunning(holder))) {
        rmSync(lock, { force: true });
        continue;
      }
    } catch {
      // The holder released it between the two calls; the next attempt takes it.
    }
    if (Date.now() >= deadline) {
      throw new StoreBusy(
        holder === undefined
          ? `another process is updating ${file}; its lock at ${lock} did not clear`
          : `process ${String(holder.pid)} on ${holder.host} is updating ${file}; its lock at ${lock} did not clear`,
      );
    }
    pause(LOCK_POLL_MS);
  }
}

/** What a change to a store returns: the store to write, or none, and the caller's answer. */
export interface StoreChange<S, T> {
  /** The store to write, or absent to leave the file untouched. */
  store?: S;
  result: T;
}

/** How one store is read and written; the lock knows nothing of its shape. */
export interface StoreIo<S> {
  read: () => S;
  write: (store: S) => void;
}

/**
 * Read, change and write the store at `file` as ONE operation. The store is
 * read AFTER the lock is held, so a change never lands on a snapshot another
 * process has already moved past: two writers at the same moment each keep the
 * other's record. A change that returns no store writes nothing, and the lock
 * is released whatever happens.
 */
export function updateStore<S, T>(
  file: string,
  io: StoreIo<S>,
  change: (store: S) => StoreChange<S, T>,
  options: { waitMs?: number } = {},
): T {
  const lock = acquire(file, options.waitMs);
  try {
    const outcome = change(io.read());
    if (outcome.store !== undefined) io.write(outcome.store);
    return outcome.result;
  } finally {
    rmSync(lock, { force: true });
  }
}
