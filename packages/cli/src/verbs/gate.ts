// docs/cli.md §hook, docs/cli.md: the hooks' entry point — the engine pin first,
// then the staged vault, or the commit message. A pure reader: judging the
// staged vault writes nothing, and so does refusing a commit-message prefix.

import type { Finding } from "@wikiwright/core";
import type { CommandResult, ErrEnvelope } from "../envelope.ts";
import type { CommandSpec } from "../spec.ts";
import { runCommitMsgGate, runStagedLint } from "../staged.ts";

interface VerdictData {
  findings?: Finding[];
  summary?: { errors?: number; by_rule?: Record<string, number> };
}

/**
 * docs/cli.md §hook: what the hook prints when it refuses a commit. The
 * envelope stays on stdout for a machine reader; a refused commit is read by
 * whoever typed `git commit`, and what they need is the rule census, the
 * error findings — rule, path, line, message, remediation — and the one line
 * saying how to see the rest. Never the coverage block: the two findings that
 * blocked a commit sat on lines 200–230 of a 700-line envelope.
 */
function refusalText(envelope: ErrEnvelope): string {
  const data = (envelope.data ?? {}) as VerdictData;
  const lines: string[] = [];
  if (envelope.error.code === "findings" && data.summary !== undefined) {
    lines.push(`wikiwright gate: ${data.summary.errors ?? 0} error finding(s) block this commit`);
    const byRule = Object.entries(data.summary.by_rule ?? {}).map(([rule, n]) => `${rule} ${n}`);
    if (byRule.length > 0) lines.push(`  by rule: ${byRule.join(", ")}`);
    for (const f of (data.findings ?? []).filter((f) => f.severity === "error")) {
      const at = f.line === undefined ? f.path : `${f.path}:${f.line}`;
      lines.push(`  error ${f.ruleId} ${at} — ${f.message}`);
      if (f.remediation !== undefined) lines.push(`    remediation: ${f.remediation}`);
    }
    lines.push("run `wikiwright gate --all` for the whole envelope");
    return lines.join("\n");
  }
  lines.push(`wikiwright gate: ${envelope.error.code} — ${envelope.error.message}`);
  if (envelope.error.hint !== undefined) lines.push(`  hint: ${envelope.error.hint}`);
  lines.push("run `wikiwright gate` for the whole envelope");
  return lines.join("\n");
}

/** A refusal with nothing on stderr yet gets the summary; the prefix refusal keeps its one line. */
function withRefusalText(result: CommandResult): CommandResult {
  if (result.envelope.ok || result.stderr !== undefined) return result;
  return { ...result, stderr: refusalText(result.envelope) };
}

export const gateCommand: CommandSpec = {
  name: "gate",
  role: "maintainer",
  summary: "The hooks' entry point: check the engine pin, then judge the staged vault.",
  positionals: [],
  flags: [
    {
      name: "commit-msg",
      type: "string",
      summary: "judge a commit message file against commit_prefixes",
    },
    { name: "limit", type: "string", summary: "cap the findings array (default 50)" },
    { name: "rule", type: "string", summary: "only findings with this rule id" },
    { name: "path", type: "string", summary: "only findings on this page" },
    { name: "all", type: "boolean", summary: "lift the findings cap" },
  ],
  examples: ["wikiwright gate", "wikiwright gate --commit-msg .git/COMMIT_EDITMSG"],
  writes: false,
  needsVaultModules: true,
  run: async (args) => {
    const messageFile = args.flags["commit-msg"];
    if (typeof messageFile === "string" && messageFile.length > 0) {
      return withRefusalText(runCommitMsgGate(args.root, messageFile));
    }
    return withRefusalText(await runStagedLint(args, "gate"));
  },
};
