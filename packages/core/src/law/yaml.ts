// v2 contracts §3 (type, fragment and vocabulary documents are YAML) · §5
// (YAML integers within int64 bind as `int`, other numbers as `double`) · §7
// (the page digest canonicalises YAML 1.2 core-schema frontmatter).
//
// One reading of YAML for the whole v2 law and the page interface: YAML 1.2,
// core schema, duplicate keys refused, integers read as `bigint` so that an
// integer and a float the author wrote stay distinguishable to CEL. A
// consumer that needs JSON numbers (Ajv, the key tables) converts with
// `jsonNumbers`.
import { parseDocument } from "yaml";

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
  return { ok: true, value: int64(doc.toJS({ maxAliasCount: 100 })) };
}

/** An integer outside int64 is a `double`, as §5 binds it. */
function int64(value: unknown): unknown {
  if (typeof value === "bigint") {
    return value < INT64_MIN || value > INT64_MAX ? Number(value) : value;
  }
  if (Array.isArray(value)) return value.map(int64);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) out[key] = int64(v);
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
    for (const [key, v] of Object.entries(value)) out[key] = jsonNumbers(v);
    return out;
  }
  return value;
}

/** A plain mapping, as YAML gives one. */
export function isMapping(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
