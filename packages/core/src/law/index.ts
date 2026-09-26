// v2 contracts §2, §3: the type-document loader's surface. Beside the old
// loader (registry/), which still loads every corpus in the repository.

export {
  bytesDigest,
  canonicalJson,
  contentDigest,
  LAW_DEPENDENCIES,
  lawDigest,
  lawLines,
  pageDigest,
} from "../digest/index.ts";
export type {
  Occurrence,
  PageLimit,
  PageRead,
  ParsedPage,
  UnparsedItem,
} from "../interface/index.ts";
export {
  buildBefore,
  buildFacts,
  buildPageInterface,
  celOccurrence,
  lawFacts,
  PAGE_BYTES_MAX,
  PAGE_INTERFACE,
  pageLinks,
  parsePage,
} from "../interface/index.ts";
export type {
  ClaimRecord,
  EntryRecord,
  GrammarRecord,
  Location,
  RelationRecord,
  RelationTarget,
  ResolveTarget,
} from "../records/index.ts";
export {
  claimHandle,
  parseClaimLine,
  parseEntryLine,
  parseRelationLine,
} from "../records/index.ts";
export { RECORD_SCHEMAS, recordValidators } from "../records/schemas.ts";
export * from "../rules/index.ts";
export { ENGINE_KEYWORDS, errorLine, strictAjv } from "../schema/ajv.ts";
export { isDate, isDateTime, isUri, parseUrl } from "../schema/formats.ts";
export { RESERVED_KEYS, reservedShape } from "../schema/reserved.ts";
export type { CompiledShapes, ShapeContext } from "../schema/shapes.ts";
export { compileShapes, ENGINE_DEFS } from "../schema/shapes.ts";
export type {
  Composition,
  LawRule,
  LawSection,
  LawSections,
  LawType,
  LawVocabulary,
  ShapePart,
} from "./compose.ts";
export { CANDIDATE_RULE } from "./compose.ts";
export type {
  FragmentDocument,
  Grammar,
  RequireRow,
  Role,
  SectionParams,
  TypeDocument,
  VocabularyDocument,
} from "./documents.ts";
export { GRAMMAR_PARAMS, GRAMMARS, ROLES } from "./documents.ts";
export type { EngineV4, EngineV4Result, FolderTagModeV4 } from "./engine.ts";
export { ENGINE_PATH, ENGINE_V4_CONSUMERS, ENGINE_V4_SCHEMA, loadEngineV4 } from "./engine.ts";
export type { LawIssue } from "./issues.ts";
export { LAW_ISSUE_CODES } from "./issues.ts";
export type { TypeLaw, TypeLawResult } from "./load.ts";
export { loadTypeLaw } from "./load.ts";
export { isName, NAME_PATTERN, qualify, resolveReference, splitName } from "./names.ts";
export { resolveInRepository, utf8Compare } from "./paths.ts";
export { skeletonOf } from "./skeleton.ts";
export type { LawFile, LawPlace, LawSnapshot, ResolvedLibrary } from "./snapshot.ts";
export {
  BUNDLE_LAW_DIRECTORIES,
  LIBRARY_FILE,
  LIBRARY_LAW_DIRECTORIES,
  libraryDirectories,
  placeLawFiles,
  resolveLibraries,
} from "./snapshot.ts";
export { utf8Text } from "./text.ts";
export { isMapping, jsonNumbers, readYaml } from "./yaml.ts";
