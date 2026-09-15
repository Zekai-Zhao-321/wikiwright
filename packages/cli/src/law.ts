// docs/concepts.md §Findings and routing · docs/architecture.md §How a verdict is produced (one place turns a loaded vault into
// the judge's second argument) · docs/architecture.md §The invariants (the engine.json
// keys name their consumers HERE — `rootsOf`, `lintOptionsFor`, `generateOptionsFor`,
// `checkEnginePin`) · docs/architecture.md §Directories.

import {
  buildNameIndex,
  codeUnitCompare,
  type generateArtifacts,
  type Law,
  type lintPage,
  type NameIndex,
  satisfiesEngineRange,
} from "@wikiwright/core";
import { type CommandResult, ENGINE_VERSION, fail } from "./envelope.ts";
import type { loadVault } from "./vaultio.ts";

export type VaultOk = Extract<ReturnType<typeof loadVault>, { ok: true }>;

/**
 * The one reader of engine.json's content_roots. The key is
 * required — the loader refuses a bundle without it — so this never guesses.
 */
export function rootsOf(vault: VaultOk): readonly string[] {
  return vault.engine.content_roots ?? [];
}

/**
 * The engine.json keys a page verdict consumes (docs/architecture.md §The invariants names
 * this function as their consumer): folder_tag_aliases, folder_tags, extensions,
 * and field_sources via generateOptionsFor beside it.
 */
export function lintOptionsFor(vault: VaultOk, names: NameIndex, extra?: { baseText?: string }) {
  const options: Record<string, unknown> = {
    names,
    contentRoots: rootsOf(vault),
  };
  if (vault.engine.field_sources !== undefined)
    options["fieldSources"] = vault.engine.field_sources;
  if (vault.engine.folder_tag_aliases !== undefined)
    options["folderTagAliases"] = vault.engine.folder_tag_aliases;
  options["folderTags"] = vault.engine.folder_tags?.mode ?? "off";
  // The declared evidence roots reach the grammar too, not only
  // generation — a body link and a bare-path provenance ref read the same
  // declaration (docs/constitution.md §config/engine.json).
  if (vault.engine.source_roots !== undefined) options["sourceRoots"] = vault.engine.source_roots;
  if (vault.engine.extensions !== undefined) options["extensions"] = vault.engine.extensions;
  if (extra?.baseText !== undefined) options["baseText"] = extra.baseText;
  return options;
}

/** The engine.json keys generation consumes: field_sources and source_roots. */
// (source_roots has a second reader, `lintOptionsFor` above — one declaration,
// two passes that must agree on what an evidence root is. ENGINE_CONFIG_CONSUMERS
// names both, so the schema walk resolves both.)
export function generateOptionsFor(vault: VaultOk) {
  const options: { fieldSources?: unknown; sourceRoots?: readonly string[] } = {};
  if (vault.engine.field_sources !== undefined) options.fieldSources = vault.engine.field_sources;
  if (vault.engine.source_roots !== undefined) options.sourceRoots = vault.engine.source_roots;
  return options as Parameters<typeof generateArtifacts>[3];
}

/**
 * docs/concepts.md §Findings and routing / docs/architecture.md §How a verdict is produced: the law a state is judged under. One place turns
 * a loaded vault into the judge's second argument, so every verb judges under
 * the same declaration set and `lint`, `check` and `gate` cannot drift apart.
 */
export function lawFor(vault: VaultOk): Law {
  const options = lintOptionsFor(vault, buildNameIndex([])) as Record<string, unknown>;
  delete options["names"];
  const law: Law = {
    registry: vault.registry,
    // docs/extending.md §What a module registers: the loader already composed and validated this exact set.
    // Reconstructing it here would let loading and judging disagree as soon as
    // a bundle can declare a kit (docs/extending.md §A check).
    modules: vault.modules,
    options: options as NonNullable<Parameters<typeof lintPage>[1]>,
    policyKeys: Object.entries(vault.engine)
      .filter(([, value]) => value !== undefined)
      .map(([key]) => key)
      .sort(codeUnitCompare),
  };
  return law;
}

/**
 * docs/cli.md §move: the one reader of engine.json's `move_reasons` — the closed set of
 * justifications a move may state, or `undefined` where the bundle declares
 * none and any non-empty reason is the justification.
 */
export function moveReasonsOf(vault: VaultOk): readonly string[] | undefined {
  return vault.engine.move_reasons;
}

/**
 * The one reader of engine.json's `engine` pin (docs/cli.md §hook): the running
 * engine must satisfy the bundle's range before it judges anything, because a
 * verdict from an engine the law excludes is worth nothing.
 */
export function checkEnginePin(
  command: string,
  engine: { engine?: string },
  version: string = ENGINE_VERSION,
): CommandResult | undefined {
  const range = engine.engine;
  if (range === undefined) return undefined;
  if (satisfiesEngineRange(version, range)) return undefined;
  return fail(
    command,
    "constitution",
    "engine-pin-mismatch",
    `this bundle requires an engine matching "${range}"; the running engine is ${version}`,
    {
      details: { required: range, running: version },
      hint: "install an engine inside the declared range, or widen config/engine.json's `engine`",
    },
  );
}
