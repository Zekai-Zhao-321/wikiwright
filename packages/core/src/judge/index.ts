// docs/concepts.md §Findings and routing, docs/concepts.md §The gate,
// docs/concepts.md §Section grammar · docs/architecture.md §How a verdict is produced (the core API and the constructor list)
// docs/architecture.md §The invariants
// (one judging function; every verb constructs a state and calls it).
//
// Purity (docs/architecture.md §Directories): core takes no Node typings, so judge reads
// bytes handed to it and never touches a filesystem, a process or git. The five
// state constructors live in the CLI shell; this module is what they all call.
import {
  buildFix,
  type FindingFix,
  type FixerContext,
  type FixTarget,
  fixerExecutes,
} from "../fixers/index.ts";
import { type FixInput, fixOpsFor, PURE_FIXERS } from "../fixers/ops.ts";
import { addDispositions, type Dispositions, emptyDispositions } from "../grammar/index.ts";
import { codeUnitCompare, normalizeIdentity } from "../identity/index.ts";
import {
  checkVaultInstances,
  evidenceDigestFor,
  type Finding,
  grammarBindings,
  type LintOptions,
  linkVerdict,
  lintPage,
} from "../lint/index.ts";
import { armApplies, ENVELOPE_ARMS, type ModuleRegistry, passRows } from "../modules/index.ts";
import { buildNameIndex, checkVaultIdentity, type NameIndex } from "../names/index.ts";
import { normalizeInput, type ParsedDoc, parseDoc } from "../parse/index.ts";
import type { PassRow, QueueLane } from "../passes/index.ts";
import type { EffectiveType, FlattenedRegistry } from "../registry/index.ts";
import { pinFieldOf } from "../shapes/index.ts";

// ---------------------------------------------------------------------------
// the state

export interface StateRename {
  from: string;
  to: string;
}

/**
 * What a verb hands the judge. `base` maps a path to the bytes it had in
 * the base snapshot, or `null` when the page did not exist there — the two cases
 * a single `Map<path, string>` conflates and the transition arms must not.
 */
export interface VaultState {
  pages: Map<string, string>;
  base?: Map<string, string | null>;
  renames?: readonly StateRename[];
  /**
   * Each page's parse beside the text it was parsed from, filled by
   * `parsedPages`. A verb that renders artifacts and then judges the same
   * state parses each page once; an entry is read back only while the page's
   * text is the one it was parsed from, so a state mutated after the parse is
   * parsed again rather than judged from a stale tree.
   */
  parsed?: Map<string, { text: string; doc: ParsedDoc }>;
}

/** Every page of a state, parsed once per text, in code-unit path order. */
export function parsedPages(state: VaultState): { path: string; doc: ParsedDoc }[] {
  if (state.parsed === undefined) state.parsed = new Map();
  const cache = state.parsed;
  const paths = [...state.pages.keys()].sort(codeUnitCompare);
  return paths.map((path) => {
    const text = state.pages.get(path) ?? "";
    const hit = cache.get(path);
    if (hit !== undefined && hit.text === text) return { path, doc: hit.doc };
    const doc = parseDoc(text);
    cache.set(path, { text, doc });
    return { path, doc };
  });
}

/** The law a state is judged under: one loaded constitution plus its options. */
export interface Law {
  registry: FlattenedRegistry;
  /**
   * docs/extending.md §What a module registers: the modules this bundle loaded. The kernel reads an arm's own
   * applicability declaration from here rather than knowing a grammar's name,
   * and it never imports the modules — the shell composes them and hands them
   * over, which is what makes the standard library a layer (docs/architecture.md §The invariants).
   */
  modules: ModuleRegistry;
  /** Vault-level lint options: everything except `names`, `baseText`, `collect`. */
  options?: LintOptions;
  /** POLICY keys `config/engine.json` declares — coverage reads them (docs/concepts.md §Findings and routing). */
  policyKeys?: readonly string[];
}

export interface JudgeOptions {
  /**
   * docs/concepts.md §The gate: the constructors that judge a COMMIT (indexState, the write overlay).
   * Turns on line-scoped severity and the change-scoping the staged gate applies.
   */
  gate?: boolean;
  /** A `config/` change rescopes the whole vault and suspends demotion. */
  configChanged?: boolean;
  limit?: number;
  all?: boolean;
  rule?: string;
  path?: string;
  /**
   * Findings from passes whose INPUT is not the page set — generated artifacts,
   * module loading, templates, freshness. The shell runs them and names them, so
   * the coverage block can tell "did not run here" from "found nothing".
   */
  shellFindings?: readonly Finding[];
  shellPasses?: readonly string[];
  /** A prebuilt name index (the stdin overlay builds one over the whole vault). */
  names?: NameIndex;
  /**
   * docs/cli.md §lint --page: the pages to JUDGE. The vault passes still see the whole
   * state — identity is a property of the vault, not of the page you asked
   * about — but per-page arms, page counts and `unevaluated` are scoped here.
   */
  only?: ReadonlySet<string>;
}

export interface CoverageRow {
  evaluated: number;
  not_applicable: number;
  unevaluable: number;
  /**
   * Why the pass did not apply where it did not: `no-base` for a pass that
   * compares against a base revision this state has none of,
   * `capability-unavailable` for a shell pass this run did not perform, and
   * `external-origin` for a pass that measures an external git origin — a
   * network the page set does not carry; this verb contacts none, and
   * `freshness` is the verb that does.
   */
  reason?: "no-base" | "capability-unavailable" | "external-origin";
}

/**
 * docs/concepts.md §Findings and routing: the blind spot, NAMED. `summary.unevaluated` is
 * the scalar every reader sums; this block says which pass could not be judged
 * and why, keyed by pass id — a count with no key is a number nobody can act on.
 */
export interface UnevaluatedRow {
  count: number;
  reason: "no-base";
}

export interface Verdict {
  findings: Finding[];
  dispositions: Record<string, Dispositions>;
  coverage: { passes: Record<string, CoverageRow> };
  unevaluated: Record<string, UnevaluatedRow>;
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

const SEVERITY_BAND: Readonly<Record<string, number>> = { error: 0, warning: 1, info: 2 };

/**
 * docs/concepts.md §Findings and routing: the cap fills error-first, so a gate never
 * blocks on a finding it did not print. The returned array keeps the deterministic
 * order — only membership changes — and the band sort is stable, so the chosen
 * N are the same N on bun and on node.
 */
function capBySeverity(sorted: readonly Finding[], limit: number): Finding[] {
  if (sorted.length <= limit) return [...sorted];
  const byBand = [...sorted].sort(
    (a, b) => (SEVERITY_BAND[a.severity] ?? 3) - (SEVERITY_BAND[b.severity] ?? 3),
  );
  const chosen = new Set(byBand.slice(0, limit));
  return sorted.filter((f) => chosen.has(f));
}

// ---------------------------------------------------------------------------
// routing (docs/concepts.md §Findings and routing)

/** The composed table, keyed by id: the kernel's rows plus every module's arms and checks. */
type Rows = ReadonlyMap<string, PassRow>;

function rowsOf(law: Law): Rows {
  return new Map(passRows(law.modules).map((r) => [r.id, r] as const));
}

function rowFor(finding: Pick<Finding, "ruleId" | "pass">, rows: Rows): PassRow | undefined {
  return rows.get(finding.pass ?? finding.ruleId) ?? rows.get(finding.ruleId);
}

/**
 * The xor every non-info finding satisfies. `fix` when a fixer in the closed
 * registry executes this rule TODAY; `queue` otherwise. Nothing on this path is
 * authored: a row flips by registering its fixer, with no table edit.
 */
function routeFinding(
  finding: Finding,
  law: Law,
  rows: Rows,
  text: string | undefined,
  staged: boolean,
): { fix?: FindingFix; queue?: QueueLane } {
  if (finding.severity === "info") return {};
  const row = rowFor(finding, rows);
  const id = row?.id ?? finding.pass ?? finding.ruleId;
  const context = fixerContextOf(law);
  if (
    row !== undefined &&
    fixerExecutes(row.fixer, id, context) &&
    executesHere(finding, row.fixer, text)
  ) {
    // The argv names the state the finding lives in: a commit's finding hands
    // out `--staged`, so `fix` judges the index the gate judged rather than a
    // working tree that may not carry the finding at all.
    const target: FixTarget = { ruleId: finding.ruleId, path: finding.path };
    if (finding.line !== undefined) target.line = finding.line;
    if (finding.details !== undefined) target.details = finding.details;
    if (staged) target.staged = true;
    const fix = buildFix(row.fixer ?? "", target, context);
    if (fix !== undefined) return { fix };
  }
  // A registered arm's or check's lane comes from the manifest that declared
  // it, through the composed table; `loadModules` refuses a non-census row with
  // no lane, so this finds one whenever the row is not `info`.
  if (row?.lane !== undefined) return { queue: row.lane };
  // Anything else is a class-B hole and is reported as an engine defect rather
  // than routed by guess.
  throw new Error(`finding-unroutable: "${id}" has no pass-table row and no lane`);
}

/**
 * docs/concepts.md §Findings and routing: `fixability: mechanical` is derived from the fixer's
 * OWN derivation, not from its rule list. One rule id can carry several defects —
 * `sections` fires for a missing heading, an undeclared one, an out-of-order one
 * and a count over `max` — and only the first has a mechanical remedy. Asking the
 * derivation is what keeps "a promise the verb breaks on contact" out
 * of the envelope, and it is why every derivation REFUSES rather than returning
 * an empty op list.
 *
 * A fixer outside the pure set (`check --write`, whose input is the artifact
 * tree) is trusted, because core cannot ask.
 */
function executesHere(finding: Finding, fixer: string | undefined, text?: string): boolean {
  if (fixer === undefined) return false;
  if (!PURE_FIXERS.includes(fixer) || text === undefined) return true;
  const input: FixInput = { ruleId: finding.ruleId, text };
  if (finding.line !== undefined) input.line = finding.line;
  if (finding.details !== undefined) input.details = { ...finding.details };
  return fixOpsFor(fixer, input).ok;
}

/** docs/concepts.md §Findings and routing: the engine state the fixer registry consults. */
function fixerContextOf(law: Law): FixerContext {
  const mode = law.options?.folderTags;
  return mode === undefined ? {} : { folderTags: mode };
}

/**
 * docs/concepts.md §Findings and routing: the law binds every verb that EMITS findings.
 * `okf check`, `move` and `new` build their arrays outside `judge` and map this
 * over them, so the xor holds on every envelope the CLI produces.
 */
export function routeFindings(
  findings: readonly Finding[],
  law: Law,
  pages: readonly { path: string; doc: ParsedDoc }[] = [],
): Finding[] {
  const byPath = new Map(pages.map((p) => [p.path, p] as const));
  const rows = rowsOf(law);
  return findings.map((f) => routeOne(f, law, rows, byPath, false));
}

/** One finding, routed: the xor, and a digest where the route is a queue. */
function routeOne(
  finding: Finding,
  law: Law,
  rows: Rows,
  byPath: ReadonlyMap<string, { path: string; doc: ParsedDoc }>,
  staged: boolean,
): Finding {
  const route = routeFinding(finding, law, rows, byPath.get(finding.path)?.doc.source, staged);
  const out: Finding = { ...finding };
  if (route.fix !== undefined) out.fix = route.fix;
  if (route.queue !== undefined) {
    out.queue = route.queue;
    if (out.evidenceDigest === undefined) {
      out.evidenceDigest = evidenceDigestFor(
        finding.ruleId,
        finding.path,
        digestCoreOf(finding, byPath),
      );
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// line inheritance (docs/concepts.md §The gate)

/**
 * The 1-based current lines the base accounts for: a current line is inherited
 * when the base holds an identical line it has not already accounted for. A
 * moved line is a move, not an edit, so order is not consulted; an edited line
 * matches nothing and is new (docs/concepts.md §The gate).
 */
export function inheritedLines(baseText: string, currentText: string): Set<number> {
  const pool = new Map<string, number>();
  for (const line of normalizeInput(baseText).text.split("\n")) {
    pool.set(line, (pool.get(line) ?? 0) + 1);
  }
  const out = new Set<number>();
  normalizeInput(currentText)
    .text.split("\n")
    .forEach((line, i) => {
      const left = pool.get(line) ?? 0;
      if (left === 0) return;
      pool.set(line, left - 1);
      out.add(i + 1);
    });
  return out;
}

// ---------------------------------------------------------------------------
// per-page exceptions (docs/constitution.md §Types, docs/concepts.md §Findings and routing)

export interface PageException {
  rule: string;
  digest: string;
  reason: string;
}

function exceptionsOf(doc: ParsedDoc): { list: PageException[]; malformed: boolean } {
  const raw = doc.frontmatter.value["exceptions"];
  if (raw === undefined) return { list: [], malformed: false };
  if (!Array.isArray(raw)) return { list: [], malformed: true };
  const list: PageException[] = [];
  let malformed = false;
  for (const item of raw) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      malformed = true;
      continue;
    }
    const rec = item as Record<string, unknown>;
    const rule = rec["rule"];
    const digest = rec["digest"];
    const reason = rec["reason"];
    if (typeof rule !== "string" || typeof digest !== "string" || typeof reason !== "string") {
      malformed = true;
      continue;
    }
    list.push({ rule, digest, reason });
  }
  return { list, malformed };
}

// ---------------------------------------------------------------------------
// coverage (docs/concepts.md §Findings and routing)

/** How many declarations of this pass govern this page; 0 = not applicable. */
function armCount(row: PassRow, effective: EffectiveType | undefined, law: Law): number {
  if (row.kind === "POLICY") {
    return (law.policyKeys ?? []).includes(row.key ?? "") ? 1 : 0;
  }
  if (row.kind === "LAW") return 1;
  if (effective === undefined || effective.status === "retired") return 0;
  if (row.id === "instances") return effective.instances === undefined ? 0 : 1;
  // docs/constitution.md §Shapes: declared by the `pin` SHAPE, read off the one predicate
  // `freshness` reads — never by a field's name.
  if (row.id === "malformed-pin") return pinFieldOf(effective.fields) === undefined ? 0 : 1;
  // docs/constitution.md §Types: declared by the TYPE, not by a section, so it is counted
  // before the grammar-binding short-circuit — a `review` type with a body law
  // and no sections at all is exactly the case this arm exists for.
  if (row.id === "body-append-only") {
    return effective.body === undefined ? 0 : 1;
  }
  const bindings = grammarBindings(effective, law.modules);
  if (bindings.length === 0) return 0;
  // docs/extending.md §An arm: the envelope arms belong to no grammar —
  // `grammar-unparsed` fires wherever a top-level item does not parse under
  // whatever grammar its section declared, and `canonical-form` compares the raw
  // line with the engine's rendering of the same item, both before any
  // grammar-specific branch. Classified by NAME, `canonical-form` matched no set
  // and fell through to 0: it reported `evaluated: 0, not_applicable: 41` on the
  // measurement corpus while firing 45 times there (docs/architecture.md §The invariants).
  if (ENVELOPE_ARMS.includes(row.id)) return bindings.length;
  // docs/extending.md §An arm: every other grammar arm is counted from the
  // declaration its own module made — `{grammar, param?, equals?}` — so a kit's
  // arm gets a coverage row without the kernel learning its name.
  const arm = law.modules.arms.get(row.id);
  if (arm !== undefined) {
    const grammar = law.modules.armGrammar.get(row.id);
    const spec = grammar === undefined ? undefined : law.modules.grammars.get(grammar);
    if (grammar === undefined || spec === undefined) return 0;
    return bindings.filter(
      (b) =>
        b.grammar === grammar &&
        // docs/extending.md §A grammar: the binding carries its grammar's
        // parameters in one record, so the count reads them rather than
        // projecting names off the struct.
        armApplies(arm, b.params),
    ).length;
  }
  if (row.id === "tag-requires-link") return 1;
  return 0;
}

/**
 * docs/extending.md §A check: how many attachments of this check govern this page —
 * the same question `armCount` asks of an arm, answered from the type's own
 * composed attachment list rather than from a name the kernel knows.
 */
function checkCount(id: string, effective: EffectiveType | undefined): number {
  if (effective === undefined || effective.status === "retired") return 0;
  return effective.checks.filter((attachment) => attachment.use === id).length;
}

// ---------------------------------------------------------------------------
// the judge

/**
 * The staged gate counts `unevaluated` for the pages the commit touches — an
 * untouched page's arms are not this commit's blind spot (as the gate
 * has always reported it).
 */
function countsUnevaluated(state: VaultState, options: JudgeOptions, path: string): boolean {
  if (options.gate !== true || options.configChanged === true || state.base === undefined) {
    return true;
  }
  const base = state.base.get(path);
  return base === undefined || base === null || base !== state.pages.get(path);
}

export function judge(state: VaultState, law: Law, options: JudgeOptions = {}): Verdict {
  const pages = parsedPages(state);
  const names = options.names ?? buildNameIndex(pages);
  const byPath = new Map(pages.map((p) => [p.path, p] as const));

  const findings: Finding[] = [];
  const dispositions: Record<string, Dispositions> = {};
  // docs/concepts.md §Findings and routing: the composed table — the kernel's rows plus
  // every arm and check a loaded module registered. Iterating the kernel's
  // table alone is how a kit's arm reported NOTHING — no row, no finding, no
  // refusal — while the manifest that declared it loaded clean.
  const rows = passRows(law.modules);
  const byId: Rows = new Map(rows.map((r) => [r.id, r] as const));
  const coverage: Record<string, CoverageRow> = {};
  for (const row of rows) {
    coverage[row.id] = { evaluated: 0, not_applicable: 0, unevaluable: 0 };
  }
  const shellRan = new Set(options.shellPasses ?? []);
  const baseFor = (path: string): string | undefined => {
    const value = state.base?.get(path);
    return typeof value === "string" ? value : undefined;
  };
  let unevaluated = 0;
  const unevaluatedBy = new Map<string, number>();

  for (const page of pages) {
    if (options.only !== undefined && !options.only.has(page.path)) continue;
    const baseText = baseFor(page.path);
    const collect = { dispositions: emptyDispositions() };
    const lintOptions: LintOptions = { ...law.options, names, collect };
    if (baseText !== undefined) lintOptions.baseText = baseText;
    findings.push(
      ...lintPage({ path: page.path, doc: page.doc, registry: law.registry }, lintOptions),
    );
    const anyDisposition = Object.values(collect.dispositions).some((v) => v !== 0);
    if (anyDisposition) dispositions[page.path] = collect.dispositions;

    // --- coverage, per page, over every pass in the table ------------------
    const typeValue = page.doc.frontmatter.value["type"];
    const effective = typeof typeValue === "string" ? law.registry.types.get(typeValue) : undefined;
    for (const row of rows) {
      const cell = coverage[row.id];
      if (cell === undefined) continue;
      // A shell pass this run did not perform did not apply, whatever the page
      // declares: "did not run here" is the first question, and the answer is
      // the same on every page.
      if (row.input === "shell" && !shellRan.has(row.id)) {
        cell.not_applicable += 1;
        cell.reason = "capability-unavailable";
        continue;
      }
      // docs/constitution.md §Shapes: a pass whose input is an external origin. No judging
      // verb contacts one — nine sockets on every `check` would make a
      // one-second verb network-bound and paint warnings on every offline run
      // — so the row is present, honest and never evaluated here.
      if (row.input === "origin") {
        cell.not_applicable += 1;
        cell.reason = "external-origin";
        continue;
      }
      const arms = law.modules.checks.has(row.id)
        ? checkCount(row.id, effective)
        : armCount(row, effective, law);
      if (arms === 0) {
        cell.not_applicable += 1;
        continue;
      }
      // The row says whether it compares against a base — the kernel's own
      // rows on the table, a module's on its manifest — so a kit's transition
      // arm never reads `evaluated` on a page it never saw.
      if (row.needsBase === true && baseText === undefined) {
        cell.not_applicable += arms;
        cell.reason = "no-base";
        // The scalar counts the arms a DECLARATION turned on and this
        // run could not judge — never a census, and never the kernel's own
        // rename or folder passes, which no page declares.
        if (
          row.kind === "type-declared" &&
          row.severity !== "info" &&
          countsUnevaluated(state, options, page.path)
        ) {
          unevaluated += arms;
          unevaluatedBy.set(row.id, (unevaluatedBy.get(row.id) ?? 0) + arms);
        }
        continue;
      }
      cell.evaluated += 1;
    }
  }

  findings.push(...checkVaultIdentity(pages, { fieldSources: law.options?.fieldSources }));
  findings.push(...checkVaultInstances(pages, law.registry));
  findings.push(...renamedWithoutAlias(state, byPath));
  findings.push(...(options.shellFindings ?? []));

  // --- per-page exceptions (docs/concepts.md §Findings and routing) ---------------------------------
  const excepted: Record<string, number> = {};
  const kept: Finding[] = [];
  // `gate: true` is the constructors that judge a COMMIT — the index — so the
  // fix argv of every finding here says `--staged`.
  const staged = options.gate === true;
  const routed = findings.map((f) => routeOne(f, law, byId, byPath, staged));
  const exceptionUse = new Map<string, Set<string>>();
  for (const f of routed) {
    const page = byPath.get(f.path);
    if (page === undefined || f.queue === undefined || f.evidenceDigest === undefined) {
      kept.push(f);
      continue;
    }
    const { list } = exceptionsOf(page.doc);
    const match = list.find((e) => e.rule === f.ruleId && e.digest === f.evidenceDigest);
    if (match === undefined) {
      kept.push(f);
      continue;
    }
    excepted[f.ruleId] = (excepted[f.ruleId] ?? 0) + 1;
    let used = exceptionUse.get(f.path);
    if (used === undefined) {
      used = new Set<string>();
      exceptionUse.set(f.path, used);
    }
    used.add(`${match.rule}|${match.digest}`);
  }
  kept.push(
    ...exceptionFindings(pages, exceptionUse, law, byId).map((f) =>
      routeOne(f, law, byId, byPath, staged),
    ),
  );

  // --- the base name index (docs/concepts.md §The gate) -----------------------
  // A rename mutates the name index, and the rows that read it fire on the LINK
  // HOLDER — untouched, every line inherited. Line inheritance is the wrong
  // question for them, so they are re-asked against the names the base held.
  const baseNames = buildBaseNames(state, byPath);
  const causedByNames = (f: Finding): boolean => {
    if (baseNames === undefined) return false;
    const want = NAME_INDEX_RULES.get(f.ruleId);
    if (want === undefined) return false;
    const target = f.details?.["target"];
    if (typeof target !== "string") return false;
    return linkVerdict(baseNames, target) !== want;
  };

  // --- line-scoped severity (docs/concepts.md §The gate) --------------------------------
  // One alignment per page, because a page is judged by many arms.
  const alignments = new Map<string, Set<number>>();
  const inheritedOn = (path: string, baseText: string): Set<number> => {
    let lines = alignments.get(path);
    if (lines === undefined) {
      lines = inheritedLines(baseText, state.pages.get(path) ?? "");
      alignments.set(path, lines);
    }
    return lines;
  };
  const scoped = kept.map((f) => {
    const baseText = baseFor(f.path);
    if (causedByNames(f)) {
      // The base index would not have produced it: the commit did, whatever
      // the holder's lines say. Never demoted, and visible below.
      return { ...f, new_since_base: true };
    }
    if (baseText === undefined || f.line === undefined) return f;
    const inherited = inheritedOn(f.path, baseText).has(f.line);
    const out: Finding = { ...f, new_since_base: !inherited };
    if (
      options.gate === true &&
      options.configChanged !== true &&
      inherited &&
      out.severity === "error" &&
      out.queue !== undefined &&
      !NEVER_DEMOTED.has(f.pass ?? f.ruleId)
    ) {
      out.severity = "warning";
      out.details = { ...out.details, demoted_from: "error" };
    }
    return out;
  });

  // --- the gate's change-scoping -----------------------------------
  const changed = new Set<string>();
  if (state.base !== undefined) {
    for (const [path, text] of state.pages) {
      const base = state.base.get(path);
      if (base === undefined || base === null || base !== text) changed.add(path);
    }
    // A pure rename moves bytes that did not change, so the byte comparison
    // above says "unchanged" and the scoping would drop the one P4 finding the
    // rename exists to raise. The rename IS the change.
    for (const rename of state.renames ?? []) changed.add(rename.to);
  }
  const visible =
    options.gate === true && options.configChanged !== true && state.base !== undefined
      ? scoped.filter(
          (f) =>
            changed.has(f.path) ||
            f.ruleId === "identity-collision" ||
            f.ruleId === "instances" ||
            // A link the commit broke on a page it did not touch.
            causedByNames(f) ||
            !byPath.has(f.path),
        )
      : scoped;

  sortFindings(visible);
  const wantPath = options.path?.normalize("NFC");
  const filtered = visible.filter(
    (f) =>
      (options.rule === undefined || f.ruleId === options.rule) &&
      (wantPath === undefined || f.path === wantPath),
  );
  const limit = options.limit ?? DEFAULT_FINDING_LIMIT;
  const capped = options.all === true ? filtered : capBySeverity(filtered, limit);

  const by_rule: Record<string, number> = {};
  const counts = new Map<string, number>();
  for (const f of filtered) counts.set(f.ruleId, (counts.get(f.ruleId) ?? 0) + 1);
  for (const id of [...counts.keys()].sort(codeUnitCompare)) by_rule[id] = counts.get(id) ?? 0;

  const pageCount =
    options.only !== undefined
      ? pages.filter((p) => options.only?.has(p.path) === true).length
      : options.gate === true && options.configChanged !== true && state.base !== undefined
        ? changed.size
        : pages.length;

  const unevaluatedBlock: Record<string, UnevaluatedRow> = {};
  for (const id of [...unevaluatedBy.keys()].sort(codeUnitCompare)) {
    unevaluatedBlock[id] = { count: unevaluatedBy.get(id) ?? 0, reason: "no-base" };
  }

  return {
    findings: capped,
    dispositions,
    coverage: { passes: coverage },
    unevaluated: unevaluatedBlock,
    summary: {
      pages: pageCount,
      errors: filtered.filter((f) => f.severity === "error").length,
      warnings: filtered.filter((f) => f.severity === "warning").length,
      infos: filtered.filter((f) => f.severity === "info").length,
      by_rule,
      excepted,
      unevaluated,
    },
    caps: { limit, hit: options.all !== true && filtered.length > limit },
  };
}

/**
 * docs/concepts.md §The gate: the rows whose input is the vault NAME INDEX, with
 * the `linkVerdict` each one asserts. A finding here is "caused by this commit"
 * when the base index would have returned something else for the same target.
 */
const NAME_INDEX_RULES: ReadonlyMap<string, "unresolved" | "alias"> = new Map([
  ["wikilink-unresolved", "unresolved"],
  ["wikilink-alias-target", "alias"],
  ["relation-target-unresolved", "unresolved"],
]);

/**
 * The name index as the BASE held it: a renamed page under its `from` (the base
 * knew it as `Ana`), a deleted page still present (`state.base` may carry paths
 * the page set no longer does). An unchanged page reuses the doc the page loop
 * already parsed, so the extra parse is paid only for what the commit touched.
 */
function buildBaseNames(
  state: VaultState,
  byPath: ReadonlyMap<string, { path: string; doc: ParsedDoc }>,
): NameIndex | undefined {
  if (state.base === undefined) return undefined;
  const renamedFrom = new Map((state.renames ?? []).map((r) => [r.to, r.from] as const));
  const pages: { path: string; doc: ParsedDoc }[] = [];
  const seen = new Set<string>();
  for (const [path, text] of state.base) {
    if (typeof text !== "string") continue;
    const namePath = renamedFrom.get(path) ?? path;
    if (seen.has(namePath)) continue;
    seen.add(namePath);
    const current = byPath.get(path);
    const doc =
      current !== undefined && state.pages.get(path) === text ? current.doc : parseDoc(text);
    pages.push({ path: namePath, doc });
  }
  pages.sort((a, b) => codeUnitCompare(a.path, b.path));
  return buildNameIndex(pages);
}

/**
 * docs/concepts.md §The gate: what an inherited line never demotes. Frontmatter parse errors
 * are the page's syntax, not its backlog — a commit that inherits a broken YAML
 * block still cannot be read — and a fix-routed error is one command away.
 */
const NEVER_DEMOTED: ReadonlySet<string> = new Set([
  "malformed-frontmatter",
  "frontmatter-not-mapping",
  "duplicate-key",
  "identity-collision",
  "instances",
  "exception-illegal",
]);

/** The item core a queue-routed finding is keyed by — never its line number. */
function digestCoreOf(
  finding: Finding,
  byPath: ReadonlyMap<string, { path: string; doc: ParsedDoc }>,
): string {
  const handle = finding.details?.["handle"];
  if (typeof handle === "string") return handle;
  const page = byPath.get(finding.path);
  if (page === undefined || finding.line === undefined) return finding.message;
  const line = page.doc.source.split("\n")[finding.line - 1];
  return line ?? finding.message;
}

/** docs/concepts.md §Findings and routing: a stale exception is a warning, an illegal one an error. */
function exceptionFindings(
  pages: readonly { path: string; doc: ParsedDoc }[],
  used: ReadonlyMap<string, ReadonlySet<string>>,
  law: Law,
  rows: Rows,
): Finding[] {
  const out: Finding[] = [];
  // From the TABLE under the loaded law, never from the findings that
  // happened to fire — otherwise the same waiver on the same page reads stale
  // or illegal depending on whether an unrelated page violated the rule.
  const context = fixerContextOf(law);
  const fixRouted = new Set(
    [...rows.values()].filter((r) => fixerExecutes(r.fixer, r.id, context)).map((r) => r.id),
  );
  for (const page of pages) {
    const { list, malformed } = exceptionsOf(page.doc);
    const keyLine = page.doc.frontmatter.keys.find((k) => k.key === "exceptions")?.line ?? 1;
    if (malformed) {
      out.push({
        ruleId: "exception-illegal",
        severity: "error",
        path: page.path,
        line: keyLine,
        message: "exceptions: every entry is a mapping with `rule`, `digest` and `reason`",
        remediation: "fix the entry, or remove it and let the finding stand",
        contributedBy: "engine",
        layer: "constitution",
      });
    }
    const seen = used.get(page.path) ?? new Set<string>();
    for (const exception of list) {
      const row = rows.get(exception.rule);
      // An `info` row is never queue-routed and carries no digest, so
      // an exception naming one can never match — it reported `exception-stale`
      // while the finding it names sat three lines below. Nothing to waive.
      const census = row?.severity === "info";
      const illegal =
        row === undefined ||
        census ||
        fixRouted.has(exception.rule) ||
        NEVER_DEMOTED.has(exception.rule);
      if (illegal) {
        const why =
          row === undefined
            ? "not a rule this engine emits"
            : census
              ? "an info row: a census with nothing to waive"
              : "fix-routed or a law a page may not waive";
        out.push({
          ruleId: "exception-illegal",
          severity: "error",
          path: page.path,
          line: keyLine,
          message: `"${exception.rule}" may not be excepted per page: it is ${why}`,
          remediation:
            row === undefined || census
              ? "remove the entry"
              : "run the fix; a fix-routed row and a law are never waived",
          contributedBy: "engine",
          layer: "constitution",
        });
        continue;
      }
      if (!seen.has(`${exception.rule}|${exception.digest}`)) {
        out.push({
          ruleId: "exception-stale",
          severity: "warning",
          path: page.path,
          line: keyLine,
          message: `exception for "${exception.rule}" matches no finding on this page`,
          remediation: "remove it — the finding it waived is gone",
          contributedBy: "engine",
          layer: "constitution",
          details: { rule: exception.rule, digest: exception.digest },
        });
      }
    }
  }
  return out;
}

/**
 * P4: Obsidian's `alwaysUpdateLinks` rewrites every link on a
 * rename, so the ONE thing that can still break is the alias ritual — the old
 * name must survive as an alias or every existing reference to it, in any
 * writer's notes, silently stops resolving. A path move or case normalization
 * does not change that identity; an actual rename whose new page already
 * carries the alias fires nothing.
 */
function renamedWithoutAlias(
  state: VaultState,
  byPath: ReadonlyMap<string, { path: string; doc: ParsedDoc }>,
): Finding[] {
  const out: Finding[] = [];
  for (const rename of [...(state.renames ?? [])].sort((a, b) => codeUnitCompare(a.to, b.to))) {
    const page = byPath.get(rename.to);
    if (page === undefined) continue;
    const old = basenameOfPath(rename.from);
    if (old === "") continue;
    const current = basenameOfPath(rename.to);
    if (normalizeIdentity(old) === normalizeIdentity(current)) continue;
    const aliases = page.doc.frontmatter.value["aliases"];
    const carried = Array.isArray(aliases)
      ? aliases.some(
          (a) => typeof a === "string" && normalizeIdentity(a) === normalizeIdentity(old),
        )
      : false;
    if (carried) continue;
    out.push({
      ruleId: "renamed-without-alias",
      severity: "error",
      path: rename.to,
      line: page.doc.frontmatter.keys.find((k) => k.key === "aliases")?.line ?? 1,
      message: `renamed from "${old}"; the old name must survive as an alias`,
      remediation: `add "${old}" to aliases — every existing [[${old}]] outside this rename still points at it`,
      contributedBy: "engine",
      layer: "constitution",
      details: { from: rename.from, alias: old },
    });
  }
  return out;
}

function basenameOfPath(path: string): string {
  const last = path.split("/").pop() ?? "";
  return last.endsWith(".md") ? last.slice(0, -3) : last;
}

/** One order, before any cap. */
export function sortFindings(findings: Finding[]): void {
  findings.sort((a, b) => {
    const byPath = codeUnitCompare(a.path, b.path);
    if (byPath !== 0) return byPath;
    const la = a.line ?? 0;
    const lb = b.line ?? 0;
    if (la !== lb) return la - lb;
    const byRule = codeUnitCompare(a.ruleId, b.ruleId);
    if (byRule !== 0) return byRule;
    return codeUnitCompare(a.message, b.message);
  });
}

export type { Dispositions };
export { addDispositions, emptyDispositions };
