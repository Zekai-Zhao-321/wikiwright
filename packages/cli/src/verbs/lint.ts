// docs/cli.md §lint (--page, --staged, --stdin, --since, --explain; error findings
// exit 5) · docs/concepts.md §Findings and routing · docs/architecture.md §How a verdict is produced · docs/architecture.md §Directories.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  codeUnitCompare,
  type Finding,
  type JudgeOptions,
  judge,
  parseDoc,
  type VaultState,
} from "@wikiwright/core";
import { type CommandResult, capOptions, fail, ok, verdictEnvelope } from "../envelope.ts";
import { lawFor, rootsOf, type VaultOk } from "../law.ts";
import { sectionLines, templateFindings } from "../pages.ts";
import { contentPathRefusal } from "../paths.ts";
import type { CommandArgs, CommandSpec } from "../spec.ts";
import { runStagedLint } from "../staged.ts";
import { commitPairs, fsState, overlayState, revisionReader, revisionState } from "../state.ts";
import { loadVault, loadVaultVia, readPage } from "../vaultio.ts";

export const lintCommand: CommandSpec = {
  name: "lint",
  role: "writer",
  summary: "Lint pages against their effective type contracts; error findings exit 5.",
  positionals: [],
  flags: [
    { name: "page", type: "string", summary: "lint one page (repo-relative path)" },
    { name: "staged", type: "boolean", summary: "lint staged content against the base revision" },
    { name: "stdin", type: "boolean", summary: "lint a draft read from stdin (with --path)" },
    {
      name: "since",
      type: "string",
      summary: "replay every commit from <rev> to HEAD, each against its first parent",
    },
    { name: "limit", type: "string", summary: "cap the findings array (default 50)" },
    { name: "rule", type: "string", summary: "only findings with this rule id" },
    { name: "all", type: "boolean", summary: "lift the findings cap" },
    {
      name: "explain",
      type: "boolean",
      summary:
        "with --page: chain, sections, vocabularies, and a paste-ready exceptions stanza per queued finding",
    },
    {
      name: "path",
      type: "string",
      summary: "with --stdin, the draft's would-be path; otherwise, only findings on this page",
    },
  ],
  examples: [
    "wikiwright lint --root .",
    "wikiwright lint --staged",
    "wikiwright lint --page wiki/example.md",
    "wikiwright lint --since HEAD~5",
  ],
  writes: false,
  needsVaultModules: true,
  run: async (args) => {
    if (args.flags["staged"] === true) return runStagedLint(args);
    if (typeof args.flags["since"] === "string") return runSinceLint(args);
    const vault = loadVault("lint", args.root);
    if (!vault.ok) return vault.result;
    const roots = rootsOf(vault);
    const caps = capOptions(args);
    const shellFindings: Finding[] = [];
    const shellPasses: string[] = [];
    let state: VaultState;
    const judgeOptions: JudgeOptions = { ...caps, shellFindings, shellPasses };
    if (args.flags["stdin"] === true) {
      // docs/cli.md §lint --stdin: the SAME judge over the overlay state — the
      // draft in place of the page, with the disk file as its base.
      const rawDraftPath = args.flags["path"];
      if (typeof rawDraftPath !== "string" || rawDraftPath.length === 0) {
        return fail("lint", "usage", "missing-argument", "--stdin requires --path <would-be path>");
      }
      const draftPath = rawDraftPath.normalize("NFC");
      const pathRefused = contentPathRefusal(args.root, draftPath, roots);
      if (pathRefused !== undefined) {
        return fail("lint", "usage", "invalid-path", `--path ${pathRefused}`);
      }
      state = overlayState(fsState(args.root, roots), args.root, [
        { path: draftPath, text: readFileSync(0, "utf8") },
      ]);
      judgeOptions.only = new Set([draftPath]);
      judgeOptions.path = draftPath;
    } else {
      const raw = args.flags["page"];
      // The caller's bytes are not the vault's. `walkPages` stores
      // NFC, so an NFD `--page` inserted verbatim would add the page a second
      // time under a second key.
      const page = typeof raw === "string" ? raw.normalize("NFC") : raw;
      if (typeof page === "string") {
        const pathRefused = contentPathRefusal(args.root, page, roots);
        if (pathRefused !== undefined) {
          return fail("lint", "usage", "invalid-path", `--page ${pathRefused}`);
        }
      }
      state = fsState(args.root, roots);
      if (typeof page === "string") {
        if (!existsSync(join(args.root, page))) {
          return fail("lint", "not_found", "page-not-found", `no page at "${page}"`);
        }
        if (!state.pages.has(page)) state.pages.set(page, readPage(args.root, page));
        judgeOptions.only = new Set([page]);
        judgeOptions.path = page;
      } else {
        shellFindings.push(...templateFindings(args.root, vault));
        shellPasses.push("template-orphan", "template-placeholder-unknown");
      }
    }

    const verdict = judge(state, lawFor(vault), judgeOptions);
    const data: Record<string, unknown> = verdictEnvelope(verdict);
    if (args.flags["explain"] === true) {
      const page = args.flags["page"];
      if (typeof page !== "string" || page.length === 0) {
        return fail("lint", "usage", "missing-argument", "--explain requires --page <path>");
      }
      data["explain"] = explainPage(args.root, vault, page, verdict.findings);
    }
    if (verdict.summary.errors > 0) {
      return fail("lint", "findings", "findings", `${verdict.summary.errors} error finding(s)`, {
        data,
        hint: "each finding carries its rule id, provenance, and remediation",
      });
    }
    return ok("lint", data);
  },
};

/**
 * docs/cli.md §lint --explain: the paste-ready stanza. Every queue-routed finding on the
 * page can be waived per page (`exceptions:`), and the stanza is never retyped
 * by hand.
 */
function explainPage(
  root: string,
  vault: VaultOk,
  page: string,
  findings: readonly Finding[],
): Record<string, unknown> {
  const doc = parseDoc(readPage(root, page));
  const typeValue = doc.frontmatter.value["type"];
  const effective = typeof typeValue === "string" ? vault.registry.types.get(typeValue) : undefined;
  const queued = findings.filter(
    (f) => f.path === page && f.queue !== undefined && f.evidenceDigest !== undefined,
  );
  return {
    type: typeof typeValue === "string" ? typeValue : null,
    chain: effective?.chain ?? [],
    // In v3 there are no rules — the law governing this page lives in its
    // sections and the vocabularies they read. Printing them here keeps
    // `--explain` from answering "nothing governs this page" when everything does.
    sections: effective === undefined ? [] : sectionLines(effective),
    vocabularies: [...vault.registry.vocabularies.values()].map((v) => ({
      name: v.name,
      mode: v.mode,
      entries: v.entries.size,
    })),
    exception_stanzas: queued.map((f) => ({
      rule: f.ruleId,
      digest: f.evidenceDigest,
      reason: "<why this finding is deliberate>",
    })),
  };
}

/**
 * docs/cli.md §lint --since: the commit-pair walk. Each pair is judged under the
 * constitution AT that commit — what the gate would have said on the day.
 */
async function runSinceLint(args: CommandArgs): Promise<CommandResult> {
  const since = args.flags["since"];
  if (typeof since !== "string" || since.length === 0) {
    return fail("lint", "usage", "missing-argument", "--since requires a revision");
  }
  const worktree = loadVault("lint", args.root);
  if (!worktree.ok) return worktree.result;
  let pairs: { rev: string; base: string }[];
  try {
    pairs = commitPairs(args.root, since);
  } catch (e) {
    return fail(
      "lint",
      "not_found",
      "revision-not-found",
      `cannot walk from "${since}": ${String(e)}`,
    );
  }
  const commits: Record<string, unknown>[] = [];
  // One reader serves every judging verb — the replay rolls its pairs
  // up into the same `summary` block `lint`, `check` and `gate` print. `totals`
  // stays for `blocked`, which has no per-page meaning.
  const totals = { errors: 0, warnings: 0, infos: 0, blocked: 0 };
  const pages = new Set<string>();
  const by_rule = new Map<string, number>();
  const excepted = new Map<string, number>();
  let unevaluated = 0;
  for (const pair of pairs) {
    const vault = loadVaultVia("lint", revisionReader(args.root, pair.rev), { root: args.root });
    if (!vault.ok) {
      commits.push({ rev: pair.rev, skipped: "constitution-did-not-load" });
      continue;
    }
    const state = revisionState(args.root, pair.rev, pair.base, rootsOf(vault));
    const verdict = judge(state, lawFor(vault), { gate: true, all: true });
    totals.errors += verdict.summary.errors;
    totals.warnings += verdict.summary.warnings;
    totals.infos += verdict.summary.infos;
    if (verdict.summary.errors > 0) totals.blocked += 1;
    for (const path of state.pages.keys()) pages.add(path);
    for (const [id, n] of Object.entries(verdict.summary.by_rule)) {
      by_rule.set(id, (by_rule.get(id) ?? 0) + n);
    }
    for (const [id, n] of Object.entries(verdict.summary.excepted)) {
      excepted.set(id, (excepted.get(id) ?? 0) + n);
    }
    unevaluated += verdict.summary.unevaluated;
    commits.push({
      rev: pair.rev,
      base: pair.base,
      summary: verdict.summary,
      dispositions: verdict.dispositions,
    });
  }
  const rolled = (counts: ReadonlyMap<string, number>): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const id of [...counts.keys()].sort(codeUnitCompare)) out[id] = counts.get(id) ?? 0;
    return out;
  };
  const summary = {
    pages: pages.size,
    errors: totals.errors,
    warnings: totals.warnings,
    infos: totals.infos,
    by_rule: rolled(by_rule),
    excepted: rolled(excepted),
    unevaluated,
  };
  return ok("lint", { since, commits, totals, summary });
}
