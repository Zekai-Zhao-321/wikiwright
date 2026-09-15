// docs/constitution.md §Types, docs/constitution.md §Sections,
// docs/constitution.md §Fragments (chains
// resolve once at load) · docs/extending.md §A grammar (a grammar
// owns both halves of every parameter's monotone law) · docs/extending.md
//
// The ONE combine function, applied twice per type: once for the set-union of
// the fragments it pastes in (the layer), once for the type's own declaration.
// "Adds or tightens" is stated per key beside the finding it emits; nothing a
// grammar declares selects behaviour below `mergeGrammar`.
import { codeUnitCompare, normalizeIdentity } from "../identity/index.ts";
import {
  armApplies,
  combineParam,
  declaredParams,
  grammarParams,
  type ModuleRegistry,
  safeParseModule,
} from "../modules/index.ts";
import { validateShape } from "../shapes/index.ts";
import {
  type CheckAttachment,
  type Document,
  pointerOf,
  type SectionDeclaration,
  type SectionsDeclaration,
  type TypeDeclaration,
  whereOfPointer,
} from "./document.ts";
import {
  type Attributed,
  checkKey,
  type EffectiveCheck,
  type EffectiveInstances,
  type EffectiveSectionEntry,
  type EffectiveType,
  type RegistryIssue,
} from "./model.ts";

/** Engine archetypes (docs/constitution.md §Types): the four built-in roots and their base fields. */
export const ARCHETYPES: ReadonlyMap<string, { description: string }> = new Map([
  ["concept", { description: "Explains what something is, why it works, or its current model." }],
  ["hub", { description: "Gives a concise overview and curated routes." }],
  ["procedure", { description: "Explains how to perform or verify an action." }],
  ["reference", { description: "Provides lookup-oriented facts, tables, commands, or records." }],
]);

/** docs/constitution.md §Types: the frontmatter every page carries, whatever its type (engine law). */
export const BASE_REQUIRED_FIELDS: readonly string[] = ["description", "tags", "title", "type"];
export const BASE_OPTIONAL_FIELDS: readonly string[] = [
  "aliases",
  // docs/constitution.md / docs/concepts.md §Findings and routing: the per-page waiver list. A base field
  // like every other one, so a bundle cannot forget to declare it and a page
  // cannot smuggle it in under the `x-` mount.
  "exceptions",
  "status",
  "superseded_by",
  "supersedes",
];

function archetypeEffective(name: string): EffectiveType {
  return {
    name,
    status: "active",
    description: ARCHETYPES.get(name)?.description ?? "",
    chain: [name],
    archetype: name,
    fields: new Map([
      ...BASE_REQUIRED_FIELDS.map(
        (f) => [f, { shape: { kind: "any", required: true }, contributedBy: "engine" }] as const,
      ),
      ...BASE_OPTIONAL_FIELDS.map(
        (f) => [f, { shape: { kind: "any" }, contributedBy: "engine" }] as const,
      ),
    ]),
    checks: [],
    fragments: [],
  };
}

// ---------------------------------------------------------------------------
// a declaration: what one combine step adds

/** A declared field with the site that declared it. */
interface DeclaredField {
  shape: unknown;
  contributedBy: string;
  /** The anchored `where` a shape problem is reported at. */
  site: string;
}

/** A declared section entry with the site that declared it. */
interface DeclaredSection extends SectionDeclaration {
  contributedBy: string;
  registryPath: string;
}

interface DeclaredSections {
  ordered?: boolean;
  depth?: number;
  additional?: boolean;
  list: DeclaredSection[];
}

/**
 * One contribution to a type: its own declaration, or the union of the
 * fragments it pastes in. Both go through the one combine function.
 */
interface Declaration {
  /** The anchored `where` a combination issue is reported at: `type:<name>`. */
  where: string;
  /** The type being resolved; `contributedBy` for its own items. */
  name: string;
  /** The type's own step pushes its name onto the chain; the layer does not. */
  extendsChain: boolean;
  fields: Map<string, DeclaredField>;
  sections?: DeclaredSections;
  checks: EffectiveCheck[];
  abstract?: boolean;
  instances?: TypeDeclaration["instances"];
  body?: TypeDeclaration["body"];
  description?: string;
  use_when?: string;
  avoid_when?: string;
  template?: string;
  example?: string;
  status?: "active" | "retired";
  replaced_by?: string[];
}

/**
 * docs/extending.md §A check: the attachments one declaration writes, across all
 * four surfaces — its own `checks`, each field's, and each section entry's.
 */
function attachmentsOf(
  contributedBy: string,
  root: readonly (string | number)[],
  surfaceOfRoot: "type" | "fragment",
  declaration: {
    checks: readonly CheckAttachment[];
    fields: Readonly<Record<string, unknown>>;
    sections?: SectionsDeclaration | undefined;
  },
): EffectiveCheck[] {
  const out: EffectiveCheck[] = [];
  const push = (
    surface: EffectiveCheck["surface"],
    target: string | undefined,
    raw: CheckAttachment,
    registryPath: string,
  ): void => {
    const check: EffectiveCheck = {
      use: raw.use,
      surface,
      config: raw.config ?? {},
      contributedBy,
      registryPath,
    };
    if (target !== undefined) check.target = target;
    if (raw.severity !== undefined) check.severity = raw.severity;
    out.push(check);
  };
  declaration.checks.forEach((raw, i) => {
    push(surfaceOfRoot, undefined, raw, pointerOf(...root, "checks", i));
  });
  for (const [field, shape] of Object.entries(declaration.fields)) {
    if (shape === null || typeof shape !== "object" || Array.isArray(shape)) continue;
    const declared = (shape as Record<string, unknown>)["checks"];
    if (!Array.isArray(declared)) continue;
    (declared as CheckAttachment[]).forEach((raw, i) => {
      push("field", field, raw, pointerOf(...root, "fields", field, "checks", i));
    });
  }
  declaration.sections?.list.forEach((section, i) => {
    section.checks.forEach((raw, j) => {
      push("section", section.heading, raw, pointerOf(...root, "sections", "list", i, "checks", j));
    });
  });
  return out;
}

/** The type's own declaration, every item attributed to the type. */
function typeDeclaration(name: string, entry: TypeDeclaration): Declaration {
  const where = `type:${name}`;
  const fields = new Map<string, DeclaredField>();
  for (const [field, shape] of Object.entries(entry.fields)) {
    fields.set(field, { shape, contributedBy: name, site: where });
  }
  const declaration: Declaration = {
    where,
    name,
    extendsChain: true,
    fields,
    checks: attachmentsOf(name, ["types", name], "type", entry),
    status: entry.status,
    description: entry.description,
  };
  if (entry.sections !== undefined) {
    declaration.sections = {
      ...entry.sections,
      list: entry.sections.list.map((section, i) => ({
        ...section,
        contributedBy: name,
        registryPath: pointerOf("types", name, "sections", "list", i),
      })),
    };
  }
  if (entry.abstract !== undefined) declaration.abstract = entry.abstract;
  if (entry.instances !== undefined) declaration.instances = entry.instances;
  if (entry.body !== undefined) declaration.body = entry.body;
  if (entry.use_when !== undefined) declaration.use_when = entry.use_when;
  if (entry.avoid_when !== undefined) declaration.avoid_when = entry.avoid_when;
  if (entry.template !== undefined) declaration.template = entry.template;
  if (entry.example !== undefined) declaration.example = entry.example;
  if (entry.replaced_by !== undefined) declaration.replaced_by = entry.replaced_by;
  return declaration;
}

/** The tighter of two attachment severities: `error` over `warning` over none. */
function tighterSeverity(
  a: "warning" | "error" | undefined,
  b: "warning" | "error" | undefined,
): "warning" | "error" | undefined {
  if (a === "error" || b === "error") return "error";
  if (a === "warning" || b === "warning") return "warning";
  return undefined;
}

/**
 * docs/constitution.md §Fragments: the SET of a type's fragments, as one layer. A set
 * has no order, so the union is order-independent: a field or a heading two
 * fragments both contribute is `fragment-collision` whichever was listed
 * first, the block flags two fragments both declare must agree, `additional`
 * is the conjunction, a repeated attachment takes the tighter severity, and
 * the layer lists the fragments by name — each fragment's own list in its own
 * order. Every item is attributed to the fragment that declared it, at paste
 * time, so nothing is renamed afterwards.
 *
 * Returns `undefined` where a fragment is not defined: a type pasting nothing
 * that exists has no law to combine.
 */
function fragmentLayer(
  name: string,
  entry: TypeDeclaration,
  document: Document,
  issues: RegistryIssue[],
): Declaration | undefined {
  const where = `type:${name}`;
  let known = true;
  for (const fragment of entry.fragments) {
    if (Object.hasOwn(document.fragments, fragment)) continue;
    issues.push({
      code: "unknown-fragment",
      where,
      message: `fragment "${fragment}" is not defined`,
    });
    known = false;
  }
  if (!known) return undefined;
  const layer: Declaration = {
    where,
    name,
    extendsChain: false,
    fields: new Map(),
    checks: [],
  };
  const fieldOwner = new Map<string, string>();
  const headingOwner = new Map<string, string>();
  const checks = new Map<string, EffectiveCheck>();
  let sections: DeclaredSections | undefined;
  let flags: { ordered?: boolean; depth?: number; from: string } | undefined;
  for (const fragment of [...entry.fragments].sort(codeUnitCompare)) {
    const declared = document.fragments[fragment];
    if (declared === undefined) continue;
    const contributedBy = `fragment:${fragment}`;
    for (const [field, shape] of Object.entries(declared.fields)) {
      const prior = fieldOwner.get(field);
      if (prior !== undefined) {
        issues.push({
          code: "fragment-collision",
          where,
          message: `fragments "${prior}" and "${fragment}" both contribute field "${field}"`,
        });
        continue;
      }
      fieldOwner.set(field, fragment);
      layer.fields.set(field, { shape, contributedBy, site: `fragment:${fragment}` });
    }
    if (declared.sections !== undefined) {
      const block = declared.sections;
      sections ??= { list: [] };
      for (const key of ["ordered", "depth"] as const) {
        const value = block[key];
        if (value === undefined) continue;
        const prior = flags?.[key];
        if (prior !== undefined && prior !== value) {
          issues.push({
            code: "fragment-collision",
            where,
            message: `fragments "${flags?.from ?? "?"}" and "${fragment}" declare sections.${key} as ${String(prior)} and ${String(value)}; a set of fragments agrees on its flags`,
          });
          continue;
        }
        sections[key] = value as never;
        flags = { ...flags, [key]: value, from: flags?.from ?? fragment };
      }
      if (block.additional !== undefined) {
        // The conjunction: one fragment closing the section set closes it.
        sections.additional = (sections.additional ?? true) && block.additional;
      }
      block.list.forEach((section, i) => {
        const identity = normalizeIdentity(section.heading);
        const prior = headingOwner.get(identity);
        if (prior !== undefined) {
          issues.push({
            code: "fragment-collision",
            where,
            message: `fragments "${prior}" and "${fragment}" both contribute section "${section.heading}"`,
          });
          return;
        }
        headingOwner.set(identity, fragment);
        sections?.list.push({
          ...section,
          contributedBy,
          registryPath: pointerOf("fragments", fragment, "sections", "list", i),
        });
      });
    }
    for (const check of attachmentsOf(
      contributedBy,
      ["fragments", fragment],
      "fragment",
      declared,
    )) {
      const key = checkKey(check);
      const prior = checks.get(key);
      if (prior === undefined) {
        checks.set(key, check);
        continue;
      }
      const severity = tighterSeverity(prior.severity, check.severity);
      checks.set(key, severity === undefined ? prior : { ...prior, severity });
    }
  }
  if (sections !== undefined && sections.list.length > 0) layer.sections = sections;
  layer.checks = [...checks.values()];
  return layer;
}

// ---------------------------------------------------------------------------
// the combine law

/**
 * docs/constitution.md §Types (a bundle tightens an inherited shaped field):
 * what a child may do to an inherited field's shape, as the EFFECTIVE shape it
 * yields — or `undefined`, which is `field-schema-redeclared`.
 *
 *  1. SHAPING — the parent is `{kind: "any"}`, "declared, unshaped"; a child
 *     may give it a real shape, and may not drop `required`.
 *  2. PROMOTION — the child is the parent plus `required: true`.
 *  3. TIGHTENING — same kind, every other key equal, and each of these
 *     moved only in the narrowing direction: `values` a subset, `min_items` no
 *     lower, `max_items` and `max_length` no higher, and `pattern` ADDED as a
 *     further pattern — the effective shape carries every pattern on the chain
 *     and a value matches all of them; a child never replaces one.
 *
 * The same law for a bundle over a kit's type and a type over its parent: it
 * is the one combine function that applies it.
 */
const TIGHTENING_KEYS: readonly string[] = [
  "values",
  "min_items",
  "max_items",
  "max_length",
  "pattern",
];

function patternsOf(value: unknown): readonly string[] {
  if (typeof value === "string") return [value];
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function tightenedShape(child: unknown, parent: unknown): unknown {
  if (typeof child !== "object" || child === null || Array.isArray(child)) return undefined;
  if (typeof parent !== "object" || parent === null || Array.isArray(parent)) return undefined;
  const childRecord = child as Record<string, unknown>;
  const parentRecord = parent as Record<string, unknown>;
  const parentRequired = parentRecord["required"] === true;
  // A child that SHAPES an inherited `any` says nothing about the disposition,
  // so the inherited one carries: shaping a field is not a way to un-require it.
  const withRequired = (shape: Record<string, unknown>): Record<string, unknown> =>
    parentRequired ? { ...shape, required: true } : shape;
  const { required: childRequired, ...childRest } = childRecord;
  const { required: _parentRequiredKey, ...parentRest } = parentRecord;
  const canonical = (v: Record<string, unknown>): string =>
    JSON.stringify(Object.entries(v).sort(([a], [b]) => codeUnitCompare(a, b)));
  const same = canonical(childRest) === canonical(parentRest);
  // SHAPING. A child that repeats `{kind: "any"}` has added nothing, so that
  // falls through to the promotion test.
  if (parentRecord["kind"] === "any" && Object.keys(parentRest).length === 1 && !same) {
    return withRequired(childRecord);
  }
  // PROMOTION.
  if (same) return childRequired === true && !parentRequired ? childRecord : undefined;
  // TIGHTENING: every key outside the five must agree, kind included.
  if (childRest["kind"] !== parentRest["kind"]) return undefined;
  const others = [...new Set([...Object.keys(childRest), ...Object.keys(parentRest)])].filter(
    (key) => !TIGHTENING_KEYS.includes(key),
  );
  for (const key of others) {
    if (JSON.stringify(childRest[key]) !== JSON.stringify(parentRest[key])) return undefined;
  }
  const effective: Record<string, unknown> = { ...childRest };
  const narrows = (key: string, ok: (c: unknown, p: unknown) => boolean): boolean => {
    const c = childRest[key];
    const p = parentRest[key];
    if (c === undefined && p === undefined) return true;
    if (c === undefined) return false; // a bound dropped is a widening
    if (p === undefined) return true; // a bound added is a narrowing
    return ok(c, p);
  };
  if (
    !narrows("values", (c, p) => {
      const parentValues = Array.isArray(p) ? (p as unknown[]) : [];
      return Array.isArray(c) && c.every((v) => parentValues.includes(v));
    })
  ) {
    return undefined;
  }
  if (!narrows("min_items", (c, p) => typeof c === "number" && typeof p === "number" && c >= p)) {
    return undefined;
  }
  if (!narrows("max_items", (c, p) => typeof c === "number" && typeof p === "number" && c <= p)) {
    return undefined;
  }
  if (!narrows("max_length", (c, p) => typeof c === "number" && typeof p === "number" && c <= p)) {
    return undefined;
  }
  // `pattern`: the parent's stay, the child's is appended; restating the
  // parent's own is not a further pattern and adds nothing.
  const parentPatterns = patternsOf(parentRest["pattern"]);
  const childPatterns = patternsOf(childRest["pattern"]);
  if (parentPatterns.length > 0 && childPatterns.length === 0) return undefined;
  const added = childPatterns.filter((c) => !parentPatterns.includes(c));
  const patterns = [...parentPatterns, ...added];
  if (patterns.length === 1) effective["pattern"] = patterns[0];
  else if (patterns.length > 1) effective["pattern"] = patterns;
  else delete effective["pattern"];
  return withRequired(childRequired === true ? { ...effective, required: true } : effective);
}

/**
 * docs/extending.md §An arm: does any arm this section's declaration turns
 * on gate by default? The one-way severity ratchet compares against the severity
 * the engine would actually apply, so an ancestor relying on the documented
 * default must read as `error` rather than as `undefined` (docs/constitution.md §Sections).
 */
function gatesByDefault(entry: EffectiveSectionEntry, modules: ModuleRegistry): boolean {
  const grammar = entry.grammar;
  if (grammar === undefined) return false;
  const spec = modules.grammars.get(grammar);
  if (spec === undefined) return false;
  const params = declaredParams(entry);
  return spec.arms.some((arm) => arm.severityDefault === "error" && armApplies(arm, params));
}

/**
 * docs/extending.md §The manifest: attachments compose additively and monotonically.
 * A child may ADD an attachment and may never remove one; where it repeats an
 * inherited attachment exactly, the severity may only tighten.
 */
function composeChecks(
  where: string,
  inherited: readonly EffectiveCheck[],
  own: readonly EffectiveCheck[],
  issues: RegistryIssue[],
): EffectiveCheck[] {
  const merged = new Map<string, EffectiveCheck>();
  for (const check of inherited) merged.set(checkKey(check), check);
  for (const check of own) {
    const key = checkKey(check);
    const prior = merged.get(key);
    if (prior === undefined) {
      merged.set(key, check);
      continue;
    }
    if (prior.severity === "error" && check.severity === "warning") {
      issues.push({
        code: "check-relaxed",
        where,
        message: `check "${check.use}" is declared at error by "${prior.contributedBy}"; a child may tighten it, never quiet it`,
      });
      continue;
    }
    merged.set(key, { ...prior, ...check });
  }
  return [...merged.values()].sort((a, b) => codeUnitCompare(checkKey(a), checkKey(b)));
}

/**
 * Headings and aliases share ONE identity space — an alias that
 * repeats another entry's name can never match either. Judged on each own
 * list and on the effective list, because a child heading may claim
 * an identity the parent claimed as an alias.
 */
function unreachableIssues(
  where: string,
  list: readonly { heading: string; aliases?: readonly string[] | undefined }[],
): RegistryIssue[] {
  const issues: RegistryIssue[] = [];
  const seen = new Set<string>();
  for (const e of list) {
    for (const declared of [e.heading, ...(e.aliases ?? [])]) {
      const identity = normalizeIdentity(declared);
      if (seen.has(identity)) {
        issues.push({
          code: "sections-unreachable",
          where,
          message:
            declared === e.heading
              ? `section "${declared}" is declared twice in one list; the later entry can never match`
              : `section "${e.heading}" aliases "${declared}", which another entry already claims; the alias can never match`,
        });
      }
      seen.add(identity);
    }
  }
  return issues;
}

/** A deep copy of a JSON value, so effective entries never share a mutable row with the document. */
function copyValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(copyValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, copyValue(item)]),
    );
  }
  return value;
}

/** A fresh effective entry from a declaration: the kernel's keys, then the parameters copied. */
function freshEntry(e: DeclaredSection): EffectiveSectionEntry {
  const out: EffectiveSectionEntry = {
    heading: e.heading,
    // No min means optional — declaring a bound is not declaring an
    // obligation (the SE3 defect).
    min: e.min ?? 0,
    params: {},
    contributedBy: e.contributedBy,
    registryPath: e.registryPath,
  };
  if (e.max !== undefined) out.max = e.max;
  if (e.aliases !== undefined) out.aliases = e.aliases;
  if (e.max_chars !== undefined) out.max_chars = e.max_chars;
  if (e.severity !== undefined) out.severity = e.severity;
  if (e.grammar !== undefined) out.grammar = e.grammar;
  if (e.vocabulary !== undefined) out.vocabulary = e.vocabulary;
  // docs/extending.md §A grammar: a first declaration is copied whole, so effective
  // entries never share a mutable row with the document — and a key the
  // grammar does not own rides along so `checkGrammarParameters` can NAME it;
  // the load fails, so no successful entry keeps one.
  for (const [name, value] of Object.entries(e.params)) {
    out.params[name] = copyValue(value);
  }
  return out;
}

export interface CombineContext {
  modules: ModuleRegistry;
  issues: RegistryIssue[];
}

/**
 * The one combine function: `parent` plus one declaration, under the
 * combination table. Applied for the fragment layer and again for the type's
 * own declaration, so a fragment composes before `extends` under the same laws.
 */
export function combine(
  parent: EffectiveType,
  own: Declaration,
  ctx: CombineContext,
): EffectiveType {
  const { modules, issues } = ctx;
  const where = own.where;

  // docs/constitution.md §Types: ONE map. A child may add a field, and may
  // TIGHTEN an inherited one — promote it to `required`, or give an inherited
  // `any` a real shape. Anything else is a redeclaration. Every declared shape
  // is meta-validated at its own declaring site.
  const fields = new Map(parent.fields);
  for (const [field, declared] of own.fields) {
    for (const problem of validateShape(declared.shape, `fields.${field}`)) {
      issues.push({ code: "field-shape-invalid", where: declared.site, message: problem });
    }
    const prior = fields.get(field);
    if (prior === undefined) {
      fields.set(field, { shape: declared.shape, contributedBy: declared.contributedBy });
      continue;
    }
    const tightened = tightenedShape(declared.shape, prior.shape);
    if (tightened !== undefined) {
      fields.set(field, { shape: tightened, contributedBy: declared.contributedBy });
      continue;
    }
    issues.push({
      code: "field-schema-redeclared",
      where,
      message: `field "${field}" already carries a shape from ${prior.contributedBy}${
        declared.contributedBy === own.name ? "" : ` (redeclared by ${declared.contributedBy})`
      }`,
    });
  }

  /**
   * combination law: a child may ADD a grammar to an inherited entry that
   * has none, and may TIGHTEN a parameter both declare. Changing a grammar or
   * relaxing a parameter is a load error.
   */
  const mergeGrammar = (
    inherited: EffectiveSectionEntry,
    e: DeclaredSection,
    out: EffectiveSectionEntry,
  ): boolean => {
    if (
      e.grammar !== undefined &&
      inherited.grammar !== undefined &&
      e.grammar !== inherited.grammar
    ) {
      issues.push({
        code: "sections-grammar-conflict",
        where,
        message: `section "${inherited.heading}" is declared with grammar "${inherited.grammar}" by ${inherited.contributedBy}; a grammar is fixed once on a chain`,
      });
      return false;
    }
    const relaxed = (key: string, detail: string): boolean => {
      issues.push({
        code: "sections-grammar-relaxed",
        where,
        message: `section "${inherited.heading}" may only tighten "${key}": ${detail}`,
      });
      return false;
    };
    const grammar = e.grammar ?? inherited.grammar;
    if (grammar !== undefined) out.grammar = grammar;
    // The vocabulary a section binds is identity-bearing: equal, or declared
    // for the first time. Changing it re-keys every item on every page.
    if (
      e.vocabulary !== undefined &&
      inherited.vocabulary !== undefined &&
      e.vocabulary !== inherited.vocabulary
    ) {
      return relaxed("vocabulary", `"${inherited.vocabulary}" may not become "${e.vocabulary}"`);
    }
    const vocabulary = e.vocabulary ?? inherited.vocabulary;
    if (vocabulary !== undefined) out.vocabulary = vocabulary;

    // A grammar owns both halves of every parameter's monotone law.
    // Introduction and combination meet in this one interpreter; no parameter
    // name below this point selects behaviour. A key the grammar does not own
    // rides along for `checkGrammarParameters` to name.
    const spec = grammar === undefined ? undefined : modules.grammars.get(grammar);
    for (const [name, value] of Object.entries(e.params)) {
      if (spec?.params[name] === undefined) out.params[name] = value;
    }
    for (const [name, param] of Object.entries(spec?.params ?? {})) {
      const combined = combineParam(
        name,
        param,
        inherited.params[name],
        e.params[name],
        inherited.grammar !== undefined,
      );
      if (!combined.ok) return relaxed(name, combined.detail);
      if (combined.value !== undefined) out.params[name] = combined.value;
    }

    // The ratchet knob moves one way: a child may gate a row its ancestor only
    // reported, never quiet a row its ancestor gates. Judged on the inherited
    // entry's EFFECTIVE severity: an ancestor relying on an arm's
    // documented `error` default carries `undefined`, and a comparison against
    // the authored value would accept a child's `warning`.
    const inheritedSeverity =
      inherited.severity ?? (gatesByDefault(inherited, modules) ? "error" : undefined);
    if (e.severity === "warning" && inheritedSeverity === "error") {
      return relaxed("severity", '"error" may not become "warning" — the ratchet is one-way');
    }
    const severity = e.severity ?? inherited.severity;
    if (severity !== undefined) out.severity = severity;

    if (e.max_chars !== undefined && inherited.max_chars !== undefined) {
      if (e.max_chars > inherited.max_chars) {
        return relaxed("max_chars", `${inherited.max_chars} may not be raised to ${e.max_chars}`);
      }
    }
    const maxChars = e.max_chars ?? inherited.max_chars;
    if (maxChars !== undefined) out.max_chars = maxChars;
    return true;
  };

  /**
   * A grammar parameter belongs to exactly one grammar, and an entry with no
   * grammar has no parameters to carry. Judged over the EFFECTIVE entry, so a
   * child may declare a parameter for a grammar its ancestor declared. Reported
   * at the entry the author edits.
   */
  const checkGrammarParameters = (entry: EffectiveSectionEntry): void => {
    const at = whereOfPointer(entry.registryPath);
    const present = Object.keys(entry.params);
    const grammar = entry.grammar;
    // docs/extending.md §A check: a section may declare ANY registered grammar,
    // and a reference to one no loaded module registers fails load. `prose` is
    // the kernel's own and belongs to no module. Checked BEFORE the
    // no-parameters return: a section can declare a grammar and no parameter
    // at all, and that is exactly the typo worth catching.
    if (grammar !== undefined && grammar !== "prose" && !modules.grammars.has(grammar)) {
      issues.push({
        code: "constitution-unknown-extension",
        where: at,
        message: `section "${entry.heading}" declares grammar "${grammar}", which no loaded module registers`,
      });
      return;
    }
    if (present.length === 0) return;
    if (grammar === undefined) {
      issues.push({
        code: "sections-grammar-params",
        where: at,
        message: `section "${entry.heading}" declares grammar parameter(s) ${present.join(", ")} but no grammar`,
      });
      return;
    }
    // docs/extending.md §A grammar: a parameter's `excludes` names the parameters
    // of its grammar that contradict it — docs/concepts.md §Section grammar: a claims
    // section that IS the history section and points at a history section of
    // its own is the one the standard library declares. The kernel counts the
    // pair; the grammar said why.
    const grammarSpec = modules.grammars.get(grammar);
    for (const key of present) {
      for (const excluded of grammarSpec?.params[key]?.excludes ?? []) {
        if (entry.params[excluded] === undefined) continue;
        issues.push({
          code: "sections-params-exclusive",
          where: at,
          message: `section "${entry.heading}" declares ${key} and ${excluded}, which the "${grammar}" grammar does not admit together`,
        });
      }
    }
    const allowed = new Set(grammarParams(modules, grammar));
    const strays = present.filter((key) => !allowed.has(key));
    if (strays.length > 0) {
      issues.push({
        code: "sections-grammar-params",
        where: at,
        message: `section "${entry.heading}" declares ${strays.join(", ")}, which the "${grammar}" grammar does not own`,
      });
    }
    // The VALUE is the grammar's business too — checked against the
    // module's own schema, never a kernel copy, through the guard.
    const spec = modules.grammars.get(grammar);
    for (const key of present) {
      const param = spec?.params[key];
      if (param === undefined) continue;
      const parsed = safeParseModule(param.value, entry.params[key], `parameter "${key}"`);
      if (parsed.success) continue;
      issues.push({
        code: "sections-grammar-params",
        where: at,
        message: `section "${entry.heading}" declares ${key}: ${parsed.issues.map((i) => i.message).join("; ")}`,
      });
    }
  };

  // sections combine: union-append-only (docs/constitution.md §Sections) —
  // flags are set once on the chain (`additional` may tighten true→false),
  // entries append after the inherited list, redeclaring an inherited heading
  // may only tighten it.
  let sections = parent.sections;
  if (own.sections !== undefined) {
    const declared = own.sections;
    issues.push(...unreachableIssues(where, declared.list));
    if (parent.sections === undefined) {
      sections = {
        ordered: declared.ordered ?? false,
        depth: declared.depth ?? 2,
        additional: declared.additional ?? true,
        list: declared.list.map((e) => {
          const out = freshEntry(e);
          checkGrammarParameters(out);
          return out;
        }),
      };
    } else {
      const base = parent.sections;
      let additional = base.additional;
      if (declared.ordered !== undefined && declared.ordered !== base.ordered) {
        issues.push({
          code: "sections-flag-conflict",
          where,
          message: `sections.ordered is ${base.ordered} on an ancestor and may not change`,
        });
      }
      if (declared.depth !== undefined && declared.depth !== base.depth) {
        issues.push({
          code: "sections-flag-conflict",
          where,
          message: `sections.depth is ${base.depth} on an ancestor and may not change`,
        });
      }
      if (declared.additional !== undefined) {
        if (declared.additional && !base.additional) {
          issues.push({
            code: "sections-flag-conflict",
            where,
            message:
              "sections.additional is false on an ancestor; reopening it would relax an inherited constraint",
          });
        } else {
          additional = declared.additional;
        }
      }
      const seenHeadings = new Set(base.list.map((e) => normalizeIdentity(e.heading)));
      const appended = [...base.list];
      for (const e of declared.list) {
        const identity = normalizeIdentity(e.heading);
        if (seenHeadings.has(identity)) {
          // child-may-tighten: a redeclared inherited heading may only
          // raise min or add/lower max; unspecified fields inherit.
          const index = appended.findIndex((x) => normalizeIdentity(x.heading) === identity);
          const inherited = appended[index];
          if (inherited !== undefined) {
            const effMin = e.min ?? inherited.min;
            const effMax = e.max ?? inherited.max;
            // The alias set is union-append-only — a child may add
            // aliases; dropping an inherited one would re-identify the
            // parent's section, which union-append-only forbids.
            const inheritedAliases = inherited.aliases ?? [];
            const ownAliases = e.aliases;
            const dropped =
              ownAliases === undefined
                ? []
                : inheritedAliases.filter(
                    (a) => !ownAliases.some((b) => normalizeIdentity(b) === normalizeIdentity(a)),
                  );
            if (dropped.length > 0) {
              issues.push({
                code: "sections-alias-removed",
                where,
                message: `section "${inherited.heading}" drops inherited alias(es) ${dropped
                  .map((a) => `"${a}"`)
                  .join(", ")}; a child may add aliases, never remove one`,
              });
              continue;
            }
            const mergedAliases = [...inheritedAliases];
            for (const alias of ownAliases ?? []) {
              if (!mergedAliases.some((a) => normalizeIdentity(a) === normalizeIdentity(alias))) {
                mergedAliases.push(alias);
              }
            }
            const tightens =
              effMin >= inherited.min &&
              (inherited.max === undefined
                ? true
                : effMax !== undefined && effMax <= inherited.max) &&
              (effMax === undefined || effMax >= effMin);
            if (tightens) {
              const replaced: EffectiveSectionEntry = {
                heading: inherited.heading,
                min: effMin,
                params: {},
                contributedBy: e.contributedBy,
                registryPath: e.registryPath,
              };
              if (effMax !== undefined) replaced.max = effMax;
              if (mergedAliases.length > 0) replaced.aliases = mergedAliases;
              // The grammar law runs before the occurrence law, so a
              // relaxed grammar is reported as itself, never as "redeclared".
              if (!mergeGrammar(inherited, e, replaced)) continue;
              checkGrammarParameters(replaced);
              appended[index] = replaced;
              continue;
            }
          }
          issues.push({
            code: "sections-redeclared",
            where,
            message: `section "${e.heading}" is already declared by ${inherited?.contributedBy ?? "an ancestor"}; a child may only tighten it (raise min, add or lower max) or append new sections`,
          });
          continue;
        }
        seenHeadings.add(identity);
        const out = freshEntry(e);
        checkGrammarParameters(out);
        appended.push(out);
      }
      // The effective list is where an inherited alias and an
      // appended heading can claim the same identity — first-wins matching
      // would orphan the second silently. Reported once, whichever side.
      const seenMessages = new Set(issues.map((i) => `${i.where}|${i.message}`));
      for (const issue of unreachableIssues(where, appended)) {
        if (!seenMessages.has(`${issue.where}|${issue.message}`)) issues.push(issue);
      }
      sections = { ordered: base.ordered, depth: base.depth, additional, list: appended };
    }
  }

  // docs/constitution.md §Sections v3 rows: `abstract` is one-way — an
  // abstract type's child may be concrete, a concrete type's child may not
  // become abstract.
  // A fragment layer sits between a type and its parent and declares nothing
  // about `abstract`: it passes the parent's disposition through unchanged, so
  // the type's own declaration is judged against its real parent.
  const parentAbstract = parent.abstract === true;
  const ownAbstract = own.abstract === true;
  if (own.extendsChain && ownAbstract && parent.chain.length > 1 && !parentAbstract) {
    issues.push({
      code: "abstract-widened",
      where,
      message: `type "${parent.name}" is instantiable; a child may not become abstract`,
    });
  }

  // docs/constitution.md §Types: the law is inherited and may only tighten — a child
  // may raise `warning` to `error` and may not lower it.
  let body = parent.body;
  if (own.body !== undefined) {
    if (body?.severity === "error" && own.body.severity === "warning") {
      issues.push({
        code: "body-relaxed",
        where,
        message: `body.severity on "${parent.name}" is error; a child may not lower it`,
      });
    } else {
      body = {
        lifecycle: "append-only",
        severity: own.body.severity ?? body?.severity ?? "error",
        contributedBy: own.name,
      };
    }
  }

  let instances = parent.instances;
  if (own.instances !== undefined) {
    const declared = own.instances;
    const inheritedMin = instances?.min;
    const inheritedMax = instances?.max;
    const nextMin = declared.min ?? inheritedMin;
    const nextMax = declared.max ?? inheritedMax;
    const relaxes =
      (inheritedMin !== undefined && (nextMin === undefined || nextMin < inheritedMin)) ||
      (inheritedMax !== undefined && (nextMax === undefined || nextMax > inheritedMax)) ||
      (instances?.severity === "error" && declared.severity === "warning");
    if (relaxes) {
      issues.push({
        code: "instances-relaxed",
        where,
        message: `instances on "${parent.name}" may only tighten: raise min, lower max, ratchet severity`,
      });
    } else {
      const next: EffectiveInstances = {
        severity: declared.severity ?? instances?.severity ?? "warning",
        contributedBy: own.name,
      };
      if (nextMin !== undefined) next.min = nextMin;
      if (nextMax !== undefined) next.max = nextMax;
      instances = next;
    }
  }

  // docs/cli.md §init: nearest template and example win.
  const template =
    own.template !== undefined ? { value: own.template, contributedBy: own.name } : parent.template;
  const example =
    own.example !== undefined ? { value: own.example, contributedBy: own.name } : parent.example;
  // The key order is the order `type show` prints; it is part of the golden.
  return {
    name: own.name,
    status: own.status ?? parent.status,
    description: own.description ?? parent.description,
    chain: own.extendsChain ? [own.name, ...parent.chain] : parent.chain,
    archetype: parent.archetype,
    fields: new Map([...fields].sort(([a], [b]) => codeUnitCompare(a, b))),
    // docs/extending.md §A check: the inherited attachments, plus this
    // declaration's own — union-append, with the ratchet on a repeat.
    checks: composeChecks(where, parent.checks, own.checks, issues),
    ...(sections !== undefined ? { sections } : {}),
    ...(body !== undefined ? { body } : {}),
    ...(own.extendsChain
      ? ownAbstract || parentAbstract
        ? { abstract: ownAbstract }
        : {}
      : parent.abstract !== undefined
        ? { abstract: parent.abstract }
        : {}),
    ...(instances !== undefined ? { instances } : {}),
    ...(own.replaced_by !== undefined ? { replaced_by: own.replaced_by } : {}),
    ...(own.use_when !== undefined ? { use_when: own.use_when } : {}),
    ...(own.avoid_when !== undefined ? { avoid_when: own.avoid_when } : {}),
    ...(template !== undefined ? { template } : {}),
    ...(example !== undefined ? { example } : {}),
    fragments: parent.fragments,
  };
}

// ---------------------------------------------------------------------------
// resolution

/**
 * Every type of the document, resolved once: the chain walk (`extends-cycle`,
 * `unknown-extends`, `extends-retired`, `archetype-name-collision`,
 * `identity-collision`), then two applications of `combine` — the fragment
 * layer, then the type's own declaration. Types that cannot resolve are absent
 * from the map; their issues say why.
 */
export function resolveTypes(
  document: Document,
  modules: ModuleRegistry,
  issues: RegistryIssue[],
): Map<string, EffectiveType> {
  const ctx: CombineContext = { modules, issues };
  const types = document.types;
  const resolved = new Map<string, EffectiveType>();
  for (const name of ARCHETYPES.keys()) resolved.set(name, archetypeEffective(name));

  // docs/constitution.md §Types: type names are unique by identity
  // within their own namespace; archetype names stay reserved in it.
  const owners = new Map<string, string>();
  const refused = new Set<string>();
  for (const name of Object.keys(types)) {
    const identity = normalizeIdentity(name);
    if (ARCHETYPES.has(identity)) {
      issues.push({
        code: "archetype-name-collision",
        where: `type:${name}`,
        message: `type name shadows the built-in archetype "${identity}"`,
      });
      refused.add(name);
      continue;
    }
    const existing = owners.get(identity);
    if (existing !== undefined) {
      issues.push({
        code: "identity-collision",
        where: `type:${name}`,
        message: `identity "${identity}" already claimed by type:${existing}`,
      });
      refused.add(name);
      continue;
    }
    owners.set(identity, name);
  }

  // A fragment's own list is judged once, at the fragment.
  for (const [name, fragment] of Object.entries(document.fragments)) {
    if (fragment.sections !== undefined) {
      issues.push(...unreachableIssues(`fragment:${name}`, fragment.sections.list));
    }
  }

  const resolve = (name: string, stack: string[]): EffectiveType | undefined => {
    const cached = resolved.get(name);
    if (cached !== undefined) return cached;
    const entry = types[name];
    if (entry === undefined || refused.has(name)) return undefined;
    if (stack.includes(name)) {
      issues.push({
        code: "extends-cycle",
        where: `type:${name}`,
        message: `extends cycle: ${[...stack, name].join(" → ")}`,
      });
      return undefined;
    }
    const parentName = entry.extends;
    if (!ARCHETYPES.has(parentName) && !Object.hasOwn(types, parentName)) {
      issues.push({
        code: "unknown-extends",
        where: `type:${name}`,
        message: `extends unknown type "${parentName}"`,
      });
      return undefined;
    }
    if (types[parentName]?.status === "retired") {
      issues.push({
        code: "extends-retired",
        where: `type:${name}`,
        message: `extends retired type "${parentName}"`,
      });
      return undefined;
    }
    const parent = resolve(parentName, [...stack, name]);
    if (parent === undefined) return undefined;
    const raised = issues.length;
    const layer = fragmentLayer(name, entry, document, issues);
    if (entry.fragments.length > 0 && layer === undefined) return undefined;
    const lowered = layer === undefined ? parent : combine(parent, layer, ctx);
    const effective = combine(lowered, typeDeclaration(name, entry), ctx);
    // An issue this type's resolution raised at another anchor — a
    // fragment's row, pasted here — names this type as a site, so the loader
    // can fold the four copies a shared fragment produces into one.
    for (const issue of issues.slice(raised)) {
      if (issue.where === `type:${name}` || issue.where.startsWith(`type:${name}/`)) continue;
      issue.sites = [...(issue.sites ?? []), `type:${name}`];
    }
    // `type show` answers "how do I write this page", so the fragment list is
    // EFFECTIVE like every other line it prints: ancestors first, each
    // attributed to the type that pasted it in.
    const pasted: Attributed<string>[] = entry.fragments.map((value) => ({
      value,
      contributedBy: name,
    }));
    effective.fragments = [...parent.fragments, ...pasted];
    resolved.set(name, effective);
    return effective;
  };
  for (const name of Object.keys(types)) resolve(name, []);
  return resolved;
}
