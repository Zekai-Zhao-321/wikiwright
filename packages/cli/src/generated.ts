// v2 contracts §2 (`generated/` holds BRIEF.md, manifest.json, graph.json,
// tag-catalog.md, queue.md) · §9.1 (`check --write` regenerates them) · §9.2
// (the gate judges `generated/*` as staged).
//
// One generation path for the v2 table: the kernel's four artifacts
// (`typeLawArtifacts`) and the brief, rendered here because it renders the
// command registry. `check` compares the plans with the working tree and
// writes them under `--write`; the gate compares them with the index. The
// queue is cut from a judge run with no base over the same pages, so the
// working tree and the index cut the same queue from the same bytes.
//
// The brief keeps what the old one said a reader needs — the loop, what to
// do with a finding, every verb with its usage and first example, the types
// with the case for each, the vocabularies as declared, the names — and the
// three roles survive as its three sections (§1). Not ported: the census of
// the vocabularies as the vault uses them, which moved to `type show --brief`
// with the live counts, the modules' skill fragments (modules leave), and
// the pass counts of the old pass table.
import {
  type Collected,
  codeUnitCompare,
  collectTypeLaw,
  type JudgeState,
  type QueueDigests,
  type StateRead,
  type TypeLaw,
  type TypeLawArtifact,
  typeLawArtifacts,
  type Unrouted,
  verdictOfCollected,
} from "@wikiwright/core";
import { type CommandSpec, flagsOf } from "./spec.ts";

export const BRIEF_PATH = "generated/BRIEF.md";

/** The paths `check --write` writes, in path order. */
export const GENERATED_PATHS: readonly string[] = [
  BRIEF_PATH,
  "generated/graph.json",
  "generated/manifest.json",
  "generated/queue.md",
  "generated/tag-catalog.md",
];

const PRINCIPLE =
  "Use the engine to decide, to write and to attribute; use your own tools to look.";

/** What each verb of the v2 table is for, in the loop's words. */
const WORKFLOW: Readonly<Record<string, string>> = {
  check: "the whole bundle, its pins and its generated files",
  gate: "what a commit would contain, run by the hooks",
  write: "the one write: a directory of drafts and an optional ops.json, judged together",
  rule: "a candidate rule over the pages it would govern, before it is law",
  read: "a page's sections, its digest and its status",
  search: "before creating anything, and before claiming absence; each result carries its status",
  type: "the contract you are about to satisfy, with its skeleton",
  version: "which engine build is answering",
};

const SECTIONS: readonly { heading: string; lines: readonly string[] }[] = [
  {
    heading: "Reading (the consumer)",
    lines: [
      "1. `search` every name form, in both scripts, before you say a thing is absent; never claim absence while `caps.hit` is true.",
      "2. `read` the sections the task needs. Keep the envelope's `metadata.bundle` and the page's `bytes` digest beside what you took.",
      "3. Read `status` on every page you use: `stale: true` or an `unresolved` rule is material due for reconsideration, not settled knowledge.",
      "4. Report a knowledge problem as a proposal to the bundle's maintainer; never edit a bundle you were given to read.",
    ],
  },
  {
    heading: "Writing (the writer)",
    lines: [
      "1. `search` every name form before you create anything.",
      "2. `type show <type> --brief`: the contract, the skeleton to write from, the vocabularies with live counts.",
      "3. Draft the pages in a directory that mirrors the vault's paths, with an `ops.json` for a move, a retirement, a retraction or a supersession; `write --from <dir> --dry-run` and read the findings.",
      "4. `write --from <dir>`: the batch is judged together and lands only whole; the engine stamps `created` and `updated` where the type declares them.",
      "5. Commit. The gate runs the same judge over what the commit would contain.",
    ],
  },
  {
    heading: "Maintaining (the maintainer)",
    lines: [
      "1. `check` the whole bundle. A finding with `queue` is a judgment: adjudicate it or change the law, and never lower a severity to quiet it.",
      "2. A rule learned from a defect: `rule try` it first, then add it with its rule tests (a negative page, its repaired twin, a positive page).",
      "3. A commit that relaxes the law carries a body line `law-change: <reason>`; a decision page records why.",
      "4. `check --write` and commit `generated/` with the pages it describes.",
    ],
  },
];

function verbLines(spec: CommandSpec): string[] {
  const flags = flagsOf(spec)
    .map((f) => (f.type === "string" ? `--${f.name} <v>` : `--${f.name}`))
    .join(" ");
  const positionals = spec.positionals
    .map((p) =>
      p.name === "subcommand" && spec.subcommands !== undefined
        ? `<${spec.subcommands.join("|")}>`
        : p.required
          ? `<${p.name}>`
          : `[${p.name}]`,
    )
    .join(" ");
  return [
    `### \`${spec.name}\` — ${WORKFLOW[spec.name] ?? spec.summary}`,
    "",
    `\`wikiwright ${spec.name}${positionals === "" ? "" : ` ${positionals}`}\`${flags === "" ? "" : ` — flags: ${flags}`}`,
    "",
    ...(spec.examples[0] === undefined ? [] : ["```text", spec.examples[0], "```", ""]),
  ];
}

/** §2 BRIEF.md: the bundle's brief, a function of the law and the registry. */
export function renderTypeLawBrief(
  law: TypeLaw,
  lawDigest: string,
  commands: readonly CommandSpec[],
): string {
  const types = [...law.types.values()]
    .filter((t) => !t.abstract)
    .sort((a, b) => codeUnitCompare(a.name, b.name));
  const vocabularies = [...law.vocabularies.values()].sort((a, b) =>
    codeUnitCompare(a.name, b.name),
  );
  const verbs = [...commands].sort((a, b) => codeUnitCompare(a.name, b.name));
  return [
    `# wikiwright — the brief of \`${law.engine.label}\``,
    "",
    "Generated file — do not edit; regenerate with `wikiwright check --write`.",
    "",
    `Law digest: \`${lawDigest}\``,
    "",
    "## The loop",
    "",
    PRINCIPLE,
    "",
    ...SECTIONS.flatMap((section) => [`### ${section.heading}`, "", ...section.lines, ""]),
    "## Findings",
    "",
    "A finding with `fix` names the argv that repairs it. A finding with `queue` is a",
    "judgment for the maintainer; at the gate, a queued error on a line the commit did",
    "not touch is a warning, not a block. An `unevaluated` finding is a check this",
    "state could not make, never a pass.",
    "",
    "## Verbs",
    "",
    ...verbs.flatMap(verbLines),
    "## Types",
    "",
    ...(types.length === 0
      ? ["No concrete type is declared."]
      : types.map((t) => `- \`${t.name}\` (${t.role}) — ${t.use_when ?? t.description}`)),
    "",
    "## Vocabularies",
    "",
    ...vocabularies.flatMap((v) => {
      const entries = [...v.entries].sort(([a], [b]) => codeUnitCompare(a, b));
      const retired = [...v.retired].sort(([a], [b]) => codeUnitCompare(a, b));
      return [
        `### \`${v.name}\` (${v.mode})`,
        "",
        ...(entries.length === 0 ? ["No entry is declared."] : []),
        ...entries.map(
          ([name, e]) => `- \`${name}\`${e.description === undefined ? "" : ` — ${e.description}`}`,
        ),
        ...retired.map(
          ([name, r]) =>
            `- \`${name}\` (retired${r.successor === undefined ? "" : `; use \`${r.successor}\``})`,
        ),
        "",
      ];
    }),
    "## Names",
    "",
    "A page's name is its file's basename. A wikilink names a page by that name, never",
    "by an alias: write `[[Canonical|what you meant]]`. A page whose title is not Latin",
    "carries a Latin alias, so both scripts find it.",
    "",
  ].join("\n");
}

/**
 * Every generated file of a state under its law: the kernel's four and the
 * brief. The queue is cut from a judge run with no base over the state's
 * pages — the working tree's, or the index's at the gate — so it is a
 * function of the law and the content only.
 */
export function generatedPlans(input: {
  state: JudgeState;
  law: TypeLaw;
  read: StateRead;
  digests: QueueDigests;
  commands: readonly CommandSpec[];
  /** The state's own collection, when the state has no base: the queue's run, already made. */
  unbased?: Collected;
}): TypeLawArtifact[] {
  const { state, law, read, digests } = input;
  const unbased: JudgeState = { kind: "working-tree", law: state.law, pages: state.pages };
  if (state.skipped !== undefined) unbased.skipped = state.skipped;
  // The same parse, each page's base left out: what a page says does not
  // depend on its base, and the queue reads no base.
  const unbasedRead: StateRead = {
    ...read,
    pages: read.pages.map((p) => ({ ...p, base: undefined })),
  };
  const collected = input.unbased ?? collectTypeLaw(unbased, law, { read: unbasedRead });
  const queue = verdictOfCollected(collected, { all: true });
  return [
    { path: BRIEF_PATH, content: renderTypeLawBrief(law, digests.law, input.commands) },
    ...typeLawArtifacts(law, read, queue.findings, digests),
  ].sort((a, b) => codeUnitCompare(a.path, b.path));
}

/**
 * `generated-drift`: each planned file against the bytes the state holds for
 * it — the working tree's under `check`, the index's at the gate.
 */
export function driftFindings(
  plans: readonly TypeLawArtifact[],
  holds: (path: string) => string | undefined,
  where: "working-tree" | "index",
): Unrouted[] {
  const out: Unrouted[] = [];
  for (const plan of plans) {
    const held = holds(plan.path);
    if (held === plan.content) continue;
    out.push({
      rule: "generated-drift",
      severity: "error",
      path: plan.path,
      location: { kind: "page" },
      message:
        held === undefined
          ? where === "index"
            ? "the index carries no such file, and the staged pages render one"
            : "the generated file is missing"
          : where === "index"
            ? "the staged file does not describe the staged pages and law"
            : "the generated file differs from a fresh render",
      details: { artifact: plan.path, state: where },
    });
  }
  return out;
}
