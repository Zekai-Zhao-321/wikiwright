// docs/concepts.md (the post-combination families over the
// effective set) · docs/constitution.md §Types (the two lifecycle contradictions)
// docs/constitution.md §Sections (required ∩ forbidden headings) · docs/constitution.md §Shapes (the
// pin shape's siblings) · docs/extending.md §A check (an attachment names a
// registered check, sits on a surface it admits, carries a config its schema
// accepts) · docs/constitution.md §Vocabularies (every name a section or an entry points
// at resolves).
import { codeUnitCompare, normalizeIdentity } from "../identity/index.ts";
import {
  declaredParams,
  effectOf,
  type LifecycleEffect,
  type ModuleRegistry,
  safeParseModule,
} from "../modules/index.ts";
import { shapeKind, shapeRequires, shapeTargetType } from "../shapes/index.ts";
import { ARCHETYPES } from "./combine.ts";
import {
  type EffectiveSectionEntry,
  type EffectiveType,
  type EffectiveVocabulary,
  entryProperty,
  type RegistryIssue,
  resolveVocabularyEntry,
  type VocabularyEntry,
} from "./model.ts";

/**
 * docs/extending.md: what this section's declaration does to the
 * lines it governs, read as the word the grammar declared rather than the
 * grammar's name — so a kit's append-only grammar inherits both refusals.
 */
function sectionEffect(entry: EffectiveSectionEntry, modules: ModuleRegistry): LifecycleEffect {
  const grammar = entry.grammar;
  if (grammar === undefined) return "none";
  const spec = modules.grammars.get(grammar);
  if (spec === undefined) return "none";
  return effectOf(spec, declaredParams(entry));
}

/** What a section parameter's value names, when the grammar declared `ParamSpec.entries`. */
interface EntryReference {
  readonly param: string;
  /** The vocabulary the names resolve in; absent when the section bound none. */
  readonly vocabulary: string | undefined;
  readonly values: readonly string[];
}

/** The names a parameter value carries: a string, a list, or rows read at `key`. */
function namesIn(value: unknown, key: string | undefined): string[] {
  const items = Array.isArray(value) ? (value as unknown[]) : [value];
  const leaves =
    key === undefined
      ? items
      : items.map((row) =>
          row !== null && typeof row === "object"
            ? (row as Record<string, unknown>)[key]
            : undefined,
        );
  return leaves.flatMap((leaf) =>
    Array.isArray(leaf)
      ? (leaf as unknown[]).filter((v): v is string => typeof v === "string")
      : typeof leaf === "string"
        ? [leaf]
        : [],
  );
}

/**
 * docs/constitution.md §Vocabularies: the parameters of a section entry whose values name
 * vocabulary entries, as the grammar declared them. The kernel knows a
 * parameter HAS entries — in the bound vocabulary, or a fixed one — and not
 * what the parameter means.
 */
function entryReferences(entry: EffectiveSectionEntry, modules: ModuleRegistry): EntryReference[] {
  const spec = entry.grammar === undefined ? undefined : modules.grammars.get(entry.grammar);
  if (spec === undefined) return [];
  const out: EntryReference[] = [];
  for (const [param, paramSpec] of Object.entries(spec.params)) {
    const refs = paramSpec.entries;
    if (refs === undefined) continue;
    const value = entry.params[param];
    if (value === undefined) continue;
    out.push({
      param,
      vocabulary: refs.vocabulary ?? entry.vocabulary,
      values: namesIn(value, refs.key),
    });
  }
  return out;
}

/**
 * The vocabularies a section entry binds: the one its `vocabulary` names, and
 * every fixed one a declared parameter's values resolve in. What `vocabulary
 * show` prints under `bound_by`, derived from the manifests rather than from
 * a parameter name the verb knows.
 */
export function boundVocabularies(entry: EffectiveSectionEntry, modules: ModuleRegistry): string[] {
  const bound = new Set<string>();
  if (entry.vocabulary !== undefined) bound.add(entry.vocabulary);
  for (const reference of entryReferences(entry, modules)) {
    if (reference.vocabulary !== undefined) bound.add(reference.vocabulary);
  }
  return [...bound].sort(codeUnitCompare);
}

/** The names at a dotted path into an entry's own properties: a string, or a list of them. */
function namesAt(entry: VocabularyEntry, path: string): string[] {
  const [head, ...rest] = path.split(".");
  let value: unknown = head === undefined ? undefined : entryProperty(entry, head);
  for (const segment of rest) {
    value =
      value !== null && typeof value === "object"
        ? (value as Record<string, unknown>)[segment]
        : undefined;
  }
  return namesIn(value, undefined);
}

/** The families judged over the EFFECTIVE set, after every chain has combined. */
export function validateEffective(
  types: ReadonlyMap<string, EffectiveType>,
  vocabularies: ReadonlyMap<string, EffectiveVocabulary>,
  modules: ModuleRegistry,
  issues: RegistryIssue[],
): void {
  const declaredTypes = new Set([...types.keys(), ...ARCHETYPES.keys()]);
  const tags = vocabularies.get("tags");

  for (const [name, eff] of types) {
    const where = `type:${name}`;

    // docs/constitution.md §Types: the page-wide law and an append-only section would
    // report ONE mutation twice — the narrower declaration is the one to keep,
    // and the engine says which rather than double-reporting.
    if (eff.body !== undefined) {
      const doubled = (eff.sections?.list ?? []).find(
        (e) => sectionEffect(e, modules) === "forbids-mutation",
      );
      if (doubled !== undefined) {
        issues.push({
          code: "body-lifecycle-doubled",
          where,
          message: `body.lifecycle (from ${eff.body.contributedBy}) and the append-only "${doubled.heading}" section (from ${doubled.contributedBy}) would report one mutation twice — keep the section`,
        });
      }
      // A page-wide append-only law
      // and a section whose law requires a REWRITE are mutually contradictory —
      // every legal supersession would trip the page-wide law.
      const rewriting = (eff.sections?.list ?? []).find(
        (e) => sectionEffect(e, modules) === "requires-rewrite",
      );
      if (rewriting !== undefined) {
        issues.push({
          code: "body-lifecycle-conflict",
          where,
          message: `body.lifecycle append-only (from ${eff.body.contributedBy}) forbids the rewrite the "${rewriting.heading}" section's own law requires — a page cannot be both`,
        });
      }
    }

    // Sections entries with min ≥ 1 are required structure and entries with
    // max: 0 are forbidden structure — the required∩forbidden contradiction
    // family (docs/constitution.md §Sections), compared by identity.
    const requiredHeadings = new Map<string, { heading: string; from: string }>();
    const forbiddenHeadings = new Map<string, { heading: string; from: string }>();
    for (const e of eff.sections?.list ?? []) {
      const identity = normalizeIdentity(e.heading);
      if (e.min >= 1) requiredHeadings.set(identity, { heading: e.heading, from: e.contributedBy });
      if (e.max === 0)
        forbiddenHeadings.set(identity, { heading: e.heading, from: e.contributedBy });
    }
    for (const [identity, required] of requiredHeadings) {
      const forbidden = forbiddenHeadings.get(identity);
      if (forbidden === undefined) continue;
      issues.push({
        code: "rule-conflict-heading",
        where,
        message: `heading "${required.heading}" required by ${required.from} and forbidden by ${forbidden.from}${
          required.heading === forbidden.heading ? "" : ` as "${forbidden.heading}"`
        }`,
      });
    }

    // Shapes, over the EFFECTIVE field set: `requires` names a field on the
    // type, `target_type` names a declared type or archetype.
    for (const [field, declared] of eff.fields) {
      for (const required of shapeRequires(declared.shape)) {
        if (!eff.fields.has(required)) {
          issues.push({
            code: "field-requires-unknown",
            where,
            message: `field "${field}" requires "${required}", which no declaration on this type names`,
          });
        }
      }
      const targetType = shapeTargetType(declared.shape);
      if (targetType !== undefined && !declaredTypes.has(targetType)) {
        issues.push({
          code: "field-target-type-unknown",
          where,
          message: `field "${field}" targets type "${targetType}", which the constitution does not declare`,
        });
      }
    }

    // docs/constitution.md §Shapes (the `pin` shape): a pin names a revision OF an origin, so
    // the sibling it points at must be declared on the chain and be a string,
    // `covers` a list of strings, and a chain carries ONE pin.
    const pins = [...eff.fields].filter(([, declared]) => shapeKind(declared.shape) === "pin");
    if (pins.length > 1) {
      issues.push({
        code: "pin-duplicate",
        where,
        message: `fields ${pins.map(([field]) => `"${field}"`).join(", ")} are all pins; a type carries one pin`,
      });
    }
    for (const [field, declared] of pins) {
      const shape = declared.shape as Record<string, unknown>;
      const origin = String(shape["origin"]);
      const originShape = eff.fields.get(origin)?.shape;
      if (originShape === undefined) {
        issues.push({
          code: "pin-origin-unknown-field",
          where,
          message: `field "${field}" pins the origin named by "${origin}", which the type does not declare`,
        });
      } else if (shapeKind(originShape) !== "string") {
        issues.push({
          code: "pin-origin-shape",
          where,
          message: `field "${field}" pins the origin named by "${origin}", which is a ${shapeKind(originShape) ?? "?"}, not a string`,
        });
      }
      const covers = shape["covers"];
      if (typeof covers !== "string") continue;
      const coversShape = eff.fields.get(covers)?.shape;
      const item = (coversShape as Record<string, unknown> | undefined)?.["item"];
      if (coversShape === undefined) {
        issues.push({
          code: "pin-covers-shape",
          where,
          message: `field "${field}" covers the paths in "${covers}", which the type does not declare`,
        });
      } else if (shapeKind(coversShape) !== "list" || shapeKind(item) !== "string") {
        issues.push({
          code: "pin-covers-shape",
          where,
          message: `field "${field}" covers the paths in "${covers}", which is not a list of strings`,
        });
      }
    }

    // docs/extending.md §A check: every attachment names a REGISTERED check, sits
    // on a surface that check admits, and carries a config its own schema
    // accepts. All three are refused before any module code runs, which is
    // what makes a check a closed selection rather than a bundle-authored
    // predicate.
    for (const check of eff.checks) {
      const spec = modules.checks.get(check.use);
      if (spec === undefined) {
        issues.push({
          code: "constitution-unknown-extension",
          where,
          message: `no loaded module registers a check named "${check.use}" (registered: ${[...modules.checks.keys()].sort(codeUnitCompare).join(", ") || "none"})`,
        });
        continue;
      }
      if (!spec.surfaces.includes(check.surface)) {
        issues.push({
          code: "check-attachment-invalid",
          where,
          message: `check "${check.use}" attaches to ${spec.surfaces.join(", ")}; it is declared on a ${check.surface}`,
        });
        continue;
      }
      const parsed = safeParseModule(spec.config, check.config, `check "${check.use}"`);
      if (!parsed.success) {
        for (const issue of parsed.issues) {
          issues.push({
            code: "check-config-invalid",
            where,
            message: `check "${check.use}"${issue.path.length === 0 ? "" : ` config.${issue.path.join(".")}`}: ${issue.message}`,
          });
        }
        continue;
      }
      check.config = parsed.data as Readonly<Record<string, unknown>>;
    }

    // docs/constitution.md §Vocabularies: every name a section points at must resolve,
    // and a grammar that declared which vocabulary its items are checked
    // against is not bound to another.
    for (const entry of eff.sections?.list ?? []) {
      const declared = entry.vocabulary;
      if (declared !== undefined) {
        if (vocabularies.get(declared) === undefined) {
          issues.push({
            code: "sections-vocabulary-unknown",
            where,
            message: `section "${entry.heading}" reads vocabulary "${declared}", which the constitution does not declare`,
          });
        } else {
          const expected =
            entry.grammar === undefined
              ? undefined
              : modules.grammars.get(entry.grammar)?.vocabulary;
          if (expected !== undefined && expected !== declared) {
            issues.push({
              code: "sections-vocabulary-kind",
              where,
              message: `the "${entry.grammar}" grammar reads the "${expected}" vocabulary, not "${declared}"`,
            });
          }
        }
      }
      // docs/constitution.md §Vocabularies: a parameter whose values name entries is
      // resolved through the alias and retirement laws here, exactly as a
      // value on a page is — a name mistyped in a constitution silently
      // unrecognizes every page that wrote the real one. A vocabulary the
      // bundle does not declare governs nothing.
      for (const reference of entryReferences(entry, modules)) {
        const target =
          reference.vocabulary === undefined ? undefined : vocabularies.get(reference.vocabulary);
        if (target === undefined) continue;
        for (const value of reference.values) {
          const resolved = resolveVocabularyEntry(target, value);
          if (resolved === undefined) {
            if (target.mode === "registered") {
              issues.push({
                code: "sections-entry-unknown",
                where,
                message: `section "${entry.heading}" names "${value}" in ${reference.param}, which "${target.name}" does not declare`,
              });
            }
            continue;
          }
          if (resolved.alias) {
            issues.push({
              code: "sections-entry-alias",
              where,
              message: `section "${entry.heading}" names "${value}" in ${reference.param}, which is an alias of "${resolved.entry.name}" — write the canonical entry`,
            });
          }
          if (resolved.entry.status === "retired") {
            issues.push({
              code: "sections-entry-retired",
              where,
              message: `section "${entry.heading}" names retired entry "${value}" in ${reference.param}${resolved.entry.replaced_by === undefined ? "" : ` (replaced by: ${resolved.entry.replaced_by.join(", ")})`}`,
            });
          }
        }
      }
    }
  }

  // docs/constitution.md §Vocabularies: an entry property that names types or tags —
  // declared as `typeRefs` / `tagRefs` by the module that owns the vocabulary
  // — resolves, or the load is refused. The kernel validates that the NAME
  // resolves, which is a kernel question, and reads nothing else about the
  // property; a kit's own type-valued property gets the same check.
  for (const vocabulary of vocabularies.values()) {
    const spec = modules.vocabularies.get(vocabulary.name);
    if (spec === undefined) continue;
    for (const entry of vocabulary.entries.values()) {
      const at = `vocabulary:${vocabulary.name}/${entry.name}`;
      for (const path of spec.typeRefs ?? []) {
        for (const target of namesAt(entry, path)) {
          if (declaredTypes.has(target)) continue;
          issues.push({
            code: "vocabulary-type-ref-unknown",
            where: at,
            message: `${path} names "${target}", which is not a registered type`,
          });
        }
      }
      for (const path of spec.tagRefs ?? []) {
        for (const target of namesAt(entry, path)) {
          if (tags?.entries.get(normalizeIdentity(target))?.name === target) continue;
          issues.push({
            code: "vocabulary-tag-ref-unknown",
            where: at,
            message: `${path} names "${target}", which is not a registered tag`,
          });
        }
      }
    }
  }
}
