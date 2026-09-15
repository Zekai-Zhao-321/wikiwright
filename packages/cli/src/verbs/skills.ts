// docs/cli.md §skills (the installed skills are a COPY — this verb is
// what refreshes it and what reports the drift) · docs/architecture.md §Directories.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { writeBrief } from "../artifacts.ts";
import { BRIEF_PATH } from "../brief.ts";
import { runningCommit } from "../buildinfo.ts";
import { type CommandResult, ENGINE_VERSION, fail, ok } from "../envelope.ts";
import { inspectSkills, planSkillsUpdate, SKILLS_ROOT, updateSkills } from "../skills.ts";
import {
  type CommandArgs,
  type CommandSpec,
  isDryRun,
  type Plan,
  type PlanOp,
  planOf,
} from "../spec.ts";

/**
 * docs/cli.md §The dry-run law: the files `skills update` would rewrite, read off the
 * same computation the writer runs (`planSkillsUpdate`) rather than a second
 * one — a file whose installed bytes already equal the shipped ones is
 * untouched, and the plan says so by leaving it out.
 *
 * The plan used to read the same COMPARISON but not the same GATE.
 * `updateSkills` writes nothing when the vault has no `.claude/skills/`
 *; the plan called `inspectSkills` unconditionally and promised eight
 * writes in a vault where the verb makes none. It also named the stamp
 * `.wikiwright-stamp`, where this module exports `.wikiwright-stamp.json` — a
 * path that never exists on disk. Both are now one function's answer.
 */
function planForSkills(args: CommandArgs): Plan {
  const [sub] = args.positionals;
  if (sub !== "update") return planOf([]);
  const plan = planSkillsUpdate(args.root, { force: args.flags["force"] === true });
  const ops: PlanOp[] = plan.writes.map(({ skill, file }) => ({
    kind: file.installed === null ? ("create" as const) : ("write" as const),
    path: `${SKILLS_ROOT}/${skill}/${file.path}`,
    summary: `install the shipped bytes (currently ${file.state})`,
  }));
  for (const stamp of plan.stamps) {
    ops.push({
      kind: "write",
      path: stamp.path,
      summary: "restamp the install with this engine and commit",
    });
  }
  // docs/cli.md §brief: the stamp covers the generated brief, so a
  // refresh of the skills refreshes the file that carries the verbs — the two
  // halves of the manual are updated by one command or they drift.
  if (existsSync(join(args.root, "config"))) {
    ops.push({
      kind: existsSync(join(args.root, BRIEF_PATH)) ? "write" : "create",
      path: BRIEF_PATH,
      summary: "re-render the writer's brief from this engine's registry",
    });
  }
  return planOf(ops);
}

/** The one refusal both the run and its dry run answer with (docs/cli.md §skills). */
function skillModified(blocked: ReturnType<typeof planSkillsUpdate>["blocked"]): CommandResult {
  return fail(
    "skills",
    "conflict",
    "skill-modified",
    `${blocked.length} installed file(s) differ from what the engine recorded writing`,
    {
      details: { blocked },
      hint: "review the diff and keep the edit, or rerun with --force to restore the shipped bytes",
    },
  );
}

/**
 * docs/cli.md §skills: the installed skills are a COPY, and before this
 * verb nothing refreshed it — a bundle could run a whole slice against a manual
 * that predated the findings its own `check` was printing.
 */
export const skillsCommand: CommandSpec = {
  name: "skills",
  role: "maintainer",
  summary: "Reinstall the shipped skills into .claude/skills/, or compare installed vs shipped.",
  positionals: [{ name: "subcommand", required: true }],
  subcommands: ["status", "update"],
  flags: [
    {
      name: "force",
      type: "boolean",
      summary: "overwrite a file whose bytes the engine cannot account for",
    },
  ],
  examples: ["wikiwright skills status", "wikiwright skills update"],
  writes: true,
  needsVaultModules: true,
  plan: planForSkills,
  run: (args) => {
    const [sub] = args.positionals;
    if (sub === "status" && isDryRun(args)) return ok("skills", planForSkills(args));
    if (sub === "status") {
      return ok("skills", {
        engine: ENGINE_VERSION,
        commit: runningCommit(),
        skills: inspectSkills(args.root).map((report) => ({
          skill: report.skill,
          installed: report.installed,
          stamp:
            report.stamp === undefined
              ? null
              : { engine: report.stamp.engine, commit: report.stamp.commit },
          files: report.files,
          orphaned: report.orphaned,
        })),
      });
    }
    // After the subcommand vocabulary AND the refusal, before the write: a dry
    // run answers for an invocation the verb would otherwise accept, never for
    // a typo and never for one it would refuse.
    const options = { force: args.flags["force"] === true };
    if (isDryRun(args)) {
      const blocked = planSkillsUpdate(args.root, options).blocked;
      if (blocked.length > 0) return skillModified(blocked);
      return ok("skills", planForSkills(args));
    }
    const outcome = updateSkills(args.root, options);
    if (!outcome.ok) return skillModified(outcome.blocked);
    const brief = writeBrief(args.root, args.commands);
    return ok("skills", {
      engine: ENGINE_VERSION,
      commit: runningCommit(),
      updated: outcome.updated,
      unchanged: outcome.unchanged,
      stamped: outcome.stamped,
      orphaned: outcome.orphaned,
      brief: brief ?? null,
    });
  },
};
