// v2 contracts §6 (the finding) · §10 (judge(state, law) over the new law,
// the routing and coverage tables carried over by id).
//
// One function of one state and one loaded law. It reads every page of the
// state once (interface/: the frontmatter, the sections, the records), builds
// the vault's names from them, resolves each relation's target, judges each
// page under its type, then the vault as a whole, and routes, sorts and caps
// what it found. It reads no file, no git and no clock: a state constructor
// (packages/cli/src/lawstate.ts) hands it bytes.
//
// Ported from the old judge (judge/index.ts): the verdict's shape (findings,
// coverage by id, the unevaluated block, the summary, the error-first cap),
// the deterministic order, the `--rule`, `--path`, `--limit` and `--all`
// filters. Not ported here: the gate's line-scoped demotion and its
// change-scoping, which the `gate` verb brings with it (step 4).
import { codeUnitCompare } from "../identity/index.ts";
import { lawFacts, type PageRead, type ParsedPage, parsePage } from "../interface/index.ts";
import type { TypeLaw } from "../law/load.ts";
import { applyExceptions, hasExceptions } from "./exceptions.ts";
import { grammarRows, itemFindings, sectionFindings } from "./grammar.ts";
import { type JudgeOverlaid, type LawTestOptions, lawTestFindings } from "./lawtests.ts";
import { buildNames, identityCollisions, type NamedPage, type VaultNames } from "./names.ts";
import {
  linkFindings,
  PAGE_LOCATION,
  type PageContext,
  pageRefFindings,
  readFindings,
  renameFindings,
  shapeFindings,
  tagFindings,
  type Unrouted,
  withFrontmatterLines,
} from "./page.ts";
import { ruleFindings } from "./rules.ts";
import { type JudgeState, sameBytes } from "./state.ts";
import { routeVerdictFinding, VERDICT_TABLE, type VerdictFinding } from "./table.ts";
import { transitionFindings, transitionRows } from "./transitions.ts";

export interface TypeLawJudgeOptions {
  /** At most this many findings, errors first (default 50). */
  limit?: number;
  /** Every finding, uncapped. */
  all?: boolean;
  /** Only this rule's findings. */
  rule?: string;
  /** Only this page's findings. */
  path?: string;
  /** §8: run the law's rule tests and examples (default true: `check` and `gate` do). */
  lawTests?: boolean;
  /** §8: rule ids the gate's law diff adds or changes; each one untested is an error. */
  rulesChanged?: ReadonlySet<string>;
}

export interface CoverageCell {
  /** Pages the pass judged. */
  evaluated: number;
  /** Pages the pass does not govern. */
  not_applicable: number;
  /** Pages it governs and could not judge: a transition with no base. */
  unevaluated: number;
}

/**
 * Why a pass a page is governed by was not judged there: the state has no
 * base (§5), or the base's bytes do not read as a page (over 1 MiB, or not
 * UTF-8).
 */
export type UnevaluatedReason = "no-base" | "base-unreadable";

export interface TypeLawVerdict {
  findings: VerdictFinding[];
  /** Every row of the table and every CEL rule, by id. */
  coverage: Record<string, CoverageCell>;
  /** The transitions this state could not judge, by id, with every reason it could not. */
  unevaluated: Record<string, { count: number; reasons: UnevaluatedReason[] }>;
  summary: {
    pages: number;
    errors: number;
    warnings: number;
    infos: number;
    by_rule: Record<string, number>;
    excepted: Record<string, number>;
    unevaluated: number;
  };
  caps: { limit: number; hit: boolean };
}

export const DEFAULT_FINDING_LIMIT = 50;

const BAND: Readonly<Record<string, number>> = { error: 0, warning: 1, info: 2 };

function locationKey(finding: VerdictFinding): string {
  const at = finding.location;
  return at.kind === "page"
    ? "0"
    : `1\u0000${String(at.line).padStart(9, "0")}\u0000${at.heading}\u0000${at.occurrence}`;
}

/** One order: by path, then location, then rule, then message. */
export function sortVerdictFindings(findings: VerdictFinding[]): void {
  findings.sort(
    (a, b) =>
      codeUnitCompare(a.path, b.path) ||
      codeUnitCompare(locationKey(a), locationKey(b)) ||
      codeUnitCompare(a.rule, b.rule) ||
      codeUnitCompare(a.message, b.message),
  );
}

/** The cap fills error-first, so a gate never blocks on a finding it did not print. */
function capBySeverity(sorted: readonly VerdictFinding[], limit: number): VerdictFinding[] {
  if (sorted.length <= limit) return [...sorted];
  const chosen = new Set(
    [...sorted].sort((a, b) => (BAND[a.severity] ?? 3) - (BAND[b.severity] ?? 3)).slice(0, limit),
  );
  return sorted.filter((f) => chosen.has(f));
}

/** Coverage by id: the table's page rows and every rule of the law. */
export class Coverage {
  readonly cells = new Map<string, CoverageCell>();
  readonly reasons = new Map<string, Set<UnevaluatedReason>>();
  constructor(ids: Iterable<string>) {
    for (const id of ids) this.add(id);
  }

  add(id: string): void {
    if (!this.cells.has(id))
      this.cells.set(id, { evaluated: 0, not_applicable: 0, unevaluated: 0 });
  }

  /** One page's outcome for every row: judged, not governed, or governed and not judged. */
  page(judged: ReadonlySet<string>, unjudged: ReadonlyMap<string, UnevaluatedReason>): void {
    for (const [id, cell] of this.cells) {
      const reason = unjudged.get(id);
      if (reason !== undefined) {
        cell.unevaluated += 1;
        const reasons = this.reasons.get(id) ?? new Set<UnevaluatedReason>();
        reasons.add(reason);
        this.reasons.set(id, reasons);
      } else if (judged.has(id)) cell.evaluated += 1;
      else cell.not_applicable += 1;
    }
  }
}

/** A page of the state, read, and its base. */
export interface ReadPage {
  path: string;
  read: PageRead;
  /**
   * §5: `undefined` when the state has no base; `null` when the base does
   * not hold the page; its base version otherwise.
   */
  base: PageRead | null | undefined;
}

/** Every page of a state read under the law, relation targets resolved against the vault. */
export function readPages(
  state: Pick<JudgeState, "pages" | "base">,
  law: TypeLaw,
): { pages: ReadPage[]; names: VaultNames; named: NamedPage[] } {
  const read: ReadPage[] = [...state.pages].map(([path, bytes]) => {
    const current = parsePage(path, bytes, law);
    if (state.base === undefined) return { path, read: current, base: undefined };
    const was = state.base.get(path) ?? null;
    if (was === null) return { path, read: current, base: null };
    return {
      path,
      read: current,
      base: sameBytes(was, bytes) ? current : parsePage(path, was, law),
    };
  });
  const named: NamedPage[] = read.flatMap((p) =>
    p.read.ok ? [{ path: p.path, frontmatter: p.read.page.frontmatter }] : [],
  );
  const names = buildNames(named);
  for (const page of read) {
    if (page.read.ok) resolveRelations(page.read.page, names);
    if (page.base?.ok === true && page.base !== page.read) resolveRelations(page.base.page, names);
  }
  return { pages: read, names, named };
}

/** §4: a relation's target, resolved from the vault's names once every page is read. */
export function resolveRelations(page: ParsedPage, names: VaultNames): void {
  for (const occurrence of page.occurrences) {
    for (const item of occurrence.items) {
      if (item.kind !== "relation") continue;
      const found = names.resolve(item.target.name);
      item.target.resolved = found !== undefined;
      item.target.path = found?.path ?? null;
      item.target.type = found?.type ?? null;
    }
  }
}

/**
 * The ids a page's coverage is counted over: the page rows, and the vault
 * rows a page takes part in (its names, its type's instances).
 */
const PAGE_ROWS = VERDICT_TABLE.filter((row) => row.scope !== "law").map((row) => row.id);

/** The findings of one page, and which passes judged it. */
export interface PageJudgment {
  findings: Unrouted[];
  judged: Set<string>;
  unjudged: Map<string, UnevaluatedReason>;
}

/** §5: a transition this state could not judge on this page, reported, never passed. */
export function unevaluatedFinding(
  path: string,
  rule: string,
  reason: UnevaluatedReason,
): Unrouted {
  return {
    rule: "unevaluated",
    severity: "info",
    path,
    location: PAGE_LOCATION,
    message:
      reason === "no-base"
        ? `${rule} compares the page with its base, and this state has none`
        : `${rule} compares the page with its base, and the base does not read as a page`,
    details: { rule, reason },
  };
}

/**
 * Judge one read page under the context: the kernel's checks, in order. An
 * `overlaid` page is a rule test's or an example's, laid over the vault from
 * outside the content roots: it may be a page of an abstract type, and its
 * `exceptions` are not applied.
 */
export function judgePage(ctx: PageContext, page: ReadPage, overlaid = false): PageJudgment {
  const judged = new Set<string>(["page-too-large", "page-not-utf8"]);
  const unjudged = new Map<string, UnevaluatedReason>();
  const out: PageJudgment = { findings: [], judged, unjudged };
  if (!page.read.ok) {
    out.findings.push({
      rule: page.read.code,
      severity: "error",
      path: page.path,
      location: PAGE_LOCATION,
      message: page.read.message,
      details: page.read.code === "page-too-large" ? { ...page.read.details } : {},
    });
    return out;
  }
  const parsed = page.read.page;
  for (const id of ["malformed-frontmatter", "duplicate-key", "frontmatter-not-mapping"])
    judged.add(id);
  if (!overlaid) judged.add("identity-collision");
  judged.add("type-unknown");
  const refused = readFindings(parsed, page.path);
  if (refused !== undefined) {
    out.findings.push(...withFrontmatterLines(parsed, refused));
    return out;
  }
  const type = parsed.type;
  if (type === undefined) return out;
  if (!overlaid) judged.add("abstract-type");
  if (!overlaid && type.instances !== null) judged.add("instances-min").add("instances-max");
  if (type.abstract && !overlaid) {
    out.findings.push({
      rule: "abstract-type",
      severity: "error",
      path: page.path,
      location: PAGE_LOCATION,
      message: `${type.name} is abstract: a page under the content roots is one of its descendants`,
      details: { type: type.name, pointer: "/type" },
    });
  }
  judged.add("page-shape-invalid");
  out.findings.push(...shapeFindings(ctx.law, parsed, type));
  judged.add("page-ref-type");
  out.findings.push(...pageRefFindings(ctx, parsed, type));
  if (ctx.tags !== undefined) judged.add("vocabulary-unknown").add("vocabulary-retired");
  out.findings.push(...tagFindings(ctx, parsed));
  judged.add("wikilink-unresolved").add("wikilink-alias-target");
  out.findings.push(...linkFindings(ctx, parsed));
  if (ctx.renamedFrom.has(page.path)) judged.add("renamed-without-alias");
  out.findings.push(...renameFindings(ctx, parsed));
  for (const id of grammarRows(type)) judged.add(id);
  out.findings.push(...sectionFindings(parsed, type), ...itemFindings(ctx.law, parsed, type));
  const transitions = transitionRows(type);
  const reason: UnevaluatedReason | undefined =
    page.base === undefined ? "no-base" : page.base?.ok === false ? "base-unreadable" : undefined;
  if (reason !== undefined) {
    for (const id of transitions) {
      unjudged.set(id, reason);
      out.findings.push(unevaluatedFinding(page.path, id, reason));
    }
  } else {
    for (const id of transitions) judged.add(id);
    // A page new to the base has nothing to compare: every transition holds.
    if (page.base !== null && page.base?.ok === true && page.base !== page.read)
      out.findings.push(...transitionFindings(parsed, page.base.page, type));
  }
  const ruled = ruleFindings(ctx.rules, parsed, type, page.base);
  for (const id of ruled.judged) judged.add(id);
  for (const [id, why] of ruled.unjudged) unjudged.set(id, why);
  out.findings.push(...ruled.findings);
  // A test page or an example shows the law as it stands: its own
  // exceptions waive nothing, or a repaired twin could pass by waiving the
  // rule under test.
  out.findings = withFrontmatterLines(parsed, out.findings);
  if (!overlaid && hasExceptions(parsed)) {
    judged.add("exception-applied").add("exception-stale").add("exception-illegal");
    out.findings = withFrontmatterLines(
      parsed,
      applyExceptions(ctx.law, parsed, out.findings, new Set(unjudged.keys())),
    );
  }
  return out;
}

/** §3 `instances`: pages of exactly each type with a bound, against it. */
function instanceFindings(law: TypeLaw, pages: readonly ReadPage[]): Unrouted[] {
  const counts = new Map<string, number>();
  for (const page of pages) {
    if (!page.read.ok) continue;
    const declared = page.read.page.type?.name;
    if (declared !== undefined) counts.set(declared, (counts.get(declared) ?? 0) + 1);
  }
  const out: Unrouted[] = [];
  for (const type of [...law.types.values()].sort((a, b) => codeUnitCompare(a.name, b.name))) {
    if (type.instances === null) continue;
    const count = counts.get(type.name) ?? 0;
    const { min, max } = type.instances;
    if (min !== null && count < min) {
      out.push({
        rule: "instances-min",
        severity: "error",
        path: type.where,
        location: PAGE_LOCATION,
        message: `the vault holds ${count} page(s) of type ${type.name}; at least ${min} required`,
        details: { type: type.name, count, min },
      });
    }
    if (max !== null && count > max) {
      out.push({
        rule: "instances-max",
        severity: "error",
        path: type.where,
        location: PAGE_LOCATION,
        message: `the vault holds ${count} page(s) of type ${type.name}; at most ${max} allowed`,
        details: { type: type.name, count, max },
      });
    }
  }
  return out;
}

/** The context the state and the law give every page. */
export function pageContext(
  state: Pick<JudgeState, "renames">,
  law: TypeLaw,
  names: VaultNames,
): PageContext {
  const tags = law.vocabularies.get("tags");
  return {
    law,
    names,
    titleFromBasename: law.engine.field_sources.title === "basename",
    tags,
    renamedFrom: new Map((state.renames ?? []).map((r) => [r.to, r.from] as const)),
    contentRoots: law.engine.content_roots,
    rules: {
      law,
      facts: lawFacts(law),
      resolve: (name) => {
        const found = names.resolve(name);
        return found === undefined ? undefined : { path: found.path, type: found.type };
      },
    },
  };
}

/** Route, order, filter, cap and count: the verdict of what was found. */
export function verdictOf(
  found: readonly Unrouted[],
  coverage: Coverage,
  pages: number,
  options: TypeLawJudgeOptions,
): TypeLawVerdict {
  const routed = found.map(routeVerdictFinding);
  sortVerdictFindings(routed);
  const wantPath = options.path?.normalize("NFC");
  const filtered = routed.filter(
    (f) =>
      (options.rule === undefined || f.rule === options.rule) &&
      (wantPath === undefined || f.path === wantPath),
  );
  const limit = options.limit ?? DEFAULT_FINDING_LIMIT;
  const byRule = new Map<string, number>();
  for (const f of filtered) byRule.set(f.rule, (byRule.get(f.rule) ?? 0) + 1);
  const by_rule: Record<string, number> = {};
  for (const id of [...byRule.keys()].sort(codeUnitCompare)) by_rule[id] = byRule.get(id) ?? 0;
  const excepted: Record<string, number> = {};
  for (const f of routed) {
    const waived = f.rule === "exception-applied" ? f.details["rule"] : undefined;
    if (typeof waived === "string") excepted[waived] = (excepted[waived] ?? 0) + 1;
  }
  const unevaluated: Record<string, { count: number; reasons: UnevaluatedReason[] }> = {};
  const coverageOut: Record<string, CoverageCell> = {};
  let unevaluatedTotal = 0;
  for (const id of [...coverage.cells.keys()].sort(codeUnitCompare)) {
    const cell = coverage.cells.get(id) as CoverageCell;
    coverageOut[id] = { ...cell };
    if (cell.unevaluated > 0) {
      unevaluated[id] = {
        count: cell.unevaluated,
        reasons: [...(coverage.reasons.get(id) ?? [])].sort(codeUnitCompare),
      };
      unevaluatedTotal += cell.unevaluated;
    }
  }
  return {
    findings: options.all === true ? filtered : capBySeverity(filtered, limit),
    coverage: coverageOut,
    unevaluated,
    summary: {
      pages,
      errors: filtered.filter((f) => f.severity === "error").length,
      warnings: filtered.filter((f) => f.severity === "warning").length,
      infos: filtered.filter((f) => f.severity === "info").length,
      by_rule,
      excepted: Object.fromEntries(
        Object.keys(excepted)
          .sort(codeUnitCompare)
          .map((k) => [k, excepted[k] ?? 0]),
      ),
      unevaluated: unevaluatedTotal,
    },
    caps: { limit, hit: options.all !== true && filtered.length > limit },
  };
}

/**
 * v2 contracts §10: `judge(state, law)`. `law` is `loadTypeLaw(state.law)`;
 * the caller loads it, so a law that does not load is reported as the
 * loader's issues and never judged.
 */
export function judgeTypeLaw(
  state: JudgeState,
  law: TypeLaw,
  options: TypeLawJudgeOptions = {},
): TypeLawVerdict {
  const { pages, names, named } = readPages(state, law);
  const ctx = pageContext(state, law, names);
  const coverage = new Coverage([...PAGE_ROWS, ...law.rules.keys()]);
  const found: Unrouted[] = [];
  for (const page of pages) {
    const judgment = judgePage(ctx, page);
    found.push(...judgment.findings);
    coverage.page(judgment.judged, judgment.unjudged);
  }
  for (const collision of identityCollisions(named, ctx.titleFromBasename)) {
    found.push({
      rule: "identity-collision",
      severity: "error",
      path: collision.path,
      location: PAGE_LOCATION,
      message: collision.message,
      details: collision.details,
    });
  }
  found.push(...instanceFindings(law, pages));
  if (options.lawTests !== false) {
    const overlaid: JudgeOverlaid = (path, bytes, base) => {
      const read = parsePage(path, bytes, law);
      const was = base === null ? null : parsePage(path, base, law);
      if (read.ok) resolveRelations(read.page, names);
      if (was?.ok === true) resolveRelations(was.page, names);
      const judged = judgePage(ctx, { path, read, base: was }, true);
      const declared = read.ok ? read.page.frontmatter["type"] : undefined;
      return { findings: judged.findings, type: typeof declared === "string" ? declared : null };
    };
    const tests: LawTestOptions =
      options.rulesChanged === undefined ? {} : { rulesChanged: options.rulesChanged };
    found.push(...lawTestFindings(law, overlaid, tests));
  }
  return verdictOf(found, coverage, pages.length, options);
}
