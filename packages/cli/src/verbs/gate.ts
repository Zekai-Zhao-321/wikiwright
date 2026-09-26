// v2 contracts §9.2: `gate [--commit-msg <file>]` — the index adapter with
// HEAD as its base (no HEAD: an empty base and no law diff); staged pages,
// the constitution, the rule tests, the examples and the libraries read from
// the index; `generated/*` judged as staged; today's demotion of a queued
// error on an untouched line; exit 5 on any error after demotion. §8: at
// `pre-commit` the law diff is `law-changed` (info) and never blocks; at
// `commit-msg` it is `law-relaxed` (error) unless the message's body carries
// `law-change: <reason>`, and the message's prefix is held to
// `commit_prefixes`. `.pre-commit-hooks.yaml` at the repository root
// publishes both stages.
//
// Replaces the old `gate` (legacy/gate.ts, staged.ts) and absorbs
// `lint --staged`; the old `hook` verb's installed scripts give way to the
// published definition and the one-liners docs/cli.md documents. Ported from
// the old gate: the refusal's text on stderr (the census, the blocking
// findings, the one line naming the whole envelope), `unmerged-paths`,
// `git-unavailable`, the commit-message path taken as git hands it, and the
// prefix refusal with its one stderr line. Not ported: the staged kits
// (modules leave), the exports and the engine pin under its old name (it is
// `engine-mismatch` here, as in `check`).
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import {
  changesLaw,
  codeUnitCompare,
  collectTypeLaw,
  commitPrefixVerdict,
  gateScope,
  headLawDiff,
  type JudgeState,
  type LawChange,
  lawChangeFindings,
  lawDigest,
  loadTypeLaw,
  readPages,
  type TypeLaw,
  type TypeLawResult,
  type TypeLawVerdict,
  type Unrouted,
  verdictOfCollected,
  verdictOfFindings,
} from "@wikiwright/core";
import {
  type CommandResult,
  capOptions,
  ENGINE_VERSION,
  type ErrEnvelope,
  fail,
  ok,
} from "../envelope.ts";
import { driftFindings, GENERATED_PATHS, generatedPlans } from "../generated.ts";
import {
  GitAnswerRefused,
  gitHasHead,
  gitIndexEntries,
  gitReadBlobBytes,
  gitStagedChanges,
} from "../git.ts";
import { repositoryPlace, revisionLawSnapshot } from "../lawfiles.ts";
import { indexState } from "../lawstate.ts";
import type { CommandArgs, CommandSpec } from "../spec.ts";
import {
  engineMismatch,
  lawOf,
  stateContentDigest,
  typeLawIdentity,
  withIdentity,
} from "../typelaw.ts";

type Read<T> = { ok: true; value: T } | { ok: false; result: CommandResult };

/** The index as one state, or the refusal: no repository, or a merge in progress. */
async function readIndex(root: string): Promise<Read<JudgeState>> {
  try {
    return { ok: true, value: await indexState(root) };
  } catch (e) {
    // A cut or contradicted answer is refused as itself.
    if (e instanceof GitAnswerRefused) throw e;
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes("unmerged path")) {
      return {
        ok: false,
        result: fail("gate", "conflict", "unmerged-paths", message, {
          hint: "resolve the merge conflicts, stage the resolutions, then rerun",
        }),
      };
    }
    if (message.includes("is in no git repository")) {
      return {
        ok: false,
        result: fail("gate", "conflict", "git-unavailable", message, {
          hint: "the gate judges a repository's index; run it inside one",
        }),
      };
    }
    throw e;
  }
}

/** §8: HEAD's law as it loaded, or null with no HEAD. */
async function headLaw(root: string): Promise<TypeLawResult | null> {
  const { top } = await repositoryPlace(root);
  if (!(await gitHasHead(top))) return null;
  return loadTypeLaw(await revisionLawSnapshot(root, "HEAD"));
}

/**
 * §8 the pre-commit change-scoping: a staged path under `config/`,
 * `constitution/`, `rule-tests/`, `examples/` or a declared library — the
 * index's or HEAD's — changes the law, and the whole vault is then judged.
 */
async function lawStaged(root: string, law: TypeLaw, head: TypeLawResult | null): Promise<boolean> {
  const { top, bundle } = await repositoryPlace(root);
  if (!(await gitHasHead(top))) return true;
  const libraries = [
    ...law.libraries.map((l) => l.root),
    ...(head?.ok === true ? head.law.libraries.map((l) => l.root) : []),
  ];
  for (const change of await gitStagedChanges(top)) {
    for (const path of [change.path, change.oldPath]) {
      if (path !== undefined && changesLaw(path.normalize("NFC"), bundle, libraries)) return true;
    }
  }
  return false;
}

/**
 * The staged bytes of each generated file, by bundle-relative path: `null`
 * when the index tracks none of them, and the gate then judges none.
 */
async function stagedGenerated(root: string): Promise<Map<string, string> | null> {
  const { top, bundle } = await repositoryPlace(root);
  const wanted = new Map(
    GENERATED_PATHS.map((p) => [(bundle === "" ? p : `${bundle}/${p}`).normalize("NFC"), p]),
  );
  const entries = (await gitIndexEntries(top)).filter(
    (e) => e.stage === 0 && wanted.has(e.path.normalize("NFC")),
  );
  if (entries.length === 0) return null;
  const blobs = await gitReadBlobBytes(
    top,
    entries.map((e) => e.blob),
  );
  const out = new Map<string, string>();
  for (const entry of entries) {
    const bytes = blobs.get(entry.blob);
    const path = wanted.get(entry.path.normalize("NFC"));
    if (bytes !== undefined && path !== undefined) out.set(path, new TextDecoder().decode(bytes));
  }
  return out;
}

/**
 * docs/cli.md §gate: what the gate prints on stderr when it refuses a commit —
 * the census, each blocking finding with its route, and the one line naming
 * the whole envelope. Never the coverage block.
 */
function refusalText(envelope: ErrEnvelope): string {
  const data = (envelope.data ?? {}) as Partial<TypeLawVerdict>;
  const lines: string[] = [];
  if (envelope.error.code === "findings" && data.summary !== undefined) {
    lines.push(`wikiwright gate: ${data.summary.errors} error finding(s) block this commit`);
    const census = Object.entries(data.summary.by_rule).map(([rule, n]) => `${rule} ${n}`);
    if (census.length > 0) lines.push(`  by rule: ${census.join(", ")}`);
    for (const f of (data.findings ?? []).filter((f) => f.severity === "error")) {
      const at = f.location.kind === "section" ? `${f.path}:${f.location.line}` : f.path;
      lines.push(`  error ${f.rule} ${at} — ${f.message}`);
      if (f.fix !== undefined) lines.push(`    fix: ${f.fix.argv.join(" ")}`);
      else if (f.queue !== undefined) lines.push(`    queue: ${f.queue}`);
    }
    lines.push("run `wikiwright gate --all` for the whole envelope");
    return lines.join("\n");
  }
  lines.push(`wikiwright gate: ${envelope.error.code} — ${envelope.error.message}`);
  if (envelope.error.hint !== undefined) lines.push(`  hint: ${envelope.error.hint}`);
  lines.push("run `wikiwright gate` for the whole envelope");
  return lines.join("\n");
}

function withRefusalText(result: CommandResult): CommandResult {
  if (result.envelope.ok || result.stderr !== undefined) return result;
  return { ...result, stderr: refusalText(result.envelope) };
}

function verdictData(verdict: TypeLawVerdict, extra: Record<string, unknown>) {
  return {
    findings: verdict.findings,
    summary: verdict.summary,
    coverage: verdict.coverage,
    unevaluated: verdict.unevaluated,
    caps: verdict.caps,
    ...extra,
  };
}

function refusedOrOk(verdict: TypeLawVerdict, data: Record<string, unknown>): CommandResult {
  return verdict.summary.errors > 0
    ? fail("gate", "findings", "findings", `${verdict.summary.errors} error finding(s)`, {
        data,
        hint: "each finding names its fix or its queue lane; an error on a line the commit did not touch is a warning",
      })
    : ok("gate", data);
}

/** The pre-commit stage: the index judged with HEAD as its base. */
async function preCommit(
  args: CommandArgs,
  state: JudgeState,
  law: TypeLaw,
  head: TypeLawResult | null,
): Promise<CommandResult> {
  const diff = headLawDiff(head, law);
  const configChanged = await lawStaged(args.root, law, head);
  const read = readPages(state, law);
  const collected = collectTypeLaw(state, law, { read, rulesChanged: diff.rulesChanged });
  const plans = generatedPlans({
    state,
    law,
    read,
    digests: { law: lawDigest(law, ENGINE_VERSION), content: stateContentDigest(state) },
    commands: args.commands,
  });
  const staged = await stagedGenerated(args.root);
  const drift: Unrouted[] =
    staged === null ? [] : driftFindings(plans, (path) => staged.get(path), "index");
  const found = [
    ...collected.found,
    ...drift,
    ...lawChangeFindings(diff.changes, { kind: "pre-commit" }),
  ];
  const scope = gateScope(found, state, read, configChanged);
  const verdict = verdictOfCollected(
    {
      found: scope.findings,
      coverage: collected.coverage,
      pages: scope.scoped ? scope.changed.size : collected.pages,
    },
    {
      ...capOptions(args),
      shellCoverage: {
        "generated-drift": {
          evaluated: staged === null ? 0 : plans.length,
          not_applicable: staged === null ? plans.length : 0,
          unevaluated: 0,
        },
      },
    },
  );
  return refusedOrOk(
    verdict,
    verdictData(verdict, {
      stage: "pre-commit",
      config_changed: configChanged,
      law_changes: diff.changes,
    }),
  );
}

/**
 * docs/cli.md §gate: git hands the commit-msg hook the message file relative
 * to the directory it runs the hook in (the repository's top level), or
 * absolute in a linked worktree. A relative path is read there, and else
 * against the bundle root.
 */
function messagePath(root: string, file: string): string | undefined {
  if (isAbsolute(file)) return existsSync(file) ? file : undefined;
  for (const candidate of [resolve(file), join(root, file)]) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

/** The commit-msg stage: the prefix, then the law diff against the message's reason. */
export function commitMessageStage(
  args: CommandArgs,
  law: TypeLaw,
  head: TypeLawResult | null,
  file: string,
): CommandResult {
  const path = messagePath(args.root, file);
  if (path === undefined) {
    return fail("gate", "not_found", "message-not-found", `no commit message file at "${file}"`);
  }
  const message = readFileSync(path, "utf8");
  const changes: LawChange[] = headLawDiff(head, law).changes;
  const findings = lawChangeFindings(changes, { kind: "commit-msg", message });
  const verdict = verdictOfFindings(findings, capOptions(args));
  const prefixes = law.engine.commit_prefixes;
  const prefix =
    prefixes.length === 0 ? null : commitPrefixVerdict({ prefixes: [...prefixes] }, message);
  const data = verdictData(verdict, {
    stage: "commit-msg",
    commit_prefixes: prefix,
    law_changes: changes,
  });
  if (prefix !== null && !prefix.known) {
    const valid = [...prefixes].sort(codeUnitCompare).join(", ");
    // A first line with no opening is a different mistake from an
    // unregistered word, and the refusal says which.
    const reason =
      prefix.prefix === "none"
        ? 'commit message opens with no "<prefix>:", "<prefix>(<scope>):" or "<prefix>!:"'
        : `commit message prefix "${prefix.prefix}" is not registered`;
    const refused = fail("gate", "findings", "commit-prefix", reason, {
      details: { prefix: prefix.prefix, valid_values: [...prefixes] },
      data,
    });
    return { ...refused, stderr: `wikiwright: ${reason} — use one of: ${valid}` };
  }
  return refusedOrOk(verdict, data);
}

async function run(args: CommandArgs): Promise<CommandResult> {
  const index = await readIndex(args.root);
  if (!index.ok) return withRefusalText(index.result);
  const state = index.value;
  const loaded = lawOf("gate", state);
  if (!loaded.ok) return withRefusalText(loaded.result);
  const law = loaded.law;
  // §7: the gate's envelope names the index's law and content.
  const identity = await typeLawIdentity(args.root, state, law);
  const mismatch = engineMismatch("gate", law);
  if (mismatch !== undefined) return withIdentity(withRefusalText(mismatch), identity);
  const head = await headLaw(args.root);
  const file = args.flags["commit-msg"];
  const result =
    typeof file === "string" && file.length > 0
      ? commitMessageStage(args, law, head, file)
      : await preCommit(args, state, law, head);
  return withIdentity(withRefusalText(result), identity);
}

export const gateCommand: CommandSpec = {
  name: "gate",
  role: "maintainer",
  summary:
    "Judge what the commit would contain: the index with HEAD as its base, the law diff, and under --commit-msg the message's prefix and its law-change line.",
  positionals: [],
  flags: [
    {
      name: "commit-msg",
      type: "string",
      summary:
        "the commit-msg stage: hold this message file to commit_prefixes, and a law change to a `law-change: <reason>` line",
    },
    { name: "limit", type: "string", summary: "cap the findings array (default 50)" },
    { name: "rule", type: "string", summary: "only findings with this rule id" },
    { name: "path", type: "string", summary: "only findings on this page" },
    { name: "all", type: "boolean", summary: "lift the findings cap" },
  ],
  examples: ["wikiwright gate", "wikiwright gate --commit-msg .git/COMMIT_EDITMSG"],
  writes: false,
  needsVaultModules: false,
  run,
};
