// v2 contracts §3.1: every JSON Schema the engine compiles goes through one
// Ajv 2020 instance factory in strict mode, so a schema the engine writes and
// a schema a bundle writes are held to the same dialect and the same
// strictness: `pattern` runs on RE2 (no lookaround, no backreferences, linear
// time), `format` is asserted for exactly date, date-time and uri, and the two
// engine keywords are registered with their meta-schemas.
import { RE2JS } from "@bufbuild/re2";
import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js";
import { NAME_PATTERN } from "../law/names.ts";
import { FORMATS } from "./formats.ts";

export type { ErrorObject };

/**
 * Ajv's `code.regExp` seam, backed by RE2. Ajv keys its per-instance pattern
 * cache on the compiled object's `toString()`, so an adapter without its own
 * would hand every pattern the first one compiled (the feasibility spike
 * showed `^a$` answering for `^b$`); this one names its pattern.
 */
const re2RegExp = Object.assign(
  (pattern: string, flags: string) => {
    const compiled = RE2JS.compile(pattern);
    return {
      test: (text: string): boolean => compiled.test(text),
      toString: (): string => `re2:/${pattern}/${flags}`,
    };
  },
  // Only Ajv's standalone code generation reads this; the engine never uses it.
  { code: "re2" },
);

/** §3.1: the keywords the engine owns, legal beside a `page-ref` or `page-ref-list`. */
export const ENGINE_KEYWORDS: Readonly<Record<string, Record<string, unknown>>> = {
  // A type name the target must have, ancestry counted: bare or qualified.
  target_type: { type: "string", pattern: `^([a-z0-9]+(-[a-z0-9]+)*/)?${NAME_PATTERN.slice(1)}` },
  // `content`, or a declared source root.
  target_root: { type: "string", minLength: 1 },
};

/** A fresh strict draft 2020-12 validator factory. */
export function strictAjv(options: { strictRequired?: boolean } = {}): Ajv2020 {
  const ajv = new Ajv2020({
    strict: true,
    strictRequired: options.strictRequired ?? true,
    allErrors: true,
    code: { regExp: re2RegExp },
  });
  for (const [name, validate] of Object.entries(FORMATS)) {
    ajv.addFormat(name, { type: "string", validate });
  }
  for (const [keyword, metaSchema] of Object.entries(ENGINE_KEYWORDS)) {
    // Annotation keywords: the judge reads them against the vault's name
    // index; Ajv holds their spelling to the meta-schema.
    ajv.addKeyword({ keyword, schemaType: "string", metaSchema });
  }
  return ajv;
}

/** One Ajv error as a line a reader can act on: where in the value, and what. */
export function errorLine(error: ErrorObject): string {
  const at = error.instancePath === "" ? "/" : error.instancePath;
  if (error.keyword === "additionalProperties") {
    const key = (error.params as { additionalProperty?: string }).additionalProperty;
    return `${at}: unknown key "${String(key)}"`;
  }
  if (error.keyword === "unevaluatedProperties") {
    const key = (error.params as { unevaluatedProperty?: string }).unevaluatedProperty;
    return `${at}: "${String(key)}" is a key no type, fragment or reserved key declares`;
  }
  return `${at}: ${error.message ?? error.keyword}`;
}
