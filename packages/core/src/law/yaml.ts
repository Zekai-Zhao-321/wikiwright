// v2 contracts §3 (type, fragment and vocabulary documents are YAML) · §5
// (YAML integers within int64 bind as `int`, other numbers as `double`) · §7
// (the page digest canonicalises YAML 1.2 core-schema frontmatter).
//
// One reading of YAML for the whole v2 law and the page interface: YAML 1.2,
// core schema, duplicate keys refused, integers read as `bigint` so that an
// integer and a float the author wrote stay distinguishable to CEL. A
// consumer that needs JSON numbers (Ajv, the key tables) converts with
// `jsonNumbers`.
import { isScalar, parseDocument, visit } from "yaml";

export type YamlResult =
  | { ok: true; value: unknown }
  | { ok: false; message: string; line?: number };

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
    const line = error.linePos?.[0]?.line;
    return line === undefined
      ? { ok: false, message: reason }
      : { ok: false, message: reason, line };
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
  return { ok: true, value: int64(doc.toJS({ maxAliasCount: 100 })) };
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
