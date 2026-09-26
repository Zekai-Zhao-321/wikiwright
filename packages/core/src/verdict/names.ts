// v2 contracts §10 (the judge's name index and link resolution, carried by
// id: identity-collision, wikilink-unresolved, wikilink-alias-target, and
// relation targets resolved from it, §4).
//
// Ported from the old name index (names/index.ts) over the v2 page reader:
// the canonical name of a page is its basename, an alias resolves (for a
// diagnostic, never as a sanctioned link target), a title participates in
// identity as written or as the basename `field_sources.title` derives, and
// every comparison goes through normalizeIdentity. Changed: a resolved name
// carries the type the target's frontmatter names, which a relation record,
// `facts.links` and `target_type` read.
import { normalizeIdentity } from "../identity/index.ts";
import { basenameOf } from "../names/basename.ts";

/** What the index knows of one page: its path and its frontmatter. */
export interface NamedPage {
  path: string;
  frontmatter: Record<string, unknown>;
}

export interface VaultNameEntry {
  path: string;
  viaAlias: boolean;
  /** The type the target's frontmatter names, `null` when it names none. */
  type: string | null;
}

export interface VaultNames {
  resolve(name: string): VaultNameEntry | undefined;
}

function aliasesOf(page: NamedPage): string[] {
  const raw = page.frontmatter["aliases"];
  if (!Array.isArray(raw)) return [];
  return raw.filter((a): a is string => typeof a === "string");
}

function typeOf(page: NamedPage): string | null {
  const declared = page.frontmatter["type"];
  return typeof declared === "string" && declared !== "" ? declared : null;
}

/** The title a page carries, written or derived from its basename. */
export function titleOf(page: NamedPage, titleFromBasename: boolean): string | null {
  const explicit = page.frontmatter["title"];
  if (typeof explicit === "string") return explicit;
  return titleFromBasename ? basenameOf(page.path) : null;
}

export function buildNames(pages: readonly NamedPage[]): VaultNames {
  const entries = new Map<string, VaultNameEntry>();
  for (const page of pages) {
    entries.set(normalizeIdentity(basenameOf(page.path)), {
      path: page.path,
      viaAlias: false,
      type: typeOf(page),
    });
  }
  for (const page of pages) {
    for (const alias of aliasesOf(page)) {
      const identity = normalizeIdentity(alias);
      if (!entries.has(identity))
        entries.set(identity, { path: page.path, viaAlias: true, type: typeOf(page) });
    }
  }
  return { resolve: (name) => entries.get(normalizeIdentity(name.trim())) };
}

export interface Collision {
  path: string;
  message: string;
  details: Record<string, unknown>;
}

/**
 * Vault-wide identity collisions: a basename, an alias or a title that names
 * two pages. In path order, each reported on the page that came second.
 */
export function identityCollisions(
  pages: readonly NamedPage[],
  titleFromBasename: boolean,
): Collision[] {
  const out: Collision[] = [];
  const collide = (path: string, message: string, name: string, other: string): void => {
    out.push({ path, message, details: { name, other } });
  };
  const owners = new Map<string, { path: string; kind: "basename" | "alias"; display: string }>();
  const sorted = [...pages].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (const page of sorted) {
    const display = basenameOf(page.path);
    const identity = normalizeIdentity(display);
    const owner = owners.get(identity);
    if (owner !== undefined && owner.path !== page.path) {
      collide(
        page.path,
        `basename "${display}" collides with ${owner.kind} "${owner.display}" on ${owner.path}`,
        display,
        owner.path,
      );
    } else owners.set(identity, { path: page.path, kind: "basename", display });
  }
  for (const page of sorted) {
    for (const alias of aliasesOf(page)) {
      const identity = normalizeIdentity(alias);
      const owner = owners.get(identity);
      if (owner !== undefined && owner.path !== page.path) {
        collide(
          page.path,
          `alias "${alias}" collides with ${owner.kind} "${owner.display}" on ${owner.path}`,
          alias,
          owner.path,
        );
      } else if (owner === undefined) {
        owners.set(identity, { path: page.path, kind: "alias", display: alias });
      }
    }
  }
  const titles = new Map<string, string>();
  for (const page of sorted) {
    const title = titleOf(page, titleFromBasename);
    if (title === null) continue;
    const identity = normalizeIdentity(title);
    // A title equal to the page's own basename says nothing the basename did not.
    if (identity === normalizeIdentity(basenameOf(page.path))) continue;
    const owner = owners.get(identity);
    if (owner !== undefined && owner.path !== page.path) {
      collide(
        page.path,
        `title "${title}" collides with ${owner.kind} "${owner.display}" on ${owner.path}`,
        title,
        owner.path,
      );
      continue;
    }
    const prior = titles.get(identity);
    if (prior !== undefined && prior !== page.path) {
      collide(page.path, `title "${title}" duplicates the title of ${prior}`, title, prior);
    } else titles.set(identity, page.path);
  }
  return out;
}
