// The one in-memory constitution builder the suites load a law through. A
// test states the types, fragments and vocabularies it is about; the envelope
// — `schema`, `schema_version`, a `tags` vocabulary the loader requires — is
// filled in here, once, so no fixture repeats it and no fixture can drift from
// the document shape the loader parses.
import {
  type FlattenedRegistry,
  type LoadResult,
  loadConstitution,
  type ModuleRegistry,
  standardLibrary,
} from "../../src/index.ts";

export type Json = Record<string, unknown>;

export interface Doc {
  types?: Json;
  fragments?: Json;
  /** Whole vocabularies; `tags` defaults to a registered, empty one. */
  vocabularies?: Json;
  /** Shorthand for the `tags` vocabulary's entries, where the test declares no vocabularies of its own. */
  tags?: Json;
}

/** The v3 document, as `config/constitution.json` would carry it. */
export function documentOf(doc: Doc = {}): Json {
  const vocabularies: Json = { ...(doc.vocabularies ?? {}) };
  if (vocabularies["tags"] === undefined) {
    vocabularies["tags"] = { mode: "registered", entries: doc.tags ?? {} };
  }
  const out: Json = {
    schema: "wikiwright/constitution",
    schema_version: 3,
    vocabularies,
    types: doc.types ?? {},
  };
  if (doc.fragments !== undefined) out["fragments"] = doc.fragments;
  return out;
}

/** The load result, for a test that asserts on the refusal itself. */
export function loadOf(doc: Doc, modules: ModuleRegistry = standardLibrary()): LoadResult {
  return loadConstitution(documentOf(doc), modules);
}

/** The loaded law; a document that does not load is a fixture defect, so it throws. */
export function constitutionOf(
  doc: Doc,
  modules: ModuleRegistry = standardLibrary(),
): FlattenedRegistry {
  const loaded = loadOf(doc, modules);
  if (!loaded.ok) {
    throw new Error(`the fixture constitution does not load: ${JSON.stringify(loaded.issues)}`);
  }
  return loaded.registry;
}

/** Every issue as `code@where`; empty when the document loads. */
export function issuesOf(doc: Doc, modules: ModuleRegistry = standardLibrary()): string[] {
  const loaded = loadOf(doc, modules);
  return loaded.ok ? [] : loaded.issues.map((i) => `${i.code}@${i.where}`);
}

/** Every issue code; empty when the document loads. */
export function codesOf(doc: Doc, modules: ModuleRegistry = standardLibrary()): string[] {
  const loaded = loadOf(doc, modules);
  return loaded.ok ? [] : loaded.issues.map((i) => i.code);
}
