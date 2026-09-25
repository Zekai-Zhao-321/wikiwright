// v2 contracts §2, §3: the type-document loader, beside the old one
// (registry/). One function of one snapshot; issue collection is total within
// a stage and stops between stages, as the old loader's was: a law whose
// libraries did not resolve has no documents to read.
import type { ValidateFunction } from "ajv/dist/2020.js";
import { type CompiledRule, compileRule } from "../rules/evaluate.ts";
import { admitRule } from "../rules/profile.ts";
import { compileShapes } from "../schema/shapes.ts";
import { compose, type LawType, type LawVocabulary } from "./compose.ts";
import {
  type FragmentDocument,
  readDocument,
  type TypeDocument,
  type VocabularyDocument,
} from "./documents.ts";
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
  /** Every type, by qualified name. */
  types: Map<string, LawType>;
  fragments: Map<string, FragmentDocument>;
  vocabularies: Map<string, LawVocabulary>;
  /** §3.1: each type's compiled effective shape. */
  validators: Map<string, ValidateFunction>;
  /** §3.1: each type's effective shape as compiled. */
  shapes: Map<string, Record<string, unknown>>;
  /** §6: every rule, admitted under the profile and planned, by id. */
  rules: Map<string, CompiledRule>;
}

const KINDS: Readonly<Record<string, "type" | "fragment" | "vocabulary">> = {
  types: "type",
  fragments: "fragment",
  vocabularies: "vocabulary",
};

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

  // §3: every document on its own, against its key table.
  const typeDocs: TypeDocument[] = [];
  const fragmentDocs: FragmentDocument[] = [];
  const vocabularyDocs: VocabularyDocument[] = [];
  for (const [path, file] of files) {
    const segments = file.path.split("/");
    const directory = file.owner === "bundle" ? segments[1] : segments[0];
    const inDocuments = file.owner === "bundle" ? segments[0] === "constitution" : true;
    const kind = directory === undefined ? undefined : KINDS[directory];
    if (!inDocuments || kind === undefined || !file.path.endsWith(".yaml")) continue;
    const namespace = file.owner === "bundle" ? "" : file.owner;
    const read = readDocument(kind, namespace, `${file.owner}:${file.path}`, path, file.bytes);
    issues.push(...read.issues);
    const document = read.document;
    if (document?.kind === "type") typeDocs.push(document);
    else if (document?.kind === "fragment") fragmentDocs.push(document);
    else if (document?.kind === "vocabulary") vocabularyDocs.push(document);
  }
  if (issues.length > 0) return failed(issues);

  const composed = compose(typeDocs, fragmentDocs, vocabularyDocs);
  if (composed.issues.length > 0) return failed(composed.issues);

  const compiled = compileShapes(composed.types, engine);
  // §6: every rule is admitted under the profile, or refused with its limit.
  const rules = new Map<string, CompiledRule>();
  for (const doc of [...fragmentDocs, ...typeDocs]) {
    for (const rule of doc.rules) {
      const admission = admitRule(rule.expr);
      if (!admission.ok) {
        compiled.issues.push({
          code: "rule-invalid",
          where: doc.where,
          message: `${rule.pointer}/expr: rule "${rule.id}": ${admission.message}`,
          details: { pointer: `${rule.pointer}/expr`, rule: rule.id, limit: admission.limit },
        });
        continue;
      }
      rules.set(rule.id, compileRule(admission));
    }
  }
  if (compiled.issues.length > 0) return failed(compiled.issues);
  return {
    ok: true,
    law: {
      engine,
      libraries: resolved.libraries,
      files,
      types: composed.types,
      fragments: composed.fragments,
      vocabularies: composed.vocabularies,
      validators: compiled.validators,
      shapes: compiled.schemas,
      rules,
    },
  };
}
