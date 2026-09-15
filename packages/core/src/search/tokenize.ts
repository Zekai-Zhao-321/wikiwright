// docs/concepts.md §Generated artifacts "The tokenizer (law)" (bigram-capable
// CJK lexical search, a day-one test surface; every comparison through
// normalizeIdentity) · locale-free, byte-identical across engines.
//
// One tokenizer serves every lexical tier. Classification runs over explicit
// code-point ranges — never a Unicode property escape, a locale table, or Intl —
// so two engines built against different Unicode versions tokenize identically.
import { normalizeIdentity } from "../identity/index.ts";

/** The string the coverage block reports (docs/concepts.md §Generated artifacts). */
export const TOKENIZATION_MODE = "latin-word + cjk-unigram+bigram, NFC casefold";

/** Inclusive code-point ranges holding Han characters (unigram + bigram class). */
const HAN_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x3005, 0x3005], // 々 iteration mark
  [0x3007, 0x3007], // 〇 ideographic number zero
  [0x3400, 0x4dbf], // extension A
  [0x4e00, 0x9fff], // unified ideographs
  [0xf900, 0xfaff], // compatibility ideographs
  [0x20000, 0x2fa1f], // extensions B–F + compatibility supplement
  [0x30000, 0x323af], // extensions G–H
];

/**
 * Inclusive ranges dropped outright: whitespace, punctuation, ASCII and
 * full-width. Rule 4 is a law about punctuation, not a block list, so a
 * separator missing from these ranges is a defect and not a preference — the
 * three that look like letters and are not are `·`, `・` and the soft hyphen
 * (docs/concepts.md §Generated artifacts).
 */
const SEPARATOR_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0009, 0x000d], // tab … carriage return
  [0x0020, 0x0020], // space
  [0x0021, 0x002f], // ! … /
  [0x003a, 0x0040], // : … @
  [0x005b, 0x0060], // [ … `
  [0x007b, 0x007e], // { … ~
  [0x0085, 0x0085], // next line
  [0x00a0, 0x00a0], // no-break space
  [0x00ad, 0x00ad], // soft hyphen
  [0x00b7, 0x00b7], // · middle dot — how Chinese writes a transliterated name
  [0x1680, 0x1680], // ogham space mark
  [0x2000, 0x206f], // general punctuation (spaces, dashes, quotes, ellipsis)
  [0x2e00, 0x2e7f], // supplemental punctuation
  [0x3000, 0x303f], // CJK symbols and punctuation (々 and 〇 excluded below: Han)
  [0x30fb, 0x30fb], // ・ katakana middle dot
  [0xfe10, 0xfe6f], // vertical forms, CJK compatibility forms, small form variants
  [0xff01, 0xff0f], // ！ … ／
  [0xff1a, 0xff20], // ： … ＠
  [0xff3b, 0xff40], // ［ … ｀
  [0xff5b, 0xff65], // ｛ … ･
];

function inRanges(cp: number, ranges: ReadonlyArray<readonly [number, number]>): boolean {
  for (const [lo, hi] of ranges) {
    if (cp >= lo && cp <= hi) return true;
  }
  return false;
}

/** True for a code point in the Han class — the unigram+bigram tier's alphabet. */
export function isHanCodePoint(cp: number): boolean {
  return inRanges(cp, HAN_RANGES);
}

/**
 * True for whitespace or punctuation: dropped, and never joins two tokens.
 *
 * Where the two classes overlap, **Han wins, and it wins here** — `々` (U+3005)
 * and `〇` (U+3007) sit inside the CJK symbols-and-punctuation block and in the
 * Han class, and the precedence is a property of the character, so every
 * consumer of the classification inherits it (docs/concepts.md §Generated artifacts).
 * Resolved in `tokenize` alone, `compactForm` still deleted them: `佐々木` and
 * `佐木` compacted alike and `name:near` reported `trigram:1.00` — its maximum
 * confidence — between two different people, and a name written only in those
 * characters compacted to the empty string and returned no candidates at all.
 */
export function isSeparatorCodePoint(cp: number): boolean {
  return !isHanCodePoint(cp) && inRanges(cp, SEPARATOR_RANGES);
}

/**
 * The tokenizer (docs/concepts.md §Generated artifacts): normalizeIdentity, then Han unigrams and
 * the contiguous bigrams of each Han run, word runs for every other script and
 * digits, punctuation and whitespace dropped. Tokens come out in occurrence
 * order with duplicates kept — term frequency is data.
 */
export function tokenize(text: string): string[] {
  const normalized = normalizeIdentity(text);
  const tokens: string[] = [];
  let word = "";
  let han: string[] = [];

  const flushWord = (): void => {
    if (word !== "") {
      tokens.push(word);
      word = "";
    }
  };
  const flushHan = (): void => {
    if (han.length === 0) return;
    for (const ch of han) tokens.push(ch);
    for (let i = 0; i + 1 < han.length; i += 1) tokens.push(`${han[i]}${han[i + 1]}`);
    han = [];
  };

  for (const ch of normalized) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) continue;
    // Han is tested first for readability only: the classifier already gives it
    // precedence, so the two branches can no longer disagree.
    if (isHanCodePoint(cp)) {
      flushWord();
      han.push(ch);
    } else if (isSeparatorCodePoint(cp)) {
      flushWord();
      flushHan();
    } else {
      flushHan();
      word += ch;
    }
  }
  flushWord();
  flushHan();
  return tokens;
}

/**
 * The normalized string with every separator removed — the surface character
 * trigrams run over, so `ZhangWei` and `Zhang Wei` compare identically
 * (docs/concepts.md §Generated artifacts, `name:near`).
 */
export function compactForm(text: string): string {
  let out = "";
  for (const ch of normalizeIdentity(text)) {
    const cp = ch.codePointAt(0);
    if (cp === undefined || isSeparatorCodePoint(cp)) continue;
    out += ch;
  }
  return out;
}

/** True when the string carries at least one Han character (script detection). */
export function hasHan(text: string): boolean {
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp !== undefined && isHanCodePoint(cp)) return true;
  }
  return false;
}
