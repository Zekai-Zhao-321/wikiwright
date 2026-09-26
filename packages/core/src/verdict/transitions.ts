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
//   relation-removed    a relation of the base that is gone from its section
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
import { boundedLevenshtein, trigramJaccard } from "../text/index.ts";
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

/** Where a base occurrence's heading stands in the page now: its same occurrence, or the page. */
function locationOf(page: ParsedPage, heading: string, index: number): FindingLocation {
  const now = indexed(page).find((a) => a.occurrence.heading === heading && a.index === index);
  return now === undefined
    ? PAGE_LOCATION
    : { kind: "section", heading, occurrence: index, line: now.occurrence.location.line };
}

/** `lifecycle: append-only`: the first base entry the page changed or removed, per occurrence. */
function entryFindings(page: ParsedPage, base: ParsedPage, type: LawType): Unrouted[] {
  const out: Unrouted[] = [];
  const appendOnly = new Set(
    (type.sections?.list ?? [])
      .filter((s) => s.grammar === "entries" && s.params.lifecycle === "append-only")
      .map((s) => s.heading),
  );
  const current = declaredOccurrences(page, type);
  for (const { at } of declaredOccurrences(base, type)) {
    if (!appendOnly.has(at.occurrence.heading)) continue;
    const now = current.find(
      (c) => c.at.occurrence.heading === at.occurrence.heading && c.at.index === at.index,
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
            ? locationOf(page, at.occurrence.heading, at.index)
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

function tokensOnlyIn(from: string, other: string): string[] {
  const pool = [...other.toLowerCase().matchAll(/[\p{L}\p{N}]+/gu)].map((m) => m[0]);
  const out: string[] = [];
  for (const [token] of from.toLowerCase().matchAll(/[\p{L}\p{N}]+/gu)) {
    const at = pool.indexOf(token);
    if (at < 0) out.push(token);
    else pool.splice(at, 1);
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
  const prefixed = (longer: string[], shorter: string[]): boolean =>
    longer.some((t) =>
      NEGATION_PREFIXES.some((p) => t.startsWith(p) && shorter.includes(t.slice(p.length))),
    );
  return prefixed(onlyAfter, onlyBefore) || prefixed(onlyBefore, onlyAfter);
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
    boundedLevenshtein(a, b, CORRECTED_MAX_EDITS) <= CORRECTED_MAX_EDITS
  ) {
    return true;
  }
  return trigramJaccard(a, b) >= CORRECTED_MIN_JACCARD;
}

const wordish = (ch: string): boolean => ch !== "" && /[\p{L}\p{N}_]/u.test(ch);

/** `text` quotes `core` as a whole segment: bounded by the edge or a non-letter, non-digit. */
function quotes(text: string, core: string): boolean {
  if (core === "") return false;
  let from = 0;
  for (;;) {
    const at = text.indexOf(core, from);
    if (at < 0) return false;
    const before = at === 0 ? "" : ([...text.slice(0, at)].at(-1) ?? "");
    const after = [...text.slice(at + core.length)][0] ?? "";
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
): { heading: string; index: number; claim: ClaimRecord }[] {
  return declaredOccurrences(page, type).flatMap(({ at, section }) =>
    section.grammar !== "claims"
      ? []
      : at.occurrence.items.flatMap((item) =>
          item.kind === "claim"
            ? [{ heading: at.occurrence.heading, index: at.index, claim: item }]
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
  for (const { heading, index, claim } of claimsOf(base, type)) {
    if (claim.retracted !== null || claim.superseded !== null) continue;
    if (kept.has(identity(claim))) continue;
    const correction = current.find(
      (c) => c.heading === heading && !corrected.has(c.claim) && isCorrection(claim, c.claim),
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
      location: locationOf(page, heading, index),
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
    const of = (p: ParsedPage, heading: string) =>
      declaredOccurrences(p, type).filter((o) => o.at.occurrence.heading === heading);
    const relations = (p: ParsedPage): RelationRecord[] =>
      of(p, section.heading).flatMap((o) =>
        o.at.occurrence.items.filter((i): i is RelationRecord => i.kind === "relation"),
      );
    const survivors = new Map<string, number>();
    for (const r of relations(page)) {
      const id = relationIdentity(r.label, r.target.name);
      survivors.set(id, (survivors.get(id) ?? 0) + 1);
    }
    const history = section.params.history;
    const landed =
      history === undefined
        ? []
        : newItems(
            of(page, history).flatMap((o) => o.at.occurrence.items),
            of(base, history).flatMap((o) => o.at.occurrence.items),
          );
    for (const relation of relations(base)) {
      const id = relationIdentity(relation.label, relation.target.name);
      const left = survivors.get(id) ?? 0;
      if (left > 0) {
        survivors.set(id, left - 1);
        continue;
      }
      if (landed.some((item) => quotedRelations(item.raw).has(id))) continue;
      const quoted = `${relation.label} [[${relation.target.name}]]`;
      out.push({
        rule: "relation-removed",
        severity: "error",
        path: page.path,
        location: locationOf(page, section.heading, 0),
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
