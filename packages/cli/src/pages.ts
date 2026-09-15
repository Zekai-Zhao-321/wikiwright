// Lint over EffectiveType · docs/constitution.md §Sections (the section lines a type
// prints) · docs/cli.md §check, docs/cli.md §lint (the page-shaped helpers two or more verbs share:
// collection, ordering, the summary census) · docs/architecture.md §Directories.

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  codeUnitCompare,
  declaredParams,
  type EffectiveType,
  type Finding,
  type FlattenedRegistry,
  folderSegmentsFor,
  isContentPath,
  normalizeIdentity,
  type PageInput,
  type ParsedDoc,
  parseDoc,
  segmentIdentity,
} from "@wikiwright/core";
import type { VaultOk } from "./law.ts";
import { vaultReadAbsolute } from "./paths.ts";
import { readPage } from "./vaultio.ts";

export function activeTypeNames(registry: FlattenedRegistry): string[] {
  return [...registry.types.values()]
    .filter((t) => t.status === "active")
    .map((t) => t.name)
    .sort(codeUnitCompare);
}

export function collectPages(root: string, paths: string[]): PageInput[] {
  return [...paths]
    .sort(codeUnitCompare)
    .map((path) => ({ path, doc: parseDoc(readPage(root, path)) }));
}

export function sortFindings(findings: Finding[]): Finding[] {
  return findings.sort((a, b) => {
    const byPath = codeUnitCompare(a.path, b.path);
    if (byPath !== 0) return byPath;
    const la = a.line ?? 0;
    const lb = b.line ?? 0;
    if (la !== lb) return la - lb;
    return codeUnitCompare(a.ruleId, b.ruleId);
  });
}

/**
 * One parameter value, legibly: a scalar as itself, a list by commas, a record
 * as `key=value` pairs joined by `:`. Generic on purpose — a kit's parameter
 * prints without this file learning its shape.
 */
function renderParam(value: unknown): string {
  if (Array.isArray(value)) return value.map(renderParam).join(",");
  if (value !== null && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => `${key}=${renderParam(item)}`)
      .join(":");
  }
  return String(value);
}

/**
 * docs/constitution.md §Sections: `heading | grammar | parameters | contributedBy`, one
 * line per declared section — the grammar's parameters sorted by key, then the
 * kernel's two knobs — so the rendering is byte-stable and names nothing a
 * grammar declared.
 */
/**
 * The declared sections, one line each — in the template's order where a
 * template body is given (what `type show --brief` prints beside the
 * skeleton, so the two agree), else in declaration order. A heading the
 * template does not carry follows the ones it does, in declaration order.
 */
export function sectionLines(effective: EffectiveType, template?: string): string[] {
  const sections = effective.sections;
  if (sections === undefined) return [];
  const ordered = [...sections.list];
  if (template !== undefined) {
    const rank = new Map<string, number>();
    for (const match of template.matchAll(/^#{1,6}[ \t]+(.*?)[ \t]*$/gmu)) {
      const identity = normalizeIdentity(match[1] ?? "");
      if (!rank.has(identity)) rank.set(identity, rank.size);
    }
    const rankOf = (heading: string): number =>
      rank.get(normalizeIdentity(heading)) ?? Number.MAX_SAFE_INTEGER;
    ordered.sort((a, b) => rankOf(a.heading) - rankOf(b.heading));
  }
  return ordered.map((entry) => {
    const declared = declaredParams(entry);
    const params = Object.keys(declared)
      .sort(codeUnitCompare)
      .map((key) => `${key}=${renderParam(declared[key])}`);
    if (entry.max_chars !== undefined) params.push(`max_chars=${entry.max_chars}`);
    if (entry.severity !== undefined) params.push(`severity=${entry.severity}`);
    const grammar = entry.grammar ?? "prose";
    return `${entry.heading} | ${grammar} | ${params.length > 0 ? params.join(" ") : "—"} | ${entry.contributedBy}`;
  });
}

/**
 * docs/cli.md §new: the page a type's declared sections require, with
 * `{{ title }}` where the title goes — merged with a template's body where the
 * type has one, so a template that predates a section declaration still
 * carries every heading its type requires. One renderer: `new` writes it and
 * `type show --brief` prints it.
 */
/** The four keys the engine composes itself at `new`; a template's values for them are never seeds. */
const ENGINE_FRONTMATTER_KEYS: ReadonlySet<string> = new Set([
  "type",
  "title",
  "description",
  "tags",
]);

/** A template's frontmatter value that seeds nothing: absent, empty text, an empty list, null. */
function isEmptySeed(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

/**
 * docs/constitution.md §Types: the type's template, resolved — a module's
 * registered bytes under the namespaced name, or the bundle's file at a vault
 * path — or `undefined` where the type declares none or the file is absent.
 * `body` is everything after the frontmatter, the skeleton `new` renders and
 * `type show --brief` prints. `seeds` are the frontmatter's non-empty values
 * under keys the type declares: what `new` writes into a field `--set` does
 * not name, and what the brief shows beside the field. The engine's own four
 * keys are never seeds, and an empty value (`""`, `[]`, `null`) is a stub
 * left standing, not a seed of nothing. The ONE resolver both verbs read, so
 * the skeleton an agent reads is the skeleton `new` writes. The registered
 * name is tried first: a kit's type arrives with its own seed, and a bundle
 * still overrides by declaring a path of its own.
 */
export function templateOf(
  root: string,
  vault: VaultOk,
  effective: EffectiveType,
): { body: string; seeds: Map<string, unknown> } | undefined {
  const declared = effective.template?.value;
  if (declared === undefined) return undefined;
  const registered = vault.modules.templates.get(declared);
  const source =
    registered ?? (existsSync(join(root, declared)) ? readPage(root, declared) : undefined);
  if (source === undefined) return undefined;
  const template = parseDoc(source);
  const body = template.source
    .split("\n")
    .slice(template.frontmatter.endLine)
    .join("\n")
    .replace(/^\n+/, "");
  const seeds = new Map<string, unknown>();
  for (const [field, value] of Object.entries(template.frontmatter.value)) {
    if (ENGINE_FRONTMATTER_KEYS.has(field) || isEmptySeed(value)) continue;
    if (!effective.fields.has(field)) continue;
    seeds.set(field, value);
  }
  return { body, seeds };
}

export function skeletonOf(effective: EffectiveType, template?: string): string {
  const required: string[] = [];
  for (const entry of effective.sections?.list ?? []) {
    if (entry.min < 1 || required.includes(entry.heading)) continue;
    required.push(entry.heading);
  }
  const depth = "#".repeat(effective.sections?.depth ?? 2);
  if (template === undefined) {
    return `${["# {{ title }}", ...required.flatMap((h) => ["", `${depth} ${h}`])].join("\n")}\n`;
  }
  const present = new Set(
    [...template.matchAll(/^#{1,6}[ \t]+(.*?)[ \t]*$/gmu)].map((m) =>
      normalizeIdentity(m[1] ?? ""),
    ),
  );
  const missing = required.filter((h) => !present.has(normalizeIdentity(h)));
  if (missing.length === 0) return template;
  return `${template.replace(/\n*$/u, "")}\n${missing.map((h) => `\n${depth} ${h}\n`).join("")}`;
}

export function summarize(findings: Finding[], pages: number) {
  // docs/concepts.md §Section grammar: a census is only useful as a count. `by_rule` carries
  // every rule that fired, keyed in code-unit order so the envelope is
  // byte-stable across engines.
  const counts = new Map<string, number>();
  for (const finding of findings) {
    counts.set(finding.ruleId, (counts.get(finding.ruleId) ?? 0) + 1);
  }
  const by_rule: Record<string, number> = {};
  for (const ruleId of [...counts.keys()].sort(codeUnitCompare)) {
    by_rule[ruleId] = counts.get(ruleId) ?? 0;
  }
  return {
    pages,
    errors: findings.filter((f) => f.severity === "error").length,
    warnings: findings.filter((f) => f.severity === "warning").length,
    infos: findings.filter((f) => f.severity === "info").length,
    by_rule,
  };
}

/**
 * Template hygiene — a declared template's placeholders must be ones
 * `new` substitutes, and a template no type declares is dead weight the
 * bundle should see. Warnings: judgment, never a blocked commit.
 */
const KNOWN_PLACEHOLDERS = new Set(["title"]);

export function templateFindings(root: string, vault: VaultOk): Finding[] {
  const findings: Finding[] = [];
  const declared = new Set<string>();
  for (const effective of vault.registry.types.values()) {
    for (const file of [effective.template?.value, effective.example?.value]) {
      if (file !== undefined) declared.add(file);
    }
  }
  for (const effective of vault.registry.types.values()) {
    const template = effective.template?.value;
    if (template === undefined) continue;
    // docs/extending.md §What a module registers: a module-contributed template is
    // bytes the engine already holds, not a file in the bundle. Its placeholders
    // are checked the same way; only where the bytes come from differs.
    const registered = vault.modules.templates.get(template);
    const abs = join(root, template);
    if (registered === undefined && !existsSync(abs)) continue;
    const text = registered ?? readPage(root, template);
    // Template hygiene: a frontmatter key the type does not declare is
    // a seed of nothing — it lands on no page `new` writes and it names a
    // field the type has not, so the template lies about the type.
    for (const key of Object.keys(parseDoc(text).frontmatter.value)) {
      if (ENGINE_FRONTMATTER_KEYS.has(key) || effective.fields.has(key)) continue;
      findings.push({
        ruleId: "template-field-unknown",
        severity: "warning",
        path: template,
        message: `frontmatter key "${key}" is not a field of ${effective.name}`,
        remediation: `declare "${key}" on the type, or remove it from the template`,
        contributedBy: "engine",
        layer: "constitution",
      });
    }
    for (const match of text.matchAll(/\{\{\s*([^}]*?)\s*\}\}/gu)) {
      const name = (match[1] ?? "").trim();
      if (KNOWN_PLACEHOLDERS.has(name)) continue;
      findings.push({
        ruleId: "template-placeholder-unknown",
        severity: "warning",
        path: template,
        message: `unknown placeholder "{{ ${name} }}" — new substitutes ${[...KNOWN_PLACEHOLDERS].join(", ")}`,
        remediation: "remove the placeholder, or seed the value as a stub field",
        contributedBy: "engine",
        layer: "constitution",
      });
    }
  }
  // The bundle's own declarations say where its templates live — the engine
  // never assumes a templates/ directory it owns. A bundle that declares none
  // is scanned nowhere. An example may be a real corpus page, so paths under
  // content_roots are pages rather than orphan template candidates.
  const contentRoots = vault.engine.content_roots ?? [];
  const templateDirs = new Set(
    [...declared].map((f) => f.split("/").slice(0, -1).join("/")).filter((d) => d.length > 0),
  );
  for (const dir of [...templateDirs].sort(codeUnitCompare)) {
    const abs = join(root, dir);
    if (!existsSync(abs)) continue;
    const containedDir = vaultReadAbsolute(root, dir);
    for (const entry of readdirSync(containedDir, { recursive: true, encoding: "utf8" })) {
      const rel =
        `${dir}/${process.platform === "win32" ? entry.replaceAll("\\", "/") : entry}`.normalize(
          "NFC",
        );
      if (!rel.endsWith(".md")) continue;
      if (declared.has(rel)) continue;
      if (isContentPath(rel, contentRoots)) continue;
      findings.push({
        ruleId: "template-orphan",
        severity: "warning",
        path: rel,
        message: "no registered type declares this template or example",
        remediation: "declare it on a type, or remove it",
        contributedBy: "engine",
        layer: "constitution",
      });
    }
  }
  return findings;
}

/** The diff-driven review: former folder segments still carried as tags. */
export function formerFolderTagFindings(
  oldPath: string,
  newPath: string,
  doc: ParsedDoc,
  roots: readonly string[],
): Finding[] {
  const currentSegments = new Set(folderSegmentsFor(newPath, roots).map(segmentIdentity));
  const tags = doc.frontmatter.value["tags"];
  const pageTags = Array.isArray(tags)
    ? tags.filter((t): t is string => typeof t === "string")
    : [];
  const findings: Finding[] = [];
  for (const former of folderSegmentsFor(oldPath, roots)) {
    const identity = segmentIdentity(former);
    if (!currentSegments.has(identity) && pageTags.some((t) => segmentIdentity(t) === identity)) {
      findings.push({
        ruleId: "former-folder-tags-review",
        severity: "warning",
        path: newPath,
        message: `former folder segment "${former}" is still present as a tag`,
        remediation: "confirm it as a deliberate cross-cutting membership or remove it",
        contributedBy: "engine",
        layer: "constitution",
      });
    }
  }
  return findings;
}
