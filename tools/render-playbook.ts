// docs/skills/wikiwright-maintain/finding-response.md, the playbook, is
// GENERATED from the verdict table (packages/core/src/verdict/table.ts): every
// code the judge and the verbs beside it emit, with its severity and its
// route, so "the playbook names every code the binary prints" is a tautology
// plus a guard (skills.test.ts) rather than a promise a hand-written file
// keeps until someone forgets.
//
// Run: `bun tools/render-playbook.ts` (writes) or `--check` (compares).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  codeUnitCompare,
  RULE_LANE,
  VERDICT_TABLE,
  type VerdictRow,
} from "../packages/core/src/index.ts";

const OUT = fileURLToPath(
  new URL("../docs/skills/wikiwright-maintain/finding-response.md", import.meta.url),
);

function severityOf(row: VerdictRow): string {
  return row.severity === "declared" ? "the rule's own" : `\`${row.severity}\``;
}

/** The row's route, as the judge derives it. */
function routeText(row: VerdictRow): string {
  if (row.fix !== undefined) {
    const argv = `\`${row.fix.join(" ")}\``;
    return row.fixWhen === undefined
      ? `fix ${argv}`
      : `fix ${argv} where \`details.${row.fixWhen}\`, else queue \`${row.lane ?? "—"}\``;
  }
  if (row.lane !== undefined) return `queue \`${row.lane}\``;
  return "none: an info finding";
}

function carriesText(row: VerdictRow): string {
  return row.carries.length === 0 ? "—" : row.carries.map((id) => `\`${id}\``).join(", ");
}

export function renderPlaybook(): string {
  const lanes = [
    ...new Set(VERDICT_TABLE.map((r) => r.lane).filter((l): l is string => l !== undefined)),
  ].sort(codeUnitCompare);
  const section = (title: string, scope: VerdictRow["scope"]): string[] => [
    `## ${title}`,
    "",
    "| code | severity | route | carries the v1 ids |",
    "|---|---|---|---|",
    ...VERDICT_TABLE.filter((row) => row.scope === scope).map(
      (row) =>
        `| \`${row.id}\` | ${severityOf(row)} | ${routeText(row)}${row.needsBase === true ? "; a transition, `unevaluated` without a base" : ""} | ${carriesText(row)} |`,
    ),
    "",
  ];
  return [
    "# Responding to a finding",
    "",
    "**Generated** by `tools/render-playbook.ts` from the verdict table, every code",
    "the judge and the verbs beside it emit. Do not edit: a hand-maintained list of",
    "the codes the binary prints is a list that goes stale on the next change.",
    "",
    "## The whole instruction, in two sentences and one clause",
    "",
    "If a finding has `fix`, run its `argv`. If it has `queue`, it is a judgment",
    "for the bundle's maintainer: continue. And at the gate, a queued error on a",
    "line the commit did not touch is a warning (`details.demoted_from`), not a block.",
    "",
    "An `info` finding carries neither: it is a census row, and the count is the",
    "point.",
    "",
    ...section("A page", "page"),
    ...section("The vault as a whole", "vault"),
    ...section("The law itself: rule tests, examples, the law diff", "law"),
    ...section("Beside the judge: pins, generated files, base OKF", "shell"),
    "## A rule the law declares",
    "",
    "A CEL rule a type or a fragment declares is its own row, under its own id:",
    `its severity is the one it declares, and it routes to the queue \`${RULE_LANE}\`.`,
    "`rule-error` is a rule that did not evaluate to a boolean; `rule-untested`",
    "a rule with no negative, repaired or positive test page, a warning under",
    "`check` and an error at the gate for a rule the commit adds or changes.",
    "",
    "## The queues",
    "",
    `The lane set is closed: ${lanes.map((l) => `\`${l}\``).join(", ")}.`,
    "",
    "A lane is a human queue. Its depth is the evidence a rule is ready to ratchet",
    "from warning to error, which is why a queued finding is counted rather than",
    "silenced; `generated/queue.md` holds the queue of the pages as they stand.",
    "",
    "## Exceptions",
    "",
    "A finding you have judged and ruled intentional is excepted on the page, with",
    "a reason, through the page's own `exceptions:` key (`{rule, reason}`) — never",
    "by lowering a severity. An excepted finding stays visible as",
    "`exception-applied`; an exception that closes nothing is `exception-stale`, and",
    "one naming no rule, or a law a page may not waive, is `exception-illegal`.",
    "",
  ].join("\n");
}

if (import.meta.main) {
  const wanted = renderPlaybook();
  if (process.argv.includes("--check")) {
    const found = readFileSync(OUT, "utf8");
    if (found !== wanted) {
      process.stderr.write("finding-response.md is not what the generator renders\n");
      process.exitCode = 1;
    }
  } else {
    writeFileSync(OUT, wanted);
  }
}
