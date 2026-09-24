// docs/constitution.md §exports (the marker a copy carries, `config/export.json`)
// · docs/cli.md §The envelope (a copy names the export it is).
//
// Reads only. The marker is read through the contained reader, parsed, and
// checked key by key against the shape the renderer writes; nothing here
// loads a law or parses a page, so the check is answered before any module
// preloads.
import {
  type ExportContribution,
  type ExportSelect,
  isSkillName,
  normalizeInput,
} from "@wikiwright/core";
import { fsReader } from "./vaultfiles.ts";

/** docs/constitution.md §exports: the marker a copy carries. */
export const MARKER_PATH = "config/export.json";

/** docs/constitution.md §exports: `config/export.json`, in its fixed key order. */
export interface ExportMarker {
  schema: "wikiwright/export";
  version: 1;
  name: string;
  bundle: string;
  select: ExportSelect;
  sources: "exclude" | "include";
  output: "skills" | "external";
  links: "closed" | "cut";
  cut: { links: number; citations: number; attachments: number };
  pages: number;
  source: { repository: string | null; law: string; content: string };
  contribution: ExportContribution;
  guide: string | null;
  license: string | null;
  engine: string;
}

/** What a root's marker is: absent, a marker, or a file that is not one and why. */
export type MarkerRead =
  | { kind: "none" }
  | { kind: "valid"; marker: ExportMarker }
  | { kind: "invalid"; reason: string };

const MARKER_KEYS = [
  "schema",
  "version",
  "name",
  "bundle",
  "select",
  "sources",
  "output",
  "links",
  "cut",
  "pages",
  "source",
  "contribution",
  "guide",
  "license",
  "engine",
] as const;

const DIGEST = /^[0-9a-f]{64}$/u;

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every((item) => typeof item === "string" && item.length > 0);

/** The keys of `value` that `allowed` does not name, in the order they appear. */
function unknownKeys(value: Json, allowed: readonly string[]): string[] {
  return Object.keys(value).filter((key) => !allowed.includes(key));
}

function oneOf(value: unknown, allowed: readonly string[]): boolean {
  return typeof value === "string" && allowed.includes(value);
}

/**
 * The marker `raw` is, or the first reason it is not one: every key the
 * renderer writes, of the type it writes, and no other. A marker names a
 * schema and a version, so a copy cut by a later format is refused by name
 * rather than read as this one.
 */
export function markerOf(raw: unknown): ExportMarker | string {
  if (!isObject(raw)) return "the marker is not a JSON object";
  const extra = unknownKeys(raw, MARKER_KEYS);
  if (extra.length > 0) return `"${extra[0]}" is not a marker key`;
  for (const key of MARKER_KEYS) {
    if (!(key in raw)) return `"${key}" is missing`;
  }
  if (raw["schema"] !== "wikiwright/export") return '"schema" is not "wikiwright/export"';
  if (raw["version"] !== 1) return '"version" is not 1';
  if (typeof raw["name"] !== "string" || !isSkillName(raw["name"])) {
    return '"name" is not a skill name';
  }
  if (typeof raw["bundle"] !== "string" || raw["bundle"].length === 0) {
    return '"bundle" is not a non-empty string';
  }
  const select = raw["select"];
  if (!isObject(select)) return '"select" is not an object';
  if (select["kind"] === "all") {
    if (unknownKeys(select, ["kind"]).length > 0) return '"select" carries a key "all" does not';
  } else if (select["kind"] === "tag") {
    if (unknownKeys(select, ["kind", "tags"]).length > 0 || !isStringList(select["tags"])) {
      return '"select.tags" is not a non-empty list of tags';
    }
  } else if (select["kind"] === "directory") {
    if (
      unknownKeys(select, ["kind", "directories"]).length > 0 ||
      !isStringList(select["directories"])
    ) {
      return '"select.directories" is not a non-empty list of directories';
    }
  } else {
    return '"select.kind" is not one of all, tag, directory';
  }
  if (!oneOf(raw["sources"], ["exclude", "include"])) return '"sources" is not exclude or include';
  if (!oneOf(raw["output"], ["skills", "external"])) return '"output" is not skills or external';
  if (!oneOf(raw["links"], ["closed", "cut"])) return '"links" is not closed or cut';
  const cut = raw["cut"];
  if (
    !isObject(cut) ||
    unknownKeys(cut, ["links", "citations", "attachments"]).length > 0 ||
    !isCount(cut["links"]) ||
    !isCount(cut["citations"]) ||
    !isCount(cut["attachments"])
  ) {
    return '"cut" is not three counts: links, citations, attachments';
  }
  if (!isCount(raw["pages"])) return '"pages" is not a count';
  const source = raw["source"];
  if (
    !isObject(source) ||
    unknownKeys(source, ["repository", "law", "content"]).length > 0 ||
    !(source["repository"] === null || typeof source["repository"] === "string") ||
    typeof source["law"] !== "string" ||
    !DIGEST.test(source["law"]) ||
    typeof source["content"] !== "string" ||
    !DIGEST.test(source["content"])
  ) {
    return '"source" is not a repository (or null) and two sha256 digests, law and content';
  }
  const contribution = raw["contribution"];
  if (
    !isObject(contribution) ||
    unknownKeys(contribution, ["mode", "repository", "folder"]).length > 0 ||
    !oneOf(contribution["mode"], ["issues", "pull-requests", "local-folder", "none"]) ||
    (contribution["repository"] !== undefined && typeof contribution["repository"] !== "string") ||
    (contribution["folder"] !== undefined && typeof contribution["folder"] !== "string")
  ) {
    return '"contribution" is not a mode, with an optional repository or folder';
  }
  for (const key of ["guide", "license"] as const) {
    if (!(raw[key] === null || typeof raw[key] === "string"))
      return `"${key}" is not a string or null`;
  }
  if (typeof raw["engine"] !== "string" || raw["engine"].length === 0) {
    return '"engine" is not a non-empty string';
  }
  return raw as unknown as ExportMarker;
}

/**
 * docs/cli.md §The envelope: the marker at `root`, read through the contained
 * reader. A marker that cannot be read inside the root, is not JSON, or is not
 * the shape the renderer writes is `invalid`, with the reason; it never throws.
 */
export function markerAt(root: string): MarkerRead {
  let text: string;
  try {
    const reader = fsReader(root);
    if (!reader.exists(MARKER_PATH)) return { kind: "none" };
    text = reader.read(MARKER_PATH);
  } catch (e) {
    return { kind: "invalid", reason: e instanceof Error ? e.message : String(e) };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(normalizeInput(text).text);
  } catch (e) {
    return {
      kind: "invalid",
      reason: `not JSON: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  const marker = markerOf(raw);
  return typeof marker === "string"
    ? { kind: "invalid", reason: marker }
    : { kind: "valid", marker };
}
