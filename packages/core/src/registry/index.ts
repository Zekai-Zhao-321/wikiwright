// docs/constitution.md §config/constitution.json (one document — vocabularies,
// fragments, types) (chains resolve once at load; downstream
// consumes the effective model only) · docs/architecture.md (zod validates shape; the
// monotonic law is domain logic).
//
// The loader: parse the document, resolve its vocabularies, combine its types,
// validate the effective set. Issue collection is total within a stage and
// fail-fast between stages — a document that does not parse has nothing to
// combine, and types judged against vocabularies that did not load would
// report the same defect twice.
import { codeUnitCompare } from "../identity/index.ts";
import type { ModuleRegistry } from "../modules/index.ts";
import { ARCHETYPES, resolveTypes } from "./combine.ts";
import { parseDocument, withModuleContributions } from "./document.ts";
import type { EffectiveFragment, LoadResult, RegistryIssue } from "./model.ts";
import { validateEffective } from "./validate.ts";

export { boundVocabularies } from "./validate.ts";

import { resolveVocabularies } from "./vocabularies.ts";

export { BASE_OPTIONAL_FIELDS, BASE_REQUIRED_FIELDS } from "./combine.ts";
export type { EngineConfig, EngineConfigLoadResult, FolderTagMode } from "./engine.ts";
export { ENGINE_CONFIG_CONSUMERS, ENGINE_CONFIG_SCHEMA, loadEngineConfig } from "./engine.ts";
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
  FlattenedRegistry,
  LoadResult,
  RegistryIssue,
  VocabularyEntry,
  VocabularyResolution,
} from "./model.ts";
export { checkKey, entryProperty, resolveVocabularyEntry, tagByName, tagsOf } from "./model.ts";
export { vocabularyNames } from "./vocabularies.ts";

/** docs/constitution.md §Types: the four engine roots, by name. */
export const ARCHETYPE_NAMES: readonly string[] = [...ARCHETYPES.keys()];

/**
 * Load `config/constitution.json` (docs/constitution.md §config/constitution.json) under the
 * modules the shell composed. A section entry's legal parameters, the arms a
 * declaration turns on and the lifecycle effect the contradiction families
 * read are all the modules' — the loader is handed them rather than knowing a
 * grammar's name.
 */
export function loadConstitution(json: unknown, modules: ModuleRegistry): LoadResult {
  const contributed = withModuleContributions(json, modules);
  if (contributed.issues.length > 0) return { ok: false, issues: contributed.issues };
  const parsed = parseDocument(contributed.json);
  if (!parsed.ok) return parsed;
  const document = parsed.document;

  const vocabularies = resolveVocabularies(document.vocabularies, modules);
  if (vocabularies.issues.length > 0) return { ok: false, issues: vocabularies.issues };

  const issues: RegistryIssueList = [];
  const types = resolveTypes(document, modules, issues);
  validateEffective(types, vocabularies.vocabularies, modules, issues);
  if (issues.length > 0) return { ok: false, issues: collapseIssues(issues) };

  const fragments = new Map<string, EffectiveFragment>();
  for (const [name, fragment] of Object.entries(document.fragments)) {
    const effective: EffectiveFragment = {
      name,
      fields: Object.keys(fragment.fields).sort(),
      sections: (fragment.sections?.list ?? []).map((e) => e.heading),
    };
    if (fragment.description !== undefined) effective.description = fragment.description;
    fragments.set(name, effective);
  }
  return {
    ok: true,
    registry: {
      types,
      archetypes: ARCHETYPE_NAMES,
      vocabularies: vocabularies.vocabularies,
      fragments,
      modules,
    },
  };
}

type RegistryIssueList = RegistryIssue[];

/**
 * One cause, one issue. A fragment pasted by four types raises the same
 * `code`, `where` and `message` four times, once per type that resolves it;
 * the reader has one edit to make and is told the four sites once. Issues are
 * kept in first-raised order; sites are listed in code-unit order.
 */
function collapseIssues(issues: readonly RegistryIssue[]): RegistryIssue[] {
  const byKey = new Map<string, RegistryIssue>();
  for (const issue of issues) {
    const key = `${issue.code}\u0000${issue.where}\u0000${issue.message}`;
    const prior = byKey.get(key);
    if (prior === undefined) {
      const copy: RegistryIssue = { code: issue.code, where: issue.where, message: issue.message };
      if (issue.sites !== undefined && issue.sites.length > 0) copy.sites = [...issue.sites];
      byKey.set(key, copy);
      continue;
    }
    if (issue.sites === undefined) continue;
    prior.sites = [...new Set([...(prior.sites ?? []), ...issue.sites])];
  }
  return [...byKey.values()].map((issue) =>
    issue.sites === undefined ? issue : { ...issue, sites: [...issue.sites].sort(codeUnitCompare) },
  );
}
