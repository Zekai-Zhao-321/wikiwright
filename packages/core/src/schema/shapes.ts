// v2 contracts §3.1: the effective shape of a type. Each document's `fields`
// is checked for what the engine reserves, given its own `$id` and the
// engine's `$defs`, compiled on its own to attribute its errors to it, and
// then composed: `allOf` of the reserved keys' schema and every document in
// linearisation order, with one `unevaluatedProperties: false` at the
// concrete type when `extensions.mode` is `registered` (an author may close a
// nested object, ruling 8). `shape-relaxed` and
// `default-conflict` compare a child's declared keywords with its ancestors'.
import type { Ajv2020, ValidateFunction } from "ajv/dist/2020.js";
import type { LawType } from "../law/compose.ts";
import type { EngineV4 } from "../law/engine.ts";
import type { LawIssue } from "../law/issues.ts";
import { resolveReference } from "../law/names.ts";
import { strictAjv } from "./ajv.ts";
import { reservedShape } from "./reserved.ts";

/** §3.1: the engine's `$defs`, reserved names every document can `$ref`. */
export const ENGINE_DEFS: Readonly<Record<string, Record<string, unknown>>> = {
  // A canonical page name as written inside [[ ]], e.g. "Pruning roses".
  "page-ref": { type: "string", minLength: 1 },
  "page-ref-list": { type: "array", items: { $ref: "#/$defs/page-ref" } },
  pin: {
    type: "object",
    properties: {
      commit: { type: "string", pattern: "^[0-9a-f]{7,64}$" },
      // "." for this repository, else a path or URL as today.
      origin: { type: "string" },
      covers: { type: "array", items: { type: "string" } },
    },
    required: ["commit", "origin", "covers"],
    additionalProperties: false,
  },
};

/** Keywords that hold subschemas by name, by position, or as one schema. */
const MAP_KEYWORDS = new Set(["properties", "patternProperties", "$defs", "dependentSchemas"]);
const LIST_KEYWORDS = new Set(["allOf", "anyOf", "oneOf", "prefixItems"]);
const ONE_KEYWORDS = new Set([
  "items",
  "contains",
  "not",
  "if",
  "then",
  "else",
  "propertyNames",
  "unevaluatedItems",
]);
/** Keywords whose subschemas apply to the same instance: at the top, the frontmatter itself. */
const IN_PLACE_KEYWORDS = new Set([
  "allOf",
  "anyOf",
  "oneOf",
  "not",
  "if",
  "then",
  "else",
  "dependentSchemas",
]);
/** Identifiers the engine assigns or does not admit: an authored one would re-root a document. */
const IDENTIFIERS = ["$id", "$anchor", "$dynamicAnchor", "$dynamicRef", "$schema", "$vocabulary"];
const REF_TARGETS = new Set(["#/$defs/page-ref", "#/$defs/page-ref-list"]);

export interface ShapeContext {
  /** Every type the law declares, by qualified name: what `target_type` may name. */
  types: ReadonlySet<string>;
  /** `content` and the declared source roots: what `target_root` may name. */
  roots: ReadonlySet<string>;
}

/**
 * The authored rules §3.1 states that Ajv cannot: no closing keyword (the
 * engine closes the shape once), no identifier, `$ref` only into this
 * document's `$defs` or the engine's, the engine keywords only beside a page
 * reference, and no document `$def` under a reserved name.
 */
export function authoredShapeIssues(
  schema: Record<string, unknown>,
  namespace: string,
  where: string,
  context: ShapeContext,
): LawIssue[] {
  const issues: LawIssue[] = [];
  const invalid = (pointer: string, message: string): void => {
    issues.push({
      code: "shape-invalid",
      where,
      message: `/fields${pointer}: ${message}`,
      details: { pointer: `/fields${pointer}` },
    });
  };
  const defs = schema["$defs"];
  const ownDefs = new Set(
    defs !== null && typeof defs === "object" && !Array.isArray(defs) ? Object.keys(defs) : [],
  );
  for (const name of ownDefs) {
    if (!(name in ENGINE_DEFS)) continue;
    issues.push({
      code: "constitution-collision",
      where,
      message: `/fields/$defs/${name}: "${name}" is an engine $def; a document may $ref it, never declare it`,
      details: { pointer: `/fields/$defs/${name}`, name },
    });
  }
  // Ruling 8: the closing keywords are refused where they would close the
  // page's frontmatter itself — the top of `fields` and the subschemas
  // applied in place there — and admitted on a nested object.
  const walk = (node: unknown, pointer: string, top: boolean): void => {
    if (node === null || typeof node !== "object" || Array.isArray(node)) return;
    const record = node as Record<string, unknown>;
    for (const key of ["additionalProperties", "unevaluatedProperties"]) {
      if (top && key in record) {
        invalid(
          `${pointer}/${key}`,
          `an authored ${key} on the frontmatter itself; the engine closes the effective shape once, under extensions.mode (a nested object may be closed)`,
        );
      }
    }
    for (const key of IDENTIFIERS) {
      if (key in record) invalid(`${pointer}/${key}`, `${key} is the engine's to assign`);
    }
    const ref = record["$ref"];
    if (ref !== undefined) {
      const match = typeof ref === "string" ? /^#\/\$defs\/([^/]+)$/u.exec(ref) : null;
      const target = match?.[1];
      if (target === undefined || (!ownDefs.has(target) && !(target in ENGINE_DEFS))) {
        invalid(
          `${pointer}/$ref`,
          `${JSON.stringify(ref)} resolves to no $def of this document or of the engine (page-ref, page-ref-list, pin)`,
        );
      }
    }
    for (const keyword of ["target_type", "target_root"]) {
      const value = record[keyword];
      if (value === undefined) continue;
      if (typeof ref !== "string" || !REF_TARGETS.has(ref)) {
        invalid(
          `${pointer}/${keyword}`,
          `${keyword} is legal beside a page-ref or page-ref-list only`,
        );
        continue;
      }
      if (keyword === "target_type") {
        const name = typeof value === "string" ? resolveReference(namespace, value) : undefined;
        if (name === undefined || !context.types.has(name)) {
          invalid(
            `${pointer}/${keyword}`,
            `${JSON.stringify(value)} is no type the bundle or its libraries declare`,
          );
        }
      } else if (typeof value !== "string" || !context.roots.has(value)) {
        invalid(
          `${pointer}/${keyword}`,
          `${JSON.stringify(value)} is neither "content" nor a declared source root (${[...context.roots].join(", ")})`,
        );
      }
    }
    for (const [key, value] of Object.entries(record)) {
      const inPlace = top && IN_PLACE_KEYWORDS.has(key);
      if (MAP_KEYWORDS.has(key) && value !== null && typeof value === "object") {
        for (const [name, sub] of Object.entries(value))
          walk(sub, `${pointer}/${key}/${name}`, inPlace);
      } else if (LIST_KEYWORDS.has(key) && Array.isArray(value)) {
        value.forEach((sub, i) => {
          walk(sub, `${pointer}/${key}/${i}`, inPlace);
        });
      } else if (ONE_KEYWORDS.has(key)) walk(value, `${pointer}/${key}`, inPlace);
    }
  };
  walk(schema, "", true);
  return issues;
}

/** A document's schema as an Ajv resource: its engine `$id` and the engine `$defs` beside its own. */
export function documentResource(
  id: string,
  schema: Record<string, unknown>,
): Record<string, unknown> {
  const own = schema["$defs"];
  return {
    ...schema,
    $id: id,
    $defs: { ...(own !== null && typeof own === "object" ? own : {}), ...ENGINE_DEFS },
  };
}

function compileMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).split("\n")[0] ?? "";
}

export interface CompiledShapes {
  validators: Map<string, ValidateFunction>;
  /** Each type's effective shape as compiled, for `type show` and the judge. */
  schemas: Map<string, Record<string, unknown>>;
  issues: LawIssue[];
}

/** §3.1: every type's effective shape, compiled once per load. */
export function compileShapes(
  types: ReadonlyMap<string, LawType>,
  engine: EngineV4,
): CompiledShapes {
  const issues: LawIssue[] = [];
  const context: ShapeContext = {
    types: new Set(types.keys()),
    roots: new Set(["content", ...engine.source_roots]),
  };
  // One resource object per document, reused by every type it composes:
  // Ajv accepts an embedded `$id` it has seen when it is the same schema.
  const resources = new Map<string, Record<string, unknown>>();
  const reserved = documentResource("wikiwright:reserved", reservedShape(engine.field_sources));
  const isolated: Ajv2020 = strictAjv({ strictRequired: false });
  const failed = new Set<string>();
  for (const type of types.values()) {
    for (const part of type.parts) {
      if (resources.has(part.origin) || failed.has(part.origin)) continue;
      const [kind, name] = [
        part.origin.slice(0, part.origin.indexOf(":")),
        part.origin.slice(part.origin.indexOf(":") + 1),
      ];
      const namespace = name.includes("/") ? name.slice(0, name.indexOf("/")) : "";
      const authored = authoredShapeIssues(part.schema, namespace, part.where, context);
      if (authored.length > 0) {
        issues.push(...authored);
        failed.add(part.origin);
        continue;
      }
      const resource = documentResource(`wikiwright:${kind}/${name}`, part.schema);
      try {
        // On its own, to name the document an error belongs to. `required`
        // may name a property an earlier document declares, so that one
        // strictness waits for the composed shape.
        isolated.compile(resource);
      } catch (error) {
        issues.push({
          code: "shape-invalid",
          where: part.where,
          message: `/fields: ${compileMessage(error)}`,
          details: { pointer: "/fields" },
        });
        failed.add(part.origin);
        continue;
      }
      resources.set(part.origin, resource);
    }
  }
  const validators = new Map<string, ValidateFunction>();
  const schemas = new Map<string, Record<string, unknown>>();
  if (issues.length > 0) return { validators, schemas, issues };
  const ajv = strictAjv();
  for (const type of types.values()) {
    const effective: Record<string, unknown> = {
      $id: `wikiwright:shape/${type.name}`,
      type: "object",
      allOf: [reserved, ...type.parts.map((p) => resources.get(p.origin))],
    };
    if (engine.extensions.mode === "registered") effective["unevaluatedProperties"] = false;
    try {
      validators.set(type.name, ajv.compile(effective));
      schemas.set(type.name, effective);
    } catch (error) {
      issues.push({
        code: "shape-invalid",
        where: type.where,
        message: `/fields: the effective shape of ${type.name} does not compile: ${compileMessage(error)}`,
        details: { pointer: "/fields" },
      });
    }
  }
  issues.push(...relaxations(types));
  return { validators, schemas, issues };
}

const RISE_ONLY = ["minimum", "exclusiveMinimum", "minLength", "minItems", "minProperties"];
const FALL_ONLY = ["maximum", "exclusiveMaximum", "maxLength", "maxItems", "maxProperties"];

function declarationsOf(
  type: LawType,
  property: string,
): { origin: string; schema: Record<string, unknown> }[] {
  const out: { origin: string; schema: Record<string, unknown> }[] = [];
  for (const part of type.parts) {
    const properties = part.schema["properties"];
    if (properties === null || typeof properties !== "object") continue;
    const declared = (properties as Record<string, unknown>)[property];
    if (declared !== null && typeof declared === "object" && !Array.isArray(declared)) {
      out.push({ origin: part.origin, schema: declared as Record<string, unknown> });
    }
  }
  return out;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * §3.1 `shape-relaxed`: a child's own declaration of a property against each
 * ancestor's effective declarations of it, keyword by keyword. No
 * implication prover: only the keywords named here, compared as written.
 * `required` may only grow, which `allOf` guarantees, so it is not compared.
 */
function relaxations(types: ReadonlyMap<string, LawType>): LawIssue[] {
  const issues: LawIssue[] = [];
  for (const type of types.values()) {
    const own = type.parts.find((p) => p.origin === `type:${type.name}`);
    const properties = own?.schema["properties"];
    if (own === undefined || properties === null || typeof properties !== "object") continue;
    for (const [property, value] of Object.entries(properties)) {
      if (value === null || typeof value !== "object") continue;
      const child = value as Record<string, unknown>;
      for (const ancestorName of type.ancestry) {
        const ancestor = types.get(ancestorName);
        if (ancestor === undefined) continue;
        for (const declared of declarationsOf(ancestor, property)) {
          const report = (code: string, keyword: string, message: string, kind?: string): void => {
            issues.push({
              code,
              where: type.where,
              message: `/fields/properties/${property}/${keyword}: ${message} (${declared.origin.replace(/^[a-z]+:/u, "")} declares ${JSON.stringify(declared.schema[keyword])})`,
              details: {
                pointer: `/fields/properties/${property}/${keyword}`,
                keyword,
                ancestor: declared.origin,
                ...(kind === undefined ? {} : { kind }),
              },
            });
          };
          const theirs = declared.schema;
          if (Array.isArray(child["enum"]) && Array.isArray(theirs["enum"])) {
            const inherited = theirs["enum"] as unknown[];
            const mine = child["enum"] as unknown[];
            const inside = mine.filter((v) => inherited.some((w) => same(v, w)));
            if (inside.length === 0) {
              report(
                "shape-relaxed",
                "enum",
                "no value is in the inherited enum: the two contradict",
                "contradiction",
              );
            } else if (inside.length < mine.length) {
              report(
                "shape-relaxed",
                "enum",
                "the enum admits a value the inherited enum does not",
                "relaxed",
              );
            }
          }
          for (const keyword of ["type", "const"]) {
            if (child[keyword] === undefined || theirs[keyword] === undefined) continue;
            if (!same(child[keyword], theirs[keyword])) {
              report(
                "shape-relaxed",
                keyword,
                `${keyword} ${JSON.stringify(child[keyword])} differs from the inherited one`,
              );
            }
          }
          for (const keyword of RISE_ONLY) {
            const mine = child[keyword];
            const inherited = theirs[keyword];
            if (typeof mine === "number" && typeof inherited === "number" && mine < inherited) {
              report(
                "shape-relaxed",
                keyword,
                `${keyword} ${mine} lowers the inherited bound; it may only rise`,
              );
            }
          }
          for (const keyword of FALL_ONLY) {
            const mine = child[keyword];
            const inherited = theirs[keyword];
            if (typeof mine === "number" && typeof inherited === "number" && mine > inherited) {
              report(
                "shape-relaxed",
                keyword,
                `${keyword} ${mine} raises the inherited bound; it may only fall`,
              );
            }
          }
          if (
            "default" in child &&
            "default" in theirs &&
            !same(child["default"], theirs["default"])
          ) {
            report(
              "default-conflict",
              "default",
              `default ${JSON.stringify(child["default"])} differs from the inherited one`,
            );
          }
        }
      }
    }
  }
  return issues;
}
