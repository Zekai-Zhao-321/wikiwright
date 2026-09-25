// v2 contracts §2 (libraries resolve against the git top level, stay inside
// the repository, and are read from the index under the index adapter) · §7
// (under the index adapter the law's bytes come from git, under the working
// tree from disk) · §10 (constitution and library blobs go through the batch
// reader).
//
// The shell half of the type-document loader: two adapters that each build
// one `LawSnapshot` of the same shape, which core's `loadTypeLaw` reads. Each
// reads twice — `config/engine.json`, whose `libraries` name the rest, then
// every file under the law directories — and neither interprets a byte.
// Beside the old loader (vaultio.ts); no verb reads through this yet.
import { lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
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
import { gitIndexEntries, gitReadBlobBytes, gitTopLevel } from "./git.ts";

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

/** The repository's top level and the bundle's place in it, both real paths. */
async function placeOf(bundleRoot: string): Promise<{ top: string; bundle: string } | undefined> {
  const real = realpathSync(bundleRoot);
  const top = await gitTopLevel(real);
  if (top === undefined) return undefined;
  const realTop = realpathSync(top);
  return { top: realTop, bundle: posix(relative(realTop, real)) };
}

/**
 * Every file under `dir` (repository-relative), without following a link: a
 * link is recorded as one file flagged `link`, file or directory alike, and
 * the loader refuses it by name.
 */
function walk(top: string, dir: string, into: Map<string, LawFile>): void {
  let names: string[];
  try {
    names = readdirSync(join(top, dir), { encoding: "utf8" });
  } catch {
    return;
  }
  for (const name of names.sort(codeUnitCompare)) {
    const rel = `${dir}/${name}`;
    const stat = lstatSync(join(top, rel));
    const key = rel.normalize("NFC");
    if (stat.isSymbolicLink()) into.set(key, { bytes: new Uint8Array(), link: true });
    else if (stat.isDirectory()) walk(top, rel, into);
    else if (stat.isFile()) into.set(key, { bytes: new Uint8Array(readFileSync(join(top, rel))) });
  }
}

function readOne(top: string, rel: string, into: Map<string, LawFile>): void {
  try {
    const stat = lstatSync(join(top, rel));
    if (stat.isSymbolicLink()) into.set(rel, { bytes: new Uint8Array(), link: true });
    else if (stat.isFile()) into.set(rel, { bytes: new Uint8Array(readFileSync(join(top, rel))) });
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
  const files = new Map<string, LawFile>();
  readOne(top, under(bundle, ENGINE_PATH), files);
  for (const dir of BUNDLE_LAW_DIRECTORIES) walk(top, under(bundle, dir), files);
  const directories = new Set<string>();
  const escaped = new Set<string>();
  const engine = files.get(under(bundle, ENGINE_PATH));
  const loaded = loadEngineV4(engine?.link === true ? undefined : engine?.bytes);
  if (loaded.ok) {
    for (const library of libraryDirectories(loaded.engine)) {
      let real: string;
      try {
        if (!statSync(join(top, library)).isDirectory()) continue;
        real = realpathSync(join(top, library));
      } catch {
        continue;
      }
      directories.add(library);
      // Inside by its spelling, outside by the link it passes through.
      if (!real.startsWith(`${top}${sep}`)) {
        escaped.add(library);
        continue;
      }
      readOne(top, `${library}/${LIBRARY_FILE}`, files);
      for (const dir of LIBRARY_LAW_DIRECTORIES) walk(top, `${library}/${dir}`, files);
    }
  }
  return { bundle, files: sorted(files), directories, escaped };
}

/**
 * The index adapter: every stage-0 entry under the law directories, read by
 * blob id through the batch reader. A link is an entry of mode 120000.
 */
export async function indexLawSnapshot(bundleRoot: string): Promise<LawSnapshot> {
  const placed = await placeOf(bundleRoot);
  if (placed === undefined) {
    throw new Error(`"${bundleRoot}" is in no git repository, so it has no index to read`);
  }
  const { top, bundle } = placed;
  const entries = (await gitIndexEntries(top))
    .filter((e) => e.stage === 0)
    .map((e) => ({ ...e, path: e.path.normalize("NFC") }));
  const read = async (paths: (path: string) => boolean): Promise<Map<string, LawFile>> => {
    const chosen = entries.filter((e) => paths(e.path));
    const blobs = await gitReadBlobBytes(
      top,
      chosen.filter((e) => e.mode !== "120000").map((e) => e.blob),
    );
    const out = new Map<string, LawFile>();
    for (const entry of chosen) {
      if (entry.mode === "120000") {
        out.set(entry.path, { bytes: new Uint8Array(), link: true });
        continue;
      }
      const bytes = blobs.get(entry.blob);
      if (bytes === undefined)
        throw new Error(
          `the index names blob ${entry.blob} for "${entry.path}" and git did not return it`,
        );
      out.set(entry.path, { bytes: new Uint8Array(bytes) });
    }
    return out;
  };
  const enginePath = under(bundle, ENGINE_PATH);
  const bundleDirs = BUNDLE_LAW_DIRECTORIES.map((d) => `${under(bundle, d)}/`);
  const files = await read((p) => p === enginePath || bundleDirs.some((d) => p.startsWith(d)));
  const engine = files.get(enginePath);
  const loaded = loadEngineV4(engine?.link === true ? undefined : engine?.bytes);
  const directories = new Set<string>();
  if (loaded.ok) {
    const libraries = libraryDirectories(loaded.engine).filter((library) =>
      entries.some((e) => e.path.startsWith(`${library}/`)),
    );
    for (const library of libraries) directories.add(library);
    const lawDirs = libraries.flatMap((library) =>
      LIBRARY_LAW_DIRECTORIES.map((d) => `${library}/${d}/`),
    );
    const libraryFiles = new Set(libraries.map((library) => `${library}/${LIBRARY_FILE}`));
    const more = await read((p) => libraryFiles.has(p) || lawDirs.some((d) => p.startsWith(d)));
    for (const [path, file] of more) files.set(path, file);
  }
  return { bundle, files: sorted(files), directories };
}
