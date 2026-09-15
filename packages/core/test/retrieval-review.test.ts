// docs/concepts.md §Generated artifacts: "Where the two classes overlap, Han
// wins" · "Rule 4 is a law about punctuation, not a block list" · "The field
// boost, stated as the arithmetic it is" · "Every demoted result carries
// status:retired" · "`name:near` — advisory, never ranked": the candidate
// floor is 0.4 and the list carries its own cap · caps.near_limit /
// caps.near_hit.
//
// An adversarial review's core-side findings, each pinned to the documented sentence
// the review forced into existence.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { NamedPage } from "../src/names/index.ts";
import { parseDoc } from "../src/parse/index.ts";
import { buildLexicalIndex } from "../src/search/bm25.ts";
import { RRF_K, searchPages } from "../src/search/index.ts";
import { buildNearIndex, NEAR_LIMIT, NEAR_THRESHOLD, nearCandidates } from "../src/search/near.ts";
import {
  compactForm,
  isHanCodePoint,
  isSeparatorCodePoint,
  tokenize,
} from "../src/search/tokenize.ts";

function page(path: string, frontmatter: string, body: string): NamedPage {
  return { path, doc: parseDoc(`---\n${frontmatter}\n---\n\n${body}\n`) };
}

describe("the classifier resolves the Han/separator overlap, not one caller", () => {
  it("classifies 々 and 〇 as Han and not as separators", () => {
    for (const cp of [0x3005, 0x3007]) {
      assert.equal(isHanCodePoint(cp), true, `U+${cp.toString(16)} is Han`);
      assert.equal(isSeparatorCodePoint(cp), false, `U+${cp.toString(16)} is not a separator`);
    }
    // The rest of the CJK symbols-and-punctuation block still separates.
    assert.equal(isSeparatorCodePoint(0x3001), true, "、 separates");
    assert.equal(isSeparatorCodePoint(0x3002), true, "。 separates");
  });

  it("keeps 々 in the compact form, so 佐々木 and 佐木 are different names", () => {
    assert.notEqual(compactForm("佐々木"), compactForm("佐木"));
    assert.equal(compactForm("佐々木"), "佐々木");
    assert.deepEqual(tokenize("佐々木"), ["佐", "々", "木", "佐々", "々木"]);
  });

  it("never reports trigram:1.00 between 佐々木 and 佐木 (the review's wrong answer)", () => {
    const index = buildNearIndex([
      page("wiki/佐々木.md", 'type: person\naliases: ["Sasaki"]', "# 佐々木"),
      page("wiki/佐木.md", 'type: person\naliases: ["Saki"]', "# 佐木"),
    ]);
    const hit = nearCandidates(index, "佐々木").find((c) => c.path === "wiki/佐木.md");
    if (hit !== undefined) {
      assert.ok(hit.score < 1, `佐木 scored ${hit.score} against 佐々木 — a different person`);
      assert.equal(hit.why.includes("name:exact"), false);
      assert.equal(hit.why.includes("token-set:equal"), false);
    }
  });

  it("finds a name written only in 〇, which used to compact to the empty string", () => {
    const index = buildNearIndex([page("wiki/二〇二六.md", 'type: doc\naliases: ["2026"]', "x")]);
    assert.notEqual(compactForm("〇〇"), "");
    assert.deepEqual(
      nearCandidates(index, "二〇二六").map((c) => c.path),
      ["wiki/二〇二六.md"],
    );
  });
});

describe("rule 4 is a law about punctuation, not a block list", () => {
  it("drops the interpunct, the katakana middle dot, and the soft hyphen", () => {
    assert.deepEqual(tokenize("Alpha·Beta"), ["alpha", "beta"]);
    assert.deepEqual(tokenize("Tokyo・Osaka"), ["tokyo", "osaka"]);
    assert.deepEqual(tokenize("so\u00adft"), ["so", "ft"]);
    for (const t of tokenize("亚历山大·汉密尔顿")) {
      assert.notEqual(t, "·", "the interpunct is never a term of its own");
    }
  });

  it("gives 张·伟 and 张伟 the same compact form, so --near sees one name", () => {
    assert.equal(compactForm("张·伟"), compactForm("张伟"));
    assert.equal(compactForm("Tokyo・Osaka"), compactForm("TokyoOsaka"));
  });
});

describe("the field boost is +3 occurrences, not 3×", () => {
  it("counts a basename term 3 and an alias term at its body count + 3", () => {
    const index = buildLexicalIndex([
      page("wiki/alpha.md", 'type: concept\naliases: ["zephyr"]', "Nothing else here."),
    ]);
    const doc = index.byPath.get("wiki/alpha.md");
    assert.ok(doc !== undefined);
    // The basename is the one boosted field that is not inside the file.
    assert.equal(doc.tf.get("alpha"), 3, "basename term: 0 body occurrences + 3");
    // Frontmatter is part of the source, so the alias was already counted once.
    assert.equal(doc.tf.get("zephyr"), 4, "alias term: 1 body occurrence + 3");
  });
});

describe("a demoted result names its demotion (item 9)", () => {
  const pages = [
    page("wiki/act.md", "type: concept", "zephyr alpha beta quintessence"),
    page("wiki/ret.md", "type: concept\nstatus: retired", "zephyr alpha beta quintessence"),
  ];

  it("carries status:retired even when only lexical:bm25 found the page", () => {
    const out = searchPages(pages, "zephyr quintessence", {}, 20);
    const retired = out.results.find((r) => r.path === "wiki/ret.md");
    const active = out.results.find((r) => r.path === "wiki/act.md");
    assert.ok(retired !== undefined && active !== undefined);
    // No ladder tier fired: the two query tokens are not contiguous in the body.
    assert.equal(retired.ladder_score, 0);
    assert.equal(retired.match_reasons.includes("lexical:bm25"), true);
    // Both pages are found by BM25 alone, so each fused score is one reciprocal
    // rank. `status: retired` is itself frontmatter, which makes the retired page
    // the longer document and BM25's rank 2 — so the halving is read against its
    // OWN rank, not against the active twin's.
    assert.equal(active.score, Math.round((1 / (RRF_K + 1)) * 1e6) / 1e6);
    assert.equal(retired.score, Math.round((1 / (RRF_K + 2) / 2) * 1e6) / 1e6, "halved");
    assert.equal(
      retired.match_reasons.includes("status:retired"),
      true,
      "a halved score must carry the reason that halved it",
    );
    assert.equal(active.match_reasons.includes("status:retired"), false);
  });

  it("names it exactly once when a ladder tier fired too", () => {
    const out = searchPages(pages, "zephyr alpha beta quintessence", {}, 20);
    const retired = out.results.find((r) => r.path === "wiki/ret.md");
    assert.ok(retired !== undefined);
    assert.equal(retired.match_reasons.filter((r) => r === "status:retired").length, 1);
  });
});

describe("the near candidate floor is 0.4", () => {
  // query "abcdefg" → 7 trigrams; a 7-character candidate sharing i of them
  // scores i/(14-i): 4 → exactly 0.4 (in), 3 → 0.2727 (out).
  const pages = [
    page("wiki/abcdexy.md", "type: concept", "x"),
    page("wiki/abcdxyz.md", "type: concept", "x"),
  ];

  it("keeps a pair at exactly the floor and drops the one below it", () => {
    assert.equal(NEAR_THRESHOLD, 0.4);
    const candidates = nearCandidates(buildNearIndex(pages), "abcdefg");
    const at = candidates.find((c) => c.path === "wiki/abcdexy.md");
    assert.ok(at !== undefined, "jaccard 0.40 is a candidate — the floor is inclusive");
    assert.equal(at.score, 0.4);
    assert.deepEqual(at.why, ["trigram:0.40"]);
    assert.equal(
      candidates.some((c) => c.path === "wiki/abcdxyz.md"),
      false,
      "jaccard 0.27 is noise, not a candidate",
    );
  });
});

describe("the advisory list carries its own cap, and the block says so", () => {
  const pages = Array.from({ length: 25 }, (_, i) =>
    page(`wiki/Ana Bell ${String(i + 1).padStart(2, "0")}.md`, "type: person", "x"),
  );

  it("caps at NEAR_LIMIT rather than at --limit", () => {
    const out = searchPages(pages, "AnaBell", {}, 5, { near: true });
    assert.equal(out.results.length <= 5, true);
    assert.equal(NEAR_LIMIT, 20);
    assert.equal(
      out.near?.length,
      NEAR_LIMIT,
      "--limit is a display choice about results, not about the identity guard",
    );
  });

  it("reports near_limit and near_hit when the near cap dropped candidates", () => {
    const out = searchPages(pages, "AnaBell", {}, 5, { near: true });
    assert.equal(out.coverage.caps.near_limit, NEAR_LIMIT);
    assert.equal(out.coverage.caps.near_hit, true);
  });

  it("reports near_hit false when nothing was dropped, and omits both without --near", () => {
    const few = pages.slice(0, 3);
    const withNear = searchPages(few, "AnaBell", {}, 5, { near: true });
    assert.equal(withNear.coverage.caps.near_limit, NEAR_LIMIT);
    assert.equal(withNear.coverage.caps.near_hit, false);
    const without = searchPages(few, "AnaBell", {}, 5);
    assert.equal("near_limit" in without.coverage.caps, false);
    assert.equal("near_hit" in without.coverage.caps, false);
  });
});
