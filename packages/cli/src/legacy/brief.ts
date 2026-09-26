// docs/cli.md §brief

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Finding } from "@wikiwright/core";
import { BRIEF_PATH, briefOf } from "../brief.ts";
import { fail, ok } from "../envelope.ts";
import { rootsOf } from "../law.ts";
import { markerAt } from "../marker.ts";
import { collectPages } from "../pages.ts";
import { type CommandSpec, declaredRole, type Role } from "../spec.ts";
import { loadVault, walkPages } from "../vaultio.ts";

// docs/cli.md §brief: every role has a brief with a loop of its own, and every
// role may print one, the consumer included — the verb is ranked consumer, so a
// bounded reader is never refused its own manual.
const ROLES = ["consumer", "writer", "maintainer"] as const;

/** The one renderer, so `init`, `skills update` and `check` cannot disagree. */
export async function briefFor(
  root: string,
  role: Role,
  commands: readonly CommandSpec[],
): Promise<{ ok: true; text: string } | { ok: false }> {
  const vault = await loadVault("brief", root);
  if (!vault.ok) return { ok: false };
  return {
    ok: true,
    text: briefOf(root, vault, collectPages(root, walkPages(root, rootsOf(vault))), role, commands),
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
  role: "consumer",
  summary:
    "Print the role's brief: every verb it may run, the types, the vocabularies, the names. `check --write` lands the writer's under generated/.",
  positionals: [],
  flags: [
    {
      name: "role",
      type: "string",
      summary:
        "consumer | writer | maintainer (default: WIKIWRIGHT_ROLE when set, else writer); an installed copy's is always the consumer's",
    },
  ],
  examples: [
    "wikiwright brief --role writer",
    "wikiwright brief --role maintainer",
    "wikiwright brief --role consumer",
  ],
  writes: false,
  needsVaultModules: true,
  run: async (args) => {
    // docs/cli.md §brief: the flag, else the session's own role, else the
    // writer's — a bounded session that asks for its brief gets its own, not
    // one listing verbs it may not run.
    const raw = args.flags["role"];
    const asked = typeof raw === "string" ? raw : (declaredRole() ?? "writer");
    if (!(ROLES as readonly string[]).includes(asked)) {
      return fail("brief", "usage", "unknown-role", `no brief for the role "${asked}"`, {
        details: { valid_values: [...ROLES] },
      });
    }
    // docs/cli.md §brief: over an installed copy every write is refused, so
    // the only brief that describes what may be run there is the consumer's,
    // whatever role was asked for — the one the copy carries.
    const copy = markerAt(args.root).kind === "valid";
    const role = copy ? "consumer" : asked;
    const rendered = await briefFor(args.root, role as Role, args.commands);
    if (!rendered.ok) {
      const vault = await loadVault("brief", args.root);
      return vault.ok
        ? fail("brief", "internal", "no-brief", "the brief did not render")
        : vault.result;
    }
    return ok("brief", {
      role,
      ...(copy ? { details: { reason: "installed copy", asked } } : {}),
      path: null,
      bytes: Buffer.byteLength(rendered.text),
      brief: rendered.text,
    });
  },
};
