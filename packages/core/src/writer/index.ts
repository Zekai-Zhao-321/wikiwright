// docs/concepts.md §The judge and its states (a write differs from its input only inside the
// ops' line ranges; the page's BOM, line ending and trailing-newline state are
// the input's; a shape the splice cannot read is a REFUSAL, never a partial
// edit) · docs/architecture.md §How a verdict is produced (the one Writer every writing verb goes through).
//
// The seed is `tagwrite.ts`, which spliced one YAML scalar list and needed three
// corrections in a day. The lesson kept here is the scope:
// the Writer's surface is the lines an op NAMES, never "the page", because the
// invariant is only provable of an edit whose extent is declared.
import { normalizeIdentity } from "../identity/index.ts";
import { parseDoc } from "../parse/index.ts";

/** docs/concepts.md §The judge and its states: the closed op set. A sixth op would make the law unprovable. */
export type WriteOp =
  | { kind: "insert"; after: number; lines: readonly string[] }
  | { kind: "replace"; from: number; to: number; lines: readonly string[] }
  | { kind: "append-section"; heading: string; depth?: number; lines: readonly string[] }
  | {
      kind: "frontmatter-list";
      field: string;
      /** The value the field is to hold BEFORE `add` — the caller's reading. */
      existing: readonly unknown[];
      add: readonly string[];
      /**
       * docs/concepts.md §The judge and its states: values the op takes OUT. Naming them turns the append
       * into a rewrite of the key's whole extent, in the value's own style —
       * which a `tag-rename` needs and an append must never do, since appending
       * after the last item of a block list would leave the old value standing.
       */
      remove?: readonly string[];
    }
  | { kind: "frontmatter-set"; field: string; value: string };

/** What a writing verb returns: one page, the ops that touch it (docs/architecture.md §How a verdict is produced). */
export interface WritePlan {
  path: string;
  ops: WriteOp[];
}

/** 1-based, inclusive. `to < from` is the empty range of a pure insertion. */
export interface WriteRange {
  from: number;
  to: number;
}

export type WriteResult =
  | { ok: true; text: string; ranges: WriteRange[]; consumed: WriteRange[] }
  | { ok: false; reason: string };

/** The three envelope properties that are the INPUT's, never the writer's. */
export interface PageEnvelope {
  bom: boolean;
  eol: "\n" | "\r\n";
  endsWithEol: boolean;
}

export function pageEnvelope(raw: string): PageEnvelope {
  const bom = raw.startsWith("﻿");
  const body = bom ? raw.slice(1) : raw;
  const eol = /\r\n/u.test(body) ? "\r\n" : "\n";
  return { bom, eol, endsWithEol: body.endsWith(eol) };
}

/** The body's lines. A trailing newline shows up as a final empty element. */
function bodyLines(raw: string): string[] {
  return (raw.startsWith("﻿") ? raw.slice(1) : raw).split(/\r?\n/u);
}

const HEADING = /^(#{1,6})[ \t]+(.*?)[ \t]*$/u;
const FENCE = /^\s*(?:```|~~~)/u;

interface HeadingHit {
  index: number;
  depth: number;
}

/**
 * The headings of a page, outside the frontmatter and outside fenced code. This
 * is a heading scan, not a parse: `append-section` must not need a registry, or
 * the Writer stops being pure and its answer could disagree with the parse seam
 * about where a section ends.
 */
function headingsOf(lines: readonly string[]): HeadingHit[] {
  const out: HeadingHit[] = [];
  let start = 0;
  if (lines[0]?.trim() === "---") {
    const close = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
    if (close > 0) start = close + 1;
  }
  let fenced = false;
  for (let i = start; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (FENCE.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const m = HEADING.exec(line);
    if (m?.[1] !== undefined) out.push({ index: i, depth: m[1].length });
  }
  return out;
}

/**
 * docs/concepts.md §The judge and its states: the 1-based line an `append-section` op inserts AFTER — the
 * last non-blank line of the section, so an appended item lands before the blank
 * run that separates the section from the next heading. `undefined` where the
 * heading does not occur, occurs more than once, or occurs at another depth:
 * ambiguity is a refusal, never a choice.
 */
export function sectionTail(raw: string, heading: string, depth?: number): number | undefined {
  const lines = bodyLines(raw);
  const wanted = normalizeIdentity(heading);
  const all = headingsOf(lines);
  const hits = all.filter((h) => {
    const m = HEADING.exec(lines[h.index] ?? "");
    if (m?.[2] === undefined) return false;
    if (depth !== undefined && h.depth !== depth) return false;
    return normalizeIdentity(m[2]) === wanted;
  });
  const hit = hits[0];
  if (hit === undefined || hits.length > 1) return undefined;
  // A page ending with a newline splits to a final empty element that IS the
  // trailing newline. Inserting after it would move the file's last byte, so the
  // section's search space stops one short of it (docs/concepts.md §The judge and its states's envelope).
  const limit = pageEnvelope(raw).endsWithEol ? lines.length - 1 : lines.length;
  let end = limit;
  for (const other of all) {
    if (other.index > hit.index && other.depth <= hit.depth) {
      end = Math.min(other.index, limit);
      break;
    }
  }
  const blank = (i: number): boolean => (lines[i] ?? "").trim() === "";
  let tail = end;
  while (tail > hit.index + 1 && blank(tail - 1)) tail -= 1;
  // An empty section keeps the customary blank line under its heading: the
  // engine appends BELOW it rather than wedging the item against the heading.
  if (tail === hit.index + 1 && tail < limit && blank(tail)) tail += 1;
  return tail;
}

// ---------------------------------------------------------------------------
// frontmatter splices (absorbed from tagwrite.ts)

/** A tag safe to emit as a plain YAML scalar; anything else gets quoted. */
function plainSafe(value: string): boolean {
  if (value.length === 0) return false;
  if (value !== value.trim()) return false;
  if (/[:#,[\]{}\n\r\t"']/u.test(value)) return false;
  return !/^[-?:,[\]{}#&*!|>'"%@`]/u.test(value);
}

/**
 * One string as a YAML scalar: plain where that reads back as the same string,
 * JSON-quoted otherwise — JSON string syntax is a subset of YAML's double-quoted
 * scalar, so the result is always parseable. The Writer's own frontmatter
 * splices render through this, and so does `new` when it renders a `--set`
 * value into a skeleton: one rendering, not two.
 */
export function yamlScalar(value: string): string {
  return plainSafe(value) ? value : JSON.stringify(value);
}

function emitFlow(values: readonly string[]): string {
  return `[${values.map((v) => JSON.stringify(v)).join(", ")}]`;
}

interface Splice {
  /** 0-based index of the first line consumed. */
  start: number;
  /** How many input lines this op consumes; 0 for a pure insertion. */
  deleteCount: number;
  lines: string[];
}

type SpliceResult = { ok: true; splice: Splice } | { ok: false; reason: string };

interface FrontmatterView {
  closing: number;
  keyIndices: number[];
  extentEnd: number;
}

function frontmatterView(
  lines: readonly string[],
  field: string,
): { ok: true; view: FrontmatterView } | { ok: false; reason: string } {
  if (lines[0]?.trim() !== "---") return { ok: false, reason: "no frontmatter block" };
  const closing = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  if (closing < 0) return { ok: false, reason: "unterminated frontmatter" };
  const keyPattern = new RegExp(`^${field.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\s*:`, "u");
  const keyIndices: number[] = [];
  for (let i = 1; i < closing; i += 1) {
    if (keyPattern.test(lines[i] ?? "")) keyIndices.push(i);
  }
  // With the key written twice, choosing between them is a guess.
  if (keyIndices.length > 1) {
    return {
      ok: false,
      reason: `${field} appears ${keyIndices.length} times; a splice may not choose between duplicate keys`,
    };
  }
  const keyIndex = keyIndices[0] ?? -1;
  let extentEnd = closing;
  if (keyIndex >= 0) {
    const isTopKey = (line: string): boolean => /^[^\s#][^:]*:/u.test(line);
    for (let i = keyIndex + 1; i < closing; i += 1) {
      if (isTopKey(lines[i] ?? "")) {
        extentEnd = i;
        break;
      }
    }
  }
  return { ok: true, view: { closing, keyIndices, extentEnd } };
}

function listSplice(
  lines: readonly string[],
  field: string,
  existing: readonly unknown[],
  add: readonly string[],
  remove: readonly string[] = [],
): SpliceResult {
  if (!existing.every((t): t is string => typeof t === "string")) {
    return { ok: false, reason: `${field} list holds a non-string entry` };
  }
  const current = existing as readonly string[];
  const viewed = frontmatterView(lines, field);
  if (!viewed.ok) return viewed;
  const { closing, keyIndices, extentEnd } = viewed.view;
  const keyIndex = keyIndices[0] ?? -1;
  if (keyIndex < 0) {
    if (existing.length > 0) return { ok: false, reason: `no ${field} key` };
    return {
      ok: true,
      splice: { start: closing, deleteCount: 0, lines: [`${field}: ${emitFlow([...add])}`] },
    };
  }
  const keyLine = lines[keyIndex] ?? "";
  const inline = keyLine.slice(keyLine.indexOf(":") + 1);
  const trimmed = inline.trim();

  if (remove.length > 0) {
    // A removal cannot be an append: the key's whole extent is rewritten, in the
    // style the value already had, so the old value cannot survive below the new.
    const next = [...current, ...add];
    const isBlock = trimmed.length === 0 || trimmed.startsWith("#");
    if (!isBlock && !trimmed.startsWith("[")) {
      return { ok: false, reason: `unsupported ${field} value: ${trimmed}` };
    }
    let indent = "  ";
    for (let i = keyIndex + 1; i < extentEnd; i += 1) {
      const m = /^(\s*)-\s/u.exec(lines[i] ?? "");
      if (m !== null) indent = m[1] ?? "  ";
    }
    const emitted = isBlock
      ? [`${field}:`, ...next.map((v) => `${indent}- ${yamlScalar(v)}`)]
      : [`${field}: ${emitFlow(next)}`];
    return {
      ok: true,
      splice: { start: keyIndex, deleteCount: extentEnd - keyIndex, lines: emitted },
    };
  }

  if (trimmed.startsWith("[")) {
    // The sequence ends at its LAST bracket: anything inside is the parser's
    // business, anything after it is a trailing comment.
    const closeAt = inline.lastIndexOf("]");
    if (closeAt < 0) return { ok: false, reason: "multi-line flow sequence" };
    const trailing = inline.slice(closeAt + 1);
    if (trailing.trim().length > 0 && !trailing.trim().startsWith("#")) {
      return { ok: false, reason: `unexpected content after the ${field} sequence` };
    }
    return {
      ok: true,
      splice: {
        start: keyIndex,
        deleteCount: 1,
        lines: [`${field}: ${emitFlow([...current, ...add])}${trailing}`],
      },
    };
  }
  if (trimmed.length > 0 && !trimmed.startsWith("#")) {
    return { ok: false, reason: `unsupported ${field} value: ${trimmed}` };
  }

  let lastItem = -1;
  let indent = "  ";
  for (let i = keyIndex + 1; i < extentEnd; i += 1) {
    const m = /^(\s*)-\s/u.exec(lines[i] ?? "");
    if (m !== null) {
      lastItem = i;
      indent = m[1] ?? "  ";
    }
  }
  if (lastItem < 0) {
    return {
      ok: true,
      splice: {
        start: keyIndex,
        deleteCount: 1,
        lines: [`${field}: ${emitFlow([...current, ...add])}`],
      },
    };
  }
  return {
    ok: true,
    splice: {
      start: lastItem + 1,
      deleteCount: 0,
      lines: add.map((v) => `${indent}- ${yamlScalar(v)}`),
    },
  };
}

function setSplice(lines: readonly string[], field: string, value: string): SpliceResult {
  const viewed = frontmatterView(lines, field);
  if (!viewed.ok) return viewed;
  const { closing, keyIndices } = viewed.view;
  const keyIndex = keyIndices[0] ?? -1;
  const emitted = `${field}: ${yamlScalar(value)}`;
  if (keyIndex < 0) {
    return { ok: true, splice: { start: closing, deleteCount: 0, lines: [emitted] } };
  }
  const keyLine = lines[keyIndex] ?? "";
  const inline = keyLine.slice(keyLine.indexOf(":") + 1).trim();
  if (inline.startsWith("[") || inline.startsWith("{")) {
    return { ok: false, reason: `${field} holds a collection; a scalar set may not flatten it` };
  }
  if (inline.length === 0 || inline.startsWith("#")) {
    // A key with a block value beneath it. Only an EMPTY key is a scalar slot.
    const nextLine = lines[keyIndex + 1] ?? "";
    if (/^\s+\S/u.test(nextLine)) {
      return { ok: false, reason: `${field} holds a block value; a scalar set may not replace it` };
    }
  }
  if (inline.startsWith("|") || inline.startsWith(">") || inline.startsWith("&")) {
    return { ok: false, reason: `${field} holds a ${inline[0]} value a splice may not rewrite` };
  }
  return { ok: true, splice: { start: keyIndex, deleteCount: 1, lines: [emitted] } };
}

// ---------------------------------------------------------------------------
// the splice

function spliceFor(raw: string, lines: readonly string[], op: WriteOp): SpliceResult {
  switch (op.kind) {
    case "insert": {
      if (op.after < 0 || op.after > lines.length) {
        return { ok: false, reason: `insert after line ${op.after} is outside the page` };
      }
      return { ok: true, splice: { start: op.after, deleteCount: 0, lines: [...op.lines] } };
    }
    case "replace": {
      if (op.from < 1 || op.to < op.from || op.to > lines.length) {
        return { ok: false, reason: `replace ${op.from}..${op.to} is outside the page` };
      }
      return {
        ok: true,
        splice: { start: op.from - 1, deleteCount: op.to - op.from + 1, lines: [...op.lines] },
      };
    }
    case "append-section": {
      const tail = sectionTail(raw, op.heading, op.depth);
      if (tail === undefined) {
        return {
          ok: false,
          reason: `"${op.heading}" does not occur exactly once${op.depth === undefined ? "" : ` at depth ${op.depth}`}`,
        };
      }
      // The customary blank line, kept on both sides: an empty section has
      // none under its heading, and a section at the page's end or flush
      // against the next heading has none after its tail. A skeleton's
      // sections are all of these, and the item lands read as Markdown reads.
      const heading = (line: string | undefined): boolean =>
        line !== undefined && HEADING.test(line);
      const before = heading(lines[tail - 1]) ? [""] : [];
      const after =
        heading(lines[tail]) && (op.lines[op.lines.length - 1] ?? "").trim() !== "" ? [""] : [];
      return {
        ok: true,
        splice: { start: tail, deleteCount: 0, lines: [...before, ...op.lines, ...after] },
      };
    }
    case "frontmatter-list":
    case "frontmatter-set": {
      // generalized: a mechanical edit of a block the YAML parser
      // rejected is a guess by definition. One `malformed-frontmatter` in must
      // never be two out, so the refusal precedes every frontmatter op. A BODY
      // op on the same page is untouched by this: it edits no key.
      const issues = parseDoc(raw).frontmatter.issues;
      if (issues.length > 0) {
        const codes = [...new Set(issues.map((i) => i.code))].sort().join(", ");
        return {
          ok: false,
          reason: `the frontmatter does not parse (${codes}); a splice may not edit a block the parser could not read`,
        };
      }
      return op.kind === "frontmatter-list"
        ? listSplice(lines, op.field, op.existing, op.add, op.remove ?? [])
        : setSplice(lines, op.field, op.value);
    }
  }
}

/**
 * docs/concepts.md Applies every op in one pass and reports the ranges it touched:
 * `ranges` in OUTPUT line numbers, `consumed` in input line numbers, both 1-based
 * and inclusive, with `to < from` for an empty side. The result differs from the
 * input only inside those ranges — which is the property the fuzz asserts.
 */
export function applyWrite(raw: string, ops: readonly WriteOp[]): WriteResult {
  const envelope = pageEnvelope(raw);
  const lines = bodyLines(raw);
  if (ops.length === 0) return { ok: true, text: raw, ranges: [], consumed: [] };

  const splices: Splice[] = [];
  for (const op of ops) {
    const result = spliceFor(raw, lines, op);
    if (!result.ok) return result;
    splices.push(result.splice);
  }
  // Stable order by position; a pure insertion at the same point keeps the
  // caller's order, which is the only place two ops may share a start.
  const order = splices.map((s, i) => ({ s, i }));
  order.sort((a, b) => a.s.start - b.s.start || a.i - b.i);
  for (let i = 1; i < order.length; i += 1) {
    const prev = order[i - 1]?.s;
    const here = order[i]?.s;
    if (prev === undefined || here === undefined) continue;
    const prevEnd = prev.start + prev.deleteCount;
    if (here.start < prevEnd || (prev.deleteCount > 0 && here.start === prev.start)) {
      return { ok: false, reason: `two ops overlap at line ${here.start + 1}` };
    }
  }

  const out: string[] = [];
  const ranges: WriteRange[] = [];
  const consumed: WriteRange[] = [];
  let cursor = 0;
  for (const { s } of order) {
    out.push(...lines.slice(cursor, s.start));
    const from = out.length + 1;
    out.push(...s.lines);
    ranges.push({ from, to: out.length });
    consumed.push({ from: s.start + 1, to: s.start + s.deleteCount });
    cursor = s.start + s.deleteCount;
  }
  out.push(...lines.slice(cursor));

  const text = (envelope.bom ? "﻿" : "") + out.join(envelope.eol);
  return { ok: true, text, ranges, consumed };
}

/**
 * The one-op convenience the tag path and the `frontmatter-set` fixer share.
 * Kept as a function rather than inlined at each call site so "append to a YAML
 * list" has one implementation (one implementation per operation, applied to the writer).
 */
export function appendToFrontmatterList(
  raw: string,
  field: string,
  existing: readonly unknown[],
  add: readonly string[],
): { ok: true; text: string } | { ok: false; reason: string } {
  if (add.length === 0) return { ok: true, text: raw };
  const result = applyWrite(raw, [{ kind: "frontmatter-list", field, existing, add }]);
  return result.ok ? { ok: true, text: result.text } : result;
}
