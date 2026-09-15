// docs/constitution.md §Types (duplicate basenames, aliases, alias-to-basename,
// duplicate titles all hard-fail vault-wide; every comparison goes through
// normalizeIdentity; the canonical name is the basename, and aliases resolve
// for diagnostics, never as sanctioned link targets).
import { type FieldSources, resolveTitle } from "../fields/index.ts";
import { normalizeIdentity } from "../identity/index.ts";
import type { Finding } from "../lint/index.ts";
import type { ParsedDoc } from "../parse/index.ts";
import { basenameOf } from "./basename.ts";

export interface NamedPage {
  path: string;
  doc: ParsedDoc;
}

export interface NameEntry {
  path: string;
  viaAlias: boolean;
}

export interface NameIndex {
  resolve(name: string): NameEntry | undefined;
  /** The declared type of the page a name resolves to, for `target_type` / `range`. */
  typeOf(name: string): string | undefined;
}

function aliasesOf(doc: ParsedDoc): string[] {
  const raw = doc.frontmatter.value["aliases"];
  if (!Array.isArray(raw)) return [];
  return raw.filter((a): a is string => typeof a === "string");
}

export function buildNameIndex(pages: NamedPage[]): NameIndex {
  const entries = new Map<string, NameEntry>();
  const typesByPath = new Map<string, string>();
  for (const page of pages) {
    entries.set(normalizeIdentity(basenameOf(page.path)), { path: page.path, viaAlias: false });
    const declared = page.doc.frontmatter.value["type"];
    if (typeof declared === "string") typesByPath.set(page.path, declared);
  }
  for (const page of pages) {
    for (const alias of aliasesOf(page.doc)) {
      const identity = normalizeIdentity(alias);
      if (!entries.has(identity)) entries.set(identity, { path: page.path, viaAlias: true });
    }
  }
  const resolve = (name: string): NameEntry | undefined => entries.get(normalizeIdentity(name));
  return {
    resolve,
    typeOf: (name) => {
      const entry = resolve(name);
      return entry === undefined ? undefined : typesByPath.get(entry.path);
    },
  };
}

/** Vault-wide identity collisions as findings. Pure; sorted by path. */
export function checkVaultIdentity(
  pages: NamedPage[],
  options?: { fieldSources?: FieldSources | undefined },
): Finding[] {
  const findings: Finding[] = [];
  const collide = (path: string, message: string): void => {
    findings.push({
      ruleId: "identity-collision",
      severity: "error",
      path,
      message,
      contributedBy: "engine",
      layer: "constitution",
    });
  };

  const nameOwners = new Map<
    string,
    { path: string; kind: "basename" | "alias"; display: string }
  >();
  const sorted = [...pages].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (const page of sorted) {
    const display = basenameOf(page.path);
    const identity = normalizeIdentity(display);
    const owner = nameOwners.get(identity);
    if (owner !== undefined && owner.path !== page.path) {
      collide(
        page.path,
        `basename "${display}" collides with ${owner.kind} "${owner.display}" on ${owner.path}`,
      );
    } else {
      nameOwners.set(identity, { path: page.path, kind: "basename", display });
    }
  }
  for (const page of sorted) {
    for (const alias of aliasesOf(page.doc)) {
      const identity = normalizeIdentity(alias);
      const owner = nameOwners.get(identity);
      if (owner !== undefined && owner.path !== page.path) {
        collide(
          page.path,
          `alias "${alias}" collides with ${owner.kind} "${owner.display}" on ${owner.path}`,
        );
      } else if (owner === undefined) {
        nameOwners.set(identity, { path: page.path, kind: "alias", display: alias });
      }
    }
  }
  // Titles participate in identity RESOLVED — a derived title
  // (basename under field_sources) collides exactly like an explicit one, and
  // a title claiming another page's basename or alias is the same ambiguity
  // names.resolve would trip over.
  const titleOwners = new Map<string, { path: string; display: string }>();
  for (const page of sorted) {
    const title = resolveTitle(page.doc, page.path, options?.fieldSources);
    if (title === null) continue;
    const identity = normalizeIdentity(title);
    // A title equal to the page's OWN basename adds no identity information —
    // it is fully the basename pass's territory, and judging it here would
    // double-count every such collision (review wf_52acf5e4 #0).
    if (identity === normalizeIdentity(basenameOf(page.path))) continue;
    const nameOwner = nameOwners.get(identity);
    if (nameOwner !== undefined && nameOwner.path !== page.path) {
      collide(
        page.path,
        `title "${title}" collides with ${nameOwner.kind} "${nameOwner.display}" on ${nameOwner.path}`,
      );
      continue;
    }
    const owner = titleOwners.get(identity);
    if (owner !== undefined && owner.path !== page.path) {
      collide(page.path, `title "${title}" duplicates the title of ${owner.path}`);
    } else {
      titleOwners.set(identity, { path: page.path, display: title });
    }
  }
  return findings;
}

export { basenameOf };
