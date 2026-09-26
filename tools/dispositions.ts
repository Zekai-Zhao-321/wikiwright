// v2 contracts §1 (the disposition table): every rule id, constitution key and
// engine key of the old tree, each with one disposition —
//   kernel   kept by the engine, and where;
//   rule     re-expressed as a CEL rule, in which library, with which id;
//   dropped  removed, with the line CHANGELOG.md carries for it.
// The navigator reviews the table before step 4; an id with no row fails it,
// and so does this script: the ids and keys are ENUMERATED from the old tree
// (the composed pass table, the v3 constitution and engine schemas, the
// standard library's grammar parameters and vocabulary entry properties, the
// field-shape kinds), and every one must have a row below, and every row an
// enumerated id.
//
// Run: `bun tools/dispositions.ts` (writes docs/v2-dispositions.md) or
// `--check` (compares). The file has this one generator.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ENGINE_CONFIG_SCHEMA, passRows, standardLibrary } from "../packages/core/src/index.ts";
import { ConstitutionSchema } from "../packages/core/src/registry/document.ts";
import { KIND_KEYS, UNIVERSAL_KEYS } from "../packages/core/src/shapes/index.ts";

const OUT = fileURLToPath(new URL("../docs/v2-dispositions.md", import.meta.url));

type Disposition = "kernel" | "rule" | "dropped";
export type Row = readonly [key: string, disposition: Disposition, text: string];

// ---------------------------------------------------------------------------
// enumeration

interface ZodLike {
  _zod?: { def?: Record<string, unknown> };
}

/** Every key path a zod schema declares: `a.b`, `a[].b`, `a.*.b`. */
function keyPaths(schema: unknown, path = "", out: string[] = []): string[] {
  const def = (schema as ZodLike)?._zod?.def;
  if (def === undefined) return out;
  switch (def["type"]) {
    case "optional":
    case "nullable":
    case "default":
    case "readonly":
    case "catch":
      return keyPaths(def["innerType"], path, out);
    case "pipe":
      return keyPaths(def["in"], path, out);
    case "object":
      for (const [key, value] of Object.entries(def["shape"] as Record<string, unknown>)) {
        const at = path === "" ? key : `${path}.${key}`;
        if (!out.includes(at)) out.push(at);
        keyPaths(value, at, out);
      }
      return out;
    case "array":
      return keyPaths(def["element"], `${path}[]`, out);
    case "record":
      return keyPaths(def["valueType"], `${path}.*`, out);
    case "union":
      for (const option of def["options"] as unknown[]) keyPaths(option, path, out);
      return out;
    default:
      return out;
  }
}

/**
 * The v3 constitution's keys, a type's and a fragment's shared subtrees (their
 * `sections` and `checks`) named once: `sections.list[].heading`, not once per
 * owner.
 */
function constitutionKeys(): string[] {
  const out: string[] = [];
  for (const path of keyPaths(ConstitutionSchema)) {
    const shared = path
      .replace(/^(?:types|fragments)\.\*\.sections/u, "sections")
      .replace(/^(?:.*\.)?checks(?=\[\]|$)/u, "checks");
    if (!out.includes(shared)) out.push(shared);
  }
  return out;
}

function grammarParams(): string[] {
  const out: string[] = [];
  for (const [grammar, spec] of standardLibrary().grammars) {
    for (const param of Object.keys(spec.params)) out.push(`${grammar}.${param}`);
  }
  return out;
}

function entryProperties(): string[] {
  const shared = ["description", "aliases", "status", "replaced_by"].map((k) => `*.${k}`);
  const own: string[] = [];
  for (const [vocabulary, spec] of standardLibrary().vocabularies) {
    const shape = (spec.entry as { shape?: Record<string, unknown> } | undefined)?.shape ?? {};
    for (const key of Object.keys(shape)) own.push(`${vocabulary}.${key}`);
  }
  return [...shared, ...own];
}

function shapeKeys(): string[] {
  const out: string[] = [];
  for (const [kind, keys] of Object.entries(KIND_KEYS)) {
    out.push(kind);
    for (const key of keys) if (key !== "kind") out.push(`${kind}.${key}`);
  }
  for (const key of UNIVERSAL_KEYS) out.push(`*.${key}`);
  return out;
}

// ---------------------------------------------------------------------------
// the table

const STEP5 = "its rule test lands with the library (contracts §12 step 5)";

export const RULES: readonly Row[] = [
  [
    "module-failure",
    "dropped",
    "`module-failure` removed with modules: a rule that cannot evaluate is `rule-error` (§6).",
  ],
  [
    "malformed-frontmatter",
    "kernel",
    "the judge: `malformed-frontmatter`, with the line the YAML reader names (verdict/page.ts)",
  ],
  ["frontmatter-not-mapping", "kernel", "the judge: `frontmatter-not-mapping` (verdict/page.ts)"],
  [
    "duplicate-key",
    "kernel",
    "the judge: `duplicate-key`, the page reader refusing a key written twice (law/yaml.ts)",
  ],
  [
    "unknown-type",
    "kernel",
    "the judge: `type-unknown`, `details.kind` `missing` or `unknown` (verdict/page.ts)",
  ],
  [
    "tombstone",
    "dropped",
    "`tombstone` removed with type `status` and `replaced_by`: a type leaves by removal, which `law-changed` reports (§8).",
  ],
  [
    "missing-required-field",
    "kernel",
    "the judge: `page-shape-invalid`, keyword `required`, against the effective shape (verdict/page.ts)",
  ],
  ["field-shape", "kernel", "the judge: `page-shape-invalid`, the effective shape's keywords"],
  [
    "unknown-frontmatter-key",
    "kernel",
    "the judge: `page-shape-invalid`, keyword `unevaluatedProperties`, under `extensions.mode: registered`",
  ],
  [
    "invalid-tags-field",
    "kernel",
    "the judge: `page-shape-invalid` against the reserved `tags` schema (schema/reserved.ts)",
  ],
  [
    "unknown-tag",
    "kernel",
    "the judge: `vocabulary-unknown`, a `tags` value outside the bundle's registered `tags` vocabulary",
  ],
  ["tag-alias-target", "dropped", "`tag-alias-target` removed with vocabulary entry aliases."],
  [
    "tag-retired",
    "kernel",
    "the judge: `vocabulary-retired`, a `tags` value the vocabulary retired, with its successor",
  ],
  [
    "identity-collision",
    "kernel",
    "the judge: `identity-collision`, carried by id (verdict/names.ts)",
  ],
  [
    "sections",
    "kernel",
    "the judge: `section-count` (`min`, `max`) and `sections-conflict` (`ordered`, `additional`), §3.2 (verdict/grammar.ts)",
  ],
  ["section-depth", "kernel", "the judge: `sections-conflict`, `details.kind: depth` (§3)"],
  [
    "max-chars",
    "dropped",
    "`max-chars` removed with `max_chars`: a size bound is a section rule over `section.raw`.",
  ],
  [
    "wikilink-alias-target",
    "kernel",
    "the judge: `wikilink-alias-target`, carried by id (verdict/page.ts)",
  ],
  [
    "wikilink-unresolved",
    "kernel",
    "the judge: `wikilink-unresolved`, carried by id; a page reference that names no page too",
  ],
  ["generated-drift", "kernel", "`check` and `gate` over `generated/*` (§9)"],
  ["okf-missing-type", "kernel", "the `okf-missing-type` rule inside `check` (§1, §9.1)"],
  [
    "template-placeholder-unknown",
    "dropped",
    "`template-placeholder-unknown` removed with templates: the skeleton is derived (§3.3).",
  ],
  [
    "template-field-unknown",
    "dropped",
    "`template-field-unknown` removed with templates: the skeleton is derived (§3.3).",
  ],
  [
    "template-orphan",
    "dropped",
    "`template-orphan` removed with templates: the skeleton is derived (§3.3).",
  ],
  [
    "freshness-unavailable",
    "kernel",
    "`check`'s pin measurement against the local repository (§9.1)",
  ],
  ["folder-segment-registered", "kernel", "the folder-tag fixer, `folder_tags` as today (§2)"],
  ["folder-tags-present", "kernel", "the folder-tag fixer, `folder_tags` as today (§2)"],
  ["former-folder-tags-review", "kernel", "the folder-tag fixer, `folder_tags` as today (§2)"],
  [
    "unregistered-extension",
    "dropped",
    "`unregistered-extension` removed with `extensions.namespaces` and `extensions.fields`: under `registered` an undeclared key is refused by the effective shape.",
  ],
  [
    "malformed-pin",
    "kernel",
    "the judge: `page-shape-invalid` against the engine `$def` `pin` (schema/shapes.ts)",
  ],
  ["stale-capture", "kernel", "`check`'s pin measurement, reported as `pin-stale` (§9.1)"],
  ["stale-source-cited", "kernel", "`check`, propagated over `graph.json` edges (§9.1)"],
  [
    "citation-unresolved",
    "kernel",
    "`check`'s pin measurement, the citations held to the pin as `freshness` holds them today",
  ],
  ["pin-unknown-to-origin", "kernel", "`check`'s pin measurement against the local repository"],
  [
    "origin-unreachable",
    "dropped",
    "`origin-unreachable` removed with remote freshness: a remote-origin pin is `pin-unmeasured` (info).",
  ],
  ["grammar-unparsed", "kernel", "the judge: `item-unparsed` (§4, verdict/grammar.ts)"],
  [
    "canonical-form",
    "dropped",
    "`canonical-form` removed: each grammar has one spelling, and any other does not parse (`item-unparsed`).",
  ],
  [
    "abstract-type",
    "kernel",
    "the judge: `abstract-type`, a page under the content roots; a rule test or an example may be a page of an abstract type (§3, §8)",
  ],
  [
    "tag-form",
    "kernel",
    "the judge: `page-shape-invalid` against the reserved `tags` schema's name pattern",
  ],
  [
    "tag-requires-link",
    "dropped",
    "`tag-requires-link` removed with the `requires_link` entry property: a page rule over `page.fields.tags` and `facts.links` expresses it.",
  ],
  [
    "instances",
    "kernel",
    "the judge: `instances-min` and `instances-max`, at the type document (§3)",
  ],
  [
    "body-append-only",
    "rule",
    `library \`code\`, rule \`body-append-only\`: a transition rule over \`before.page.body\` (code/decision); ${STEP5}`,
  ],
  [
    "vocabulary-alias-target",
    "dropped",
    "`vocabulary-alias-target` removed with vocabulary entry aliases.",
  ],
  [
    "vocabulary-retired",
    "kernel",
    "the judge: `vocabulary-retired`, a value the vocabulary lists under `retired`",
  ],
  [
    "skills-stale",
    "dropped",
    "`skills-stale` removed with the `skills` verb and installed-skill comparison (§1).",
  ],
  [
    "skills-missing",
    "dropped",
    "`skills-missing` removed with the `skills` verb and installed-skill comparison (§1).",
  ],
  ["brief-stale", "kernel", "`generated/BRIEF.md`, held with `generated/*` (§2)"],
  [
    "hook-stale",
    "dropped",
    "`hook-stale` removed with the `hook` verb: the published hook definition invokes `gate` (§9.2).",
  ],
  ["export-stale", "dropped", "`export-stale` removed with exports (§1)."],
  ["export-orphan", "dropped", "`export-orphan` removed with exports (§1)."],
  ["export-not-closed", "dropped", "`export-not-closed` removed with exports (§1)."],
  ["export-tag-unknown", "dropped", "`export-tag-unknown` removed with exports (§1)."],
  ["export-guide-outside", "dropped", "`export-guide-outside` removed with exports (§1)."],
  ["export-skill-invalid", "dropped", "`export-skill-invalid` removed with exports (§1)."],
  [
    "export-destination-invalid",
    "dropped",
    "`export-destination-invalid` removed with exports (§1).",
  ],
  ["export-symlink", "dropped", "`export-symlink` removed with exports (§1)."],
  [
    "export-destination-linked",
    "dropped",
    "`export-destination-linked` removed with exports (§1).",
  ],
  [
    "renamed-without-alias",
    "kernel",
    "the judge: `renamed-without-alias` over the index state's staged renames (§10)",
  ],
  [
    "exception-stale",
    "kernel",
    "the judge: `exception-stale`, an entry of the reserved `exceptions` key that closes nothing (§3.1)",
  ],
  [
    "exception-illegal",
    "kernel",
    "the judge: `exception-illegal`, an entry naming no rule, a census or a law a page may not waive (§3.1)",
  ],
  [
    "unknown-category",
    "kernel",
    "the judge: `vocabulary-unknown`, a claim's `[category]` against the section's vocabulary (§4)",
  ],
  ["journal-only-category", "dropped", "`journal-only-category` removed with category classes."],
  [
    "category-not-allowed",
    "kernel",
    "the judge: `category-not-allowed`, the claims `categories` parameter (§4)",
  ],
  ["owned-by", "dropped", "`owned-by` removed with the `owned_by` entry property."],
  [
    "claim-provenance",
    "kernel",
    "the judge: `claim-provenance`, the claims `provenance: required | none` (§4)",
  ],
  [
    "closed-claim-in-facts",
    "kernel",
    "the judge: `claim-closed`, the claims grammar's `closed: refused` (ruling 4)",
  ],
  [
    "history-marker",
    "kernel",
    "the judge: `claim-open`, the claims grammar's `closed: required` (ruling 4)",
  ],
  [
    "marker-like",
    "dropped",
    "`marker-like` removed with the provenance forms: a parenthetical is provenance or core text (§4).",
  ],
  ["sourced-inferred", "dropped", "`sourced-inferred` removed with the provenance forms (§4)."],
  [
    "provenance-path-only",
    "dropped",
    "`provenance-path-only` removed with the provenance forms: a path under a source root is provenance of kind `path` (§4).",
  ],
  ["provenance-weak", "dropped", "`provenance-weak` removed with the provenance forms (§4)."],
  ["hearsay", "dropped", "`hearsay` removed with the provenance forms (§4)."],
  [
    "claims-transition",
    "kernel",
    "the judge, by id (ruling 3): an open claim of the base, matched by handle, closed, corrected or recorded by a dated entry quoting it (verdict/transitions.ts)",
  ],
  [
    "claim-landing",
    "dropped",
    "`claim-landing` removed: a census of where closed claims land, which no rule reads.",
  ],
  [
    "unknown-label",
    "kernel",
    "the judge: `vocabulary-unknown`, a relation's label against the section's vocabulary (§4)",
  ],
  [
    "relation-range",
    "rule",
    `library \`code\`, rule \`relation-range\`, the ranges as its config (the spike's rule, in the admitted form); ${STEP5}`,
  ],
  [
    "relation-target-unresolved",
    "kernel",
    "the judge: `relation-target-unresolved`, the target from the vault's names (§4)",
  ],
  [
    "relation-removed",
    "kernel",
    "the judge, by id (ruling 3): a relation that left its section, recorded in its `history` heading (verdict/transitions.ts)",
  ],
  [
    "relation-retired",
    "dropped",
    "`relation-retired` removed: a census of retired labels; a retired label in use is `vocabulary-retired`.",
  ],
  [
    "relation-require",
    "kernel",
    "the judge: `require-unmet`, the relations `require` parameter (ruling 2)",
  ],
  ["entry-date-missing", "kernel", "`item-unparsed`: an entry is dated or does not parse (§4)"],
  [
    "entry-mutated",
    "kernel",
    "the judge: `entry-edited`, the entries grammar's `lifecycle: append-only` (§4)",
  ],
];

const CONSTITUTION: readonly Row[] = [
  [
    "schema",
    "dropped",
    "`config/constitution.json` replaced by `constitution/` directories of YAML documents; no `schema` key (§2).",
  ],
  [
    "schema_version",
    "dropped",
    "`config/constitution.json` replaced by `constitution/` directories; `config/engine.json` carries `schema_version: 4` (§2).",
  ],
  ["vocabularies", "kernel", "`constitution/vocabularies/<name>.yaml` (law/documents.ts)"],
  ["vocabularies.*.mode", "kernel", "a vocabulary document's `mode`"],
  [
    "vocabularies.*.form",
    "dropped",
    "vocabulary `form` removed: every entry name is a lower-case hyphenated name (§3).",
  ],
  ["vocabularies.*.entries", "kernel", "a vocabulary document's `entries`"],
  ["fragments", "kernel", "`constitution/fragments/<name>.yaml`"],
  ["fragments.*.description", "kernel", "a fragment document's `description`"],
  ["fragments.*.fields", "kernel", "a fragment document's `fields`, JSON Schema (§3.1)"],
  ["sections", "kernel", "a type's or a fragment's `sections` (§3.2)"],
  ["sections.ordered", "kernel", "`sections.ordered`"],
  ["sections.depth", "kernel", "`sections.depth`"],
  ["sections.additional", "kernel", "`sections.additional: allowed | refused` (a boolean before)"],
  ["sections.list", "kernel", "`sections.list`"],
  ["sections.list[].heading", "kernel", "a section entry's `heading`, exact text"],
  ["sections.list[].min", "kernel", "a section entry's `min`"],
  ["sections.list[].max", "kernel", "a section entry's `max`, nullable"],
  [
    "sections.list[].aliases",
    "dropped",
    "section heading `aliases` removed: a heading is matched by its exact text (§3).",
  ],
  [
    "sections.list[].grammar",
    "kernel",
    "`grammar: claims | relations | entries`, the fixed set (§4)",
  ],
  ["sections.list[].vocabulary", "kernel", "a section entry's `vocabulary`, bare or qualified"],
  [
    "sections.list[].max_chars",
    "dropped",
    "`max_chars` removed: a size bound is a section rule over `section.raw`.",
  ],
  [
    "sections.list[].severity",
    "dropped",
    "a section's `severity` removed: a rule carries its own `severity` (§3).",
  ],
  [
    "checks",
    "dropped",
    "`checks` (on a type, a fragment or a section entry) removed with registered checks: `rules` carry CEL expressions, a section rule names its heading (§3, §6).",
  ],
  ["checks[].use", "dropped", "a check's `use` removed: a rule is its own `expr` (§6)."],
  ["checks[].config", "kernel", "a rule's `config`, and `configure` on a type (§3)"],
  ["checks[].severity", "kernel", "a rule's `severity` (§3)"],
  ["types", "kernel", "`constitution/types/<name>.yaml`"],
  [
    "types.*.extends",
    "kernel",
    "a type document's `extends`, optional at a root, bare or qualified",
  ],
  ["types.*.description", "kernel", "a type document's `description`"],
  ["types.*.abstract", "kernel", "a type document's `abstract`"],
  ["types.*.instances", "kernel", "a type document's `instances`"],
  ["types.*.instances.min", "kernel", "`instances.min`"],
  ["types.*.instances.max", "kernel", "`instances.max`, nullable"],
  [
    "types.*.instances.severity",
    "dropped",
    "`instances.severity` removed: `instances-min` and `instances-max` carry their own rows.",
  ],
  ["types.*.use_when", "kernel", "a type document's `use_when`"],
  ["types.*.avoid_when", "kernel", "a type document's `avoid_when`"],
  ["types.*.fragments", "kernel", "a type document's `fragments`, bare or qualified"],
  ["types.*.fields", "kernel", "a type document's `fields`, JSON Schema (§3.1)"],
  [
    "types.*.body",
    "rule",
    `library \`code\`, rule \`body-append-only\` (the page-wide append-only law); ${STEP5}`,
  ],
  [
    "types.*.body.lifecycle",
    "rule",
    "library `code`, rule `body-append-only`: `append-only` is what the rule states",
  ],
  ["types.*.body.severity", "kernel", "the rule's `severity` (§3)"],
  [
    "types.*.template",
    "dropped",
    "type `template` removed: `type show --brief` prints the derived skeleton (§3.3).",
  ],
  ["types.*.example", "kernel", "a type document's `examples: [path]`, run by `check` (§8)"],
  [
    "types.*.status",
    "dropped",
    "type `status` removed: a type leaves by removal, which `law-changed` reports (§8).",
  ],
  ["types.*.replaced_by", "dropped", "type `replaced_by` removed with type `status`."],
];

const GRAMMAR_PARAMS: readonly Row[] = [
  ["claims.provenance", "kernel", "`provenance: required | optional | none` (§4)"],
  [
    "claims.forms",
    "dropped",
    "claims `forms` removed with the provenance forms: provenance is a page, a URL or a path (§4).",
  ],
  [
    "claims.sources",
    "dropped",
    "claims `sources` removed with the `sourced` provenance form (§4).",
  ],
  [
    "claims.history",
    "dropped",
    "claims `history` removed: a closed claim is a record with `retracted` or `superseded`; where it may stand is the `closed` parameter (ruling 4).",
  ],
  [
    "claims.role",
    "dropped",
    "claims `role: history` removed: a History section is an `entries` section, or a claims section with `closed: required` (ruling 4).",
  ],
  [
    "claims.categories",
    "dropped",
    "the legacy `categories: claim-classes` spelling removed; `categories` now names the admitted subset (§4).",
  ],
  ["claims.only", "kernel", "claims `categories: [..]`, the subset of the vocabulary (§4)"],
  ["claims.items", "dropped", "claims `items` removed: a section holds one record kind (§4)."],
  [
    "claims.inferred_ref",
    "dropped",
    "claims `inferred_ref` removed with the `inferred` provenance form (§4).",
  ],
  ["relations.require", "kernel", "relations `require: [{labels, min}]` (§4)"],
  [
    "relations.history",
    "kernel",
    "relations `history: <heading>`, held by the judge's `relation-removed` (ruling 3)",
  ],
  ["entries.date", "dropped", "entries `date` removed: an entry is dated or does not parse (§4)."],
  ["entries.lifecycle", "kernel", "entries `lifecycle: append-only` (`entry-edited`, §4)"],
];

const ENTRY_PROPERTIES: readonly Row[] = [
  ["*.description", "kernel", "a vocabulary entry's `description`"],
  ["*.aliases", "dropped", "vocabulary entry `aliases` removed."],
  ["*.status", "kernel", "a vocabulary's `retired` map (§3)"],
  ["*.replaced_by", "kernel", "`retired.<entry>.successor` (§3)"],
  [
    "tags.requires_link",
    "dropped",
    "the tags entry property `requires_link` removed: a page rule over `page.fields.tags` and `facts.links` expresses it.",
  ],
  [
    "categories.class",
    "dropped",
    "the category entry property `class` (supersede, accumulate, journal-only) removed with the claims transition classes.",
  ],
  ["categories.owned_by", "dropped", "the category entry property `owned_by` removed."],
  [
    "relations.range",
    "rule",
    "library `code`, rule `relation-range`: the ranges move into the rule's `config`",
  ],
];

const SHAPES: readonly Row[] = [
  ["any", "kernel", "a property schema with no keyword (`{}`)"],
  ["string", "kernel", "`type: string`"],
  ["string.min_length", "kernel", "`minLength`"],
  ["string.max_length", "kernel", "`maxLength`"],
  ["string.pattern", "kernel", "`pattern`, compiled by RE2 (no lookaround, no backreferences)"],
  ["dated-string", "kernel", "`type: string` with an RE2 `pattern` for the date prefix"],
  ["integer", "kernel", "`type: integer`"],
  ["integer.min", "kernel", "`minimum`"],
  ["integer.max", "kernel", "`maximum`"],
  ["number", "kernel", "`type: number`"],
  ["number.min", "kernel", "`minimum`"],
  ["number.max", "kernel", "`maximum`"],
  ["boolean", "kernel", "`type: boolean`"],
  ["enum", "kernel", "`enum`"],
  ["enum.values", "kernel", "`enum`'s list"],
  ["date", "kernel", "`type: string, format: date` (engine-written validator)"],
  [
    "date.auto",
    "kernel",
    "`write` stamps `created` on a new page and `updated` on a changed page where the effective shape declares the key, through the clock seam (ruling 7, contracts §12 step 4)",
  ],
  ["datetime", "kernel", "`type: string, format: date-time` (engine-written validator)"],
  ["list", "kernel", "`type: array`"],
  ["list.item", "kernel", "`items`"],
  ["list.min_items", "kernel", "`minItems`"],
  ["list.max_items", "kernel", "`maxItems`"],
  ["object", "kernel", "`type: object`"],
  ["object.keys", "kernel", "`properties`"],
  ["object.required", "kernel", "`required`"],
  ["page-ref", "kernel", "the engine `$def` `page-ref`"],
  ["page-ref.target_root", "kernel", "the engine keyword `target_root`"],
  ["page-ref.target_type", "kernel", "the engine keyword `target_type`, ancestry counted"],
  ["page-ref-list", "kernel", "the engine `$def` `page-ref-list`"],
  ["page-ref-list.target_root", "kernel", "the engine keyword `target_root`"],
  ["page-ref-list.target_type", "kernel", "the engine keyword `target_type`, ancestry counted"],
  ["pin", "kernel", "the engine `$def` `pin`: `{commit, origin, covers}`"],
  ["pin.origin", "kernel", "`pin.origin`, inside the pin object (a sibling field before)"],
  ["pin.covers", "kernel", "`pin.covers`, inside the pin object (a sibling field before)"],
  ["*.required", "kernel", "the object schema's `required` list"],
  ["*.requires", "kernel", "`dependentRequired`"],
  ["*.checks", "dropped", "field `checks` removed: a rule reads `page.fields` (§5)."],
];

const ENGINE: readonly Row[] = [
  ["content_roots", "kernel", "`content_roots` (§2)"],
  ["engine", "kernel", "`engine`, the closed range subset (§2)"],
  ["folder_tag_aliases", "kernel", "`folder_tag_aliases`, as today (§2)"],
  ["folder_tags", "kernel", "`folder_tags`, as today (§2)"],
  ["folder_tags.mode", "kernel", "`folder_tags.mode`, as today"],
  ["source_roots", "kernel", "`source_roots` (§2): claim provenance and `target_root`"],
  ["extensions", "kernel", "`extensions` (§2)"],
  ["extensions.mode", "kernel", "`extensions.mode`: whether the effective shape is closed (§3.1)"],
  [
    "extensions.namespaces",
    "dropped",
    "`extensions.namespaces` removed: the `x-` mount is gone; a key is declared by a type or refused.",
  ],
  [
    "extensions.fields",
    "dropped",
    "`extensions.fields` removed: a key is declared by a type or refused.",
  ],
  ["commit_prefixes", "kernel", "`commit_prefixes: [string]`, flattened (§2)"],
  [
    "commit_prefixes.prefixes",
    "dropped",
    "`commit_prefixes.prefixes` removed: `commit_prefixes` is the list itself.",
  ],
  [
    "move_reasons",
    "dropped",
    "`move_reasons` removed: a move carries its reason in `ops.json` (§2, §9.3).",
  ],
  [
    "modules",
    "dropped",
    "`modules` removed: a bundle names type libraries by `libraries[].path` (§2).",
  ],
  ["modules[].package", "dropped", "`modules[].package` removed with `modules`."],
  ["modules[].version", "dropped", "`modules[].version` removed with `modules`."],
  [
    "modules[].path",
    "dropped",
    "`modules[].path` removed with `modules`; `libraries[].path` resolves against the git top level.",
  ],
  ["exports", "dropped", "`exports` removed with exports (§1)."],
  ["exports[].name", "dropped", "removed with `exports`."],
  ["exports[].select", "dropped", "removed with `exports`."],
  ["exports[].select.kind", "dropped", "removed with `exports`."],
  ["exports[].select.tags", "dropped", "removed with `exports`."],
  ["exports[].select.directories", "dropped", "removed with `exports`."],
  ["exports[].sources", "dropped", "removed with `exports`."],
  ["exports[].output", "dropped", "removed with `exports`."],
  ["exports[].repository", "dropped", "removed with `exports`."],
  ["exports[].links", "dropped", "removed with `exports`."],
  ["exports[].guide", "dropped", "removed with `exports`."],
  ["exports[].contribution", "dropped", "removed with `exports`."],
  ["exports[].contribution.mode", "dropped", "removed with `exports`."],
  ["exports[].contribution.repository", "dropped", "removed with `exports`."],
  ["exports[].contribution.folder", "dropped", "removed with `exports`."],
  ["exports[].skill", "dropped", "removed with `exports`."],
  ["exports[].license", "dropped", "removed with `exports`."],
  ["plugin", "dropped", "`plugin` removed with `.claude-plugin/` (§1)."],
  ["plugin.name", "dropped", "removed with `plugin`."],
  ["plugin.version", "dropped", "removed with `plugin`."],
  ["plugin.description", "dropped", "removed with `plugin`."],
  ["field_sources", "kernel", "`field_sources` (§2)"],
  [
    "field_sources.title",
    "kernel",
    "`field_sources.title: basename`: `title` is not required (schema/reserved.ts)",
  ],
  [
    "field_sources.description",
    "dropped",
    "`field_sources.description: lede` removed: the v4 table carries `title` only (§2).",
  ],
];

interface Group {
  title: string;
  what: string;
  rows: readonly Row[];
  enumerate: () => readonly string[];
}

const GROUPS: readonly Group[] = [
  {
    title: "Rule ids",
    what: "Every row of the composed pass table (`passRows(standardLibrary())`): the kernel's rows and the standard library's arms. The code kit registers none.",
    rows: RULES,
    enumerate: () => passRows(standardLibrary()).map((row) => row.id),
  },
  {
    title: "Constitution keys",
    what: "Every key the v3 `config/constitution.json` schema declares; a type's and a fragment's `sections` and `checks` subtrees are named once.",
    rows: CONSTITUTION,
    enumerate: constitutionKeys,
  },
  {
    title: "Section grammar parameters",
    what: "Every parameter the standard library's three grammars declare, `<grammar>.<parameter>`.",
    rows: GRAMMAR_PARAMS,
    enumerate: grammarParams,
  },
  {
    title: "Vocabulary entry keys",
    what: "The four keys every entry shares (`*.`) and each registered vocabulary's own entry properties.",
    rows: ENTRY_PROPERTIES,
    enumerate: entryProperties,
  },
  {
    title: "Field shape kinds and keys",
    what: "Every field-shape kind and the keys it admits, and the keys every kind admits (`*.`). JSON Schema replaces the table (§3.1).",
    rows: SHAPES,
    enumerate: shapeKeys,
  },
  {
    title: "Engine keys",
    what: "Every key the v3 `config/engine.json` schema declares.",
    rows: ENGINE,
    enumerate: () => keyPaths(ENGINE_CONFIG_SCHEMA),
  },
];

/** Every enumerated id against every row: none missing, none extra, none twice. */
export function dispositionProblems(): string[] {
  const problems: string[] = [];
  for (const group of GROUPS) {
    const enumerated = [...new Set(group.enumerate())];
    const rowKeys = group.rows.map(([key]) => key);
    for (const key of enumerated) {
      if (!rowKeys.includes(key)) problems.push(`${group.title}: "${key}" has no row`);
    }
    for (const key of rowKeys) {
      if (!enumerated.includes(key))
        problems.push(`${group.title}: the row "${key}" names nothing the old tree declares`);
    }
    for (const key of new Set(rowKeys)) {
      if (rowKeys.filter((k) => k === key).length > 1)
        problems.push(`${group.title}: "${key}" has two rows`);
    }
  }
  return problems;
}

const cell = (text: string): string => text.replaceAll("|", "\\|");

export function renderDispositions(): string {
  const problems = dispositionProblems();
  if (problems.length > 0)
    throw new Error(`the disposition table is incomplete:\n${problems.join("\n")}`);
  const lines = [
    "# v2 dispositions",
    "",
    "<!-- Generated by `bun tools/dispositions.ts`; do not edit by hand. -->",
    "",
    "Every rule id, constitution key and engine key of the v1 tree, with what the",
    "v2 delivery does with it (contracts §1). `kernel`: kept by the engine, and",
    "where. `rule`: re-expressed as a CEL rule, in which library and under which",
    "id; the rule and its test set land with the library (contracts §12 step 5).",
    "`dropped`: removed, with the line `CHANGELOG.md` carries for it. The ids are",
    "enumerated from the v1 tree by the generator, which fails when one has no row",
    "or a row names nothing, so the table cannot fall behind the code it describes.",
    "",
  ];
  const totals = { kernel: 0, rule: 0, dropped: 0 };
  for (const group of GROUPS) {
    lines.push(
      `## ${group.title}`,
      "",
      group.what,
      "",
      "| id | disposition | where, or the changelog line |",
      "|---|---|---|",
    );
    for (const [key, disposition, text] of group.rows) {
      totals[disposition] += 1;
      lines.push(`| \`${cell(key)}\` | ${disposition} | ${cell(text)} |`);
    }
    lines.push("");
  }
  lines.push(
    "## Totals",
    "",
    `${totals.kernel} kernel, ${totals.rule} rule, ${totals.dropped} dropped: ${totals.kernel + totals.rule + totals.dropped} rows.`,
    "",
  );
  return lines.join("\n");
}

if (import.meta.main) {
  const rendered = renderDispositions();
  if (process.argv.includes("--check")) {
    const current = readFileSync(OUT, "utf8");
    if (current !== rendered) {
      console.error("docs/v2-dispositions.md is stale: run `bun tools/dispositions.ts`");
      process.exitCode = 1;
    }
  } else {
    writeFileSync(OUT, rendered);
  }
}
