// v2 contracts §7: digests.
//
// `bytes` is sha256 over a page file's bytes: what `read` returns, what
// `write` compares as a base, what `content` aggregates, one line per page,
// `<path>\0<bytes>\n`, sorted by UTF-8 bytes.
//
// `law` is sha256 over one line-framed list: a line per file the loader
// read, `bundle:<path>\0<sha256>\n` or `<library id>:<path>\0<sha256>\n`,
// sorted by UTF-8 bytes; then the interface and profile identities, the
// versions of the dependencies that decide what a law means, and the
// engine's version. The same bytes give the same digest whichever adapter
// read them: the working tree's from disk, the index's and a revision's
// from git.
//
// `page.digest` is the interface's digest of a page: sha256 over its canonical
// frontmatter, the type's `meta` keys removed, then a NUL, then the body's
// bytes. Canonical: YAML 1.2 core schema as parsed (law/yaml.ts), keys sorted
// recursively by code unit, values as JSON.stringify writes them with
// integers as their decimal digits; on a frontmatter parse failure, the raw
// frontmatter bytes in its place. A `meta` key is bookkeeping (a date the
// writer stamps); every other key participates, so a field that changes how
// the page should be read changes its digest.
import { sha256HexOfBytes } from "../hash/index.ts";
import { codeUnitCompare } from "../identity/index.ts";
import { PAGE_INTERFACE } from "../interface/identity.ts";
import type { TypeLaw } from "../law/load.ts";
import { utf8Compare } from "../law/paths.ts";
import { CEL_PROFILE } from "../rules/profile.ts";

declare const TextEncoder: new () => { encode(text: string): Uint8Array };
const ENCODER = new TextEncoder();

/** The canonical serialisation of a parsed YAML value. */
export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const keys = Object.keys(value).sort(codeUnitCompare);
    const record = value as Record<string, unknown>;
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`).join(",")}}`;
  }
  return "null";
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/**
 * §7 `page.digest`. `frontmatter` is the parsed mapping, or the raw
 * frontmatter bytes when it did not parse.
 */
export function pageDigest(
  frontmatter: Record<string, unknown> | Uint8Array,
  meta: readonly string[],
  body: Uint8Array,
): string {
  let head: Uint8Array;
  if (frontmatter instanceof Uint8Array) head = frontmatter;
  else {
    const kept: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(frontmatter))
      if (!meta.includes(key)) kept[key] = value;
    head = ENCODER.encode(canonicalJson(kept));
  }
  return sha256HexOfBytes(concat([head, new Uint8Array([0]), body]));
}

/** UTF-8 bytes of a string, for a caller composing a digest's input. */
export function utf8Bytes(text: string): Uint8Array {
  return ENCODER.encode(text);
}

/** §7 `bytes`: sha256 over a file's bytes as they are. */
export function bytesDigest(bytes: Uint8Array): string {
  return sha256HexOfBytes(bytes);
}

/** §7 `content`: one `<path>\0<bytes>\n` line per page, sorted by UTF-8 bytes. */
export function contentDigest(pages: readonly { path: string; bytes: Uint8Array }[]): string {
  const lines = pages
    .map((page) => `${page.path}\u0000${bytesDigest(page.bytes)}\n`)
    .sort(utf8Compare);
  return sha256HexOfBytes(ENCODER.encode(lines.join("")));
}

/**
 * The dependencies whose versions enter the law digest (§7), as installed.
 * A version bump is a change of law: the same documents may mean something
 * else under another evaluator, schema compiler, YAML reader or parser.
 * `law-digests.test.ts` holds this table to the lockfile.
 */
export const LAW_DEPENDENCIES: Readonly<Record<string, string>> = {
  "@bufbuild/cel": "0.6.1",
  "@bufbuild/re2": "0.6.1",
  "@bufbuild/cel-spec": "0.6.1",
  "@bufbuild/protobuf": "2.15.0",
  ajv: "8.20.0",
  yaml: "2.9.0",
  "mdast-util-from-markdown": "2.0.3",
  micromark: "4.0.2",
};

/** The lines the law digest is taken over, in order: for a reader who wants to see why two differ. */
export function lawLines(law: TypeLaw, engineVersion: string): string[] {
  const files = [...law.files.values()]
    .map((file) => `${file.owner}:${file.path}\u0000${bytesDigest(file.bytes)}\n`)
    .sort(utf8Compare);
  return [
    ...files,
    `profile\u0000${PAGE_INTERFACE}\n`,
    `profile\u0000${CEL_PROFILE}\n`,
    ...Object.entries(LAW_DEPENDENCIES).map(([name, version]) => `dep\u0000${name}@${version}\n`),
    `engine\u0000${engineVersion}\n`,
  ];
}

/** §7 `law`. */
export function lawDigest(law: TypeLaw, engineVersion: string): string {
  return sha256HexOfBytes(ENCODER.encode(lawLines(law, engineVersion).join("")));
}
