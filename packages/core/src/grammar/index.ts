// docs/concepts.md §Section grammar (the item EBNF; "a marker is a complete clause"; the
// rationale rule; the two History item kinds; the state arms)
// docs/constitution.md §Sections (the declaration and its parameters)
// docs/architecture.md §Directories determinism (no locale, no clock, code-unit ordering only).
//
// This module is the ONE item parser: every arm — the state arms here, the
// transition arms in lint, and the writer — reads the `SectionAST` it produces.
import { normalizeIdentity } from "../identity/index.ts";
import {
  type ArmContext,
  type ArmRow,
  type ArmSpec,
  admittedKinds,
  armApplies,
  armDefault,
  armRows,
  canonicalizeOf,
  DECLARED_ARM_DEFAULT,
  type DeclaredParams,
  type GrammarParse,
  type ItemFields,
  type ModuleRegistry,
  type ParseContext,
  resolveParsers,
  type VocabularyUse,
  type VocabularyView,
} from "../modules/index.ts";
import type { ParsedDoc } from "../parse/index.ts";

// ---------------------------------------------------------------------------
// the declaration a section carries (docs/constitution.md §Sections)

/**
 * docs/extending.md §A check: a grammar's REGISTERED NAME. A string, not a union
 * of the four the standard library ships — a kit registers its own, and the
 * registry refuses one no module registered (`constitution-unknown-extension`).
 * `prose` is the kernel's own: no module registers it and it parses nothing.
 */
export type GrammarKind = string;

export interface SectionBinding {
  heading: string;
  aliases?: readonly string[];
  /** The type's section depth — identity AND depth bind. */
  depth: number;
  grammar: GrammarKind;
  /**
   * docs/extending.md §A grammar: the parameters the DECLARED GRAMMAR admits,
   * carried as one opaque record. The kernel checks that a parameter belongs to
   * its grammar and that its combination law is obeyed; it never reads a
   * parameter's meaning, so this struct does not grow a field per kit.
   */
  params: DeclaredParams;
  /**
   * docs/extending.md §A grammar: the resolved dispatch chain — this section's grammar
   * then its applicable delegates, in order. Resolved by whoever built the
   * binding, because that is the layer holding the module registry; empty for a
   * prose section and for a grammar no loaded module registered.
   */
  parsers: readonly GrammarParse[];
  /** The per-parameter ratchet knob for every non-census row of this section. */
  severity?: "warning" | "error";
  /** The type that declared this entry, and the registry pointer to it. */
  contributedBy?: string;
  registryPath?: string;
}

/**
 * docs/extending.md §A grammar: build a binding from the kernel's own keys plus one
 * parameter record. The constructor exists so a caller — a test, a kit's own
 * fixture — states which half of the entry it is setting, instead of a flat
 * literal that hides the seam.
 */
export function sectionBinding(
  kernel: {
    heading: string;
    depth: number;
    grammar: GrammarKind;
    aliases?: readonly string[];
    severity?: "warning" | "error";
    contributedBy?: string;
    registryPath?: string;
  },
  params: DeclaredParams = {},
  modules?: ModuleRegistry,
): SectionBinding {
  const binding: SectionBinding = {
    heading: kernel.heading,
    depth: kernel.depth,
    grammar: kernel.grammar,
    params,
    parsers: modules === undefined ? [] : resolveParsers(kernel.grammar, params, modules),
  };
  if (kernel.aliases !== undefined) binding.aliases = kernel.aliases;
  if (kernel.severity !== undefined) binding.severity = kernel.severity;
  if (kernel.contributedBy !== undefined) binding.contributedBy = kernel.contributedBy;
  if (kernel.registryPath !== undefined) binding.registryPath = kernel.registryPath;
  return binding;
}

// ---------------------------------------------------------------------------
// the AST

export interface RationaleLine {
  line: number;
  text: string;
}

/**
 * docs/extending.md §A grammar: what the kernel attaches around a module's
 * fields. Exported because a module's item shape extends it — and it is the ONE
 * thing about an item the kernel guarantees, because the Writer splices on it.
 */
export interface ItemBase {
  line: number;
  /** The item text after the bullet marker, verbatim. */
  raw: string;
  rationale: RationaleLine[];
}

export interface UnparsedItem extends ItemBase {
  kind: "unparsed";
  text: string;
}

/**
 * An item as the KERNEL sees one: the envelope, a kind it does not interpret,
 * and the module's own fields it does not name. The kernel reads
 * `kind` to dispatch and `raw` to splice; everything a grammar put on the item
 * travels untyped to the arms that grammar registered.
 */
export interface GrammarItem extends ItemBase {
  kind: string;
  /** The kernel's OWN `unparsed` item: the text nothing parsed. */
  text?: string;
  /** docs/extending.md §The determinism fixture: the message a module's `parse` threw, if it did. */
  parseError?: string;
}

/**
 * docs/extending.md §A grammar: what a grammar's `parse` returns — its own fields and its
 * kind, and never the envelope. The kernel attaches `line`, `raw` and
 * `rationale` around them, so a module cannot name a line and therefore cannot
 * aim a splice at the wrong bytes (docs/concepts.md §The judge and its states).
 */
export type Fields<T extends ItemBase> = Omit<T, keyof ItemBase>;

export interface SectionNode {
  /** The heading as written on the page (may be a declared alias). */
  heading: string;
  /** The canonical declared heading. */
  declared: string;
  identity: string;
  depth: number;
  line: number;
  grammar: GrammarKind;
  binding: SectionBinding;
  items: GrammarItem[];
  /** Non-list, non-blank lines: unparsed prose, and legal. */
  proseLines: number;
}

export interface SectionAST {
  sections: SectionNode[];
}

// ---------------------------------------------------------------------------
// lexical shapes

const HEADING = /^(#{1,6})[ \t]+(.*?)[ \t]*$/u;
const LIST_ITEM = /^([ \t]*)(?:[-*+]|\d+[.)])[ \t]+(.*)$/u;
/**
 * docs/constitution.md §Sections / docs/constitution.md §config/engine.json: what the parser needs from the BUNDLE
 * rather than from the type. Today one entry — the declared evidence roots the
 * bare-path provenance form resolves against. A kernel type because it
 * is engine config on its way to `ParseContext`, and every grammar gets it on
 * the same terms.
 */
export interface ParseOptions {
  /** `config/engine.json`'s `source_roots`; absent or empty ⇒ the form is off. */
  sourceRoots?: readonly string[];
}

/**
 * docs/extending.md §A grammar: the kernel's dispatch. It resolves the section's
 * grammar in the module registry, calls that grammar's `parse`, and on a decline
 * tries each DECLARED delegation whose condition the section meets — resolving
 * the delegated kind to its owning grammar itself, so no module imports another.
 * What nothing parsed becomes `unparsed`, which only the kernel may make.
 *
 * The grammar names that used to sit here were the leak this dispatch closes: a
 * kit's grammar reached this function and fell through to `entries`.
 */
function parseItem(
  text: string,
  line: number,
  binding: SectionBinding,
  options: ParseOptions | undefined,
): GrammarItem {
  const ctx: ParseContext = { params: binding.params, sourceRoots: options?.sourceRoots ?? [] };
  const envelope = { line, raw: text, rationale: [] as RationaleLine[] };
  for (const parse of binding.parsers) {
    // docs/extending.md §The determinism fixture: a module's `parse` that throws must not take
    // the page's parse with it. The item becomes `unparsed` — which is what an
    // item nothing parsed IS — and carries the reason, which `checkGrammar`
    // turns into an attributed `module-failure` rather than a silent skip.
    let fields: ItemFields | undefined;
    try {
      fields = parse(text, ctx);
    } catch (error) {
      return {
        kind: "unparsed",
        text,
        ...envelope,
        parseError: error instanceof Error ? error.message : String(error),
      };
    }
    if (fields !== undefined) return { ...fields, ...envelope } as GrammarItem;
  }
  return { kind: "unparsed", text, ...envelope };
}

/**
 * Bind sections by identity, aliases and depth (the sections matcher), then parse
 * each non-prose section's TOP-LEVEL list items under its grammar. Indented
 * items attach to the last parsed item as rationale, in every grammar.
 */
export function parseSections(
  doc: ParsedDoc,
  bindings: readonly SectionBinding[],
  options?: ParseOptions,
): SectionAST {
  const byIdentity = new Map<string, SectionBinding>();
  for (const binding of bindings) {
    for (const name of [binding.heading, ...(binding.aliases ?? [])]) {
      const identity = normalizeIdentity(name);
      if (!byIdentity.has(identity)) byIdentity.set(identity, binding);
    }
  }
  const fenced = new Set<number>();
  for (const fence of doc.fences) {
    for (let i = fence.line; i <= fence.endLine; i += 1) fenced.add(i);
  }
  const lines = doc.source.split("\n");
  const sections: SectionNode[] = [];
  let current: SectionNode | undefined;
  let lastItem: GrammarItem | undefined;
  for (let i = doc.frontmatter.endLine; i < lines.length; i += 1) {
    const lineNo = i + 1;
    if (fenced.has(lineNo)) continue;
    const text = lines[i] ?? "";
    const heading = HEADING.exec(text);
    if (heading !== null) {
      const depth = (heading[1] ?? "").length;
      const label = heading[2] ?? "";
      if (current !== undefined && depth <= current.depth) {
        current = undefined;
        lastItem = undefined;
      }
      // A heading ends the ownership scope in every case: a rationale line under
      // `### Sub` is not the claim's above it (docs/concepts.md §Section grammar).
      lastItem = undefined;
      const binding = byIdentity.get(normalizeIdentity(label));
      if (binding !== undefined && depth === binding.depth) {
        current = {
          heading: label,
          declared: binding.heading,
          identity: normalizeIdentity(binding.heading),
          depth,
          line: lineNo,
          grammar: binding.grammar,
          binding,
          items: [],
          proseLines: 0,
        };
        sections.push(current);
        lastItem = undefined;
      }
      continue;
    }
    if (current === undefined) continue;
    const listItem = LIST_ITEM.exec(text);
    if (listItem === null) {
      if (text.trim() !== "") current.proseLines += 1;
      continue;
    }
    const indent = (listItem[1] ?? "").length;
    const body = (listItem[2] ?? "").trim();
    if (current.grammar === "prose") {
      lastItem = undefined;
      continue;
    }
    if (indent > 0) {
      // The rationale rule: identity-free, verbatim, never an item, never a
      // finding — in every grammar (docs/concepts.md §Section grammar).
      if (lastItem !== undefined) {
        lastItem.rationale.push({ line: lineNo, text: body });
        continue;
      }
      // An indented item with NO owner has no third outcome: it is reported,
      // never dropped one indent level down. It is NOT parsed under the
      // section's grammar — an indented `[category]` bullet is not a claim
      // (CLAIM_BULLET stays deleted) — and it owns the indented lines
      // that follow, so a nested block reports once.
      const orphan: UnparsedItem = {
        kind: "unparsed",
        line: lineNo,
        raw: body,
        text: body,
        rationale: [],
      };
      current.items.push(orphan);
      lastItem = orphan;
      continue;
    }
    const item = parseItem(body, lineNo, current.binding, options);
    current.items.push(item);
    lastItem = item;
  }
  return { sections };
}

// ---------------------------------------------------------------------------
// the state arms (docs/concepts.md §Section grammar) — report mode: warnings and census infos

// docs/concepts.md §Findings and routing: the arm-row vocabulary lives with the module API, because
// arms are what it is about and a module declares its own row. Re-exported here
// because this is where the emit site resolves a severity from it.
export { type ArmRow, armDefault, armRows, DECLARED_ARM_DEFAULT } from "../modules/index.ts";

export interface GrammarFinding {
  /**
   * docs/extending.md §An arm: a STRING, not a closed union — a kit's arm
   * carries its own namespaced id, and a type that could not hold one is a
   * third way an arm was unable to fire. Every id emitted here has a row:
   * the kernel's five in the pass table, and a module's on its own manifest.
   */
  ruleId: string;
  severity: "error" | "warning" | "info";
  line: number;
  message: string;
  remediation?: string;
  contributedBy?: string;
  registryPath?: string;
  details: Record<string, string | number | boolean>;
  /**
   * The row's per-item identity, digested into `evidenceDigest` by the caller
   * (docs/concepts.md §Findings and routing). Per item, not per message: two claims of the same
   * category on one page must not share an exception key.
   */
  evidence: string;
}

/**
 * docs/constitution.md §Vocabularies: what an authored value resolved to, and how.
 * The consumers used to fold aliases into the canonical entry and drop the
 * `status`, which is exactly why the alias law and the retirement law were
 * unenforced everywhere but `tags`.
 */
/**
 * docs/constitution.md §Vocabularies: how an authored value resolved. Defined with the module API
 * (`modules/index.ts`) because an arm context hands one to a module; re-exported
 * here because this is where the vocabulary laws are judged. One definition.
 */
export type { VocabularyUse } from "../modules/index.ts";

export interface GrammarCheckOptions {
  /**
   * docs/concepts.md §Findings and routing: the loaded modules, whose arms carry their own
   * pass-table rows. Absent leaves only the kernel's four rows known, so a
   * caller that judges a bundle passes one.
   */
  modules: ModuleRegistry;
  /**
   * docs/extending.md §An arm: one view per REGISTERED vocabulary
   * name. The per-vocabulary fields below are the shipped modules' and are being
   * replaced by this map, which is what lets a kit's grammar read a vocabulary
   * the kernel never heard of.
   */
  vocabularies?: ReadonlyMap<string, VocabularyView>;
  /** The page being judged, for `owned_by.not_on`. */
  page?: { chain?: readonly string[]; tags?: readonly string[] };
  /** Name-index resolution for relation targets; absent ⇒ the arm is inapplicable. */
  resolveTarget?: (name: string) => boolean;
  /** The target page's `extends` chain, for a label's `range`. */
  resolveTargetChain?: (name: string) => readonly string[] | undefined;
  /** The concrete types whose chain reaches any of the named ones — what a page may carry where an abstract type is named. */
  concreteTypesUnder?: (names: readonly string[]) => readonly string[];
}

/**
 * docs/concepts.md §The judge and its states: the engine's own dialect for an item it
 * authors — a `-` bullet, and whatever else the item's own grammar declares. The
 * ARM is the kernel's and so is its `info` row; the RENDERING is the module's,
 * resolved from the grammar that owns the item's kind. A rationale line is never
 * touched: it is identity-free prose.
 *
 * This function used to know that a claim opens with 【】 and that a dated entry
 * separates with an em-dash — two grammars' syntax, in the kernel, behind a
 * kernel-owned arm id.
 */
function canonicalLineOf(item: GrammarItem, modules: ModuleRegistry): string | undefined {
  const canonicalize = canonicalizeOf(item.kind, modules);
  return canonicalize === undefined ? undefined : canonicalize(item as never);
}

export function checkGrammar(ast: SectionAST, options: GrammarCheckOptions): GrammarFinding[] {
  const findings: GrammarFinding[] = [];
  // docs/concepts.md §Findings and routing: resolved once — the kernel's four rows plus the
  // row each loaded module declared. Without a registry only the kernel's are
  // known, which is why the caller passes one rather than the engine defaulting.
  const rows = armRows(options.modules);
  for (const section of ast.sections) {
    const binding = section.binding;
    if (binding.grammar === "prose") continue;
    // docs/concepts.md §Findings and routing: only a `declared` row is the knob's to move —
    // the section's own `severity`, else the arm's declared default. A census
    // row is `info` whatever the section says, and a vocabulary law is an error
    // the section cannot quiet — an alias that resolves silently is a vocabulary
    // with two names for one thing.
    const severityOf = (row: ArmRow, severityDefault?: "error"): GrammarFinding["severity"] =>
      row === "declared"
        ? (binding.severity ?? severityDefault ?? DECLARED_ARM_DEFAULT)
        : armDefault(row);
    const push = (
      ruleId: string,
      severity: GrammarFinding["severity"],
      line: number,
      message: string,
      details: Record<string, string | number | boolean>,
      evidence: string,
      remediation?: string,
    ): void => {
      const finding: GrammarFinding = { ruleId, severity, line, message, details, evidence };
      if (remediation !== undefined) finding.remediation = remediation;
      if (binding.contributedBy !== undefined) finding.contributedBy = binding.contributedBy;
      if (binding.registryPath !== undefined) finding.registryPath = binding.registryPath;
      findings.push(finding);
    };
    /** The kernel's own emits, under the kernel's own rows. */
    const emit = (
      ruleId: string,
      line: number,
      message: string,
      details: Record<string, string | number | boolean>,
      evidence: string,
      remediation?: string,
    ): void => {
      // Every emitted id has a row — the kernel's are reserved, and an arm
      // carries its own. A `?? "declared"` default here would be unreachable,
      // and an unreachable default is a lie about what happens when it is reached.
      const row = rows.get(ruleId);
      if (row === undefined) throw new Error(`no pass-table row for "${ruleId}"`);
      push(ruleId, severityOf(row), line, message, details, evidence, remediation);
    };
    /**
     * docs/constitution.md §Vocabularies: the two laws every vocabulary shares, at the
     * site that authored the value. Fixed errors — the section's `severity` does
     * not reach them, because an alias that resolves silently is a vocabulary
     * with two names for one thing, and a retirement that does not bite is not a
     * retirement.
     */
    const vocabularyLaws = (
      use: VocabularyUse | undefined,
      authored: string,
      line: number,
      details: Record<string, string | number | boolean>,
      evidence: string,
    ): void => {
      if (use === undefined) return;
      if (use.alias) {
        emit(
          "vocabulary-alias-target",
          line,
          `"${authored}" is an alias of "${use.canonical}" — write the canonical entry`,
          { ...details, canonical: use.canonical },
          evidence,
          `write "${use.canonical}"; the alias is accepted as input, never stored`,
        );
      }
      if (use.retired) {
        emit(
          "vocabulary-retired",
          line,
          `"${authored}" is retired${use.replaced_by === undefined ? "" : ` (replaced by: ${use.replaced_by.join(", ")})`}`,
          { ...details, canonical: use.canonical },
          evidence,
          "write one of the entries that replaced it, or un-retire the entry through review",
        );
      }
    };
    // docs/extending.md §A grammar: the item kinds this section's AUTHORS may write, read
    // off the grammar's own `admits` declaration. The kernel used to spell this
    // `role === "history"` and `kind === "claim" || kind === "entry"` — three
    // claims names in a loop that runs under every grammar.
    const admitted = admittedKinds(binding.grammar, binding.params, options.modules);
    // docs/extending.md §An arm: everything a registered arm may read. Narrow
    // on purpose — an arm speaks only by calling `emit`, and the severity comes
    // from the row its module declared, never from the arm.
    const ctx: ArmContext = {
      params: binding.params,
      section: { heading: binding.heading, line: section.line },
      emit,
      vocabularyLaws,
      vocabulary: (name) => options.vocabularies?.get(name),
      page: options.page ?? {},
      resolves: (name) => options.resolveTarget?.(name),
      chainOf: (name) => options.resolveTargetChain?.(name),
      concreteTypesUnder: (names) => options.concreteTypesUnder?.(names) ?? [],
    };
    // The arms this section's grammar registered, in declaration order.
    //
    // `needsBase` arms are skipped. This loop judges ONE revision and
    // has no base to compare against, so running one would emit a verdict from
    // half its input — which is what `not_applicable`, reason `no-base`, exists
    // to report instead (docs/extending.md §An arm). It was honoured where arms are
    // COUNTED and not where they RUN, which is the worst of both.
    const grammarArms = (options.modules.grammars.get(binding.grammar)?.arms ?? []).filter(
      (arm) => arm.needsBase !== true && armApplies(arm, binding.params),
    );
    // One context per arm, because the emit is scoped to the arm's OWN
    // id. A shared context hands every arm the same unrestricted `emit`, and the
    // row follows the id — so an arm declared `info` could emit under a kernel
    // `error` id and receive it. Removing the severity parameter was never
    // enough while the id was free.
    const ctxOf = new Map<string, ArmContext>();
    for (const arm of grammarArms) {
      ctxOf.set(arm.id, {
        ...ctx,
        emit: (id, line, message, details, evidence, remediation) => {
          if (id !== arm.id) {
            throw new Error(
              `arm "${arm.id}" emitted "${id}", which is not its own id — an arm may emit only the id it declared`,
            );
          }
          push(
            id,
            severityOf(arm.row, arm.severityDefault),
            line,
            message,
            details,
            evidence,
            remediation,
          );
        },
      });
    }
    /**
     * docs/extending.md §The determinism fixture: the blast radius of a stranger's bug is ONE
     * arm on ONE item. That loss was written down, and kit loading did not ship
     * without closing it: the refusals above still throw, because they
     * are exact and a module author must meet them, and the throw is caught
     * here and reported as an attributed `module-failure` rather than taking
     * the whole vault's verdict with it.
     *
     * The finding names the module, its version and the arm, because the point
     * of attribution is that the reader knows whose bug it is without bisecting.
     */
    const guarded = (arm: ArmSpec, line: number, run: () => void): void => {
      try {
        run();
      } catch (error) {
        const owner = options.modules.owners.get(`arm:${arm.id}`);
        const module = owner === undefined ? "?" : owner.module;
        const version = owner?.version;
        emit(
          "module-failure",
          line,
          `module "${module}"${version === undefined ? "" : `@${version}`} threw while running arm "${arm.id}": ${error instanceof Error ? error.message : String(error)}`,
          {
            module,
            arm: arm.id,
            section: binding.heading,
            ...(version === undefined ? {} : { version }),
          },
          `module-failure|${module}|${arm.id}|${line}`,
          "report the failure to the module's author; the pass it was running has no verdict on this page",
        );
      }
    };
    for (const item of section.items) {
      if (admitted !== undefined && item.kind !== "unparsed" && !admitted.includes(item.kind)) {
        // `items` is the allow-list a section declares. An item of a kind
        // it does not admit is not silently "not a claim" — it is the same
        // finding any unparsed top-level item gets. `unparsed` is excluded
        // because nothing parsed it: it is the branch below, under its own
        // message, and reporting it twice would be one defect counted twice.
        emit(
          "grammar-unparsed",
          item.line,
          `section "${binding.heading}" admits ${admitted.join(" and ")} items only`,
          { grammar: binding.grammar, section: binding.heading, kind: item.kind },
          item.raw,
          "write the item in one of the kinds the section declares, or widen `items` through review",
        );
        continue;
      }
      // docs/concepts.md §The judge and its states: the dialect a line is written in, counted. A
      // corpus writes 【】 markers and `:`/`-` entry separators and neither is a
      // defect — so this is `info`, and NOTHING in the engine rewrites it except
      // `fix --rule canonical-form`, which the operator names.
      const canonical = canonicalLineOf(item, options.modules);
      if (canonical !== undefined) {
        emit(
          "canonical-form",
          item.line,
          `the line's dialect differs from the engine's; the canonical form is "${canonical}"`,
          { canonical_line: canonical, section: binding.heading },
          `canonical-form|${item.raw}`,
          "`fix --rule canonical-form` is the one path that rewrites a dialect; nothing else may",
        );
      }
      // docs/extending.md §The determinism fixture: the item is `unparsed` because a module's
      // parse THREW, not because nothing claimed the line. Reported as the
      // module's failure, attributed, beside the unparsed finding — the page
      // still has a defect the author must see, and so does the module author.
      if (item.parseError !== undefined) {
        const owner = options.modules.owners.get(`grammar:${binding.grammar}`);
        const module = owner?.module ?? "?";
        emit(
          "module-failure",
          item.line,
          `module "${module}"${owner?.version === undefined ? "" : `@${owner.version}`} threw while parsing an item of the "${binding.grammar}" grammar: ${item.parseError}`,
          {
            module,
            grammar: binding.grammar,
            section: binding.heading,
            ...(owner?.version === undefined ? {} : { version: owner.version }),
          },
          `module-failure|${module}|${binding.grammar}|${item.line}`,
          "report the failure to the module's author; this item was not parsed by the grammar its section declares",
        );
      }
      if (item.kind === "unparsed") {
        emit(
          "grammar-unparsed",
          item.line,
          `top-level item does not parse under the "${binding.grammar}" grammar of section "${binding.heading}"`,
          { grammar: binding.grammar, section: binding.heading },
          item.raw,
          "write the item in the section's grammar, or move it to a prose section — the engine never silently skips a top-level item",
        );
        continue;
      }
      // docs/extending.md §An arm: the registered per-item arms. Their bodies live in
      // the module that declared them; this loop knows only that an arm exists.
      for (const arm of grammarArms) {
        if (arm.run === undefined) continue;
        guarded(arm, item.line, () => arm.run?.(item as never, ctxOf.get(arm.id) ?? ctx));
      }
    }
    // docs/extending.md §An arm: the aggregate arms, once per section, after every item
    // — a second entry point rather than an accumulator, so the per-item pass
    // above stays order-independent.
    for (const arm of grammarArms) {
      if (arm.runSection === undefined) continue;
      guarded(arm, section.line, () =>
        arm.runSection?.(section.items as never, ctxOf.get(arm.id) ?? ctx),
      );
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// dispositions (docs/concepts.md §Section grammar)

/**
 * docs/concepts.md §Section grammar: the counted outcomes of a page's transitions, keyed by the
 * disposition a transition arm counted — `corrected`, `superseded`,
 * `entry_mutated`, `relation_removed`, and whatever a kit's arm counts. Open by
 * construction: the counters are the modules' and the kernel sums them.
 */
export type Dispositions = Record<string, number>;

export function emptyDispositions(): Dispositions {
  return {};
}

export function addDispositions(into: Dispositions, from: Dispositions): void {
  for (const [disposition, n] of Object.entries(from))
    into[disposition] = (into[disposition] ?? 0) + n;
}
