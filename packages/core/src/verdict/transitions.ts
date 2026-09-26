// v2 contracts §4 (`lifecycle: append-only`, `history: <heading>`) · §5 (a
// transition is judged against the base, and is `unevaluated` without one)
// · the navigator's ruling 3 (both transitions are kernel, by id).
//
// Three transitions the kernel judges between a page and its base:
//   entry-edited        an `entries` section declared append-only: the
//                       base's entries are a prefix of the page's, in order.
//   claims-transition   an open claim of the base that is gone from every
//                       claims section of the page, not closed in place or
//                       moved, not corrected, and not recorded by a new dated
//                       entry quoting its core.
//   relation-removed    a relation of the base — its label and the page its
//                       target names — that is gone from its section
//                       and was not recorded by a new line of the section its
//                       `history` parameter names, quoting `label [[Target]]`.
//
// Ported by id from the old arms (stdlib/entries.ts `entry-mutated`,
// stdlib/claims-transition.ts, stdlib/relations.ts `relation-removed`),
// re-expressed over the §4 records. What changed with the grammar: a claim
// is matched by its category and its handle (the core's normalised
// identity), as the old arm matched category and core, so a claim closed in
// place or moved to another claims section keeps both and passes, and so
// does one whose provenance alone changed (the old arm called that an
// annotation of a `supersede` claim), while one whose category changed is a
// new claim and the old one left unclosed; the category classes
// are gone, so every open claim of a claims section is held, where the old
// arm held only the `supersede` and `accumulate` classes; and the History
// landing reads any new dated entry quoting the core, where the old one read
// the section the claims `history` parameter named, a parameter v2 drops.
import { normalizeIdentity } from "../identity/index.ts";
import type { ParsedPage } from "../interface/index.ts";
import type { LawType } from "../law/compose.ts";
import type { ClaimRecord, RelationRecord } from "../records/index.ts";
import { trigramJaccard } from "../text/index.ts";
import { declaredOccurrences, indexed } from "./grammar.ts";
import { PAGE_LOCATION, type Unrouted } from "./page.ts";
import type { FindingLocation } from "./table.ts";

/** The kernel transitions a type's sections govern. */
export function transitionRows(type: LawType): Set<string> {
  const out = new Set<string>();
  for (const section of type.sections?.list ?? []) {
    if (section.grammar === "entries" && section.params.lifecycle === "append-only")
      out.add("entry-edited");
    if (section.grammar === "claims") out.add("claims-transition");
    if (section.grammar === "relations") out.add("relation-removed");
  }
  return out;
}

/** Where a base physical occurrence stands now, or the page after removal/rename. */
function locationOf(
  page: ParsedPage,
  address: readonly { heading: string; index: number }[],
): FindingLocation {
  const now = indexed(page).find(
    (a) => JSON.stringify(a.occurrence.address) === JSON.stringify(address),
  );
  return now === undefined
    ? PAGE_LOCATION
    : {
        kind: "section",
        heading: now.occurrence.heading,
        occurrence: now.index,
        line: now.occurrence.location.line,
      };
}

/** `lifecycle: append-only`: the first base entry the page changed or removed, per occurrence. */
function entryFindings(page: ParsedPage, base: ParsedPage, type: LawType): Unrouted[] {
  const out: Unrouted[] = [];
  const current = declaredOccurrences(page, type);
  for (const { at, section } of declaredOccurrences(base, type)) {
    if (section.grammar !== "entries" || section.params.lifecycle !== "append-only") continue;
    const now = current.find(
      (c) =>
        JSON.stringify(c.at.occurrence.address) === JSON.stringify(at.occurrence.address) &&
        JSON.stringify(c.section.path) === JSON.stringify(section.path),
    );
    const items = now?.at.occurrence.items ?? [];
    for (let i = 0; i < at.occurrence.items.length; i += 1) {
      const was = at.occurrence.items[i];
      const is = items[i];
      if (was === undefined || is?.raw === was.raw) continue;
      out.push({
        rule: "entry-edited",
        severity: "error",
        path: page.path,
        location:
          is === undefined
            ? locationOf(page, at.occurrence.address)
            : {
                kind: "section",
                heading: at.occurrence.heading,
                occurrence: at.index,
                line: is.location.line,
              },
        message: `section "${at.occurrence.heading}" is append-only; entry ${i + 1} was ${is === undefined ? "removed" : "changed"} — restore it and record the correction as a new dated entry`,
        details: {
          heading: at.occurrence.heading,
          entry: i + 1,
          was: was.raw,
          is: is?.raw ?? null,
        },
      });
      break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// claims: the correction tolerance and the landing, ported from
// stdlib/claims-transition.ts (the kernel imports nothing from stdlib/).

const CORRECTED_MAX_EDITS = 3;
const CORRECTED_MIN_CORE = 12;
const CORRECTED_MIN_JACCARD = 0.9;

function digitSignature(core: string): string {
  return [...core].filter((ch) => /\p{Nd}/u.test(ch)).join("");
}

const NEGATION_WORDS = new Set("not no never none nor without cannot un non anti".split(" "));
const NEGATION_PREFIXES = "un non dis in im ir il anti".split(" ");
const NEGATION_CHARS = [..."不没無无非未勿别"];

/** The tokens of `from` that `other` does not hold, as a multiset: a counted pool, linear. */
function tokensOnlyIn(from: string, other: string): string[] {
  const pool = new Map<string, number>();
  for (const [token] of other.toLowerCase().matchAll(/[\p{L}\p{N}]+/gu))
    pool.set(token, (pool.get(token) ?? 0) + 1);
  const out: string[] = [];
  for (const [token] of from.toLowerCase().matchAll(/[\p{L}\p{N}]+/gu)) {
    const left = pool.get(token) ?? 0;
    if (left === 0) out.push(token);
    else pool.set(token, left - 1);
  }
  return out;
}

/** Whether two cores differ in polarity: deliberately allowed to over-fire. */
function polarityChanged(before: string, after: string): boolean {
  const count = (text: string, ch: string): number => [...text].filter((c) => c === ch).length;
  if (NEGATION_CHARS.some((ch) => count(before, ch) !== count(after, ch))) return true;
  const onlyBefore = tokensOnlyIn(before, after);
  const onlyAfter = tokensOnlyIn(after, before);
  if ([...onlyBefore, ...onlyAfter].some((t) => NEGATION_WORDS.has(t))) return true;
  const prefixed = (longer: string[], shorter: ReadonlySet<string>): boolean =>
    longer.some((t) =>
      NEGATION_PREFIXES.some((p) => t.startsWith(p) && shorter.has(t.slice(p.length))),
    );
  return prefixed(onlyAfter, new Set(onlyBefore)) || prefixed(onlyBefore, new Set(onlyAfter));
}

/**
 * Whether two strings are at most `max` edits apart, by code point: the
 * edit distance over the band of cells `max` either side of the diagonal,
 * since no cell outside it can be `max` or less. Linear in the length for a
 * fixed `max`; the full edit-distance table would be quadratic for two
 * long cores a typo apart.
 */
function withinEdits(a: string, b: string, max: number): boolean {
  const A = [...a];
  const B = [...b];
  const n = A.length;
  const m = B.length;
  if (Math.abs(n - m) > max) return false;
  const over = max + 1;
  let prev = new Array<number>(m + 1).fill(over);
  let row = new Array<number>(m + 1).fill(over);
  for (let j = 0; j <= Math.min(m, max); j += 1) prev[j] = j;
  for (let i = 1; i <= n; i += 1) {
    const lo = Math.max(1, i - max);
    const hi = Math.min(m, i + max);
    row[lo - 1] = lo === 1 && i <= max ? i : over;
    let best = row[lo - 1] ?? over;
    for (let j = lo; j <= hi; j += 1) {
      const cost = A[i - 1] === B[j - 1] ? 0 : 1;
      const value = Math.min(
        (row[j - 1] ?? over) + 1,
        (prev[j] ?? over) + 1,
        (prev[j - 1] ?? over) + cost,
        over,
      );
      row[j] = value;
      if (value < best) best = value;
    }
    if (hi < m) row[hi + 1] = over;
    if (best > max) return false;
    [prev, row] = [row, prev];
  }
  return (prev[m] ?? over) <= max;
}

/**
 * A typo-sized correction of a core, under the same category and the same
 * provenance, its digits and its polarity unchanged: a correction of the
 * record, not a change in the world.
 */
function isCorrection(before: ClaimRecord, after: ClaimRecord): boolean {
  if (before.category !== after.category) return false;
  if (
    before.provenance.kind !== after.provenance.kind ||
    before.provenance.value !== after.provenance.value
  )
    return false;
  const a = normalizeIdentity(before.core);
  const b = normalizeIdentity(after.core);
  if (a === b) return false;
  if (digitSignature(a) !== digitSignature(b) || polarityChanged(a, b)) return false;
  if (
    a.length >= CORRECTED_MIN_CORE &&
    b.length >= CORRECTED_MIN_CORE &&
    withinEdits(a, b, CORRECTED_MAX_EDITS)
  ) {
    return true;
  }
  return trigramJaccard(a, b) >= CORRECTED_MIN_JACCARD;
}

const wordish = (ch: string): boolean => ch !== "" && /[\p{L}\p{N}_]/u.test(ch);

/**
 * `text` quotes `core` as a whole segment: bounded by the edge or a
 * non-letter, non-digit. The neighbours are read where they stand, a
 * surrogate pair whole, so each occurrence costs its own length.
 */
function quotes(text: string, core: string): boolean {
  if (core === "") return false;
  let from = 0;
  for (;;) {
    const at = text.indexOf(core, from);
    if (at < 0) return false;
    const before = at === 0 ? "" : codePointBefore(text, at);
    const next = text.codePointAt(at + core.length);
    const after = next === undefined ? "" : String.fromCodePoint(next);
    if (!wordish(before) && !wordish(after)) return true;
    from = at + 1;
  }
}

/** Items of the page no item of the base accounts for, by raw line, as a multiset. */
function newItems<T extends { raw: string }>(current: readonly T[], base: readonly T[]): T[] {
  const pool = new Map<string, number>();
  for (const item of base) pool.set(item.raw, (pool.get(item.raw) ?? 0) + 1);
  return current.filter((item) => {
    const left = pool.get(item.raw) ?? 0;
    if (left === 0) return true;
    pool.set(item.raw, left - 1);
    return false;
  });
}

function claimsOf(
  page: ParsedPage,
  type: LawType,
): {
  heading: string;
  address: { heading: string; index: number }[];
  policy: string[];
  claim: ClaimRecord;
}[] {
  return declaredOccurrences(page, type).flatMap(({ at, section }) =>
    section.grammar !== "claims"
      ? []
      : at.occurrence.items.flatMap((item) =>
          item.kind === "claim"
            ? [
                {
                  heading: at.occurrence.heading,
                  address: at.occurrence.address,
                  policy: section.path,
                  claim: item,
                },
              ]
            : [],
        ),
  );
}

/**
 * The items a claim's record may land in: the dated entries. A claim landing
 * as a claim keeps its handle and is found by it; a new claim quoting an old
 * one is another claim, not its record.
 */
function landingItems(page: ParsedPage, type: LawType): { raw: string }[] {
  return declaredOccurrences(page, type).flatMap(({ at, section }) =>
    section.grammar === "entries" ? at.occurrence.items : [],
  );
}

/** An open claim of the base that left every claims section, unclosed and unrecorded. */
function claimFindings(page: ParsedPage, base: ParsedPage, type: LawType): Unrouted[] {
  const out: Unrouted[] = [];
  const current = claimsOf(page, type);
  const identity = (claim: ClaimRecord): string => `${claim.category}\u0000${claim.handle}`;
  const kept = new Set(current.map((c) => identity(c.claim)));
  const fresh = newItems(landingItems(page, type), landingItems(base, type)).map((i) =>
    normalizeIdentity(i.raw),
  );
  const corrected = new Set<ClaimRecord>();
  for (const { heading, address, policy, claim } of claimsOf(base, type)) {
    if (claim.retracted !== null || claim.superseded !== null) continue;
    if (kept.has(identity(claim))) continue;
    const correction = current.find(
      (c) =>
        JSON.stringify(c.policy) === JSON.stringify(policy) &&
        !corrected.has(c.claim) &&
        isCorrection(claim, c.claim),
    );
    if (correction !== undefined) {
      corrected.add(correction.claim);
      continue;
    }
    const core = normalizeIdentity(claim.core);
    if (fresh.some((raw) => quotes(raw, core))) continue;
    out.push({
      rule: "claims-transition",
      severity: "error",
      path: page.path,
      location: locationOf(page, address),
      message: `the open [${claim.category}] claim "${claim.core}" left "${heading}" without being closed: retract or supersede it, or record why in a dated entry quoting it`,
      details: { heading, handle: claim.handle, category: claim.category, core: claim.core },
    });
  }
  return out;
}

// A quoted relation is `label [[Target]]`: a run of letters, digits, `_` or
// `-`, whitespace, then a wikilink (with an optional `#heading` and
// `|alias`). Read from each `[[` — the target forward with an anchored
// pattern that stops at the next bracket, the label backward — so the scan
// is linear in the line. The one global pattern it replaces backtracked
// over every start of a long run of letters, cubic in the line's length: a
// History entry of 4,000 letters took seconds, and a page may hold a line
// of 1 MiB.
const QUOTED_TARGET = /([^\][|#\n]+)(?:#[^\][|\n]*)?(?:\|[^\][\n]*)?\]\]/uy;
const LABEL_CHAR = /^[\p{L}\p{N}_-]$/u;
const SPACE = /^\s$/u;

function relationIdentity(label: string, target: string): string {
  return `${normalizeIdentity(label)}\u0000${normalizeIdentity(target.trim())}`;
}

/** The code point that ends at `at` in `text`, a surrogate pair whole. */
function codePointBefore(text: string, at: number): string {
  const low = text.charCodeAt(at - 1);
  if (at >= 2 && low >= 0xdc00 && low <= 0xdfff) {
    const high = text.charCodeAt(at - 2);
    if (high >= 0xd800 && high <= 0xdbff) return text.slice(at - 2, at);
  }
  return text.slice(at - 1, at);
}

function quotedRelations(raw: string): Set<string> {
  const out = new Set<string>();
  let from = 0;
  for (;;) {
    const open = raw.indexOf("[[", from);
    if (open < 0) return out;
    from = open + 2;
    QUOTED_TARGET.lastIndex = open + 2;
    const target = QUOTED_TARGET.exec(raw);
    if (target === null) continue;
    let at = open;
    while (at > 0 && SPACE.test(raw.charAt(at - 1))) at -= 1;
    if (at === open) continue;
    const end = at;
    for (let ch = codePointBefore(raw, at); at > 0 && LABEL_CHAR.test(ch); ) {
      at -= ch.length;
      ch = at > 0 ? codePointBefore(raw, at) : "";
    }
    if (at === end) continue;
    out.add(relationIdentity(raw.slice(at, end), target[1] ?? ""));
    from = QUOTED_TARGET.lastIndex;
  }
}

/** A relation of the base that left its section and landed in no new line of its `history`. */
function relationFindings(page: ParsedPage, base: ParsedPage, type: LawType): Unrouted[] {
  const out: Unrouted[] = [];
  for (const section of type.sections?.list ?? []) {
    if (section.grammar !== "relations") continue;
    const of = (p: ParsedPage, policy: readonly string[]) =>
      declaredOccurrences(p, type).filter(
        (o) => JSON.stringify(o.section.path) === JSON.stringify(policy),
      );
    const relations = (
      p: ParsedPage,
    ): { record: RelationRecord; address: { heading: string; index: number }[] }[] =>
      of(p, section.path).flatMap((o) =>
        o.at.occurrence.items
          .filter((i): i is RelationRecord => i.kind === "relation")
          .map((record) => ({ record, address: o.at.occurrence.address })),
      );
    // A relation is the same relation when its label is and its target names
    // the same page: by the page the name resolves to, where it resolves, so
    // a move that renames the target and rewrites the link keeps it (the
    // base's names are the vault's, where the old name is the moved page's
    // alias), and by the name as written otherwise.
    const kept = (r: RelationRecord): string =>
      r.target.path === null
        ? relationIdentity(r.label, r.target.name)
        : `${normalizeIdentity(r.label)}\u0000path:${r.target.path}`;
    const survivors = new Map<string, number>();
    for (const { record } of relations(page)) {
      const id = kept(record);
      survivors.set(id, (survivors.get(id) ?? 0) + 1);
    }
    const history = section.params.history;
    const landed =
      history === undefined
        ? []
        : newItems(
            of(page, [history]).flatMap((o) => o.at.occurrence.items),
            of(base, [history]).flatMap((o) => o.at.occurrence.items),
          );
    for (const { record: relation, address } of relations(base)) {
      const id = relationIdentity(relation.label, relation.target.name);
      const key = kept(relation);
      const left = survivors.get(key) ?? 0;
      if (left > 0) {
        survivors.set(key, left - 1);
        continue;
      }
      if (landed.some((item) => quotedRelations(item.raw).has(id))) continue;
      const quoted = `${relation.label} [[${relation.target.name}]]`;
      out.push({
        rule: "relation-removed",
        severity: "error",
        path: page.path,
        location: locationOf(page, address),
        message:
          history === undefined
            ? `the relation "${quoted}" left "${section.heading}", and the section names no history to record it in: restore it, or declare \`history\` and close it there`
            : `the relation "${quoted}" left "${section.heading}" and landed nowhere: restore it, or record it in "${history}" with a dated entry quoting it`,
        details: {
          heading: section.heading,
          label: relation.label,
          target: relation.target.name,
          ...(history === undefined ? {} : { history }),
        },
      });
    }
  }
  return out;
}

/** The three kernel transitions between a page and its base, under the page's type. */
export function transitionFindings(page: ParsedPage, base: ParsedPage, type: LawType): Unrouted[] {
  return [
    ...entryFindings(page, base, type),
    ...claimFindings(page, base, type),
    ...relationFindings(page, base, type),
  ];
}
