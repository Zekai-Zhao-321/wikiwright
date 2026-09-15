// docs/extending.md §What a module registers · docs/constitution.md (the nine parameters and their
// combination law) · docs/concepts.md §Section grammar, docs/concepts.md
//
// Categorised claims carrying provenance on the line. The largest of the three
// first-party grammars: if the API can express this one, it can express a kit's.
import { z } from "zod";
import { normalizeIdentity } from "../identity/index.ts";
import {
  type ArmContext,
  defineArm,
  defineGrammar,
  defineModule,
  defineVocabulary,
} from "../modules/index.ts";
import {
  type ClaimItem,
  PROVENANCE_FORMS,
  type ProvenanceClause,
  parseClaim,
} from "./claims-parse.ts";
import { claimIdentity, isCorrection, landingArm, transitionArm } from "./claims-transition.ts";

/** The vocabulary this grammar's category arms read; the module declares it below. */
const CATEGORIES = "categories";
/** The vocabulary the `sourced` provenance form's tag is drawn from. */
const SOURCES = "sources";

const asClaim = (item: { kind: string }): ClaimItem | undefined =>
  item.kind === "claim" ? (item as unknown as ClaimItem) : undefined;

const detailsOf = (claim: ClaimItem): Record<string, string> => ({
  handle: claim.handle,
  category: claim.category,
});
const evidenceOf = (claim: ClaimItem): string => `${claim.handle}|${claim.categoryId}`;

/**
 * v3 names the vocabulary (`vocabulary: "categories"`); v2 had one way of
 * saying it (`categories: "claim-classes"`). One arm, both spellings — a
 * half-read vocabulary is the silent-exclusion mode.
 */
const readsCategories = (ctx: ArmContext): boolean =>
  ctx.params["categories"] === "claim-classes" || ctx.params["vocabulary"] === CATEGORIES;

/**
 * The claim's lifecycle class, or undefined — which is also what an UNREGISTERED
 * category gives, and what `unknown-category` reports. A registered entry that
 * carries no `class` reads as unregistered here; that is the shipped behaviour,
 * preserved rather than corrected in a code move.
 */
const classOf = (ctx: ArmContext, claim: ClaimItem): string | undefined => {
  if (!readsCategories(ctx)) return undefined;
  const entry = ctx.vocabulary(CATEGORIES)?.entries.get(claim.categoryId);
  return entry?.["class"] as string | undefined;
};

/**
 * The category entry's negative selector, for the CANONICAL spelling only.
 *
 * The asymmetry is deliberate and preserved: the shipped `categoryOwnedBy` map
 * was built without the alias loop its sibling class map has, so an aliased
 * category never triggered `owned-by`. That reads like a latent defect rather
 * than a rule, but it is behaviour, and a code move is the wrong place to change
 * a verdict. Written down here so the next reader meets it instead of finding it.
 */
const ownedByOf = (
  ctx: ArmContext,
  claim: ClaimItem,
): { types?: readonly string[]; tags?: readonly string[] } | undefined => {
  const view = ctx.vocabulary(CATEGORIES);
  if (view?.uses.get(claim.categoryId)?.alias !== false) return undefined;
  const ownedBy = view.entries.get(claim.categoryId)?.["owned_by"] as
    | { not_on?: { types?: readonly string[]; tags?: readonly string[] } }
    | undefined;
  return ownedBy?.not_on;
};

/** docs/concepts.md §Section grammar: the provenance forms that carry the least weight this grammar admits. */
const isWeak = (provenance: ProvenanceClause): boolean => {
  if (provenance.form === "legacy" || provenance.form === "recorded") return true;
  return provenance.form === "inferred" && provenance.refShape === "shorthand";
};

export default defineModule({
  id: "claims",
  // The brief renders a vocabulary's entries with their properties verbatim
  // and says nothing about what a property MEANS: that is the module's to say.
  skills: [
    {
      heading: "Categories, by lifecycle class",
      body: "A *supersede* category holds one truth: a later value replaces the earlier one and the engine writes the History line. An *accumulate* category collects dated observations: a later contrary one is appended, never a supersession. A *journal-only* category never becomes a standing fact.",
    },
  ],
  // docs/concepts.md §Findings and routing: the lane only this module's arms queue to. `category-review`
  // is the kernel's, because the two vocabulary laws queue there too.
  lanes: ["provenance-backfill"],
  // docs/constitution.md §Vocabularies: the two vocabularies this module owns, each with
  // the properties its OWN entries carry. The four every vocabulary shares —
  // description, aliases, status, replaced_by — are the kernel's, because the
  // alias and retirement laws are judged outside any section.
  vocabularies: {
    categories: defineVocabulary({
      // The negative selector names types and tags; the kernel holds both to
      // the registry through these paths and reads nothing else in them.
      typeRefs: ["owned_by.not_on.types"],
      tagRefs: ["owned_by.not_on.tags"],
      entry: z.strictObject({
        // docs/concepts.md §Section grammar: the lifecycle class the transition arm reads.
        class: z.enum(["supersede", "accumulate", "journal-only"]),
        // The negative selector the `owned-by` arm judges.
        owned_by: z
          .strictObject({
            not_on: z.strictObject({
              types: z.array(z.string().min(1)).min(1).optional(),
              tags: z.array(z.string().min(1)).min(1).optional(),
            }),
          })
          .optional(),
      }),
    }),
    // The `sourced` provenance form's tag set. Its entries carry nothing beyond
    // the shared four: the vocabulary IS the closed set of admissible tags.
    sources: defineVocabulary({}),
  },
  grammars: {
    claims: defineGrammar({
      kinds: ["claim"],
      form: "- [category] core (provenance)",
      // docs/constitution.md §Vocabularies: a claim's category is checked against this one.
      vocabulary: CATEGORIES,
      parse: parseClaim,
      // docs/extending.md §An arm: the two capabilities the kernel's
      // diff calls. Registered here rather than imported there, which is what
      // makes `write --correct` and the transition arm mean something under a
      // kit's grammar instead of only under this one.
      identityOf: (item) => {
        const claim = asClaim(item);
        return claim === undefined ? undefined : claimIdentity(claim);
      },
      isCorrection: (before, after) => {
        const a = asClaim(before);
        const b = asClaim(after);
        return a !== undefined && b !== undefined && isCorrection(a, b);
      },
      // docs/extending.md §A grammar: a History section admits the dated changelog entry,
      // which is the `entries` module's kind. Declaring the hand-off keeps the
      // kernel dispatching it; importing `entries` here would be the coupling
      // the layering exists to prevent.
      delegates: [{ to: "entry", on: { param: "role", equals: "history" } }],
      // docs/extending.md §A grammar: `items` is the section AUTHOR's allow-list over the
      // kinds this grammar can produce, read only where the section is a History
      // section. Not the same declaration as `delegates` above, and collapsing
      // them would silently widen a history section that declares no `items`.
      admits: { param: "items", on: { param: "role", equals: "history" } },
      // docs/concepts.md §The judge and its states: the engine's dialect for a claim — an ASCII
      // `[category]` bracket. The 【】 form is a dialect a corpus writes and not
      // a defect, which is why the arm that counts it is `info` and why only
      // `fix --rule canonical-form` rewrites it.
      canonicalize: (item) => {
        const m = /^【([^【】\n]+)】\s*(.*)$/u.exec(item.raw);
        return m === null ? undefined : `- [${m[1] ?? ""}] ${m[2] ?? ""}`;
      },
      // docs/constitution.md §Vocabularies: which values of a vocabulary a claim
      // authored. `sources` has one consumer on a page — the `sourced` form's
      // tag; a `sourced` clause recognized by its date tail alone
      // carries no tag and is counted by `sourced-inferred` instead.
      observes: (vocabulary, item) => {
        const claim = asClaim(item);
        if (claim === undefined) return [];
        if (vocabulary === CATEGORIES) return [claim.category];
        if (vocabulary !== SOURCES) return [];
        const provenance = claim.provenance;
        return provenance?.form === "sourced" && provenance.source !== undefined
          ? [provenance.source]
          : [];
      },
      params: {
        provenance: {
          introduction: "any-depth",
          value: z.enum(["required", "optional"]),
          law: { tightenOneWay: ["optional", "required"] },
        },
        // docs/constitution.md: the three that may not be first-declared
        // by a child on an inherited grammar. `forms` and `sources` decide which
        // trailing parentheticals are markers, so narrowing either re-keys every
        // claim on every page of the type; `role` selects which arms run at all.
        forms: {
          introduction: "with-grammar",
          value: z.array(z.enum(PROVENANCE_FORMS)).min(1),
          law: "subset-only",
        },
        sources: {
          introduction: "with-grammar",
          value: z.array(z.string().min(1)),
          law: "subset-only",
          // Each is an entry of the `sources` vocabulary, where the
          // bundle declares one.
          entries: { vocabulary: SOURCES },
        },
        // docs/extending.md: a supersession REWRITES the open section — it
        // moves a claim out of it and into History — which is what the kernel's
        // page-wide append-only law contradicts (docs/constitution.md §Types).
        history: {
          introduction: "any-depth",
          value: z.string().min(1),
          law: "identity",
          effect: { effect: "requires-rewrite" },
        },
        // docs/concepts.md §Section grammar: a section is the open one or the history one,
        // and `role` is the single declaration of which — a history section
        // that points at a history section of its own is its own history.
        role: {
          introduction: "with-grammar",
          value: z.literal("history"),
          law: "identity",
          excludes: ["history"],
        },
        categories: {
          introduction: "any-depth",
          value: z.literal("claim-classes"),
          law: "identity",
        },
        only: {
          introduction: "any-depth",
          value: z.array(z.string().min(1)).min(1),
          law: "subset-only",
          // Each names an entry of the vocabulary the section bound.
          entries: {},
        },
        items: {
          introduction: "any-depth",
          value: z.array(z.enum(["claim", "entry"])).min(1),
          law: "subset-only",
        },
        inferred_ref: {
          introduction: "any-depth",
          value: z.enum(["required", "optional"]),
          law: { tightenOneWay: ["optional", "required"] },
        },
      },
      arms: [
        // docs/concepts.md §Findings and routing: the `declared` rows — the section's severity knob
        // moves these, and `warning` is what it means to author none.
        defineArm({
          id: "unknown-category",
          lane: "category-review",
          row: "declared",
          run: (item, ctx) => {
            const claim = asClaim(item);
            if (claim === undefined || !readsCategories(ctx)) return;
            const view = ctx.vocabulary(CATEGORIES);
            // docs/constitution.md §Vocabularies: judged for every authored
            // category, at the site that wrote it, known entry or not.
            ctx.vocabularyLaws(
              view?.uses.get(claim.categoryId),
              claim.category,
              claim.line,
              detailsOf(claim),
              evidenceOf(claim),
            );
            if (view === undefined || classOf(ctx, claim) !== undefined) return;
            ctx.emit(
              "unknown-category",
              claim.line,
              `[${claim.category}] is not a registered category`,
              detailsOf(claim),
              evidenceOf(claim),
              "reuse a registered category, or propose the entry through review — vocabulary sprawl is the failure mode this counts",
            );
          },
        }),
        defineArm({
          id: "journal-only-category",
          lane: "category-review",
          row: "declared",
          run: (item, ctx) => {
            const claim = asClaim(item);
            // `classOf` is undefined unless the section reads the vocabulary AND
            // the entry carries a class, so this one check is the whole gate.
            if (claim === undefined || classOf(ctx, claim) !== "journal-only") return;
            ctx.emit(
              "journal-only-category",
              claim.line,
              `[${claim.category}] is a journal-only class — it never becomes a standing fact`,
              detailsOf(claim),
              evidenceOf(claim),
              "record it in the journal as what was said, when; promote only on repetition or the owner's confirmation",
            );
          },
        }),
        // `only` narrows the section's vocabulary; the claim is a legal
        // category of the wrong section, which is a different defect from an
        // unregistered one and gets its own row.
        defineArm({
          id: "category-not-allowed",
          lane: "category-review",
          row: "declared",
          run: (item, ctx) => {
            const claim = asClaim(item);
            const only = ctx.params["only"] as readonly string[] | undefined;
            if (claim === undefined || only === undefined) return;
            if (classOf(ctx, claim) === undefined) return;
            if (only.some((c) => normalizeIdentity(c) === claim.categoryId)) return;
            ctx.emit(
              "category-not-allowed",
              claim.line,
              `section "${ctx.section.heading}" admits only [${only.join("], [")}]`,
              detailsOf(claim),
              evidenceOf(claim),
              "move the claim to the page that owns this category, or widen the section's `only` through review",
            );
          },
        }),
        // The negative selector on the category entry — the one
        // tag-scoped rule the retired editorial tier ever had.
        defineArm({
          id: "owned-by",
          lane: "category-review",
          row: "declared",
          run: (item, ctx) => {
            const claim = asClaim(item);
            if (claim === undefined) return;
            const notOn = ownedByOf(ctx, claim);
            if (notOn === undefined) return;
            const byType = (notOn.types ?? []).find((t) => (ctx.page.chain ?? []).includes(t));
            const byTag = (notOn.tags ?? []).find((tag) =>
              (ctx.page.tags ?? []).some((t) => normalizeIdentity(t) === normalizeIdentity(tag)),
            );
            if (byType === undefined && byTag === undefined) return;
            ctx.emit(
              "owned-by",
              claim.line,
              `[${claim.category}] does not belong on a page that is ${byType !== undefined ? `a ${byType}` : `tagged ${String(byTag)}`}`,
              detailsOf(claim),
              evidenceOf(claim),
              "record the claim on the page the category is about — this one routes, it does not accumulate",
            );
          },
        }),
        defineArm({
          id: "claim-provenance",
          lane: "provenance-backfill",
          row: "declared",
          run: (item, ctx) => {
            const claim = asClaim(item);
            if (claim === undefined) return;
            if (ctx.params["provenance"] === "required" && claim.provenance === undefined) {
              ctx.emit(
                "claim-provenance",
                claim.line,
                `[${claim.category}] carries no provenance clause, and this section requires one`,
                detailsOf(claim),
                evidenceOf(claim),
                "add one of the section's declared provenance forms; the engine never stamps one for you",
              );
              return;
            }
            // The bundle declared that an `inferred` claim names something
            // resolvable. Until then the same line is `provenance-weak` (info).
            if (
              ctx.params["inferred_ref"] !== "required" ||
              claim.provenance?.form !== "inferred" ||
              claim.provenance.refShape !== "shorthand"
            ) {
              return;
            }
            ctx.emit(
              "claim-provenance",
              claim.line,
              `[${claim.category}] infers from "${claim.provenance.ref ?? ""}", which is not a resolvable reference, and this section requires one`,
              detailsOf(claim),
              evidenceOf(claim),
              "cite the archive item or the page the inference rests on — a shorthand ref names nothing a reader can open",
            );
          },
        }),
        defineArm({
          id: "closed-claim-in-facts",
          lane: "grammar-review",
          row: "declared",
          run: (item, ctx) => {
            const claim = asClaim(item);
            if (claim?.closing === undefined || ctx.params["role"] === "history") return;
            ctx.emit(
              "closed-claim-in-facts",
              claim.line,
              `[${claim.category}] carries a closing clause outside a history section`,
              detailsOf(claim),
              evidenceOf(claim),
              `move the retired claim to "${(ctx.params["history"] as string | undefined) ?? "History"}" — an open section holds open claims`,
            );
          },
        }),
        defineArm({
          id: "history-marker",
          lane: "grammar-review",
          row: "declared",
          // `--propose` only: the closing clause with its dates as placeholders.
          fixer: "history-close",
          run: (item, ctx) => {
            const claim = asClaim(item);
            if (claim === undefined || ctx.params["role"] !== "history") return;
            if (claim.closing !== undefined) return;
            ctx.emit(
              "history-marker",
              claim.line,
              `[${claim.category}] is a claim-kind history item with no closing clause`,
              detailsOf(claim),
              evidenceOf(claim),
              "close it with `valid X→Y, superseded Z` or `retracted Z`, or write the line as a dated changelog entry",
            );
          },
        }),
        // The census rows: counted, never ratcheted. A count is not a verdict.
        defineArm({
          id: "marker-like",
          row: "info",
          run: (item, ctx) => {
            const claim = asClaim(item);
            if (claim === undefined) return;
            for (const body of claim.markerLike) {
              ctx.emit(
                "marker-like",
                claim.line,
                "a trailing parenthetical opens with a clause keyword and does not complete; it stays in the core",
                { ...detailsOf(claim), paren: body },
                `${evidenceOf(claim)}|${body}`,
              );
            }
          },
        }),
        defineArm({
          id: "sourced-inferred",
          row: "info",
          run: (item, ctx) => {
            const claim = asClaim(item);
            if (claim?.provenance?.form !== "sourced" || claim.provenance.source !== undefined) {
              return;
            }
            // Recognized by the ISO-date tail alone: no tag from the section's
            // `sources` matched. Every other marker either matches a clause shape
            // or a declared tag; this one matches a punctuation habit, and it sets
            // claim identity — so the census sees it (docs/concepts.md §Section grammar).
            ctx.emit(
              "sourced-inferred",
              claim.line,
              "a trailing parenthetical was read as `sourced` because it ends in a date, not because a declared source tag matched; it left the core",
              { ...detailsOf(claim), form: "sourced", paren: claim.provenance.raw },
              `${evidenceOf(claim)}|${claim.provenance.raw}`,
            );
          },
        }),
        // Recognized from the token's SHAPE, with no keyword to read: the same
        // admission the date-tail `sourced` dialect makes about itself. It sets
        // claim identity, so a marker rule the census cannot see is the silent
        // exclusion `marker-like` exists to prevent. The census counts
        // RECOGNITIONS, not winners: a path that yielded the provenance slot to
        // an adjacent keyword clause still left the core, so it is
        // still counted here — and the count no longer depends on which
        // parenthetical the writer typed first.
        defineArm({
          id: "provenance-path-only",
          row: "info",
          run: (item, ctx) => {
            const claim = asClaim(item);
            if (claim === undefined) return;
            const pathOnly =
              claim.provenance?.dialect === "path-only"
                ? claim.provenance
                : claim.provenanceExtra?.find((clause) => clause.dialect === "path-only");
            if (pathOnly === undefined) return;
            ctx.emit(
              "provenance-path-only",
              claim.line,
              "a bare path under a declared source root was read as `inferred` provenance; it left the core",
              { ...detailsOf(claim), form: "inferred", ref: pathOnly.ref ?? "" },
              `${evidenceOf(claim)}|${pathOnly.raw}`,
            );
          },
        }),
        defineArm({
          id: "provenance-weak",
          row: "info",
          run: (item, ctx) => {
            const claim = asClaim(item);
            if (claim?.provenance === undefined || !isWeak(claim.provenance)) return;
            ctx.emit(
              "provenance-weak",
              claim.line,
              `provenance form "${claim.provenance.form}" is the weakest kind the section admits`,
              { ...detailsOf(claim), form: claim.provenance.form },
              evidenceOf(claim),
            );
          },
        }),
        defineArm({
          id: "hearsay",
          row: "info",
          run: (item, ctx) => {
            const claim = asClaim(item);
            if (claim?.provenance?.form !== "stated-by") return;
            ctx.emit(
              "hearsay",
              claim.line,
              "third-party attestation, not a first-hand statement",
              { ...detailsOf(claim), form: "stated-by" },
              evidenceOf(claim),
            );
          },
        }),
        // The transition arms, which the `history` declaration turns on. Their
        // bodies are this module's (claims-transition.ts): the kernel parses
        // both revisions and hands over the items, and reads nothing inside one.
        defineArm({
          id: "claims-transition",
          lane: "grammar-review",
          row: "declared",
          on: { param: "history" },
          needsBase: true,
          severityDefault: "error",
          runTransition: transitionArm,
        }),
        defineArm({
          id: "claim-landing",
          row: "info",
          on: { param: "history" },
          needsBase: true,
          runTransition: landingArm,
        }),
      ],
    }),
  },
});
