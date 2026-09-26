// v2 contracts §9.1: `check [--write] [--fix] [--dry-run]` — the working-tree
// adapter over the whole bundle; the rule tests and examples; every pin
// measured against the enclosing or declared local repositories; the `okf-missing-type` rule; the
// generated files compared with a fresh render and, under `--write`, written;
// `--fix` implying `--write` and running the surviving fixers first.
//
// Replaces the old `check` (legacy/check.ts) and absorbs `lint` (the working
// tree's verdict), `freshness` (the pins), `okf` (its
// one surviving row) and `fix` (the folder-tag materializer and the generated
// files, the two fixers that survive). What the old `check` also judged and
// this one does not: templates, exports, installed skills, installed hooks
// (each left with its mechanism, §1).
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import {
  applyWrite,
  type CoverageCell,
  collectTypeLaw,
  findingKey,
  type JudgeState,
  lawDigest,
  missingFolderTags,
  PAGE_LOCATION,
  readPages,
  type StateRead,
  type TypeLaw,
  type TypeLawArtifact,
  typeLawGraph,
  type Unrouted,
  verdictOfCollected,
} from "@wikiwright/core";
import { preflightReplacements } from "../atomicwrite.ts";
import { type CommandResult, capOptions, ENGINE_VERSION, fail, ok } from "../envelope.ts";
import { driftFindings, GENERATED_PATHS, generatedPlans } from "../generated.ts";
import { fsState } from "../lawstate.ts";
import { measurePins } from "../pins.ts";
import {
  type CommandArgs,
  type CommandSpec,
  isDryRun,
  type Plan,
  type PlanOp,
  planOf,
} from "../spec.ts";
import {
  engineMismatch,
  lawOf,
  stateContentDigest,
  stateRefusal,
  typeLawIdentity,
  withIdentity,
} from "../typelaw.ts";
import { commitWritesWithArtifacts } from "../writer.ts";

/** The bytes `generated/` holds on disk for one planned path, or undefined when absent. */
function onDisk(root: string, path: string): string | undefined {
  const abs = join(realpathSync(root), path);
  preflightReplacements([{ path: abs }], { writable: false });
  return existsSync(abs) ? readFileSync(abs, "utf8") : undefined;
}

/** A write validates every generated destination before landing any page or artifact. */
function preflightGenerated(root: string): void {
  const real = realpathSync(root);
  preflightReplacements(GENERATED_PATHS.map((path) => ({ path: join(real, path) })));
}

/** A page `--fix` rewrites, and the bytes it would hold. */
interface Fixed {
  path: string;
  text: string;
  added: string[];
}

/**
 * The folder-tag materializer (§2 `folder_tags`, `materialize-add-only`):
 * each page missing a tag its folders call for gains it, appended to its
 * `tags` through the Writer's frontmatter-list op; nothing is removed. A page
 * the splice refuses is left as it is, and its finding stays.
 */
function folderFixes(state: JudgeState, law: TypeLaw, read: StateRead): Fixed[] {
  if (law.engine.folder_tags.mode !== "materialize-add-only") return [];
  const tags = law.vocabularies.get("tags");
  const out: Fixed[] = [];
  for (const page of read.pages) {
    if (!page.read.ok || page.read.page.frontmatterCode !== undefined) continue;
    const missing = missingFolderTags(page.path, page.read.page, law.engine, tags);
    if (missing.length === 0) continue;
    const bytes = state.pages.get(page.path);
    if (bytes === undefined) continue;
    const existing = page.read.page.frontmatter["tags"];
    const spliced = applyWrite(new TextDecoder().decode(bytes), [
      {
        kind: "frontmatter-list",
        field: "tags",
        existing: Array.isArray(existing) ? existing : [],
        add: missing,
      },
    ]);
    if (spliced.ok) out.push({ path: page.path, text: spliced.text, added: missing });
  }
  return out;
}

/** The state with the fixed pages in place of their bytes. */
function withFixes(state: JudgeState, fixes: readonly Fixed[]): JudgeState {
  if (fixes.length === 0) return state;
  const pages = new Map(state.pages);
  const encoder = new TextEncoder();
  for (const fix of fixes) pages.set(fix.path, encoder.encode(fix.text));
  return { ...state, pages };
}

/** §1: base OKF's one surviving row — every page carries a non-empty `type`. */
function okfFindings(read: StateRead): Unrouted[] {
  const out: Unrouted[] = [];
  for (const page of read.pages) {
    if (!page.read.ok) continue;
    const declared = page.read.page.frontmatter["type"];
    if (typeof declared === "string" && declared.trim() !== "") continue;
    out.push({
      rule: "okf-missing-type",
      severity: "error",
      path: page.path,
      location: PAGE_LOCATION,
      message: "base OKF requires a non-empty `type` on every page",
      details: { pointer: "/type" },
    });
  }
  return out;
}

function cell(evaluated: number, notApplicable: number): CoverageCell {
  return { evaluated, not_applicable: notApplicable, unevaluated: 0 };
}

/** What one `check` read, loaded, fixed and rendered: the run and its dry run share it. */
interface Prepared {
  state: JudgeState;
  law: TypeLaw;
  read: StateRead;
  fixes: Fixed[];
  plans: TypeLawArtifact[];
  collected: ReturnType<typeof collectTypeLaw>;
}

type Preparation = { ok: true; prepared: Prepared } | { ok: false; result: CommandResult };

async function prepare(args: CommandArgs): Promise<Preparation> {
  let read0: JudgeState;
  try {
    read0 = await fsState(args.root);
  } catch (e) {
    const refused = stateRefusal("check", e);
    if (refused === undefined) throw e;
    return { ok: false, result: refused };
  }
  const loaded = lawOf("check", read0, args.root);
  if (!loaded.ok) return loaded;
  const law = loaded.law;
  const mismatch = engineMismatch("check", law);
  if (mismatch !== undefined) return { ok: false, result: mismatch };
  const diskRead = readPages(read0, law);
  const fixes = args.flags["fix"] === true ? folderFixes(read0, law, diskRead) : [];
  const state = withFixes(read0, fixes);
  const read = readPages(state, law);
  const collected = collectTypeLaw(state, law, { read });
  if (fixes.length > 0) {
    const before = new Set(
      verdictOfCollected(collectTypeLaw(read0, law, { read: diskRead }), {
        all: true,
      }).findings.map(findingKey),
    );
    const touched = new Set(fixes.map((fix) => fix.path));
    const introduced = verdictOfCollected(collected, { all: true }).findings.filter(
      (finding) =>
        finding.severity === "error" &&
        (touched.has(finding.path) || !before.has(findingKey(finding))),
    );
    if (introduced.length > 0) {
      return {
        ok: false,
        result: withIdentity(
          fail(
            "check",
            "findings",
            "fix-invalid",
            `${introduced.length} error finding(s) would remain or arise from the proposed fixes; nothing landed`,
            {
              data: {
                findings: introduced,
                failing: [...new Set(introduced.map((finding) => finding.path))].sort(),
              },
              hint: "review the page and its type before applying a mechanical fix",
            },
          ),
          await typeLawIdentity(args.root, read0, law),
        ),
      };
    }
  }
  const plans = generatedPlans({
    state,
    law,
    read,
    digests: { law: lawDigest(law, ENGINE_VERSION), content: stateContentDigest(state) },
    commands: args.commands,
    unbased: collected,
  });
  return { ok: true, prepared: { state, law, read, fixes, plans, collected } };
}

/** The ops `--write` and `--fix` would apply: the fixed pages, then every generated file that differs. */
function opsOf(root: string, prepared: Prepared, writing: boolean): PlanOp[] {
  const ops: PlanOp[] = prepared.fixes.map((fix) => ({
    kind: "write",
    path: fix.path,
    summary: `add the folder tags ${fix.added.join(", ")} (folder_tags: materialize-add-only)`,
  }));
  if (!writing) return ops;
  for (const plan of prepared.plans) {
    const held = onDisk(root, plan.path);
    if (held === plan.content) continue;
    ops.push({
      kind: held === undefined ? "create" : "write",
      path: plan.path,
      summary: "render the generated file from the law and the pages",
    });
  }
  return ops;
}

function writing(args: CommandArgs): boolean {
  return args.flags["write"] === true || args.flags["fix"] === true;
}

/**
 * docs/cli.md §The dry-run law: what this invocation would land — nothing
 * without `--write` or `--fix`; the fixed pages and the generated files that
 * differ with them.
 */
async function planForCheck(args: CommandArgs): Promise<Plan> {
  if (!writing(args)) return planOf([]);
  const prepared = await prepare(args);
  if (!prepared.ok) return planOf([]);
  return planOf(opsOf(args.root, prepared.prepared, true));
}

async function run(args: CommandArgs): Promise<CommandResult> {
  if (args.flags["summary"] === true && args.flags["limit"] !== undefined)
    return fail(
      "check",
      "usage",
      "summary-limit-conflict",
      "--summary reports uncapped selected findings; remove --limit",
      {
        details: { flags: ["--summary", "--limit"] },
      },
    );
  const preparation = await prepare(args);
  if (!preparation.ok) return preparation.result;
  const prepared = preparation.prepared;
  const { state, law, read, plans, fixes } = prepared;
  const identity = await typeLawIdentity(args.root, state, law);
  if (writing(args)) preflightGenerated(args.root);
  if (isDryRun(args)) {
    return withIdentity(ok("check", planOf(opsOf(args.root, prepared, writing(args)))), identity);
  }
  const changedPlans = writing(args)
    ? plans.filter((plan) => onDisk(args.root, plan.path) !== plan.content)
    : [];
  if (fixes.length > 0 || changedPlans.length > 0) {
    commitWritesWithArtifacts(
      args.root,
      fixes.map((fix) => ({ path: fix.path, text: fix.text })),
      changedPlans,
    );
  }
  const fixed = fixes.map((fix) => ({ path: fix.path, added: fix.added }));
  const written = changedPlans.map((plan) => plan.path);
  const drift = driftFindings(plans, (path) => onDisk(args.root, path), "working-tree");
  const graph = typeLawGraph(law, read);
  const pins = await measurePins(args.root, read, graph.edges, law.engine.local_origins);
  const okf = okfFindings(read);
  const pages = read.pages.length;
  const byPage = new Map<string, typeof pins.entries>();
  for (const entry of pins.entries) {
    const entries = byPage.get(entry.path) ?? [];
    entries.push(entry);
    byPage.set(entry.path, entries);
  }
  const pinned = byPage.size;
  // A page with several pins is fully evaluated only when every pin was checked.
  const pinCell = (checked: (entry: (typeof pins.entries)[number]) => boolean): CoverageCell => ({
    evaluated: [...byPage.values()].filter((entries) => entries.every(checked)).length,
    not_applicable: pages - pinned,
    unevaluated: [...byPage.values()].filter((entries) => entries.some((entry) => !checked(entry)))
      .length,
  });
  const evidenceReasons = [
    ...new Set(
      pins.entries
        .map((entry) =>
          entry.state === "unmeasured"
            ? "pin-unmeasured"
            : entry.reason === "coverage-invalid"
              ? "pin-coverage-invalid"
              : entry.state === "unknown"
                ? "pin-unknown"
                : null,
        )
        .filter(
          (reason): reason is "pin-unmeasured" | "pin-coverage-invalid" | "pin-unknown" =>
            reason !== null,
        ),
    ),
  ];
  const verdict = verdictOfCollected(prepared.collected, {
    ...capOptions(args),
    ...(args.flags["summary"] === true ? { all: true } : {}),
    shellFindings: [...drift, ...pins.findings, ...okf],
    shellCoverage: {
      "generated-drift": cell(plans.length, 0),
      "okf-missing-type": cell(read.pages.filter((p) => p.read.ok).length, 0),
      "pin-stale": pinCell((entry) => entry.citations !== null),
      "pin-unknown": pinCell((entry) => entry.state !== "unmeasured"),
      "pin-coverage-invalid": pinCell((entry) => entry.resolved_commit !== undefined),
      "pin-unmeasured": cell(pinned, pages - pinned),
      "citation-unresolved": pinCell((entry) => entry.citations !== null),
      "stale-source-cited": cell(pages, 0),
    },
    shellReasons: {
      "pin-stale": evidenceReasons,
      "pin-unknown": evidenceReasons,
      "pin-coverage-invalid": evidenceReasons,
      "citation-unresolved": evidenceReasons,
    },
  });
  const data = {
    findings: verdict.findings,
    summary: verdict.summary,
    coverage: verdict.coverage,
    scope: verdict.scope,
    unevaluated: verdict.unevaluated,
    caps: verdict.caps,
    pins: { counts: pins.counts, entries: pins.entries },
    generated: { files: [...GENERATED_PATHS], written },
    ...(args.flags["fix"] === true ? { fixed } : {}),
  };
  const result =
    verdict.summary.errors > 0
      ? fail("check", "findings", "findings", `${verdict.summary.errors} error finding(s)`, {
          data,
          hint: "each finding names its fix or its queue lane; --all lifts the cap",
        })
      : ok("check", data);
  return withIdentity(result, identity);
}

export const checkCommand: CommandSpec = {
  name: "check",
  summary:
    "Judge the whole bundle: every page, the rule tests and examples, pins against declared local repositories, and generated files; --write renders generated/, --fix repairs what a fixer may first.",
  positionals: [],
  flags: [
    {
      name: "write",
      type: "boolean",
      summary: "render generated/ (BRIEF.md, graph.json, manifest.json, queue.md, tag-catalog.md)",
    },
    {
      name: "fix",
      type: "boolean",
      summary:
        "run the fixers that survive — the folder-tag materializer, then the generated files — then judge; implies --write",
    },
    { name: "limit", type: "string", summary: "cap the findings array (default 50)" },
    { name: "rule", type: "string", summary: "only findings with this rule id" },
    { name: "path", type: "string", summary: "only findings on this page" },
    { name: "all", type: "boolean", summary: "lift the findings cap" },
    {
      name: "summary",
      type: "boolean",
      summary: "print a compact verdict; with --out save the uncapped full report",
    },
  ],
  examples: [
    "wikiwright check",
    "wikiwright check --write",
    "wikiwright check --fix --dry-run",
    "wikiwright check --path wiki/Basil.md --all",
    "wikiwright check --summary",
  ],
  writes: true,
  plan: planForCheck,
  run,
};
