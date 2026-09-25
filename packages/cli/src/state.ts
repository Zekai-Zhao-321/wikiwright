// docs/architecture.md §How a verdict is produced (the five state constructors live in the shell) · docs/cli.md §lint
// (--staged, --stdin, --since)
// Each constructor answers one question — "which bytes, against which
// base?" — and hands the answer to the one `judge` in core.
import {
  codeUnitCompare,
  isContentPath,
  parseNameStatusZ,
  type StagedChange,
  type StateRename,
  type VaultState,
} from "@wikiwright/core";
import {
  GitAnswerRefused,
  GitInconsistentRead,
  gitHeadBlobs,
  gitIndexEntries,
  gitReadBlobs,
  gitShowHead,
  gitShowStaged,
  gitStagedChanges,
  gitText,
  type IndexEntry,
  inArgumentOrder,
  terminated,
} from "./git.ts";
import { readPage, type VaultReader, walkPages } from "./vaultio.ts";

/** git's whole answer, read from the file git wrote (git.ts, stdoutfile.ts). */
function git(root: string, argv: string[]): Promise<string> {
  return gitText(root, argv);
}

/** `lint`, `check`: the working tree as it stands. No base — no transition arm. */
export function fsState(root: string, roots: readonly string[]): VaultState {
  const pages = new Map<string, string>();
  for (const rel of walkPages(root, roots).sort(codeUnitCompare)) {
    pages.set(rel, readPage(root, rel));
  }
  return { pages };
}

export interface IndexState extends VaultState {
  /** A `config/` change rescopes the whole vault and suspends demotion. */
  configChanged: boolean;
  reader: VaultReader;
}

/** The index as read once: its staged changes and its entries, each path NFC. */
export interface IndexSnapshot {
  changes: StagedChange[];
  entries: IndexEntry[];
}

/**
 * The two git calls every read of the index starts from. The gate reads the
 * index twice — once for the staged constitution, whose roots it does not know
 * yet, and once for the pages under those roots — and both reads take this one
 * snapshot, so neither call is spawned again for the second.
 */
export async function indexSnapshot(root: string): Promise<IndexSnapshot> {
  // The two reads are asked for together; each is its own git child, and a
  // failure is reported in argument order, the diff's first, whichever child
  // fails sooner.
  const [changes, entries] = await inArgumentOrder([gitStagedChanges(root), gitIndexEntries(root)]);
  const snapshot = {
    changes,
    entries: entries.map((e) => ({ ...e, path: e.path.normalize("NFC") })),
  };
  // The two answers describe one index. A path the staged diff says is in it —
  // added, modified, retyped, or the new name of a rename or copy — that the
  // listing does not hold means one of them is not whole, and a listing cut
  // at a record boundary is well formed: judged, it would be fewer pages.
  const listed = new Set(snapshot.entries.map((e) => e.path));
  for (const change of snapshot.changes) {
    if (!IN_INDEX.has(change.status)) continue;
    const path = change.path.normalize("NFC");
    if (!listed.has(path)) {
      throw new GitInconsistentRead(
        ["diff --cached --name-status -z -M --relative", "ls-files -s -z"],
        `the staged diff names "${path}" (${change.status}) and the index listing does not hold it`,
      );
    }
  }
  return snapshot;
}

/** The staged-diff statuses whose path the index holds. */
const IN_INDEX: ReadonlySet<string> = new Set(["A", "M", "T", "R", "C"]);

/**
 * `lint --staged`, `gate`: the virtual post-index vault. Pages are the INDEX's
 * bytes — what the commit would contain — and the base is HEAD, page by page,
 * with `null` where the page is new. An unchanged page's base is its own staged
 * content, so its diff-gated arms evaluate trivially instead of counting
 * unevaluated.
 */
export async function indexState(
  root: string,
  roots: readonly string[],
  given?: IndexSnapshot,
): Promise<IndexState> {
  const { changes, entries } = given ?? (await indexSnapshot(root));
  const indexSet = new Set(entries.map((e) => e.path));
  const reader: VaultReader = {
    exists: (rel) => indexSet.has(rel),
    read: (rel) => gitShowStaged(root, rel),
  };
  // Stage 0 only: an unmerged path carries stages 1 to 3, and the gate has
  // refused it before this constructor runs.
  const content = entries
    .filter((e) => e.stage === 0 && isContentPath(e.path, roots))
    .sort((a, b) => codeUnitCompare(a.path, b.path));
  const changeByPath = new Map(changes.map((ch) => [ch.path.normalize("NFC"), ch] as const));
  // The path at HEAD a changed page is judged against: its own, or the path it
  // was renamed from. A new page has none.
  const headPathOf = (change: StagedChange): string | undefined =>
    change.status === "A" ? undefined : change.status === "R" ? change.oldPath : change.path;
  const contentPaths = new Set(content.map((e) => e.path));
  const deletions = changes.filter((ch) => {
    if (ch.status !== "D") return false;
    const path = ch.path.normalize("NFC");
    return isContentPath(path, roots) && !contentPaths.has(path);
  });
  const headPaths: string[] = deletions.map((ch) => ch.path);
  for (const { path } of content) {
    const change = changeByPath.get(path);
    const headPath = change === undefined ? undefined : headPathOf(change);
    if (headPath !== undefined) headPaths.push(headPath);
  }
  // Every staged page and every base in one read, by blob id, in a number of git
  // processes bounded by the bytes — not a `git show` per page, which made the
  // gate's cost a process spawn per page in the vault and a bulk commit's a
  // spawn per changed page. A name that holds a newline cannot go on
  // `cat-file`'s line protocol; no content path can hold one, only a rename's
  // source, and that keeps its own `git show`.
  const headBlobs = await gitHeadBlobs(
    root,
    headPaths.filter((p) => !p.includes("\n")),
  );
  const blobs = await gitReadBlobs(root, [
    ...content.map((e) => e.blob),
    ...[...headBlobs.values()].filter((b): b is string => b !== undefined),
  ]);
  const headText = async (path: string | undefined): Promise<string | undefined> => {
    if (path === undefined) return undefined;
    if (path.includes("\n")) return gitShowHead(root, path);
    const blob = headBlobs.get(path);
    if (blob === undefined) return undefined;
    const text = blobs.get(blob);
    if (text === undefined)
      throw new Error(`HEAD names blob ${blob} for "${path}" and git did not return it`);
    return text;
  };
  const pages = new Map<string, string>();
  const base = new Map<string, string | null>();
  for (const { path, blob } of content) {
    const text = blobs.get(blob);
    if (text === undefined)
      throw new Error(`the index names blob ${blob} for "${path}" and git did not return it`);
    pages.set(path, text);
    const change = changeByPath.get(path);
    if (change === undefined) {
      base.set(path, text);
      continue;
    }
    base.set(path, (await headText(headPathOf(change))) ?? null);
  }
  // A deletion is a BASE fact, so `base` carries paths the page set no
  // longer does and the gate can build the name index the base held. The page
  // loop walks `pages`, so a base-only key adds no page and no finding.
  for (const change of deletions) {
    const head = await headText(change.path);
    if (head !== undefined) base.set(change.path.normalize("NFC"), head);
  }
  const renames: StateRename[] = changes
    .filter((ch) => ch.status === "R" && ch.oldPath !== undefined)
    .map((ch) => ({ from: (ch.oldPath ?? "").normalize("NFC"), to: ch.path.normalize("NFC") }))
    .filter((r) => isContentPath(r.to, roots))
    .sort((a, b) => codeUnitCompare(a.to, b.to));
  const configChanged = changes.some(
    (ch) => ch.path.startsWith("config/") || ch.oldPath?.startsWith("config/") === true,
  );
  return { pages, base, renames, configChanged, reader };
}

/**
 * `lint --stdin`, `write`, `fix`: the vault with one or more pages replaced by
 * drafts — ONE virtual state holding all of them, so two new pages that link
 * each other are judged together. The base of each is the DISK bytes at
 * its path when the file exists, so a draft's transitions are judged before a
 * byte lands; a new page has no base and says so.
 */
export function overlayState(
  fs: VaultState,
  root: string,
  drafts: readonly { path: string; text: string }[],
): VaultState {
  const pages = new Map(fs.pages);
  const base = new Map<string, string | null>();
  for (const draft of drafts) {
    // `walkPages` stores NFC, so a caller's NFD path inserted verbatim
    // makes the overlay hold the SAME page twice — a doubled page count, a
    // doubled name index, and `identity-collision` against itself.
    const key = draft.path.normalize("NFC");
    pages.set(key, draft.text);
    try {
      base.set(key, readPage(root, key));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw error;
      base.set(key, null);
    }
  }
  return { pages, base };
}

/** The first-parent commits from `rev` to HEAD, oldest first (replay's walk). */
export async function commitPairs(
  root: string,
  since: string,
): Promise<{ rev: string; base: string }[]> {
  let revs: string[];
  // Each walk is held to git's own count of its range: a walk cut at a line
  // boundary is well formed, and judged it would be a shorter history.
  const list = async (range: string): Promise<string[]> => {
    const args = ["rev-list", "--first-parent", "--reverse", range];
    const counting = ["rev-list", "--first-parent", "--count", range];
    const [walkedText, countText] = await inArgumentOrder([git(root, args), git(root, counting)]);
    const walked = terminated(args, walkedText, "\n")
      .split("\n")
      .filter((s) => s !== "");
    const count = Number.parseInt(terminated(counting, countText, "\n", true), 10);
    if (walked.length !== count) {
      throw new GitInconsistentRead(
        [args.join(" "), counting.join(" ")],
        `the walk lists ${walked.length} commits and the count is ${count}`,
      );
    }
    return walked;
  };
  try {
    revs = await list(`${since}^..HEAD`);
  } catch (error) {
    // A refused answer is not a missing parent: it is refused as itself.
    if (error instanceof GitAnswerRefused) throw error;
    // `<root>^` does not exist, and a repository's first commit is exactly the
    // pair a replay most wants: its base is the empty tree, so every page in it
    // is `added` rather than a page with no arms.
    const all = await list("HEAD");
    const parse = ["rev-parse", since];
    const full = terminated(parse, await git(root, parse), "\n", true).trim();
    const at = all.indexOf(full);
    if (at < 0) throw new Error(`"${since}" is not an ancestor of HEAD`);
    revs = all.slice(at);
  }
  return inArgumentOrder(revs.map(async (rev) => ({ rev, base: await firstParent(root, rev) })));
}

const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

async function firstParent(root: string, commit: string): Promise<string> {
  const args = ["rev-list", "--parents", "-n", "1", commit];
  const parents = terminated(args, await git(root, args), "\n", true)
    .trim()
    .split(" ");
  return parents[1] ?? EMPTY_TREE;
}

interface TreeEntry {
  path: string;
  rawPath: string;
  blob: string;
}

async function lsTree(root: string, commit: string): Promise<TreeEntry[]> {
  const entries: TreeEntry[] = [];
  const args = ["ls-tree", "-r", "-z", commit];
  for (const record of terminated(args, await git(root, args), "\0").split("\0")) {
    if (record === "") continue;
    const tab = record.indexOf("\t");
    if (tab < 0) continue;
    const meta = record.slice(0, tab).split(" ");
    const rawPath = record.slice(tab + 1);
    const blob = meta[2];
    if (blob === undefined || meta[1] !== "blob") continue;
    entries.push({ path: rawPath.normalize("NFC"), rawPath, blob });
  }
  return entries;
}

/** The constitution as it stood at a revision — `lint --since`'s reader. */
export async function revisionReader(root: string, rev: string): Promise<VaultReader> {
  const byPath = new Map((await lsTree(root, rev)).map((e) => [e.path, e] as const));
  return {
    exists: (rel) => byPath.has(rel.normalize("NFC")),
    read: (rel) => {
      const entry = byPath.get(rel.normalize("NFC"));
      if (entry === undefined) throw new Error(`no such path at ${rev}: ${rel}`);
      return git(root, ["cat-file", "blob", entry.blob]);
    },
  };
}

/**
 * `lint --since`: one commit pair as a state. Absorbs `tools/replay.ts`'s walk —
 * the tree at `rev` is the page set, the tree at its first parent is the base,
 * and a path absent from the parent is `null` rather than missing, so a new page
 * is a new page and not a page with no arms.
 */
export async function revisionState(
  root: string,
  rev: string,
  given?: string,
  roots: readonly string[] = ["wiki", "raw", "meta"],
): Promise<VaultState & { renames: StateRename[] }> {
  const base = given ?? (await firstParent(root, rev));
  const [revTree, baseTree] = await inArgumentOrder([lsTree(root, rev), lsTree(root, base)]);
  const current = revTree.filter((e) => isContentPath(e.path, roots));
  const parent = new Map(baseTree.map((e) => [e.path, e] as const));
  const parentContent = [...parent.values()].filter((e) => isContentPath(e.path, roots));
  // Both trees' pages in one read (git.ts `gitReadBlobs`), as the staged gate reads the index.
  const blobs = await gitReadBlobs(
    root,
    [...current, ...parentContent].map((e) => e.blob),
  );
  const read = (entry: TreeEntry): string => {
    const text = blobs.get(entry.blob);
    if (text === undefined)
      throw new Error(`blob ${entry.blob} for "${entry.path}" was not returned`);
    return text;
  };
  const pages = new Map<string, string>();
  const baseMap = new Map<string, string | null>();
  for (const entry of current.sort((a, b) => codeUnitCompare(a.path, b.path))) {
    pages.set(entry.path, read(entry));
    const was = parent.get(entry.path);
    baseMap.set(entry.path, was === undefined ? null : read(was));
  }
  // As for `indexState`: a path the parent held and this revision
  // does not is a base fact the name index needs.
  for (const entry of parentContent) {
    if (baseMap.has(entry.path)) continue;
    baseMap.set(entry.path, read(entry));
  }
  const diff = ["diff", "--name-status", "-z", "-M", `${base}..${rev}`];
  const renames: StateRename[] = parseNameStatusZ(terminated(diff, await git(root, diff), "\0"))
    .filter((ch) => ch.oldPath !== undefined)
    .map((ch) => ({ from: (ch.oldPath ?? "").normalize("NFC"), to: ch.path.normalize("NFC") }))
    .filter((r) => isContentPath(r.to, roots))
    .sort((a, b) => codeUnitCompare(a.to, b.to));
  return { pages, base: baseMap, renames };
}
