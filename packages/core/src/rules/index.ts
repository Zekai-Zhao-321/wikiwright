// v2 contracts §6: rules in CEL under the engine's profile.
export { lawBoundIssues, overBound } from "./bounds.ts";
export type { CompiledRule, RuleBindings, RuleVerdict } from "./evaluate.ts";
export { compileRule } from "./evaluate.ts";
export type { Admission, RuleLimit } from "./profile.ts";
export {
  AST_NODES_MAX,
  admitRule,
  CEL_PROFILE,
  CHAIN_MAX,
  COST_MAX,
  EXPRESSION_BYTES_MAX,
  NESTING_MAX,
  PARENTHESES_MAX,
  RANGE_BOUNDS,
} from "./profile.ts";
