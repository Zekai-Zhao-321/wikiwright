// v2 contracts §12 step 5: a one-off rewrite of a bundle on the v1 law — a
// `config/constitution.json` (schema version 3) and an engine.json with no
// `schema_version` — into the v2 law and the §4 spellings. Run once over each
// corpus of this repository (devwiki, fixtures/memory-synth, the two
// handbooks, fixtures/minimal-vault); its output is committed, and the tool
// refuses a bundle already on the v2 law, so a second run changes nothing.
//
// What it writes, and from what:
//   config/engine.json         schema version 4 (§2): `label` from the bundle
//                              directory's name in the skill-name grammar,
//                              `modules` → `libraries[].path`,
//                              `commit_prefixes.prefixes` flattened; the keys
//                              v4 drops (exports, plugin, move_reasons,
//                              field_sources.description, extensions'
//                              namespaces and fields) are reported, not kept.
//   constitution/types/*.yaml  one type document per type (§3): a v1 base
//                              (`hub`, `concept`, `procedure`, `reference`) is
//                              the type's `role`; field kinds become JSON Schema
//                              (§3.1); `additional: false` is `refused`; a
//                              section's grammar parameters are mapped to §4's
//                              (a claims section with a `history` heading is
//                              `closed: refused`, a claims section with `role:
//                              history` an entries section, ruling 4); and
//                              `body.lifecycle: append-only` becomes the page
//                              rule `body-append-only`, carried by a fragment
//                              every such type names.
//   constitution/fragments/    one fragment document per fragment.
//   constitution/vocabularies/ one vocabulary document per vocabulary, its
//                              entries' `_` become `-` and a retired entry is
//                              listed under `retired`; an empty vocabulary a
//                              kit contributed into is the library's now and
//                              is not written; the entry properties v2 drops
//                              (`class`, `owned_by`, `requires_link`,
//                              `aliases`) are reported.
//   pages                      every page under the content roots: a pin's
//                              sibling `origin` and `covers` folded into the
//                              one `pin` object (§3.1); under a heading whose
//                              v1 grammar is claims, relations or entries,
//                              each top-level item (`*` and `+` become `-`)
//                              rewritten into the one spelling §4 reads,
//                              where the rewrite keeps every character of
//                              meaning (below).
// and removes config/constitution.json and templates/ (§3.3: the skeleton
// is derived). generated/ is not touched: its one generator is
// `wikiwright check --write`, run after this tool.
//
// The item rewrites, each lossless:
//   relations  a label's `_` becomes `-` (a v2 vocabulary entry is
//              `[a-z0-9]+(-[a-z0-9]+)*`, §3).
//   entries    `- DATE: text` and `- DATE — text` become `- DATE — text`; an
//              approximation mark before the date (`~`, `约`), a range's second
//              date (`→ DATE`) and a parenthetical after the date move to the
//              front of the text, so the entry is dated by its first date and
//              says the rest in words.
//   claims     `【category】` becomes `[category]`; the space after the
//              category is one; a lifecycle clause is respelled as §4's
//              `(retracted DATE)` or `(valid DATE→DATE, superseded DATE)` and
//              moved last.
// An item no rewrite reaches is left as written, and the report lists it: the
// v2 judge reads it as `item-unparsed`, a decision for a person, not for this
// tool. Every other v1 marker (`(stated …)`, `(inferred …)`) is core text
// under §4 and stays where it is.
//
// The code kit: a bundle declaring the module `@wikiwright/kit-code` imports
// the library `libraries/kit-code` instead (§2). The tool reads the v1 kit
// (packages/kit-code/index.js) for the sections and the pin its types carry,
// so it can rewrite a devwiki page; that package leaves in step 6, and with
// it the tool's ability to migrate a bundle over the kit.
//
// Run: `bun tools/migrate-spellings.ts <bundle root> [--dry-run]`. Prints a
// JSON report: the files written and removed, the rewrites by kind, the
// keys and properties dropped, and every item left unparsed.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

// ---------------------------------------------------------------------------
// v1 shapes, as the corpora write them

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonMap = { [key: string]: Json };

interface V1Section {
  heading: string;
  min?: number;
  max?: number;
  grammar?: string;
  vocabulary?: string;
  [param: string]: Json | undefined;
}

interface V1Sections {
  depth?: number;
  ordered?: boolean;
  additional?: boolean;
  list?: V1Section[];
}

interface V1Type {
  extends?: string;
  description?: string;
  use_when?: string;
  avoid_when?: string;
  abstract?: boolean;
  instances?: { min?: number; max?: number; severity?: string };
  fragments?: string[];
  fields?: Record<string, JsonMap>;
  sections?: V1Sections;
  body?: { lifecycle: string; severity?: string };
  template?: string;
  status?: string;
  replaced_by?: string;
}

interface V1Fragment {
  description?: string;
  fields?: Record<string, JsonMap>;
  sections?: V1Sections;
}

interface V1Vocabulary {
  mode: string;
  form?: string;
  entries?: Record<string, JsonMap>;
}

interface V1Constitution {
  schema: string;
  schema_version: number;
  vocabularies?: Record<string, V1Vocabulary>;
  fragments?: Record<string, V1Fragment>;
  types?: Record<string, V1Type>;
}

interface V1Kit {
  id: string;
  entries?: Record<string, Record<string, JsonMap>>;
  fragments?: Record<string, V1Fragment>;
  types?: Record<string, V1Type>;
}

const BASES = new Set(["hub", "concept", "procedure", "reference"]);

/** The one module a corpus of this repository declares, and the library that replaces it. */
const KITS: Readonly<Record<string, { module: string; library: string }>> = {
  "@wikiwright/kit-code": { module: "packages/kit-code/index.js", library: "libraries/kit-code" },
};

const REPO = join(import.meta.dirname, "..");

// ---------------------------------------------------------------------------
// the report

interface Report {
  bundle: string;
  written: string[];
  removed: string[];
  dropped: string[];
  rewrites: Record<string, number>;
  unparsed: { path: string; line: number; heading: string; raw: string }[];
}

function count(report: Report, kind: string): void {
  report.rewrites[kind] = (report.rewrites[kind] ?? 0) + 1;
}

// ---------------------------------------------------------------------------
// a YAML writer for the law documents: block mappings, flow lists of
// scalars, and every string that YAML 1.2's core schema would read as
// anything else double-quoted

const PLAIN = /^[A-Za-z0-9][A-Za-z0-9 _.,/()'`→—–-]*$/u;
const NOT_PLAIN = /^(?:true|false|null|yes|no|on|off|~|[-+]?[0-9][0-9_.eE+-]*)$/iu;

function scalar(value: Json, inFlow = false): string {
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (typeof value === "string") {
    const plain =
      PLAIN.test(value) &&
      !NOT_PLAIN.test(value) &&
      !/: |\s#|\s$/u.test(value) &&
      !(inFlow && value.includes(","));
    if (plain) return value;
    return JSON.stringify(value);
  }
  throw new Error("not a scalar");
}

const isScalar = (value: Json): value is null | boolean | number | string =>
  value === null || typeof value !== "object";

function flow(value: Json): string | undefined {
  if (isScalar(value)) return scalar(value, true);
  if (Array.isArray(value)) {
    const parts = value.map(flow);
    if (parts.some((p) => p === undefined)) return undefined;
    return `[${parts.join(", ")}]`;
  }
  const entries = Object.entries(value);
  if (entries.length === 0) return "{}";
  const parts = entries.map(([k, v]) => {
    const inner = flow(v);
    return inner === undefined ? undefined : `${scalar(k, true)}: ${inner}`;
  });
  if (parts.some((p) => p === undefined)) return undefined;
  return `{ ${parts.join(", ")} }`;
}

/** Keys whose value is always written as a block: a reader scans them line by line. */
const BLOCK_KEYS = new Set([
  "properties",
  "list",
  "entries",
  "retired",
  "rules",
  "sections",
  "fields",
]);

/** Whether a value may sit on one line: a scalar, a list of scalars, or a map of those. */
function shallow(value: Json): boolean {
  if (isScalar(value)) return true;
  const members = Array.isArray(value) ? value : Object.values(value);
  if (Array.isArray(value)) return members.every(isScalar);
  return members.every(
    (m) => isScalar(m) || (Array.isArray(m) ? m.every(isScalar) : Object.keys(m).length === 0),
  );
}

/** A value after `key:`, inline when short and shallow, else on its own lines at `indent`. */
function block(key: string, value: Json, indent: string): string {
  const inline = flow(value);
  const room = 100 - indent.length - key.length;
  if (
    inline !== undefined &&
    inline.length <= room &&
    shallow(value) &&
    !(BLOCK_KEYS.has(key) && !isScalar(value) && inline !== "{}" && inline !== "[]")
  ) {
    return ` ${inline}\n`;
  }
  if (Array.isArray(value)) {
    return `\n${value.map((item) => `${indent}-${item !== null && typeof item === "object" && !Array.isArray(item) ? listMap(item, `${indent}  `) : ` ${flow(item) ?? scalar(String(item))}\n`}`).join("")}`;
  }
  if (value !== null && typeof value === "object") {
    return `\n${Object.entries(value)
      .map(([k, v]) => `${indent}${scalar(k)}:${block(k, v, `${indent}  `)}`)
      .join("")}`;
  }
  return ` ${scalar(value)}\n`;
}

/** A map as a list member: one line when it fits, else its keys under the dash. */
function listMap(value: JsonMap, indent: string): string {
  const inline = flow(value);
  if (inline !== undefined && inline.length <= 100 - indent.length && shallow(value))
    return ` ${inline}\n`;
  const lines = Object.entries(value).map(([k, v]) => `${scalar(k)}:${block(k, v, `${indent}  `)}`);
  return ` ${lines.join(indent)}`;
}

function yamlDocument(doc: JsonMap): string {
  return Object.entries(doc)
    .map(([k, v]) => `${scalar(k)}:${block(k, v, "  ")}`)
    .join("");
}

// ---------------------------------------------------------------------------
// the law

/** A v1 field shape as JSON Schema (§3.1), with whether it was required. */
function fieldSchema(
  shape: JsonMap,
  where: string,
  report: Report,
): { schema: JsonMap; required: boolean } {
  const required = shape["required"] === true;
  const kind = shape["kind"];
  const out: JsonMap = {};
  switch (kind) {
    case "any":
      break;
    case "string":
      out["type"] = "string";
      if (typeof shape["min_length"] === "number") out["minLength"] = shape["min_length"];
      if (typeof shape["max_length"] === "number") out["maxLength"] = shape["max_length"];
      if (typeof shape["pattern"] === "string") out["pattern"] = shape["pattern"];
      break;
    case "dated-string":
      out["type"] = "string";
      out["pattern"] = "^\\d{4}-\\d{2}-\\d{2}";
      break;
    case "integer":
    case "number":
      out["type"] = kind;
      if (typeof shape["min"] === "number") out["minimum"] = shape["min"];
      if (typeof shape["max"] === "number") out["maximum"] = shape["max"];
      break;
    case "boolean":
      out["type"] = "boolean";
      break;
    case "enum":
      out["enum"] = shape["values"] as Json[];
      break;
    case "date":
      out["type"] = "string";
      out["format"] = "date";
      if (shape["auto"] !== undefined)
        report.dropped.push(`${where}.auto (write stamps created and updated, ruling 7)`);
      break;
    case "datetime":
      out["type"] = "string";
      out["format"] = "date-time";
      break;
    case "list": {
      out["type"] = "array";
      const item = shape["item"];
      if (item !== null && typeof item === "object" && !Array.isArray(item)) {
        out["items"] = fieldSchema(item, `${where}.item`, report).schema;
      }
      if (typeof shape["min_items"] === "number") out["minItems"] = shape["min_items"];
      if (typeof shape["max_items"] === "number") out["maxItems"] = shape["max_items"];
      break;
    }
    case "page-ref":
    case "page-ref-list":
      out["$ref"] = `#/$defs/${kind}`;
      if (typeof shape["target_type"] === "string") out["target_type"] = shape["target_type"];
      if (typeof shape["target_root"] === "string") out["target_root"] = shape["target_root"];
      break;
    case "pin":
      out["$ref"] = "#/$defs/pin";
      break;
    default:
      throw new Error(`${where}: the field kind ${JSON.stringify(kind)} has no mapping here`);
  }
  if (shape["checks"] !== undefined) report.dropped.push(`${where}.checks`);
  return { schema: out, required };
}

/** The names of a type's pin siblings (`origin`, `covers`), from the v1 pin kind. */
type PinSiblings = Map<string, { origin: string; covers: string }>;

function pinSiblingsOf(fields: Record<string, JsonMap> | undefined, into: PinSiblings): void {
  for (const [name, shape] of Object.entries(fields ?? {})) {
    if (shape["kind"] !== "pin") continue;
    into.set(name, { origin: String(shape["origin"]), covers: String(shape["covers"]) });
  }
}

/** A v1 `fields` map as a JSON Schema object schema; pin siblings fold into their pin. */
function fieldsSchema(
  fields: Record<string, JsonMap> | undefined,
  where: string,
  pins: PinSiblings,
  report: Report,
): JsonMap | undefined {
  if (fields === undefined || Object.keys(fields).length === 0) return undefined;
  const properties: JsonMap = {};
  const required: string[] = [];
  const siblingOf = new Map<string, { pin: string; part: "origin" | "covers" }>();
  for (const [pin, s] of pins) {
    siblingOf.set(s.origin, { pin, part: "origin" });
    siblingOf.set(s.covers, { pin, part: "covers" });
  }
  for (const [name, shape] of Object.entries(fields)) {
    const at = `${where}.fields.${name}`;
    const sibling = siblingOf.get(name);
    const { schema, required: isRequired } = fieldSchema(shape, at, report);
    if (sibling !== undefined) {
      // §3.1: `origin` and `covers` live inside the pin object now; a
      // tightening of either is a tightening of the pin's own property.
      const pin = (properties[sibling.pin] ?? { type: "object", properties: {} }) as JsonMap;
      (pin["properties"] as JsonMap)[sibling.part] = schema;
      properties[sibling.pin] = pin;
      if (Object.keys(schema).length > 0) count(report, `field-into-pin:${name}`);
      continue;
    }
    if (shape["kind"] === "any" && RESERVED.has(name)) {
      // A reserved key the engine already declares (§3.1).
      count(report, "field-reserved-any");
      continue;
    }
    properties[name] = schema;
    if (isRequired) required.push(name);
  }
  if (Object.keys(properties).length === 0) return undefined;
  const out: JsonMap = { type: "object", properties };
  if (required.length > 0) out["required"] = required;
  return out;
}

/** §3.1: the reserved frontmatter keys every effective shape already declares. */
const RESERVED = new Set([
  "type",
  "title",
  "description",
  "tags",
  "aliases",
  "status",
  "supersedes",
  "superseded_by",
  "exceptions",
  "created",
  "updated",
]);

const hyphen = (label: string): string => label.replaceAll("_", "-");

/** A v1 section entry as §3's, its grammar parameters mapped to §4's. */
function sectionEntry(entry: V1Section, where: string, report: Report): JsonMap {
  const out: JsonMap = { heading: entry.heading };
  if (entry.min !== undefined && entry.min !== 0) out["min"] = entry.min;
  if (entry.max !== undefined) out["max"] = entry.max;
  let grammar = entry.grammar;
  const at = `${where}.sections["${entry.heading}"]`;
  for (const key of ["aliases", "max_chars", "severity", "checks"]) {
    if (entry[key] !== undefined) report.dropped.push(`${at}.${key}`);
  }
  if (grammar === "claims" && entry["role"] === "history") {
    // Ruling 4: a History section is an entries section, or a claims section
    // with `closed: required`. A v1 History admitted claims and dated entries
    // both; the corpora write dated lines there.
    grammar = "entries";
    count(report, "section-history-to-entries");
    report.dropped.push(`${at}.role (a History section is an entries section, ruling 4)`);
    if (entry.vocabulary !== undefined)
      report.dropped.push(`${at}.vocabulary (an entries section reads none)`);
  }
  if (grammar !== undefined) out["grammar"] = grammar;
  if (grammar === "claims") {
    const vocabulary =
      entry.vocabulary ?? (entry["categories"] === "claim-classes" ? "categories" : undefined);
    if (vocabulary !== undefined) out["vocabulary"] = vocabulary;
    const provenance = entry["provenance"];
    if (provenance === "required" || provenance === "optional") out["provenance"] = provenance;
    if (Array.isArray(entry["only"])) out["categories"] = entry["only"];
    if (entry["history"] !== undefined) {
      // A closed claim moved to the History heading; where it may stand is
      // now `closed` (ruling 4): not here.
      out["closed"] = "refused";
      count(report, "section-history-to-closed-refused");
    }
    for (const key of ["forms", "sources", "items", "inferred_ref"]) {
      if (entry[key] !== undefined) report.dropped.push(`${at}.${key}`);
    }
  } else if (grammar === "relations") {
    if (entry.vocabulary !== undefined) out["vocabulary"] = entry.vocabulary;
    if (Array.isArray(entry["require"])) {
      out["require"] = (entry["require"] as JsonMap[]).map((row) => ({
        labels: (row["labels"] as string[]).map(hyphen),
        min: (row["min"] as number) ?? 1,
      }));
    }
    if (typeof entry["history"] === "string") out["history"] = entry["history"];
  } else if (grammar === "entries") {
    if (entry["lifecycle"] === "append-only") out["lifecycle"] = "append-only";
    if (entry["date"] !== undefined)
      report.dropped.push(`${at}.date (an entry is dated or does not parse)`);
  }
  return out;
}

function sectionsDocument(sections: V1Sections, where: string, report: Report): JsonMap {
  const out: JsonMap = {};
  if (sections.depth !== undefined && sections.depth !== 2) out["depth"] = sections.depth;
  if (sections.ordered === true) out["ordered"] = true;
  if (sections.additional === false) out["additional"] = "refused";
  out["list"] = (sections.list ?? []).map((entry) => sectionEntry(entry, where, report));
  return out;
}

/** §6: the page-wide append-only law of v1 (`body.lifecycle`), as a transition rule. */
const BODY_APPEND_ONLY: JsonMap = {
  id: "body-append-only",
  expr: '!before.present || (page.body.trim() + "\\n").startsWith(before.page.body.trim() + "\\n")',
  severity: "error",
  message:
    "This page is append-only: its body before this change is a prefix of its body after it; record a correction as a new dated line.",
};
const APPEND_ONLY_FRAGMENT = "append-only";

// ---------------------------------------------------------------------------
// v1 effective sections, for rewriting pages

interface Grammatical {
  grammar: "claims" | "relations" | "entries";
  depth: number;
}

/** Every heading a type's pages carry under a grammar, with the depth it sits at. */
function grammarsOf(
  typeName: string,
  types: Map<string, V1Type>,
  fragments: Map<string, V1Fragment>,
): Map<string, Grammatical> {
  const chain: V1Type[] = [];
  let at = types.get(typeName);
  const seen = new Set<string>();
  while (at !== undefined) {
    chain.unshift(at);
    const parent = at.extends;
    if (parent === undefined || BASES.has(parent) || seen.has(parent)) break;
    seen.add(parent);
    at = types.get(parent);
  }
  const out = new Map<string, Grammatical>();
  const take = (sections: V1Sections | undefined): void => {
    for (const entry of sections?.list ?? []) {
      let grammar = entry.grammar;
      if (grammar === "claims" && entry["role"] === "history") grammar = "entries";
      if (grammar === "claims" || grammar === "relations" || grammar === "entries") {
        out.set(entry.heading, { grammar, depth: sections?.depth ?? 2 });
      }
    }
  };
  for (const type of chain) {
    for (const f of type.fragments ?? []) take(fragments.get(f)?.sections);
    take(type.sections);
  }
  return out;
}

function pinsOf(
  typeName: string,
  types: Map<string, V1Type>,
  fragments: Map<string, V1Fragment>,
): PinSiblings {
  const out: PinSiblings = new Map();
  let at = types.get(typeName);
  const seen = new Set<string>();
  while (at !== undefined) {
    pinSiblingsOf(at.fields, out);
    for (const f of at.fragments ?? []) pinSiblingsOf(fragments.get(f)?.fields, out);
    const parent = at.extends;
    if (parent === undefined || BASES.has(parent) || seen.has(parent)) break;
    seen.add(parent);
    at = types.get(parent);
  }
  return out;
}

// ---------------------------------------------------------------------------
// items

const DAY = String.raw`\d{4}-\d{2}-\d{2}`;
const PART = String.raw`\d{4}(?:-\d{2}(?:-\d{2})?)?`;

/**
 * An entry line: `- [~|约]DATE[ → [~]DATE][ (qualifier)](: | — |—)text`. The
 * canonical line is `- DATE — ` then whatever stood between the date and
 * the separator, then the text.
 */
const ENTRY_DIALECT = new RegExp(
  `^- (~|约)?(${PART})((?:\\s*(?:→|->)\\s*~?(?:${PART}))?)((?:\\s*\\([^()]*\\))?)(?:\\s*:\\s+|\\s+—\\s+|\\s*—\\s*)(\\S.*)$`,
  "u",
);

export function rewriteEntry(line: string): string | undefined {
  const m = ENTRY_DIALECT.exec(line);
  if (m === null) return undefined;
  const [, approx, date, range, qualifier, text] = m;
  const front = [
    approx === undefined ? "" : `${approx} `,
    range === undefined || range === "" ? "" : `${range.trim().replace("->", "→")} `,
    qualifier === undefined || qualifier === "" ? "" : `${qualifier.trim()} `,
  ].join("");
  return `- ${date} — ${front}${text}`;
}

const CLAIM_DIALECT = /^- (?:\[([^[\]\n]+)\]|【([^【】\n]+)】)\s*(\S.*)$/u;
const RETRACTED_ANY = new RegExp(`^retracted\\s+(${DAY})$`, "iu");
const VALID_ANY = new RegExp(
  `^valid\\s*(${DAY})?\\s*(?:→|->)\\s*(${DAY})\\s*,?\\s+superseded\\s+(${DAY})(?:\\s+by\\s+(#[0-9a-f]{8}))?$`,
  "iu",
);

/** The trailing balanced parenthetical of `text`, if it ends in one preceded by a space. */
function trailing(text: string): { body: string; before: string } | undefined {
  if (!text.endsWith(")")) return undefined;
  let depth = 0;
  for (let i = text.length - 1; i >= 0; i -= 1) {
    const ch = text[i];
    if (ch === ")") depth += 1;
    else if (ch === "(") {
      depth -= 1;
      if (depth === 0) {
        if (i === 0 || text[i - 1] !== " ") return undefined;
        return { body: text.slice(i + 1, -1), before: text.slice(0, i - 1) };
      }
    }
  }
  return undefined;
}

function lifecycleClause(body: string): string | undefined {
  const r = RETRACTED_ANY.exec(body.trim());
  if (r !== null) return `retracted ${r[1]}`;
  const v = VALID_ANY.exec(body.trim());
  if (v !== null) {
    return `valid ${v[1] ?? ""}→${v[2]}, superseded ${v[3]}${v[4] === undefined ? "" : ` by ${v[4]}`}`;
  }
  return undefined;
}

export function rewriteClaim(line: string): string | undefined {
  const m = CLAIM_DIALECT.exec(line);
  if (m === null) return undefined;
  const category = (m[1] ?? m[2] ?? "").trim();
  let rest = (m[3] ?? "").trimEnd();
  // A lifecycle clause among the trailing parentheticals moves last, respelled.
  const peeled: string[] = [];
  let clause: string | undefined;
  for (let i = 0; i < 3; i += 1) {
    const t = trailing(rest);
    if (t === undefined) break;
    const life = lifecycleClause(t.body);
    if (life !== undefined && clause === undefined) {
      clause = life;
      rest = t.before.trimEnd();
      continue;
    }
    peeled.unshift(`(${t.body})`);
    rest = t.before.trimEnd();
  }
  const tail = [...peeled, ...(clause === undefined ? [] : [`(${clause})`])].join(" ");
  return `- [${category}] ${rest}${tail === "" ? "" : ` ${tail}`}`;
}

const RELATION_DIALECT = /^- ([^\s[\]]+) (\[\[.*)$/u;

export function rewriteRelation(line: string): string | undefined {
  const m = RELATION_DIALECT.exec(line);
  if (m === null) return undefined;
  return `- ${hyphen(m[1] ?? "")} ${m[2]}`;
}

// ---------------------------------------------------------------------------
// pages

const HEADING = /^(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/u;
const FENCE = /^[ \t]{0,3}(`{3,}|~{3,})/u;

/** The same checks the v2 parser applies, so the report names what it will refuse. */
const CLAIM = /^- \[([^[\]\s][^[\]]*)\] (\S.*)$/u;
const RELATION = /^- ([^\s[\]]+) \[\[([^[\]|#]+)(?:#([^[\]|]+))?(?:\|([^[\]]+))?\]\]$/u;
const ENTRY = /^- (\d{4})(?:-(\d{2})(?:-(\d{2}))?)? — (\S.*)$/u;

function rewriteBody(
  lines: string[],
  from: number,
  grammars: Map<string, Grammatical>,
  path: string,
  report: Report,
): void {
  let fence: string | undefined;
  let current: Grammatical | undefined;
  let atDepth = false;
  let heading = "";
  for (let i = from; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const f = FENCE.exec(line);
    if (f !== null) {
      const marker = f[1] ?? "";
      if (fence === undefined) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = undefined;
      continue;
    }
    if (fence !== undefined) continue;
    const h = HEADING.exec(line);
    if (h !== null) {
      // A heading at a depth its type does not declare is no occurrence of
      // the section (§4, the judge's section-depth); its items are respelled
      // all the same, so the repair is the heading alone.
      heading = h[2] ?? "";
      current = grammars.get(heading);
      atDepth = current?.depth === (h[1] ?? "").length;
      continue;
    }
    if (current === undefined || !/^[-*+] /u.test(line)) continue;
    let text = line.replace(/^[*+] /u, "- ");
    if (text !== line) count(report, "item-marker");
    const canonical =
      current.grammar === "claims" ? CLAIM : current.grammar === "relations" ? RELATION : ENTRY;
    const rewrite =
      current.grammar === "claims"
        ? rewriteClaim
        : current.grammar === "relations"
          ? rewriteRelation
          : rewriteEntry;
    const rewritten = rewrite(text);
    if (rewritten !== undefined && rewritten !== text) {
      count(report, `${current.grammar}-respelled`);
      text = rewritten;
    }
    lines[i] = text;
    if (atDepth && !canonical.test(text)) {
      report.unparsed.push({ path, line: i + 1, heading, raw: text });
    }
  }
}

/** Fold `origin:` and `covers:` lines into the pin they belong to, as one block. */
function foldPins(lines: string[], end: number, pins: PinSiblings, report: Report): number {
  for (const [pin, siblings] of pins) {
    const find = (key: string) =>
      lines.findIndex((l, i) => i > 0 && i < end && l.startsWith(`${key}:`));
    const at = find(pin);
    if (at === -1) continue;
    const value = (lines[at] ?? "").slice(pin.length + 1).trim();
    if (value === "" || value.startsWith("{")) continue;
    const originAt = find(siblings.origin);
    const coversAt = find(siblings.covers);
    const origin =
      originAt === -1 ? "" : (lines[originAt] ?? "").slice(siblings.origin.length + 1).trim();
    const covers =
      coversAt === -1 ? "[]" : (lines[coversAt] ?? "").slice(siblings.covers.length + 1).trim();
    lines[at] = [
      `${pin}:`,
      `  commit: ${value}`,
      `  origin: ${origin}`,
      `  covers: ${covers}`,
    ].join("\n");
    for (const i of [originAt, coversAt].filter((n) => n !== -1).sort((a, b) => b - a)) {
      lines.splice(i, 1);
      end -= 1;
    }
    count(report, "pin-folded");
  }
  return end;
}

function rewritePage(
  path: string,
  text: string,
  types: Map<string, V1Type>,
  fragments: Map<string, V1Fragment>,
  report: Report,
): string {
  const lines = text.split("\n");
  if (lines[0] !== "---") return text;
  let end = lines.indexOf("---", 1);
  if (end === -1) return text;
  const typeLine = lines.slice(1, end).find((l) => l.startsWith("type:"));
  const typeName = typeLine
    ?.slice("type:".length)
    .trim()
    .replace(/^["']|["']$/gu, "");
  if (typeName === undefined) return text;
  end = foldPins(lines, end, pinsOf(typeName, types, fragments), report);
  rewriteBody(lines, end + 1, grammarsOf(typeName, types, fragments), path, report);
  return lines.join("\n");
}

function walkPages(root: string, dir: string, out: string[]): void {
  const abs = join(root, dir);
  if (!existsSync(abs)) return;
  for (const entry of readdirSync(abs, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : 1,
  )) {
    const rel = dir === "" ? entry.name : `${dir}/${entry.name}`;
    if (entry.isDirectory()) walkPages(root, rel, out);
    else if (entry.isFile() && entry.name.endsWith(".md")) out.push(rel);
  }
}

// ---------------------------------------------------------------------------
// the run

/**
 * §2 `label`: the bundle directory's name in the skill-name grammar — lower
 * case, every run of other characters one hyphen. The v1 label was the
 * basename itself.
 */
function labelOf(name: string): string {
  const label = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  if (label === "")
    throw new Error(`"${name}" gives no label: name the bundle directory in letters or digits`);
  return label;
}

async function loadKit(module: string): Promise<V1Kit> {
  const imported = (await import(pathToFileURL(join(REPO, module)).href)) as { default: V1Kit };
  return imported.default;
}

export async function migrate(root: string, dryRun: boolean): Promise<Report> {
  const report: Report = {
    bundle: relative(REPO, root).split(sep).join("/") || ".",
    written: [],
    removed: [],
    dropped: [],
    rewrites: {},
    unparsed: [],
  };
  const read = (rel: string): string => readFileSync(join(root, rel), "utf8");
  const engine = JSON.parse(read("config/engine.json")) as JsonMap;
  if (engine["schema_version"] !== undefined) {
    throw new Error(
      `${root}: config/engine.json already declares schema_version ${String(engine["schema_version"])}; the bundle is migrated`,
    );
  }
  const constitution = JSON.parse(read("config/constitution.json")) as V1Constitution;
  if (constitution.schema_version !== 3) throw new Error(`${root}: not a v3 constitution`);

  // Modules → libraries, and the kit's declarations for the page rewrite.
  const types = new Map<string, V1Type>(Object.entries(constitution.types ?? {}));
  const fragments = new Map<string, V1Fragment>(Object.entries(constitution.fragments ?? {}));
  const libraries: JsonMap[] = [];
  const kitVocabularies = new Set<string>();
  const kitIds: string[] = [];
  for (const declared of (engine["modules"] as JsonMap[] | undefined) ?? []) {
    const name = String(declared["package"] ?? declared["path"]);
    const kit = KITS[name];
    if (kit === undefined)
      throw new Error(`${root}: the module ${name} has no library to migrate to`);
    libraries.push({ path: kit.library });
    const loaded = await loadKit(kit.module);
    kitIds.push(loaded.id);
    for (const [n, t] of Object.entries(loaded.types ?? {})) types.set(n, t);
    for (const [n, f] of Object.entries(loaded.fragments ?? {})) fragments.set(n, f);
    for (const vocabulary of Object.keys(loaded.entries ?? {})) kitVocabularies.add(vocabulary);
  }

  // config/engine.json, schema version 4.
  const v4: JsonMap = {
    schema: "wikiwright/engine",
    schema_version: 4,
    label: labelOf(basename(root)),
    content_roots: engine["content_roots"] as Json,
  };
  if (engine["source_roots"] !== undefined) v4["source_roots"] = engine["source_roots"];
  if (libraries.length > 0) v4["libraries"] = libraries;
  const prefixes = (engine["commit_prefixes"] as JsonMap | undefined)?.["prefixes"];
  if (Array.isArray(prefixes)) v4["commit_prefixes"] = prefixes;
  const sources = engine["field_sources"] as JsonMap | undefined;
  if (sources?.["title"] !== undefined) v4["field_sources"] = { title: sources["title"] };
  if (sources?.["description"] !== undefined)
    report.dropped.push("engine.field_sources.description");
  if (engine["folder_tags"] !== undefined) v4["folder_tags"] = engine["folder_tags"];
  if (engine["folder_tag_aliases"] !== undefined)
    v4["folder_tag_aliases"] = engine["folder_tag_aliases"];
  const extensions = engine["extensions"] as JsonMap | undefined;
  if (extensions !== undefined) {
    v4["extensions"] = { mode: extensions["mode"] as Json };
    for (const key of ["namespaces", "fields"]) {
      if (extensions[key] !== undefined) report.dropped.push(`engine.extensions.${key}`);
    }
  }
  for (const key of Object.keys(engine)) {
    if (
      ![
        "content_roots",
        "source_roots",
        "modules",
        "commit_prefixes",
        "field_sources",
        "folder_tags",
        "folder_tag_aliases",
        "extensions",
        "engine",
      ].includes(key)
    ) {
      report.dropped.push(`engine.${key}`);
    }
  }
  if (engine["engine"] !== undefined) v4["engine"] = engine["engine"];

  const documents = new Map<string, string>();
  const put = (path: string, doc: JsonMap): void => {
    documents.set(path, yamlDocument(doc));
  };

  // Vocabularies: the bundle's own; an empty one a kit contributes into is the library's now.
  for (const [name, vocabulary] of Object.entries(constitution.vocabularies ?? {})) {
    const entries: JsonMap = {};
    const retired: JsonMap = {};
    for (const [entry, props] of Object.entries(vocabulary.entries ?? {})) {
      const key = hyphen(entry);
      if (key !== entry) count(report, "vocabulary-entry-respelled");
      const out: JsonMap = {};
      if (typeof props["description"] === "string") out["description"] = props["description"];
      for (const prop of Object.keys(props)) {
        if (!["description", "status", "replaced_by"].includes(prop)) {
          report.dropped.push(`vocabularies.${name}.entries.${entry}.${prop}`);
        }
      }
      if (props["status"] === "retired") {
        const r: JsonMap = {};
        if (typeof props["replaced_by"] === "string") r["successor"] = hyphen(props["replaced_by"]);
        retired[key] = r;
      } else entries[key] = out;
    }
    if (vocabulary.form !== undefined) report.dropped.push(`vocabularies.${name}.form`);
    if (kitVocabularies.has(name)) {
      if (Object.keys(entries).length === 0) {
        report.dropped.push(
          `vocabularies.${name} (empty; the library declares ${kitIds[0]}/${name})`,
        );
        continue;
      }
      put(`constitution/vocabularies/${name}.yaml`, {
        vocabulary: name,
        contributes_to: `${kitIds[0]}/${name}`,
        entries,
      });
      continue;
    }
    const doc: JsonMap = { vocabulary: name, mode: vocabulary.mode, entries };
    if (Object.keys(retired).length > 0) doc["retired"] = retired;
    put(`constitution/vocabularies/${name}.yaml`, doc);
  }

  // Fragments.
  for (const [name, fragment] of Object.entries(constitution.fragments ?? {})) {
    const doc: JsonMap = { fragment: name };
    if (fragment.description !== undefined) doc["description"] = fragment.description;
    const fields = fieldsSchema(fragment.fields, `fragments.${name}`, new Map(), report);
    if (fields !== undefined) doc["fields"] = fields;
    if (fragment.sections !== undefined)
      doc["sections"] = sectionsDocument(fragment.sections, `fragments.${name}`, report);
    put(`constitution/fragments/${name}.yaml`, doc);
  }

  // Types.
  const appendOnly: string[] = [];
  for (const [name, type] of Object.entries(constitution.types ?? {})) {
    const doc: JsonMap = { type: name };
    const parent = type.extends;
    if (parent === undefined)
      throw new Error(`${root}: type ${name} extends nothing; a v1 type extends a base or a type`);
    if (BASES.has(parent)) doc["role"] = parent;
    else doc["extends"] = parent;
    if (type.description !== undefined) doc["description"] = type.description;
    if (type.use_when !== undefined) doc["use_when"] = type.use_when;
    if (type.avoid_when !== undefined) doc["avoid_when"] = type.avoid_when;
    if (type.abstract === true) doc["abstract"] = true;
    const fragmentList = [...(type.fragments ?? [])];
    if (type.body?.lifecycle === "append-only") {
      fragmentList.push(APPEND_ONLY_FRAGMENT);
      appendOnly.push(name);
      count(report, "body-append-only-rule");
    }
    if (fragmentList.length > 0) doc["fragments"] = fragmentList;
    if (type.instances !== undefined) {
      const instances: JsonMap = {};
      if (type.instances.min !== undefined) instances["min"] = type.instances.min;
      if (type.instances.max !== undefined) instances["max"] = type.instances.max;
      doc["instances"] = instances;
      if (type.instances.severity !== undefined)
        report.dropped.push(`types.${name}.instances.severity`);
    }
    const inherited = pinsOf(parent ?? "", types, fragments);
    const fields = fieldsSchema(type.fields, `types.${name}`, inherited, report);
    if (fields !== undefined) doc["fields"] = fields;
    if (type.sections !== undefined)
      doc["sections"] = sectionsDocument(type.sections, `types.${name}`, report);
    if (type.template !== undefined)
      report.dropped.push(`types.${name}.template (§3.3: the skeleton is derived)`);
    for (const key of ["status", "replaced_by"] as const) {
      if (type[key] !== undefined) report.dropped.push(`types.${name}.${key}`);
    }
    put(`constitution/types/${name}.yaml`, doc);
  }
  if (appendOnly.length > 0) {
    put(`constitution/fragments/${APPEND_ONLY_FRAGMENT}.yaml`, {
      fragment: APPEND_ONLY_FRAGMENT,
      description:
        "The page is append-only as a whole: a later change adds lines after the body and never edits one above.",
      rules: [BODY_APPEND_ONLY],
    });
  }

  // Pages.
  const pages = new Map<string, string>();
  for (const contentRoot of engine["content_roots"] as string[]) {
    const found: string[] = [];
    walkPages(root, contentRoot, found);
    for (const rel of found) {
      const before = read(rel);
      const after = rewritePage(rel, before, types, fragments, report);
      if (after !== before) pages.set(rel, after);
    }
  }

  const writes = new Map<string, string>([
    ["config/engine.json", `${JSON.stringify(v4, null, 2)}\n`],
    ...documents,
    ...pages,
  ]);
  const removals = ["config/constitution.json", "templates"].filter((p) =>
    existsSync(join(root, p)),
  );
  report.written = [...writes.keys()].sort();
  report.removed = removals;
  if (!dryRun) {
    for (const [rel, text] of writes) {
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      writeFileSync(join(root, rel), text);
    }
    for (const rel of removals) rmSync(join(root, rel), { recursive: true, force: true });
  }
  return report;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const root = args.find((a) => !a.startsWith("--"));
  if (root === undefined) {
    process.stderr.write("usage: bun tools/migrate-spellings.ts <bundle root> [--dry-run]\n");
    process.exitCode = 2;
  } else {
    const report = await migrate(resolve(root), dryRun);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  }
}
