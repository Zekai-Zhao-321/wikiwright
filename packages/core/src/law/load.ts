// v2 contracts §2, §3: the type-document loader, beside the old one
// (registry/). One function of one snapshot; issue collection is total within
// a stage and stops between stages, as the old loader's was: a law whose
// libraries did not resolve has no documents to read.
import { ENGINE_PATH, type EngineV4, loadEngineV4 } from "./engine.ts";
import { collapseLawIssues, type LawIssue, sortLawIssues } from "./issues.ts";
import { joinUnder } from "./paths.ts";
import {
  type LawPlace,
  type LawSnapshot,
  placeLawFiles,
  type ResolvedLibrary,
  resolveLibraries,
} from "./snapshot.ts";

/** The law a snapshot declares, as far as it loaded. */
export interface TypeLaw {
  engine: EngineV4;
  libraries: ResolvedLibrary[];
  /** Every file the loader read, by repository-relative path, placed. */
  files: Map<string, LawPlace & { bytes: Uint8Array }>;
}

export type TypeLawResult = { ok: true; law: TypeLaw } | { ok: false; issues: LawIssue[] };

function failed(issues: readonly LawIssue[]): TypeLawResult {
  return { ok: false, issues: sortLawIssues(collapseLawIssues(issues)) };
}

export function loadTypeLaw(snapshot: LawSnapshot): TypeLawResult {
  const engineFile = snapshot.files.get(joinUnder(snapshot.bundle, ENGINE_PATH));
  const loaded = loadEngineV4(engineFile?.link === true ? undefined : engineFile?.bytes);
  if (!loaded.ok) return failed(loaded.issues);
  const engine = loaded.engine;

  const resolved = resolveLibraries(engine, snapshot);
  const placed = placeLawFiles(snapshot, resolved.libraries);
  const issues = [...resolved.issues, ...placed.issues];
  if (issues.length > 0) return failed(issues);

  const files = new Map<string, LawPlace & { bytes: Uint8Array }>();
  for (const [path, place] of placed.placed) {
    const file = snapshot.files.get(path);
    if (file !== undefined) files.set(path, { ...place, bytes: file.bytes });
  }
  return { ok: true, law: { engine, libraries: resolved.libraries, files } };
}
