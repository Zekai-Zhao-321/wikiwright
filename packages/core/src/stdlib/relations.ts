// docs/extending.md §What a module registers · docs/constitution.md (the three parameters)
// docs/concepts.md · docs/constitution.md §Vocabularies
//
// Labelled links: `- <label> [[Target]]`. Its arms are the vocabulary's, which is
// why the module declares which vocabulary it reads.
import { z } from "zod";
import type { Fields, ItemBase } from "../grammar/index.ts";
import { codeUnitCompare, normalizeIdentity } from "../identity/index.ts";
import {
  type ArmContext,
  defineArm,
  defineGrammar,
  defineModule,
  defineVocabulary,
  type TransitionContext,
  type TransitionItem,
} from "../modules/index.ts";

// ---------------------------------------------------------------------------
// the item shape and its parser (moved out of the kernel)

export interface RelationItem extends ItemBase {
  kind: "relation";
  label: string;
  labelId: string;
  target: string;
  display?: string;
  rest: string;
}

// `label ::= ( letter | digit | "_" | "-" )+` (docs/concepts.md §Section grammar) — letter and digit
// are Unicode. An ASCII-only label made `- 关系 [[X]]` unparsed in exactly the
// bilingual direction this project treats as its top duplicate risk.
const RELATION_ITEM =
  /^([\p{L}\p{N}_-]+)\s+\[\[([^\][|#\n]+)(?:#[^\][|\n]*)?(?:\|([^\][\n]*))?\]\](?:\s+(.*))?$/u;

export function parseRelation(text: string): Fields<RelationItem> | undefined {
  const matched = RELATION_ITEM.exec(text);
  if (matched === null) return undefined;
  const label = matched[1] ?? "";
  const item: Fields<RelationItem> = {
    kind: "relation",
    label,
    labelId: normalizeIdentity(label),
    target: (matched[2] ?? "").trim(),
    rest: (matched[4] ?? "").trim(),
  };
  const display = matched[3]?.trim();
  if (display !== undefined && display !== "") item.display = display;
  return item;
}

/**
 * docs/constitution.md §Sections: a relation label's `range`, matched THROUGH the target's
 * `extends` chain. ONE predicate: the `relation-range` arm asks it of a page's
 * target and `vocabulary show` asks it of every concrete type to compute
 * `admits`, so the verb's answer and the finding cannot disagree. An absent
 * `range` admits everything — that is what "no range" means, and saying it here
 * is why the verb prints `range: "any"` without a second rule.
 *
 * It lives with the module because it is a relations concept, not a string
 * utility: it reads a label's `range` against a type chain.
 */
export function rangeAdmits(
  range: readonly string[] | undefined,
  chain: readonly string[],
): boolean {
  if (range === undefined) return true;
  return range.some((r) => chain.includes(r));
}

// ---------------------------------------------------------------------------
// the lifecycle (docs/extending.md §An arm): a relation that leaves a page
// leaves a record

/**
 * docs/extending.md §An arm: a relation's identity — its label and its
 * target, normalized. The kernel matches a base item to a draft item on this
 * string and reads nothing inside it; NUL cannot occur in either half, so two
 * relations whose label/target boundary differs cannot collide.
 */
export function relationIdentity(item: {
  readonly label?: unknown;
  readonly target?: unknown;
}): string | undefined {
  if (typeof item.label !== "string" || typeof item.target !== "string") return undefined;
  if (item.label === "" || item.target.trim() === "") return undefined;
  return `${normalizeIdentity(item.label)}\u0000${normalizeIdentity(item.target.trim())}`;
}

/** Every `label [[Target]]` a line quotes, as identities — the History landing form. */
const QUOTED_RELATION =
  /([\p{L}\p{N}_-]+)\s+\[\[([^\][|#\n]+)(?:#[^\][|\n]*)?(?:\|[^\][\n]*)?\]\]/gu;

function quotedRelations(raw: string): Set<string> {
  const out = new Set<string>();
  for (const match of raw.matchAll(QUOTED_RELATION)) {
    const identity = relationIdentity({ label: match[1], target: match[2] });
    if (identity !== undefined) out.add(identity);
  }
  return out;
}

interface RelationTransition {
  /** Base relations absent from the draft that landed in no History line. */
  removed: RelationItem[];
  /** Base relations absent from the draft that a NEW History line quotes. */
  retired: { relation: RelationItem; line: number }[];
  added: number;
  unchanged: number;
}

/**
 * The transition over two revisions of a Relations section, from the items the
 * kernel parsed under the one parser. A base relation the draft still carries
 * (by identity) is unchanged; one it does not carry either landed — a History
 * line that did not exist in the base quotes `label [[Target]]` — or was
 * removed. A relabel is a removal of one identity and an addition of another:
 * "this module diverged from REQ-003 until the code was read" is a fact worth
 * a closing line, and a count with no label and no target is not a record.
 */
function relationTransition(ctx: TransitionContext): RelationTransition {
  const history = ctx.params["history"];
  const landing = typeof history === "string" ? ctx.sectionItems(history) : undefined;
  const inherited = new Map<string, number>();
  for (const item of landing?.base ?? [])
    inherited.set(item.raw, (inherited.get(item.raw) ?? 0) + 1);
  const fresh = (landing?.current ?? []).filter((item) => {
    const remaining = inherited.get(item.raw) ?? 0;
    if (remaining > 0) {
      inherited.set(item.raw, remaining - 1);
      return false;
    }
    return true;
  });
  const relationsOf = (items: readonly TransitionItem[]): RelationItem[] =>
    items.filter((i) => i.kind === "relation") as unknown as RelationItem[];
  const survivors = new Map<string, number>();
  for (const relation of relationsOf(ctx.current)) {
    const identity = relationIdentity(relation);
    if (identity !== undefined) survivors.set(identity, (survivors.get(identity) ?? 0) + 1);
  }
  const result: RelationTransition = { removed: [], retired: [], added: 0, unchanged: 0 };
  for (const relation of relationsOf(ctx.base)) {
    const identity = relationIdentity(relation);
    if (identity === undefined) continue;
    const remaining = survivors.get(identity) ?? 0;
    if (remaining > 0) {
      survivors.set(identity, remaining - 1);
      result.unchanged += 1;
      continue;
    }
    const closing = fresh.find((item) => quotedRelations(item.raw).has(identity));
    if (closing !== undefined) result.retired.push({ relation, line: closing.line });
    else result.removed.push(relation);
  }
  for (const count of survivors.values()) result.added += count;
  return result;
}

/** The evidence key every relation arm shares: the label and its target. */
const evidenceOf = (item: RelationItem): string =>
  `${item.labelId}|${normalizeIdentity(item.target)}`;
const detailsOf = (item: RelationItem): Record<string, string> => ({
  label: item.label,
  target: item.target,
});

/** The vocabulary this grammar's arms read; the module declares it above. */
const LABELS = "relations";

const labelEntry = (
  ctx: ArmContext,
  item: RelationItem,
): { range?: readonly string[] } | undefined =>
  ctx.vocabulary(LABELS)?.entries.get(item.labelId) as { range?: readonly string[] } | undefined;

export default defineModule({
  id: "relations",
  // docs/concepts.md §Findings and routing: the lane this module's label arms queue to.
  lanes: ["label-review"],
  // docs/constitution.md §Vocabularies: a relation label's own property is its `range`.
  vocabularies: {
    relations: defineVocabulary({
      // A range names types; the kernel holds each to the registry.
      typeRefs: ["range"],
      entry: z.strictObject({
        // The legal target types, matched THROUGH the target's chain.
        range: z.array(z.string().min(1)).min(1).optional(),
      }),
    }),
  },
  grammars: {
    relations: defineGrammar({
      kinds: ["relation"],
      form: "- label [[Target]]   (an indented bullet under an item is rationale)",
      // docs/constitution.md §Vocabularies: a relation's label is checked against this one.
      vocabulary: LABELS,
      parse: (text) => parseRelation(text),
      // docs/extending.md §An arm: the identity the kernel's diff
      // matches on — the label and the target. A relation is not corrected
      // like a claim's core is: a different target or label is a different
      // relation, so `isCorrection` stays the closed default.
      identityOf: (item) =>
        item.kind === "relation" ? relationIdentity(item as unknown as RelationItem) : undefined,
      // docs/constitution.md §Vocabularies: a relation authors exactly one label.
      observes: (vocabulary, item) =>
        vocabulary === LABELS && item.kind === "relation"
          ? [(item as unknown as RelationItem).label]
          : [],
      // docs/concepts.md §Generated artifacts: a relation IS a labelled edge — the target under
      // the label — and the graph carries it as one, so coverage is a query
      // over the artifact rather than a grep over the pages.
      edges: (item) =>
        item.kind === "relation"
          ? [
              {
                to: (item as unknown as RelationItem).target,
                label: (item as unknown as RelationItem).label,
              },
            ]
          : [],
      params: {
        // A row is an obligation over a label SET: at least `min` and at most
        // `max` relations carrying any of `labels` — "implements or
        // diverges-from" is one row; one label is the one-element case.
        // Rows are keyed by the normalized set, so under `extends` a child may
        // add a conjunct, raise a `min` or add/lower a `max`, and never relax a
        // bound: every row is a conjunct of the section's obligation, and a
        // wider set is a different key that adds one rather than replacing one.
        require: {
          introduction: "any-depth",
          value: z
            .array(
              z.strictObject({
                labels: z.array(z.string().min(1)).min(1),
                min: z.number().int().min(0),
                max: z.number().int().min(0).optional(),
              }),
            )
            .min(1),
          law: { keyedBounds: { key: "labels", lower: "min", upper: "max" } },
          // Every label of a row names an entry of the vocabulary the section bound.
          entries: { key: "labels" },
        },
        // The History section a retired relation lands in — a dated line
        // quoting `label [[Target]]`. Landing one REWRITES the open section (a
        // line leaves it), which is what the kernel's page-wide append-only law
        // contradicts (docs/extending.md), exactly as a claims supersession.
        history: {
          introduction: "any-depth",
          value: z.string().min(1),
          law: "identity",
          effect: { effect: "requires-rewrite" },
        },
      },
      arms: [
        // docs/constitution.md §Vocabularies: the alias and retirement
        // laws run for every authored label, at the site that wrote it. The
        // kernel judges them; this arm only says WHICH value was authored.
        defineArm({
          id: "unknown-label",
          lane: "label-review",
          row: "declared",
          run: (item, ctx) => {
            const relation = item as unknown as RelationItem;
            ctx.vocabularyLaws(
              ctx.vocabulary(LABELS)?.uses.get(relation.labelId),
              relation.label,
              relation.line,
              detailsOf(relation),
              evidenceOf(relation),
            );
            if (ctx.vocabulary(LABELS)?.mode !== "registered") return;
            if (labelEntry(ctx, relation) !== undefined) return;
            ctx.emit(
              "unknown-label",
              relation.line,
              `"${relation.label}" is not a registered relation label`,
              detailsOf(relation),
              evidenceOf(relation),
              "reuse a registered label, or propose the entry through review — label sprawl is the failure mode this counts",
            );
          },
        }),
        // A label's `range`, matched THROUGH the target's extends chain.
        defineArm({
          id: "relation-range",
          lane: "label-review",
          row: "declared",
          run: (item, ctx) => {
            const relation = item as unknown as RelationItem;
            const range = labelEntry(ctx, relation)?.range;
            if (range === undefined) return;
            const chain = ctx.chainOf(relation.target);
            if (chain === undefined || rangeAdmits(range, chain)) return;
            // A range naming a kit's abstract type names no page: the concrete
            // types of THIS vault that satisfy it are what the author can point
            // at, so they are named beside it.
            const concrete = ctx.concreteTypesUnder(range);
            const here =
              concrete.length === 0 || concrete.every((t) => range.includes(t))
                ? ""
                : ` (here: ${concrete.join(", ")})`;
            ctx.emit(
              "relation-range",
              relation.line,
              `"${relation.label}" points at a ${chain[0] ?? "?"}; its range is ${range.join(", ")}${here}`,
              detailsOf(relation),
              evidenceOf(relation),
              "point the relation at a page of a type in the label's range, or widen the range through review",
            );
          },
        }),
        defineArm({
          id: "relation-target-unresolved",
          lane: "link-review",
          row: "declared",
          run: (item, ctx) => {
            const relation = item as unknown as RelationItem;
            if (ctx.resolves(relation.target) !== false) return;
            ctx.emit(
              "relation-target-unresolved",
              relation.line,
              `relation target [[${relation.target}]] resolves to no page`,
              detailsOf(relation),
              evidenceOf(relation),
              "write the target page, or correct the name — a relation to nothing is a dangling edge",
            );
          },
        }),
        // docs/extending.md §An arm: a relation that left the section and
        // landed in no History line, NAMED — label and target — under the
        // section's own severity. `relation_removed: 1` with neither was the
        // defect: a dropped `diverges-from` is exactly the edit a reviewer must
        // see, and a count is not reviewable. Counts every disposition of the
        // transition, once, here.
        defineArm({
          id: "relation-removed",
          lane: "label-review",
          row: "declared",
          needsBase: true,
          runTransition: (ctx) => {
            const history = ctx.params["history"];
            const result = relationTransition(ctx);
            for (const relation of result.removed) {
              const quoted = `${relation.label} [[${relation.target}]]`;
              ctx.emit(
                "relation-removed",
                undefined,
                `relation "${quoted}" was removed from "${ctx.section.heading}" and landed nowhere`,
                detailsOf(relation),
                evidenceOf(relation),
                typeof history === "string"
                  ? `restore it, or close it in "## ${history}" with a dated entry quoting it — "- <date> — retired ${quoted}: <why>"`
                  : `restore it, or declare \`history\` on "${ctx.section.heading}" and close it there — a relation that leaves a page leaves a record`,
              );
            }
            ctx.count("relation_unchanged", result.unchanged);
            ctx.count("relation_added", result.added);
            ctx.count("relation_retired", result.retired.length);
            ctx.count("relation_removed", result.removed.length);
          },
        }),
        // The census of the removed relations that DID land, pointing at the
        // closing line — the record the page keeps of what it believed before.
        defineArm({
          id: "relation-retired",
          row: "info",
          needsBase: true,
          runTransition: (ctx) => {
            for (const { relation, line } of relationTransition(ctx).retired) {
              ctx.emit(
                "relation-retired",
                line,
                `relation "${relation.label} [[${relation.target}]]" was closed here`,
                detailsOf(relation),
                evidenceOf(relation),
              );
            }
          },
        }),
        // `require` is the section's own occurrence law for labels — the
        // relations equivalent of a section's `min`, judged once per section,
        // which is why it is a `runSection` and not a `run`.
        defineArm({
          id: "relation-require",
          lane: "label-review",
          row: "declared",
          runSection: (items, ctx) => {
            const required = ctx.params["require"] as
              | readonly { labels: readonly string[]; min: number; max?: number }[]
              | undefined;
            if (required === undefined) return;
            const counts = new Map<string, number>();
            for (const item of items) {
              if (item.kind !== "relation") continue;
              const id = (item as unknown as RelationItem).labelId;
              counts.set(id, (counts.get(id) ?? 0) + 1);
            }
            for (const rule of required) {
              const ids = [...new Set(rule.labels.map(normalizeIdentity))].sort(codeUnitCompare);
              const count = ids.reduce((sum, id) => sum + (counts.get(id) ?? 0), 0);
              if (count >= rule.min && (rule.max === undefined || count <= rule.max)) continue;
              const bound =
                count < rule.min ? `at least ${rule.min}` : `at most ${String(rule.max ?? 0)}`;
              const named = rule.labels.join(" or ");
              ctx.emit(
                "relation-require",
                ctx.section.line,
                `section "${ctx.section.heading}" carries ${count} relation(s) labelled ${named}; ${bound} required`,
                { section: ctx.section.heading, labels: rule.labels.join(", "), count },
                // Stable under reordering the declaration: the heading, then
                // the normalized labels sorted.
                `${ctx.section.heading}|${ids.join("|")}`,
                count < rule.min
                  ? `write a relation labelled ${named}, or relax the section's \`require\` through review`
                  : `remove a relation labelled ${named}, or relax the section's \`require\` through review`,
              );
            }
          },
        }),
      ],
    }),
  },
});
