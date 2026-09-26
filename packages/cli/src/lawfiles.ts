// v2 contracts §2 (libraries resolve against the git top level, stay inside
// the repository, and are read from the index under the index adapter) · §7
// (under the index adapter the law's bytes come from git, under the working
// tree from disk) · §10 (constitution and library blobs go through the batch
// reader).
//
// The shell half of the type-document loader: three adapters — the working
// tree, the index and a revision — that each build one `LawSnapshot` of the
// same shape, which core's `loadTypeLaw` reads. Each reads twice —
// `config/engine.json`, whose `libraries` name the rest, then every file
// under the law directories — and none interprets a byte. Beside the old
// loader (vaultio.ts); the v2 states (lawstate.ts) read through these, and
// no verb does yet.
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { join, relative, sep } from "node:path";
import {
  BUNDLE_LAW_DIRECTORIES,
  codeUnitCompare,
  ENGINE_PATH,
  type LawFile,
  type LawSnapshot,
  LIBRARY_FILE,
  LIBRARY_LAW_DIRECTORIES,
  libraryDirectories,
  loadEngineV4,
} from "@wikiwright/core";
import { gitIndexEntries, gitReadBlobBytes, gitTopLevel, gitTreeListing } from "./git.ts";

function posix(path: string): string {
  return sep === "/" ? path : path.split(sep).join("/");
}

/** The files in code-unit order of path, whichever adapter listed them. */
function sorted(files: Map<string, LawFile>): Map<string, LawFile> {
  return new Map([...files].sort(([a], [b]) => codeUnitCompare(a, b)));
}

function under(prefix: string, rel: string): string {
  return prefix === "" ? rel : `${prefix}/${rel}`;
}

/**
 * The repository's top level and the bundle's place in it, both real paths.
 * `bundle` is in NFC, as every snapshot key is (the index's paths are
 * normalised the same way); `disk` is the place as the filesystem spells
 * it, for reading, which a normalisation-sensitive filesystem needs.
 */
async function placeOf(
  bundleRoot: string,
): Promise<{ top: string; bundle: string; disk: string } | undefined> {
  const real = realpathSync(bundleRoot);
  const top = await gitTopLevel(real);
  if (top === undefined) return undefined;
  const realTop = realpathSync(top);
  const disk = posix(relative(realTop, real));
  return { top: realTop, bundle: disk.normalize("NFC"), disk };
}

/** A snapshot key: the repository-relative path in NFC. */
function key(rel: string): string {
  return rel.normalize("NFC");
}

const EMPTY = new Uint8Array();

/** A symbolic link, or a directory holding `.git` (a submodule or a nested repository). */
function foreignAt(top: string, rel: string): LawFile | undefined {
  let stat: ReturnType<typeof lstatSync>;
  try {
    stat = lstatSync(join(top, rel));
  } catch {
    return undefined;
  }
  if (stat.isSymbolicLink()) return { bytes: EMPTY, link: true };
  if (stat.isDirectory() && existsSync(join(top, rel, ".git")))
    return { bytes: EMPTY, link: true, submodule: true };
  return undefined;
}

/**
 * The first component of `rel` below `base` that is a link or a nested
 * repository, as the file the loader records in `rel`'s place: the index
 * holds such a component as one entry (mode 120000 or 160000) and nothing
 * under it, so the tree must not read through it either.
 */
function crossing(top: string, base: string, rel: string): LawFile | undefined {
  const below = base === "" ? rel : rel.slice(base.length + 1);
  let at = base;
  for (const segment of below.split("/")) {
    at = under(at, segment);
    const foreign = foreignAt(top, at);
    if (foreign !== undefined) return foreign;
  }
  return undefined;
}

/**
 * Every file under the law directory `dir` (repository-relative), without
 * following a link: a link, or a directory that is a nested repository, is
 * recorded as one file flagged `link`, the directory itself included, and
 * the loader refuses it by name. `base` is where the check for such a
 * component starts (the bundle root, or the library root).
 */
function walk(top: string, base: string, dir: string, into: Map<string, LawFile>): void {
  const foreign = crossing(top, base, dir);
  if (foreign !== undefined) {
    into.set(key(dir), foreign);
    return;
  }
  try {
    if (lstatSync(join(top, dir)).isDirectory()) list(top, dir, into);
  } catch {
    // Absent: a law directory is optional.
  }
}

function list(top: string, dir: string, into: Map<string, LawFile>): void {
  for (const name of readdirSync(join(top, dir), { encoding: "utf8" }).sort(codeUnitCompare)) {
    const rel = `${dir}/${name}`;
    const foreign = foreignAt(top, rel);
    if (foreign !== undefined) {
      into.set(key(rel), foreign);
      continue;
    }
    const stat = lstatSync(join(top, rel));
    if (stat.isDirectory()) list(top, rel, into);
    else if (stat.isFile())
      into.set(key(rel), { bytes: new Uint8Array(readFileSync(join(top, rel))) });
  }
}

/** One file at `rel`, unless it or a directory between `base` and it is a link. */
function readOne(top: string, base: string, rel: string, into: Map<string, LawFile>): void {
  const foreign = crossing(top, base, rel);
  if (foreign !== undefined) {
    into.set(key(rel), foreign);
    return;
  }
  try {
    if (lstatSync(join(top, rel)).isFile())
      into.set(key(rel), { bytes: new Uint8Array(readFileSync(join(top, rel))) });
  } catch {
    // Absent: the loader names what it needed and did not find.
  }
}

/**
 * The working-tree adapter. A bundle in no repository is its own top level,
 * so a library path is read from the bundle root; the envelope's `head` says
 * there is no repository.
 */
export async function workingTreeLawSnapshot(bundleRoot: string): Promise<LawSnapshot> {
  const placed = await placeOf(bundleRoot);
  const top = placed?.top ?? realpathSync(bundleRoot);
  const bundle = placed?.bundle ?? "";
  const disk = placed?.disk ?? "";
  const files = new Map<string, LawFile>();
  readOne(top, disk, under(disk, ENGINE_PATH), files);
  for (const dir of BUNDLE_LAW_DIRECTORIES) walk(top, disk, under(disk, dir), files);
  const directories = new Set<string>();
  const engine = files.get(under(bundle, ENGINE_PATH));
  const loaded = loadEngineV4(engine?.link === true ? undefined : engine?.bytes);
  if (loaded.ok) {
    for (const library of libraryDirectories(loaded.engine)) {
      // A library root that is, or lies under, a link or a nested repository
      // is recorded in its own place, as the index adapter records it.
      const foreign = crossing(top, "", library);
      if (foreign !== undefined) {
        directories.add(library);
        files.set(library, foreign);
        continue;
      }
      try {
        if (!lstatSync(join(top, library)).isDirectory()) continue;
      } catch {
        continue;
      }
      directories.add(library);
      readOne(top, library, `${library}/${LIBRARY_FILE}`, files);
      for (const dir of LIBRARY_LAW_DIRECTORIES) walk(top, library, `${library}/${dir}`, files);
    }
  }
  return { bundle, files: sorted(files), directories };
}

/** An index entry the loader never reads through: a link (120000) or a submodule (160000). */
function foreignEntry(mode: string): LawFile | undefined {
  if (mode === "120000") return { bytes: EMPTY, link: true };
  if (mode === "160000") return { bytes: EMPTY, link: true, submodule: true };
  return undefined;
}

/** One entry of a git tree the law is read from: the index's stage 0, or a revision's tree. */
export interface GitLawEntry {
  /** Repository-relative, NFC. */
  path: string;
  /** The blob (or, for a submodule, the commit) the entry names. */
  object: string;
  mode: string;
}

/**
 * The law of a git tree — the index's or a revision's — from its entries:
 * every entry under the law directories, read by blob id through the batch
 * reader. A link is an entry of mode 120000 and a submodule one of mode
 * 160000; either, at a law directory, at a library root or on the way to one,
 * is recorded in that place, as the working-tree adapter records it.
 */
export async function lawSnapshotOfEntries(
  top: string,
  bundle: string,
  entries: readonly GitLawEntry[],
): Promise<LawSnapshot> {
  const foreignEntries = new Map<string, LawFile>();
  for (const entry of entries) {
    const foreign = foreignEntry(entry.mode);
    if (foreign !== undefined) foreignEntries.set(entry.path, foreign);
  }
  /** The first link or submodule entry on the way from `base` down to `rel`. */
  const crossingEntry = (base: string, rel: string): LawFile | undefined => {
    const below = base === "" ? rel : rel.slice(base.length + 1);
    let at = base;
    for (const segment of below.split("/")) {
      at = under(at, segment);
      const foreign = foreignEntries.get(at);
      if (foreign !== undefined) return foreign;
    }
    return undefined;
  };
  const read = async (paths: (path: string) => boolean): Promise<Map<string, LawFile>> => {
    const chosen = entries.filter((e) => paths(e.path));
    const blobs = await gitReadBlobBytes(
      top,
      chosen.filter((e) => foreignEntry(e.mode) === undefined).map((e) => e.object),
    );
    const out = new Map<string, LawFile>();
    for (const entry of chosen) {
      const foreign = foreignEntry(entry.mode);
      if (foreign !== undefined) {
        out.set(entry.path, foreign);
        continue;
      }
      const bytes = blobs.get(entry.object);
      if (bytes === undefined)
        throw new Error(
          `the tree names blob ${entry.object} for "${entry.path}" and git did not return it`,
        );
      out.set(entry.path, { bytes: new Uint8Array(bytes) });
    }
    return out;
  };
  /** Law directories whose own place is a link or a submodule, recorded there; the rest to read. */
  const lawDirectories = (base: string, dirs: readonly string[], into: Map<string, LawFile>) =>
    dirs.filter((dir) => {
      const foreign = crossingEntry(base, dir);
      if (foreign !== undefined) into.set(dir, foreign);
      return foreign === undefined;
    });
  const enginePath = under(bundle, ENGINE_PATH);
  const files = new Map<string, LawFile>();
  const bundleDirs = lawDirectories(
    bundle,
    BUNDLE_LAW_DIRECTORIES.map((d) => under(bundle, d)),
    files,
  ).map((d) => `${d}/`);
  const engineCrossing = crossingEntry(bundle, enginePath);
  if (engineCrossing !== undefined) files.set(enginePath, engineCrossing);
  const bundleFiles = await read(
    (p) =>
      (p === enginePath && engineCrossing === undefined) || bundleDirs.some((d) => p.startsWith(d)),
  );
  for (const [path, file] of bundleFiles) files.set(path, file);
  const engine = files.get(enginePath);
  const loaded = loadEngineV4(engine?.link === true ? undefined : engine?.bytes);
  const directories = new Set<string>();
  if (loaded.ok) {
    const libraries: string[] = [];
    for (const library of libraryDirectories(loaded.engine)) {
      const foreign = crossingEntry("", library);
      if (foreign !== undefined) {
        directories.add(library);
        files.set(library, foreign);
      } else if (entries.some((e) => e.path.startsWith(`${library}/`))) {
        directories.add(library);
        libraries.push(library);
      }
    }
    const lawDirs = libraries.flatMap((library) =>
      lawDirectories(
        library,
        LIBRARY_LAW_DIRECTORIES.map((d) => `${library}/${d}`),
        files,
      ).map((d) => `${d}/`),
    );
    const libraryFiles = new Set(libraries.map((library) => `${library}/${LIBRARY_FILE}`));
    const more = await read((p) => libraryFiles.has(p) || lawDirs.some((d) => p.startsWith(d)));
    for (const [path, file] of more) files.set(path, file);
  }
  return { bundle, files: sorted(files), directories };
}

/** The repository's top level and the bundle's place in it, or a refusal naming the root. */
export async function repositoryPlace(
  bundleRoot: string,
): Promise<{ top: string; bundle: string; disk: string }> {
  const placed = await placeOf(bundleRoot);
  if (placed === undefined) {
    throw new Error(`"${bundleRoot}" is in no git repository, so it has no index to read`);
  }
  return placed;
}

/** The index adapter: every stage-0 entry under the law directories. */
export async function indexLawSnapshot(bundleRoot: string): Promise<LawSnapshot> {
  const { top, bundle } = await repositoryPlace(bundleRoot);
  const entries = (await gitIndexEntries(top))
    .filter((e) => e.stage === 0)
    .map((e) => ({ path: e.path.normalize("NFC"), object: e.blob, mode: e.mode }));
  return lawSnapshotOfEntries(top, bundle, entries);
}

/**
 * The revision adapter (contracts §10 `revisionState`, and HEAD's law for the
 * gate's law diff, §8): the law of a revision's tree, from one listing.
 */
export async function revisionLawSnapshot(
  bundleRoot: string,
  rev: string,
  listing?: readonly GitLawEntry[],
): Promise<LawSnapshot> {
  const { top, bundle } = await repositoryPlace(bundleRoot);
  return lawSnapshotOfEntries(top, bundle, listing ?? (await revisionEntries(top, rev)));
}

/** A revision's tree as law entries: repository-relative NFC paths. */
export async function revisionEntries(top: string, rev: string): Promise<GitLawEntry[]> {
  return (await gitTreeListing(top, rev)).map((e) => ({
    path: e.path.normalize("NFC"),
    object: e.object,
    mode: e.mode,
  }));
}
