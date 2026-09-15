// docs/constitution.md §config/constitution.json (one document — vocabularies,
// fragments, types; shapes-only fields) · docs/constitution.md §Sections (a strict block)
// docs/extending.md §What a module registers (a module's fragments and types are
// plain constitution data, merged before the parse).
//
// The document as loaded: one zod family, one path per key. The kernel's own
// section keys are typed here and partitioned from the grammar's parameters
// at parse time, so no later pass computes "which keys are parameters" by
// exclusion over a record it shares with the kernel.
import { z } from "zod";
import type { ModuleRegistry } from "../modules/index.ts";
import type { RegistryIssue } from "./model.ts";

const VocabularySchema = z.strictObject({
  mode: z.enum(["registered", "census"]),
  form: z
    .string()
    .min(1)
    .refine(
      (v) => {
        try {
          new RegExp(v, "u");
          return true;
        } catch {
          return false;
        }
      },
      { message: "form is not a valid regular expression" },
    )
    .optional(),
  // docs/constitution.md §Vocabularies: an entry is validated in two halves — the
  // shared four by the kernel, the rest by the registering module — so this
  // schema only says "an object". A strict object here would refuse a kit's
  // entry property before the module that declared it was consulted.
  entries: z.record(z.string().min(1), z.record(z.string().min(1), z.unknown())).optional(),
});

/**
 * docs/extending.md §A check: one `checks` entry, as a bundle writes it. `use`
 * names a REGISTERED check; the config's shape is that check's own schema and is
 * validated after the registry is consulted, so this schema only says "an object".
 */
const CheckAttachmentSchema = z.strictObject({
  use: z.string().min(1),
  config: z.record(z.string().min(1), z.unknown()).optional(),
  severity: z.enum(["warning", "error"]).optional(),
});
const ChecksSchema = z.array(CheckAttachmentSchema).min(1);

/**
 * docs/constitution.md §Sections + docs/extending.md §A grammar: the kernel's own keys are
 * typed here; every other key passes through and lands in `params`, to be
 * validated against the DECLARED GRAMMAR's parameter schema. A strict object
 * listing every parameter would mean a kit's grammar could not declare one.
 */
const SectionEntrySchema = z
  .object({
    heading: z.string().min(1),
    // Min defaults to 0, so `max: 0` (the forbidden form) is legal and
    // `{heading, max: 1}` does not mean "required".
    min: z.number().int().min(0).optional(),
    max: z.number().int().min(0).optional(),
    aliases: z.array(z.string().min(1)).optional(),
    // docs/extending.md §A check: any registered grammar's name, validated
    // against the loaded modules, not by an enum that could never hold a kit's.
    grammar: z.string().min(1).optional(),
    // docs/constitution.md §Sections: the vocabulary the section's items are checked
    // against — a kernel key, because the kernel resolves it against the
    // constitution's vocabularies and a grammar reads it under the same name.
    vocabulary: z.string().min(1).optional(),
    max_chars: z.number().int().min(1).optional(),
    severity: z.enum(["warning", "error"]).optional(),
    checks: ChecksSchema.optional(),
  })
  .catchall(z.unknown())
  .refine((e) => e.max === undefined || e.max >= (e.min ?? 0), {
    message: "max must be ≥ min",
  });

/** docs/extending.md §A grammar: the keys a section entry carries under ANY grammar. */
const KERNEL_SECTION_KEYS: ReadonlySet<string> = new Set([
  "heading",
  "min",
  "max",
  "aliases",
  "grammar",
  "vocabulary",
  "max_chars",
  "severity",
  "checks",
]);

const SectionsSchema = z.strictObject({
  ordered: z.boolean().optional(),
  depth: z.number().int().min(1).max(6).optional(),
  additional: z.boolean().optional(),
  list: z.array(SectionEntrySchema).min(1),
});

/** docs/constitution.md §Types: field name → its shape; `required` lives inside. */
const FieldsSchema = z.record(z.string().min(1), z.unknown());

const FragmentSchema = z.strictObject({
  description: z.string().min(1).optional(),
  fields: FieldsSchema.optional(),
  sections: SectionsSchema.optional(),
  // docs/extending.md §A check: a fragment is a reusable slice of a type, so it
  // carries attachments the same way a type does.
  checks: ChecksSchema.optional(),
});

/** docs/constitution.md §Types: two members, and `append-only` is the only lifecycle. */
const BodySchema = z.strictObject({
  lifecycle: z.literal("append-only"),
  severity: z.enum(["warning", "error"]).optional(),
});

const InstancesSchema = z
  .strictObject({
    min: z.number().int().min(0).optional(),
    max: z.number().int().min(0).optional(),
    severity: z.enum(["warning", "error"]).optional(),
  })
  .refine((v) => v.min === undefined || v.max === undefined || v.max >= v.min, {
    message: "instances.max must be ≥ instances.min",
  });

const TypeSchema = z.strictObject({
  extends: z.string().min(1),
  description: z.string().min(1),
  abstract: z.boolean().optional(),
  instances: InstancesSchema.optional(),
  use_when: z.string().optional(),
  avoid_when: z.string().optional(),
  fragments: z.array(z.string().min(1)).optional(),
  fields: FieldsSchema.optional(),
  sections: SectionsSchema.optional(),
  body: BodySchema.optional(),
  checks: ChecksSchema.optional(),
  template: z.string().min(1).optional(),
  example: z.string().min(1).optional(),
  status: z.enum(["active", "retired"]).optional(),
  replaced_by: z.array(z.string().min(1)).optional(),
});

const ConstitutionSchema = z.strictObject({
  schema: z.literal("wikiwright/constitution"),
  schema_version: z.literal(3),
  vocabularies: z.record(z.string().min(1), VocabularySchema),
  fragments: z.record(z.string().min(1), FragmentSchema).optional(),
  types: z.record(z.string().min(1), TypeSchema),
});

// ---------------------------------------------------------------------------
// the document, typed

export interface CheckAttachment {
  use: string;
  config?: Record<string, unknown>;
  severity?: "warning" | "error";
}

/** One section entry: the kernel's keys, and the grammar's parameters beside them. */
export interface SectionDeclaration {
  heading: string;
  min?: number;
  max?: number;
  aliases?: string[];
  grammar?: string;
  vocabulary?: string;
  max_chars?: number;
  severity?: "warning" | "error";
  checks: CheckAttachment[];
  params: Record<string, unknown>;
}

export interface SectionsDeclaration {
  ordered?: boolean;
  depth?: number;
  additional?: boolean;
  list: SectionDeclaration[];
}

export interface FragmentDeclaration {
  description?: string;
  fields: Record<string, unknown>;
  sections?: SectionsDeclaration;
  checks: CheckAttachment[];
}

export interface TypeDeclaration {
  extends: string;
  description: string;
  abstract?: boolean;
  instances?: { min?: number; max?: number; severity?: "warning" | "error" };
  use_when?: string;
  avoid_when?: string;
  fragments: string[];
  fields: Record<string, unknown>;
  sections?: SectionsDeclaration;
  body?: { lifecycle: "append-only"; severity?: "warning" | "error" };
  checks: CheckAttachment[];
  template?: string;
  example?: string;
  status: "active" | "retired";
  replaced_by?: string[];
}

export interface VocabularyDeclaration {
  mode: "registered" | "census";
  form?: string;
  entries: Record<string, Readonly<Record<string, unknown>>>;
}

export interface Document {
  vocabularies: Record<string, VocabularyDeclaration>;
  fragments: Record<string, FragmentDeclaration>;
  types: Record<string, TypeDeclaration>;
}

export type ParseResult = { ok: true; document: Document } | { ok: false; issues: RegistryIssue[] };

/** Copy the defined members of a record, so `undefined` never lands as a value. */
function defined(value: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));
}

function checkOf(raw: z.infer<typeof CheckAttachmentSchema>): CheckAttachment {
  const out: CheckAttachment = { use: raw.use };
  if (raw.config !== undefined) out.config = raw.config;
  if (raw.severity !== undefined) out.severity = raw.severity;
  return out;
}

function sectionsOf(block: z.infer<typeof SectionsSchema>): SectionsDeclaration {
  const list = block.list.map((entry): SectionDeclaration => {
    const kernel: SectionDeclaration = { heading: entry.heading, checks: [], params: {} };
    if (entry.min !== undefined) kernel.min = entry.min;
    if (entry.max !== undefined) kernel.max = entry.max;
    if (entry.aliases !== undefined) kernel.aliases = entry.aliases;
    if (entry.grammar !== undefined) kernel.grammar = entry.grammar;
    if (entry.vocabulary !== undefined) kernel.vocabulary = entry.vocabulary;
    if (entry.max_chars !== undefined) kernel.max_chars = entry.max_chars;
    if (entry.severity !== undefined) kernel.severity = entry.severity;
    if (entry.checks !== undefined) kernel.checks = entry.checks.map(checkOf);
    // docs/extending.md §A grammar: everything the kernel does not own is the
    // declared grammar's, carried as one record for the combine law and the
    // grammar's own schema. A key with no value was never declared.
    for (const [key, value] of Object.entries(entry)) {
      if (KERNEL_SECTION_KEYS.has(key) || value === undefined) continue;
      kernel.params[key] = value;
    }
    return kernel;
  });
  const out: SectionsDeclaration = { list };
  if (block.ordered !== undefined) out.ordered = block.ordered;
  if (block.depth !== undefined) out.depth = block.depth;
  if (block.additional !== undefined) out.additional = block.additional;
  return out;
}

function documentOf(parsed: z.infer<typeof ConstitutionSchema>): Document {
  const vocabularies: Record<string, VocabularyDeclaration> = {};
  for (const [name, declared] of Object.entries(parsed.vocabularies)) {
    const vocabulary: VocabularyDeclaration = { mode: declared.mode, entries: {} };
    if (declared.form !== undefined) vocabulary.form = declared.form;
    for (const [entry, raw] of Object.entries(declared.entries ?? {})) {
      vocabulary.entries[entry] = defined(raw);
    }
    vocabularies[name] = vocabulary;
  }
  const fragments: Record<string, FragmentDeclaration> = {};
  for (const [name, declared] of Object.entries(parsed.fragments ?? {})) {
    const fragment: FragmentDeclaration = {
      fields: declared.fields ?? {},
      checks: (declared.checks ?? []).map(checkOf),
    };
    if (declared.description !== undefined) fragment.description = declared.description;
    if (declared.sections !== undefined) fragment.sections = sectionsOf(declared.sections);
    fragments[name] = fragment;
  }
  const types: Record<string, TypeDeclaration> = {};
  for (const [name, declared] of Object.entries(parsed.types)) {
    const type: TypeDeclaration = {
      extends: declared.extends,
      description: declared.description,
      fragments: declared.fragments ?? [],
      fields: declared.fields ?? {},
      checks: (declared.checks ?? []).map(checkOf),
      status: declared.status ?? "active",
    };
    if (declared.abstract !== undefined) type.abstract = declared.abstract;
    if (declared.instances !== undefined) {
      const instances: TypeDeclaration["instances"] = {};
      if (declared.instances.min !== undefined) instances.min = declared.instances.min;
      if (declared.instances.max !== undefined) instances.max = declared.instances.max;
      if (declared.instances.severity !== undefined)
        instances.severity = declared.instances.severity;
      type.instances = instances;
    }
    if (declared.use_when !== undefined) type.use_when = declared.use_when;
    if (declared.avoid_when !== undefined) type.avoid_when = declared.avoid_when;
    if (declared.sections !== undefined) type.sections = sectionsOf(declared.sections);
    if (declared.body !== undefined) {
      type.body =
        declared.body.severity === undefined
          ? { lifecycle: "append-only" }
          : { lifecycle: "append-only", severity: declared.body.severity };
    }
    if (declared.template !== undefined) type.template = declared.template;
    if (declared.example !== undefined) type.example = declared.example;
    if (declared.replaced_by !== undefined) type.replaced_by = declared.replaced_by;
    types[name] = type;
  }
  return { vocabularies, fragments, types };
}

// ---------------------------------------------------------------------------
// where: one spelling

/** Top-level maps whose keys name a surface an author edits. */
const ANCHORS: Readonly<Record<string, string>> = {
  types: "type",
  fragments: "fragment",
  vocabularies: "vocabulary",
};

/**
 * The one spelling of a location: the anchor a reader opens the file at, then
 * the path below it. A zod path is mapped by its first two segments; a path
 * that never reaches a named entry stays under `constitution`.
 */
export function whereOf(path: readonly (string | number)[]): string {
  const [head, name, ...rest] = path;
  const anchor = typeof head === "string" ? ANCHORS[head] : undefined;
  if (anchor !== undefined && name !== undefined) {
    return rest.length === 0
      ? `${anchor}:${String(name)}`
      : `${anchor}:${String(name)}/${rest.join("/")}`;
  }
  return path.length === 0 ? "constitution" : `constitution/${path.join("/")}`;
}

/** A JSON pointer into the document, for a declaring entry (`/types/<t>/sections/list/<i>`). */
export function pointerOf(...segments: readonly (string | number)[]): string {
  return `/${segments.join("/")}`;
}

/** The anchored `where` of a JSON pointer a registryPath carries. */
export function whereOfPointer(pointer: string): string {
  return whereOf(pointer.split("/").slice(1));
}

// ---------------------------------------------------------------------------
// the keys a constitution does not carry

/**
 * docs/constitution.md §config/constitution.json: keys a constitution does not carry, and what
 * carries that law instead. A section's grammar and a field's shape ARE the
 * rules; a fragment is what a contract meant; a budget is a section's
 * `max_chars`; a checker is nothing a bundle names.
 */
const UNKNOWN_KEYS: Readonly<Record<string, string>> = {
  rules: "a constitution has no `rules`; a section's grammar and a field's shape carry that law",
  contracts:
    "a constitution has no `contracts`; a fragment is {description, fields, sections, checks}",
  budget: "a constitution has no `budget`; a section's `max_chars` is the one budget",
  checker: "a constitution names no checker; a bundle selects a grammar or a registered check",
  fixability: "a constitution authors no fixability; it is derived from the fixer a pass declares",
};

/**
 * docs/constitution.md §config/constitution.json: *anywhere* is literal. The scan
 * walks the WHOLE document: a `checker` inside a section entry or a `rules`
 * inside a vocabulary is the same mistake as one at the top, and would
 * otherwise fall through to a bare `schema-invalid: Unrecognized key` — or,
 * inside a section entry, pass through as a grammar parameter and be refused
 * one pass later under a less helpful name.
 */
function unknownKeyIssues(json: unknown): RegistryIssue[] {
  const issues: RegistryIssue[] = [];
  const walk = (where: string, path: string, node: unknown): void => {
    if (typeof node !== "object" || node === null) return;
    if (Array.isArray(node)) {
      node.forEach((item, i) => {
        walk(where, `${path}/${i}`, item);
      });
      return;
    }
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      const why = UNKNOWN_KEYS[key];
      if (why !== undefined) {
        issues.push({
          code: "constitution-unknown-key",
          where: path === "" ? where : `${where}/${path}`,
          message: why,
        });
      }
      // The three name maps re-anchor `where`; everything else extends the path.
      const anchor = path === "" && where === "constitution" ? ANCHORS[key] : undefined;
      if (anchor !== undefined && typeof value === "object" && value !== null) {
        for (const [name, entry] of Object.entries(value as Record<string, unknown>)) {
          walk(`${anchor}:${name}`, "", entry);
        }
        continue;
      }
      walk(where, path === "" ? key : `${path}/${key}`, value);
    }
  };
  walk("constitution", "", json);
  return issues;
}

// ---------------------------------------------------------------------------
// module contributions

/**
 * docs/extending.md §What a module registers: merge every loaded module's fragments
 * and types into the bundle's document BEFORE it is scanned and parsed, so a
 * module contributing a `rules` key meets the same refusal a bundle would, and
 * a name collision is a load error rather than a silent overwrite in either
 * direction. Composition is additive and monotone: a bundle may EXTEND a kit's
 * type and may not re-declare one.
 */
export function withModuleContributions(
  json: unknown,
  modules: ModuleRegistry,
): { json: unknown; issues: RegistryIssue[] } {
  if (modules.fragments.size === 0 && modules.types.size === 0) return { json, issues: [] };
  if (json === null || typeof json !== "object" || Array.isArray(json)) return { json, issues: [] };
  const issues: RegistryIssue[] = [];
  const document = { ...(json as Record<string, unknown>) };
  const merge = (key: "fragments" | "types", contributions: ReadonlyMap<string, unknown>): void => {
    if (contributions.size === 0) return;
    const anchor = ANCHORS[key];
    const own = { ...((document[key] ?? {}) as Record<string, unknown>) };
    for (const [name, value] of contributions) {
      if (Object.hasOwn(own, name)) {
        issues.push({
          code: "constitution-module-collision",
          where: `${anchor}:${name}`,
          message: `"${name}" is contributed by module "${modules.owners.get(`${anchor}:${name}`)?.module ?? "?"}"; a bundle may extend a module's declaration, never re-declare it`,
        });
        continue;
      }
      own[name] = value;
    }
    document[key] = own;
  };
  merge("fragments", modules.fragments);
  merge("types", modules.types);
  return { json: document, issues };
}

// ---------------------------------------------------------------------------
// parse

/** Parse the document: the key scan, then the schema. A document that does not parse has nothing to combine. */
export function parseDocument(json: unknown): ParseResult {
  const scanned = unknownKeyIssues(json);
  if (scanned.length > 0) return { ok: false, issues: scanned };
  const parsed = ConstitutionSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => ({
        code: "schema-invalid",
        where: whereOf(i.path.map((segment) => String(segment))),
        message: i.message,
      })),
    };
  }
  return { ok: true, document: documentOf(parsed.data) };
}
