// v2 contracts §4, §5: a page as rules see it.
//
// A page is read from its bytes: the frontmatter as YAML 1.2 core (integers
// as `int`), the body as the bytes after the closing `---` line, and every
// heading as a section occurrence — its heading path, its location as a line
// and a UTF-8 byte span, its raw text, and, under a heading the page's type
// declares with a grammar, the records of §4. From that the page interface
// is built: `page`, `section` (per occurrence), `facts`, `before`, `config`,
// the five variables a CEL rule is bound to (identity `page-interface/1`).
//
// Unavailable to a rule, by construction: git history, another page's body,
// files, the network, and time.
import { pageDigest } from "../digest/index.ts";
import { normalizeIdentity } from "../identity/index.ts";
import type { LawType } from "../law/compose.ts";
import type { TypeLaw } from "../law/load.ts";
import { utf8Text } from "../law/text.ts";
import { isMapping, readYaml } from "../law/yaml.ts";
import { parseDoc } from "../parse/index.ts";
import {
  type GrammarRecord,
  type Location,
  parseClaimLine,
  parseEntryLine,
  parseRelationLine,
  type ResolveTarget,
} from "../records/index.ts";
import { recordValidators } from "../records/schemas.ts";
import { parseUrl } from "../schema/formats.ts";
import { PAGE_BYTES_MAX } from "./identity.ts";

export { PAGE_BYTES_MAX, PAGE_INTERFACE } from "./identity.ts";

export interface Occurrence {
  heading: string;
  depth: number;
  /** The headings from the outermost enclosing one to this one. */
  path: string[];
  location: Location;
  raw: string;
  items: GrammarRecord[];
}

/** §4 `item-unparsed`: a top-level list item under a grammar that did not parse. */
export interface UnparsedItem {
  heading: string;
  occurrence: number;
  line: number;
  raw: string;
  reason: string;
}

export interface ParsedPage {
  path: string;
  /** The frontmatter as parsed; `{}` when there is none or it did not parse. */
  frontmatter: Record<string, unknown>;
  /** Why the frontmatter did not parse, when it did not. */
  frontmatterError?: string;
  /** The raw bytes between the fences, when there are fences. */
  frontmatterBytes: Uint8Array | null;
  body: string;
  bodyBytes: Uint8Array;
  occurrences: Occurrence[];
  unparsed: UnparsedItem[];
  /** Every wikilink target in the body, as written. */
  links: string[];
  /** The type the frontmatter names, when the law declares it. */
  type?: LawType;
}

export type PageRead =
  | { ok: true; page: ParsedPage }
  | { ok: false; code: "page-too-large" | "page-not-utf8"; message: string };

function utf8Length(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4;
      i += 1;
    } else n += 3;
  }
  return n;
}

interface Line {
  /** The line as written, a trailing CR kept. */
  raw: string;
  /** The line without its CR. */
  text: string;
  startChar: number;
  endChar: number;
  startByte: number;
  endByte: number;
}

function linesOf(text: string): Line[] {
  const out: Line[] = [];
  let char = 0;
  let byte = 0;
  for (const raw of text.split("\n")) {
    const length = utf8Length(raw);
    out.push({
      raw,
      text: raw.endsWith("\r") ? raw.slice(0, -1) : raw,
      startChar: char,
      endChar: char + raw.length - (raw.endsWith("\r") ? 1 : 0),
      startByte: byte,
      endByte: byte + length - (raw.endsWith("\r") ? 1 : 0),
    });
    char += raw.length + 1;
    byte += length + 1;
  }
  return out;
}

const LIST_ITEM = /^(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/u;

/**
 * Read a page. `law` supplies the type, its sections and the source roots;
 * `resolve` finds a relation's target in the vault (absent: nothing resolves).
 */
export function parsePage(
  path: string,
  bytes: Uint8Array,
  law: TypeLaw,
  resolve: ResolveTarget = () => undefined,
): PageRead {
  if (bytes.length > PAGE_BYTES_MAX) {
    return {
      ok: false,
      code: "page-too-large",
      message: `${path} is ${bytes.length} bytes; a page is at most ${PAGE_BYTES_MAX}`,
    };
  }
  const text = utf8Text(bytes);
  if (text === undefined)
    return { ok: false, code: "page-not-utf8", message: `${path} is not UTF-8` };
  const lines = linesOf(text);
  const bom = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const first = lines[0]?.text.slice(bom);

  // The frontmatter: `---` on the first line to the next `---` line.
  let frontmatter: Record<string, unknown> = {};
  let frontmatterError: string | undefined;
  let frontmatterBytes: Uint8Array | null = null;
  let bodyLine = 0;
  if (first === "---") {
    const close = lines.findIndex((l, i) => i > 0 && l.text === "---");
    if (close > 0) {
      const open = lines[0] as Line;
      const end = lines[close] as Line;
      const inner = text.slice(open.startChar + open.raw.length + 1, end.startChar);
      frontmatterBytes = bytes.slice(open.startByte + utf8Length(open.raw) + 1, end.startByte);
      const read = readYaml(inner);
      if (!read.ok) frontmatterError = read.message;
      else if (read.value === null) frontmatter = {};
      else if (!isMapping(read.value)) frontmatterError = "the frontmatter is not a mapping";
      else frontmatter = read.value;
      bodyLine = close + 1;
    }
  }
  const bodyStartByte = bodyLine === 0 ? 0 : (lines[bodyLine]?.startByte ?? bytes.length);
  const bodyStartChar = bodyLine === 0 ? 0 : (lines[bodyLine]?.startChar ?? text.length);
  const body = bodyStartChar >= text.length ? "" : text.slice(bodyStartChar);
  const bodyBytes = bodyStartByte >= bytes.length ? new Uint8Array() : bytes.slice(bodyStartByte);

  const typeName = frontmatter["type"];
  const type = typeof typeName === "string" ? law.types.get(typeName) : undefined;
  const sections = type?.sections ?? null;

  // Headings and fences as CommonMark reads them (the old parser's
  // projection, kept: headings with their text, fenced blocks by line).
  const doc = parseDoc(text);
  const fenced = new Set<number>();
  for (const fence of doc.fences)
    for (let i = fence.line; i <= fence.endLine; i += 1) fenced.add(i);
  const headings = doc.headings.filter((h) => h.line > bodyLine);

  const occurrences: Occurrence[] = [];
  const unparsed: UnparsedItem[] = [];
  const stack: { depth: number; heading: string }[] = [];
  const seen = new Map<string, number>();
  headings.forEach((heading, index) => {
    while (stack.length > 0 && (stack[stack.length - 1]?.depth ?? 0) >= heading.depth) stack.pop();
    stack.push({ depth: heading.depth, heading: heading.text });
    const next = headings.slice(index + 1).find((h) => h.depth <= heading.depth);
    const lastLine = (next?.line ?? lines.length + 1) - 1;
    const directEnd = (headings[index + 1]?.line ?? lines.length + 1) - 1;
    const startLine = lines[heading.line - 1] as Line;
    let endLine = lines[lastLine - 1] ?? startLine;
    // A section's span ends at its last line with content, not at the blank
    // lines before the next heading.
    for (let n = lastLine; n > heading.line && (lines[n - 1]?.text.trim() ?? "") === ""; n -= 1) {
      endLine = lines[n - 2] ?? startLine;
    }
    const occurrence: Occurrence = {
      heading: heading.text,
      depth: heading.depth,
      path: stack.map((s) => s.heading),
      location: { line: heading.line, span: [startLine.startByte, endLine.endByte] },
      raw: text.slice(startLine.startChar, endLine.endChar),
      items: [],
    };
    const count = seen.get(heading.text) ?? 0;
    seen.set(heading.text, count + 1);
    occurrences.push(occurrence);
    const declared =
      sections !== null && heading.depth === sections.depth
        ? sections.list.find((s) => s.heading === heading.text)
        : undefined;
    const grammar = declared?.grammar;
    if (grammar === undefined) return;
    // A setext heading's underline is not content.
    const contentFrom = startLine.text.trimStart().startsWith("#")
      ? heading.line + 1
      : heading.line + 2;
    let current:
      | {
          record: Omit<GrammarRecord, "rationale" | "raw" | "location"> | undefined;
          line: Line;
          lineNo: number;
          rationale: Line[];
          reason?: string;
        }
      | undefined;
    const flush = (): void => {
      if (current === undefined) return;
      const last = current.rationale[current.rationale.length - 1] ?? current.line;
      const location: Location = {
        line: current.lineNo,
        span: [current.line.startByte, last.endByte],
      };
      const record = current.record;
      const finished =
        record === undefined
          ? undefined
          : ({
              ...record,
              rationale: current.rationale.map((l) => l.text),
              raw: current.line.text,
              location,
            } as GrammarRecord);
      const validate = recordValidators().get(`item-${record?.kind ?? ""}`);
      if (finished !== undefined && validate?.(finished) === true) occurrence.items.push(finished);
      else {
        unparsed.push({
          heading: heading.text,
          occurrence: count,
          line: current.lineNo,
          raw: current.line.text,
          reason:
            current.reason ??
            `the record does not conform to item-${record?.kind ?? "?"}: ${(validate?.errors ?? []).map((e) => `${e.instancePath} ${e.message}`).join("; ")}`,
        });
      }
      current = undefined;
    };
    for (let n = contentFrom; n <= directEnd; n += 1) {
      const line = lines[n - 1];
      if (line === undefined || fenced.has(n)) continue;
      if (line.text.trim() === "") continue;
      const indented = /^[ \t]/u.test(line.text);
      if (indented) {
        // §4 rationale: the lines indented under an item, verbatim.
        if (current !== undefined) current.rationale.push(line);
        continue;
      }
      flush();
      if (!LIST_ITEM.test(line.text)) continue; // prose between items
      const parsed =
        grammar === "claims"
          ? parseClaimLine(line.text, law.engine.source_roots)
          : grammar === "relations"
            ? parseRelationLine(line.text, resolve)
            : parseEntryLine(line.text);
      current =
        "record" in parsed
          ? { record: parsed.record, line, lineNo: n, rationale: [] }
          : { record: undefined, line, lineNo: n, rationale: [], reason: parsed.reason };
    }
    flush();
  });

  const out: ParsedPage = {
    path,
    frontmatter,
    frontmatterBytes,
    body,
    bodyBytes,
    occurrences,
    unparsed,
    links: doc.wikilinks.map((l) => l.target),
  };
  if (frontmatterError !== undefined) out.frontmatterError = frontmatterError;
  if (type !== undefined) out.type = type;
  return { ok: true, page: out };
}

/** A location as CEL binds it: integers as `int`. */
function celLocation(location: Location): Record<string, unknown> {
  return { line: BigInt(location.line), span: location.span.map((n) => BigInt(n)) };
}

function celRecord(record: GrammarRecord): Record<string, unknown> {
  return { ...record, location: celLocation(record.location) };
}

/** A section occurrence as CEL binds it (§5 `section`, and each of `page.sections`). */
export function celOccurrence(occurrence: Occurrence): Record<string, unknown> {
  return {
    heading: occurrence.heading,
    path: [...occurrence.path],
    location: celLocation(occurrence.location),
    raw: occurrence.raw,
    items: occurrence.items.map(celRecord),
  };
}

/** The first declaration of a top-level property's schema keyword, over the linearisation. */
function declaredKeyword(type: LawType, property: string, keyword: string): unknown {
  for (const part of type.parts) {
    const properties = part.raw["properties"];
    if (!isMapping(properties)) continue;
    const declared = properties[property];
    if (isMapping(declared) && keyword in declared) return declared[keyword];
  }
  return undefined;
}

/**
 * §5 `page`. `fields` is the raw frontmatter plus the defaults the effective
 * shape declares for absent keys; `urls` holds an entry for each field the
 * shape declares `format: uri` whose value the WHATWG parser accepts.
 */
export function buildPageInterface(parsed: ParsedPage, type: LawType): Record<string, unknown> {
  const fields: Record<string, unknown> = { ...parsed.frontmatter };
  for (const property of type.properties) {
    if (property in fields) continue;
    const fallback = declaredKeyword(type, property, "default");
    if (fallback !== undefined) fields[property] = fallback;
  }
  const urls: Record<string, Record<string, string>> = {};
  for (const property of type.properties) {
    const value = fields[property];
    if (typeof value !== "string" || declaredKeyword(type, property, "format") !== "uri") continue;
    const url = parseUrl(value);
    if (url !== undefined) urls[property] = url;
  }
  return {
    path: parsed.path,
    type: type.name,
    ancestry: [...type.ancestry],
    role: type.role,
    frontmatter: parsed.frontmatter,
    fields,
    body: parsed.body,
    digest: pageDigest(
      parsed.frontmatterError === undefined || parsed.frontmatterBytes === null
        ? parsed.frontmatter
        : parsed.frontmatterBytes,
      type.meta,
      parsed.bodyBytes,
    ),
    urls,
    sections: parsed.occurrences.map(celOccurrence),
  };
}

/**
 * §5 `facts`: every vocabulary's entries, every link this page makes keyed by
 * its normalised target name, and every type's ancestry.
 */
export function buildFacts(
  law: TypeLaw,
  parsed: ParsedPage,
  resolve: ResolveTarget = () => undefined,
): Record<string, unknown> {
  const vocabularies: Record<string, string[]> = {};
  for (const [name, vocabulary] of law.vocabularies)
    vocabularies[name] = [...vocabulary.entries.keys()];
  const links: Record<string, Record<string, unknown>> = {};
  const targets = [
    ...parsed.links,
    ...parsed.occurrences.flatMap((o) =>
      o.items.flatMap((i) => (i.kind === "relation" ? [i.target.name] : [])),
    ),
  ];
  for (const name of targets) {
    const key = normalizeIdentity(name);
    if (key in links) continue;
    const found = resolve(name);
    links[key] =
      found === undefined
        ? { resolved: false, path: null, type: null }
        : { resolved: true, path: found.path, type: found.type };
  }
  const ancestry: Record<string, string[]> = {};
  for (const [name, type] of law.types) ancestry[name] = [...type.ancestry];
  return { vocabularies, links, ancestry };
}

/**
 * §5 `before`: `present: false` with no base; otherwise the base version's
 * `page` and `sections`. `section` for one occurrence is the caller's to add.
 */
export function buildBefore(
  base: { parsed: ParsedPage; type: LawType } | undefined,
): Record<string, unknown> {
  if (base === undefined) return { present: false };
  const page = buildPageInterface(base.parsed, base.type);
  return { present: true, page, sections: page["sections"] };
}
