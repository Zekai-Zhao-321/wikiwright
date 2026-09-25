// v2 contracts §2, §3: the type-document loader's surface. Beside the old
// loader (registry/), which still loads every corpus in the repository.
export type { EngineV4, EngineV4Result, FolderTagModeV4 } from "./engine.ts";
export { ENGINE_PATH, ENGINE_V4_CONSUMERS, ENGINE_V4_SCHEMA, loadEngineV4 } from "./engine.ts";
export type { LawIssue } from "./issues.ts";
export type { TypeLaw, TypeLawResult } from "./load.ts";
export { loadTypeLaw } from "./load.ts";
export { isName, NAME_PATTERN, qualify, resolveReference, splitName } from "./names.ts";
export { resolveInRepository, utf8Compare } from "./paths.ts";
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
export { readYaml } from "./yaml.ts";
