// v2 contracts §4: the fixed grammar. Under a section that declares a
// grammar, every top-level list item is parsed into one record of three
// kinds — a claim, a relation, a dated entry — each in one canonical
// spelling, with its raw line, its rationale (the lines indented under it)
// and its location as a line and a UTF-8 byte span. A top-level item that
// does not parse is `item-unparsed`. Prose between items is ignored.
//
// The claim's lifecycle clause is today's, kept as the one canonical form:
// the spelling `write` renders (packages/cli/src/verbs/write.ts, closeLine and
// supersedeClause) and the old parser reads (stdlib/claims-parse.ts,
// RETRACTED and VALID_WHOLE): a trailing `(retracted YYYY-MM-DD)` or
// `(valid YYYY-MM-DD→YYYY-MM-DD, superseded YYYY-MM-DD)`, the first date
// optional, and after the supersession date an optional ` by #xxxxxxxx`
// naming the claim that replaced it (the navigator's ruling 5; `write`'s
// `supersede` operation writes it from step 4). The handle is today's too:
// `#` and the first eight hex digits of sha256 over the core's normalised
// identity, computed, never written on the claim itself.
import { sha256Hex } from "../hash/index.ts";
import { normalizeIdentity } from "../identity/index.ts";
import { isDate } from "../schema/formats.ts";

export interface Location {
  line: number;
  /** UTF-8 byte offsets into the file, end exclusive. */
  span: [number, number];
}

export interface ClaimRecord {
  kind: "claim";
  handle: string;
  category: string;
  core: string;
  provenance: { kind: "page" | "url" | "path" | "none"; value: string | null };
  retracted: { date: string } | null;
  superseded: {
    date: string;
    by: string | null;
    valid_from: string | null;
    valid_to: string;
  } | null;
  rationale: string[];
  raw: string;
  location: Location;
}

export interface RelationTarget {
  name: string;
  heading: string | null;
  alias: string | null;
  path: string | null;
  resolved: boolean;
  type: string | null;
}

export interface RelationRecord {
  kind: "relation";
  label: string;
  target: RelationTarget;
  rationale: string[];
  raw: string;
  location: Location;
}

export interface EntryRecord {
  kind: "entry";
  date: string;
  precision: "day" | "month" | "year";
  text: string;
  rationale: string[];
  raw: string;
  location: Location;
}

export type GrammarRecord = ClaimRecord | RelationRecord | EntryRecord;

/** Where a relation's target lives in the vault, when it resolves. */
export type ResolveTarget = (name: string) => { path: string; type: string } | undefined;

const DAY = "\\d{4}-\\d{2}-\\d{2}";
const RETRACTED = new RegExp(`^retracted (${DAY})$`, "u");
const SUPERSEDED = new RegExp(
  `^valid (${DAY})?→(${DAY}), superseded (${DAY})(?: by (#[0-9a-f]{8}))?$`,
  "u",
);
/**
 * A parenthetical shaped like a lifecycle clause: one of its three words, in
 * any letter case, then a date or an arrow. One that is not the canonical
 * clause is refused; any other trailing parenthetical — "(valid for zone
 * 7)", "(superseded by hybrids)" — is core text (§4).
 */
const LIFECYCLE_SHAPE = /^(?:retracted|valid|superseded)\s+(?:\d{4}-|→|->)/iu;
const CLAIM = /^- \[([^[\]\s][^[\]]*)\] (\S.*)$/u;
const WIKILINK_ONLY = /^\[\[([^[\]|#]+)(?:#([^[\]|]*))?(?:\|([^[\]]*))?\]\]$/u;
const URL_ONLY = /^https?:\/\/\S+$/u;
const RELATION = /^- ([^\s[\]]+) \[\[([^[\]|#]+)(?:#([^[\]|]+))?(?:\|([^[\]]+))?\]\]$/u;
const ENTRY = /^- (\d{4})(?:-(\d{2})(?:-(\d{2}))?)? — (\S.*)$/u;

/** The claim handle (today's formula, kept). */
export function claimHandle(core: string): string {
  return `#${sha256Hex(normalizeIdentity(core)).slice(0, 8)}`;
}

/** The trailing balanced parenthetical of `text`, if it ends in one preceded by a space. */
function trailingParenthetical(text: string): { body: string; before: string } | undefined {
  if (!text.endsWith(")")) return undefined;
  let depth = 0;
  for (let i = text.length - 1; i >= 0; i -= 1) {
    const ch = text[i];
    if (ch === ")") depth += 1;
    else if (ch === "(") {
      depth -= 1;
      if (depth === 0) {
        if (i === 0 || text[i - 1] !== " ") return undefined;
        return { body: text.slice(i + 1, -1), before: text.slice(0, i - 1) };
      }
    }
  }
  return undefined;
}

/**
 * §4 provenance: a path under a declared source root — one token, `/`
 * separated, no empty or `..` segment, strictly below the root.
 */
function underSourceRoot(token: string, sourceRoots: readonly string[]): boolean {
  if (/\s/u.test(token) || !token.includes("/")) return false;
  const spine = token.endsWith("/") ? token.slice(0, -1) : token;
  if (spine.split("/").some((s) => s === "" || s === "." || s === "..")) return false;
  return sourceRoots.some((root) => spine.startsWith(`${root}/`) && spine.length > root.length + 1);
}

type Parsed<T> = { record: Omit<T, "rationale" | "raw" | "location"> } | { reason: string };

export function parseClaimLine(line: string, sourceRoots: readonly string[]): Parsed<ClaimRecord> {
  const m = CLAIM.exec(line);
  if (m === null) return { reason: "a claim is `- [category] core (provenance)`" };
  const category = m[1] ?? "";
  let rest = m[2] ?? "";
  let retracted: ClaimRecord["retracted"] = null;
  let superseded: ClaimRecord["superseded"] = null;
  let last = trailingParenthetical(rest);
  if (last !== undefined && LIFECYCLE_SHAPE.test(last.body)) {
    const r = RETRACTED.exec(last.body);
    const s = SUPERSEDED.exec(last.body);
    if (r !== null) retracted = { date: r[1] ?? "" };
    else if (s !== null) {
      superseded = {
        date: s[3] ?? "",
        by: s[4] ?? null,
        valid_from: s[1] ?? null,
        valid_to: s[2] ?? "",
      };
    } else {
      return {
        reason: `"(${last.body})" is not the lifecycle clause: \`(retracted YYYY-MM-DD)\` or \`(valid YYYY-MM-DD→YYYY-MM-DD, superseded YYYY-MM-DD)\`, optionally \` by #xxxxxxxx\` after the supersession date`,
      };
    }
    const dates = [retracted?.date, superseded?.date, superseded?.valid_to, superseded?.valid_from];
    if (dates.some((d) => d !== undefined && d !== null && !isDate(d))) {
      return { reason: `"(${last.body})" names a day that is not on the calendar` };
    }
    rest = last.before;
    last = trailingParenthetical(rest);
  }
  let provenance: ClaimRecord["provenance"] = { kind: "none", value: null };
  if (last !== undefined) {
    const link = WIKILINK_ONLY.exec(last.body);
    if (link !== null) provenance = { kind: "page", value: (link[1] ?? "").trim() };
    else if (URL_ONLY.test(last.body)) provenance = { kind: "url", value: last.body };
    else if (underSourceRoot(last.body, sourceRoots))
      provenance = { kind: "path", value: last.body };
    if (provenance.kind !== "none") rest = last.before;
  }
  // A lifecycle clause anywhere but last is not the canonical form either.
  const stray = trailingParenthetical(rest);
  if (stray !== undefined && LIFECYCLE_SHAPE.test(stray.body)) {
    return { reason: `"(${stray.body})": the lifecycle clause comes last, after the provenance` };
  }
  const core = rest.trim();
  if (core === "") return { reason: "a claim has a core between its category and its provenance" };
  return {
    record: {
      kind: "claim",
      handle: claimHandle(core),
      category,
      core,
      provenance,
      retracted,
      superseded,
    },
  };
}

export function parseRelationLine(line: string, resolve: ResolveTarget): Parsed<RelationRecord> {
  const m = RELATION.exec(line);
  if (m === null)
    return {
      reason: "a relation is `- label [[Target]]`, `[[Target#Heading]]` or `[[Target|alias]]`",
    };
  const name = (m[2] ?? "").trim();
  const found = name === "" ? undefined : resolve(name);
  return {
    record: {
      kind: "relation",
      label: m[1] ?? "",
      target: {
        name,
        heading: m[3] === undefined ? null : m[3].trim(),
        alias: m[4] === undefined ? null : m[4].trim(),
        path: found?.path ?? null,
        resolved: found !== undefined,
        type: found?.type ?? null,
      },
    },
  };
}

export function parseEntryLine(line: string): Parsed<EntryRecord> {
  const m = ENTRY.exec(line);
  if (m === null)
    return { reason: "an entry is `- YYYY-MM-DD — text`, `- YYYY-MM — text` or `- YYYY — text`" };
  const [year, month, day, text] = [m[1] ?? "", m[2], m[3], m[4] ?? ""];
  if (month !== undefined && (Number(month) < 1 || Number(month) > 12)) {
    return { reason: `"${year}-${month}" names no month` };
  }
  if (day !== undefined && !isDate(`${year}-${month}-${day}`)) {
    return { reason: `"${year}-${month}-${day}" is not on the calendar` };
  }
  const date =
    day !== undefined ? `${year}-${month}-${day}` : month !== undefined ? `${year}-${month}` : year;
  const precision = day !== undefined ? "day" : month !== undefined ? "month" : "year";
  return { record: { kind: "entry", date, precision, text } };
}
