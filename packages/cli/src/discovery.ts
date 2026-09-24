// docs/cli.md §bundles (a bundle skill is found by its name in the skill
// directories, never registered) · docs/concepts.md §A copy.
//
// Reads only, and little: with a name, one `stat` per probed directory and one
// marker read per directory that holds one; never a page, never a kit. A
// candidate is a directory `<dir>/<name>/` whose `config/export.json` is a
// marker naming that same name. Plugin caches are not scanned: a host names
// one through `WIKIWRIGHT_SKILL_DIRS`.
import { existsSync, lstatSync, readdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { codeUnitCompare } from "@wikiwright/core";
import { gitTopLevel } from "./git.ts";
import { type ExportMarker, MARKER_PATH, markerAt } from "./marker.ts";

/** Where a skill directory sits: the project, the user's own, or one the environment names. */
export type Tier = "project" | "user" | "extra";

export interface SkillDirectory {
  dir: string;
  tier: Tier;
}

/** A directory the scan found holding a marker that names it. */
export interface Candidate {
  name: string;
  /** The directory as found, `<dir>/<name>`. */
  root: string;
  realpath: string;
  tier: Tier;
  /** Whether the found path is itself a symbolic link. */
  linked: boolean;
  marker: ExportMarker;
}

/** A directory holding a marker the scan could not take, and why. */
export interface Skipped {
  name: string;
  root: string;
  tier: Tier;
  linked: boolean;
  reason: string;
}

/** The machine's own skill directory, read after the user's unless the environment names another. */
const SYSTEM_SKILL_DIR = "/etc/codex/skills";

/** The project's skill directories nearest first: `.claude/skills` then `.agents/skills` at each level. */
function projectDirectories(cwd: string): SkillDirectory[] {
  let top: string | undefined;
  try {
    top = gitTopLevel(cwd);
  } catch {
    // No git to ask: the walk goes to the filesystem root, as outside a repository.
    top = undefined;
  }
  const stop = top === undefined ? undefined : resolve(top);
  const out: SkillDirectory[] = [];
  let level = resolve(cwd);
  for (;;) {
    out.push({ dir: join(level, ".claude", "skills"), tier: "project" });
    out.push({ dir: join(level, ".agents", "skills"), tier: "project" });
    if (stop !== undefined && sameDirectory(level, stop)) break;
    const parent = dirname(level);
    if (parent === level) break;
    level = parent;
  }
  return out;
}

function sameDirectory(a: string, b: string): boolean {
  if (a === b) return true;
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return false;
  }
}

/**
 * docs/cli.md §bundles: every directory the scan reads, in the order a name is
 * resolved in — the project's from the working directory up to the top of its
 * repository (to the filesystem root outside one), then the user's and the
 * system's (`WIKIWRIGHT_SYSTEM_SKILL_DIR`, `/etc/codex/skills` unless set; an
 * empty value leaves it out), then each of `WIKIWRIGHT_SKILL_DIRS`,
 * colon-separated, in order.
 */
export function skillDirectories(cwd: string = process.cwd()): SkillDirectory[] {
  const home = homedir();
  const extra = (process.env["WIKIWRIGHT_SKILL_DIRS"] ?? "")
    .split(":")
    .filter((dir) => dir !== "")
    .map((dir) => ({ dir: resolve(dir), tier: "extra" as const }));
  const system = process.env["WIKIWRIGHT_SYSTEM_SKILL_DIR"] ?? SYSTEM_SKILL_DIR;
  return [
    ...projectDirectories(cwd),
    { dir: join(home, ".claude", "skills"), tier: "user" },
    { dir: join(home, ".agents", "skills"), tier: "user" },
    ...(system === "" ? [] : [{ dir: resolve(system), tier: "user" as const }]),
    ...extra,
  ];
}

function isLinkAt(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

/** The directory `<dir>/<name>` read as a candidate, a skipped directory, or nothing there. */
function inspect(
  directory: SkillDirectory,
  name: string,
): { candidate: Candidate } | { skipped: Skipped } | undefined {
  const root = join(directory.dir, name);
  if (!existsSync(join(root, MARKER_PATH))) return undefined;
  const linked = isLinkAt(root);
  const read = markerAt(root);
  if (read.kind === "none") return undefined;
  if (read.kind === "invalid") {
    return { skipped: { name, root, tier: directory.tier, linked, reason: read.reason } };
  }
  if (read.marker.name !== name) {
    return {
      skipped: {
        name,
        root,
        tier: directory.tier,
        linked,
        reason: `its marker names the export "${read.marker.name}", not the directory's name "${name}"`,
      },
    };
  }
  return {
    candidate: {
      name,
      root,
      realpath: realpathSync(root),
      tier: directory.tier,
      linked,
      marker: read.marker,
    },
  };
}

/** One name probed in every directory, in order: the candidates, one per real path, and the skipped. */
export function probe(
  name: string,
  directories: readonly SkillDirectory[] = skillDirectories(),
): { searched: string[]; candidates: Candidate[]; skipped: Skipped[] } {
  const candidates: Candidate[] = [];
  const skipped: Skipped[] = [];
  const seen = new Set<string>();
  for (const directory of directories) {
    const found = inspect(directory, name);
    if (found === undefined) continue;
    if ("skipped" in found) {
      skipped.push(found.skipped);
      continue;
    }
    // Two paths to one directory are one candidate: the nearer is kept.
    if (seen.has(found.candidate.realpath)) continue;
    seen.add(found.candidate.realpath);
    candidates.push(found.candidate);
  }
  return { searched: directories.map((d) => d.dir), candidates, skipped };
}

/**
 * Every directory under every skill directory that holds a marker, in scan
 * order — what `bundles list` prints and a failed name lists — reading one
 * directory listing per skill directory and one marker per candidate.
 */
export function scanAll(directories: readonly SkillDirectory[] = skillDirectories()): {
  candidates: Candidate[];
  skipped: Skipped[];
} {
  const candidates: Candidate[] = [];
  const skipped: Skipped[] = [];
  for (const directory of directories) {
    let names: string[];
    try {
      names = readdirSync(directory.dir, { encoding: "utf8" }).sort(codeUnitCompare);
    } catch {
      continue;
    }
    for (const name of names) {
      const found = inspect(directory, name);
      if (found === undefined) continue;
      if ("skipped" in found) skipped.push(found.skipped);
      else candidates.push(found.candidate);
    }
  }
  return { candidates, skipped };
}

/**
 * The identity two candidates are compared by: the marker's repository, bundle
 * and name. A copy that names no repository is itself alone: two local copies
 * under one name are one bundle only when they are one directory.
 */
export function identityOf(candidate: Candidate): string {
  const repository = candidate.marker.source.repository;
  return repository === null
    ? `\u0000${candidate.realpath}`
    : `${repository}\u0000${candidate.marker.bundle}\u0000${candidate.name}`;
}

export type Resolution =
  | { kind: "found"; chosen: Candidate; shadowed: Candidate[]; skipped: Skipped[] }
  | { kind: "none"; searched: string[]; names: string[]; skipped: Skipped[] }
  | { kind: "ambiguous"; candidates: Candidate[]; skipped: Skipped[] };

/**
 * docs/cli.md §bundles: a name resolved. None found; one identity among every
 * candidate, the nearest chosen and the rest shadowed; or more than one
 * identity, which no order settles.
 */
export function resolveBundle(
  name: string,
  directories: readonly SkillDirectory[] = skillDirectories(),
): Resolution {
  const { searched, candidates, skipped } = probe(name, directories);
  const [chosen, ...rest] = candidates;
  if (chosen === undefined) {
    const names = [...new Set(scanAll(directories).candidates.map((c) => c.name))].sort(
      codeUnitCompare,
    );
    return { kind: "none", searched, names, skipped };
  }
  const identity = identityOf(chosen);
  if (rest.some((candidate) => identityOf(candidate) !== identity)) {
    return { kind: "ambiguous", candidates, skipped };
  }
  return { kind: "found", chosen, shadowed: rest, skipped };
}
