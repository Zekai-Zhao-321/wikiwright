// v2 contracts §3, §3.1, §5, §10: the checks the kernel makes of one page
// under its type — the bytes and the YAML, the type, the effective shape, the
// page references its shape declares, the `tags` vocabulary, the body's
// links and the rename — each as findings with their §6 location.
//
// Ported by id from the old per-page passes (lint/index.ts): the frontmatter
// codes, `unknown-type` (now `type-unknown`), `abstract-type`, the shape's
// codes (now one, `page-shape-invalid`, with Ajv's keyword in details), the
// tag laws (now `vocabulary-unknown` and `vocabulary-retired` over the
// bundle's `tags` vocabulary), the two link verdicts and the rename review.

import { normalizeIdentity } from "../identity/index.ts";
import type { ParsedPage } from "../interface/index.ts";
import type { LawType, LawVocabulary } from "../law/compose.ts";
import type { TypeLaw } from "../law/load.ts";
import { resolveReference } from "../law/names.ts";
import { jsonNumbers } from "../law/yaml.ts";
import { basenameOf } from "../names/basename.ts";
import { errorLine } from "../schema/ajv.ts";
import { reservedShape } from "../schema/reserved.ts";
import type { VaultNameEntry, VaultNames } from "./names.ts";
import type { RuleContext } from "./rules.ts";
import type { FindingLocation, VerdictFinding } from "./table.ts";

/** A finding before it is routed. */
export type Unrouted = Omit<VerdictFinding, "queue">;

export const PAGE_LOCATION: FindingLocation = { kind: "page" };

/**
 * The location of a line of the body: the innermost section occurrence that
 * holds it, or the page when it sits above every heading.
 */
export function locationAt(page: ParsedPage, line: number): FindingLocation {
  const counts = new Map<string, number>();
  let at: FindingLocation = PAGE_LOCATION;
  for (const occurrence of page.occurrences) {
    const index = counts.get(occurrence.heading) ?? 0;
    counts.set(occurrence.heading, index + 1);
    if (occurrence.location.line > line) break;
    at = { kind: "section", heading: occurrence.heading, occurrence: index, line };
  }
  return at;
}

/** The context every page is judged in: the law, the vault's names, and what the state holds. */
export interface PageContext {
  law: TypeLaw;
  names: VaultNames;
  /** `field_sources.title: basename`: a title is the basename where none is written. */
  titleFromBasename: boolean;
  /** The bundle's own `tags` vocabulary, when it declares one. */
  tags: LawVocabulary | undefined;
  /** Renames the state records, by the path renamed to. */
  renamedFrom: ReadonlyMap<string, string>;
  /** Every content root, for `target_root: content`. */
  contentRoots: readonly string[];
  /** What every page's CEL rules share. */
  rules: RuleContext;
}

/** The findings of a page that did not reach its type: `undefined` when it did. */
export function readFindings(page: ParsedPage, path: string): Unrouted[] | undefined {
  if (page.frontmatterCode !== undefined) {
    return [
      {
        rule: page.frontmatterCode,
        severity: "error",
        path,
        location: PAGE_LOCATION,
        message: `the frontmatter does not read: ${page.frontmatterError ?? "it is not YAML"}`,
        details:
          page.frontmatterLine === undefined
            ? { reason: page.frontmatterError ?? "" }
            : { reason: page.frontmatterError ?? "", line: page.frontmatterLine },
      },
    ];
  }
  const declared = page.frontmatter["type"];
  if (typeof declared !== "string" || declared === "") {
    return [
      {
        rule: "type-unknown",
        severity: "error",
        path,
        location: PAGE_LOCATION,
        message:
          page.frontmatterBytes === null
            ? "the page has no frontmatter, so it names no type"
            : "the frontmatter names no type: `type` is a type the bundle or its libraries declare",
        details: { kind: "missing" },
      },
    ];
  }
  if (page.type === undefined) {
    return [
      {
        rule: "type-unknown",
        severity: "error",
        path,
        location: PAGE_LOCATION,
        message: `type "${declared}" is no type the bundle or its libraries declare`,
        details: { kind: "unknown", type: declared },
      },
    ];
  }
  return undefined;
}

/** §3.1: the effective shape, one finding per error Ajv reports. */
export function shapeFindings(law: TypeLaw, page: ParsedPage, type: LawType): Unrouted[] {
  const validate = law.validators.get(type.name);
  if (validate === undefined || validate(jsonNumbers(page.frontmatter)) === true) return [];
  const seen = new Set<string>();
  const out: Unrouted[] = [];
  for (const error of validate.errors ?? []) {
    // allOf reports one failure once per member that holds it; one is enough.
    const line = errorLine(error);
    if (seen.has(line)) continue;
    seen.add(line);
    out.push({
      rule: "page-shape-invalid",
      severity: "error",
      path: page.path,
      location: PAGE_LOCATION,
      message: `${type.name}: ${line}`,
      details: {
        keyword: error.keyword,
        pointer: error.instancePath,
        schema: error.schemaPath,
        params: error.params,
      },
    });
  }
  return out;
}

/** A frontmatter key the effective shape declares a page reference, and what it requires. */
interface PageRefField {
  key: string;
  list: boolean;
  /** Qualified type names the target must have, ancestry counted: every declaration's. */
  targetTypes: string[];
  targetRoots: string[];
}

const REF = "#/$defs/page-ref";
const REF_LIST = "#/$defs/page-ref-list";

function pageRefFields(type: LawType): PageRefField[] {
  const out = new Map<string, PageRefField>();
  const read = (namespace: string, properties: unknown): void => {
    if (properties === null || typeof properties !== "object") return;
    for (const [key, declared] of Object.entries(properties)) {
      if (declared === null || typeof declared !== "object") continue;
      const record = declared as Record<string, unknown>;
      const ref = record["$ref"];
      if (ref !== REF && ref !== REF_LIST) continue;
      const field = out.get(key) ?? {
        key,
        list: ref === REF_LIST,
        targetTypes: [],
        targetRoots: [],
      };
      const targetType = record["target_type"];
      if (typeof targetType === "string") {
        const name = resolveReference(namespace, targetType);
        if (name !== undefined) field.targetTypes.push(name);
      }
      const targetRoot = record["target_root"];
      if (typeof targetRoot === "string") field.targetRoots.push(targetRoot);
      out.set(key, field);
    }
  };
  read("", reservedShape({})["properties"]);
  for (const part of type.parts) {
    const name = part.origin.slice(part.origin.indexOf(":") + 1);
    const namespace = name.includes("/") ? name.slice(0, name.indexOf("/")) : "";
    read(namespace, part.schema["properties"]);
  }
  return [...out.values()];
}

/** A type and every type above it. */
function chainOf(law: TypeLaw, type: string): string[] {
  const found = law.types.get(type);
  return found === undefined ? [type] : [type, ...found.ancestry];
}

/**
 * §3.1 a page reference against the vault's names, and its `target_type`
 * and `target_root`: one that names no page, one written as a path, one
 * that resolves to a page of another type, and one under another root are
 * each `page-ref-type`, an error, as v1's `field-shape` was.
 */
export function pageRefFindings(ctx: PageContext, page: ParsedPage, type: LawType): Unrouted[] {
  const out: Unrouted[] = [];
  for (const field of pageRefFields(type)) {
    const value = page.frontmatter[field.key];
    const names = field.list
      ? Array.isArray(value)
        ? value.filter((v): v is string => typeof v === "string")
        : []
      : typeof value === "string"
        ? [value]
        : [];
    names.forEach((name, index) => {
      const pointer = field.list ? `/${field.key}/${index}` : `/${field.key}`;
      const target = ctx.names.resolve(name);
      if (target === undefined) {
        // A path breaks on the next move while the name survives it, which
        // is why a page reference, like a wikilink, is the canonical name.
        const path = name.includes("/") || name.endsWith(".md");
        const canonical = (name.split("/").pop() ?? name).replace(/\.md$/u, "");
        out.push({
          rule: "page-ref-type",
          severity: "error",
          path: page.path,
          location: PAGE_LOCATION,
          message: path
            ? `${field.key}: "${name}" is a path; a page reference is the page's canonical name (here "${canonical}")`
            : `${field.key}: "${name}" names no page; a page reference is a page's canonical name`,
          details: {
            kind: path ? "path" : "unresolved",
            field: field.key,
            pointer,
            target: name,
            ...(path ? { canonical } : {}),
          },
        });
        return;
      }
      const chain = target.type === null ? [] : chainOf(ctx.law, target.type);
      for (const required of field.targetTypes) {
        if (chain.includes(required)) continue;
        out.push({
          rule: "page-ref-type",
          severity: "error",
          path: page.path,
          location: PAGE_LOCATION,
          message: `${field.key}: "${name}" is a ${target.type ?? "page with no type"}; ${type.name} requires a ${required}`,
          details: {
            kind: "type",
            field: field.key,
            pointer,
            target: target.path,
            type: target.type,
            required,
          },
        });
      }
      for (const root of field.targetRoots) {
        const roots = root === "content" ? ctx.contentRoots : [root];
        if (roots.some((r) => target.path.startsWith(`${r}/`))) continue;
        out.push({
          rule: "page-ref-type",
          severity: "error",
          path: page.path,
          location: PAGE_LOCATION,
          message: `${field.key}: "${name}" is ${target.path}, outside ${root === "content" ? "the content roots" : `the source root ${root}`}`,
          details: { kind: "root", field: field.key, pointer, target: target.path, root },
        });
      }
    });
  }
  return out;
}

/**
 * A value authored against a vocabulary: registered and absent is
 * `vocabulary-unknown`, retired is `vocabulary-retired` with its successor; a
 * census vocabulary admits a new value and counts it.
 */
export function vocabularyFinding(
  vocabulary: LawVocabulary,
  value: string,
  path: string,
  location: FindingLocation,
  details: Record<string, unknown>,
): Unrouted | undefined {
  const retired = vocabulary.retired.get(value);
  if (retired !== undefined) {
    return {
      rule: "vocabulary-retired",
      severity: "error",
      path,
      location,
      message: `"${value}" is retired from ${vocabulary.name}${retired.successor === undefined ? "" : `; use "${retired.successor}"`}`,
      details: {
        ...details,
        vocabulary: vocabulary.name,
        value,
        ...(retired.successor === undefined ? {} : { successor: retired.successor }),
      },
    };
  }
  if (vocabulary.mode !== "registered" || vocabulary.entries.has(value)) return undefined;
  return {
    rule: "vocabulary-unknown",
    severity: "error",
    path,
    location,
    message: `"${value}" is not an entry of ${vocabulary.name}`,
    details: { ...details, vocabulary: vocabulary.name, value },
  };
}

/** The `tags` a page carries against the bundle's `tags` vocabulary. */
export function tagFindings(ctx: PageContext, page: ParsedPage): Unrouted[] {
  const tags = page.frontmatter["tags"];
  if (ctx.tags === undefined || !Array.isArray(tags)) return [];
  const out: Unrouted[] = [];
  tags.forEach((tag, index) => {
    if (typeof tag !== "string") return;
    const finding = vocabularyFinding(ctx.tags as LawVocabulary, tag, page.path, PAGE_LOCATION, {
      pointer: `/tags/${index}`,
    });
    if (finding !== undefined) out.push(finding);
  });
  return out;
}

function linkVerdict(entry: VaultNameEntry | undefined): "ok" | "unresolved" | "alias" {
  if (entry === undefined) return "unresolved";
  return entry.viaAlias ? "alias" : "ok";
}

/** Every wikilink in the body: one that names no page, and one that names a page by an alias. */
export function linkFindings(ctx: PageContext, page: ParsedPage): Unrouted[] {
  const out: Unrouted[] = [];
  for (const link of page.links) {
    const entry = ctx.names.resolve(link.target);
    const verdict = linkVerdict(entry);
    if (verdict === "ok") continue;
    const location = locationAt(page, link.line);
    const details = { target: link.target, line: link.line };
    if (verdict === "unresolved") {
      out.push({
        rule: "wikilink-unresolved",
        severity: "warning",
        path: page.path,
        location,
        message: `[[${link.target}]] names no page`,
        details,
      });
    } else {
      const canonical = basenameOf(entry?.path ?? "");
      out.push({
        rule: "wikilink-alias-target",
        severity: "error",
        path: page.path,
        location,
        message: `[[${link.target}]] names ${entry?.path ?? ""} by an alias; link it as [[${canonical}]]`,
        details: { ...details, canonical },
      });
    }
  }
  return out;
}

/**
 * The rename review: a page renamed to a new name keeps its old name as an
 * alias, or every link to the old name stops resolving.
 */
export function renameFindings(ctx: PageContext, page: ParsedPage): Unrouted[] {
  const from = ctx.renamedFrom.get(page.path);
  if (from === undefined) return [];
  const old = basenameOf(from);
  if (old === "" || normalizeIdentity(old) === normalizeIdentity(basenameOf(page.path))) return [];
  const aliases = page.frontmatter["aliases"];
  const carried =
    Array.isArray(aliases) &&
    aliases.some((a) => typeof a === "string" && normalizeIdentity(a) === normalizeIdentity(old));
  if (carried) return [];
  return [
    {
      rule: "renamed-without-alias",
      severity: "error",
      path: page.path,
      location: PAGE_LOCATION,
      message: `renamed from "${old}"; the old name must survive as an alias, or every [[${old}]] stops resolving`,
      details: { from, alias: old },
    },
  ];
}
