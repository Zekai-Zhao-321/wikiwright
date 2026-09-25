// docs/cli.md §version (the verb never throws — an unanswerable question
// is null, not an error; the primary answer names the BUILD, read
// from the artifact the build script stamped, and the call-time git lookup is
// demoted to `checkout_commit`). The identity of the running code lives here, in
// one module, because two verbs answer with it: `version` prints it and `skills`
// stamps it into the install (docs/cli.md §skills).
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gitRun } from "./git.ts";

const CLI_PACKAGE_DIR = fileURLToPath(new URL("..", import.meta.url));

/** git's answer in the package's own directory, read from the file git wrote; null on any failure. */
async function gitInPackage(args: string[]): Promise<string | null> {
  try {
    const result = await gitRun(CLI_PACKAGE_DIR, args);
    return result.error === undefined && result.status === 0
      ? result.stdout.toString("utf8")
      : null;
  } catch {
    return null;
  }
}

export interface Identity {
  commit: string | null;
  dirty: boolean | null;
}

/**
 * The checkout this binary's package sits in, or null — never a
 * throw. `ls-files --error-unmatch package.json` guards the installed case: a
 * copy under a vault's node_modules/ sits inside the VAULT's repository,
 * ignored and untracked, and must not report the vault's commit as its own.
 */
export async function checkoutIdentity(): Promise<Identity> {
  const unknown: Identity = { commit: null, dirty: null };
  if ((await gitInPackage(["ls-files", "--error-unmatch", "package.json"])) === null) {
    return unknown;
  }
  const [head, status] = await Promise.all([
    gitInPackage(["rev-parse", "--short", "HEAD"]),
    gitInPackage(["status", "--porcelain", "-z", "--untracked-files=no"]),
  ]);
  if (head === null || status === null) return unknown;
  // Under `-z` an entry ends in a NUL; a clean checkout prints nothing.
  return { commit: head.trim(), dirty: status.length > 0 };
}

export interface BuildInfo {
  commit: string | null;
  dirty: boolean | null;
}

/**
 * The stamp `tools/write-build-info.ts` wrote beside the emitted JavaScript.
 * Looked for next to this module (the compiled `dist/` case) and then in the
 * package's `dist/` (running from `src/`, as the tests do), so "which code is
 * this" has one answer in both. `undefined` means no build info shipped with
 * this binary — reported as `source: "unknown"`, never guessed at.
 */
export function readBuildInfo(): BuildInfo | undefined {
  for (const candidate of [
    new URL("./build-info.json", import.meta.url),
    new URL("../dist/build-info.json", import.meta.url),
  ]) {
    const path = fileURLToPath(candidate);
    if (!existsSync(path)) continue;
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as BuildInfo;
      const commit = typeof parsed.commit === "string" ? parsed.commit : null;
      const dirty = typeof parsed.dirty === "boolean" ? parsed.dirty : null;
      return { commit, dirty };
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * The commit the running code identifies itself by — the one answer `version`
 * prints and `skills` stamps, so the two verbs cannot disagree about which
 * build an install came from. The BUILD's commit: a checkout hash pins nothing
 * during active development, which is the only time anyone asks.
 */
export function runningCommit(): string | null {
  return readBuildInfo()?.commit ?? null;
}

export interface VersionData {
  engine: string;
  commit: string | null;
  dirty: boolean | null;
  source: "build-info" | "unknown";
  checkout_commit: string | null;
  checkout_dirty: boolean | null;
}

/**
 * docs/cli.md §version: the shape, as a pure function of the two identities, so the
 * unbuilt case is testable without deleting the artifact the suite runs on.
 * `source` exists so the answer is never ambiguous about its own provenance.
 */
export function versionData(
  build: BuildInfo | undefined,
  checkout: Identity,
  engine: string,
): VersionData {
  return {
    engine,
    commit: build?.commit ?? null,
    dirty: build === undefined ? null : build.dirty,
    source: build === undefined ? "unknown" : "build-info",
    checkout_commit: checkout.commit,
    checkout_dirty: checkout.dirty,
  };
}
