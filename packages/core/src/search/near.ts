// docs/concepts.md §Generated artifacts "`name:near` — advisory, never ranked" · docs/cli.md §search
// (`--near`; a judgment queue that is not rate-limited becomes a landfill:
// capped candidates, info-class, never a verdict) · score desc then code-unit
// path; no locale anywhere · zero dependencies: the Han↔Latin bridge is built
// from the bundle's own alias pairs, never a pinyin table.
import { codeUnitCompare, normalizeIdentity } from "../identity/index.ts";
import { basenameOf, type NamedPage } from "../names/index.ts";
import { trigrams } from "../text/index.ts";
import { compactForm, hasHan, tokenize } from "./tokenize.ts";

/**
 * The candidate floor (docs/concepts.md §Generated artifacts). Below this, a trigram similarity is
 * noise rather than a candidate. It is a floor on what may be SHOWN, not a gate
 * on a decision — nothing branches on it and `results` never sees it — so it is
 * deliberately more generous than the 0.5 the corpus measurement rules out as a
 * gate (0 of 3,570 Han-basename pairs reach 0.5, REDESIGN ).
 */
export const NEAR_THRESHOLD = 0.4;
/**
 * The advisory list's OWN cap (a judgment queue that is not rate-limited
 * becomes a landfill). `--limit` is a display choice about `results` and never
 * truncates this list: a maintainer who narrowed the printed results has not
 * asked to be shown fewer same-name pages (docs/concepts.md §Generated artifacts).
 */
export const NEAR_LIMIT = 20;

export interface NearCandidate {
  path: string;
  /** The name form that matched — basename, alias, title, or a stemmed one. */
  name: string;
  score: number;
  why: string[];
}

interface NameForm {
  path: string;
  display: string;
  normalized: string;
  compact: string;
  tokens: ReadonlySet<string>;
  trigrams: ReadonlySet<string>;
}

export interface NearIndex {
  forms: readonly NameForm[];
  /** normalized name → the counterpart-script names the bundle's own pages pair it with. */
  bridge: ReadonlyMap<string, readonly string[]>;
}

/** Strip ONE trailing ` (…)` qualifier — the `name:stem` transformation. */
export function stripQualifier(name: string): string | null {
  const trimmed = name.trimEnd();
  if (!trimmed.endsWith(")")) return null;
  const open = trimmed.lastIndexOf(" (");
  if (open <= 0) return null;
  const stem = trimmed.slice(0, open).trimEnd();
  return stem === "" ? null : stem;
}

/** Every name a page answers to: basename, aliases, title, and their stems. */
export function nameFormsOf(page: NamedPage): string[] {
  const fm = page.doc.frontmatter.value;
  const out: string[] = [basenameOf(page.path)];
  const aliases = fm["aliases"];
  if (Array.isArray(aliases)) {
    for (const a of aliases) if (typeof a === "string") out.push(a);
  }
  const title = fm["title"];
  if (typeof title === "string") out.push(title);
  for (const name of [...out]) {
    const stem = stripQualifier(name);
    if (stem !== null) out.push(stem);
  }
  const seen = new Set<string>();
  return out.filter((n) => {
    const key = normalizeIdentity(n);
    if (key === "" || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formOf(path: string, display: string): NameForm {
  const normalized = normalizeIdentity(display);
  const compact = compactForm(display);
  return {
    path,
    display,
    normalized,
    compact,
    tokens: new Set(tokenize(display)),
    trigrams: trigrams(compact),
  };
}

/**
 * Build the near index, including the Han↔Latin bridge: a Han name form sharing
 * a page with a Latin one teaches that pair, so the bundle becomes its own
 * transliteration table (docs/concepts.md §Generated artifacts). A bundle without the
 * Han-title-carries-a-Latin-alias discipline simply teaches nothing, and the
 * tier reports nothing — never an invention.
 */
export function buildNearIndex(pages: readonly NamedPage[]): NearIndex {
  const forms: NameForm[] = [];
  const bridge = new Map<string, string[]>();
  const addBridge = (from: string, to: string): void => {
    const list = bridge.get(from);
    if (list === undefined) bridge.set(from, [to]);
    else if (!list.includes(to)) list.push(to);
  };
  for (const page of pages) {
    const names = nameFormsOf(page);
    for (const name of names) forms.push(formOf(page.path, name));
    const han = names.filter((n) => hasHan(n));
    const latin = names.filter((n) => !hasHan(n));
    for (const h of han) {
      for (const l of latin) {
        addBridge(normalizeIdentity(h), normalizeIdentity(l));
        addBridge(normalizeIdentity(l), normalizeIdentity(h));
      }
    }
  }
  forms.sort((a, b) =>
    a.path === b.path
      ? codeUnitCompare(a.normalized, b.normalized)
      : codeUnitCompare(a.path, b.path),
  );
  for (const [, list] of bridge) list.sort(codeUnitCompare);
  return { forms, bridge };
}

function setsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size || a.size === 0) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const v of a) if (b.has(v)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function similarity(query: NameForm, candidate: NameForm): { score: number; why: string[] } | null {
  const why: string[] = [];
  let score = 0;
  if (query.normalized === candidate.normalized) {
    why.push("name:exact");
    score = 1;
  } else if (setsEqual(query.tokens, candidate.tokens)) {
    why.push("token-set:equal");
    score = 1;
  }
  const trigram = jaccard(query.trigrams, candidate.trigrams);
  if (trigram >= NEAR_THRESHOLD) {
    why.push(`trigram:${trigram.toFixed(2)}`);
    if (trigram > score) score = trigram;
  }
  return why.length === 0 ? null : { score, why };
}

/**
 * Every candidate above the floor, ordered and uncapped. The caller that reports
 * the cap needs the length it capped — a truncated candidate list reporting
 * nothing would be the miss-as-absence failure one level down
 * (docs/concepts.md §Generated artifacts, `caps.near_hit`).
 */
export function nearCandidatesAll(index: NearIndex, query: string): NearCandidate[] {
  const direct = formOf("", query);
  if (direct.compact === "") return [];
  const queryForms: Array<{ form: NameForm; bridged: boolean }> = [
    { form: direct, bridged: false },
  ];
  for (const bridged of index.bridge.get(direct.normalized) ?? []) {
    queryForms.push({ form: formOf("", bridged), bridged: true });
  }

  const best = new Map<string, NearCandidate>();
  for (const candidate of index.forms) {
    for (const q of queryForms) {
      const hit = similarity(q.form, candidate);
      if (hit === null) continue;
      const why = q.bridged ? ["bridge:han-latin", ...hit.why] : hit.why;
      const current = best.get(candidate.path);
      if (current === undefined || hit.score > current.score) {
        best.set(candidate.path, {
          path: candidate.path,
          name: candidate.display,
          score: Math.round(hit.score * 1e6) / 1e6,
          why,
        });
      }
    }
  }
  return [...best.values()].sort((a, b) =>
    a.score === b.score ? codeUnitCompare(a.path, b.path) : b.score - a.score,
  );
}

/**
 * The advisory candidate list, capped. It never enters `results` and never
 * changes a rank (docs/concepts.md §Generated artifacts); it is the identity guard's input before
 * a write.
 */
export function nearCandidates(
  index: NearIndex,
  query: string,
  limit: number = NEAR_LIMIT,
): NearCandidate[] {
  return nearCandidatesAll(index, query).slice(0, limit);
}
