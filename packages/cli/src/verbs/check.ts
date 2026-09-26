// v2 contracts §9.1: `check [--write] [--fix] [--dry-run]` — the working-tree
// adapter over the whole bundle; the rule tests and examples; every pin
// measured against the local repository; the `okf-missing-type` rule; the
// generated files compared with a fresh render and, under `--write`, written;
// `--fix` implying `--write` and running the surviving fixers first.
//
// Replaces the old `check` (legacy/check.ts) and absorbs `lint` (the working
// tree's verdict), `freshness` (the pins, local repository only), `okf` (its
// one surviving row) and `fix` (the folder-tag materializer and the generated
// files, the two fixers that survive). What the old `check` also judged and
// this one does not: templates, exports, installed skills, installed hooks
// (each left with its mechanism, §1).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  applyWrite,
  type CoverageCell,
  collectTypeLaw,
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
import { replaceFiles } from "../atomicwrite.ts";
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
import { commitWrites } from "../writer.ts";

/** The bytes `generated/` holds on disk for one planned path, or undefined when absent. */
function onDisk(root: string, path: string): string | undefined {
  const abs = join(root, path);
  return existsSync(abs) ? readFileSync(abs, "utf8") : undefined;
}

/**
 * `--write`: every planned file lands through the shell's staged replace,
 * all staged before the first rename (atomicwrite.ts): a failure while
 * staging leaves every old file; a crash inside the rename loop can leave
 * some old and some new, and the next `check --write` converges them.
 */
function writeGenerated(root: string, plans: readonly TypeLawArtifact[]): string[] {
  replaceFiles(plans.map((plan) => ({ path: join(root, plan.path), contents: plan.content })));
  return plans.map((plan) => plan.path);
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
  const loaded = lawOf("check", read0);
  if (!loaded.ok) return loaded;
  const law = loaded.law;
  const mismatch = engineMismatch("check", law);
  if (mismatch !== undefined) return { ok: false, result: mismatch };
  const fixes = args.flags["fix"] === true ? folderFixes(read0, law, readPages(read0, law)) : [];
  const state = withFixes(read0, fixes);
  const read = readPages(state, law);
  const collected = collectTypeLaw(state, law, { read });
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
  const preparation = await prepare(args);
  if (!preparation.ok) return preparation.result;
  const prepared = preparation.prepared;
  const { state, law, read, plans, fixes } = prepared;
  const identity = await typeLawIdentity(args.root, state, law);
  if (isDryRun(args)) {
    return withIdentity(ok("check", planOf(opsOf(args.root, prepared, writing(args)))), identity);
  }
  if (fixes.length > 0) {
    commitWrites(
      args.root,
      fixes.map((fix) => ({ path: fix.path, text: fix.text })),
    );
  }
  const fixed = fixes.map((fix) => ({ path: fix.path, added: fix.added }));
  const written = writing(args)
    ? writeGenerated(
        args.root,
        plans.filter((plan) => onDisk(args.root, plan.path) !== plan.content),
      )
    : [];
  const drift = driftFindings(plans, (path) => onDisk(args.root, path), "working-tree");
  const graph = typeLawGraph(law, read);
  const pins = await measurePins(args.root, read, graph.edges);
  const okf = okfFindings(read);
  const pinned = new Set(pins.entries.map((e) => e.path)).size;
  const measured = new Set(pins.entries.filter((e) => e.state !== "unmeasured").map((e) => e.path))
    .size;
  const pages = read.pages.length;
  const verdict = verdictOfCollected(prepared.collected, {
    ...capOptions(args),
    shellFindings: [...drift, ...pins.findings, ...okf],
    shellCoverage: {
      "generated-drift": cell(plans.length, 0),
      "okf-missing-type": cell(read.pages.filter((p) => p.read.ok).length, 0),
      "pin-stale": cell(measured, pages - measured),
      "pin-unknown": cell(measured, pages - measured),
      "pin-unmeasured": cell(pinned, pages - pinned),
      "citation-unresolved": cell(measured, pages - measured),
      "stale-source-cited": cell(pages, 0),
    },
  });
  const data = {
    findings: verdict.findings,
    summary: verdict.summary,
    coverage: verdict.coverage,
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
  role: "writer",
  summary:
    "Judge the whole bundle: every page, the rule tests and examples, the pins against the local repository, and the generated files; --write renders generated/, --fix repairs what a fixer may first.",
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
  ],
  examples: [
    "wikiwright check",
    "wikiwright check --write",
    "wikiwright check --fix --dry-run",
    "wikiwright check --path wiki/Basil.md --all",
  ],
  writes: true,
  needsVaultModules: false,
  plan: planForCheck,
  run,
};
