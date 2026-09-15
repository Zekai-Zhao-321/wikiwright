// docs/architecture.md (micromark/mdast behind the ParsedDoc seam; yaml strict)
// docs/architecture.md §Directories determinism invariant 1 (BOM/CRLF input normalization)
// docs/concepts.md §Findings and routing (this module produces every checker's input surface).
//
// The grammar is CommonMark plus YAML frontmatter. The GFM extensions (tables,
// task lists, strikethrough, autolink literals, footnotes) are not loaded: no
// checker reads any of those constructs, the projection below — headings,
// fences, inline code, raw HTML, wikilinks — is the same with them and
// without for every corpus this repository judges, and tokenizing them cost
// close to half of every parse (docs/roadmap.md §Every run parses the whole
// corpus). A check over a table would load them beside the check.
import { fromMarkdown } from "mdast-util-from-markdown";
import { frontmatterFromMarkdown } from "mdast-util-frontmatter";
import { frontmatter as micromarkFrontmatter } from "micromark-extension-frontmatter";
import { isMap, isScalar, parseDocument } from "yaml";

export interface NormalizedInput {
  text: string;
  hadBom: boolean;
  hadCrlf: boolean;
}

/** invariant 1: strip a UTF-8 BOM, normalize CRLF to LF, report both. */
export function normalizeInput(raw: string): NormalizedInput {
  const hadBom = raw.charCodeAt(0) === 0xfeff;
  const noBom = hadBom ? raw.slice(1) : raw;
  const hadCrlf = noBom.includes("\r\n");
  const text = hadCrlf ? noBom.replaceAll("\r\n", "\n") : noBom;
  return { text, hadBom, hadCrlf };
}

export interface FrontmatterKey {
  key: string;
  line: number;
}

export interface ParseIssue {
  code: "malformed-frontmatter" | "duplicate-key" | "frontmatter-not-mapping";
  message: string;
  /** The page line (1-based, the opening fence counted), as every finding reports it. */
  line: number;
  /** The parser's column, where it gave one (the one number that locates a `: `). */
  column?: number;
}

export interface Frontmatter {
  present: boolean;
  value: Record<string, unknown>;
  keys: FrontmatterKey[];
  issues: ParseIssue[];
  endLine: number;
}

export interface Heading {
  depth: number;
  text: string;
  line: number;
}

export interface Fence {
  info: string;
  line: number;
  endLine: number;
  value: string;
}

export interface Wikilink {
  target: string;
  heading?: string;
  alias?: string;
  line: number;
  raw: string;
}

export interface ParsedDoc {
  frontmatter: Frontmatter;
  headings: Heading[];
  fences: Fence[];
  wikilinks: Wikilink[];
  /** The normalized (BOM-stripped, LF) source — the text every checker sees. */
  source: string;
  input: Pick<NormalizedInput, "hadBom" | "hadCrlf">;
}

interface MdNode {
  type: string;
  children?: MdNode[];
  value?: string;
  depth?: number;
  lang?: string | null;
  url?: string;
  position?: {
    start: { line: number; offset?: number };
    end: { line: number; offset?: number };
  };
}

const WIKILINK = /\[\[([^\][|#\n]+?)(?:#([^\][|\n]*))?(?:\|([^\][\n]*))?\]\]/g;

function collectText(node: MdNode): string {
  if (node.type === "text" || node.type === "inlineCode") return node.value ?? "";
  return (node.children ?? []).map(collectText).join("");
}

/**
 * Wikilinks are scanned over the SOURCE, not over mdast's decoded text values —
 * decoded values lose links to reference-definition reshaping and inline-markdown
 * splitting, and phantom-match escaped syntax. Non-prose regions
 * (frontmatter, fences, inline code, raw HTML) are excluded by offset range.
 */
function scanWikilinks(source: string, excluded: Array<[number, number]>): Wikilink[] {
  const links: Wikilink[] = [];
  const isExcluded = (offset: number): boolean =>
    excluded.some(([start, end]) => offset >= start && offset < end);
  let scanFrom = 0;
  let line = 1;
  for (const m of source.matchAll(WIKILINK)) {
    const idx = m.index;
    if (isExcluded(idx)) continue;
    if (idx > 0 && source[idx - 1] === "\\") continue;
    for (let i = scanFrom; i < idx; i += 1) if (source[i] === "\n") line += 1;
    scanFrom = idx;
    const [raw, target, heading, alias] = m;
    if (target === undefined) continue;
    const link: Wikilink = { target: target.trim(), line, raw };
    if (heading !== undefined && heading !== "") link.heading = heading.trim();
    if (alias !== undefined && alias !== "") link.alias = alias.trim();
    links.push(link);
  }
  return links;
}

function parseFrontmatterNode(node: MdNode | undefined): Frontmatter {
  if (node === undefined || node.type !== "yaml") {
    return { present: false, value: {}, keys: [], issues: [], endLine: 0 };
  }
  const source = node.value ?? "";
  const fenceLine = node.position?.start.line ?? 1;
  const endLine = node.position?.end.line ?? fenceLine;
  const issues: ParseIssue[] = [];
  const keys: FrontmatterKey[] = [];

  const doc = parseDocument(source);
  for (const err of doc.errors) {
    const at = err.linePos?.[0];
    const line = fenceLine + (at?.line ?? 1);
    // The parser's message carries its own position, relative to the YAML
    // block, and a code snippet under it. The finding reports the PAGE line
    // and the column once, in the message and as data, and nothing else —
    // a reader locating the defect needs the numbers, not the excerpt.
    const reason = (err.message.split("\n")[0] ?? err.message)
      .replace(/ at line \d+, column \d+:?$/u, "")
      .trim();
    const where = at === undefined ? `line ${line}` : `line ${line}, column ${at.col}`;
    const issue: ParseIssue = {
      code: err.code === "DUPLICATE_KEY" ? "duplicate-key" : "malformed-frontmatter",
      message: `${reason} (${where})`,
      line,
    };
    if (at !== undefined) issue.column = at.col;
    issues.push(issue);
  }

  let value: Record<string, unknown> = {};
  if (isMap(doc.contents)) {
    for (const pair of doc.contents.items) {
      if (!isScalar(pair.key)) continue;
      const keyText = String(pair.key.value);
      const offset = pair.key.range?.[0] ?? 0;
      let breaks = 0;
      for (const ch of source.slice(0, offset)) if (ch === "\n") breaks += 1;
      keys.push({ key: keyText, line: fenceLine + 1 + breaks });
    }
    const js: unknown = doc.toJS();
    if (typeof js === "object" && js !== null && !Array.isArray(js)) {
      value = js as Record<string, unknown>; // invariant: guarded plain-object narrowing
    }
  } else if (doc.errors.length === 0) {
    issues.push({
      code: "frontmatter-not-mapping",
      message: "frontmatter must be a YAML mapping",
      line: fenceLine + 1,
    });
  }

  return { present: true, value, keys, issues, endLine };
}

/** Parse one page into the checker-facing projection. Input is normalized first. */
export function parseDoc(raw: string): ParsedDoc {
  const { text, hadBom, hadCrlf } = normalizeInput(raw);
  const tree = fromMarkdown(text, {
    extensions: [micromarkFrontmatter(["yaml"])],
    mdastExtensions: [frontmatterFromMarkdown(["yaml"])],
  }) as unknown as MdNode; // invariant: mdast Root is structurally MdNode; the seam owns this one cast

  const headings: Heading[] = [];
  const fences: Fence[] = [];
  const excluded: Array<[number, number]> = [];

  const exclude = (node: MdNode): void => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start !== undefined && end !== undefined) excluded.push([start, end]);
  };

  const visit = (node: MdNode): void => {
    switch (node.type) {
      case "yaml":
        exclude(node);
        return;
      case "heading": {
        headings.push({
          depth: node.depth ?? 1,
          text: collectText(node).trim(),
          line: node.position?.start.line ?? 1,
        });
        break;
      }
      case "code": {
        fences.push({
          info: node.lang ?? "",
          line: node.position?.start.line ?? 1,
          endLine: node.position?.end.line ?? node.position?.start.line ?? 1,
          value: node.value ?? "",
        });
        exclude(node);
        return;
      }
      case "inlineCode":
      case "html":
        exclude(node);
        return;
      default:
        break;
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(tree);
  const wikilinks = scanWikilinks(text, excluded);

  return {
    frontmatter: parseFrontmatterNode(tree.children?.[0]),
    headings,
    fences,
    wikilinks,
    source: text,
    input: { hadBom, hadCrlf },
  };
}
