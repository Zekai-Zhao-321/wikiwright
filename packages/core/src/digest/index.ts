// v2 contracts §7: digests.
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
