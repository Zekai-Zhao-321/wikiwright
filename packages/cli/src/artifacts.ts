// docs/cli.md §check (ONE generation path — `check --write` and
// `init` both land artifacts through it, so a fresh init's first check is green
// by construction) · write-then-rename · docs/architecture.md §Directories.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { buildNameIndex, generateArtifacts, type PageInput } from "@wikiwright/core";
import { replaceFiles } from "./atomicwrite.ts";
import { BRIEF_PATH, briefOf } from "./brief.ts";
import { generateOptionsFor, rootsOf, type VaultOk } from "./law.ts";
import { collectPages } from "./pages.ts";
import type { CommandSpec, PlanOp } from "./spec.ts";
import { loadVault, walkPages } from "./vaultio.ts";

/** One generated file: its vault path and its bytes. */
export interface ArtifactPlan {
  path: string;
  content: string;
}

/**
 * docs/cli.md §check: the writer's brief is a generated artifact like
 * the three the kernel renders — the file's own header says so — and it lands
 * beside them through the one write loop. `brief-stale` names `check --write`.
 */
export function briefPlan(
  vault: VaultOk,
  pages: PageInput[],
  commands: readonly CommandSpec[],
): ArtifactPlan {
  return { path: BRIEF_PATH, content: briefOf(vault, pages, "writer", commands) };
}

/** The writer's brief alone, through the same write loop — what `skills update` re-renders. */
export function writeBrief(root: string, commands: readonly CommandSpec[]): string | undefined {
  const vault = loadVault("brief", root);
  if (!vault.ok) return undefined;
  const pages = collectPages(root, walkPages(root, rootsOf(vault)));
  return writeArtifacts(root, [briefPlan(vault, pages, commands)])[0];
}

export function writeArtifacts(root: string, plans: readonly ArtifactPlan[]): string[] {
  // Every artifact is staged before the first rename, through the shell's one
  // staged replace (`atomicwrite.ts`): a failure while writing leaves every
  // artifact old with no debris. The rename loop is not batch-atomic — a crash
  // inside it can leave some artifacts old and some new, and the next
  // `check --write` converges them.
  replaceFiles(plans.map((plan) => ({ path: join(root, plan.path), contents: plan.content })));
  return plans.map((p) => p.path);
}

/**
 * The ONE generation path. `init` calls it and `check --write` writes the
 * same plans, so a fresh init's first `check` is green by construction — there
 * is no second generator whose output could drift from the one check compares
 * against.
 */
export function regenerate(
  root: string,
  vault: VaultOk,
  commands: readonly CommandSpec[],
): string[] {
  const pages = collectPages(root, walkPages(root, rootsOf(vault)));
  const plans = generateArtifacts(
    vault.registry,
    pages,
    buildNameIndex(pages),
    generateOptionsFor(vault),
  );
  return writeArtifacts(root, [...plans, briefPlan(vault, pages, commands)]);
}

/**
 * docs/cli.md §The dry-run law: what `regenerate` WOULD write, computed without writing.
 * The paths come from the generator itself rather than from a list beside it,
 * so a plan can never name a file the writer would not produce — the same
 * reason `check` compares against a fresh `generateArtifacts` rather than a
 * remembered set.
 */
export function artifactOps(root: string, vault: VaultOk): PlanOp[] {
  const pages = collectPages(root, walkPages(root, rootsOf(vault)));
  const plans = generateArtifacts(
    vault.registry,
    pages,
    buildNameIndex(pages),
    generateOptionsFor(vault),
  );
  return [
    ...plans.map((plan) => ({
      kind: "write" as const,
      path: plan.path,
      summary: "regenerate the derived artifact",
    })),
    {
      kind: existsSync(join(root, BRIEF_PATH)) ? ("write" as const) : ("create" as const),
      path: BRIEF_PATH,
      summary: "the writer's generated brief, from the verb registry and the constitution",
    },
  ];
}
