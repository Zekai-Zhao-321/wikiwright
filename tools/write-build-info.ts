// docs/cli.md §version (`version.commit` must name the BUILD, not the
// checkout the binary happens to sit in) · docs/architecture.md §Directories (build artifacts carry
// no timestamp: an artifact that changes when nothing changed is not
// reproducible).
//
// Run by the `build` script AFTER `tsc -b`: the compiler owns `dist/`, so the
// stamp lands once the directory exists, and `tsc` never removes a file it did
// not emit. Zero dependencies — git is spawned, as everywhere else.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = fileURLToPath(new URL("../packages/cli/dist/build-info.json", import.meta.url));
const REPO = fileURLToPath(new URL("..", import.meta.url));

function git(args: string[]): string | null {
  try {
    return execFileSync("git", ["-C", REPO, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

/**
 * The same two questions the `version` verb used to ask at call time, asked once
 * at build time instead. Unanswerable is `null`, never a throw and never a
 * guess: a build made outside a git checkout is a legitimate build, and a stamp
 * that invented a hash for it would be worse than no stamp.
 */
const head = git(["rev-parse", "--short", "HEAD"]);
const status = head === null ? null : git(["status", "--porcelain", "--untracked-files=no"]);
/**
 * The emitted code itself: sha256 over every file under `packages/<name>/dist`
 * but this stamp, by path. A commit and a dirty bit do not say which bytes a
 * dirty build emitted; this does, and the parse store keys on it, so a
 * rebuild with different code never answers from reads the old code made.
 */
function codeDigest(): string {
  const lines: string[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(join(dir, entry.name), path);
      else if (entry.isFile() && !path.startsWith("cli/dist/build-info.json"))
        lines.push(
          `${path}\0${createHash("sha256")
            .update(readFileSync(join(dir, entry.name)))
            .digest("hex")}\n`,
        );
    }
  };
  let packages: string[] = [];
  try {
    packages = readdirSync(join(REPO, "packages"));
  } catch {
    // A tree with no packages emitted no code; its digest is the empty listing's.
  }
  for (const name of packages) {
    try {
      walk(join(REPO, "packages", name, "dist"), `${name}/dist`);
    } catch {
      // A package with nothing emitted adds nothing.
    }
  }
  lines.sort();
  return createHash("sha256").update(lines.join("")).digest("hex");
}

const info = {
  commit: head === null ? null : head.trim(),
  dirty: status === null ? null : status.trim().length > 0,
  code: codeDigest(),
};

// Written through a rename: a reader of this file is a running `version` verb,
// and a half-written stamp would answer `source: "unknown"` for the microsecond
// the write takes — a build must never make the binary lie about itself.
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(`${OUT}.tmp`, `${JSON.stringify(info, null, 2)}\n`);
renameSync(`${OUT}.tmp`, OUT);
