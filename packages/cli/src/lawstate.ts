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
// A symbolic link or a submodule at, under or above a content root is read
// by none of the four: the index and a revision hold a link as the text of
// its target and a submodule as a commit id, and the working tree would read
// through either, so the one rule all four can keep is to read through
// none. Each reports what it did not read (`skipped`), and the judge reports
// each as `path-skipped`: the working tree walks with lstat and descends into
// no link and no directory holding `.git`; the index and a revision list
// modes 120000 and 160000.
import { type Dirent, lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  codeUnitCompare,
  contentDigest,
  contentRootsOf,
  isContentPath,
  isVaultPath,
  type JudgeState,
  type LawSnapshot,
  type PageRename,
  pageMap,
  type SkippedPath,
  touchesContentRoot,
} from "@wikiwright/core";
import {
  GitInconsistentRead,
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
import { readPageBytes } from "./vaultfiles.ts";

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
  skipped: SkippedPath[];
}

function bySkippedPath(skipped: SkippedPath[]): SkippedPath[] {
  const unique = new Map(skipped.map((s) => [s.path, s] as const));
  return [...unique.values()].sort((a, b) => codeUnitCompare(a.path, b.path));
}

/**
 * The pages under the content roots and the links and submodules the walk
 * does not enter, by lstat: a link is never followed, a directory holding
 * `.git` never entered, and a content root is checked segment by segment,
 * as git holds a link above one as a single entry. `disk` is the name as the
 * directory lists it, `path` its NFC key.
 */
function walkContent(
  root: string,
  roots: readonly string[],
): { pages: { path: string; disk: string }[]; skipped: SkippedPath[] } {
  const pages: { path: string; disk: string }[] = [];
  const skipped: SkippedPath[] = [];
  const holdsGit = (entries: Dirent[]): boolean => entries.some((e) => e.name === ".git");
  const walk = (disk: string, path: string): void => {
    const entries = readdirSync(join(root, disk), { withFileTypes: true, encoding: "utf8" });
    if (holdsGit(entries)) {
      skipped.push({ path, kind: "submodule" });
      return;
    }
    for (const entry of entries) {
      const childDisk = `${disk}/${entry.name}`;
      const child = `${path}/${entry.name.normalize("NFC")}`;
      if (entry.isSymbolicLink()) {
        if (isVaultPath(child)) skipped.push({ path: child, kind: "symbolic-link" });
      } else if (entry.isDirectory()) walk(childDisk, child);
      else if (entry.isFile() && isContentPath(child, roots))
        pages.push({ path: child, disk: childDisk });
    }
  };
  for (const contentRoot of roots) {
    const segments = contentRoot.split("/");
    let blocked = false;
    for (let i = 1; i <= segments.length && !blocked; i += 1) {
      const prefix = segments.slice(0, i).join("/");
      let stat: ReturnType<typeof lstatSync> | undefined;
      try {
        stat = lstatSync(join(root, prefix));
      } catch {
        blocked = true; // No such directory: the root holds no page.
        continue;
      }
      if (stat.isSymbolicLink()) {
        skipped.push({ path: prefix, kind: "symbolic-link" });
        blocked = true;
      } else if (!stat.isDirectory()) blocked = true;
      else if (i < segments.length) {
        const entries = readdirSync(join(root, prefix), { withFileTypes: true, encoding: "utf8" });
        if (holdsGit(entries)) {
          skipped.push({ path: prefix, kind: "submodule" });
          blocked = true;
        }
      }
    }
    if (!blocked) walk(contentRoot, contentRoot);
  }
  pages.sort((a, b) => codeUnitCompare(a.path, b.path));
  return { pages, skipped: bySkippedPath(skipped) };
}

async function captureWorkingTree(root: string): Promise<Capture> {
  const law = await workingTreeLawSnapshot(root);
  const walked = walkContent(root, contentRootsOf(law));
  const pages: [string, Uint8Array][] = walked.pages.map((p) => [
    p.path,
    new Uint8Array(readPageBytes(root, p.disk)),
  ]);
  return { law, pages: pageMap(pages), skipped: walked.skipped };
}

/** One digest over everything a capture read: the law's files, the pages and what it skipped. */
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
    ...capture.skipped.map((s) => ({ path: `${s.kind}:${s.path}`, bytes: new Uint8Array() })),
  ]);
}

/** A file or directory that left, or a link that came back on itself, between the listing and the read. */
function vanished(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR" || code === "ELOOP";
}

async function tryCapture(root: string): Promise<Capture | undefined> {
  try {
    return await captureWorkingTree(root);
  } catch (error) {
    if (vanished(error)) return undefined;
    throw error;
  }
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
    // A path that vanishes mid-read is a tree that changed: read again.
    const first = await tryCapture(root);
    await options.betweenReads?.(attempt);
    const second = await tryCapture(root);
    if (
      first !== undefined &&
      second !== undefined &&
      captureDigest(first) === captureDigest(second)
    )
      return second;
  }
  throw new StateChangedDuringRead(root);
}

/** The working tree as it stands: its law and its pages, no base. */
export async function fsState(root: string, options: CaptureOptions = {}): Promise<JudgeState> {
  const { law, pages, skipped } = await consistentCapture(root, options);
  return { kind: "working-tree", law, pages, skipped };
}

/** A draft page: a bundle-relative path and the bytes proposed for it. */
export interface Draft {
  path: string;
  bytes: Uint8Array;
}

/** A page a batch moves: the disk's page at `from`, laid at `to`. */
export interface Move {
  from: string;
  to: string;
}

/**
 * Drafts over the working tree, judged together: the pages are the disk's
 * with every draft in its place, and the base is the disk — a page's bytes on
 * disk, `null` for a draft the disk does not hold. A move (`write`'s ops.json)
 * takes the page away from `from`; the draft at `to` has the disk's bytes at
 * `from` as its base, and the move is the state's rename. A draft outside the
 * content roots is refused: it would be judged as a page nothing reads; so is
 * a draft at or under a link or a submodule, which no state reads through.
 */
export async function overlayState(
  root: string,
  drafts: readonly Draft[],
  options: CaptureOptions & { moves?: readonly Move[] } = {},
): Promise<JudgeState> {
  const disk = await consistentCapture(root, options);
  const roots = contentRootsOf(disk.law);
  const pages = new Map(disk.pages);
  const movedFrom = new Map<string, string>();
  for (const move of options.moves ?? []) {
    pages.delete(move.from.normalize("NFC"));
    movedFrom.set(move.to.normalize("NFC"), move.from.normalize("NFC"));
  }
  for (const draft of drafts) {
    const path = draft.path.normalize("NFC");
    if (!isContentPath(path, roots)) {
      throw new Error(
        `the draft "${draft.path}" is not a page under the content roots (${roots.join(", ")})`,
      );
    }
    const behind = disk.skipped.find((s) => path === s.path || path.startsWith(`${s.path}/`));
    if (behind !== undefined) {
      throw new Error(
        `the draft "${draft.path}" is at or under ${behind.path}, a ${behind.kind === "symbolic-link" ? "symbolic link" : "submodule"} no state reads through`,
      );
    }
    pages.set(path, draft.bytes);
  }
  const base = new Map<string, Uint8Array | null>();
  for (const path of pages.keys()) {
    const from = movedFrom.get(path);
    base.set(path, disk.pages.get(from ?? path) ?? null);
  }
  const renames: PageRename[] = [...movedFrom]
    .map(([to, from]) => ({ from, to }))
    .sort((a, b) => codeUnitCompare(a.to, b.to));
  const state: JudgeState = {
    kind: "overlay",
    law: disk.law,
    pages: pageMap(pages),
    base,
    skipped: disk.skipped,
  };
  if (renames.length > 0) state.renames = renames;
  return state;
}

/** A tree entry that is a page: a regular file, not a link (120000) or a submodule (160000). */
function regular(mode: string): boolean {
  return mode !== "120000" && mode !== "160000";
}

/** The links and submodules a listing holds at, under or above a content root. */
function skippedEntries(
  entries: readonly { path: string; mode: string }[],
  bundle: string,
  roots: readonly string[],
): SkippedPath[] {
  const out: SkippedPath[] = [];
  for (const entry of entries) {
    if (regular(entry.mode)) continue;
    const rel = inBundle(bundle, entry.path.normalize("NFC"));
    if (rel === undefined || !isVaultPath(rel) || !touchesContentRoot(rel, roots)) continue;
    out.push({ path: rel, kind: entry.mode === "120000" ? "symbolic-link" : "submodule" });
  }
  return bySkippedPath(out);
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
  // The two answers describe one index. A path the staged diff says is in it
  // — added, modified, retyped, or the new name of a rename or copy — that
  // the listing does not hold means one of them is not whole, and a listing
  // cut at a record boundary is well formed: judged, it would be fewer pages.
  const listedPaths = new Set(entries.map((e) => e.path));
  for (const change of changes) {
    if (!IN_INDEX.has(change.status)) continue;
    const path = change.path.normalize("NFC");
    if (!listedPaths.has(path)) {
      throw new GitInconsistentRead(
        ["diff --cached --name-status -z -M --relative", "ls-files -s -z"],
        `the staged diff names "${path}" (${change.status}) and the index listing does not hold it`,
      );
    }
  }
  const changeOf = new Map(changes.map((c) => [c.path.normalize("NFC"), c] as const));
  const headPaths: string[] = [];
  for (const entry of content) {
    const change = changeOf.get(entry.path);
    const head = change === undefined ? undefined : headPathOf(change);
    if (head !== undefined && !head.includes("\n")) headPaths.push(head);
  }
  // A page the commit deletes: its HEAD bytes, so the base's names hold it.
  const deleted: [string, string][] = [];
  for (const change of changes) {
    if (change.status !== "D") continue;
    const path = change.path.normalize("NFC");
    const rel = inBundle(bundle, path);
    if (rel === undefined || path.includes("\n") || !isContentPath(rel, roots)) continue;
    deleted.push([rel, path]);
    headPaths.push(path);
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
  const skipped = skippedEntries(entries, bundle, roots);
  const state: JudgeState = { kind: "index", law, pages: pageMap(pages), base, renames, skipped };
  const removed = new Map<string, Uint8Array>();
  for (const [rel, path] of deleted) {
    const blob = headBlobs.get(path);
    if (blob !== undefined) removed.set(rel, bytesOf(blob, path));
  }
  if (removed.size > 0) state.removed = pageMap(removed);
  return state;
}

/** The staged-diff statuses whose path the index holds. */
const IN_INDEX: ReadonlySet<string> = new Set(["A", "M", "T", "R", "C"]);

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
  const skipped = skippedEntries(listing, bundle, roots);
  return { kind: "revision", law, pages: pageMap(pages), skipped };
}
