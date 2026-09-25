// docs/cli.md §check (ONE generation path — `check --write` and
// `init` both land artifacts through it, so a fresh init's first check is green
// by construction) · write-then-rename · docs/architecture.md §Directories.

import { existsSync, lstatSync, readdirSync, rmdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { buildNameIndex, generateArtifacts, type PageInput } from "@wikiwright/core";
import { replaceFiles } from "./atomicwrite.ts";
import { BRIEF_PATH, briefOf } from "./brief.ts";
import { bundleLabel } from "./bundle.ts";
import {
  exportDifferences,
  fsExportSource,
  type RepositoryExports,
  repositoryExports,
} from "./exports.ts";
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
  root: string,
  vault: VaultOk,
  pages: PageInput[],
  commands: readonly CommandSpec[],
): ArtifactPlan {
  return { path: BRIEF_PATH, content: briefOf(root, vault, pages, "writer", commands) };
}

/** The writer's brief alone, through the same write loop — what `skills update` re-renders. */
export function writeBrief(root: string, commands: readonly CommandSpec[]): string | undefined {
  const vault = loadVault("brief", root);
  if (!vault.ok) return undefined;
  const pages = collectPages(root, walkPages(root, rootsOf(vault)));
  return writeArtifacts(root, [briefPlan(root, vault, pages, commands)])[0];
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
  const written = writeArtifacts(root, [...plans, briefPlan(root, vault, pages, commands)]);
  const exports = repositoryExports({
    vault,
    source: fsExportSource(root, pages),
    label: bundleLabel(root),
    commands,
  });
  return [...written, ...writeExports(root, exports)];
}

/**
 * docs/cli.md §check: render the bundle's in-repository exports. Every planned
 * file is replaced, through the one staged replace, and every file under an
 * export's own `skills/<name>/` that the plan no longer holds is removed, with
 * the directories it leaves empty: a shrunk selection leaves no formerly
 * exported page behind. The plugin manifests are written at the root when
 * declared. An export a finding refuses is not rendered, and nothing outside
 * the owned directories and the two manifests is touched. Returns the paths
 * written or removed.
 */
export function writeExports(root: string, exports: RepositoryExports): string[] {
  const differences = exportDifferences(exports, fsExportSource(root, []));
  const replacements: { path: string; contents: Buffer }[] = [];
  const removals: string[] = [];
  const planned = new Map<string, Buffer>();
  for (const plan of exports.plans) {
    for (const file of plan.files ?? []) {
      planned.set(`${plan.export.destination}/${file.path}`, file.bytes);
    }
  }
  for (const file of exports.manifests) planned.set(file.path, file.bytes);
  for (const difference of [...differences.values()].flat()) {
    if (difference.kind === "extra") removals.push(difference.path);
    else {
      const bytes = planned.get(difference.path);
      if (bytes !== undefined) replacements.push({ path: difference.path, contents: bytes });
    }
  }
  if (replacements.length > 0) {
    // A copy holds bytes, never a link. A planned file whose place a link
    // holds, or that lies under a linked directory, is replaced by bytes: each
    // link goes first, itself and never what it names, so the rename lands a
    // file here and nothing is written or removed through the link. An
    // ordinary file stays where it is until its replacement is renamed over
    // it, so a render that fails leaves the previous bytes.
    for (const replacement of replacements) {
      unlinkLinks(root, replacement.path, exports.destinations);
    }
    replaceFiles(replacements.map((r) => ({ path: join(root, r.path), contents: r.contents })));
  }
  for (const path of removals) {
    // A link removed above to make room for a directory is one now.
    if (lstatSync(join(root, path), { throwIfNoEntry: false })?.isDirectory() === true) continue;
    rmSync(join(root, path), { force: true });
    pruneEmpty(root, dirname(path), exports.destinations);
  }
  return [...replacements.map((r) => r.path), ...removals].sort();
}

/**
 * Remove every symbolic link from the owned directory down to `path`, itself
 * included: the link, never what it names. The owned directory is the export's
 * `skills/<name>`, or the root for a manifest; nothing above it is touched.
 */
function unlinkLinks(root: string, path: string, destinations: readonly string[]): void {
  const parts = path.split("/");
  const owner = destinations.find((dest) => path.startsWith(`${dest}/`));
  const from = owner === undefined ? 1 : owner.split("/").length;
  for (let i = from; i <= parts.length; i += 1) {
    const abs = join(root, ...parts.slice(0, i));
    const stat = lstatSync(abs, { throwIfNoEntry: false });
    if (stat === undefined) return;
    if (stat.isSymbolicLink()) rmSync(abs, { force: true });
  }
}

/** Remove the directories a removal left empty, up to and never including the destination's own parent. */
function pruneEmpty(root: string, dir: string, destinations: readonly string[]): void {
  let current = dir;
  while (destinations.some((dest) => current === dest || current.startsWith(`${dest}/`))) {
    const abs = join(root, current);
    try {
      if (readdirSync(abs).length > 0) return;
      rmdirSync(abs);
    } catch {
      return;
    }
    if (current.includes("/")) current = dirname(current);
    else return;
  }
}

/** docs/cli.md §The dry-run law: what `writeExports` would write and remove, as plan ops. */
export function exportOps(root: string, exports: RepositoryExports): PlanOp[] {
  const ops: PlanOp[] = [];
  for (const difference of [
    ...exportDifferences(exports, fsExportSource(root, [])).values(),
  ].flat()) {
    ops.push(
      difference.kind === "extra"
        ? {
            kind: "delete",
            path: difference.path,
            summary: "a file the export's plan no longer holds",
          }
        : {
            kind: difference.kind === "missing" ? "create" : "write",
            path: difference.path,
            summary: "render the export",
          },
    );
  }
  return ops.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/**
 * docs/cli.md §The dry-run law: what `regenerate` WOULD write, computed without writing.
 * The paths come from the generator itself rather than from a list beside it,
 * so a plan can never name a file the writer would not produce — the same
 * reason `check` compares against a fresh `generateArtifacts` rather than a
 * remembered set.
 */
export function artifactOps(
  root: string,
  vault: VaultOk,
  commands: readonly CommandSpec[],
): PlanOp[] {
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
    ...exportOps(
      root,
      repositoryExports({
        vault,
        source: fsExportSource(root, pages),
        label: bundleLabel(root),
        commands,
      }),
    ),
  ];
}
