// docs/cli.md §brief

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Finding } from "@wikiwright/core";
import { BRIEF_PATH, briefOf } from "../brief.ts";
import { fail, ok } from "../envelope.ts";
import { rootsOf } from "../law.ts";
import { collectPages } from "../pages.ts";
import type { CommandSpec, Role } from "../spec.ts";
import { loadVault, walkPages } from "../vaultio.ts";

// docs/cli.md §brief: every role has a brief, including the consumer's — a bounded reader
// with no manual is the unrefreshed-skills defect one role down.
const ROLES = ["consumer", "writer", "maintainer"] as const;

/** The one renderer, so `init`, `skills update` and `check` cannot disagree. */
export function briefFor(
  root: string,
  role: Role,
  commands: readonly CommandSpec[],
): { ok: true; text: string } | { ok: false } {
  const vault = loadVault("brief", root);
  if (!vault.ok) return { ok: false };
  return {
    ok: true,
    text: briefOf(vault, collectPages(root, walkPages(root, rootsOf(vault))), role, commands),
  };
}

/**
 * docs/cli.md §brief: `check`'s arm. The brief is a per-install
 * artifact, so "absent" and "cut from another law" are both machine-local state
 * and the run-external severity law caps this pass at info — a `check` that went
 * red because a machine had not run `check --write` would flake everywhere but
 * the author's own checkout. The caller renders from its loaded page set;
 * this comparison does not load and parse the corpus again.
 * `check --write` is the one generator.
 */
export function briefFindings(root: string, expected: string): Finding[] {
  const abs = join(root, BRIEF_PATH);
  const installed = existsSync(abs) ? readFileSync(abs, "utf8") : undefined;
  if (installed === expected) return [];
  return [
    {
      ruleId: "brief-stale",
      severity: "info",
      path: BRIEF_PATH,
      message:
        installed === undefined
          ? "no generated brief is installed, so this vault's writer has no verb list"
          : "the installed brief differs from the one this engine and this constitution render",
      remediation: "run `wikiwright check --write`",
      contributedBy: "engine",
      layer: "constitution",
    },
  ];
}

export const briefCommand: CommandSpec = {
  name: "brief",
  role: "writer",
  summary:
    "Print the role's brief: every verb it may run, the types, the vocabularies, the names. `check --write` lands the writer's under generated/.",
  positionals: [],
  flags: [
    { name: "role", type: "string", summary: "consumer | writer | maintainer (default: writer)" },
  ],
  examples: ["wikiwright brief --role writer", "wikiwright brief --role maintainer"],
  writes: false,
  needsVaultModules: true,
  run: (args) => {
    const raw = args.flags["role"];
    const role = typeof raw === "string" ? raw : "writer";
    if (!(ROLES as readonly string[]).includes(role)) {
      return fail("brief", "usage", "unknown-role", `no brief for the role "${role}"`, {
        details: { valid_values: [...ROLES] },
      });
    }
    const rendered = briefFor(args.root, role as Role, args.commands);
    if (!rendered.ok) {
      const vault = loadVault("brief", args.root);
      return vault.ok
        ? fail("brief", "internal", "no-brief", "the brief did not render")
        : vault.result;
    }
    return ok("brief", {
      role,
      path: null,
      bytes: Buffer.byteLength(rendered.text),
      brief: rendered.text,
    });
  },
};
