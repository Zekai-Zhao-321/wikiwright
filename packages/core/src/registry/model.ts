// docs/constitution.md §Types,
// docs/constitution.md §Fragments · vocabularies (chains resolve once at load;
// downstream consumes the effective model only).
//
// The effective model: what every reader of a loaded law holds. Every field
// here has a reader outside `registry/` — a field nothing reads is a lie the
// model tells its author, and the closure meta-test holds this file to that.
import type { GrammarKind } from "../grammar/index.ts";
import { normalizeIdentity } from "../identity/index.ts";
import type { ModuleRegistry } from "../modules/index.ts";

export interface RegistryIssue {
  code: string;
  /**
   * One spelling: an anchor — `constitution`, `type:<name>`, `fragment:<name>`,
   * `vocabulary:<name>` — and, where the issue sits below it, a `/`-joined path
   * to the entry the author edits (`type:person/sections/list/0`).
   */
  where: string;
  message: string;
  /**
   * The types whose resolution raised this issue, where that is not the
   * anchor itself — a fragment's bad row is one edit, reported once, and this
   * says which types paste it. Absent when the issue sits where it was raised.
   */
  sites?: string[];
}

export interface Attributed<T> {
  value: T;
  contributedBy: string;
}

export interface EffectiveSectionEntry {
  heading: string;
  min: number;
  max?: number;
  /** docs/constitution.md §Sections: alternative headings, compared by normalizeIdentity. */
  aliases?: string[];
  /** docs/constitution.md §Sections: the grammar this section's items are written in; absent = prose. */
  grammar?: GrammarKind;
  /** docs/constitution.md §Sections: the vocabulary this section's items are checked against. */
  vocabulary?: string;
  /**
   * docs/extending.md §A grammar: every parameter the declared grammar
   * admits, combined under `extends` by the grammar's own laws and carried as
   * one opaque record typed by that grammar's manifest. The kernel checks that
   * a key belongs to the grammar and that its combination law held; it reads
   * none of their meanings.
   */
  params: Record<string, unknown>;
  /** Absorbs `budget.section_max_chars`. */
  max_chars?: number;
  /** The per-parameter ratchet knob; `warning` unless the entry says otherwise. */
  severity?: "warning" | "error";
  /** The type, or `fragment:<name>`, whose declaration this entry is. */
  contributedBy: string;
  /** The declaring entry, as a JSON pointer into the document (docs/concepts.md §Findings and routing). */
  registryPath: string;
}

export interface EffectiveSections {
  ordered: boolean;
  depth: number;
  /** docs/constitution.md §Sections: may an undeclared heading appear at the section depth? */
  additional: boolean;
  list: EffectiveSectionEntry[];
}

/**
 * docs/constitution.md §Types: a page-wide append-only law, for a type whose content is
 * not sectioned. Its one consumer is the `body-append-only` transition arm.
 */
export interface EffectiveBody {
  lifecycle: "append-only";
  /** The arm's severity; `error` unless the type says otherwise. */
  severity: "warning" | "error";
  contributedBy: string;
}

/** docs/constitution.md §Types: a vault-level cardinality with its own severity. */
export interface EffectiveInstances {
  min?: number;
  max?: number;
  severity: "warning" | "error";
  contributedBy: string;
}

export interface EffectiveType {
  name: string;
  status: "active" | "retired";
  description: string;
  /** `true` = the type may not be instantiated (`abstract-type`). */
  abstract?: boolean;
  /** How many pages of this type the vault may hold. */
  instances?: EffectiveInstances;
  /** The fragments this type pastes in — ancestors' first, each attributed to the pasting type. */
  fragments: Attributed<string>[];
  use_when?: string;
  avoid_when?: string;
  chain: string[];
  archetype: string;
  /**
   * docs/constitution.md §Types: field name → its shape, ONE per chain.
   * `required` lives inside the shape.
   */
  fields: Map<string, { shape: unknown; contributedBy: string }>;
  /**
   * docs/extending.md §A check: the registered checks this type answers to,
   * composed over the chain and the fragments it pastes in.
   */
  checks: EffectiveCheck[];
  sections?: EffectiveSections;
  /** docs/constitution.md §Types: the page-wide append-only law, if the chain declares one. */
  body?: EffectiveBody;
  replaced_by?: string[];
  template?: Attributed<string>;
  example?: Attributed<string>;
}

/**
 * docs/extending.md §A check: one attachment of a registered check. `surface` is
 * WHERE the bundle wrote it, and the check declares which surfaces it admits —
 * a stable-id check attached to a section is a configuration error, not a
 * silently inert one.
 */
export interface EffectiveCheck {
  /** The registered check's id — `<module-id>/<name>` for a kit's. */
  use: string;
  surface: "type" | "fragment" | "field" | "section";
  /** The field name or the section heading this attachment sits on. */
  target?: string;
  config: Readonly<Record<string, unknown>>;
  /** docs/constitution.md §Sections: the ratchet knob, for a `declared` row. */
  severity?: "warning" | "error";
  contributedBy: string;
  registryPath: string;
}

/** The composition key: one attachment is the same as another iff all three agree. */
export function checkKey(check: EffectiveCheck): string {
  return `${check.use}|${check.surface}|${check.target ?? ""}|${JSON.stringify(check.config)}`;
}

/**
 * docs/constitution.md §Vocabularies: one entry shape, N
 * instances. The four fields below are the ones EVERY vocabulary shares, because
 * the alias law and the retirement law are judged outside any section and the
 * kernel judges them; everything else an entry carries is its own vocabulary's
 * and lives in `properties`, validated by the schema the registering module
 * declared and read by that module's arms.
 */
export interface VocabularyEntry {
  name: string;
  description?: string;
  aliases: string[];
  status: "active" | "retired";
  replaced_by?: string[];
  /** The registering module's own properties, already validated by its schema. */
  properties: Readonly<Record<string, unknown>>;
}

/** The one read of a module-owned entry property from kernel or verb code. */
export function entryProperty(entry: VocabularyEntry, name: string): unknown {
  return entry.properties[name];
}

export interface EffectiveVocabulary {
  name: string;
  mode: "registered" | "census";
  /** An optional regular expression every entry name and authored value must match. */
  form?: string;
  /** Keyed by the entry name's normalized identity; `VocabularyEntry.name` keeps the spelling. */
  entries: Map<string, VocabularyEntry>;
}

/**
 * docs/constitution.md §Vocabularies: what an authored value resolved to, and how.
 * `alias: true` says the author wrote one of the entry's aliases rather than its
 * canonical name — which is the alias law's whole subject.
 */
export interface VocabularyResolution {
  entry: VocabularyEntry;
  alias: boolean;
}

/**
 * Resolve an authored value against a vocabulary, through the alias space.
 * ONE resolution site: the alias law, the retirement law and every consumer of
 * a vocabulary have to agree on what an authored value means.
 */
export function resolveVocabularyEntry(
  vocabulary: EffectiveVocabulary | undefined,
  authored: string,
): VocabularyResolution | undefined {
  if (vocabulary === undefined) return undefined;
  const identity = normalizeIdentity(authored);
  const direct = vocabulary.entries.get(identity);
  if (direct !== undefined) return { entry: direct, alias: false };
  for (const entry of vocabulary.entries.values()) {
    if (entry.aliases.some((a) => normalizeIdentity(a) === identity)) return { entry, alias: true };
  }
  return undefined;
}

/** docs/constitution.md §config/constitution.json: a fragment as `type show` reports it. */
export interface EffectiveFragment {
  name: string;
  description?: string;
  fields: string[];
  sections: string[];
}

export interface FlattenedRegistry {
  types: Map<string, EffectiveType>;
  archetypes: readonly string[];
  /** Every governed vocabulary; `tags` is always among them. */
  vocabularies: Map<string, EffectiveVocabulary>;
  fragments: Map<string, EffectiveFragment>;
  /**
   * docs/extending.md §What a module registers: the modules this bundle loaded. Carried on the loaded
   * law so every consumer that holds a registry holds the declarations too, and
   * no kernel table has to mirror a manifest.
   */
  modules: ModuleRegistry;
}

/**
 * docs/constitution.md §Vocabularies: the `tags` vocabulary — required at load, so never absent.
 * Folder alignment, the catalog and the frontmatter closure read tags from
 * here, the one place the vocabulary lives.
 */
export function tagsOf(registry: FlattenedRegistry): EffectiveVocabulary {
  const tags = registry.vocabularies.get("tags");
  if (tags === undefined) throw new Error("a loaded law carries a `tags` vocabulary");
  return tags;
}

/**
 * A tag by its EXACT declared name. `unknown-tag` is judged on the spelling the
 * author wrote — the alias law resolves aliases through `resolveVocabularyEntry`,
 * and a canonical name written in another case is unknown, not resolved.
 */
export function tagByName(registry: FlattenedRegistry, name: string): VocabularyEntry | undefined {
  const entry = tagsOf(registry).entries.get(normalizeIdentity(name));
  return entry?.name === name ? entry : undefined;
}

export type LoadResult =
  | { ok: true; registry: FlattenedRegistry }
  | { ok: false; issues: RegistryIssue[] };
