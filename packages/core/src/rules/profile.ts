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

type RangeKind = keyof typeof RANGE_BOUNDS;

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
      segments.push(kind.value.field);
      at = kind.value.operand;
      continue;
    }
    if (
      kind.case === "callExpr" &&
      kind.value.function === "_[_]" &&
      kind.value.args.length === 2
    ) {
      segments.push("[]");
      at = kind.value.args[0];
      continue;
    }
    return undefined;
  }
  return undefined;
}

/**
 * §6: which declared bound a range falls under, given what each iteration
 * variable in scope ranges over; undefined when it is not a direct path.
 */
function rangeKind(
  expr: Expr | undefined,
  scope: ReadonlyMap<string, RangeKind>,
): RangeKind | undefined {
  const path = pathOf(expr);
  if (path === undefined) return undefined;
  const [first, second, ...rest] = path.segments;
  const bound = scope.get(path.root);
  if (bound !== undefined) {
    // A list inside an element: a section's items, or a list within a
    // config, frontmatter or facts list, under that list's own bound.
    if (bound === "sections")
      return first === "items" && second === undefined ? "items" : undefined;
    if (bound === "items") return undefined;
    return first === undefined ? undefined : bound;
  }
  const page = (segments: (string | undefined)[]): RangeKind | undefined => {
    const [head, next] = segments;
    if (head === "sections" && next === undefined) return "sections";
    if ((head === "fields" || head === "frontmatter") && next !== undefined) return "list";
    return undefined;
  };
  switch (path.root) {
    case "section":
      return first === "items" && second === undefined ? "items" : undefined;
    case "page":
      return page([first, second, ...rest]);
    case "config":
      return first === undefined ? undefined : "list";
    case "facts":
      return first === undefined ? undefined : "facts";
    case "before":
      if (first === "sections" && second === undefined) return "sections";
      if (first === "section") return second === "items" && rest.length === 0 ? "items" : undefined;
      if (first === "page") return page([second, ...rest]);
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
  scope: ReadonlyMap<string, RangeKind>,
  depth: number,
  walk: Walk,
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
        const range = rangeKind(c.iterRange, scope);
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
          body += level(part, inner, depth + 1, walk);
        }
        cost += RANGE_BOUNDS[range] * Math.max(1, body);
        return;
      }
      default:
        return;
    }
  };
  visit(expr);
  return cost;
}

/** Admit one rule expression under the profile, or name the limit it breaks. */
export function admitRule(expr: string): Admission {
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
  const cost = level(ast.expr, new Map(), 0, walk);
  if (walk.nodes > AST_NODES_MAX) {
    return {
      ok: false,
      limit: "nodes",
      message: `the AST has ${walk.nodes} nodes; at most ${AST_NODES_MAX}`,
    };
  }
  if (walk.refusal !== undefined) return { ok: false, ...walk.refusal };
  if (cost > COST_MAX) {
    return {
      ok: false,
      limit: "cost-bound",
      message: `the worst case is ${cost} iterations; at most ${COST_MAX} (items per section ${RANGE_BOUNDS.items}, sections per page ${RANGE_BOUNDS.sections}, a frontmatter or config list ${RANGE_BOUNDS.list}, a facts list ${RANGE_BOUNDS.facts})`,
    };
  }
  return { ok: true, ast, transition: walk.transition, cost };
}
