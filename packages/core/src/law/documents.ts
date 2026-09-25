// v2 contracts §3: the type, fragment and vocabulary documents, one YAML file
// each, read against their key tables. Every key is typed here, an unknown key
// is refused by name (`type-key-unknown`, and its fragment and vocabulary
// twins), and a value of the wrong kind is `<kind>-invalid`. Nothing here
// composes: a document is read on its own, and `compose.ts` puts them
// together.
import type { LawIssue } from "./issues.ts";
import { isName, qualify, splitName } from "./names.ts";
import { utf8Text, withoutBom } from "./text.ts";
import { isMapping, jsonNumbers, readYaml } from "./yaml.ts";

export type Role = "concept" | "hub" | "procedure" | "reference";
export const ROLES: readonly Role[] = ["concept", "hub", "procedure", "reference"];

export type Grammar = "claims" | "relations" | "entries";
export const GRAMMARS: readonly Grammar[] = ["claims", "relations", "entries"];

/** §4: the parameters each grammar admits; any other key on a section entry is `sections-grammar-params`. */
export const GRAMMAR_PARAMS: Readonly<Record<Grammar, readonly string[]>> = {
  claims: ["provenance", "categories"],
  relations: ["require", "history"],
  entries: ["lifecycle"],
};

export interface RequireRow {
  labels: string[];
  min: number;
}

export interface SectionParams {
  provenance?: "required" | "optional" | "none";
  categories?: string[];
  require?: RequireRow[];
  history?: string;
  lifecycle?: "append-only";
}

export interface SectionDeclaration {
  heading: string;
  min?: number;
  max?: number | null;
  grammar?: Grammar;
  /** As written: bare or qualified; resolved by `compose.ts`. */
  vocabulary?: string;
  params: SectionParams;
  pointer: string;
}

export interface SectionsDeclaration {
  depth?: number;
  ordered?: boolean;
  additional?: "allowed" | "refused";
  list: SectionDeclaration[];
}

export interface RuleDeclaration {
  id: string;
  expr: string;
  section?: string;
  /** YAML as read: integers are `bigint`, so CEL sees an `int`. */
  config: Record<string, unknown>;
  severity: "error" | "warning";
  message: string;
  pointer: string;
}

interface Common {
  /** Qualified name. */
  name: string;
  /** `""` for the bundle, else the library id. */
  namespace: string;
  /** `bundle:<path>` or `<library id>:<path>`. */
  where: string;
  description?: string;
  /** The document's JSON Schema, numbers as JSON numbers. */
  fields?: Record<string, unknown>;
  /** The same schema as YAML read it, integers as `bigint`: a default a rule sees is an `int`. */
  rawFields?: Record<string, unknown>;
  sections?: SectionsDeclaration;
  rules: RuleDeclaration[];
  meta: string[];
}

export interface TypeDocument extends Common {
  kind: "type";
  description: string;
  role?: Role;
  use_when?: string;
  avoid_when?: string;
  extends?: string;
  fragments: string[];
  abstract: boolean;
  instances?: { min: number | null; max: number | null };
  configure: Record<string, Record<string, unknown>>;
  examples: string[];
}

export interface FragmentDocument extends Common {
  kind: "fragment";
}

export interface VocabularyDocument {
  kind: "vocabulary";
  name: string;
  namespace: string;
  where: string;
  mode?: "registered" | "census";
  entries: Map<string, { description?: string }>;
  retired: Map<string, { since?: string; successor?: string }>;
  contributes_to?: string;
}

export type LawDocument = TypeDocument | FragmentDocument | VocabularyDocument;

const TYPE_KEYS = [
  "type",
  "role",
  "description",
  "use_when",
  "avoid_when",
  "extends",
  "fragments",
  "abstract",
  "instances",
  "fields",
  "sections",
  "rules",
  "configure",
  "meta",
  "examples",
];
const FRAGMENT_KEYS = ["fragment", "description", "fields", "sections", "rules", "meta"];
const VOCABULARY_KEYS = ["vocabulary", "mode", "entries", "retired", "contributes_to"];
const RULE_KEYS = ["id", "expr", "section", "config", "severity", "message"];
const SECTIONS_KEYS = ["depth", "ordered", "additional", "list"];
const SECTION_KERNEL_KEYS = ["heading", "min", "max", "grammar", "vocabulary"];

class Reader {
  readonly issues: LawIssue[] = [];
  readonly kind: "type" | "fragment" | "vocabulary";
  readonly where: string;
  constructor(kind: "type" | "fragment" | "vocabulary", where: string) {
    this.kind = kind;
    this.where = where;
  }

  invalid(pointer: string, message: string): undefined {
    this.issues.push({
      code: `${this.kind}-invalid`,
      where: this.where,
      message: `${pointer === "" ? "" : `${pointer}: `}${message}`,
      details: { pointer },
    });
    return undefined;
  }

  unknownKeys(value: Record<string, unknown>, allowed: readonly string[], pointer: string): void {
    for (const key of Object.keys(value)) {
      if (allowed.includes(key)) continue;
      this.issues.push({
        code: `${this.kind}-key-unknown`,
        where: this.where,
        message: `${pointer}/${key}: "${key}" is not a key of a ${this.kind} document here (keys: ${allowed.join(", ")})`,
        details: { pointer: `${pointer}/${key}`, key },
      });
    }
  }

  string(value: unknown, pointer: string): string | undefined {
    if (typeof value === "string" && value !== "") return value;
    return this.invalid(pointer, "a non-empty string");
  }

  name(value: unknown, pointer: string, qualified: boolean): string | undefined {
    if (typeof value === "string" && (qualified ? splitName(value) !== undefined : isName(value))) {
      return value;
    }
    return this.invalid(
      pointer,
      `${JSON.stringify(jsonNumbers(value))} is not a name: lower-case letters and digits in hyphen-separated runs${qualified ? ", optionally qualified by a library id (garden/planting)" : ""}`,
    );
  }

  names(value: unknown, pointer: string, qualified: boolean): string[] | undefined {
    if (!Array.isArray(value)) return this.invalid(pointer, "a list of names");
    const out: string[] = [];
    value.forEach((item, i) => {
      const name = this.name(item, `${pointer}/${i}`, qualified);
      if (name !== undefined) out.push(name);
    });
    return out;
  }

  int(value: unknown, pointer: string, nullable: boolean): number | null | undefined {
    if (nullable && value === null) return null;
    if (typeof value === "bigint" && value >= 0n) return Number(value);
    return this.invalid(pointer, `a non-negative integer${nullable ? " or null" : ""}`);
  }

  strings(value: unknown, pointer: string): string[] | undefined {
    if (Array.isArray(value) && value.every((v) => typeof v === "string" && v !== "")) {
      return value as string[];
    }
    return this.invalid(pointer, "a list of non-empty strings");
  }
}

function readSections(r: Reader, value: unknown): SectionsDeclaration | undefined {
  if (!isMapping(value))
    return r.invalid("/sections", "a mapping of depth, ordered, additional, list");
  r.unknownKeys(value, SECTIONS_KEYS, "/sections");
  const out: SectionsDeclaration = { list: [] };
  if (value["depth"] !== undefined) {
    const depth = r.int(value["depth"], "/sections/depth", false);
    if (typeof depth === "number" && (depth < 1 || depth > 6)) {
      r.invalid("/sections/depth", "a heading depth from 1 to 6");
    } else if (typeof depth === "number") out.depth = depth;
  }
  if (value["ordered"] !== undefined) {
    if (typeof value["ordered"] === "boolean") out.ordered = value["ordered"];
    else r.invalid("/sections/ordered", "true or false");
  }
  if (value["additional"] !== undefined) {
    const additional = value["additional"];
    if (additional === "allowed" || additional === "refused") out.additional = additional;
    else r.invalid("/sections/additional", '"allowed" or "refused"');
  }
  const list = value["list"] ?? [];
  if (!Array.isArray(list)) return r.invalid("/sections/list", "a list of section entries");
  list.forEach((entry, i) => {
    const section = readSection(r, entry, `/sections/list/${i}`);
    if (section !== undefined) out.list.push(section);
  });
  return out;
}

function readSection(r: Reader, value: unknown, pointer: string): SectionDeclaration | undefined {
  if (!isMapping(value)) return r.invalid(pointer, "a section entry is a mapping");
  const heading = r.string(value["heading"], `${pointer}/heading`);
  if (heading === undefined) return undefined;
  const out: SectionDeclaration = { heading, params: {}, pointer };
  if (value["min"] !== undefined) {
    const min = r.int(value["min"], `${pointer}/min`, false);
    if (typeof min === "number") out.min = min;
  }
  if (value["max"] !== undefined) {
    const max = r.int(value["max"], `${pointer}/max`, true);
    if (max !== undefined) out.max = max;
  }
  const grammar = value["grammar"];
  if (grammar !== undefined) {
    if (typeof grammar === "string" && (GRAMMARS as readonly string[]).includes(grammar)) {
      out.grammar = grammar as Grammar;
    } else {
      r.invalid(`${pointer}/grammar`, `one of ${GRAMMARS.join(", ")}; absent for prose`);
      return undefined;
    }
  }
  if (value["vocabulary"] !== undefined) {
    const vocabulary = r.name(value["vocabulary"], `${pointer}/vocabulary`, true);
    if (vocabulary !== undefined) out.vocabulary = vocabulary;
  }
  // A parameter no grammar owns is refused here; one another grammar owns is
  // judged against the EFFECTIVE grammar when the chain is composed, so a
  // child may add a parameter to a heading whose grammar an ancestor declared.
  const known = new Set(Object.values(GRAMMAR_PARAMS).flat());
  const strays = Object.keys(value).filter(
    (key) => !SECTION_KERNEL_KEYS.includes(key) && !known.has(key),
  );
  if (strays.length > 0) {
    r.issues.push({
      code: "sections-grammar-params",
      where: r.where,
      message: `${pointer}: section "${heading}" declares ${strays.join(", ")}, which no grammar owns (claims: ${GRAMMAR_PARAMS.claims.join(", ")}; relations: ${GRAMMAR_PARAMS.relations.join(", ")}; entries: ${GRAMMAR_PARAMS.entries.join(", ")})`,
      details: { pointer, keys: strays },
    });
  }
  const admitted = [...known];
  const provenance = value["provenance"];
  if (provenance !== undefined && admitted.includes("provenance")) {
    if (provenance === "required" || provenance === "optional" || provenance === "none") {
      out.params.provenance = provenance;
    } else r.invalid(`${pointer}/provenance`, '"required", "optional" or "none"');
  }
  if (value["categories"] !== undefined && admitted.includes("categories")) {
    const categories = r.names(value["categories"], `${pointer}/categories`, false);
    if (categories !== undefined) out.params.categories = categories;
  }
  if (value["require"] !== undefined && admitted.includes("require")) {
    const rows = value["require"];
    if (!Array.isArray(rows)) r.invalid(`${pointer}/require`, "a list of {labels, min} rows");
    else {
      out.params.require = [];
      for (const [i, row] of rows.entries()) {
        const at = `${pointer}/require/${i}`;
        if (!isMapping(row)) {
          r.invalid(at, "a {labels, min} row");
          continue;
        }
        r.unknownKeys(row, ["labels", "min"], at);
        const labels = r.names(row["labels"], `${at}/labels`, false);
        const min = r.int(row["min"] ?? 1n, `${at}/min`, false);
        if (labels !== undefined && typeof min === "number") {
          out.params.require.push({ labels, min });
        }
      }
    }
  }
  if (value["history"] !== undefined && admitted.includes("history")) {
    const history = r.string(value["history"], `${pointer}/history`);
    if (history !== undefined) out.params.history = history;
  }
  if (value["lifecycle"] !== undefined && admitted.includes("lifecycle")) {
    if (value["lifecycle"] === "append-only") out.params.lifecycle = "append-only";
    else r.invalid(`${pointer}/lifecycle`, '"append-only"');
  }
  return out;
}

function readRules(r: Reader, value: unknown): RuleDeclaration[] {
  if (!Array.isArray(value)) {
    r.invalid("/rules", "a list of rules");
    return [];
  }
  const out: RuleDeclaration[] = [];
  for (const [i, raw] of value.entries()) {
    const pointer = `/rules/${i}`;
    if (!isMapping(raw)) {
      r.invalid(pointer, "a rule is a mapping");
      continue;
    }
    r.unknownKeys(raw, RULE_KEYS, pointer);
    const id = r.name(raw["id"], `${pointer}/id`, false);
    const expr = r.string(raw["expr"], `${pointer}/expr`);
    const message = r.string(raw["message"], `${pointer}/message`);
    const severity = raw["severity"] ?? "error";
    if (severity !== "error" && severity !== "warning") {
      r.invalid(`${pointer}/severity`, '"error" or "warning"');
    }
    const config = raw["config"] ?? {};
    if (!isMapping(config)) r.invalid(`${pointer}/config`, "a mapping");
    let section: string | undefined;
    if (raw["section"] !== undefined) section = r.string(raw["section"], `${pointer}/section`);
    if (id === undefined || expr === undefined || message === undefined) continue;
    if (!isMapping(config) || (severity !== "error" && severity !== "warning")) continue;
    const rule: RuleDeclaration = { id, expr, config, severity, message, pointer };
    if (section !== undefined) rule.section = section;
    out.push(rule);
  }
  return out;
}

function stemOf(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  return base.endsWith(".yaml") ? base.slice(0, -".yaml".length) : base;
}

/** Read one document file. `kind` is its directory; `namespace` its owner (`""` for the bundle). */
export function readDocument(
  kind: "type" | "fragment" | "vocabulary",
  namespace: string,
  where: string,
  path: string,
  bytes: Uint8Array,
): { document?: LawDocument; issues: LawIssue[] } {
  const r = new Reader(kind, where);
  const text = utf8Text(bytes);
  if (text === undefined) {
    r.invalid("", "not UTF-8");
    return { issues: r.issues };
  }
  const read = readYaml(withoutBom(text));
  if (!read.ok) {
    r.invalid(
      "",
      `not YAML: ${read.message}${read.line === undefined ? "" : ` (line ${read.line})`}`,
    );
    return { issues: r.issues };
  }
  const value = read.value;
  if (!isMapping(value)) {
    r.invalid("", "a document is a YAML mapping");
    return { issues: r.issues };
  }
  const stem = stemOf(path);
  const nameKey = kind;
  const declared = value[nameKey];
  if (declared !== stem) {
    r.invalid(
      `/${nameKey}`,
      `"${nameKey}: ${String(jsonNumbers(declared))}" must equal the file's stem, "${stem}"`,
    );
    return { issues: r.issues };
  }
  if (!isName(stem)) {
    r.invalid(
      `/${nameKey}`,
      `"${stem}" is not a name: lower-case letters and digits in hyphen-separated runs`,
    );
    return { issues: r.issues };
  }
  const name = qualify(namespace, stem);
  if (kind === "vocabulary") return readVocabulary(r, value, name, namespace);

  r.unknownKeys(value, kind === "type" ? TYPE_KEYS : FRAGMENT_KEYS, "");
  const common: Omit<Common, "description"> & { description?: string } = {
    name,
    namespace,
    where,
    rules: value["rules"] === undefined ? [] : readRules(r, value["rules"]),
    meta: [],
  };
  if (value["description"] !== undefined) {
    const description = r.string(value["description"], "/description");
    if (description !== undefined) common.description = description;
  }
  if (value["fields"] !== undefined) {
    if (isMapping(value["fields"])) {
      common.fields = jsonNumbers(value["fields"]) as Record<string, unknown>;
      common.rawFields = value["fields"];
    } else r.invalid("/fields", "a JSON Schema object schema, written as a mapping");
  }
  if (value["sections"] !== undefined) {
    const sections = readSections(r, value["sections"]);
    if (sections !== undefined) common.sections = sections;
  }
  if (value["meta"] !== undefined) common.meta = r.strings(value["meta"], "/meta") ?? [];

  if (kind === "fragment") {
    return { document: { kind: "fragment", ...common }, issues: r.issues };
  }
  if (common.description === undefined) {
    if (value["description"] === undefined)
      r.invalid("/description", "required: what the type is for");
    return { issues: r.issues };
  }
  const type: TypeDocument = {
    kind: "type",
    ...common,
    description: common.description,
    fragments: [],
    abstract: false,
    configure: {},
    examples: [],
  };
  const role = value["role"];
  if (role !== undefined) {
    if (typeof role === "string" && (ROLES as readonly string[]).includes(role)) {
      type.role = role as Role;
    } else r.invalid("/role", `one of ${ROLES.join(", ")}`);
  }
  for (const key of ["use_when", "avoid_when"] as const) {
    if (value[key] === undefined) continue;
    const text = r.string(value[key], `/${key}`);
    if (text !== undefined) type[key] = text;
  }
  if (value["extends"] !== undefined) {
    const parent = r.name(value["extends"], "/extends", true);
    if (parent !== undefined) type.extends = parent;
  }
  if (value["fragments"] !== undefined) {
    type.fragments = r.names(value["fragments"], "/fragments", true) ?? [];
  }
  if (value["abstract"] !== undefined) {
    if (typeof value["abstract"] === "boolean") type.abstract = value["abstract"];
    else r.invalid("/abstract", "true or false");
  }
  const instances = value["instances"];
  if (instances !== undefined) {
    if (!isMapping(instances)) r.invalid("/instances", "a {min, max} mapping");
    else {
      r.unknownKeys(instances, ["min", "max"], "/instances");
      const min =
        instances["min"] === undefined ? null : r.int(instances["min"], "/instances/min", true);
      const max =
        instances["max"] === undefined ? null : r.int(instances["max"], "/instances/max", true);
      if (min !== undefined && max !== undefined) {
        if (min !== null && max !== null && max < min) {
          r.invalid("/instances", `max ${max} is below min ${min}`);
        } else type.instances = { min, max };
      }
    }
  }
  const configure = value["configure"];
  if (configure !== undefined) {
    if (!isMapping(configure)) r.invalid("/configure", "a mapping of rule id to config");
    else {
      for (const [id, config] of Object.entries(configure)) {
        if (!isName(id)) r.invalid(`/configure/${id}`, `"${id}" is not a rule id`);
        else if (!isMapping(config)) r.invalid(`/configure/${id}`, "a config mapping");
        else type.configure[id] = config;
      }
    }
  }
  if (value["examples"] !== undefined)
    type.examples = r.strings(value["examples"], "/examples") ?? [];
  return { document: type, issues: r.issues };
}

function readVocabulary(
  r: Reader,
  value: Record<string, unknown>,
  name: string,
  namespace: string,
): { document?: LawDocument; issues: LawIssue[] } {
  r.unknownKeys(value, VOCABULARY_KEYS, "");
  const document: VocabularyDocument = {
    kind: "vocabulary",
    name,
    namespace,
    where: r.where,
    entries: new Map(),
    retired: new Map(),
  };
  const mode = value["mode"];
  if (mode !== undefined) {
    if (mode === "registered" || mode === "census") document.mode = mode;
    else r.invalid("/mode", '"registered" or "census"');
  }
  if (value["contributes_to"] !== undefined) {
    const target = r.name(value["contributes_to"], "/contributes_to", true);
    if (target !== undefined) document.contributes_to = target;
    if (mode !== undefined) {
      r.invalid("/mode", "a contribution takes the mode of the vocabulary it contributes to");
    }
  } else if (mode === undefined) {
    r.invalid("/mode", 'required: "registered" or "census"');
  }
  const entries = value["entries"] ?? {};
  if (!isMapping(entries)) r.invalid("/entries", "a mapping of entry name to {description}");
  else {
    for (const [entry, body] of Object.entries(entries)) {
      const at = `/entries/${entry}`;
      if (!isName(entry)) {
        r.invalid(
          at,
          `"${entry}" is not an entry name: lower-case letters and digits in hyphen-separated runs`,
        );
        continue;
      }
      if (body === null) {
        document.entries.set(entry, {});
        continue;
      }
      if (!isMapping(body)) {
        r.invalid(at, "an entry is a {description} mapping");
        continue;
      }
      r.unknownKeys(body, ["description"], at);
      const out: { description?: string } = {};
      if (body["description"] !== undefined) {
        const description = r.string(body["description"], `${at}/description`);
        if (description !== undefined) out.description = description;
      }
      document.entries.set(entry, out);
    }
  }
  const retired = value["retired"] ?? {};
  if (!isMapping(retired)) r.invalid("/retired", "a mapping of entry name to {since, successor}");
  else {
    for (const [entry, body] of Object.entries(retired)) {
      const at = `/retired/${entry}`;
      if (!isName(entry)) {
        r.invalid(at, `"${entry}" is not an entry name`);
        continue;
      }
      if (!isMapping(body)) {
        r.invalid(at, "a retired entry is a {since, successor} mapping");
        continue;
      }
      r.unknownKeys(body, ["since", "successor"], at);
      const out: { since?: string; successor?: string } = {};
      if (body["since"] !== undefined) {
        const since = r.string(body["since"], `${at}/since`);
        if (since !== undefined) out.since = since;
      }
      if (body["successor"] !== undefined) {
        const successor = r.name(body["successor"], `${at}/successor`, false);
        if (successor !== undefined) out.successor = successor;
      }
      if (document.entries.has(entry)) {
        r.invalid(at, `"${entry}" is both an entry and retired`);
        continue;
      }
      document.retired.set(entry, out);
    }
  }
  return { document, issues: r.issues };
}
