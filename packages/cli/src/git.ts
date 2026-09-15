// docs/architecture.md (spawned git plumbing; no git library) · docs/cli.md §lint (--staged
// reads index content, never the working tree).
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  parseCatFileBatch,
  parseCatFileBatchCheck,
  parseNameStatusZ,
  type StagedChange,
} from "@wikiwright/core";

// 64 MiB: the default 1 MiB maxBuffer would crash on large pages — and worse,
// silently disarm the append-only base lookup via the catch below.
const MAX_BUFFER = 64 * 1024 * 1024;

function git(root: string, args: string[]): string {
  // stderr is captured, never inherited: it rides on the thrown error's message
  // (gitShowHead matches on it) instead of printing `fatal:` beside a green
  // envelope — a repository the freshness pass cannot measure is a finding or a
  // coverage row, never noise on stderr (docs/cli.md §The envelope).
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function gitStagedChanges(root: string): StagedChange[] {
  // --relative keeps paths vault-root-relative, so a vault living in a
  // subdirectory of a code repo (the code-bundle layout) works unchanged.
  return parseNameStatusZ(
    git(root, ["diff", "--cached", "--name-status", "-z", "-M", "--relative"]),
  );
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
  for (const record of git(root, ["ls-files", "-s", "-z"]).split("\0")) {
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
  return git(root, ["rev-parse", "HEAD"]).trim();
}

/**
 * The root of the work tree enclosing `dir`, or `undefined` when no repository
 * does (docs/constitution.md §Shapes: origin "." is the repository the vault
 * lives in, whether the vault is its root or a directory inside it). Only
 * "not a git repository" is an answer of "none"; any other failure is the
 * plumbing breaking and is thrown as itself.
 */
export function gitTopLevel(dir: string): string | undefined {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: dir,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error !== undefined) throw result.error;
  if (result.status === 0) return result.stdout.trim();
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
  const result = spawnSync("git", ["rev-parse", "--verify", "--quiet", "HEAD"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error !== undefined) throw result.error;
  if (result.status === 0) return true;
  if (result.status === 1 && result.stdout.trim() === "") return false;
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
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: ORIGIN_TIMEOUT_MS,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  if (result.error !== undefined) {
    if ((result.error as NodeJS.ErrnoException).code === "ETIMEDOUT") {
      throw new OriginUnreachable(`no answer within ${ORIGIN_TIMEOUT_MS / 1000} s`);
    }
    throw result.error;
  }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** The origin's HEAD, with no clone: one round trip. */
export function gitLsRemoteHead(cwd: string, origin: string): string {
  const r = originGit(cwd, ["ls-remote", "--quiet", origin, "HEAD"]);
  if (r.status !== 0) {
    throw new OriginUnreachable(r.stderr.trim() || `git ls-remote exited ${String(r.status)}`);
  }
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
  return { head: git(cache, ["rev-parse", CACHE_HEAD]).trim(), filter };
}

/** A ref's commit, or null where the ref does not exist. */
export function gitRefHead(dir: string, ref: string): string | null {
  const result = spawnSync("git", ["rev-parse", "--verify", "--quiet", ref], {
    cwd: dir,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error !== undefined) throw result.error;
  if (result.status === 0) return result.stdout.trim();
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
  const result = spawnSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], {
    cwd: dir,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
    stdio: ["ignore", "pipe", "pipe"],
  });
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
  return git(dir, ["ls-tree", "--full-tree", "--name-only", "-z", rev])
    .split("\0")
    .filter((name) => name !== "");
}

/**
 * The type of the object `<rev>:<path>` names — `blob`, `tree` — or undefined
 * where the revision's tree holds no such path. A missing path is an answer,
 * not a failure; a spawn failure is thrown as itself.
 */
export function gitObjectType(dir: string, spec: string): string | undefined {
  const result = spawnSync("git", ["cat-file", "-t", spec], {
    cwd: dir,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error !== undefined) throw result.error;
  return result.status === 0 ? result.stdout.trim() : undefined;
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
  return Number.parseInt(git(dir, ["rev-list", "--count", `${from}..${to}`]).trim(), 10);
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
  return git(dir, args)
    .split("\0")
    .filter((p) => p !== "");
}

/** The shell's decoder for a blob's bytes: what `git show` through `encoding: "utf8"` produced. */
function utf8(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("utf8");
}

/** The most content bytes one `cat-file --batch` child returns; a chunk holds at least one blob. */
const BATCH_BYTES = 32 * 1024 * 1024;

function gitBatch(root: string, args: string[], input: string, maxBuffer: number): Buffer {
  const result = spawnSync("git", args, {
    cwd: root,
    input,
    maxBuffer,
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} exited ${result.status}: ${result.stderr.toString("utf8")}`,
    );
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
  const checked = gitBatch(
    root,
    ["cat-file", "--batch-check"],
    `${wanted.join("\n")}\n`,
    MAX_BUFFER,
  );
  for (const record of parseCatFileBatchCheck(checked.toString("utf8"))) {
    if (record.size === undefined) throw new Error(`blob ${record.name} is not in the repository`);
    sizes.set(record.name, record.size);
  }
  let chunk: string[] = [];
  let chunkBytes = 0;
  const flush = (): void => {
    if (chunk.length === 0) return;
    // The buffer is the chunk's content plus a header and a newline per blob.
    const maxBuffer = chunkBytes + chunk.length * 128 + 1024;
    const bytes = gitBatch(root, ["cat-file", "--batch"], `${chunk.join("\n")}\n`, maxBuffer);
    for (const [blob, text] of parseCatFileBatch(bytes, utf8)) out.set(blob, text);
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
  const checked = gitBatch(
    root,
    ["cat-file", "--batch-check"],
    `${names.join("\n")}\n`,
    MAX_BUFFER,
  );
  const records = parseCatFileBatchCheck(checked.toString("utf8"));
  if (records.length !== wanted.length) {
    throw new Error(`cat-file --batch-check answered ${records.length} of ${wanted.length} paths`);
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
  const result = spawnSync(
    "git",
    ["rev-parse", "--is-inside-work-tree", "--git-common-dir", "--show-prefix"],
    { cwd: dir, env, encoding: "utf8", maxBuffer: MAX_BUFFER, stdio: ["ignore", "pipe", "pipe"] },
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
  // other output is a path with no worktree identity.
  const lines = result.stdout.split("\n");
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
