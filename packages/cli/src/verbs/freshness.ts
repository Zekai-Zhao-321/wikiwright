// docs/cli.md §freshness (pins are measured against the origin
// the source page names, at a depth the flag chooses; --fast-forward advances
// only the clean pins, through the Writer) · docs/architecture.md §Directories.

import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  buildNameIndex,
  graphOf,
  routeFindings,
  type VaultState,
  type WritePlan,
} from "@wikiwright/core";
import { replaceFile } from "../atomicwrite.ts";
import { fail, ok } from "../envelope.ts";
import {
  CACHE_ROOT,
  cacheDirOf,
  computeFreshness,
  type FreshnessResult,
  freshnessReportJson,
  pinnedPages,
} from "../freshness.ts";
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
const CACHE_IGNORE = `${CACHE_ROOT}/.gitignore`;

/** The distinct external origins the vault's pins name, sorted. */
function externalOrigins(vault: VaultOk, root: string): string[] {
  const pages = collectPages(root, walkPages(root, rootsOf(vault)));
  const { pinned } = pinnedPages(vault.registry, pages);
  return [...new Set(pinned.map((p) => p.origin).filter((o) => o !== "."))].sort();
}

function measure(vault: VaultOk, root: string, fetch: boolean, network: boolean): FreshnessResult {
  const pages = collectPages(root, walkPages(root, rootsOf(vault)));
  const edges = graphOf(
    vault.registry,
    pages,
    buildNameIndex(pages),
    generateOptionsFor(vault),
  ).edges;
  return computeFreshness(root, pages, vault.registry, { fetch, network, edges });
}

/**
 * docs/cli.md §The dry-run law: one of the INVERTED verbs. The default is the
 * report and `--fetch` / `--fast-forward` are what write more. Under `--fetch`
 * the plan names the machine-local cache per origin and the file that makes
 * the directory ignore itself; under `--fast-forward` the pins whose covering
 * diff is empty — measured against the cache AS IT STANDS, because a plan
 * touches nothing and a fetch is a write. The run fetches first, so a pin the
 * cache is behind on may advance where the plan did not name it; the plan is
 * exact for the machine state it was read from.
 */
function planForFreshness(args: CommandArgs): Plan {
  const ops: PlanOp[] = [{ kind: "write", path: REPORT, summary: "the freshness report" }];
  const vault = loadVault("freshness", args.root);
  if (!vault.ok) return planOf(ops);
  const fetch = args.flags["fetch"] === true;
  const fastForward = args.flags["fast-forward"] === true;
  if (!fetch || (fastForward && !fetch)) return planOf(ops);
  const origins = externalOrigins(vault, args.root);
  if (origins.length > 0 && !existsSync(join(args.root, CACHE_IGNORE))) {
    ops.push({
      kind: "create",
      path: CACHE_IGNORE,
      summary: "the machine-local directory ignores itself",
    });
  }
  for (const origin of origins) {
    const dir = cacheDirOf(origin);
    ops.push({
      kind: existsSync(join(args.root, dir, "HEAD")) ? "write" : "create",
      path: dir,
      summary: `the blobless bare cache of ${origin}`,
    });
  }
  if (!fastForward) return planOf(ops);
  let result: FreshnessResult;
  try {
    result = measure(vault, args.root, true, false);
  } catch {
    return planOf(ops);
  }
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

export const freshnessCommand: CommandSpec = {
  name: "freshness",
  role: "maintainer",
  summary:
    "Measure every pin against the origin its page names: is it still the head (default), or how far behind and is the capture stale (--fetch); --fast-forward advances the clean pins.",
  positionals: [],
  flags: [
    {
      name: "fetch",
      type: "boolean",
      summary:
        "keep a blobless bare cache per origin under .wikiwright/origins/ and measure pin distance and the covering diff against it",
    },
    {
      name: "fast-forward",
      type: "boolean",
      summary:
        "with --fetch: rewrite each pin whose covering diff is empty to the origin's head, through the Writer",
    },
  ],
  examples: [
    "wikiwright freshness",
    "wikiwright freshness --fetch",
    "wikiwright freshness --fetch --fast-forward",
  ],
  writes: true,
  needsVaultModules: true,
  plan: planForFreshness,
  run: (args) => {
    const fetch = args.flags["fetch"] === true;
    const fastForward = args.flags["fast-forward"] === true;
    if (fastForward && !fetch) {
      return fail(
        "freshness",
        "usage",
        "fast-forward-needs-fetch",
        "--fast-forward advances a pin only on an empty covering diff, which needs the origin's objects",
        { hint: "pass --fetch with --fast-forward" },
      );
    }
    const vault = loadVault("freshness", args.root);
    if (!vault.ok) return vault.result;
    // After the load and the usage refusal, and before the first write — the
    // cache, the advanced pins, then the report.
    if (isDryRun(args)) return ok("freshness", planForFreshness(args));
    if (fetch && externalOrigins(vault, args.root).length > 0) {
      // The cache lives in a directory that ignores itself: machine-local,
      // never committed, deletable by hand — the same standing as `.git`.
      mkdirSync(join(args.root, CACHE_ROOT, "origins"), { recursive: true });
      if (!existsSync(join(args.root, CACHE_IGNORE))) {
        replaceFile(join(args.root, CACHE_IGNORE), "*\n");
      }
    }
    let result: FreshnessResult;
    try {
      result = measure(vault, args.root, fetch, true);
    } catch (e) {
      // Only a genuine plumbing failure reaches here — an origin that did not
      // answer is a finding on the pages that name it, never a refusal.
      return fail("freshness", "conflict", "git-unavailable", `git plumbing failed: ${String(e)}`);
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
      // The report reflects the post-advance state, against the cache the run
      // just brought current: no second round trip.
      if (advanced.length > 0) result = measure(vault, args.root, true, false);
    }
    mkdirSync(join(args.root, "generated"), { recursive: true });
    replaceFile(join(args.root, REPORT), freshnessReportJson(result));
    const pages = collectPages(args.root, walkPages(args.root, rootsOf(vault)));
    const findings = routeFindings(sortFindings([...result.findings]), lawFor(vault), pages);
    const summary = summarize(findings, pages.length);
    const data = {
      depth: result.depth,
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
