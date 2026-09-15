// docs/extending.md §The manifest: a module declares its parameter shapes with zod,
// so the engine re-exports it. A kit that pinned its own copy would hand the
// loader schemas from a second zod instance, and `instanceof` checks inside a
// schema library are exactly where that goes wrong.
export { z } from "zod";
export type { FieldSources } from "./fields/index.ts";
export { ledeOf, resolveDescription, resolveTitle } from "./fields/index.ts";
export type { Applicability, FindingFix, FixerContext, FixTarget } from "./fixers/index.ts";
export {
  buildFix,
  FIXER_REGISTRY,
  fixerExecutes,
  fixerRegistered,
  REGISTERED_FIXERS,
} from "./fixers/index.ts";
export type { FixInput, FixOps } from "./fixers/ops.ts";
export { fixOpsFor, PURE_FIXERS } from "./fixers/ops.ts";
export type {
  ArtifactFile,
  GenerateOptions,
  Graph,
  GraphEdge,
  PageInput,
} from "./generate/index.ts";
export { generateArtifacts, graphOf, serializeArtifact } from "./generate/index.ts";
export type { BatchCheckRecord, Decode, StagedChange, StagedStatus } from "./gitplan/index.ts";
export { parseCatFileBatch, parseCatFileBatchCheck, parseNameStatusZ } from "./gitplan/index.ts";
export type {
  Dispositions,
  GrammarCheckOptions,
  GrammarFinding,
  GrammarItem,
  GrammarKind,
  ItemBase,
  ParseOptions,
  RationaleLine,
  SectionAST,
  SectionBinding,
  SectionNode,
  UnparsedItem,
  VocabularyUse,
} from "./grammar/index.ts";
export {
  addDispositions,
  armDefault,
  armRows,
  checkGrammar,
  DECLARED_ARM_DEFAULT,
  emptyDispositions,
  parseSections,
  sectionBinding,
} from "./grammar/index.ts";
export { codeUnitCompare, foldCase, normalizeIdentity } from "./identity/index.ts";
export type {
  CoverageRow,
  JudgeOptions,
  Law,
  PageException,
  StateRename,
  UnevaluatedRow,
  VaultState,
  Verdict,
} from "./judge/index.ts";
export {
  DEFAULT_FINDING_LIMIT,
  inheritedLines,
  judge,
  parsedPages,
  routeFindings,
  sortFindings as sortJudgedFindings,
} from "./judge/index.ts";
export type {
  Finding,
  LinkResolver,
  LintContext,
  LintOptions,
  VocabularyObservation,
} from "./lint/index.ts";
export {
  checkOkfCore,
  checkVaultInstances,
  evidenceDigestFor,
  folderSegmentsFor,
  grammarBindings,
  linkVerdict,
  lintPage,
  observeVocabulary,
  parseOptionsOf,
  segmentIdentity,
} from "./lint/index.ts";
export type {
  AdmitsSpec,
  ArmSpec,
  Canonicalize,
  CheckContext,
  CheckSpec,
  CheckSurface,
  DeclaredParams,
  GrammarSpec,
  IdentityOf,
  IsCorrection,
  LifecycleEffect,
  ModuleLoad,
  ModuleManifest,
  ModuleRegistry,
  ParamCombineResult,
  ParamIntroduction,
  ParamLaw,
  ParamSpec,
  RegistryConflict,
  SkillFragment,
  TransitionContext,
  TransitionItem,
  VocabularySpec,
} from "./modules/index.ts";
export {
  admittedKinds,
  allGrammarParams,
  armApplies,
  canonicalizeOf,
  combineParam,
  declaredParams,
  defineArm,
  defineCheck,
  defineGrammar,
  defineModule,
  defineVocabulary,
  ENVELOPE_ARMS,
  edgesOf,
  effectOf,
  grammarParams,
  KERNEL_EDGE_KINDS,
  KERNEL_OWNED_ARMS,
  KERNEL_OWNED_GRAMMARS,
  KERNEL_RESERVED_IDS,
  KERNEL_VOCABULARIES,
  loadModules,
  passRows,
  transitionArms,
  transitionSeam,
} from "./modules/index.ts";
export type { PurityViolation } from "./modules/purity.ts";
export { scanPurity } from "./modules/purity.ts";
export { basenameOf } from "./names/basename.ts";
export type { NamedPage, NameEntry, NameIndex } from "./names/index.ts";
export { buildNameIndex, checkVaultIdentity } from "./names/index.ts";
export type {
  Fence,
  Frontmatter,
  FrontmatterKey,
  Heading,
  NormalizedInput,
  ParsedDoc,
  ParseIssue,
  Wikilink,
} from "./parse/index.ts";
export { normalizeInput, parseDoc } from "./parse/index.ts";
export type { PassRow, QueueLane } from "./passes/index.ts";
export { KERNEL_LANES, PASS_TABLE, routeOf, unroutableRows } from "./passes/index.ts";
export type { PathRefusal } from "./paths/index.ts";
export { isContentPath, isVaultPath, PATH_REFUSALS, pathRefusal } from "./paths/index.ts";
export type {
  CommitPrefixOpening,
  CommitPrefixPolicy,
  CommitPrefixVerdict,
} from "./prefixes/index.ts";
export { commitPrefixOf, commitPrefixVerdict } from "./prefixes/index.ts";
export type {
  Attributed,
  EffectiveBody,
  EffectiveCheck,
  EffectiveFragment,
  EffectiveInstances,
  EffectiveSectionEntry,
  EffectiveSections,
  EffectiveType,
  EffectiveVocabulary,
  EngineConfig,
  EngineConfigLoadResult,
  FlattenedRegistry,
  LoadResult,
  RegistryIssue,
  VocabularyEntry,
  VocabularyResolution,
} from "./registry/index.ts";
export {
  ARCHETYPE_NAMES,
  BASE_OPTIONAL_FIELDS,
  BASE_REQUIRED_FIELDS,
  boundVocabularies,
  ENGINE_CONFIG_CONSUMERS,
  ENGINE_CONFIG_SCHEMA,
  entryProperty,
  loadConstitution,
  loadEngineConfig,
  resolveVocabularyEntry,
  tagByName,
  tagsOf,
  vocabularyNames,
} from "./registry/index.ts";
export type { LexicalHit, LexicalIndex } from "./search/bm25.ts";
export { BM25_B, BM25_K1, buildLexicalIndex, FIELD_BOOST, rankLexical } from "./search/bm25.ts";
export type {
  SearchBand,
  SearchCoverage,
  SearchFilters,
  SearchOutcome,
  SearchResult,
} from "./search/index.ts";
export { RRF_K, searchPages } from "./search/index.ts";
export type { NearCandidate, NearIndex } from "./search/near.ts";
export { buildNearIndex, nameFormsOf, nearCandidates, stripQualifier } from "./search/near.ts";
export { TOKENIZATION_MODE, tokenize } from "./search/tokenize.ts";
export type { PinField, ShapeAuto, ShapeCheckContext } from "./shapes/index.ts";
export {
  COMMIT_ID,
  checkValue,
  pinFieldOf,
  shapeAuto,
  shapeKind,
  shapeRequired,
  shapeRequires,
  shapeTargetType,
  validateShape,
} from "./shapes/index.ts";
// docs/extending.md §What a module registers · docs/architecture.md §The invariants: the standard library's own
// surface. Its item SHAPES and its parsers live with the module that owns them,
// and the package re-exports them because a bundle's tools read a claim the way
// `claims` writes one — but the kernel reaches none of it, which is the whole of
// what makes `stdlib/` a layer rather than a directory.
export type {
  ClaimItem,
  ClaimsParams,
  ClosingClause,
  ProvenanceClause,
  ProvenanceForm,
} from "./stdlib/claims-parse.ts";
export { claimHandle, PROVENANCE_FORMS, parseClaim } from "./stdlib/claims-parse.ts";
export {
  claimClass,
  claimIdentity,
  digitSignature,
  isCorrection,
  polarityChanged,
} from "./stdlib/claims-transition.ts";
export type { EDate, EntryItem } from "./stdlib/entries.ts";
export { parseEntry } from "./stdlib/entries.ts";
export { STANDARD_LIBRARY, standardLibrary } from "./stdlib/index.ts";
export type { RelationItem } from "./stdlib/relations.ts";
// `rangeAdmits` is a relations concept — a label's `range` against a
// type chain — so it lives with the module. The package surface still offers it,
// because `vocabulary show` computes `admits` with the same predicate the
// `relation-range` arm judges with, and two copies would let them disagree.
export { parseRelation, rangeAdmits } from "./stdlib/relations.ts";
// docs/extending.md §An arm: generic text metrics are kernel utilities,
// not claim concepts — `vocabulary show` ranks nearest names with Levenshtein on
// a path that has nothing to do with claims. The claim-semantic composition over
// them (`isCorrection`, the digit and polarity guards) is `stdlib/claims`', and
// reaches a caller through `transitionSeam` rather than through this barrel:
// `write --correct` under a kit's grammar must not silently mean "under claims".
export { boundedLevenshtein, trigramJaccard, trigrams } from "./text/index.ts";
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
