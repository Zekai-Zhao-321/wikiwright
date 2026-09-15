// docs/cli.md §check (the aggregate pass: registry + lint + generated-drift, with a
// named coverage row for every pass that did not run) · docs/concepts.md §Findings and routing
// docs/architecture.md §Directories.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildNameIndex,
  type Finding,
  generateArtifacts,
  judge,
  parsedPages,
} from "@wikiwright/core";
import { artifactOps, briefPlan, writeArtifacts } from "../artifacts.ts";
import { BRIEF_PATH } from "../brief.ts";
import { capOptions, fail, ok, verdictEnvelope } from "../envelope.ts";
import { installedHooks } from "../hooks.ts";
import { generateOptionsFor, lawFor, rootsOf } from "../law.ts";
import { templateFindings } from "../pages.ts";
import { skillFindings } from "../skills.ts";
import { type CommandArgs, type CommandSpec, isDryRun, type Plan, planOf } from "../spec.ts";
import { fsState } from "../state.ts";
import { loadVault } from "../vaultio.ts";
import { briefFindings } from "./brief.ts";

/**
 * docs/cli.md §The dry-run law: the first of the three INVERTED verbs. `check`
 * already defaults to reporting and writes only under `--write`; the plan is
 * what `--write` would land — the same artifact set the drift comparison is
 * made against.
 *
 * And it is what THIS invocation would land. The plan used to report
 * the `--write` ops with no `--write` in the argv — disclosed as a quirk, and
 * wrong: a plan is what an agent reads to decide whether to run this command,
 * so the answer for an invocation that writes nothing is an empty plan.
 */
function planForCheck(args: CommandArgs): Plan {
  if (args.flags["write"] !== true) return planOf([]);
  const vault = loadVault("check", args.root);
  if (!vault.ok) return planOf([]);
  return planOf(artifactOps(args.root, vault));
}

export const checkCommand: CommandSpec = {
  name: "check",
  role: "writer",
  summary: "The aggregate pass: registry + lint + generated-drift comparison.",
  positionals: [],
  flags: [
    { name: "write", type: "boolean", summary: "refresh derived artifacts before comparing" },
    { name: "limit", type: "string", summary: "cap the findings array (default 50)" },
    { name: "rule", type: "string", summary: "only findings with this rule id" },
    { name: "path", type: "string", summary: "only findings on this page" },
    { name: "all", type: "boolean", summary: "lift the findings cap" },
  ],
  examples: ["wikiwright check --root .", "wikiwright check --write"],
  writes: true,
  needsVaultModules: true,
  plan: planForCheck,
  run: async (args) => {
    const vault = loadVault("check", args.root);
    if (!vault.ok) return vault.result;
    // The load is the only refusal `check` reaches before `--write`'s first
    // write, so the plan is answered here.
    if (isDryRun(args)) return ok("check", planForCheck(args));
    // Read one snapshot and parse it once: the artifacts, the brief and the
    // judge below all take this state's pages (`parsedPages` keeps the parse
    // on the state, so the judge reads it back rather than parsing again).
    // The state retains the original bytes, including BOM/CRLF.
    const state = fsState(args.root, rootsOf(vault));
    const pages = parsedPages(state);
    const names = buildNameIndex(pages);
    const shellFindings: Finding[] = [...templateFindings(args.root, vault)];
    const plans = generateArtifacts(vault.registry, pages, names, generateOptionsFor(vault));
    const brief = briefPlan(vault, pages, args.commands);
    // The brief lands with the artifacts, through the one write loop;
    // its drift is `brief-stale` below, the artifacts' is `generated-drift`.
    if (args.flags["write"] === true) {
      writeArtifacts(args.root, [...plans, brief]);
    }
    for (const plan of plans) {
      const abs = join(args.root, plan.path);
      const disk = existsSync(abs) ? readFileSync(abs, "utf8") : undefined;
      if (disk !== plan.content) {
        shellFindings.push({
          ruleId: "generated-drift",
          severity: "error",
          path: plan.path,
          message:
            disk === undefined
              ? "generated artifact is missing"
              : "generated artifact differs from a fresh rebuild",
          remediation: "run `wikiwright check --write`",
          contributedBy: "engine",
          layer: "constitution",
        });
      }
    }
    // docs/cli.md §skills: the installed skills against what this binary
    // ships. Machine-local state, so warning is the ceiling — a `check` that
    // went red because a machine is behind would flake on every machine but
    // the author's.
    shellFindings.push(...skillFindings(args.root));
    // docs/cli.md §brief: the brief is generated per install, so a
    // brief that is absent or cut from another law is machine-local state — info
    // by the run-external severity law, with the verb that refreshes it.
    shellFindings.push(...briefFindings(args.root, brief.content));
    // A marker hook another build wrote runs that build's contract — the
    // one that echoed the whole envelope after the summary — until it is
    // reinstalled. Machine-local state, so warning is the ceiling, and the
    // route is the reinstall, chain kept.
    for (const hook of installedHooks(args.root, {
      commitPrefixes: vault.engine.commit_prefixes !== undefined,
    })) {
      if (hook.current) continue;
      shellFindings.push({
        ruleId: "hook-stale",
        severity: "warning",
        path: hook.path,
        message: `the installed ${hook.name} hook is not the one this engine writes`,
        remediation: `run \`wikiwright hook install${hook.chain === undefined ? "" : ` --chain ${hook.chain}`}\``,
        contributedBy: "engine",
        layer: "constitution",
        ...(hook.chain === undefined ? {} : { details: { chain: hook.chain } }),
      });
    }
    // docs/concepts.md §Findings and routing: the shell passes this run performed, named so the
    // judge can tell "did not run here" from "found nothing" for each.
    // docs/constitution.md §Shapes: `check` contacts no origin. The pin's snapshot-internal
    // half (`malformed-pin`) is judged below like every shape; the run-external
    // rows read `not_applicable`, reason `external-origin`, on every page —
    // present and honest whether or not the vault is a repository — and
    // `wikiwright freshness` is the verb that measures them.
    const shellPasses = [
      "template-orphan",
      "template-placeholder-unknown",
      "template-field-unknown",
      "generated-drift",
      "brief-stale",
      "skills-stale",
      "skills-missing",
      "hook-stale",
    ];
    // docs/concepts.md §Findings and routing: one judge, one envelope. `check` runs the passes whose
    // input is the artifact tree and the machine, names them, and hands them to
    // the judge with everything else — the block is the judge's, built once.
    const verdict = judge(state, lawFor(vault), {
      ...capOptions(args),
      names,
      shellFindings,
      shellPasses,
    });
    const data = {
      ...verdictEnvelope(verdict),
      generated: { files: [...plans.map((p) => p.path), BRIEF_PATH] },
    };
    if (verdict.summary.errors > 0) {
      return fail("check", "findings", "findings", `${verdict.summary.errors} error finding(s)`, {
        data,
      });
    }
    return ok("check", data);
  },
};
