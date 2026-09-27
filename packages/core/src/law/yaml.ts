// v2 contracts §3 (type, fragment and vocabulary documents are YAML) · §5
// (YAML integers within int64 bind as `int`, other numbers as `double`) · §7
// (the page digest canonicalises YAML 1.2 core-schema frontmatter).
//
// One reading of YAML for the whole v2 law and the page interface: YAML 1.2,
// core schema, duplicate keys refused, integers read as `bigint` so that an
// integer and a float the author wrote stay distinguishable to CEL. A
// consumer that needs JSON numbers (Ajv, the key tables) converts with
// `jsonNumbers`.
import { isMap, isScalar, parseDocument, visit } from "yaml";

export type YamlResult =
  | {
      ok: true;
      value: unknown;
      /** Each top-level key of a mapping, and the line of the text it is written on (from 1). */
      keyLines: Map<string, number>;
    }
  | {
      ok: false;
      message: string;
      line?: number;
      /** The `yaml` library's code (`DUPLICATE_KEY` a repeated key), when it gave one. */
      code?: string;
    };

const INT64_MIN = -(2n ** 63n);
const INT64_MAX = 2n ** 63n - 1n;

/** Parse one YAML document. */
export function readYaml(text: string): YamlResult {
  const doc = parseDocument(text, {
    version: "1.2",
    schema: "core",
    intAsBigInt: true,
    uniqueKeys: true,
    prettyErrors: false,
  });
  const error = doc.errors[0];
  if (error !== undefined) {
    const reason = (error.message.split("\n")[0] ?? error.message).trim();
    // `linePos` is filled only under pretty errors; the offset is always there.
    const offset = error.pos?.[0];
    const line =
      error.linePos?.[0]?.line ??
      (offset === undefined ? undefined : text.slice(0, offset).split("\n").length);
    return {
      ok: false,
      message: reason,
      code: error.code,
      ...(line === undefined ? {} : { line }),
    };
  }
  // `__proto__` is refused as a key: copied into an object by assignment it
  // would set the object's prototype rather than add a key, and its members
  // would then satisfy a shape by inheritance while leaving the digest.
  let proto: number | undefined;
  visit(doc, {
    Pair(_key, pair) {
      if (isScalar(pair.key) && pair.key.value === "__proto__") {
        proto = pair.key.range?.[0] ?? 0;
        return visit.BREAK;
      }
      return undefined;
    },
  });
  if (proto !== undefined) {
    return {
      ok: false,
      message: 'the key "__proto__" is refused',
      line: text.slice(0, proto).split("\n").length,
    };
  }
  // An alias bomb or cyclic alias is a document that does not read, never an
  // internal error from a later recursive normalizer.
  try {
    const value = doc.toJS({ maxAliasCount: 100 });
    assertFiniteYamlGraph(value);
    return { ok: true, value: int64(value), keyLines: keyLinesOf(doc.contents, text) };
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
}

/** Refuse cyclic aliases and excessive nesting before any recursive consumer sees them. */
export function assertFiniteYamlGraph(value: unknown): void {
  const active = new WeakSet<object>();
  let visited = 0;
  const walk = (node: unknown, depth: number): void => {
    if (node === null || typeof node !== "object") return;
    if (depth > 128) throw new Error("YAML value is nested more than 128 levels");
    if (active.has(node)) throw new Error("YAML aliases form a cycle");
    visited += 1;
    if (visited > 100_000) throw new Error("YAML value has more than 100000 members");
    active.add(node);
    for (const child of Object.values(node)) walk(child, depth + 1);
    active.delete(node);
  };
  walk(value, 0);
}

/** The line each top-level key starts on, counted forward once through the text. */
function keyLinesOf(contents: unknown, text: string): Map<string, number> {
  const out = new Map<string, number>();
  if (!isMap(contents)) return out;
  let line = 1;
  let at = 0;
  for (const pair of contents.items) {
    const key = pair.key;
    const offset = isScalar(key) ? key.range?.[0] : undefined;
    if (!isScalar(key) || offset === undefined || offset < at) continue;
    for (let i = text.indexOf("\n", at); i !== -1 && i < offset; i = text.indexOf("\n", i + 1))
      line += 1;
    at = offset;
    out.set(String(key.value), line);
  }
  return out;
}

/**
 * Set `key` on `target` as an own data property. Plain assignment of
 * `__proto__` sets the prototype instead; every copy the v2 law and the page
 * interface make goes through this.
 */
export function setOwn(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

/** An integer outside int64 is a `double`, as §5 binds it. */
function int64(value: unknown): unknown {
  if (typeof value === "bigint") {
    return value < INT64_MIN || value > INT64_MAX ? Number(value) : value;
  }
  if (Array.isArray(value)) return value.map(int64);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) setOwn(out, key, int64(v));
    return out;
  }
  return value;
}

/** The same value with every `bigint` as a JSON number, for Ajv and the key tables. */
export function jsonNumbers(value: unknown): unknown {
  if (typeof value === "bigint") return Number(value);
  if (Array.isArray(value)) return value.map(jsonNumbers);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) setOwn(out, key, jsonNumbers(v));
    return out;
  }
  return value;
}

/** A plain mapping, as YAML gives one. */
export function isMapping(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
