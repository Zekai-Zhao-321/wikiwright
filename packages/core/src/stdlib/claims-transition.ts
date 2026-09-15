// docs/extending.md §An arm: the claims grammar's half of a transition — what a
// claim MEANS between two revisions. The kernel parses both revisions and hands
// this module the items of the section and of the History section it names;
// the matching by identity, the History landing escapes, the corrected
// tolerance and the disposition table are this module's, and the kernel reads
// nothing inside a claim. The generic text metrics the tolerance composes over
// stay kernel utilities (`../text/index.ts`) — `vocabulary show` uses
// Levenshtein on a path with nothing to do with claims.
import { normalizeIdentity } from "../identity/index.ts";
import type { TransitionContext, TransitionItem } from "../modules/index.ts";
import { type FlattenedRegistry, resolveVocabularyEntry } from "../registry/index.ts";
import { boundedLevenshtein, trigramJaccard } from "../text/index.ts";
import type { ClaimItem } from "./claims-parse.ts";

/** The vocabulary the disposition classes are read from; the module declares it. */
const CATEGORIES = "categories";

/**
 * The lifecycle class of a claim's category, read off the vocabulary this
 * module owns and through its aliases — the one reading the arms make, offered
 * to a verb so that `write`'s claims forms ask the module what a class is
 * rather than naming the vocabulary and its property themselves.
 */
export function claimClass(registry: FlattenedRegistry, claim: ClaimItem): string | undefined {
  const resolved = resolveVocabularyEntry(registry.vocabularies.get(CATEGORIES), claim.category);
  const cls = resolved?.entry.properties["class"];
  return typeof cls === "string" ? cls : undefined;
}

/**
 * docs/concepts.md §Section grammar: the `corrected` tolerance, with the length floor the
 * record states. Levenshtein ≤ 3 is a typo only when there is enough core for
 * three edits to be a typo — on a five-character core three edits are a
 * different fact — so the edit-distance arm carries a floor and the trigram arm
 * (Jaccard ≥ 0.9, which is scale-free) does not.
 */
const CORRECTED_MAX_EDITS = 3;
const CORRECTED_MIN_CORE = 12;
const CORRECTED_MIN_JACCARD = 0.9;

/** The marker clause set, as a comparable signature (identical ⇒ nothing moved). */
function markerSignature(claim: ClaimItem): string {
  const parts = [
    claim.provenance?.raw ?? "",
    ...(claim.provenanceExtra ?? []).map((p) => p.raw),
    claim.closing?.raw ?? "",
    ...(claim.closingExtra ?? []).map((c) => c.raw),
    ...claim.markerLike,
  ];
  return JSON.stringify(parts);
}

/**
 * docs/concepts.md §Section grammar: the digits of a core, in order. A typo fix does
 * not change them, and every laundering case the review reproduced does —
 * `aged 34 → 37`, `1990 → 1998`, `50000 → 90000 CAD`, `expires 2027 → 2037`.
 * Exact, cheap, and it closes the Jaccard arm's missing floor for quantities.
 */
export function digitSignature(core: string): string {
  return [...core].filter((ch) => /\p{Nd}/u.test(ch)).join("");
}

/** Standalone words whose presence on one side alone flips the claim. */
const NEGATION_WORDS = new Set("not no never none nor without cannot un non anti".split(" "));
/** Prefixes that negate the token they are glued to (`smoker` → `nonsmoker`). */
const NEGATION_PREFIXES = "un non dis in im ir il anti".split(" ");
/** CJK negators, counted rather than tokenized — 中文 has no word boundaries here. */
const NEGATION_CHARS = [..."不没無无非未勿别"];

/** The multiset of tokens in `from` that `other` does not account for. */
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

/**
 * docs/concepts.md §Section grammar: whether the two cores differ in polarity. A
 * heuristic, deliberately allowed to over-fire — a false positive costs one
 * finding the human answers, a false negative costs a value nothing recovers.
 * `is a smoker → is a nonsmoker` is three edits, `married → unmarried` two.
 */
export function polarityChanged(before: string, after: string): boolean {
  const count = (text: string, ch: string): number => [...text].filter((c) => c === ch).length;
  if (NEGATION_CHARS.some((ch) => count(before, ch) !== count(after, ch))) return true;
  const onlyBefore = tokensOnlyIn(before, after);
  const onlyAfter = tokensOnlyIn(after, before);
  if ([...onlyBefore, ...onlyAfter].some((t) => NEGATION_WORDS.has(t))) return true;
  // A token on one side that is a token on the other plus a negating prefix:
  // the pair IS the negation, not two unrelated words.
  const prefixed = (longer: string[], shorter: string[]): boolean =>
    longer.some((t) =>
      NEGATION_PREFIXES.some((p) => t.startsWith(p) && shorter.includes(t.slice(p.length))),
    );
  return prefixed(onlyAfter, onlyBefore) || prefixed(onlyBefore, onlyAfter);
}

/**
 * docs/extending.md §An arm: a claim's identity — its category and its
 * normalized core. `undefined` for a claim with no core, which is the item the
 * kernel must never match: matching one would report an edit elsewhere on the
 * page as a change to a claim that says nothing.
 *
 * The separator is NUL because it cannot occur in either half, so two claims
 * whose category/core boundary differs cannot collide on one string.
 */
export function claimIdentity(claim: ClaimItem): string | undefined {
  if (claim.core === "") return undefined;
  return `${claim.categoryId}\u0000${claim.coreId}`;
}

/**
 * docs/concepts.md §Section grammar: a typo-sized core edit under identical markers — with the
 * two guards in front of both tolerance arms, because semantic
 * distance is not edit distance and the `supersede` class exists precisely for
 * the dates, quantities and polarities the escape was swallowing.
 */
export function isCorrection(before: ClaimItem, after: ClaimItem): boolean {
  if (before.categoryId !== after.categoryId) return false;
  if (before.coreId === after.coreId) return false;
  if (markerSignature(before) !== markerSignature(after)) return false;
  if (digitSignature(before.coreId) !== digitSignature(after.coreId)) return false;
  if (polarityChanged(before.coreId, after.coreId)) return false;
  if (
    before.coreId.length >= CORRECTED_MIN_CORE &&
    after.coreId.length >= CORRECTED_MIN_CORE &&
    boundedLevenshtein(before.coreId, after.coreId, CORRECTED_MAX_EDITS) <= CORRECTED_MAX_EDITS
  ) {
    return true;
  }
  return trigramJaccard(before.coreId, after.coreId) >= CORRECTED_MIN_JACCARD;
}

// ---------------------------------------------------------------------------
// the transition over two revisions (re-expressed over the AST)

/** Letter, digit or `_` — the two sides a quotation may not be glued to. */
function wordish(ch: string): boolean {
  return ch !== "" && /[\p{L}\p{N}_]/u.test(ch);
}

function codePointBefore(text: string, at: number): string {
  if (at <= 0) return "";
  const low = text.charCodeAt(at - 1);
  if (low >= 0xdc00 && low <= 0xdfff && at >= 2) {
    const high = text.charCodeAt(at - 2);
    if (high >= 0xd800 && high <= 0xdbff) return text.slice(at - 2, at);
  }
  return text.slice(at - 1, at);
}

function codePointAt(text: string, at: number): string {
  if (at >= text.length) return "";
  const cp = text.codePointAt(at);
  return cp === undefined ? "" : String.fromCodePoint(cp);
}

/**
 * The History-entry escape quotes the removed claim's core AS A WHOLE SEGMENT:
 * bounded by the line edge or by a non-letter, non-digit code point. Identity is
 * exact normalized equality (docs/concepts.md §Section grammar) and an escape past an error-severity
 * gate may not be looser than the law it escapes — unanchored containment let
 * "tidied the Mainland section" legalize the removal of a claim whose core is
 * "Main", and 北京 land in 北京大学.
 */
function quotesCore(text: string, core: string): boolean {
  if (core === "") return false;
  for (let from = 0; from <= text.length - core.length; from += 1) {
    const at = text.indexOf(core, from);
    if (at < 0) return false;
    if (!wordish(codePointBefore(text, at)) && !wordish(codePointAt(text, at + core.length))) {
      return true;
    }
    from = at;
  }
  return false;
}

const claimsOf = (items: readonly TransitionItem[]): ClaimItem[] =>
  items.filter((i) => i.kind === "claim") as unknown as ClaimItem[];
const entriesOf = (items: readonly TransitionItem[]): TransitionItem[] =>
  items.filter((i) => i.kind === "entry");

export interface ClaimRemoval {
  claim: ClaimItem;
  cls: "supersede" | "accumulate";
}

export interface ClaimLanding {
  line: number;
  escape: "history-claim-landing" | "history-entry-landing";
  handle: string;
  category: string;
}

/** docs/concepts.md §Section grammar: the derived table, counted per page and section. */
export interface ClaimTransition {
  removed: ClaimRemoval[];
  landings: ClaimLanding[];
  dispositions: Record<string, number>;
}

/**
 * Both revisions of the open section and of the History section it names, from
 * the one parser. The History landing has two escapes and the caller is told
 * which one fired: the claim-kind form the writer renders, and the entry-kind
 * form the corpus actually writes (75/75 History bullets; 0 of 176 replayed
 * firings escaped).
 */
export function claimTransitions(input: {
  base: readonly TransitionItem[];
  current: readonly TransitionItem[];
  history: { base: readonly TransitionItem[]; current: readonly TransitionItem[] } | undefined;
  classOf: (categoryId: string) => string | undefined;
}): ClaimTransition {
  const { classOf } = input;
  const currentClaims = claimsOf(input.current);
  const baseClaims = claimsOf(input.base);
  const historyBase = input.history?.base ?? [];
  const historyCurrent = input.history?.current ?? [];
  const survivors = new Map<string, number>();
  for (const claim of currentClaims) survivors.set(claim.raw, (survivors.get(claim.raw) ?? 0) + 1);

  const inheritedHistory = new Map<string, number>();
  for (const item of [...claimsOf(historyBase), ...entriesOf(historyBase)]) {
    inheritedHistory.set(item.raw, (inheritedHistory.get(item.raw) ?? 0) + 1);
  }
  const isNew = (raw: string): boolean => {
    const remaining = inheritedHistory.get(raw) ?? 0;
    if (remaining > 0) {
      inheritedHistory.set(raw, remaining - 1);
      return false;
    }
    return true;
  };
  const newHistoryClaims = claimsOf(historyCurrent).filter((c) => isNew(c.raw));
  const newHistoryEntries = entriesOf(historyCurrent).filter((e) => isNew(e.raw));

  const removed: ClaimRemoval[] = [];
  const landings: ClaimLanding[] = [];
  const dispositions: Record<string, number> = {
    unchanged: 0,
    added: 0,
    superseded: 0,
    annotated: 0,
    corrected: 0,
    retracted: 0,
    removed_illegally: 0,
    history_erased: 0,
  };
  // docs/concepts.md §Section grammar: a base claim that survives verbatim is `unchanged`; a
  // current claim no base raw accounts for is `added`. Counted over raws so the
  // two sides of the table are one walk, never a second parse.
  const baseRaws = new Map<string, number>();
  for (const claim of baseClaims) baseRaws.set(claim.raw, (baseRaws.get(claim.raw) ?? 0) + 1);
  for (const claim of currentClaims) {
    const remaining = baseRaws.get(claim.raw) ?? 0;
    if (remaining > 0) {
      baseRaws.set(claim.raw, remaining - 1);
      dispositions["unchanged"] = (dispositions["unchanged"] ?? 0) + 1;
    } else {
      dispositions["added"] = (dispositions["added"] ?? 0) + 1;
    }
  }
  // History is append-only by construction: a retired claim absent from the
  // draft is `history_erased`. Counted here; the FINDING is not this slice's.
  const currentHistoryRaws = new Set(claimsOf(historyCurrent).map((c) => c.raw));
  for (const item of claimsOf(historyBase)) {
    if (!currentHistoryRaws.has(item.raw)) {
      dispositions["history_erased"] = (dispositions["history_erased"] ?? 0) + 1;
    }
  }

  const correctedBy = new Set<ClaimItem>();
  for (const claim of baseClaims) {
    const cls = classOf(claim.categoryId);
    if (cls !== "accumulate" && cls !== "supersede") continue;
    // A claim with no core has no identity, and is never matched — and so is
    // never reported as changed rather than replaced.
    const identity = claimIdentity(claim);
    if (identity === undefined) continue;
    const remaining = survivors.get(claim.raw) ?? 0;
    if (remaining > 0) {
      survivors.set(claim.raw, remaining - 1);
      continue;
    }
    if (cls === "supersede" && currentClaims.some((c) => claimIdentity(c) === identity)) {
      // The same value still stands — an in-place annotation, not a replacement.
      dispositions["annotated"] = (dispositions["annotated"] ?? 0) + 1;
      continue;
    }
    const landed = newHistoryClaims.find((h) => claimIdentity(h) === identity);
    if (landed !== undefined) {
      landings.push({
        line: landed.line,
        escape: "history-claim-landing",
        handle: claim.handle,
        category: claim.category,
      });
      const key = cls === "accumulate" ? "retracted" : "superseded";
      dispositions[key] = (dispositions[key] ?? 0) + 1;
      continue;
    }
    const viaEntry = newHistoryEntries.find((e) =>
      quotesCore(normalizeIdentity(e.raw), claim.coreId),
    );
    if (viaEntry !== undefined) {
      landings.push({
        line: viaEntry.line,
        escape: "history-entry-landing",
        handle: claim.handle,
        category: claim.category,
      });
      const key = cls === "accumulate" ? "retracted" : "superseded";
      dispositions[key] = (dispositions[key] ?? 0) + 1;
      continue;
    }
    // docs/concepts.md §Section grammar: the human's "Shangai" → "Shanghai" in Obsidian.
    // A same-category open counterpart whose markers did not move and whose
    // core is within the typo tolerance is a CORRECTION — counted, never a
    // finding, because a temporal database separates a correction of the record
    // from a change in the world.
    const fixed = currentClaims.find((c) => !correctedBy.has(c) && isCorrection(claim, c));
    if (fixed !== undefined) {
      correctedBy.add(fixed);
      dispositions["corrected"] = (dispositions["corrected"] ?? 0) + 1;
      continue;
    }
    removed.push({ claim, cls });
    dispositions["removed_illegally"] = (dispositions["removed_illegally"] ?? 0) + 1;
  }
  return { removed, landings, dispositions };
}

/** The transition as the kernel hands it in: the History section is the one `history` names. */
function transitionOf(ctx: TransitionContext): ClaimTransition {
  const history = ctx.params["history"];
  const classOf = (categoryId: string): string | undefined => {
    const entry = ctx.vocabulary(CATEGORIES)?.entries.get(categoryId);
    return typeof entry?.["class"] === "string" ? entry["class"] : undefined;
  };
  return claimTransitions({
    base: ctx.base,
    current: ctx.current,
    history: typeof history === "string" ? ctx.sectionItems(history) : undefined,
    classOf,
  });
}

/**
 * `claims-transition`: a claim of a lifecycle class that left the open section
 * and landed nowhere, and the disposition table the page's transition counted.
 */
export function transitionArm(ctx: TransitionContext): void {
  const history = String(ctx.params["history"] ?? "History");
  const result = transitionOf(ctx);
  for (const { claim, cls } of result.removed) {
    ctx.emit(
      "claims-transition",
      undefined,
      cls === "accumulate"
        ? `accumulate: the [${claim.category}] observation "${claim.core}" was removed or edited — variance accumulates; restore it or retract it explicitly into "## ${history}"`
        : `supersede: the replaced [${claim.category}] value "${claim.core}" must land in "## ${history}" with closed dates`,
      { handle: claim.handle, category: claim.category, class: cls },
      `${claim.handle}|${claim.category}`,
      // The path back is this grammar's own: its write forms, by handle, and
      // the closing clause a hand would write. The verb that refuses the
      // rewrite relays this, so the hint is the arm's and not a fixed sentence.
      cls === "accumulate"
        ? `retract it with \`write <page> --section "${ctx.section.heading}" --retract ${claim.handle}\`, or close it by hand in "## ${history}" with \`retracted Z\``
        : `supersede it with \`write <page> --section "${ctx.section.heading}" --replace-core ${claim.handle}\`, or close it by hand in "## ${history}" with \`valid X→Y, superseded Z\``,
    );
  }
  for (const [disposition, n] of Object.entries(result.dispositions)) ctx.count(disposition, n);
}

/** `claim-landing`: a census of the removed claims that DID land, and through which escape. */
export function landingArm(ctx: TransitionContext): void {
  const history = String(ctx.params["history"] ?? "History");
  for (const landing of transitionOf(ctx).landings) {
    ctx.emit(
      "claim-landing",
      landing.line,
      `a removed [${landing.category}] claim landed in "## ${history}" via ${landing.escape}`,
      { handle: landing.handle, category: landing.category, escape: landing.escape },
      `${landing.handle}|${landing.category}|${landing.escape}`,
    );
  }
}
