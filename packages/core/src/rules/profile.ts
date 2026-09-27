// v2 contracts §6: the CEL profile, enforced by the engine on the AST
// `parse()` returns — the library exposes no checker, no cost estimator and
// no overload removal, so admission is this walk.
//
// Refused as `rule-invalid` at load, the limit named in `details.limit`:
// - `bytes`: an expression over 4,096 UTF-8 bytes;
// - `parentheses`: parenthesis nesting over 32, by a character scan before
//   the parser runs;
// - `parse`: anything `parse` throws;
// - `nodes`: an AST over 512 nodes;
// - `call`: any call to `timestamp`, `duration`, a `get*` time method or
//   `format` (the clock, the calendar, the locale);
// - `literal`: a message literal (`google.protobuf.Timestamp{…}`);
// - `pattern`: a literal `matches` pattern RE2 does not compile;
// - `nesting`: comprehensions nested more than 2 deep;
// - `chaining`: more than 4 comprehensions side by side at one level;
// - `range-not-bound`: a comprehension whose range is not a direct
//   interface path (a range produced by `map`, `filter`, `split` or any call);
// - `cost-bound`: a worst case over 200,000 iterations — the product of the
//   bounds of nested ranges, summed over comprehensions side by side.
//
// A config list is bounded by its actual length (the navigator's ruling 1 on
// the contracts, 2026-09-26): the rule's config is known at load, after
// `configure`, so a range under `config` counts the members it holds, and a
// config path that names no list counts none. `facts.ancestry[t]` is bounded
// at 32, which the loader holds on every chain (`law-too-large`). The linear
// work of a built-in inside one iteration (`in` over a list, `join`,
// `contains`, `matches`) is not counted; docs/roadmap.md states the worst
// case that leaves.

import { parse } from "@bufbuild/cel";
import type { Expr } from "@bufbuild/cel-spec/cel/expr/syntax_pb.js";
import { RE2JS } from "@bufbuild/re2";

export const CEL_PROFILE = "cel-profile/1";

export const EXPRESSION_BYTES_MAX = 4096;
export const AST_NODES_MAX = 512;
export const PARENTHESES_MAX = 32;
export const NESTING_MAX = 2;
export const CHAIN_MAX = 4;
export const COST_MAX = 200_000;

/** §6: the declared bounds of every range a comprehension may walk. */
export const RANGE_BOUNDS = {
  items: 5_000,
  sections: 200,
  list: 1_000,
  facts: 10_000,
} as const;

/** Ruling 1: an ancestry chain, `facts.ancestry[t]`, holds at most 32 types. */
export const ANCESTRY_MAX = 32;

type RangeKind = keyof typeof RANGE_BOUNDS | "ancestry" | "config";

/** A range a comprehension walks: its kind, its bound, and for a config list the lists it may be. */
interface Range {
  kind: RangeKind;
  bound: number;
  /** For a range under `config`: every list or map the path may name, as the config holds it. */
  values?: unknown[];
}

export type RuleLimit =
  | "bytes"
  | "parentheses"
  | "parse"
  | "nodes"
  | "call"
  | "literal"
  | "pattern"
  | "nesting"
  | "chaining"
  | "range-not-bound"
  | "cost-bound";

export type Admission =
  | {
      ok: true;
      ast: ReturnType<typeof parse>;
      /** §5: an expression that reads `before` is a transition rule. */
      transition: boolean;
      /** The static worst case, in iterations. */
      cost: number;
    }
  | { ok: false; limit: RuleLimit; message: string };

const TIME_METHOD = /^get[A-Z]/u;
const EXCLUDED_CALLS = new Set(["timestamp", "duration", "format"]);

/** The deepest parenthesis nesting outside string literals. */
function parenthesisDepth(expr: string): number {
  let depth = 0;
  let deepest = 0;
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i] ?? "";
    if (ch === '"' || ch === "'") {
      // A string literal: raw when an r or R prefixes it, triple-quoted or not.
      const raw = /[rR]/u.test(expr[i - 1] ?? "") || /[rR]/u.test(expr[i - 2] ?? "");
      const triple = expr.startsWith(ch.repeat(3), i);
      const close = triple ? ch.repeat(3) : ch;
      i += close.length;
      while (i < expr.length && !expr.startsWith(close, i)) {
        if (!raw && expr[i] === "\\") i += 1;
        i += 1;
      }
      i += close.length;
      continue;
    }
    if (ch === "(") deepest = Math.max(deepest, ++depth);
    else if (ch === ")") depth = Math.max(0, depth - 1);
    i += 1;
  }
  return deepest;
}

function utf8Length(text: string): number {
  let n = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    n += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return n;
}

/** A path from an interface root through selections and indexes, or undefined. */
function pathOf(expr: Expr | undefined): { root: string; segments: string[] } | undefined {
  const segments: string[] = [];
  let at = expr;
  while (at !== undefined) {
    const kind = at.exprKind;
    if (kind.case === "identExpr") return { root: kind.value.name, segments: segments.reverse() };
    if (kind.case === "selectExpr" && !kind.value.testOnly) {
      segments.push(`.${kind.value.field}`);
      at = kind.value.operand;
      continue;
    }
    if (
      kind.case === "callExpr" &&
      kind.value.function === "_[_]" &&
      kind.value.args.length === 2
    ) {
      // A constant key names one member; any other index may name any.
      const key = kind.value.args[1]?.exprKind;
      const constant =
        key?.case === "constExpr" &&
        (key.value.constantKind.case === "stringValue" ||
          key.value.constantKind.case === "int64Value")
          ? String(key.value.constantKind.value)
          : undefined;
      segments.push(constant === undefined ? "[]" : `.${constant}`);
      at = kind.value.args[0];
      continue;
    }
    return undefined;
  }
  return undefined;
}

function members(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value !== null && typeof value === "object") return Object.values(value);
  return [];
}

function sizeOf(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (value !== null && typeof value === "object") return Object.keys(value).length;
  return 0;
}

/**
 * Ruling 1: what a path names inside a rule's config, followed through every
 * candidate: a field or a constant key names one member, any other index any
 * member. The bound is the largest list or map a candidate is; a path that
 * names nothing bounds nothing.
 */
function configRange(candidates: readonly unknown[], segments: readonly string[]): Range {
  let at = [...candidates];
  for (const segment of segments) {
    const next: unknown[] = [];
    for (const value of at) {
      if (segment === "[]") next.push(...members(value));
      else if (Array.isArray(value)) {
        const index = Number(segment.slice(1));
        if (Number.isInteger(index) && index >= 0 && index < value.length) next.push(value[index]);
      } else if (
        value !== null &&
        typeof value === "object" &&
        Object.hasOwn(value, segment.slice(1))
      )
        next.push((value as Record<string, unknown>)[segment.slice(1)]);
    }
    at = next;
  }
  return { kind: "config", bound: Math.max(0, ...at.map(sizeOf)), values: at };
}

const bounded = (kind: keyof typeof RANGE_BOUNDS): Range => ({ kind, bound: RANGE_BOUNDS[kind] });

/**
 * §6: which bound a range falls under, given what each iteration variable in
 * scope ranges over; undefined when it is not a direct path.
 */
function rangeOf(
  expr: Expr | undefined,
  scope: ReadonlyMap<string, Range>,
  config: Record<string, unknown>,
): Range | undefined {
  const path = pathOf(expr);
  if (path === undefined) return undefined;
  const segments = path.segments;
  const [first, second, ...rest] = segments;
  const outer = scope.get(path.root);
  if (outer !== undefined) {
    // A list inside an element: a section's items, a list within a config
    // element (as long as the config's lists are), or within a frontmatter
    // or facts list under that list's own bound.
    if (outer.kind === "sections")
      return first === ".items" && second === undefined ? bounded("items") : undefined;
    if (outer.kind === "items" || outer.kind === "ancestry") return undefined;
    if (first === undefined) return undefined;
    if (outer.kind === "config") {
      return configRange(
        (outer.values ?? []).flatMap((v) => members(v)),
        segments,
      );
    }
    return { kind: outer.kind, bound: outer.bound };
  }
  const page = (at: (string | undefined)[]): Range | undefined => {
    const [head, next] = at;
    if (head === ".sections" && next === undefined) return bounded("sections");
    if ((head === ".fields" || head === ".frontmatter") && next !== undefined)
      return bounded("list");
    return undefined;
  };
  switch (path.root) {
    case "section":
      return first === ".items" && second === undefined ? bounded("items") : undefined;
    case "page":
      return page(segments);
    case "config":
      return first === undefined ? undefined : configRange([config], segments);
    case "facts":
      if (first === undefined) return undefined;
      // Ruling 1: one type's ancestry chain holds at most 32 types.
      if (first === ".ancestry" && second !== undefined && rest.length === 0)
        return { kind: "ancestry", bound: ANCESTRY_MAX };
      return bounded("facts");
    case "before":
      if (first === ".sections" && second === undefined) return bounded("sections");
      if (first === ".section")
        return second === ".items" && rest.length === 0 ? bounded("items") : undefined;
      if (first === ".page") return page([second, ...rest]);
      return undefined;
    default:
      return undefined;
  }
}

interface Walk {
  nodes: number;
  refusal?: { limit: RuleLimit; message: string };
  transition: boolean;
}

/**
 * The cost of the comprehensions directly under one level (the whole
 * expression, or one comprehension's body), walking every node once.
 */
function level(
  expr: Expr | undefined,
  scope: ReadonlyMap<string, Range>,
  depth: number,
  walk: Walk,
  config: Record<string, unknown>,
): number {
  let cost = 0;
  let siblings = 0;
  const visit = (node: Expr | undefined): void => {
    if (node === undefined || walk.refusal !== undefined) return;
    walk.nodes += 1;
    const kind = node.exprKind;
    switch (kind.case) {
      case "identExpr":
        if (kind.value.name === "before" && !scope.has("before")) walk.transition = true;
        return;
      case "selectExpr":
        visit(kind.value.operand);
        return;
      case "callExpr": {
        const name = kind.value.function;
        if (EXCLUDED_CALLS.has(name) || TIME_METHOD.test(name)) {
          walk.refusal = {
            limit: "call",
            message: `the profile has no ${name}(): no clock, no calendar, no locale in a rule`,
          };
          return;
        }
        if (name === "matches") {
          const pattern = kind.value.args[kind.value.target === undefined ? 1 : 0];
          const literal = pattern?.exprKind;
          if (literal?.case === "constExpr" && literal.value.constantKind.case === "stringValue") {
            try {
              RE2JS.compile(literal.value.constantKind.value);
            } catch (error) {
              walk.refusal = {
                limit: "pattern",
                message: `RE2 does not compile ${JSON.stringify(literal.value.constantKind.value)}: ${(error as Error).message}`,
              };
              return;
            }
          }
        }
        visit(kind.value.target);
        for (const arg of kind.value.args) visit(arg);
        return;
      }
      case "listExpr":
        for (const element of kind.value.elements) visit(element);
        return;
      case "structExpr":
        if (kind.value.messageName !== "") {
          walk.refusal = {
            limit: "literal",
            message: `a message literal (${kind.value.messageName}) is outside the profile`,
          };
          return;
        }
        for (const entry of kind.value.entries) {
          if (entry.keyKind.case === "mapKey") visit(entry.keyKind.value);
          visit(entry.value);
        }
        return;
      case "comprehensionExpr": {
        const c = kind.value;
        siblings += 1;
        if (depth + 1 > NESTING_MAX) {
          walk.refusal = {
            limit: "nesting",
            message: `comprehensions nest more than ${NESTING_MAX} deep`,
          };
          return;
        }
        if (siblings > CHAIN_MAX) {
          walk.refusal = {
            limit: "chaining",
            message: `more than ${CHAIN_MAX} comprehensions side by side`,
          };
          return;
        }
        visit(c.iterRange);
        const range = rangeOf(c.iterRange, scope, config);
        if (range === undefined) {
          walk.refusal = {
            limit: "range-not-bound",
            message:
              "a comprehension ranges over section.items, page.sections, a list under page.fields or config, or a facts list; a range a call produces has no bound",
          };
          return;
        }
        visit(c.accuInit);
        const inner = new Map(scope);
        inner.set(c.iterVar, range);
        if (c.iterVar2 !== "") inner.set(c.iterVar2, range);
        let body = 0;
        for (const part of [c.loopCondition, c.loopStep, c.result]) {
          if (walk.refusal !== undefined) return;
          body += level(part, inner, depth + 1, walk, config);
        }
        cost += range.bound * Math.max(1, body);
        return;
      }
      default:
        return;
    }
  };
  visit(expr);
  return cost;
}

function costMessage(cost: number): string {
  return `the worst case is ${cost} iterations; at most ${COST_MAX} (items per section ${RANGE_BOUNDS.items}, sections per page ${RANGE_BOUNDS.sections}, a frontmatter list ${RANGE_BOUNDS.list}, a config list as long as it is, an ancestry chain ${ANCESTRY_MAX}, a facts list ${RANGE_BOUNDS.facts})`;
}

/**
 * The static worst case of an admitted rule under one config: the loader
 * asks it again of every type the rule is attached to, with the config
 * `configure` left there (ruling 1). `undefined` never: the walk that
 * admitted the expression refused everything else.
 */
export function ruleCost(ast: ReturnType<typeof parse>, config: Record<string, unknown>): number {
  const walk: Walk = { nodes: 0, transition: false };
  return level(ast.expr, new Map(), 0, walk, config);
}

/** The refusal of a cost over the bound, as admission reports it. */
export function costRefusal(cost: number): { limit: "cost-bound"; message: string } | undefined {
  return cost > COST_MAX ? { limit: "cost-bound", message: costMessage(cost) } : undefined;
}

/**
 * Admit one rule expression under the profile, or name the limit it breaks.
 * `config` is the rule's config as declared: a range under it is bounded by
 * the lists it holds.
 */
export function admitRule(expr: string, config: Record<string, unknown> = {}): Admission {
  const bytes = utf8Length(expr);
  if (bytes > EXPRESSION_BYTES_MAX) {
    return {
      ok: false,
      limit: "bytes",
      message: `the expression is ${bytes} bytes; at most ${EXPRESSION_BYTES_MAX}`,
    };
  }
  const parens = parenthesisDepth(expr);
  if (parens > PARENTHESES_MAX) {
    return {
      ok: false,
      limit: "parentheses",
      message: `parentheses nest ${parens} deep; at most ${PARENTHESES_MAX}`,
    };
  }
  let ast: ReturnType<typeof parse>;
  try {
    ast = parse(expr);
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).split("\n")[0] ?? "";
    return { ok: false, limit: "parse", message: `CEL does not parse it: ${message}` };
  }
  const walk: Walk = { nodes: 0, transition: false };
  const cost = level(ast.expr, new Map(), 0, walk, config);
  if (walk.nodes > AST_NODES_MAX) {
    return {
      ok: false,
      limit: "nodes",
      message: `the AST has ${walk.nodes} nodes; at most ${AST_NODES_MAX}`,
    };
  }
  if (walk.refusal !== undefined) return { ok: false, ...walk.refusal };
  const refused = costRefusal(cost);
  if (refused !== undefined) return { ok: false, ...refused };
  return { ok: true, ast, transition: walk.transition, cost };
}
