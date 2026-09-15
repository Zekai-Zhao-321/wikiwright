// Per-fact claim classes, split into two all-or-nothing arms: the transition
// arm is diff-gated lifecycle enforcement; the vocabulary arms are the
// never-gated guard — journal-only refusal and unknown categories ·
// docs/concepts.md (line-level guards, honest depth)
//
// The law is one `categories` vocabulary whose entries carry a class, read by
// a `claims` section with a `history` and by the history section it names.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lintPage } from "../src/lint/index.ts";
import { parseDoc } from "../src/parse/index.ts";
import { constitutionOf, type Json, loadOf } from "./helpers/constitution.ts";

const CLASSES = {
  supersede: ["identity", "address", "role"],
  accumulate: ["preference", "habit"],
  "journal-only": ["mood"],
};

/** The `categories` vocabulary a class map declares: one entry per category, carrying its class. */
function categoriesOf(classes: Record<string, string[]>): Json {
  const entries: Json = {};
  for (const [cls, names] of Object.entries(classes)) {
    for (const name of names) entries[name] = { class: cls };
  }
  return { mode: "registered", entries };
}

/** The claims pair — the open section and the history it lands in — under one `person` type. */
function personSections(open = "Facts", history = "History", extra: Json = {}): Json {
  return {
    depth: 2,
    list: [
      { heading: open, grammar: "claims", history, vocabulary: "categories", ...extra },
      { heading: history, grammar: "claims", role: "history", vocabulary: "categories" },
    ],
  };
}

function registryWith(config: { classes: Record<string, string[]>; section?: string }) {
  return constitutionOf({
    vocabularies: { categories: categoriesOf(config.classes) },
    types: {
      person: {
        extends: "concept",
        description: "A person page.",
        sections: personSections(config.section ?? "Facts"),
      },
    },
  });
}

const page = (facts: string[], history: string[] = []) =>
  [
    "---",
    "type: person",
    "title: 张伟",
    "description: d.",
    "tags: []",
    "---",
    "",
    "# 张伟",
    "",
    "## Facts",
    ...facts,
    "",
    "## History",
    ...history,
    "",
  ].join("\n");

function lintWith(
  current: string,
  base?: string,
  config: { classes: Record<string, string[]>; section?: string } = { classes: CLASSES },
) {
  const registry = registryWith(config);
  const options = base === undefined ? undefined : { baseText: base };
  return lintPage({ path: "wiki/张伟.md", doc: parseDoc(current), registry }, options);
}

/**
 * The one v2 rule id this file asserted on became three engine arms —
 * one transition arm and two vocabulary arms. The verdict, the page and the
 * severity are what the tests are about; the id is not.
 */
const CLAIM_ARMS: ReadonlySet<string> = new Set([
  "claims-transition",
  "unknown-category",
  "journal-only-category",
]);
const isClaimArm = (f: { ruleId: string }): boolean => CLAIM_ARMS.has(f.ruleId);

const lifecycle = (current: string, base?: string) => lintWith(current, base);
const vocabulary = (current: string) => lintWith(current, undefined);

describe("accumulate: dated observations survive or retract explicitly", () => {
  const base = page(["- [preference] 喜欢吃辣 (stated 2026-08-14)", "- [identity] born 1999"]);

  it("removing an accumulate bullet is an error", () => {
    const findings = lifecycle(page(["- [identity] born 1999"]), base);
    assert.equal(findings.some(isClaimArm), true);
  });

  it("editing an accumulate bullet is an error (edit = remove + add)", () => {
    const findings = lifecycle(
      page(["- [preference] 喜欢吃辣 (stated 2026-09-01)", "- [identity] born 1999"]),
      base,
    );
    assert.equal(findings.some(isClaimArm), true);
  });

  it("moving an accumulate bullet to History (explicit retraction) is legal", () => {
    const findings = lifecycle(
      page(
        ["- [identity] born 1999"],
        ["- [preference] 喜欢吃辣 (stated 2026-08-14; retracted 2026-09-01)"],
      ),
      base,
    );
    assert.equal(findings.some(isClaimArm), false);
  });

  it("adding a contrary observation alongside the old one is legal — variance is signal", () => {
    const findings = lifecycle(
      page([
        "- [preference] 喜欢吃辣 (stated 2026-08-14)",
        "- [preference] 最近不太想吃辣 (stated 2026-09-01)",
        "- [identity] born 1999",
      ]),
      base,
    );
    assert.equal(findings.some(isClaimArm), false);
  });
});

describe("supersede: the replaced value lands in History", () => {
  const base = page(["- [address] lives at 100 King St (stated 2026-08-01)"]);

  it("replacing without a History landing is an error", () => {
    const findings = lifecycle(
      page(["- [address] lives at 200 Queen St (stated 2026-09-01)"]),
      base,
    );
    assert.equal(findings.some(isClaimArm), true);
  });

  it("replacing with the old core text in History is legal", () => {
    const findings = lifecycle(
      page(
        ["- [address] lives at 200 Queen St (stated 2026-09-01)"],
        ["- [address] lives at 100 King St (valid 2026-08-01→2026-09-01, superseded 2026-09-01)"],
      ),
      base,
    );
    assert.equal(findings.some(isClaimArm), false);
  });

  it("an unchanged supersede bullet is legal", () => {
    const findings = lifecycle(base, base);
    assert.equal(findings.some(isClaimArm), false);
  });
});

describe("the vocabulary guard is its own never-gated rule", () => {
  it("a journal-only category standing in Facts is an error — no base revision needed", () => {
    const findings = vocabulary(page(["- [mood] 再也不想见他了 (stated 2026-09-01)"]));
    const f = findings.find(isClaimArm);
    assert.notEqual(f, undefined);
    assert.match(String(f?.message), /journal/i);
  });

  it("an unknown category is a warning by default", () => {
    const findings = vocabulary(page(["- [vibes] seems cool"]));
    assert.equal(findings.find(isClaimArm)?.severity, "warning");
  });

  // The per-rule `unknown_category` mode is deleted. v3's equivalent is
  // the vocabulary's own `mode` (registered | census) plus the section's
  // `severity` — two knobs a bundle already had, instead of a third
  // that only this rule read.

  it("the transition arm reports no vocabulary: unknown and journal-only bullets pass it", () => {
    // The two-arm split survives the rename: each arm is all-or-nothing with
    // respect to gating, so the VOCABULARY arms are the ones that speak here.
    const findings = lifecycle(page(["- [vibes] seems cool", "- [mood] venting"]), page([]));
    assert.equal(
      findings.some((f) => f.ruleId === "claims-transition"),
      false,
    );
  });

  it("the lifecycle arm needs a base; the vocabulary arm does not", () => {
    // This read `DIFF_GATED_CHECKERS`, a set of four v2 checker names deleted
    // with the runtime behind it. The distinction it recorded is now structural:
    // `claims-transition` is a TRANSITION arm and `unknown-category` is a STATE
    // arm, so the property is asserted by running them rather than by naming them.
    const withBase = lifecycle(page(["- [role] engineer (stated 2026-08-14)"]), page([]));
    assert.equal(withBase.some(isClaimArm), false, "a pure addition is legal");
    const noBase = lifecycle(page(["- [role] engineer (stated 2026-08-14)"]), undefined);
    assert.equal(
      noBase.some(isClaimArm),
      false,
      "with no base the lifecycle arm cannot fire at all",
    );
    // The vocabulary arm is a STATE arm: it fires on the page's own bytes.
    assert.equal(
      vocabulary(page(["- [vibes] seems cool"])).some(isClaimArm),
      true,
      "the vocabulary arm needs no base",
    );
  });
});

describe("the History escape is category- and delta-anchored", () => {
  it("a pre-existing unrelated History line cannot legalize a removal", () => {
    const base = page(
      ["- [preference] likes tea (stated 2026-08-01)"],
      ["- [habit] dislikes teabags in the office (noted 2025-01-01)"],
    );
    const findings = lifecycle(
      page([], ["- [habit] dislikes teabags in the office (noted 2025-01-01)"]),
      base,
    );
    assert.equal(
      findings.some(isClaimArm),
      true,
      "the escape demands a NEW same-category History landing, not any substring",
    );
  });

  it("a second supersession requires a new History entry (inherited History does not count)", () => {
    const staleHistory = ["- [address] lives at 100 King St (valid 2024→2025)"];
    const base = page(["- [address] lives at 100 King St (stated 2026-01-01)"], staleHistory);
    const findings = lifecycle(
      page(["- [address] lives at 300 Main St (stated 2026-09-01)"], staleHistory),
      base,
    );
    assert.equal(findings.some(isClaimArm), true);
  });

  it("a wrong-category History landing does not satisfy the escape", () => {
    const base = page(["- [preference] 喜欢吃辣 (stated 2026-08-14)"]);
    const findings = lifecycle(page([], ["- [habit] 喜欢吃辣 (retracted 2026-09-01)"]), base);
    assert.equal(findings.some(isClaimArm), true);
  });
});

describe("annotation edits and paren stripping", () => {
  it("a supersede bullet re-annotated in place (same core) is not a replacement", () => {
    const base = page(["- [address] lives at 100 King St (stated 2026-08-01)"]);
    const findings = lifecycle(
      page(["- [address] lives at 100 King St (stated 2026-08-01; confirmed 2026-09-01)"]),
      base,
    );
    assert.equal(findings.some(isClaimArm), false);
  });

  it("full-width （）provenance strips like ASCII parens", () => {
    const base = page(["- [address] 住在国王街100号 （stated 2026-08-01）"]);
    const findings = lifecycle(
      page(
        ["- [address] 住在皇后街200号 （stated 2026-09-01）"],
        // The complete-clause rule: `valid X→Y` with no `superseded` is not a
        // complete clause, so it is core text; the closing clause must complete.
        ["- [address] 住在国王街100号 （valid 2026-08-01→2026-09-01, superseded 2026-09-01）"],
      ),
      base,
    );
    assert.equal(findings.some(isClaimArm), false);
  });

  // The peel is still balanced and nesting-aware, but what
  // it peels is decided by the complete-clause rule — so the fixture's marker
  // must complete. A nested non-clause parenthetical is core text (docs/concepts.md §Section grammar).
  it("a nested paren inside a complete clause still strips", () => {
    const base = page([
      "- [address] lives at 100 King St (stated 2026-08-01; from a note (scanned))",
    ]);
    const findings = lifecycle(
      page(
        ["- [address] lives at 200 Queen St (stated 2026-09-01)"],
        ["- [address] lives at 100 King St (valid 2026-08-01→2026-09-01, superseded 2026-09-01)"],
      ),
      base,
    );
    assert.equal(findings.some(isClaimArm), false);
  });

  it("a nested non-clause parenthetical is core text, so an edit to it is a removal", () => {
    const base = page(["- [address] lives at 100 King St (valid (approx) 2026)"]);
    const findings = lifecycle(
      page(["- [address] lives at 100 King St (valid (approx) 2027)"]),
      base,
    );
    assert.equal(
      findings.some(isClaimArm),
      true,
      "core is the item text minus MARKER parens only — the old rule erased this edit",
    );
  });
});

describe("bullet-shape exclusions and the walk", () => {
  it("checkboxes, wikilink bullets, and letterless status markers are not claims", () => {
    const findings = vocabulary(
      page([
        "- [ ] follow up with 张伟",
        "- [x] done item",
        "- [[张伟]] introduced Wei to the barber",
        "- [?] does 张伟 still cut hair — unanswered",
        "- [~] half-investigated question",
      ]),
    );
    assert.equal(
      findings.some(isClaimArm),
      false,
      "status markers like [?]/[~] carry no letters and are not categories",
    );
  });

  // An indented item is rationale in every grammar, so an
  // indented `[category]` bullet is no longer a claim (docs/concepts.md §Section grammar).
  it("an indented claim bullet is rationale, not a claim", () => {
    const findings = vocabulary(page(["  - [mood] nested venting (stated 2026-09-01)"]));
    assert.equal(findings.some(isClaimArm), false);
  });

  it("bullets inside a fenced code block are never claims", () => {
    const doc = [
      "---",
      "type: person",
      "title: T",
      "description: d.",
      "tags: []",
      "---",
      "",
      "## Facts",
      "```",
      "- [mood] this is example text in a fence",
      "## History",
      "```",
      "- [identity] born 1999",
      "",
    ].join("\n");
    const registry = registryWith({ classes: CLASSES });
    const findings = lintPage({ path: "wiki/t.md", doc: parseDoc(doc), registry });
    assert.equal(findings.some(isClaimArm), false);
  });

  it("a level-1 heading closes the Facts section", () => {
    const doc = [
      "---",
      "type: person",
      "title: T",
      "description: d.",
      "tags: []",
      "---",
      "",
      "## Facts",
      "- [identity] born 1999",
      "",
      "# Appendix",
      "- [vibes] not a claim any more",
      "",
    ].join("\n");
    const registry = registryWith({ classes: CLASSES });
    const findings = lintPage({ path: "wiki/t.md", doc: parseDoc(doc), registry });
    assert.equal(findings.some(isClaimArm), false);
  });

  it("heading matching folds case; level-3 headings do not open the section", () => {
    const shouty = page(["- [vibes] judged"]).replace("## Facts", "## FACTS");
    assert.equal(vocabulary(shouty).some(isClaimArm), true);
    const level3 = page(["- [vibes] not judged"]).replace("## Facts", "### Facts");
    assert.equal(vocabulary(level3).some(isClaimArm), false);
  });
});

describe("config discipline at load time", () => {
  it("a typo'd lifecycle class name is a load error, never a silent exemption", () => {
    // The vocabulary entry declares `class` as a closed enum, so the typo is
    // refused by the claims module's own entry schema.
    const result = loadOf({
      vocabularies: { categories: categoriesOf({ journal_only: ["mood"] }) },
      types: { person: { extends: "concept", description: "P.", sections: personSections() } },
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(
      result.issues.some((i) => i.code === "vocabulary-entry-invalid"),
      true,
      JSON.stringify(result.issues),
    );
  });

  it("a page-wide append-only law and a claims history on one type is a load error", () => {
    // The incompatible pair: the transition
    // arm requires the rewrite the body arm forbids, so the type is
    // unsatisfiable — caught structurally, and named for what it is.
    const result = loadOf({
      vocabularies: { categories: categoriesOf({ accumulate: ["habit"] }) },
      types: {
        person: {
          extends: "concept",
          description: "P.",
          body: { lifecycle: "append-only" },
          sections: personSections(),
        },
      },
    });
    assert.equal(result.ok, false);
    assert.match(JSON.stringify(!result.ok ? result.issues : []), /body-lifecycle-conflict/);
  });
});

describe("behavior pins", () => {
  it("duplicate identical bullets are multiset-checked: dropping one copy is a removal", () => {
    const twice = page([
      "- [preference] 喜欢吃辣 (stated 2026-08-14)",
      "- [preference] 喜欢吃辣 (stated 2026-08-14)",
    ]);
    const once = page(["- [preference] 喜欢吃辣 (stated 2026-08-14)"]);
    assert.equal(lifecycle(once, twice).some(isClaimArm), true);
  });

  it("a base page with no Facts section contributes nothing to the diff arms", () => {
    const base = page([]).replace("## Facts\n", "");
    const findings = lifecycle(page(["- [identity] born 1999"]), base);
    assert.equal(findings.some(isClaimArm), false);
  });

  it("vocabulary findings carry the bullet's line number and distinct evidence digests", () => {
    const findings = vocabulary(page(["- [vibes] one thing", "- [vibes] another thing"]));
    const hits = findings.filter(isClaimArm);
    assert.equal(hits.length, 2);
    assert.equal(typeof hits[0]?.line, "number");
    assert.notEqual(hits[0]?.evidenceDigest, hits[1]?.evidenceDigest);
  });

  // `rule.message` is deleted with the rule record. A v3 constitution
  // authors no messages — an arm's message is the engine's, so that a reader who
  // has seen one `journal-only-category` finding has seen them all, and the
  // bundle's voice lives in `description` / `use_when` / `avoid_when`, which the
  // finding still carries as its hint.
  it("the arm's message is the engine's, and the bundle's prose rides as the hint", () => {
    const registry = registryWith({ classes: CLASSES });
    const findings = lintPage({
      path: "wiki/t.md",
      doc: parseDoc(page(["- [mood] venting"])),
      registry,
    });
    const f = findings.find((x) => x.ruleId === "journal-only-category");
    assert.notEqual(f, undefined, JSON.stringify(findings.map((x) => x.ruleId)));
    assert.match(f?.message ?? "", /journal/i);
  });

  it("configured section and history_section names are honored", () => {
    const doc = [
      "---",
      "type: person",
      "title: T",
      "description: d.",
      "tags: []",
      "---",
      "",
      "## 事实",
      "- [mood] venting",
      "",
    ].join("\n");
    const registry = registryWith({ classes: CLASSES, section: "事实" });
    const findings = lintPage({ path: "wiki/t.md", doc: parseDoc(doc), registry });
    assert.equal(findings.some(isClaimArm), true);
  });
});

describe("the transition arm reads two SectionASTs, and both landings are counted", () => {
  const base = page(["- [address] lives at 100 King St (stated 2026-08-01)"]);

  it("history-claim-landing: the claim-kind form legalizes and says which escape fired", () => {
    const findings = lifecycle(
      page(
        ["- [address] lives at 200 Queen St (stated 2026-09-01)"],
        ["- [address] lives at 100 King St (valid 2026-08-01→2026-09-01, superseded 2026-09-01)"],
      ),
      base,
    );
    assert.equal(findings.some(isClaimArm), false);
    const landing = findings.find((f) => f.ruleId === "claim-landing");
    assert.equal(landing?.severity, "info");
    assert.equal(landing?.details?.["escape"], "history-claim-landing");
    assert.equal(typeof landing?.details?.["handle"], "string");
  });

  it("history-entry-landing: a new dated changelog entry carrying the core legalizes", () => {
    const findings = lifecycle(
      page(
        ["- [address] lives at 200 Queen St (stated 2026-09-01)"],
        ["- 2026-09-01: replaced the address — lives at 100 King St is no longer current"],
      ),
      base,
    );
    assert.equal(
      findings.some(isClaimArm),
      false,
      "75 of 75 History bullets in the corpus are entries; the escape exists because the claim form was unwritable",
    );
    assert.equal(
      findings.find((f) => f.ruleId === "claim-landing")?.details?.["escape"],
      "history-entry-landing",
    );
  });

  it("an inherited History entry carrying the core does not legalize", () => {
    const inherited = ["- 2025-01-01: an old note about lives at 100 King St"];
    const withHistory = page(["- [address] lives at 100 King St (stated 2026-08-01)"], inherited);
    const findings = lifecycle(
      page(["- [address] lives at 200 Queen St (stated 2026-09-01)"], inherited),
      withHistory,
    );
    assert.equal(findings.some(isClaimArm), true, "the escape is delta-anchored in both kinds");
  });

  it("a History entry that does not carry the core does not legalize", () => {
    const findings = lifecycle(
      page(
        ["- [address] lives at 200 Queen St (stated 2026-09-01)"],
        ["- 2026-09-01: tidied the page"],
      ),
      base,
    );
    assert.equal(findings.some(isClaimArm), true);
  });
});

describe("the entry-landing escape is segment-anchored (docs/concepts.md §Section grammar)", () => {
  it("`Main` never lands in `Mainland` — the escape uses the section's own identity law", () => {
    const base = page(["- [identity] Main (stated 2026-01-02)"]);
    const findings = lifecycle(
      page(
        ["- [identity] Mainland (stated 2026-02-03)"],
        ["- 2026-02-03 — tidied the Mainland section"],
      ),
      base,
    );
    assert.equal(
      findings.some(isClaimArm),
      true,
      "an unrelated History line may not legalize a removal past an error-severity gate",
    );
    assert.equal(
      findings.some((f) => f.ruleId === "claim-landing"),
      false,
    );
  });

  it("`甲乙` never lands in `甲乙丙丁` — the boundary is a code point, not a word break", () => {
    // A script with no word breaks is the case an ASCII boundary test cannot
    // reach, and it is this project's stated top duplicate risk. The tokens are
    // stem-and-branch placeholders — the CJK equivalent of `foo`/`foobar`.
    const base = page(["- [address] 甲乙 (stated 2026-01-02)"]);
    const findings = lifecycle(
      page(["- [address] 丙丁 (stated 2026-02-03)"], ["- 2026-02-03 — 甲乙丙丁 tidied"]),
      base,
    );
    assert.equal(findings.some(isClaimArm), true);
  });

  it("a quoted core still legalizes, however the entry wraps it in prose", () => {
    const base = page(["- [identity] Main (stated 2026-01-02)"]);
    for (const entry of [
      "- 2026-02-03 — replaced Main with Mainland",
      "- 2026-02-03 — 「Main」 is no longer current",
      "- 2026-02-03 — superseded: Main",
    ]) {
      const findings = lifecycle(
        page(["- [identity] Mainland (stated 2026-02-03)"], [entry]),
        base,
      );
      assert.equal(
        findings.some(isClaimArm),
        false,
        `${entry}: the escape is exact about WHAT is quoted, loose about how`,
      );
    }
  });
});

describe("the transition arm reads the declared section depth (docs/concepts.md §Section grammar)", () => {
  const deepPage = (facts: string[], history: string[] = []) =>
    [
      "---",
      "type: person",
      "title: 张伟",
      "description: d.",
      "tags: []",
      "---",
      "",
      "# 张伟",
      "",
      "### Facts",
      ...facts,
      "",
      "### History",
      ...history,
      "",
    ].join("\n");

  it("a depth-3 bundle's claims are seen by the arm, not silently zero", () => {
    const registry = deepRegistry();
    const findings = lintPage(
      {
        path: "wiki/张伟.md",
        doc: parseDoc(deepPage(["- [address] lives at 200 Queen St (stated 2026-09-01)"])),
        registry,
      },
      { baseText: deepPage(["- [address] lives at 100 King St (stated 2026-08-01)"]) },
    );
    assert.equal(
      findings.some(isClaimArm),
      true,
      "one parser driven by two depth contracts is the class-C shape this slice removes",
    );
  });

  function deepRegistry() {
    return constitutionOf({
      vocabularies: { categories: categoriesOf(CLASSES) },
      types: {
        person: {
          extends: "concept",
          description: "A person page.",
          sections: { ...personSections(), depth: 3, ordered: false, additional: true },
        },
      },
    });
  }
});

describe("one core per line reaches the transition arm too (docs/concepts.md §Section grammar)", () => {
  function sourcedRegistry() {
    return constitutionOf({
      vocabularies: { categories: categoriesOf(CLASSES) },
      types: {
        person: {
          extends: "concept",
          description: "A person page.",
          sections: personSections("Facts", "History", { sources: ["wechat"] }),
        },
      },
    });
  }

  const run = (current: string, base: string) =>
    lintPage(
      { path: "wiki/张伟.md", doc: parseDoc(current), registry: sourcedRegistry() },
      { baseText: base },
    );

  it("the arm reads the type's declared `sources`, so a declared envelope is a marker", () => {
    const findings = run(
      page(["- [address] lives at 100 King St (wechat thread B)"]),
      page(["- [address] lives at 100 King St (wechat thread A)"]),
    );
    assert.equal(
      findings.some(isClaimArm),
      false,
      "two cores for one line is the class-C failure this slice exists to remove",
    );
  });

  it("and still gates a real replacement under that same vocabulary", () => {
    const findings = run(
      page(["- [address] lives at 200 Queen St (wechat thread A)"]),
      page(["- [address] lives at 100 King St (wechat thread A)"]),
    );
    assert.equal(findings.some(isClaimArm), true);
  });

  it("a section cannot be its own history — v3 has one declaration, not two", () => {
    // A section that declares `role: history` AND a `history` pointer says it
    // is its own history. There is one declaration site, so the contradiction
    // is a load error rather than something a second opinion arbitrates.
    const result = loadOf({
      vocabularies: { categories: categoriesOf(CLASSES) },
      types: {
        person: {
          extends: "concept",
          description: "A person page.",
          sections: personSections("Facts", "History", { role: "history" }),
        },
      },
    });
    assert.equal(result.ok, false);
    assert.match(JSON.stringify(result.ok ? [] : result.issues), /sections-params-exclusive/);
  });
});

describe("History landing uses exact normalized identity", () => {
  const supersedeRegistry = () => registryWith({ classes: { supersede: ["address"] } });
  const doc = (facts: string, history: string) =>
    `---\ntype: person\ntitle: T\ndescription: d.\ntags: []\n---\n\n## Facts\n${facts}\n\n## History\n${history}\n`;

  it("a superset core (Main ⊂ Mainland) does NOT land the old claim", () => {
    const base = doc("- [address] Main (stated 2026-01-01)", "");
    const cur = doc(
      "- [address] Elsewhere (stated 2026-09-01)",
      "- [address] Mainland (noted 2026-09-01)",
    );
    const findings = lintPage(
      { path: "wiki/t.md", doc: parseDoc(cur), registry: supersedeRegistry() },
      { baseText: base },
    );
    assert.equal(
      findings.some((f) => f.ruleId === "claims-transition"),
      true,
      "substring containment must not count as a History landing",
    );
  });

  it("an exact-core landing still passes", () => {
    const base = doc("- [address] Main (stated 2026-01-01)", "");
    const cur = doc(
      "- [address] Elsewhere (stated 2026-09-01)",
      // The complete-clause rule: `valid X→Y` with no `superseded` is not a
      // complete clause, so it stays in the core; the closing clause must complete.
      "- [address] Main (valid 2026-01-01→2026-09-01, superseded 2026-09-01)",
    );
    const findings = lintPage(
      { path: "wiki/t.md", doc: parseDoc(cur), registry: supersedeRegistry() },
      { baseText: base },
    );
    assert.equal(
      findings.some((f) => f.ruleId === "claims-transition"),
      false,
    );
  });
});
