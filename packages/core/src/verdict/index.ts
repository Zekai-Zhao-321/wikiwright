// v2 contracts §10: judge(state, law) over the type law, beside the old judge
// (judge/), which every verb still calls. Nothing in the binary reaches this
// yet; the tests import it (contracts §12 step 3), and the verbs are
// rewritten over it in step 4.
export type { JudgeState, PageRename, StateKind } from "./state.ts";
export { contentRootsOf, pageMap, sameBytes } from "./state.ts";
