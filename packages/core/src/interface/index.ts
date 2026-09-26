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
import { type LawType, sectionPolicy } from "../law/compose.ts";
import type { TypeLaw } from "../law/load.ts";
import { utf8Text } from "../law/text.ts";
import { isMapping, readYaml, setOwn } from "../law/yaml.ts";
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
import { overBound, RANGE_BOUNDS } from "../rules/bounds.ts";
import { parseUrl } from "../schema/formats.ts";
import { PAGE_BYTES_MAX } from "./identity.ts";

export { PAGE_BYTES_MAX, PAGE_INTERFACE } from "./identity.ts";

export interface Occurrence {
  heading: string;
  depth: number;
  /** The headings from the outermost enclosing one to this one. */
  path: string[];
  /** Exact path below sections.depth, or [] outside its section tree. */
  sectionPath: string[];
  /** Physical ancestry and sibling identity; stable across repeated headings. */
  address: { heading: string; index: number }[];
  /** The declaration owning this heading's direct body, if any. */
  policy: string[] | null;
  mode: "claims" | "relations" | "entries" | "prose" | "unbound";
  explicit: boolean;
  location: Location;
  /** The whole heading subtree, including child headings. */
  raw: string;
  /** This heading through the next heading of any depth. */
  direct: string;
  directLocation: Location;
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
  /**
   * Which of the three ways it did not: YAML that does not read, a key
   * written twice, or a document that is not a mapping.
   */
  frontmatterCode?: "malformed-frontmatter" | "duplicate-key" | "frontmatter-not-mapping";
  /** The page line the YAML reader names, the opening fence as line 1, when it names one. */
  frontmatterLine?: number;
  /** Each top-level frontmatter key and the page line it is written on, the opening fence as line 1. */
  keyLines: ReadonlyMap<string, number>;
  /** The raw bytes between the fences, when there are fences. */
  frontmatterBytes: Uint8Array | null;
  body: string;
  bodyBytes: Uint8Array;
  /** Body bytes before its first document-level heading, if any. */
  preamble: string;
  occurrences: Occurrence[];
  unparsed: UnparsedItem[];
  /** Every wikilink in the body: its target as written, and its line. */
  links: { target: string; line: number }[];
  /** The type the frontmatter names, when the law declares it. */
  type?: LawType;
}

/**
 * Which §6 bound a refused page exceeds: its bytes (1 MiB), its sections
 * (200), the top-level items of one section (5,000), a list or map in its
 * frontmatter (1,000), or the distinct link targets `facts.links` would hold
 * (10,000).
 */
export type PageLimit = "bytes" | "sections" | "items" | "list" | "links";

export type PageRead =
  | { ok: true; page: ParsedPage }
  | {
      ok: false;
      code: "page-too-large";
      limit: PageLimit;
      message: string;
      details: { limit: PageLimit; bound: number; size: number; pointer?: string };
    }
  | { ok: false; code: "page-not-utf8"; message: string };

function tooLarge(
  limit: PageLimit,
  bound: number,
  size: number,
  message: string,
  pointer?: string,
): PageRead {
  return {
    ok: false,
    code: "page-too-large",
    limit,
    message,
    details: { limit, bound, size, ...(pointer === undefined ? {} : { pointer }) },
  };
}

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
    return tooLarge(
      "bytes",
      PAGE_BYTES_MAX,
      bytes.length,
      `${path} is ${bytes.length} bytes; a page is at most ${PAGE_BYTES_MAX}`,
    );
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
  let frontmatterCode: ParsedPage["frontmatterCode"];
  let frontmatterLine: number | undefined;
  const keyLines = new Map<string, number>();
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
      if (!read.ok) {
        frontmatterError = read.message;
        frontmatterCode = read.code === "DUPLICATE_KEY" ? "duplicate-key" : "malformed-frontmatter";
        if (read.line !== undefined) frontmatterLine = read.line + 1;
      } else if (read.value === null) frontmatter = {};
      else if (!isMapping(read.value)) {
        frontmatterError = "the frontmatter is not a mapping";
        frontmatterCode = "frontmatter-not-mapping";
      } else {
        frontmatter = read.value;
        // The text between the fences starts on the page's second line.
        for (const [key, line] of read.keyLines) keyLines.set(key, line + 1);
      }
      bodyLine = close + 1;
    }
  }
  const bodyStartByte = bodyLine === 0 ? 0 : (lines[bodyLine]?.startByte ?? bytes.length);
  const bodyStartChar = bodyLine === 0 ? 0 : (lines[bodyLine]?.startChar ?? text.length);
  const body = bodyStartChar >= text.length ? "" : text.slice(bodyStartChar);
  const bodyBytes = bodyStartByte >= bytes.length ? new Uint8Array() : bytes.slice(bodyStartByte);

  // §6: a list or map in the frontmatter is a range a rule may walk.
  const list = overBound(frontmatter, RANGE_BOUNDS.list);
  if (list !== undefined) {
    return tooLarge(
      "list",
      RANGE_BOUNDS.list,
      list.size,
      `${path}: the frontmatter's ${list.pointer} holds ${list.size} members; a frontmatter list or map holds at most ${RANGE_BOUNDS.list}`,
      list.pointer,
    );
  }

  const typeName = frontmatter["type"];
  const type = typeof typeName === "string" ? law.types.get(typeName) : undefined;
  const sections = type?.sections ?? null;

  // Headings, fences, HTML blocks and thematic breaks as CommonMark reads
  // them (the old parser's projection, kept and extended): a line inside a
  // fence, an HTML block (a comment among them) or a break holds no item.
  const doc = parseDoc(text);
  const opaque = new Map<number, number>();
  for (const block of [...doc.fences, ...doc.opaque]) {
    const indent = /^( *)/u.exec(lines[block.line - 1]?.text ?? "")?.[1]?.length ?? 0;
    for (let i = block.line; i <= block.endLine; i += 1) opaque.set(i, indent);
  }
  const headings = doc.headings.filter((h) => h.line > bodyLine);
  const firstHeading = headings[0];
  const preamble = text.slice(
    bodyStartChar,
    firstHeading === undefined
      ? text.length
      : (lines[firstHeading.line - 1]?.startChar ?? text.length),
  );
  // §6: `page.sections` holds one occurrence per heading, and `facts.links`
  // one entry per distinct target; both are ranges. Refused before the walk
  // below, whose work grows with the headings.
  if (headings.length > RANGE_BOUNDS.sections) {
    return tooLarge(
      "sections",
      RANGE_BOUNDS.sections,
      headings.length,
      `${path} has ${headings.length} headings; a page has at most ${RANGE_BOUNDS.sections} sections`,
    );
  }
  const targets = new Set(doc.wikilinks.map((l) => normalizeIdentity(l.target)));
  if (targets.size > RANGE_BOUNDS.facts) {
    return tooLarge(
      "links",
      RANGE_BOUNDS.facts,
      targets.size,
      `${path} links ${targets.size} distinct pages; a page links at most ${RANGE_BOUNDS.facts}`,
    );
  }

  const occurrences: Occurrence[] = [];
  const unparsed: UnparsedItem[] = [];
  const stack: { depth: number; heading: string; address: { heading: string; index: number }[] }[] =
    [];
  const siblingCounts = new Map<string, number>();
  const seen = new Map<string, number>();
  let overflow: { heading: string; line: number } | undefined;
  headings.forEach((heading, index) => {
    if (overflow !== undefined) return;
    while (stack.length > 0 && (stack[stack.length - 1]?.depth ?? 0) >= heading.depth) stack.pop();
    // Policy identity starts at sections.depth. A title edit must not make
    // every governed region look replaced to before.section or transitions.
    const parentAddress =
      heading.depth === sections?.depth ? [] : (stack[stack.length - 1]?.address ?? []);
    const siblingKey = JSON.stringify([parentAddress, heading.text]);
    const siblingIndex = siblingCounts.get(siblingKey) ?? 0;
    siblingCounts.set(siblingKey, siblingIndex + 1);
    const address = [...parentAddress, { heading: heading.text, index: siblingIndex }];
    stack.push({ depth: heading.depth, heading: heading.text, address });
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
    let directEndLine = lines[directEnd - 1] ?? startLine;
    for (let n = directEnd; n > heading.line && (lines[n - 1]?.text.trim() ?? "") === ""; n -= 1) {
      directEndLine = lines[n - 2] ?? startLine;
    }
    const rootIndex = stack.findIndex((part) => part.depth === sections?.depth);
    const sectionPath = rootIndex < 0 ? [] : stack.slice(rootIndex).map((part) => part.heading);
    const policy = sectionPolicy(sections, sectionPath);
    const occurrence: Occurrence = {
      heading: heading.text,
      depth: heading.depth,
      path: stack.map((s) => s.heading),
      sectionPath,
      address,
      policy: policy.section?.path ?? null,
      mode: policy.section?.grammar ?? (policy.section === undefined ? "unbound" : "prose"),
      explicit: policy.explicit,
      location: { line: heading.line, span: [startLine.startByte, endLine.endByte] },
      raw: text.slice(startLine.startChar, endLine.endChar),
      direct: text.slice(startLine.startChar, directEndLine.endChar),
      directLocation: { line: heading.line, span: [startLine.startByte, directEndLine.endByte] },
      items: [],
    };
    const count = seen.get(heading.text) ?? 0;
    seen.set(heading.text, count + 1);
    occurrences.push(occurrence);
    const grammar = policy.section?.grammar;
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
          contentIndent: number;
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
    let items = 0;
    for (let n = contentFrom; n <= directEnd; n += 1) {
      const line = lines[n - 1];
      if (line === undefined) continue;
      const blockIndent = opaque.get(n);
      if (blockIndent !== undefined) {
        // A separate block ends the preceding list item; a block indented
        // inside its content remains part of that item's rationale.
        if (current !== undefined && blockIndent < current.contentIndent) flush();
        continue;
      }
      if (line.text.trim() === "") continue;
      const spaces = /^( *)/u.exec(line.text)?.[1]?.length ?? 0;
      const listText = line.text.slice(spaces);
      const topLevelCandidate = spaces <= 3 && LIST_ITEM.test(listText);
      if (!topLevelCandidate || (current !== undefined && spaces >= current.contentIndent)) {
        // A nested list item or indented prose is rationale. At the start of
        // a section, an indented CommonMark bullet is still a top-level item
        // and must not disappear from the grammar's judgment.
        if (/^[ \t]/u.test(line.text)) {
          if (current !== undefined) current.rationale.push(line);
          continue;
        }
        flush();
        continue; // prose between items
      }
      flush();
      // §6: `section.items` is a range; parsed or not, an item counts.
      items += 1;
      if (items > RANGE_BOUNDS.items) {
        overflow = { heading: heading.text, line: heading.line };
        return;
      }
      const parsed =
        spaces > 0
          ? {
              reason:
                "a grammar item starts at column 1; an indented top-level list item is not canonical",
            }
          : grammar === "claims"
            ? parseClaimLine(line.text, law.engine.source_roots)
            : grammar === "relations"
              ? parseRelationLine(line.text, resolve)
              : parseEntryLine(line.text);
      const marker = /^(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/u.exec(listText)?.[0] ?? "";
      current =
        "record" in parsed
          ? {
              record: parsed.record,
              line,
              lineNo: n,
              contentIndent: spaces + marker.length,
              rationale: [],
            }
          : {
              record: undefined,
              line,
              lineNo: n,
              contentIndent: spaces + marker.length,
              rationale: [],
              reason: parsed.reason,
            };
    }
    flush();
  });

  if (overflow !== undefined) {
    return tooLarge(
      "items",
      RANGE_BOUNDS.items,
      RANGE_BOUNDS.items + 1,
      `${path}: the section "${overflow.heading}" (line ${overflow.line}) has over ${RANGE_BOUNDS.items} items; a section has at most ${RANGE_BOUNDS.items}`,
    );
  }

  const out: ParsedPage = {
    path,
    frontmatter,
    frontmatterBytes,
    keyLines,
    body,
    bodyBytes,
    preamble,
    occurrences,
    unparsed,
    links: doc.wikilinks.map((l) => ({ target: l.target, line: l.line })),
  };
  if (frontmatterError !== undefined) out.frontmatterError = frontmatterError;
  if (frontmatterCode !== undefined) out.frontmatterCode = frontmatterCode;
  if (frontmatterLine !== undefined) out.frontmatterLine = frontmatterLine;
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
    mode: occurrence.mode,
    explicit: occurrence.explicit,
    location: celLocation(occurrence.location),
    raw: occurrence.raw,
    direct: occurrence.direct,
    directLocation: celLocation(occurrence.directLocation),
    items: occurrence.items.map(celRecord),
  };
}

/** The first declaration of a top-level property's schema keyword, over the linearisation. */
function declaredKeyword(type: LawType, property: string, keyword: string): unknown {
  for (const part of type.parts) {
    const properties = part.raw["properties"];
    if (!isMapping(properties)) continue;
    const declared = properties[property];
    if (isMapping(declared) && Object.hasOwn(declared, keyword)) return declared[keyword];
  }
  return undefined;
}

/**
 * §5 `page`. `fields` is the raw frontmatter plus the defaults the effective
 * shape declares for absent keys; `urls` holds an entry for each field the
 * shape declares `format: uri` whose value the WHATWG parser accepts.
 */
export function buildPageInterface(parsed: ParsedPage, type: LawType): Record<string, unknown> {
  // Every map here is keyed by what a page or a document wrote, so a key is
  // set as an own property and looked up with Object.hasOwn: `constructor`
  // is a frontmatter key or a page name like any other.
  const fields: Record<string, unknown> = { ...parsed.frontmatter };
  for (const property of type.properties) {
    if (Object.hasOwn(fields, property)) continue;
    const fallback = declaredKeyword(type, property, "default");
    if (fallback !== undefined) setOwn(fields, property, fallback);
  }
  const urls: Record<string, Record<string, string>> = {};
  for (const property of type.properties) {
    const value = fields[property];
    if (typeof value !== "string" || declaredKeyword(type, property, "format") !== "uri") continue;
    const url = parseUrl(value);
    if (url !== undefined) setOwn(urls, property, url);
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

/** §5 `facts.vocabularies` and `facts.ancestry`: the law's, the same for every page. */
export function lawFacts(law: TypeLaw): {
  vocabularies: Record<string, string[]>;
  ancestry: Record<string, string[]>;
} {
  const vocabularies: Record<string, string[]> = {};
  for (const [name, vocabulary] of law.vocabularies)
    setOwn(vocabularies, name, [...vocabulary.entries.keys()]);
  const ancestry: Record<string, string[]> = {};
  for (const [name, type] of law.types) setOwn(ancestry, name, [...type.ancestry]);
  return { vocabularies, ancestry };
}

/** §5 `facts.links`: every link this page makes, keyed by its normalised target name. */
export function pageLinks(
  parsed: ParsedPage,
  resolve: ResolveTarget = () => undefined,
): Record<string, Record<string, unknown>> {
  const links: Record<string, Record<string, unknown>> = {};
  const targets = [
    ...parsed.links.map((l) => l.target),
    ...parsed.occurrences.flatMap((o) =>
      o.items.flatMap((i) => (i.kind === "relation" ? [i.target.name] : [])),
    ),
  ];
  for (const name of targets) {
    const key = normalizeIdentity(name);
    if (Object.hasOwn(links, key)) continue;
    const found = resolve(name);
    setOwn(
      links,
      key,
      found === undefined
        ? { resolved: false, path: null, type: null }
        : { resolved: true, path: found.path, type: found.type },
    );
  }
  return links;
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
  const { vocabularies, ancestry } = lawFacts(law);
  return { vocabularies, links: pageLinks(parsed, resolve), ancestry };
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
