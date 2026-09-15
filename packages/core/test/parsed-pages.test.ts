// docs/roadmap.md §Every run parses the whole corpus: a state's pages are
// parsed once per text — `check` renders its artifacts, the brief and the
// verdict from one parse, the gate its drift pass and its verdict — and a page
// whose text moved after the parse is parsed again, never judged stale.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parsedPages, type VaultState } from "../src/judge/index.ts";

const page = (title: string): string => `---\ntype: note\ntitle: ${title}\n---\n\n# ${title}\n`;

describe("parsedPages parses each page once per text", () => {
  it("returns the pages in code-unit path order and the same parse on a second call", () => {
    const state: VaultState = {
      pages: new Map([
        ["wiki/b.md", page("B")],
        ["wiki/a.md", page("A")],
      ]),
    };
    const first = parsedPages(state);
    assert.deepEqual(
      first.map((p) => p.path),
      ["wiki/a.md", "wiki/b.md"],
    );
    const second = parsedPages(state);
    assert.equal(second[0]?.doc, first[0]?.doc, "the parse is kept, not redone");
    assert.equal(second[1]?.doc, first[1]?.doc);
    assert.equal(state.parsed?.size, 2);
  });

  it("re-parses a page whose text changed and keeps the others", () => {
    const state: VaultState = {
      pages: new Map([
        ["wiki/a.md", page("A")],
        ["wiki/b.md", page("B")],
      ]),
    };
    const before = parsedPages(state);
    state.pages.set("wiki/b.md", page("B renamed"));
    const after = parsedPages(state);
    assert.equal(after[0]?.doc, before[0]?.doc);
    assert.notEqual(after[1]?.doc, before[1]?.doc);
    assert.equal(after[1]?.doc.frontmatter.value["title"], "B renamed");
  });

  it("ignores a cached parse whose text is not the page's", () => {
    const state: VaultState = { pages: new Map([["wiki/a.md", page("A")]]) };
    const stale = parsedPages({ pages: new Map([["wiki/a.md", page("Old")]]) })[0];
    assert.ok(stale);
    state.parsed = new Map([["wiki/a.md", { text: page("Old"), doc: stale.doc }]]);
    assert.equal(parsedPages(state)[0]?.doc.frontmatter.value["title"], "A");
  });

  it("an empty state parses nothing", () => {
    assert.deepEqual(parsedPages({ pages: new Map() }), []);
  });
});
