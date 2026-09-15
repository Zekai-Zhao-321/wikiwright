// docs/cli.md §skills, docs/architecture.md §The invariants: the lint-response playbook is GENERATED
// from the composed pass table — the kernel's rows plus the standard library's
// arms — and the fixer registry, so "the playbook names every id the binary
// prints" is a tautology plus a guard rather than a promise a hand-written file
// keeps until someone forgets.
//
// Run: `bun tools/render-playbook.ts` (writes) or `--check` (compares).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  codeUnitCompare,
  FIXER_REGISTRY,
  type PassRow,
  passRows,
  routeOf,
  standardLibrary,
} from "../packages/core/src/index.ts";

const OUT = fileURLToPath(
  new URL("../packages/cli/skills/wikiwright-maintain/lint-response.md", import.meta.url),
);

function severityOf(row: PassRow): string {
  return row.severity === "declared" ? "the section's own `severity`" : `\`${row.severity}\``;
}

/** The engine's own derivation, with the fixer's applicability beside a fixer route. */
function routeText(row: PassRow): string {
  const route = routeOf(row);
  if (row.fixer !== undefined && route === row.fixer) {
    const entry = FIXER_REGISTRY[row.fixer];
    const condition = entry?.enabled === undefined ? "" : ", where the bundle's mode admits it";
    return `fixer \`${row.fixer}\` (${entry?.applicability ?? "?"}${condition}) — else queue \`${row.lane ?? "—"}\``;
  }
  if (row.advisory !== undefined) return `advisory: \`${row.advisory}\``;
  if (row.lane !== undefined) return `queue \`${row.lane}\``;
  return "census — nothing to route";
}

export function renderPlaybook(): string {
  const modules = standardLibrary();
  const rows = passRows(modules);
  const lanes = [...modules.lanes].sort(codeUnitCompare);
  const byKind = (kind: PassRow["kind"]): PassRow[] => rows.filter((r) => r.kind === kind);
  const section = (title: string, rows: readonly PassRow[]): string[] => [
    `## ${title}`,
    "",
    "| id | severity | route |",
    "|---|---|---|",
    ...rows.map((row) => `| \`${row.id}\` | ${severityOf(row)} | ${routeText(row)} |`),
    "",
  ];
  return [
    "# Responding to a finding",
    "",
    "**Generated** by `tools/render-playbook.ts` from the pass table — the kernel's",
    "rows and the standard library's arms — and the fixer registry. Do not edit: a",
    "hand-maintained list of the ids the binary prints is a",
    "list that goes stale on the next slice, which is how a manual came to be silent",
    "about eleven arms its own `check` was reporting.",
    "",
    "## The whole instruction, in two sentences and one clause",
    "",
    "If a finding has `fix`, run its `argv` — filling any placeholders first. If it has",
    "`queue`, it is not yours: continue. And a queued finding on a line you did not",
    "write is a warning, not a block.",
    "",
    "An `info` finding carries neither: it is a census row, and the count is the point.",
    "The one exception you may act on deliberately is `canonical-form`, whose fixer runs",
    "only when you name the rule.",
    "",
    "## Applicability",
    "",
    "- **MachineApplicable** — the engine derived the exact ops and proves them gone.",
    "- **MaybeIncorrect** — the op is right by the engine's preference, not by law; it",
    "  applies only under an explicit `--expect N` naming the rule.",
    "- **HasPlaceholders** — the rendering carries `<...>` you must fill. `--propose`",
    "  prints it; no count ever applies it.",
    "",
    ...section("LAW — always on", byKind("LAW")),
    ...section("POLICY — off unless the bundle declares its key", byKind("POLICY")),
    ...section("type-declared — on where a type says so", byKind("type-declared")),
    "## The queues",
    "",
    `The lane set is closed: ${lanes.map((l) => `\`${l}\``).join(", ")}.`,
    "",
    "A lane is a human queue. Its depth is the evidence a row is ready to ratchet from",
    "warning to error, which is why a queued finding is counted rather than silenced.",
    "",
    "## Waivers",
    "",
    "A finding you have judged and ruled intentional is waived on the page, with a",
    "reason, through the page's own `exceptions:` block — never by lowering a severity.",
    "A waiver naming a fix-routed row or a parse law is illegal, and a waiver matching",
    "no finding is stale; both are findings of their own.",
    "",
  ].join("\n");
}

const wanted = renderPlaybook();
if (process.argv.includes("--check")) {
  const found = readFileSync(OUT, "utf8");
  if (found !== wanted) {
    process.stderr.write("lint-response.md is not what the generator renders\n");
    process.exitCode = 1;
  }
} else {
  writeFileSync(OUT, wanted);
}
