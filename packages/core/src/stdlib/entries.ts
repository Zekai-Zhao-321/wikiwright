// docs/extending.md §What a module registers (the standard library registers through the same API a kit
// uses) · docs/constitution.md (the two parameters) · docs/concepts.md
//
// Dated entries: a Timeline, a Changelog, and the `entry` kind of a History
// section. The smallest of the three first-party grammars, and therefore the one
// that says soonest whether the API is real.
import { z } from "zod";
import type { Fields, ItemBase } from "../grammar/index.ts";
import { defineArm, defineGrammar, defineModule } from "../modules/index.ts";

// ---------------------------------------------------------------------------
// the item shape and its parser (moved out of the kernel)

export interface EDate {
  raw: string;
  start: string;
  end?: string;
  precision: "year" | "month" | "day";
  approximate: boolean;
}

export interface EntryItem extends ItemBase {
  kind: "entry";
  date?: EDate;
  separator?: string;
  text: string;
}

// EDTF-lite (docs/concepts.md §Section grammar): ~? YYYY[-MM[-DD]] [range] [sep text]
const D_PART = String.raw`\d{4}(?:-\d{2}(?:-\d{2})?)?`;
const APPROX = String.raw`(?:~|约|circa\s+|c\.\s?)`;
const RANGE_SEP = String.raw`(?:→|->|–|—|\.\.|\bto\b)`;
// Group 1 is the whole edate: `EDate.raw` is the span a writer re-emits, not the
// line (docs/concepts.md §Section grammar).
const ENTRY_HEAD = new RegExp(
  `^((${APPROX})?(${D_PART})(?:\\s*${RANGE_SEP}\\s*(${APPROX})?(${D_PART}))?)(?:\\s*([—:-])[ \\t]+(.*)|\\s*$)`,
  "u",
);

function precisionOf(ymd: string): "year" | "month" | "day" {
  const parts = ymd.split("-").length;
  return parts >= 3 ? "day" : parts === 2 ? "month" : "year";
}

export function parseEntry(text: string): Fields<EntryItem> {
  const matched = ENTRY_HEAD.exec(text);
  if (matched === null || matched[3] === undefined) return { kind: "entry", text };
  const start = matched[3];
  const date: EDate = {
    raw: (matched[1] ?? "").trimEnd(),
    start,
    precision: precisionOf(start),
    approximate: matched[2] !== undefined || matched[4] !== undefined,
  };
  if (matched[5] !== undefined) date.end = matched[5];
  const item: Fields<EntryItem> = {
    kind: "entry",
    text: (matched[7] ?? "").trim(),
    date,
  };
  if (matched[6] !== undefined) item.separator = matched[6];
  return item;
}

export default defineModule({
  id: "entries",
  grammars: {
    entries: defineGrammar({
      kinds: ["entry"],
      form: "- YYYY[-MM[-DD]] — text",
      parse: (text) => parseEntry(text),
      // docs/concepts.md §The judge and its states: the engine's dialect for a dated entry — an
      // em-dash separator. A `:` or `-` is a dialect the corpus writes; the arm
      // that counts it is the kernel's and its row is `info`.
      canonicalize: (item) => {
        const entry = item as unknown as EntryItem;
        if (entry.date === undefined || entry.separator === undefined) return undefined;
        if (entry.separator === "\u2014") return undefined;
        return `- ${entry.date.raw} \u2014 ${entry.text}`;
      },
      params: {
        // `optional → required` is the tightening; the reverse is a relaxation.
        date: {
          introduction: "any-depth",
          value: z.enum(["required", "optional"]),
          law: { tightenOneWay: ["optional", "required"] },
        },
        // docs/extending.md: append-only governs the section's lines, and
        // `free` governs nothing — which is why the effect names its value.
        lifecycle: {
          introduction: "any-depth",
          value: z.enum(["append-only", "free"]),
          law: { tightenOneWay: ["free", "append-only"] },
          effect: { equals: "append-only", effect: "forbids-mutation" },
        },
      },
      arms: [
        defineArm({
          id: "entry-date-missing",
          lane: "grammar-review",
          row: "declared",
          // NOT `on: { param: "date", equals: "required" }`, though the arm can
          // only fire there: `on` feeds the coverage count, and narrowing it
          // would move a number this slice has no measurement for. The arm
          // checks the parameter itself instead. Left as a question for the
          // coverage work, not smuggled into a code move.
          run: (item, ctx) => {
            const entry = item as unknown as EntryItem;
            if (entry.kind !== "entry" || ctx.params["date"] !== "required") return;
            if (entry.date !== undefined) return;
            ctx.emit(
              "entry-date-missing",
              entry.line,
              `entry carries no date, and section "${ctx.section.heading}" requires one`,
              { section: ctx.section.heading },
              entry.raw,
              "prefix the entry with a date at any precision (YYYY, YYYY-MM, YYYY-MM-DD), then the separator",
            );
          },
        }),
        // docs/concepts.md: the base's items are a PREFIX of the draft's, and
        // the first differing item is the finding's. The kernel hands over both
        // revisions' items; what "mutated" means for a dated entry is this
        // module's to say.
        defineArm({
          id: "entry-mutated",
          lane: "grammar-review",
          row: "declared",
          on: { param: "lifecycle", equals: "append-only" },
          needsBase: true,
          severityDefault: "error",
          runTransition: (ctx) => {
            for (let i = 0; i < ctx.base.length; i += 1) {
              const was = ctx.base[i];
              const now = ctx.current[i];
              if (was === undefined || now?.raw === was.raw) continue;
              ctx.count("entry_mutated");
              ctx.emit(
                "entry-mutated",
                now?.line,
                `section "${ctx.section.heading}" is append-only; entry ${i + 1} was changed or removed`,
                { section: ctx.section.heading, entry: i + 1 },
                `${ctx.section.heading}|${was.raw}`,
                "restore the entry and record the correction as a NEW dated entry",
              );
              break;
            }
          },
        }),
      ],
    }),
  },
});
