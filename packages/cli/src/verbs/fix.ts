// The verb a fix-routed finding's own argv names: judge ONCE, derive the ops
// the rule licenses, honour --expect, splice every page in memory, judge ONCE
// more with every fixed page in place, and write only when the rule is gone
// and no new error appeared (docs/cli.md §fix, docs/concepts.md §Findings and
// routing). A pure function of state and law: no fixer reads git.
//
// The state is the one the finding came from. `check` and `lint` judge the
// working tree, so a plain `fix` does too; `gate` and `lint --staged` judge the
// index, and a finding of theirs hands out `--staged`. Judging the index while
// writing the tree is the ONE case where the two can disagree, so only that
// mode refuses `working-tree-drift` — naming every drifted page.

import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  type Applicability,
  codeUnitCompare,
  FIXER_REGISTRY,
  type Finding,
  fixerExecutes,
  fixOpsFor,
  judge,
  type Law,
  type PassRow,
  passRows,
  type VaultState,
  type Verdict,
  type WriteOp,
} from "@wikiwright/core";
import { type CommandResult, fail, ok } from "../envelope.ts";
import { lawFor, rootsOf, type VaultOk } from "../law.ts";
import { contentPathRefusal } from "../paths.ts";
import {
  type CommandArgs,
  type CommandSpec,
  isDryRun,
  type Plan,
  type PlanOp,
  planOf,
} from "../spec.ts";
import { fsState, indexState } from "../state.ts";
import { loadVault, readPage } from "../vaultio.ts";
import { commitWrites, proveWrites, splicePlan, writeOps } from "../writer.ts";

/** One page's ops, with the reason it can or cannot be applied. */
interface PageFix {
  path: string;
  ruleId: string;
  fixer: string;
  applicability: Applicability;
  ops: WriteOp[];
  description: string;
  line?: number;
}

/**
 * The fixer a rule id's own row names — in the COMPOSED table the judge routes
 * by, the kernel's rows plus one per registered arm and check, so a module
 * arm's fixer is found here exactly as the kernel's are — and, where the row
 * names none, the registered fixer whose rule list covers it. The second case
 * is the OPT-IN path and exists for exactly one row: `canonical-form` is
 * `info`, so its finding advertises no fix and nothing runs it as a side
 * effect, but an operator who names the rule gets the dialect rewrite they
 * asked for.
 */
function fixerFor(rows: readonly PassRow[], ruleId: string): string | undefined {
  const row = rows.find((r) => r.id === ruleId);
  if (row?.fixer !== undefined) return row.fixer;
  return Object.entries(FIXER_REGISTRY).find(([, e]) => e.rules.includes(ruleId))?.[0];
}

function derive(
  finding: Finding,
  text: string,
  rows: readonly PassRow[],
): { ok: true; fix: PageFix } | { ok: false; reason: string } {
  const fixer = fixerFor(rows, finding.ruleId);
  if (fixer === undefined) return { ok: false, reason: `"${finding.ruleId}" names no fixer` };
  const entry = FIXER_REGISTRY[fixer];
  if (entry === undefined) return { ok: false, reason: `"${fixer}" is not registered` };
  const input = {
    ruleId: finding.ruleId,
    text,
    ...(finding.line === undefined ? {} : { line: finding.line }),
    ...(finding.details === undefined ? {} : { details: { ...finding.details } }),
  };
  const derived = fixOpsFor(fixer, input);
  if (!derived.ok) return derived;
  return {
    ok: true,
    fix: {
      path: finding.path,
      ruleId: finding.ruleId,
      fixer,
      applicability: entry.applicability,
      ops: derived.ops,
      description: derived.description,
      ...(finding.line === undefined ? {} : { line: finding.line }),
    },
  };
}

function planOpsOf(fixes: readonly PageFix[]): PlanOp[] {
  const seen = new Set<string>();
  const out: PlanOp[] = [];
  for (const fix of fixes) {
    if (seen.has(fix.path)) continue;
    seen.add(fix.path);
    out.push(...writeOps(fix.path, "write", fix.description));
  }
  return out;
}

interface Collected {
  fixes: PageFix[];
  refusals: { path: string; ruleId: string; reason: string; line?: number }[];
  /** The one judge of the state as it stands: the proof compares against it. */
  before: Verdict;
}

function collect(
  args: CommandArgs,
  state: VaultState,
  law: Law,
  rule: string,
  paths: readonly string[] | undefined,
  rows: readonly PassRow[],
  staged: boolean,
): Collected {
  const line = args.flags["line"];
  const lineNumber = typeof line === "string" ? Number.parseInt(line, 10) : undefined;
  // The gate's change-scoping is right for the index, whose subject IS the
  // changed set, and wrong for the working tree, where a finding on any page
  // is exactly what `check` reported.
  const before = judge(state, law, { all: true, gate: staged });
  const wanted = before.findings.filter(
    (f) =>
      f.ruleId === rule &&
      (paths === undefined || paths.includes(f.path)) &&
      (lineNumber === undefined || f.line === lineNumber) &&
      fixerFor(rows, f.ruleId) !== undefined,
  );
  const fixes: PageFix[] = [];
  const refusals: Collected["refusals"] = [];
  for (const finding of wanted) {
    const text = state.pages.get(finding.path);
    if (text === undefined) continue;
    const derived = derive(finding, text, rows);
    // A fixer whose row is gated by the bundle's declared policy executes only
    // where that policy admits it — the folder-tag materializer under
    // `folder_tags: materialize-add-only`. Naming the rule is not consent; the
    // constitution's mode is.
    const folderTags = law.options?.folderTags;
    const admitted =
      derived.ok &&
      fixerExecutes(
        derived.fix.fixer,
        finding.ruleId,
        folderTags === undefined ? undefined : { folderTags },
      );
    if (derived.ok && admitted) fixes.push(derived.fix);
    else {
      refusals.push({
        path: finding.path,
        ruleId: finding.ruleId,
        reason: derived.ok
          ? `the "${derived.fix.fixer}" fixer does not execute under this bundle's declared policy`
          : derived.reason,
        ...(finding.line === undefined ? {} : { line: finding.line }),
      });
    }
  }
  return { fixes, refusals, before };
}

/** Everything the plan and the run share, or the refusal that stops both. */
interface Prepared {
  vault: VaultOk;
  rows: readonly PassRow[];
  law: Law;
  state: VaultState;
  staged: boolean;
  /** The pages in scope; `undefined` is every page. */
  paths: string[] | undefined;
  collected: Collected;
}

function stateName(staged: boolean): "index" | "working-tree" {
  return staged ? "index" : "working-tree";
}

/**
 * The state the verb judges, chosen by the argv: `--staged` is the index — the
 * state `gate` and `lint --staged` judged, whose findings hand the flag out —
 * and its absence is the working tree, the state `check` and `lint` judged.
 * `--path` narrows either to one page; `--staged` alone is every page the
 * index changed; neither is every page.
 */
function prepare(
  args: CommandArgs,
  rule: string,
  path: string | undefined,
): { ok: true; prepared: Prepared } | { ok: false; result: CommandResult } {
  const vault = loadVault("fix", args.root);
  if (!vault.ok) return { ok: false, result: vault.result };
  const roots = rootsOf(vault);
  if (path !== undefined) {
    const pathRefused = contentPathRefusal(args.root, path, roots);
    if (pathRefused !== undefined) {
      return { ok: false, result: fail("fix", "usage", "invalid-path", `--path ${pathRefused}`) };
    }
    if (!existsSync(join(args.root, path))) {
      return {
        ok: false,
        result: fail("fix", "not_found", "page-not-found", `no page at "${path}"`),
      };
    }
  }
  // The vault boundary is judged before the rule is — a path outside the vault
  // is refused whatever else the command line says. The table this vault is
  // judged under — the kernel's rows plus one per registered arm and check —
  // is the one `--rule` names into: an id no row carries is refused by name,
  // valid values attached; a kit arm's id is a row of this vault like any other.
  const rows = passRows(vault.modules);
  if (!rows.some((r) => r.id === rule)) {
    return {
      ok: false,
      result: fail(
        "fix",
        "usage",
        "unknown-rule",
        `"${rule}" is not a rule this vault is judged by`,
        {
          details: { valid_values: rows.map((r) => r.id).sort(codeUnitCompare) },
        },
      ),
    };
  }
  const staged = args.flags["staged"] === true;
  let state: VaultState;
  let paths: string[] | undefined;
  if (staged) {
    try {
      state = indexState(args.root, roots);
    } catch (error) {
      return {
        ok: false,
        result: fail(
          "fix",
          "conflict",
          "git-unavailable",
          `git plumbing failed: ${String(error)}`,
          {
            hint: "--staged judges the index, which needs a git repository; drop it to judge the working tree",
          },
        ),
      };
    }
    paths =
      path !== undefined
        ? [path]
        : [...state.pages.keys()].filter((p) => {
            const base = state.base?.get(p);
            return base === null || base !== state.pages.get(p);
          });
    // The verb judges the index and WRITES the tree, so it refuses when the two
    // disagree rather than overwriting an unstaged edit — and names every page
    // that does, so one re-run answers the whole set.
    const drifted = paths
      .filter((candidate) => {
        const inIndex = state.pages.get(candidate);
        if (inIndex === undefined || !existsSync(join(args.root, candidate))) return false;
        return inIndex !== readPage(args.root, candidate);
      })
      .sort(codeUnitCompare);
    if (drifted.length > 0) {
      return {
        ok: false,
        result: fail(
          "fix",
          "conflict",
          "working-tree-drift",
          `${drifted.length} page(s) differ between the index and the working tree: ${drifted.join(", ")}`,
          {
            data: { paths: drifted },
            hint: "fix --staged judges the index and writes the working tree, and will not overwrite an unstaged edit — stage them (git add) or revert them, then re-run; or drop --staged to judge the working tree",
          },
        ),
      };
    }
  } else {
    state = fsState(args.root, roots);
    if (path !== undefined) {
      if (!state.pages.has(path)) state.pages.set(path, readPage(args.root, path));
      paths = [path];
    }
  }
  const law = lawFor(vault);
  const collected = collect(args, state, law, rule, paths, rows, staged);
  return { ok: true, prepared: { vault, rows, law, state, staged, paths, collected } };
}

function planForFix(args: CommandArgs): Plan {
  const rule = args.flags["rule"];
  const pathRaw = args.flags["path"];
  if (typeof rule !== "string" || rule.length === 0) return planOf([]);
  const path =
    typeof pathRaw === "string" && pathRaw.length > 0 ? pathRaw.normalize("NFC") : undefined;
  const prepared = prepare(args, rule, path);
  if (!prepared.ok) return planOf([]);
  return planOf(
    planOpsOf(
      prepared.prepared.collected.fixes.filter((f) => f.applicability === "MachineApplicable"),
    ),
  );
}

export const fixCommand: CommandSpec = {
  name: "fix",
  role: "writer",
  summary: "Apply the mechanical ops one rule licenses, all-or-nothing, and prove them gone.",
  positionals: [],
  flags: [
    { name: "rule", type: "string", summary: "the rule id whose ops to apply" },
    {
      name: "path",
      type: "string",
      summary: "the page (repo-relative); with neither --path nor --staged, every page",
    },
    {
      name: "staged",
      type: "boolean",
      summary:
        "judge the index, the state `gate` and `lint --staged` judge; alone, every page the index changed. Without it the working tree, the state `check` and `lint` judge",
    },
    { name: "line", type: "string", summary: "restrict to the finding on this line" },
    {
      name: "propose",
      type: "boolean",
      summary: "print the HasPlaceholders renderings without applying anything",
    },
    { name: "expect", type: "string", summary: "the op count this call may apply, or `any`" },
  ],
  examples: [
    "wikiwright fix --rule sections --path wiki/parser.md --expect 1",
    "wikiwright fix --rule folder-tags-present --staged --expect any",
    "wikiwright fix --rule unknown-frontmatter-key --expect any",
    "wikiwright fix --rule renamed-without-alias --path wiki/lexer.md --staged --expect 1",
  ],
  writes: true,
  needsVaultModules: true,
  plan: planForFix,
  run: async (args) => {
    const rule = args.flags["rule"];
    const pathRaw = args.flags["path"];
    const path =
      typeof pathRaw === "string" && pathRaw.length > 0 ? pathRaw.normalize("NFC") : undefined;
    const expectRaw = args.flags["expect"];
    const propose = args.flags["propose"] === true;
    if (typeof rule !== "string" || rule.length === 0) {
      return fail("fix", "usage", "missing-argument", "--rule <id> is required");
    }
    // `--propose` writes nothing, so the blast-radius guard has nothing to
    // bound: a proposal is a rendering, not a changeset.
    if (typeof expectRaw !== "string" && !propose) {
      return fail("fix", "usage", "missing-argument", "--expect <n|any> is required");
    }
    const prepared = prepare(args, rule, path);
    if (!prepared.ok) return prepared.result;
    const { rows, law, state, staged, collected } = prepared.prepared;
    const registered = fixerFor(rows, rule);
    const anyExpect = expectRaw === "any" || (propose && typeof expectRaw !== "string");
    const expect = anyExpect ? -1 : Number.parseInt(String(expectRaw), 10);
    if (!anyExpect && (!Number.isFinite(expect) || expect < 0)) {
      return fail(
        "fix",
        "usage",
        "invalid-value",
        "--expect takes a non-negative integer or `any`",
      );
    }
    // `any` is the human escape and stays out of the agent loop unless the
    // blast radius is knowable — a dry run, a proposal, or one MachineApplicable
    // fixer whose ops the verb proves before writing.
    const machine =
      registered !== undefined && FIXER_REGISTRY[registered]?.applicability === "MachineApplicable";
    if (anyExpect && !isDryRun(args) && !propose && !machine) {
      return fail(
        "fix",
        "usage",
        "expect-any-unadmitted",
        "`--expect any` needs --dry-run, --propose, or a rule whose fixer is MachineApplicable",
        {
          details: {
            rule,
            applicability:
              registered === undefined ? null : (FIXER_REGISTRY[registered]?.applicability ?? null),
          },
        },
      );
    }

    if (propose) {
      // `--propose` renders and applies nothing — the HasPlaceholders path, and
      // the only path `history-close` ever takes.
      return ok("fix", {
        ...planOf([]),
        state: stateName(staged),
        proposals: collected.fixes.map((f) => ({
          path: f.path,
          rule: f.ruleId,
          fixer: f.fixer,
          applicability: f.applicability,
          line: f.line ?? null,
          rendered: f.ops.flatMap((op) =>
            op.kind === "replace" || op.kind === "insert" || op.kind === "append-section"
              ? [...op.lines]
              : [],
          ),
        })),
        refusals: collected.refusals,
        proved: false,
      });
    }

    // `--expect N` applies the MachineApplicable ops, and — only because the
    // operator named the rule and pinned the count — a MaybeIncorrect one.
    // `canonical-form` is the whole of that population: naming the rule IS the
    // opt-in, and `--expect any` never reaches it. HasPlaceholders is never
    // applied by any count; `--propose` is its only path.
    const applicable = collected.fixes.filter(
      (f) =>
        f.applicability === "MachineApplicable" ||
        (f.applicability === "MaybeIncorrect" && !anyExpect),
    );
    if (!anyExpect && applicable.length !== expect) {
      return fail(
        "fix",
        "conflict",
        "expect-mismatch",
        `--expect ${expect} but ${applicable.length} mechanical op(s) apply in the ${staged ? "index" : "working tree"}`,
        {
          data: { ops: applicable, refusals: collected.refusals, rule, state: stateName(staged) },
          hint: staged
            ? "fix --staged judged the index, the state `gate` and `lint --staged` judge; a finding from `check` or `lint` lives in the working tree — drop --staged. Otherwise re-read the findings and pass the count you meant"
            : "fix judged the working tree, the state `check` and `lint` judge; a finding from `gate` or `lint --staged` lives in the index — add --staged. Otherwise re-read the findings and pass the count you meant",
        },
      );
    }
    // All-or-nothing: every page is spliced in memory first, and one refusal
    // writes nothing at all.
    const byPage = new Map<string, PageFix[]>();
    for (const fix of applicable) {
      byPage.set(fix.path, [...(byPage.get(fix.path) ?? []), fix]);
    }
    const spliced: { path: string; text: string }[] = [];
    for (const [page, fixes] of [...byPage].sort(([a], [b]) => codeUnitCompare(a, b))) {
      const before = state.pages.get(page);
      if (before === undefined) continue;
      const result = splicePlan(before, { path: page, ops: fixes.flatMap((f) => f.ops) });
      if (!result.ok) {
        return fail("fix", "conflict", "fixer-refused", `${page}: ${result.reason}`, {
          data: { ops: applicable },
          hint: "the value's shape is beyond a splice; edit it by hand",
        });
      }
      spliced.push({ path: page, text: result.spliced.text });
    }
    if (isDryRun(args)) {
      return ok("fix", {
        ...planOf(planOpsOf(applicable)),
        state: stateName(staged),
        changed: [],
        proved: false,
        dry_run: true,
        fix_ops: applicable,
        refusals: collected.refusals,
      });
    }
    if (spliced.length === 0) {
      return ok("fix", {
        state: stateName(staged),
        changed: [],
        ops: [],
        proved: true,
        refusals: collected.refusals,
      });
    }
    // The proof is ONE judge of the same state with every fixed page in place
    // (N pages used to be 2N judges), so "the finding is gone" is a
    // claim about what the engine would now say of the whole vault.
    const proof = proveWrites({
      state,
      law,
      pages: spliced.map((page) => ({ path: page.path, after: page.text })),
      addresses: (f) => f.ruleId === rule,
      before: collected.before,
      options: { gate: staged },
    });
    if (!proof.ok) {
      return fail("fix", "conflict", proof.code, proof.message, {
        data: { ops: applicable, ...proof.details },
      });
    }
    commitWrites(args.root, spliced);
    return ok("fix", {
      state: stateName(staged),
      changed: spliced.map((p) => p.path),
      ops: applicable,
      refusals: collected.refusals,
      proved: true,
    });
  },
};
