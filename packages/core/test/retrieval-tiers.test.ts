// docs/concepts.md §Generated artifacts (the tokenizer law, the tier ladder,
// fusion, the index-rebuild tripwire, name:near; band, ladder_score, rrf
// reasons; tiers_executed, fusion, tokenization; bigram-capable CJK lexical
// search — a day-one test surface; locale-free, byte-identical across runs and
// engines; type chains: retired demoted, never removed).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeIdentity } from "../src/identity/index.ts";
import type { NamedPage } from "../src/names/index.ts";
import { parseDoc } from "../src/parse/index.ts";
import { buildLexicalIndex, deterministicLn, rankLexical } from "../src/search/bm25.ts";
import { searchPages } from "../src/search/index.ts";
import { buildNearIndex, nearCandidates } from "../src/search/near.ts";
import { TOKENIZATION_MODE, tokenize } from "../src/search/tokenize.ts";
import { constitutionOf } from "./helpers/constitution.ts";

function page(path: string, frontmatter: string, body: string): NamedPage {
  return { path, doc: parseDoc(`---\n${frontmatter}\n---\n\n${body}\n`) };
}

describe("the tokenizer is law (docs/concepts.md §Generated artifacts,)", () => {
  it("emits Latin word runs and digit runs, case folded through normalizeIdentity", () => {
    assert.deepEqual(tokenize("Fitness ROUTINE 2026"), ["fitness", "routine", "2026"]);
  });

  it("normalizes composed and decomposed forms to the same tokens", () => {
    const composed = tokenize("Café");
    const decomposed = tokenize("Café");
    assert.deepEqual(composed, decomposed);
    assert.equal(composed[0], normalizeIdentity("Café"));
  });

  it("emits Han unigrams and then the contiguous bigrams of each run", () => {
    assert.deepEqual(tokenize("甲乙丙丁"), ["甲", "乙", "丙", "丁", "甲乙", "乙丙", "丙丁"]);
  });

  it("never lets a bigram cross a run boundary", () => {
    assert.deepEqual(tokenize("甲乙 丙丁"), ["甲", "乙", "甲乙", "丙", "丁", "丙丁"]);
    assert.equal(tokenize("甲乙 丙丁").includes("乙丙"), false);
  });

  it("drops punctuation, ASCII and full-width alike, and never joins two tokens", () => {
    assert.deepEqual(tokenize("张伟（Zhang Wei）、fitness！"), [
      "张",
      "伟",
      "张伟",
      "zhang",
      "wei",
      "fitness",
    ]);
    assert.deepEqual(tokenize("a.b,c"), ["a", "b", "c"]);
  });

  it("splits a script boundary without whitespace", () => {
    assert.deepEqual(tokenize("iPhone手机"), ["iphone", "手", "机", "手机"]);
  });

  it("treats astral-plane Han as Han, by code point (no property escapes)", () => {
    assert.deepEqual(tokenize("\u{20000}\u{20001}"), [
      "\u{20000}",
      "\u{20001}",
      "\u{20000}\u{20001}",
    ]);
  });

  it("keeps duplicates in occurrence order — term frequency is data", () => {
    assert.deepEqual(tokenize("reset reset warm"), ["reset", "reset", "warm"]);
  });

  it("names the mode the coverage block reports", () => {
    assert.equal(TOKENIZATION_MODE, "latin-word + cjk-unigram+bigram, NFC casefold");
  });
});

describe("lexical:bm25 (docs/concepts.md §Generated artifacts)", () => {
  const corpus: NamedPage[] = [
    page(
      "wiki/fitness-log.md",
      "type: concept\ntitle: Fitness log\ndescription: Training notes.\ntags: []",
      "# Fitness log\n\nThe fitness plan is simple; the evening routine follows the morning one.\n",
    ),
    page(
      "wiki/甲乙丙.md",
      'type: concept\ntitle: 甲乙丙\ndescription: A CJK page.\naliases: ["Stems note"]\ntags: []',
      "# 甲乙丙\n\n甲乙 戊己 丙丁 庚辛。\n",
    ),
    page(
      "wiki/unrelated.md",
      "type: concept\ntitle: Unrelated\ndescription: Nothing here.\ntags: []",
      "# Unrelated\n\nA page about boot logs and cables.\n",
    ),
  ];

  it("answers a multi-token query whose tokens are not contiguous (RAG , the defect)", () => {
    const out = searchPages(corpus, "fitness routine", {}, 10);
    assert.equal(out.results[0]?.path, "wiki/fitness-log.md");
    assert.equal(
      out.results[0]?.match_reasons.some((r) => r === "lexical:bm25"),
      true,
    );
  });

  it("answers a CJK query whose characters are separated in the text ()", () => {
    const out = searchPages(corpus, "甲乙丙丁", {}, 10);
    assert.equal(out.results[0]?.path, "wiki/甲乙丙.md");
  });

  it("boosts basename ∪ aliases ∪ tags ∪ headings 3× over body", () => {
    const boosted = page(
      "wiki/cables.md",
      "type: concept\ntitle: Cables\ndescription: d.\ntags: [cables]",
      "# Cables\n\nShort page.\n",
    );
    const buried = page(
      "wiki/long.md",
      "type: concept\ntitle: Long\ndescription: d.\ntags: []",
      `# Long\n\n${"filler word ".repeat(200)}cables\n`,
    );
    const index = buildLexicalIndex([boosted, buried]);
    const ranked = rankLexical(index, "cables", [boosted, buried]);
    assert.equal(ranked[0]?.path, "wiki/cables.md");
  });

  it("scores identically whatever order the query's terms arrive in (code-unit summation)", () => {
    const index = buildLexicalIndex(corpus);
    const a = rankLexical(index, "routine fitness", corpus);
    const b = rankLexical(index, "fitness routine", corpus);
    assert.deepEqual(a, b);
  });

  it("is byte-identical across rebuilds", () => {
    const one = JSON.stringify(rankLexical(buildLexicalIndex(corpus), "甲乙 fitness", corpus));
    const two = JSON.stringify(rankLexical(buildLexicalIndex(corpus), "甲乙 fitness", corpus));
    assert.equal(one, two);
  });

  it("computes ln without a transcendental library call, to double precision", () => {
    for (const x of [1, 1.5, 2, 3, 10, 1e-3, 1e6, 0.5]) {
      assert.equal(Math.abs(deterministicLn(x) - Math.log(x)) < 1e-12, true, `ln(${x})`);
    }
  });
});

describe("name:stem — the qualifier tier that gates (docs/concepts.md §Generated artifacts)", () => {
  const pages: NamedPage[] = [
    page(
      "wiki/Li Wei (barber).md",
      "type: concept\ntitle: Li Wei (barber)\ndescription: The barber.\ntags: []",
      "# Li Wei (barber)\n\nCuts hair.\n",
    ),
    page(
      "wiki/noise.md",
      "type: concept\ntitle: Noise\ndescription: Mentions Li Wei often.\ntags: []",
      `# Noise\n\n${"Li Wei ".repeat(40)}\n`,
    ),
  ];

  it("reaches a qualified basename from the bare name", () => {
    const out = searchPages(pages, "Li Wei", {}, 10);
    assert.equal(out.results[0]?.path, "wiki/Li Wei (barber).md");
    assert.equal(out.results[0]?.match_reasons.includes("name:stem"), true);
    assert.equal(out.results[0]?.band, "identity");
  });

  it("stems a qualified alias too, and strips only one trailing qualifier", () => {
    const aliased = page(
      "wiki/coach.md",
      'type: concept\ntitle: Coach\ndescription: d.\naliases: ["Zhang Wei (coach)"]\ntags: []',
      "# Coach\n\nx.\n",
    );
    const out = searchPages([aliased], "Zhang Wei", {}, 10);
    assert.equal(out.results[0]?.match_reasons.includes("name:stem"), true);
  });
});

describe("fusion — RRF k=60, and the band law it may not break (docs/concepts.md §Generated artifacts)", () => {
  const exact = page(
    "wiki/zeta.md",
    "type: concept\ntitle: Zeta\ndescription: A short page.\ntags: []",
    "# Zeta\n\nOne line.\n",
  );
  const pileUp = page(
    "wiki/pile.md",
    "type: concept\ntitle: All about zeta\ndescription: zeta zeta zeta.\ntags: [zeta]",
    `# Zeta everywhere\n\n${"zeta ".repeat(80)}\n`,
  );

  it("an exact name hit outranks any pile-up of body matches, under fusion", () => {
    const out = searchPages([exact, pileUp], "zeta", {}, 10);
    assert.equal(out.results[0]?.path, "wiki/zeta.md");
    assert.equal(out.results[0]?.band, "identity");
    assert.equal(out.results[1]?.band, "relevance");
  });

  it("names the tiers and the ranks each list contributed (docs/concepts.md §Generated artifacts)", () => {
    const out = searchPages([exact, pileUp], "zeta", {}, 10);
    const reasons = out.results[1]?.match_reasons ?? [];
    assert.equal(reasons.includes("tag:zeta"), true);
    assert.equal(
      reasons.some((r) => r.startsWith("rrf:ladder#")),
      true,
    );
    assert.equal(
      reasons.some((r) => r.startsWith("rrf:lexical:bm25#")),
      true,
    );
    assert.equal(typeof out.results[1]?.ladder_score, "number");
  });

  it("keeps the whole-query phrase tier as body:phrase, demoted inside the ladder", () => {
    const phrase = page(
      "wiki/phrase.md",
      "type: concept\ntitle: Phrase\ndescription: d.\ntags: []",
      "# Phrase\n\nthe warm reset ritual runs nightly.\n",
    );
    const out = searchPages([phrase], "warm reset ritual", {}, 10);
    assert.equal(out.results[0]?.match_reasons.includes("body:phrase"), true);
  });

  it("demotes a retired page below its active peer without removing it", () => {
    const active = page(
      "wiki/warm-reset.md",
      "type: concept\ntitle: Warm reset\ndescription: The reset.\ntags: [reset]",
      "# Warm reset\n\nreset content.\n",
    );
    const retired = page(
      "wiki/reset-plan-old.md",
      "type: concept\ntitle: Reset plan old\ndescription: Old reset planning.\ntags: [reset]\nstatus: retired",
      "# Reset plan old\n\nreset reset reset.\n",
    );
    const out = searchPages([active, retired], "reset", {}, 10);
    const paths = out.results.map((r) => r.path);
    assert.equal(paths.includes("wiki/reset-plan-old.md"), true);
    assert.equal(
      paths.indexOf("wiki/warm-reset.md") < paths.indexOf("wiki/reset-plan-old.md"),
      true,
    );
    assert.equal((out.results.at(-1)?.score ?? 0) > 0, true);
  });

  it("filters subset both lists without reordering what survives (RAG )", () => {
    const tagged = page(
      "wiki/tagged.md",
      "type: concept\ntitle: Tagged reset\ndescription: reset here.\ntags: [reset]",
      "# Tagged reset\n\nreset body.\n",
    );
    const untagged = page(
      "wiki/untagged.md",
      "type: concept\ntitle: Untagged reset\ndescription: reset here too.\ntags: []",
      "# Untagged reset\n\nreset reset body.\n",
    );
    const all = searchPages([tagged, untagged], "reset", {}, 10);
    const filtered = searchPages([tagged, untagged], "reset", { tag: "reset" }, 10);
    const keptOrder = all.results.map((r) => r.path).filter((p) => p === "wiki/tagged.md");
    assert.deepEqual(
      filtered.results.map((r) => r.path),
      keptOrder,
    );
  });
});

describe("the coverage block (docs/concepts.md §Generated artifacts)", () => {
  const pages = [
    page("wiki/a.md", "type: concept\ntitle: A\ndescription: d.\ntags: []", "# A\n\nbody.\n"),
  ];

  it("reports the tokenization mode, the tiers, and the fusion", () => {
    const { coverage } = searchPages(pages, "body", {}, 10);
    assert.equal(coverage.tokenization, "latin-word + cjk-unigram+bigram, NFC casefold");
    for (const tier of ["name", "alias", "name:stem", "lexical:bm25", "body:phrase"]) {
      assert.equal(coverage.tiers_executed.includes(tier), true, `tiers_executed has ${tier}`);
    }
    assert.deepEqual(coverage.fusion, { method: "rrf", k: 60, lists: ["ladder", "lexical:bm25"] });
    assert.equal(coverage.corpus_size, 1);
  });

  it("lists name:near only when the near tier ran", () => {
    assert.equal(
      searchPages(pages, "body", {}, 10).coverage.tiers_executed.includes("name:near"),
      false,
    );
    const withNear = searchPages(pages, "body", {}, 10, { near: true });
    assert.equal(withNear.coverage.tiers_executed.includes("name:near"), true);
  });
});

describe("name:near — advisory, never ranked (docs/concepts.md §Generated artifacts)", () => {
  const pages: NamedPage[] = [
    page(
      "wiki/张伟.md",
      'type: concept\ntitle: 张伟\ndescription: A colleague.\naliases: ["Zhang Wei"]\ntags: []',
      "# 张伟\n\nOwns the rigs.\n",
    ),
    page(
      "wiki/Wei Zhang (coach).md",
      "type: concept\ntitle: Wei Zhang (coach)\ndescription: The swim coach.\ntags: []",
      "# Wei Zhang (coach)\n\nSwims.\n",
    ),
  ];

  it("catches the reversed-order miss by order-free token-set equality", () => {
    const candidates = nearCandidates(buildNearIndex(pages), "Wei Zhang", 10);
    const hit = candidates.find((c) => c.path === "wiki/张伟.md");
    assert.notEqual(hit, undefined);
    assert.equal(hit?.why.includes("token-set:equal"), true);
  });

  it("catches the no-space miss by character-trigram similarity", () => {
    const candidates = nearCandidates(buildNearIndex(pages), "ZhangWei", 10);
    const hit = candidates.find((c) => c.path === "wiki/张伟.md");
    assert.notEqual(hit, undefined);
    assert.equal(
      hit?.why.some((w) => w.startsWith("trigram:")),
      true,
    );
  });

  it("bridges Han↔Latin from the bundle's own alias pairs, with no pinyin table", () => {
    const candidates = nearCandidates(buildNearIndex(pages), "张伟", 10);
    const bridged = candidates.find((c) => c.path === "wiki/Wei Zhang (coach).md");
    assert.notEqual(bridged, undefined, "the 张伟/Zhang Wei pair teaches the bridge");
    assert.equal(bridged?.why.includes("bridge:han-latin"), true);
  });

  it("orders candidates by score then code-unit path, deterministically", () => {
    const index = buildNearIndex(pages);
    assert.deepEqual(
      nearCandidates(index, "Wei Zhang", 10),
      nearCandidates(index, "Wei Zhang", 10),
    );
  });

  it("never changes the ranked results", () => {
    const without = searchPages(pages, "Wei Zhang", {}, 10);
    const withNear = searchPages(pages, "Wei Zhang", {}, 10, { near: true });
    assert.deepEqual(
      withNear.results.map((r) => r.path),
      without.results.map((r) => r.path),
    );
    assert.equal((withNear.near ?? []).length > 0, true);
  });
});

describe("a query-less search reports the tiers it ran (docs/concepts.md §Generated artifacts)", () => {
  const pages: NamedPage[] = [
    page(
      "wiki/reset-a.md",
      "type: concept\ntitle: Reset A\ndescription: d.\ntags: [reset]",
      "# Reset A\n\nbody.\n",
    ),
    page(
      "wiki/other.md",
      "type: concept\ntitle: Other\ndescription: d.\ntags: []",
      "# Other\n\nbody.\n",
    ),
  ];

  it("names the filter, not the ladder it never consulted", () => {
    const { coverage, results } = searchPages(pages, undefined, { tag: "reset" }, 10);
    assert.deepEqual(coverage.tiers_executed, ["filter"]);
    assert.deepEqual(coverage.fusion, { method: "rrf", k: 60, lists: ["ladder"] });
    assert.deepEqual(
      results.map((r) => r.path),
      ["wiki/reset-a.md"],
    );
    assert.deepEqual(results[0]?.match_reasons.includes("filter:match"), true);
  });

  it("reports no tier when the filter matched nothing — the absence-shaped answer", () => {
    const { coverage, results } = searchPages(pages, undefined, { tag: "absent" }, 10);
    assert.equal(results.length, 0);
    assert.deepEqual(coverage.tiers_executed, ["filter"]);
    for (const tier of ["lexical:bm25", "body:phrase", "name", "name:stem"]) {
      assert.equal(coverage.tiers_executed.includes(tier), false, `${tier} never ran`);
    }
  });

  it("does not list name:near when --near had no name to rank against", () => {
    const { coverage, near } = searchPages(pages, undefined, { tag: "reset" }, 10, { near: true });
    assert.equal(coverage.tiers_executed.includes("name:near"), false);
    assert.equal(near, undefined);
  });

  it("still reports the full ladder when a query ran", () => {
    const { coverage } = searchPages(pages, "reset", { tag: "reset" }, 10);
    assert.equal(coverage.tiers_executed.includes("lexical:bm25"), true);
    assert.deepEqual(coverage.fusion.lists, ["ladder", "lexical:bm25"]);
  });
});

describe("type-aware retrieval (docs/concepts.md §Generated artifacts)", () => {
  it("search --type matches descendants through the chain", () => {
    const registry = constitutionOf({
      types: {
        record: { extends: "reference", description: "R." },
        "test-record": { extends: "record", description: "T." },
      },
    });
    const pages = [
      {
        path: "wiki/t.md",
        doc: parseDoc(
          "---\ntype: test-record\ntitle: Boot log\ndescription: d.\ntags: []\n---\n\n# Boot log\n",
        ),
      },
    ];
    const chains = new Map<string, string[]>();
    for (const [name, eff] of registry.types) chains.set(name, eff.chain);
    const exact = searchPages(pages, "boot", { type: "test-record" }, 10, {
      typeChains: chains,
    });
    assert.equal(exact.results.length, 1);
    const ancestor = searchPages(pages, "boot", { type: "record" }, 10, {
      typeChains: chains,
    });
    assert.equal(ancestor.results.length, 1, "an ancestor type matches its descendants");
    const archetype = searchPages(pages, "boot", { type: "reference" }, 10, {
      typeChains: chains,
    });
    assert.equal(archetype.results.length, 1, "the archetype matches too");
    const other = searchPages(pages, "boot", { type: "concept" }, 10, { typeChains: chains });
    assert.equal(other.results.length, 0);
  });
});

describe("search obeys tier dominance and normalizes filters (docs/concepts.md §Generated artifacts)", () => {
  const pages = [
    {
      path: "wiki/zeta.md",
      doc: parseDoc(
        "---\ntype: concept\ntitle: Something else\ndescription: nothing.\ntags: []\n---\n\n# Something else\n\nzeta appears here.\n",
      ),
    },
    {
      path: "wiki/pileup.md",
      doc: parseDoc(
        "---\ntype: concept\ntitle: zeta zeta collection\ndescription: all about zeta.\ntags: []\n---\n\n# About\n\n## zeta section\n\nzeta zeta zeta.\n",
      ),
    },
    {
      path: "wiki/tagged.md",
      doc: parseDoc(
        "---\ntype: concept\ntitle: Tagged\ndescription: x.\ntags: [reset]\n---\n\n# Tagged\n",
      ),
    },
    {
      path: "wiki/old.md",
      doc: parseDoc(
        "---\ntype: concept\ntitle: Old reset notes\ndescription: reset planning.\ntags: [reset]\nstatus: retired\n---\n\n# Old reset notes\n",
      ),
    },
  ];

  it("ranks an exact basename above any pile-up of weaker tiers", () => {
    const out = searchPages(pages, "zeta", {}, 20);
    assert.equal(out.results[0]?.path, "wiki/zeta.md");
  });

  it("matches --tag filters case-insensitively through normalizeIdentity", () => {
    const out = searchPages(pages, undefined, { tag: "Reset" }, 20);
    assert.equal(
      out.results.some((r) => r.path === "wiki/tagged.md"),
      true,
    );
  });

  it("demotes retired pages without excluding them or going negative", () => {
    const out = searchPages(pages, undefined, { tag: "reset" }, 20);
    const retired = out.results.find((r) => r.path === "wiki/old.md");
    const active = out.results.find((r) => r.path === "wiki/tagged.md");
    assert.notEqual(retired, undefined);
    assert.equal((retired?.score ?? 0) > 0, true, "scores stay positive");
    assert.equal((active?.score ?? 0) > (retired?.score ?? 0), true);
  });
});
