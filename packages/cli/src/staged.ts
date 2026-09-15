// docs/cli.md §hook, docs/cli.md §gate (the staged gate over a COMPLETE virtual
// post-index vault — the index and HEAD readers' one caller) · docs/cli.md
// docs/architecture.md §Directories (`lint --staged` and `gate` share this, so it is a named
// module rather than a block between two verb specs). Both gates are readers.

import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import {
  buildNameIndex,
  codeUnitCompare,
  commitPrefixVerdict,
  type Finding,
  generateArtifacts,
  judge,
  parsedPages,
} from "@wikiwright/core";
import { type CommandResult, capOptions, fail, ok, verdictEnvelope } from "./envelope.ts";
import { checkEnginePin, generateOptionsFor, lawFor, rootsOf, type VaultOk } from "./law.ts";
import { formerFolderTagFindings } from "./pages.ts";
import type { CommandArgs } from "./spec.ts";
import { type IndexState, indexSnapshot, indexState } from "./state.ts";
import { loadVault, loadVaultVia } from "./vaultio.ts";

/**
 * docs/cli.md §gate: `generated-drift` over the STAGED state. The artifacts are
 * rebuilt from the index's pages and compared with the index's bytes under
 * generated/ — never with the working tree's, whose artifacts describe
 * whatever the tree holds. So a partial staging whose staged generated/
 * describes exactly the staged pages passes, and a staging that forgot to
 * regenerate fails with the artifact named. A bundle that tracks none of its
 * artifacts is not judged on them here (`check` is where an untracked
 * artifact reads as missing); the coverage row says the pass did not run.
 */
function stagedDriftFindings(
  state: IndexState,
  vault: VaultOk,
): { judged: boolean; findings: Finding[] } {
  const pages = parsedPages(state);
  const plans = generateArtifacts(
    vault.registry,
    pages,
    buildNameIndex(pages),
    generateOptionsFor(vault),
  );
  if (!plans.some((plan) => state.reader.exists(plan.path))) return { judged: false, findings: [] };
  const findings: Finding[] = [];
  for (const plan of plans) {
    const staged = state.reader.exists(plan.path) ? state.reader.read(plan.path) : undefined;
    if (staged === plan.content) continue;
    findings.push({
      ruleId: "generated-drift",
      severity: "error",
      path: plan.path,
      message:
        staged === undefined
          ? "the index carries no such artifact, and the staged pages rebuild one"
          : "the staged artifact does not describe the staged pages",
      remediation:
        "run `wikiwright check --write` while the working tree holds the pages being staged, then stage generated/ with them",
      contributedBy: "engine",
      layer: "constitution",
    });
  }
  return { judged: true, findings };
}

export async function runStagedLint(args: CommandArgs, command = "lint"): Promise<CommandResult> {
  let state: ReturnType<typeof indexState>;
  let snapshot: ReturnType<typeof indexSnapshot>;
  try {
    snapshot = indexSnapshot(args.root);
    if (snapshot.changes.some((ch) => ch.status === "U")) {
      return fail(command, "conflict", "unmerged-paths", "the index has unmerged paths", {
        hint: "resolve the merge conflicts, stage the resolutions, then rerun",
      });
    }
    // The roots are not known until the STAGED constitution loads, and the
    // constitution is read through this same index — so the first pass walks
    // nothing and the second walks the roots the law names, both over one
    // snapshot of the index, so its diff and its listing are read once.
    state = indexState(args.root, [], snapshot);
  } catch (e) {
    return fail(command, "conflict", "git-unavailable", `git plumbing failed: ${String(e)}`, {
      hint: "the staged gate runs inside a git repository",
    });
  }
  const vault = loadVaultVia(command, state.reader, { root: args.root });
  if (!vault.ok) return vault.result;
  // The pin is judged BEFORE any page is - against the STAGED
  // constitution, the one the commit would contain.
  const pin = command === "gate" ? checkEnginePin(command, vault.engine) : undefined;
  if (pin !== undefined) return pin;
  const roots = rootsOf(vault);
  // Compared against the LOADED roots, not against a constant the
  // engine no longer has. The first pass walked no roots, so this always rebuilds
  // when the bundle declares any.
  if (roots.length > 0) state = indexState(args.root, roots, snapshot);
  const configChanged = state.configChanged;

  // The diff-driven review is a property of the RENAME, not of the page,
  // so it rides in beside the judge's own vault passes.
  const shellFindings: Finding[] = [];
  const docs = new Map(parsedPages(state).map((page) => [page.path, page.doc] as const));
  for (const rename of state.renames ?? []) {
    const doc = docs.get(rename.to);
    if (doc === undefined) continue;
    shellFindings.push(...formerFolderTagFindings(rename.from, rename.to, doc, roots));
  }
  const drift = stagedDriftFindings(state, vault);
  shellFindings.push(...drift.findings);
  const verdict = judge(state, lawFor(vault), {
    ...capOptions(args),
    gate: true,
    configChanged,
    shellFindings,
    shellPasses: ["former-folder-tags-review", ...(drift.judged ? ["generated-drift"] : [])],
  });
  const data = verdictEnvelope(verdict);
  if (verdict.summary.errors > 0) {
    return fail(command, "findings", "findings", `${verdict.summary.errors} error finding(s)`, {
      data,
      hint: "each finding carries its rule id, provenance, and remediation",
    });
  }
  return ok(command, data);
}

/**
 * docs/cli.md §hook: git passes this path relative at a repository's top
 * level and ABSOLUTE in a linked worktree — joining the absolute form onto the
 * root produced a path that cannot exist, so every commit in a linked worktree
 * was refused as message-not-found.
 */
export function commitMsgPath(root: string, messageFile: string): string {
  return isAbsolute(messageFile) ? messageFile : join(root, messageFile);
}

/**
 * docs/cli.md: the commit-msg hook's verb. A registered prefix passes;
 * an unknown one is refused with ONE line on stderr naming the valid set — the
 * envelope stays on stdout, where a machine reader expects it. A bundle that
 * declares no prefixes is answered with `commit_prefixes: null` and judges
 * nothing.
 */
export function runCommitMsgGate(root: string, messageFile: string): CommandResult {
  const vault = loadVault("gate", root);
  if (!vault.ok) return vault.result;
  const policy = vault.engine.commit_prefixes;
  if (policy === undefined) return ok("gate", { commit_prefixes: null });
  const abs = commitMsgPath(root, messageFile);
  if (!existsSync(abs)) {
    return fail(
      "gate",
      "not_found",
      "message-not-found",
      `no commit message file at "${messageFile}"`,
    );
  }
  const verdict = commitPrefixVerdict(policy, readFileSync(abs, "utf8"));
  if (verdict.known) return ok("gate", { ...verdict });
  const valid = [...policy.prefixes].sort(codeUnitCompare).join(", ");
  // A first line with no opening is a different mistake from an unregistered
  // word, and the refusal says which; `docs(wiki):` once read as "none" here.
  const reason =
    verdict.prefix === "none"
      ? 'commit message opens with no "<prefix>:", "<prefix>(<scope>):" or "<prefix>!:"'
      : `commit message prefix "${verdict.prefix}" is not registered`;
  const result = fail("gate", "findings", "commit-prefix", reason, {
    details: { prefix: verdict.prefix, valid_values: [...policy.prefixes] },
  });
  return { ...result, stderr: `wikiwright: ${reason} — use one of: ${valid}` };
}
