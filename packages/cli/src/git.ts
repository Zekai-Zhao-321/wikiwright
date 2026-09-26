// docs/architecture.md (spawned git plumbing; no git library) · docs/cli.md §lint (--staged
// reads index content, never the working tree).
import {
  BatchStreamTruncated,
  parseCatFileBatch,
  parseCatFileBatchCheck,
  parseNameStatusZ,
  type StagedChange,
} from "@wikiwright/core";
import { type ChildAnswer, type ChildOptions, spawnWithStdoutFile } from "./stdoutfile.ts";

/**
 * A git answer the engine refuses to judge from. Every catch that turns a
 * plumbing failure into `git-unavailable` or `revision-not-found` rethrows
 * one of these as itself, so it reaches the runtime's own refusal
 * (docs/cli.md §Exit codes).
 */
export abstract class GitAnswerRefused extends Error {}

/**
 * docs/cli.md §Exit codes: a git answer that ended before git finished
 * writing it. Every answer is read from a file git wrote itself, and every
 * batch request handed over as a file the engine wrote (`stdoutfile.ts`), so no
 * runtime pipe can cut either; the terminator and count checks stay as a
 * second line. A read whose output has a terminator is held
 * to it, and one that ends without it is this, refused by name as
 * `git-short-read`. `command` is the git command, for the refusal.
 */
export class GitShortRead extends GitAnswerRefused {
  readonly command: string;
  constructor(command: string, detail: string) {
    super(`git ${command} answered short: ${detail}`);
    this.command = command;
  }
}

/**
 * docs/cli.md §Exit codes: two git answers that cannot both be whole — the
 * staged diff names a page the index listing does not hold, or a commit walk
 * lists fewer commits than git counts in its range. A listing cut at a record
 * boundary is well formed, so these cross-checks are what can catch one; it is
 * refused as `git-inconsistent-read`, never judged as a smaller state.
 */
export class GitInconsistentRead extends GitAnswerRefused {
  readonly commands: string[];
  constructor(commands: readonly string[], detail: string) {
    super(`git ${commands.join(" and git ")} disagree: ${detail}`);
    this.commands = [...commands];
  }
}

/**
 * docs/cli.md §Exit codes: a git child that did not finish within the
 * timeout every git read carries (`gitTimeoutMs`), killed rather than waited
 * for, refused by name as `git-timeout`. A hung git held one of the pool's
 * slots, and the verb waited on it, for as long as it hung.
 */
export class GitTimedOut extends GitAnswerRefused {
  readonly command: string;
  readonly timeoutMs: number;
  constructor(command: string, timeoutMs: number) {
    super(`git ${command} did not finish within ${String(timeoutMs)} ms and was killed`);
    this.command = command;
    this.timeoutMs = timeoutMs;
  }
}

/** How long one git child may run when `WIKIWRIGHT_GIT_TIMEOUT_MS` names no other bound. */
export const GIT_TIMEOUT_DEFAULT_MS = 60_000;

/**
 * docs/cli.md §Environment: the bound on one git child, in milliseconds —
 * `WIKIWRIGHT_GIT_TIMEOUT_MS` when it is set and not empty, else
 * GIT_TIMEOUT_DEFAULT_MS — or `{invalid}` for a value that is not a whole
 * number of milliseconds from 1 to 2^31 - 1 (the most a timer holds), which
 * `main.ts` refuses as `git-timeout-invalid` before any verb runs.
 */
export function gitTimeoutSetting(): number | { invalid: string } {
  const value = process.env["WIKIWRIGHT_GIT_TIMEOUT_MS"];
  if (value === undefined || value === "") return GIT_TIMEOUT_DEFAULT_MS;
  const ms = /^[1-9][0-9]{0,9}$/u.test(value) ? Number(value) : Number.NaN;
  return ms <= 2_147_483_647 ? ms : { invalid: value };
}

function gitTimeoutMs(): number {
  const setting = gitTimeoutSetting();
  return typeof setting === "number" ? setting : GIT_TIMEOUT_DEFAULT_MS;
}

/**
 * `out` as git's whole answer to `args`: empty, or ending in its terminator — a
 * NUL for a `-z` listing, a newline for a line protocol. `nonEmpty` is for the
 * reads that always answer something, where no output at all is a cut too.
 */
export function terminated(
  args: readonly string[],
  out: string,
  terminator: "\0" | "\n",
  nonEmpty = false,
): string {
  const named = terminator === "\0" ? "NUL" : "a newline";
  if (out === "") {
    if (nonEmpty) throw new GitShortRead(args.join(" "), "it printed nothing");
    return out;
  }
  if (!out.endsWith(terminator)) {
    throw new GitShortRead(args.join(" "), `its output does not end in ${named}`);
  }
  return out;
}

/**
 * One git child: its stdout read from the file it wrote, its stdin, when it has
 * one, a file the engine wrote (`stdoutfile.ts`). It runs for at most the
 * caller's `timeout`, else `gitTimeoutMs()`; a child killed for overrunning it
 * is answered with `error` a GitTimedOut, which every reader throws, and every
 * catch that turns a git failure into a quieter answer rethrows as itself.
 * stderr is a pipe, captured,
 * never inherited: it rides on a thrown error's message instead of printing
 * `fatal:` beside a green envelope (docs/cli.md §The envelope), and two
 * answers are recognised from its text — `gitShowHead`'s absent path and
 * `gitTopLevel`'s "not a git repository" — each of which, with the text lost,
 * fails as a plumbing failure rather than a smaller answer.
 */
export async function gitRun(
  cwd: string,
  args: readonly string[],
  options: Omit<ChildOptions, "cwd"> = {},
): Promise<ChildAnswer> {
  // `LC_ALL=C`: git's messages, which two answers are recognised from, in
  // one language whatever the caller's locale. `GIT_OPTIONAL_LOCKS=0`: a
  // read never takes the index lock to refresh it, so it never moves the
  // index under a dry run or races a concurrent read.
  const env = { ...(options.env ?? process.env), LC_ALL: "C", GIT_OPTIONAL_LOCKS: "0" };
  const timeout = options.timeout ?? gitTimeoutMs();
  const answer = await spawnWithStdoutFile("git", args, { ...options, cwd, env, timeout });
  if ((answer.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT") {
    return { ...answer, error: new GitTimedOut(args.join(" "), timeout) };
  }
  return answer;
}

/**
 * Reads asked for together, answered as if they had run one after another:
 * each runs to its end, and the first failure in argument order is the one
 * thrown. `Promise.all` throws whichever failure settles first, so two git
 * children failing at once put either message in the envelope depending on
 * scheduling, and the same input answered with different bytes.
 */
export async function inArgumentOrder<T extends readonly unknown[] | []>(
  reads: T,
): Promise<{ -readonly [K in keyof T]: Awaited<T[K]> }> {
  const settled = await Promise.allSettled(reads);
  const values: unknown[] = [];
  for (const read of settled) {
    if (read.status === "rejected") throw read.reason;
    values.push(read.value);
  }
  return values as { -readonly [K in keyof T]: Awaited<T[K]> };
}

/** git's whole answer as text; a spawn failure or a non-zero exit is thrown with stderr. */
export async function gitText(root: string, args: readonly string[]): Promise<string> {
  const result = await gitRun(root, args);
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} exited ${String(result.status)}: ${result.stderr.trim()}`,
    );
  }
  return result.stdout.toString("utf8");
}

async function git(root: string, args: string[]): Promise<string> {
  return gitText(root, args);
}

export async function gitStagedChanges(root: string): Promise<StagedChange[]> {
  // --relative keeps paths vault-root-relative, so a vault living in a
  // subdirectory of a code repo (the code-bundle layout) works unchanged.
  const args = ["diff", "--cached", "--name-status", "-z", "-M", "--relative"];
  return parseNameStatusZ(terminated(args, await git(root, args), "\0"));
}

/** The staged (index) content of a path (vault-root-relative via ./ pathspec). */
export async function gitShowStaged(root: string, path: string): Promise<string> {
  return git(root, ["show", `:./${path}`]);
}

/**
 * The last committed content of a path, or undefined when it did not exist.
 * Kept for the one path `cat-file`'s line protocol cannot name: a rename's
 * source whose name holds a newline. Every other base comes through
 * `gitHeadBlobs` and the batch read.
 */
export async function gitShowHead(root: string, path: string): Promise<string | undefined> {
  try {
    return await git(root, ["show", `HEAD:./${path}`]);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // Only a genuinely-absent path means "no base"; any other failure must
    // surface rather than silently disarming diff-aware checkers.
    if (
      message.includes("does not exist") ||
      message.includes("exists on disk, but not in") ||
      message.includes("bad revision")
    ) {
      return undefined;
    }
    throw e;
  }
}

/** One index entry: the path (vault-root-relative) and the blob it names. */
export interface IndexEntry {
  path: string;
  blob: string;
  /** 0 for a resolved entry; 1 to 3 are the stages of an unmerged path. */
  stage: number;
  /** The entry's mode as git prints it: `120000` is a symbolic link. */
  mode: string;
}

/** The index's entries, for staged-state identity and the one read of its pages. */
export async function gitIndexEntries(root: string): Promise<IndexEntry[]> {
  const entries: IndexEntry[] = [];
  // `<mode> <blob> <stage>\t<path>`, NUL-terminated, paths relative to the root.
  const args = ["ls-files", "-s", "-z"];
  for (const record of terminated(args, await git(root, args), "\0").split("\0")) {
    const tab = record.indexOf("\t");
    if (tab < 0) continue;
    const [mode, blob, stage] = record.slice(0, tab).split(" ");
    if (mode === undefined || blob === undefined || stage === undefined) continue;
    entries.push({ path: record.slice(tab + 1), blob, stage: Number(stage), mode });
  }
  return entries;
}

/** The current head commit. */
export async function gitHead(root: string): Promise<string> {
  const args = ["rev-parse", "HEAD"];
  return terminated(args, await git(root, args), "\n", true).trim();
}

/**
 * The root of the work tree enclosing `dir`, or `undefined` when no repository
 * does (docs/constitution.md §Shapes: origin "." is the repository the vault
 * lives in, whether the vault is its root or a directory inside it). Only
 * "not a git repository" is an answer of "none"; any other failure is the
 * plumbing breaking and is thrown as itself.
 */
export async function gitTopLevel(dir: string): Promise<string | undefined> {
  const result = await gitRun(dir, ["rev-parse", "--show-toplevel"]);
  if (result.error !== undefined) throw result.error;
  if (result.status === 0) {
    const out = result.stdout.toString("utf8");
    return terminated(["rev-parse", "--show-toplevel"], out, "\n", true).trim();
  }
  if (/not a git repository/iu.test(result.stderr)) return undefined;
  throw new Error(
    `git rev-parse --show-toplevel failed (exit ${String(result.status)}): ${result.stderr.trim()}`,
  );
}

/**
 * Whether the repository has a commit yet (docs/constitution.md §Shapes). `rev-parse
 * --verify --quiet HEAD` separates the two cases that used to arrive as one
 * failure: exit 1 with no output is an unborn HEAD — a repository with nothing
 * to be fresh against, which is a coverage row — and anything else (no
 * repository, git missing, plumbing broken) is a real failure and is thrown, so
 * it keeps its warning instead of being silently read as "no commits yet".
 */
export async function gitHasHead(root: string): Promise<boolean> {
  const result = await gitRun(root, ["rev-parse", "--verify", "--quiet", "HEAD"]);
  if (result.error !== undefined) throw result.error;
  const out = result.stdout.toString("utf8");
  if (result.status === 0) {
    terminated(["rev-parse", "--verify", "--quiet", "HEAD"], out, "\n", true);
    return true;
  }
  if (result.status === 1 && out.trim() === "") return false;
  throw new Error(
    `git rev-parse --verify HEAD failed (exit ${result.status}): ${result.stderr.trim()}`,
  );
}

/** A ref's commit, or null where the ref does not exist. */
export async function gitRefHead(dir: string, ref: string): Promise<string | null> {
  const args = ["rev-parse", "--verify", "--quiet", ref];
  const result = await gitRun(dir, args);
  if (result.error !== undefined) throw result.error;
  if (result.status === 0) {
    return terminated(args, result.stdout.toString("utf8"), "\n", true).trim();
  }
  if (result.status === 1) return null;
  throw new Error(
    `git rev-parse --verify ${ref} failed (exit ${String(result.status)}): ${result.stderr.trim()}`,
  );
}

/** Whether the repository holds this commit at all. */
export async function gitCommitKnown(dir: string, sha: string): Promise<boolean> {
  return (await gitRefHead(dir, `${sha}^{commit}`)) !== null;
}

/** Whether `ancestor` is on the history of `descendant`. */
export async function gitIsAncestor(
  dir: string,
  ancestor: string,
  descendant: string,
): Promise<boolean> {
  const result = await gitRun(dir, ["merge-base", "--is-ancestor", ancestor, descendant]);
  if (result.error !== undefined) throw result.error;
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  throw new Error(
    `git merge-base --is-ancestor failed (exit ${String(result.status)}): ${result.stderr.trim()}`,
  );
}

/**
 * The entry names at the ROOT of a revision's tree — `--full-tree`, because
 * from a vault embedded in a subdirectory `ls-tree` would otherwise list that
 * subdirectory, while `<rev>:<path>` is always root-relative. What tells a
 * repository path from any other backticked token.
 */
export async function gitTreeEntries(dir: string, rev: string): Promise<string[]> {
  const args = ["ls-tree", "--full-tree", "--name-only", "-z", rev];
  return terminated(args, await git(dir, args), "\0")
    .split("\0")
    .filter((name) => name !== "");
}

/** One entry of a revision's tree, as `ls-tree -r` lists it: a blob, a link or a submodule. */
export interface TreeListingEntry {
  /** `100644`, `100755`, `120000` (a symbolic link) or `160000` (a submodule). */
  mode: string;
  /** `blob`, or `commit` for a submodule. */
  type: string;
  object: string;
  /** Repository-relative, as git spells it. */
  path: string;
}

/**
 * Every entry of a revision's tree, recursively, from the repository's top
 * level whatever directory `dir` is (`--full-tree`), NUL-framed: the one
 * listing the v2 revision state and its law are read from.
 */
export async function gitTreeListing(dir: string, rev: string): Promise<TreeListingEntry[]> {
  const args = ["ls-tree", "-r", "-z", "--full-tree", rev];
  const out: TreeListingEntry[] = [];
  for (const record of terminated(args, await git(dir, args), "\0").split("\0")) {
    if (record === "") continue;
    const tab = record.indexOf("\t");
    if (tab < 0) continue;
    const [mode, type, object] = record.slice(0, tab).split(" ");
    if (mode === undefined || type === undefined || object === undefined) continue;
    out.push({ mode, type, object, path: record.slice(tab + 1) });
  }
  return out;
}

/**
 * The type of the object `<rev>:<path>` names — `blob`, `tree` — or undefined
 * where the revision's tree holds no such path. A missing path is an answer,
 * not a failure; a spawn failure is thrown as itself.
 */
export async function gitObjectType(dir: string, spec: string): Promise<string | undefined> {
  const result = await gitRun(dir, ["cat-file", "-t", spec]);
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) return undefined;
  return terminated(["cat-file", "-t", spec], result.stdout.toString("utf8"), "\n", true).trim();
}

/** The number of lines in a blob: its newlines, plus one for an unterminated last line. */
export async function gitBlobLineCount(dir: string, spec: string): Promise<number> {
  const text = await git(dir, ["cat-file", "-p", spec]);
  if (text.length === 0) return 0;
  const newlines = text.split("\n").length - 1;
  return text.endsWith("\n") ? newlines : newlines + 1;
}

/** Commits between a pin and a head (pin distance). Throws on an unresolvable pin. */
export async function gitRevListCount(dir: string, from: string, to: string): Promise<number> {
  const args = ["rev-list", "--count", `${from}..${to}`];
  return Number.parseInt(terminated(args, await git(dir, args), "\n", true).trim(), 10);
}

/**
 * Files the range touched, restricted to the covered paths (covering
 * diff). `--no-renames`: a covered file that moved away is listed under the
 * path it left, the path a page covers. With `top`, `:(top)` pathspec magic keeps `covers`
 * repo-root-relative when the vault is embedded in a subdirectory of the
 * repository it documents. `--no-relative`: a caller's `diff.relative=true`
 * would restrict the diff to the vault's directory and answer nothing for a
 * covered path outside it, and a stale pin would read unchanged.
 */
export async function gitDiffNames(
  dir: string,
  from: string,
  to: string,
  paths: readonly string[],
  top: boolean,
): Promise<string[]> {
  const args = ["diff", "--name-only", "-z", "--no-renames", "--no-relative", from, to];
  if (paths.length > 0) args.push("--", ...paths.map((p) => (top ? `:(top)${p}` : p)));
  return terminated(args, await git(dir, args), "\0")
    .split("\0")
    .filter((p) => p !== "");
}

/** The shell's decoder for a blob's bytes: what `git show` through `encoding: "utf8"` produced. */
function utf8(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("utf8");
}

/** The most content bytes one `cat-file --batch` child returns; a chunk holds at least one blob. */
const BATCH_BYTES = 32 * 1024 * 1024;

/**
 * A batch read: the object names go in as a file the engine wrote, handed to
 * git as its stdin, and the answer comes back in the file git wrote
 * (stdoutfile.ts). Neither travels through a pipe the runtime fills or drains.
 * Each batch read still holds its answer to its request, row by row: the count
 * of rows, and each row's name against the name it answers.
 */
async function gitBatch(root: string, args: string[], input: string): Promise<Buffer> {
  const result = await gitRun(root, args, { input });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} exited ${String(result.status)}: ${result.stderr}`);
  }
  return result.stdout;
}

/**
 * Each row of a batch answer names the request at its position, else the
 * answer and the request disagree: `git-inconsistent-read`.
 */
function answersInOrder(answered: readonly string[], requested: readonly string[]): void {
  requested.forEach((request, i) => {
    const answer = answered[i];
    if (answer !== request) {
      throw new GitInconsistentRead(
        ["cat-file --batch-check"],
        `row ${i + 1} answers ${JSON.stringify(answer)}, and the request there was ${JSON.stringify(request)}`,
      );
    }
  });
}

/**
 * The content of many blobs, by id, in a number of git processes bounded by
 * the bytes rather than by the count: one `cat-file --batch-check` for the
 * sizes, then one `cat-file --batch` per chunk of at most BATCH_BYTES. The
 * staged gate and the replay read every page of a state through this. A `git
 * show` per page made the gate's cost a process spawn per page in the vault,
 * about six milliseconds each: a five-thousand-page index took thirty seconds
 * to read and four to judge (docs/roadmap.md §Every run parses the whole
 * corpus). A blob the repository does not hold is a broken repository, thrown.
 */
export async function gitReadBlobs(
  root: string,
  blobs: readonly string[],
  decode: (bytes: Uint8Array) => string = utf8,
): Promise<Map<string, string>> {
  const wanted = [...new Set(blobs)];
  const out = new Map<string, string>();
  if (wanted.length === 0) return out;
  const sizes = new Map<string, number>();
  const checked = await gitBatch(root, ["cat-file", "--batch-check"], `${wanted.join("\n")}\n`);
  const records = parseCatFileBatchCheck(
    terminated(["cat-file", "--batch-check"], checked.toString("utf8"), "\n"),
  );
  if (records.length !== wanted.length) {
    throw new GitShortRead(
      "cat-file --batch-check",
      `it answered ${records.length} of ${wanted.length} objects`,
    );
  }
  // The requests are full object ids, and git answers each with its full
  // object id or echoes it as `missing`: every row names what it answers.
  answersInOrder(
    records.map((r) => r.name),
    wanted,
  );
  for (const record of records) {
    if (record.size === undefined) throw new Error(`blob ${record.name} is not in the repository`);
    sizes.set(record.name, record.size);
  }
  let chunk: string[] = [];
  let chunkBytes = 0;
  const flush = async (): Promise<void> => {
    if (chunk.length === 0) return;
    const bytes = await gitBatch(root, ["cat-file", "--batch"], `${chunk.join("\n")}\n`);
    // Every object ends in a newline, so a stream cut between objects is caught
    // by the terminator and the count; one cut inside an object, by the parser,
    // and it is the same short read by name.
    if (bytes.length > 0 && bytes[bytes.length - 1] !== 0x0a) {
      throw new GitShortRead("cat-file --batch", "its output does not end in a newline");
    }
    let read: Map<string, string>;
    try {
      read = parseCatFileBatch(bytes, decode);
    } catch (error) {
      if (!(error instanceof BatchStreamTruncated)) throw error;
      throw new GitShortRead(
        "cat-file --batch",
        error.object === undefined
          ? "its output ends inside a header"
          : `its output ends inside object ${error.object}`,
      );
    }
    const missing = chunk.filter((blob) => !read.has(blob));
    if (missing.length > 0) {
      throw new GitShortRead(
        "cat-file --batch",
        `it answered ${chunk.length - missing.length} of ${chunk.length} objects`,
      );
    }
    for (const [blob, text] of read) out.set(blob, text);
    chunk = [];
    chunkBytes = 0;
  };
  for (const blob of wanted) {
    const size = sizes.get(blob) ?? 0;
    if (chunk.length > 0 && chunkBytes + size > BATCH_BYTES) await flush();
    chunk.push(blob);
    chunkBytes += size;
  }
  await flush();
  return out;
}

/**
 * The bytes of many blobs, by id, through the same batch read: an export
 * carries files that are not text (docs/constitution.md §exports). Each blob
 * is carried through a byte-for-byte decoding and back.
 */
export async function gitReadBlobBytes(
  root: string,
  blobs: readonly string[],
): Promise<Map<string, Buffer>> {
  const latin1 = (bytes: Uint8Array): string =>
    Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("latin1");
  const out = new Map<string, Buffer>();
  for (const [blob, text] of await gitReadBlobs(root, blobs, latin1)) {
    out.set(blob, Buffer.from(text, "latin1"));
  }
  return out;
}

/**
 * The blob HEAD holds at each path, or `undefined` where it holds none: a path
 * added since, or a repository with no commit yet. One `cat-file --batch-check`
 * over `HEAD:./<path>` for any number of paths, where a `git show` per path made
 * a bulk commit's gate spawn one process for every changed page. `./` resolves
 * each path from the vault root, as `diff --relative` reported it, so an
 * embedded vault reads inside its own directory. git answers `missing` for a
 * path HEAD does not hold and exits non-zero for any other failure, which is
 * thrown. A path must not hold a newline: the names go one per line.
 */
export async function gitHeadBlobs(
  root: string,
  paths: readonly string[],
): Promise<Map<string, string | undefined>> {
  const wanted = [...new Set(paths)];
  const out = new Map<string, string | undefined>();
  if (wanted.length === 0) return out;
  const names = wanted.map((path) => `HEAD:./${path}`);
  const checked = await gitBatch(root, ["cat-file", "--batch-check"], `${names.join("\n")}\n`);
  const records = parseCatFileBatchCheck(
    terminated(["cat-file", "--batch-check"], checked.toString("utf8"), "\n"),
  );
  if (records.length !== wanted.length) {
    throw new GitShortRead(
      "cat-file --batch-check",
      `it answered ${records.length} of ${wanted.length} paths`,
    );
  }
  // A row git could not resolve echoes the request, which must be the one it
  // answers; a row it resolved names the object, not the path, so it must at
  // least be a blob. A request cut inside its path answers `missing` for a
  // shorter path, and read by position it would be a page HEAD never held.
  answersInOrder(
    records.map((r, i) => (r.size === undefined ? r.name : (names[i] ?? ""))),
    names,
  );
  records.forEach((record, i) => {
    if (record.size !== undefined && record.type !== "blob") {
      throw new GitInconsistentRead(
        ["cat-file --batch-check"],
        `the request ${JSON.stringify(names[i])} was answered with a ${String(record.type)}, not a blob`,
      );
    }
  });
  wanted.forEach((path, i) => {
    const record = records[i];
    out.set(path, record === undefined || record.size === undefined ? undefined : record.name);
  });
  return out;
}

/** The variables git exports into a hook, which change what `rev-parse` discovers. */
const HOOK_VARIABLES = ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_INDEX_FILE"] as const;

/** What `bundleIdentity` reports about the checkout a vault sits in. */
export interface CheckoutState {
  /** The commit HEAD names, or null in a repository with no commit yet. */
  head: string | null;
  /** Whether `git status` lists any change under the directory, untracked files included. */
  dirty: boolean;
}

/**
 * docs/cli.md §The envelope: the checkout a vault root sits in, from one
 * process. `status --porcelain=v2 --branch` prints the head as its
 * `# branch.oid` header (`(initial)` before the first commit) and one entry
 * per change, and the pathspec keeps the entries to the directory, so the
 * header answers `head` and any entry makes it `dirty`. Untracked files count;
 * ignored ones do not.
 *
 * A reader, never a writer: `--no-optional-locks` (and `GIT_OPTIONAL_LOCKS=0`,
 * which every git call here carries) keeps `status` from refreshing the index, which it otherwise does whenever it can take the
 * lock, and which a dry run must not move. A hook's exported variables are
 * removed, so the repository is the one git discovers from the directory. Undefined when git gives no answer: no
 * repository encloses the directory, or git cannot run there.
 */
export async function gitCheckoutState(dir: string): Promise<CheckoutState | undefined> {
  const env = { ...process.env };
  for (const key of HOOK_VARIABLES) delete env[key];
  const result = await gitRun(
    dir,
    [
      "--no-optional-locks",
      "status",
      "--porcelain=v2",
      "-z",
      "--branch",
      "--untracked-files=all",
      "--",
      ".",
    ],
    { env },
  );
  // A git that hung is refused by name, not read as no checkout.
  if (result.error instanceof GitTimedOut) throw result.error;
  if (result.error !== undefined || result.status !== 0) return undefined;
  // A cut answer could drop the entries that make the checkout dirty: it is
  // thrown, and the bundle block it would have fed is left off. Under `-z`
  // every header and entry ends in a NUL, and a rename's second path is one
  // more NUL-terminated field, which reads as an entry: dirty either way.
  const out = terminated(
    ["status", "--porcelain=v2", "-z", "--branch", "--untracked-files=all"],
    result.stdout.toString("utf8"),
    "\0",
    true,
  );
  let head: string | null = null;
  let dirty = false;
  for (const line of out.split("\0")) {
    if (line === "") continue;
    if (!line.startsWith("# ")) {
      dirty = true;
      continue;
    }
    const oid = /^# branch\.oid ([0-9a-f]{40,64})$/u.exec(line)?.[1];
    if (oid !== undefined) head = oid;
  }
  return { head, dirty };
}
