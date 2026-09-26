// docs/cli.md §freshness (pins are measured against the local repository
// the vault sits in; a pin naming another origin is reported unmeasured;
// --fast-forward advances only the clean pins, through the Writer) ·
// docs/architecture.md §Directories.

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  buildNameIndex,
  graphOf,
  routeFindings,
  type VaultState,
  type WritePlan,
} from "@wikiwright/core";
import { replaceFile } from "../atomicwrite.ts";
import { type CommandResult, fail, ok } from "../envelope.ts";
import { computeFreshness, type FreshnessResult, freshnessReportJson } from "../freshness.ts";
import { GitAnswerRefused } from "../git.ts";
import { generateOptionsFor, lawFor, rootsOf, type VaultOk } from "../law.ts";
import { collectPages, sortFindings, summarize } from "../pages.ts";
import {
  type CommandArgs,
  type CommandSpec,
  isDryRun,
  type Plan,
  type PlanOp,
  planOf,
} from "../spec.ts";
import { fsState } from "../state.ts";
import { loadVault, readPage, walkPages } from "../vaultio.ts";
import { commitWrite, proveWrite, splicePlan, writeOps } from "../writer.ts";

const REPORT = "generated/freshness.json";

async function measure(vault: VaultOk, root: string): Promise<FreshnessResult> {
  const pages = collectPages(root, walkPages(root, rootsOf(vault)));
  const edges = graphOf(
    vault.registry,
    pages,
    buildNameIndex(pages),
    generateOptionsFor(vault),
  ).edges;
  return computeFreshness(root, pages, vault.registry, { edges });
}

/**
 * docs/cli.md §The dry-run law: one of the INVERTED verbs. The default is the
 * report and `--fast-forward` is what writes more: the plan names the pins
 * whose covering diff is empty, measured against the local repository as it
 * stands — the same measurement the run makes, since reading the history
 * writes nothing. A measurement that fails is thrown, and the dry run answers
 * it with the refusal the run gives: a plan that left the advances out would
 * read as a vault with none to make.
 */
async function planForFreshness(args: CommandArgs): Promise<Plan> {
  const ops: PlanOp[] = [{ kind: "write", path: REPORT, summary: "the freshness report" }];
  const vault = await loadVault("freshness", args.root);
  if (!vault.ok) return planOf(ops);
  if (args.flags["fast-forward"] !== true) return planOf(ops);
  const result = await measure(vault, args.root);
  // docs/architecture.md §How a verdict is produced: a pin advance is a page write, so it goes through the Writer.
  for (const candidate of result.eligible) {
    ops.push(
      ...writeOps(
        candidate.path,
        "write",
        `advance ${candidate.field} ${candidate.pin.slice(0, 12)} → ${candidate.head.slice(0, 12)} (its covering diff is empty)`,
      ),
    );
  }
  return planOf(ops);
}

/**
 * A measurement that failed, as the run and its dry run both answer it. Only a
 * genuine plumbing failure reaches here — a vault no repository encloses is a
 * finding on the pages that pin to ".", never a refusal. A cut or contradicted git
 * answer is refused as itself.
 */
function measurementRefused(e: unknown): CommandResult {
  if (e instanceof GitAnswerRefused) throw e;
  return fail("freshness", "conflict", "git-unavailable", `git plumbing failed: ${String(e)}`);
}

export const freshnessCommand: CommandSpec = {
  name: "freshness",
  role: "maintainer",
  summary:
    "Measure every pin against the local repository: how far behind its head, and is the capture stale; a pin naming another origin is reported unmeasured; --fast-forward advances the clean pins.",
  positionals: [],
  flags: [
    {
      name: "fast-forward",
      type: "boolean",
      summary:
        "rewrite each pin whose covering diff is empty to the repository's head, through the Writer",
    },
  ],
  examples: ["wikiwright freshness", "wikiwright freshness --fast-forward"],
  writes: true,
  needsVaultModules: true,
  plan: planForFreshness,
  run: async (args) => {
    const fastForward = args.flags["fast-forward"] === true;
    const vault = await loadVault("freshness", args.root);
    if (!vault.ok) return vault.result;
    // After the load, and before the first write — the advanced pins, then
    // the report.
    if (isDryRun(args)) {
      try {
        return ok("freshness", await planForFreshness(args));
      } catch (e) {
        return measurementRefused(e);
      }
    }
    let result: FreshnessResult;
    try {
      result = await measure(vault, args.root);
    } catch (e) {
      return measurementRefused(e);
    }
    const advanced: Array<{ path: string; field: string; from: string; to: string }> = [];
    const refused: Array<{ path: string; reason: string }> = [];
    if (fastForward && result.eligible.length > 0) {
      // docs/concepts.md §The judge and its states: the pin's line is rewritten by the one Writer, proved
      // against the same law every other write is, and landed temp-then-rename.
      const roots = rootsOf(vault);
      const law = lawFor(vault);
      const state: VaultState = fsState(args.root, roots);
      for (const candidate of result.eligible) {
        const before = readPage(args.root, candidate.path);
        const plan: WritePlan = {
          path: candidate.path,
          ops: [{ kind: "frontmatter-set", field: candidate.field, value: candidate.head }],
        };
        const spliced = splicePlan(before, plan);
        if (!spliced.ok) {
          refused.push({ path: candidate.path, reason: spliced.reason });
          continue;
        }
        const after = spliced.spliced.text;
        const proof = proveWrite({ state, law, path: candidate.path, after });
        if (!proof.ok) {
          refused.push({ path: candidate.path, reason: proof.message });
          continue;
        }
        commitWrite(args.root, candidate.path, after);
        state.pages.set(candidate.path, after);
        advanced.push({
          path: candidate.path,
          field: candidate.field,
          from: candidate.pin,
          to: candidate.head,
        });
      }
      // The report reflects the post-advance state: measured again.
      if (advanced.length > 0) result = await measure(vault, args.root);
    }
    mkdirSync(join(args.root, "generated"), { recursive: true });
    replaceFile(join(args.root, REPORT), freshnessReportJson(result));
    const pages = collectPages(args.root, walkPages(args.root, rootsOf(vault)));
    const findings = routeFindings(sortFindings([...result.findings]), lawFor(vault), pages);
    const summary = summarize(findings, pages.length);
    const data = {
      origins: result.origins,
      pins: result.pins,
      entries: result.entries,
      findings,
      summary: { ...summary, pins: result.entries.length, ...result.pins },
      advanced,
      refused,
      coverage: { passes: { freshness: result.coverage } },
    };
    if (summary.errors > 0) {
      return fail("freshness", "findings", "findings", `${summary.errors} error finding(s)`, {
        data,
      });
    }
    return ok("freshness", data);
  },
};
