// v2 contracts §10: judge(state, law) over the type law, beside the old judge
// (judge/), which every verb still calls. Nothing in the binary reaches this
// yet; the tests import it (contracts §12 step 3), and the verbs are
// rewritten over it in step 4.

export { folderFindings, formerFolderFindings, missingFolderTags } from "./folders.ts";
export type { GateScope } from "./gate.ts";
export { changesLaw, gateScope, inheritedLines as inheritedPageLines } from "./gate.ts";
export type {
  Collected,
  CoverageCell,
  ReadPage,
  StateRead,
  TypeLawJudgeOptions,
  TypeLawVerdict,
  UnevaluatedReason,
} from "./judge.ts";
export {
  collectTypeLaw,
  judgeTypeLaw,
  readPages,
  sortVerdictFindings,
  verdictOfCollected,
  verdictOfFindings,
} from "./judge.ts";
export type { LawChange } from "./lawdiff.ts";
export {
  changedRules,
  headLawDiff,
  lawChangeFindings,
  lawChangeReason,
  lawDiff,
} from "./lawdiff.ts";
export type { VaultNameEntry, VaultNames } from "./names.ts";
export type { Unrouted } from "./page.ts";
export { locationAt, PAGE_LOCATION } from "./page.ts";
export type { JudgeState, PageRename, SkippedPath, StateKind } from "./state.ts";
export { contentRootsOf, pageMap, sameBytes, touchesContentRoot } from "./state.ts";
export type { FindingLocation, VerdictFinding, VerdictRow } from "./table.ts";
export {
  RULE_LANE,
  routeVerdictFinding,
  unroutableVerdictRows,
  VERDICT_TABLE,
  verdictRow,
} from "./table.ts";
