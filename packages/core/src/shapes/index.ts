// One bounded shape vocabulary for frontmatter field schemas.
// Deliberately closed: unknown kinds,
// unknown keys, and malformed nests are load errors, and the slide toward a
// general schema language is refused, as a rule language was.
//
// docs/constitution.md §config/constitution.json: in constitution v3 a field IS a
// shape, so the shape carries what the four parallel field lists carried —
// `required`, and `requires` (absorbing `conditional-required`) — plus two kinds
// and two per-kind keys that absorb `verify-evidence` and give the writer its
// engine-stamped dates.

export interface ShapeCheckContext {
  names?: {
    resolve(name: string): { path: string; viaAlias: boolean } | undefined;
    /** The referent's `extends` chain, for `target_type`; absent ⇒ the arm is inapplicable. */
    typeChainOf?(name: string): readonly string[] | undefined;
  };
}

/**
 * Keys every kind admits. `required` is the shape's own disposition;
 * `requires` names the fields whose presence makes this one required. Both are
 * read by the registry and by lint, never by `checkValue` alone.
 */
// docs/extending.md §A check: `checks` is universal — a registered check may be
// attached to a field of any kind, because what it validates is the field's
// VALUE and the kind is what the shape already says about it.
const UNIVERSAL_KEYS: readonly string[] = ["required", "requires", "checks"];

const KIND_KEYS: Record<string, ReadonlySet<string>> = {
  // The identity shape. v3 requires every declared field to BE a shape,
  // and a v2 field declared without one must not acquire a constraint it never
  // had at the format bump — `any` is what "declared, unshaped" is called.
  any: new Set(["kind"]),
  string: new Set(["kind", "min_length", "max_length", "pattern"]),
  "dated-string": new Set(["kind"]),
  integer: new Set(["kind", "min", "max"]),
  number: new Set(["kind", "min", "max"]),
  boolean: new Set(["kind"]),
  enum: new Set(["kind", "values"]),
  date: new Set(["kind", "auto"]),
  datetime: new Set(["kind"]),
  list: new Set(["kind", "item", "min_items", "max_items"]),
  object: new Set(["kind", "keys", "required"]),
  "page-ref": new Set(["kind", "target_root", "target_type"]),
  "page-ref-list": new Set(["kind", "target_root", "target_type"]),
  // docs/constitution.md §Shapes: a field that pins a git revision of an origin named by a
  // sibling field. The kernel learns exactly that — not what a source page, a
  // capture class or a license is; those stay bundle data.
  pin: new Set(["kind", "origin", "covers"]),
};

/**
 * docs/constitution.md §Shapes: the value law of a `pin` — a full SHA-1 or SHA-256 commit id,
 * lowercase. Full, because an abbreviated pin cannot be compared with a
 * remote head without a fetch. Snapshot-internal: the well-formedness is
 * judged here; whether the origin knows the commit is `freshness`'s question.
 */
export const COMMIT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

/** A type's `pin` field, with the sibling fields the shape names. */
export interface PinField {
  field: string;
  /** The sibling field carrying the origin: a git URL, or "." for the enclosing repository. */
  origin: string;
  /** The sibling list of origin-relative paths the capture covers; absent = the whole repository. */
  covers?: string;
}

/**
 * docs/constitution.md §Shapes: the one pin a type declares, read off its effective fields —
 * the ONE definition site the judge and `freshness` both read, as `rangeAdmits`
 * is for relations. The registry refuses a second pin on one chain.
 */
export function pinFieldOf(fields: ReadonlyMap<string, { shape: unknown }>): PinField | undefined {
  for (const [field, declared] of fields) {
    const record = asRecord(declared.shape);
    if (record?.["kind"] !== "pin" || typeof record["origin"] !== "string") continue;
    const covers = record["covers"];
    return typeof covers === "string"
      ? { field, origin: record["origin"], covers }
      : { field, origin: record["origin"] };
  }
  return undefined;
}

/** The field is engine-stamped; an author never writes it, and `required` waits. */
export type ShapeAuto = "on-create" | "on-write";

const AUTO_VALUES: readonly string[] = ["on-create", "on-write"];

const asRecord = (shape: unknown): Record<string, unknown> | undefined =>
  typeof shape === "object" && shape !== null && !Array.isArray(shape)
    ? (shape as Record<string, unknown>)
    : undefined;

/**
 * The declared kind of a meta-valid shape — the one string a caller
 * types a value by. The pin registry, the pin lint arm, `type show` and
 * `new --set` all read it here; there is exactly one definition site.
 */
export function shapeKind(shape: unknown): string | undefined {
  const kind = asRecord(shape)?.["kind"];
  return typeof kind === "string" ? kind : undefined;
}

/** Does the shape declare its field required? `object`'s `required` is a key list. */
export function shapeRequired(shape: unknown): boolean {
  return asRecord(shape)?.["required"] === true;
}

/** The fields whose presence makes this one required (absorbs conditional-required). */
export function shapeRequires(shape: unknown): readonly string[] {
  const record = asRecord(shape);
  const requires = record?.["requires"];
  return Array.isArray(requires) ? requires.filter((r): r is string => typeof r === "string") : [];
}

/** The engine stamp on a date field, if any. */
export function shapeAuto(shape: unknown): ShapeAuto | undefined {
  const auto = asRecord(shape)?.["auto"];
  return auto === "on-create" || auto === "on-write" ? auto : undefined;
}

/** The declared referent type of a page-ref kind, if any. */
export function shapeTargetType(shape: unknown): string | undefined {
  const target = asRecord(shape)?.["target_type"];
  return typeof target === "string" ? target : undefined;
}

/** Is this a legal shape? Returns human-readable problems; [] = legal. */
export function validateShape(shape: unknown, at = "shape"): string[] {
  if (typeof shape !== "object" || shape === null || Array.isArray(shape)) {
    return [`${at}: a shape is an object with a "kind"`];
  }
  const record = shape as Record<string, unknown>;
  const kind = record["kind"];
  if (typeof kind !== "string" || !(kind in KIND_KEYS)) {
    return [
      `${at}: unknown kind ${JSON.stringify(kind)} (valid: ${Object.keys(KIND_KEYS).join(", ")})`,
    ];
  }
  const problems: string[] = [];
  const allowed = KIND_KEYS[kind];
  for (const key of Object.keys(record)) {
    if (UNIVERSAL_KEYS.includes(key)) continue;
    if (allowed !== undefined && !allowed.has(key)) {
      problems.push(`${at}: key "${key}" is not part of kind "${kind}"`);
    }
  }
  // The two universal keys are typed here, once, for every kind. On the
  // `object` kind `required` keeps its meaning as a key list too, so both
  // forms are legal there and only there.
  const requiredKey = record["required"];
  if (
    requiredKey !== undefined &&
    requiredKey !== true &&
    !(kind === "object" && Array.isArray(requiredKey))
  ) {
    problems.push(`${at}: required is the literal true, or absent`);
  }
  const requires = record["requires"];
  if (requires !== undefined) {
    if (
      !Array.isArray(requires) ||
      requires.length === 0 ||
      requires.some((r) => typeof r !== "string" || r.length === 0)
    ) {
      problems.push(`${at}: requires is a non-empty list of field names`);
    }
  }
  const numeric = (key: string): void => {
    const v = record[key];
    if (v !== undefined && typeof v !== "number") problems.push(`${at}: ${key} must be a number`);
  };
  switch (kind) {
    case "string": {
      numeric("min_length");
      numeric("max_length");
      const pattern = record["pattern"];
      if (pattern !== undefined) {
        if (typeof pattern !== "string") {
          problems.push(`${at}: pattern must be a string`);
        } else {
          try {
            new RegExp(pattern, "u");
          } catch {
            problems.push(`${at}: pattern is not a valid regular expression`);
          }
        }
      }
      break;
    }
    case "integer":
    case "number":
      numeric("min");
      numeric("max");
      break;
    case "enum": {
      const values = record["values"];
      if (
        !Array.isArray(values) ||
        values.length === 0 ||
        values.some((v) => typeof v !== "string")
      ) {
        problems.push(`${at}: enum needs a non-empty list of string values`);
      }
      break;
    }
    case "list": {
      numeric("min_items");
      numeric("max_items");
      if (record["item"] === undefined) {
        problems.push(`${at}: list needs an "item" shape`);
      } else {
        problems.push(...validateShape(record["item"], `${at}.item`));
      }
      break;
    }
    case "object": {
      const keys = record["keys"];
      if (typeof keys !== "object" || keys === null || Array.isArray(keys)) {
        problems.push(`${at}: object needs a "keys" map of shapes`);
        break;
      }
      for (const [k, v] of Object.entries(keys)) {
        problems.push(...validateShape(v, `${at}.keys.${k}`));
      }
      const required = record["required"];
      if (required !== undefined && required !== true) {
        if (!Array.isArray(required) || required.some((r) => typeof r !== "string")) {
          problems.push(`${at}: required must be a list of key names`);
        } else {
          for (const r of required as string[]) {
            if (!(r in (keys as Record<string, unknown>))) {
              problems.push(`${at}: required key "${r}" is not declared in keys`);
            }
          }
        }
      }
      break;
    }
    case "date": {
      const auto = record["auto"];
      if (auto !== undefined && (typeof auto !== "string" || !AUTO_VALUES.includes(auto))) {
        problems.push(`${at}: auto is "on-create" or "on-write"`);
      }
      break;
    }
    case "pin": {
      const origin = record["origin"];
      if (typeof origin !== "string" || origin.length === 0) {
        problems.push(`${at}: pin needs an "origin": the sibling field naming the git origin`);
      }
      const covers = record["covers"];
      if (covers !== undefined && (typeof covers !== "string" || covers.length === 0)) {
        problems.push(
          `${at}: covers names a sibling field, the list of origin paths the capture covers`,
        );
      }
      break;
    }
    case "page-ref":
    case "page-ref-list": {
      const root = record["target_root"];
      if (root !== undefined && (typeof root !== "string" || root.length === 0)) {
        problems.push(`${at}: target_root must be a non-empty string`);
      }
      const targetType = record["target_type"];
      if (targetType !== undefined && (typeof targetType !== "string" || targetType.length === 0)) {
        problems.push(`${at}: target_type must be a non-empty string`);
      }
      break;
    }
    default:
      break;
  }
  return problems;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/u;
/** `dated-string` wants a date INSIDE the text, not the whole of it. */
const LOOSE_DATE_RE = /\b\d{4}-\d{2}-\d{2}\b/u;

const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/u;

function realDate(text: string): boolean {
  const [y, m, d] = text.slice(0, 10).split("-").map(Number);
  if (y === undefined || m === undefined || d === undefined) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function checkPageRef(
  value: unknown,
  record: Record<string, unknown>,
  at: string,
  context: ShapeCheckContext | undefined,
): string[] {
  if (typeof value !== "string" || value.length === 0) {
    return [`${at}: a page reference is a non-empty canonical name`];
  }
  const resolver = context?.names;
  if (resolver === undefined) return [];
  const resolved = resolver.resolve(value);
  if (resolved === undefined) {
    // A path is refused, not accepted. `move` changes paths and keeps
    // names, so a path-form reference breaks on the next move while the
    // name-form survives — the reason wikilinks are by canonical name too.
    if (value.includes("/") || value.endsWith(".md")) {
      const name = (value.split("/").pop() ?? value).replace(/\.md$/u, "");
      return [
        `${at}: "${value}" is a path — a page reference is the canonical name (the basename without .md, here "${name}"), never a path`,
      ];
    }
    return [`${at}: "${value}" resolves to no page — a page reference is the canonical name`];
  }
  const root = record["target_root"];
  if (typeof root === "string" && !resolved.path.startsWith(`${root}/`)) {
    return [`${at}: "${value}" resolves to ${resolved.path}, outside root "${root}"`];
  }
  // The referent's type, matched THROUGH its extends chain, so a
  // `target_type: entity` accepts every descendant. Without a chain resolver the
  // arm is inapplicable — never a silent pass reported as a check.
  const targetType = record["target_type"];
  if (typeof targetType === "string" && resolver.typeChainOf !== undefined) {
    const chain = resolver.typeChainOf(value);
    if (chain !== undefined && !chain.includes(targetType)) {
      return [`${at}: "${value}" is a ${chain[0] ?? "?"}, not a ${targetType}`];
    }
  }
  return [];
}

/**
 * Does the value satisfy the shape? The shape is assumed meta-valid
 * (validateShape ran at load); problems are human-readable and carry paths.
 */
export function checkValue(
  value: unknown,
  shape: unknown,
  context?: ShapeCheckContext,
  at = "value",
): string[] {
  const record = shape as Record<string, unknown>;
  const kind = record["kind"] as string;
  switch (kind) {
    case "any":
      return [];
    case "string": {
      if (typeof value !== "string") return [`${at}: expected a string`];
      const min = record["min_length"];
      const max = record["max_length"];
      const pattern = record["pattern"];
      const problems: string[] = [];
      if (typeof min === "number" && value.length < min)
        problems.push(`${at}: shorter than min_length ${min}`);
      if (typeof max === "number" && value.length > max)
        problems.push(`${at}: longer than max_length ${max}`);
      // An inherited shape a child tightened carries every pattern on
      // the chain, and a value matches all of them.
      const patterns = Array.isArray(pattern) ? pattern : [pattern];
      for (const p of patterns) {
        if (typeof p === "string" && !new RegExp(p, "u").test(value))
          problems.push(`${at}: does not match pattern ${p}`);
      }
      return problems;
    }
    case "integer":
    case "number": {
      if (typeof value !== "number" || Number.isNaN(value)) return [`${at}: expected a number`];
      const problems: string[] = [];
      if (kind === "integer" && !Number.isInteger(value))
        problems.push(`${at}: expected an integer`);
      const min = record["min"];
      const max = record["max"];
      if (typeof min === "number" && value < min) problems.push(`${at}: below min ${min}`);
      if (typeof max === "number" && value > max) problems.push(`${at}: above max ${max}`);
      return problems;
    }
    case "boolean":
      return typeof value === "boolean" ? [] : [`${at}: expected a boolean`];
    case "enum": {
      const values = record["values"] as string[];
      return typeof value === "string" && values.includes(value)
        ? []
        : [`${at}: expected one of ${values.join(", ")}`];
    }
    case "date":
      return typeof value === "string" && DATE_RE.test(value) && realDate(value)
        ? []
        : [`${at}: expected a real YYYY-MM-DD date`];
    case "dated-string":
      return typeof value === "string" && LOOSE_DATE_RE.test(value)
        ? []
        : [`${at}: expected a string carrying an ISO date`];
    case "datetime":
      return typeof value === "string" && DATETIME_RE.test(value) && realDate(value)
        ? []
        : [`${at}: expected an ISO 8601 datetime`];
    case "list":
    case "page-ref-list": {
      if (!Array.isArray(value)) return [`${at}: expected a list`];
      const problems: string[] = [];
      const min = record["min_items"];
      const max = record["max_items"];
      if (typeof min === "number" && value.length < min)
        problems.push(`${at}: fewer than min_items ${min}`);
      if (typeof max === "number" && value.length > max)
        problems.push(`${at}: more than max_items ${max}`);
      value.forEach((item, i) => {
        if (kind === "page-ref-list") {
          problems.push(...checkPageRef(item, record, `${at}[${i}]`, context));
        } else {
          problems.push(...checkValue(item, record["item"], context, `${at}[${i}]`));
        }
      });
      return problems;
    }
    case "object": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return [`${at}: expected an object`];
      }
      const problems: string[] = [];
      const keys = record["keys"] as Record<string, unknown>;
      const declared = record["required"];
      const required = Array.isArray(declared) ? (declared as string[]) : [];
      for (const r of required) {
        if (!(r in (value as Record<string, unknown>)))
          problems.push(`${at}: missing required key "${r}"`);
      }
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        const keyShape = keys[k];
        if (keyShape === undefined) {
          problems.push(`${at}: unknown key "${k}" (keys are closed)`);
          continue;
        }
        problems.push(...checkValue(v, keyShape, context, `${at}.${k}`));
      }
      return problems;
    }
    case "page-ref":
      return checkPageRef(value, record, at, context);
    case "pin":
      return typeof value === "string" && COMMIT_ID.test(value)
        ? []
        : [`${at}: expected the full commit id of the origin (40 or 64 lowercase hex digits)`];
    default:
      return [`${at}: unknown kind "${kind}"`];
  }
}
