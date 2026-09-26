// v2 contracts §10: what a state constructor hands the judge. Four
// constructors live in the shell (packages/cli/src/lawstate.ts) — the working
// tree, drafts over the disk, the index over HEAD, a revision — and each
// answers one question: which bytes, under which law, against which base.
// The judge reads nothing else, so the same bytes give the same verdict
// whichever constructor read them (the judge property test).
//
// Ported from the old `VaultState` (judge/index.ts): the page map, the base
// map with `null` for a page new to the base, and the renames. Changed: pages
// are bytes, not text (the judge reports a page that is not UTF-8, and the
// bytes digest is over bytes); the law's files travel with the pages, so a
// state names the law it was read under; and whether the state HAS a base is
// its own fact (§5 `before`), not inferred from a map being present.
import { codeUnitCompare } from "../identity/index.ts";
import { ENGINE_PATH, loadEngineV4 } from "../law/engine.ts";
import { joinUnder } from "../law/paths.ts";
import type { LawSnapshot } from "../law/snapshot.ts";

export type StateKind = "working-tree" | "overlay" | "index" | "revision";

/**
 * A path at, under or above a content root that no state reads through: a
 * symbolic link (git mode 120000), or a submodule (160000; on disk, a
 * directory holding `.git`). The index and a revision hold a link as the
 * text of its target and a submodule as one commit id, and the working tree
 * would read through either; all four read neither, and report each.
 */
export interface SkippedPath {
  /** Bundle-relative, NFC. */
  path: string;
  kind: "symbolic-link" | "submodule";
}

/** Existence and kind only; source bytes are outside the page and law snapshot. */
export interface SourceFacts {
  files: ReadonlySet<string>;
  directories: ReadonlySet<string>;
  skipped: readonly SkippedPath[];
}

/** A page the base held under one path and the state holds under another. */
export interface PageRename {
  from: string;
  to: string;
}

export interface JudgeState {
  kind: StateKind;
  /** The law's files, as this state reads them: from disk, the index or a revision. */
  law: LawSnapshot;
  /** Every page under the content roots, by bundle-relative NFC path. */
  pages: ReadonlyMap<string, Uint8Array>;
  /**
   * §5: present exactly when the state has a base — the overlay (the disk)
   * and the index (HEAD). Each page's bytes in the base, `null` for a page the
   * base does not hold. The working tree and a revision have none, and a
   * transition is `unevaluated` there.
   */
  base?: ReadonlyMap<string, Uint8Array | null>;
  /** Renames from the base to the state (the index's staged renames). */
  renames?: readonly PageRename[];
  /**
   * The pages the base held that the state no longer holds under any path
   * (the index's staged deletions), with their base bytes: the names the
   * base held include theirs.
   */
  removed?: ReadonlyMap<string, Uint8Array>;
  /** The links and submodules at, under or above a content root, in code-unit order of path. */
  skipped?: readonly SkippedPath[];
  /** Paths below source_roots from this selected state. Absence means unmeasured. */
  sources?: SourceFacts;
  /** HEAD's source paths when the selected state is the index. */
  baseSources?: SourceFacts;
}

/** Whether `path` is a content root, lies under one, or holds one. */
export function touchesContentRoot(path: string, roots: readonly string[]): boolean {
  return roots.some((r) => path === r || path.startsWith(`${r}/`) || r.startsWith(`${path}/`));
}

/** A page map in code-unit order of path, keyed in NFC. */
export function pageMap(
  pages: Iterable<readonly [string, Uint8Array]>,
): ReadonlyMap<string, Uint8Array> {
  return new Map(
    [...pages]
      .map(([path, bytes]) => [path.normalize("NFC"), bytes] as const)
      .sort(([a], [b]) => codeUnitCompare(a, b)),
  );
}

/** Two byte strings are one. */
export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * §2 `content_roots`, read from a law snapshot: where a state constructor
 * discovers the pages its own law governs. None when engine.json does not
 * load: the judge then reports the law, not the pages.
 */
export function contentRootsOf(law: LawSnapshot): string[] {
  const file = law.files.get(joinUnder(law.bundle, ENGINE_PATH));
  const loaded = loadEngineV4(file?.link === true ? undefined : file?.bytes);
  return loaded.ok ? [...loaded.engine.content_roots] : [];
}

/** Source roots declared by this state's own law. */
export function sourceRootsOf(law: LawSnapshot): string[] {
  const file = law.files.get(joinUnder(law.bundle, ENGINE_PATH));
  const loaded = loadEngineV4(file?.link === true ? undefined : file?.bytes);
  return loaded.ok ? [...loaded.engine.source_roots] : [];
}
