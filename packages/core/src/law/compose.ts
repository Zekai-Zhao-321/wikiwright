// v2 contracts §2 (qualified names, collisions, vocabulary contribution) ·
// §3 (roles, the linearisation) · §3.2 (sections and rules under inheritance).
//
// Documents in, effective types out. Ported from the old registry's
// combine.ts: the one-way section laws (min is the maximum of the mins, max
// the minimum of the maxes, a grammar or vocabulary fixed once on a chain, a
// child adding a heading) and the chain walk with its cycle refusal. Dropped:
// module-registered grammars and their parameter schemas (the grammar set is
// fixed, §4), aliases and max_chars on a section, the severity ratchet on a
// section (a rule carries its severity, §3), checks attached by `use`, and
// field shapes as a closed kind table (a field is JSON Schema, §3.1).

import { RESERVED_KEYS } from "../schema/reserved.ts";
import {
  type FragmentDocument,
  GRAMMAR_PARAMS,
  type Grammar,
  type Role,
  type RuleDeclaration,
  type SectionParams,
  type TypeDocument,
  type VocabularyDocument,
} from "./documents.ts";
import type { LawIssue } from "./issues.ts";
import { resolveReference } from "./names.ts";

export interface LawSection {
  heading: string;
  min: number;
  max: number | null;
  grammar?: Grammar;
  /** Qualified. */
  vocabulary?: string;
  params: SectionParams;
  /** The types and fragments that declare this heading, in declaration order. */
  declaredBy: string[];
}

export interface LawSections {
  depth: number;
  ordered: boolean;
  additional: "allowed" | "refused";
  list: LawSection[];
}

export interface LawRule {
  id: string;
  expr: string;
  section?: string;
  /** After every `configure` on the chain; YAML integers are `bigint`. */
  config: Record<string, unknown>;
  severity: "error" | "warning";
  message: string;
  /** The type or fragment that declares the rule (qualified). */
  declaredBy: string;
  where: string;
  pointer: string;
}

/** One member of the effective shape's `allOf`, before the engine adds its own. */
export interface ShapePart {
  /** `fragment:<qualified>` or `type:<qualified>`. */
  origin: string;
  where: string;
  schema: Record<string, unknown>;
  /** The schema as YAML read it, integers as `bigint`. */
  raw: Record<string, unknown>;
}

export interface LawType {
  name: string;
  namespace: string;
  where: string;
  role: Role;
  description: string;
  use_when?: string;
  avoid_when?: string;
  abstract: boolean;
  instances: { min: number | null; max: number | null } | null;
  /** Qualified parent, when the type extends one. */
  extends?: string;
  /** §5: the chain from the parent up to the root, the type itself excluded. */
  ancestry: string[];
  /** §3.1: the documents whose `fields` compose the shape, in linearisation order. */
  parts: ShapePart[];
  /**
   * Every top-level frontmatter key the effective shape declares: the reserved
   * keys, then each part's `properties`, in linearisation order.
   */
  properties: string[];
  sections: LawSections | null;
  rules: LawRule[];
  /** §3: frontmatter keys left out of the page digest (§7). */
  meta: string[];
  examples: string[];
}

export interface LawVocabulary {
  name: string;
  namespace: string;
  where: string;
  mode: "registered" | "census";
  entries: Map<string, { description?: string; contributedBy: string }>;
  retired: Map<string, { since?: string; successor?: string }>;
}

export interface Composition {
  types: Map<string, LawType>;
  fragments: Map<string, FragmentDocument>;
  vocabularies: Map<string, LawVocabulary>;
  issues: LawIssue[];
}

const DEFAULT_DEPTH = 2;

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a, bigints) === JSON.stringify(b, bigints);
}

function bigints(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? `${value}n` : value;
}

/** §2: vocabularies, each library's and the bundle's own, then every contribution. */
function composeVocabularies(
  documents: readonly VocabularyDocument[],
  issues: LawIssue[],
): Map<string, LawVocabulary> {
  const out = new Map<string, LawVocabulary>();
  for (const doc of documents) {
    if (doc.contributes_to !== undefined || doc.mode === undefined) continue;
    const entries = new Map<string, { description?: string; contributedBy: string }>();
    for (const [name, entry] of doc.entries)
      entries.set(name, { ...entry, contributedBy: doc.name });
    out.set(doc.name, {
      name: doc.name,
      namespace: doc.namespace,
      where: doc.where,
      mode: doc.mode,
      entries,
      retired: new Map(doc.retired),
    });
  }
  for (const doc of documents) {
    if (doc.contributes_to === undefined) continue;
    const target = out.get(doc.contributes_to);
    if (target === undefined || target.namespace === doc.namespace) {
      issues.push({
        code: "vocabulary-invalid",
        where: doc.where,
        message: `/contributes_to: "${doc.contributes_to}" is not a library vocabulary this ${
          doc.namespace === "" ? "bundle" : "library"
        } can add entries to`,
        details: { pointer: "/contributes_to" },
      });
      continue;
    }
    if (doc.retired.size > 0) {
      issues.push({
        code: "vocabulary-invalid",
        where: doc.where,
        message:
          "/retired: a contribution adds entries only; retiring is the declaring vocabulary's",
        details: { pointer: "/retired" },
      });
    }
    for (const [name, entry] of doc.entries) {
      const prior = target.entries.get(name);
      if (prior !== undefined || target.retired.has(name)) {
        issues.push({
          code: "vocabulary-collision",
          where: doc.where,
          message: `/entries/${name}: "${name}" already exists in ${target.name}${
            prior === undefined ? " (retired)" : ` (declared by ${prior.contributedBy})`
          }; a contribution adds entries, never re-declares one`,
          details: { pointer: `/entries/${name}`, vocabulary: target.name, entry: name },
        });
        continue;
      }
      target.entries.set(name, { ...entry, contributedBy: doc.name });
    }
  }
  for (const vocabulary of out.values()) {
    for (const [name, retired] of vocabulary.retired) {
      if (retired.successor !== undefined && !vocabulary.entries.has(retired.successor)) {
        issues.push({
          code: "vocabulary-invalid",
          where: vocabulary.where,
          message: `/retired/${name}/successor: "${retired.successor}" is not an entry of ${vocabulary.name}`,
          details: { pointer: `/retired/${name}/successor` },
        });
      }
    }
  }
  return out;
}

interface Layer {
  /** `type:<q>` or `fragment:<q>`. */
  origin: string;
  name: string;
  doc: TypeDocument | FragmentDocument;
}

export function compose(
  typeDocs: readonly TypeDocument[],
  fragmentDocs: readonly FragmentDocument[],
  vocabularyDocs: readonly VocabularyDocument[],
): Composition {
  const issues: LawIssue[] = [];
  const typesByName = new Map(typeDocs.map((d) => [d.name, d] as const));
  const fragments = new Map(fragmentDocs.map((d) => [d.name, d] as const));

  // §2: a name is a type or a fragment, once.
  for (const doc of typeDocs) {
    const fragment = fragments.get(doc.name);
    if (fragment === undefined) continue;
    issues.push({
      code: "constitution-collision",
      where: doc.where,
      message: `"${doc.name}" is declared as a type here and as a fragment at ${fragment.where}`,
      details: { name: doc.name },
    });
  }
  const vocabularies = composeVocabularies(vocabularyDocs, issues);

  // §3: rule ids are global across the bundle and every library.
  const ruleSites = new Map<string, string>();
  for (const doc of [...fragmentDocs, ...typeDocs]) {
    for (const rule of doc.rules) {
      const prior = ruleSites.get(rule.id);
      if (prior !== undefined) {
        issues.push({
          code: "rule-collision",
          where: doc.where,
          message: `${rule.pointer}/id: rule "${rule.id}" is already declared at ${prior}; a rule id is declared once across the bundle and its libraries`,
          details: { pointer: `${rule.pointer}/id`, rule: rule.id },
        });
        continue;
      }
      ruleSites.set(rule.id, doc.where);
    }
  }

  /** The chain from `name` to its root, or undefined after reporting why not. */
  const chainOf = (doc: TypeDocument): TypeDocument[] | undefined => {
    const chain: TypeDocument[] = [doc];
    const seen = new Set<string>([doc.name]);
    let at = doc;
    while (at.extends !== undefined) {
      const parentName = resolveReference(at.namespace, at.extends);
      const parent = parentName === undefined ? undefined : typesByName.get(parentName);
      if (parent === undefined) {
        issues.push({
          code: "type-invalid",
          where: at.where,
          message: `/extends: "${at.extends}" is ${
            parentName !== undefined && fragments.has(parentName)
              ? "a fragment, not a type"
              : "no type the bundle or its libraries declare"
          }`,
          details: { pointer: "/extends" },
        });
        return undefined;
      }
      if (seen.has(parent.name)) {
        issues.push({
          code: "type-invalid",
          where: doc.where,
          message: `/extends: the chain from "${doc.name}" returns to "${parent.name}"; a chain ends at a type that extends nothing`,
          details: { pointer: "/extends" },
        });
        return undefined;
      }
      seen.add(parent.name);
      chain.push(parent);
      at = parent;
    }
    return chain;
  };

  const fragmentsOf = (doc: TypeDocument): FragmentDocument[] => {
    const out: FragmentDocument[] = [];
    doc.fragments.forEach((written, i) => {
      const name = resolveReference(doc.namespace, written);
      const fragment = name === undefined ? undefined : fragments.get(name);
      if (fragment === undefined) {
        issues.push({
          code: "type-invalid",
          where: doc.where,
          message: `/fragments/${i}: "${written}" is no fragment the bundle or its libraries declare`,
          details: { pointer: `/fragments/${i}` },
        });
        return;
      }
      out.push(fragment);
    });
    return out;
  };

  const types = new Map<string, LawType>();
  for (const doc of typeDocs) {
    const chain = chainOf(doc);
    if (chain === undefined) continue;
    const root = chain[chain.length - 1] ?? doc;
    // §3 `role`: required at the root, inherited below it, never changed.
    if (root.role === undefined) {
      issues.push({
        code: "type-invalid",
        where: root.where,
        message: `/role: required on a type with no ancestor (${["concept", "hub", "procedure", "reference"].join(", ")})`,
        details: { pointer: "/role" },
      });
      continue;
    }
    const role = root.role;
    if (doc.role !== undefined && doc.role !== role) {
      issues.push({
        code: "role-conflict",
        where: doc.where,
        message: `/role: "${doc.role}" differs from "${role}", which ${root.name} declares; a role is inherited, never changed`,
        details: { pointer: "/role", inherited: role, declared: doc.role },
      });
      continue;
    }
    const rootDown = [...chain].reverse();
    // §3.1: fragments of the type, then each ancestor root down (its
    // fragments, then its own fields), then the type's own.
    const fieldLayers: Layer[] = [];
    const seenOrigins = new Set<string>();
    const pushLayer = (layer: Layer): void => {
      if (seenOrigins.has(layer.origin)) return;
      seenOrigins.add(layer.origin);
      fieldLayers.push(layer);
    };
    const fragmentLayers = (t: TypeDocument): Layer[] =>
      fragmentsOf(t).map((f) => ({ origin: `fragment:${f.name}`, name: f.name, doc: f }));
    for (const layer of fragmentLayers(doc)) pushLayer(layer);
    for (const ancestor of rootDown.slice(0, -1)) {
      for (const layer of fragmentLayers(ancestor)) pushLayer(layer);
      pushLayer({ origin: `type:${ancestor.name}`, name: ancestor.name, doc: ancestor });
    }
    pushLayer({ origin: `type:${doc.name}`, name: doc.name, doc });
    // §3.2: sections, rules and meta in declaration order down the chain,
    // each type's fragments just before it.
    const declLayers: Layer[] = [];
    const seenDecl = new Set<string>();
    for (const t of rootDown) {
      for (const layer of [
        ...fragmentLayers(t),
        { origin: `type:${t.name}`, name: t.name, doc: t },
      ]) {
        if (seenDecl.has(layer.origin)) continue;
        seenDecl.add(layer.origin);
        declLayers.push(layer);
      }
    }

    const sections = mergeSections(doc, declLayers, vocabularies, issues);
    const rules = mergeRules(doc, rootDown, declLayers, sections, issues);
    const properties = [...RESERVED_KEYS];
    for (const layer of fieldLayers) {
      const declared = layer.doc.fields?.["properties"];
      if (declared === null || typeof declared !== "object" || Array.isArray(declared)) continue;
      for (const key of Object.keys(declared)) if (!properties.includes(key)) properties.push(key);
    }
    // §3 `meta`: a key the effective shape does not declare names nothing.
    const meta: string[] = [];
    for (const layer of declLayers) {
      layer.doc.meta.forEach((key, i) => {
        if (!properties.includes(key)) {
          issues.push({
            code: "meta-unknown",
            where: layer.doc.where,
            message: `/meta/${i}: "${key}" is not a frontmatter key ${doc.name}'s effective shape declares`,
            details: { pointer: `/meta/${i}`, key, type: doc.name },
          });
          return;
        }
        if (!meta.includes(key)) meta.push(key);
      });
    }
    const type: LawType = {
      name: doc.name,
      namespace: doc.namespace,
      where: doc.where,
      role,
      description: doc.description,
      abstract: doc.abstract,
      instances: doc.instances ?? null,
      ancestry: chain.slice(1).map((t) => t.name),
      parts: fieldLayers
        .filter((layer) => layer.doc.fields !== undefined)
        .map((layer) => ({
          origin: layer.origin,
          where: layer.doc.where,
          schema: layer.doc.fields as Record<string, unknown>,
          raw: layer.doc.rawFields as Record<string, unknown>,
        })),
      properties,
      sections,
      rules,
      meta,
      examples: doc.examples,
    };
    if (doc.use_when !== undefined) type.use_when = doc.use_when;
    if (doc.avoid_when !== undefined) type.avoid_when = doc.avoid_when;
    const parent = chain[1];
    if (parent !== undefined) type.extends = parent.name;
    types.set(doc.name, type);
  }
  return { types, fragments, vocabularies, issues };
}

function mergeSections(
  doc: TypeDocument,
  layers: readonly Layer[],
  vocabularies: ReadonlyMap<string, LawVocabulary>,
  issues: LawIssue[],
): LawSections | null {
  const declaring = layers.filter((l) => l.doc.sections !== undefined);
  if (declaring.length === 0) return null;
  let depth: { value: number; by: string } | undefined;
  let ordered = false;
  let additional: "allowed" | "refused" = "allowed";
  const merged = new Map<string, LawSection>();
  const conflict = (layer: Layer, pointer: string, message: string): void => {
    issues.push({
      code: "sections-conflict",
      where: layer.doc.where,
      message: `${pointer}: ${message}`,
      details: { pointer, type: doc.name },
    });
  };
  for (const layer of declaring) {
    const sections = layer.doc.sections;
    if (sections === undefined) continue;
    // An undeclared depth is the default's: a parent's sections sit at 2.
    const declaredDepth = sections.depth ?? DEFAULT_DEPTH;
    if (depth !== undefined && depth.value !== declaredDepth) {
      conflict(
        layer,
        "/sections/depth",
        `depth ${declaredDepth} differs from depth ${depth.value}, which ${depth.by} declares`,
      );
    } else depth ??= { value: declaredDepth, by: layer.name };
    if (sections.ordered === true) ordered = true;
    if (sections.additional === "refused") additional = "refused";
    for (const entry of sections.list) {
      const vocabulary =
        entry.vocabulary === undefined
          ? undefined
          : resolveReference(layer.doc.namespace, entry.vocabulary);
      if (
        entry.vocabulary !== undefined &&
        (vocabulary === undefined || !vocabularies.has(vocabulary))
      ) {
        issues.push({
          code: `${layer.doc.kind}-invalid`,
          where: layer.doc.where,
          message: `${entry.pointer}/vocabulary: "${entry.vocabulary}" is no vocabulary the bundle or its libraries declare`,
          details: { pointer: `${entry.pointer}/vocabulary` },
        });
        continue;
      }
      const prior = merged.get(entry.heading);
      // §4: a parameter belongs to the section's effective grammar.
      const grammar = entry.grammar ?? prior?.grammar;
      const allowed: readonly string[] =
        grammar === undefined
          ? []
          : [...GRAMMAR_PARAMS[grammar], ...(grammar === "entries" ? [] : ["vocabulary"])];
      const written = [
        ...Object.keys(entry.params),
        ...(entry.vocabulary === undefined ? [] : ["vocabulary"]),
      ];
      const strays = written.filter((key) => !allowed.includes(key));
      if (strays.length > 0) {
        issues.push({
          code: "sections-grammar-params",
          where: layer.doc.where,
          message: `${entry.pointer}: section "${entry.heading}" declares ${strays.join(", ")}, which ${
            grammar === undefined
              ? "a prose section does not admit"
              : `the "${grammar}" grammar does not own`
          }`,
          details: { pointer: entry.pointer, keys: strays },
        });
      }
      if (prior === undefined) {
        const fresh: LawSection = {
          heading: entry.heading,
          min: entry.min ?? 0,
          max: entry.max ?? null,
          params: structuredCopy(entry.params),
          declaredBy: [layer.name],
        };
        if (entry.grammar !== undefined) fresh.grammar = entry.grammar;
        if (vocabulary !== undefined) fresh.vocabulary = vocabulary;
        merged.set(entry.heading, fresh);
        continue;
      }
      const at = entry.pointer;
      const by = prior.declaredBy.join(", ");
      if (
        entry.grammar !== undefined &&
        prior.grammar !== undefined &&
        entry.grammar !== prior.grammar
      ) {
        conflict(
          layer,
          `${at}/grammar`,
          `section "${entry.heading}" is "${prior.grammar}" by ${by}; "${entry.grammar}" differs`,
        );
        continue;
      }
      if (
        vocabulary !== undefined &&
        prior.vocabulary !== undefined &&
        vocabulary !== prior.vocabulary
      ) {
        conflict(
          layer,
          `${at}/vocabulary`,
          `section "${entry.heading}" reads ${prior.vocabulary} by ${by}; ${vocabulary} differs`,
        );
        continue;
      }
      let clash = false;
      for (const key of ["provenance", "categories", "history", "lifecycle"] as const) {
        const mine = entry.params[key];
        const theirs = prior.params[key];
        if (mine === undefined || theirs === undefined || same(mine, theirs)) continue;
        conflict(
          layer,
          `${at}/${key}`,
          `section "${entry.heading}" has ${key} ${JSON.stringify(theirs)} by ${by}; ${JSON.stringify(mine)} differs`,
        );
        clash = true;
      }
      if (clash) continue;
      if (entry.grammar !== undefined) prior.grammar = entry.grammar;
      if (vocabulary !== undefined) prior.vocabulary = vocabulary;
      for (const key of ["provenance", "categories", "history", "lifecycle"] as const) {
        const mine = entry.params[key];
        if (mine !== undefined)
          (prior.params as Record<string, unknown>)[key] = structuredCopy(mine);
      }
      // A child may add a `require` row, never remove one.
      for (const row of entry.params.require ?? []) {
        prior.params.require ??= [];
        if (!prior.params.require.some((r) => same(r, row))) prior.params.require.push({ ...row });
      }
      if (entry.min !== undefined) prior.min = Math.max(prior.min, entry.min);
      if (entry.max !== undefined && entry.max !== null) {
        prior.max = prior.max === null ? entry.max : Math.min(prior.max, entry.max);
      }
      prior.declaredBy.push(layer.name);
    }
  }
  const list = [...merged.values()];
  for (const section of list) {
    const reportAt = (message: string): void => {
      issues.push({
        code: "sections-conflict",
        where: doc.where,
        message: `/sections: ${message}`,
        details: { pointer: "/sections", heading: section.heading, type: doc.name },
      });
    };
    if (section.max !== null && section.min > section.max) {
      reportAt(
        `section "${section.heading}" ends with min ${section.min} above max ${section.max}`,
      );
    }
    const vocabulary =
      section.vocabulary === undefined ? undefined : vocabularies.get(section.vocabulary);
    const invalid = (message: string): void => {
      issues.push({
        code: "type-invalid",
        where: doc.where,
        message: `/sections: section "${section.heading}" ${message}`,
        details: { pointer: "/sections", heading: section.heading },
      });
    };
    for (const category of section.params.categories ?? []) {
      if (vocabulary === undefined) invalid(`names categories and reads no vocabulary`);
      else if (!vocabulary.entries.has(category)) {
        invalid(`admits category "${category}", which ${vocabulary.name} does not hold`);
      }
    }
    for (const row of section.params.require ?? []) {
      for (const label of row.labels) {
        if (vocabulary !== undefined && !vocabulary.entries.has(label)) {
          invalid(`requires label "${label}", which ${vocabulary.name} does not hold`);
        }
      }
    }
    const history = section.params.history;
    if (history !== undefined && !merged.has(history)) {
      invalid(
        `lands relations that leave it in "${history}", which this type declares no section for`,
      );
    }
  }
  return { depth: depth?.value ?? DEFAULT_DEPTH, ordered, additional, list };
}

function structuredCopy<T>(value: T): T {
  if (Array.isArray(value)) return value.map(structuredCopy) as T;
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = structuredCopy(v);
    return out as T;
  }
  return value;
}

/**
 * §3.2: a rule is inherited by union with its id; `configure` supplies or
 * extends an inherited rule's config, root down, and a list value must hold
 * every member of the inherited one (`configure-narrows`).
 */
function mergeRules(
  doc: TypeDocument,
  rootDown: readonly TypeDocument[],
  layers: readonly Layer[],
  sections: LawSections | null,
  issues: LawIssue[],
): LawRule[] {
  const rules = new Map<string, LawRule>();
  const headings = new Set(sections?.list.map((s) => s.heading) ?? []);
  const own = (layer: Layer, rule: RuleDeclaration): LawRule => {
    const out: LawRule = {
      id: rule.id,
      expr: rule.expr,
      config: structuredCopy(rule.config),
      severity: rule.severity,
      message: rule.message,
      declaredBy: layer.name,
      where: layer.doc.where,
      pointer: rule.pointer,
    };
    if (rule.section !== undefined) out.section = rule.section;
    return out;
  };
  for (const layer of layers) {
    for (const rule of layer.doc.rules) {
      if (rules.has(rule.id)) continue;
      if (rule.section !== undefined && !headings.has(rule.section)) {
        issues.push({
          code: "rule-section-unknown",
          where: layer.doc.where,
          message: `${rule.pointer}/section: rule "${rule.id}" attaches to "${rule.section}", which ${doc.name}'s sections do not declare`,
          details: { pointer: `${rule.pointer}/section`, rule: rule.id, type: doc.name },
        });
        continue;
      }
      rules.set(rule.id, own(layer, rule));
    }
    // `configure` applies once the type's own rules and everything above are in.
    if (layer.doc.kind !== "type") continue;
    const type = layer.doc;
    if (!rootDown.includes(type)) continue;
    for (const [id, config] of Object.entries(type.configure)) {
      const rule = rules.get(id);
      const inherited = rule !== undefined && rule.declaredBy !== type.name;
      if (rule === undefined || !inherited) {
        issues.push({
          code: "type-invalid",
          where: type.where,
          message: `/configure/${id}: "${id}" is no rule ${type.name} inherits${rule === undefined ? "" : " (it declares it itself; its config is written there)"}`,
          details: { pointer: `/configure/${id}` },
        });
        continue;
      }
      const narrowed = narrowings(rule.config, config, `/configure/${id}`);
      for (const pointer of narrowed) {
        issues.push({
          code: "configure-narrows",
          where: type.where,
          message: `${pointer}: the list drops a member the inherited config of "${id}" holds; configure may only extend a list`,
          details: { pointer, rule: id },
        });
      }
      if (narrowed.length === 0) rule.config = mergeConfig(rule.config, config);
    }
  }
  return [...rules.values()];
}

/** Every list in `next` that drops a member `prior` holds at the same key. */
function narrowings(
  prior: Record<string, unknown>,
  next: Record<string, unknown>,
  pointer: string,
): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(next)) {
    const before = prior[key];
    const at = `${pointer}/${key}`;
    if (Array.isArray(before) && Array.isArray(value)) {
      if (!before.every((member) => value.some((v) => same(v, member)))) out.push(at);
    } else if (Array.isArray(before) && value !== undefined) {
      out.push(at);
    } else if (isRecord(before) && isRecord(value)) {
      out.push(...narrowings(before, value, at));
    }
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function mergeConfig(
  prior: Record<string, unknown>,
  next: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...prior };
  for (const [key, value] of Object.entries(next)) {
    const before = prior[key];
    out[key] =
      isRecord(before) && isRecord(value) ? mergeConfig(before, value) : structuredCopy(value);
  }
  return out;
}
