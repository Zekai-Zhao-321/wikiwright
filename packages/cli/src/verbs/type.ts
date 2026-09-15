// docs/cli.md §type · docs/constitution.md §Types, docs/constitution.md §Sections (the effective
// contract an agent reads before writing) · docs/architecture.md §Directories.

import {
  buildNameIndex,
  codeUnitCompare,
  declaredParams,
  type EffectiveType,
  type FlattenedRegistry,
  observeVocabulary,
  shapeKind,
} from "@wikiwright/core";
import { fail, ok } from "../envelope.ts";
import { lintOptionsFor, rootsOf, type VaultOk } from "../law.ts";
import { activeTypeNames, collectPages, sectionLines, skeletonOf, templateOf } from "../pages.ts";
import type { CommandSpec } from "../spec.ts";
import { loadVault, walkPages } from "../vaultio.ts";

/**
 * docs/cli.md §type: the contract as the WRITING INSTRUCTION — one line per
 * section carrying its grammar, its bounds, the item form the grammar's own
 * manifest states, its parameters sorted by key, and the vocabulary it reads
 * with the vault's LIVE counts. The brief carries the stable half; the counts
 * live here, so a tracked brief never goes stale on a content commit.
 */
function briefLines(vault: VaultOk, effective: EffectiveType): string[] {
  const registry: FlattenedRegistry = vault.registry;
  return (effective.sections?.list ?? []).map((entry) => {
    const grammar = entry.grammar ?? "prose";
    const bounds = `min ${entry.min}${entry.max === undefined ? "" : ` max ${entry.max}`}`;
    const parts = [`${entry.heading}  ${grammar}  ${bounds}`];
    const form = vault.modules.grammars.get(grammar)?.form;
    if (form !== undefined) parts.push(form);
    const declared = declaredParams(entry);
    const params = Object.keys(declared)
      .filter((key) => key !== "vocabulary")
      .sort(codeUnitCompare)
      .map((key) => `${key}=${JSON.stringify(declared[key])}`);
    if (params.length > 0) parts.push(params.join(" "));
    if (entry.vocabulary !== undefined) {
      const vocabulary = registry.vocabularies.get(entry.vocabulary);
      parts.push(
        `${entry.vocabulary}: ${vocabulary?.entries.size ?? 0} declared (${vocabulary?.mode ?? "census"})`,
      );
    }
    return parts.join("  |  ");
  });
}

/** The census of each vocabulary named, head first, keyed by the vocabulary. */
function observedFor(
  vault: VaultOk,
  root: string,
  names: readonly string[],
): Record<string, { label: string; count: number }[]> {
  if (names.length === 0) return {};
  const pages = collectPages(root, walkPages(root, rootsOf(vault)));
  const options = lintOptionsFor(vault, buildNameIndex([]));
  return Object.fromEntries(
    [...names].sort(codeUnitCompare).map((name) => [
      name,
      observeVocabulary(name, pages, vault.registry, options)
        .slice(0, 25)
        .map((row) => ({ label: row.label, count: row.count })),
    ]),
  );
}

export const typeCommand: CommandSpec = {
  name: "type",
  role: "consumer",
  summary: "Introspect the type registry: show one effective contract, or list all types.",
  positionals: [
    { name: "subcommand", required: true },
    { name: "name", required: false },
  ],
  subcommands: ["list", "show"],
  flags: [
    {
      name: "brief",
      type: "boolean",
      summary: "print the contract as the writing instruction, with live counts",
    },
  ],
  examples: [
    "wikiwright type show subsystem",
    "wikiwright type show code-concept --brief",
    "wikiwright type list",
  ],
  writes: false,
  needsVaultModules: true,
  run: (args) => {
    const vault = loadVault("type", args.root);
    if (!vault.ok) return vault.result;
    const [sub, name] = args.positionals;
    if (sub === "show") {
      if (name === undefined) {
        return fail("type", "usage", "missing-argument", "type show requires a type name");
      }
      const effective = vault.registry.types.get(name);
      if (effective === undefined) {
        return fail("type", "not_found", "unknown-type", `no registered type "${name}"`, {
          details: { valid_values: activeTypeNames(vault.registry) },
          hint: "register the type in config/constitution.json through review, or pick one of details.valid_values",
        });
      }
      // Field shapes are part of the shown contract — a Map serializes
      // to {}, so the schemas surface explicitly.
      // So do the fragments a type pastes in, the vocabularies its
      // sections read (with their modes and entry counts), and whether the type
      // is instantiable at all.
      const readVocabularies = new Set(
        (effective.sections?.list ?? [])
          .map((e) => e.vocabulary)
          .filter((v): v is string => v !== undefined),
      );
      // The template `new` renders from, read for the brief: its body is the
      // skeleton and its seeds sit beside the fields, so the two verbs agree.
      const template =
        args.flags["brief"] === true ? templateOf(args.root, vault, effective) : undefined;
      return ok("type", {
        ...effective,
        abstract: effective.abstract === true,
        fragments: effective.fragments.map((f) => ({
          value: f.value,
          contributedBy: f.contributedBy,
          description: vault.registry.fragments.get(f.value)?.description,
        })),
        vocabularies: [...readVocabularies].sort(codeUnitCompare).map((name) => {
          const vocabulary = vault.registry.vocabularies.get(name);
          return {
            name,
            mode: vocabulary?.mode ?? "census",
            entries: vocabulary?.entries.size ?? 0,
          };
        }),
        // docs/constitution.md §Sections: one line per section — the contract an agent
        // reads before writing IS the contract the parser enforces.
        section_lines: sectionLines(effective, template?.body),
        ...(args.flags["brief"] !== true
          ? {}
          : {
              brief: briefLines(vault, effective),
              // The skeleton `new` writes — the template's body merged with the
              // required headings — with the title left to the caller.
              skeleton: skeletonOf(effective, template?.body).replaceAll("{{ title }}", "<title>"),
              // docs/constitution.md §Vocabularies: the vault's LIVE counts for every vocabulary
              // this type's sections read — never a literal name.
              observed: observedFor(vault, args.root, [...readVocabularies]),
            }),
        // docs/constitution.md §Types: ONE map, `required` inside the shape. The four
        // lists this printed were an IR artifact, and a reader who wants
        // "which are required" reads the shapes — the same way the engine does.
        fields: Object.fromEntries(
          [...effective.fields].map(([field, s]) => [
            field,
            {
              shape: s.shape,
              contributedBy: s.contributedBy,
              // The two page-ref kinds take a canonical NAME, never a
              // path; `type show` says so where the shape is read.
              ...(shapeKind(s.shape) === "page-ref" || shapeKind(s.shape) === "page-ref-list"
                ? { form: "canonical name" }
                : {}),
              // docs/cli.md §new: the value the template seeds, which `new`
              // writes unless `--set` names the field.
              ...(template?.seeds.has(field) === true ? { seed: template.seeds.get(field) } : {}),
            },
          ]),
        ),
      });
    }
    if (sub === "list") {
      // The four engine roots are usable types no registry file
      // declares — say which is which, or the file under-counts by four.
      const archetypes = new Set(vault.registry.archetypes);
      const types = [...vault.registry.types.values()]
        .sort((a, b) => codeUnitCompare(a.name, b.name))
        .map((t) => ({
          name: t.name,
          source: archetypes.has(t.name) ? "archetype" : "registry",
          archetype: t.archetype,
          status: t.status,
          description: t.description,
        }));
      return ok("type", { types });
    }
    throw new Error(`unreachable: subcommand "${String(sub)}" passed the parser`);
  },
};
