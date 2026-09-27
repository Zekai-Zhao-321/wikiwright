// v2 contracts §10: the type-law judge and its findings, routes and coverage.
// The working tree, drafts, index and revision adapters all reach it.

export { folderFindings, formerFolderFindings, missingFolderTags } from "./folders.ts";
export type { GateScope } from "./gate.ts";
export { changesLaw, findingKey, gateScope, inheritedLines as inheritedPageLines } from "./gate.ts";
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
export { titleOf as titleOfPage } from "./names.ts";
export type { Unrouted } from "./page.ts";
export { locationAt, PAGE_LOCATION } from "./page.ts";
export type { SourcePathStatus } from "./sourcepaths.ts";
export { sourcePathFindings, sourcePathStatus } from "./sourcepaths.ts";
export type { JudgeState, PageRename, SkippedPath, SourceFacts, StateKind } from "./state.ts";
export { contentRootsOf, pageMap, sameBytes, sourceRootsOf, touchesContentRoot } from "./state.ts";
export type { FindingLocation, VerdictFinding, VerdictRow } from "./table.ts";
export {
  RULE_LANE,
  routeVerdictFinding,
  unroutableVerdictRows,
  VERDICT_TABLE,
  verdictRow,
} from "./table.ts";
