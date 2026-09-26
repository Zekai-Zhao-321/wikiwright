// docs/cli.md §version (the verb never throws — an unanswerable question
// is null, not an error; the primary answer names the BUILD, read
// from the artifact the build script stamped, and the call-time git lookup is
// demoted to `checkout_commit`). The identity of the running code lives here, in
// one module so `version` names the build rather than guessing at a checkout.
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

/** The stamp compiled into a binary by `bun build --define`; undeclared everywhere else. */
declare const WIKIWRIGHT_BUILD_INFO: string | undefined;

function parseBuildInfo(text: string): BuildInfo | undefined {
  try {
    const parsed = JSON.parse(text) as BuildInfo;
    const commit = typeof parsed.commit === "string" ? parsed.commit : null;
    const dirty = typeof parsed.dirty === "boolean" ? parsed.dirty : null;
    return { commit, dirty };
  } catch {
    return undefined;
  }
}

/**
 * The stamp `tools/write-build-info.ts` wrote beside the emitted JavaScript.
 * Looked for next to this module (the compiled `dist/` case) and then in the
 * package's `dist/` (running from `src/`, as the tests do), so "which code is
 * this" has one answer in both. A compiled binary (`bun run binary`) has no
 * file beside it: the same stamp is compiled in as `WIKIWRIGHT_BUILD_INFO`,
 * which `bun build --define` replaces with the stamp's JSON text, and which is
 * read first. `undefined` means no build info shipped with this binary —
 * reported as `source: "unknown"`, never guessed at.
 */
export function readBuildInfo(): BuildInfo | undefined {
  if (typeof WIKIWRIGHT_BUILD_INFO === "string") return parseBuildInfo(WIKIWRIGHT_BUILD_INFO);
  for (const candidate of [
    new URL("./build-info.json", import.meta.url),
    new URL("../dist/build-info.json", import.meta.url),
  ]) {
    const path = fileURLToPath(candidate);
    if (!existsSync(path)) continue;
    return parseBuildInfo(readFileSync(path, "utf8"));
  }
  return undefined;
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
