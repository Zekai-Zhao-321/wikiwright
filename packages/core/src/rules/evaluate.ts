// v2 contracts §5, §6: evaluating an admitted rule over the page interface.
//
// The environment is @bufbuild/cel's standard one with the `strings`
// extension, its `format` removed, RE2 behind `matches`, and the five
// interface variables declared as maps. A result of `true` passes and `false`
// is a finding; anything else — a non-bool, an error value, a throw — is
// `rule-error` with its kind and the CEL error's text. A transition rule
// under a state with no base (the working tree) is `unevaluated`, reason
// `no-base`: never a pass, never a rule-error. Under a state with a base (the
// overlay, the index) a new page is evaluated, with `before.present` false.
import { CelScalar, celEnv, isCelError, mapType, plan } from "@bufbuild/cel";
import { strings } from "@bufbuild/cel/ext";
import { RE2JS } from "@bufbuild/re2";
import type { Admission } from "./profile.ts";

const MAP = mapType(CelScalar.STRING, CelScalar.DYN);

/** The profile's environment, built once. */
const ENV = celEnv({
  funcs: strings.filter((f) => f.name !== "format"),
  re2: { compile: (pattern: string) => RE2JS.compile(pattern) },
  variables: { page: MAP, section: MAP, config: MAP, facts: MAP, before: MAP },
});

export interface RuleBindings {
  /**
   * §5: whether the state has a base at all — true under the overlay and the
   * index, false under the working tree and a revision. A page new to a state
   * with a base binds `before.present: false` and is evaluated.
   */
  base: boolean;
  page: Record<string, unknown>;
  /** Bound for a section rule only. */
  section?: Record<string, unknown>;
  config: Record<string, unknown>;
  facts: Record<string, unknown>;
  before: Record<string, unknown>;
}

export type RuleVerdict =
  | { verdict: "pass" }
  | { verdict: "fail" }
  | { verdict: "error"; kind: "non-bool" | "error"; message: string }
  | { verdict: "unevaluated"; reason: "no-base" };

export interface CompiledRule {
  transition: boolean;
  cost: number;
  evaluate(bindings: RuleBindings): RuleVerdict;
}

/** A result for a message: an int named as one, anything else as JSON would spell it. */
function describe(value: unknown): string {
  if (typeof value === "bigint") return `${value} (int)`;
  try {
    return (
      JSON.stringify(value, (_key, v: unknown) => (typeof v === "bigint" ? `${v}` : v)) ??
      typeof value
    );
  } catch {
    return typeof value;
  }
}

/** Plan an admitted rule once; evaluate it per page or per occurrence. */
export function compileRule(admission: Extract<Admission, { ok: true }>): CompiledRule {
  const run = plan(ENV, admission.ast);
  return {
    transition: admission.transition,
    cost: admission.cost,
    evaluate(bindings: RuleBindings): RuleVerdict {
      if (admission.transition && !bindings.base) {
        return { verdict: "unevaluated", reason: "no-base" };
      }
      let value: unknown;
      try {
        value = run({
          page: bindings.page,
          section: bindings.section ?? {},
          config: bindings.config,
          facts: bindings.facts,
          before: bindings.before,
        } as never);
      } catch (error) {
        return { verdict: "error", kind: "error", message: (error as Error).message };
      }
      if (value === true) return { verdict: "pass" };
      if (value === false) return { verdict: "fail" };
      if (isCelError(value)) return { verdict: "error", kind: "error", message: value.message };
      return {
        verdict: "error",
        kind: "non-bool",
        message: `the rule evaluated to ${describe(value)}, not a bool`,
      };
    },
  };
}
