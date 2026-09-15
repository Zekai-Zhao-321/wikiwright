// docs/concepts.md §Findings and routing (fixability is DERIVED from a closed registry of
// fixers that exist as executable operations, never authored on a row)

/** How much a machine may trust the op it is handed. */
export type Applicability = "MachineApplicable" | "MaybeIncorrect" | "HasPlaceholders";

/** The `fix` half of the routing xor (4.5, shape 1). */
export interface FindingFix {
  argv: string[];
  applicability: Applicability;
  placeholders?: string[];
}

/** What a finding needs to carry for a fixer to build its argv. */
export interface FixTarget {
  ruleId: string;
  path: string;
  line?: number;
  /**
   * The finding came from the INDEX (`gate`, `lint --staged`), so the argv
   * carries `--staged` and `fix` judges the same state. Absent, the finding
   * came from the working tree, which is what a plain `fix` judges.
   */
  staged?: boolean;
  /** The finding's own `details`, for an argv that must carry one of them. */
  details?: Readonly<Record<string, string | number | boolean>>;
}

/**
 * docs/concepts.md §Findings and routing: the engine state a fixer's verb needs to run in
 * THIS vault. "Exists as an executable operation" is a claim about a vault, not
 * about the binary — the folder-tag materializer is compiled in and still
 * refuses under a `folder_tags` mode that forbids materializing.
 */
export interface FixerContext {
  folderTags?: string;
}

interface FixerEntry {
  applicability: Applicability;
  /**
   * The rule ids this fixer can execute TODAY. Membership — not the fixer's
   * name on the row — is what makes a finding fix-routed, because a row may
   * name the fixer it wants long before the operation exists for that rule
   * (`frontmatter-set` appends to a list field in this slice, so
   * `missing-required-field` on a scalar still queues).
   */
  rules: readonly string[];
  /** The mode condition the verb needs; absent means "always". */
  enabled?(context: FixerContext | undefined): boolean;
  argv(target: FixTarget): string[];
}

/** `fix --rule <id> --path <p> [--line n] [--staged] --expect 1` — the maintainer verb. */
function fixVerbArgv(target: FixTarget): string[] {
  const argv = ["fix", "--rule", target.ruleId, "--path", target.path];
  if (target.line !== undefined) argv.push("--line", String(target.line));
  if (target.staged === true) argv.push("--staged");
  argv.push("--expect", "1");
  return argv;
}

/**
 * The closed registry. A fixer is here when it EXISTS as an executable
 * operation; slice 7 widens `rules` and adds entries, and no row, spec table or
 * skill changes when it does — which is the whole point of deriving.
 */
export const FIXER_REGISTRY: Readonly<Record<string, FixerEntry>> = {
  "check --write": {
    applicability: "MachineApplicable",
    rules: ["generated-drift"],
    argv: () => ["check", "--write"],
  },
  /** Reinstall the marker hooks, keeping the chained script the stale one named. */
  "hook install": {
    applicability: "MachineApplicable",
    rules: ["hook-stale"],
    argv: (target) => {
      const chain = target.details?.["chain"];
      return typeof chain === "string"
        ? ["hook", "install", "--chain", chain]
        : ["hook", "install"];
    },
  },
  /**
   * docs/concepts.md §Findings and routing: the folder-tag materializer is a FIXER.
   * `folder-segment-registered` and `former-folder-tags-review` are NOT fixable
   * by it — an unregistered segment is a vocabulary decision and a former tag is
   * a removal an add-only materializer cannot make.
   */
  "folder-tags": {
    applicability: "MachineApplicable",
    // The row is fix-routed only under the mode whose verb can run.
    enabled: (context) => context?.folderTags === "materialize-add-only",
    rules: ["folder-tags-present"],
    argv: fixVerbArgv,
  },
  "heading-depth": {
    applicability: "MachineApplicable",
    rules: ["section-depth"],
    argv: fixVerbArgv,
  },
  "section-stub": {
    applicability: "MachineApplicable",
    rules: ["sections"],
    argv: fixVerbArgv,
  },
  "link-rewrite": {
    applicability: "MachineApplicable",
    rules: ["wikilink-alias-target"],
    argv: fixVerbArgv,
  },
  "tag-rename": {
    applicability: "MachineApplicable",
    rules: ["tag-alias-target", "tag-retired"],
    argv: fixVerbArgv,
  },
  retype: {
    applicability: "MachineApplicable",
    rules: ["tombstone"],
    argv: fixVerbArgv,
  },
  /**
   * docs/concepts.md §The judge and its states: the ONE dialect rewrite in the engine, opt-in by
   * rule, `MaybeIncorrect` because "the engine's dialect" is a preference and
   * the corpus's own dialect is not a defect. Nothing else may rewrite a line's
   * marker or separator as a side effect of doing something else.
   */
  "canonical-form": {
    applicability: "MaybeIncorrect",
    rules: ["canonical-form"],
    argv: fixVerbArgv,
  },
  /** `--propose` only: the closing clause with its dates as placeholders. */
  "history-close": {
    applicability: "HasPlaceholders",
    rules: ["history-marker"],
    argv: (target) => [...fixVerbArgv(target).slice(0, -2), "--propose"],
  },
  /**
   * Delete exactly the undeclared key the finding names — its line and
   * the block value beneath it — and nothing else. A key the type does not
   * declare has no legal value, so removing it is the one mechanical answer;
   * declaring it is the other, and that is a constitution edit, not a fix.
   */
  "frontmatter-delete": {
    applicability: "MachineApplicable",
    rules: ["unknown-frontmatter-key"],
    argv: fixVerbArgv,
  },
  "frontmatter-set": {
    applicability: "MachineApplicable",
    // The two shape rows join, but ONLY where the shape admits exactly
    // one legal value — the derivation refuses otherwise, so a row whose field
    // has two legal values still queues.
    rules: ["renamed-without-alias", "missing-required-field", "field-shape"],
    argv: fixVerbArgv,
  },
};

export const REGISTERED_FIXERS: readonly string[] = Object.keys(FIXER_REGISTRY).sort();

/**
 * Whether the registry names this fixer for this rule at all — the static half
 * of `fixerExecutes`, with no vault in hand. A pass-table row may name a fixer
 * only where this is true: a name the registry does not carry for the rule is
 * a route the envelope would print and the verb would refuse.
 */
export function fixerRegistered(fixer: string, ruleId: string): boolean {
  return FIXER_REGISTRY[fixer]?.rules.includes(ruleId) === true;
}

/**
 * Whether this row's fixer can execute this rule in THIS vault (docs/concepts.md §Findings and routing).
 * With no context the answer is the conservative one, so `unroutableRows` —
 * which holds the table with no vault in hand — requires a row whose fixer names
 * a mode condition to declare the lane it falls through to.
 */
export function fixerExecutes(
  fixer: string | undefined,
  ruleId: string,
  context?: FixerContext,
): boolean {
  if (fixer === undefined || !fixerRegistered(fixer, ruleId)) return false;
  const entry = FIXER_REGISTRY[fixer];
  return entry?.enabled === undefined || entry.enabled(context);
}

/** The `fix` object for a finding whose row names an executing fixer. */
export function buildFix(
  fixer: string,
  target: FixTarget,
  context?: FixerContext,
): FindingFix | undefined {
  const entry = FIXER_REGISTRY[fixer];
  if (entry === undefined || !fixerExecutes(fixer, target.ruleId, context)) return undefined;
  return { argv: entry.argv(target), applicability: entry.applicability };
}
