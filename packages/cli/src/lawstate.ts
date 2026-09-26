// v2 contracts §10 (four state constructors) · §5 (`before` availability) ·
// §11 (the snapshot: the index and a revision by object ids, the working tree
// by digest before and after, one retry, then state-changed-during-read).
//
// Each constructor answers "which bytes, under which law, against which
// base?" and hands the answer to core's `judgeTypeLaw`:
//   fsState        the working tree; no base (`check`, `rule try`).
//   overlayState   drafts over the working tree; the base is the disk (`write`).
//   indexState     the index; the base is HEAD (`gate`).
//   revisionState  a revision's tree; no base (`rule try --base`).
// The law travels with the pages: each state reads `config/engine.json`, the
// constitution and the libraries from the same place as its pages (the
// adapters in lawfiles.ts), so the content roots it walks are the ones its
// own law declares. Beside the old constructors (state.ts), which every verb
// still calls; nothing in the binary reaches these yet.
//
// A page that is a symbolic link, or a submodule, is not a page to any of
// the four: the index and a revision hold a link as the text of its target,
// the working tree reads through it, and the one rule all four can keep is
// to read none of them (docs/roadmap.md says so).
import { lstatSync } from "node:fs";
import { join } from "node:path";
import {
  codeUnitCompare,
  contentDigest,
  contentRootsOf,
  isContentPath,
  type JudgeState,
  type LawSnapshot,
  type PageRename,
  pageMap,
} from "@wikiwright/core";
import {
  gitHasHead,
  gitHeadBlobs,
  gitIndexEntries,
  gitReadBlobBytes,
  gitShowHead,
  gitStagedChanges,
  inArgumentOrder,
} from "./git.ts";
import {
  type GitLawEntry,
  lawSnapshotOfEntries,
  repositoryPlace,
  revisionEntries,
  workingTreeLawSnapshot,
} from "./lawfiles.ts";
import { readPageBytes, walkPages } from "./vaultfiles.ts";

/** §11: the working tree changed between two reads, twice; nothing consistent was read. */
export class StateChangedDuringRead extends Error {
  readonly code = "state-changed-during-read";
  constructor(root: string) {
    super(
      `the working tree under "${root}" changed while it was read, twice in a row; nothing was judged — read again when no editor or process is writing to it`,
    );
    this.name = "StateChangedDuringRead";
  }
}

/** A bundle-relative path from a repository-relative one, or undefined outside the bundle. */
function inBundle(bundle: string, path: string): string | undefined {
  if (bundle === "") return path;
  return path.startsWith(`${bundle}/`) ? path.slice(bundle.length + 1) : undefined;
}

interface Capture {
  law: LawSnapshot;
  pages: ReadonlyMap<string, Uint8Array>;
}

async function captureWorkingTree(root: string): Promise<Capture> {
  const law = await workingTreeLawSnapshot(root);
  const pages: [string, Uint8Array][] = [];
  for (const rel of walkPages(root, contentRootsOf(law))) {
    let link = false;
    try {
      link = lstatSync(join(root, rel)).isSymbolicLink();
    } catch {
      // Named NFC by the walk and NFD on disk: the read below finds it.
    }
    if (link) continue;
    pages.push([rel, new Uint8Array(readPageBytes(root, rel))]);
  }
  return { law, pages: pageMap(pages) };
}

/** One digest over everything a capture read: the law's files and the pages. */
function captureDigest(capture: Capture): string {
  return contentDigest([
    ...[...capture.law.files].map(([path, file]) => ({
      path: `${file.link === true ? "link" : "law"}:${path}`,
      bytes: file.bytes,
    })),
    ...[...capture.law.directories].map((path) => ({
      path: `directory:${path}`,
      bytes: new Uint8Array(),
    })),
    ...[...capture.pages].map(([path, bytes]) => ({ path: `page:${path}`, bytes })),
  ]);
}

export interface CaptureOptions {
  /**
   * Runs between the two reads of each attempt. The seam a test changes the
   * tree through while it is being read; nothing else passes it.
   */
  betweenReads?: (attempt: number) => void | Promise<void>;
}

/**
 * §11: the working tree read twice and compared by digest; on a difference,
 * once more; on a second difference, `state-changed-during-read`.
 */
async function consistentCapture(root: string, options: CaptureOptions): Promise<Capture> {
  for (const attempt of [1, 2]) {
    const first = await captureWorkingTree(root);
    await options.betweenReads?.(attempt);
    const second = await captureWorkingTree(root);
    if (captureDigest(first) === captureDigest(second)) return second;
  }
  throw new StateChangedDuringRead(root);
}

/** The working tree as it stands: its law and its pages, no base. */
export async function fsState(root: string, options: CaptureOptions = {}): Promise<JudgeState> {
  const { law, pages } = await consistentCapture(root, options);
  return { kind: "working-tree", law, pages };
}

/** A draft page: a bundle-relative path and the bytes proposed for it. */
export interface Draft {
  path: string;
  bytes: Uint8Array;
}

/**
 * Drafts over the working tree, judged together: the pages are the disk's
 * with every draft in its place, and the base is the disk — a page's bytes on
 * disk, `null` for a draft the disk does not hold. A draft outside the
 * content roots is refused: it would be judged as a page nothing reads.
 */
export async function overlayState(
  root: string,
  drafts: readonly Draft[],
  options: CaptureOptions = {},
): Promise<JudgeState> {
  const disk = await consistentCapture(root, options);
  const roots = contentRootsOf(disk.law);
  const pages = new Map(disk.pages);
  for (const draft of drafts) {
    const path = draft.path.normalize("NFC");
    if (!isContentPath(path, roots)) {
      throw new Error(
        `the draft "${draft.path}" is not a page under the content roots (${roots.join(", ")})`,
      );
    }
    pages.set(path, draft.bytes);
  }
  const base = new Map<string, Uint8Array | null>();
  for (const path of pages.keys()) base.set(path, disk.pages.get(path) ?? null);
  return { kind: "overlay", law: disk.law, pages: pageMap(pages), base };
}

/** A tree entry that is a page: a regular file, not a link (120000) or a submodule (160000). */
function regular(mode: string): boolean {
  return mode !== "120000" && mode !== "160000";
}

/** The staged-diff statuses that name a page at another path, or none, in HEAD. */
function headPathOf(change: {
  status: string;
  path: string;
  oldPath?: string;
}): string | undefined {
  if (change.status === "A" || change.status === "C") return undefined;
  if (change.status === "R") return change.oldPath;
  return change.path;
}

/**
 * The index, with HEAD as its base (§5): the pages and the law as they would
 * be committed, one listing and one batch read by blob id. A page the commit
 * does not change has its own bytes as its base; a changed page has HEAD's
 * bytes at its path, or at the path it was renamed from, or `null` when new.
 * With no HEAD the base is empty: every page is new.
 */
export async function indexState(root: string): Promise<JudgeState> {
  const { top, bundle } = await repositoryPlace(root);
  const [listed, hasHead] = await inArgumentOrder([gitIndexEntries(top), gitHasHead(top)]);
  const unmerged = listed.find((e) => e.stage !== 0);
  if (unmerged !== undefined) {
    throw new Error(`the index holds an unmerged path, "${unmerged.path}"; resolve it first`);
  }
  const entries: GitLawEntry[] = listed.map((e) => ({
    path: e.path.normalize("NFC"),
    object: e.blob,
    mode: e.mode,
  }));
  const law = await lawSnapshotOfEntries(top, bundle, entries);
  const roots = contentRootsOf(law);
  const content = entries.filter((e) => {
    const rel = inBundle(bundle, e.path);
    return rel !== undefined && regular(e.mode) && isContentPath(rel, roots);
  });
  const changes = hasHead ? await gitStagedChanges(top) : [];
  const changeOf = new Map(changes.map((c) => [c.path.normalize("NFC"), c] as const));
  const headPaths: string[] = [];
  for (const entry of content) {
    const change = changeOf.get(entry.path);
    const head = change === undefined ? undefined : headPathOf(change);
    if (head !== undefined && !head.includes("\n")) headPaths.push(head);
  }
  const headBlobs = await gitHeadBlobs(top, headPaths);
  const blobs = await gitReadBlobBytes(top, [
    ...content.map((e) => e.object),
    ...[...headBlobs.values()].filter((b): b is string => b !== undefined),
  ]);
  const bytesOf = (blob: string, path: string): Uint8Array => {
    const bytes = blobs.get(blob);
    if (bytes === undefined) throw new Error(`git did not return blob ${blob} for "${path}"`);
    return new Uint8Array(bytes);
  };
  const pages: [string, Uint8Array][] = [];
  const base = new Map<string, Uint8Array | null>();
  for (const entry of content) {
    const rel = inBundle(bundle, entry.path) ?? entry.path;
    const bytes = bytesOf(entry.object, entry.path);
    pages.push([rel, bytes]);
    if (!hasHead) {
      base.set(rel, null);
      continue;
    }
    const change = changeOf.get(entry.path);
    if (change === undefined) {
      base.set(rel, bytes);
      continue;
    }
    const head = headPathOf(change);
    if (head === undefined) {
      base.set(rel, null);
    } else if (head.includes("\n")) {
      // A rename's source whose name holds a newline cannot go on the batch
      // reader's line protocol; its own `git show` reads it, as text.
      const text = await gitShowHead(top, head);
      base.set(rel, text === undefined ? null : new TextEncoder().encode(text));
    } else {
      const blob = headBlobs.get(head);
      base.set(rel, blob === undefined ? null : bytesOf(blob, head));
    }
  }
  const renames: PageRename[] = changes
    .filter((c) => c.status === "R" && c.oldPath !== undefined)
    .map((c) => ({
      from: inBundle(bundle, (c.oldPath ?? "").normalize("NFC")),
      to: inBundle(bundle, c.path.normalize("NFC")),
    }))
    .filter((r): r is PageRename => r.from !== undefined && r.to !== undefined)
    .filter((r) => isContentPath(r.to, roots))
    .sort((a, b) => codeUnitCompare(a.to, b.to));
  return { kind: "index", law, pages: pageMap(pages), base, renames };
}

/** A revision's tree, its law and its pages, with no base (§10: `rule try --base`). */
export async function revisionState(root: string, rev: string): Promise<JudgeState> {
  const { top, bundle } = await repositoryPlace(root);
  const listing = await revisionEntries(top, rev);
  const law = await lawSnapshotOfEntries(top, bundle, listing);
  const roots = contentRootsOf(law);
  const content = listing.filter((e) => {
    const rel = inBundle(bundle, e.path);
    return rel !== undefined && regular(e.mode) && isContentPath(rel, roots);
  });
  const blobs = await gitReadBlobBytes(
    top,
    content.map((e) => e.object),
  );
  const pages: [string, Uint8Array][] = content.map((e) => {
    const bytes = blobs.get(e.object);
    if (bytes === undefined) throw new Error(`git did not return blob ${e.object} for "${e.path}"`);
    return [inBundle(bundle, e.path) ?? e.path, new Uint8Array(bytes)];
  });
  return { kind: "revision", law, pages: pageMap(pages) };
}
