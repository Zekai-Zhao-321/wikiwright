// docs/concepts.md §The judge and its states (applyWrite differs from its input only inside the
// ops' line ranges; the BOM, the line ending and the trailing-newline state are
// the input's; a shape a splice cannot read is a refusal, never a partial edit)
// docs/architecture.md §How a verdict is produced (the Writer module and WritePlan).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyWrite, parseDoc, sectionTail } from "@wikiwright/core";

const PAGE = [
  "---",
  "type: person",
  "aliases: [Chen]",
  "---",
  "",
  "A designer.",
  "",
  "## Facts",
  "",
  "- [identity] full name: 陈静 (stated 2026-01-01)",
  "- [role] designer (stated 2026-01-02)",
  "",
  "## Relations",
  "",
  "- works_at [[Acme]]",
  "",
  "## History",
  "",
].join("\n");

function lines(text: string): string[] {
  return text.replace(/^﻿/u, "").split(/\r?\n/u);
}

describe("the splice law (docs/concepts.md §The judge and its states)", () => {
  it("an insert touches exactly the lines it adds", () => {
    const r = applyWrite(PAGE, [{ kind: "insert", after: 11, lines: ["- [habit] runs"] }]);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const before = lines(PAGE);
    const after = lines(r.text);
    assert.equal(after.length, before.length + 1);
    assert.equal(after[11], "- [habit] runs");
    assert.deepEqual(after.slice(0, 11), before.slice(0, 11));
    assert.deepEqual(after.slice(12), before.slice(11));
    assert.deepEqual(r.ranges, [{ from: 12, to: 12 }]);
    assert.deepEqual(r.consumed, [{ from: 12, to: 11 }]);
  });

  it("a replace touches exactly the line range it names", () => {
    const r = applyWrite(PAGE, [
      { kind: "replace", from: 11, to: 11, lines: ["- [role] staff designer (stated 2026-09-01)"] },
    ]);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const before = lines(PAGE);
    const after = lines(r.text);
    assert.equal(after.length, before.length);
    assert.deepEqual(after.slice(0, 10), before.slice(0, 10));
    assert.deepEqual(after.slice(11), before.slice(11));
    assert.deepEqual(r.ranges, [{ from: 11, to: 11 }]);
  });

  it("append-section inserts at the section's tail, before its trailing blanks", () => {
    const r = applyWrite(PAGE, [
      { kind: "append-section", heading: "Facts", lines: ["- [habit] runs (stated 2026-09-03)"] },
    ]);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const after = lines(r.text);
    assert.equal(after[11], "- [habit] runs (stated 2026-09-03)");
    assert.equal(after[12], "");
    assert.equal(after[13], "## Relations");
  });

  it("append-section on an empty last section lands after the heading", () => {
    const r = applyWrite(PAGE, [
      {
        kind: "append-section",
        heading: "History",
        lines: [
          "- [role] designer (stated 2026-01-02) (valid 2026-01-02→2026-09-02, superseded 2026-09-03)",
        ],
      },
    ]);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const after = lines(r.text);
    assert.equal(after[16], "## History");
    // The customary blank line under a heading is kept even where the empty
    // section had none: an item never lands flush against its heading.
    assert.equal(after[17], "");
    assert.equal(
      after[18],
      "- [role] designer (stated 2026-01-02) (valid 2026-01-02→2026-09-02, superseded 2026-09-03)",
    );
    assert.equal(after[19], "", "and the page keeps its trailing newline");
  });

  it("the heading is matched by identity and, where given, by depth", () => {
    assert.equal(sectionTail(PAGE, "facts"), 11);
    assert.equal(sectionTail(PAGE, "Facts", 2), 11);
    assert.equal(sectionTail(PAGE, "Facts", 3), undefined);
    assert.equal(sectionTail(PAGE, "Nowhere"), undefined);
  });

  it("a heading inside a fence is not a section", () => {
    const fenced = ["## Notes", "", "```md", "## Facts", "```", ""].join("\n");
    assert.equal(sectionTail(fenced, "Facts"), undefined);
  });

  it("the BOM, the line ending and the trailing-newline state are the input's", () => {
    for (const bom of ["", "﻿"]) {
      for (const eol of ["\n", "\r\n"]) {
        for (const tail of ["", "x"]) {
          const base = tail === "" ? PAGE : PAGE.replace(/\n+$/u, "");
          const raw = bom + base.replaceAll("\n", eol);
          const r = applyWrite(raw, [{ kind: "insert", after: 11, lines: ["- [habit] runs"] }]);
          assert.equal(r.ok, true);
          if (!r.ok) return;
          assert.equal(r.text.startsWith("﻿"), bom !== "");
          assert.equal(/\r\n/u.test(r.text), eol === "\r\n");
          assert.equal(r.text.endsWith(eol), tail === "");
        }
      }
    }
  });

  it("overlapping ops are refused, never merged", () => {
    const r = applyWrite(PAGE, [
      { kind: "replace", from: 10, to: 11, lines: ["a"] },
      { kind: "replace", from: 11, to: 12, lines: ["b"] },
    ]);
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.match(r.reason, /overlap/u);
  });

  it("a range outside the page is refused", () => {
    const r = applyWrite(PAGE, [{ kind: "replace", from: 900, to: 901, lines: ["a"] }]);
    assert.equal(r.ok, false);
  });

  it("frontmatter-list appends in the value's own style", () => {
    const r = applyWrite(PAGE, [
      { kind: "frontmatter-list", field: "aliases", existing: ["Chen"], add: ["Chen Jing"] },
    ]);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(lines(r.text)[2], 'aliases: ["Chen", "Chen Jing"]');
    assert.deepEqual(lines(r.text).slice(3), lines(PAGE).slice(3));
  });

  it("frontmatter-set replaces a scalar and inserts an absent one", () => {
    const replaced = applyWrite(PAGE, [
      { kind: "frontmatter-set", field: "type", value: "designer" },
    ]);
    assert.equal(replaced.ok, true);
    if (!replaced.ok) return;
    assert.equal(lines(replaced.text)[1], "type: designer");

    const inserted = applyWrite(PAGE, [
      { kind: "frontmatter-set", field: "status", value: "active" },
    ]);
    assert.equal(inserted.ok, true);
    if (!inserted.ok) return;
    assert.equal(lines(inserted.text)[3], "status: active");
    assert.equal(lines(inserted.text)[4], "---");
  });

  it("frontmatter-set refuses a list-valued field rather than flattening it", () => {
    const r = applyWrite(PAGE, [{ kind: "frontmatter-set", field: "aliases", value: "x" }]);
    assert.equal(r.ok, false);
  });

  it("a page whose frontmatter does not parse is refused whole", () => {
    const bad = ["---", "aliases: [a]", "aliases: [b]", "---", "", "body", ""].join("\n");
    const r = applyWrite(bad, [
      { kind: "frontmatter-list", field: "aliases", existing: ["a"], add: ["c"] },
    ]);
    assert.equal(r.ok, false);
    // One malformed page in must never be two out (docs/concepts.md §The judge and its states).
    assert.equal(parseDoc(bad).frontmatter.issues.length > 0, true);
  });

  it("two disjoint ops apply in one pass, both ranges reported", () => {
    const r = applyWrite(PAGE, [
      { kind: "insert", after: 15, lines: ["- knows [[Bo]]"] },
      { kind: "frontmatter-list", field: "aliases", existing: ["Chen"], add: ["CJ"] },
    ]);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.ranges.length, 2);
    assert.deepEqual(
      r.ranges.map((x) => x.from),
      [3, 16],
    );
  });
});
