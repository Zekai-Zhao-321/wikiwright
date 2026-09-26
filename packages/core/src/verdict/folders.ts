// v2 contracts §2 (`folder_tags` and `folder_tag_aliases`, "as today"): the
// folder-tag policy, judged over the v2 page reader. Off unless engine.json
// sets `folder_tags.mode`; under `validate` and `materialize-add-only` every
// directory segment between a content root and a page must be a registered
// entry of the bundle's `tags` vocabulary (`folder-segment-registered`) and a
// tag the page carries (`folder-tags-present`); after a rename, a tag naming a
// segment the page left is a judgment (`former-folder-tags-review`).
//
// Ported by id from the old per-page pass (lint/index.ts) and the rename
// review (packages/cli/src/pages.ts): the segment identity (normalizeIdentity
// with spaces and underscores folded to hyphens), a segment alias resolving
// to its governing tag before matching, and the missing tag named by its
// registered spelling, which is what `check --fix` writes. Changed: the
// finding names its fix only under `materialize-add-only` (`details.
// materialize`), where `check --fix` runs the add-only materializer; under
// `validate` it queues, as the old row's lane did.
import { normalizeIdentity } from "../identity/index.ts";
import type { ParsedPage } from "../interface/index.ts";
import type { LawVocabulary } from "../law/compose.ts";
import type { EngineV4 } from "../law/engine.ts";
import { PAGE_LOCATION, type Unrouted } from "./page.ts";

/** Segment↔tag identity: normalizeIdentity with separators folded to a hyphen. */
export function segmentIdentity(segment: string): string {
  return normalizeIdentity(segment.replaceAll(/[\s_]+/gu, "-"));
}

/** The directory segments between the content root a page is under and the page. */
export function folderSegments(path: string, roots: readonly string[]): string[] {
  const root = roots.find((r) => path.startsWith(`${r}/`));
  if (root === undefined) return [];
  return path
    .slice(root.length + 1)
    .split("/")
    .slice(0, -1);
}

function pageTags(page: ParsedPage): string[] | undefined {
  const raw = page.frontmatter["tags"];
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return undefined;
  return raw.filter((t): t is string => typeof t === "string");
}

/** The missing tags a page's folders call for, by their registered spelling. */
export function missingFolderTags(
  path: string,
  page: ParsedPage,
  engine: EngineV4,
  tags: LawVocabulary | undefined,
): string[] {
  if (engine.folder_tags.mode === "off") return [];
  const carried = pageTags(page);
  if (carried === undefined) return [];
  const aliases = engine.folder_tag_aliases;
  const entries = [...(tags?.entries.keys() ?? [])];
  const registered = (segment: string): string =>
    entries.find((e) => segmentIdentity(e) === segmentIdentity(segment)) ?? segment;
  return folderSegments(path, engine.content_roots)
    .map((segment) => aliases[segment] ?? segment)
    .filter((segment) => !carried.some((t) => segmentIdentity(t) === segmentIdentity(segment)))
    .map(registered);
}

/** `folder-segment-registered` and `folder-tags-present` on one page. */
export function folderFindings(
  path: string,
  page: ParsedPage,
  engine: EngineV4,
  tags: LawVocabulary | undefined,
): Unrouted[] {
  const mode = engine.folder_tags.mode;
  if (mode === "off") return [];
  const out: Unrouted[] = [];
  const aliases = engine.folder_tag_aliases;
  const known = new Set([...(tags?.entries.keys() ?? [])].map(segmentIdentity));
  for (const raw of folderSegments(path, engine.content_roots)) {
    const segment = aliases[raw] ?? raw;
    if (known.has(segmentIdentity(segment))) continue;
    out.push({
      rule: "folder-segment-registered",
      severity: "error",
      path,
      location: PAGE_LOCATION,
      message: `folder segment "${segment}" is not an entry of the tags vocabulary`,
      details: { segment, pointer: "/tags" },
    });
  }
  const missing = missingFolderTags(path, page, engine, tags);
  if (missing.length > 0) {
    out.push({
      rule: "folder-tags-present",
      severity: "error",
      path,
      location: PAGE_LOCATION,
      message: `tags missing the page's folder segments: ${missing.join(", ")}`,
      details: { missing, pointer: "/tags", materialize: mode === "materialize-add-only" },
    });
  }
  return out;
}

/** `former-folder-tags-review`: a tag that names a folder segment the renamed page left. */
export function formerFolderFindings(
  from: string,
  path: string,
  page: ParsedPage,
  engine: EngineV4,
): Unrouted[] {
  if (engine.folder_tags.mode === "off") return [];
  const now = new Set(folderSegments(path, engine.content_roots).map(segmentIdentity));
  const carried = pageTags(page) ?? [];
  const out: Unrouted[] = [];
  for (const former of folderSegments(from, engine.content_roots)) {
    const identity = segmentIdentity(former);
    if (now.has(identity) || !carried.some((t) => segmentIdentity(t) === identity)) continue;
    out.push({
      rule: "former-folder-tags-review",
      severity: "warning",
      path,
      location: PAGE_LOCATION,
      message: `the tag for the former folder segment "${former}" is still on the page: a deliberate membership, or one to remove`,
      details: { segment: former, from, pointer: "/tags" },
    });
  }
  return out;
}
