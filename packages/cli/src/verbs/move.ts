// docs/cli.md §move (a move states its reason, runs git mv, and SURFACES tag
// findings rather than editing tags) (the rename
// ritual as a verb — the old basename lands in `aliases` through the Writer, so
// `renamed-without-alias` cannot fire after a move, and inbound links are
// rewritten on request) · docs/concepts.md §Findings and routing · docs/architecture.md

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  basenameOf,
  buildNameIndex,
  fixOpsFor,
  judge,
  lintPage,
  normalizeIdentity,
  parseDoc,
  routeFindings,
} from "@wikiwright/core";
import { fail, ok } from "../envelope.ts";
import { lawFor, lintOptionsFor, moveReasonsOf, rootsOf } from "../law.ts";
import { collectPages, formerFolderTagFindings, sortFindings } from "../pages.ts";
import { contentPathRefusal } from "../paths.ts";
import { type CommandArgs, type CommandSpec, isDryRun, type Plan, planOf } from "../spec.ts";
import { fsState } from "../state.ts";
import { loadVault, readPage, walkPages } from "../vaultio.ts";
import { commitWrite, splicePlan, writeOps } from "../writer.ts";

/**
 * docs/cli.md §The dry-run law: a move is exactly one `git mv`, and the reason is part of
 * what it would do — a plan that omitted it would describe a different verb.
 */
function planForMove(args: CommandArgs): Plan {
  const [from, to] = args.positionals;
  if (from === undefined || to === undefined) return planOf([]);
  if (!existsSync(join(args.root, from)) || existsSync(join(args.root, to))) return planOf([]);
  const reason = args.flags["reason"];
  return planOf([
    {
      kind: "rename",
      path: to,
      // The page DISAPPEARS from `from`, and an agent reading `ops`
      // could not see that when the op carried one path.
      from,
      summary: `git mv ${from} → ${to}${typeof reason === "string" ? ` (${reason})` : ""}`,
    },
    ...(basenameOf(from) === basenameOf(to) || args.flags["rename"] !== true
      ? []
      : writeOps(
          to,
          "write",
          `append the old basename "${basenameOf(from)}" to aliases (the rename ritual)`,
        )),
  ]);
}

export const moveCommand: CommandSpec = {
  name: "move",
  role: "maintainer",
  summary: "Move a page with a stated reason; surfaces tag findings, never edits tags.",
  positionals: [
    { name: "from", required: true },
    { name: "to", required: true },
  ],
  flags: [
    { name: "reason", type: "string", summary: "the stated justification for the move" },
    {
      name: "rename",
      type: "boolean",
      summary: "admit a basename change: the rename ritual, performed rather than reported",
    },
    {
      name: "rewrite-links",
      type: "boolean",
      summary: "rewrite inbound wikilinks through link-rewrite (default: report only)",
    },
  ],
  examples: [
    "wikiwright move wiki/a/x.md wiki/b/x.md --reason activity-boundary",
    "wikiwright move wiki/a/Ana.md wiki/a/Anna.md --reason browse-misleading --rename --rewrite-links",
  ],
  writes: true,
  needsVaultModules: true,
  plan: planForMove,
  run: async (args) => {
    const vault = loadVault("move", args.root);
    if (!vault.ok) return vault.result;
    const [rawFrom, rawTo] = args.positionals;
    if (rawFrom === undefined || rawTo === undefined) {
      return fail("move", "usage", "missing-argument", "move requires <from> and <to>");
    }
    const from = rawFrom.normalize("NFC");
    const to = rawTo.normalize("NFC");
    const roots = rootsOf(vault);
    for (const [label, path] of [
      ["<from>", from],
      ["<to>", to],
    ] as const) {
      const pathRefused = contentPathRefusal(args.root, path, roots);
      if (pathRefused !== undefined) {
        return fail("move", "usage", "invalid-path", `${label} ${pathRefused}`);
      }
    }
    // docs/cli.md §move: a move states its reason. The bundle may close the set in
    // engine.json (`move_reasons`); where it declares none, any non-empty
    // justification is one — the engine ships no vocabulary of its own.
    const reason = args.flags["reason"];
    const declared = moveReasonsOf(vault);
    if (typeof reason !== "string" || reason.length === 0) {
      return fail("move", "usage", "missing-argument", "a move states its reason (--reason)", {
        ...(declared === undefined ? {} : { details: { valid_values: [...declared] } }),
      });
    }
    if (declared !== undefined && !declared.includes(reason)) {
      return fail(
        "move",
        "usage",
        "invalid-reason",
        `"${reason}" is not one of the justifications this bundle declares`,
        { details: { valid_values: [...declared] } },
      );
    }
    if (!existsSync(join(args.root, from))) {
      return fail("move", "not_found", "page-not-found", `no page at "${from}"`);
    }
    if (existsSync(join(args.root, to))) {
      return fail("move", "conflict", "destination-exists", `a page already exists at "${to}"`);
    }
    // docs/cli.md §move: a rename the agent DECLARES
    // is the answer to the pairing git declined to infer, and it stays a
    // DISTINCT operation — `docs/cli.md §move` step 4 has always said a move preserves
    // the filename unless a rename is requested. `--rename` is that request; the
    // old basename then lands in `aliases` through the Writer, so
    // `renamed-without-alias` cannot fire after it.
    const renamed = basenameOf(from) !== basenameOf(to);
    if (renamed && args.flags["rename"] !== true) {
      return fail(
        "move",
        "usage",
        "basename-change",
        "a move never changes the basename; pass --rename to make this a rename",
        { hint: "a rename appends the old basename to aliases and may rewrite inbound links" },
      );
    }
    // After every refusal — the reason vocabulary, the missing page, the
    // occupied destination, the basename change — and before the one write
    // this verb makes.
    if (isDryRun(args)) return ok("move", planForMove(args));
    try {
      mkdirSync(dirname(join(args.root, to)), { recursive: true });
      execFileSync("git", ["mv", from, to], { cwd: args.root });
    } catch (e) {
      return fail("move", "conflict", "git-unavailable", `git mv failed: ${String(e)}`, {
        hint: "move operates inside a git repository",
      });
    }
    // docs/cli.md §move: the alias, through the Writer, so a rename
    // and its ritual are one operation. `aliases` already holding the old name
    // is not an error — it is the ritual already satisfied.
    const aliased: string[] = [];
    if (renamed) {
      const raw = readPage(args.root, to);
      const value = parseDoc(raw).frontmatter.value["aliases"];
      const existing = Array.isArray(value) ? value : value === undefined ? [] : undefined;
      const old = basenameOf(from);
      if (existing === undefined) {
        return fail("move", "conflict", "aliases-not-a-list", `"${to}" has a non-list aliases`);
      }
      const has = existing.some(
        (a) => typeof a === "string" && normalizeIdentity(a) === normalizeIdentity(old),
      );
      if (!has) {
        const spliced = splicePlan(raw, {
          path: to,
          ops: [{ kind: "frontmatter-list", field: "aliases", existing, add: [old] }],
        });
        if (!spliced.ok) {
          return fail("move", "conflict", "splice-refused", spliced.reason);
        }
        commitWrite(args.root, to, spliced.spliced.text);
        aliased.push(old);
      }
    }
    const pages = collectPages(args.root, walkPages(args.root, rootsOf(vault)));
    const names = buildNameIndex(pages);
    const doc = parseDoc(readPage(args.root, to));
    // Move judges the moved page with the SAME effective options
    // as every other verb — one pipeline.
    const findings = [
      ...lintPage({ path: to, doc, registry: vault.registry }, lintOptionsFor(vault, names)),
    ];
    if ((vault.engine.folder_tags?.mode ?? "off") !== "off") {
      findings.push(...formerFolderTagFindings(from, to, doc, rootsOf(vault)));
    }
    sortFindings(findings);
    // docs/concepts.md §Findings and routing: the law is about what an agent RECEIVES, so
    // it binds every verb that prints a finding. `move` was printing the one
    // fix-routed folder row with no payload at all.
    const law = lawFor(vault);
    const routed = routeFindings(findings, law, [{ path: to, doc }]);
    // docs/cli.md §move: inbound links are REPORTED by default — a
    // move and a semantic rewrite are separate commits — and rewritten
    // through `link-rewrite` when the caller asks, which is the one fixer that
    // knows what a canonical name is.
    const rewritten: string[] = [];
    if (renamed && args.flags["rewrite-links"] === true) {
      const state = fsState(args.root, rootsOf(vault));
      const verdict = judge(state, law, { all: true });
      for (const finding of verdict.findings) {
        if (finding.ruleId !== "wikilink-alias-target" || finding.path === to) continue;
        const text = state.pages.get(finding.path);
        if (text === undefined || finding.line === undefined) continue;
        const derived = fixOpsFor("link-rewrite", {
          ruleId: finding.ruleId,
          line: finding.line,
          text,
          ...(finding.details === undefined ? {} : { details: { ...finding.details } }),
        });
        if (!derived.ok) continue;
        const spliced = splicePlan(text, { path: finding.path, ops: derived.ops });
        if (!spliced.ok) continue;
        commitWrite(args.root, finding.path, spliced.spliced.text);
        state.pages.set(finding.path, spliced.spliced.text);
        rewritten.push(finding.path);
      }
    }
    return ok("move", {
      from,
      to,
      reason,
      // Whether the reason was checked against a declared set, so a
      // maintainer reading the envelope knows the vocabulary is open here
      // rather than wondering where the flag's values come from.
      reasons: declared === undefined ? "undeclared" : [...declared],
      renamed,
      aliased,
      rewritten_links: [...new Set(rewritten)].sort(),
      findings: routed,
    });
  },
};
