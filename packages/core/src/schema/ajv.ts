// v2 contracts §3.1: every JSON Schema the engine compiles goes through one
// Ajv 2020 instance factory in strict mode, so a schema the engine writes and
// a schema a bundle writes are held to the same dialect and the same
// strictness.
import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js";

export type { ErrorObject };

/** A fresh strict draft 2020-12 validator factory. */
export function strictAjv(): Ajv2020 {
  return new Ajv2020({ strict: true, allErrors: true });
}

/** One Ajv error as a line a reader can act on: where in the value, and what. */
export function errorLine(error: ErrorObject): string {
  const at = error.instancePath === "" ? "/" : error.instancePath;
  if (error.keyword === "additionalProperties") {
    const key = (error.params as { additionalProperty?: string }).additionalProperty;
    return `${at}: unknown key "${String(key)}"`;
  }
  return `${at}: ${error.message ?? error.keyword}`;
}
