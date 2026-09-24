// docs/architecture.md (spawned git plumbing; no git library) · docs/cli.md §lint (--staged
// reads index content, never the working tree).
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
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
 * writing it. Every answer is read from a file git wrote itself
 * (`stdoutfile.ts`), so no runtime pipe can cut one; the terminator and count
 * checks stay as a second line. A read whose output has a terminator is held
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
 * One git child, its stdout read from the file it wrote (`stdoutfile.ts`).
 * stderr is captured, never inherited: it rides on a thrown error's message
 * (gitShowHead matches on it) instead of printing `fatal:` beside a green
 * envelope (docs/cli.md §The envelope).
 */
export function gitRun(
  cwd: string,
  args: readonly string[],
  options: Omit<ChildOptions, "cwd"> = {},
): ChildAnswer {
  return spawnWithStdoutFile("git", args, { ...options, cwd });
}

/** git's whole answer as text; a spawn failure or a non-zero exit is thrown with stderr. */
export function gitText(root: string, args: readonly string[]): string {
  const result = gitRun(root, args);
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} exited ${String(result.status)}: ${result.stderr.trim()}`,
    );
  }
  return result.stdout.toString("utf8");
}

function git(root: string, args: string[]): string {
  return gitText(root, args);
}

export function gitStagedChanges(root: string): StagedChange[] {
  // --relative keeps paths vault-root-relative, so a vault living in a
  // subdirectory of a code repo (the code-bundle layout) works unchanged.
  const args = ["diff", "--cached", "--name-status", "-z", "-M", "--relative"];
  return parseNameStatusZ(terminated(args, git(root, args), "\0"));
}

/** The staged (index) content of a path (vault-root-relative via ./ pathspec). */
export function gitShowStaged(root: string, path: string): string {
  return git(root, ["show", `:./${path}`]);
}

/**
 * The last committed content of a path, or undefined when it did not exist.
 * Kept for the one path `cat-file`'s line protocol cannot name: a rename's
 * source whose name holds a newline. Every other base comes through
 * `gitHeadBlobs` and the batch read.
 */
export function gitShowHead(root: string, path: string): string | undefined {
  try {
    return git(root, ["show", `HEAD:./${path}`]);
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
}

/** The index's entries, for staged-state identity and the one read of its pages. */
export function gitIndexEntries(root: string): IndexEntry[] {
  const entries: IndexEntry[] = [];
  // `<mode> <blob> <stage>\t<path>`, NUL-terminated, paths relative to the root.
  const args = ["ls-files", "-s", "-z"];
  for (const record of terminated(args, git(root, args), "\0").split("\0")) {
    const tab = record.indexOf("\t");
    if (tab < 0) continue;
    const [, blob, stage] = record.slice(0, tab).split(" ");
    if (blob === undefined || stage === undefined) continue;
    entries.push({ path: record.slice(tab + 1), blob, stage: Number(stage) });
  }
  return entries;
}

/** The current head commit. */
export function gitHead(root: string): string {
  const args = ["rev-parse", "HEAD"];
  return terminated(args, git(root, args), "\n", true).trim();
}

/**
 * The root of the work tree enclosing `dir`, or `undefined` when no repository
 * does (docs/constitution.md §Shapes: origin "." is the repository the vault
 * lives in, whether the vault is its root or a directory inside it). Only
 * "not a git repository" is an answer of "none"; any other failure is the
 * plumbing breaking and is thrown as itself.
 */
export function gitTopLevel(dir: string): string | undefined {
  const result = gitRun(dir, ["rev-parse", "--show-toplevel"]);
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
export function gitHasHead(root: string): boolean {
  const result = gitRun(root, ["rev-parse", "--verify", "--quiet", "HEAD"]);
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

// ---------------------------------------------------------------------------
// origins (docs/constitution.md §Shapes): the network half, with a timeout and no prompt

/**
 * An origin that did not answer — the run-external failure `freshness` reports
 * as `origin-unreachable` on every page naming it. Distinct from a plumbing
 * failure (no git on PATH, a broken repository), which is thrown as itself and
 * becomes `freshness-unavailable`.
 */
export class OriginUnreachable extends Error {}

const ORIGIN_TIMEOUT_MS = 30_000;

/** The ref the per-origin cache keeps the origin's HEAD under. */
export const CACHE_HEAD = "refs/wikiwright/head";

/**
 * A git call that may reach the network. `GIT_TERMINAL_PROMPT=0` so a private
 * origin fails instead of hanging on a credential prompt; a timeout so a dead
 * host is an answer; a non-zero exit is the origin's refusal, never a throw.
 */
function originGit(
  cwd: string,
  args: string[],
): { status: number | null; stdout: string; stderr: string } {
  const result = gitRun(cwd, args, {
    timeout: ORIGIN_TIMEOUT_MS,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  if (result.error !== undefined) {
    if ((result.error as NodeJS.ErrnoException).code === "ETIMEDOUT") {
      throw new OriginUnreachable(`no answer within ${ORIGIN_TIMEOUT_MS / 1000} s`);
    }
    throw result.error;
  }
  return { status: result.status, stdout: result.stdout.toString("utf8"), stderr: result.stderr };
}

/** The origin's HEAD, with no clone: one round trip. */
export function gitLsRemoteHead(cwd: string, origin: string): string {
  const r = originGit(cwd, ["ls-remote", "--quiet", origin, "HEAD"]);
  if (r.status !== 0) {
    throw new OriginUnreachable(r.stderr.trim() || `git ls-remote exited ${String(r.status)}`);
  }
  terminated(["ls-remote", "--quiet", origin, "HEAD"], r.stdout, "\n");
  const sha = r.stdout.split(/\s+/u)[0] ?? "";
  if (!/^[0-9a-f]{40,64}$/u.test(sha)) throw new OriginUnreachable("the origin advertised no HEAD");
  return sha;
}

/**
 * Bring the origin's HEAD into its blobless bare cache. `--filter=blob:none`
 * fetches commits and trees and no file contents — enough for `rev-list` and a
 * `--name-only` diff between two trees; on a server that refuses filters the
 * fetch is retried whole, and the caller is told which. `--no-tags`: a tag is
 * not a head. The cache is created on first use; git makes the directory.
 */
export function gitOriginFetch(
  root: string,
  cache: string,
  origin: string,
): { head: string; filter: "blob:none" | "none" } {
  if (!existsSync(join(cache, "HEAD"))) git(root, ["init", "--bare", "-q", cache]);
  const fetch = (filtered: boolean) =>
    originGit(cache, [
      "fetch",
      "--quiet",
      ...(filtered ? ["--filter=blob:none"] : []),
      "--no-tags",
      origin,
      `+HEAD:${CACHE_HEAD}`,
    ]);
  let r = fetch(true);
  let filter: "blob:none" | "none" = "blob:none";
  if (r.status !== 0 && /filter/iu.test(r.stderr)) {
    r = fetch(false);
    filter = "none";
  }
  if (r.status !== 0) {
    throw new OriginUnreachable(r.stderr.trim() || `git fetch exited ${String(r.status)}`);
  }
  const head = ["rev-parse", CACHE_HEAD];
  return { head: terminated(head, git(cache, head), "\n", true).trim(), filter };
}

/** A ref's commit, or null where the ref does not exist. */
export function gitRefHead(dir: string, ref: string): string | null {
  const args = ["rev-parse", "--verify", "--quiet", ref];
  const result = gitRun(dir, args);
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
export function gitCommitKnown(dir: string, sha: string): boolean {
  return gitRefHead(dir, `${sha}^{commit}`) !== null;
}

/** Whether `ancestor` is on the history of `descendant`. */
export function gitIsAncestor(dir: string, ancestor: string, descendant: string): boolean {
  const result = gitRun(dir, ["merge-base", "--is-ancestor", ancestor, descendant]);
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
export function gitTreeEntries(dir: string, rev: string): string[] {
  const args = ["ls-tree", "--full-tree", "--name-only", "-z", rev];
  return terminated(args, git(dir, args), "\0")
    .split("\0")
    .filter((name) => name !== "");
}

/**
 * The type of the object `<rev>:<path>` names — `blob`, `tree` — or undefined
 * where the revision's tree holds no such path. A missing path is an answer,
 * not a failure; a spawn failure is thrown as itself.
 */
export function gitObjectType(dir: string, spec: string): string | undefined {
  const result = gitRun(dir, ["cat-file", "-t", spec]);
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) return undefined;
  return terminated(["cat-file", "-t", spec], result.stdout.toString("utf8"), "\n", true).trim();
}

/** The number of lines in a blob: its newlines, plus one for an unterminated last line. */
export function gitBlobLineCount(dir: string, spec: string): number {
  const text = git(dir, ["cat-file", "-p", spec]);
  if (text.length === 0) return 0;
  const newlines = text.split("\n").length - 1;
  return text.endsWith("\n") ? newlines : newlines + 1;
}

/** Commits between a pin and a head (pin distance). Throws on an unresolvable pin. */
export function gitRevListCount(dir: string, from: string, to: string): number {
  const args = ["rev-list", "--count", `${from}..${to}`];
  return Number.parseInt(terminated(args, git(dir, args), "\n", true).trim(), 10);
}

/**
 * Files the range touched, restricted to the covered paths (covering
 * diff). `--no-renames`: rename detection compares blob contents and would
 * lazily fetch blobs into a blobless cache; a `--name-only` diff of two trees
 * needs none. With `top`, `:(top)` pathspec magic keeps `covers`
 * repo-root-relative when the vault is embedded in a subdirectory of the
 * repository it documents.
 */
export function gitDiffNames(
  dir: string,
  from: string,
  to: string,
  paths: readonly string[],
  top: boolean,
): string[] {
  const args = ["diff", "--name-only", "-z", "--no-renames", from, to];
  if (paths.length > 0) args.push("--", ...paths.map((p) => (top ? `:(top)${p}` : p)));
  return terminated(args, git(dir, args), "\0")
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
 * A batch read: the object names go in on stdin, a pipe the runtime writes, and
 * the answer comes back in the file git wrote. What the stdin pipe could lose
 * is caught by the count each batch read holds its answer to.
 */
function gitBatch(root: string, args: string[], input: string): Buffer {
  const result = gitRun(root, args, { input });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} exited ${String(result.status)}: ${result.stderr}`);
  }
  return result.stdout;
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
export function gitReadBlobs(root: string, blobs: readonly string[]): Map<string, string> {
  const wanted = [...new Set(blobs)];
  const out = new Map<string, string>();
  if (wanted.length === 0) return out;
  const sizes = new Map<string, number>();
  const checked = gitBatch(root, ["cat-file", "--batch-check"], `${wanted.join("\n")}\n`);
  const records = parseCatFileBatchCheck(
    terminated(["cat-file", "--batch-check"], checked.toString("utf8"), "\n"),
  );
  if (records.length !== wanted.length) {
    throw new GitShortRead(
      "cat-file --batch-check",
      `it answered ${records.length} of ${wanted.length} objects`,
    );
  }
  for (const record of records) {
    if (record.size === undefined) throw new Error(`blob ${record.name} is not in the repository`);
    sizes.set(record.name, record.size);
  }
  let chunk: string[] = [];
  let chunkBytes = 0;
  const flush = (): void => {
    if (chunk.length === 0) return;
    const bytes = gitBatch(root, ["cat-file", "--batch"], `${chunk.join("\n")}\n`);
    // Every object ends in a newline, so a stream cut between objects is caught
    // by the terminator and the count; one cut inside an object, by the parser,
    // and it is the same short read by name.
    if (bytes.length > 0 && bytes[bytes.length - 1] !== 0x0a) {
      throw new GitShortRead("cat-file --batch", "its output does not end in a newline");
    }
    let read: Map<string, string>;
    try {
      read = parseCatFileBatch(bytes, utf8);
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
    if (chunk.length > 0 && chunkBytes + size > BATCH_BYTES) flush();
    chunk.push(blob);
    chunkBytes += size;
  }
  flush();
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
export function gitHeadBlobs(
  root: string,
  paths: readonly string[],
): Map<string, string | undefined> {
  const wanted = [...new Set(paths)];
  const out = new Map<string, string | undefined>();
  if (wanted.length === 0) return out;
  const names = wanted.map((path) => `HEAD:./${path}`);
  const checked = gitBatch(root, ["cat-file", "--batch-check"], `${names.join("\n")}\n`);
  const records = parseCatFileBatchCheck(
    terminated(["cat-file", "--batch-check"], checked.toString("utf8"), "\n"),
  );
  if (records.length !== wanted.length) {
    throw new GitShortRead(
      "cat-file --batch-check",
      `it answered ${records.length} of ${wanted.length} paths`,
    );
  }
  wanted.forEach((path, i) => {
    const record = records[i];
    out.set(path, record === undefined || record.size === undefined ? undefined : record.name);
  });
  return out;
}

/** The variables git exports into a hook, which change what `rev-parse` discovers. */
const HOOK_VARIABLES = ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_INDEX_FILE"] as const;

/**
 * docs/cli.md §trust: where a vault sits, for a worktree-scope grant — the git
 * common directory its checkout shares with every linked worktree of the same
 * clone, and the vault's path inside its own worktree, as git discovers them
 * from the vault directory. The variables git exports into a hook are removed
 * first: with `GIT_DIR` set and no work tree, `rev-parse` takes the directory it
 * runs in for the top of the work tree, and a vault below the top would read as
 * the top itself. The common directory is resolved against `dir`, since git
 * may print it relative; the caller takes its real path. A directory outside
 * every work tree, and any failure of git, is thrown.
 */
export function gitWorktreeIdentity(dir: string): { commonDir: string; prefix: string } {
  const env = { ...process.env };
  for (const key of HOOK_VARIABLES) delete env[key];
  const result = gitRun(
    dir,
    ["rev-parse", "--is-inside-work-tree", "--git-common-dir", "--show-prefix"],
    { env },
  );
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `git rev-parse --git-common-dir failed (exit ${String(result.status)}): ${result.stderr.trim()}`,
    );
  }
  // git prints each answer on its own line and a newline inside a path
  // verbatim, so a newline in the vault's path or in a common directory printed
  // whole would split one answer into two and read the vault as a shorter path,
  // another vault's. Exactly three lines is the one unambiguous reading; any
  // other output is a path with no worktree identity. An answer that does not
  // end in a newline was cut short, and says so.
  const lines = terminated(
    ["rev-parse", "--is-inside-work-tree", "--git-common-dir", "--show-prefix"],
    result.stdout.toString("utf8"),
    "\n",
    true,
  ).split("\n");
  if (lines.length !== 4 || lines[3] !== "") {
    throw new Error(
      `"${dir}" has no worktree identity: git printed its answers across ${String(lines.length - 1)} lines, so a path holds a newline`,
    );
  }
  const [inside = "", common = "", prefix = ""] = lines;
  if (inside !== "true") throw new Error(`"${dir}" is not inside a git work tree`);
  if (common === "") throw new Error("git rev-parse --git-common-dir printed no directory");
  return { commonDir: resolve(dir, common), prefix };
}

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
 * A reader, never a writer: `--no-optional-locks` keeps `status` from
 * refreshing the index, which it otherwise does whenever it can take the
 * lock, and which a dry run must not move. A hook's exported variables are
 * removed, as for the worktree identity, so the repository is the one git
 * discovers from the directory. Undefined when git gives no answer: no
 * repository encloses the directory, or git cannot run there.
 */
export function gitCheckoutState(dir: string): CheckoutState | undefined {
  const env = { ...process.env };
  for (const key of HOOK_VARIABLES) delete env[key];
  const result = gitRun(
    dir,
    [
      "--no-optional-locks",
      "status",
      "--porcelain=v2",
      "--branch",
      "--untracked-files=all",
      "--",
      ".",
    ],
    { env },
  );
  if (result.error !== undefined || result.status !== 0) return undefined;
  // A cut answer could drop the entries that make the checkout dirty: it is
  // thrown, and the bundle block it would have fed is left off.
  const out = terminated(
    ["status", "--porcelain=v2", "--branch", "--untracked-files=all"],
    result.stdout.toString("utf8"),
    "\n",
    true,
  );
  let head: string | null = null;
  let dirty = false;
  for (const line of out.split("\n")) {
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
