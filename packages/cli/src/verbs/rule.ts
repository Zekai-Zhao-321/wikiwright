// v2 contracts §9.4: `rule try --type <t> [--section <h>] --expr <cel>
// [--config <json>] [--base <ref>]` — a candidate rule, id `candidate`,
// severity error, evaluated over every page whose type is `<t>` or has it in
// its ancestry, under the working tree and, with `--base`, under the
// revision adapter; what it would refuse and pass, with locations; exit 0
// whatever the counts; nothing written.
//
// The candidate is admitted under the profile exactly as a declared rule is
// (`admitRule`, its static bound counted with the config given), attached to
// the type and every descendant in the law the state carries, and judged by
// the one judge, so a candidate refuses here what the rule would refuse once
// declared. The id is reserved: no declared rule may take it. New in v2; the
// old tree had no candidate rule.
import {
  admitRule,
  CANDIDATE_RULE,
  codeUnitCompare,
  collectTypeLaw,
  compileRule,
  type FindingLocation,
  isMapping,
  type JudgeState,
  type LawRule,
  type LawType,
  readPages,
  readYaml,
  type TypeLaw,
  verdictOfCollected,
} from "@wikiwright/core";
import { type CommandResult, fail, ok } from "../envelope.ts";
import { gitRefHead } from "../git.ts";
import { repositoryPlace } from "../lawfiles.ts";
import { fsState, revisionState } from "../lawstate.ts";
import type { CommandArgs, CommandSpec } from "../spec.ts";
import { lawOf, stateRefusal, typeLawIdentity, withIdentity } from "../typelaw.ts";

/** What the candidate does over one state. */
export interface TryOutcome {
  would_refuse: { path: string; location: FindingLocation }[];
  would_pass: string[];
  unevaluated: { path: string; reason: string }[];
  errors: { path: string; kind: string; message: string }[];
}

interface Candidate {
  type: string;
  section?: string;
  expr: string;
  config: Record<string, unknown>;
}

type Step<T> = { ok: true; value: T } | { ok: false; result: CommandResult };

function usage(code: string, message: string, details: Record<string, unknown>): Step<never> {
  return { ok: false, result: fail("rule", "usage", code, message, { details }) };
}

function candidateOf(args: CommandArgs): Step<Candidate> {
  const type = args.flags["type"];
  const expr = args.flags["expr"];
  if (typeof type !== "string" || type === "")
    return usage("missing-argument", "rule try needs --type <type>", {
      expected_flags: ["--type"],
    });
  if (typeof expr !== "string" || expr === "")
    return usage("missing-argument", "rule try needs --expr <cel>", { expected_flags: ["--expr"] });
  let config: Record<string, unknown> = {};
  const raw = args.flags["config"];
  if (typeof raw === "string") {
    // JSON is YAML 1.2: read as a rule's `config` is read, integers as ints.
    const read = readYaml(raw);
    if (!read.ok || !isMapping(read.value))
      return usage("config-invalid", "--config is not a JSON object", { flag: "config" });
    config = read.value;
  }
  const section = args.flags["section"];
  return {
    ok: true,
    value: {
      type,
      expr,
      config,
      ...(typeof section === "string" && section !== "" ? { section } : {}),
    },
  };
}

/** The law with the candidate attached to `type` and each type below it. */
function lawWithCandidate(
  law: TypeLaw,
  candidate: Candidate,
): Step<{ law: TypeLaw; governed: Set<string> }> {
  const target = law.types.get(candidate.type);
  if (target === undefined) {
    return {
      ok: false,
      result: fail(
        "rule",
        "not_found",
        "unknown-type",
        `the law declares no type "${candidate.type}"`,
        {
          details: { valid_values: [...law.types.keys()].sort(codeUnitCompare) },
        },
      ),
    };
  }
  if (
    candidate.section !== undefined &&
    !(target.sections?.list ?? []).some((s) => s.heading === candidate.section)
  ) {
    return usage(
      "rule-section-unknown",
      `${candidate.type} declares no section "${candidate.section}"`,
      { valid_values: (target.sections?.list ?? []).map((s) => s.heading) },
    );
  }
  const admission = admitRule(candidate.expr, candidate.config);
  if (!admission.ok) {
    return usage(
      "rule-invalid",
      `the candidate is refused under the profile: ${admission.message}`,
      {
        limit: admission.limit,
      },
    );
  }
  const rule: LawRule = {
    id: CANDIDATE_RULE,
    expr: candidate.expr,
    config: candidate.config,
    severity: "error",
    message: "the candidate rule refuses this",
    declaredBy: target.name,
    where: target.where,
    pointer: "/rules/candidate",
    ...(candidate.section === undefined ? {} : { section: candidate.section }),
  };
  const governed = new Set<string>();
  const types = new Map<string, LawType>();
  for (const [name, type] of law.types) {
    if (name === target.name || type.ancestry.includes(target.name)) {
      governed.add(name);
      types.set(name, { ...type, rules: [...type.rules, rule] });
    } else types.set(name, type);
  }
  const rules = new Map(law.rules);
  rules.set(CANDIDATE_RULE, compileRule(admission));
  return { ok: true, value: { law: { ...law, types, rules }, governed } };
}

/** The candidate over one state: every governed page refused, passed, unevaluated or in error. */
function tryOver(state: JudgeState, law: TypeLaw, governed: ReadonlySet<string>): TryOutcome {
  const read = readPages(state, law);
  const verdict = verdictOfCollected(collectTypeLaw(state, law, { read, lawTests: false }), {
    all: true,
  });
  const out: TryOutcome = { would_refuse: [], would_pass: [], unevaluated: [], errors: [] };
  const touched = new Set<string>();
  for (const f of verdict.findings) {
    if (f.rule === CANDIDATE_RULE) {
      out.would_refuse.push({ path: f.path, location: f.location });
      touched.add(f.path);
    } else if (f.details["rule"] === CANDIDATE_RULE && f.rule === "unevaluated") {
      out.unevaluated.push({ path: f.path, reason: String(f.details["reason"]) });
      touched.add(f.path);
    } else if (f.details["rule"] === CANDIDATE_RULE && f.rule === "rule-error") {
      out.errors.push({
        path: f.path,
        kind: String(f.details["kind"]),
        message: String(f.details["error"]),
      });
      touched.add(f.path);
    }
  }
  for (const page of read.pages) {
    const type = page.read.ok ? page.read.page.type?.name : undefined;
    if (type !== undefined && governed.has(type) && !touched.has(page.path))
      out.would_pass.push(page.path);
  }
  out.would_pass.sort(codeUnitCompare);
  return out;
}

async function run(args: CommandArgs): Promise<CommandResult> {
  const candidate = candidateOf(args);
  if (!candidate.ok) return candidate.result;
  let working: JudgeState;
  try {
    working = await fsState(args.root);
  } catch (e) {
    const refused = stateRefusal("rule", e);
    if (refused === undefined) throw e;
    return refused;
  }
  const loaded = lawOf("rule", working);
  if (!loaded.ok) return loaded.result;
  const identity = await typeLawIdentity(args.root, working, loaded.law);
  const attached = lawWithCandidate(loaded.law, candidate.value);
  if (!attached.ok) return withIdentity(attached.result, identity);
  const data: Record<string, unknown> = {
    candidate: { id: CANDIDATE_RULE, ...candidate.value, severity: "error" },
    working: tryOver(working, attached.value.law, attached.value.governed),
  };
  const ref = args.flags["base"];
  if (typeof ref === "string" && ref !== "") {
    const { top } = await repositoryPlace(args.root);
    if ((await gitRefHead(top, `${ref}^{commit}`)) === null) {
      return withIdentity(
        fail("rule", "not_found", "revision-not-found", `no commit answers to "${ref}"`, {
          details: { base: ref },
        }),
        identity,
      );
    }
    const revision = await revisionState(args.root, ref);
    const baseLaw = lawOf("rule", revision);
    if (!baseLaw.ok) return withIdentity(baseLaw.result, identity);
    const atBase = lawWithCandidate(baseLaw.law, candidate.value);
    if (!atBase.ok) return withIdentity(atBase.result, identity);
    data["base"] = { ref, ...tryOver(revision, atBase.value.law, atBase.value.governed) };
  }
  return withIdentity(ok("rule", data), identity);
}

export const ruleCommand: CommandSpec = {
  name: "rule",
  role: "maintainer",
  summary:
    "Try a candidate CEL rule over the pages of a type before it is law: what it would refuse and pass, under the working tree and at a base revision.",
  positionals: [{ name: "subcommand", required: true }],
  subcommands: ["try"],
  flags: [
    {
      name: "type",
      type: "string",
      summary: "the type the candidate attaches to, and every type below it",
    },
    { name: "section", type: "string", summary: "a section rule: the heading it is evaluated at" },
    { name: "expr", type: "string", summary: "the candidate's CEL expression, under the profile" },
    { name: "config", type: "string", summary: "the candidate's config, a JSON object" },
    {
      name: "base",
      type: "string",
      summary: "a revision to try it at too, under the revision adapter",
    },
  ],
  examples: [
    'wikiwright rule try --type planting --expr "has(page.fields.source)"',
    'wikiwright rule try --type planting --section History --expr "section.items.all(i, i.precision == \\"day\\")" --base HEAD',
  ],
  writes: false,
  run,
};
