// The kernel's surface: the type-document loader (law/), the page interface,
// the fixed grammar's records, the CEL rules, the shapes and the digests, the
// judge over them (verdict/) and its artifacts, beside the pure helpers the
// shell reads bytes with — the parser, the name forms, the path law, the git
// plumbing parsers, the commit-prefix verdict, search and the byte-level
// writer. The old registry, its standard library and its module API left in
// step 6 of the v2 delivery.
export * from "./artifacts/index.ts";
export type { FieldSources } from "./fields/index.ts";
export { resolveDescription, resolveTitle } from "./fields/index.ts";
export type { BatchCheckRecord, Decode, StagedChange, StagedStatus } from "./gitplan/index.ts";
export {
  BatchStreamTruncated,
  parseCatFileBatch,
  parseCatFileBatchCheck,
  parseNameStatusZ,
} from "./gitplan/index.ts";
export { codeUnitCompare, foldCase, normalizeIdentity } from "./identity/index.ts";
export * from "./law/index.ts";
export { basenameOf } from "./names/basename.ts";
export type { NamedPage } from "./names/index.ts";
export type {
  Fence,
  Frontmatter,
  FrontmatterKey,
  Heading,
  NormalizedInput,
  OpaqueBlock,
  ParsedDoc,
  ParseIssue,
  Wikilink,
} from "./parse/index.ts";
export { normalizeInput, parseDoc } from "./parse/index.ts";
export type { PathRefusal } from "./paths/index.ts";
export { isContentPath, isVaultPath, PATH_REFUSALS, pathRefusal } from "./paths/index.ts";
export type {
  CommitPrefixOpening,
  CommitPrefixPolicy,
  CommitPrefixVerdict,
} from "./prefixes/index.ts";
export { commitPrefixOf, commitPrefixVerdict } from "./prefixes/index.ts";
export type { LexicalHit, LexicalIndex } from "./search/bm25.ts";
export {
  BM25_B,
  BM25_K1,
  buildLexicalIndex,
  buildTextIndex,
  FIELD_BOOST,
  rankKeys,
  rankLexical,
} from "./search/bm25.ts";
export type {
  FileHit,
  FilesCoverage,
  SearchBand,
  SearchCoverage,
  SearchFilters,
  SearchOutcome,
  SearchResult,
} from "./search/index.ts";
export { pageFilter, RRF_K, SEARCH_BANDS, searchFiles, searchPages } from "./search/index.ts";
export type { ItemCandidate } from "./search/items.ts";
export { rankItemCandidates } from "./search/items.ts";
export type { NearCandidate, NearIndex } from "./search/near.ts";
export { buildNearIndex, nameFormsOf, nearCandidates, stripQualifier } from "./search/near.ts";
export { TOKENIZATION_MODE, tokenize } from "./search/tokenize.ts";
export { trigramJaccard, trigrams } from "./text/index.ts";
export * from "./verdict/index.ts";
export type { Comparator, Semver } from "./version/index.ts";
export { parseEngineRange, parseSemver, satisfiesEngineRange } from "./version/index.ts";
export type {
  PageEnvelope,
  WriteOp,
  WritePlan,
  WriteRange,
  WriteResult,
} from "./writer/index.ts";
export {
  appendToFrontmatterList,
  applyWrite,
  pageEnvelope,
  sectionTail,
  yamlScalar,
} from "./writer/index.ts";
