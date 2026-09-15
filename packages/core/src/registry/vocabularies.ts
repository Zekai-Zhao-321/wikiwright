// docs/constitution.md §Vocabularies
// (one entry shape, N instances; the shared four are the
// kernel's, the rest is the registering module's) · docs/extending.md §The manifest (a bundle
// may tighten a module's mode and never relax it; a module's entries sit beside
// the bundle's and may not be re-declared).
import { z } from "zod";
import { codeUnitCompare, normalizeIdentity } from "../identity/index.ts";
import { type ModuleRegistry, safeParseModule } from "../modules/index.ts";
import type { VocabularyDeclaration } from "./document.ts";
import type { EffectiveVocabulary, RegistryIssue, VocabularyEntry } from "./model.ts";

/**
 * docs/constitution.md §Vocabularies: the four properties EVERY
 * vocabulary's entry carries, whoever registered it. They are the kernel's
 * because the alias law and the retirement law are judged outside any section's
 * ratchet, and the kernel judges them.
 */
const SHARED_ENTRY_KEYS: readonly string[] = ["description", "aliases", "status", "replaced_by"];

const SharedEntrySchema = z.strictObject({
  description: z.string().min(1).optional(),
  aliases: z.array(z.string().min(1)).optional(),
  status: z.enum(["active", "retired"]).optional(),
  replaced_by: z.array(z.string().min(1)).optional(),
});

/**
 * docs/constitution.md §Vocabularies: the vocabulary names this bundle may declare —
 * the kernel's own plus every name a loaded module registered.
 */
export function vocabularyNames(modules: ModuleRegistry): readonly string[] {
  return [...modules.vocabularies.keys()].sort(codeUnitCompare);
}

/** The keys the registering module's entry schema declares; empty for a bare vocabulary. */
function moduleEntryKeys(vocabulary: string, modules: ModuleRegistry): readonly string[] {
  const entry = modules.vocabularies.get(vocabulary)?.entry;
  if (entry === undefined) return [];
  const shape = (entry as { shape?: Record<string, unknown> }).shape;
  return shape === undefined ? [] : Object.keys(shape);
}

/**
 * Which registered vocabulary owns a property name — used only to turn "this
 * entry carries a key its vocabulary does not declare" into "…and here is the
 * vocabulary that does". A hint, never a verdict.
 */
function propertyOwner(property: string, modules: ModuleRegistry): string | undefined {
  for (const name of modules.vocabularies.keys()) {
    if (moduleEntryKeys(name, modules).includes(property)) return name;
  }
  return undefined;
}

/** docs/constitution.md §Vocabularies: one entry's schema failures, under its own anchor. */
function entrySchemaIssues(where: string, error: z.ZodError): RegistryIssue[] {
  return error.issues.map((i) => ({
    code: i.code === "unrecognized_keys" ? "vocabulary-entry-key" : "vocabulary-entry-invalid",
    where: i.path.length === 0 ? where : `${where}/${i.path.join("/")}`,
    message: i.message,
  }));
}

/**
 * The document's vocabularies against the loaded modules' registrations: the
 * name set is closed, `tags` is required and registered, a bundle may not relax
 * a module's mode, each entry is validated in two halves, and the alias and
 * replacement laws hold within each vocabulary.
 */
export function resolveVocabularies(
  declared: Readonly<Record<string, VocabularyDeclaration>>,
  modules: ModuleRegistry,
): { issues: RegistryIssue[]; vocabularies: Map<string, EffectiveVocabulary> } {
  const issues: RegistryIssue[] = [];
  const vocabularies = new Map<string, EffectiveVocabulary>();
  const registered = vocabularyNames(modules);
  const names = new Set<string>(registered);
  for (const name of Object.keys(declared)) {
    if (!names.has(name)) {
      issues.push({
        code: "vocabulary-unknown",
        where: `vocabulary:${name}`,
        message: `no loaded module registers a "${name}" vocabulary (registered: ${registered.join(", ")}) — a vocabulary nothing consumes is metadata`,
      });
    }
  }
  const tags = declared["tags"];
  if (tags === undefined) {
    issues.push({
      code: "vocabulary-missing",
      where: "vocabulary:tags",
      message: "every constitution declares a `tags` vocabulary",
    });
  } else if (tags.mode !== "registered") {
    issues.push({
      code: "vocabulary-mode",
      where: "vocabulary:tags",
      message: "`tags` is registered by law: folder alignment and the catalog read a closed set",
    });
  }

  for (const [name, vocabulary] of Object.entries(declared)) {
    // docs/extending.md §The manifest: a bundle may TIGHTEN a registered mode and never relax
    // it. A module that registered `registered` said its value set is closed;
    // a bundle re-declaring it as `census` would silently disable the
    // module's own law on every page.
    const spec = modules.vocabularies.get(name);
    if (spec?.mode === "registered" && vocabulary.mode !== "registered") {
      issues.push({
        code: "vocabulary-mode",
        where: `vocabulary:${name}`,
        message: `"${name}" is registered by the module that declared it; a bundle may not relax it to census`,
      });
    }
    const ownSchema = spec?.entry;
    const ownKeys = new Set(moduleEntryKeys(name, modules));
    // docs/extending.md §What a module registers: every entry a module shipped into this
    // vocabulary — the owner's own and any other module's contributions, one
    // merged map — first, the bundle's beside them. A name declared by both is
    // two laws with one name — refused, like a re-declared type — never a
    // silent overwrite in either direction.
    const shipped = modules.entries.get(name) ?? new Map();
    const raws: Record<string, Readonly<Record<string, unknown>>> = {};
    for (const [entryName, contributed] of shipped) raws[entryName] = contributed.value;
    for (const [entryName, raw] of Object.entries(vocabulary.entries)) {
      const contributed = shipped.get(entryName);
      if (contributed !== undefined) {
        issues.push({
          code: "vocabulary-entry-collision",
          where: `vocabulary:${name}/${entryName}`,
          message: `"${entryName}" is shipped by module "${contributed.module}"; a bundle may add entries beside a module's, never re-declare one`,
        });
        continue;
      }
      raws[entryName] = raw;
    }
    const entries = new Map<string, VocabularyEntry>();
    const owners = new Map<string, string>();
    for (const [entryName, raw] of Object.entries(raws)) {
      const where = `vocabulary:${name}/${entryName}`;
      const shared: Record<string, unknown> = {};
      const own: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(raw)) {
        if (SHARED_ENTRY_KEYS.includes(key)) shared[key] = value;
        else own[key] = value;
      }
      const sharedParsed = SharedEntrySchema.safeParse(shared);
      if (!sharedParsed.success) {
        for (const issue of entrySchemaIssues(where, sharedParsed.error)) issues.push(issue);
        continue;
      }
      // docs/constitution.md §Vocabularies: the module's own half. A property neither
      // side declares is refused, and the message names the vocabulary that
      // DOES own it where one does — derived from the registrations.
      for (const key of Object.keys(own)) {
        if (ownKeys.has(key)) continue;
        const owner = propertyOwner(key, modules);
        issues.push({
          code: "vocabulary-entry-key",
          where,
          message:
            owner === undefined
              ? `"${key}" is not a property the "${name}" vocabulary declares`
              : `"${key}" belongs to the "${owner}" vocabulary, not to "${name}"`,
        });
      }
      let properties: Readonly<Record<string, unknown>> = {};
      if (ownSchema !== undefined) {
        // Through the guard — a vocabulary's entry schema is MODULE
        // code, and one that throws would end the load unattributed.
        const ownParsed = safeParseModule(ownSchema, own, `vocabulary "${name}"`);
        if (!ownParsed.success) {
          for (const issue of ownParsed.issues) {
            // The unrecognized-key issues are already reported above, by name
            // and with the owning vocabulary; reporting them twice would count
            // one defect twice.
            if (/unrecognized key/iu.test(issue.message)) continue;
            issues.push({
              code: "vocabulary-entry-invalid",
              where: issue.path.length === 0 ? where : `${where}/${issue.path.join("/")}`,
              message: issue.message,
            });
          }
          continue;
        }
        properties = ownParsed.data as Readonly<Record<string, unknown>>;
      }
      const entry = sharedParsed.data;
      for (const declaredName of [entryName, ...(entry.aliases ?? [])]) {
        const identity = normalizeIdentity(declaredName);
        const prior = owners.get(identity);
        if (prior !== undefined) {
          issues.push({
            code: "vocabulary-alias-collision",
            where,
            message: `"${declaredName}" is already claimed by "${prior}" in this vocabulary`,
          });
        }
        owners.set(identity, entryName);
      }
      for (const target of entry.replaced_by ?? []) {
        if (!Object.hasOwn(raws, target)) {
          issues.push({
            code: "unknown-replaced-by",
            where,
            message: `replaced_by names "${target}", which this vocabulary does not declare`,
          });
        }
      }
      const effective: VocabularyEntry = {
        name: entryName,
        aliases: entry.aliases ?? [],
        status: entry.status ?? "active",
        properties,
      };
      if (entry.description !== undefined) effective.description = entry.description;
      if (entry.replaced_by !== undefined) effective.replaced_by = entry.replaced_by;
      entries.set(normalizeIdentity(entryName), effective);
    }
    const effective: EffectiveVocabulary = { name, mode: vocabulary.mode, entries };
    if (vocabulary.form !== undefined) effective.form = vocabulary.form;
    vocabularies.set(name, effective);
  }
  return { issues, vocabularies };
}
