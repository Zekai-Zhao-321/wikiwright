// docs/concepts.md §Section grammar (a trailing parenthetical
// that is exactly one path-shaped token under a declared source root is `inferred`
// provenance with that ref, counted at info as provenance-path-only)
// docs/constitution.md §config/engine.json (source_roots is the key that exists; undeclared means off).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  checkGrammar,
  parseSections,
  type SectionAST,
  type SectionBinding,
  sectionBinding,
} from "../src/grammar/index.ts";
import { parseDoc } from "../src/parse/index.ts";
import type { ClaimItem } from "../src/stdlib/claims-parse.ts";
import { standardLibrary } from "../src/stdlib/index.ts";

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
  { provenance: "optional" },
);

function page(lines: readonly string[]): string {
  return ["---", "type: person", "tags: []", "---", "", "Lede.", "", "## Facts", ...lines, ""].join(
    "\n",
  );
}

function ast(lines: readonly string[], sourceRoots?: readonly string[]): SectionAST {
  return parseSections(
    parseDoc(page(lines)),
    [FACTS],
    sourceRoots === undefined ? undefined : { sourceRoots },
  );
}

function claims(lines: readonly string[], sourceRoots?: readonly string[]): ClaimItem[] {
  const node = ast(lines, sourceRoots).sections.find((s) => s.heading === "Facts");
  return (node?.items ?? []).filter((i): i is ClaimItem => i.kind === "claim");
}

/** No default: "which roots are declared" is the whole question here. */
function one(line: string, sourceRoots?: readonly string[]): ClaimItem {
  const items = claims([line], sourceRoots);
  assert.equal(items.length, 1, `"${line}" parses as one claim`);
  return items[0] as ClaimItem;
}

describe("a bare path under a declared root is `inferred` provenance (docs/concepts.md §Section grammar)", () => {
  it("carries the same fields as the clause form the writer could have typed", () => {
    const bare = one("- [event] moved apartments (raw/web/2026-08-15--lease)", ["raw"]);
    const spelled = one("- [event] moved apartments (inferred, raw/web/2026-08-15--lease)", [
      "raw",
    ]);
    assert.equal(bare.provenance?.form, "inferred");
    assert.equal(bare.provenance?.ref, "raw/web/2026-08-15--lease");
    assert.equal(bare.provenance?.refShape, "path");
    assert.equal(bare.provenance?.ref, spelled.provenance?.ref);
    assert.equal(bare.provenance?.refShape, spelled.provenance?.refShape);
  });

  it("is a marker, so it leaves the claim's core — and its identity — behind", () => {
    const bare = one("- [event] moved apartments (raw/web/lease)", ["raw"]);
    assert.equal(bare.core, "moved apartments");
    assert.equal(
      bare.coreId,
      one("- [event] moved apartments (inferred, raw/web/lease)", ["raw"]).coreId,
    );
  });

  it("recognizes full-width parentheses, like every other marker", () => {
    const item = one("- [事件] 搬家了（raw/web/2026-08-15--lease）", ["raw"]);
    assert.equal(item.provenance?.form, "inferred");
    assert.equal(item.provenance?.ref, "raw/web/2026-08-15--lease");
    assert.equal(item.core, "搬家了");
  });

  it("a nested root path resolves by path segment, not by string prefix", () => {
    assert.equal(one("- [event] x (raw/web/a)", ["raw/web"]).provenance?.form, "inferred");
    assert.equal(one("- [event] x (rawish/web/a)", ["raw"]).provenance, undefined);
  });

  it("takes precedence over the sourced date-tail dialect: a path is not a habit", () => {
    const dated = one("- [event] x (raw/web/2026-08-15)", ["raw"]);
    assert.equal(dated.provenance?.form, "inferred");
    assert.equal(dated.provenance?.ref, "raw/web/2026-08-15");
  });
});

describe("what the arm refuses to eat (docs/concepts.md §Section grammar: three bounds)", () => {
  it("a path under no declared root stays core text", () => {
    const item = one("- [event] moved (notes/2026/lease)", ["raw"]);
    assert.equal(item.provenance, undefined);
    assert.equal(item.core, "moved (notes/2026/lease)");
  });

  it("undeclared source_roots recognizes nothing — the engine never infers a root", () => {
    // Both spellings of "the bundle declared none": no options at all, and an
    // empty list. Neither may recognize a root the bundle never named.
    for (const roots of [undefined, []] as const) {
      const item = one("- [event] moved (raw/web/lease)", roots);
      assert.equal(item.provenance, undefined);
      assert.equal(item.core, "moved (raw/web/lease)");
    }
  });

  it("a Windows-style path is not path-shaped: the token must contain a forward slash", () => {
    const item = one("- [event] moved (raw\\web\\lease)", ["raw"]);
    assert.equal(item.provenance, undefined);
    assert.equal(item.core, "moved (raw\\web\\lease)");
  });

  it("a body with a second segment is prose, not a ref", () => {
    const item = one("- [event] moved (raw/web/lease, casual aside)", ["raw"]);
    assert.equal(item.provenance, undefined);
    assert.equal(item.core, "moved (raw/web/lease, casual aside)");
  });

  it("a token with whitespace inside the body is not one token", () => {
    const item = one("- [event] moved (raw/web/the lease)", ["raw"]);
    assert.equal(item.provenance, undefined);
  });

  it("the root itself is not a ref: something must sit UNDER it", () => {
    for (const line of ["- [event] moved (raw/)", "- [event] moved (raw)"]) {
      const item = one(line, ["raw"]);
      assert.equal(item.provenance, undefined, `"${line}" is the root, not a ref under it`);
    }
  });

  it("an empty segment is not a path the engine can resolve", () => {
    const item = one("- [event] moved (raw//web/lease)", ["raw"]);
    assert.equal(item.provenance, undefined);
    assert.equal(item.core, "moved (raw//web/lease)");
  });

  it("a leading ./ is stripped from the token as it already is from the root", () => {
    const item = one("- [event] moved (./raw/web/lease)", ["raw"]);
    assert.equal(item.provenance?.form, "inferred");
    assert.equal(item.provenance?.ref, "raw/web/lease", "the recorded ref is the normalized token");
    assert.equal(item.core, "moved");
  });

  it("a section that does not admit `inferred` does not recognize it", () => {
    const node = parseSections(
      parseDoc(page(["- [event] moved (raw/web/lease)"])),
      [{ ...FACTS, params: { ...FACTS.params, forms: ["stated"] } }],
      { sourceRoots: ["raw"] },
    ).sections.find((s) => s.heading === "Facts");
    const item = (node?.items ?? [])[0] as ClaimItem;
    assert.equal(item.provenance, undefined);
    assert.equal(item.core, "moved (raw/web/lease)");
  });
});

describe("across the trailing parentheticals it is the WEAKEST reading", () => {
  // The regression: the provenance slot is first-marker-wins, so a path-only
  // span typed first took the slot from an adjacent complete clause and deleted
  // that clause's census row. Every case below is asserted in BOTH orders: the
  // count of `hearsay` and `provenance-weak` may not depend on which
  // parenthetical the writer typed first.
  const orders = (a: string, b: string): string[] => [
    `- [event] moved ${a} ${b}`,
    `- [event] moved ${b} ${a}`,
  ];

  function rulesOf(line: string): string[] {
    return checkGrammar(ast([line], ["raw"]), { modules: STDLIB })
      .map((f) => f.ruleId)
      .sort();
  }

  it("a `stated by` clause keeps the provenance slot, and keeps its hearsay row", () => {
    for (const line of orders("(raw/web/y)", "(stated by Zhang Wei)")) {
      const item = one(line, ["raw"]);
      assert.equal(item.provenance?.form, "stated-by", line);
      assert.equal(item.core, "moved", line);
      assert.deepEqual(rulesOf(line), ["hearsay", "provenance-path-only"], line);
    }
  });

  it("an `inferred` shorthand keeps the slot, and keeps its provenance-weak row", () => {
    for (const line of orders("(raw/web/y)", "(inferred, wechat)")) {
      const item = one(line, ["raw"]);
      assert.equal(item.provenance?.ref, "wechat", line);
      assert.deepEqual(rulesOf(line), ["provenance-path-only", "provenance-weak"], line);
    }
  });

  it("an explicit `stated` date keeps the slot, in either order", () => {
    for (const line of orders("(raw/web/y)", "(stated 2026-08-14)")) {
      const item = one(line, ["raw"]);
      assert.equal(item.provenance?.form, "stated", line);
      assert.equal(item.provenance?.date, "2026-08-14", line);
      assert.equal(item.core, "moved", line);
    }
  });

  it("the losing path span is still a marker: it leaves the core and is still counted", () => {
    for (const line of orders("(raw/web/y)", "(stated by Zhang Wei)")) {
      const item = one(line, ["raw"]);
      assert.equal(item.core, "moved", line);
      assert.equal(
        item.provenanceExtra?.some((p) => p.ref === "raw/web/y"),
        true,
        `${line}: the path clause is kept beside the winner, not dropped`,
      );
    }
  });

  it("with no keyword clause beside it, the path still takes the slot", () => {
    const item = one("- [event] moved (raw/web/y) (raw/web/z)", ["raw"]);
    assert.equal(item.provenance?.ref, "raw/web/y", "first-marker-wins among equals");
    assert.equal(item.core, "moved");
  });
});

describe("the arm is counted, because it is a shape rule (docs/concepts.md §Section grammar)", () => {
  it("emits provenance-path-only at info, and no provenance-weak beside it", () => {
    const found = checkGrammar(ast(["- [event] moved (raw/web/lease)"], ["raw"]), {
      modules: STDLIB,
    });
    const rows = found.map((f) => [f.ruleId, f.severity]);
    assert.deepEqual(rows, [["provenance-path-only", "info"]]);
    assert.equal(found[0]?.details?.["ref"], "raw/web/lease");
  });

  it("the spelled-out clause form is NOT counted — only the inferred recognition is", () => {
    const found = checkGrammar(ast(["- [event] moved (inferred, raw/web/lease)"], ["raw"]), {
      modules: STDLIB,
    });
    assert.deepEqual(found, []);
  });

  it("the arm satisfies `provenance: required`, so it is provenance and not decoration", () => {
    const node = parseSections(
      parseDoc(page(["- [event] moved (raw/web/lease)"])),
      [{ ...FACTS, params: { ...FACTS.params, provenance: "required" } }],
      { sourceRoots: ["raw"] },
    );
    const ruleIds = checkGrammar(node, { modules: STDLIB }).map((f) => f.ruleId);
    assert.equal(ruleIds.includes("claim-provenance"), false);
  });
});
