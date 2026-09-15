// docs/cli.md §skills (the install stamp, `skills update | status`, the
// refusal on a file the engine cannot prove it wrote) (skills are
// versioned with the engine) · docs/concepts.md (the install and the binary
// are machine-local state, so warning is this pass's ceiling).
//
// `init` COPIES the shipped skills into a vault. Nothing refreshed that copy, so
// a bundle authored pages against a manual that never
// mentioned the grammars its own `check` was reporting. The stamp is what makes
// the copy auditable: without it the engine can see that a file differs from
// what it ships today, but not whether it wrote the version on disk.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { codeUnitCompare, type Finding } from "@wikiwright/core";
import { replaceFile } from "./atomicwrite.ts";
import { runningCommit } from "./buildinfo.ts";
import { ENGINE_VERSION } from "./envelope.ts";
import { sha256Of } from "./trust.ts";

/** The stamp's basename, inside each installed skill directory (docs/cli.md §skills). */
export const STAMP_BASENAME = ".wikiwright-stamp.json";

/** Vault-relative, POSIX-separated: the one spelling findings and reports use. */
export const SKILLS_ROOT = ".claude/skills";

export interface StampedFile {
  path: string;
  sha256: string;
}

export interface SkillStamp {
  engine: string;
  commit: string | null;
  files: StampedFile[];
}

export type FileState = "current" | "stale" | "modified" | "missing" | "unstamped";

export interface FileRow {
  path: string;
  state: FileState;
  installed: string | null;
  shipped: string | null;
  stamped: string | null;
}

export interface SkillReport {
  skill: string;
  installed: boolean;
  stamp: SkillStamp | undefined;
  files: FileRow[];
  /** Stamped files the engine no longer ships: never rewritten, never deleted. */
  orphaned: string[];
}

function shippedRoot(): string {
  return fileURLToPath(new URL("../skills/", import.meta.url));
}

/** The skills this binary ships, by directory name (code-unit sorted). */
export function shippedSkillNames(): string[] {
  const root = shippedRoot();
  if (!existsSync(root)) return [];
  return readdirSync(root, { encoding: "utf8" })
    .filter((entry) => statSync(join(root, entry)).isDirectory())
    .sort(codeUnitCompare);
}

/** Every file of one shipped skill, relative and POSIX-separated. */
function shippedFilesOf(skill: string): string[] {
  const base = join(shippedRoot(), skill);
  return readdirSync(base, { recursive: true, encoding: "utf8" })
    .map((entry) => entry.replaceAll("\\", "/"))
    .filter((rel) => statSync(join(base, rel)).isFile())
    .sort(codeUnitCompare);
}

function installedDir(root: string, skill: string): string {
  return join(root, ".claude", "skills", skill);
}

/**
 * docs/cli.md §skills: "is this vault using skills" is a property of the VAULT,
 * decided once here — not per skill directory. Per-directory scope made the two
 * largest drifts invisible: a wholly deleted skill was reported clean and could
 * not be restored (deleting one file inside it was both), and a skill a newer
 * build ships could never reach a vault an older build installed, which is the
 * forward-compatibility case `skills update` exists for.
 */
export function skillsRootInstalled(root: string): boolean {
  return existsSync(join(root, ".claude", "skills"));
}

function stampPath(root: string, skill: string): string {
  return join(installedDir(root, skill), STAMP_BASENAME);
}

function shaOfFile(path: string): string | null {
  if (!existsSync(path)) return null;
  return sha256Of(readFileSync(path));
}

/**
 * A stamp that does not parse is a stamp the engine cannot read, which is the
 * same epistemic state as none: it reports `skills-missing` and refuses to
 * overwrite bytes it cannot account for, rather than guessing.
 */
function readStamp(root: string, skill: string): SkillStamp | undefined {
  const path = stampPath(root, skill);
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as SkillStamp;
    if (typeof parsed.engine !== "string" || !Array.isArray(parsed.files)) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

/** The full comparison `status`, `update` and `check` all read (docs/cli.md §skills). */
export function inspectSkills(root: string): SkillReport[] {
  const reports: SkillReport[] = [];
  for (const skill of shippedSkillNames()) {
    const dir = installedDir(root, skill);
    const stamp = readStamp(root, skill);
    const stampedShas = new Map((stamp?.files ?? []).map((f) => [f.path, f.sha256] as const));
    const shipped = shippedFilesOf(skill);
    const files: FileRow[] = shipped.map((rel) => {
      const installed = shaOfFile(join(dir, rel));
      const shippedSha = sha256Of(readFileSync(join(shippedRoot(), skill, rel)));
      const stamped = stampedShas.get(rel) ?? null;
      const state: FileState =
        installed === null
          ? "missing"
          : stamp === undefined
            ? "unstamped"
            : installed === shippedSha
              ? "current"
              : installed === stamped
                ? "stale"
                : "modified";
      return { path: rel, state, installed, shipped: shippedSha, stamped };
    });
    const shippedSet = new Set(shipped);
    const orphaned = [...stampedShas.keys()]
      .filter((p) => !shippedSet.has(p))
      .sort(codeUnitCompare);
    reports.push({ skill, installed: existsSync(dir), stamp, files, orphaned });
  }
  return reports;
}

/**
 * The stamp's bytes for one shipped skill: what `init` and `skills update`
 * write, and what `init` compares an installed stamp against before it plans
 * to rewrite it (docs/cli.md §The dry-run law: a rewrite of identical bytes is no write).
 */
export function stampText(skill: string): string {
  return stampBody(skill, shippedFilesOf(skill));
}

function stampBody(skill: string, files: readonly string[]): string {
  const stamp: SkillStamp = {
    engine: ENGINE_VERSION,
    commit: runningCommit(),
    files: [...files].sort(codeUnitCompare).map((rel) => ({
      path: rel,
      sha256: sha256Of(readFileSync(join(shippedRoot(), skill, rel))),
    })),
  };
  return `${JSON.stringify(stamp, null, 2)}\n`;
}

/**
 * docs/cli.md §The dry-run law: every file `init` lands under
 * `.claude/skills/`, vault-relative and POSIX-separated — the shipped files and
 * the stamp written beside them. Read off the same two functions the copy and
 * the stamp read, so a plan can never name a path the write functions do not produce:
 * the plan used to say `.wikiwright-stamp` while this module's own
 * `STAMP_BASENAME` is `.wikiwright-stamp.json`, a file that never exists.
 */
export function shippedSkillPaths(): string[] {
  const paths: string[] = [];
  for (const skill of shippedSkillNames()) {
    for (const rel of shippedFilesOf(skill)) paths.push(`${SKILLS_ROOT}/${skill}/${rel}`);
    paths.push(`${SKILLS_ROOT}/${skill}/${STAMP_BASENAME}`);
  }
  return paths;
}

/** Write one skill's stamp; `init` and `skills update` share this one writer. */
export function writeStamp(root: string, skill: string): string {
  const dir = installedDir(root, skill);
  mkdirSync(dir, { recursive: true });
  replaceFile(stampPath(root, skill), stampBody(skill, shippedFilesOf(skill)));
  return `${SKILLS_ROOT}/${skill}/${STAMP_BASENAME}`;
}

export function stampAll(root: string): string[] {
  return shippedSkillNames().map((skill) => writeStamp(root, skill));
}

export interface Blocked {
  path: string;
  reason: "modified" | "unstamped";
}

export interface UpdateOutcome {
  ok: boolean;
  blocked: Blocked[];
  updated: string[];
  unchanged: string[];
  stamped: string[];
  orphaned: string[];
}

/**
 * Reinstall the shipped files and rewrite the stamps. Two laws (docs/cli.md §skills):
 * only files the engine installed are ever written, and a file whose bytes the
 * engine cannot account for — edited since the stamp, or installed before
 * stamps existed — is refused unless `--force`. The refusal is atomic across
 * every skill: init's own lesson, that a verb must not half-apply before it
 * discovers a conflict.
 *
 * Scope is the skills ROOT: with it present every shipped skill is
 * installed and stamped, absent one included; without it the verb writes nothing
 * and never creates a root the vault did not have.
 */
export interface SkillsUpdatePlan {
  blocked: Blocked[];
  orphaned: string[];
  /** The files whose installed bytes differ from the shipped ones. */
  writes: Array<{ skill: string; file: FileRow }>;
  unchanged: string[];
  /** The skills this run stamps, and the vault-relative stamp path of each. */
  stamps: Array<{ skill: string; path: string }>;
}

/**
 * What `updateSkills` would do, with no write in it (docs/cli.md §The dry-run law).
 *
 * This exists because the plan and the writer disagreed. The verb's
 * plan called `inspectSkills` unconditionally while the writer gated on
 * `skillsRootInstalled` first, so in a vault with no `.claude/skills/` the dry
 * run promised eight writes the run then did not make. One function answers
 * both now — the gate included.
 */
export function planSkillsUpdate(root: string, options: { force: boolean }): SkillsUpdatePlan {
  const reports = skillsRootInstalled(root) ? inspectSkills(root) : [];
  const blocked: Blocked[] = [];
  if (!options.force) {
    for (const report of reports) {
      for (const file of report.files) {
        if (file.state === "modified") {
          blocked.push({ path: `${report.skill}/${file.path}`, reason: "modified" });
        } else if (file.state === "unstamped" && file.installed !== file.shipped) {
          blocked.push({ path: `${report.skill}/${file.path}`, reason: "unstamped" });
        }
      }
    }
  }
  const orphaned = reports.flatMap((r) => r.orphaned.map((p) => `${r.skill}/${p}`));
  const writes: Array<{ skill: string; file: FileRow }> = [];
  const unchanged: string[] = [];
  const stamps: Array<{ skill: string; path: string }> = [];
  if (blocked.length === 0) {
    for (const report of reports) {
      for (const file of report.files) {
        if (file.installed === file.shipped) unchanged.push(`${report.skill}/${file.path}`);
        else writes.push({ skill: report.skill, file });
      }
      stamps.push({
        skill: report.skill,
        path: `${SKILLS_ROOT}/${report.skill}/${STAMP_BASENAME}`,
      });
    }
  }
  return { blocked, orphaned, writes, unchanged, stamps };
}

export function updateSkills(root: string, options: { force: boolean }): UpdateOutcome {
  const plan = planSkillsUpdate(root, options);
  if (plan.blocked.length > 0) {
    return {
      ok: false,
      blocked: plan.blocked,
      updated: [],
      unchanged: [],
      stamped: [],
      orphaned: plan.orphaned,
    };
  }
  const updated: string[] = [];
  for (const { skill, file } of plan.writes) {
    const target = join(installedDir(root, skill), file.path);
    mkdirSync(dirname(target), { recursive: true });
    replaceFile(target, readFileSync(join(shippedRoot(), skill, file.path)));
    updated.push(`${skill}/${file.path}`);
  }
  const stamped = plan.stamps.map((stamp) => writeStamp(root, stamp.skill));
  return {
    ok: true,
    blocked: [],
    updated,
    unchanged: plan.unchanged,
    stamped,
    orphaned: plan.orphaned,
  };
}

/**
 * docs/cli.md §skills: an unknown build cannot be SHOWN to differ, so two unknown
 * commits — or one — never make a difference. The per-file shas are the
 * comparison that always holds, and they are recomputed every run rather than
 * remembered, so the gate cannot go quiet because a number was not bumped.
 */
function engineMoved(stamp: SkillStamp): boolean {
  if (stamp.engine !== ENGINE_VERSION) return true;
  const running = runningCommit();
  if (stamp.commit === null || running === null) return false;
  return stamp.commit !== running;
}

/** The `check` arms (docs/cli.md §skills): machine-local state, so warning is the ceiling. */
export function skillFindings(root: string): Finding[] {
  const findings: Finding[] = [];
  if (!skillsRootInstalled(root)) return findings;
  for (const report of inspectSkills(root)) {
    const path = `${SKILLS_ROOT}/${report.skill}`;
    // An absent skill has no stamp either, and is drift rather than the
    // pre-stamp case: this arm is about an install the engine cannot account
    // for, not about an install that is not there (docs/cli.md §skills).
    if (report.installed && report.stamp === undefined) {
      findings.push({
        ruleId: "skills-missing",
        severity: "info",
        path,
        message:
          "the installed skill carries no engine stamp, so the engine cannot say which build wrote it",
        remediation:
          "run `wikiwright skills update` to record it (a pre-stamp install whose files already differ needs --force)",
        contributedBy: "engine",
        layer: "constitution",
      });
      continue;
    }
    const behind = report.files.filter((f) => f.state === "stale" || f.state === "missing");
    const edited = report.files.filter((f) => f.state === "modified");
    const moved = report.stamp !== undefined && engineMoved(report.stamp);
    if (behind.length === 0 && edited.length === 0 && !moved) continue;
    const stampedAs =
      report.stamp === undefined
        ? "unstamped"
        : `${report.stamp.engine}/${report.stamp.commit ?? "unknown"}`;
    const running = `${ENGINE_VERSION}/${runningCommit() ?? "unknown"}`;
    const details = {
      files_behind: behind.length,
      files_modified: edited.length,
      engine_moved: moved,
    };
    // The stamp's metadata is old and every installed file's sha is the
    // shipped sha. Nothing about the install differs — only the note saying
    // which build wrote it — and `commit` moves with every engine build, so a
    // warning here would fire in every vault after every engine commit and its
    // standing answer would be "dismiss it". The severity column of the pass
    // table is this pass's ceiling, not its only value (docs/concepts.md §Findings and routing).
    if (behind.length === 0 && edited.length === 0) {
      findings.push({
        ruleId: "skills-stale",
        severity: "info",
        path,
        message: `the engine has moved on; the installed files are current (stamped ${stampedAs}, running ${running})`,
        remediation: "run `wikiwright skills update` to refresh the stamp",
        contributedBy: "engine",
        layer: "constitution",
        details,
      });
      continue;
    }
    const parts: string[] = [];
    if (behind.length > 0) {
      parts.push(
        `${behind.length} file(s) behind the engine (${behind.map((f) => f.path).join(", ")})`,
      );
    }
    if (edited.length > 0) {
      parts.push(
        `${edited.length} file(s) edited locally (${edited.map((f) => f.path).join(", ")})`,
      );
    }
    if (moved) parts.push(`stamped ${stampedAs}, running ${running}`);
    findings.push({
      ruleId: "skills-stale",
      severity: "warning",
      path,
      message: `the installed skill has drifted from the engine: ${parts.join("; ")}`,
      remediation:
        "run `wikiwright skills update` (add --force to discard a local edit of a shipped file)",
      contributedBy: "engine",
      layer: "constitution",
      details,
    });
  }
  return findings;
}
