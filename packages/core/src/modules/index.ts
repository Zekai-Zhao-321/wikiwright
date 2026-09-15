// docs/extending.md §What a module registers, docs/extending.md §A grammar, docs/extending.md §An arm,
// docs/extending.md — the registration API the standard library and a
// domain kit both go through.
//
// This module is the API and the registry. It knows what a grammar DECLARES; it
// knows nothing about claims, relations or entries, and a name from any of them
// appearing here is the failure `docs/architecture.md §The invariants` exists to catch.
import { z } from "zod";
import { fixerRegistered } from "../fixers/index.ts";
import { normalizeIdentity } from "../identity/index.ts";
import { KERNEL_LANES, PASS_TABLE, type PassRow } from "../passes/index.ts";

/**
 * docs/extending.md: what a grammar does to the lines it governs,
 * from a closed three-value set. The kernel computes both `body.lifecycle`
 * contradiction families from this word, so a kit's append-only grammar inherits
 * the refusals rather than meeting the double report they prevent.
 */
export type LifecycleEffect = "none" | "forbids-mutation" | "requires-rewrite";

/**
 * docs/extending.md §A grammar: how a parameter combines under
 * `extends`, as DATA from a closed set. A module supplying a comparison function
 * would be authoring a predicate, which the engine refuses.
 *
 * - `identity` — equal, or declared for the first time.
 * - `subset-only` — a child may narrow the value set, never widen it.
 * - `tighten-one-way` — an ordered pair: only `from → to` is legal.
 * - `keyed-bounds` — rows keyed by normalized identity (of a name, or of a
 *   name SET); lower rises, upper falls.
 */
export type ParamLaw =
  | "identity"
  | "subset-only"
  | { readonly tightenOneWay: readonly [from: string, to: string] }
  | {
      readonly keyedBounds: {
        readonly key: string;
        readonly lower: string;
        readonly upper: string;
      };
    };

/** Whether a child may be the first declaration site for a parameter. */
export type ParamIntroduction = "any-depth" | "with-grammar";

export interface ParamSpec {
  readonly introduction: ParamIntroduction;
  readonly law: ParamLaw;
  /**
   * docs/extending.md §A grammar: the values this parameter admits, as the
   * module's own schema. The kernel's section-entry schema types the keys it
   * owns and passes the rest through; a parameter's shape is the grammar's
   * business, which is what lets a kit declare one the kernel never heard of.
   */
  readonly value: z.ZodType;
  /**
   * The lifecycle effect declaring this parameter gives the section. `equals`
   * narrows it to one value — `lifecycle` is only append-only at
   * `"append-only"`, and `free` governs nothing.
   */
  readonly effect?: { readonly equals?: string; readonly effect: LifecycleEffect };
  /**
   * docs/constitution.md §Vocabularies: the values of this parameter NAME ENTRIES of a
   * vocabulary — the one the section bound with `vocabulary` when no
   * `vocabulary` is given here, else the fixed one named. `key` says the values
   * are rows and names the row property carrying the entry name(s). The kernel
   * resolves every name through the vocabulary's alias and retirement laws at
   * load (`sections-entry-unknown` / `-alias` / `-retired`) and reads nothing
   * else about the parameter.
   */
  readonly entries?: { readonly vocabulary?: string; readonly key?: string };
  /**
   * The parameters of the same grammar that may not be declared beside this
   * one. A section declaring both is `sections-params-exclusive` at load: the
   * grammar states which of its parameters contradict, the kernel only counts.
   */
  readonly excludes?: readonly string[];
}

/**
 * docs/extending.md §An arm: what turns this arm on. The kernel counts the
 * coverage block's per-pass declaration count from this rather than from a
 * grammar name it knows.
 */
export interface ArmSpec {
  readonly id: string;
  /** Absent: every section declaring this grammar. Present: only where the
   * parameter is declared, and — with `equals` — only at that value. */
  readonly on?: { readonly param: string; readonly equals?: string };
  /** Without a base this arm is `not_applicable` with reason `no-base`. */
  readonly needsBase?: true;
  /**
   * docs/concepts.md §Findings and routing: the pass-table row this arm emits under, and
   * therefore how the section's `severity` knob reaches it:
   *
   * - `declared` — the knob's to move; `warning` when the section authors none.
   * - `info` — a census row, `info` whatever the section says. A count is not a
   *   verdict, so the knob does not reach it.
   * - `error` — a law the section cannot quiet, like a vocabulary's own.
   *
   * The arm IS its row: `passRows` composes the kernel's table with one row per
   * registered arm, and nothing about a module's arm is restated in the kernel.
   */
  readonly row: ArmRow;
  /**
   * docs/concepts.md §Findings and routing: the kernel-registered fixer that executes this arm's
   * findings, by the name the fixer registry carries for this id. A module
   * registers no fixer — the splice law is the kernel's — it may only name one
   * the kernel already ships for its rule, and `loadModules` refuses any other.
   */
  readonly fixer?: string;
  /**
   * docs/constitution.md §Sections: does this arm GATE by default? Distinct from
   * `row: "error"`, which says the section cannot quiet the arm at all. This says
   * only that the undeclared default is `error`, which is what the one-way
   * severity ratchet compares an ancestor against. Do not merge the two: an arm
   * can gate by default and still be ratchetable, which is exactly
   * `claims-transition`.
   */
  readonly severityDefault?: "error";
  /**
   * docs/concepts.md §Findings and routing: the queue lane a non-info finding of this arm
   * routes to. Required for any row but `info` on an arm the kernel's own
   * `PASS_TABLE` does not carry — the routing law is `fix XOR queue`, and a
   * finding with neither was an unroutable throw in the middle of a vault.
   */
  readonly lane?: string;
  /**
   * docs/extending.md §An arm: the per-item predicate. Void — an arm communicates only
   * through `ctx.emit`, so it cannot choose a severity or reorder a finding.
   */
  readonly run?: (item: ItemFields & { line: number; raw: string }, ctx: ArmContext) => void;
  /**
   * The section-scoped predicate, for an arm that AGGREGATES — `relation-require`
   * counts labels across a section and cannot decide per item. A second entry
   * point rather than a mutable accumulator handed to `run`, so the per-item pass
   * stays order-independent.
   */
  readonly runSection?: (
    items: readonly (ItemFields & { line: number; raw: string })[],
    ctx: ArmContext,
  ) => void;
  /**
   * docs/extending.md §An arm: the predicate over TWO revisions of the section,
   * for a `needsBase` arm. The kernel parses both revisions under the one
   * parser, hands the items over, and carries findings and counts back; what a
   * removal, a landing or a correction MEANS is the grammar's. An arm declares
   * this or `run`/`runSection`, never both — a transition has no per-item pass.
   */
  readonly runTransition?: (ctx: TransitionContext) => void;
}

/** An item as a transition sees one: the module's fields under the kernel's line and raw. */
export type TransitionItem = ItemFields & { readonly line: number; readonly raw: string };

/**
 * docs/extending.md §An arm: everything a transition arm may read. The section's
 * items in the base revision and in the draft, any other declared section by
 * heading (a History section is another section), the same narrow facts a
 * per-item arm gets — and two ways to speak: `emit` a finding under its own id,
 * or `count` a disposition into the page's table (docs/concepts.md §Section grammar).
 */
export interface TransitionContext {
  readonly params: DeclaredParams;
  readonly section: { readonly heading: string; readonly line: number };
  readonly page: { readonly chain?: readonly string[]; readonly tags?: readonly string[] };
  readonly base: readonly TransitionItem[];
  readonly current: readonly TransitionItem[];
  /** Another declared section's items in both revisions; `undefined` where the type declares none by that heading. */
  sectionItems(
    heading: string,
  ):
    | { readonly base: readonly TransitionItem[]; readonly current: readonly TransitionItem[] }
    | undefined;
  vocabulary(name: string): VocabularyView | undefined;
  /** A finding under the arm's own id; `line` is the draft's, or absent for a removal. */
  emit(
    id: string,
    line: number | undefined,
    message: string,
    details: Record<string, string | number | boolean>,
    evidence: string,
    remediation?: string,
  ): void;
  /** docs/concepts.md §Section grammar: a counted outcome, summed into the page's table. */
  count(disposition: string, n?: number): void;
}

/**
 * docs/extending.md §A grammar: what a module returns for one item. Its own fields and its kind —
 * never `line`, `raw` or `rationale`, which the kernel attaches around them so
 * that a module cannot aim a splice at the wrong bytes (docs/concepts.md §The judge and its states).
 */
export type ItemFields = { readonly kind: string } & Record<string, unknown>;

/**
 * docs/extending.md §A grammar: everything a grammar may read while parsing one item. The section's
 * parameters, plus the declared source roots — the second because `claims`
 * decides the bare-path provenance form against them and they are
 * engine config, not a section parameter. Nothing else: not the page, the vault,
 * the constitution or the sibling items.
 */
export interface ParseContext {
  readonly params: DeclaredParams;
  /** `config/engine.json`'s `source_roots`; empty ⇒ the path form is off. */
  readonly sourceRoots: readonly string[];
}

export type GrammarParse = (text: string, ctx: ParseContext) => ItemFields | undefined;

/**
 * docs/extending.md §A grammar: an item kind belonging to ANOTHER grammar that this one hands off
 * to when its own parse declines, and the condition for handing off. The kernel
 * resolves `to` to its owning grammar and calls that grammar's parse, so no
 * module imports another.
 *
 * This is the module's capability, not the section's allow-list: `items` says
 * what a section's authors may write, and the two must not be read as one.
 */
export interface Delegation {
  readonly to: string;
  readonly on: { readonly param: string; readonly equals?: string };
}

/**
 * docs/extending.md §An arm: the key the kernel's diff matches a base
 * item to a draft item on. `undefined` for an item with no identity, which is
 * therefore never matched — and so is never reported as CHANGED rather than
 * replaced. The kernel compares the strings and reads nothing inside them.
 */
export type IdentityOf = (item: ItemFields & { readonly raw: string }) => string | undefined;

/**
 * docs/extending.md §An arm: whether a matched pair that differs is a
 * correction of wording rather than a change of substance. The kernel owns the
 * matching, the classification and the counters; a module owns what its own
 * items MEAN in a transition, because "the same fact, spelled better" is a
 * statement about a grammar and not about two strings.
 */
export type IsCorrection = (
  before: ItemFields & { readonly raw: string },
  after: ItemFields & { readonly raw: string },
) => boolean;

/**
 * docs/concepts.md §The judge and its states: the engine's own dialect for an item this grammar
 * authors. Returns the canonical LINE when the item's differs, `undefined` when
 * it does not. The kernel owns the `canonical-form` arm, its `info` row and its
 * remediation — the module owns only what its own item looks like when the
 * engine writes it, because that is a fact about a syntax and not about a
 * severity. A grammar that registers none has no dialect to count.
 */
export type Canonicalize = (item: ItemFields & { readonly raw: string }) => string | undefined;

/**
 * docs/extending.md §A grammar: the section parameter that names the item kinds a
 * section's AUTHORS may write, and the condition under which it is read.
 *
 * This is the `items` allow-list of constitution v3, declared rather than
 * hard-coded: the kernel used to spell it `role === "history"` and
 * `kind === "claim" || kind === "entry"`, three claims names in the state-arm
 * loop. It is NOT `delegates` — that is the module's capability, this is the
 * section author's restriction of it, and collapsing the two would silently
 * widen a history section that declares no `items`.
 */
export interface AdmitsSpec {
  /** The parameter carrying the admitted kinds, as an array of kind names. */
  readonly param: string;
  /** When present, the allow-list is read only where this condition holds. */
  readonly on?: { readonly param: string; readonly equals?: string };
}

export interface GrammarSpec {
  readonly params: Readonly<Record<string, ParamSpec>>;
  /**
   * docs/constitution.md §Vocabularies: the vocabulary this grammar's items are checked against.
   * A section that declares this grammar and binds another vocabulary is
   * `sections-vocabulary-kind` at load; a grammar that declares none is bound
   * to whatever the section names. A name no module registers is refused at
   * module load (`vocabulary-unknown`).
   */
  readonly vocabulary?: string;
  readonly arms: readonly ArmSpec[];
  /** The item kinds this grammar owns. `unparsed` is the kernel's and is refused. */
  readonly kinds: readonly string[];
  /**
   * docs/cli.md §type: the item's written form, in one line, as `type show --brief`
   * prints it beside the section's parameters. The grammar's own statement of
   * what an author writes; the kernel renders it and reads nothing in it.
   */
  readonly form?: string;
  readonly parse: GrammarParse;
  readonly delegates?: readonly Delegation[];
  /** docs/extending.md §An arm. Absent ⇒ this grammar's items have no
   * identity, so the kernel matches none of them and reports none as changed. */
  readonly identityOf?: IdentityOf;
  /** docs/extending.md §An arm. Absent ⇒ nothing is a correction, which
   * is the safe reading: an unrecognized edit is a change of substance. */
  readonly isCorrection?: IsCorrection;
  /** docs/concepts.md §The judge and its states: this grammar's canonical rendering of its own item. */
  readonly canonicalize?: Canonicalize;
  /** docs/extending.md §A grammar: the section parameter restricting which kinds may be written. */
  readonly admits?: AdmitsSpec;
  /**
   * docs/constitution.md §Vocabularies: which values of a REGISTERED vocabulary this
   * item authored. The census (`vocabulary census`, `observeVocabulary`) walks
   * pages and counts authored names; before this it did so by branching on
   * `"relations"` / `"categories"` / `"sources"` and then reading `item.label`,
   * `item.category` and `item.provenance.source` — one module's field names in
   * a kernel loop, and a kit's vocabulary invisible to its own census.
   *
   * Called with the vocabulary's registered name; an item that authored none of
   * that vocabulary's values returns the empty array.
   */
  readonly observes?: (
    vocabulary: string,
    item: ItemFields & { readonly raw: string },
  ) => readonly string[];
  /**
   * docs/concepts.md §Generated artifacts: the page references this item declares, each with the
   * label the edge carries. The kernel resolves the target, drops what does not
   * resolve, sorts and dedupes; the edge's kind is the item's kind. Absent ⇒ the
   * grammar's items contribute no edges (their wikilinks still do, as
   * wikilinks). An unlabelled edge is a wikilink, which the kernel already has —
   * so `label` is required.
   */
  readonly edges?: (
    item: ItemFields & { readonly raw: string },
  ) => readonly { readonly to: string; readonly label: string }[];
}

/**
 * docs/extending.md: every schema a module supplies is typed as
 * `z.ZodType` — the standard library and a TypeScript kit get real inference
 * from it — but the ENGINE calls only `safeParse`, and reads `.shape` only to
 * enumerate a vocabulary's own entry keys. A kit written in plain JavaScript
 * supplies an object with a `safeParse` and loads the same way.
 */
/**
 * : call a module's schema without letting it
 * end the load. A schema is module code and may throw; before this, one that did
 * crashed `loadConstitution` with the module's own message and nothing saying
 * whose it was. A throw becomes a REFUSAL of the value, which is the same
 * direction every other module-failure guard takes: a module's bug makes the
 * engine stricter, never quieter.
 */
export function safeParseModule(
  schema: { safeParse(value: unknown): unknown },
  value: unknown,
  what: string,
):
  | { success: true; data: unknown }
  | { success: false; issues: { path: string[]; message: string }[] } {
  let result: unknown;
  try {
    result = schema.safeParse(value);
  } catch (error) {
    return {
      success: false,
      issues: [
        {
          path: [],
          message: `${what}: the module's own schema threw — ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }
  const parsed = result as
    | { success: true; data: unknown }
    | { success: false; error?: { issues?: { path?: unknown[]; message?: string }[] } };
  if (parsed.success === true) return { success: true, data: parsed.data };
  const issues = (parsed.error?.issues ?? []).map((issue) => ({
    path: (issue.path ?? []).map((segment) => String(segment)),
    message: issue.message ?? "invalid",
  }));
  return {
    success: false,
    issues: issues.length > 0 ? issues : [{ path: [], message: "invalid" }],
  };
}

/**
 * docs/extending.md §What a module registers: a vocabulary, with the entry schema its
 * OWN properties are validated by. The four every vocabulary shares —
 * `description`, `aliases`, `status`, `replaced_by` — are the kernel's, because
 * the alias and retirement laws are judged outside any section
 * (docs/constitution.md §Vocabularies). Everything else on an entry is
 * this schema's, and the kernel reads none of it.
 */
export interface VocabularySpec {
  /**
   * The properties an entry of this vocabulary carries beyond the shared four.
   * A zod object; the kernel merges it with its own base and refuses a property
   * neither side declares, naming the vocabulary that does own it.
   */
  readonly entry?: z.ZodType;
  /** `registered` may not be relaxed to `census` by a bundle (docs/extending.md §The manifest). */
  readonly mode?: "registered" | "census";
  /**
   * docs/extending.md §What a module registers: entries this module ships, in the shape a
   * bundle's own take — the shared four plus this vocabulary's properties,
   * validated by the same schema at load. A bundle that declares the vocabulary
   * gets them beside its own; it may add entries and may not re-declare one.
   * The standard library ships none: its vocabularies are the bundle's to fill.
   */
  readonly entries?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  /**
   * Dotted paths into an entry whose value — a name or a list of names — must
   * name a registered type; `vocabulary-type-ref-unknown` at load otherwise.
   * The kernel validates that the NAME resolves, which is a kernel question,
   * and reads nothing else about the property. A kit's own type-valued
   * property gets the same check by declaring the path.
   */
  readonly typeRefs?: readonly string[];
  /** As `typeRefs`, against the `tags` vocabulary: `vocabulary-tag-ref-unknown`. */
  readonly tagRefs?: readonly string[];
}

/** docs/extending.md §What a module registers: where a check may be attached. */
export type CheckSurface = "type" | "fragment" | "field" | "section";

/**
 * docs/extending.md §What a module registers: a predicate a BUNDLE attaches, with the
 * configuration schema its attachment is validated against. A bundle selects
 * from a closed set of registered checks and configures the one it selected,
 * rather than authoring a predicate — which the engine refuses.
 */
export interface CheckSpec {
  /** The attachment's `config`, validated at LOAD. A check with no knobs takes `z.strictObject({})`. */
  readonly config: z.ZodType;
  /** The surfaces this check may be attached to; an attachment elsewhere is a load error. */
  readonly surfaces: readonly CheckSurface[];
  /** docs/concepts.md §Findings and routing: the row this check's findings emit under. */
  readonly row: ArmRow;
  /** docs/concepts.md §Findings and routing: the queue lane a non-info finding routes to. */
  readonly lane?: string;
  /** Without a base this check is `not_applicable` with reason `no-base`. */
  readonly needsBase?: true;
  readonly run: (ctx: CheckContext) => void;
}

/**
 * docs/extending.md §An arm: what a check may read. The same posture as
 * `ArmContext` — facts the kernel already computed about the page being judged,
 * and no capability. A check never chooses a severity: `emit` writes the check's
 * own id, and the row it declared plus the attachment's knob decide.
 */
export interface CheckContext {
  /** The attachment's configuration, already validated by the check's own schema. */
  readonly config: Readonly<Record<string, unknown>>;
  readonly page: {
    readonly path: string;
    readonly frontmatter: Readonly<Record<string, unknown>>;
    readonly body: string;
    readonly chain?: readonly string[];
    readonly tags?: readonly string[];
  };
  /** Present for a `field` attachment: the field this check was attached to. */
  readonly field?: { readonly name: string; readonly value: unknown; readonly line?: number };
  /** Present for a `section` attachment: the section's heading, line and parameters. */
  readonly section?: {
    readonly heading: string;
    readonly line: number;
    readonly params: DeclaredParams;
    readonly items: readonly (ItemFields & { line: number; raw: string })[];
  };
  /** The base revision's bytes, for a `needsBase` check; absent ⇒ it never runs. */
  readonly baseText?: string;
  emit(
    line: number | undefined,
    message: string,
    details: Record<string, string | number | boolean>,
    evidence: string,
    remediation?: string,
  ): void;
  resolves(name: string): boolean | undefined;
  chainOf(name: string): readonly string[] | undefined;
}

/**
 * docs/cli.md §brief: a paragraph a module contributes to the
 * generated brief, so an agent working a kit's bundle is told what the kit's
 * grammar means. Rendered in module load order under the module's own heading.
 */
export interface SkillFragment {
  readonly heading: string;
  readonly body: string;
}

export interface ModuleManifest {
  /** Bare for the standard library; `<vendor>/<name>` for a kit (docs/extending.md §The manifest). */
  readonly id: string;
  /** docs/extending.md §Declaring a module: the version a finding is attributed to. */
  readonly version?: string;
  /** Every key but `id` is optional: a kit that registers only declarations is a module. */
  readonly grammars?: Readonly<Record<string, GrammarSpec>>;
  /** docs/extending.md §What a module registers: the vocabularies this module owns. */
  readonly vocabularies?: Readonly<Record<string, VocabularySpec>>;
  /** docs/extending.md §What a module registers: the checks a bundle may attach. */
  readonly checks?: Readonly<Record<string, CheckSpec>>;
  /** docs/concepts.md §Findings and routing: the queue lanes this module's findings route to. */
  readonly lanes?: readonly string[];
  /** docs/extending.md §What a module registers: plain constitution data. */
  readonly fragments?: Readonly<Record<string, unknown>>;
  readonly types?: Readonly<Record<string, unknown>>;
  readonly templates?: Readonly<Record<string, string>>;
  readonly skills?: readonly SkillFragment[];
  /**
   * docs/constitution.md §Vocabularies: entries this module CONTRIBUTES to a vocabulary
   * another module registered — vocabulary name → entry name → the entry, in
   * the shape a bundle's own take. A kit's relation labels are its domain
   * model, and the vocabulary they belong to is the standard library's. The
   * kernel merges every module's contributions with the bundle's own entries
   * and validates the constitution against the MERGED set; a name two
   * contributors both ship is refused at load naming both.
   */
  readonly entries?: Readonly<
    Record<string, Readonly<Record<string, Readonly<Record<string, unknown>>>>>
  >;
}

/** The one constructor, so a manifest is a checked shape rather than a literal. */
export function defineModule(manifest: ModuleManifest): ModuleManifest {
  return manifest;
}

export function defineVocabulary(vocabulary: VocabularySpec): VocabularySpec {
  return vocabulary;
}

export function defineCheck(check: CheckSpec): CheckSpec {
  return check;
}

export function defineGrammar(grammar: GrammarSpec): GrammarSpec {
  return grammar;
}

export function defineArm(arm: ArmSpec): ArmSpec {
  return arm;
}

export type ArmRow = "declared" | "info" | "error";

/**
 * docs/concepts.md §Findings and routing: the severity every `declared` arm emits when
 * the section authors no `severity`.
 */
export const DECLARED_ARM_DEFAULT = "warning" as const;

/**
 * docs/concepts.md §Findings and routing: the severity a row emits when the section authors none.
 * DERIVED, so a second field beside `row` cannot drift from it.
 */
export function armDefault(row: ArmRow): "error" | "warning" | "info" {
  return row === "declared" ? DECLARED_ARM_DEFAULT : row;
}

/**
 * docs/extending.md §An arm: the arms `checkGrammar` emits ITSELF, under the
 * kernel's own rows, because each is a property of the item envelope, of a
 * vocabulary's own registration, or of a module having thrown — never of any
 * grammar. A module declaring one of these ids is refused at load: a
 * module that could re-row `canonical-form` could make a census line an error
 * the section cannot quiet, and one that could re-row `module-failure` could
 * quiet its own crash.
 *
 * `grammar-unparsed` fires wherever a top-level item does not parse under
 * WHATEVER grammar its section declared, and `canonical-form` compares the raw
 * line with the engine's rendering of the same item — both before any
 * grammar-specific branch — so both are counted over every non-prose binding.
 * The two vocabulary laws are LAW rows judged at the site that authored the
 * value, outside any section's ratchet (docs/constitution.md §Vocabularies).
 */
export const KERNEL_OWNED_ARMS: readonly string[] = [
  "grammar-unparsed",
  "module-failure",
  "canonical-form",
  "vocabulary-alias-target",
  "vocabulary-retired",
];

/** A kernel-owned arm's row, read off the one table; an engine defect if absent. */
function kernelArmRow(id: string): ArmRow {
  const row = PASS_TABLE.find((r) => r.id === id);
  if (row === undefined || row.severity === "warning") {
    throw new Error(`kernel-owned arm "${id}" has no arm row in PASS_TABLE`);
  }
  return row.severity;
}

/**
 * Every arm row that governs this vault: the kernel's five, read off the pass
 * table, plus the row each loaded module declared for its own arms. A module
 * cannot overwrite a kernel row — `loadModules` refuses the id — so the seeding
 * order here is not load-bearing and the composed view has one answer per id.
 */
export function armRows(modules: ModuleRegistry): ReadonlyMap<string, ArmRow> {
  const rows = new Map<string, ArmRow>(KERNEL_OWNED_ARMS.map((id) => [id, kernelArmRow(id)]));
  for (const [id, arm] of modules.arms) rows.set(id, arm.row);
  return rows;
}

/**
 * docs/concepts.md §Findings and routing: the table a vault is judged under — the kernel's rows plus
 * one row per registered arm and check, each read off the manifest that
 * declared it. Routing, the coverage block, the per-page waiver and the
 * generated playbook all read this and never the kernel's table alone, so a
 * kit's arm gets a route and a coverage row without the kernel learning a name.
 */
export function passRows(modules: ModuleRegistry): readonly PassRow[] {
  const rows: PassRow[] = [...PASS_TABLE];
  for (const [id, arm] of modules.arms) {
    const row: PassRow = { id, kind: "type-declared", severity: arm.row };
    if (arm.fixer !== undefined) row.fixer = arm.fixer;
    if (arm.lane !== undefined) row.lane = arm.lane;
    if (arm.needsBase === true) row.needsBase = true;
    rows.push(row);
  }
  for (const [id, check] of modules.checks) {
    const row: PassRow = { id, kind: "type-declared", severity: check.row };
    if (check.lane !== undefined) row.lane = check.lane;
    if (check.needsBase === true) row.needsBase = true;
    rows.push(row);
  }
  return rows;
}

/** The kernel-owned arms counted over every non-prose binding, not over one grammar. */
export const ENVELOPE_ARMS: readonly string[] = ["grammar-unparsed", "canonical-form"];

/**
 * docs/extending.md §A grammar: the item kinds no module may claim. `unparsed`
 * is what an item becomes when NOTHING parsed it, and it is the sole input of the
 * kernel-owned `grammar-unparsed` arm. The other four are the kernel's own EDGE
 * kinds (docs/concepts.md §Generated artifacts): a module's edge is keyed by its item's kind, so
 * an item kind named `wikilink` would put a module's edges under the kernel's.
 */
export const KERNEL_EDGE_KINDS: readonly string[] = ["cites", "supersedes", "tagged", "wikilink"];
export const KERNEL_OWNED_KINDS: readonly string[] = ["unparsed", ...KERNEL_EDGE_KINDS];

/** One vocabulary entry a module shipped, attributed. */
export interface ContributedEntry {
  readonly value: Readonly<Record<string, unknown>>;
  readonly module: string;
}

export interface ModuleRegistry {
  /** grammar id → the module that registered it. */
  readonly grammarOwner: ReadonlyMap<string, string>;
  readonly grammars: ReadonlyMap<string, GrammarSpec>;
  /** item kind → the grammar that owns it, so the kernel can resolve a delegation. */
  readonly kindOwner: ReadonlyMap<string, string>;
  /** arm id → the grammar it belongs to. */
  readonly armGrammar: ReadonlyMap<string, string>;
  readonly arms: ReadonlyMap<string, ArmSpec>;
  /** docs/extending.md §What a module registers: vocabulary name → its registration. */
  readonly vocabularies: ReadonlyMap<string, VocabularySpec>;
  /**
   * docs/constitution.md §Vocabularies: vocabulary name → entry name → the entry a module
   * shipped and which module. One map for the owner's own `entries` and every
   * other module's contributions, so the bundle's entries meet ONE merged set.
   */
  readonly entries: ReadonlyMap<string, ReadonlyMap<string, ContributedEntry>>;
  /** docs/extending.md §What a module registers: check id → its registration. */
  readonly checks: ReadonlyMap<string, CheckSpec>;
  /** docs/concepts.md §Findings and routing: every lane a finding of this vault may route to. */
  readonly lanes: ReadonlySet<string>;
  /** docs/extending.md §What a module registers: the constitution data modules contribute. */
  readonly fragments: ReadonlyMap<string, unknown>;
  readonly types: ReadonlyMap<string, unknown>;
  readonly templates: ReadonlyMap<string, string>;
  readonly skills: readonly (SkillFragment & { readonly module: string })[];
  /** docs/extending.md §The determinism fixture: which module registered each id, and at which version. */
  readonly owners: ReadonlyMap<string, { readonly module: string; readonly version?: string }>;
}

/**
 * docs/constitution.md §Vocabularies: how an authored value resolved against its vocabulary. The
 * kernel's, because the two vocabulary laws are judged at the site that authored
 * the value, outside any section's ratchet.
 */
export interface VocabularyUse {
  canonical: string;
  alias: boolean;
  retired: boolean;
  replaced_by?: readonly string[];
}

/**
 * docs/extending.md §An arm: one vocabulary as an arm sees it, keyed
 * by the vocabulary's REGISTERED NAME rather than by a field per vocabulary on a
 * kernel struct. `entries` hands back the module's own entry shape — `range` is
 * relations', `owned_by` is claims' — and the kernel reads none of it.
 */
export interface VocabularyView {
  readonly mode: string;
  readonly entries: ReadonlyMap<string, Readonly<Record<string, unknown>>>;
  /** Every name an author may write — canonical AND alias — to its resolution. */
  readonly uses: ReadonlyMap<string, VocabularyUse>;
}

/**
 * docs/extending.md §An arm: everything an arm may read. Narrow on purpose: no finding
 * array, no severity table, no routing decision, no coverage counter. An arm
 * speaks only by calling `emit`, and the kernel resolves the severity from the
 * arm's declared row and the section's knob.
 */
export interface ArmContext {
  readonly params: DeclaredParams;
  readonly section: { readonly heading: string; readonly line: number };
  emit(
    id: string,
    line: number,
    message: string,
    details: Record<string, string | number | boolean>,
    evidence: string,
    remediation?: string,
  ): void;
  /** docs/constitution.md §Vocabularies, judged by the kernel for the module. */
  vocabularyLaws(
    use: VocabularyUse | undefined,
    authored: string,
    line: number,
    details: Record<string, string | number | boolean>,
    evidence: string,
  ): void;
  vocabulary(name: string): VocabularyView | undefined;
  /** The page being judged: its `extends` chain and its tags, for a negative selector. */
  readonly page: { readonly chain?: readonly string[]; readonly tags?: readonly string[] };
  /** Does this page name resolve to a page? A kernel question, not a grammar's. */
  resolves(name: string): boolean | undefined;
  /** The target's `extends` chain, nearest first. Kernel identity, kernel index. */
  chainOf(name: string): readonly string[] | undefined;
  /**
   * The concrete registered types — active, not abstract — whose `extends`
   * chain reaches one of `names`, in code-unit order. A kit's abstract type
   * names no page; this is what a page can carry in its place.
   */
  concreteTypesUnder(names: readonly string[]): readonly string[];
}

/**
 * docs/extending.md §The manifest: every identifier the ENGINE emits under, which no
 * module may claim — the whole kernel table. An arm declaring one of these ids
 * would be routed by that id's row, fixer included: an arm on
 * `missing-required-field` would be handed the `frontmatter-set` FIXER, and
 * `docs/concepts.md §The judge and its states` is a kernel guarantee. The kernel's table carries no
 * module's row, so the reservation is the table and needs no marker.
 */
export const KERNEL_RESERVED_IDS: ReadonlySet<string> = new Set(PASS_TABLE.map((row) => row.id));

/**
 * docs/extending.md §A check: `prose` is the kernel's own grammar — "no module registers it
 * and it parses nothing". A module that registered it would take over every
 * prose section of every bundle that loads the module, silently, because a prose
 * section declares no parameters for anyone to notice a change in.
 */
export const KERNEL_OWNED_GRAMMARS: readonly string[] = ["prose"];

/**
 * docs/constitution.md §Vocabularies: the vocabulary the KERNEL owns. `tags` is read by
 * folder alignment, the catalog and the frontmatter closure — outside any
 * section and under every grammar — so it belongs to no module, and no module
 * may claim it. `requires_link` is its one own property.
 */
export const KERNEL_VOCABULARIES: Readonly<Record<string, VocabularySpec>> = {
  tags: {
    mode: "registered",
    entry: z.strictObject({
      // A page carrying this tag must link the named page — the one
      // editorial power a tag entry carries.
      requires_link: z.string().min(1).optional(),
    }),
  },
};

export interface RegistryConflict {
  /**
   * `kind-reserved` is the one conflict with a single claimant: `unparsed` is
   * what an item BECOMES when no grammar claimed it, so a grammar that produced
   * one would be reporting the kernel's own finding under its own name.
   */
  readonly kind:
    | "grammar"
    | "grammar-reserved"
    | "arm"
    | "arm-reserved"
    | "arm-fixer-unknown"
    | "arm-base-mismatch"
    | "arm-lane-missing"
    | "applicability-unknown-param"
    | "kind"
    | "kind-reserved"
    | "delegate-unknown"
    | "vocabulary"
    | "vocabulary-reserved"
    | "check"
    | "check-reserved"
    | "check-surfaces-missing"
    | "check-lane-missing"
    | "lane"
    | "lane-unknown"
    | "vocabulary-unknown"
    | "excludes-unknown-param"
    | "manifest-key"
    | "manifest-key-unknown"
    | "entry"
    | "fragment"
    | "type"
    | "template";
  readonly id: string;
  readonly claimants: readonly string[];
}

export type ModuleLoad =
  | { readonly ok: true; readonly registry: ModuleRegistry }
  | { readonly ok: false; readonly conflicts: readonly RegistryConflict[] };

/**
 * docs/extending.md §The manifest: two modules declaring one identifier is a load error, raised
 * BEFORE any module code runs — which is why this function takes manifests and
 * not modules.
 */
/**
 * docs/extending.md §The manifest: every key a manifest may carry, with the shape it
 * must have. Only `id` is required — a kit that ships declarations and no
 * grammar is a module — and a key of the wrong shape, or one the manifest
 * format does not know, is refused BY NAME before anything reads it.
 */
const MANIFEST_KEYS: Readonly<Record<string, "string" | "object" | "array">> = {
  id: "string",
  version: "string",
  grammars: "object",
  vocabularies: "object",
  checks: "object",
  lanes: "array",
  fragments: "object",
  types: "object",
  templates: "object",
  skills: "array",
  entries: "object",
};

function manifestConflicts(manifest: ModuleManifest): RegistryConflict[] {
  const conflicts: RegistryConflict[] = [];
  const record = manifest as unknown as Record<string, unknown>;
  const claimant = typeof record["id"] === "string" ? record["id"] : "?";
  if (typeof record["id"] !== "string" || record["id"].length === 0) {
    conflicts.push({ kind: "manifest-key", id: "id", claimants: [claimant] });
  }
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined || key === "id") continue;
    const expected = MANIFEST_KEYS[key];
    if (expected === undefined) {
      conflicts.push({ kind: "manifest-key-unknown", id: key, claimants: [claimant] });
      continue;
    }
    const actual = Array.isArray(value)
      ? "array"
      : value !== null && typeof value === "object"
        ? "object"
        : typeof value;
    if (actual !== expected)
      conflicts.push({ kind: "manifest-key", id: key, claimants: [claimant] });
  }
  return conflicts;
}

export function loadModules(manifests: readonly ModuleManifest[]): ModuleLoad {
  // A malformed manifest is refused by key before any of it is read —
  // the alternative is a crash inside the loader attributed to nothing.
  const malformed = manifests.flatMap(manifestConflicts);
  if (malformed.length > 0) return { ok: false, conflicts: malformed };
  const grammarOwner = new Map<string, string>();
  const grammars = new Map<string, GrammarSpec>();
  const kindOwner = new Map<string, string>();
  const armGrammar = new Map<string, string>();
  const arms = new Map<string, ArmSpec>();
  const vocabularies = new Map<string, VocabularySpec>(Object.entries(KERNEL_VOCABULARIES));
  const entries = new Map<string, Map<string, ContributedEntry>>();
  const checks = new Map<string, CheckSpec>();
  const lanes = new Set<string>(KERNEL_LANES);
  const fragments = new Map<string, unknown>();
  const types = new Map<string, unknown>();
  const templates = new Map<string, string>();
  const skills: (SkillFragment & { module: string })[] = [];
  const owners = new Map<string, { module: string; version?: string }>();
  const conflicts: RegistryConflict[] = [];

  const own = (id: string, manifest: ModuleManifest): void => {
    const record: { module: string; version?: string } = { module: manifest.id };
    if (manifest.version !== undefined) record.version = manifest.version;
    owners.set(id, record);
  };

  // docs/concepts.md §Findings and routing: every lane first, because an arm or a check
  // declared later may name one and the manifests are not ordered.
  for (const manifest of manifests) {
    for (const lane of manifest.lanes ?? []) {
      if (KERNEL_LANES.includes(lane)) {
        conflicts.push({ kind: "lane", id: lane, claimants: ["kernel", manifest.id] });
        continue;
      }
      if (lanes.has(lane)) {
        conflicts.push({
          kind: "lane",
          id: lane,
          claimants: [owners.get(`lane:${lane}`)?.module ?? "?", manifest.id],
        });
        continue;
      }
      lanes.add(lane);
      own(`lane:${lane}`, manifest);
    }
  }

  for (const manifest of manifests) {
    // docs/constitution.md §Vocabularies: a vocabulary before the grammars that read it,
    // and `tags` is the kernel's — a module claiming it would re-shape the one
    // vocabulary read outside every section.
    for (const [name, vocabulary] of Object.entries(manifest.vocabularies ?? {})) {
      if (Object.hasOwn(KERNEL_VOCABULARIES, name)) {
        conflicts.push({ kind: "vocabulary-reserved", id: name, claimants: [manifest.id] });
        continue;
      }
      const prior = owners.get(`vocabulary:${name}`)?.module;
      if (prior !== undefined) {
        conflicts.push({ kind: "vocabulary", id: name, claimants: [prior, manifest.id] });
        continue;
      }
      vocabularies.set(name, vocabulary);
      own(`vocabulary:${name}`, manifest);
    }

    // docs/extending.md §What a module registers: a check declares its surfaces, its
    // row, and — where the row is not a census — the lane its findings queue to.
    for (const [id, check] of Object.entries(manifest.checks ?? {})) {
      // A check emits its own id and routes through the same table, so
      // the same reservation holds for it.
      if (KERNEL_RESERVED_IDS.has(id)) {
        conflicts.push({ kind: "check-reserved", id, claimants: [manifest.id] });
        continue;
      }
      if (check.surfaces.length === 0) {
        conflicts.push({ kind: "check-surfaces-missing", id, claimants: [manifest.id] });
        continue;
      }
      if (check.row !== "info" && check.lane === undefined) {
        conflicts.push({ kind: "check-lane-missing", id, claimants: [manifest.id] });
        continue;
      }
      if (check.lane !== undefined && !lanes.has(check.lane)) {
        conflicts.push({ kind: "lane-unknown", id: check.lane, claimants: [manifest.id] });
        continue;
      }
      const prior = owners.get(`check:${id}`)?.module;
      if (prior !== undefined) {
        conflicts.push({ kind: "check", id, claimants: [prior, manifest.id] });
        continue;
      }
      checks.set(id, check);
      own(`check:${id}`, manifest);
    }

    // docs/extending.md §What a module registers: plain constitution data. Collisions
    // are refused here, before the document that would carry them is built.
    for (const [name, fragment] of Object.entries(manifest.fragments ?? {})) {
      const prior = owners.get(`fragment:${name}`)?.module;
      if (prior !== undefined) {
        conflicts.push({ kind: "fragment", id: name, claimants: [prior, manifest.id] });
        continue;
      }
      fragments.set(name, fragment);
      own(`fragment:${name}`, manifest);
    }
    for (const [name, type] of Object.entries(manifest.types ?? {})) {
      const prior = owners.get(`type:${name}`)?.module;
      if (prior !== undefined) {
        conflicts.push({ kind: "type", id: name, claimants: [prior, manifest.id] });
        continue;
      }
      types.set(name, type);
      own(`type:${name}`, manifest);
    }
    for (const [name, template] of Object.entries(manifest.templates ?? {})) {
      const prior = owners.get(`template:${name}`)?.module;
      if (prior !== undefined) {
        conflicts.push({ kind: "template", id: name, claimants: [prior, manifest.id] });
        continue;
      }
      templates.set(name, template);
      own(`template:${name}`, manifest);
    }
    for (const fragment of manifest.skills ?? []) {
      skills.push({ ...fragment, module: manifest.id });
    }

    for (const [name, grammar] of Object.entries(manifest.grammars ?? {})) {
      if (KERNEL_OWNED_GRAMMARS.includes(name)) {
        conflicts.push({ kind: "grammar-reserved", id: name, claimants: [manifest.id] });
        continue;
      }
      const prior = grammarOwner.get(name);
      if (prior !== undefined) {
        conflicts.push({ kind: "grammar", id: name, claimants: [prior, manifest.id] });
        continue;
      }
      grammarOwner.set(name, manifest.id);
      grammars.set(name, grammar);
      own(`grammar:${name}`, manifest);
      const declaredParamNames = new Set(Object.keys(grammar.params));
      // A parameter's `excludes` names other parameters of the same grammar,
      // or the exclusion can never fire — a disabled law that loads as one.
      for (const [param, spec] of Object.entries(grammar.params)) {
        for (const excluded of spec.excludes ?? []) {
          if (excluded === param || !declaredParamNames.has(excluded)) {
            conflicts.push({ kind: "excludes-unknown-param", id: excluded, claimants: [name] });
          }
        }
      }
      // docs/extending.md: a delegation's condition names a
      // parameter its grammar declares, or it can never be met — a disabled
      // hand-off that reports as an enabled one.
      for (const delegation of grammar.delegates ?? []) {
        if (!declaredParamNames.has(delegation.on.param)) {
          conflicts.push({
            kind: "applicability-unknown-param",
            id: delegation.on.param,
            claimants: [name],
          });
        }
      }
      // The same rule for the allow-list's condition and its parameter.
      if (grammar.admits !== undefined) {
        for (const param of [
          grammar.admits.param,
          ...(grammar.admits.on === undefined ? [] : [grammar.admits.on.param]),
        ]) {
          if (!declaredParamNames.has(param)) {
            conflicts.push({
              kind: "applicability-unknown-param",
              id: param,
              claimants: [name],
            });
          }
        }
      }
      for (const kind of grammar.kinds) {
        if (KERNEL_OWNED_KINDS.includes(kind)) {
          conflicts.push({ kind: "kind-reserved", id: kind, claimants: [name] });
          continue;
        }
        const holder = kindOwner.get(kind);
        if (holder !== undefined) {
          conflicts.push({ kind: "kind", id: kind, claimants: [holder, name] });
          continue;
        }
        kindOwner.set(kind, name);
        own(`kind:${kind}`, manifest);
      }
      for (const arm of grammar.arms) {
        // The kernel's ids are its own, and the
        // kernel's ids are the WHOLE pass table — not the four envelope arms.
        // An arm on an engine id would be routed by that id's row, fixer
        // included.
        if (KERNEL_RESERVED_IDS.has(arm.id)) {
          conflicts.push({ kind: "arm-reserved", id: arm.id, claimants: [name] });
          continue;
        }
        // docs/extending.md §An arm: a transition runs against a base and a
        // per-item pass runs without one, so an arm is one or the other. A
        // `needsBase` arm with `run` never ran (the state-arm loop skips it)
        // and a `runTransition` without `needsBase` read `evaluated` on a page
        // it never saw — both silent, both refused here.
        const transitional = arm.runTransition !== undefined;
        const perItem = arm.run !== undefined || arm.runSection !== undefined;
        if ((transitional && arm.needsBase !== true) || (perItem && arm.needsBase === true)) {
          conflicts.push({ kind: "arm-base-mismatch", id: arm.id, claimants: [name] });
          continue;
        }
        // docs/concepts.md §Findings and routing: a module registers no fixer, so the one it names
        // must be a fixer the kernel already ships for THIS id — otherwise the
        // row would print a route the verb refuses.
        if (arm.fixer !== undefined && !fixerRegistered(arm.fixer, arm.id)) {
          conflicts.push({ kind: "arm-fixer-unknown", id: arm.id, claimants: [name] });
          continue;
        }
        // A finding that is not a census must route somewhere, and the
        // routing law is `fix XOR queue` (docs/concepts.md §Findings and routing). An arm's row is its
        // own, so its lane is declared here, or its first finding is an
        // unroutable throw in the middle of a vault.
        if (arm.row !== "info" && arm.lane === undefined) {
          conflicts.push({ kind: "arm-lane-missing", id: arm.id, claimants: [name] });
          continue;
        }
        if (arm.lane !== undefined && !lanes.has(arm.lane)) {
          conflicts.push({ kind: "lane-unknown", id: arm.lane, claimants: [name] });
          continue;
        }
        // The same rule a delegation gets. A condition naming a
        // parameter the grammar does not declare is never met, so the arm loads
        // clean and silently never applies.
        if (arm.on !== undefined && !declaredParamNames.has(arm.on.param)) {
          conflicts.push({
            kind: "applicability-unknown-param",
            id: arm.on.param,
            claimants: [name],
          });
          continue;
        }
        const owner = armGrammar.get(arm.id);
        if (owner !== undefined) {
          conflicts.push({ kind: "arm", id: arm.id, claimants: [owner, name] });
          continue;
        }
        armGrammar.set(arm.id, name);
        arms.set(arm.id, arm);
        own(`arm:${arm.id}`, manifest);
      }
    }
  }
  // After every grammar is in, so a delegation may name a kind registered later.
  for (const [name, grammar] of grammars) {
    for (const delegation of grammar.delegates ?? []) {
      if (!kindOwner.has(delegation.to))
        conflicts.push({ kind: "delegate-unknown", id: delegation.to, claimants: [name] });
    }
    // docs/constitution.md §Vocabularies: a grammar, or a parameter, that names the vocabulary
    // its values are checked against names one some module registered — read
    // after every manifest is in, because a kit's vocabulary may be declared
    // by a manifest after its grammar's.
    const named = [
      ...(grammar.vocabulary === undefined ? [] : [grammar.vocabulary]),
      ...Object.values(grammar.params).flatMap((spec) =>
        spec.entries?.vocabulary === undefined ? [] : [spec.entries.vocabulary],
      ),
    ];
    for (const vocabulary of named) {
      if (!vocabularies.has(vocabulary)) {
        conflicts.push({ kind: "vocabulary-unknown", id: vocabulary, claimants: [name] });
      }
    }
  }
  // docs/constitution.md §Vocabularies: every entry a module ships — the owner's own
  // `entries` and any module's contributions — into ONE map per vocabulary,
  // after every vocabulary is registered so a kit may contribute to one a
  // later manifest declares. A name shipped twice is two laws with one name,
  // refused naming both contributors; a bundle's own entries meet the merged
  // set in `resolveVocabularies`.
  const contribute = (
    vocabulary: string,
    shipped: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
    module: string,
  ): void => {
    if (!vocabularies.has(vocabulary)) {
      conflicts.push({ kind: "vocabulary-unknown", id: vocabulary, claimants: [module] });
      return;
    }
    const held = entries.get(vocabulary) ?? new Map<string, ContributedEntry>();
    entries.set(vocabulary, held);
    for (const [entryName, value] of Object.entries(shipped)) {
      const prior = held.get(entryName);
      if (prior !== undefined) {
        conflicts.push({
          kind: "entry",
          id: `${vocabulary}/${entryName}`,
          claimants: [prior.module, module],
        });
        continue;
      }
      held.set(entryName, { value, module });
      owners.set(`entry:${vocabulary}/${entryName}`, ownerRecord(module));
    }
  };
  const ownerRecord = (module: string): { module: string; version?: string } => {
    const manifest = manifests.find((m) => m.id === module);
    const record: { module: string; version?: string } = { module };
    if (manifest?.version !== undefined) record.version = manifest.version;
    return record;
  };
  for (const manifest of manifests) {
    for (const [name, vocabulary] of Object.entries(manifest.vocabularies ?? {})) {
      if (vocabulary.entries !== undefined && vocabularies.get(name) === vocabulary) {
        contribute(name, vocabulary.entries, manifest.id);
      }
    }
  }
  for (const manifest of manifests) {
    for (const [name, shipped] of Object.entries(manifest.entries ?? {})) {
      contribute(name, shipped, manifest.id);
    }
  }
  if (conflicts.length > 0) return { ok: false, conflicts };
  return {
    ok: true,
    registry: {
      grammarOwner,
      grammars,
      kindOwner,
      armGrammar,
      arms,
      vocabularies,
      entries,
      checks,
      lanes,
      fragments,
      types,
      templates,
      skills,
      owners,
    },
  };
}

/**
 * docs/extending.md §An arm: the arms that judge a page against its base — every
 * arm any loaded module declared with `runTransition`. A finding of one says a
 * governed item left the page or changed where its grammar forbids it, which
 * is what a verb that writes whole pages refuses on. Read off the manifests,
 * so the verb names no module's arm.
 */
export function transitionArms(modules: ModuleRegistry): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const [id, arm] of modules.arms) if (arm.runTransition !== undefined) ids.add(id);
  return ids;
}

/**
 * docs/extending.md §A grammar: the parameter names this grammar admits,
 * read off the manifest. The ONE definition site — a kernel table beside it,
 * held equal by a test, would be one law with two hand-maintained renderings,
 * and the kernel would know a kit's parameter names.
 */
export function grammarParams(
  modules: ModuleRegistry,
  grammar: string | undefined,
): readonly string[] {
  if (grammar === undefined) return [];
  const spec = modules.grammars.get(grammar);
  return spec === undefined ? [] : Object.keys(spec.params);
}

/** Every parameter name any loaded grammar admits — the "is this a parameter at all" set. */
export function allGrammarParams(modules: ModuleRegistry): readonly string[] {
  const names = new Set<string>();
  for (const spec of modules.grammars.values()) {
    for (const name of Object.keys(spec.params)) names.add(name);
  }
  return [...names];
}

/** A section entry, as the kernel hands one to this API: its declared parameters. */
export type DeclaredParams = Readonly<Record<string, unknown>>;

/**
 * docs/extending.md §A grammar: the parameters a section entry declared,
 * as its grammar's arms read them — the entry's own opaque record, plus the
 * kernel's `vocabulary` key, which names the vocabulary the section's items are
 * checked against and which every grammar that reads one reads under the same
 * name. The kernel does not know what any of the rest mean.
 */
export function declaredParams(entry: {
  readonly params: DeclaredParams;
  readonly vocabulary?: string;
}): DeclaredParams {
  return entry.vocabulary === undefined
    ? entry.params
    : { ...entry.params, vocabulary: entry.vocabulary };
}

/**
 * docs/extending.md §An arm: does this arm's declaration hold for a section that
 * declared `grammar` with `params`? The kernel's coverage count is the number of
 * bindings for which this is true.
 */
export function armApplies(arm: ArmSpec, params: DeclaredParams): boolean {
  return arm.on === undefined || conditionMet(arm.on, params);
}

/**
 * The one reading of `{ param, equals }`, shared by an arm's applicability and a
 * delegation's condition. Present-and-equal, where `equals` absent
 * means present-at-any-value. Two readings would be one law with two renderings.
 */
function conditionMet(
  on: { readonly param: string; readonly equals?: string },
  params: DeclaredParams,
): boolean {
  const value = params[on.param];
  if (value === undefined) return false;
  return on.equals === undefined || value === on.equals;
}

/**
 * docs/extending.md §A grammar: the dispatch chain for one section, resolved ONCE where
 * the registry is — the grammar's own `parse`, then each declared delegation
 * whose condition this section's parameters meet, in declaration order.
 *
 * Resolving here rather than at parse time is what keeps the registry out of the
 * parser: a binding is already the resolved thing, and a section's parameters do
 * not change between items, so the condition is evaluated once and exactly.
 */
export function resolveParsers(
  grammar: string,
  params: DeclaredParams,
  modules: ModuleRegistry,
): readonly GrammarParse[] {
  const spec = modules.grammars.get(grammar);
  if (spec === undefined) return [];
  const chain: GrammarParse[] = [spec.parse];
  for (const delegation of spec.delegates ?? []) {
    if (!conditionMet(delegation.on, params)) continue;
    const owner = modules.kindOwner.get(delegation.to);
    const delegate = owner === undefined ? undefined : modules.grammars.get(owner);
    if (delegate !== undefined) chain.push(delegate.parse);
  }
  return chain;
}

/**
 * docs/constitution.md §Vocabularies: the values of `vocabulary` this item authored,
 * asked of the grammar that OWNS the item's kind. Empty where nothing was
 * authored and where the grammar registers no observer, which are the same
 * verdict for a census: no value, no count.
 */
export function observedValues(
  vocabulary: string,
  item: ItemFields & { readonly raw: string },
  modules: ModuleRegistry,
): readonly string[] {
  const owner = modules.kindOwner.get(item.kind);
  const observes = owner === undefined ? undefined : modules.grammars.get(owner)?.observes;
  if (observes === undefined) return [];
  // A census walks every item of every page; a throw here would end the
  // census rather than skip an item, and a census is a count.
  try {
    return observes(vocabulary, item);
  } catch {
    return [];
  }
}

/**
 * docs/concepts.md §Generated artifacts: the labelled edges one item declares, asked of the
 * grammar that OWNS the item's kind. Empty where the grammar registers no
 * `edges` hook — the item's wikilinks are still the kernel's to see, as
 * wikilinks. A throw loses this item's edges and never the artifact:
 * the graph is a derived census of the vault, and a stranger's bug may cost one
 * row of it, not the file.
 */
export function edgesOf(
  item: ItemFields & { readonly raw: string },
  modules: ModuleRegistry,
): readonly { readonly to: string; readonly label: string }[] {
  const owner = modules.kindOwner.get(item.kind);
  const edges = owner === undefined ? undefined : modules.grammars.get(owner)?.edges;
  if (edges === undefined) return [];
  try {
    return edges(item);
  } catch {
    return [];
  }
}

/**
 * docs/concepts.md §The judge and its states: the canonical rendering for one item, resolved from
 * the grammar that OWNS the item's kind rather than from the section's grammar.
 * A History section declares `claims` and holds `entry` items by delegation, and
 * the dated entry's canonical form is `entries`' to state, not claims'.
 */
export function canonicalizeOf(kind: string, modules: ModuleRegistry): Canonicalize | undefined {
  const owner = modules.kindOwner.get(kind);
  const declared = owner === undefined ? undefined : modules.grammars.get(owner)?.canonicalize;
  if (declared === undefined) return undefined;
  // docs/extending.md §The determinism fixture: a module that throws here would take the page's
  // whole verdict with it, and the census row it feeds is `info` — a count.
  // Losing one count is the right cost of a stranger's bug; losing the page is
  // not. The arm-level guards report a failure because a failed ARM leaves a
  // gate unevaluated; this one has no gate behind it.
  return (item) => {
    try {
      return declared(item);
    } catch {
      return undefined;
    }
  };
}

/**
 * docs/extending.md §A grammar: the item kinds this section's authors may write, or
 * `undefined` where the grammar declares no allow-list or the section did not
 * turn it on. `undefined` and "every kind" are the same verdict here and are
 * deliberately not distinguished: a section with no allow-list restricts nothing.
 */
export function admittedKinds(
  grammar: string,
  params: DeclaredParams,
  modules: ModuleRegistry,
): readonly string[] | undefined {
  const admits = modules.grammars.get(grammar)?.admits;
  if (admits === undefined) return undefined;
  if (admits.on !== undefined && !conditionMet(admits.on, params)) return undefined;
  const declared = params[admits.param];
  return Array.isArray(declared) ? (declared as readonly string[]) : undefined;
}

/**
 * docs/extending.md §An arm: the two transition capabilities of one
 * grammar, resolved from the registry. Returned as a pair rather than looked up
 * one at a time so a caller cannot take identity from one grammar and the
 * correction predicate from another.
 *
 * A grammar that registered neither gets the closed defaults: no item has an
 * identity, and no edit is a correction. Both are the SAFE readings — an
 * unmatched item is never reported as changed, and an unrecognized edit is a
 * change of substance rather than a typo the engine forgives.
 */
export function transitionSeam(
  grammar: string,
  modules: ModuleRegistry,
): { readonly identityOf: IdentityOf; readonly isCorrection: IsCorrection } {
  const spec = modules.grammars.get(grammar);
  const identityOf = spec?.identityOf;
  const isCorrection = spec?.isCorrection;
  // A throw becomes the CLOSED default, which is the same answer an
  // absent capability gets — no identity, no correction. Both readings are the
  // strict one: an unmatched item is never reported as changed, and an
  // unrecognized edit is a change of substance. A module's bug therefore makes
  // the transition arm louder, never quieter.
  return {
    identityOf: (item) => {
      if (identityOf === undefined) return undefined;
      try {
        return identityOf(item);
      } catch {
        return undefined;
      }
    },
    isCorrection: (before, after) => {
      if (isCorrection === undefined) return false;
      try {
        return isCorrection(before, after);
      } catch {
        return false;
      }
    },
  };
}

/**
 * docs/extending.md: the effect a section's declared parameters give it. The
 * strongest wins, because a section that both forbids mutation and requires a
 * rewrite is the contradiction the caller is about to report.
 */
export function effectOf(grammar: GrammarSpec, params: DeclaredParams): LifecycleEffect {
  let effect: LifecycleEffect = "none";
  for (const [name, spec] of Object.entries(grammar.params)) {
    if (spec.effect === undefined) continue;
    const value = params[name];
    if (value === undefined) continue;
    if (spec.effect.equals !== undefined && value !== spec.effect.equals) continue;
    if (spec.effect.effect === "requires-rewrite") return "requires-rewrite";
    effect = spec.effect.effect;
  }
  return effect;
}

export type ParamCombineResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly detail: string };

function sameValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, i) => sameValue(value, right[i]));
  }
  if (
    left !== null &&
    right !== null &&
    typeof left === "object" &&
    typeof right === "object" &&
    !Array.isArray(left) &&
    !Array.isArray(right)
  ) {
    const leftRecord = left as Readonly<Record<string, unknown>>;
    const rightRecord = right as Readonly<Record<string, unknown>>;
    const keys = Object.keys(leftRecord);
    return (
      keys.length === Object.keys(rightRecord).length &&
      keys.every(
        (key) => Object.hasOwn(rightRecord, key) && sameValue(leftRecord[key], rightRecord[key]),
      )
    );
  }
  return false;
}

function copyValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(copyValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Readonly<Record<string, unknown>>).map(([key, item]) => [
        key,
        copyValue(item),
      ]),
    );
  }
  return value;
}

function display(value: unknown): string {
  return JSON.stringify(value) ?? String(value);
}

/**
 * docs/extending.md §A grammar: the one interpreter for a grammar
 * parameter under `extends`. `undefined` means the declaration is absent; the
 * returned value is a fresh copy so effective entries never share mutable rows.
 */
export function combineParam(
  name: string,
  spec: ParamSpec,
  inherited: unknown,
  own: unknown,
  grammarInherited: boolean,
): ParamCombineResult {
  if (own === undefined) return { ok: true, value: copyValue(inherited) };
  if (inherited === undefined) {
    if (spec.introduction === "with-grammar" && grammarInherited) {
      return {
        ok: false,
        detail: `"${name}" is declared where the grammar is declared; the ancestor's grammar declaration omits it`,
      };
    }
    return { ok: true, value: copyValue(own) };
  }

  if (spec.law === "identity") {
    return sameValue(inherited, own)
      ? { ok: true, value: copyValue(own) }
      : { ok: false, detail: `${display(inherited)} may not become ${display(own)}` };
  }

  if (spec.law === "subset-only") {
    if (!Array.isArray(inherited) || !Array.isArray(own)) {
      return { ok: false, detail: '"subset-only" requires two arrays' };
    }
    const widened = own.filter(
      (candidate) => !inherited.some((allowed) => sameValue(candidate, allowed)),
    );
    return widened.length === 0
      ? { ok: true, value: copyValue(own) }
      : { ok: false, detail: `${widened.map(display).join(", ")} is outside the inherited set` };
  }

  if ("tightenOneWay" in spec.law) {
    const [from, to] = spec.law.tightenOneWay;
    return inherited === own || (inherited === from && own === to)
      ? { ok: true, value: copyValue(own) }
      : { ok: false, detail: `${display(inherited)} may not become ${display(own)}` };
  }

  const fields = spec.law.keyedBounds;
  if (!Array.isArray(inherited) || !Array.isArray(own)) {
    return { ok: false, detail: '"keyed-bounds" requires two arrays' };
  }
  const isNames = (value: unknown): value is string | readonly string[] =>
    typeof value === "string" ||
    (Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === "string"));
  const rowOf = (value: unknown): Readonly<Record<string, unknown>> | undefined => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
    const row = value as Readonly<Record<string, unknown>>;
    if (!isNames(row[fields.key]) || typeof row[fields.lower] !== "number") return undefined;
    if (row[fields.upper] !== undefined && typeof row[fields.upper] !== "number") return undefined;
    return row;
  };
  const inheritedRows = inherited.map(rowOf);
  const ownRows = own.map(rowOf);
  if (inheritedRows.some((row) => row === undefined) || ownRows.some((row) => row === undefined)) {
    return {
      ok: false,
      detail: `"keyed-bounds" requires a string or string-list "${fields.key}", numeric "${fields.lower}" and optional numeric "${fields.upper}"`,
    };
  }
  // A row is keyed by the normalized identity of its name — or, for a name
  // SET, of the set: order-free, so `[a, b]` and `[b, a]` are one row, and a
  // wider set is a different key that adds a conjunct rather than replacing one.
  const keyOf = (names: string | readonly string[]): string =>
    typeof names === "string"
      ? normalizeIdentity(names)
      : [...new Set(names.map(normalizeIdentity))].sort().join("|");
  const nameOf = (names: string | readonly string[]): string =>
    typeof names === "string" ? names : names.join(", ");

  const merged = new Map<string, Readonly<Record<string, unknown>>>();
  for (const row of inheritedRows) {
    if (row === undefined) continue;
    merged.set(keyOf(row[fields.key] as string | readonly string[]), row);
  }
  for (const row of ownRows) {
    if (row === undefined) continue;
    const key = row[fields.key] as string | readonly string[];
    const prior = merged.get(keyOf(key));
    if (prior !== undefined) {
      const lower = row[fields.lower] as number;
      const inheritedLower = prior[fields.lower] as number;
      if (lower < inheritedLower) {
        return {
          ok: false,
          detail: `${fields.key} "${nameOf(key)}" may not lower ${fields.lower} ${inheritedLower}`,
        };
      }
      const upper = row[fields.upper] as number | undefined;
      const inheritedUpper = prior[fields.upper] as number | undefined;
      if (inheritedUpper !== undefined && (upper === undefined || upper > inheritedUpper)) {
        return {
          ok: false,
          detail: `${fields.key} "${nameOf(key)}" may not raise ${fields.upper} ${inheritedUpper}`,
        };
      }
    }
    merged.set(keyOf(key), row);
  }
  return { ok: true, value: [...merged.values()].map(copyValue) };
}
