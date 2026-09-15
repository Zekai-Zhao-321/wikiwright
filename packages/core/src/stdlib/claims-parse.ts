// docs/extending.md §What a module registers (the standard library registers through the same API a kit
// uses) · docs/concepts.md §Section grammar (the item EBNF; "a marker is a complete clause"; the
// rationale rule) · docs/constitution.md §Sections (the parameters this grammar declares)
// docs/architecture.md §The invariants (this file is why the boundary is real —
// the regexes below were the last of the claims grammar living in the kernel).
//
// The `claims` item shape and its parser. Split from the manifest beside it
// because a reader looking for what an arm DECIDES should not have to page past
// four hundred lines of lexical shapes to reach it.

import type { Fields, ItemBase } from "../grammar/index.ts";
import { sha256Hex } from "../hash/index.ts";
import { normalizeIdentity } from "../identity/index.ts";
import type { ParseContext } from "../modules/index.ts";

/**
 * The parameters the `claims` grammar declares, as this module's own parsers
 * and arms read them — a MODULE's typed view of its own parameters. The kernel
 * keeps only the opaque `DeclaredParams`; the one cast below asserts what the
 * loader already proved, because every value here was parsed by the module's
 * own schema before a binding existed.
 */
export interface ClaimsParams {
  /** The heading retired claims land in. */
  history?: string;
  /** Whether an item must carry a provenance clause. */
  provenance?: "required" | "optional";
  /** The provenance forms this section admits (default: all six). */
  forms?: readonly ProvenanceForm[];
  /** The tags the `sourced` form may open with. */
  sources?: readonly string[];
  /** This section IS a History section — it admits claims and entries. */
  role?: "history";
  /** The vocabulary this section's categories are checked against. */
  vocabulary?: string;
  /** The legacy spelling of `vocabulary: "categories"`. */
  categories?: "claim-classes";
  /** The subset of the vocabulary this section admits. */
  only?: readonly string[];
  /** The item kinds a `role: history` section admits. */
  items?: readonly ("claim" | "entry")[];
  /** `required` promotes a shorthand `inferred` ref from census to finding. */
  inferred_ref?: "required" | "optional";
}

export type ProvenanceForm =
  | "stated"
  | "stated-by"
  | "inferred"
  | "sourced"
  | "recorded"
  | "legacy";

/** The closed form set; `forms` on a section entry narrows it, never widens. */
export const PROVENANCE_FORMS: readonly ProvenanceForm[] = [
  "stated",
  "stated-by",
  "inferred",
  "sourced",
  "recorded",
  "legacy",
];

export interface ProvenanceClause {
  form: ProvenanceForm;
  raw: string;
  date?: string;
  who?: string;
  ref?: string;
  refShape?: "path" | "wikilink" | "shorthand";
  source?: string;
  /**
   * How the marker was recognized when no keyword said so (docs/concepts.md §Section grammar):
   * `path-only` is the bare `(raw/web/…)` dialect, admitted because the
   * token resolves under a declared source root. Recorded so the census can
   * count a recognition the reader inferred from shape rather than read.
   */
  dialect?: "path-only";
}

export interface ClosingClause {
  kind: "superseded" | "retracted";
  raw: string;
  validFrom?: string;
  validTo?: string;
  date?: string;
}

export interface ClaimItem extends ItemBase {
  kind: "claim";
  category: string;
  categoryId: string;
  /** The item text minus MARKER parentheticals only (docs/concepts.md §Section grammar). */
  core: string;
  coreId: string;
  handle: string;
  provenance?: ProvenanceClause;
  closing?: ClosingClause;
  /** First complete clause wins; the rest is kept, never erased (docs/concepts.md §Section grammar). */
  provenanceExtra?: ProvenanceClause[];
  closingExtra?: ClosingClause[];
  /** Keyword-opened parentheticals that did not complete — core text, counted. */
  markerLike: string[];
}

// ---------------------------------------------------------------------------
// lexical shapes

// ASCII [category] or full-width 【category】. Checkbox shapes, letterless status
// markers and wikilink-leading bullets are not claims.
const CLAIM_MARK = /^(?:\[([^[\]\n]+)\]|【([^【】\n]+)】)\s*(.*)$/u;
const CLAUSE_KEYWORD = /^(?:stated|inferred|recorded|legacy|valid|retracted|superseded)\b/iu;
const ISO_AT_END = /(\d{4}-\d{2}-\d{2})\s*$/u;
const SKIPPABLE = /[\s.。:：;；,!！*]/u;

const D_FULL = String.raw`\d{4}-\d{2}-\d{2}`;
const D_PART = String.raw`\d{4}(?:-\d{2}(?:-\d{2})?)?`;
const STATED_BY = /^stated\s+by\s+(\S.*)$/iu;
const STATED = new RegExp(`^stated\\s+(${D_FULL})$`, "iu");
const INFERRED_BARE = /^inferred$/iu;
const INFERRED_COLON = /^inferred\s*[:：]\s*(\S.*)$/iu;
const RECORDED = new RegExp(`^recorded\\s+(${D_FULL})$`, "iu");
const LEGACY = /^legacy$/iu;
const RETRACTED = new RegExp(`^retracted\\s+(${D_FULL})$`, "iu");
const VALID_HEAD = new RegExp(`^valid\\s*(${D_PART})?\\s*(?:→|->)\\s*(${D_PART})?$`, "iu");
const VALID_WHOLE = new RegExp(
  `^valid\\s*(${D_PART})?\\s*(?:→|->)\\s*(${D_PART})?\\s+superseded\\s+(${D_FULL})$`,
  "iu",
);
const SUPERSEDED = new RegExp(`^superseded\\s+(${D_FULL})$`, "iu");

// ---------------------------------------------------------------------------
// the parser

/** `#` + the first 8 hex of sha256 over the normalized core (docs/concepts.md §Section grammar). */
export function claimHandle(core: string): string {
  return `#${sha256Hex(normalizeIdentity(core)).slice(0, 8)}`;
}

interface ParenSpan {
  start: number;
  end: number;
  body: string;
}

/**
 * Peel the trailing parenthetical run, balanced and nesting-aware, ASCII ``
 * and full-width `（）` alike, tolerating the sentence punctuation and bold
 * wrapping the corpus writes after an envelope. A text that is ENTIRELY one
 * parenthetical keeps it: the parenthetical is the content then.
 */
function peelTrailingParens(text: string): ParenSpan[] {
  const spans: ParenSpan[] = [];
  let end = text.length;
  for (;;) {
    let j = end;
    while (j > 0 && SKIPPABLE.test(text[j - 1] ?? "")) j -= 1;
    if (j === 0) break;
    const close = text[j - 1];
    const open = close === ")" ? "(" : close === "）" ? "（" : undefined;
    if (open === undefined || close === undefined) break;
    let depth = 0;
    let start = -1;
    for (let i = j - 1; i >= 0; i -= 1) {
      const ch = text[i];
      if (ch === close) depth += 1;
      else if (ch === open) {
        depth -= 1;
        if (depth === 0) {
          start = i;
          break;
        }
      }
    }
    if (start <= 0) break;
    spans.unshift({ start, end: j, body: text.slice(start + 1, j - 1).trim() });
    end = start;
  }
  return spans;
}

/** Remove the marker spans; everything else survives byte-for-byte. */
function excise(text: string, spans: readonly ParenSpan[]): string {
  let out = text;
  for (let i = spans.length - 1; i >= 0; i -= 1) {
    const span = spans[i];
    if (span === undefined) continue;
    out = out.slice(0, span.start).replace(/[ \t]+$/u, "") + out.slice(span.end);
  }
  return out.trim();
}

function splitSegments(body: string): string[] {
  return body
    .split(/[,;；]/u)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

interface Clause {
  provenance?: ProvenanceClause;
  closing?: ClosingClause;
}

function inferredClause(ref: string, raw: string): ProvenanceClause {
  const refShape = ref.startsWith("[[") ? "wikilink" : ref.includes("/") ? "path" : "shorthand";
  return { form: "inferred", raw, ref, refShape };
}

/**
 * The bare-path provenance form (docs/concepts.md §Section grammar): a body that is EXACTLY
 * one path-shaped token sitting under a declared root. Three bounds, all here:
 * one token (no whitespace, no second segment — a body with prose beside the
 * path is prose), path-shaped (contains `/`, so a Windows-style `raw\web\x`
 * is not one and platform separators never leak into the grammar), and under a
 * DECLARED root, matched segment-wise so `rawish/x` is not under `raw`.
 * Containment, not existence: whether the referent is on disk is a later arm's
 * question. Undeclared roots recognize nothing — the engine never infers an
 * evidence root from a directory name.
 */
function pathOnlyRef(body: string, roots: readonly string[]): string | undefined {
  // `./` is stripped from the token exactly as it already is from the
  // root below, so the two sides normalize the same way; the stripped token is
  // the recorded ref.
  const token = body.trim().replace(/^\.\//u, "");
  if (token === "" || /\s/u.test(token) || !token.includes("/")) return undefined;
  // One trailing slash denotes a directory item and belongs to the ref; every
  // OTHER empty segment, and any `..`, is a path the engine would have to guess
  // at, which is not a ref.
  const spine = token.endsWith("/") ? token.slice(0, -1) : token;
  if (spine.split("/").some((segment) => segment === "" || segment === "..")) return undefined;
  for (const root of roots) {
    const normalized = root.replace(/^\.\//u, "").replace(/\/+$/u, "");
    if (normalized === "") continue;
    // "sits UNDER the root": a non-empty segment must follow it, so the root
    // itself — `(raw/)`, `(raw)` — is not a ref to anything.
    if (spine.length > normalized.length + 1 && spine.startsWith(`${normalized}/`)) return token;
  }
  return undefined;
}

function matchClause(
  segments: readonly string[],
  i: number,
): { consume: number; clause: Clause } | undefined {
  const seg = segments[i];
  if (seg === undefined) return undefined;
  const next = segments[i + 1];

  const by = STATED_BY.exec(seg);
  if (by !== null) {
    return {
      consume: 1,
      clause: { provenance: { form: "stated-by", raw: seg, who: (by[1] ?? "").trim() } },
    };
  }
  const stated = STATED.exec(seg);
  if (stated !== null) {
    return {
      consume: 1,
      clause: { provenance: { form: "stated", raw: seg, date: stated[1] ?? "" } },
    };
  }
  if (INFERRED_BARE.test(seg) && next !== undefined) {
    return { consume: 2, clause: { provenance: inferredClause(next, `${seg}, ${next}`) } };
  }
  const colon = INFERRED_COLON.exec(seg);
  if (colon !== null) {
    return { consume: 1, clause: { provenance: inferredClause((colon[1] ?? "").trim(), seg) } };
  }
  const recorded = RECORDED.exec(seg);
  if (recorded !== null) {
    return {
      consume: 1,
      clause: { provenance: { form: "recorded", raw: seg, date: recorded[1] ?? "" } },
    };
  }
  if (LEGACY.test(seg)) return { consume: 1, clause: { provenance: { form: "legacy", raw: seg } } };
  const retracted = RETRACTED.exec(seg);
  if (retracted !== null) {
    return {
      consume: 1,
      clause: { closing: { kind: "retracted", raw: seg, date: retracted[1] ?? "" } },
    };
  }
  const whole = VALID_WHOLE.exec(seg);
  if (whole !== null) {
    return { consume: 1, clause: { closing: closingFrom(seg, whole[1], whole[2], whole[3]) } };
  }
  const head = VALID_HEAD.exec(seg);
  if (head !== null && next !== undefined) {
    const tail = SUPERSEDED.exec(next);
    if (tail !== null) {
      return {
        consume: 2,
        clause: { closing: closingFrom(`${seg}, ${next}`, head[1], head[2], tail[1]) },
      };
    }
  }
  return undefined;
}

function closingFrom(
  raw: string,
  from: string | undefined,
  to: string | undefined,
  date: string | undefined,
): ClosingClause {
  const out: ClosingClause = { kind: "superseded", raw };
  if (from !== undefined) out.validFrom = from;
  if (to !== undefined) out.validTo = to;
  if (date !== undefined) out.date = date;
  return out;
}

type ParenVerdict =
  | {
      kind: "marker";
      provenance?: ProvenanceClause;
      closing?: ClosingClause;
      provenanceExtra?: ProvenanceClause[];
      closingExtra?: ClosingClause[];
    }
  | { kind: "marker-like" }
  | { kind: "core" };

function firstToken(body: string): string {
  return (body.split(/[\s,;；:：]+/u)[0] ?? "").replace(/[)）.]+$/u, "");
}

/**
 * A parenthetical is a MARKER iff it matches a complete clause shape (or the
 * `sourced` shape the section declares). Everything else is core text — and a
 * keyword-opened parenthetical that does not complete is counted, never eaten.
 */
function classifyParen(body: string, ctx: ParseContext): ParenVerdict {
  const params = ctx.params as ClaimsParams;
  const forms = new Set<ProvenanceForm>(params.forms ?? PROVENANCE_FORMS);
  const segments = splitSegments(body);
  const clauses: Clause[] = [];
  let i = 0;
  while (i < segments.length) {
    const matched = matchClause(segments, i);
    if (matched === undefined) {
      // `body ::= clause { sep (clause | free) }`: the body must OPEN with a
      // clause, but once it has, a free segment does not end the read. Breaking
      // here made `(stated D, wechat, valid X→Y, superseded Z)` lose its closing
      // and read as an open claim, so the verdict depended on segment order.
      if (clauses.length === 0) break;
      i += 1;
      continue;
    }
    clauses.push(matched.clause);
    i += matched.consume;
  }
  if (clauses.length > 0) {
    const verdict: ParenVerdict = { kind: "marker" };
    const provenanceExtra: ProvenanceClause[] = [];
    const closingExtra: ClosingClause[] = [];
    for (const clause of clauses) {
      if (clause.provenance !== undefined) {
        if (!forms.has(clause.provenance.form)) return { kind: "marker-like" };
        // First complete clause of each slot wins; the rest is kept (docs/concepts.md §Section grammar).
        if (verdict.provenance === undefined) verdict.provenance = clause.provenance;
        else provenanceExtra.push(clause.provenance);
      }
      if (clause.closing !== undefined) {
        if (verdict.closing === undefined) verdict.closing = clause.closing;
        else closingExtra.push(clause.closing);
      }
    }
    if (provenanceExtra.length > 0) verdict.provenanceExtra = provenanceExtra;
    if (closingExtra.length > 0) verdict.closingExtra = closingExtra;
    return verdict;
  }
  // One token under a declared root, before every keyword-shaped and
  // date-shaped reading WITHIN this body. Nothing that is a single
  // separator-free token can also be a completed clause, and a path is stronger
  // evidence than the `sourced` punctuation habit — so the strongest
  // recognition is tried first and the weaker one's census row cannot claim the
  // line. ACROSS bodies the precedence is the other way round: see
  // `parseClaim`, which is where the claim's one provenance slot is filled.
  if (forms.has("inferred")) {
    const ref = pathOnlyRef(body, ctx.sourceRoots);
    if (ref !== undefined) {
      return {
        kind: "marker",
        provenance: { form: "inferred", raw: body, ref, refShape: "path", dialect: "path-only" },
      };
    }
  }
  if (CLAUSE_KEYWORD.test(body)) return { kind: "marker-like" };
  if (forms.has("sourced")) {
    const sources = new Set((params.sources ?? []).map((s) => normalizeIdentity(s)));
    const head = normalizeIdentity(firstToken(body));
    const iso = ISO_AT_END.exec(body);
    if (head !== "" && sources.has(head)) {
      const provenance: ProvenanceClause = { form: "sourced", raw: body, source: firstToken(body) };
      if (iso?.[1] !== undefined) provenance.date = iso[1];
      return { kind: "marker", provenance };
    }
    if (iso?.[1] !== undefined) {
      return { kind: "marker", provenance: { form: "sourced", raw: body, date: iso[1] } };
    }
  }
  return { kind: "core" };
}

export function parseClaim(text: string, ctx: ParseContext): Fields<ClaimItem> | undefined {
  const marked = CLAIM_MARK.exec(text);
  if (marked === null) return undefined;
  const category = (marked[1] ?? marked[2] ?? "").trim();
  if (category === "" || /^[xX]$/u.test(category) || !/\p{L}/u.test(category)) return undefined;
  const rest = (marked[3] ?? "").trim();
  const spans = peelTrailingParens(rest);
  const markerSpans: ParenSpan[] = [];
  const markerLike: string[] = [];
  let closing: ClosingClause | undefined;
  const recognized: ProvenanceClause[] = [];
  const closingExtra: ClosingClause[] = [];
  for (const span of spans) {
    const verdict = classifyParen(span.body, ctx);
    if (verdict.kind === "marker") {
      markerSpans.push(span);
      if (verdict.provenance !== undefined) recognized.push(verdict.provenance);
      if (verdict.closing !== undefined) {
        if (closing === undefined) closing = verdict.closing;
        else closingExtra.push(verdict.closing);
      }
      recognized.push(...(verdict.provenanceExtra ?? []));
      closingExtra.push(...(verdict.closingExtra ?? []));
    } else if (verdict.kind === "marker-like") {
      markerLike.push(span.body);
    }
  }
  // The one provenance slot is first-marker-wins among the KEYWORD
  // forms; the bare-path dialect takes it only when no span yielded one. Filling
  // it in plain span order let a path typed first take the slot from an adjacent
  // `(stated by …)` or `(inferred, wechat)` and delete that clause's census row,
  // so `hearsay` and `provenance-weak` counted differently depending on which
  // parenthetical the writer typed first. Every recognized clause is kept either
  // way, and every marker span leaves the core either way.
  const winner = recognized.findIndex((clause) => clause.dialect !== "path-only");
  const slot = winner === -1 ? 0 : winner;
  const provenance = recognized[slot];
  const provenanceExtra = recognized.filter((_, index) => index !== slot);
  const core = excise(rest, markerSpans);
  const item: Fields<ClaimItem> = {
    kind: "claim",
    category,
    categoryId: normalizeIdentity(category),
    core,
    coreId: normalizeIdentity(core),
    handle: claimHandle(core),
    markerLike,
  };
  if (provenance !== undefined) item.provenance = provenance;
  if (closing !== undefined) item.closing = closing;
  if (provenanceExtra.length > 0) item.provenanceExtra = provenanceExtra;
  if (closingExtra.length > 0) item.closingExtra = closingExtra;
  return item;
}
