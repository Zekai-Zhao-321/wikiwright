// v2 contracts §10: judge(state, law) over the type law, beside the old judge
// (judge/), which every verb still calls. Nothing in the binary reaches this
// yet; the tests import it (contracts §12 step 3), and the verbs are
// rewritten over it in step 4.

export type {
  CoverageCell,
  TypeLawJudgeOptions,
  TypeLawVerdict,
  UnevaluatedReason,
} from "./judge.ts";
export { judgeTypeLaw, sortVerdictFindings } from "./judge.ts";
export type { LawChange } from "./lawdiff.ts";
export {
  changedRules,
  headLawDiff,
  lawChangeFindings,
  lawChangeReason,
  lawDiff,
} from "./lawdiff.ts";
export type { VaultNameEntry, VaultNames } from "./names.ts";
export type { JudgeState, PageRename, StateKind } from "./state.ts";
export { contentRootsOf, pageMap, sameBytes } from "./state.ts";
export type { FindingLocation, VerdictFinding, VerdictRow } from "./table.ts";
export {
  RULE_LANE,
  routeVerdictFinding,
  unroutableVerdictRows,
  VERDICT_TABLE,
  verdictRow,
} from "./table.ts";
