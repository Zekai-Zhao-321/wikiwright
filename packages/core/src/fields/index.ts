// docs/cli.md §lint (field_sources) · derivation produces ONE
// effective page model — lint, manifest, graph, and search must see identical
// resolved values.
import { basenameOf } from "../names/basename.ts";
import type { ParsedDoc } from "../parse/index.ts";

export interface FieldSources {
  title?: "basename";
  description?: "lede";
}

/** The first non-empty, non-heading body line — the page's lede. */
export function ledeOf(doc: ParsedDoc): string | null {
  const lines = doc.source.split("\n").slice(doc.frontmatter.endLine);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    return trimmed;
  }
  return null;
}

export function resolveTitle(
  doc: ParsedDoc,
  path: string,
  fieldSources?: FieldSources,
): string | null {
  const explicit = doc.frontmatter.value["title"];
  if (typeof explicit === "string") return explicit;
  if (fieldSources?.title === "basename") return basenameOf(path);
  return null;
}

export function resolveDescription(doc: ParsedDoc, fieldSources?: FieldSources): string | null {
  const explicit = doc.frontmatter.value["description"];
  if (typeof explicit === "string") return explicit;
  if (fieldSources?.description === "lede") return ledeOf(doc);
  return null;
}
