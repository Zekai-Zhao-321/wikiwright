// A page read is a function of its path, its bytes, the law and the engine
// (core `parsePage`), so reads made by one invocation can answer the next.
// This module is that store: one file per bundle and law, under the user's
// cache directory, rewritten after a command that read something new. It is
// derived and safe to delete; a file that does not verify reads as empty.
//
// The pack is keyed by the law digest (law files, profiles, dependency
// versions, engine version), the digest of the emitted engine code the build
// stamped, and the runtime's versions (the serializer's format is the
// runtime's). A build without that stamp keeps nothing,
// since nothing then says which code produced a kept read.
import { createHash, randomBytes } from "node:crypto";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { deserialize, serialize } from "node:v8";
import { constants, zstdCompressSync, zstdDecompressSync } from "node:zlib";
import { lawDigest, type PageRead, type PageReadCache, type TypeLaw } from "@wikiwright/core";
import { ENGINE_VERSION } from "./envelope.ts";

const FORMAT = "wikiwright-page-reads/1";
const MAGIC = Buffer.from("WWPR0001", "latin1");
const DIGEST_BYTES = 32;
/** Packs kept per bundle: a law edited back and forth stays warm, and the directory stays small. */
const PACKS_KEPT = 4;

type Entries = Map<string, Uint8Array>;

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Where the cache lives: `WIKIWRIGHT_CACHE_DIR`, else the platform's user
 * cache directory. `undefined` when `WIKIWRIGHT_NO_CACHE` is set to anything
 * but empty or `0`, or when no directory can be named.
 */
export function cacheRoot(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const off = env["WIKIWRIGHT_NO_CACHE"];
  if (off !== undefined && off !== "" && off !== "0") return undefined;
  const explicit = env["WIKIWRIGHT_CACHE_DIR"];
  if (explicit !== undefined && explicit !== "") return explicit;
  let home: string;
  try {
    home = homedir();
  } catch {
    home = "";
  }
  let base: string | undefined;
  if (process.platform === "win32") base = env["LOCALAPPDATA"] || undefined;
  else if (process.platform === "darwin") base = home ? join(home, "Library", "Caches") : undefined;
  else base = env["XDG_CACHE_HOME"] || (home ? join(home, ".cache") : undefined);
  return base === undefined ? undefined : join(base, "wikiwright");
}

/** The pack file a law reads from, inside one bundle's directory. */
function packName(lawKey: string, code: string): string {
  return `parse-${sha256(`${FORMAT}\0${lawKey}\0${code}\0${JSON.stringify(process.versions)}`)}.bin`;
}

function decodePack(file: Buffer): Entries | undefined {
  if (file.length < MAGIC.length + DIGEST_BYTES) return undefined;
  if (!file.subarray(0, MAGIC.length).equals(MAGIC)) return undefined;
  const digest = file.subarray(MAGIC.length, MAGIC.length + DIGEST_BYTES);
  const payload = file.subarray(MAGIC.length + DIGEST_BYTES);
  if (!createHash("sha256").update(payload).digest().equals(digest)) return undefined;
  const entries: unknown = deserialize(zstdDecompressSync(payload));
  if (!(entries instanceof Map)) return undefined;
  for (const [key, value] of entries) {
    if (typeof key !== "string" || !(value instanceof Uint8Array)) return undefined;
  }
  return entries as Entries;
}

function encodePack(entries: Entries): Buffer {
  const payload = zstdCompressSync(serialize(entries), {
    params: { [constants.ZSTD_c_compressionLevel]: 3 },
  });
  const digest = createHash("sha256").update(payload).digest();
  return Buffer.concat([MAGIC, digest, payload]);
}

function readPack(file: string): Entries {
  try {
    return decodePack(readFileSync(file)) ?? new Map();
  } catch {
    return new Map();
  }
}

/** A read as the store keeps it: the law's type object is named again on the way out. */
function keepable(read: PageRead): Uint8Array {
  if (!read.ok || read.page.type === undefined) return serialize(read);
  const { type: _type, ...page } = read.page;
  return serialize({ ...read, page });
}

function restore(blob: Uint8Array, path: string, law: TypeLaw): PageRead | undefined {
  let read: unknown;
  try {
    read = deserialize(blob);
  } catch {
    return undefined;
  }
  if (typeof read !== "object" || read === null) return undefined;
  const candidate = read as PageRead;
  if (typeof candidate.ok !== "boolean") return undefined;
  if (!candidate.ok) return typeof candidate.code === "string" ? candidate : undefined;
  const page = candidate.page;
  if (typeof page !== "object" || page === null || page.path !== path) return undefined;
  const typeName = page.frontmatter?.["type"];
  const type = typeof typeName === "string" ? law.types.get(typeName) : undefined;
  if (type !== undefined) page.type = type;
  return candidate;
}

interface LawPack {
  file: string;
  old: Entries;
  /** Entries this run made, by key. */
  fresh: Entries;
  /** The key each path was asked for this run, so an old entry for an edited page is dropped. */
  asked: Map<string, string>;
}

/** The store `parsePage` consults, plus the write that keeps what it learned. */
export interface PageStore extends PageReadCache {
  flush(): void;
}

/**
 * The store for one bundle. `bundle` is the invocation's root with its links
 * resolved; `code` the emitted engine's digest. `undefined` when caching is
 * off or there is nothing to key it on.
 */
export function openPageStore(
  bundle: string,
  code: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): PageStore | undefined {
  const root = cacheRoot(env);
  if (root === undefined || typeof code !== "string" || code === "") return undefined;
  const dir = join(root, sha256(bundle));
  const lawKeys = new WeakMap<TypeLaw, string>();
  const packs = new Map<string, LawPack>();
  const digests = new WeakMap<Uint8Array, string>();

  const digestOf = (bytes: Uint8Array): string => {
    let d = digests.get(bytes);
    if (d === undefined) {
      d = sha256(bytes);
      digests.set(bytes, d);
    }
    return d;
  };
  const packOf = (law: TypeLaw): LawPack => {
    let key = lawKeys.get(law);
    if (key === undefined) {
      key = lawDigest(law, ENGINE_VERSION);
      lawKeys.set(law, key);
    }
    let pack = packs.get(key);
    if (pack === undefined) {
      const file = join(dir, packName(key, code));
      pack = { file, old: readPack(file), fresh: new Map(), asked: new Map() };
      packs.set(key, pack);
    }
    return pack;
  };
  const keyOf = (path: string, bytes: Uint8Array): string => `${path}\0${digestOf(bytes)}`;

  return {
    get(path, bytes, law) {
      const pack = packOf(law);
      const key = keyOf(path, bytes);
      pack.asked.set(path, key);
      const blob = pack.fresh.get(key) ?? pack.old.get(key);
      return blob === undefined ? undefined : restore(blob, path, law);
    },
    put(path, bytes, law, read) {
      const pack = packOf(law);
      const key = keyOf(path, bytes);
      pack.asked.set(path, key);
      pack.fresh.set(key, keepable(read));
    },
    flush() {
      for (const pack of packs.values()) {
        if (pack.fresh.size === 0) continue;
        const next: Entries = new Map();
        for (const [key, blob] of pack.old) {
          const path = key.slice(0, key.lastIndexOf("\0"));
          const now = pack.asked.get(path);
          if (now === undefined || now === key) next.set(key, blob);
        }
        for (const [key, blob] of pack.fresh) next.set(key, blob);
        writePack(dir, pack.file, encodePack(next));
      }
    },
  };
}

function writePack(dir: string, file: string, bytes: Buffer): void {
  mkdirSync(dir, { recursive: true });
  const temp = `${file}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    writeFileSync(temp, bytes);
    renameSync(temp, file);
  } catch {
    // Another invocation holds or just replaced it: its pack is as good as ours.
    rmSync(temp, { force: true });
    return;
  }
  prune(dir);
}

/** Keep the newest packs; a stale temp file left by a killed run goes too. */
function prune(dir: string): void {
  const packs: { file: string; at: number }[] = [];
  for (const name of readdirSync(dir)) {
    const file = join(dir, name);
    try {
      const at = statSync(file).mtimeMs;
      if (name.endsWith(".tmp")) {
        if (Date.now() - at > 3_600_000) rmSync(file, { force: true });
      } else if (name.startsWith("parse-") && name.endsWith(".bin")) packs.push({ file, at });
    } catch {
      // Gone already.
    }
  }
  packs.sort((a, b) => b.at - a.at);
  for (const { file } of packs.slice(PACKS_KEPT)) rmSync(file, { force: true });
}
