// What a vocabulary admits, who binds it, and what the vault actually writes
// (docs/cli.md §vocabulary, docs/constitution.md §Vocabularies). The verb reads
// each module's DECLARATION of its vocabulary — the entry properties that name
// a type or a tag — and never a property's name: a kit's vocabulary renders
// exactly as the standard library's do.

import {
  boundedLevenshtein,
  boundVocabularies,
  buildNameIndex,
  codeUnitCompare,
  DECLARED_ARM_DEFAULT,
  type EffectiveType,
  type EffectiveVocabulary,
  type FlattenedRegistry,
  type ModuleRegistry,
  normalizeIdentity,
  observeVocabulary,
  resolveVocabularyEntry,
  type VocabularyEntry,
  vocabularyNames,
} from "@wikiwright/core";
import { fail, ok } from "../envelope.ts";
import { lintOptionsFor, rootsOf } from "../law.ts";
import { activeTypeNames, collectPages } from "../pages.ts";
import type { CommandSpec } from "../spec.ts";
import { loadVault, walkPages } from "../vaultio.ts";

/**
 * The mirror of `type show`, pointed the other way. `type show` answers "how
 * do I write a page of this type"; this answers "what does this vocabulary
 * admit, who binds it, and what does the vault actually write".
 */
type VocabularyBinding = {
  type: string;
  section: string;
  severity: "warning" | "error";
  /** The rows as declared: an obligation over a label SET. */
  require?: { labels: string[]; min: number; max?: number }[];
};

/**
 * Which sections bind a vocabulary — the one named by the section's
 * `vocabulary`, and every fixed one a declared parameter's values resolve in
 * (`sources`) — read off the manifests through `boundVocabularies`
 * rather than off a parameter name this verb knows.
 */
function boundBy(
  registry: FlattenedRegistry,
  modules: ModuleRegistry,
  name: string,
): VocabularyBinding[] {
  const rows: VocabularyBinding[] = [];
  for (const effective of registry.types.values()) {
    for (const entry of effective.sections?.list ?? []) {
      if (!boundVocabularies(entry, modules).includes(name)) continue;
      const row: VocabularyBinding = {
        type: effective.name,
        section: entry.heading,
        // docs/concepts.md §Findings and routing: what the arms of this section
        // actually emit — the authored knob, else the default the emit site
        // applies. A verb that printed only the authored value would report
        // `undefined` for every section that never touched the ratchet.
        severity: entry.severity ?? DECLARED_ARM_DEFAULT,
      };
      const require = entry.params["require"];
      if (Array.isArray(require)) {
        row.require = (require as { labels: string[]; min: number; max?: number }[]).map((r) => ({
          labels: [...r.labels],
          min: r.min,
          ...(r.max === undefined ? {} : { max: r.max }),
        }));
      }
      rows.push(row);
    }
  }
  return rows.sort(
    (a, b) => codeUnitCompare(a.type, b.type) || codeUnitCompare(a.section, b.section),
  );
}

/**
 * Every section whose `require` names this label — the label's inbound duty.
 * `with` is the rest of the row's label set, so the reader sees the disjunction:
 * an `implements` required `with: ["diverges-from"]` is satisfied by either.
 */
function requiredBy(
  rows: readonly VocabularyBinding[],
  label: string,
): { type: string; section: string; min: number; max?: number; with: string[] }[] {
  const identity = normalizeIdentity(label);
  const out: { type: string; section: string; min: number; max?: number; with: string[] }[] = [];
  for (const row of rows) {
    for (const required of row.require ?? []) {
      if (!required.labels.some((l) => normalizeIdentity(l) === identity)) continue;
      out.push({
        type: row.type,
        section: row.section,
        min: required.min,
        ...(required.max === undefined ? {} : { max: required.max }),
        with: required.labels.filter((l) => normalizeIdentity(l) !== identity),
      });
    }
  }
  return out;
}

/** The names a dotted path holds in an entry's own properties: one name, or a list of them. */
function namesAt(properties: Readonly<Record<string, unknown>>, path: string): string[] {
  let node: unknown = properties;
  for (const key of path.split(".")) {
    if (node === null || typeof node !== "object" || Array.isArray(node)) return [];
    node = (node as Record<string, unknown>)[key];
  }
  if (typeof node === "string") return [node];
  return Array.isArray(node) ? node.filter((v): v is string => typeof v === "string") : [];
}

/**
 * The concrete types — active, not abstract, so a page can carry them — whose
 * `extends` chain reaches one of `names`. What a type-valued property of an
 * entry resolves to in THIS vault, read the way every arm reads a chain.
 */
function concreteTypesUnder(registry: FlattenedRegistry, names: readonly string[]): string[] {
  return [...registry.types.values()]
    .filter(
      (t) => t.abstract !== true && t.status === "active" && t.chain.some((c) => names.includes(c)),
    )
    .map((t) => t.name)
    .sort(codeUnitCompare);
}

/**
 * Every type-valued property of an entry, by the dotted paths the registering
 * module DECLARED (`typeRefs`), with the concrete types each resolves to; every
 * tag-valued one (`tagRefs`) with its names. The verb reads the declaration
 * and never a property's name, so a kit's own type-valued property is rendered
 * exactly as the standard library's `range` is.
 */
function referencesOf(
  registry: FlattenedRegistry,
  modules: ModuleRegistry,
  vocabulary: string,
  entry: VocabularyEntry,
): Record<string, { types: string[]; concrete: string[] } | { tags: string[] }> {
  const spec = modules.vocabularies.get(vocabulary);
  const out: Record<string, { types: string[]; concrete: string[] } | { tags: string[] }> = {};
  for (const path of spec?.typeRefs ?? []) {
    const types = namesAt(entry.properties, path);
    if (types.length > 0) out[path] = { types, concrete: concreteTypesUnder(registry, types) };
  }
  for (const path of spec?.tagRefs ?? []) {
    const tags = namesAt(entry.properties, path);
    if (tags.length > 0) out[path] = { tags };
  }
  return out;
}

/** Whether any declared type-valued property of the entry names the type or one of its ancestors. */
function refersTo(
  modules: ModuleRegistry,
  vocabulary: string,
  entry: VocabularyEntry,
  effective: EffectiveType,
): string[] {
  const spec = modules.vocabularies.get(vocabulary);
  return (spec?.typeRefs ?? []).filter((path) =>
    namesAt(entry.properties, path).some((name) => effective.chain.includes(name)),
  );
}

/** The registered vocabularies whose entries may name a type — the ones `--target` can ask. */
function typeReferencing(modules: ModuleRegistry): string[] {
  return vocabularyNames(modules).filter(
    (name) => (modules.vocabularies.get(name)?.typeRefs ?? []).length > 0,
  );
}

/**
 * The vocabulary this bundle loaded, or — where the constitution
 * declares none by that name — an empty one with a `note` saying so. A block is
 * never omitted: an empty `declared` with a note is an answer; a missing key is
 * a question about the verb.
 */
function vocabularyView(
  registry: FlattenedRegistry,
  name: string,
): { vocabulary: EffectiveVocabulary; notes: string[] } {
  const declared = registry.vocabularies.get(name);
  if (declared !== undefined) return { vocabulary: declared, notes: [] };
  return {
    vocabulary: { name, mode: "census", entries: new Map() },
    notes: [
      `this constitution declares no \`${name}\` vocabulary, so nothing is registered and no entry can be unknown — the observed block is the whole of what is known`,
    ],
  };
}

/** The registered names nearest an unknown one — a not_found that helps. */
function nearestEntries(vocabulary: EffectiveVocabulary, wanted: string): string[] {
  const names = [...vocabulary.entries.values()].map((e) => e.name);
  return names
    .map((name) => ({
      name,
      distance: boundedLevenshtein(normalizeIdentity(wanted), normalizeIdentity(name), 3),
    }))
    .filter((c) => c.distance <= 3)
    .sort((a, b) => a.distance - b.distance || codeUnitCompare(a.name, b.name))
    .slice(0, 5)
    .map((c) => c.name);
}

export const vocabularyCommand: CommandSpec = {
  name: "vocabulary",
  role: "consumer",
  summary:
    "Show one vocabulary: its entries and what they admit, the sections that bind it, and the vault's own census.",
  positionals: [
    { name: "subcommand", required: true },
    { name: "name", required: false },
  ],
  subcommands: ["show"],
  flags: [
    { name: "label", type: "string", summary: "narrow the entries block to one entry" },
    {
      name: "target",
      type: "string",
      summary:
        "the inbound view: every entry whose declared type-valued property names this type or an ancestor of it (a vocabulary whose module declares no such property has no inbound view)",
    },
  ],
  examples: [
    "wikiwright vocabulary show relations",
    "wikiwright vocabulary show relations --label part_of",
    "wikiwright vocabulary show relations --target source-map",
    "wikiwright vocabulary show tags",
  ],
  writes: false,
  needsVaultModules: true,
  run: (args) => {
    const [, name] = args.positionals;
    const vault = loadVault("vocabulary", args.root);
    if (!vault.ok) return vault.result;
    const registry = vault.registry;
    // The names are the LOADED modules' registrations, never a closed set: a
    // kit's vocabulary is a vocabulary here, and a name no loaded module
    // registers is refused by the same message.
    const registered = vocabularyNames(vault.modules);
    if (name === undefined) {
      return fail(
        "vocabulary",
        "usage",
        "missing-argument",
        "vocabulary show requires a vocabulary name",
        { details: { valid_values: registered } },
      );
    }
    const target = args.flags["target"];
    if (typeof target === "string" && !typeReferencing(vault.modules).includes(name)) {
      return fail(
        "vocabulary",
        "usage",
        "target-not-applicable",
        `--target is the inbound view of an entry's type-valued property; the module registering "${name}" declares none`,
        { details: { valid_values: typeReferencing(vault.modules) } },
      );
    }
    if (!registered.includes(name)) {
      return fail(
        "vocabulary",
        "usage",
        "unknown-vocabulary",
        `no loaded module registers a "${name}" vocabulary`,
        { details: { valid_values: registered } },
      );
    }
    const view = vocabularyView(registry, name);
    const rows = boundBy(registry, vault.modules, name);
    const notes = [...view.notes];
    if (name === "tags" && rows.length === 0) {
      notes.push(
        "no section binds `tags`: the vocabulary is read from frontmatter by folder alignment, the catalog and the identity checks, outside any section",
      );
    }

    let entries = [...view.vocabulary.entries.values()].sort((a, b) =>
      codeUnitCompare(a.name, b.name),
    );
    const label = args.flags["label"];
    if (typeof label === "string") {
      const resolved = resolveVocabularyEntry(view.vocabulary, label);
      if (resolved === undefined) {
        return fail(
          "vocabulary",
          "not_found",
          "unknown-entry",
          `"${label}" is not an entry of the "${name}" vocabulary`,
          {
            details: {
              nearest: nearestEntries(view.vocabulary, label),
              valid_values: entries.map((e) => e.name),
            },
          },
        );
      }
      entries = [resolved.entry];
    }

    // Every entry: the four shared properties, then the registering module's
    // own properties verbatim, then — for each type- or tag-valued property the
    // module DECLARED — what it resolves to in this vault. `references` is the
    // line that matters for a type-valued property: a name nobody extends and
    // no name at all read alike in the declaration and differ completely in
    // what a page may write.
    const declared = entries.map((entry) => ({
      name: entry.name,
      description: entry.description ?? null,
      aliases: entry.aliases,
      status: entry.status,
      replaced_by: entry.replaced_by ?? null,
      properties: entry.properties,
      references: referencesOf(registry, vault.modules, name, entry),
      required_by: requiredBy(rows, entry.name),
    }));

    const pages = collectPages(args.root, walkPages(args.root, rootsOf(vault)));
    const observed = observeVocabulary(
      name,
      pages,
      registry,
      lintOptionsFor(vault, buildNameIndex(pages)),
    ).map((row) => ({
      label: row.label,
      count: row.count,
      on_types: row.onTypes,
      // The drift, named. In `registered` mode an observed value with no entry
      // is what a later `unknown-*` finding will be about; in `census` mode it
      // is the argument the registered flip is made from (docs/constitution.md §Vocabularies).
      registered: resolveVocabularyEntry(view.vocabulary, row.label) !== undefined,
    }));

    if (typeof target === "string") {
      // A reader took the unfiltered `declared` block for a
      // broken `--target` filter on first sight. `--target` is an INBOUND view
      // and adds a block; it narrows nothing, and saying so costs one sentence
      // where not saying it cost a reader their trust in the verb.
      notes.push(
        "the answer to --target is the `target` block; `declared` is the whole vocabulary, unfiltered",
      );
    }
    let targetBlock: Record<string, unknown> | undefined;
    if (typeof target === "string") {
      const effective = registry.types.get(target);
      if (effective === undefined) {
        return fail("vocabulary", "not_found", "unknown-type", `no registered type "${target}"`, {
          details: { valid_values: activeTypeNames(registry) },
          hint: "register the type in config/constitution.json through review, or pick one of details.valid_values",
        });
      }
      // An abstract type is uninstantiable, so no page carries it and no entry
      // can name a page of it. The empty list is the honest answer, and the
      // note is why it is empty.
      const instantiable = effective.abstract !== true;
      if (!instantiable) {
        notes.push(`"${target}" is abstract, so no page carries it and no entry can point at it`);
      }
      targetBlock = {
        type: target,
        entries: [...view.vocabulary.entries.values()]
          .map((entry) => ({ entry, through: refersTo(vault.modules, name, entry, effective) }))
          .filter(({ through }) => instantiable && through.length > 0)
          .sort((a, b) => codeUnitCompare(a.entry.name, b.entry.name))
          .map(({ entry, through }) => ({
            name: entry.name,
            // The declared property (or properties) whose names the type's chain meets.
            through,
            references: referencesOf(registry, vault.modules, name, entry),
            required_by: requiredBy(rows, entry.name),
            // Where such a line may be written at all: an entry with no section
            // to carry it is one no page can use, whatever it names.
            sources: rows.map((row) => ({
              type: row.type,
              section: row.section,
              severity: row.severity,
            })),
          })),
      };
    }

    const data: Record<string, unknown> = {
      name,
      mode: view.vocabulary.mode,
      entries: view.vocabulary.entries.size,
      form: view.vocabulary.form ?? null,
      ...(notes.length === 0 ? {} : { note: notes.join(" \u00b7 ") }),
      bound_by: rows,
      declared,
      observed,
    };
    if (targetBlock !== undefined) data["target"] = targetBlock;
    return ok("vocabulary", data);
  },
};
