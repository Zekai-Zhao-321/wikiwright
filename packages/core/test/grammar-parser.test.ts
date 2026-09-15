// docs/concepts.md §Section grammar (the item EBNF; "a marker is a complete clause"; the
// rationale rule; the two History item kinds) · docs/constitution.md §Sections (grammar
// declaration and its parameters)
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import {
  type GrammarItem,
  parseSections,
  type SectionBinding,
  type SectionNode,
  sectionBinding,
} from "../src/grammar/index.ts";
import { normalizeIdentity } from "../src/identity/index.ts";
import { parseDoc } from "../src/parse/index.ts";
import type { ClaimItem } from "../src/stdlib/claims-parse.ts";
import type { EntryItem } from "../src/stdlib/entries.ts";
import { standardLibrary } from "../src/stdlib/index.ts";
import type { RelationItem } from "../src/stdlib/relations.ts";

/**
 * docs/extending.md §A grammar: a binding carries its resolved dispatch chain, so a test
 * that builds one by hand supplies the registry the same way `grammarBindings`
 * does. No default: a binding with no parsers parses nothing, and the kernel
 * silently reaching for the standard library is the leak this seam removes.
 */
const STDLIB = standardLibrary();
const bind = (
  kernel: Parameters<typeof sectionBinding>[0],
  params: Parameters<typeof sectionBinding>[1] = {},
): SectionBinding => sectionBinding(kernel, params, STDLIB);

const FACTS: SectionBinding = bind(
  { heading: "Facts", depth: 2, grammar: "claims" },
  { history: "History", provenance: "optional", categories: "claim-classes" },
);
const HISTORY: SectionBinding = bind(
  { heading: "History", depth: 2, grammar: "claims" },
  { role: "history" },
);
const RELATIONS: SectionBinding = bind({
  heading: "Relations",
  depth: 2,
  grammar: "relations",
});
const TIMELINE: SectionBinding = bind({
  heading: "Timeline",
  depth: 2,
  grammar: "entries",
});
const NOTES: SectionBinding = bind({
  heading: "Notes",
  depth: 2,
  grammar: "prose",
  aliases: ["备注"],
});
const BINDINGS = [FACTS, RELATIONS, TIMELINE, NOTES, HISTORY];

function page(body: readonly string[]): string {
  return ["---", "type: person", "tags: []", "---", "", "Lede line.", "", ...body, ""].join("\n");
}

function sectionsOf(body: readonly string[], bindings = BINDINGS): SectionNode[] {
  return parseSections(parseDoc(page(body)), bindings).sections;
}

function itemsIn(body: readonly string[], heading: string, bindings = BINDINGS): GrammarItem[] {
  const node = sectionsOf(body, bindings).find((s) => s.heading === heading);
  assert.notEqual(node, undefined, `section "${heading}" was bound`);
  return node?.items ?? [];
}

function oneClaim(line: string): ClaimItem {
  const items = itemsIn(["## Facts", line], "Facts");
  assert.equal(items.length, 1);
  const item = items[0];
  assert.equal(item?.kind, "claim", `"${line}" parses as a claim`);
  return item as ClaimItem;
}

describe("claims: the six provenance forms the grammar declares (docs/concepts.md §Section grammar)", () => {
  it("recognizes stated, stated-by, inferred, recorded and legacy", () => {
    assert.equal(oneClaim("- [role] data engineer (stated 2026-08-14)").provenance?.form, "stated");
    assert.equal(
      oneClaim("- [role] data engineer (stated by Ada Byron, mail 2026-05-25)").provenance?.form,
      "stated-by",
    );
    assert.equal(
      oneClaim("- [role] data engineer (inferred, raw/mail/2026-05-25--x/)").provenance?.form,
      "inferred",
    );
    assert.equal(
      oneClaim("- [role] data engineer (recorded 2026-08-14)").provenance?.form,
      "recorded",
    );
    assert.equal(oneClaim("- [role] data engineer (legacy)").provenance?.form, "legacy");
  });

  it("a `;` inside the envelope and a free remainder after the first clause are legal", () => {
    const claim = oneClaim("- [role] data engineer (stated 2026-08-16; chatlog)");
    assert.equal(claim.provenance?.form, "stated");
    assert.equal(claim.core, "data engineer", "the whole envelope left the core");
  });

  it("an inferred ref is classified path-shaped or shorthand, never invented", () => {
    assert.equal(
      oneClaim("- [role] x (inferred, raw/mail/2026-05-25--x/)").provenance?.refShape,
      "path",
    );
    assert.equal(oneClaim("- [role] x (inferred, [[Some Page]])").provenance?.refShape, "wikilink");
    assert.equal(oneClaim("- [role] x (inferred, same)").provenance?.refShape, "shorthand");
  });

  it("sourced recognizes a declared source tag or an ISO-dated tail, and nothing else", () => {
    const sourced: SectionBinding = { ...FACTS, params: { ...FACTS.params, sources: ["chatlog"] } };
    const bindings = [sourced, RELATIONS, TIMELINE, NOTES, HISTORY];
    const byTag = itemsIn(["## Facts", "- [role] x (chatlog thread on hiring)"], "Facts", bindings);
    assert.equal((byTag[0] as ClaimItem).provenance?.form, "sourced");
    assert.equal((byTag[0] as ClaimItem).core, "x");
    const byDate = itemsIn(
      ["## Facts", "- [role] x (notesync scan 2031-07-25)"],
      "Facts",
      bindings,
    );
    assert.equal((byDate[0] as ClaimItem).provenance?.form, "sourced");
    const neither = itemsIn(["## Facts", "- [role] x (a plain aside)"], "Facts", bindings);
    assert.equal((neither[0] as ClaimItem).provenance, undefined);
    assert.equal((neither[0] as ClaimItem).core, "x (a plain aside)", "core keeps the prose paren");
  });

  it("a form the section does not declare does not recognize", () => {
    const narrow: SectionBinding = { ...FACTS, params: { ...FACTS.params, forms: ["stated"] } };
    const items = itemsIn(["## Facts", "- [role] x (legacy)"], "Facts", [
      narrow,
      RELATIONS,
      TIMELINE,
      NOTES,
      HISTORY,
    ]);
    const claim = items[0] as ClaimItem;
    assert.equal(claim.provenance, undefined);
    assert.deepEqual(claim.markerLike, ["legacy"], "counted as marker-like, not read as a marker");
    assert.equal(claim.core, "x (legacy)");
  });
});

describe("the recognizer rule: a marker is a complete clause (docs/concepts.md §Section grammar)", () => {
  it("keyword-opened parentheticals that do not complete stay in the core", () => {
    for (const [line, core] of [
      ["- [doc] study permit (valid to 2034-04-09)", "study permit (valid to 2034-04-09)"],
      ["- [doc] lease (valid 2026-08-20 → 2026-08-30)", "lease (valid 2026-08-20 → 2026-08-30)"],
      ["- [habit] counts (stated bars, not guesses)", "counts (stated bars, not guesses)"],
    ] as const) {
      const claim = oneClaim(line);
      assert.equal(claim.core, core, `${line}: the domain fact survives`);
      assert.equal(claim.markerLike.length, 1, `${line}: counted as marker-like`);
      assert.equal(claim.provenance, undefined);
    }
  });

  it("core is the item text minus MARKER parentheticals only", () => {
    const claim = oneClaim("- [preference] likes hotpot (casual aside) (stated 2026-08-14)");
    assert.equal(claim.core, "likes hotpot (casual aside)");
    assert.equal(claim.provenance?.form, "stated");
    assert.equal(claim.markerLike.length, 0, "a prose paren is core text, not marker-like");
  });

  it("clauses split across two parentheticals both read", () => {
    const items = itemsIn(
      [
        "## History",
        "- [housing] Riverside (stated 2026-08-20) (valid 2026-08-20→2026-09-08, superseded 2026-09-09)",
      ],
      "History",
    );
    const claim = items[0] as ClaimItem;
    assert.equal(claim.provenance?.form, "stated");
    assert.equal(claim.closing?.kind, "superseded");
    assert.equal(claim.core, "Riverside");
  });

  it("full-width （） parentheticals classify exactly like ASCII ones", () => {
    const claim = oneClaim("- [address] lives at 100 King St （stated 2026-08-14）");
    assert.equal(claim.core, "lives at 100 King St");
    assert.equal(claim.provenance?.form, "stated");
  });

  it("trailing sentence punctuation after the envelope stays in the core", () => {
    const claim = oneClaim("- [role] data engineer (stated 2026-08-14).");
    assert.equal(claim.core, "data engineer.");
    assert.equal(claim.provenance?.form, "stated");
  });

  it("identity is exact normalized equality and the handle is sha256 of the core", () => {
    const claim = oneClaim("- [identity] Main (stated 2026-08-14)");
    const expected = `#${createHash("sha256").update(normalizeIdentity("Main")).digest("hex").slice(0, 8)}`;
    assert.equal(claim.coreId, normalizeIdentity("Main"));
    assert.equal(claim.handle, expected);
    assert.notEqual(claim.handle, oneClaim("- [identity] Mainland (stated 2026-08-14)").handle);
  });
});

describe("the rationale rule and what is not an item (docs/concepts.md §Section grammar)", () => {
  it("an indented list item is rationale in every grammar, never an item", () => {
    const facts = itemsIn(
      ["## Facts", "- [role] engineer (stated 2026-08-14)", "  - why: said in the standup"],
      "Facts",
    );
    assert.equal(facts.length, 1, "the indented bullet is not a second item");
    assert.deepEqual(
      facts[0]?.rationale.map((r) => r.text),
      ["why: said in the standup"],
    );
    const relations = itemsIn(
      ["## Relations", "- peer_of [[Some Page]]", "  - met at the guild"],
      "Relations",
    );
    assert.equal(relations.length, 1);
    assert.equal(relations[0]?.rationale.length, 1);
  });

  it("an indented [category] bullet is rationale, not a claim (CLAIM_BULLET is deleted)", () => {
    const items = itemsIn(
      ["## Facts", "- [role] engineer (stated 2026-08-14)", "  - [role] not a second claim"],
      "Facts",
    );
    assert.equal(items.length, 1);
    assert.equal(items[0]?.rationale.length, 1);
  });

  it("non-list lines inside a grammar section are prose and legal", () => {
    const node = sectionsOf(["## Facts", "Some framing prose.", "- [role] engineer"]).find(
      (s) => s.heading === "Facts",
    );
    assert.equal(node?.items.length, 1);
    assert.equal(node?.proseLines, 1);
  });

  it("checkbox and letterless bullets are not claims — they are unparsed items", () => {
    for (const line of ["- [ ] a task", "- [x] done", "- [?] unknown", "- [[Some Page]] link"]) {
      const items = itemsIn(["## Facts", line], "Facts");
      assert.equal(items[0]?.kind, "unparsed", `${line} is not a claim`);
    }
  });

  it("fenced code is never walked", () => {
    const items = itemsIn(
      ["## Facts", "```", "- [role] engineer (stated 2026-08-14)", "```"],
      "Facts",
    );
    assert.deepEqual(items, []);
  });

  it("a heading at the wrong depth does not open a grammar section", () => {
    const node = sectionsOf(["### Facts", "- [role] engineer"]).find((s) => s.heading === "Facts");
    assert.equal(node, undefined, "identity AND depth bind");
  });

  it("a declared alias heading opens the section it names", () => {
    const node = sectionsOf(["## 备注", "prose"]).find((s) => s.declared === "Notes");
    assert.notEqual(node, undefined);
    assert.equal(node?.grammar, "prose");
    assert.deepEqual(node?.items, [], "a prose section has no items");
  });
});

describe("relations and entries (docs/concepts.md §Section grammar)", () => {
  it("`- label [[Target]] free` parses; anything else is unparsed", () => {
    const items = itemsIn(
      [
        "## Relations",
        "- peer_of [[Some Page]]",
        "- mentored_by [[Some Page|display]] since 2026",
        "- a multi word label [[Some Page]]",
        "- no link at all",
      ],
      "Relations",
    );
    assert.deepEqual(
      items.map((i) => i.kind),
      ["relation", "relation", "unparsed", "unparsed"],
    );
    const first = items[0] as RelationItem;
    assert.equal(first.label, "peer_of");
    assert.equal(first.target, "Some Page");
    const second = items[1] as RelationItem;
    assert.equal(second.display, "display");
    assert.equal(second.rest, "since 2026");
  });

  it("entries carry EDTF-lite precision, approximation and ranges", () => {
    const items = itemsIn(
      [
        "## Timeline",
        "- 2026-08-14: full date",
        "- 2026-08 — month only",
        "- 2026 - year only",
        "- ~2026-08-14: approximate",
        "- 2026-08 → 2026-10: a range",
        "- no date at all",
      ],
      "Timeline",
    );
    const dates = items.map((i) => (i as EntryItem).date);
    assert.deepEqual(
      dates.map((d) => d?.precision),
      ["day", "month", "year", "day", "month", undefined],
    );
    assert.equal(dates[3]?.approximate, true);
    assert.equal(dates[4]?.end, "2026-10");
    assert.equal((items[0] as EntryItem).separator, ":");
    assert.equal((items[1] as EntryItem).separator, "—");
    assert.equal((items[0] as EntryItem).text, "full date");
  });
});

describe("a History section admits two item kinds (docs/concepts.md §Section grammar)", () => {
  it("a retired claim and a dated changelog entry live in one section", () => {
    const items = itemsIn(
      [
        "## History",
        "- [housing] Riverside (stated 2026-08-20) (valid 2026-08-20→2026-09-08, superseded 2026-09-09)",
        "- 2026-09-09: moved the housing fact after the WeChat thread",
        "- a note with no date at all",
      ],
      "History",
    );
    assert.deepEqual(
      items.map((i) => i.kind),
      ["claim", "entry", "entry"],
    );
    assert.equal((items[0] as ClaimItem).closing?.kind, "superseded");
    assert.equal((items[1] as EntryItem).date?.precision, "day");
  });

  it("a retracted closing clause reads on an accumulate retirement", () => {
    const items = itemsIn(
      ["## History", "- [preference] prefers it spicy (stated 2026-08-14; retracted 2026-09-01)"],
      "History",
    );
    const claim = items[0] as ClaimItem;
    assert.equal(claim.provenance?.form, "stated");
    assert.equal(claim.closing?.kind, "retracted");
    assert.equal(claim.core, "prefers it spicy");
  });
});

describe("a free segment does not terminate the body (docs/concepts.md §Section grammar)", () => {
  it("a clause behind a free segment still reads, and segment order decides nothing", () => {
    const inOrder = itemsIn(
      [
        "## History",
        "- [identity] lived in Toronto (stated 2026-01-02, valid 2026-01-02 → 2026-02-03, superseded 2026-02-03, per the lease)",
      ],
      "History",
    )[0] as ClaimItem;
    const behindFree = itemsIn(
      [
        "## History",
        "- [identity] lived in Toronto (stated 2026-01-02, per the lease, valid 2026-01-02 → 2026-02-03, superseded 2026-02-03)",
      ],
      "History",
    )[0] as ClaimItem;
    assert.equal(inOrder.closing?.kind, "superseded");
    assert.equal(
      behindFree.closing?.kind,
      "superseded",
      "a grammar whose verdict depends on where the prose sits is not a grammar",
    );
    assert.equal(behindFree.provenance?.form, "stated");
    assert.equal(behindFree.core, inOrder.core, "both orders excise the same envelope");
  });

  it("a body must OPEN with a clause: prose first is core text, not a marker", () => {
    const claim = oneClaim("- [role] engineer (a plain aside, legacy)");
    assert.equal(claim.provenance, undefined);
    assert.equal(claim.core, "engineer (a plain aside, legacy)");
  });

  it("the first complete clause of each slot wins, and the remainder is kept", () => {
    const claim = oneClaim("- [identity] x (stated 2026-01-02) (recorded 2026-02-03)");
    assert.equal(claim.provenance?.form, "stated");
    assert.deepEqual(
      claim.provenanceExtra?.map((p) => p.form),
      ["recorded"],
      "a second provenance clause is kept for the writer, never erased",
    );
    const closed = itemsIn(
      [
        "## History",
        "- [identity] x (valid 2026-01-02 → 2026-02-03, superseded 2026-02-03) (retracted 2026-03-04)",
      ],
      "History",
    )[0] as ClaimItem;
    assert.equal(closed.closing?.kind, "superseded");
    assert.deepEqual(
      closed.closingExtra?.map((c) => c.kind),
      ["retracted"],
    );
  });
});

describe("the label alphabet is Unicode, as the EBNF says (docs/concepts.md §Section grammar)", () => {
  it("a Han relation label parses; `letter` in the EBNF is not `ASCII letter`", () => {
    const items = itemsIn(["## Relations", "- 关系 [[Some Page]]"], "Relations");
    assert.equal(items[0]?.kind, "relation", "the bilingual case is the one aliases exist for");
    assert.equal((items[0] as RelationItem).label, "关系");
  });

  it("a bullet with no label is still unparsed", () => {
    const items = itemsIn(["## Relations", "- [[Some Page]]"], "Relations");
    assert.equal(items[0]?.kind, "unparsed");
  });
});

describe("rationale ownership has no third outcome (docs/concepts.md §Section grammar)", () => {
  it("a heading ends the scope: a rationale line under a sub-heading is not the claim's", () => {
    const items = itemsIn(
      [
        "## Facts",
        "- [role] engineer (stated 2026-08-14)",
        "",
        "### Sub",
        "  - an indented line under the sub-heading",
      ],
      "Facts",
    );
    assert.equal(items[0]?.rationale.length, 0, "the sub-heading ended the item's scope");
    assert.equal(items[1]?.kind, "unparsed", "and the orphan is reported, never dropped");
  });

  it("an indented item with no owner at all is an item, not silence", () => {
    const items = itemsIn(["## Facts", "  - an orphan indented bullet"], "Facts");
    assert.equal(items.length, 1);
    assert.equal(items[0]?.kind, "unparsed");
  });

  it("prose does not break the attachment — that is how the corpus writes rationale", () => {
    const items = itemsIn(
      [
        "## Facts",
        "- [role] engineer (stated 2026-08-14)",
        "Framing prose between the item and its commentary.",
        "  - why: said in the standup",
      ],
      "Facts",
    );
    assert.equal(items.length, 1);
    assert.deepEqual(
      items[0]?.rationale.map((r) => r.text),
      ["why: said in the standup"],
    );
  });
});

describe("EDate.raw carries the date, not the line (docs/concepts.md §Section grammar)", () => {
  it("the raw span is the edate a writer would re-emit", () => {
    const items = itemsIn(["## Timeline", "- 2026 — a year-precision entry"], "Timeline");
    const date = (items[0] as EntryItem).date;
    assert.equal(date?.raw, "2026");
    assert.equal((items[0] as EntryItem).text, "a year-precision entry");
    const range = itemsIn(["## Timeline", "- ~2026-08 → 2026-10: a range"], "Timeline");
    assert.equal((range[0] as EntryItem).date?.raw, "~2026-08 → 2026-10");
  });
});
