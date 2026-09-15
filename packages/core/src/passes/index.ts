// docs/concepts.md §Findings and routing: every pass the KERNEL can emit, classified as LAW /
// POLICY / type-declared, with its severity and its route. A module's arms and
// checks carry their own rows on the manifest that declared them; `passRows`
// (modules/index.ts) composes the two into the table a vault is judged under.
// docs/concepts.md §Findings and routing: the route is DERIVED from a fixer name and a queue lane; a
// non-info row that names neither fails the build as `finding-unroutable`.
import { fixerExecutes, fixerRegistered } from "../fixers/index.ts";

/**
 * docs/concepts.md §Findings and routing: the lane set the KERNEL owns — every lane a
 * row of this table names, and no other. A module registers the lanes only its
 * own arms queue to (the standard library's `label-review` and
 * `provenance-backfill`), and the registration API refuses a module that claims
 * one of these, or an arm naming a lane nothing registered.
 *
 * A lane is a human queue; its cap has no consumer, so `engine.json` gains NO
 * `queues` key — a key a pass does not read is the class-B shape this project
 * counts.
 */
export const KERNEL_LANES: readonly string[] = [
  "category-review",
  // docs/extending.md §The determinism fixture: where an attributed module failure queues. A
  // stranger's exception is a finding about the MODULE, so it is a human's to
  // look at and it may not sit in a lane about the page.
  "module-review",
  "exception-review",
  "grammar-review",
  "identity-review",
  "link-review",
  "skills-review",
  "source-review",
  "syntax-review",
  "tag-review",
  "template-review",
  "type-review",
];

/**
 * A lane is a STRING, not a union of the kernel's twelve: a module registers
 * its own (`docs/extending.md §What a module registers`), and a kit that cannot name its own
 * lane pollutes a kernel one. The kernel's set is still closed and still checked
 * — `loadModules` refuses an arm or check naming a lane nothing registered.
 */
export type QueueLane = string;

export interface PassRow {
  /** The finding `ruleId`, the parse-issue code, or the checker name. */
  id: string;
  kind: "LAW" | "POLICY" | "type-declared";
  /** `declared` where the rule record carries the severity. */
  severity: "error" | "warning" | "info" | "declared";
  /**
   * The registered fixer for this row — a name the fixer registry carries FOR
   * THIS RULE, held by a test. Whether a finding is fix-routed is still decided
   * per vault: a fixer whose mode condition fails falls through to the lane.
   */
  fixer?: string;
  /** The lane a non-info finding routes to when no fixer executes it. */
  lane?: QueueLane;
  /** Info rows only: a verb worth naming, which is never a route. */
  advisory?: string;
  /** POLICY rows only: the config/engine.json key that turns the pass on. */
  key?: string;
  /**
   * docs/concepts.md §Findings and routing: this pass compares against a base revision. Without
   * one it is `not_applicable`, reason `no-base`, and a non-info type-declared
   * row counts toward `unevaluated` — the blind spot a whole-vault pass reports
   * rather than a clean zero.
   */
  needsBase?: true;
  /**
   * docs/concepts.md §Findings and routing: the pass's input is not the page set. `shell` — the
   * artifact tree, the machine or the process: the shell runs it and names it
   * in `shellPasses`; where it did not, the judge reports `not_applicable`,
   * reason `capability-unavailable`. `origin` — an EXTERNAL git origin a
   * source page names (docs/constitution.md §Shapes): only `freshness` contacts one, so every
   * judging verb reports `not_applicable`, reason `external-origin` — a row
   * present on every envelope, never a zero it did not earn.
   */
  input?: "shell" | "origin";
  /** Why the pass exists, in one clause — the `why` F/H asked POLICY rows for. */
  why?: string;
}

/**
 * docs/concepts.md §Findings and routing: one derivation, read by the playbook and by the envelope. A
 * fixer counts only where the registry carries it for this rule — a row naming
 * one it does not is a phantom route, and the row's lane is its real one.
 */
export function routeOf(row: PassRow): string {
  if (row.fixer !== undefined && fixerRegistered(row.fixer, row.id)) return row.fixer;
  if (row.advisory !== undefined) return row.advisory;
  if (row.lane !== undefined) return `queue ${row.lane}`;
  return "—";
}

/**
 * The build-failing half of the routing law: the ids that route nowhere.
 * A non-info row must be executable (a registered fixer for that rule) or
 * queued; an info row is a census and names neither.
 */
export function unroutableRows(table: readonly PassRow[] = PASS_TABLE): string[] {
  const bad: string[] = [];
  for (const row of table) {
    if (row.severity === "info") {
      if (row.fixer !== undefined || row.lane !== undefined) bad.push(row.id);
      continue;
    }
    if (fixerExecutes(row.fixer, row.id)) continue;
    if (row.lane === undefined) bad.push(row.id);
  }
  return bad.sort();
}

export const PASS_TABLE: readonly PassRow[] = [
  // --- LAW: always on -------------------------------------------------------
  // docs/extending.md §The determinism fixture: a loaded module threw while judging a page. The
  // finding names the module and the arm or check that reached, so a stranger's
  // bug is one attributed error on one page rather than an unattributed crash
  // that takes the whole vault's verdict with it.
  {
    id: "module-failure",
    kind: "LAW",
    severity: "error",
    lane: "module-review",
    why: "a module threw while judging; the verdict for the pass it was running is unknown",
  },
  { id: "malformed-frontmatter", kind: "LAW", severity: "error", lane: "syntax-review" },
  { id: "frontmatter-not-mapping", kind: "LAW", severity: "error", lane: "syntax-review" },
  // Emitted by the YAML parse seam and invisible to the
  // ledger's `code: "…"` scan, which stops at the first literal of the union
  // type declaring it — a routing hole this slice's xor test found.
  { id: "duplicate-key", kind: "LAW", severity: "error", lane: "syntax-review" },
  { id: "unknown-type", kind: "LAW", severity: "error", lane: "type-review" },
  { id: "tombstone", kind: "LAW", severity: "error", fixer: "retype", lane: "type-review" },
  {
    id: "missing-required-field",
    kind: "LAW",
    severity: "error",
    fixer: "frontmatter-set",
    lane: "syntax-review",
  },
  {
    id: "field-shape",
    kind: "LAW",
    severity: "error",
    fixer: "frontmatter-set",
    lane: "syntax-review",
  },
  {
    id: "unknown-frontmatter-key",
    kind: "LAW",
    severity: "error",
    fixer: "frontmatter-delete",
    lane: "syntax-review",
  },
  { id: "invalid-tags-field", kind: "LAW", severity: "error", lane: "syntax-review" },
  // `tag-rename` executes an alias and a single-replacement retirement;
  // an UNKNOWN tag names no replacement at all, so it queues.
  { id: "unknown-tag", kind: "LAW", severity: "error", lane: "tag-review" },
  {
    id: "tag-alias-target",
    kind: "LAW",
    severity: "error",
    fixer: "tag-rename",
    lane: "tag-review",
  },
  { id: "tag-retired", kind: "LAW", severity: "error", fixer: "tag-rename", lane: "tag-review" },
  { id: "identity-collision", kind: "LAW", severity: "error", lane: "identity-review" },
  { id: "sections", kind: "LAW", severity: "error", fixer: "section-stub", lane: "grammar-review" },
  {
    id: "section-depth",
    kind: "LAW",
    severity: "error",
    fixer: "heading-depth",
    lane: "grammar-review",
  },
  { id: "max-chars", kind: "LAW", severity: "warning", lane: "grammar-review" },
  {
    id: "wikilink-alias-target",
    kind: "LAW",
    severity: "error",
    fixer: "link-rewrite",
    lane: "link-review",
  },
  { id: "wikilink-unresolved", kind: "LAW", severity: "warning", lane: "link-review" },
  {
    id: "generated-drift",
    kind: "LAW",
    severity: "error",
    fixer: "check --write",
    input: "shell",
  },
  { id: "okf-missing-type", kind: "LAW", severity: "error", lane: "type-review" },
  {
    id: "template-placeholder-unknown",
    kind: "LAW",
    severity: "warning",
    lane: "template-review",
    input: "shell",
  },
  // A template frontmatter key the type does not declare seeds nothing and
  // lands on no page, so the template lies about the type; said beside the
  // placeholder row it belongs with.
  {
    id: "template-field-unknown",
    kind: "LAW",
    severity: "warning",
    lane: "template-review",
    input: "shell",
  },
  {
    id: "template-orphan",
    kind: "LAW",
    severity: "warning",
    lane: "template-review",
    input: "shell",
  },
  {
    id: "freshness-unavailable",
    kind: "LAW",
    severity: "warning",
    lane: "source-review",
    input: "shell",
  },

  // --- POLICY: off unless engine.json declares the key ----------------------
  {
    id: "folder-segment-registered",
    kind: "POLICY",
    severity: "error",
    lane: "tag-review",
    key: "folder_tags",
    why: "folders mint nothing; a segment that governs tags must be registered",
  },
  {
    id: "folder-tags-present",
    kind: "POLICY",
    severity: "error",
    fixer: "folder-tags",
    // The fixer executes this row only under
    // `folder_tags.mode == "materialize-add-only"`. Under any other mode the
    // route falls through to the lane, so the lane is not optional here.
    lane: "tag-review",
    key: "folder_tags",
    why: "location and membership agree, deliberately",
  },
  {
    id: "former-folder-tags-review",
    kind: "POLICY",
    severity: "warning",
    // Kept as a queue: a former tag is a REMOVAL, and the add-only materializer
    // cannot perform one. The row names no fixer and queues.
    lane: "tag-review",
    key: "folder_tags",
    // A property of a RENAME: the staged gate reads it off the index and
    // hands it in; there is no rename to read without a base.
    needsBase: true,
    input: "shell",
    why: "after a move, an old segment tag is a judgment call, not a defect",
  },
  {
    id: "unregistered-extension",
    kind: "POLICY",
    severity: "error",
    lane: "syntax-review",
    key: "extensions",
    why: "a bundle that closes the x- mount says which namespaces it opened",
  },

  // --- type-declared: on where a type's fields, sections or rules say so ----
  // docs/constitution.md §Shapes: the snapshot-internal half of a pin — a full commit id, and
  // an origin field beside it — judged by every verb on every page whose type
  // declares a `pin` field. Whether the origin knows the commit is not here.
  {
    id: "malformed-pin",
    kind: "type-declared",
    severity: "error",
    lane: "source-review",
    why: "a pin is the full commit id of a named origin; anything else cannot be measured",
  },
  // The run-external half: measured against the origin the page names, by
  // `freshness` alone. No fixer — a stale capture is by definition a pin whose
  // covering diff is NOT empty, which is exactly the pin a fast-forward never
  // advances; the human re-reads and re-pins, or records why the change does
  // not matter, and that is a queue.
  {
    id: "stale-capture",
    kind: "type-declared",
    severity: "warning",
    lane: "source-review",
    input: "origin",
  },
  {
    id: "stale-source-cited",
    kind: "type-declared",
    severity: "warning",
    lane: "source-review",
    input: "origin",
  },
  // A repository path the page cites in backticks that the origin does not
  // hold at the pin, or a cited line past the blob's end. Read off
  // the origin's objects by `freshness` alone; the human re-reads at the pin
  // and corrects the citation or the pin.
  {
    id: "citation-unresolved",
    kind: "type-declared",
    severity: "warning",
    lane: "source-review",
    input: "origin",
  },
  // A pin the origin does not know, or that is not on its head's history — a
  // force-push, a rebase, a typo. Undecidable at the gate, so never an error.
  {
    id: "pin-unknown-to-origin",
    kind: "type-declared",
    severity: "warning",
    lane: "source-review",
    input: "origin",
  },
  {
    id: "origin-unreachable",
    kind: "LAW",
    severity: "warning",
    lane: "source-review",
    input: "origin",
    why: "an origin that did not answer is a fact about this run, on every page that names it",
  },
  // --- type-declared: the item envelope (docs/concepts.md §Section grammar) --------------
  // The arms every non-prose section gets, whatever grammar it declares. A
  // grammar's OWN arms are not here: each carries its row, its lane and its
  // fixer on the manifest that declared it, and `passRows` composes them in.
  //
  // `declared`, not `warning`. The severity column is a CEILING
  //, and a section's `severity: "error"` raises this arm — so a fixed
  // `warning` here would claim a ceiling the engine does not honour.
  { id: "grammar-unparsed", kind: "type-declared", severity: "declared", lane: "grammar-review" },
  // docs/concepts.md §The judge and its states: a line whose marker or separator dialect differs
  // from the engine's. INFO and opt-in: the corpus's own dialect is not a
  // defect, and this is the only row whose fixer rewrites one.
  { id: "canonical-form", kind: "type-declared", severity: "info" },
  // `retype` needs a declared replacement; an abstract type names descendants,
  // which is a choice, so this row queues.
  { id: "abstract-type", kind: "LAW", severity: "error", lane: "type-review" },
  { id: "tag-form", kind: "LAW", severity: "error", lane: "tag-review" },
  { id: "tag-requires-link", kind: "type-declared", severity: "declared", lane: "link-review" },
  { id: "instances", kind: "type-declared", severity: "declared", lane: "type-review" },
  // docs/constitution.md §Types: the page-wide arm. `declared` because `body.severity`
  // moves it, so a fixed value here would claim a ceiling the engine does not
  // honour. No fixer: restoring a mutated body is judgment.
  {
    id: "body-append-only",
    kind: "type-declared",
    severity: "declared",
    lane: "grammar-review",
    needsBase: true,
  },
  // docs/constitution.md §Vocabularies: the two laws every vocabulary shares, on
  // authored values. A fixed `error` — outside the section's ratchet.
  { id: "vocabulary-alias-target", kind: "LAW", severity: "error", lane: "category-review" },
  { id: "vocabulary-retired", kind: "LAW", severity: "error", lane: "category-review" },

  // --- LAW: the installed skills against the running binary (docs/cli.md §skills)
  // Machine-local state — the install and the binary both live outside the
  // committed snapshot — so the run-external severity law caps this pass at
  // warning: a `check` that went red because a machine is behind would flake on
  // every machine that is not the author's.
  { id: "skills-stale", kind: "LAW", severity: "warning", lane: "skills-review", input: "shell" },
  {
    id: "skills-missing",
    kind: "LAW",
    severity: "info",
    advisory: "skills update",
    input: "shell",
  },
  // docs/cli.md §brief: the brief is generated per install, so a
  // stale one is machine-local state — info, with the verb that refreshes it.
  { id: "brief-stale", kind: "LAW", severity: "info", advisory: "check --write", input: "shell" },
  // The installed marker hooks against the ones this build writes: a
  // hook from an older build runs that build's contract on every commit.
  // Machine-local, so warning is the ceiling; the reinstall is the fixer.
  { id: "hook-stale", kind: "LAW", severity: "warning", fixer: "hook install", input: "shell" },

  // --- the judge's own rows (docs/concepts.md §The gate, docs/concepts.md §Findings and routing) -----
  // P4 needs a base: an Obsidian rename that drops the alias ritual is the one
  // transition the staged gate could not see. The fixer EXISTS, so
  // this row is the slice's one fix-routed finding.
  {
    id: "renamed-without-alias",
    kind: "LAW",
    severity: "error",
    fixer: "frontmatter-set",
    needsBase: true,
  },
  { id: "exception-stale", kind: "LAW", severity: "warning", lane: "exception-review" },
  { id: "exception-illegal", kind: "LAW", severity: "error", lane: "exception-review" },
];
