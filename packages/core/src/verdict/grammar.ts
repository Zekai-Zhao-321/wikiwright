// v2 contracts §3.2 (sections under a type) · §4 (the fixed grammar and its
// closed parameters) · the navigator's rulings 2 (`require` is a grammar
// parameter the engine enforces) and 4 (`closed` on claims).
//
// What the kernel judges of a page's sections, occurrence by occurrence: how
// many there are of each declared heading (`section-count`), their order
// (`section-order`), their depth (`section-depth`) and whether an
// undeclared heading may stand among them (`section-undeclared`), every
// top-level item that does not parse
// (`item-unparsed`), and each record against its section's parameters — a
// vocabulary value (`vocabulary-unknown`, `vocabulary-retired`), the claims
// `categories` subset, `provenance` and `closed`, a relation's target and
// the `require` rows.
//
// Ported by id from the old grammar arms (grammar/, stdlib/): `sections`
// and `section-depth`, `grammar-unparsed` and `entry-date-missing`,
// `unknown-category` and `unknown-label`, `category-not-allowed`,
// `claim-provenance`, `closed-claim-in-facts` and `history-marker` (now
// `claim-closed` and `claim-open` under the `closed` parameter),
// `relation-target-unresolved` and `relation-require` (now `require-unmet`).
// Dropped with their parameters: a section's own severity (every code here
// carries its row's), and the category classes.
import type { Occurrence, ParsedPage } from "../interface/index.ts";
import type { LawSection, LawType } from "../law/compose.ts";
import type { TypeLaw } from "../law/load.ts";
import type { ClaimRecord, GrammarRecord, RelationRecord } from "../records/index.ts";
import { PAGE_LOCATION, type Unrouted, vocabularyFinding } from "./page.ts";
import type { FindingLocation } from "./table.ts";

/** One occurrence of a heading, with its index among the page's occurrences of that heading. */
export interface Indexed {
  occurrence: Occurrence;
  index: number;
}

/** Every occurrence, each with its index among those of the same heading text. */
export function indexed(page: ParsedPage): Indexed[] {
  const counts = new Map<string, number>();
  return page.occurrences.map((occurrence) => {
    const index = counts.get(occurrence.heading) ?? 0;
    counts.set(occurrence.heading, index + 1);
    return { occurrence, index };
  });
}

function sectionAt(at: Indexed, line = at.occurrence.location.line): FindingLocation {
  return { kind: "section", heading: at.occurrence.heading, occurrence: at.index, line };
}

/** The occurrences of declared headings at the declared depth, with their declaration. */
export function declaredOccurrences(
  page: ParsedPage,
  type: LawType,
): { at: Indexed; section: LawSection }[] {
  const sections = type.sections;
  if (sections === null) return [];
  const out: { at: Indexed; section: LawSection }[] = [];
  for (const at of indexed(page)) {
    if (at.occurrence.depth !== sections.depth) continue;
    const section = sections.list.find((s) => s.heading === at.occurrence.heading);
    if (section !== undefined) out.push({ at, section });
  }
  return out;
}

/** §3.2: the count, the order, the depth and the headings no declaration names. */
export function sectionFindings(page: ParsedPage, type: LawType): Unrouted[] {
  const sections = type.sections;
  if (sections === null) return [];
  const out: Unrouted[] = [];
  const all = indexed(page);
  const atDepth = all.filter((a) => a.occurrence.depth === sections.depth);
  for (const section of sections.list) {
    const found = atDepth.filter((a) => a.occurrence.heading === section.heading);
    if (found.length < section.min) {
      out.push({
        rule: "section-count",
        severity: "error",
        path: page.path,
        location: PAGE_LOCATION,
        message: `section "${section.heading}" occurs ${found.length} time(s); ${type.name} requires at least ${section.min}`,
        details: { kind: "min", heading: section.heading, count: found.length, min: section.min },
      });
    }
    if (section.max !== null && found.length > section.max) {
      const extra = found[section.max] as Indexed;
      out.push({
        rule: "section-count",
        severity: "error",
        path: page.path,
        location: sectionAt(extra),
        message: `section "${section.heading}" occurs ${found.length} time(s); ${type.name} allows at most ${section.max}`,
        details: { kind: "max", heading: section.heading, count: found.length, max: section.max },
      });
    }
  }
  const declared = new Map(sections.list.map((s, i) => [s.heading, i] as const));
  for (const at of all) {
    if (at.occurrence.depth === sections.depth || !declared.has(at.occurrence.heading)) continue;
    out.push({
      rule: "section-depth",
      severity: "error",
      path: page.path,
      location: sectionAt(at),
      message: `"${at.occurrence.heading}" is a heading of depth ${at.occurrence.depth}; ${type.name} declares its sections at depth ${sections.depth}`,
      details: {
        heading: at.occurrence.heading,
        depth: at.occurrence.depth,
        declared: sections.depth,
      },
    });
  }
  let highest = -1;
  for (const at of atDepth) {
    const position = declared.get(at.occurrence.heading);
    if (position === undefined) {
      if (sections.additional === "refused") {
        out.push({
          rule: "section-undeclared",
          severity: "error",
          path: page.path,
          location: sectionAt(at),
          message: `"${at.occurrence.heading}" is no section ${type.name} declares, and it refuses additional ones`,
          details: { heading: at.occurrence.heading },
        });
      }
      continue;
    }
    if (sections.ordered && position < highest) {
      const after = sections.list[highest]?.heading ?? "";
      out.push({
        rule: "section-order",
        severity: "error",
        path: page.path,
        location: sectionAt(at),
        message: `"${at.occurrence.heading}" comes after "${after}"; ${type.name} orders its sections as declared`,
        details: { heading: at.occurrence.heading, after },
      });
    }
    highest = Math.max(highest, position);
  }
  return out;
}

function itemAt(at: Indexed, record: GrammarRecord): FindingLocation {
  return sectionAt(at, record.location.line);
}

function claimFindings(
  law: TypeLaw,
  path: string,
  at: Indexed,
  section: LawSection,
  claim: ClaimRecord,
): Unrouted[] {
  const out: Unrouted[] = [];
  const location = itemAt(at, claim);
  const base = { heading: section.heading, handle: claim.handle };
  const vocabulary =
    section.vocabulary === undefined ? undefined : law.vocabularies.get(section.vocabulary);
  const unknown =
    vocabulary === undefined
      ? undefined
      : vocabularyFinding(vocabulary, claim.category, path, location, base);
  if (unknown !== undefined) out.push(unknown);
  // A category the vocabulary refused is reported once, as the vocabulary's;
  // one it admits — a census admits a new one — is still held to the subset.
  const categories = section.params.categories;
  if (categories !== undefined && !categories.includes(claim.category) && unknown === undefined) {
    out.push({
      rule: "category-not-allowed",
      severity: "error",
      path,
      location,
      message: `[${claim.category}] is not a category section "${section.heading}" admits (${categories.join(", ")})`,
      details: { ...base, category: claim.category, categories },
    });
  }
  const provenance = section.params.provenance ?? "optional";
  if (provenance === "required" && claim.provenance.kind === "none") {
    out.push({
      rule: "claim-provenance",
      severity: "error",
      path,
      location,
      message: `a claim in "${section.heading}" names its source: a [[page]], a URL or a path under a source root, in a final parenthetical`,
      details: { ...base, kind: "missing" },
    });
  }
  if (provenance === "none" && claim.provenance.kind !== "none") {
    out.push({
      rule: "claim-provenance",
      severity: "error",
      path,
      location,
      message: `a claim in "${section.heading}" carries no provenance, and this one names ${claim.provenance.value ?? ""}`,
      details: { ...base, kind: "forbidden", provenance: claim.provenance },
    });
  }
  const closed = claim.retracted !== null || claim.superseded !== null;
  const policy = section.params.closed ?? "allowed";
  if (policy === "refused" && closed) {
    out.push({
      rule: "claim-closed",
      severity: "error",
      path,
      location,
      message: `a closed claim stands in "${section.heading}", which holds open claims only; move it to the section that keeps closed ones`,
      details: { ...base, closed: claim.retracted !== null ? "retracted" : "superseded" },
    });
  }
  if (policy === "required" && !closed) {
    out.push({
      rule: "claim-open",
      severity: "error",
      path,
      location,
      message: `an open claim stands in "${section.heading}", which holds closed claims only: retract or supersede it`,
      details: base,
    });
  }
  return out;
}

function relationFindings(
  law: TypeLaw,
  path: string,
  at: Indexed,
  section: LawSection,
  relation: RelationRecord,
): Unrouted[] {
  const out: Unrouted[] = [];
  const location = itemAt(at, relation);
  const base = { heading: section.heading, label: relation.label, target: relation.target.name };
  const vocabulary =
    section.vocabulary === undefined ? undefined : law.vocabularies.get(section.vocabulary);
  if (vocabulary !== undefined) {
    const finding = vocabularyFinding(vocabulary, relation.label, path, location, base);
    if (finding !== undefined) out.push(finding);
  }
  if (!relation.target.resolved) {
    out.push({
      rule: "relation-target-unresolved",
      severity: "warning",
      path,
      location,
      message: `the relation's target [[${relation.target.name}]] names no page`,
      details: base,
    });
  }
  return out;
}

/** Ruling 2: each `require` row over one occurrence's relations. */
function requireFindings(path: string, at: Indexed, section: LawSection): Unrouted[] {
  const out: Unrouted[] = [];
  for (const row of section.params.require ?? []) {
    const count = at.occurrence.items.filter(
      (i) => i.kind === "relation" && row.labels.includes(i.label),
    ).length;
    if (count >= row.min) continue;
    out.push({
      rule: "require-unmet",
      severity: "error",
      path,
      location: sectionAt(at),
      message: `section "${section.heading}" carries ${count} relation(s) labelled ${row.labels.join(" or ")}; at least ${row.min} required`,
      details: { heading: section.heading, labels: row.labels, min: row.min, count },
    });
  }
  return out;
}

/** §4: every item of every declared grammar section, and every item that did not parse. */
export function itemFindings(law: TypeLaw, page: ParsedPage, type: LawType): Unrouted[] {
  const out: Unrouted[] = [];
  for (const item of page.unparsed) {
    out.push({
      rule: "item-unparsed",
      severity: "error",
      path: page.path,
      location: {
        kind: "section",
        heading: item.heading,
        occurrence: item.occurrence,
        line: item.line,
      },
      message: `a list item under "${item.heading}" does not parse: ${item.reason}`,
      details: { heading: item.heading, raw: item.raw, reason: item.reason },
    });
  }
  for (const { at, section } of declaredOccurrences(page, type)) {
    if (section.grammar === undefined) continue;
    for (const record of at.occurrence.items) {
      if (record.kind === "claim") out.push(...claimFindings(law, page.path, at, section, record));
      else if (record.kind === "relation")
        out.push(...relationFindings(law, page.path, at, section, record));
    }
    if (section.grammar === "relations") out.push(...requireFindings(page.path, at, section));
  }
  return out;
}

/** Which grammar codes a type's sections govern: a page of it is judged by these. */
export function grammarRows(type: LawType): Set<string> {
  const out = new Set<string>();
  const sections = type.sections;
  if (sections === null) return out;
  out.add("section-count").add("section-depth");
  if (sections.ordered) out.add("section-order");
  if (sections.additional === "refused") out.add("section-undeclared");
  for (const section of sections.list) {
    if (section.grammar === undefined) continue;
    out.add("item-unparsed");
    if (section.vocabulary !== undefined) out.add("vocabulary-unknown").add("vocabulary-retired");
    if (section.grammar === "claims") {
      if (section.params.categories !== undefined) out.add("category-not-allowed");
      if ((section.params.provenance ?? "optional") !== "optional") out.add("claim-provenance");
      if (section.params.closed === "refused") out.add("claim-closed");
      if (section.params.closed === "required") out.add("claim-open");
    }
    if (section.grammar === "relations") {
      out.add("relation-target-unresolved");
      if ((section.params.require ?? []).length > 0) out.add("require-unmet");
    }
  }
  return out;
}
