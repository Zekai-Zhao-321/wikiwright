// v2 contracts §6 (the finding and its route) · §10 (the routing and coverage
// tables carried over by id, docs/v2-dispositions.md).
//
// Every code the v2 judge emits, with its severity, its route and the v1 ids
// it carries, and every code a verb adds beside the judge's (scope `shell`:
// `check`'s pins, generated artifacts and base-OKF row). The route is total:
// an error or a warning names exactly one of a queue lane and a fix, and an
// info finding names neither. No fixer runs inside the judge; the two that
// survive, the folder tags and the generated artifacts, are `check --fix`'s,
// and their rows name that argv (`fix`) — the folder tags' only where the
// finding says the materializer applies (`fixWhen`), a queue otherwise. A
// CEL rule is its own row, severity as the rule declares, lane `rule-review`
// (§3: every CEL rule routes to the queue).
//
// Ported from the old PASS_TABLE (passes/index.ts): the lanes by id, the
// `needsBase` flag that makes a transition `unevaluated` without a base, and
// the unroutable-row check. Dropped: the fixers the kernel ran on a page
// (frontmatter-set, frontmatter-delete, tag-rename, section-stub,
// heading-depth, link-rewrite, retype, history-close), which leave with `fix`
// (§1), so their rows queue to the lane they fell through to before; the
// POLICY kind and its keys (the folder-tag passes are `check`'s); and the
// `shell` and `origin` inputs, which belong to the verbs.

/** Where a finding sits: the whole page, or one occurrence of a section. */
export type FindingLocation =
  | { kind: "page" }
  | { kind: "section"; heading: string; occurrence: number; line: number };

/** §6: a finding, routed. */
export interface VerdictFinding {
  /** The code, or the CEL rule's id. */
  rule: string;
  severity: "error" | "warning" | "info";
  /** A page's bundle-relative path, or a law file framed as the law digest frames it. */
  path: string;
  location: FindingLocation;
  message: string;
  details: Record<string, unknown>;
  /** The queue lane: on every error and warning that names no fix, on no info. */
  queue?: string;
  /** The command that repairs it: on an error or a warning whose row names one. */
  fix?: { argv: string[] };
}

export interface VerdictRow {
  id: string;
  /** `declared`: a CEL rule's own severity, or rule-untested's, which the gate raises. */
  severity: "error" | "warning" | "info" | "declared";
  /** The lane an error or a warning queues to; none on an info row. */
  lane?: string;
  /** The v1 ids this code carries (docs/v2-dispositions.md). */
  carries: readonly string[];
  /** The argv that repairs a finding of this row, in place of the lane. */
  fix?: readonly string[];
  /** The `details` key that must be `true` for `fix` to apply; the lane routes otherwise. */
  fixWhen?: string;
  /** A transition: without a base it is `unevaluated`, reason `no-base`. */
  needsBase?: true;
  /**
   * What it judges: a page, the vault as a whole, or the law itself — or, for
   * `shell`, what a verb judges beside the judge (git, the generated files).
   */
  scope: "page" | "vault" | "law" | "shell";
}

/** The lanes a CEL rule and the law's own findings queue to; the rest are v1's. */
export const RULE_LANE = "rule-review";
export const LAW_LANE = "law-review";

export const VERDICT_TABLE: readonly VerdictRow[] = [
  // --- a page as bytes and as YAML -----------------------------------------
  { id: "page-too-large", severity: "error", lane: "syntax-review", carries: [], scope: "page" },
  { id: "page-not-utf8", severity: "error", lane: "syntax-review", carries: [], scope: "page" },
  {
    id: "malformed-frontmatter",
    severity: "error",
    lane: "syntax-review",
    carries: ["malformed-frontmatter"],
    scope: "page",
  },
  {
    id: "frontmatter-not-mapping",
    severity: "error",
    lane: "syntax-review",
    carries: ["frontmatter-not-mapping"],
    scope: "page",
  },
  {
    id: "duplicate-key",
    severity: "error",
    lane: "syntax-review",
    carries: ["duplicate-key"],
    scope: "page",
  },
  // --- the type and its shape ------------------------------------------------
  {
    id: "type-unknown",
    severity: "error",
    lane: "type-review",
    carries: ["unknown-type"],
    scope: "page",
  },
  {
    id: "abstract-type",
    severity: "error",
    lane: "type-review",
    carries: ["abstract-type"],
    scope: "page",
  },
  {
    id: "page-shape-invalid",
    severity: "error",
    lane: "syntax-review",
    carries: [
      "missing-required-field",
      "field-shape",
      "unknown-frontmatter-key",
      "invalid-tags-field",
      "tag-form",
      "malformed-pin",
    ],
    scope: "page",
  },
  {
    id: "page-ref-type",
    severity: "error",
    lane: "link-review",
    carries: ["field-shape"],
    scope: "page",
  },
  // --- vocabularies ------------------------------------------------------------
  {
    id: "vocabulary-unknown",
    severity: "error",
    lane: "category-review",
    carries: ["unknown-tag", "unknown-category", "unknown-label"],
    scope: "page",
  },
  {
    id: "vocabulary-retired",
    severity: "error",
    lane: "category-review",
    carries: ["tag-retired", "vocabulary-retired"],
    scope: "page",
  },
  // --- names and links -----------------------------------------------------------
  {
    id: "identity-collision",
    severity: "error",
    lane: "identity-review",
    carries: ["identity-collision"],
    scope: "vault",
  },
  {
    id: "wikilink-unresolved",
    severity: "warning",
    lane: "link-review",
    carries: ["wikilink-unresolved"],
    scope: "page",
  },
  {
    id: "wikilink-alias-target",
    severity: "error",
    lane: "link-review",
    carries: ["wikilink-alias-target"],
    scope: "page",
  },
  {
    id: "renamed-without-alias",
    severity: "error",
    lane: "identity-review",
    carries: ["renamed-without-alias"],
    needsBase: true,
    scope: "page",
  },
  // A link or a submodule where a page could be, which no state reads through.
  {
    id: "path-skipped",
    severity: "warning",
    lane: "identity-review",
    carries: [],
    scope: "vault",
  },
  // --- instances -----------------------------------------------------------------
  {
    id: "instances-min",
    severity: "error",
    lane: "type-review",
    carries: ["instances"],
    scope: "vault",
  },
  {
    id: "instances-max",
    severity: "error",
    lane: "type-review",
    carries: ["instances"],
    scope: "vault",
  },
  // --- sections and the fixed grammar --------------------------------------------
  {
    id: "section-count",
    severity: "error",
    lane: "grammar-review",
    carries: ["sections"],
    scope: "page",
  },
  {
    id: "section-order",
    severity: "error",
    lane: "grammar-review",
    carries: ["sections"],
    scope: "page",
  },
  {
    id: "section-undeclared",
    severity: "error",
    lane: "grammar-review",
    carries: ["sections"],
    scope: "page",
  },
  {
    id: "section-depth",
    severity: "error",
    lane: "grammar-review",
    carries: ["section-depth"],
    scope: "page",
  },
  {
    id: "item-unparsed",
    severity: "error",
    lane: "grammar-review",
    carries: ["grammar-unparsed", "entry-date-missing"],
    scope: "page",
  },
  {
    id: "category-not-allowed",
    severity: "error",
    lane: "category-review",
    carries: ["category-not-allowed"],
    scope: "page",
  },
  {
    id: "claim-provenance",
    severity: "error",
    lane: "provenance-backfill",
    carries: ["claim-provenance"],
    scope: "page",
  },
  {
    id: "claim-closed",
    severity: "error",
    lane: "grammar-review",
    carries: ["closed-claim-in-facts"],
    scope: "page",
  },
  {
    id: "claim-open",
    severity: "error",
    lane: "grammar-review",
    carries: ["history-marker"],
    scope: "page",
  },
  {
    id: "relation-target-unresolved",
    severity: "warning",
    lane: "link-review",
    carries: ["relation-target-unresolved"],
    scope: "page",
  },
  {
    id: "require-unmet",
    severity: "error",
    lane: "label-review",
    carries: ["relation-require"],
    scope: "page",
  },
  // --- the kernel transitions (ruling 3) -------------------------------------------
  {
    id: "entry-edited",
    severity: "error",
    lane: "grammar-review",
    carries: ["entry-mutated"],
    needsBase: true,
    scope: "page",
  },
  {
    id: "claims-transition",
    severity: "error",
    lane: "grammar-review",
    carries: ["claims-transition"],
    needsBase: true,
    scope: "page",
  },
  {
    id: "relation-removed",
    severity: "error",
    lane: "label-review",
    carries: ["relation-removed"],
    needsBase: true,
    scope: "page",
  },
  // --- the folder-tag policy, off unless engine.json declares it -------------------
  {
    id: "folder-segment-registered",
    severity: "error",
    lane: "tag-review",
    carries: ["folder-segment-registered"],
    scope: "page",
  },
  {
    id: "folder-tags-present",
    severity: "error",
    lane: "tag-review",
    fix: ["wikiwright", "check", "--fix"],
    fixWhen: "materialize",
    carries: ["folder-tags-present"],
    scope: "page",
  },
  {
    id: "former-folder-tags-review",
    severity: "warning",
    lane: "tag-review",
    carries: ["former-folder-tags-review"],
    needsBase: true,
    scope: "page",
  },
  // --- exceptions ----------------------------------------------------------------
  { id: "exception-applied", severity: "info", carries: [], scope: "page" },
  {
    id: "exception-stale",
    severity: "warning",
    lane: "exception-review",
    carries: ["exception-stale"],
    scope: "page",
  },
  {
    id: "exception-illegal",
    severity: "error",
    lane: "exception-review",
    carries: ["exception-illegal"],
    scope: "page",
  },
  // --- rules ---------------------------------------------------------------------
  { id: "rule-error", severity: "error", lane: RULE_LANE, carries: [], scope: "page" },
  { id: "unevaluated", severity: "info", carries: [], scope: "page" },
  // --- rule tests and examples (§8) --------------------------------------------------
  // A warning under `check`, an error at the gate for a rule its diff adds or changes.
  { id: "rule-untested", severity: "declared", lane: RULE_LANE, carries: [], scope: "law" },
  { id: "rule-test-fails", severity: "error", lane: RULE_LANE, carries: [], scope: "law" },
  { id: "example-fails", severity: "error", lane: RULE_LANE, carries: [], scope: "law" },
  // --- the law diff (§8) ---------------------------------------------------------------
  { id: "law-changed", severity: "info", carries: [], scope: "law" },
  { id: "law-relaxed", severity: "error", lane: LAW_LANE, carries: [], scope: "law" },
  // --- what `check` judges beside the judge (§9.1) -------------------------------------
  {
    id: "generated-drift",
    severity: "error",
    fix: ["wikiwright", "check", "--write"],
    carries: ["generated-drift", "brief-stale"],
    scope: "shell",
  },
  {
    id: "okf-missing-type",
    severity: "error",
    lane: "type-review",
    carries: ["okf-missing-type"],
    scope: "shell",
  },
  // Pins, measured against the local repository only.
  {
    id: "pin-stale",
    severity: "warning",
    lane: "source-review",
    carries: ["stale-capture"],
    scope: "shell",
  },
  {
    id: "pin-unknown",
    severity: "warning",
    lane: "source-review",
    carries: ["pin-unknown-to-origin"],
    scope: "shell",
  },
  {
    id: "pin-unmeasured",
    severity: "info",
    carries: ["freshness-unavailable"],
    scope: "shell",
  },
  {
    id: "citation-unresolved",
    severity: "warning",
    lane: "source-review",
    carries: ["citation-unresolved"],
    scope: "shell",
  },
  {
    id: "stale-source-cited",
    severity: "warning",
    lane: "source-review",
    carries: ["stale-source-cited"],
    scope: "shell",
  },
];

const BY_ID = new Map(VERDICT_TABLE.map((row) => [row.id, row] as const));

/** The row of a kernel code, or undefined for a CEL rule's id. */
export function verdictRow(id: string): VerdictRow | undefined {
  return BY_ID.get(id);
}

/**
 * §6: the route of one finding. A kernel code routes as its row does: to the
 * fix its row names, where the finding meets the row's condition, else to its
 * lane; any other id is a CEL rule, which queues to `rule-review`. An info
 * finding carries no route.
 */
export function routeVerdictFinding(
  finding: Omit<VerdictFinding, "queue" | "fix">,
): VerdictFinding {
  if (finding.severity === "info") return { ...finding };
  const row = BY_ID.get(finding.rule);
  if (
    row?.fix !== undefined &&
    (row.fixWhen === undefined || finding.details[row.fixWhen] === true)
  ) {
    return { ...finding, fix: { argv: [...row.fix] } };
  }
  const lane = row === undefined ? RULE_LANE : row.lane;
  if (lane === undefined) {
    throw new Error(`finding-unroutable: "${finding.rule}" has no lane and is not info`);
  }
  return { ...finding, queue: lane };
}

/**
 * The rows that route nowhere: a non-info row with neither a lane nor an
 * unconditional fix, or an info row with either.
 */
export function unroutableVerdictRows(table: readonly VerdictRow[] = VERDICT_TABLE): string[] {
  return table
    .filter((row) => {
      const routes = row.lane !== undefined || (row.fix !== undefined && row.fixWhen === undefined);
      const names = row.lane !== undefined || row.fix !== undefined;
      return row.severity === "info" ? names : !routes;
    })
    .map((row) => row.id)
    .sort();
}
